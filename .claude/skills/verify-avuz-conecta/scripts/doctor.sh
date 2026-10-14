#!/bin/bash
# Read-only staging health check. No login, no secrets.
# Usage: scripts/doctor.sh <base-url> [expected-deck-version]
set -euo pipefail

ALLOWED_URLS="https://conectahml.avuz.app https://conectahml2.avuz.app https://conectahmls3.avuz.app https://conectamail.avuz.app"

base_url="${1:?usage: doctor.sh <base-url> [expected-deck-version]}"
base_url="${base_url%/}"

case " $ALLOWED_URLS " in
  *" $base_url "*) ;;
  *) echo "FAIL: $base_url is not an allowed staging URL" >&2; exit 2 ;;
esac

if [ "$base_url" = "https://conectamail.avuz.app" ]; then
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "$base_url/")"
  [ "$code" = "200" ] || { echo "FAIL: webmail HTTP $code" >&2; exit 1; }
  echo "OK webmail reachable (HTTP 200)"
  exit 0
fi

body="$(curl -sS --max-time 15 -w '\n%{http_code}' "$base_url/status.php")"
code="$(printf '%s' "$body" | tail -n1)"
json="$(printf '%s' "$body" | sed '$d')"
[ "$code" = "200" ] || { echo "FAIL: status.php HTTP $code" >&2; exit 1; }

printf '%s' "$json" | grep -q '"installed":true'    || { echo "FAIL: not installed" >&2; exit 1; }
printf '%s' "$json" | grep -q '"maintenance":false' || { echo "FAIL: maintenance mode on" >&2; exit 1; }

version="$(printf '%s' "$json" | sed -n 's/.*"versionstring":"\([^"]*\)".*/\1/p')"
echo "OK $base_url installed, no maintenance, version ${version:-unknown}"

# Deck version: info.xml is readable without login (the capabilities endpoint hides deck until login).
deck_version="$(curl -sS --max-time 15 "$base_url/apps/deck/appinfo/info.xml" | sed -n 's/.*<version>\([^<]*\)<\/version>.*/\1/p' | head -n1)"
echo "OK deck version ${deck_version:-unknown}"

expected_deck="${2:-}"
if [ -n "$expected_deck" ] && [ "$deck_version" != "$expected_deck" ]; then
  echo "FAIL: deck version ${deck_version:-unknown}, expected $expected_deck (old image still running?)" >&2
  exit 1
fi
