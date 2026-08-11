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
  # 上游的建置門檻。寫成變數是為了讓測試能餵一個假的進來，數字本身出自 audio.cpp：
  # `cmake_minimum_required(VERSION 3.20)` 與 `find_package(CUDAToolkit 12.0 REQUIRED)`。
  # 驅動 525 則是 NVIDIA 對 CUDA 12 runtime 訂的下限——它管的是「編出來跑不跑得動」。
  AUDIOCPP_MIN_CMAKE="${AUDIOCPP_MIN_CMAKE:-3.20}"
  AUDIOCPP_MIN_CUDA="${AUDIOCPP_MIN_CUDA:-12.0}"
  AUDIOCPP_MIN_NVIDIA_DRIVER="${AUDIOCPP_MIN_NVIDIA_DRIVER:-525}"
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

# 版本字串比較：$1 >= $2 回 0。只比前三段數字，"570.133.07"（驅動）與 "12.4.131"（nvcc）都適用。
# 刻意純 bash 而不呼叫 sort -V：這個檔案的測試沙箱只放進腳本真正用到的幾個工具，為了比大小
# 多一個相依不划算。
audiocpp_version_ge() {
  local i h w
  local -a have=() want=()
  IFS='.' read -ra have <<<"$1"
  IFS='.' read -ra want <<<"$2"
  for i in 0 1 2; do
    h="${have[$i]:-0}"; h="${h%%[!0-9]*}"; h="${h:-0}"
    w="${want[$i]:-0}"; w="${w%%[!0-9]*}"; w="${w:-0}"
    (( 10#$h > 10#$w )) && return 0
    (( 10#$h < 10#$w )) && return 1
  done
  return 0
}

# 從 `<cmd> --version` 的輸出裡取第一個 x.y[.z]。
audiocpp_tool_version() {
  "$@" --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+(\.[0-9]+)?' | sed -n '1p'
}

# 這個編譯器有沒有浮點版的 std::to_chars？audio.cpp 的 src/framework/debug/trace.cpp 用了它，
# 而它是 libstdc++ 11 才有的東西。這裡直接編一小段來問，不比對編譯器版號——clang 用的是系統
# 那份 libstdc++，版號對不上它自己的版本，光看 `--version` 會判錯。
audiocpp_cxx_has_float_to_chars() {
  local cxx="$1" src rc=1
  src="$(mktemp "${TMPDIR:-/tmp}/audiocpp-tochars-XXXXXX.cpp" 2>/dev/null)" || return 1
  cat >"$src" <<'EOF'
#include <charconv>
int main() {
  char buf[32];
  const auto r = std::to_chars(buf, buf + sizeof(buf), 1.5, std::chars_format::general);
  return r.ec == std::errc{} ? 0 : 1;
}
EOF
  "$cxx" -std=c++17 -fsyntax-only "$src" >/dev/null 2>&1 && rc=0
  rm -f "$src"
  return "$rc"
}

# 這台機器上第一個能用的 C++ 編譯器（與下面「缺建置工具」那段找的是同一組）。$CXX 優先：
# 系統編譯器太舊而另外裝了一份時，cmake 認的是 $CXX，這裡要問的也必須是同一個——否則會用
# /usr/bin/c++ 的答案，去否決一個其實建得起來的環境。
audiocpp_find_cxx() {
  local candidate
  if [[ -n "${CXX:-}" ]] && command -v "$CXX" >/dev/null 2>&1; then
    command -v "$CXX"
    return 0
  fi
  for candidate in c++ g++ clang++; do
    command -v "$candidate" >/dev/null 2>&1 && { command -v "$candidate"; return 0; }
  done
  return 1
}

# clone／編譯之前先驗門檻。這裡問的不是「有沒有裝」（那是下面 missing 那段）而是「夠不夠新」，
# 而 audio.cpp 對兩者都有要求。不先問的代價不是「失敗」，是「編了十幾分鐘才失敗」——在
# Ubuntu 20.04（g++-9、cmake 3.16）上實際發生過：一路編到 258/704 才報 std::chars_format 未宣告。
#
# 回 0 表示可以開始建，實際要用的 backend 放在 AUDIOCPP_BUILD_BACKEND。GPU 那兩項（CUDA
# Toolkit、驅動）不足時只把它降成 cpu 而不擋建置——與執行期 GPU 不可用就退回 CPU 同一個道理，
# 差別只在這裡是「事先就知道」，省掉一次注定失敗的 GPU 建置。
audiocpp_check_build_prereqs() {
  local backend="$1" version cxx nvcc driver
  audiocpp_init_paths
  AUDIOCPP_BUILD_BACKEND="$backend"

  version="$(audiocpp_tool_version cmake)"
  if [[ -n "$version" ]] && ! audiocpp_version_ge "$version" "$AUDIOCPP_MIN_CMAKE"; then
    log_warn "cmake $version 太舊，audio.cpp 要 $AUDIOCPP_MIN_CMAKE 以上——不建置"
    printf '%s    不需要 root：%s python3 -m pip install --user "cmake>=%s"\n' \
      "$C_WARN" "$C_RESET" "$AUDIOCPP_MIN_CMAKE" >&2
    return 1
  fi

  if cxx="$(audiocpp_find_cxx)" && ! audiocpp_cxx_has_float_to_chars "$cxx"; then
    log_warn "$cxx 沒有浮點版的 std::to_chars（要 GCC 11／libstdc++ 11 以上）——不建置"
    printf '%s    Ubuntu 20.04 的 apt 最高只有 g++-10，兩個都不夠；不需要 root 的裝法：%s\n' "$C_WARN" "$C_RESET" >&2
    printf '%s      conda create -p ~/toolchain/gcc12 -c conda-forge gcc_linux-64=12 gxx_linux-64=12%s\n' "$C_WARN" "$C_RESET" >&2
    printf '%s      export CC=~/toolchain/gcc12/bin/x86_64-conda-linux-gnu-gcc CXX=~/toolchain/gcc12/bin/x86_64-conda-linux-gnu-g++%s\n' "$C_WARN" "$C_RESET" >&2
    return 1
  fi

  [[ "$AUDIOCPP_BUILD_BACKEND" == "cuda" ]] || return 0

  nvcc="$(command -v nvcc 2>/dev/null || true)"
  [[ -z "$nvcc" && -x /usr/local/cuda/bin/nvcc ]] && nvcc=/usr/local/cuda/bin/nvcc
  version=""
  [[ -n "$nvcc" ]] && version="$(audiocpp_tool_version "$nvcc")"
  if [[ -z "$version" ]] || ! audiocpp_version_ge "$version" "$AUDIOCPP_MIN_CUDA"; then
    log_warn "CUDA Toolkit ${version:-未安裝}，audio.cpp 的 CUDA backend 要 $AUDIOCPP_MIN_CUDA 以上——改用 CPU 建置"
    printf '%s    要 GPU 版的話，toolkit 可以裝在家目錄（不需要 root，也不會動到系統的 CUDA）：%s\n' "$C_WARN" "$C_RESET" >&2
    printf '%s      sh cuda_12.4.1_*_linux.run --silent --toolkit --toolkitpath=$HOME/cuda-12.4 --override%s\n' "$C_WARN" "$C_RESET" >&2
    printf '%s      export CUDACXX=$HOME/cuda-12.4/bin/nvcc CUDAToolkit_ROOT=$HOME/cuda-12.4%s\n' "$C_WARN" "$C_RESET" >&2
    AUDIOCPP_BUILD_BACKEND=cpu
    return 0
  fi

  if command -v nvidia-smi >/dev/null 2>&1; then
    driver="$(nvidia-smi --query-gpu=driver_version --format=csv,noheader 2>/dev/null | sed -n '1p')"
    driver="${driver// /}"
    if [[ -n "$driver" ]] && ! audiocpp_version_ge "$driver" "$AUDIOCPP_MIN_NVIDIA_DRIVER"; then
      # 這一項不是編不編得起來的問題：CUDA $AUDIOCPP_MIN_CUDA 編出來的執行檔在舊驅動上啟動時
      # 會丟 "CUDA driver version is insufficient"，然後每一段都退回 CPU——花了 GPU 建置的時間，
      # 拿到的還是 CPU 的速度。
      log_warn "NVIDIA 驅動 $driver 太舊，CUDA $AUDIOCPP_MIN_CUDA 的執行檔需要 $AUDIOCPP_MIN_NVIDIA_DRIVER 以上——改用 CPU 建置"
      printf '%s    升級驅動（需要 root，之後要重開機）：%s sudo apt install nvidia-driver-570\n' "$C_WARN" "$C_RESET" >&2
      AUDIOCPP_BUILD_BACKEND=cpu
      return 0
    fi
  fi
  return 0
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

  # backend 要在 clone 之前決定，因為它決定了要檢查哪些門檻（CUDA 版本、驅動版本）——而門檻
  # 不過關時最省事的收場是「什麼都還沒下載」。
  backend="$(audiocpp_read_env AUDIOCPP_TTS_BACKEND)"
  if [[ -z "$backend" || "$backend" == "auto" ]]; then
    backend="$(detect_audiocpp_backend)"
    log_info "未指定 backend，依這台機器偵測為：$backend"
  fi

  if ! audiocpp_check_build_prereqs "$backend"; then
    log_warn "（僅警告，不中斷啟動；本機 TTS 在工具鏈補齊之前無法建置）"
    return 0
  fi
  backend="$AUDIOCPP_BUILD_BACKEND"

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
