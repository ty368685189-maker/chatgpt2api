#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

check_api() {
  local url="$1"
  local needle="$2"
  local body
  body="$(curl -fsS "$url")"
  if [[ "$body" != *"$needle"* ]]; then
    echo "[smoke] missing needle '$needle' in $url" >&2
    return 1
  fi
  echo "[smoke] ok: $url contains '$needle'"
}

check_api "http://127.0.0.1:4521/" "ChatGPT 号池管理"
check_api "http://127.0.0.1:4521/api/auth/login" "用户名或密码错误" || true

container_id="$(sudo -n docker inspect --format '{{.Id}}' chatgpt2api-py)"
if [[ -z "$container_id" ]]; then
  echo "[smoke] container chatgpt2api-py not found" >&2
  exit 1
fi

if ! sudo -n docker exec chatgpt2api-py sh -lc 'grep -Rao "旧密钥登录\|登录密钥\|用户密钥\|管理员密钥\|无限制" /app/web_dist/_next/static/chunks 2>/dev/null | sort | uniq | sed -n "1,20p"' | grep -q .; then
  echo "[smoke] no expected frontend strings found in container chunks" >&2
  exit 1
fi

echo "[smoke] frontend chunk strings ok"

login_res="$(curl -sS -X POST http://127.0.0.1:4521/api/auth/login -H 'Content-Type: application/json' -d '{"username":"__no_such_user__","password":"badpass1"}')"
if [[ "$login_res" != *"用户名或密码错误"* ]]; then
  echo "[smoke] login error path broken: $login_res" >&2
  exit 1
fi

echo "[smoke] api login error path ok"
