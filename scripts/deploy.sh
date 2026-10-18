#!/bin/bash
# Redeploy one or more Portainer stacks via the Portainer CE API (pull latest
# image + recreate). Portainer CE has no stack webhooks (Business only), so this
# resolves each stack by name and re-applies its existing compose + env with
# pullImage=true — no config change, just a pull + recreate.
#
# Config in scripts/deploy.env (gitignored — the token is a secret):
#     PORTAINER_URL=https://portainer.avuz.app
#     PORTAINER_TOKEN=ptr_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
# Token: Portainer → My account → Access tokens → Add. Copy deploy.env.example.
#
# Usage:
#   ./scripts/deploy.sh <stack> [<stack> ...]   # redeploy these stacks
#   ./scripts/deploy.sh --list                  # list stacks Portainer knows
#   ./scripts/deploy.sh -y <stack>              # skip the confirmation prompt
#   ./scripts/deploy.sh --no-cachebust <stack>  # don't bump the theming cachebuster
#
# After each redeploy, once the container reports installed: true (startup can
# take ~6 min), the theming cachebuster is incremented via occ so browsers +
# Cloudflare fetch fresh l10n/JS overrides. Non-fatal; skip with --no-cachebust
# or SKIP_CACHEBUST=1.
#
# Build first (this script only deploys, never builds):
#   ./scripts/build-push.sh latest prod && ./scripts/deploy.sh grupo-vidalar
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Environment-scoped config: default is staging (deploy.env). deploy-prod.sh
# sets PORTAINER_ENV_FILE to deploy.prod.env — separate URL + token per env.
CONFIG_FILE="${PORTAINER_ENV_FILE:-$SCRIPT_DIR/deploy.env}"

die() { echo "error: $*" >&2; exit 1; }

command -v jq >/dev/null || die "jq is required (brew install jq)"
[ -f "$CONFIG_FILE" ] || die "no $CONFIG_FILE — copy $(basename "$CONFIG_FILE").example and fill in PORTAINER_URL + PORTAINER_TOKEN"

# shellcheck disable=SC1090
set -a; . "$CONFIG_FILE"; set +a
[ -n "${PORTAINER_URL:-}" ]   || die "PORTAINER_URL not set in $CONFIG_FILE"
[ -n "${PORTAINER_TOKEN:-}" ] || die "PORTAINER_TOKEN not set in $CONFIG_FILE"
PORTAINER_URL="${PORTAINER_URL%/}" # strip trailing slash

# Portainer's default HTTPS port (9443) uses a self-signed cert. Set
# PORTAINER_INSECURE=1 in deploy.env to skip cert verification (fine for an
# internal IP:port with no DNS). Leave unset when a real cert is in place.
CURL_OPTS=()
[ "${PORTAINER_INSECURE:-0}" = "1" ] && CURL_OPTS+=(-k)

# GET helper — authenticated, fails on non-2xx.
api_get() { curl -fsS "${CURL_OPTS[@]}" -H "X-API-Key: $PORTAINER_TOKEN" "$PORTAINER_URL$1"; }

# POST to the Docker API proxy for the cachebuster exec. Bounded by --max-time so
# a hung/booting container can never stall the deploy (it's non-fatal anyway).
CACHEBUST_EXEC_TIMEOUT="${CACHEBUST_EXEC_TIMEOUT:-30}"
api_post() {
  curl -fsS "${CURL_OPTS[@]}" --max-time "$CACHEBUST_EXEC_TIMEOUT" \
    -X POST -H "X-API-Key: $PORTAINER_TOKEN" -H 'Content-Type: application/json' "$@"
}

