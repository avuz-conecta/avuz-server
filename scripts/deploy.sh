#!/bin/bash
# Dispatch a Portainer redeploy webhook for one or more client stacks.
#
# Webhooks live in scripts/deploy-webhooks.env (gitignored — the URLs are
# secrets: anyone with a URL can redeploy that stack). Format, one per line:
#     grupo-vidalar=https://portainer.avuz.app/api/stacks/webhooks/<uuid>
# Copy scripts/deploy-webhooks.env.example to get started.
#
# Usage:
#   ./scripts/deploy.sh <stack> [<stack> ...]   # redeploy these stacks
#   ./scripts/deploy.sh --list                  # list configured stacks
#   ./scripts/deploy.sh -y <stack>              # skip the confirmation prompt
#
# Build first (this script only deploys, never builds):
#   ./scripts/build-push.sh latest prod && ./scripts/deploy.sh grupo-vidalar
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEBHOOKS_FILE="$SCRIPT_DIR/deploy-webhooks.env"

die() { echo "error: $*" >&2; exit 1; }

[ -f "$WEBHOOKS_FILE" ] || die "no $WEBHOOKS_FILE — copy deploy-webhooks.env.example and fill in the webhook URLs"

# Print configured stack names (keys), skipping blanks and # comments.
list_stacks() {
  grep -vE '^\s*(#|$)' "$WEBHOOKS_FILE" | cut -d= -f1
}

# Look up one stack's webhook URL, empty if absent.
webhook_for() {
  grep -E "^$1=" "$WEBHOOKS_FILE" | head -1 | cut -d= -f2- || true
}

ASSUME_YES=0
STACKS=()
for arg in "$@"; do
  case "$arg" in
    -l|--list) echo "Configured stacks:"; list_stacks | sed 's/^/  /'; exit 0 ;;
    -y|--yes)  ASSUME_YES=1 ;;
    -*)        die "unknown flag: $arg" ;;
    *)         STACKS+=("$arg") ;;
  esac
done

[ "${#STACKS[@]}" -gt 0 ] || die "no stack given. Configured: $(list_stacks | paste -sd, -)"

# Resolve every stack up front so a typo aborts before any deploy fires.
URLS=()
for stack in "${STACKS[@]}"; do
  url="$(webhook_for "$stack")"
  [ -n "$url" ] || die "no webhook for '$stack'. Configured: $(list_stacks | paste -sd, -)"
  URLS+=("$url")
done

echo "About to redeploy: ${STACKS[*]}"
if [ "$ASSUME_YES" -ne 1 ]; then
  [ -t 0 ] || die "non-interactive shell — pass -y to confirm"
  read -r -p "Proceed? [y/N] " reply
  case "$reply" in [yY]|[yY][eE][sS]) ;; *) echo "aborted"; exit 1 ;; esac
fi

FAILED=()
for i in "${!STACKS[@]}"; do
  stack="${STACKS[$i]}"
  url="${URLS[$i]}"
  echo -n "→ $stack ... "
  if curl -fsS -X POST "$url" >/dev/null; then
    echo "triggered"
  else
    echo "FAILED"
    FAILED+=("$stack")
  fi
done

[ "${#FAILED[@]}" -eq 0 ] || die "redeploy webhook failed for: ${FAILED[*]}"
echo "done"
