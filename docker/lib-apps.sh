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
