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

# ── shadow copy detection / purge ──
shadow_root="$(mktemp -d)"; image_root="$(mktemp -d)"; quarantine="$(mktemp -d)"
mkdir -p "$shadow_root/spreed" "$shadow_root/deck" "$shadow_root/forms" "$shadow_root/orphan"
# usable image copies for spreed and deck only
mkdir -p "$image_root/spreed/appinfo" "$image_root/deck/appinfo"
touch "$image_root/spreed/appinfo/info.xml" "$image_root/deck/appinfo/info.xml"
# marker proves actual content moves, not just a directory node landing at
# the quarantine path (a `rm -rf` + `mkdir -p` would still pass a bare
# existence check but would silently lose this file)
echo spreed-payload > "$shadow_root/spreed/MARKER"

assert_eq "shadow_copies lists owned apps that have an image fallback" \
"$shadow_root/spreed
$shadow_root/deck" \
    "$(avuz_shadow_copies "$shadow_root" "$image_root" spreed deck orphan integration_openai)"

purge_out="$(avuz_purge_shadow_copies "$shadow_root" "$image_root" "$quarantine" \
    spreed deck orphan integration_openai)"

assert_eq "purge quarantines owned shadow copy" "gone" \
    "$([ -e "$shadow_root/spreed" ] && echo present || echo gone)"
assert_eq "purge is reversible — copy lands in quarantine" "present" \
    "$([ -d "$quarantine/spreed" ] && echo present || echo gone)"
assert_eq "purge is reversible — marker content survives the move" \
    "spreed-payload" "$(cat "$quarantine/spreed/MARKER" 2>/dev/null)"
assert_eq "purge NEVER touches an app with no image fallback" "present" \
    "$([ -e "$shadow_root/orphan" ] && echo present || echo gone)"
assert_eq "orphan is warned about" "yes" \
    "$(printf '%s' "$purge_out" | grep -q 'no image copy' && echo yes || echo no)"
assert_eq "purge leaves non-owned app untouched" "present" \
    "$([ -e "$shadow_root/forms" ] && echo present || echo gone)"
assert_eq "purge is idempotent" "0" \
    "$(avuz_purge_shadow_copies "$shadow_root" "$image_root" "$quarantine" spreed deck >/dev/null; echo $?)"

# ── parameter validation guards ──
assert_eq "shadow_copies guards against empty root" "1" \
    "$( (avuz_shadow_copies "" "$image_root" spreed) >/dev/null 2>&1; echo $? )"
assert_eq "purge_shadow_copies guards against empty quarantine" "1" \
    "$( (avuz_purge_shadow_copies "$shadow_root" "$image_root" "" spreed) >/dev/null 2>&1; echo $? )"

# ── malformed app names are refused, not acted on ──
for bad_app in "" "." ".." "../escape" "spreed/../../etc"; do
    bad_out="$(avuz_shadow_copies "$shadow_root" "$image_root" "$bad_app")"
    assert_eq "shadow_copies refuses malformed app name '$bad_app'" "" "$bad_out"

    bad_purge_out="$(avuz_purge_shadow_copies "$shadow_root" "$image_root" "$quarantine" "$bad_app")"
    assert_eq "purge_shadow_copies refuses malformed app name '$bad_app'" "yes" \
        "$(printf '%s' "$bad_purge_out" | grep -q 'malformed app name' && echo yes || echo no)"
done
assert_eq "malformed-name run touched nothing outside the volume" "present" \
    "$([ -e "$shadow_root/forms" ] && echo present || echo gone)"

rm -rf "$shadow_root" "$image_root" "$quarantine"

# ── version comparison ──
assert_eq "5.2.5 < 5.3.0"      "yes" "$(avuz_version_lt 5.2.5 5.3.0 && echo yes || echo no)"
assert_eq "5.3.0 not < 5.2.5"  "no"  "$(avuz_version_lt 5.3.0 5.2.5 && echo yes || echo no)"
assert_eq "equal is not less"  "no"  "$(avuz_version_lt 5.2.5 5.2.5 && echo yes || echo no)"
assert_eq "4.5.1.7 < 4.5.2"    "yes" "$(avuz_version_lt 4.5.1.7 4.5.2 && echo yes || echo no)"

# different segment counts for the same release must compare equal, not less
assert_eq "5.3 not < 5.3.0 (equal, different segment count)" "no" \
    "$(avuz_version_lt 5.3 5.3.0 && echo yes || echo no)"
