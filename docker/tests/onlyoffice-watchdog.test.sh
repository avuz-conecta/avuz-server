#!/bin/bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
WATCHDOG="$HERE/../onlyoffice-watchdog.sh"

fail=0
assert_eq() {
    local desc="$1" expected="$2" actual="$3"
    if [ "$expected" = "$actual" ]; then
        echo "ok - $desc"
    else
        echo "NOT OK - $desc"; echo "  expected: [$expected]"; echo "  actual:   [$actual]"; fail=1
    fi
}

SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT
export CALLS_LOG="$SCRATCH/calls.log"
export SETTINGS_ERROR_FILE="$SCRATCH/settings_error"

# Stub occ backed by a file for settings_error: a passing --check clears it,
# the way the real command does.
cat > "$SCRATCH/occ" <<'STUB'
#!/usr/bin/env bash
echo "$*" >> "$CALLS_LOG"
case "$1 ${3:-}" in
    "config:app:get enabled")
        [ "$FAKE_ENABLED_EXIT" = "0" ] || exit "$FAKE_ENABLED_EXIT"
        printf '%s\n' "$FAKE_ENABLED"; exit 0 ;;
    "config:app:get settings_error")
        cat "$SETTINGS_ERROR_FILE"; exit 0 ;;
esac
if [ "$1" = "onlyoffice:documentserver" ]; then
    [ "$FAKE_CHECK_EXIT" = "0" ] && : > "$SETTINGS_ERROR_FILE"
    exit "$FAKE_CHECK_EXIT"
fi
exit 0
STUB
chmod +x "$SCRATCH/occ"

run_watchdog() {
    : > "$CALLS_LOG"
    ONLYOFFICE_WATCHDOG_OCC="$SCRATCH/occ" \
    ONLYOFFICE_WATCHDOG_SLEEP_COMMAND=true \
    ONLYOFFICE_WATCHDOG_MAX_LOOPS="$1" \
        bash "$WATCHDOG"
}
check_calls() { grep -c '^onlyoffice:documentserver --check$' "$CALLS_LOG" || true; }

describe() { echo "# $1"; }

describe "healthy editor"
export FAKE_ENABLED=yes FAKE_ENABLED_EXIT=0 FAKE_CHECK_EXIT=0
: > "$SETTINGS_ERROR_FILE"
output="$(run_watchdog 3)"
assert_eq "never probes the document server" "0" "$(check_calls)"
assert_eq "reports enabled once" "onlyoffice-watchdog: editor enabled" "$output"

describe "editor tripped, document server back"
printf 'Error occurred in the document service: timeout' > "$SETTINGS_ERROR_FILE"
output="$(run_watchdog 3)"
assert_eq "runs the check once" "1" "$(check_calls)"
assert_eq "clears the stored error" "" "$(cat "$SETTINGS_ERROR_FILE")"
assert_eq "reports the recovery with the old error" \
    "onlyoffice-watchdog: editor re-enabled (was: Error occurred in the document service: timeout)" "$output"

describe "editor tripped, document server still down"
export FAKE_CHECK_EXIT=1
printf 'timeout' > "$SETTINGS_ERROR_FILE"
output="$(run_watchdog 3)"
assert_eq "retries the check every loop" "3" "$(check_calls)"
assert_eq "keeps the stored error" "timeout" "$(cat "$SETTINGS_ERROR_FILE")"
assert_eq "reports the failure once" \
    "onlyoffice-watchdog: editor disabled, document server still failing: timeout" "$output"

describe "app disabled"
export FAKE_ENABLED=no FAKE_CHECK_EXIT=0
output="$(run_watchdog 2)"
assert_eq "skips the check" "0" "$(check_calls)"
assert_eq "reports waiting" "onlyoffice-watchdog: app off, waiting" "$output"

describe "AvuzConecta not installed yet"
export FAKE_ENABLED_EXIT=1
output="$(run_watchdog 2)"
assert_eq "treats an occ error as off" "onlyoffice-watchdog: app off, waiting" "$output"
assert_eq "skips the check" "0" "$(check_calls)"

exit "$fail"