ASSUME_YES=0
# Bump the theming cachebuster after each redeploy so browsers + Cloudflare
# fetch fresh l10n/JS overrides (see below). Off via --no-cachebust or
# SKIP_CACHEBUST=1.
CACHEBUST=1
[ "${SKIP_CACHEBUST:-0}" = "1" ] && CACHEBUST=0
STACKS=()
for arg in "$@"; do
  case "$arg" in
    --no-cachebust) CACHEBUST=0 ;;
    -l|--list)
      # Same stack name can exist in multiple environments (endpoints); show the
      # endpoint + stack id so collisions are visible and can be targeted by id.
      { echo -e "ENDPOINT\tSTACK_ID\tNAME"
        api_get "/api/stacks" \
          | jq -r '.[] | "\(.EndpointId)\t\(.Id)\t\(.Name)"' | sort -k3
      } | column -t -s "$(printf '\t')" \
        || die "could not reach Portainer at $PORTAINER_URL"
      exit 0 ;;
    -y|--yes) ASSUME_YES=1 ;;
    -*)       die "unknown flag: $arg" ;;
    *)        STACKS+=("$arg") ;;
  esac
done

[ "${#STACKS[@]}" -gt 0 ] || die "no stack given. See: $0 --list"

# A target is either a numeric stack id (unambiguous — use when names collide
# across endpoints) or a stack name. This jq selector matches whichever.
SELECT='.[] | select(if ($t|test("^[0-9]+$")) then (.Id == ($t|tonumber)) else (.Name == $t) end)'

# Fetch the stack list once; resolve every target up front so a typo or an
# ambiguous name aborts before any deploy fires.
ALL_STACKS="$(api_get "/api/stacks")" || die "could not reach Portainer at $PORTAINER_URL"
for stack in "${STACKS[@]}"; do
  matches="$(printf '%s' "$ALL_STACKS" | jq --arg t "$stack" "[$SELECT] | length")"
  if [ "$matches" = "0" ]; then
    die "stack '$stack' not found. See: $0 --list"
  elif [ "$matches" != "1" ]; then
    cand="$(printf '%s' "$ALL_STACKS" | jq -r --arg t "$stack" "$SELECT | \"  endpoint \(.EndpointId)  id \(.Id)  \(.Name)\"")"
    die "'$stack' is ambiguous ($matches stacks share that name across endpoints). Target by id instead:
$cand"
  fi
done

echo "About to redeploy (pull + recreate) [$(basename "$CONFIG_FILE")]: ${STACKS[*]}"
if [ "$ASSUME_YES" -ne 1 ]; then
  [ -t 0 ] || die "non-interactive shell — pass -y to confirm"
  read -r -p "Proceed? [y/N] " reply
  case "$reply" in [yY]|[yY][eE][sS]) ;; *) echo "aborted"; exit 1 ;; esac
fi

redeploy_one() {
  local stack="$1" row id eid env file body
  row="$(printf '%s' "$ALL_STACKS" | jq -c --arg t "$stack" "$SELECT")"
  id="$(printf '%s' "$row" | jq -r '.Id')"
  eid="$(printf '%s' "$row" | jq -r '.EndpointId')"
  env="$(printf '%s' "$row" | jq -c '.Env // []')"
  # Re-send the stack's current compose file unchanged; pullImage forces a fresh
  # pull of the (mutable :latest) image, prune=false keeps other resources.
  file="$(api_get "/api/stacks/$id/file" | jq -r '.StackFileContent')"
  body="$(jq -n --arg f "$file" --argjson e "$env" \
    '{stackFileContent:$f, env:$e, prune:false, pullImage:true}')"
  curl -fsS "${CURL_OPTS[@]}" -X PUT \
    -H "X-API-Key: $PORTAINER_TOKEN" -H "Content-Type: application/json" \
    -d "$body" "$PORTAINER_URL/api/stacks/$id?endpointId=$eid" >/dev/null
}

