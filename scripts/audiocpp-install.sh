#!/usr/bin/env bash
# 檢查本機 TTS 引擎 audio.cpp（https://github.com/0xShug0/audio.cpp）是否可用，缺少時自動
# clone + 建置。見 docs/audiocpp-local-tts.md。
#
# 兩種用法：
#   1. 由 start.sh source 進去，於啟動流程中呼叫 ensure_audiocpp（自動沿用它的 log 樣式）。
#   2. 直接執行 ./scripts/audiocpp-install.sh，單獨安裝／檢查（會強制執行，不看 .env 選了誰）。
#
# 抽成獨立檔案而不是塞在 start.sh 裡，是因為這段有實際的分支邏輯（模式、既有安裝、缺工具、
# GPU 退回 CPU）需要被測試，而 start.sh 是一啟動就跑到底的流程腳本，沒辦法只叫其中一段。

AUDIOCPP_SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# 路徑一律經過這裡，而且每個進入點都先呼叫一次，不只在 source 當下算一次：`VAR=x . 這個檔案`
# 這種前置賦值在 bash 裡只在 source 期間有效，之後呼叫 ensure_audiocpp 時那些值早就沒了——
# 在 start.sh 的 `set -u` 底下會直接變成「未綁定的變數」而中斷啟動。
audiocpp_init_paths() {
  MAKESLIDE_ROOT="${MAKESLIDE_ROOT:-$AUDIOCPP_SELF_DIR}"
  AUDIOCPP_DIR="${AUDIOCPP_DIR:-$MAKESLIDE_ROOT/.audiocpp}"
  AUDIOCPP_REPO="${AUDIOCPP_REPO:-https://github.com/0xShug0/audio.cpp.git}"
  AUDIOCPP_BUILD_LOG="${AUDIOCPP_BUILD_LOG:-$MAKESLIDE_ROOT/audiocpp-build.log}"
  AUDIOCPP_ENV_FILE="${AUDIOCPP_ENV_FILE:-$MAKESLIDE_ROOT/.env}"
  # start.sh 以 .env 的 TTS_PROVIDER 決定要不要動作；直接執行時一律動作（使用者就是為了裝它才跑的）。
  AUDIOCPP_FORCE_INSTALL="${AUDIOCPP_FORCE_INSTALL:-0}"
}
audiocpp_init_paths

# start.sh 已經定義過這些就沿用它的（顏色、格式一致）；獨立執行時才自備。
if ! declare -F log_info >/dev/null 2>&1; then
  log_info()  { printf '[INFO] %s\n' "$*"; }
  log_warn()  { printf '[WARN] %s\n' "$*" >&2; }
  log_step()  { printf '\n▶ %s\n' "$*"; }
  C_WARN=''; C_RESET=''
fi

# 讀 .env 中單一變數的值（取最後一筆、去行內註解/引號/前後空白）。與 start.sh 的同名函式一致；
# 這裡以 AUDIOCPP_ENV_FILE 為準，好讓測試指向別的檔案。
audiocpp_read_env() {
  local key="$1" line=""
  [[ -f "$AUDIOCPP_ENV_FILE" ]] || return 0
  line="$(grep -E "^[[:space:]]*${key}=" "$AUDIOCPP_ENV_FILE" | tail -1)" || return 0
  line="${line#*=}"
  line="${line%%#*}"
  printf '%s' "$line" | sed -E "s/^[[:space:]]+//; s/[[:space:]]+$//; s/^[\"']//; s/[\"']$//"
}

