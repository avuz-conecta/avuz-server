# Split `run_avuz_configuration` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a version-bump deploy run only settings + pending migrations + new-app enable + explicit retirement, moving expensive repair and store operations behind a fresh-install/upgrade gate, so routine releases recreate the container in seconds instead of minutes.

**Architecture:** Extract the heavy tail of `run_avuz_configuration` into a sourceable, dry-run-testable lib (`docker/lib-apps.sh`) — mirroring the existing `docker/lib-perms.sh` pattern. `run_avuz_configuration` keeps a pure settings block (`apply_avuz_settings`) and calls the lib for: `occ upgrade` with fail-closed classification (replaces `app:update --all`), a known-apps manifest so only genuinely-new apps auto-enable, and explicit `REMOVE_APPS` retirement (disable only). A failed upgrade writes a marker, skips the stamp, crash-loops, and leaves the instance in maintenance mode.

**Tech Stack:** Bash (entrypoint + sourced lib), Docker, Nextcloud `occ`. Tests are a self-contained shell script (no bats/shellcheck in this environment), run with `bash docker/tests/apps.test.sh`.

**Spec:** `docs/superpowers/specs/2026-07-09-split-run-avuz-configuration-design.md`

## Global Constraints

- `docker/entrypoint.sh` line 2 is `set -e` — every added command that can fail (`occ` non-zero, empty glob, missing file) MUST be guarded (`set +e`/`set -e` fence, `|| true`, or `2>/dev/null`) or it aborts the whole boot.
- `occ` runs as **root** in this image. Files it creates under `data/` (the manifest, the marker, the stamp) are root-owned; that is fine — only the root entrypoint reads them. Do not add chowns for them.
- Never reintroduce `app:update --all` or a blanket `app:enable --force` loop over all managed apps in the steady-state path.
- Retirement is `app:disable` only — **never** `app:remove` (it can DROP tables = irreversible user-data loss).
- The manifest lives at `/var/www/html/data/.avuz_known_apps`; the failure marker at `/var/www/html/data/.avuz_upgrade_failed`. `data/` is a local volume on both disk and S3 stacks (same place the existing `.avuz_configured` stamp lives), so both persist across container recreate.
- Managed app arrays are `BUNDLED_APPS` (entrypoint.sh:18-37) and `ENABLE_APPS` (39-61). Conditional apps (`oidc`, `conectamail`) are enabled in their own env-gated blocks and are **not** in these arrays — never drive removal by diffing against the arrays.
- Lib is sourced from `/var/www/html/docker/lib-apps.sh` (same path convention as `lib-perms.sh`, entrypoint.sh:11). `COPY .` (Dockerfile:20) already ships `docker/`; no Dockerfile change needed — verified in Task 6.
- **Fail-closed scope is the config-path `occ upgrade` only.** The marker + maintenance-gate protect the `occ upgrade` inside `run_avuz_configuration`. The pre-existing core-upgrade branch (the `needsDbUpgrade: true` path with its own `occ upgrade` and `app:update --all`) is **not** re-wired here and keeps its existing `UPGRADE_STATE_FILE` behavior — out of scope, do not assume full coverage.

---

## File Structure

- **Create `docker/lib-apps.sh`** — sourceable helpers: `_avuz_occ` (dry-run wrapper), `avuz_parse_app_list`, `avuz_seed_manifest`, `avuz_new_apps`, `avuz_enable_new_apps`, `avuz_retire_apps`, `avuz_classify_upgrade`, `avuz_handle_upgrade_result`. Dry-run aware via `AVUZ_OCC_DRYRUN`. No side effects on source.
- **Create `docker/tests/apps.test.sh`** — self-contained assertions over the lib in dry-run mode + tmp manifests. Zero external deps. Run with `bash docker/tests/apps.test.sh`.
- **Modify `docker/entrypoint.sh`**:
  - source `lib-apps.sh` next to `lib-perms.sh` (line 11).
  - add `REMOVE_APPS=()` array after `ENABLE_APPS` (line 61).
  - extract settings (lines 217-476) into `apply_avuz_settings()`.
  - replace the heavy block (lines 478-501) with the lib-driven upgrade + indices + gated repair + seed/enable/retire glue; delete overlay reapply (488-489).
  - marker-gate the maintenance-mode force-off (line 595).

