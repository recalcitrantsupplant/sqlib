#!/bin/bash
set -e

# Build and push Docker image to ACR
# Set ACR_NAME to your Azure Container Registry name, e.g. ACR_NAME=myregistry
ACR_NAME="${ACR_NAME:?set ACR_NAME to your Azure Container Registry name}"
ACR_LOGIN_SERVER="${ACR_LOGIN_SERVER:-${ACR_NAME}.azurecr.io}"
IMAGE_NAME="sparql-query-lib"
TAG="${TAG:-${1:-latest}}"

echo "Building and pushing: $ACR_LOGIN_SERVER/$IMAGE_NAME:$TAG"

# Navigate to repo root
cd "$(dirname "$0")/.."

# Login to ACR
az acr login --name "$ACR_NAME"

# Build and push
docker build --platform linux/amd64 -t "$ACR_LOGIN_SERVER/$IMAGE_NAME:$TAG" .
docker push "$ACR_LOGIN_SERVER/$IMAGE_NAME:$TAG"

echo "Done: $ACR_LOGIN_SERVER/$IMAGE_NAME:$TAG"
