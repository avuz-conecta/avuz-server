#!/bin/bash
# Mask secrets that occ --value arguments left in a tenant's admin_audit log,
# through the Portainer exec proxy. Bundles lib.php + redact.php, base64-evals
# it as www-data (the log owner). Dry run unless --execute.
#
# Usage:
#   scripts/audit-log/run.sh <staging|prod> <container> [--execute]
#
# Every prod run, dry or not, needs the user's explicit go.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPTS_DIR="$(dirname "$SCRIPT_DIR")"

die() { echo "error: $*" >&2; exit 1; }

[ "$#" -ge 2 ] || die "usage: $0 <staging|prod> <container> [--execute]"
ENVIRONMENT="$1"; CONTAINER="$2"; shift 2

case "$ENVIRONMENT" in
  staging) EXEC="$SCRIPTS_DIR/portainer-exec.sh" ;;
  prod)    EXEC="$SCRIPTS_DIR/portainer-exec-prod.sh" ;;
  *)       die "environment must be staging or prod, got '$ENVIRONMENT'" ;;
esac
case "${1:-}" in
  ""|--execute) ;;
  *) die "unknown flag '$1' (only --execute)" ;;
esac

BUNDLE_BASE64="$(cat "$SCRIPT_DIR/lib.php" "$SCRIPT_DIR/redact.php" | grep -v '^<?php' | base64 | tr -d '\n')"
exec "$EXEC" -u www-data "$CONTAINER" php -r "eval(base64_decode('$BUNDLE_BASE64'));" -- "$@"
