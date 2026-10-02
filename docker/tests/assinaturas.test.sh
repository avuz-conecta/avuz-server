#!/bin/bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
source "$HERE/../lib-apps.sh"
source "$HERE/../lib-assinaturas.sh"

fail=0
assert_eq() {
    local desc="$1" expected="$2" actual="$3"
    if [ "$expected" = "$actual" ]; then
        echo "ok - $desc"
    else
        echo "NOT OK - $desc"; echo "  expected: [$expected]"; echo "  actual:   [$actual]"; fail=1
    fi
}
assert_has() {
    local desc="$1" needle="$2" haystack="$3"
    if printf '%s\n' "$haystack" | grep -qxF -- "$needle"; then echo "ok - $desc"; else
        echo "NOT OK - $desc"; echo "  missing line: [$needle]"; echo "  in: [$haystack]"; fail=1; fi
}
assert_lacks() {
    local desc="$1" needle="$2" haystack="$3"
    if printf '%s\n' "$haystack" | grep -qF -- "$needle"; then
        echo "NOT OK - $desc"; echo "  unexpected: [$needle]"; fail=1; else echo "ok - $desc"; fi
}

OCC_LOG="$(mktemp)"
CONFIG_VALUES_LOG="$(mktemp)"
FAKE_APP_DIR="$(mktemp -d)"
mkdir -p "$FAKE_APP_DIR/appinfo"
printf '<info>\n    <version>0.4.0</version>\n</info>\n' > "$FAKE_APP_DIR/appinfo/info.xml"
TEST_TOKEN="test-token-value"

_avuz_occ() {
    printf '%s\n' "$*" >> "$OCC_LOG"
    case "$*" in
        "config:app:get assinaturas enabled") echo "$FAKE_ENABLED" ;;
        "config:app:get assinaturas installed_version") echo "$FAKE_INSTALLED" ;;
        "app:getpath assinaturas") echo "$FAKE_APP_DIR" ;;
        "app:enable --force assinaturas")
            [ "$FAKE_ENABLE_FAILS" = "yes" ] && return 1
            FAKE_ENABLED="yes"; FAKE_INSTALLED="0.4.0" ;;
        "assinaturas:webhook:ensure") [ "$FAKE_ENSURE_FAILS" = "yes" ] && return 1 ;;
    esac
    return 0
}

_avuz_occ_bounded() {
    ENSURE_TIMEOUT_SECONDS="$1"; shift
    _avuz_occ "$@"
}

# Logs the command line, and separately the value PHP would read from the env.
_avuz_php_config() {
    printf 'php-config %s\n' "$*" >> "$OCC_LOG"
    printf '%s=%s\n' "$2" "${!3:-}" >> "$CONFIG_VALUES_LOG"
    if [ "$FAKE_SET_FAILS" = "yes" ] && [ "$2" = "environment" ]; then echo "failed: RuntimeException"; return 1; fi
    echo "set"
}

reset_fakes() {
    : > "$OCC_LOG"; : > "$CONFIG_VALUES_LOG"
    FAKE_ENABLED="no"; FAKE_INSTALLED=""; ENSURE_TIMEOUT_SECONDS=""
    FAKE_ENABLE_FAILS="no"; FAKE_ENSURE_FAILS="no"; FAKE_SET_FAILS="no"
    unset ZAPSIGN_API_TOKEN ZAPSIGN_ENVIRONMENT ZAPSIGN_COMPANY_NAME ZAPSIGN_WEBHOOK_SECRET
}
configure_env() {
    export ZAPSIGN_API_TOKEN="$TEST_TOKEN" ZAPSIGN_ENVIRONMENT="sandbox" ZAPSIGN_COMPANY_NAME="Construtora Teste"
}
writes() { grep -v '^config:app:get\|^app:getpath' "$OCC_LOG" || true; }
# Runs the sync in THIS shell (a $(...) subshell would lose AVUZ_ASSINATURAS_CHANGED).
SYNC_OUT="$(mktemp)"
sync_now() { avuz_assinaturas_sync > "$SYNC_OUT"; }
synced() { cat "$SYNC_OUT"; }

