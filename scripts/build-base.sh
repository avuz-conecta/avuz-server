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
BASE_IMAGE_NAME="avuzconecta-base"
parse_no_latest "$@"
set -- ${BUILD_ARGS[@]+"${BUILD_ARGS[@]}"}
VERSION=${1:-latest}

# Environment: local (macOS/arm64) or staging (linux/amd64)
ENV=${2:-local}

case $ENV in
  local)
    PLATFORM="linux/arm64"
    PUSH=false
    IMAGE_TAG="${BASE_IMAGE_NAME}:${VERSION}"
    IMAGE_TAG_LATEST="${BASE_IMAGE_NAME}:latest"
    ;;
  staging)
    PLATFORM="linux/amd64"
    PUSH=true
    IMAGE_TAG="${REGISTRY}/${ORG}/${BASE_IMAGE_NAME}:staging"
    IMAGE_TAG_LATEST="${REGISTRY}/${ORG}/${BASE_IMAGE_NAME}:staging"
    ;;
  prod)
    PLATFORM="linux/amd64"
    PUSH=true
    IMAGE_TAG="${REGISTRY}/${ORG}/${BASE_IMAGE_NAME}:${VERSION}"
    IMAGE_TAG_LATEST="${REGISTRY}/${ORG}/${BASE_IMAGE_NAME}:latest"
    ;;
  *)
    echo "Usage: $0 [version] [local|staging|prod] [--no-latest]"
    echo "  local   - Build for macOS (arm64), no push"
    echo "  staging - Build for Linux (amd64), push as :staging"
    echo "  prod    - Build for Linux (amd64), push as :latest"
    echo "  --no-latest - Push only :<version>, leave :latest untouched"
    exit 1
    ;;
esac

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
echo "Building BASE image"
echo "  Image:    ${IMAGE_TAG}"
echo "  Platform: ${PLATFORM}"
echo "  Push:     ${PUSH}"
echo "==========================================="

# Build base image (pushes straight to the registry for staging/prod)
read -ra BUILD_FLAGS <<< "$(docker_build_flags "$PUSH" "${TAGS[@]}")"
docker buildx build \
  --platform ${PLATFORM} \
  -f Dockerfile.base \
  "${BUILD_FLAGS[@]}" \
  .

if [ "$PUSH" = true ]; then
  echo "✓ Built and pushed: ${TAGS[*]}"
else
  echo "✓ Built: ${TAGS[*]}"
fi

echo ""
echo "Now you can run: ./scripts/build-push.sh [version] [local|staging|prod]"
