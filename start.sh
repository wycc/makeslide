#!/usr/bin/env bash
# makeslide 一鍵啟動腳本
# - 載入 nvm（若存在）並切換到 .nvmrc 指定版本
# - 檢查 Node / npm / poppler-utils / .env
# - 選用 audiocpp 當 TTS 時，檢查本機 audio.cpp，缺少則自動建置
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
# 平時只有在 .env 真的選了 audiocpp 當 TTS 供應商時才檢查／建置本機引擎（見 ensure_audiocpp）。
AUDIOCPP_FORCE_INSTALL=0
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
  --install-audiocpp 即使 .env 沒選 audiocpp，也檢查／自動建置本機 TTS 引擎 audio.cpp
  --dev              frontend build 使用 development mode + sourcemap
  -h, --help         顯示本說明

預設行為：
  1. 載入 nvm（若存在）並切換到 .nvmrc 指定的 Node 版本
  2. 檢查 Node >= 20、npm >= 10
  3. 檢查 poppler-utils（pdftoppm、pdfinfo）
  4. 若無 .env 則從 .env.example 複製並暫停等待編輯
  5. 建立 storage/、data/ 目錄
  6. 必要時執行 npm install
  7. 若 .env 的 TTS_PROVIDER/SECONDARY_TTS_PROVIDER 是 audiocpp，檢查本機 audio.cpp，
     沒有就自動 clone 並建置（GPU 建不起來會自動改用 CPU；設 AUDIOCPP_AUTO_INSTALL=false 可停用）
  8. 啟動前若偵測到指定 port 已被佔用，會嘗試終止該程序以釋放 port
  9. all 模式：frontend build 後由 backend（production static）同一 port 對外

範例：
  ./start.sh                       # 一般啟動
  ./start.sh --install             # 強制重裝依賴後啟動
  ./start.sh --clean               # 清除 node_modules 後重裝並啟動
  ./start.sh --backend-only        # 只啟動 backend
  ./start.sh --frontend-only       # 只啟動 frontend
  ./start.sh --port 8888           # 單一入口 port=8888
  ./start.sh --https --port 8888   # 以 HTTPS 模式啟動 https://localhost:8888
  ./start.sh --install-audiocpp    # 順便檢查／建置本機 TTS 引擎 audio.cpp
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
    --install-audiocpp) AUDIOCPP_FORCE_INSTALL=1; shift ;;
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
# Step 6.5: 釋放已被佔用的 port
# ──────────────────────────────────────────────────────────────────────────────
log_step "檢查 port $PORT 是否已被佔用"

find_pids_on_port() {
  local port="$1"
  local pids=""

  if command -v lsof >/dev/null 2>&1; then
    pids="$(lsof -ti tcp:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  fi

  if [[ -z "$pids" ]] && command -v fuser >/dev/null 2>&1; then
    pids="$(fuser "${port}/tcp" 2>/dev/null | grep -oE '[0-9]+' || true)"
  fi

  if [[ -z "$pids" ]] && command -v ss >/dev/null 2>&1; then
    pids="$(ss -ltnp "sport = :$port" 2>/dev/null | grep -oP 'pid=\K[0-9]+' || true)"
  fi

  printf '%s\n' "$pids" | sort -u | grep -v '^$' || true
}

collect_child_pids() {
  local parent="$1"
  local children=""
  local child=""

  if command -v pgrep >/dev/null 2>&1; then
    children="$(pgrep -P "$parent" 2>/dev/null || true)"
    while IFS= read -r child; do
      [[ -n "$child" ]] || continue
      printf '%s\n' "$child"
      collect_child_pids "$child"
    done <<< "$children"
  fi
}

terminate_process_tree() {
  local root_pid="$1"
  local signal="${2:-TERM}"
  local tree_pids=""

  [[ -n "$root_pid" ]] || return 0

  tree_pids="$(collect_child_pids "$root_pid" | tac 2>/dev/null || collect_child_pids "$root_pid")"
  while IFS= read -r pid; do
    [[ -n "$pid" ]] || continue
    kill -"$signal" "$pid" 2>/dev/null || true
  done <<< "$tree_pids"

  kill -"$signal" "$root_pid" 2>/dev/null || true
}