# Find the running Nextcloud container for a stack on its endpoint. Portainer
# labels every container with the compose project (= stack name) and service
# (both stack templates name the NC service `app`). No all=1: we want the fresh,
# running container the recreate just started.
find_nc_container() {
  local eid="$1" name="$2" filt
  filt="$(jq -rn --arg p "$name" \
    '{label:["com.docker.compose.project=\($p)","com.docker.compose.service=app"]} | tojson | @uri')"
  api_get "/api/endpoints/$eid/docker/containers/json?filters=$filt" \
    | jq -r '.[0].Id // empty'
}

# Run a command in the container via the Docker API exec proxy (TTY => raw
# output), as $user. Mirrors scripts/portainer-exec.sh.
nc_exec() {
  local eid="$1" cid="$2" user="$3"; shift 3
  local cmd_json exec_id
  cmd_json="$(for a in "$@"; do jq -Rn --arg x "$a" '$x'; done | jq -sc .)"
  exec_id="$(api_post "$PORTAINER_URL/api/endpoints/$eid/docker/containers/$cid/exec" \
    -d "$(jq -n --argjson cmd "$cmd_json" --arg u "$user" \
          '{AttachStdout:true, AttachStderr:true, Tty:true, Cmd:$cmd}
           + (if $u == "" then {} else {User:$u} end)')" | jq -r '.Id')" || return 1
  [ -n "$exec_id" ] && [ "$exec_id" != "null" ] || return 1
  api_post "$PORTAINER_URL/api/endpoints/$eid/docker/exec/$exec_id/start" \
    -d '{"Detach":false,"Tty":true}'
}

# After redeploy, wait for the fresh container to finish installing (startup can
# take ~6 min), then increment the theming cachebuster so ?v=<hash>-<cachebuster>
# asset URLs change and Cloudflare/browsers drop the 6-month-immutable copies.
# Entirely non-fatal: any failure warns and leaves the deploy successful.
CACHEBUST_WAIT="${CACHEBUST_WAIT:-420}"   # seconds to wait for installed: true
bump_cachebuster() {
  local stack="$1" row eid name cid out cur next waited=0
  row="$(printf '%s' "$ALL_STACKS" | jq -c --arg t "$stack" "$SELECT")"
  eid="$(printf '%s' "$row" | jq -r '.EndpointId')"
  name="$(printf '%s' "$row" | jq -r '.Name')"

  while :; do
    cid="$(find_nc_container "$eid" "$name" 2>/dev/null || true)"
    if [ -n "$cid" ]; then
      out="$(nc_exec "$eid" "$cid" www-data php occ status 2>/dev/null || true)"
      printf '%s' "$out" | grep -q 'installed: true' && break
    fi
    waited=$((waited + 10))
    if [ "$waited" -ge "$CACHEBUST_WAIT" ]; then
      echo "  ⚠ cachebuster skipped: $stack not healthy within ${CACHEBUST_WAIT}s"
      return 0
    fi
    sleep 10
  done

  cur="$(nc_exec "$eid" "$cid" www-data php occ config:app:get theming cachebuster 2>/dev/null || true)"
  cur="$(printf '%s' "$cur" | tr -dc '0-9')"   # strip TTY CR/whitespace; empty => unset
  [ -n "$cur" ] || cur=0
  next=$((cur + 1))
  if nc_exec "$eid" "$cid" www-data php occ config:app:set theming cachebuster --value="$next" >/dev/null 2>&1; then
    echo "  ✓ cachebuster $cur → $next ($stack)"
  else
    echo "  ⚠ cachebuster bump failed for $stack (deploy still OK)"
  fi
}

FAILED=()
for stack in "${STACKS[@]}"; do
  echo -n "→ $stack ... "
  if redeploy_one "$stack"; then
    echo "redeployed"
    [ "$CACHEBUST" -eq 1 ] && bump_cachebuster "$stack"
  else
    echo "FAILED"; FAILED+=("$stack")
  fi
done

[ "${#FAILED[@]}" -eq 0 ] || die "redeploy failed for: ${FAILED[*]}"
echo "done"
