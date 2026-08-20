# App Sourcing Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Nextcloud apps Avuz does not patch be installed and updated from the App Store at boot, while making it impossible for a store copy to silently shadow an Avuz-patched app.

**Architecture:** Split every app into exactly two disjoint sets — `AVUZ_OWNED_APPS` (carry an Avuz overlay or fork; image-owned, never store-touched) and `AVUZ_STORE_APPS` (vanilla; installed/updated from the store inside the existing `appstoreenabled=true` window in `run_avuz_configuration`). Three safety mechanisms land *before* the store sync: the patch sentinel check becomes path-resolved via `occ app:getpath`, stale shadow copies of owned apps are purged from the `custom_apps` volume, and a code-vs-DB downgrade detector heals or warns when an app's code is older than its migrated schema.

**Tech Stack:** Bash (`docker/lib-apps.sh` pure functions + `docker/tests/apps.test.sh` harness), `occ` CLI, Docker image build, Portainer API for staging verification.

## Global Constraints

- **Never `occ app:update --all`.** It pulls every app from the store and clobbers Avuz overlays. Only targeted `occ app:update <app>` / `occ app:install <app>`, and only for apps in `AVUZ_STORE_APPS`.
- **Never `occ app:remove`.** It runs uninstall migrations and can DROP tables = irreversible user-data loss. Retirement is `app:disable` only (existing `avuz_retire_apps` rule).
- **`AVUZ_OWNED_APPS` and `AVUZ_STORE_APPS` must be disjoint.** Enforced by a test, not by convention.
- **Owned apps, verbatim:** `spreed`, `deck`, `files_downloadlimit`, `integration_openai`. These carry sentinels `AVUZ-CHUNKED-UPLOAD-V2`, `AVUZ-DECK-CLONE-ORDER-V1`, `admin-download-limit`, `AVUZ-AUDIO-EXTRACT-V1` respectively.
- **App path facts:** `/var/www/html/apps` is the image layer. `/var/www/html/custom_apps`, `/var/www/html/data`, `/var/www/html/config` are mounted volumes. Nextcloud resolves an app to the **highest version across all app paths**; store installs land in `custom_apps`.
- **New pure functions go in `docker/lib-apps.sh`** with tests in `docker/tests/apps.test.sh`, following the existing `AVUZ_OCC_DRYRUN=1` / `_avuz_occ` convention. No side effects on source.
- **Bump `AVUZ_CONFIG_VERSION`** (currently `33.0.0-14`, [docker/entrypoint.sh:5](docker/entrypoint.sh:5)) so `run_avuz_configuration` re-runs on deploy.
- **Run the test suite with:** `bash docker/tests/apps.test.sh` — expect every line to start `ok - ` and exit 0.
- **Do this work in a worktree branched off `avuz-customization`**, not on the branch directly. Worktree: `.claude/worktrees/app-sourcing-policy`, branch `avuz/app-sourcing-policy`.
- **Never build an image from the worktree.** `/apps*/*` is gitignored, so the worktree has ~30 apps vs the main checkout's 54 — a worktree build ships an image missing `forms` and most bundled apps. Merge the branch onto `avuz-customization` first, then build from the main checkout (Task 6, Step 1).
- **Never branch from `origin/master`.** It is upstream Nextcloud and contains **zero** Avuz files; `avuz-customization` is the effective main branch.

## Measured Starting State (staging `avuz-conecta-app-1`, 2026-07-22)

| App | `apps/` (image) | `custom_apps/` (volume) | occ resolves |
|---|---|---|---|
| spreed | 23.0.1 (patched) | 22.0.4 — **no sentinel** | 23.0.1 |
| deck | 1.17.0 (patched) | 1.16.2 — **no sentinel** | 1.17.0 |
| files_downloadlimit | 2.0.0 (patched) | 2.0.0 — **tie, undefined order** | 2.0.0 |
| integration_openai | 4.5.1.7 (fork) | absent | 4.5.1.7 |
| forms | 5.2.5 | 5.2.3 | 5.2.5 |

Prod `avuz-app3`: forms code 5.2.5, but `oc_forms_v2_forms` already has the 5.3 columns `max_submissions`, `confirmation_email_*`, `allow_comments` — code is behind its own migrated schema, which is the bug this plan closes.

## File Structure

- **Modify `docker/lib-apps.sh`** — add `avuz_app_path`, `avuz_sentinel_target`, `avuz_shadow_copies`, `avuz_version_lt`, `avuz_code_behind_db`, `avuz_sync_store_apps`, `avuz_assert_disjoint`. Pure/testable; all occ calls via `_avuz_occ`.
- **Modify `docker/tests/apps.test.sh`** — one assertion block per new function.
- **Modify `docker/entrypoint.sh`** — declare the two app sets, make `verify_avuz_patches` path-resolved, call purge + downgrade guard + store sync in `run_avuz_configuration`, bump `AVUZ_CONFIG_VERSION`.
- **Modify `CLAUDE.md`** — document the sourcing policy so the golden-checkout instructions stop being the only story.

