#!/usr/bin/env bash
# One-shot, reliable test runner for MakeSlide.
#
# Solves the two recurring pain points when running tests by hand:
#   1. Native modules (better-sqlite3) are built for the Node version pinned in
#      .nvmrc (Node 22). Running under a different Node (e.g. the system Node 26)
#      fails with NODE_MODULE_VERSION errors. We delegate to with-node-env.sh,
#      which loads nvm and switches to the .nvmrc version first.
#   2. Backend tests build a Fastify app whose worker/queue leaves open handles,
#      so the test process never exits on its own and appears to "hang". We pass
#      --test-force-exit so the runner exits once all tests finish, plus a
#      per-test timeout so a genuinely stuck test fails fast instead of blocking.
#
# Usage:
#   scripts/run-tests.sh                 # backend + frontend (all tests)
#   scripts/run-tests.sh backend         # backend tests only
#   scripts/run-tests.sh frontend        # frontend tests only
#   scripts/run-tests.sh backend test/quality-check.test.ts   # specific file(s)/glob
#   scripts/run-tests.sh frontend 'src/lib/clamp.test.ts'
#
# Env:
#   TEST_TIMEOUT_MS   per-test timeout in ms (default 30000)
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WNE="$REPO_DIR/scripts/with-node-env.sh"
TIMEOUT_MS="${TEST_TIMEOUT_MS:-30000}"
TSX="$REPO_DIR/node_modules/.bin/tsx"

if [[ ! -x "$TSX" ]]; then
  echo "[ERROR] 找不到 tsx（$TSX）。請先在 repo 根目錄執行 npm install。" >&2
  exit 1
fi

run_side() {
  local side="$1"; shift
  local workdir="$REPO_DIR/$side"
  local -a targets
  if [[ "$#" -gt 0 ]]; then
    targets=("$@")
  elif [[ "$side" == "backend" ]]; then
    targets=("./test/*.test.ts")
  else
    targets=("src/**/*.test.ts")
  fi

  echo "▶ ${side} tests: ${targets[*]}"
  # CALLER_DIR (PWD) is what with-node-env.sh exec's in, so cd into the workspace
  # first; tsx then resolves the workspace tsconfig and test globs correctly.
  ( cd "$workdir" && "$WNE" "$TSX" --test --test-force-exit --test-timeout="$TIMEOUT_MS" "${targets[@]}" )
}

main() {
  local selector="${1:-all}"
  case "$selector" in
    backend)
      shift; run_side backend "$@" ;;
    frontend)
      shift; run_side frontend "$@" ;;
    all|"")
      run_side backend
      run_side frontend ;;
    *)
      echo "[ERROR] 未知參數：$selector（用法：run-tests.sh [backend|frontend|all] [檔案/glob...]）" >&2
      exit 2 ;;
  esac
}

main "$@"
echo "✓ 測試完成"