---

## Task 1: Probe the live stack (assumptions the classifier + parser rest on)

**Files:** none (records facts; adjust Task 2/Task 3 constants only if the probe contradicts them).

**Why:** The upgrade classifier assumes an up-to-date `occ upgrade` on NC 33 exits **0** with maintenance mode **off**. The manifest seed assumes `occ app:list` renders both sections as `  - <appid>: <version>`. Confirm both against the user's real stack before writing code that depends on them.

- [ ] **Step 1: Probe `occ upgrade` no-op signature**

Run against the live container (user has a stack):
```bash
docker exec -u www-data <nc_container> php occ upgrade --no-interaction; echo "rc=$?"
docker exec -u www-data <nc_container> php occ maintenance:mode
```
Expected: `rc=0`, output "Nextcloud is already latest version" (or similar), and maintenance mode "currently disabled".

- [ ] **Step 2: Probe `occ app:list` format**

Run:
```bash
docker exec -u www-data <nc_container> php occ app:list | head -20
```
Expected: an `Enabled:` and a `Disabled:` section, each line `  - <appid>: <version>`.

- [ ] **Step 3: Record + reconcile**

If Step 1 shows a **non-zero** rc on a no-op, note the exact code — Task 2's classifier must then treat that specific code (with maintenance off) as `ok` rather than `failure`. If Step 2's format differs, adjust `avuz_parse_app_list`'s `sed` in Task 3. If both match expectations, proceed unchanged. No commit.

---

## Task 2: `lib-apps.sh` — upgrade classification + result handling

**Files:**
- Create: `docker/lib-apps.sh`
- Test: `docker/tests/apps.test.sh`

**Interfaces:**
- Produces:
  - `avuz_classify_upgrade <rc> <maintenance_after:on|off>` → echoes `failure` if maintenance stuck on OR `rc != 0`; else `ok`.
  - `avuz_handle_upgrade_result <class:ok|failure> <marker_file>` → on `failure` writes an ISO-8601 timestamp to `<marker_file>` and returns 1; on `ok` removes `<marker_file>` and returns 0.

- [ ] **Step 1: Write the failing test**

Create `docker/tests/apps.test.sh`:
```bash
#!/bin/bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
source "$HERE/../lib-apps.sh"

fail=0
assert_eq() {
    local desc="$1" expected="$2" actual="$3"
    if [ "$expected" = "$actual" ]; then
        echo "ok - $desc"
    else
        echo "NOT OK - $desc"; echo "  expected: [$expected]"; echo "  actual:   [$actual]"; fail=1
    fi
}

# ── upgrade classification ──
assert_eq "clean success -> ok"        "ok"      "$(avuz_classify_upgrade 0 off)"
assert_eq "maintenance stuck -> failure" "failure" "$(avuz_classify_upgrade 0 on)"
assert_eq "non-zero rc -> failure"     "failure" "$(avuz_classify_upgrade 1 off)"
assert_eq "non-zero + stuck -> failure" "failure" "$(avuz_classify_upgrade 1 on)"

# ── result handling: failure writes marker, returns 1 ──
marker="$(mktemp -u)"
if avuz_handle_upgrade_result failure "$marker"; then rc=0; else rc=1; fi
assert_eq "failure returns 1" "1" "$rc"
assert_eq "failure writes marker" "yes" "$([ -s "$marker" ] && echo yes || echo no)"

# ── result handling: ok clears marker, returns 0 ──
if avuz_handle_upgrade_result ok "$marker"; then rc=0; else rc=1; fi
assert_eq "ok returns 0" "0" "$rc"
assert_eq "ok clears marker" "gone" "$([ -e "$marker" ] && echo present || echo gone)"

exit $fail
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash docker/tests/apps.test.sh; echo "exit=$?"`
Expected: FAIL — `lib-apps.sh` does not exist yet (source error) or functions undefined.

