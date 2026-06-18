#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE_NAME="chatgpt2api-local:latest"
CONTAINER_NAME="chatgpt2api-py"

echo "[release] building ${IMAGE_NAME}"
sudo -n docker build -t "${IMAGE_NAME}" "${ROOT_DIR}"

echo "[release] restarting ${CONTAINER_NAME}"
if sudo -n docker ps -a --format '{{.Names}}' | grep -qx "${CONTAINER_NAME}"; then
  sudo -n docker stop "${CONTAINER_NAME}" >/dev/null 2>&1 || true
  sudo -n docker rm "${CONTAINER_NAME}" >/dev/null 2>&1 || true
fi

sudo -n docker run -d \
  --name "${CONTAINER_NAME}" \
  --restart unless-stopped \
  --network host \
  -e STORAGE_BACKEND=json \
  -v "${ROOT_DIR}/data:/app/data" \
  -v "${ROOT_DIR}/config.json:/app/config.json" \
  "${IMAGE_NAME}" \
  uv run uvicorn main:app --host 0.0.0.0 --port 4521 --access-log

echo "[release] waiting for app"
for _ in {1..30}; do
  if curl -fsS "http://127.0.0.1:4521/" >/dev/null 2>&1; then
    echo "[release] app is ready"
    exit 0
  fi
  sleep 2
done

echo "[release] app failed to become ready" >&2
sudo -n docker logs --tail 100 "${CONTAINER_NAME}" >&2 || true
exit 1
