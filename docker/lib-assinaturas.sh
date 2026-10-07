#!/bin/bash
# Assinaturas (Avuz's ZapSign e-signature app) boot sync. Sourced by
# docker/entrypoint.sh and docker/tests/assinaturas.test.sh after lib-apps.sh.
# No side effects on source.
#
# Runs EVERY boot (not stamp-gated): the stack env is the source of truth, so
# setting or removing the token takes effect on the next redeploy.
#   ZAPSIGN_API_TOKEN       tenant sub-account token; empty -> app disabled (data kept)
#   ZAPSIGN_ENVIRONMENT     sandbox | production
#   ZAPSIGN_COMPANY_NAME    tenant company shown to signers
#   ZAPSIGN_WEBHOOK_SECRET  optional; empty -> the app keeps its generated secret

AVUZ_ASSINATURAS_APP="assinaturas"
# ZapSign calls run before php-fpm starts; a hung API must not hold the boot.
AVUZ_ASSINATURAS_ENSURE_TIMEOUT_SECONDS=60
AVUZ_ASSINATURAS_CHANGED=0

# Pure: strip leading and trailing whitespace.
avuz_trim() {
    local value="$1"
    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"
    printf '%s' "$value"
}

# Pure: why the env cannot enable the app; empty when it can.
avuz_assinaturas_env_problem() {
    local token="$1" environment="$2" company="$3"
    if [ -z "$token" ]; then echo "no ZAPSIGN_API_TOKEN"; return; fi
    case "$environment" in
        sandbox|production) ;;
        *) echo "ZAPSIGN_ENVIRONMENT must be sandbox or production (got '$environment')"; return ;;
    esac
    if [ -z "$company" ]; then echo "no ZAPSIGN_COMPANY_NAME"; return; fi
}

# `enabled` is "yes", "no", empty (never installed) or a JSON group list when
# an admin limited the app to groups; the group list counts as enabled.
avuz_assinaturas_is_enabled() {
    local enabled
    enabled="$(_avuz_occ config:app:get "$AVUZ_ASSINATURAS_APP" enabled 2>/dev/null | tr -d '[:space:]')" || true
    [ -n "$enabled" ] && [ "$enabled" != "no" ]
}

avuz_assinaturas_disable() {
    local reason="$1"
    if avuz_assinaturas_is_enabled; then
        _avuz_occ app:disable "$AVUZ_ASSINATURAS_APP" >/dev/null || true
        AVUZ_ASSINATURAS_CHANGED=1
    fi
    echo "– Assinaturas off: $reason"
}

# Values travel by env var name, never on argv (admin_audit logs every occ
# command line). Prints the failed key and its value-free outcome.
avuz_assinaturas_write_key() {
    local key="$1"; shift
    local outcome
    if outcome="$(_avuz_php_config "$AVUZ_ASSINATURAS_APP" "$key" "$@")"; then return 0; fi
    echo "  $key: $outcome"
    return 1
}

# Each write returns on failure: callers run it under `if !`, where set -e is off.
avuz_assinaturas_write_config() {
    avuz_assinaturas_write_key api_token ZAPSIGN_API_TOKEN --sensitive || return 1
    avuz_assinaturas_write_key environment ZAPSIGN_ENVIRONMENT || return 1
    avuz_assinaturas_write_key company_name ZAPSIGN_COMPANY_NAME || return 1
    [ -z "${ZAPSIGN_WEBHOOK_SECRET:-}" ] && return 0
    avuz_assinaturas_write_key webhook_secret ZAPSIGN_WEBHOOK_SECRET --sensitive
}

avuz_assinaturas_sync() {
    AVUZ_ASSINATURAS_CHANGED=0
    local token environment company webhook_secret problem reconcile_output
    token="$(avuz_trim "${ZAPSIGN_API_TOKEN:-}")"
    environment="$(avuz_trim "${ZAPSIGN_ENVIRONMENT:-}")"
    company="$(avuz_trim "${ZAPSIGN_COMPANY_NAME:-}")"
    webhook_secret="$(avuz_trim "${ZAPSIGN_WEBHOOK_SECRET:-}")"
    problem="$(avuz_assinaturas_env_problem "$token" "$environment" "$company")"
    if [ -n "$problem" ]; then
        avuz_assinaturas_disable "$problem"
        return 0
    fi
    # The config writer reads these by name, so it must see the trimmed values.
    export ZAPSIGN_API_TOKEN="$token" ZAPSIGN_ENVIRONMENT="$environment" ZAPSIGN_COMPANY_NAME="$company" \
        ZAPSIGN_WEBHOOK_SECRET="$webhook_secret"
    if ! avuz_assinaturas_is_enabled; then
        if ! _avuz_occ app:enable --force "$AVUZ_ASSINATURAS_APP" >/dev/null; then
            echo "✗ Assinaturas: app:enable failed (is apps/assinaturas in the image?)"
            return 0
        fi
        AVUZ_ASSINATURAS_CHANGED=1
    fi
    reconcile_output="$(avuz_reconcile_app_versions "$AVUZ_ASSINATURAS_APP")"
    if [ -n "$reconcile_output" ]; then
        echo "$reconcile_output"
        AVUZ_ASSINATURAS_CHANGED=1
    fi
    # Repair steps only run on install and upgrade: this brings back a deleted
    # "Avuz Assinaturas" or "Avuz Assinaturas Admins" group (empty) on every boot.
    if ! _avuz_occ assinaturas:groups:ensure >/dev/null; then
        echo "✗ Assinaturas: groups:ensure failed — the app groups may be missing until the next boot"
    fi
    if ! avuz_assinaturas_write_config; then
        echo "✗ Assinaturas: could not write the app config — webhooks left as they were"
        return 0
    fi
    if ! _avuz_occ_bounded "$AVUZ_ASSINATURAS_ENSURE_TIMEOUT_SECONDS" assinaturas:webhook:ensure >/dev/null; then
        echo "✗ Assinaturas: webhook:ensure failed — see the Nextcloud log; EnsureWebhooksJob retries daily while the app is enabled"
        return 0
    fi
    echo "✓ Assinaturas ($ZAPSIGN_ENVIRONMENT) configured"
}