# 這台機器該用哪個 backend 建（與 backend/src/services/audiocpp.ts 的 detectAudioCppBackend
# 同一套判斷，因為「建置時編進去的」必須涵蓋「執行時會挑的」——否則跑起來只會一直退回 CPU）。
detect_audiocpp_backend() {
  audiocpp_init_paths
  if [[ "$(uname -s)" == "Darwin" ]]; then printf 'metal'; return 0; fi
  # CUDA_VISIBLE_DEVICES=''／-1 是刻意把 GPU 藏起來的寫法，照做。
  if [[ -n "${CUDA_VISIBLE_DEVICES+x}" ]] && [[ "${CUDA_VISIBLE_DEVICES}" == "" || "${CUDA_VISIBLE_DEVICES}" == "-1" ]]; then
    printf 'cpu'; return 0
  fi
  if [[ -e /proc/driver/nvidia/version || -e /dev/nvidiactl ]] || command -v nvidia-smi >/dev/null 2>&1; then
    printf 'cuda'; return 0
  fi
  if [[ -e /dev/kfd ]]; then printf 'hip'; return 0; fi
  printf 'cpu'
}

# 建好的執行檔會落在哪，依建置腳本／產生器而定，逐個找。
find_audiocpp_bin() {
  local candidate
  for candidate in \
    "$AUDIOCPP_DIR/build/bin/audiocpp_cli" \
    "$AUDIOCPP_DIR/build/audiocpp_cli" \
    "$AUDIOCPP_DIR/build/bin/Release/audiocpp_cli"; do
    [[ -x "$candidate" ]] && { printf '%s' "$candidate"; return 0; }
  done
  return 1
}

# 依 backend 建 audiocpp_cli。優先用 repo 自己的建置腳本（它知道每個 backend 要帶哪些 cmake
# 旗標），沒有才退回直接 cmake。成功回 0。
build_audiocpp() {
  local backend="$1" jobs="${AUDIOCPP_BUILD_JOBS:-$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)}"
  log_info "建置 audio.cpp（backend=$backend，jobs=$jobs）——首次建置可能要十幾分鐘，進度寫在 audiocpp-build.log"
  if [[ "$backend" == "metal" && -x "$AUDIOCPP_DIR/scripts/build_metal.sh" ]]; then
    ( cd "$AUDIOCPP_DIR" && scripts/build_metal.sh --target audiocpp_cli ) >>"$AUDIOCPP_BUILD_LOG" 2>&1
  elif [[ -x "$AUDIOCPP_DIR/scripts/build_linux.sh" ]]; then
    ( cd "$AUDIOCPP_DIR" && scripts/build_linux.sh --backend "$backend" --target audiocpp_cli ) >>"$AUDIOCPP_BUILD_LOG" 2>&1
  else
    log_warn "audio.cpp 沒有預期的建置腳本，改用 cmake 直接建置"
    ( cd "$AUDIOCPP_DIR" \
      && cmake -B build -S . -DCMAKE_BUILD_TYPE=Release \
      && cmake --build build --target audiocpp_cli -j "$jobs" ) >>"$AUDIOCPP_BUILD_LOG" 2>&1
  fi
}

# 把建好的路徑寫回 .env，否則會變成「裝好了，但後端仍照預設去 PATH 找 audiocpp_cli 而找不到」，
# 對使用者來說跟沒裝一樣。已經有值就不動——那是使用者自己指定的。
persist_audiocpp_bin() {
  local bin="$1"
  [[ -f "$AUDIOCPP_ENV_FILE" ]] || return 0
  if grep -Eq '^[[:space:]]*AUDIOCPP_TTS_BIN=[[:space:]]*$' "$AUDIOCPP_ENV_FILE"; then
    local tmp="${AUDIOCPP_ENV_FILE}.audiocpp.tmp"
    # 用 awk 而不是 sed：路徑裡的 / 會撞到 sed 的分隔字元，而路徑正是這裡唯一要寫的東西。
    awk -v bin="$bin" '
      /^[[:space:]]*AUDIOCPP_TTS_BIN=[[:space:]]*$/ && !done { print "AUDIOCPP_TTS_BIN=" bin; done=1; next }
      { print }
    ' "$AUDIOCPP_ENV_FILE" > "$tmp" && mv "$tmp" "$AUDIOCPP_ENV_FILE"
    log_info "已將 AUDIOCPP_TTS_BIN 寫入 .env：$bin"
  elif ! grep -Eq '^[[:space:]]*AUDIOCPP_TTS_BIN=' "$AUDIOCPP_ENV_FILE"; then
    printf '\nAUDIOCPP_TTS_BIN=%s\n' "$bin" >> "$AUDIOCPP_ENV_FILE"
    log_info "已將 AUDIOCPP_TTS_BIN 加入 .env：$bin"
  fi
}

