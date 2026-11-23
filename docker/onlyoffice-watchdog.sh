#!/bin/bash
# Re-enables OnlyOffice after a transient outage (Deck #221). One failed health
# check stores onlyoffice:settings_error, which disables the editor, and the
# app's own EditorsCheck cron returns early while that flag is set, so it never
# clears. Only an admin pressing "Salvar" used to bring it back. This loop runs
# the same check (`occ onlyoffice:documentserver --check`, which clears the flag
# on success) only while the flag is set, so a healthy instance is never probed
# by us and a failed probe can never be the thing that trips it.
# Supervised by docker/supervisor.conf.
#
# ONLYOFFICE_WATCHDOG_OCC, _SLEEP_COMMAND and _MAX_LOOPS exist for the tests only.

set -uo pipefail

APP_ID="onlyoffice"
CHECK_INTERVAL_SECONDS=300

OCC_COMMAND="${ONLYOFFICE_WATCHDOG_OCC:-php /var/www/html/occ}"
SLEEP_COMMAND="${ONLYOFFICE_WATCHDOG_SLEEP_COMMAND:-sleep}"
MAX_LOOPS="${ONLYOFFICE_WATCHDOG_MAX_LOOPS:-0}"

announced_state=""

occ() {
    # shellcheck disable=SC2086
    $OCC_COMMAND "$@"
}

announce() {
    [ "$announced_state" = "$1" ] && return 0
    announced_state="$1"
    echo "onlyoffice-watchdog: $2"
}

# `enabled` is "yes", "no", empty (never installed) or a JSON group list.
# Any occ error (not installed yet, DB down) counts as disabled.
app_is_enabled() {
    local enabled
    enabled="$(occ config:app:get "$APP_ID" enabled 2>/dev/null | tr -d '[:space:]')" || return 1
    [ -n "$enabled" ] && [ "$enabled" != "no" ]
}

stored_settings_error() {
    occ config:app:get "$APP_ID" settings_error 2>/dev/null || true
}

check_once() {
    if ! app_is_enabled; then
        announce off "app off, waiting"
        return 0
    fi
    local settings_error
    settings_error="$(stored_settings_error)"
    if [ -z "$settings_error" ]; then
        announce healthy "editor enabled"
        return 0
    fi
    if occ onlyoffice:documentserver --check >/dev/null 2>&1; then
        announced_state=""
        announce healthy "editor re-enabled (was: $settings_error)"
        return 0
    fi
    announce tripped "editor disabled, document server still failing: $settings_error"
}

loops=0
while true; do
    loops=$((loops + 1))
    check_once
    [ "$MAX_LOOPS" -eq 0 ] || [ "$loops" -lt "$MAX_LOOPS" ] || break
    $SLEEP_COMMAND "$CHECK_INTERVAL_SECONDS"
done
