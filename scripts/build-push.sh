#!/bin/bash
set -e

# Configuration
REGISTRY="10.50.100.103:8080"  # Replace with your Quay registry URL (include port for HTTP)
ORG="admin"
IMAGE_NAME="avuzconecta"
VERSION=${1:-latest}

echo "Building ${REGISTRY}/${ORG}/${IMAGE_NAME}:${VERSION} for linux/amd64"

# Build image for linux/amd64 (x86_64) platform
docker buildx build \
  --platform linux/amd64 \
  -t ${REGISTRY}/${ORG}/${IMAGE_NAME}:${VERSION} \
  -t ${REGISTRY}/${ORG}/${IMAGE_NAME}:latest \
  --load \
  .

echo "Pushing to registry..."

# Push both tags
#docker push ${REGISTRY}/${ORG}/${IMAGE_NAME}:${VERSION}
docker push ${REGISTRY}/${ORG}/${IMAGE_NAME}:latest

#echo "✓ Successfully pushed ${REGISTRY}/${ORG}/${IMAGE_NAME}:${VERSION}"
echo "✓ Successfully pushed ${REGISTRY}/${ORG}/${IMAGE_NAME}:latest"