---

### Task 1: Path-resolved patch sentinel check

Today `verify_avuz_patches` greps hardcoded `/var/www/html/apps/<app>/...`. If a store copy in `custom_apps` outranks the image copy, NC serves the unpatched app and this check **still passes**. Resolve the path NC actually uses.

**Files:**
- Modify: `docker/lib-apps.sh`
- Modify: `docker/entrypoint.sh:71-100` (`verify_avuz_patches`)
- Test: `docker/tests/apps.test.sh`

**Interfaces:**
- Consumes: `_avuz_occ` (existing).
- Produces: `avuz_app_path <appid>` → absolute path string, empty on failure. `avuz_sentinel_target <appid> <relative-path>` → absolute file path, empty when the app path cannot be resolved.

- [ ] **Step 1: Write the failing test**

Append to `docker/tests/apps.test.sh`:

```bash
# ── app path resolution ──
_avuz_occ() { echo "/var/www/html/custom_apps/spreed"; }
assert_eq "app_path returns occ getpath output" \
    "/var/www/html/custom_apps/spreed" "$(avuz_app_path spreed)"

assert_eq "sentinel_target joins path and relative file" \
    "/var/www/html/custom_apps/spreed/lib/Controller/RecordingController.php" \
    "$(avuz_sentinel_target spreed lib/Controller/RecordingController.php)"

_avuz_occ() { return 1; }
assert_eq "app_path empty when occ fails" "" "$(avuz_app_path spreed)"
assert_eq "sentinel_target empty when path unresolved" "" \
    "$(avuz_sentinel_target spreed lib/Controller/RecordingController.php)"
unset -f _avuz_occ
source "$HERE/../lib-apps.sh"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash docker/tests/apps.test.sh`
Expected: FAIL — `avuz_app_path: command not found`

- [ ] **Step 3: Write minimal implementation**

Append to `docker/lib-apps.sh`:

```bash
# Resolve the path Nextcloud actually uses for an app. NC picks the highest
# version across all app paths, so the image copy is NOT authoritative — a
# store install in the custom_apps volume can outrank it. Empty on failure.
avuz_app_path() {
    local app="$1" path
    path="$(_avuz_occ app:getpath "$app" 2>/dev/null)" || return 0
    printf '%s' "$path"
}

# Absolute path to a sentinel-bearing file inside the app NC resolved.
# Empty when the app path cannot be resolved, so the caller fails closed.
avuz_sentinel_target() {
    local app="$1" relative="$2" base
    base="$(avuz_app_path "$app")"
    [ -n "$base" ] || return 0
    printf '%s/%s' "$base" "$relative"
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bash docker/tests/apps.test.sh`
Expected: PASS — every line starts `ok - `, exit 0

- [ ] **Step 5: Rewrite `verify_avuz_patches` to use resolved paths**

Replace the `checks` array and loop in `docker/entrypoint.sh:76-94` with app-id-keyed entries. Format becomes `"<sentinel>|<appid>|<relative-path>|<hint>"`; the `files-main.js` check has no app id and keeps an absolute path via the sentinel app id `-`:

```bash
    local checks=(
        "AVUZ-CHUNKED-UPLOAD-V2|spreed|lib/Controller/RecordingController.php|spreed overlay missing — redeploy from latest image or rerun reapply_avuz_spreed_overlay"
        "Upload in progress — do not close this tab|-|/var/www/html/dist/files-main.js|files-main.js was not rebuilt with the upload-leave-warning patch — run 'npm run build' before baking the image"
        "admin-download-limit|files_downloadlimit|templates/admin.php|files_downloadlimit overlay missing — upstream 2.0.0 tarball drops this template (GH nextcloud/files_downloadlimit#421); redeploy or rerun reapply_avuz_files_downloadlimit_overlay"
        "AVUZ-AUDIO-EXTRACT-V1|integration_openai|lib/Service/OpenAiAPIService.php|integration_openai fork missing/clobbered — submodule not shipped, or app:update replaced it (check the appinfo version pin >= store)"
        "AVUZ-DECK-CLONE-ORDER-V1|deck|lib/Service/BoardService.php|deck overlay missing — board-copy column/card shift fix lost; redeploy or rerun reapply_avuz_deck_overlay"
    )
    local failed=0
    for entry in "${checks[@]}"; do
        local sentinel="${entry%%|*}"
        local rest="${entry#*|}"
        local app="${rest%%|*}"
        rest="${rest#*|}"
        local relative="${rest%%|*}"
        local hint="${rest#*|}"
        local target
        if [ "$app" = "-" ]; then
            target="$relative"
        else
            target="$(avuz_sentinel_target "$app" "$relative")"
        fi
        if [ -z "$target" ]; then
            echo "✗ AVUZ PATCH UNVERIFIABLE: could not resolve app path for '$app'"
            echo "  $hint"
            failed=1
            continue
        fi
        if ! grep -q "$sentinel" "$target" 2>/dev/null; then
            echo "✗ AVUZ PATCH MISSING: sentinel '$sentinel' not found in $target"
            echo "  $hint"
            failed=1
        fi
    done
```