- [ ] **Step 3: Write minimal implementation**

Create `docker/lib-apps.sh`:
```bash
#!/bin/bash
# App-management helpers for the Avuz entrypoint. Sourced by docker/entrypoint.sh
# and docker/tests/apps.test.sh. No side effects on source.
#
# Splits the old run_avuz_configuration heavy block into testable units:
#   - occ upgrade with fail-closed classification (never a blanket `|| true`)
#   - a known-apps manifest so only genuinely-new managed apps auto-enable
#   - explicit REMOVE_APPS retirement (disable only, never app:remove)
#
# Set AVUZ_OCC_DRYRUN=1 to print planned occ calls instead of running them
# (used by the test harness — no container/occ required).

_avuz_occ() {
    if [ -n "${AVUZ_OCC_DRYRUN:-}" ]; then
        echo "OCC $*"
        return 0
    fi
    php occ "$@"
}

# Pure: classify an `occ upgrade` run. Failure IFF it left maintenance mode stuck
# on (mid-migration abort) or exited non-zero. A benign no-op ("already latest")
# exits 0 with maintenance off -> ok. Signature confirmed by the Task 1 probe.
avuz_classify_upgrade() {
    local rc="$1" maintenance_after="$2"
    if [ "$maintenance_after" = "on" ]; then echo "failure"; return; fi
    if [ "$rc" -ne 0 ]; then echo "failure"; return; fi
    echo "ok"
}

# Apply an upgrade classification: on failure record the marker (fail closed) and
# return 1; on ok clear it and return 0.
avuz_handle_upgrade_result() {
    local class="$1" marker="$2"
    if [ "$class" = "failure" ]; then
        date -u +%FT%TZ > "$marker"
        return 1
    fi
    rm -f "$marker"
    return 0
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bash docker/tests/apps.test.sh; echo "exit=$?"`
Expected: all `ok - …`, `exit=0`.

- [ ] **Step 5: Syntax check + commit**

Run: `bash -n docker/lib-apps.sh && echo OK`
```bash
git add docker/lib-apps.sh docker/tests/apps.test.sh
git commit -m "feat(entrypoint): add occ-upgrade classification lib with fail-closed marker"
```

---

## Task 3: `lib-apps.sh` — known-apps manifest + new-app enable

**Files:**
- Modify: `docker/lib-apps.sh`
- Test: `docker/tests/apps.test.sh`

**Interfaces:**
- Consumes: `_avuz_occ` (Task 2).
- Produces:
  - `avuz_parse_app_list` — filter: reads `occ app:list` text on stdin, emits one appid per line (both sections).
  - `avuz_seed_manifest <manifest_file>` — reads `occ app:list` text on stdin; if `<manifest_file>` is absent, write the parsed appids to it; if present, drain stdin and do nothing.
  - `avuz_new_apps <manifest_file> <app>...` — emit the managed apps absent from the manifest.
  - `avuz_enable_new_apps <manifest_file> <app>...` — for each new app: `_avuz_occ app:enable --force <app>` and append it to the manifest.

- [ ] **Step 1: Write the failing test**

