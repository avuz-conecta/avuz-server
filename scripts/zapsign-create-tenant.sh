#!/bin/bash
# Creates a ZapSign sub-account for one tenant (partner API) and saves its API
# token to a 0600 file. ZapSign shows the token ONCE: keep the file until the
# token is in the tenant's Portainer stack (ZAPSIGN_API_TOKEN), then delete it.
#
# Usage:
#   ZAPSIGN_PARTNER_TOKEN=... scripts/zapsign-create-tenant.sh "<company name>" <token-file>
# ZAPSIGN_API_BASE overrides the API base (default: production).
# Never prints the token or ZapSign's response body.
set -euo pipefail
set +x # a caller's `bash -x` must never print the tokens

ZAPSIGN_PRODUCTION_API="https://api.zapsign.com.br/api/v1"
SUBACCOUNT_COUNTRY="BR"
SUBACCOUNT_LANG="pt-br"
AVUZ_PRIMARY_COLOR="#2bb5e3"

die() { echo "error: $*" >&2; exit 1; }
command -v jq >/dev/null || die "jq is required"
company="${1:-}"
token_file="${2:-}"
[ -n "$company" ] && [ -n "$token_file" ] || die "usage: $0 \"<company name>\" <token-file>"
[ -n "${ZAPSIGN_PARTNER_TOKEN:-}" ] || die "ZAPSIGN_PARTNER_TOKEN is not set"

api="${ZAPSIGN_API_BASE:-$ZAPSIGN_PRODUCTION_API}"
LOCAL_MOCK_API='^http://(localhost|127\.0\.0\.1)(:[0-9]+)?(/|$)'
[[ "$api" != *@* ]] || die "ZAPSIGN_API_BASE must not contain userinfo (@): it can redirect the partner token to another host"
[[ "$api" == https://* || "$api" =~ $LOCAL_MOCK_API ]] \
    || die "ZAPSIGN_API_BASE must be https:// (or http://localhost for a mock): the partner token travels in it"

# ZapSign shows the sub-account token once, so prove we can store it BEFORE creating the sub-account.
# noclobber refuses existing files and dangling symlinks atomically.
token_file_created=0
token_written=0
response=""
cleanup() {
    [ -z "$response" ] || rm -f "$response"
    if [ "$token_file_created" = 1 ] && [ "$token_written" = 0 ]; then rm -f "$token_file"; fi
}
trap cleanup EXIT
(umask 077; set -o noclobber; : > "$token_file") 2>/dev/null \
    || die "cannot create $token_file (already exists, dangling symlink, or directory missing/unwritable) — nothing was sent to ZapSign"
token_file_created=1

payload="$(jq -cn --arg name "$company" --arg country "$SUBACCOUNT_COUNTRY" \
    --arg lang "$SUBACCOUNT_LANG" --arg color "$AVUZ_PRIMARY_COLOR" \
    '{company_name: $name, country: $country, lang: $lang, primary_color: $color}')"
response="$(mktemp)"

status="$(curl -q -sS -o "$response" -w '%{http_code}' -X POST "$api/partner/company/" \
    -H @<(printf 'Authorization: Bearer %s\n' "$ZAPSIGN_PARTNER_TOKEN") \
    -H 'Content-Type: application/json' --data "$payload")" \
    || die "could not reach ZapSign — a sub-account may have been created: check the ZapSign panel before retrying"
[[ "$status" == 2?? ]] || die "ZapSign answered HTTP $status (body withheld: it can carry account data)"

lost_token="sub-account may have been created, but its token was NOT saved — check the ZapSign panel"
api_token="$(jq -r '.api_token // empty' "$response" 2>/dev/null)" || die "ZapSign's answer is not valid JSON: $lost_token"
subaccount_id="$(jq -r '.id // empty' "$response" 2>/dev/null)" || die "ZapSign's answer is not valid JSON: $lost_token"
[ -n "$api_token" ] || die "ZapSign's answer has no api_token: $lost_token"
printf '%s\n' "$api_token" > "$token_file" || die "cannot write $token_file: $lost_token"
token_written=1

echo "✓ Sub-account $subaccount_id created for \"$company\". Token saved to $token_file (mode 600)."
echo "Next (docs/assinaturas-tenant-runbook.md):"
echo "  1. ZapSign panel → sub-account → Preferências: turn ON 'Bloquear assinatura fora da ordem definida'."
echo "  2. Same panel: set the sender text and Reply-To for this tenant."
echo "  3. Portainer stack: ZAPSIGN_API_TOKEN (from the file), ZAPSIGN_ENVIRONMENT=production, ZAPSIGN_COMPANY_NAME. Redeploy."
echo "  4. Delete $token_file."