- [ ] **Step 6: Commit**

```bash
git add docker/lib-apps.sh docker/tests/apps.test.sh docker/entrypoint.sh
git commit -m "fix(entrypoint): resolve patch sentinels via occ app:getpath

Sentinel checks grepped hardcoded /var/www/html/apps paths, so a higher-version
store copy in the custom_apps volume could shadow a patched app while the check
still passed. Resolve the path NC actually uses and fail closed when it cannot
be resolved."
```

---

### Task 2: Purge shadow copies of Avuz-owned apps

The `custom_apps` volume already holds unpatched `spreed` 22.0.4, `deck` 1.16.2, and a version-tied `files_downloadlimit` 2.0.0.

**Safety basis (measured on both staging instances, 2026-07-22).** All four owned apps already resolve to `/var/www/html/apps/` — including `files_downloadlimit` despite the version tie. The `custom_apps` copies are **dormant: Nextcloud is not loading them.** Their contents are pure distributed app code (`lib`, `vendor`, `js`, `css`, `l10n`, `appinfo`, `templates`, license files) with **zero files modified since 2026-01-01**, i.e. nothing is ever written to them at runtime. App state lives in the database (`oc_appconfig`, `oc_preferences`) and in `/var/www/html/data/appdata_*`, neither of which this task touches.

**Two hardenings over a naive `rm -rf`:**

1. **Never orphan an app.** Purge only when a usable image copy exists (`/var/www/html/apps/<app>/appinfo/info.xml` present). If it is missing, skip and warn — deleting the `custom_apps` copy would remove the only copy and the app really would vanish.
2. **Reversible.** Move to a quarantine directory on the data volume instead of deleting. An operator can restore it; one generation is kept.

Never `app:remove` — that runs uninstall migrations and can DROP tables.

**Files:**
- Modify: `docker/lib-apps.sh`
- Modify: `docker/entrypoint.sh` (call inside `run_avuz_configuration`)
- Test: `docker/tests/apps.test.sh`

**Interfaces:**
- Consumes: `AVUZ_OWNED_APPS` array (declared in Task 4; for this task the function takes the list as arguments).
- Produces: `avuz_shadow_copies <custom_apps_dir> <image_apps_dir> <app>...` → newline-separated paths that are safe to purge (custom copy present **and** image copy usable). `avuz_purge_shadow_copies <custom_apps_dir> <image_apps_dir> <quarantine_dir> <app>...` → moves them to quarantine, logging each; warns and skips any app lacking a usable image copy.

- [ ] **Step 1: Write the failing test**

Append to `docker/tests/apps.test.sh`:

```bash
# ── shadow copy detection / purge ──
shadow_root="$(mktemp -d)"; image_root="$(mktemp -d)"; quarantine="$(mktemp -d)"
mkdir -p "$shadow_root/spreed" "$shadow_root/deck" "$shadow_root/forms" "$shadow_root/orphan"
# usable image copies for spreed and deck only
mkdir -p "$image_root/spreed/appinfo" "$image_root/deck/appinfo"
touch "$image_root/spreed/appinfo/info.xml" "$image_root/deck/appinfo/info.xml"

assert_eq "shadow_copies lists owned apps that have an image fallback" \
"$shadow_root/spreed
$shadow_root/deck" \
    "$(avuz_shadow_copies "$shadow_root" "$image_root" spreed deck orphan integration_openai)"

purge_out="$(avuz_purge_shadow_copies "$shadow_root" "$image_root" "$quarantine" \
    spreed deck orphan integration_openai)"

assert_eq "purge quarantines owned shadow copy" "gone" \
    "$([ -e "$shadow_root/spreed" ] && echo present || echo gone)"
assert_eq "purge is reversible — copy lands in quarantine" "present" \
    "$([ -d "$quarantine/spreed" ] && echo present || echo gone)"
assert_eq "purge NEVER touches an app with no image fallback" "present" \
    "$([ -e "$shadow_root/orphan" ] && echo present || echo gone)"
assert_eq "orphan is warned about" "yes" \
    "$(printf '%s' "$purge_out" | grep -q 'no image copy' && echo yes || echo no)"
assert_eq "purge leaves non-owned app untouched" "present" \
    "$([ -e "$shadow_root/forms" ] && echo present || echo gone)"
assert_eq "purge is idempotent" "0" \
    "$(avuz_purge_shadow_copies "$shadow_root" "$image_root" "$quarantine" spreed deck >/dev/null; echo $?)"
rm -rf "$shadow_root" "$image_root" "$quarantine"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash docker/tests/apps.test.sh`
Expected: FAIL — `avuz_shadow_copies: command not found`

- [ ] **Step 3: Write minimal implementation**

Append to `docker/lib-apps.sh`:

