#!/usr/bin/env sh
set -eu

IMAGE_NAME="mosquito-threat-enricher"
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"

docker build -t "$IMAGE_NAME" "$SCRIPT_DIR"

echo "Built Docker image: $IMAGE_NAME"
