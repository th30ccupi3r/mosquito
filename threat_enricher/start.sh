#!/usr/bin/env sh
set -eu

IMAGE_NAME="mosquito-threat-enricher"
CONTAINER_NAME="mosquito-threat-enricher"
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
STORAGE_DIR="$SCRIPT_DIR/storage"

mkdir -p "$STORAGE_DIR"

docker build -t "$IMAGE_NAME" "$SCRIPT_DIR"

if docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"; then
  docker rm -f "$CONTAINER_NAME" >/dev/null
fi

docker run -d \
  --name "$CONTAINER_NAME" \
  -p 8000:8000 \
  -e DATABASE_URL=sqlite:////app/storage/mosquito.db \
  -v "$STORAGE_DIR:/app/storage" \
  "$IMAGE_NAME"

echo "mosquito: threat enricher is starting on http://localhost:8000"