```bash
# Pure: emit custom_apps directories for Avuz-owned apps that are SAFE to purge.
# These shadow the patched image copy whenever their version is higher (NC
# resolves an app to the highest version across app paths), silently serving
# unpatched code. An app is only listed when a usable image copy exists —
# without that fallback, removing the custom_apps copy would remove the only
# copy and the app would genuinely disappear.
avuz_shadow_copies() {
    local root="$1" image_root="$2"; shift 2
    local app
    for app in "$@"; do
        # Explicit `if` rather than `[ … ] && echo`: under the entrypoint's
        # `set -e`, a trailing AND-list whose left side fails aborts the boot.
        if [ -d "$root/$app" ] && [ -f "$image_root/$app/appinfo/info.xml" ]; then
            echo "$root/$app"
        fi
    done
    return 0
}

# Quarantine shadow copies of Avuz-owned apps from the custom_apps volume.
#
# Safety properties, in order of importance:
#   1. Never `occ app:remove` — that runs uninstall migrations and can DROP
#      tables (irreversible user-data loss). This function only moves a code
#      directory.
#   2. Never orphan an app: skips (and warns about) any app without a usable
#      image copy to fall back to.
#   3. Reversible: moves to a quarantine dir on the data volume rather than
#      deleting, so an operator can restore it. One generation is kept.
#
# App state (oc_appconfig, oc_preferences, data/appdata_*) is untouched — these
# directories hold distributed code only and are never written to at runtime.
# Idempotent.
avuz_purge_shadow_copies() {
    local root="$1" image_root="$2" quarantine="$3"; shift 3
    local app path
    for app in "$@"; do
        if [ ! -d "$root/$app" ]; then
            continue
        fi
        if [ ! -f "$image_root/$app/appinfo/info.xml" ]; then
            echo "✗ SKIPPING shadow purge of $root/$app — no image copy to fall back to"
            echo "  Removing it would delete the only copy of '$app'. Fix the image first."
            continue
        fi
        mkdir -p "$quarantine"
        rm -rf "${quarantine:?}/$app"
        mv "$root/$app" "$quarantine/$app"
        echo "✓ Quarantined shadow copy $root/$app -> $quarantine/$app (image copy is authoritative)"
    done
    return 0
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bash docker/tests/apps.test.sh`
Expected: PASS — every line starts `ok - `, exit 0

- [ ] **Step 5: Commit**

```bash
git add docker/lib-apps.sh docker/tests/apps.test.sh
git commit -m "feat(entrypoint): quarantine custom_apps shadow copies of owned apps

The custom_apps volume carries unpatched spreed 22.0.4 and deck 1.16.2, plus a
version-tied files_downloadlimit 2.0.0 resolved by undefined path order. These
copies are dormant today (NC resolves all four to the image copy) but shadow the
patched code the moment their version wins.

Move rather than delete, and skip any app lacking an image copy to fall back on,
so the purge can never orphan an app. Never app:remove — app state in the DB and
data/appdata_* is untouched."
```

---

### Task 3: Code-behind-schema downgrade guard

Prod `avuz-app3` runs Forms code 5.2.5 against a schema already migrated to 5.3. Detect that state, try to heal it from the store, and warn loudly if it persists. **Non-fatal by design:** refusing boot over one stale app would turn a single broken feature into a full outage across 10+ tenants.

**Files:**
- Modify: `docker/lib-apps.sh`
- Modify: `docker/entrypoint.sh` (call inside `run_avuz_configuration`)
- Test: `docker/tests/apps.test.sh`

**Interfaces:**
- Consumes: `_avuz_occ`, `avuz_app_path`.
- Produces: `avuz_version_lt <a> <b>` → returns 0 when a < b. `avuz_code_behind_db <appid> <code_version> <db_version>` → prints `behind` or `ok`.

- [ ] **Step 1: Write the failing test**

Append to `docker/tests/apps.test.sh`:

```bash
# ── version comparison ──
assert_eq "5.2.5 < 5.3.0"      "yes" "$(avuz_version_lt 5.2.5 5.3.0 && echo yes || echo no)"
assert_eq "5.3.0 not < 5.2.5"  "no"  "$(avuz_version_lt 5.3.0 5.2.5 && echo yes || echo no)"
assert_eq "equal is not less"  "no"  "$(avuz_version_lt 5.2.5 5.2.5 && echo yes || echo no)"
assert_eq "4.5.1.7 < 4.5.2"    "yes" "$(avuz_version_lt 4.5.1.7 4.5.2 && echo yes || echo no)"

# ── downgrade detection ──
assert_eq "code older than schema is behind" "behind" "$(avuz_code_behind_db forms 5.2.5 5.3.0)"
assert_eq "code matching schema is ok"       "ok"     "$(avuz_code_behind_db forms 5.3.0 5.3.0)"
assert_eq "code newer than schema is ok"     "ok"     "$(avuz_code_behind_db forms 5.3.5 5.3.0)"
assert_eq "missing db version is ok"         "ok"     "$(avuz_code_behind_db forms 5.2.5 '')"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash docker/tests/apps.test.sh`
Expected: FAIL — `avuz_version_lt: command not found`

