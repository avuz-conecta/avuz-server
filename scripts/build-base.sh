#!/bin/bash
set -e

# Configuration
REGISTRY="10.50.100.103:8080"
ORG="admin"
BASE_IMAGE_NAME="avuzconecta-base"
VERSION=${1:-latest}

echo "Building BASE image ${REGISTRY}/${ORG}/${BASE_IMAGE_NAME}:${VERSION} for linux/amd64"
echo "This includes PHP extensions and runtime packages - only rebuild when these change"

# Build base image
docker buildx build \
  --platform linux/amd64 \
  -f Dockerfile.base \
  -t ${REGISTRY}/${ORG}/${BASE_IMAGE_NAME}:${VERSION} \
  -t ${REGISTRY}/${ORG}/${BASE_IMAGE_NAME}:latest \
  --load \
  .

echo "Pushing to registry..."
docker push ${REGISTRY}/${ORG}/${BASE_IMAGE_NAME}:latest

echo "✓ Successfully pushed ${REGISTRY}/${ORG}/${BASE_IMAGE_NAME}:latest"
echo ""
echo "Now you can run ./scripts/build-push.sh for fast app builds"
