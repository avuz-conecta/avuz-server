#!/bin/bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
source "$HERE/../lib-health.sh"

fail=0
assert_eq() {
    local desc="$1" expected="$2" actual="$3"
    if [ "$expected" = "$actual" ]; then
        echo "ok - $desc"
    else
        echo "NOT OK - $desc"; echo "  expected: [$expected]"; echo "  actual:   [$actual]"; fail=1
    fi
}

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# ── failure counter ────────────────────────────────────────────────────────
state="$tmp/state"
assert_eq "counts from zero on a fresh boot" "0" "$(avuz_health_failures "$state")"
assert_eq "first failure reads 1" "1" "$(avuz_health_bump_failures "$state")"
assert_eq "consecutive failures accumulate" "2" "$(avuz_health_bump_failures "$state")"
assert_eq "counter survives a re-read" "2" "$(avuz_health_failures "$state")"

avuz_health_reset_failures "$state"
assert_eq "a healthy probe clears the streak" "0" "$(avuz_health_failures "$state")"

printf 'garbage' > "$state/failures"
assert_eq "corrupt counter falls back to zero" "0" "$(avuz_health_failures "$state")"
assert_eq "corrupt counter restarts at 1" "1" "$(avuz_health_bump_failures "$state")"

# ── log append ─────────────────────────────────────────────────────────────
log="$tmp/health.log"
avuz_health_append "$log" "first"
avuz_health_append "$log" "second"
assert_eq "appends preserve order" "first
second" "$(cat "$log")"

( set -e; avuz_health_append "$tmp/nonexistent-dir/health.log" "x" ) \
    && echo "ok - unwritable log never aborts the probe" \
    || { echo "NOT OK - unwritable log aborted the probe"; fail=1; }

# ── rotation ───────────────────────────────────────────────────────────────
avuz_health_rotate "$log" 1048576
assert_eq "small log is left alone" "first
second" "$(cat "$log")"
[ -f "$log.1" ] && { echo "NOT OK - rotated a small log"; fail=1; } || echo "ok - no backup for a small log"

head -c 200 /dev/zero | tr '\0' 'x' > "$log"
avuz_health_rotate "$log" 100
[ -f "$log.1" ] && echo "ok - oversized log moves to .1" || { echo "NOT OK - oversized log not rotated"; fail=1; }
[ -f "$log" ] && { echo "NOT OK - rotation left the old log in place"; fail=1; } || echo "ok - rotation frees the live log"

avuz_health_append "$log" "post-rotation"
assert_eq "logging resumes after rotation" "post-rotation" "$(cat "$log")"

# rotating twice keeps exactly one backup generation (bounded disk use)
head -c 200 /dev/zero | tr '\0' 'x' > "$log"
avuz_health_rotate "$log" 100
assert_eq "only one backup generation is kept" "1" "$(ls "$tmp" | grep -c 'health.log.1')"

avuz_health_rotate "$tmp/never-existed.log" 100 \
    && echo "ok - rotating a missing log is a no-op" \
    || { echo "NOT OK - rotating a missing log failed"; fail=1; }

# ── timestamp ──────────────────────────────────────────────────────────────
stamp="$(avuz_health_timestamp)"
[[ "$stamp" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] \
    && echo "ok - timestamp is sortable UTC ISO-8601" \
    || { echo "NOT OK - bad timestamp: $stamp"; fail=1; }

exit "$fail"
