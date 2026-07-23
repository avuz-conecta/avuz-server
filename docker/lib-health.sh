#!/bin/bash
# Health-log plumbing shared by healthcheck.sh (probe) and entrypoint.sh (boot marker).
# Pure-ish helpers: every path is a parameter so docker/tests/health.test.sh can drive
# them against a tmpdir without a container.

AVUZ_HEALTH_LOG="${AVUZ_HEALTH_LOG:-/var/www/html/data/avuz-health.log}"
AVUZ_HEALTH_STATE="${AVUZ_HEALTH_STATE:-/tmp/avuz-health}"
AVUZ_HEALTH_LOG_MAX_BYTES="${AVUZ_HEALTH_LOG_MAX_BYTES:-1048576}"

# Never let logging break the probe: a full disk (the very failure we want recorded)
# must still produce an exit code, not a crash.
avuz_health_append() {
    local log="$1" line="$2"
    # Group-level redirect: a failing `>>` is reported by the shell itself, so the
    # inner command's own 2>/dev/null would not silence it.
    { printf '%s\n' "$line" >> "$log"; } 2>/dev/null || return 0
}

# Single generation of backup — enough to survive one rotation mid-incident,
# bounded so a crash-loop can't eat the data volume.
avuz_health_rotate() {
    local log="$1" max_bytes="$2"
    [ -f "$log" ] || return 0
    local size
    size="$(wc -c < "$log" 2>/dev/null | tr -d ' ')"
    [ -n "$size" ] || return 0
    [ "$size" -lt "$max_bytes" ] && return 0
    mv -f "$log" "$log.1" 2>/dev/null || return 0
}

avuz_health_timestamp() {
    date -u '+%Y-%m-%dT%H:%M:%SZ'
}

# Consecutive-failure counter, in /tmp. NOTE: `docker restart` (what autoheal does)
# keeps the writable layer, so /tmp survives a restart — the entrypoint clears this
# file at boot (avuz_health_reset_failures) so the count means "failures since this
# boot", not since the container was first created.
avuz_health_bump_failures() {
    local state_dir="$1"
    mkdir -p "$state_dir" 2>/dev/null || { echo 1; return 0; }
    local count=0
    [ -f "$state_dir/failures" ] && count="$(cat "$state_dir/failures" 2>/dev/null || echo 0)"
    case "$count" in ''|*[!0-9]*) count=0 ;; esac
    count=$((count + 1))
    printf '%s' "$count" > "$state_dir/failures" 2>/dev/null || true
    echo "$count"
}

avuz_health_reset_failures() {
    local state_dir="$1"
    rm -f "$state_dir/failures" 2>/dev/null || true
}

avuz_health_failures() {
    local state_dir="$1" count=0
    [ -f "$state_dir/failures" ] && count="$(cat "$state_dir/failures" 2>/dev/null || echo 0)"
    case "$count" in ''|*[!0-9]*) count=0 ;; esac
    echo "$count"
}
