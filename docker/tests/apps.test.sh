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
