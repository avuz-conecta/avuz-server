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
REGISTRY="10.50.100.103:8080"
ORG="admin"
IMAGE_NAME="avuzconecta"
BASE_IMAGE_NAME="avuzconecta-base"
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
    echo "Usage: $0 [version] [local|staging|prod] [tag-suffix]"
    echo "  local         - Build for macOS (arm64), no push"
    echo "  staging       - Build for Linux (amd64), push as :staging"
    echo "  prod          - Build for Linux (amd64), push as :latest"
    echo "  tag-suffix    - Optional. Appends '-<suffix>' to image tags."
    echo "                  Example: '$0 latest staging s3' → :staging-s3"
    exit 1
    ;;
esac

echo "==========================================="
echo "Building APP image"
echo "  Image:    ${IMAGE_TAG}"
echo "  Base:     ${BASE_IMAGE}"
echo "  Platform: ${PLATFORM}"
echo "  Push:     ${PUSH}"
echo "==========================================="

# Build app image
docker buildx build \
  --platform ${PLATFORM} \
  --build-arg BASE_IMAGE=${BASE_IMAGE} \
  -t ${IMAGE_TAG} \
  -t ${IMAGE_TAG_LATEST} \
  --load \
  .

echo "✓ Build completed: ${IMAGE_TAG_LATEST}"

if [ "$PUSH" = true ]; then
  echo "Pushing to registry..."
  docker push ${IMAGE_TAG}
  docker push ${IMAGE_TAG_LATEST}
  echo "✓ Successfully pushed ${IMAGE_TAG_LATEST}"
fi
