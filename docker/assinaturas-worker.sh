#!/bin/bash
# Always-on worker for Assinaturas' user-facing jobs (sending an envelope,
# applying a webhook). Nextcloud cron only fires every 300 s, which made a click
# on "Send" wait minutes. Idles while the app is off, so it is safe to run on
# every tenant. Supervised by docker/supervisor.conf.
#
# ASSINATURAS_WORKER_OCC, _SLEEP_COMMAND and _MAX_LOOPS exist for the tests only.

set -euo pipefail

APP_ID="assinaturas"
JOB_CLASSES=('OCA\Assinaturas\Send\SendJob' 'OCA\Assinaturas\Sync\SyncEnvelopeJob')
POLL_INTERVAL_SECONDS=1
WORKER_LIFETIME_SECONDS=3600
APP_OFF_RECHECK_SECONDS=300
FAILURE_BACKOFF_SECONDS=30

OCC_COMMAND="${ASSINATURAS_WORKER_OCC:-php /var/www/html/occ}"
SLEEP_COMMAND="${ASSINATURAS_WORKER_SLEEP_COMMAND:-sleep}"
MAX_LOOPS="${ASSINATURAS_WORKER_MAX_LOOPS:-0}"

child_pid=""
child_status=0
stop_requested=0
announced_state=""

request_stop() {
    stop_requested=1
    [ -z "$child_pid" ] || kill -TERM "$child_pid" 2>/dev/null || true
}
trap request_stop TERM INT

# Runs in the background so a TERM reaches the child at once (a foreground child
# would hold the trap until it exits) and a running send can still finish.
run_interruptibly() {
    "$@" &
    child_pid=$!
    child_status=0
    wait "$child_pid" || child_status=$?
    while kill -0 "$child_pid" 2>/dev/null; do
        wait "$child_pid" || child_status=$?
    done
    child_pid=""
}

occ() {
    # shellcheck disable=SC2086
    $OCC_COMMAND "$@"
}

announce() {
    [ "$announced_state" = "$1" ] && return 0
    announced_state="$1"
    echo "assinaturas-worker: $2"
}

# `enabled` is "yes", "no", empty (never installed) or a JSON group list.
# Any occ error (Nextcloud not installed yet, DB down) counts as disabled.
app_is_enabled() {
    local enabled
    enabled="$(occ config:app:get "$APP_ID" enabled 2>/dev/null | tr -d '[:space:]')" || return 1
    [ -n "$enabled" ] && [ "$enabled" != "no" ]
}

pause() {
    # shellcheck disable=SC2086
    run_interruptibly $SLEEP_COMMAND "$1"
}

loops=0
while [ "$stop_requested" -eq 0 ]; do
    loops=$((loops + 1))
    if app_is_enabled; then
        [ "$announced_state" = failed ] || announce running "app on, worker running"
        # shellcheck disable=SC2086
        run_interruptibly $OCC_COMMAND background-job:worker \
            --interval="$POLL_INTERVAL_SECONDS" --stop_after="$WORKER_LIFETIME_SECONDS" "${JOB_CLASSES[@]}"
        if [ "$child_status" -eq 0 ]; then
            announce running "app on, worker running"
        elif [ "$stop_requested" -eq 0 ]; then
            announce failed "worker exited with status $child_status, retrying in ${FAILURE_BACKOFF_SECONDS}s"
            pause "$FAILURE_BACKOFF_SECONDS"
        fi
    else
        announce off "app off, waiting"
        pause "$APP_OFF_RECHECK_SECONDS"
    fi
    [ "$MAX_LOOPS" -eq 0 ] || [ "$loops" -lt "$MAX_LOOPS" ] || break
done