assert_eq "5.3.0 not < 5.3 (equal, different segment count)" "no" \
    "$(avuz_version_lt 5.3.0 5.3 && echo yes || echo no)"
assert_eq "5.9 < 5.10"         "yes" "$(avuz_version_lt 5.9 5.10 && echo yes || echo no)"
assert_eq "5.2.5 < 5.2.10"     "yes" "$(avuz_version_lt 5.2.5 5.2.10 && echo yes || echo no)"

# ── downgrade detection ──
assert_eq "code older than schema is behind" "behind" "$(avuz_code_behind_db forms 5.2.5 5.3.0)"
assert_eq "code matching schema is ok"       "ok"     "$(avuz_code_behind_db forms 5.3.0 5.3.0)"
assert_eq "code newer than schema is ok"     "ok"     "$(avuz_code_behind_db forms 5.3.5 5.3.0)"
assert_eq "missing db version is ok"         "ok"     "$(avuz_code_behind_db forms 5.2.5 '')"

# ── downgrade guard: heal store apps, report owned apps, stay non-fatal ──
guard_root="$(mktemp -d)"
store_app_dir="$guard_root/storeapp"; owned_app_dir="$guard_root/ownedapp"; ok_app_dir="$guard_root/okapp"
mkdir -p "$store_app_dir/appinfo" "$owned_app_dir/appinfo" "$ok_app_dir/appinfo"
printf '<?xml version="1.0"?>\n<info><id>storeapp</id><version>5.2.5</version></info>\n' \
    > "$store_app_dir/appinfo/info.xml"
printf '<?xml version="1.0"?>\n<info><id>ownedapp</id><version>5.2.5</version></info>\n' \
    > "$owned_app_dir/appinfo/info.xml"
printf '<?xml version="1.0"?>\n<info><id>okapp</id><version>5.3.0</version></info>\n' \
    > "$ok_app_dir/appinfo/info.xml"

GUARD_UPDATE_FAIL=""
_avuz_occ() {
    case "$1" in
        app:getpath)
            case "$2" in
                storeapp) echo "$store_app_dir" ;;
                ownedapp) echo "$owned_app_dir" ;;
                okapp)    echo "$ok_app_dir" ;;
            esac
            ;;
        config:app:get)
            echo "5.3.0"   # every app's schema is already migrated to 5.3.0
            ;;
        app:update)
            echo "UPDATE_CALLED:$2"
            [ "$GUARD_UPDATE_FAIL" = "1" ] && return 1
            return 0
            ;;
    esac
}

# store-managed app behind schema -> healed; owned app behind schema -> reported,
# never store-updated; app not behind -> silent.
guard_out="$(avuz_guard_app_downgrades "storeapp okapp" storeapp ownedapp okapp)"
guard_rc=$?
assert_eq "guard is non-fatal when everything succeeds" "0" "$guard_rc"
assert_eq "guard heals a behind store-managed app via app:update" "yes" \
    "$(printf '%s' "$guard_out" | grep -q 'UPDATE_CALLED:storeapp' && echo yes || echo no)"
assert_eq "guard never store-updates a behind owned app" "no" \
    "$(printf '%s' "$guard_out" | grep -q 'UPDATE_CALLED:ownedapp' && echo yes || echo no)"
assert_eq "guard tells the operator to rebuild the image for an owned app" "yes" \
    "$(printf '%s' "$guard_out" | grep -qi 'rebuild the image' && echo yes || echo no)"
assert_eq "guard says nothing about an app that is not behind" "no" \
    "$(printf '%s' "$guard_out" | grep -q 'okapp' && echo yes || echo no)"

# a failing store update must not abort the boot — the guard swallows it and
# reports, it never lets the `occ app:update` exit status propagate.
GUARD_UPDATE_FAIL=1
guard_out2="$(avuz_guard_app_downgrades "storeapp" storeapp)"; guard_rc2=$?
assert_eq "guard survives a failed store update — still non-fatal" "0" "$guard_rc2"
assert_eq "guard reports a failed store update instead of hiding it" "yes" \
    "$(printf '%s' "$guard_out2" | grep -q 'store update failed' && echo yes || echo no)"
GUARD_UPDATE_FAIL=""

