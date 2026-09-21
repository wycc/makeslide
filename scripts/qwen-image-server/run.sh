#!/usr/bin/env bash
# Qwen-Image-2.1 service launcher — self-contained: copy this directory (run.sh, server.py,
# requirements.txt) to any machine with a GPU and run it. It checks and installs what the service
# needs, then starts server.py. See docs/qwen-image-local.md in the MakeSlide repo.
#
#   ./run.sh                                  # check/install, then serve on 127.0.0.1:8765; CPU offload
#                                             #   switches on by itself when the model does not fit in VRAM
#   ./run.sh --host 0.0.0.0 --token secret    # listen on every interface (always set a token)
#   ./run.sh --no-cpu-offload                 # force everything onto the GPU (--cpu-offload forces offload)
#   ./run.sh --stub                           # no model: placeholder images, for wiring tests
#   ./run.sh --check                          # only run the environment checks
#   ./run.sh --download                       # also pre-download the model weights (~30 GB)
#
# Environment: QWEN_IMAGE_VENV (default ./.venv next to this file), QWEN_IMAGE_PYTHON (python3),
# QWEN_IMAGE_TORCH_INDEX (override the torch wheel index picked from nvidia-smi), HF_HOME (where
# the weights go), plus everything server.py reads (QWEN_IMAGE_MODEL, _HOST, _PORT, _DEVICE,
# _DTYPE, _CPU_OFFLOAD (1/0/auto), _STEPS, _MAX_PIXELS, _SERVER_TOKEN).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV="${QWEN_IMAGE_VENV:-$HERE/.venv}"
# An existing environment (e.g. QWEN_IMAGE_VENV=~/.conda/envs/qwen) brings its own interpreter;
# checking the system python3 instead would reject a perfectly good env over an old PATH python.
if [[ -z "${QWEN_IMAGE_PYTHON:-}" && -x "$VENV/bin/python" ]]; then PYTHON="$VENV/bin/python"
else PYTHON="${QWEN_IMAGE_PYTHON:-python3}"; fi
MODEL="${QWEN_IMAGE_MODEL:-Qwen/Qwen-Image-2.1}"
MIN_DISK_GB=40

log()  { printf '[qwen-image] %s\n' "$*"; }
warn() { printf '[qwen-image] WARN: %s\n' "$*" >&2; }
die()  { printf '[qwen-image] ERROR: %s\n' "$*" >&2; exit 1; }

CHECK_ONLY=0; DOWNLOAD=0; STUB=0; ARGS=()
for a in "$@"; do
  case "$a" in
    --check) CHECK_ONLY=1 ;;
    --download) DOWNLOAD=1 ;;
    --stub) STUB=1; ARGS+=("$a") ;;
    *) ARGS+=("$a") ;;
  esac
done

# ── 1. Python ≥ 3.10 with venv ────────────────────────────────────────────────────────────────
command -v "$PYTHON" >/dev/null 2>&1 || die "$PYTHON not found. Install Python 3.10+ (e.g. apt install python3 python3-venv python3-pip)."
PYVER="$("$PYTHON" -c 'import sys; print("%d.%d" % sys.version_info[:2])')"
"$PYTHON" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' || die "Python $PYVER is too old; need 3.10+ (set QWEN_IMAGE_PYTHON=python3.12)."
log "python: $PYTHON ($PYVER)"

if (( STUB )); then
  "$PYTHON" -c 'import PIL' 2>/dev/null || die "--stub needs pillow: $PYTHON -m pip install pillow"
  log "stub mode: serving placeholder images without a model"
  exec "$PYTHON" "$HERE/server.py" "${ARGS[@]}"
fi

"$PYTHON" -c 'import venv, ensurepip' 2>/dev/null || die "the venv/ensurepip modules are missing (Debian/Ubuntu: apt install python${PYVER}-venv)."
command -v git >/dev/null 2>&1 || die "git is required (diffusers is installed from GitHub): apt install git"