Append to `docker/tests/apps.test.sh` before the final `exit $fail`:
```bash
# ── manifest / new-app detection ──
APP_LIST_FIXTURE="Enabled:
  - activity: 3.0.0
  - deck: 1.14.0
Disabled:
  - spreed: 18.0.0"

# parse: both sections -> appids
out="$(printf '%s\n' "$APP_LIST_FIXTURE" | avuz_parse_app_list)"
assert_eq "parse emits all appids" "activity
deck
spreed" "$out"

# seed when absent: writes parsed appids
man="$(mktemp -u)"
printf '%s\n' "$APP_LIST_FIXTURE" | avuz_seed_manifest "$man"
assert_eq "seed writes manifest when absent" "activity
deck
spreed" "$(cat "$man")"

# seed when present: leaves manifest untouched
printf 'Enabled:\n  - newapp: 1.0.0\n' | avuz_seed_manifest "$man"
assert_eq "seed no-op when manifest present" "activity
deck
spreed" "$(cat "$man")"

# new_apps: only managed apps absent from manifest
out="$(avuz_new_apps "$man" deck spreed calendar forms)"
assert_eq "new_apps lists only unknown managed apps" "calendar
forms" "$out"

# enable_new_apps: enables the unknown ones and appends them
out="$(AVUZ_OCC_DRYRUN=1 avuz_enable_new_apps "$man" deck calendar)"
assert_eq "enable_new_apps enables only the new app" \
    "OCC app:enable --force calendar" "$out"
assert_eq "enable_new_apps appends new app to manifest" "activity
deck
spreed
calendar" "$(cat "$man")"

# failed enable must NOT append (retry next boot). Stub _avuz_occ to fail.
_avuz_occ() { return 1; }
avuz_enable_new_apps "$man" forms >/dev/null 2>&1
assert_eq "failed enable does not poison manifest" "activity
deck
spreed
calendar" "$(cat "$man")"
unset -f _avuz_occ; source "$HERE/../lib-apps.sh"   # restore real wrapper
rm -f "$man"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash docker/tests/apps.test.sh; echo "exit=$?"`
Expected: FAIL — `avuz_parse_app_list` / `avuz_seed_manifest` / `avuz_new_apps` / `avuz_enable_new_apps` undefined.

- [ ] **Step 3: Write minimal implementation**

Append to `docker/lib-apps.sh`:
```bash
# Pure filter: given `occ app:list` text on stdin, emit one appid per line
# (both Enabled: and Disabled: sections).
avuz_parse_app_list() {
    grep '  - ' | sed 's/  - \(.*\):.*/\1/'
}

# Seed the manifest from all currently-known apps IF it does not exist yet.
# Reads `occ app:list` text on stdin. An existing manifest is left untouched.
avuz_seed_manifest() {
    local manifest="$1"
    if [ -f "$manifest" ]; then
        cat >/dev/null   # drain stdin, no-op
        return 0
    fi
    avuz_parse_app_list > "$manifest"
}

# Pure: emit the managed apps ($2..) absent from the manifest ($1).
avuz_new_apps() {
    local manifest="$1"; shift
    local app
    for app in "$@"; do
        if ! grep -qxF "$app" "$manifest" 2>/dev/null; then
            echo "$app"
        fi
    done
}

# Enable managed apps ($2..) not yet in the manifest ($1); append to the manifest
# ONLY when the enable succeeds, so a failed enable is retried next boot instead
# of being silently marked "known". Keep --force: some managed apps have not
# declared support for the running NC version. Under the caller's `set -e`, the
# `if _avuz_occ …` form tolerates a non-zero enable (condition context).
avuz_enable_new_apps() {
    local manifest="$1"; shift
    local app
    for app in $(avuz_new_apps "$manifest" "$@"); do
        if _avuz_occ app:enable --force "$app"; then
            echo "$app" >> "$manifest"
        else
            echo "✗ Could not enable $app (will retry next boot)"
        fi
    done
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bash docker/tests/apps.test.sh; echo "exit=$?"`
Expected: all `ok - …`, `exit=0`.

- [ ] **Step 5: Syntax check + commit**

Run: `bash -n docker/lib-apps.sh && echo OK`
```bash
git add docker/lib-apps.sh docker/tests/apps.test.sh
git commit -m "feat(entrypoint): known-apps manifest so only new managed apps auto-enable"
```

---

## Task 4: `lib-apps.sh` — explicit app retirement

**Files:**
- Modify: `docker/lib-apps.sh`
- Test: `docker/tests/apps.test.sh`

**Interfaces:**
- Consumes: `_avuz_occ` (Task 2).
- Produces:
  - `avuz_retire_apps <app>...` — for each app: `_avuz_occ app:disable <app>`. No-op for zero args. Never `app:remove`.

- [ ] **Step 1: Write the failing test**

