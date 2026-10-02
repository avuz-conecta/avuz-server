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
    case "$1" in @*) cat "${1#@}" >> "$CURL_HEADERS_LOG" ;; esac
    [ "$1" = "-o" ] && out="$2"
    shift
done
[ -z "${FAKE_EXIT:-}" ] || exit "$FAKE_EXIT"
printf '%s' "$FAKE_BODY" > "$out"
printf '%s' "$FAKE_STATUS"
FAKE
chmod +x "$WORK/bin/curl"
export PATH="$WORK/bin:$PATH" CURL_ARGS_LOG="$WORK/curl-args" CURL_HEADERS_LOG="$WORK/curl-headers" ZAPSIGN_PARTNER_TOKEN="partner-test-token"

run() { bash "$SCRIPT" "$@" 2>&1; }

export FAKE_STATUS=200 FAKE_BODY='{"id":4242,"name":"Construtora Teste","api_token":"sub-test-token"}'
out="$(run "Construtora Teste" "$WORK/tenant.token")"
assert_eq "saves the sub-account token" "sub-test-token" "$(cat "$WORK/tenant.token")"
assert_eq "restricts the token file to its owner" "600" "$(stat -f '%Lp' "$WORK/tenant.token" 2>/dev/null || stat -c '%a' "$WORK/tenant.token")"
assert_eq "reports the sub-account id" "1" "$(grep -c 'Sub-account 4242 created for "Construtora Teste"' <<< "$out")"
assert_eq "never prints the token" "0" "$(grep -c 'sub-test-token' <<< "$out" || true)"
assert_eq "posts the company name" "1" "$(grep -c '"company_name":"Construtora Teste"' "$CURL_ARGS_LOG")"
assert_eq "keeps the partner token off the command line" "0" "$(grep -c 'partner-test-token' "$CURL_ARGS_LOG" || true)"
assert_eq "delivers the partner token as a bearer header" "1" "$(grep -c '^Authorization: Bearer partner-test-token$' "$CURL_HEADERS_LOG")"
assert_eq "ignores ~/.curlrc" "-q" "$(head -1 "$CURL_ARGS_LOG")"

if run "Construtora Teste" "$WORK/tenant.token" >/dev/null; then rc=0; else rc=1; fi
assert_eq "refuses to overwrite an existing token file" "1" "$rc"

# Failures before the API call must never reach ZapSign: the token is shown once.
rm -f "$CURL_ARGS_LOG"
if out="$(run "Sem pasta" "$WORK/missing-dir/x.token")"; then rc=0; else rc=1; fi
assert_eq "refuses a token file it cannot create" "1" "$rc"
assert_eq "makes no API call when the token file cannot be created" "no" "$([ -e "$CURL_ARGS_LOG" ] && echo yes || echo no)"
mkdir "$WORK/readonly" && chmod 500 "$WORK/readonly"
if [ -w "$WORK/readonly" ]; then echo "ok - refuses an unwritable directory (skipped: running as root)"; else
    if run "Somente leitura" "$WORK/readonly/x.token" >/dev/null; then rc=0; else rc=1; fi
    assert_eq "refuses an unwritable directory" "1" "$rc"
    assert_eq "makes no API call for an unwritable directory" "no" "$([ -e "$CURL_ARGS_LOG" ] && echo yes || echo no)"
fi
chmod 700 "$WORK/readonly"
ln -s "$WORK/nowhere" "$WORK/dangling.token"
if run "Link" "$WORK/dangling.token" >/dev/null; then rc=0; else rc=1; fi
assert_eq "refuses a dangling symlink as the token file" "1" "$rc"
assert_eq "does not write through the dangling symlink" "no" "$([ -e "$WORK/nowhere" ] && echo yes || echo no)"
assert_eq "makes no API call for a dangling symlink" "no" "$([ -e "$CURL_ARGS_LOG" ] && echo yes || echo no)"
if ZAPSIGN_API_BASE="http://example.com/api" run "Http" "$WORK/http.token" >/dev/null; then rc=0; else rc=1; fi
assert_eq "refuses a plain-http API base" "1" "$rc"
assert_eq "makes no API call to a plain-http API base" "no" "$([ -e "$CURL_ARGS_LOG" ] && echo yes || echo no)"
for userinfo_base in "http://localhost:80@evil.example/x" "https://user@evil.example/x" "http://localhost.evil.example/x"; do
    rm -f "$CURL_ARGS_LOG" "$WORK/userinfo.token"
    if ZAPSIGN_API_BASE="$userinfo_base" run "Userinfo" "$WORK/userinfo.token" >/dev/null; then rc=0; else rc=1; fi
    assert_eq "refuses a base URL with userinfo or a lookalike host ($userinfo_base)" "1" "$rc"
    assert_eq "makes no API call for $userinfo_base" "no" "$([ -e "$CURL_ARGS_LOG" ] && echo yes || echo no)"
    assert_eq "leaves no token file for $userinfo_base" "no" "$([ -e "$WORK/userinfo.token" ] && echo yes || echo no)"
done
out="$(ZAPSIGN_API_BASE="http://localhost:8080/api" run "Mock" "$WORK/mock.token")"
assert_eq "accepts a localhost mock API base" "1" "$(grep -c 'Sub-account 4242 created' <<< "$out")"

export FAKE_STATUS=200 FAKE_BODY='<html>gateway</html>'
if out="$(run "Html" "$WORK/html.token")"; then rc=0; else rc=1; fi
assert_eq "fails when the answer is not JSON" "1" "$rc"
assert_eq "warns that the sub-account may exist" "1" "$(grep -c 'may have been created, but its token was NOT saved' <<< "$out")"
assert_eq "leaves no empty token file when the answer is not JSON" "no" "$([ -e "$WORK/html.token" ] && echo yes || echo no)"

export FAKE_EXIT=6
if out="$(run "Offline" "$WORK/offline.token")"; then rc=0; else rc=1; fi
assert_eq "fails when curl cannot reach ZapSign" "1" "$rc"
assert_eq "reports the unreachable API" "1" "$(grep -c 'could not reach ZapSign' <<< "$out")"
assert_eq "leaves no token file when curl fails" "no" "$([ -e "$WORK/offline.token" ] && echo yes || echo no)"
unset FAKE_EXIT

export FAKE_STATUS=401 FAKE_BODY='{"detail":"secret account data"}'
if out="$(run "Outra" "$WORK/other.token")"; then rc=0; else rc=1; fi
assert_eq "fails on an HTTP error" "1" "$rc"
assert_eq "withholds the error body" "0" "$(grep -c 'secret account data' <<< "$out" || true)"
assert_eq "leaves no token file after an error" "no" "$([ -e "$WORK/other.token" ] && echo yes || echo no)"

export FAKE_STATUS=200 FAKE_BODY='{"id":1}'
if run "Sem token" "$WORK/none.token" >/dev/null; then rc=0; else rc=1; fi
assert_eq "fails when the response has no api_token" "1" "$rc"
assert_eq "leaves no token file when the response has no api_token" "no" "$([ -e "$WORK/none.token" ] && echo yes || echo no)"

unset ZAPSIGN_PARTNER_TOKEN
if run "Acme" "$WORK/acme.token" >/dev/null; then rc=0; else rc=1; fi
assert_eq "requires the partner token" "1" "$rc"

rm -rf "$WORK"
exit "$fail"
