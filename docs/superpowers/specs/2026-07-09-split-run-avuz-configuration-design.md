# Split `run_avuz_configuration` — cheap-vs-heavy boot path

**Date:** 2026-07-09
**Status:** Design approved (grilled), pending spec review
**File touched:** `docker/entrypoint.sh`

## Problem

Every image deploy that bumps `AVUZ_CONFIG_VERSION` re-runs `run_avuz_configuration`
whole. That function mixes cheap idempotent settings with three heavy operations,
so a routine theme/config release pays the full cost and stretches the container
recreate window:

- `app:update --all` (line 487) — queries the (locked) App Store and **re-extracts
  bundled apps, clobbering our spreed / files_downloadlimit / deck overlays**, which
  then have to be reapplied.
- `maintenance:repair --include-expensive` (line 481) — the main time sink.
- `app:enable --force` loop over every managed app (lines 494-496) — churns app
  state on every bump and fights Phase 4's stated intent ("on restarts, respect
  whatever the admin set").

Plain restarts (same version, no upgrade) already skip the whole function via the
stamp gate at line 692. The pain is specifically the version-bump path.

## Goal

A version bump runs only what a config release actually needs: settings + pending
migrations + enabling genuinely-new apps + disabling explicitly-retired apps.
Expensive repair and store operations move behind a fresh-install / real-upgrade
gate. New apps land enabled automatically; admin-disabled apps stay disabled;
overlays stop getting clobbered; a failed migration fails **closed** to a
maintenance page instead of silently reporting success.

## Design

Split `run_avuz_configuration` into a cheap steady-state path plus a gated heavy
path. The call site (entrypoint.sh:688) is unchanged — the function still runs on
fresh install, after upgrade, or on a config-version mismatch.

### Every version bump (cheap)

1. `appstoreenabled=true` toggle (needed for the first-boot OIDC `app:install`).
2. **All settings** — every `config:system:set`, `config:app:set`,
   `theming:config`, the `avuz-upload.ini` write, and the `*imagePath*` Redis
   cache clear (lines 217-473, 476). Extract into `apply_avuz_settings()`. Pure
   idempotent state.
3. First-boot conditional installs, unchanged and still guarded by absence checks:
   OIDC (`app:install oidc` when absent) and Conecta Mail (`conectamail`).
4. **`occ upgrade` with failure recovery** — replaces `app:update --all`. Runs
   pending core + app DB migrations from on-disk (image-baked) code. No store
   download, no app-code re-extraction, so **overlays are not clobbered**. Guarded
   and error-handled per the recovery contract below. Skipped when
   `DID_DB_UPGRADE -eq 1` (the core-upgrade branch already ran it this boot).
5. `db:add-missing-indices --no-interaction` — kept every bump; no-op when indices
   exist, and a newly-shipped app version may declare a new index.
6. **New-app-only enable** via the known-apps manifest (see below). Enables managed
   apps that are genuinely new; leaves admin-disabled and already-enabled apps
   untouched.
7. **App retirement** via `REMOVE_APPS` (see below) — `app:disable` only.
8. `appstoreenabled=false` toggle.
9. Write `AVUZ_CONFIG_VERSION` stamp (only reached if step 4 succeeded).

### Fresh install OR real upgrade only (heavy)

Gated on `NC_INSTALLED -eq 0 || DID_DB_UPGRADE -eq 1`:

- `maintenance:repair --include-expensive` — NC only requires this after an
  upgrade; running it on every config release was overkill.

### `occ upgrade` failure recovery contract

`occ upgrade` is idempotent and re-runnable, so recovery = retry next boot without
advancing the stamp, while failing closed to a maintenance page.

1. Run `occ upgrade --no-interaction`, capture exit code and output.
2. Classify **success** / **nothing-to-do** (benign) / **failure**. The exact
   signal NC 33 emits for "nothing to do" (exit code vs. output string) must be
   confirmed in-container — see Open Items. Do **not** use a blanket `|| true`.
3. On **failure**: write `data/.avuz_upgrade_failed` (timestamp + log tail), do
   **not** write the config stamp, `exit 1`. The container crash-loops → the
   failure is visible in Portainer, and the next boot retries `occ upgrade`
   (idempotent). Clear `.avuz_upgrade_failed` once an upgrade succeeds.
4. **Marker-gated maintenance mode.** entrypoint.sh:595 force-disables maintenance
   mode on every existing-install boot (it assumes maintenance-on = stale). When
   `data/.avuz_upgrade_failed` exists, **skip that force-off** so a genuinely
   failed upgrade stays in maintenance mode — users see the maintenance page, not
   a half-migrated app. Fail closed.

An app-code release that bumps an app's `info.xml` version incurs a small
app-migration window here (maintenance mode for the duration of that migration).
Accepted: it is smaller than a core upgrade and unavoidable regardless of approach.
Pure config/theme releases run `occ upgrade` as a fast no-op with no window.

### Known-apps manifest (new-app detection)

Distinguishing "never seen" from "admin disabled" requires persistent memory; NC
records neither reliably. Use a manifest file `data/.avuz_known_apps` (one appid
per line, on the persistent data volume).

- **First run (no manifest):** seed from every app NC currently knows —
  `occ app:list` (enabled **and** disabled sections). Enable nothing; just record.
  This respects existing state on the migration boot: pre-existing admin-disabled
  apps are recorded as known and never resurrected.
