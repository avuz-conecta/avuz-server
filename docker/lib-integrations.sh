#!/bin/bash
# Integration config from the stack env (Conecta Mail, Talk recording, AI
# provider, SMTP, OnlyOffice). Sourced by docker/entrypoint.sh after
# lib-apps.sh, and by docker/tests/integrations.test.sh. No side effects on source.
#
# Secrets go through avuz_set_config_from_env by env var NAME, never as an occ
# --value: admin_audit logs the full argv of every occ command to audit.log.
# An unset secret is exported empty first, so the value written matches what
# `occ ... --value="$UNSET"` wrote before.

_avuz_export_empty_if_unset() {
    local name
    for name in "$@"; do
        export "$name=${!name-}"
    done
}

avuz_configure_conectamail() {
    _avuz_export_empty_if_unset ROUNDCUBE_SSO_SECRET ROUNDCUBE_CREDENTIAL_KEY
    # retire the pre-rename app entry (no-op once cleared)
    _avuz_occ app:disable roundcube 2>/dev/null || true
    _avuz_occ app:enable conectamail 2>/dev/null || true
    _avuz_occ config:app:set conectamail roundcube_url --value="$ROUNDCUBE_URL"
    avuz_set_sensitive_app_config conectamail sso_secret ROUNDCUBE_SSO_SECRET
    avuz_set_sensitive_app_config conectamail credential_key ROUNDCUBE_CREDENTIAL_KEY
}

# Stored as JSON in spreed:recording_servers (see Config::getRecordingServers()).
# Built from the env inside php (no jq in the image), so the secret stays off argv.
# Plain, not sensitive: spreed reads it through IConfig::getAppValue.
avuz_configure_talk_recording() {
    TALK_RECORDING_VERIFY="${TALK_RECORDING_VERIFY:-true}"
    export TALK_RECORDING_URL TALK_RECORDING_VERIFY TALK_RECORDING_SECRET
    AVUZ_TALK_RECORDING_SERVERS="$(php -r '
        echo json_encode([
            "servers" => [[
                "server" => getenv("TALK_RECORDING_URL"),
                "verify" => filter_var(getenv("TALK_RECORDING_VERIFY"), FILTER_VALIDATE_BOOLEAN),
            ]],
            "secret" => getenv("TALK_RECORDING_SECRET"),
        ]);
    ')"
    export AVUZ_TALK_RECORDING_SERVERS
    local rc=0
    avuz_set_config_from_env spreed recording_servers AVUZ_TALK_RECORDING_SERVERS || rc=$?
    unset AVUZ_TALK_RECORDING_SERVERS
    [ "$rc" -eq 0 ] || return "$rc"
    _avuz_occ config:app:set spreed call_recording --value="yes"
}

# integration_openai ships as a version-pinned fork submodule (apps/), not from
# the App Store (see .gitmodules). Enabled here so it's on before the config
# writes below; it is also enabled via the BUNDLED_APPS loops (keep both).
# Pilot defaults: LLM via OpenRouter (Anthropic Claude Haiku) + STT via
# Fireworks AI (whisper-large-v3). Override any AI_*/AI_STT_* env to swap.
# The keys are stored sensitive, as the app's own admin form stores them.
avuz_configure_ai_provider() {
    _avuz_occ app:enable --force integration_openai 2>/dev/null || true

    AI_BASE_URL="${AI_BASE_URL:-https://openrouter.ai/api/v1}"
    AI_LLM_MODEL="${AI_LLM_MODEL:-anthropic/claude-haiku-4-5}"
    AI_STT_BASE_URL="${AI_STT_BASE_URL:-https://api.fireworks.ai/inference/v1}"
    AI_STT_MODEL="${AI_STT_MODEL:-whisper-v3}"
    AI_STT_LANGUAGE="${AI_STT_LANGUAGE:-pt}"
    local stt_key_variable="AI_STT_API_KEY"
    [ -n "${AI_STT_API_KEY:-}" ] || stt_key_variable="AI_API_KEY"
    export AI_API_KEY

    # Text/chat completions (used by core:text2text:summary etc.)
    _avuz_occ config:app:set integration_openai url --value="$AI_BASE_URL"
    avuz_set_sensitive_app_config integration_openai api_key AI_API_KEY
    _avuz_occ config:app:set integration_openai default_completion_model_id --value="$AI_LLM_MODEL"
    _avuz_occ config:app:set integration_openai chat_endpoint_enabled --value="1"
    _avuz_occ config:app:set integration_openai llm_provider_enabled --value="1"

    # Speech-to-text (used by core:audio2text). Independent provider; its key
    # falls back to AI_API_KEY when AI_STT_API_KEY is unset.
    _avuz_occ config:app:set integration_openai stt_url --value="$AI_STT_BASE_URL"
    avuz_set_sensitive_app_config integration_openai stt_api_key "$stt_key_variable"
    _avuz_occ config:app:set integration_openai default_stt_model_id --value="$AI_STT_MODEL"
    _avuz_occ config:app:set integration_openai stt_provider_enabled --value="1"
    _avuz_occ config:app:set integration_openai stt_language --value="$AI_STT_LANGUAGE"

    # Re-enable Talk AI summary now that LLM is wired up.
    _avuz_occ config:app:set spreed call_recording_summary --value="yes"
}

