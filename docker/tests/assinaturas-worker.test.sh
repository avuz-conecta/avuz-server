#!/bin/bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
WORKER="$HERE/../assinaturas-worker.sh"

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
CALLS_LOG="$SCRATCH/calls.log"
SLEEPS_LOG="$SCRATCH/sleeps.log"

# Stub occ: answers the enabled check from FAKE_ENABLED_* and the worker from FAKE_WORKER_*.
cat > "$SCRATCH/occ" <<'STUB'
#!/usr/bin/env bash
echo "$*" >> "$CALLS_LOG"
if [ "$1" = "config:app:get" ]; then
    [ "$FAKE_ENABLED_EXIT" = "0" ] || exit "$FAKE_ENABLED_EXIT"
    printf '%s' "$FAKE_ENABLED_OUTPUT"
    exit 0
fi
[ "$FAKE_WORKER_HANGS" = "yes" ] && exec sleep 30
exit "$FAKE_WORKER_EXIT"
STUB
cat > "$SCRATCH/sleep" <<'STUB'
#!/usr/bin/env bash
echo "$1" >> "$SLEEPS_LOG"
STUB
chmod +x "$SCRATCH/occ" "$SCRATCH/sleep"

reset_fakes() {
    : > "$CALLS_LOG"; : > "$SLEEPS_LOG"
    FAKE_ENABLED_OUTPUT="yes"; FAKE_ENABLED_EXIT=0; FAKE_WORKER_EXIT=0; FAKE_WORKER_HANGS="no"
}

# Runs the worker for N loop iterations; stdout (state log lines) lands in WORKER_OUT.
WORKER_OUT=""
run_worker() {
    WORKER_OUT="$(
        export CALLS_LOG SLEEPS_LOG FAKE_ENABLED_OUTPUT FAKE_ENABLED_EXIT FAKE_WORKER_EXIT FAKE_WORKER_HANGS
        ASSINATURAS_WORKER_OCC="$SCRATCH/occ" ASSINATURAS_WORKER_SLEEP_COMMAND="$SCRATCH/sleep" \
            ASSINATURAS_WORKER_MAX_LOOPS="$1" bash "$WORKER" 2>&1
    )" || true
}
worker_calls() { grep -v '^config:app:get' "$CALLS_LOG" || true; }
sleeps() { tr '\n' ' ' < "$SLEEPS_LOG" | sed 's/ $//'; }

WORKER_COMMAND='background-job:worker --interval=1 --stop_after=3600 OCA\Assinaturas\Send\SendJob OCA\Assinaturas\Sync\SyncEnvelopeJob'

# ── enabled ──
reset_fakes; run_worker 1
assert_eq "runs the worker with exactly the two job classes" "$WORKER_COMMAND" "$(worker_calls)"
assert_eq "asks occ whether the app is enabled" "config:app:get assinaturas enabled" "$(grep '^config:app:get' "$CALLS_LOG")"
assert_eq "does not sleep after a normal worker stop" "" "$(sleeps)"
assert_eq "announces the worker once" "assinaturas-worker: app on, worker running" "$WORKER_OUT"

reset_fakes; FAKE_ENABLED_OUTPUT='["assinaturas"]'; run_worker 1
assert_eq "treats a JSON group list as enabled" "$WORKER_COMMAND" "$(worker_calls)"

reset_fakes; FAKE_ENABLED_OUTPUT=$'yes\n'; run_worker 1
assert_eq "tolerates trailing whitespace in the enabled value" "$WORKER_COMMAND" "$(worker_calls)"

reset_fakes; run_worker 3
assert_eq "restarts the worker after each normal stop" "3" "$(worker_calls | wc -l | tr -d ' ')"
assert_eq "logs nothing new while the state is unchanged" "assinaturas-worker: app on, worker running" "$WORKER_OUT"

# ── disabled ──
reset_fakes; FAKE_ENABLED_OUTPUT="no"; run_worker 1
assert_eq "skips the worker when the app is off" "" "$(worker_calls)"
assert_eq "rechecks an off app after 300 s" "300" "$(sleeps)"
assert_eq "announces the app is off" "assinaturas-worker: app off, waiting" "$WORKER_OUT"

reset_fakes; FAKE_ENABLED_OUTPUT=""; run_worker 1
assert_eq "treats an empty enabled value (never installed) as off" "" "$(worker_calls)"

reset_fakes; FAKE_ENABLED_EXIT=1; run_worker 1
assert_eq "treats an occ error (Nextcloud not installed) as off" "" "$(worker_calls)"
assert_eq "rechecks after an occ error in 300 s" "300" "$(sleeps)"

reset_fakes; FAKE_ENABLED_OUTPUT="no"; run_worker 3
assert_eq "announces an off app only once" "assinaturas-worker: app off, waiting" "$WORKER_OUT"
assert_eq "keeps waiting between checks" "300 300 300" "$(sleeps)"

# ── worker failure ──
reset_fakes; FAKE_WORKER_EXIT=1; run_worker 2
assert_eq "retries a failed worker" "2" "$(worker_calls | wc -l | tr -d ' ')"
assert_eq "backs off 30 s after each failure" "30 30" "$(sleeps)"
assert_eq "announces a failure once, not per retry" \
    "assinaturas-worker: app on, worker running
assinaturas-worker: worker exited with status 1, retrying in 30s" "$WORKER_OUT"

# ── transitions ──
reset_fakes; FAKE_ENABLED_OUTPUT="no"; run_worker 1
FAKE_ENABLED_OUTPUT="yes"
: > "$CALLS_LOG"; run_worker 1
assert_eq "starts the worker once the app turns on" "$WORKER_COMMAND" "$(worker_calls)"

# ── TERM ──
reset_fakes; FAKE_WORKER_HANGS="yes"
(
    export CALLS_LOG SLEEPS_LOG FAKE_ENABLED_OUTPUT FAKE_ENABLED_EXIT FAKE_WORKER_EXIT FAKE_WORKER_HANGS
    ASSINATURAS_WORKER_OCC="$SCRATCH/occ" ASSINATURAS_WORKER_SLEEP_COMMAND="$SCRATCH/sleep" bash "$WORKER" > /dev/null 2>&1 &
    worker_pid=$!
    sleep 1
    kill -TERM "$worker_pid"
    stopped=1
    for _ in 1 2 3 4 5 6 7 8 9 10; do
        kill -0 "$worker_pid" 2>/dev/null || { stopped=0; break; }
        sleep 0.5
    done
    exit_status=0
    [ "$stopped" -ne 0 ] || wait "$worker_pid" || exit_status=$?
    [ "$stopped" -eq 0 ] || kill -KILL "$worker_pid" 2>/dev/null || true
    echo "$stopped $exit_status" > "$SCRATCH/term-result"
)
assert_eq "exits cleanly and promptly on TERM while a worker runs" "0 0" "$(cat "$SCRATCH/term-result")"
assert_eq "does not back off after TERM" "" "$(sleeps)"

rm -rf "$SCRATCH"
exit "$fail"
