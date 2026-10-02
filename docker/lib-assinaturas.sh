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
AVUZ_ASSINATURAS_ENVIRONMENTS=" sandbox production "
AVUZ_ASSINATURAS_CHANGED=0

# Pure: why the env cannot enable the app; empty when it can.
avuz_assinaturas_env_problem() {
    local token="$1" environment="$2" company="$3"
    if [ -z "$token" ]; then echo "no ZAPSIGN_API_TOKEN"; return; fi
    if [ -z "$environment" ] || [[ "$AVUZ_ASSINATURAS_ENVIRONMENTS" != *" $environment "* ]]; then
        echo "ZAPSIGN_ENVIRONMENT must be sandbox or production (got '$environment')"; return
    fi
    if [ -z "$company" ]; then echo "no ZAPSIGN_COMPANY_NAME"; return; fi
}

avuz_assinaturas_is_enabled() {
    [ "$(_avuz_occ config:app:get "$AVUZ_ASSINATURAS_APP" enabled 2>/dev/null | tr -d '[:space:]')" = "yes" ]
}

avuz_assinaturas_disable() {
    local reason="$1"
    if avuz_assinaturas_is_enabled; then
        _avuz_occ app:disable "$AVUZ_ASSINATURAS_APP" >/dev/null || true
        AVUZ_ASSINATURAS_CHANGED=1
    fi
    echo "– Assinaturas off: $reason"
}

# Each write returns on failure: callers run it under `if !`, where set -e is off.
avuz_assinaturas_write_config() {
    avuz_set_sensitive_app_config "$AVUZ_ASSINATURAS_APP" api_token "$ZAPSIGN_API_TOKEN" string >/dev/null || return 1
    _avuz_occ config:app:set "$AVUZ_ASSINATURAS_APP" environment --type=string --value="$ZAPSIGN_ENVIRONMENT" >/dev/null || return 1
    _avuz_occ config:app:set "$AVUZ_ASSINATURAS_APP" company_name --type=string --value="$ZAPSIGN_COMPANY_NAME" >/dev/null || return 1
    [ -z "${ZAPSIGN_WEBHOOK_SECRET:-}" ] && return 0
    avuz_set_sensitive_app_config "$AVUZ_ASSINATURAS_APP" webhook_secret "$ZAPSIGN_WEBHOOK_SECRET" string >/dev/null
}

avuz_assinaturas_sync() {
    AVUZ_ASSINATURAS_CHANGED=0
    local problem reconcile_output
    problem="$(avuz_assinaturas_env_problem "${ZAPSIGN_API_TOKEN:-}" "${ZAPSIGN_ENVIRONMENT:-}" "${ZAPSIGN_COMPANY_NAME:-}")"
    if [ -n "$problem" ]; then
        avuz_assinaturas_disable "$problem"
        return 0
    fi
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
    if ! avuz_assinaturas_write_config; then
        echo "✗ Assinaturas: could not write the app config — webhooks left as they were"
        return 0
    fi
    if ! _avuz_occ assinaturas:webhook:ensure >/dev/null; then
        echo "✗ Assinaturas: webhook:ensure failed — EnsureWebhooksJob retries daily; the poller covers the gap"
        return 0
    fi
    echo "✓ Assinaturas ($ZAPSIGN_ENVIRONMENT) configured"
}