# integration_openai registers its text-to-text provider while llm_provider_enabled
# is 1 (its default), key or not. Without a key every task fails, and apps that
# offer AI features only when a provider exists (Assinaturas: "Ler contratos com
# IA") would show them. So the provider is on only with a key: from the env, or
# one an admin stored by hand. The key is read through stdout, never argv.
avuz_sync_llm_provider_switch() {
    local stored_key
    stored_key="$(_avuz_occ config:app:get integration_openai api_key 2>/dev/null || true)"
    if [ -n "${AI_API_KEY:-}" ] || [ -n "$stored_key" ]; then
        _avuz_occ config:app:set integration_openai llm_provider_enabled --value="1"
        return 0
    fi
    _avuz_occ config:app:set integration_openai llm_provider_enabled --value="0"
}

avuz_configure_smtp() {
    _avuz_export_empty_if_unset SMTP_PASSWORD
    _avuz_occ config:system:set mail_smtpmode --value='smtp'
    _avuz_occ config:system:set mail_smtphost --value="$SMTP_HOST"
    _avuz_occ config:system:set mail_smtpport --value="$SMTP_PORT" --type=integer
    _avuz_occ config:system:set mail_smtpsecure --value="$SMTP_SECURE"
    _avuz_occ config:system:set mail_smtpauth --value=1 --type=integer
    _avuz_occ config:system:set mail_smtpauthtype --value="$SMTP_AUTHTYPE"
    _avuz_occ config:system:set mail_smtpname --value="$SMTP_NAME"
    avuz_set_config_from_env --system mail_smtppassword SMTP_PASSWORD
    _avuz_occ config:system:set mail_from_address --value="$SMTP_FROM"
    _avuz_occ config:system:set mail_domain --value="$SMTP_DOMAIN"
}

# jwt_secret stays plain and keeps its stored type: the onlyoffice app reads
# and writes it through IConfig (mixed), see AppConfigTypeConflictException.
avuz_configure_onlyoffice() {
    export ONLYOFFICE_SECRET
    _avuz_occ config:app:set onlyoffice DocumentServerUrl --value="$ONLYOFFICE_URL"
    avuz_set_config_from_env onlyoffice jwt_secret ONLYOFFICE_SECRET
    _avuz_occ config:app:set onlyoffice jwt_header --value="Authorization"
    _avuz_occ config:app:set onlyoffice defFormats --value='{"csv":"true","doc":"true","docm":"true","docx":"true","docxf":"true","dot":"true","dotm":"true","dotx":"true","epub":"true","fb2":"true","fodp":"true","fods":"true","fodt":"true","htm":"true","html":"true","hwp":"true","hwpx":"true","key":"true","md":"true","mht":"true","mhtml":"true","numbers":"true","odg":"true","odp":"true","ods":"true","odt":"true","otp":"true","ots":"true","ott":"true","oxps":"true","pages":"true","pdf":"true","pot":"true","potm":"true","potx":"true","pps":"true","ppsm":"true","ppsx":"true","ppt":"true","pptm":"true","pptx":"true","rtf":"true","stw":"true","sxc":"true","sxi":"true","sxw":"true","txt":"true","vsdm":"true","vssm":"true","vssx":"true","vstm":"true","vstx":"true","wps":"true","xls":"true","xlsb":"true","xlsm":"true","xlsx":"true","xlt":"true","xltm":"true","xltx":"true","xml":"true","xps":"true","djvu":"true"}'
    _avuz_occ config:app:set onlyoffice editFormats --value='{"csv":"true","odp":"true","ods":"true","odt":"true","rtf":"true","txt":"true","doc":"true","docm":"true","docx":"true","docxf":"true","dotx":"true","epub":"true","fb2":"true","html":"true","otp":"true","ots":"true","ott":"true","potm":"true","potx":"true","ppsm":"true","ppsx":"true","ppt":"true","pptm":"true","pptx":"true","xls":"true","xlsm":"true","xlsx":"true","xltm":"true","xltx":"true","htm":"true","fodt":"true","fods":"true","fodp":"true"}'
}