# 主流程。永遠回 0：TTS 只是整個 app 的一部分，裝不起來該警告，不該讓 MakeSlide 起不來。
ensure_audiocpp() {
  local provider secondary mode base_url configured_bin bin backend missing=()
  audiocpp_init_paths

  # 平時只在這個帳號真的會用到它時才動作。建置 audio.cpp 要 clone 一個大 repo 再編譯十幾分鐘，
  # 而絕大多數使用者走的是雲端供應商——無條件建置等於讓每個人第一次 ./start.sh 都被卡住。
  provider="$(audiocpp_read_env TTS_PROVIDER)"
  secondary="$(audiocpp_read_env SECONDARY_TTS_PROVIDER)"
  if [[ "$AUDIOCPP_FORCE_INSTALL" != "1" && "$provider" != "audiocpp" && "$secondary" != "audiocpp" ]]; then
    return 0
  fi

  log_step "檢查 audio.cpp（本機 TTS 引擎）"

  # server 模式不需要本機執行檔——語音是那台 audiocpp_server 產的，在這裡建置只是白等。
  mode="$(audiocpp_read_env AUDIOCPP_TTS_MODE)"
  base_url="$(audiocpp_read_env AUDIOCPP_TTS_BASE_URL)"
  if [[ "$mode" == "server" || ( "$mode" != "cli" && -n "$base_url" ) ]]; then
    log_info "audio.cpp 設為 server 模式（${base_url:-未填位址}），不需要本機 audiocpp_cli"
    if [[ -n "$base_url" ]] && command -v curl >/dev/null 2>&1; then
      if curl -fsS --max-time 3 "${base_url%/}/models" >/dev/null 2>&1; then
        log_info "audiocpp_server 連得上"
      else
        log_warn "連不上 audiocpp_server（${base_url%/}/models）；請先啟動它，否則語音合成會失敗"
      fi
    fi
    return 0
  fi

  configured_bin="$(audiocpp_read_env AUDIOCPP_TTS_BIN)"
  if [[ -n "$configured_bin" ]] && { [[ -x "$configured_bin" ]] || command -v "$configured_bin" >/dev/null 2>&1; }; then
    log_info "audio.cpp 已就緒：$configured_bin"
    return 0
  fi
  if [[ -z "$configured_bin" ]] && command -v audiocpp_cli >/dev/null 2>&1; then
    log_info "audio.cpp 已就緒：$(command -v audiocpp_cli)（PATH）"
    return 0
  fi
  if bin="$(find_audiocpp_bin)"; then
    log_info "audio.cpp 已建置於 .audiocpp：$bin"
    persist_audiocpp_bin "$bin"
    return 0
  fi

  if [[ "$(audiocpp_read_env AUDIOCPP_AUTO_INSTALL)" == "false" || "${AUDIOCPP_AUTO_INSTALL:-}" == "false" ]]; then
    log_warn "找不到 audiocpp_cli，且 AUDIOCPP_AUTO_INSTALL=false；請自行安裝並設定 AUDIOCPP_TTS_BIN（見 docs/audiocpp-local-tts.md）"
    return 0
  fi

  # 缺建置工具就只警告不中斷（比照 poppler 的處理）。
  command -v git   >/dev/null 2>&1 || missing+=(git)
  command -v cmake >/dev/null 2>&1 || missing+=(cmake)
  { command -v c++ >/dev/null 2>&1 || command -v g++ >/dev/null 2>&1 || command -v clang++ >/dev/null 2>&1; } \
    || missing+=("C++ compiler")
  if (( ${#missing[@]} > 0 )); then
    log_warn "找不到 audiocpp_cli，且缺少建置工具：${missing[*]}——無法自動建置"
    printf '%s    Ubuntu / Debian:%s  sudo apt-get install git cmake build-essential\n' "$C_WARN" "$C_RESET" >&2
    printf '%s    macOS (Homebrew):%s brew install git cmake\n' "$C_WARN" "$C_RESET" >&2
    log_warn "（僅警告，不中斷啟動；本機 TTS 在裝好之前無法使用）"
    return 0
  fi

  : > "$AUDIOCPP_BUILD_LOG"
  if [[ ! -d "$AUDIOCPP_DIR/.git" ]]; then
    log_info "下載 audio.cpp 原始碼到 .audiocpp（$AUDIOCPP_REPO）"
    if ! git clone --depth 1 "$AUDIOCPP_REPO" "$AUDIOCPP_DIR" >>"$AUDIOCPP_BUILD_LOG" 2>&1; then
      log_warn "clone audio.cpp 失敗（需要網路）；詳見 audiocpp-build.log。本機 TTS 暫時無法使用"
      return 0
    fi
  else
    # 刻意不自動 git pull：那會讓每次啟動都可能觸發一次十幾分鐘的重建。
    log_info "沿用既有的 .audiocpp 原始碼（要更新請自行 git -C .audiocpp pull 後刪掉 build/）"
  fi

  backend="$(audiocpp_read_env AUDIOCPP_TTS_BACKEND)"
  if [[ -z "$backend" || "$backend" == "auto" ]]; then
    backend="$(detect_audiocpp_backend)"
    log_info "未指定 backend，依這台機器偵測為：$backend"
  fi

  if ! build_audiocpp "$backend"; then
    # GPU backend 建不起來通常是缺 CUDA/ROCm toolkit，也就是「這台機器裝不了」而不是「audio.cpp
    # 壞了」；CPU backend 沒有這層相依，換它再試一次至少能得到一個能動的引擎——與執行期 GPU
    # 失敗自動退回 CPU 是同一個道理。
    if [[ "$backend" != "cpu" ]]; then
      log_warn "以 $backend 建置失敗（多半是缺 toolkit），改用 CPU 再試一次；詳見 audiocpp-build.log"
      if ! build_audiocpp cpu; then
        log_warn "audio.cpp 建置失敗（CPU 也失敗）；詳見 audiocpp-build.log。本機 TTS 暫時無法使用"
        return 0
      fi
      backend=cpu
    else
      log_warn "audio.cpp 建置失敗；詳見 audiocpp-build.log。本機 TTS 暫時無法使用"
      return 0
    fi
  fi

  if ! bin="$(find_audiocpp_bin)"; then
    log_warn "audio.cpp 建置完成但找不到 audiocpp_cli；請看 audiocpp-build.log 確認產出路徑，並手動設定 AUDIOCPP_TTS_BIN"
    return 0
  fi
  log_info "audio.cpp 建置完成（backend=$backend）：$bin"
  persist_audiocpp_bin "$bin"

  # 模型刻意不自動下載：每個家族好幾 GB，而且要挑哪一個（語言、品質、記憶體）只有使用者能決定。
  if [[ -z "$(audiocpp_read_env AUDIOCPP_TTS_MODEL)" ]]; then
    log_warn "尚未設定 AUDIOCPP_TTS_MODEL，本機 TTS 還不能用——模型不會自動下載（每個家族數 GB，且要挑語言／品質）"
    printf '%s    下載模型：%s cd %s && python3 tools/model_manager_v2.py\n' "$C_WARN" "$C_RESET" "$AUDIOCPP_DIR" >&2
    printf '%s    然後在 .env 設定 AUDIOCPP_TTS_MODEL=<模型目錄> 與 AUDIOCPP_TTS_FAMILY=<家族，如 pocket_tts>%s\n' "$C_WARN" "$C_RESET" >&2
  fi
  return 0
}

# 直接執行（而非被 source）時：強制檢查／安裝。
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  set -euo pipefail
  AUDIOCPP_FORCE_INSTALL=1
  ensure_audiocpp
fi
