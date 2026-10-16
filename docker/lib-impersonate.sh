#!/bin/bash
# Impersonate app boot sync (Deck #504). Sourced by docker/entrypoint.sh and
# docker/tests/impersonate.test.sh after lib-apps.sh. No side effects on source.
#
# Runs EVERY boot (not stamp-gated), so a stack env change lands on the next
# redeploy:
#   AVUZ_IMPERSONATE_ENABLED  0 = app disabled on this stack; anything else = on (default 1)
#   AVUZ_IMPERSONATE_GROUPS   comma-separated groups allowed to impersonate (default admin)
#
# The image ships the app at apps/impersonate (pinned, see Dockerfile).
# It is enabled once per instance. An app an admin disabled stays off: only an
# env-driven disable (marker file below) is undone when the env flips back on.

AVUZ_IMPERSONATE_APP="impersonate"
AVUZ_IMPERSONATE_DEFAULT_GROUPS="admin"
AVUZ_IMPERSONATE_ENV_OFF_MARKER="${AVUZ_IMPERSONATE_ENV_OFF_MARKER:-/var/www/html/data/.avuz_impersonate_env_off}"
AVUZ_IMPERSONATE_CHANGED=0

# Pure: comma-separated group ids -> JSON list for the app's `authorized`
# config, e.g. "admin, suporte" -> ["admin","suporte"]. Empty output when no
# group survives trimming: the caller must never write `[]`, which the app reads
# as "no restriction" (any admin or subadmin may impersonate).
avuz_impersonate_groups_json() {
    local groups_csv="$1" group trimmed json=""
    [ -z "$groups_csv" ] && return 0
    IFS=',' read -ra _avuz_impersonate_groups <<< "$groups_csv"
    for group in "${_avuz_impersonate_groups[@]}"; do
        trimmed="$(_avuz_trim "$group")"
        [ -z "$trimmed" ] && continue
        trimmed="${trimmed//\\/\\\\}"
        trimmed="${trimmed//\"/\\\"}"
        json="${json}${json:+,}\"${trimmed}\""
    done
    [ -z "$json" ] && return 0
    printf '[%s]' "$json"
}

# `enabled` is "yes", "no", empty (never installed) or a JSON group list; the
# group list counts as enabled.
avuz_impersonate_is_enabled() {
    local enabled
    enabled="$(_avuz_occ config:app:get "$AVUZ_IMPERSONATE_APP" enabled 2>/dev/null | tr -d '[:space:]')" || true
    [ -n "$enabled" ] && [ "$enabled" != "no" ]
}

# installed_version is set on the first enable and survives a disable, so an
# empty value means the app was never enabled on this instance.
avuz_impersonate_was_ever_enabled() {
    local installed
    installed="$(_avuz_occ config:app:get "$AVUZ_IMPERSONATE_APP" installed_version 2>/dev/null | tr -d '[:space:]')" || true
    [ -n "$installed" ]
}

# Writes the allowed groups only when they differ, so a plain restart changes
# nothing. Runs whether or not the app is on, so a manual enable is restricted too.
avuz_impersonate_write_groups() {
    local wanted current
    wanted="$(avuz_impersonate_groups_json "${AVUZ_IMPERSONATE_GROUPS:-$AVUZ_IMPERSONATE_DEFAULT_GROUPS}")"
    if [ -z "$wanted" ]; then
        echo "✗ AVUZ_IMPERSONATE_GROUPS has no group ('${AVUZ_IMPERSONATE_GROUPS}') — falling back to $AVUZ_IMPERSONATE_DEFAULT_GROUPS"
        wanted="$(avuz_impersonate_groups_json "$AVUZ_IMPERSONATE_DEFAULT_GROUPS")"
    fi
    current="$(_avuz_occ config:app:get "$AVUZ_IMPERSONATE_APP" authorized 2>/dev/null)" || true
    if [ "$current" = "$wanted" ]; then
        return 0
    fi
    if _avuz_occ config:app:set "$AVUZ_IMPERSONATE_APP" authorized --value="$wanted" >/dev/null; then
        echo "✓ Impersonate allowed groups: $wanted"
        return 0
    fi
    echo "✗ Impersonate: could not write allowed groups — app left as it was"
    return 1
}

avuz_impersonate_turn_off() {
    if ! avuz_impersonate_is_enabled; then
        echo "– Impersonate off (AVUZ_IMPERSONATE_ENABLED=0)"
        return 0
    fi
    if ! _avuz_occ app:disable "$AVUZ_IMPERSONATE_APP" >/dev/null; then
        echo "✗ Impersonate: app:disable failed — will retry next boot"
        return 0
    fi
    touch "$AVUZ_IMPERSONATE_ENV_OFF_MARKER" || true
    AVUZ_IMPERSONATE_CHANGED=1
    echo "– Impersonate disabled (AVUZ_IMPERSONATE_ENABLED=0)"
}

avuz_impersonate_turn_on() {
    if avuz_impersonate_is_enabled; then
        rm -f "$AVUZ_IMPERSONATE_ENV_OFF_MARKER"
        local reconcile_output
        reconcile_output="$(avuz_reconcile_app_versions "$AVUZ_IMPERSONATE_APP")"
        if [ -n "$reconcile_output" ]; then
            echo "$reconcile_output"
            AVUZ_IMPERSONATE_CHANGED=1
        fi
        echo "✓ Impersonate enabled"
        return 0
    fi
    if avuz_impersonate_was_ever_enabled && [ ! -f "$AVUZ_IMPERSONATE_ENV_OFF_MARKER" ]; then
        echo "– Impersonate disabled by an admin — leaving it off (occ app:enable impersonate to turn it back on)"
        return 0
    fi
    if ! _avuz_occ app:enable "$AVUZ_IMPERSONATE_APP" >/dev/null; then
        echo "✗ Impersonate: app:enable failed (is apps/impersonate in the image?) — will retry next boot"
        return 0
    fi
    rm -f "$AVUZ_IMPERSONATE_ENV_OFF_MARKER"
    AVUZ_IMPERSONATE_CHANGED=1
    echo "✓ Impersonate enabled"
}

# Non-fatal: every failure logs and lets the boot continue. The app is never
# turned on while its group restriction could not be written.
avuz_impersonate_sync() {
    AVUZ_IMPERSONATE_CHANGED=0
    local groups_written=1
    avuz_impersonate_write_groups || groups_written=0
    if [ "${AVUZ_IMPERSONATE_ENABLED:-1}" = "0" ]; then
        avuz_impersonate_turn_off
        return 0
    fi
    if [ "$groups_written" -eq 0 ]; then
        return 0
    fi
    avuz_impersonate_turn_on
}
