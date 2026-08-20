#!/bin/bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
source "$HERE/../lib-perms.sh"

fail=0
assert_eq() {
    local desc="$1" expected="$2" actual="$3"
    if [ "$expected" = "$actual" ]; then
        echo "ok - $desc"
    else
        echo "NOT OK - $desc"; echo "  expected: [$expected]"; echo "  actual:   [$actual]"; fail=1
    fi
}

# plain restart: no db upgrade, no config run -> only the log-safety chown
out="$(AVUZ_CHOWN_DRYRUN=1 avuz_reconcile_data_ownership /data 0 0)"
assert_eq "plain restart does no data recursion" \
    "CHOWN /data/nextcloud.log" "$out"

# config bump with appdata present -> scope to appdata + log, never the user tree
tmp="$(mktemp -d)"; mkdir -p "$tmp/appdata_abc" "$tmp/user1/files"
out="$(AVUZ_CHOWN_DRYRUN=1 avuz_reconcile_data_ownership "$tmp" 0 1)"
assert_eq "config bump scopes to appdata + log" \
    "FIND-RECHOWN $tmp/appdata_abc/
CHOWN $tmp/nextcloud.log" "$out"
rm -rf "$tmp"

# config bump on S3 (no appdata on disk) -> log only, glob is a no-op
tmp="$(mktemp -d)"
out="$(AVUZ_CHOWN_DRYRUN=1 avuz_reconcile_data_ownership "$tmp" 0 1)"
assert_eq "S3 config bump = log only, glob no-op" \
    "CHOWN $tmp/nextcloud.log" "$out"
# real (non-dryrun) run must not abort under set -e when no appdata exists
( set -e; avuz_reconcile_data_ownership "$tmp" 0 1 >/dev/null 2>&1 ) \
    && echo "ok - real run no-op survives set -e" \
    || { echo "NOT OK - real run aborted under set -e"; fail=1; }
rm -rf "$tmp"

# db upgrade -> full targeted find over data root
out="$(AVUZ_CHOWN_DRYRUN=1 avuz_reconcile_data_ownership /data 1 0)"
assert_eq "db upgrade does full targeted find" \
    "FIND-RECHOWN /data
CHOWN /data/nextcloud.log" "$out"

# fix_perms_small: config/custom_apps recursive, data top-level only
out="$(AVUZ_CHOWN_DRYRUN=1 avuz_fix_perms_small /base)"
assert_eq "fix_perms_small recurses small dirs, data top-level only" \
    "CHOWN-R /base/config /base/custom_apps
CHMOD-R /base/config /base/custom_apps
CHOWN /base/data
CHMOD /base/data" "$out"

exit $fail
