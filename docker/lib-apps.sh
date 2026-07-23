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

# Pure: reject unsafe/malformed app identifiers before they reach a path
# concatenation. Empty, `.`, `..`, or anything containing `/` is refused —
# defense in depth even though today's callers only pass a fixed,
# code-reviewed app list. Silent (no printing) so callers of the pure
# `avuz_shadow_copies` list-emitter stay clean; callers that log (like
# `avuz_purge_shadow_copies`) print their own warning on rejection.
avuz_valid_app_name() {
    local app="$1"
    case "$app" in
        "" | "." | ".." ) return 1 ;;
        */* ) return 1 ;;
    esac
    return 0
}

# Pure: emit custom_apps directories for Avuz-owned apps that are SAFE to purge.
# These shadow the patched image copy whenever their version is higher (NC
# resolves an app to the highest version across app paths), silently serving
# unpatched code. An app is only listed when a usable image copy exists —
# without that fallback, removing the custom_apps copy would remove the only
# copy and the app would genuinely disappear.
avuz_shadow_copies() {
    local root="$1" image_root="$2"; shift 2
    : "${root:?}" "${image_root:?}"
    local app
    for app in "$@"; do
        if ! avuz_valid_app_name "$app"; then
            continue
        fi
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
    : "${root:?}" "${image_root:?}" "${quarantine:?}"
    local app
    for app in "$@"; do
        if ! avuz_valid_app_name "$app"; then
            echo "✗ SKIPPING malformed app name: '$app'"
            continue
        fi
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

# Pure: return 0 when version $1 sorts strictly before $2. Uses sort -V, which
# handles Nextcloud's 4-segment app versions (e.g. 4.5.1.7) correctly.
#
# Nextcloud info.xml and installed_version strings can legitimately carry a
# different number of segments for the same release (e.g. "5.3" vs "5.3.0").
# A plain string/sort -V compare treats those as different (the shorter string
# sorts first), which would misreport them as a downgrade. Zero-pad both
# operands out to the same segment count first so trailing zero segments
# never affect the result.
avuz_version_lt() {
    local a="$1" b="$2"
    local a_segments b_segments max i a_norm="" b_norm=""
    IFS='.' read -r -a a_segments <<< "$a"
    IFS='.' read -r -a b_segments <<< "$b"
    max="${#a_segments[@]}"
    if [ "${#b_segments[@]}" -gt "$max" ]; then max="${#b_segments[@]}"; fi
    for ((i = 0; i < max; i++)); do
        a_norm="${a_norm}${a_norm:+.}${a_segments[i]:-0}"
        b_norm="${b_norm}${b_norm:+.}${b_segments[i]:-0}"
    done
    # Explicit `if` — a trailing `[ … ] && return 1` would abort the boot under
    # `set -e` on the not-equal path.
    if [ "$a_norm" = "$b_norm" ]; then
        return 1
    fi
    [ "$(printf '%s\n%s\n' "$a_norm" "$b_norm" | sort -V | head -1)" = "$a_norm" ]
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
        if printf '%s\n' "$store_apps" | tr ' ' '\n' | grep -qxF "$app"; then
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