PIDS_ON_PORT="$(find_pids_on_port "$PORT")"
if [[ -n "$PIDS_ON_PORT" ]]; then
  log_warn "Port $PORT 已被下列程序佔用，將終止以釋放：$(tr '\n' ' ' <<< "$PIDS_ON_PORT")"
  while IFS= read -r pid; do
    [[ -n "$pid" ]] || continue
    terminate_process_tree "$pid" TERM
  done <<< "$PIDS_ON_PORT"

  for _ in 1 2 3 4 5; do
    PIDS_ON_PORT="$(find_pids_on_port "$PORT")"
    [[ -z "$PIDS_ON_PORT" ]] && break
    sleep 1
  done

  PIDS_ON_PORT="$(find_pids_on_port "$PORT")"
  if [[ -n "$PIDS_ON_PORT" ]]; then
    log_warn "程序仍未結束，強制終止：$(tr '\n' ' ' <<< "$PIDS_ON_PORT")"
    while IFS= read -r pid; do
      [[ -n "$pid" ]] || continue
      terminate_process_tree "$pid" KILL
    done <<< "$PIDS_ON_PORT"
  fi
else
  log_info "Port $PORT 未被佔用"
fi

# ──────────────────────────────────────────────────────────────────────────────
# Step 6.5: 依 .env 啟動本機 Jupyter server（供後端同源反向代理）
# ──────────────────────────────────────────────────────────────────────────────
# 確保本機自簽憑證存在（重用 --https 的 HTTPS_KEY_PATH/HTTPS_CERT_PATH）；供 https 版 Jupyter 使用。
ensure_self_signed_cert() {
  mkdir -p "$(dirname "$HTTPS_KEY_PATH")" "$(dirname "$HTTPS_CERT_PATH")"
  [[ -f "$HTTPS_KEY_PATH" && -f "$HTTPS_CERT_PATH" ]] && return 0
  if ! command -v openssl >/dev/null 2>&1; then
    log_warn "找不到 openssl，無法自動產生自簽憑證"
    return 1
  fi
  log_warn "產生本機 self-signed 憑證：$HTTPS_CERT_PATH"
  openssl req -x509 -newkey rsa:2048 -nodes \
    -keyout "$HTTPS_KEY_PATH" -out "$HTTPS_CERT_PATH" \
    -days 365 -subj "/CN=localhost" \
    -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" >/dev/null 2>&1
}

# 讀 .env 中單一變數的值（取最後一筆、去行內註解/引號/前後空白）。
read_env_var() {
  local key="$1" file="$SCRIPT_DIR/.env" line=""
  [[ -f "$file" ]] || return 0
  line="$(grep -E "^[[:space:]]*${key}=" "$file" | tail -1)" || return 0
  line="${line#*=}"
  line="${line%%#*}"
  printf '%s' "$line" | sed -E "s/^[[:space:]]+//; s/[[:space:]]+$//; s/^[\"']//; s/[\"']$//"
}

