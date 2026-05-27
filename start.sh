#!/usr/bin/env bash
# makeslide 一鍵啟動腳本
# - 載入 nvm（若存在）並切換到 .nvmrc 指定版本
# - 檢查 Node / npm / poppler-utils / .env
# - 建立必要目錄、安裝依賴、啟動 dev server
set -euo pipefail

# ──────────────────────────────────────────────────────────────────────────────
# 顏色輔助
# ──────────────────────────────────────────────────────────────────────────────
if [[ -t 1 ]] && command -v tput >/dev/null 2>&1 && [[ $(tput colors 2>/dev/null || echo 0) -ge 8 ]]; then
  C_RESET=$'\033[0m'
  C_INFO=$'\033[32m'   # 綠
  C_WARN=$'\033[33m'   # 黃
  C_ERROR=$'\033[31m'  # 紅
  C_BOLD=$'\033[1m'
  C_DIM=$'\033[2m'
else
  C_RESET=''; C_INFO=''; C_WARN=''; C_ERROR=''; C_BOLD=''; C_DIM=''
fi

log_info()  { printf '%s[INFO]%s %s\n'  "$C_INFO"  "$C_RESET" "$*"; }
log_warn()  { printf '%s[WARN]%s %s\n'  "$C_WARN"  "$C_RESET" "$*" >&2; }
log_error() { printf '%s[ERROR]%s %s\n' "$C_ERROR" "$C_RESET" "$*" >&2; }
log_step()  { printf '\n%s▶ %s%s\n'     "$C_BOLD"  "$*" "$C_RESET"; }

# ──────────────────────────────────────────────────────────────────────────────
# 路徑與預設
# ──────────────────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

FORCE_INSTALL=0
CLEAN_INSTALL=0
MODE="all"   # all | backend | frontend
PORT="${PORT:-8888}"
FRONTEND_BUILD_WATCH=1
DEV_MODE=0
HTTPS_MODE=0
HTTPS_CERT_DIR="${HTTPS_CERT_DIR:-$SCRIPT_DIR/.certs}"
HTTPS_KEY_PATH="${HTTPS_KEY_PATH:-$HTTPS_CERT_DIR/localhost-key.pem}"
HTTPS_CERT_PATH="${HTTPS_CERT_PATH:-$HTTPS_CERT_DIR/localhost-cert.pem}"

# ──────────────────────────────────────────────────────────────────────────────
# --help
# ──────────────────────────────────────────────────────────────────────────────
print_help() {
  cat <<'EOF'
makeslide 一鍵啟動腳本

用法：
  ./start.sh [選項]

選項：
  --install          強制執行 npm install（即使 node_modules 已存在）
  --clean            刪除所有 node_modules 後重新安裝
  --backend-only     只啟動 backend（Fastify API）
  --frontend-only    只啟動 frontend（Vite dev server）
  --port <number>    設定統一對外 port（預設 8888）
  --https            使用 HTTPS 模式啟動（若無憑證會自動產生本機 self-signed 憑證）
  --https-key <path> HTTPS private key 路徑（預設 .certs/localhost-key.pem）
  --https-cert <path> HTTPS certificate 路徑（預設 .certs/localhost-cert.pem）
  --no-watch-build   all 模式下不啟動 frontend build --watch
  --dev              frontend build 使用 development mode + sourcemap
  -h, --help         顯示本說明

預設行為：
  1. 載入 nvm（若存在）並切換到 .nvmrc 指定的 Node 版本
  2. 檢查 Node >= 20、npm >= 10
  3. 檢查 poppler-utils（pdftoppm、pdfinfo）
  4. 若無 .env 則從 .env.example 複製並暫停等待編輯
  5. 建立 storage/、data/ 目錄
  6. 必要時執行 npm install
  7. all 模式：frontend build 後由 backend（production static）同一 port 對外

範例：
  ./start.sh                       # 一般啟動
  ./start.sh --install             # 強制重裝依賴後啟動
  ./start.sh --clean               # 清除 node_modules 後重裝並啟動
  ./start.sh --backend-only        # 只啟動 backend
  ./start.sh --frontend-only       # 只啟動 frontend
  ./start.sh --port 8888           # 單一入口 port=8888
  ./start.sh --https --port 8888   # 以 HTTPS 模式啟動 https://localhost:8888
EOF
}

