---
name: run-tests-command
description: 跑測試一律用 scripts/run-tests.sh（處理 Node 版本與 open-handle 卡住）
metadata:
  type: reference
---

跑這個專案的測試**一律使用** `scripts/run-tests.sh`，不要直接 `tsx --test`：

- `scripts/run-tests.sh` — backend + frontend 全部
- `scripts/run-tests.sh backend [檔案/glob...]` — 只跑後端（預設 `./test/*.test.ts`）
- `scripts/run-tests.sh frontend [檔案/glob...]` — 只跑前端（預設 `src/**/*.test.ts`）
- env `TEST_TIMEOUT_MS`（預設 30000）調整 per-test 超時

它解決兩個會反覆試錯的問題：
1. **Node 版本**：native 模組 `better-sqlite3` 是為 `.nvmrc` 的 Node 22.12 編譯；系統預設可能是 Node 26，直接跑會 `NODE_MODULE_VERSION` 錯誤。腳本透過 `scripts/with-node-env.sh` 載入 nvm 切到 Node 22。
2. **後端 app 測試「卡住」**：`buildApp()` 的 worker/queue 留下 open handle，process 不會自行結束。腳本加 `--test-force-exit`（測試跑完即退出）+ per-test timeout。

已知既有失敗（與一般改動無關）：`backend/test/status-machine.test.ts` 的「page status and progress step single sources expose valid values」(PROGRESS_STEPS enum 鏡像 drift)。相關：[[loop-status-report-reference]]
