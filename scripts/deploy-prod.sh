#!/bin/bash
# Production redeploy — a thin wrapper around deploy.sh that points at the
# separate prod config (scripts/deploy.prod.env: its own PORTAINER_URL + token).
# Kept as a distinct entrypoint so a prod deploy is always an explicit,
# deliberate command — never a stray default.
#
# Usage: ./scripts/deploy-prod.sh <stack> [<stack> ...]   (same flags as deploy.sh)
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PORTAINER_ENV_FILE="$SCRIPT_DIR/deploy.prod.env"
exec "$SCRIPT_DIR/deploy.sh" "$@"