# ──────────────────────────────────────────────────────────────────────────────
# 參數解析
# ──────────────────────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --install)        FORCE_INSTALL=1; shift ;;
    --clean)          CLEAN_INSTALL=1; FORCE_INSTALL=1; shift ;;
    --backend-only)   MODE="backend"; shift ;;
    --frontend-only)  MODE="frontend"; shift ;;
    --port)
      if [[ $# -lt 2 ]]; then
        log_error "--port 需要一個數字參數"
        exit 2
      fi
      PORT="$2"
      shift 2
      ;;
    --no-watch-build) FRONTEND_BUILD_WATCH=0; shift ;;
    --dev)            DEV_MODE=1; shift ;;
    --https)          HTTPS_MODE=1; shift ;;
    --https-key)
      if [[ $# -lt 2 ]]; then
        log_error "--https-key 需要一個路徑參數"
        exit 2
      fi
      HTTPS_KEY_PATH="$2"
      shift 2
      ;;
    --https-cert)
      if [[ $# -lt 2 ]]; then
        log_error "--https-cert 需要一個路徑參數"
        exit 2
      fi
      HTTPS_CERT_PATH="$2"
      shift 2
      ;;
    -h|--help)        print_help; exit 0 ;;
    *)
      log_error "未知選項：$1"
      echo
      print_help
      exit 2
      ;;
  esac
done

if ! [[ "$PORT" =~ ^[0-9]+$ ]] || [[ "$PORT" -lt 1 || "$PORT" -gt 65535 ]]; then
  log_error "port 必須是 1~65535 的整數（目前：$PORT）"
  exit 2
fi

printf '%s🎬 makeslide 啟動中…%s\n' "$C_BOLD" "$C_RESET"

# ──────────────────────────────────────────────────────────────────────────────
# Step 1: 載入 nvm 並套用 .nvmrc
# ──────────────────────────────────────────────────────────────────────────────
log_step "載入 nvm"
NVM_SH=""
if [[ -n "${NVM_DIR:-}" && -s "${NVM_DIR}/nvm.sh" ]]; then
  NVM_SH="${NVM_DIR}/nvm.sh"
elif [[ -s "$HOME/.nvm/nvm.sh" ]]; then
  NVM_SH="$HOME/.nvm/nvm.sh"
fi

if [[ -n "$NVM_SH" ]]; then
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  # shellcheck disable=SC1090
  \. "$NVM_SH"
  if [[ -f "$SCRIPT_DIR/.nvmrc" ]]; then
    if ! nvm use >/dev/null 2>&1; then
      log_warn "nvm 尚未安裝 $(cat "$SCRIPT_DIR/.nvmrc") 對應版本，嘗試 nvm install"
      nvm install
      nvm use
    fi
    log_info "nvm 使用 $(node -v)"
  else
    log_warn "找不到 .nvmrc，沿用目前 Node 版本"
  fi
else
  log_warn "未偵測到 nvm（跳過版本切換）。建議安裝：https://github.com/nvm-sh/nvm"
fi

# ──────────────────────────────────────────────────────────────────────────────
# Step 2: 檢查 Node / npm 版本
# ──────────────────────────────────────────────────────────────────────────────
log_step "檢查 Node / npm 版本"
if ! command -v node >/dev/null 2>&1; then
  log_error "找不到 node。請安裝 Node.js 20 或更新版本。"
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  log_error "找不到 npm。請安裝 npm 10 或更新版本。"
  exit 1
fi

NODE_VER="$(node -v | sed 's/^v//')"
NODE_MAJOR="${NODE_VER%%.*}"
if [[ -z "$NODE_MAJOR" || "$NODE_MAJOR" -lt 20 ]]; then
  log_error "Node 版本過舊：v${NODE_VER}（需要 >= 20）"
  log_error "  建議：安裝 nvm 後 'nvm install 20 && nvm use 20'，或升級系統 Node。"
  exit 1
fi
log_info "Node v${NODE_VER} / npm $(npm -v)"

# ──────────────────────────────────────────────────────────────────────────────
# Step 3: 檢查 poppler-utils
# ──────────────────────────────────────────────────────────────────────────────
log_step "檢查 poppler-utils（pdftoppm / pdfinfo）"
MISSING_POPPLER=0
command -v pdftoppm >/dev/null 2>&1 || MISSING_POPPLER=1
command -v pdfinfo  >/dev/null 2>&1 || MISSING_POPPLER=1
if [[ "$MISSING_POPPLER" -eq 1 ]]; then
  log_warn "找不到 pdftoppm / pdfinfo。M2 背景處理管線將無法轉圖。"
  printf '%s    Ubuntu / Debian:%s  sudo apt-get install poppler-utils\n' "$C_WARN" "$C_RESET" >&2
  printf '%s    macOS (Homebrew):%s brew install poppler\n'               "$C_WARN" "$C_RESET" >&2
  log_warn "（僅警告，不中斷啟動）"
else
  log_info "poppler-utils 已安裝"
fi

# ──────────────────────────────────────────────────────────────────────────────
# Step 4: 檢查 .env
# ──────────────────────────────────────────────────────────────────────────────
log_step "檢查 .env"
if [[ ! -f "$SCRIPT_DIR/.env" ]]; then
  if [[ -f "$SCRIPT_DIR/.env.example" ]]; then
    cp "$SCRIPT_DIR/.env.example" "$SCRIPT_DIR/.env"
    log_info "已從 .env.example 複製出 .env"
    log_warn "請編輯 .env 填入 OPENAI_API_KEY（M3/M4 階段必要）"
    printf '%s按 Enter 繼續，或 Ctrl+C 中止以先行編輯…%s' "$C_WARN" "$C_RESET"
    # shellcheck disable=SC2162
    read _ || true
  else
    log_error "找不到 .env 也找不到 .env.example，無法繼續。"
    exit 1
  fi
else
  log_info ".env 已存在"
  if grep -Eq '^OPENAI_API_KEY=\s*$' "$SCRIPT_DIR/.env"; then
    log_warn "OPENAI_API_KEY 為空（M1/M2 可略過，但 M3+ 會失敗）"
  fi
fi

# ──────────────────────────────────────────────────────────────────────────────
# Step 5: 建立必要目錄
# ──────────────────────────────────────────────────────────────────────────────
log_step "建立必要目錄"
mkdir -p "$SCRIPT_DIR/storage" "$SCRIPT_DIR/data"
log_info "storage/、data/ 就緒"

# ──────────────────────────────────────────────────────────────────────────────
# Step 5.5: HTTPS 憑證
# ──────────────────────────────────────────────────────────────────────────────
if [[ "$HTTPS_MODE" -eq 1 ]]; then
  log_step "準備 HTTPS 憑證"
  mkdir -p "$(dirname "$HTTPS_KEY_PATH")" "$(dirname "$HTTPS_CERT_PATH")"
  if [[ ! -f "$HTTPS_KEY_PATH" || ! -f "$HTTPS_CERT_PATH" ]]; then
    if ! command -v openssl >/dev/null 2>&1; then
      log_error "找不到 openssl，無法自動產生 HTTPS 憑證；請安裝 openssl 或用 --https-key/--https-cert 指定既有憑證。"
      exit 1
    fi
    log_warn "找不到 HTTPS 憑證，產生本機 self-signed 憑證（瀏覽器會顯示不受信任警告）"
    openssl req -x509 -newkey rsa:2048 -nodes \
      -keyout "$HTTPS_KEY_PATH" \
      -out "$HTTPS_CERT_PATH" \
      -days 365 \
      -subj "/CN=localhost" \
      -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" >/dev/null 2>&1
  fi
  log_info "HTTPS key：$HTTPS_KEY_PATH"
  log_info "HTTPS cert：$HTTPS_CERT_PATH"
fi

# ──────────────────────────────────────────────────────────────────────────────
# Step 6: 依賴安裝
# ──────────────────────────────────────────────────────────────────────────────
log_step "檢查 / 安裝依賴"
if [[ "$CLEAN_INSTALL" -eq 1 ]]; then
  log_warn "--clean：移除 node_modules"
  rm -rf "$SCRIPT_DIR/node_modules" \
         "$SCRIPT_DIR/backend/node_modules" \
         "$SCRIPT_DIR/frontend/node_modules"
fi

need_install=0
if [[ "$FORCE_INSTALL" -eq 1 ]]; then
  need_install=1
elif [[ ! -d "$SCRIPT_DIR/node_modules" ]]; then
  need_install=1
elif [[ ! -f "$SCRIPT_DIR/node_modules/.package-lock.json" ]]; then
  need_install=1
elif [[ -f "$SCRIPT_DIR/package-lock.json" \
        && "$SCRIPT_DIR/package-lock.json" -nt "$SCRIPT_DIR/node_modules/.package-lock.json" ]]; then
  log_warn "package-lock.json 比 node_modules 新，重新安裝依賴"
  need_install=1
fi

if [[ "$need_install" -eq 1 ]]; then
  log_info "執行 npm install"
  npm install
else
  log_info "依賴已是最新（跳過 npm install；用 --install 強制重裝）"
fi

# ──────────────────────────────────────────────────────────────────────────────
# Step 7: 啟動 dev server
# ──────────────────────────────────────────────────────────────────────────────
log_step "啟動 dev server (mode=$MODE)"
if [[ "$HTTPS_MODE" -eq 1 ]]; then
  log_info "HTTPS 模式：啟用"
fi

CHILD_PID=""
cleanup() {
  local code=$?
  if [[ -n "$CHILD_PID" ]] && kill -0 "$CHILD_PID" 2>/dev/null; then
    log_warn "收到中斷訊號，正在終結子程序 (pid=$CHILD_PID)…"
    # 先送 TERM，給 concurrently / vite / tsx 機會收尾
    kill -TERM "$CHILD_PID" 2>/dev/null || true
    # 最多等 5 秒
    for _ in 1 2 3 4 5; do
      kill -0 "$CHILD_PID" 2>/dev/null || break
      sleep 1
    done
    # 仍存活則強制終結整個 process group
    if kill -0 "$CHILD_PID" 2>/dev/null; then
      kill -KILL -"$CHILD_PID" 2>/dev/null || kill -KILL "$CHILD_PID" 2>/dev/null || true
    fi
  fi
  exit "$code"
}
trap cleanup INT TERM

case "$MODE" in
  all)
    log_info "all 模式使用單一入口 port：$PORT"
    if [[ "$DEV_MODE" -eq 1 ]]; then
      log_info "先建置 frontend 靜態檔（dev mode + sourcemap，供 backend static serving）"
      npm --workspace frontend run build -- --mode development --sourcemap
    else
      log_info "先建置 frontend 靜態檔（供 backend static serving）"
      npm --workspace frontend run build
    fi

    if [[ "$FRONTEND_BUILD_WATCH" -eq 1 ]]; then
      if [[ "$DEV_MODE" -eq 1 ]]; then
        log_info "啟動 frontend build watcher（dev mode + sourcemap，背景）"
        npm --workspace frontend run build -- --mode development --sourcemap --watch &
      else
        log_info "啟動 frontend build watcher（背景）"
        npm --workspace frontend run build -- --watch &
      fi
      WATCH_PID=$!
      # shellcheck disable=SC2034
      CHILD_PID=""
      # 以 backend 作為主前景程序，watcher 由 cleanup 一併回收
      cleanup() {
        local code=$?
        if [[ -n "${WATCH_PID:-}" ]] && kill -0 "$WATCH_PID" 2>/dev/null; then
          kill -TERM "$WATCH_PID" 2>/dev/null || true
        fi
        if [[ -n "$CHILD_PID" ]] && kill -0 "$CHILD_PID" 2>/dev/null; then
          kill -TERM "$CHILD_PID" 2>/dev/null || true
          for _ in 1 2 3 4 5; do
            kill -0 "$CHILD_PID" 2>/dev/null || break
            sleep 1
          done
          if kill -0 "$CHILD_PID" 2>/dev/null; then
            kill -KILL -"$CHILD_PID" 2>/dev/null || kill -KILL "$CHILD_PID" 2>/dev/null || true
          fi
        fi
        exit "$code"
      }
      trap cleanup INT TERM
    fi

    log_info "以 production static 模式啟動 backend（對外 port=$PORT）"
    if [[ "$HTTPS_MODE" -eq 1 ]]; then
      PORT="$PORT" NODE_ENV=production HTTPS_KEY_PATH="$HTTPS_KEY_PATH" HTTPS_CERT_PATH="$HTTPS_CERT_PATH" npm run dev:backend &
    else
      PORT="$PORT" NODE_ENV=production npm run dev:backend &
    fi
    ;;
  backend)
    log_info "執行 npm run dev:backend（port=$PORT）"
    if [[ "$HTTPS_MODE" -eq 1 ]]; then
      PORT="$PORT" HTTPS_KEY_PATH="$HTTPS_KEY_PATH" HTTPS_CERT_PATH="$HTTPS_CERT_PATH" npm run dev:backend &
    else
      PORT="$PORT" npm run dev:backend &
    fi
    ;;
  frontend)
    log_info "執行 npm run dev:frontend（vite port=$PORT）"
    if [[ "$HTTPS_MODE" -eq 1 ]]; then
      npm run dev:frontend -- --port "$PORT" --host 0.0.0.0 --https --key "$HTTPS_KEY_PATH" --cert "$HTTPS_CERT_PATH" &
    else
      npm run dev:frontend -- --port "$PORT" &
    fi
    ;;
esac

CHILD_PID=$!
wait "$CHILD_PID"
