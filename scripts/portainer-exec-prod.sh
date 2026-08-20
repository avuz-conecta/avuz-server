#!/bin/bash
# Production container exec — thin wrapper around portainer-exec.sh pointing at
# the separate prod config (scripts/deploy.prod.env). Distinct entrypoint so
# running a command against prod is always deliberate, never a stray default.
#
# Usage: ./scripts/portainer-exec-prod.sh [-u user] <container> <cmd> [args...]
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PORTAINER_ENV_FILE="$SCRIPT_DIR/deploy.prod.env"
exec "$SCRIPT_DIR/portainer-exec.sh" "$@"