# ── 2. GPU / CUDA → torch wheel index ──────────────────────────────────────────────────────────
TORCH_INDEX="${QWEN_IMAGE_TORCH_INDEX:-}"
if command -v nvidia-smi >/dev/null 2>&1; then
  GPU_LINE="$(nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader 2>/dev/null | head -1 || true)"
  log "gpu: ${GPU_LINE:-unknown}"
  CUDA_VER="$(nvidia-smi 2>/dev/null | grep -o 'CUDA Version: [0-9.]*' | head -1 | grep -o '[0-9.]*' || true)"
  if [[ -z "$TORCH_INDEX" && -n "$CUDA_VER" ]]; then
    CUDA_MAJOR="${CUDA_VER%%.*}"; CUDA_MINOR="${CUDA_VER#*.}"; CUDA_MINOR="${CUDA_MINOR%%.*}"
    if (( CUDA_MAJOR >= 13 )); then TORCH_INDEX="https://download.pytorch.org/whl/cu130"
    elif (( CUDA_MAJOR == 12 && CUDA_MINOR >= 8 )); then TORCH_INDEX="https://download.pytorch.org/whl/cu128"
    elif (( CUDA_MAJOR == 12 && CUDA_MINOR >= 6 )); then TORCH_INDEX="https://download.pytorch.org/whl/cu126"
    elif (( CUDA_MAJOR == 12 )); then TORCH_INDEX="https://download.pytorch.org/whl/cu124"
    else TORCH_INDEX="https://download.pytorch.org/whl/cu118"; fi
    log "cuda driver $CUDA_VER → torch index $TORCH_INDEX"
  fi
  # CPU offload is decided by server.py once the weights are loaded (whole pipeline ~32 GB in bf16
  # plus working room vs. free VRAM); only cards too small even for one component get a warning.
  VRAM_MB="$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits 2>/dev/null | head -1 || echo 0)"
  if [[ "$VRAM_MB" =~ ^[0-9]+$ ]] && (( VRAM_MB > 0 && VRAM_MB < 20000 )); then
    warn "only ${VRAM_MB} MiB VRAM — even with CPU offload the ~17 GB bf16 text encoder may not fit; try --dtype float16 --steps 20, or deploy to a bigger card"
  fi
else
  warn "nvidia-smi not found — no NVIDIA GPU detected; the model will run on CPU (very slow). Pass --device cpu."
  [[ -z "$TORCH_INDEX" ]] && TORCH_INDEX="https://download.pytorch.org/whl/cpu"
fi

# ── 3. Disk space for weights + venv ───────────────────────────────────────────────────────────
HF_DIR="${HF_HOME:-$HOME/.cache/huggingface}"
mkdir -p "$HF_DIR" 2>/dev/null || true
FREE_GB="$(df -Pk "$HF_DIR" 2>/dev/null | awk 'NR==2 {printf "%d", $4/1024/1024}')"
if [[ -n "${FREE_GB:-}" ]] && (( FREE_GB < MIN_DISK_GB )); then
  warn "only ${FREE_GB} GB free under $HF_DIR; the weights need ~30 GB and the venv ~8 GB (set HF_HOME to a bigger disk)"
fi

# ── 4. venv + packages (idempotent: only installs what is missing) ─────────────────────────────
if [[ ! -x "$VENV/bin/python" ]]; then
  log "creating venv at $VENV"
  "$PYTHON" -m venv "$VENV"
fi
PIP=("$VENV/bin/python" -m pip)
"${PIP[@]}" install --quiet --upgrade pip >/dev/null
# torchvision is not optional: the Qwen3-VL text encoder's processor refuses to load without it.
# It must come from the same wheel index as torch, and when torch is already there it is pinned to
# that torch so pip does not swap torch for a build the driver cannot run.
TORCH_PKGS=()
if ! "$VENV/bin/python" -c 'import torch' 2>/dev/null; then
  TORCH_PKGS=(torch torchvision)
elif ! "$VENV/bin/python" -c 'import torchvision' 2>/dev/null; then
  TORCH_VER="$("$VENV/bin/python" -c 'import torch; print(torch.__version__.split("+")[0])')"
  TORCH_PKGS=(torchvision "torch==$TORCH_VER")
fi
if (( ${#TORCH_PKGS[@]} )); then
  log "installing ${TORCH_PKGS[*]}${TORCH_INDEX:+ from $TORCH_INDEX}"
  if [[ -n "$TORCH_INDEX" ]]; then "${PIP[@]}" install "${TORCH_PKGS[@]}" --index-url "$TORCH_INDEX"; else "${PIP[@]}" install "${TORCH_PKGS[@]}"; fi
fi
if ! "$VENV/bin/python" -c 'import diffusers, transformers, accelerate, PIL; from diffusers import QwenImage21Pipeline' 2>/dev/null; then
  log "installing transformers / diffusers (git) / accelerate / pillow"
  "${PIP[@]}" install -r "$HERE/requirements.txt"
fi
"$VENV/bin/python" - <<'PY' || die "environment check failed"
import torch, torchvision, diffusers, transformers
from diffusers import QwenImage21Pipeline  # noqa: F401 — the pipeline class must exist in this diffusers build
cuda = torch.cuda.is_available()
print(f"[qwen-image] torch {torch.__version__} cuda={cuda}" + (f" ({torch.cuda.get_device_name(0)})" if cuda else "") + f", diffusers {diffusers.__version__}, transformers {transformers.__version__}")
PY

# ── 5. Optional: pre-download the weights so the first request does not wait for them ─────────
if (( DOWNLOAD )); then
  log "downloading $MODEL to $HF_DIR (this is ~30 GB)"
  "$VENV/bin/python" - "$MODEL" <<'PY'
import sys
from huggingface_hub import snapshot_download
print(snapshot_download(sys.argv[1]))
PY
fi

if (( CHECK_ONLY )); then log "checks passed"; exit 0; fi
log "starting server.py --model $MODEL ${ARGS[*]:-}"
exec "$VENV/bin/python" "$HERE/server.py" --model "$MODEL" "${ARGS[@]}"
