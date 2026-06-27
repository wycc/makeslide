---
name: loop-status-report-reference
description: LOOP 第 2 條產生新 TODO 項目時，必須參考 docs/STATUS_REPORT_2026_06_27.md
metadata:
  type: feedback
---

執行 LOOP.md 第 2 條（TODO 無可執行項目時分析程式並新增項目）產生新項目時，除了 `docs/FUTURE_ROADMAP.md`，**必須**一併參考 `docs/STATUS_REPORT_2026_06_27.md`。

**Why:** 使用者於 2026-06-27 明確要求；該檔原本因檔名拼錯（STATUS_REPOPRT）而被當成不存在，現已補上，內含具體的程式盤點、差距分析、競品觀察與 P0/P1 優先建議與參考檔案位置。

**How to apply:** 產生項目前先讀該報告的 §7（建議方向）、§8（路線圖）、§9（立即處理清單）。其中已驗證的高價值 P0 bug：品質檢查／匯出（quality-check / image-quality / script-quality / h5p）以 `pages WHERE status = 'ready'` 取頁，但 pipeline 完成後頁面停在 `audio_ready`（pipeline.ts:1260；1299 只設 pdfs.status='ready'），可能漏掉主要頁面 —— 已列入 TODO 待修。相關：[[loop-workflow-makeslide]]