JUPYTER_VENV="$SCRIPT_DIR/.jupyter-venv"
JUPYTER_BIN=""
# 取得一個 jupyter_server >= 2 的 jupyter（@jupyterlab/services 的新 kernel WebSocket protocol
# 需要 2.x；舊版會導致前端「執行了卻收不到輸出」）。優先用專用 venv；系統版本夠新則用系統；
# 都不行則自動建 venv 安裝新版。結果放全域 JUPYTER_BIN。取得成功回 0。
ensure_jupyter_bin() {
  local sysbin sysver major py venvbin="$JUPYTER_VENV/bin/jupyter" condaprefix condabin condaver condamajor
  # 設定 JUPYTER_CONDA_PREFIX：指定 notebook kernel 要用的 Anaconda/Conda 環境 prefix（內含 bin/jupyter）。
  # 設了就優先用它，讓 cell 在該環境（含其 numpy/pandas 等套件）中執行；該環境需有 jupyter_server >= 2 + ipykernel。
  condaprefix="$(read_env_var JUPYTER_CONDA_PREFIX)"
  if [[ -n "$condaprefix" ]]; then
    condabin="$condaprefix/bin/jupyter"
    if [[ -x "$condabin" ]]; then
      condaver="$("$condabin" server --version 2>/dev/null | head -1)"; condamajor="${condaver%%.*}"
      if [[ "$condamajor" =~ ^[0-9]+$ ]] && (( condamajor >= 2 )); then
        log_info "Jupyter 使用指定的 Conda 環境：$condaprefix（jupyter_server ${condaver}）"
        JUPYTER_BIN="$condabin"; return 0
      fi
      log_warn "JUPYTER_CONDA_PREFIX=$condaprefix 的 jupyter_server 過舊（${condaver:-未知}，需 >= 2）；請在該環境執行 \"conda install -y 'jupyter_server>=2' ipykernel\"。改用其他 jupyter"
    else
      log_warn "JUPYTER_CONDA_PREFIX=$condaprefix 下找不到 bin/jupyter；請在該環境執行 \"conda install -y jupyter ipykernel\"。改用其他 jupyter"
    fi
  fi
  if [[ -x "$venvbin" ]]; then JUPYTER_BIN="$venvbin"; return 0; fi
  sysbin="$(command -v jupyter || true)"
  [[ -z "$sysbin" && -x /opt/Anaconda3/bin/jupyter ]] && sysbin=/opt/Anaconda3/bin/jupyter
  if [[ -n "$sysbin" ]]; then
    sysver="$("$sysbin" server --version 2>/dev/null | head -1)"
    major="${sysver%%.*}"
    if [[ "$major" =~ ^[0-9]+$ ]] && (( major >= 2 )); then JUPYTER_BIN="$sysbin"; return 0; fi
    log_warn "系統 jupyter_server 版本過舊（${sysver:-未知}），前端需要 >= 2；建立專用 venv 安裝新版"
  else
    log_warn "找不到 jupyter，建立專用 venv 安裝 jupyter_server"
  fi
  py="$(command -v python3 || command -v python || echo /opt/Anaconda3/bin/python)"
  if ! "$py" -m venv "$JUPYTER_VENV" >/dev/null 2>&1; then log_warn "建立 venv 失敗（缺 python venv 模組？）"; return 1; fi
  log_info "安裝 jupyter_server + ipykernel 到 .jupyter-venv（首次較久，需網路）…"
  if ! "$JUPYTER_VENV/bin/pip" install --quiet --upgrade pip jupyter_server ipykernel >/dev/null 2>&1; then
    log_warn "pip 安裝 jupyter_server 失敗（需網路）；可手動執行 \"$JUPYTER_VENV/bin/pip install jupyter_server ipykernel\"，或改用系統已安裝的 jupyter_server >= 2"; return 1
  fi
  "$JUPYTER_VENV/bin/python" -m ipykernel install --sys-prefix --name python3 --display-name "Python 3" >/dev/null 2>&1 || true
  JUPYTER_BIN="$venvbin"; return 0
}

