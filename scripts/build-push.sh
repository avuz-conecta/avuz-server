#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib-docker.sh"
# self-manage Docker unless a wrapper is orchestrating base+push together
if [ -z "$DOCKER_MANAGED_EXTERNALLY" ]; then
  ensure_docker
  trap cleanup_docker EXIT
fi

# Configuration
REGISTRY="registry.avuz.app"
ORG="admin"
IMAGE_NAME="avuzconecta"
BASE_IMAGE_NAME="avuzconecta-base"
parse_no_latest "$@"
set -- ${BUILD_ARGS[@]+"${BUILD_ARGS[@]}"}
VERSION=${1:-latest}

# Environment: local (macOS/arm64) or staging (linux/amd64)
ENV=${2:-local}

# Optional tag suffix — appended as "-<suffix>" to image tags. Use to isolate
# experimental builds (e.g. "s3" → :latest-s3, :staging-s3) without overwriting
# the canonical tags. Base image is NOT suffixed.
TAG_SUFFIX=${3:-}
SUFFIX=""
if [ -n "$TAG_SUFFIX" ]; then
  SUFFIX="-${TAG_SUFFIX}"
fi

case $ENV in
  local)
    PLATFORM="linux/arm64"
    PUSH=false
    IMAGE_TAG="${IMAGE_NAME}:${VERSION}${SUFFIX}"
    IMAGE_TAG_LATEST="${IMAGE_NAME}:latest${SUFFIX}"
    BASE_IMAGE="${BASE_IMAGE_NAME}:latest"
    ;;
  staging)
    PLATFORM="linux/amd64"
    PUSH=true
    IMAGE_TAG="${REGISTRY}/${ORG}/${IMAGE_NAME}:staging${SUFFIX}"
    IMAGE_TAG_LATEST="${REGISTRY}/${ORG}/${IMAGE_NAME}:staging${SUFFIX}"
    BASE_IMAGE="${REGISTRY}/${ORG}/${BASE_IMAGE_NAME}:staging"
    ;;
  prod)
    PLATFORM="linux/amd64"
    PUSH=true
    IMAGE_TAG="${REGISTRY}/${ORG}/${IMAGE_NAME}:${VERSION}${SUFFIX}"
    IMAGE_TAG_LATEST="${REGISTRY}/${ORG}/${IMAGE_NAME}:latest${SUFFIX}"
    BASE_IMAGE="${REGISTRY}/${ORG}/${BASE_IMAGE_NAME}:latest"
    ;;
  *)
    echo "Usage: $0 [version] [local|staging|prod] [tag-suffix] [--no-latest]"
    echo "  local         - Build for macOS (arm64), no push"
    echo "  staging       - Build for Linux (amd64), push as :staging"
    echo "  prod          - Build for Linux (amd64), push as :latest"
    echo "  tag-suffix    - Optional. Appends '-<suffix>' to image tags."
    echo "                  Example: '$0 latest staging s3' → :staging-s3"
    echo "  --no-latest   - Push only :<version>, leave :latest (tenants) untouched."
    echo "                  Example: '$0 2026.10.18-ccb7b8d prod --no-latest'"
    exit 1
    ;;
esac

# --- Worktree build-context completeness -----------------------------------
# The Docker build context is `.` (the current tree). avuz-server keeps its
# gitignored bundled apps (spreed, calendar, contacts, activity, ...) AND the
# `3rdparty` submodule (the Composer autoloader) on disk ONLY in the primary
# checkout — a linked `git worktree` has neither. Building from a worktree then
# silently ships a BROKEN image: empty 3rdparty -> the container crash-loops with
# "Composer autoloader not found", and every gitignored app is simply gone.
# So when we're in a linked worktree, sync those on-disk-only inputs from the
# primary checkout first. Only ever COPIES what is missing here — never
# overwrites a tracked/present path (e.g. your worktree's own app changes).
GIT_DIR_REL="$(git rev-parse --git-dir 2>/dev/null || true)"
GIT_COMMON_REL="$(git rev-parse --git-common-dir 2>/dev/null || true)"
if [ -n "$GIT_COMMON_REL" ] && [ "$GIT_DIR_REL" != "$GIT_COMMON_REL" ]; then
  PRIMARY_TREE="$(cd "$(dirname "$GIT_COMMON_REL")" && pwd)"
  echo "Linked worktree detected — completing build context from primary checkout:"
  echo "  $PRIMARY_TREE"
  if [ ! -f 3rdparty/autoload.php ] && [ -f "$PRIMARY_TREE/3rdparty/autoload.php" ]; then
    echo "  · 3rdparty/ (submodule — Composer autoloader)"
    rsync -a --delete "$PRIMARY_TREE/3rdparty/" 3rdparty/
  fi
  if [ -d "$PRIMARY_TREE/apps" ]; then
    for app_path in "$PRIMARY_TREE"/apps/*/; do
      app_name="$(basename "$app_path")"
      # Fill an app that is ABSENT here, OR present-but-unpopulated — a linked
      # worktree gets submodule mountpoints (apps/deck, apps/integration_openai)
      # with NO content, so their Avuz-fork patches are missing and the container
      # refuses to boot. Guard on the LOCAL lacking appinfo/info.xml so a real,
      # populated app (e.g. this worktree's own conectamail changes) is NEVER
      # clobbered; only copy when the primary actually has content.
      if [ -f "$app_path/appinfo/info.xml" ] && [ ! -f "apps/$app_name/appinfo/info.xml" ]; then
        echo "  · apps/$app_name (on-disk-only app / unpopulated submodule)"
        rm -rf "apps/$app_name"
        cp -R "$app_path" "apps/$app_name"
      fi
    done
  fi
  echo "  context completed (missing-only; present paths untouched)."
fi
# ---------------------------------------------------------------------------

# Image names to tag. --no-latest leaves the moving tag alone, e.g. a pinned
# release for app3 that must not roll every tenant on :latest.
TAGS=("$IMAGE_TAG")
if [ "$SKIP_LATEST" = true ]; then
  if [ "$IMAGE_TAG" = "$IMAGE_TAG_LATEST" ]; then
    echo "✗ --no-latest needs a version other than latest (this env tags only ${IMAGE_TAG})"
    exit 1
  fi
else
  TAGS+=("$IMAGE_TAG_LATEST")
fi

echo "==========================================="
echo "Building APP image"
echo "  Image:    ${IMAGE_TAG}"
echo "  Base:     ${BASE_IMAGE}"
echo "  Platform: ${PLATFORM}"
echo "  Push:     ${PUSH}"
echo "==========================================="

# Build app image (pushes straight to the registry for staging/prod)
read -ra BUILD_FLAGS <<< "$(docker_build_flags "$PUSH" "${TAGS[@]}")"
docker buildx build \
  --platform ${PLATFORM} \
  --build-arg BASE_IMAGE=${BASE_IMAGE} \
  "${BUILD_FLAGS[@]}" \
  .

if [ "$PUSH" = true ]; then
  echo "✓ Built and pushed: ${TAGS[*]}"
else
  echo "✓ Built: ${TAGS[*]}"
fi
