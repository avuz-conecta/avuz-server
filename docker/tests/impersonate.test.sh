#!/bin/bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
export AVUZ_IMPERSONATE_ENV_OFF_MARKER="$WORK/.avuz_impersonate_env_off"
source "$HERE/../lib-apps.sh"
source "$HERE/../lib-impersonate.sh"

fail=0
assert_eq() {
    local desc="$1" expected="$2" actual="$3"
    if [ "$expected" = "$actual" ]; then
        echo "ok - $desc"
    else
        echo "NOT OK - $desc"; echo "  expected: [$expected]"; echo "  actual:   [$actual]"; fail=1
    fi
}

# Fake occ backed by files, so a sequence of boots sees the state the previous
# boot left behind.
OCC_LOG="$WORK/occ.log"
STATE="$WORK/state"
mkdir -p "$STATE"
FAKE_APP_DIR="$WORK/apps/impersonate"
mkdir -p "$FAKE_APP_DIR/appinfo"
printf '<info><version>4.0.0</version></info>' > "$FAKE_APP_DIR/appinfo/info.xml"

state_get() { cat "$STATE/$1" 2>/dev/null || true; }
state_set() { printf '%s' "$2" > "$STATE/$1"; }

_avuz_occ() {
    printf '%s\n' "$*" >> "$OCC_LOG"
    case "$*" in
        "app:getpath impersonate") echo "$FAKE_APP_DIR" ;;
        "config:app:get impersonate enabled") state_get enabled ;;
        "config:app:get impersonate installed_version") state_get installed_version ;;
        "config:app:get impersonate authorized")
            [ -f "$STATE/authorized" ] || return 1
            state_get authorized ;;
        "config:app:set impersonate authorized --value="*)
            [ "${FAKE_SET_FAILS:-no}" = "yes" ] && return 1
            state_set authorized "${4#--value=}" ;;
        "app:enable impersonate")
            [ "${FAKE_ENABLE_FAILS:-no}" = "yes" ] && return 1
            state_set enabled yes
            state_set installed_version 4.0.0 ;;
        "app:disable impersonate") state_set enabled no ;;
    esac
    return 0
}

reset_instance() {
    rm -rf "$STATE" "$AVUZ_IMPERSONATE_ENV_OFF_MARKER"
    mkdir -p "$STATE"
    : > "$OCC_LOG"
    unset AVUZ_IMPERSONATE_ENABLED AVUZ_IMPERSONATE_GROUPS FAKE_SET_FAILS FAKE_ENABLE_FAILS
}
occ_writes() { grep -v '^config:app:get\|^app:getpath' "$OCC_LOG" || true; }
boot() { : > "$OCC_LOG"; avuz_impersonate_sync; }

# ── allowed-groups JSON ──
assert_eq "it turns the default group into a JSON list" '["admin"]' "$(avuz_impersonate_groups_json admin)"
assert_eq "it trims and keeps every listed group" '["admin","suporte avuz"]' \
    "$(avuz_impersonate_groups_json ' admin , suporte avuz ')"
assert_eq "it drops empty entries" '["admin"]' "$(avuz_impersonate_groups_json ',admin,,')"
assert_eq "it escapes quotes and backslashes" '["a\"b","c\\d"]' "$(avuz_impersonate_groups_json 'a"b,c\d')"
assert_eq "it returns nothing when no group is left" "" "$(avuz_impersonate_groups_json ' , ')"
assert_eq "it returns nothing for an empty list" "" "$(avuz_impersonate_groups_json '')"

# ── fresh instance, default env ──
reset_instance
boot >/dev/null
assert_eq "it restricts impersonation to admin by default" '["admin"]' "$(state_get authorized)"
assert_eq "it enables the app on its first boot" "yes" "$(state_get enabled)"
assert_eq "it writes the groups before it enables the app" \
'config:app:set impersonate authorized --value=["admin"]
app:enable impersonate' "$(occ_writes)"
assert_eq "it reports an app change on the boot that enabled it" "1" "$AVUZ_IMPERSONATE_CHANGED"