# ── avuz_assinaturas_env_problem ──
assert_eq "reports a missing token" "no ZAPSIGN_API_TOKEN" "$(avuz_assinaturas_env_problem "" sandbox Acme)"
assert_eq "reports an unknown environment" "ZAPSIGN_ENVIRONMENT must be sandbox or production (got 'staging')" \
    "$(avuz_assinaturas_env_problem tok staging Acme)"
assert_eq "reports an empty environment" "ZAPSIGN_ENVIRONMENT must be sandbox or production (got '')" \
    "$(avuz_assinaturas_env_problem tok "" Acme)"
assert_eq "reports a missing company" "no ZAPSIGN_COMPANY_NAME" "$(avuz_assinaturas_env_problem tok production "")"
assert_eq "accepts a complete env" "" "$(avuz_assinaturas_env_problem tok production Acme)"
assert_eq "rejects two environments in one value" \
    "ZAPSIGN_ENVIRONMENT must be sandbox or production (got 'sandbox production')" \
    "$(avuz_assinaturas_env_problem tok "sandbox production" Acme)"

# ── unconfigured ──
reset_fakes
sync_now
assert_eq "leaves a disabled app alone without a token" "" "$(writes)"
assert_eq "reports no change when nothing was enabled" "0" "$AVUZ_ASSINATURAS_CHANGED"
assert_has "says why the app is off" "– Assinaturas off: no ZAPSIGN_API_TOKEN" "$(synced)"

reset_fakes; FAKE_ENABLED="yes"
sync_now
assert_eq "disables an enabled app when the token is removed" "app:disable assinaturas" "$(writes)"
assert_eq "flags the disable as a change" "1" "$AVUZ_ASSINATURAS_CHANGED"

reset_fakes; FAKE_ENABLED="yes"; configure_env; export ZAPSIGN_ENVIRONMENT="prod"
sync_now
assert_eq "disables the app on an invalid environment" "app:disable assinaturas" "$(writes)"

# ── configured, first boot ──
reset_fakes; configure_env
sync_now
assert_eq "enables, configures and registers webhooks in order" \
"app:enable --force assinaturas
php-config assinaturas api_token ZAPSIGN_API_TOKEN --sensitive
php-config assinaturas environment ZAPSIGN_ENVIRONMENT
php-config assinaturas company_name ZAPSIGN_COMPANY_NAME
assinaturas:webhook:ensure" "$(writes)"
assert_eq "hands each value to PHP through the env" "api_token=$TEST_TOKEN
environment=sandbox
company_name=Construtora Teste" "$(cat "$CONFIG_VALUES_LOG")"
assert_eq "flags the enable as a change" "1" "$AVUZ_ASSINATURAS_CHANGED"
assert_has "confirms the configuration" "✓ Assinaturas (sandbox) configured" "$(synced)"
assert_lacks "never prints the token" "$TEST_TOKEN" "$(synced)"
assert_lacks "keeps per-key outcomes out of a successful boot log" "set" "$(synced)"
assert_eq "bounds webhook:ensure to 60 seconds" "60" "$ENSURE_TIMEOUT_SECONDS"

# ── whitespace around env values ──
reset_fakes; configure_env; export ZAPSIGN_ENVIRONMENT="production " ZAPSIGN_API_TOKEN=" $TEST_TOKEN" ZAPSIGN_COMPANY_NAME=" Construtora Teste "
sync_now
assert_has "accepts an environment with trailing whitespace" "✓ Assinaturas (production) configured" "$(synced)"
assert_eq "stores the trimmed values" "api_token=$TEST_TOKEN
environment=production
company_name=Construtora Teste" "$(cat "$CONFIG_VALUES_LOG")"

reset_fakes; configure_env; FAKE_ENABLED="yes"; export ZAPSIGN_ENVIRONMENT="sandbox production"
sync_now
assert_eq "disables the app on two environments in one value" "app:disable assinaturas" "$(writes)"

# ── configured, steady state ──
reset_fakes; configure_env; FAKE_ENABLED="yes"; FAKE_INSTALLED="0.4.0"
sync_now
assert_lacks "skips app:enable when already enabled" "app:enable" "$(writes)"
assert_eq "reports no change on a steady boot" "0" "$AVUZ_ASSINATURAS_CHANGED"

