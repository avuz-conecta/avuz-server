#!/bin/bash
# App-management helpers for the Avuz entrypoint. Sourced by docker/entrypoint.sh
# and docker/tests/apps.test.sh. No side effects on source.
#
# Splits the old run_avuz_configuration heavy block into testable units:
#   - occ upgrade with fail-closed classification (never a blanket `|| true`)
#   - a known-apps manifest so only genuinely-new managed apps auto-enable
#   - explicit REMOVE_APPS retirement (disable only, never app:remove)
#
# Set AVUZ_OCC_DRYRUN=1 to print planned occ calls instead of running them
# (used by the test harness — no container/occ required).

_avuz_occ() {
    if [ -n "${AVUZ_OCC_DRYRUN:-}" ]; then
        echo "OCC $*"
        return 0
    fi
    php occ "$@"
}

# Pure: classify an `occ upgrade` run. Failure IFF it left maintenance mode stuck
# on (mid-migration abort) or exited non-zero. A benign no-op ("already latest")
# exits 0 with maintenance off -> ok. Signature confirmed by the Task 1 probe.
avuz_classify_upgrade() {
    local rc="$1" maintenance_after="$2"
    if [ "$maintenance_after" = "on" ]; then echo "failure"; return; fi
    if [ "$rc" -ne 0 ]; then echo "failure"; return; fi
    echo "ok"
}

# Apply an upgrade classification: on failure record the marker (fail closed) and
# return 1; on ok clear it and return 0.
avuz_handle_upgrade_result() {
    local class="$1" marker="$2"
    if [ "$class" = "failure" ]; then
        date -u +%FT%TZ > "$marker"
        return 1
    fi
    rm -f "$marker"
    return 0
}