- [ ] **Step 3: Write minimal implementation**

Append to `docker/lib-apps.sh`:

```bash
# Pure: return 0 when version $1 sorts strictly before $2. Uses sort -V, which
# handles Nextcloud's 4-segment app versions (e.g. 4.5.1.7) correctly.
avuz_version_lt() {
    local a="$1" b="$2"
    # Explicit `if` — a trailing `[ … ] && return 1` would abort the boot under
    # `set -e` on the not-equal path.
    if [ "$a" = "$b" ]; then
        return 1
    fi
    [ "$(printf '%s\n%s\n' "$a" "$b" | sort -V | head -1)" = "$a" ]
}

# Pure: report whether an app's on-disk code is older than the schema its own
# migrations already applied. This is the Forms failure mode — a store install
# migrates the DB, then the code reverts (lost custom_apps volume, or an image
# rebuilt from a stale checkout) while the schema stays ahead. An empty db
# version means the app was never installed, which is not a downgrade.
avuz_code_behind_db() {
    local _app="$1" code="$2" db="$3"
    [ -n "$db" ] || { echo "ok"; return; }
    [ -n "$code" ] || { echo "ok"; return; }
    if avuz_version_lt "$code" "$db"; then echo "behind"; else echo "ok"; fi
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bash docker/tests/apps.test.sh`
Expected: PASS — every line starts `ok - `, exit 0

- [ ] **Step 5: Add the runtime guard that uses them**

Append to `docker/lib-apps.sh`:

```bash
# Warn (and try to heal) when an app's code is behind its migrated schema.
# Heals only apps in the store-managed set — an owned app that is behind means
# the image is wrong and a store pull would clobber the Avuz overlay, so those
# are reported for a human to fix by rebuilding the image. Non-fatal: one stale
# app must not take a tenant offline.
avuz_guard_app_downgrades() {
    local store_apps="$1"; shift
    local app code db state base
    for app in "$@"; do
        base="$(avuz_app_path "$app")"
        [ -n "$base" ] || continue
        code="$(grep -o '<version>[^<]*' "$base/appinfo/info.xml" 2>/dev/null | head -1 | cut -d'>' -f2)"
        db="$(_avuz_occ config:app:get "$app" installed_version 2>/dev/null | tr -d '[:space:]')"
        state="$(avuz_code_behind_db "$app" "$code" "$db")"
        [ "$state" = "behind" ] || continue
        echo "✗ DOWNGRADE DETECTED: $app code $code is older than its migrated schema $db"
        if printf '%s\n' $store_apps | grep -qxF "$app"; then
            echo "  Healing from App Store..."
            if _avuz_occ app:update "$app"; then
                echo "  ✓ $app updated from store"
            else
                echo "  ✗ $app store update failed — app may misbehave until the next deploy"
            fi
        else
            echo "  $app is Avuz-owned: rebuild the image with a version >= $db (do NOT store-update, it would clobber the overlay)"
        fi
    done
    return 0
}
```

- [ ] **Step 6: Commit**

```bash
git add docker/lib-apps.sh docker/tests/apps.test.sh
git commit -m "feat(entrypoint): detect apps whose code is behind their migrated schema

Forms on prod runs 5.2.5 against a 5.3 schema. Detect the state, heal
store-managed apps from the store, and report owned apps for an image rebuild.
Non-fatal: one stale app must not take a tenant offline."
```

---

### Task 4: Store-managed app sync

Declare the two disjoint app sets and sync the store-managed ones inside the existing `appstoreenabled=true` window.

**Files:**
- Modify: `docker/lib-apps.sh`
- Modify: `docker/entrypoint.sh:42-66` (app set declarations)
- Test: `docker/tests/apps.test.sh`

**Interfaces:**
- Consumes: `_avuz_occ`.
- Produces: `avuz_assert_disjoint <listA> <listB>` → prints offending app ids, empty when disjoint. `avuz_sync_store_apps <app>...` → installs missing apps, updates present ones.

- [ ] **Step 1: Write the failing test**

Append to `docker/tests/apps.test.sh`:

```bash
# ── disjointness ──
assert_eq "disjoint sets report nothing" "" \
    "$(avuz_assert_disjoint "forms calendar" "spreed deck")"
assert_eq "overlap is reported" "spreed" \
    "$(avuz_assert_disjoint "forms spreed" "spreed deck")"

# ── store sync plan ──
export AVUZ_OCC_DRYRUN=1
sync_out="$(avuz_sync_store_apps forms calendar)"
assert_eq "sync updates apps already present" "yes" \
    "$(printf '%s' "$sync_out" | grep -q 'OCC app:update forms' && echo yes || echo no)"
assert_eq "sync never uses --all" "no" \
    "$(printf '%s' "$sync_out" | grep -q -- '--all' && echo yes || echo no)"
unset AVUZ_OCC_DRYRUN
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash docker/tests/apps.test.sh`
Expected: FAIL — `avuz_assert_disjoint: command not found`