# ── group-restricted app (enabled holds a JSON group list) ──
reset_fakes; configure_env; FAKE_ENABLED='["financeiro"]'; FAKE_INSTALLED="0.4.0"
sync_now
assert_lacks "it keeps a group-restricted app as the admin set it" "app:enable" "$(writes)"
assert_eq "reports no change on a steady group-restricted boot" "0" "$AVUZ_ASSINATURAS_CHANGED"

reset_fakes; FAKE_ENABLED='["financeiro"]'
sync_now
assert_eq "it disables a group-restricted app when the token is removed" "app:disable assinaturas" "$(writes)"
assert_eq "flags the group-restricted disable as a change" "1" "$AVUZ_ASSINATURAS_CHANGED"

# ── configured, new app version in the image ──
reset_fakes; configure_env; FAKE_ENABLED="yes"; FAKE_INSTALLED="0.3.44"
sync_now
assert_has "re-enables to run the app upgrade" "app:disable assinaturas" "$(writes)"
assert_eq "flags the upgrade as a change" "1" "$AVUZ_ASSINATURAS_CHANGED"

# ── webhook secret from env ──
reset_fakes; configure_env; FAKE_ENABLED="yes"; FAKE_INSTALLED="0.4.0"; export ZAPSIGN_WEBHOOK_SECRET="env-secret"
sync_now
assert_has "stores an env webhook secret as sensitive" \
    "php-config assinaturas webhook_secret ZAPSIGN_WEBHOOK_SECRET --sensitive" "$(writes)"
reset_fakes; configure_env; FAKE_ENABLED="yes"; FAKE_INSTALLED="0.4.0"
sync_now
assert_lacks "keeps the generated secret when the env has none" "webhook_secret" "$(writes)"
reset_fakes; configure_env; FAKE_ENABLED="yes"; FAKE_INSTALLED="0.4.0"; export ZAPSIGN_WEBHOOK_SECRET="env-secret "
sync_now
assert_has "stores the webhook secret trimmed" "webhook_secret=env-secret" "$(cat "$CONFIG_VALUES_LOG")"
reset_fakes; configure_env; FAKE_ENABLED="yes"; FAKE_INSTALLED="0.4.0"; export ZAPSIGN_WEBHOOK_SECRET="  "
sync_now
assert_lacks "treats a whitespace-only webhook secret as none" "webhook_secret" "$(writes)"

# ── secrets stay off argv (admin_audit logs every occ command line) ──
reset_fakes; configure_env; export ZAPSIGN_WEBHOOK_SECRET="env-secret"
sync_now
assert_lacks "it never passes a secret on any command line" "$TEST_TOKEN" "$(cat "$OCC_LOG")"
assert_lacks "it never passes the webhook secret on any command line" "env-secret" "$(cat "$OCC_LOG")"

# ── failures ──
reset_fakes; configure_env; FAKE_ENABLE_FAILS="yes"
sync_now
assert_eq "stops after a failed enable" "app:enable --force assinaturas" "$(writes)"
assert_has "reports the failed enable" "✗ Assinaturas: app:enable failed (is apps/assinaturas in the image?)" "$(synced)"

reset_fakes; configure_env; FAKE_ENABLED="yes"; FAKE_INSTALLED="0.4.0"; FAKE_SET_FAILS="yes"
if sync_now; then rc=0; else rc=1; fi
assert_eq "never fails the boot on a config write error" "0" "$rc"
assert_lacks "skips webhooks after a config write error" "assinaturas:webhook:ensure" "$(writes)"
assert_has "reports the config write failure" \
    "✗ Assinaturas: could not write the app config — webhooks left as they were" "$(synced)"
assert_has "names the key that failed and why" "  environment: failed: RuntimeException" "$(synced)"

reset_fakes; configure_env; FAKE_ENABLED="yes"; FAKE_INSTALLED="0.4.0"; FAKE_ENSURE_FAILS="yes"
if sync_now; then rc=0; else rc=1; fi
assert_eq "never fails the boot on a webhook error" "0" "$rc"
assert_has "reports the webhook failure" \
    "✗ Assinaturas: webhook:ensure failed — see the Nextcloud log; EnsureWebhooksJob retries daily while the app is enabled" "$(synced)"

rm -rf "$OCC_LOG" "$CONFIG_VALUES_LOG" "$FAKE_APP_DIR" "$SYNC_OUT"
exit "$fail"