Append to `docker/tests/apps.test.sh` before the final `exit $fail`:
```bash
# ── retirement: disable only, never remove ──
out="$(AVUZ_OCC_DRYRUN=1 avuz_retire_apps roundcube weather_status)"
assert_eq "retire disables each listed app" "OCC app:disable roundcube
OCC app:disable weather_status" "$out"

out="$(AVUZ_OCC_DRYRUN=1 avuz_retire_apps)"
assert_eq "retire with no apps is a no-op" "" "$out"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash docker/tests/apps.test.sh; echo "exit=$?"`
Expected: FAIL — `avuz_retire_apps` undefined.

- [ ] **Step 3: Write minimal implementation**

Append to `docker/lib-apps.sh`:
```bash
# Disable each retired app ($1..). Idempotent: app:disable on an already-disabled
# app is a no-op. `|| true` so a disable failure (e.g. app not present) never
# aborts the boot under the caller's `set -e`. NEVER app:remove (that runs
# uninstall migrations and can DROP tables = irreversible user-data loss).
avuz_retire_apps() {
    local app
    for app in "$@"; do
        _avuz_occ app:disable "$app" || true
    done
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bash docker/tests/apps.test.sh; echo "exit=$?"`
Expected: all `ok - …`, `exit=0`.

- [ ] **Step 5: Syntax check + commit**

Run: `bash -n docker/lib-apps.sh && echo OK`
```bash
git add docker/lib-apps.sh docker/tests/apps.test.sh
git commit -m "feat(entrypoint): explicit REMOVE_APPS retirement helper (disable only)"
```

---

## Task 5: Extract `apply_avuz_settings()` (pure refactor, no behavior change)

**Files:**
- Modify: `docker/entrypoint.sh` (`run_avuz_configuration`, currently lines 210-505)

**Interfaces:**
- Produces: `apply_avuz_settings()` — a **top-level** (sibling, not nested) function running every `config:system:set` / `config:app:set` / `theming:config` call, the `avuz-upload.ini` write, the conditional OIDC/ConectaMail/SMTP/OnlyOffice/AI/Talk blocks, and the `*imagePath*` Redis clear. No app enable/update/repair.

> **Why relocation, not wrap-in-place:** the settings block lives *inside* `run_avuz_configuration() { … }` (opens ~:210, closes ~:505). Wrapping it with `apply_avuz_settings() { … }` where it sits would define a function **nested** inside another — it only registers when the outer runs and leaks scope. The block must be **moved out** to a sibling function.

- [ ] **Step 1: Move the settings body into a new top-level function**

The settings body is the span that starts at the `# Trusted domains & protocol` comment and ends at the `redis-cli … *imagePath* …` clear line (the last line before the `# Database maintenance` comment). Cut that entire span out of `run_avuz_configuration` and paste it into a **new sibling function defined immediately above** `run_avuz_configuration` (before its `# ────` comment header, at file scope):
```bash
# Idempotent settings only — safe to run on every config-version bump. No app
# enable/update/repair (those live in the gated block in run_avuz_configuration).
apply_avuz_settings() {
    # Trusted domains & protocol
    #   … <the moved span: everything from the trusted-domains block through the
    #      redis-cli *imagePath* clear, verbatim, unchanged> …
}
```
Do not edit the moved lines — relocate them verbatim so the diff is a pure move.

- [ ] **Step 2: Call it from `run_avuz_configuration`**

Where the span was cut, leave a call. The top of `run_avuz_configuration` now reads:
```bash
run_avuz_configuration() {
    echo "═══ Running Avuz Conecta configuration ═══"
    php occ config:system:set appstoreenabled --value=true --type=boolean

    apply_avuz_settings

    # Database maintenance
    echo "Running database maintenance..."
```
(The `# Database maintenance` block and everything below it up to the stamp write is rewritten in Task 6 — leave it untouched in this task.)

- [ ] **Step 2b: Confirm no nested-function definition survived**

Run: `awk '/^apply_avuz_settings\(\) \{/{print NR": "$0}; /^run_avuz_configuration\(\) \{/{print NR": "$0}' docker/entrypoint.sh`
Expected: both functions print at **column-0** (no leading whitespace) — proving `apply_avuz_settings` is a sibling, not indented inside another function.

