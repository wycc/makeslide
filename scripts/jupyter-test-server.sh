#!/usr/bin/env bash
# Launch a local Jupyter server for testing the notebook-slide integration
# (Jupyter phase 1c/1d). This is a DEV/TEST helper only — permissive CORS and
# disabled XSRF make it unsafe for anything but local verification.
#
# Usage:
#   scripts/jupyter-test-server.sh            # start on the defaults below
#   JUPYTER_TEST_PORT=9000 scripts/jupyter-test-server.sh
#
# Then point the backend at it (same values as printed below):
#   JUPYTER_ENABLED=true \
#   JUPYTER_BASE_URL=http://localhost:8899 \
#   JUPYTER_TOKEN=makeslidetesttoken123 \
#   <your backend start command>
set -euo pipefail

PORT="${JUPYTER_TEST_PORT:-8899}"
TOKEN="${JUPYTER_TEST_TOKEN:-makeslidetesttoken123}"
# Where notebook kernels run / files resolve; defaults to a scratch dir.
ROOT_DIR="${JUPYTER_TEST_ROOT_DIR:-$(mktemp -d)}"

# Prefer an explicit JUPYTER_BIN, else Anaconda's, else whatever is on PATH.
JUPYTER_BIN="${JUPYTER_BIN:-}"
if [[ -z "$JUPYTER_BIN" ]]; then
  if [[ -x /opt/Anaconda3/bin/jupyter ]]; then
    JUPYTER_BIN=/opt/Anaconda3/bin/jupyter
  else
    JUPYTER_BIN="$(command -v jupyter || true)"
  fi
fi
if [[ -z "$JUPYTER_BIN" ]]; then
  echo "error: could not find a 'jupyter' executable (set JUPYTER_BIN)" >&2
  exit 1
fi

cat <<INFO
Starting Jupyter test server:
  jupyter : $JUPYTER_BIN
  url     : http://localhost:${PORT}
  token   : ${TOKEN}
  root    : ${ROOT_DIR}

Point the backend at it with:
  JUPYTER_ENABLED=true \\
  JUPYTER_BASE_URL=http://localhost:${PORT} \\
  JUPYTER_TOKEN=${TOKEN} \\
  <your backend start command>

Press Ctrl+C to stop.
INFO

exec "$JUPYTER_BIN" server \
  --ServerApp.token="${TOKEN}" \
  --ServerApp.port="${PORT}" \
  --ServerApp.allow_origin='*' \
  --ServerApp.disable_check_xsrf=True \
  --ServerApp.allow_remote_access=True \
  --ServerApp.root_dir="${ROOT_DIR}" \
  --no-browser
