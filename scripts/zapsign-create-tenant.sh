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
[ -e "$token_file" ] && die "$token_file exists — refusing to overwrite a token ZapSign shows only once"

api="${ZAPSIGN_API_BASE:-$ZAPSIGN_PRODUCTION_API}"
payload="$(jq -cn --arg name "$company" --arg country "$SUBACCOUNT_COUNTRY" \
    --arg lang "$SUBACCOUNT_LANG" --arg color "$AVUZ_PRIMARY_COLOR" \
    '{company_name: $name, country: $country, lang: $lang, primary_color: $color}')"
response="$(mktemp)"
trap 'rm -f "$response"' EXIT

status="$(curl -sS -o "$response" -w '%{http_code}' -X POST "$api/partner/company/" \
    -H @<(printf 'Authorization: Bearer %s\n' "$ZAPSIGN_PARTNER_TOKEN") \
    -H 'Content-Type: application/json' --data "$payload")"
[[ "$status" == 2?? ]] || die "ZapSign answered HTTP $status (body withheld: it can carry account data)"

api_token="$(jq -r '.api_token // empty' "$response")"
subaccount_id="$(jq -r '.id // empty' "$response")"
[ -n "$api_token" ] || die "ZapSign's answer has no api_token — check the partner account in the ZapSign panel"
(umask 077; printf '%s\n' "$api_token" > "$token_file")

echo "✓ Sub-account $subaccount_id created for \"$company\". Token saved to $token_file (mode 600)."
echo "Next (docs/assinaturas-tenant-runbook.md):"
echo "  1. ZapSign panel → sub-account → Preferências: turn ON 'Bloquear assinatura fora da ordem definida'."
echo "  2. Same panel: set the sender text and Reply-To for this tenant."
echo "  3. Portainer stack: ZAPSIGN_API_TOKEN (from the file), ZAPSIGN_ENVIRONMENT=production, ZAPSIGN_COMPANY_NAME. Redeploy."
echo "  4. Delete $token_file."
