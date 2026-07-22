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

# ── manifest / new-app detection ──
APP_LIST_FIXTURE="Enabled:
  - activity: 3.0.0
  - deck: 1.14.0
Disabled:
  - spreed: 18.0.0"

# parse: both sections -> appids
out="$(printf '%s\n' "$APP_LIST_FIXTURE" | avuz_parse_app_list)"
assert_eq "parse emits all appids" "activity
deck
spreed" "$out"

# seed when absent: writes parsed appids
man="$(mktemp -u)"
printf '%s\n' "$APP_LIST_FIXTURE" | avuz_seed_manifest "$man"
assert_eq "seed writes manifest when absent" "activity
deck
spreed" "$(cat "$man")"

# seed when present: leaves manifest untouched
printf 'Enabled:\n  - newapp: 1.0.0\n' | avuz_seed_manifest "$man"
assert_eq "seed no-op when manifest present" "activity
deck
spreed" "$(cat "$man")"

# new_apps: only managed apps absent from manifest
out="$(avuz_new_apps "$man" deck spreed calendar forms)"
assert_eq "new_apps lists only unknown managed apps" "calendar
forms" "$out"

# enable_new_apps: enables the unknown ones and appends them
out="$(AVUZ_OCC_DRYRUN=1 avuz_enable_new_apps "$man" deck calendar)"
assert_eq "enable_new_apps enables only the new app" \
    "OCC app:enable --force calendar" "$out"
assert_eq "enable_new_apps appends new app to manifest" "activity
deck
spreed
calendar" "$(cat "$man")"

# failed enable must NOT append (retry next boot). Stub _avuz_occ to fail.
_avuz_occ() { return 1; }
avuz_enable_new_apps "$man" forms >/dev/null 2>&1
assert_eq "failed enable does not poison manifest" "activity
deck
spreed
calendar" "$(cat "$man")"
unset -f _avuz_occ; source "$HERE/../lib-apps.sh"   # restore real wrapper
rm -f "$man"

# ── retirement: disable only, never remove ──
out="$(AVUZ_OCC_DRYRUN=1 avuz_retire_apps roundcube weather_status)"
assert_eq "retire disables each listed app" "OCC app:disable roundcube
OCC app:disable weather_status" "$out"

out="$(AVUZ_OCC_DRYRUN=1 avuz_retire_apps)"
assert_eq "retire with no apps is a no-op" "" "$out"

# ── app path resolution ──
_avuz_occ() { echo "/var/www/html/custom_apps/spreed"; }
assert_eq "app_path returns occ getpath output" \
    "/var/www/html/custom_apps/spreed" "$(avuz_app_path spreed)"

assert_eq "sentinel_target joins path and relative file" \
    "/var/www/html/custom_apps/spreed/lib/Controller/RecordingController.php" \
    "$(avuz_sentinel_target spreed lib/Controller/RecordingController.php)"

_avuz_occ() { return 1; }
assert_eq "app_path empty when occ fails" "" "$(avuz_app_path spreed)"
assert_eq "sentinel_target empty when path unresolved" "" \
    "$(avuz_sentinel_target spreed lib/Controller/RecordingController.php)"
unset -f _avuz_occ
source "$HERE/../lib-apps.sh"

exit $fail
