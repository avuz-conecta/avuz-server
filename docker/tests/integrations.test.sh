#!/bin/bash
# Runs the integration config functions against stubbed occ/php/config writers
# and checks that no command line carries a secret: admin_audit logs the full
# argv of every occ command to audit.log.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
source "$HERE/../lib-apps.sh"
source "$HERE/../lib-integrations.sh"

fail=0
assert_eq() {
    local desc="$1" expected="$2" actual="$3"
    if [ "$expected" = "$actual" ]; then
        echo "ok - $desc"
    else
        echo "NOT OK - $desc"; echo "  expected: [$expected]"; echo "  actual:   [$actual]"; fail=1
    fi
}
assert_contains() {
    local desc="$1" needle="$2" haystack="$3"
    if printf '%s\n' "$haystack" | grep -qxF -- "$needle"; then
        echo "ok - $desc"; else echo "NOT OK - $desc"; echo "  missing: [$needle]"; fail=1; fi
}
# Names the leaked variable only: a failing test must not print the secret either.
assert_no_secret_in_argv() {
    local desc="$1" name leaked=""
    for name in $SECRET_VARIABLES; do
        if grep -qF -- "${!name}" "$ARGV_LOG"; then leaked="$leaked $name"; fi
    done
    if [ -z "$leaked" ]; then echo "ok - $desc"; else echo "NOT OK - $desc"; echo "  leaked:$leaked"; fail=1; fi
}

ARGV_LOG="$(mktemp)"
CONFIG_VALUES="$(mktemp)"
_avuz_occ() { printf 'occ %s\n' "$*" >> "$ARGV_LOG"; }
# Records the argv, plus the value the real writer would read from the named env var.
_avuz_php_config() {
    printf 'phpcfg %s\n' "$*" >> "$ARGV_LOG"
    local positional=() argument
    for argument in "$@"; do
        case "$argument" in --*) ;; *) positional+=("$argument") ;; esac
    done
    local variable="${positional[${#positional[@]}-1]}"
    printf '%s=%s\n' "${positional[${#positional[@]}-2]}" "$(printenv "$variable" || echo UNSET)" >> "$CONFIG_VALUES"
}
if command -v php >/dev/null 2>&1; then
    php() { printf 'php %s\n' "$*" >> "$ARGV_LOG"; command php "$@"; }
fi
stored() { grep "^$1=" "$CONFIG_VALUES" | tail -1 | cut -d= -f2-; }

export ROUNDCUBE_URL="https://mail.example.test"
export ROUNDCUBE_SSO_SECRET="sso-secret-7f3a"
export ROUNDCUBE_CREDENTIAL_KEY="credential-key-91bc"
export TALK_RECORDING_URL="https://recording.example.test"
export TALK_RECORDING_SECRET="recording-secret-c0de"
export AI_API_KEY="ai-key-5e5e"
export AI_STT_API_KEY="stt-key-a11a"
export SMTP_HOST="smtp.example.test" SMTP_PORT=587 SMTP_SECURE=tls SMTP_AUTHTYPE=LOGIN
export SMTP_NAME="mailer" SMTP_FROM="noreply" SMTP_DOMAIN="example.test"
export SMTP_PASSWORD="smtp-password-d00d"
export ONLYOFFICE_URL="https://office.example.test"
export ONLYOFFICE_SECRET="onlyoffice-secret-beef"
SECRET_VARIABLES="ROUNDCUBE_SSO_SECRET ROUNDCUBE_CREDENTIAL_KEY TALK_RECORDING_SECRET AI_API_KEY AI_STT_API_KEY SMTP_PASSWORD ONLYOFFICE_SECRET"

avuz_configure_conectamail >/dev/null
avuz_configure_talk_recording >/dev/null
avuz_configure_ai_provider >/dev/null
avuz_configure_smtp >/dev/null
avuz_configure_onlyoffice >/dev/null
calls="$(cat "$ARGV_LOG")"

describe() { echo "# $1"; }

describe "secrets on argv"
assert_no_secret_in_argv "no occ, php or config call carries a secret on its command line"

describe "Conecta Mail"
assert_contains "it stores the SSO secret sensitive, by variable name" \
    "phpcfg conectamail sso_secret ROUNDCUBE_SSO_SECRET --sensitive" "$calls"
assert_contains "it stores the credential key sensitive, by variable name" \
    "phpcfg conectamail credential_key ROUNDCUBE_CREDENTIAL_KEY --sensitive" "$calls"
assert_eq "hands the SSO secret to the writer through the env" "$ROUNDCUBE_SSO_SECRET" "$(stored sso_secret)"

describe "AI provider"
assert_contains "it stores the API key sensitive, by variable name" \
    "phpcfg integration_openai api_key AI_API_KEY --sensitive" "$calls"
assert_contains "it stores the STT key sensitive, by variable name" \
    "phpcfg integration_openai stt_api_key AI_STT_API_KEY --sensitive" "$calls"

describe "SMTP"
assert_contains "it stores the SMTP password in system config, by variable name" \
    "phpcfg --system mail_smtppassword SMTP_PASSWORD" "$calls"
assert_eq "hands the SMTP password to the writer through the env" "$SMTP_PASSWORD" "$(stored mail_smtppassword)"

describe "OnlyOffice"
assert_contains "it stores the JWT secret plain, keeping its stored type" \
    "phpcfg onlyoffice jwt_secret ONLYOFFICE_SECRET" "$calls"

describe "Talk recording"
assert_contains "it stores the recording servers by variable name" \
    "phpcfg spreed recording_servers AVUZ_TALK_RECORDING_SERVERS" "$calls"
if command -v php >/dev/null 2>&1; then
    assert_eq "builds the recording servers JSON from the env" \
        '{"servers":[{"server":"https:\/\/recording.example.test","verify":true}],"secret":"recording-secret-c0de"}' \
        "$(stored recording_servers)"
else
    echo "ok - # SKIP no php CLI to build the recording servers JSON"
fi
assert_eq "drops the recording servers JSON from the env after the write" "unset" \
    "${AVUZ_TALK_RECORDING_SERVERS-unset}"
assert_contains "it turns call recording on" "occ config:app:set spreed call_recording --value=yes" "$calls"

describe "fallbacks"
: > "$ARGV_LOG"
unset AI_STT_API_KEY
avuz_configure_ai_provider >/dev/null
assert_contains "it falls back to the AI key for STT when no STT key is set" \
    "phpcfg integration_openai stt_api_key AI_API_KEY --sensitive" "$(cat "$ARGV_LOG")"

unset SMTP_PASSWORD ROUNDCUBE_CREDENTIAL_KEY
avuz_configure_smtp >/dev/null
avuz_configure_conectamail >/dev/null
assert_eq "writes an empty SMTP password when none is set, as occ did" "" "$(stored mail_smtppassword)"
assert_eq "writes an empty credential key when none is set, as occ did" "" "$(stored credential_key)"

describe "failure"
_avuz_php_config() { return 1; }
if (set -e; avuz_configure_talk_recording >/dev/null); then talk_rc=0; else talk_rc=$?; fi
assert_eq "returns non-zero when the recording servers write fails" "1" "$talk_rc"

rm -f "$ARGV_LOG" "$CONFIG_VALUES"
exit "$fail"
