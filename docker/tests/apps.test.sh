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
if guard_out2="$(avuz_guard_app_downgrades "storeapp" storeapp)"; then guard_rc2=0; else guard_rc2=1; fi
assert_eq "guard survives a failed store update — still non-fatal" "0" "$guard_rc2"
assert_eq "guard reports a failed store update instead of hiding it" "yes" \
    "$(printf '%s' "$guard_out2" | grep -q 'store update failed' && echo yes || echo no)"

unset -f _avuz_occ
source "$HERE/../lib-apps.sh"
rm -rf "$guard_root"

exit $fail
