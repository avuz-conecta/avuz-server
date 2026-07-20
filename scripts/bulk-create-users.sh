#!/usr/bin/env bash
# Bulk-create Nextcloud users via the OCS Provisioning API.
#
# uid = full email, no password sent => Nextcloud generates a random password
# and emails the user a set-password link (the same "welcome email" the admin
# UI sends). Requires working SMTP on the target instance.
#
# Idempotent: re-running skips users that already exist (no duplicate, no second
# mail) and re-uses existing groups. Safe to append rows and re-run.
#
# Usage:
#   NC_URL=https://vidalar.avuz.app \
#   ADMIN_USER=admin \
#   ADMIN_PASS=<admin-app-password> \        # app-password, not the login password
#   ./scripts/bulk-create-users.sh users.csv
#
# CSV, one user per line (see scripts/users.csv.example):
#   email,Group Name[,Display Name]
#   alice@example.com,Marketing
#   bob@example.com,Vendas,Bob Silva        # 3rd column optional
#
# Lines starting with # and blank lines are ignored. A UTF-8 BOM and CRLF line
# endings (OnlyOffice / Excel exports) are tolerated.
set -euo pipefail

: "${NC_URL:?set NC_URL}"
: "${ADMIN_USER:?set ADMIN_USER}"
: "${ADMIN_PASS:?set ADMIN_PASS}"
CSV="${1:?usage: $0 users.csv}"

API="${NC_URL%/}/ocs/v1.php/cloud"   # v1 => statuscode 100 ok / 102 exists
AUTH=(-u "${ADMIN_USER}:${ADMIN_PASS}" -H "OCS-APIRequest: true")

ocs_status() { grep -oE '<statuscode>[0-9]+</statuscode>' | grep -oE '[0-9]+'; }

ensure_group() {
  local group="$1" out code
  out=$(curl -sS "${AUTH[@]}" -X POST "${API}/groups" \
        --data-urlencode "groupid=${group}")
  code=$(echo "$out" | ocs_status)
  [[ "$code" == "100" || "$code" == "102" ]] || {   # created / exists
    echo "  ! group '${group}' failed (code ${code})" >&2; return 1; }
}

create_user() {
  local email="$1" group="$2" name="${3:-}" out code
  local fields=(--data-urlencode "userid=${email}"
                --data-urlencode "email=${email}"
                --data-urlencode "groups[]=${group}")
  [[ -n "$name" ]] && fields+=(--data-urlencode "displayName=${name}")
  out=$(curl -sS "${AUTH[@]}" -X POST "${API}/users" "${fields[@]}")
  code=$(echo "$out" | ocs_status)
  case "$code" in
    100) echo "  ok   ${email}  (${group})  welcome-mail queued" ;;
    102) echo "  skip ${email}  already exists" ;;
    *)   echo "  FAIL ${email}  code=${code}" >&2
         echo "$out" | grep -oE '<message>[^<]*</message>' >&2 || true ;;
  esac
}

while IFS=',' read -r email group name || [[ -n "$email" ]]; do
  email="${email#$'\xef\xbb\xbf'}"          # strip UTF-8 BOM if editor added one
  email="$(echo "$email" | tr -d '\r' | xargs)"
  group="$(echo "$group" | tr -d '\r' | xargs)"
  name="$(echo "${name:-}" | tr -d '\r' | xargs)"
  [[ -z "$email" || "$email" == \#* ]] && continue
  ensure_group "$group"
  create_user "$email" "$group" "$name"
done < "$CSV"

echo "Done."