- [ ] **Step 3: Write minimal implementation**

Append to `docker/lib-apps.sh`:

```bash
# Pure: emit app ids present in both lists. The owned/store split is a safety
# boundary — an app in both sets would get store-updated and lose its overlay,
# so this is asserted at boot rather than trusted to convention.
avuz_assert_disjoint() {
    local a="$1" b="$2" app
    for app in $a; do
        # Explicit `if` — see avuz_shadow_copies: a trailing AND-list that fails
        # would abort the boot under `set -e`.
        if printf '%s\n' $b | grep -qxF "$app"; then
            echo "$app"
        fi
    done
    return 0
}

# Install or update each store-managed app. Targeted calls only: `app:update
# --all` would pull every app from the store and clobber the Avuz overlays, which
# is why the entrypoint moved to `occ upgrade` in the first place. Failures are
# logged and skipped — a store outage must not abort the boot.
avuz_sync_store_apps() {
    local app
    for app in "$@"; do
        if _avuz_occ app:getpath "$app" >/dev/null 2>&1; then
            if _avuz_occ app:update "$app"; then
                echo "✓ $app up to date from store"
            else
                echo "✗ $app store update failed (offline? store outage?) — keeping current version"
            fi
        else
            if _avuz_occ app:install "$app"; then
                echo "✓ $app installed from store"
            else
                echo "✗ $app store install failed (offline? store outage?)"
            fi
        fi
    done
    return 0
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bash docker/tests/apps.test.sh`
Expected: PASS — every line starts `ok - `, exit 0

- [ ] **Step 5: Declare the app sets in the entrypoint**

Insert after the `ENABLE_APPS` array closes at `docker/entrypoint.sh:66`:

```bash
# Apps carrying an Avuz overlay or fork. Image-owned: never store-installed,
# never store-updated, and their custom_apps shadow copies are purged at boot.
# Adding an app here without adding an overlay is harmless; the reverse is not.
AVUZ_OWNED_APPS=(
    "spreed"
    "deck"
    "files_downloadlimit"
    "integration_openai"
)

# Vanilla apps Avuz does not patch. Installed and updated from the App Store
# inside the appstoreenabled window in run_avuz_configuration, so upstream fixes
# arrive without an image rebuild. The store serves the newest release compatible
# with the running NC major — there is no version pin (occ app:install/app:update
# have no --version flag), and that unpinned "latest compatible" is the accepted
# trade for not owning these apps. Start narrow; widen once staging proves a boot.
AVUZ_STORE_APPS=(
    "forms"
)
```

- [ ] **Step 6: Commit**

```bash
git add docker/lib-apps.sh docker/tests/apps.test.sh docker/entrypoint.sh
git commit -m "feat(entrypoint): declare owned vs store-managed app sets

Apps Avuz patches stay image-owned; vanilla apps sync from the store at boot.
Targeted app:install/app:update only, never --all."
```

---

### Task 5: Wire the boot sequence

Order matters: purge shadow copies and verify sentinels **before** the store sync, so a bad store pull is caught on the same boot rather than the next one.

**Files:**
- Modify: `docker/entrypoint.sh:5` (`AVUZ_CONFIG_VERSION`)
- Modify: `docker/entrypoint.sh:484-553` (`run_avuz_configuration`)

**Interfaces:**
- Consumes: `avuz_purge_shadow_copies`, `avuz_sync_store_apps`, `avuz_guard_app_downgrades`, `avuz_assert_disjoint`, `verify_avuz_patches`, `AVUZ_OWNED_APPS`, `AVUZ_STORE_APPS`.
- Produces: no new interfaces.

- [ ] **Step 1: Assert disjointness at the top of `run_avuz_configuration`**

Insert immediately after `echo "═══ Running Avuz Conecta configuration ═══"` at `docker/entrypoint.sh:485`:

```bash
    _avuz_overlap="$(avuz_assert_disjoint "${AVUZ_OWNED_APPS[*]}" "${AVUZ_STORE_APPS[*]}")"
    if [ -n "$_avuz_overlap" ]; then
        echo "✗ CONFIG ERROR: app(s) in both AVUZ_OWNED_APPS and AVUZ_STORE_APPS: $_avuz_overlap"
        echo "  A store update would clobber the Avuz overlay. Refusing to boot."
        exit 1
    fi

    # Owned apps must win path resolution before anything else runs.
    avuz_purge_shadow_copies /var/www/html/custom_apps /var/www/html/apps \
        "$AVUZ_SHADOW_QUARANTINE" "${AVUZ_OWNED_APPS[@]}"
```

- [ ] **Step 2: Sync store apps inside the store window**

Insert immediately after `php occ config:system:set appstoreenabled --value=true --type=boolean` at `docker/entrypoint.sh:489`:

```bash
    # Vanilla apps track the store; owned apps are untouched here by construction
    # (disjointness asserted above).
    echo "Syncing store-managed apps..."
    avuz_sync_store_apps "${AVUZ_STORE_APPS[@]}"
```

- [ ] **Step 3: Run the downgrade guard after `occ upgrade`**

Insert immediately after the `occ upgrade` block closes at `docker/entrypoint.sh:523` (after the `fi`):

```bash
    avuz_guard_app_downgrades "${AVUZ_STORE_APPS[*]}" \
        "${AVUZ_STORE_APPS[@]}" "${AVUZ_OWNED_APPS[@]}"
```

- [ ] **Step 4: Re-verify patches after the store window closes**

Insert immediately after `php occ config:system:set appstoreenabled --value=false --type=boolean` at `docker/entrypoint.sh:549`:

```bash
    # A store install could have landed a higher-version copy of an owned app in
    # custom_apps. Purge again and re-verify sentinels against the RESOLVED path
    # so a clobbered overlay fails this boot, not silently at runtime.
    avuz_purge_shadow_copies /var/www/html/custom_apps /var/www/html/apps \
        "$AVUZ_SHADOW_QUARANTINE" "${AVUZ_OWNED_APPS[@]}"
    verify_avuz_patches
```

- [ ] **Step 5: Declare the quarantine path and bump the config version**

In `docker/entrypoint.sh:5`, change:

```bash
AVUZ_CONFIG_VERSION="33.0.0-14"
```

to:

```bash
AVUZ_CONFIG_VERSION="33.0.0-15"
```

Then add the quarantine path alongside the other state paths, after `UPGRADE_FAILED_MARKER` at `docker/entrypoint.sh:9`:

```bash
# Shadow copies of Avuz-owned apps are moved here rather than deleted, so a bad
# purge is recoverable. Lives on the data volume; one generation is kept.
AVUZ_SHADOW_QUARANTINE="/var/www/html/data/.avuz_shadow_quarantine"
```

- [ ] **Step 6: Verify the whole suite still passes**

Run: `bash docker/tests/apps.test.sh`
Expected: PASS — every line starts `ok - `, exit 0

Run: `bash -n docker/entrypoint.sh`
Expected: no output (syntax OK)

- [ ] **Step 7: Commit**

```bash
git add docker/entrypoint.sh
git commit -m "feat(entrypoint): wire store-app sync, shadow purge and downgrade guard

Purge shadow copies and assert set disjointness before the store window; sync
store-managed apps inside it; guard downgrades after occ upgrade; re-purge and
re-verify sentinels after it closes."
```

---

### Task 6: Staging rollout and verification

Two staging instances exist and start from *different* app-path states (`avuz-conecta-app-1` has a `custom_apps/forms` 5.2.3 shadow, `avuz-conecta-2-app-1` has none), which exercises both the purge path and the clean path.

**Files:**
- No source changes. Verification only.

**Interfaces:**
- Consumes: `scripts/build-push.sh`, `scripts/portainer-exec.sh`.
- Produces: evidence that the boot sequence works before prod.

- [ ] **Step 1: Merge to `avuz-customization`, then build from there**

**Do not build from the worktree.** `.gitignore` excludes `/apps*/*`, so the worktree carries only ~30 force-added apps while the main checkout has 54 — a worktree build would ship an image missing `forms` and most bundled apps. Merge first, build from the main checkout:

```bash
git -C /Users/patrickrezende/work/avuz/avuz-server checkout avuz-customization
```
```bash
git -C /Users/patrickrezende/work/avuz/avuz-server merge --no-ff avuz/app-sourcing-policy
```
```bash
cd /Users/patrickrezende/work/avuz/avuz-server && ./scripts/build-push.sh latest staging
```

Expected: build completes, image pushed as `registry.avuz.app/admin/avuzconecta:staging`.

Sanity-check before building — the main checkout must still have the full app set:

```bash
ls /Users/patrickrezende/work/avuz/avuz-server/apps/ | wc -l
```
Expected: `54` (not ~30). If it reads ~30 you are in the worktree, not the main checkout.

- [ ] **Step 2: Redeploy both staging stacks, then capture boot logs**

Redeploy `avuz-conecta` and `avuz-conecta-2` from Portainer, then:

```bash
./scripts/portainer-exec.sh avuz-conecta-app-1 sh -c 'tail -120 /var/log/supervisor/entrypoint.log 2>/dev/null || true'
```

Expected in the log: `✓ Purged shadow copy /var/www/html/custom_apps/spreed`, `✓ forms up to date from store`, `✓ Avuz patches present`.

- [ ] **Step 3: Verify owned apps resolve to the image copy and keep their sentinels**

```bash
for c in avuz-conecta-app-1 avuz-conecta-2-app-1; do
  echo "########## $c ##########"
  ./scripts/portainer-exec.sh -u www-data "$c" sh -c '
  for a in spreed deck files_downloadlimit integration_openai; do
    printf "%-22s resolved=%s\n" "$a" "$(php occ app:getpath $a 2>/dev/null)"
  done
  echo "--- shadow copies remaining (want none) ---"
  ls /var/www/html/custom_apps/ | grep -E "^(spreed|deck|files_downloadlimit|integration_openai)$" || echo "none"
  echo "--- quarantined (recoverable) ---"
  ls /var/www/html/data/.avuz_shadow_quarantine/ 2>/dev/null || echo "none"
  '
done
```

Expected on `avuz-conecta-app-1`: every owned app resolves under `/var/www/html/apps/`, shadow copies report `none`, and quarantine holds `spreed`, `deck`, `files_downloadlimit`.
Expected on `avuz-conecta-2-app-1`: same resolution, `none` for both — it had no shadow copies to begin with, which is the no-op path.

- [ ] **Step 3b: Confirm the owned apps still work after the purge**

In a browser on `avuz-conecta-app-1`: open Talk and start a call (spreed), open a Deck board and copy it (deck). Both exercise Avuz-patched code paths.
Expected: both work, and the board copy preserves column/card order (the `AVUZ-DECK-CLONE-ORDER-V1` fix).

- [ ] **Step 4: Verify Forms healed to a 5.3.x release**

```bash
./scripts/portainer-exec.sh -u www-data avuz-conecta-app-1 sh -c '
php occ app:getpath forms
php occ app:list 2>/dev/null | grep -i " forms:"
php occ config:app:get forms installed_version
grep -c maxSubmissions "$(php occ app:getpath forms)/lib/Db/Form.php"
'
```

Expected: path under `/var/www/html/custom_apps/forms`, version `5.3.x`, and `maxSubmissions` count `≥ 1`.

- [ ] **Step 5: Reproduce the original bug against staging**

In a browser on the staging instance, open a form, change the "maximum submissions" setting, and save.
Expected: saves without `maxSubmissions is not a valid attribute`. Capture the PATCH response status (200, not 403).

- [ ] **Step 6: STOP — prod requires explicit human approval**

**Do not build or deploy prod autonomously.** Staging is yours to drive end to end; production moves only when the user says so, per stack. `.claude/settings.local.json` enforces this — every prod path (`build-push.sh * prod`, `deploy-prod.sh`, `portainer-exec-prod.sh`, `deploy.sh grupo-vidalar`, `deploy.sh -y 14`) is in the `ask` list and will prompt.

When Steps 2–5 have all passed, report the staging evidence and **ask for approval**. Only after an explicit go-ahead:

```bash
./scripts/build-push.sh latest prod
```

Then redeploy **one** prod tenant, repeat Step 3 and Step 4 against it, report the result, and get approval again before rolling the remaining stacks. Never roll all 10+ in one pass.

- [ ] **Step 7: Document the policy**

Add to `CLAUDE.md` under a new `## App Sourcing Policy` heading:

```markdown
## App Sourcing Policy

Apps split into two disjoint sets, declared in `docker/entrypoint.sh`:

- `AVUZ_OWNED_APPS` — carry an Avuz overlay or fork (spreed, deck,
  files_downloadlimit, integration_openai). Image-owned. Never store-installed
  or store-updated; their `custom_apps` shadow copies are purged every boot.
  Upgrading one means rebuilding the image.
- `AVUZ_STORE_APPS` — vanilla apps we do not patch. Installed and updated from
  the App Store during the `appstoreenabled` window in `run_avuz_configuration`,
  landing in the persistent `custom_apps` volume.

There is no version pin: `occ app:install` and `occ app:update` have no
`--version` flag, so the store serves the newest release compatible with the
running NC major. That is the accepted trade for not owning these apps.

Nextcloud resolves an app to the **highest version across all app paths**, so a
store copy in `custom_apps` can shadow the patched copy in `apps/`. Patch
sentinels are therefore checked against `occ app:getpath`, never a hardcoded
path, and shadow copies of owned apps are purged before and after the store
window.
```

```bash
git add CLAUDE.md
git commit -m "docs: document app sourcing policy (owned vs store-managed)"
```

---

## Deferred — not in this plan

- **Widening `AVUZ_STORE_APPS`** beyond `forms` to the other ~15 vanilla apps (calendar, contacts, activity, text, notifications, twofactor_totp, suspicious_login, logreader, password_policy, external, files_retention, quota_warning, notify_push, onlyoffice, viewer, bruteforcesettings). Do this incrementally after this plan is proven in prod — each addition is a one-line change plus a staging boot. Widening all at once would make a store outage a 16-app event.
- **Retiring the golden-checkout rsync bootstrap** in favour of store installs at build time. Related, but it changes the fresh-clone contract and deserves its own plan.
- **`oidc` / `previewgenerator`** keep their bespoke install blocks ([docker/entrypoint.sh:287-308](docker/entrypoint.sh:287)). Folding them into `AVUZ_STORE_APPS` is a cleanup, not a fix, and would churn a working path.
