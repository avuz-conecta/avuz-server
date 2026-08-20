#!/bin/bash
# Ownership/permission helpers for the Avuz entrypoint. Sourced by
# docker/entrypoint.sh and docker/tests/perms.test.sh. No side effects on source.
#
# occ runs as root in this image, so install/upgrade/repair create root-owned
# files under data/. php-fpm serves as www-data. These helpers restore www-data
# ownership without walking the millions of user-file inodes on every boot.
#
# Set AVUZ_CHOWN_DRYRUN=1 to print planned actions instead of running them
# (used by the test harness — no root required).

_avuz_chown() {
    local recursive="$1"; shift
    if [ -n "${AVUZ_CHOWN_DRYRUN:-}" ]; then
        if [ "$recursive" -eq 1 ]; then echo "CHOWN-R $*"; else echo "CHOWN $*"; fi
        return 0
    fi
    if [ "$recursive" -eq 1 ]; then
        chown -R www-data:www-data "$@" 2>/dev/null || true
    else
        chown www-data:www-data "$@" 2>/dev/null || true
    fi
}

_avuz_chmod() {
    local recursive="$1"; shift
    if [ -n "${AVUZ_CHOWN_DRYRUN:-}" ]; then
        if [ "$recursive" -eq 1 ]; then echo "CHMOD-R $*"; else echo "CHMOD $*"; fi
        return 0
    fi
    if [ "$recursive" -eq 1 ]; then
        chmod -R 770 "$@" 2>/dev/null || true
    else
        chmod 770 "$@" 2>/dev/null || true
    fi
}

_avuz_find_rechown() {
    local dir="$1"
    if [ -n "${AVUZ_CHOWN_DRYRUN:-}" ]; then echo "FIND-RECHOWN $dir"; return 0; fi
    find "$dir" \! -user www-data -exec chown www-data:www-data {} + || true
}

avuz_fix_perms_small() {
    local base="$1"
    _avuz_chown 1 "$base/config" "$base/custom_apps"
    _avuz_chmod 1 "$base/config" "$base/custom_apps"
    _avuz_chown 0 "$base/data"
    _avuz_chmod 0 "$base/data"
}

avuz_reconcile_data_ownership() {
    local data_dir="$1" did_db_upgrade="$2" did_config_run="$3"
    if [ "$did_db_upgrade" -eq 1 ]; then
        _avuz_find_rechown "$data_dir"
    elif [ "$did_config_run" -eq 1 ]; then
        shopt -s nullglob
        local appdata
        for appdata in "$data_dir"/appdata_*/; do
            _avuz_find_rechown "$appdata"
        done
        shopt -u nullglob
    fi
    # Log-owner safety. File owner is set at CREATION, not on append, so the log
    # goes root-owned only when occ-as-root creates it (fresh/config-bump/upgrade
    # boots) — and the appdata_* scope above excludes it. So on a config-bump boot
    # this is the ONLY line that heals the log; it also heals a log recreated by a
    # manual root `occ` run between plain restarts. No chmod: an active NC log is
    # owner-writable by construction (logfile_mode 0640), so chown alone restores
    # write access.
    _avuz_chown 0 "$data_dir/nextcloud.log"
}
