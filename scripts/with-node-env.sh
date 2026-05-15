#!/usr/bin/env bash
# Run a command with the same Node/npm environment selection used by start.sh.
# In particular, load nvm when available and switch to the Node version declared
# by the repository .nvmrc before executing npm scripts that may load native
# modules such as better-sqlite3.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CALLER_DIR="$PWD"

NVM_SH=""
if [[ -n "${NVM_DIR:-}" && -s "${NVM_DIR}/nvm.sh" ]]; then
  NVM_SH="${NVM_DIR}/nvm.sh"
elif [[ -s "$HOME/.nvm/nvm.sh" ]]; then
  NVM_SH="$HOME/.nvm/nvm.sh"
fi

if [[ -n "$NVM_SH" ]]; then
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  # npm scripts may export npm_config_prefix/NPM_CONFIG_PREFIX from the current
  # Node installation. nvm refuses to run when those are set, so clear them in
  # this wrapper before sourcing nvm.
  unset npm_config_prefix NPM_CONFIG_PREFIX
  # shellcheck disable=SC1090
  . "$NVM_SH"
  if [[ -f "$REPO_DIR/.nvmrc" ]]; then
    cd "$REPO_DIR"
    if ! nvm use >/dev/null 2>&1; then
      nvm install
      nvm use >/dev/null
    fi
    cd "$CALLER_DIR"
  fi
fi

if ! command -v node >/dev/null 2>&1; then
  echo "[ERROR] 找不到 node。請安裝 Node.js 或 nvm。" >&2
  exit 1
fi

NODE_VER="$(node -v | sed 's/^v//')"
NODE_MAJOR="${NODE_VER%%.*}"
if [[ -z "$NODE_MAJOR" || "$NODE_MAJOR" -lt 20 ]]; then
  echo "[ERROR] Node 版本過舊：v${NODE_VER}（需要 >= 20；建議使用 .nvmrc 指定版本）。" >&2
  exit 1
fi

exec "$@"