- **Subsequent runs:** for each app in `BUNDLED_APPS` + `ENABLE_APPS`, if it is
  **not** in the manifest → `app:enable --force` (keep `--force`; some managed apps
  haven't declared support for the running NC version) → append to manifest.
- Already-known apps are skipped: no churn, and admin `app:disable` choices survive
  because the app stays in the manifest.

The manifest is add-side only. It is **not** diffed against the enable arrays to
drive removal (that inference is unsafe — see Risks).

### App retirement via `REMOVE_APPS`

A new `REMOVE_APPS=(...)` array (declared near the other app lists) lets a deploy
retire an app intentionally:

- For each app in `REMOVE_APPS`: if enabled → `app:disable`. Never `app:remove`
  (that runs uninstall migrations and can DROP tables = irreversible user-data
  loss). Disable is reversible and keeps data.
- Removal is driven by explicit intent, not by "absent from the enable arrays."
  Inference against the arrays would false-positive on env-gated conditional apps
  (`oidc`, `conectamail`, `integration_openai`, enabled outside the arrays) and
  disable them every deploy.
- Manifest membership is unchanged by retirement: a retired app stays "known", so
  dropping it from `REMOVE_APPS` later does not auto-re-enable it.

### Overlays

`occ upgrade` uses on-disk app code and does not re-extract from the store, and the
overlays are baked into the image at build (Dockerfile:31/36/41) onto
`/var/www/html/apps/`, which is **not** a volume (portainer-stack.yml mounts only
`data`, `config`, `custom_apps`) — so every container recreate starts from a fresh,
overlaid `apps/`. The steady-state path therefore no longer needs overlay reapply.
The `reapply_avuz_*_overlay` calls at lines 488-489 are removed; the copies in the
core-upgrade branch (lines 637-639, 647-649) stay, since that path does re-extract.

## Behavior matrix

| Scenario | Settings | occ upgrade | add-missing-indices | new-app enable | REMOVE_APPS disable | expensive repair | app:update --all |
|---|---|---|---|---|---|---|---|
| Plain restart (same version) | skip (stamp gate) | skip | skip | skip | skip | skip | — |
| Version bump, no NC upgrade | ✅ | ✅ (no-op) | ✅ (no-op) | ✅ new only | ✅ | ❌ | ❌ removed |
| NC core upgrade | ✅ | skip (branch ran it) | ✅ | ✅ new only | ✅ | ✅ | ❌ removed |
| Fresh install | ✅ | ✅ | ✅ | seed only (no enable) | ✅ | ✅ | ❌ removed |

Note: on fresh install, apps are enabled by Phase 4 (entrypoint.sh:700-704) and the
manifest is seeded from the resulting state; the new-app loop enables nothing extra.

## Risks & mitigations

- **`occ upgrade` failure silently reporting success.** Mitigated by the recovery
  contract: no blanket `|| true`, marker file, no stamp advance, crash-loop, and
  marker-gated maintenance mode (fail closed).
- **App migration on a new bundled-app version without a core bump.** Handled:
  `occ upgrade` runs app migrations from on-disk code, no store, no overlay clobber.
- **New app must auto-enable.** Handled by the manifest: any managed app absent
  from the manifest is enabled.
- **Admin-disabled app resurrecting.** Prevented: the app is in the manifest, so
  the new-app loop skips it. Stricter than today's blanket `--force`.
- **Auto-removal false-positive on conditional apps.** Prevented by not inferring
  removal; only explicit `REMOVE_APPS` entries are disabled.
- **Destructive app removal.** Prevented: retirement is `app:disable` only, never
  `app:remove`.
- **Post-core-upgrade, NC auto-disables incompatible apps.** By decision, bringing
  them back is the admin's job via the UI; the existing `UPGRADE_STATE_FILE`
  re-enable (which restores apps that were enabled *before* the upgrade) is
  untouched. Out of scope.
- **OIDC (store-installed, not image-baked) misses store updates** now that
  `app:update --all` is gone. Pre-existing tension with the "Avuz owns the app
  upgrade cycle via image rebuilds" model; `occ upgrade` still runs OIDC's own
  migrations when its version changes. Out of scope; note for follow-up.

## Open items to verify in-container (before implementation)

- **`occ upgrade` "nothing-to-do" signal on NC 33** — exact exit code and/or output
  string, so step 4 can classify benign no-op vs real failure without `|| true`.
- **Seed parse for `occ app:list`** — confirm the enabled+disabled section format so
  the manifest seed captures every known appid.

## Testing

- Bump `AVUZ_CONFIG_VERSION`, redeploy on an existing stack: log shows settings +
  `occ upgrade` no-op + only-new-apps enabled, and **no** `app:update --all` / no
  `maintenance:repair --include-expensive`.
- Disable a managed app via `occ app:disable`, bump version, redeploy: stays
  disabled.
- Add a new app to `ENABLE_APPS`, bump version, redeploy: app is enabled and
  appended to `data/.avuz_known_apps`.
- Add an app to `REMOVE_APPS`, redeploy: app is disabled, data intact, still listed
  in `occ app:list`.
- Simulate a failing `occ upgrade`: `.avuz_upgrade_failed` written, stamp **not**
  advanced, container crash-loops, maintenance mode stays **on** across the retry
  boot (line-595 force-off skipped).
- Overlay sentinels (`AVUZ-CHUNKED-UPLOAD-V1`, `admin-download-limit`,
  `AVUZ-DECK-CLONE-ORDER-V1`) still present after a version-bump redeploy.
- Fresh install still enables all apps and runs expensive repair.

## Out of scope

- Not bumping `AVUZ_CONFIG_VERSION` for code/overlay-only releases (operational
  discipline, not a code change).
- Diff-based auto-removal (rejected for conditional-app false-positives).
- Hard `app:remove` / data purge.
- Zero-downtime / blue-green deploy.
- Moving OIDC to an image-baked app.
- Fail-closed coverage of the core-upgrade branch (`needsDbUpgrade: true` path). The
  marker + maintenance-gate protect only the config-path `occ upgrade`; the
  core-upgrade branch keeps its existing `UPGRADE_STATE_FILE` behavior.