- [ ] **Step 3: Verify no occ-call drift**

Confirm the set of settings calls is unchanged (order preserved, nothing dropped):
```bash
bash -n docker/entrypoint.sh && echo SYNTAX-OK
git diff -U0 docker/entrypoint.sh | grep -E '^[-+]\s*php occ' | sort | uniq -c | sort -n
```
Expected: SYNTAX-OK, and the grep shows only paired `-`/`+` moves (every removed `php occ` line reappears added) — no net add/drop of any settings call.

- [ ] **Step 4: Commit**

```bash
git add docker/entrypoint.sh
git commit -m "refactor(entrypoint): extract apply_avuz_settings (no behavior change)"
```

---

## Task 6: Rewire the heavy block to the lib (the split)

**Files:**
- Modify: `docker/entrypoint.sh` (source at line 11; `REMOVE_APPS` after line 61; heavy block 478-501)

**Interfaces:**
- Consumes: `avuz_classify_upgrade`, `avuz_handle_upgrade_result`, `avuz_seed_manifest`, `avuz_enable_new_apps`, `avuz_retire_apps` (Tasks 2-4); the `NC_INSTALLED` and `DID_DB_UPGRADE` boot signals already set in entrypoint.

- [ ] **Step 1: Source the lib**

After entrypoint.sh:11 (`source /var/www/html/docker/lib-perms.sh`) add:
```bash
source /var/www/html/docker/lib-apps.sh
```

- [ ] **Step 2: Declare `REMOVE_APPS`**

After the `ENABLE_APPS=( … )` closing paren (entrypoint.sh:61) add:
```bash

# Apps to retire on deploy. Disable only (data kept); never app:remove. Add an
# app here to turn it off across all stacks; leave empty when nothing is retiring.
REMOVE_APPS=(
)
```

- [ ] **Step 3: Replace the heavy block**

Anchor by content (Task 5 shifted line numbers — do **not** use absolute lines). Inside `run_avuz_configuration`, delete the contiguous block that runs from the `# Database maintenance` comment through the `php occ config:system:set appstoreenabled --value=false …` line — i.e. the old `db:add-missing-indices` + `maintenance:repair` (the `# Database maintenance` block), the `app:update --all` line, the two `reapply_avuz_*_overlay` calls, the `# Ensuring managed apps are enabled` `app:enable --force` loop, and the appstore-off line. Replace the whole deleted block with:
```bash
    # Database maintenance — cheap index check every bump; expensive repair only
    # on fresh install or a real NC core upgrade.
    echo "Running database maintenance..."
    php occ db:add-missing-indices --no-interaction 2>/dev/null || true
    if [ "$NC_INSTALLED" -eq 0 ] || [ "$DID_DB_UPGRADE" -eq 1 ]; then
        php occ maintenance:repair --include-expensive 2>/dev/null || true
    fi

    # occ upgrade (replaces app:update --all) — runs pending core+app migrations
    # from on-disk code: no store, no overlay clobber. Fail closed: on failure
    # write the marker, skip the stamp, and exit so the container crash-loops
    # (visible in Portainer) and the next boot retries. Skip when the core-upgrade
    # branch already ran occ upgrade this boot.
    if [ "$DID_DB_UPGRADE" -eq 0 ]; then
        echo "Running occ upgrade (pending migrations)..."
        set +e
        php occ upgrade --no-interaction
        _avuz_upgrade_rc=$?
        set -e
        if php occ maintenance:mode 2>/dev/null | grep -q 'currently enabled'; then
            _avuz_maint=on
        else
            _avuz_maint=off
        fi
        _avuz_upgrade_class="$(avuz_classify_upgrade "$_avuz_upgrade_rc" "$_avuz_maint")"
        if ! avuz_handle_upgrade_result "$_avuz_upgrade_class" "$UPGRADE_FAILED_MARKER"; then
            echo "✗ occ upgrade FAILED (rc=$_avuz_upgrade_rc, maintenance=$_avuz_maint) — marker written, halting boot"
            exit 1
        fi
        echo "✓ occ upgrade $_avuz_upgrade_class"
    fi

    # New-app enable via the known-apps manifest: seed on first run (enables
    # nothing), then enable only managed apps we have never seen. Admin-disabled
    # apps stay in the manifest and are never resurrected. Guard the seed: a
    # transient/empty `app:list` must NOT write an empty manifest (that would make
    # every managed app look new next boot and mass force-enable).
    _avuz_app_list="$(php occ app:list 2>/dev/null)"
    if [ -n "$_avuz_app_list" ]; then
        printf '%s\n' "$_avuz_app_list" | avuz_seed_manifest "$AVUZ_KNOWN_APPS"
    else
        echo "✗ occ app:list empty/failed — skipping manifest seed this boot"
    fi
    avuz_enable_new_apps "$AVUZ_KNOWN_APPS" "${BUNDLED_APPS[@]}" "${ENABLE_APPS[@]}"

    # Retire apps listed in REMOVE_APPS (disable only, never remove).
    avuz_retire_apps "${REMOVE_APPS[@]}"

    # Lock down the in-app store AFTER all installs/updates above have run.
    php occ config:system:set appstoreenabled --value=false --type=boolean
```