# an empty store list must fall through to the owned/report branch and never
# heal — prove it, don't just assume the shipped fallthrough is safe. Capture
# to a variable before grepping (matching the pattern above) rather than
# piping the function straight into `grep -q`: under `pipefail`, `grep -q`
# can close the pipe as soon as it matches while the function is still
# writing later lines, and the resulting SIGPIPE makes the pipeline's exit
# status nonzero regardless of the match — a real, observed flake.
guard_out3="$(avuz_guard_app_downgrades "" storeapp)"
assert_eq "empty store list never heals" "no" \
    "$(printf '%s' "$guard_out3" | grep -q UPDATE_CALLED && echo yes || echo no)"

# entrypoint.sh (Task 5) calls this function bare at the top level under
# `set -e`, never inside `$(...)` or an `if`. Command substitution does NOT
# inherit errexit (no `shopt -s inherit_errexit` in this repo), so every
# assertion above — all wrapped in `$(...)` — would still pass even if the
# function aborted the real boot. Exercise the actual call pattern: a bare
# call, in a `set -e` subshell, with the store update failing.
#
# NB: the stub below uses if/elif, not `case`, deliberately — bash 3.2 (the
# macOS default, still in play in this dev environment) mis-parses a `case`
# defined inside a command substitution that itself wraps a `( ... )`
# subshell, throwing a spurious "syntax error near unexpected token `newline'"
# even though the script is valid. if/elif sidesteps that parser bug.
#
# The assignment below is wrapped in `if ... ; then :; fi` on purpose: the
# inner `( set -e ... )` subshell is EXPECTED to abort when the regression
# this test guards against is present, which makes the command substitution
# exit non-zero. Assigning it as a bare top-level statement would let that
# non-zero status trip this outer test script's own `set -e` (line 2) and
# kill the whole suite before the assertion below ever runs. Putting the
# assignment in an `if` condition still performs it — the variable is set
# either way — but keeps its exit status from being errexit-checked here.
if bare_out="$( ( set -e
    source "$HERE/../lib-apps.sh"
    _avuz_occ() {
        if [ "$1" = "app:getpath" ]; then
            echo "$store_app_dir"
        elif [ "$1" = "config:app:get" ]; then
            echo "5.3.0"
        elif [ "$1" = "app:update" ]; then
            return 1
        fi
    }
    avuz_guard_app_downgrades "storeapp" storeapp
    echo REACHED
) 2>&1 )"; then :; fi
assert_eq "guard survives bare set -e invocation (matches entrypoint.sh call site)" "yes" \
    "$(printf '%s' "$bare_out" | grep -q REACHED && echo yes || echo no)"

unset -f _avuz_occ
source "$HERE/../lib-apps.sh"
rm -rf "$guard_root"

# ── disjointness ──
assert_eq "disjoint sets report nothing" "" \
    "$(avuz_assert_disjoint "forms calendar" "spreed deck")"
assert_eq "overlap is reported" "spreed" \
    "$(avuz_assert_disjoint "forms spreed" "spreed deck")"

# ── store sync plan ──
export AVUZ_OCC_DRYRUN=1
sync_out="$(avuz_sync_store_apps forms calendar)"
assert_eq "sync updates apps already present" "yes" \
    "$(printf '%s' "$sync_out" | grep -q 'OCC app:update forms' && echo yes || echo no)"
assert_eq "sync never uses --all" "no" \
    "$(printf '%s' "$sync_out" | grep -q -- '--all' && echo yes || echo no)"

# The two assertions above only exercise the update branch: under plain
# AVUZ_OCC_DRYRUN=1, `_avuz_occ app:getpath` always echoes and returns 0, so
# app:getpath "always succeeds" and the install branch (the else side) is
# unreachable from this suite for any app name — an install-branch --all
# regression would sail through undetected. Force the install branch by
# stubbing _avuz_occ per-argument (same convention as the
# avuz_guard_app_downgrades block above): make app:getpath fail to simulate
# "app not installed", so avuz_sync_store_apps must take the else branch.
_avuz_occ() {
    if [ "$1" = "app:getpath" ]; then return 1; fi
    echo "OCC $*"
    return 0
}
install_out="$(avuz_sync_store_apps forms)"
assert_eq "sync installs an app absent from getpath" "yes" \
    "$(printf '%s' "$install_out" | grep -q 'OCC app:install forms' && echo yes || echo no)"
assert_eq "sync install branch never uses --all" "no" \
    "$(printf '%s' "$install_out" | grep -q -- '--all' && echo yes || echo no)"
unset -f _avuz_occ; source "$HERE/../lib-apps.sh"   # restore real wrapper

unset AVUZ_OCC_DRYRUN

exit $fail
