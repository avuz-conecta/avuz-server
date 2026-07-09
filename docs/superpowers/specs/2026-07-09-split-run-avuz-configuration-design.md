# Split `run_avuz_configuration` — cheap-vs-heavy boot path

**Date:** 2026-07-09
**Status:** Design approved, pending spec review
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

A version bump runs only what a config release actually needs:
settings + pending migrations + enabling genuinely-new apps. Expensive repair and
store operations move behind a fresh-install / real-upgrade gate. New apps still
land enabled automatically; admin-disabled apps stay disabled; overlays stop
getting clobbered.

## Design

Split `run_avuz_configuration` into a cheap steady-state path plus a gated heavy
path. The call site (entrypoint.sh:688) is unchanged — the function still runs on
fresh install, after upgrade, or on a config-version mismatch.

### Every version bump (cheap)

Runs unconditionally inside the function:

1. `appstoreenabled=true` toggle (needed for the first-boot OIDC `app:install`).
2. **All settings** — every `config:system:set`, `config:app:set`,
   `theming:config`, the `avuz-upload.ini` write, and the `*imagePath*` Redis
   cache clear. Pure idempotent state (lines 217-473, 476). Extract into
   `apply_avuz_settings()`.
3. First-boot conditional installs, unchanged and still guarded by absence checks:
   OIDC (`app:install oidc` when absent) and Conecta Mail (`conectamail`).
4. `occ upgrade --no-interaction || true` — replaces `app:update --all`. Runs
   pending **core and app** DB migrations from on-disk (image-baked) code. No
   store download, no app-code re-extraction, so **overlays are not clobbered**.
   No-ops fast when nothing is pending. `|| true` because `occ upgrade` exits
   non-zero ("no upgrade required") when up to date.
5. `db:add-missing-indices --no-interaction` — kept every bump; no-op when
   indices already exist, and a newly-shipped app version may declare a new index.
6. **New-app-only enable loop** — replaces the blanket `--force` loop. For each
   app in `BUNDLED_APPS` + `ENABLE_APPS`:

   ```bash
   state=$(php occ config:app:get "$app" enabled 2>/dev/null)
   if [ -z "$state" ]; then
       php occ app:enable --force "$app" 2>/dev/null || echo "✗ Could not enable $app"
   fi
   ```

   - empty state → app never touched = **new** → enable (keep `--force`; some
     managed apps haven't declared support for the running NC version).
   - `yes` → already enabled → skip (no churn).
   - `no` → admin explicitly disabled → skip (respect admin).

   NC writes `enabled=no` in appconfig only on an explicit `app:disable`; a
   fresh image-added app has no row, so `config:app:get … enabled` returns empty.
7. `appstoreenabled=false` toggle.
8. Write `AVUZ_CONFIG_VERSION` stamp.

### Fresh install OR real upgrade only (heavy)

Gated on `NC_INSTALLED -eq 0 || DID_DB_UPGRADE -eq 1`:

- `maintenance:repair --include-expensive` — NC only requires this after an
  upgrade; running it on every config release was overkill.

### Overlays

`occ upgrade` uses on-disk app code and does not re-extract from the store, so the
steady-state path no longer clobbers overlays. The only store re-extraction left in
this function is the first-boot OIDC `app:install`. Overlay reapply
(`reapply_avuz_spreed_overlay`, `reapply_avuz_files_downloadlimit_overlay`, and
`reapply_avuz_deck_overlay`) therefore moves out of the steady-state path; it stays
in the existing upgrade branch (already present around line 635) and runs after the
first-boot OIDC install. Exact placement is an implementation detail for the plan.

## Behavior matrix

| Scenario | Settings | occ upgrade | add-missing-indices | new-app enable | expensive repair | app:update --all |
|---|---|---|---|---|---|---|
| Plain restart (same version) | skip (stamp gate) | skip | skip | skip | skip | — |
| Version bump, no NC upgrade | ✅ | ✅ (no-op) | ✅ (no-op) | ✅ new only | ❌ | ❌ removed |
| NC core upgrade | ✅ | ✅ | ✅ | ✅ new only | ✅ | ❌ removed |
| Fresh install | ✅ | ✅ | ✅ | ✅ (all new) | ✅ | ❌ removed |

## Risks & mitigations

- **App migration on a new bundled-app version without a core bump.** Handled:
  `occ upgrade` runs app migrations from on-disk code, so a newly-shipped app
  version migrates without the store or overlay clobber.
- **New app must auto-enable.** Handled by the new-app-only enable loop; it enables
  any managed app with no prior enabled state.
- **Admin-disabled app resurrecting.** Prevented: `enabled=no` short-circuits the
  loop. This is stricter than today's blanket `--force`, which re-enabled them.
- **OIDC (store-installed, not image-baked) misses store updates** now that
  `app:update --all` is gone. Pre-existing tension with the "Avuz owns the app
  upgrade cycle via image rebuilds" model; `occ upgrade` still runs OIDC's own
  migrations when its version changes. Out of scope here; note for follow-up.

## Testing

- Bump `AVUZ_CONFIG_VERSION`, redeploy on an existing stack: confirm log shows
  settings + `occ upgrade` no-op + only-new-apps enabled, and **no**
  `app:update --all` / no `maintenance:repair --include-expensive`.
- Disable a managed app via `occ app:disable`, bump version, redeploy: app stays
  disabled.
- Add a new app to `ENABLE_APPS`, bump version, redeploy: app is enabled.
- Overlay sentinels (`AVUZ-CHUNKED-UPLOAD-V1`, `AVUZ-DECK-CLONE-ORDER-V1`) still
  present after a version-bump redeploy.
- Fresh install still enables all apps and runs expensive repair.

## Out of scope

- Not bumping `AVUZ_CONFIG_VERSION` for code/overlay-only releases (operational
  discipline, not a code change).
- Zero-downtime / blue-green deploy.
- Moving OIDC to an image-baked app.