boot >/dev/null
assert_eq "a plain restart writes nothing" "" "$(occ_writes)"
assert_eq "a plain restart reports no change" "0" "$AVUZ_IMPERSONATE_CHANGED"

# ── allowed groups from env ──
reset_instance
AVUZ_IMPERSONATE_GROUPS="admin,suporte"
boot >/dev/null
assert_eq "it uses the groups from AVUZ_IMPERSONATE_GROUPS" '["admin","suporte"]' "$(state_get authorized)"
AVUZ_IMPERSONATE_GROUPS=""
boot >/dev/null
assert_eq "an empty AVUZ_IMPERSONATE_GROUPS falls back to admin" '["admin"]' "$(state_get authorized)"
AVUZ_IMPERSONATE_GROUPS=" , "
out="$(boot)"
assert_eq "a group list with no group falls back to admin, never to []" '["admin"]' "$(state_get authorized)"
assert_eq "it warns about a group list with no group" "yes" \
    "$(printf '%s' "$out" | grep -q 'AVUZ_IMPERSONATE_GROUPS has no group' && echo yes || echo no)"

reset_instance
state_set authorized '["admin","financeiro"]'
state_set enabled yes; state_set installed_version 4.0.0
boot >/dev/null
assert_eq "it replaces groups an admin added in the settings page" '["admin"]' "$(state_get authorized)"

# ── admin disabled the app ──
reset_instance
state_set enabled no; state_set installed_version 4.0.0
out="$(boot)"
assert_eq "it leaves an admin-disabled app off" "no" "$(state_get enabled)"
assert_eq "it never calls app:enable on an admin-disabled app" "" \
    "$(occ_writes | grep 'app:enable' || true)"
assert_eq "it says why the app stays off" "yes" \
    "$(printf '%s' "$out" | grep -q 'disabled by an admin' && echo yes || echo no)"

# ── per-stack toggle ──
reset_instance
boot >/dev/null
AVUZ_IMPERSONATE_ENABLED=0
boot >/dev/null
assert_eq "AVUZ_IMPERSONATE_ENABLED=0 disables the app" "no" "$(state_get enabled)"
boot >/dev/null
assert_eq "a restart with the app already off writes nothing" "" "$(occ_writes)"
AVUZ_IMPERSONATE_ENABLED=1
boot >/dev/null
assert_eq "flipping the env back on re-enables an env-disabled app" "yes" "$(state_get enabled)"
assert_eq "it clears the env-off marker once the app is back on" "gone" \
    "$([ -e "$AVUZ_IMPERSONATE_ENV_OFF_MARKER" ] && echo present || echo gone)"

reset_instance
AVUZ_IMPERSONATE_ENABLED=0
boot >/dev/null
assert_eq "env off on a fresh instance never enables the app" "" "$(state_get enabled)"
assert_eq "env off still restricts the groups, for a manual enable" '["admin"]' "$(state_get authorized)"

reset_instance
state_set enabled no; state_set installed_version 4.0.0
AVUZ_IMPERSONATE_ENABLED=0
boot >/dev/null
AVUZ_IMPERSONATE_ENABLED=1
boot >/dev/null
assert_eq "an env off/on cycle keeps an admin-disabled app off" "no" "$(state_get enabled)"

# ── failures ──
reset_instance
FAKE_SET_FAILS=yes
if out="$(boot)"; then rc=0; else rc=1; fi
assert_eq "it never enables the app when the groups could not be written" "" "$(state_get enabled)"
assert_eq "a failed groups write does not abort the boot" "0" "$rc"

reset_instance
state_set enabled yes; state_set installed_version 4.0.0
FAKE_SET_FAILS=yes AVUZ_IMPERSONATE_ENABLED=0
boot >/dev/null
assert_eq "env off disables the app even when the groups write fails" "no" "$(state_get enabled)"

reset_instance
FAKE_ENABLE_FAILS=yes
if out="$(boot)"; then rc=0; else rc=1; fi
assert_eq "a failed enable does not abort the boot" "0" "$rc"
unset FAKE_ENABLE_FAILS
boot >/dev/null
assert_eq "it retries a failed enable on the next boot" "yes" "$(state_get enabled)"

exit $fail