- [ ] **Step 4: Declare the manifest + marker paths**

Next to the existing `CONFIG_STAMP_FILE` declaration (entrypoint.sh:6) add:
```bash
AVUZ_KNOWN_APPS="/var/www/html/data/.avuz_known_apps"
UPGRADE_FAILED_MARKER="/var/www/html/data/.avuz_upgrade_failed"
```

- [ ] **Step 5: Verify wiring + that the lib ships in the image**

Run:
```bash
bash -n docker/entrypoint.sh && echo SYNTAX-OK
grep -n 'COPY \. ' Dockerfile || grep -n 'COPY ' Dockerfile | head
grep -c 'app:update --all' docker/entrypoint.sh   # expect 0 in run_avuz_configuration path
```
Expected: SYNTAX-OK; a `COPY . …` (or equivalent) line confirming `docker/` ships; `app:update --all` no longer present in the config path (the only remaining references, if any, are in the core-upgrade branch — confirm by line number that none sit inside `run_avuz_configuration`).

- [ ] **Step 6: Re-run lib tests + commit**

Run: `bash docker/tests/apps.test.sh; echo "exit=$?"`
Expected: `exit=0`.
```bash
git add docker/entrypoint.sh
git commit -m "feat(entrypoint): split run_avuz_configuration — occ upgrade + manifest + REMOVE_APPS, gate expensive repair"
```

---

## Task 7: Marker-gate the maintenance-mode force-off

**Files:**
- Modify: `docker/entrypoint.sh` (line 595)

**Interfaces:**
- Consumes: `UPGRADE_FAILED_MARKER` (Task 6).

- [ ] **Step 1: Wrap the force-off in a marker check**

Anchor by content (line numbers shifted in Tasks 5-6). Find the single maintenance-mode force-off line in the existing-install branch:
```bash
    sed -i "s/'maintenance' => true/'maintenance' => false/g" /var/www/html/config/config.php 2>/dev/null || true
```
Replace it with:
```bash
    # Force-disable maintenance mode (clears a stale flag) — UNLESS a prior
    # occ upgrade failed. In that case leave maintenance ON: fail closed to the
    # maintenance page instead of serving a half-migrated app.
    if [ -f "$UPGRADE_FAILED_MARKER" ]; then
        echo "⚠ prior upgrade failed ($UPGRADE_FAILED_MARKER present) — leaving maintenance mode ON"
    else
        sed -i "s/'maintenance' => true/'maintenance' => false/g" /var/www/html/config/config.php 2>/dev/null || true
    fi
```

- [ ] **Step 2: Verify + commit**

Run: `bash -n docker/entrypoint.sh && echo SYNTAX-OK`
Expected: SYNTAX-OK.
```bash
git add docker/entrypoint.sh
git commit -m "feat(entrypoint): keep maintenance mode ON after a failed upgrade (fail closed)"
```

