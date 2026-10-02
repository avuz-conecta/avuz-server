#!/bin/bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/../zapsign-create-tenant.sh"
fail=0
assert_eq() {
    local desc="$1" expected="$2" actual="$3"
    if [ "$expected" = "$actual" ]; then echo "ok - $desc"; else
        echo "NOT OK - $desc"; echo "  expected: [$expected]"; echo "  actual:   [$actual]"; fail=1; fi
}

WORK="$(mktemp -d)"
mkdir -p "$WORK/bin"
cat > "$WORK/bin/curl" <<'FAKE'
#!/bin/bash
out=""
while [ $# -gt 0 ]; do
    printf '%s\n' "$1" >> "$CURL_ARGS_LOG"
    [ "$1" = "-o" ] && out="$2"
    shift
done
printf '%s' "$FAKE_BODY" > "$out"
printf '%s' "$FAKE_STATUS"
FAKE
chmod +x "$WORK/bin/curl"
export PATH="$WORK/bin:$PATH" CURL_ARGS_LOG="$WORK/curl-args" ZAPSIGN_PARTNER_TOKEN="partner-test-token"

run() { bash "$SCRIPT" "$@" 2>&1; }

export FAKE_STATUS=200 FAKE_BODY='{"id":4242,"name":"Construtora Teste","api_token":"sub-test-token"}'
out="$(run "Construtora Teste" "$WORK/tenant.token")"
assert_eq "saves the sub-account token" "sub-test-token" "$(cat "$WORK/tenant.token")"
assert_eq "restricts the token file to its owner" "600" "$(stat -f '%Lp' "$WORK/tenant.token" 2>/dev/null || stat -c '%a' "$WORK/tenant.token")"
assert_eq "reports the sub-account id" "1" "$(grep -c 'Sub-account 4242 created for "Construtora Teste"' <<< "$out")"
assert_eq "never prints the token" "0" "$(grep -c 'sub-test-token' <<< "$out" || true)"
assert_eq "posts the company name" "1" "$(grep -c '"company_name":"Construtora Teste"' "$CURL_ARGS_LOG")"
assert_eq "keeps the partner token off the command line" "0" "$(grep -c 'partner-test-token' "$CURL_ARGS_LOG" || true)"

if run "Construtora Teste" "$WORK/tenant.token" >/dev/null; then rc=0; else rc=1; fi
assert_eq "refuses to overwrite an existing token file" "1" "$rc"

export FAKE_STATUS=401 FAKE_BODY='{"detail":"secret account data"}'
if out="$(run "Outra" "$WORK/other.token")"; then rc=0; else rc=1; fi
assert_eq "fails on an HTTP error" "1" "$rc"
assert_eq "withholds the error body" "0" "$(grep -c 'secret account data' <<< "$out" || true)"
assert_eq "leaves no token file after an error" "no" "$([ -e "$WORK/other.token" ] && echo yes || echo no)"

export FAKE_STATUS=200 FAKE_BODY='{"id":1}'
if run "Sem token" "$WORK/none.token" >/dev/null; then rc=0; else rc=1; fi
assert_eq "fails when the response has no api_token" "1" "$rc"

unset ZAPSIGN_PARTNER_TOKEN
if run "Acme" "$WORK/acme.token" >/dev/null; then rc=0; else rc=1; fi
assert_eq "requires the partner token" "1" "$rc"

rm -rf "$WORK"
exit "$fail"
