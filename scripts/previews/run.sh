#!/bin/bash
# Run a preview tool (scan | purge) inside a Nextcloud container through the
# Portainer exec proxy. Bundles lib.php + <tool>.php, base64-evals it as
# www-data, and passes the remaining flags to the tool.
#
# Usage:
#   scripts/previews/run.sh <staging|prod> scan  <container>
#   scripts/previews/run.sh <staging|prod> purge <container> [--execute | --sweep-only --cutoff=<ISO 8601>]
#
# purge without flags is a dry run. Every prod run needs the user's explicit go.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPTS_DIR="$(dirname "$SCRIPT_DIR")"

die() { echo "error: $*" >&2; exit 1; }

[ "$#" -ge 3 ] || die "usage: $0 <staging|prod> <scan|purge> <container> [flags...]"
ENVIRONMENT="$1"; TOOL="$2"; CONTAINER="$3"; shift 3

case "$ENVIRONMENT" in
  staging) EXEC="$SCRIPTS_DIR/portainer-exec.sh" ;;
  prod)    EXEC="$SCRIPTS_DIR/portainer-exec-prod.sh" ;;
  *)       die "environment must be staging or prod, got '$ENVIRONMENT'" ;;
esac
case "$TOOL" in
  scan|purge) ;;
  *) die "unknown tool '$TOOL' (scan | purge)" ;;
esac

BUNDLE_BASE64="$(cat "$SCRIPT_DIR/lib.php" "$SCRIPT_DIR/$TOOL.php" | grep -v '^<?php' | base64 | tr -d '\n')"
exec "$EXEC" -u www-data "$CONTAINER" php -r "eval(base64_decode('$BUNDLE_BASE64'));" -- "$@"