# 自動掃描 Conda/Anaconda 環境並註冊為 Jupyter kernelspec，讓前端「執行環境」下拉選單自動列出，
# 免手動安裝 nb_conda_kernels。每個含 ipykernel 的環境以 `<env>/bin/python -m ipykernel install
# --user` 註冊（寫入 user kernel 目錄，任何 jupyter 都找得到）。設 JUPYTER_SCAN_CONDA_ENVS=false 停用。
register_conda_kernels() {
  local scan base condacmd envs_dir env envname pybin registered=0 d
  scan="$(read_env_var JUPYTER_SCAN_CONDA_ENVS)"
  [[ "$scan" == "false" ]] && return 0
  # 決定 conda base：優先 JUPYTER_CONDA_PREFIX（若指向某 env 則往上取 base）；否則問 conda；再否則常見路徑。
  base="$(read_env_var JUPYTER_CONDA_PREFIX)"
  [[ "$base" == */envs/* ]] && base="${base%/envs/*}"
  if [[ -z "$base" ]]; then
    condacmd="$(command -v conda || true)"
    [[ -n "$condacmd" ]] && base="$("$condacmd" info --base 2>/dev/null || true)"
  fi
  if [[ -z "$base" ]]; then
    for d in /opt/Anaconda3 "$HOME/anaconda3" "$HOME/miniconda3" /opt/conda /opt/miniconda3; do
      [[ -d "$d" ]] && { base="$d"; break; }
    done
  fi
  [[ -z "$base" || ! -d "$base" ]] && return 0
  # 環境清單：base 自身 + base/envs/* 各目錄。
  local prefixes=("$base")
  envs_dir="$base/envs"
  if [[ -d "$envs_dir" ]]; then
    for env in "$envs_dir"/*/; do [[ -d "$env" ]] && prefixes+=("${env%/}"); done
  fi
  for env in "${prefixes[@]}"; do
    pybin="$env/bin/python"
    [[ -x "$pybin" ]] || continue
    "$pybin" -c "import ipykernel" >/dev/null 2>&1 || continue   # 沒 ipykernel 的環境跳過
    if [[ "$env" == "$base" ]]; then envname="base"; else envname="$(basename "$env")"; fi
    if "$pybin" -m ipykernel install --user --name "conda-$envname" \
         --display-name "Python ($envname)" >/dev/null 2>&1; then
      registered=$((registered + 1))
    fi
  done
  (( registered > 0 )) && log_info "已自動掃描並註冊 $registered 個 Conda 環境為 Jupyter kernel（可於前端「執行環境」下拉選單切換）"
  return 0
}

JUPYTER_PID=""
# 僅在 JUPYTER_ENABLED=true 且設了 JUPYTER_PROXY_TARGET 時，於本機啟動 Jupyter server，
# 讓後端可把 <NB_PREFIX><JUPYTER_PROXY_PREFIX>/* 同源反向代理到它（見 backend/src/routes/jupyterProxy.ts）。
# base_url 對齊掛載路徑、port/host 取自 JUPYTER_PROXY_TARGET；找不到 jupyter 只警告不中斷 MakeSlide。
start_jupyter() {
  local enabled target prefix nbp base hostport jhost jport jbin jlog scheme
  local ssl_args=()
  enabled="$(read_env_var JUPYTER_ENABLED)"
  target="$(read_env_var JUPYTER_PROXY_TARGET)"
  if [[ "$enabled" != "true" || -z "$target" ]]; then
    log_info "未啟用 Jupyter 後端代理（JUPYTER_ENABLED!=true 或未設 JUPYTER_PROXY_TARGET），略過啟動 Jupyter server"
    return 0
  fi

  prefix="$(read_env_var JUPYTER_PROXY_PREFIX)"; [[ -n "$prefix" ]] || prefix="/jupyter"
  nbp="$(read_env_var NB_PREFIX)"
  base="${nbp}${prefix}"
  hostport="${target#*://}"; hostport="${hostport%%/*}"
  jhost="${hostport%%:*}"; jport="${hostport##*:}"
  [[ "$jport" == "$hostport" ]] && jport=8888   # target 未帶 port 時預設 8888
  [[ -n "$jhost" ]] || jhost=127.0.0.1
  if [[ "$jport" == "$PORT" ]]; then
    log_warn "JUPYTER_PROXY_TARGET 的 port ($jport) 與後端 PORT ($PORT) 相同，會造成衝突；請在 .env 將 Jupyter 改到不同 port（例如 https://127.0.0.1:8899）"
  fi

  if ! ensure_jupyter_bin; then
    log_warn "無法取得夠新的 jupyter，略過啟動 Jupyter server（notebook 就地執行將無法連線）"
    return 0
  fi
  jbin="$JUPYTER_BIN"
  if [[ -z "$jbin" ]]; then
    log_warn "找不到 jupyter 執行檔，略過啟動 Jupyter server（notebook 就地執行將無法連線）"
    return 0
  fi
  register_conda_kernels

  if [[ -n "$(find_pids_on_port "$jport")" ]]; then
    log_info "port $jport 已有服務在監聽，沿用既有 Jupyter server（不另外啟動）"
    return 0
  fi

  # https target：以自簽憑證啟用 SSL（後端代理對 loopback 自簽憑證略過驗證）。
  scheme="${target%%://*}"
  if [[ "$scheme" == "https" ]]; then
    if ensure_self_signed_cert; then
      ssl_args=(--ServerApp.certfile="$HTTPS_CERT_PATH" --ServerApp.keyfile="$HTTPS_KEY_PATH")
    else
      log_warn "無法準備憑證，Jupyter 仍以 http 啟動——但 JUPYTER_PROXY_TARGET 是 https，後端代理會連不上；請安裝 openssl 或把 target 改回 http"
    fi
  fi

  jlog="$SCRIPT_DIR/jupyter.log"
  log_info "啟動 Jupyter server（$scheme，base_url=$base，位址 ${jhost}:${jport}，log→jupyter.log）"
  "$jbin" server \
    --ServerApp.base_url="$base" \
    ${ssl_args[@]+"${ssl_args[@]}"} \
    --ServerApp.token='' --ServerApp.password='' \
    --ServerApp.disable_check_xsrf=True \
    --ServerApp.allow_origin='*' \
    --ip="$jhost" --port="$jport" --no-browser \
    > "$jlog" 2>&1 &
  JUPYTER_PID=$!
  log_info "Jupyter server 已啟動（pid=$JUPYTER_PID）"
}

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
  if [[ -n "${JUPYTER_PID:-}" ]] && kill -0 "$JUPYTER_PID" 2>/dev/null; then
    log_warn "終結 Jupyter server (pid=$JUPYTER_PID)…"
    terminate_process_tree "$JUPYTER_PID" TERM
  fi
  if [[ -n "$CHILD_PID" ]] && kill -0 "$CHILD_PID" 2>/dev/null; then
    log_warn "收到中斷訊號，正在終結子程序 (pid=$CHILD_PID)…"
    # 先送 TERM 給整棵子程序樹，避免 npm/tsx/vite/backend 留下 orphan process 佔住 port
    terminate_process_tree "$CHILD_PID" TERM
    # 最多等 5 秒
    for _ in 1 2 3 4 5; do
      kill -0 "$CHILD_PID" 2>/dev/null || break
      sleep 1
    done
    # 仍存活則強制終結整棵子程序樹
    if kill -0 "$CHILD_PID" 2>/dev/null; then
      terminate_process_tree "$CHILD_PID" KILL
    fi
  fi
  exit "$code"
}
trap cleanup INT TERM

# backend／all 模式才需要本機 Jupyter 與本機 TTS 引擎（frontend-only 兩者都用不到）。
if [[ "$MODE" != "frontend" ]]; then
  # 只有 .env 選了 audiocpp 當 TTS 供應商（或加了 --install-audiocpp）時才會真的動作；
  # 缺少時自動 clone + 建置，失敗一律只警告不中斷。見 scripts/audiocpp-install.sh。
  MAKESLIDE_ROOT="$SCRIPT_DIR"
  # shellcheck source=scripts/audiocpp-install.sh
  . "$SCRIPT_DIR/scripts/audiocpp-install.sh"
  ensure_audiocpp
  start_jupyter
fi

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
        if [[ -n "${JUPYTER_PID:-}" ]] && kill -0 "$JUPYTER_PID" 2>/dev/null; then
          terminate_process_tree "$JUPYTER_PID" TERM
        fi
        if [[ -n "${WATCH_PID:-}" ]] && kill -0 "$WATCH_PID" 2>/dev/null; then
          terminate_process_tree "$WATCH_PID" TERM
        fi
        if [[ -n "$CHILD_PID" ]] && kill -0 "$CHILD_PID" 2>/dev/null; then
          terminate_process_tree "$CHILD_PID" TERM
          for _ in 1 2 3 4 5; do
            kill -0 "$CHILD_PID" 2>/dev/null || break
            sleep 1
          done
          if kill -0 "$CHILD_PID" 2>/dev/null; then
            terminate_process_tree "$CHILD_PID" KILL
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
