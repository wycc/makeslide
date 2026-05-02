#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "[unit] 載入 nvm 與 Node 版本"
NVM_SH=""
if [[ -n "${NVM_DIR:-}" && -s "${NVM_DIR}/nvm.sh" ]]; then
  NVM_SH="${NVM_DIR}/nvm.sh"
elif [[ -s "/home/wycc/.nvm/nvm.sh" ]]; then
  NVM_SH="/home/wycc/.nvm/nvm.sh"
fi

if [[ -n "$NVM_SH" ]]; then
  export NVM_DIR="${NVM_DIR:-/home/wycc/.nvm}"
  # shellcheck disable=SC1090
  . "$NVM_SH"
  if [[ -f "$SCRIPT_DIR/.nvmrc" ]]; then
    nvm use >/dev/null 2>&1 || nvm install
    nvm use >/dev/null
  fi
fi

echo "[unit] Node $(node -v), npm $(npm -v)"

echo "[unit] 檢查依賴"
if [[ ! -d "$SCRIPT_DIR/node_modules" ]]; then
  npm install
fi

echo "[unit] 重建 better-sqlite3（避免 Node ABI 不相容）"
npm rebuild better-sqlite3 --workspace backend || true

echo "[unit] 執行 backend 測試"
NODE_ENV=test npm --workspace backend run test

