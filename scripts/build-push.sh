#!/bin/bash
set -e

# Configuration
REGISTRY="10.50.100.103:8080"
ORG="admin"
IMAGE_NAME="avuzconecta"
BASE_IMAGE_NAME="avuzconecta-base"
VERSION=${1:-latest}

echo "Building ${REGISTRY}/${ORG}/${IMAGE_NAME}:${VERSION} for linux/amd64"

# Build app image (uses base image from registry)
docker buildx build \
  --platform linux/amd64 \
  --build-arg REGISTRY=${REGISTRY} \
  --build-arg ORG=${ORG} \
  -t ${REGISTRY}/${ORG}/${IMAGE_NAME}:${VERSION} \
  -t ${REGISTRY}/${ORG}/${IMAGE_NAME}:latest \
  --load \
  .

echo "Pushing to registry..."
docker push ${REGISTRY}/${ORG}/${IMAGE_NAME}:latest

echo "✓ Successfully pushed ${REGISTRY}/${ORG}/${IMAGE_NAME}:latest"