---

## Task 8: End-to-end verification on the live stack

**Files:** none (build + deploy + observe).

- [ ] **Step 1: Build the image**

Run: `./scripts/build-push.sh latest staging` (or the target the user deploys). Expected: build succeeds, `docker/lib-apps.sh` present in the image (`docker run --rm <image> ls /var/www/html/docker/lib-apps.sh`).

- [ ] **Step 2: Version-bump redeploy — cheap path**

Bump `AVUZ_CONFIG_VERSION` (entrypoint.sh:5), rebuild, redeploy on the existing stack. Watch entrypoint logs. Expected:
- `✓ occ upgrade ok` (no-op), **no** `app:update --all`, **no** `maintenance:repair --include-expensive`.
- `/var/www/html/data/.avuz_known_apps` exists and lists the current apps.

- [ ] **Step 3: Admin-disable survives**

Run `docker exec -u www-data <c> php occ app:disable calendar`, bump version, redeploy. Expected: `calendar` still disabled after boot (not resurrected).

- [ ] **Step 4: New app enables**

Add a not-yet-known app to `ENABLE_APPS`, bump version, redeploy. Expected: the app is enabled and appended to `.avuz_known_apps`.

- [ ] **Step 5: Retirement disables, keeps data**

Add an enabled app to `REMOVE_APPS`, redeploy. Expected: `occ app:list` shows it under Disabled; it still appears in the list (not removed).

- [ ] **Step 6: Overlays intact**

Run `docker exec <c> grep -l AVUZ-DECK-CLONE-ORDER-V1 /var/www/html/apps/deck/lib/Service/BoardService.php` and the spreed/`files_downloadlimit` sentinels. Expected: all present after a version-bump redeploy.

- [ ] **Step 7: Failed upgrade fails closed (controlled test)**

On a throwaway/staging stack, force an `occ upgrade` failure (e.g. temporarily point an app at a broken migration, or `touch` the marker to simulate) and redeploy. Expected: `.avuz_upgrade_failed` written, config stamp **not** advanced, container restarts, and on the retry boot the maintenance-mode force-off is skipped (log shows the "leaving maintenance mode ON" line). Remove the marker to recover.

- [ ] **Step 8: Fresh install still complete**

On a clean volume, deploy. Expected: all apps enabled (Phase 4), expensive repair ran, `.avuz_known_apps` seeded, instance healthy.

---

## Self-Review

- **Spec coverage:** cheap/heavy split (Tasks 5-6), `occ upgrade` fail-closed recovery + marker + maintenance gating (Tasks 2, 6, 7), known-apps manifest (Task 3, 6), `REMOVE_APPS` disable-only (Tasks 4, 6), gated expensive repair (Task 6), overlay reapply removal (Task 6), in-container probes (Task 1), behavior matrix + fresh-install (Task 8). All spec sections map to a task.
- **Placeholders:** none — every code step shows full code; the one probe-dependent constant (no-op rc) is Task 1's explicit output with a documented default.
- **Type consistency:** `avuz_classify_upgrade` → `ok|failure` feeds `avuz_handle_upgrade_result` (same tokens); `avuz_seed_manifest`/`avuz_new_apps`/`avuz_enable_new_apps` share the `<manifest_file>` first arg; `AVUZ_KNOWN_APPS` and `UPGRADE_FAILED_MARKER` declared in Task 6 and consumed in Tasks 6-7.

**Grill fixes folded (2026-07-09):** (1) Task 5 relocates settings to a sibling
function, not a nested one, with a column-0 check. (2) `avuz_enable_new_apps` uses
`if _avuz_occ …` and `avuz_retire_apps` uses `|| true`, so a failed `occ` never
aborts the boot under `set -e`. (3) enable appends to the manifest only on success,
and the seed is skipped when `app:list` is empty/failed — no manifest poisoning.
(4) edit anchors are content-based, not absolute line numbers (drift across tasks).
(5) fail-closed scope (config-path `occ upgrade` only) is stated in constraints +
spec. Fixes (2)+(3) verified behaviorally under `set -e`.
