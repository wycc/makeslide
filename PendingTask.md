# 功能改善追蹤清單

## 改善項目

- [x] #1 拆分超大路由模組（優先級：P0；難度：中）
- [x] #2 Pipeline 階段事件標準化與 SLA 追蹤（優先級：P0；難度：中；分支：feature/pipeline-stage-sla-tracking）
- [x] #3 Regenerate 狀態持久化（優先級：P0；難度：中；分支：feature/regenerate-state-persistence）
- [ ] #4 播放頁模組化（優先級：P0；難度：高）
- [x] #5 前端 API client 分域拆分（優先級：P1；難度：中；分支：feature/frontend-api-domain-split）
- [ ] #6 狀態機單一來源（優先級：P0；難度：中）
- [x] #7 錯誤碼字典 + 前端可行動提示（優先級：P1；難度：低）
- [x] #8 任務取消語義一致化（優先級：P1；難度：中；分支：feature/task-cancel-semantics）
- [ ] #9 長任務進度 + ETA（優先級：P1；難度：中）
- [x] #10 靜態資源版本指紋與快取策略（優先級：P1；難度：中；分支：feature/static-asset-cache-policy-v2）
- [x] #11 輸入防護與內容資安強化（優先級：P0；難度：中；分支：feature/input-security-hardening）
- [ ] #12 可觀測性儀表（成功率/失敗率/成本）（優先級：P1；難度：中）
- [x] #13 測試矩陣補強（重生/回滾/頁面操作）（優先級：P0；難度：中）
- [x] #14 文件對齊實作現況（優先級：P1；難度：低）
- [ ] #15 Queue 抽象層（為分散式擴充預備）（優先級：P2；難度：高）
- [x] #16 新手導引與失敗復原 UX（優先級：P2；難度：低）

## 已完成摘要

已完成 10 項改善項目：

- #1 拆分超大路由模組
- #2 Pipeline 階段事件標準化與 SLA 追蹤（分支：feature/pipeline-stage-sla-tracking）
- #3 Regenerate 狀態持久化（分支：feature/regenerate-state-persistence）
- #5 前端 API client 分域拆分（分支：feature/frontend-api-domain-split）
- #7 錯誤碼字典 + 前端可行動提示
- #10 靜態資源版本指紋與快取策略（分支：feature/static-asset-cache-policy-v2）
- #8 任務取消語義一致化（分支：feature/task-cancel-semantics）
- #11 輸入防護與內容資安強化（分支：feature/input-security-hardening）
- #13 測試矩陣補強（重生/回滾/頁面操作）
- #14 文件對齊實作現況
- #16 新手導引與失敗復原 UX

## 後續建議順序

依優先級 P0 → P1 → P2 排序，建議後續處理順序如下：

1. #2 Pipeline 階段事件標準化與 SLA 追蹤（P0；中）
2. #3 Regenerate 狀態持久化（P0；中）
3. #4 播放頁模組化（P0；高）
4. #6 狀態機單一來源（P0；中）
5. #5 前端 API client 分域拆分（P1；中）
6. #8 任務取消語義一致化（P1；中）
7. #9 長任務進度 + ETA（P1；中）
4. #10 靜態資源版本指紋與快取策略（P1；中）
8. #12 可觀測性儀表（成功率/失敗率/成本）（P1；中）
9. #15 Queue 抽象層（為分散式擴充預備）（P2；高）

## 工作記錄

- 2026-05-17 11:23 Asia/Taipei：完成 #11 輸入防護與內容資安強化。新增上傳檔名清理、控制字元移除與安全 fallback，PDF 上傳改以 `%PDF-` 檔頭驗證內容、TXT 上傳拒絕 NUL/非 UTF-8 內容；YouTube 匯入限制為 YouTube 網域並加強語言代碼格式驗證；補上輸入防護 API 測試。所在分支：feature/input-security-hardening。
- 2026-05-17 15:16 Asia/Taipei：完成 #10 靜態資源版本指紋與快取策略。前端 Vite production build 明確輸出含 hash 的 entry/chunk/asset 檔名並產生 manifest；後端 production 靜態檔服務依檔名套用快取策略，指紋資源使用一年 immutable 快取，index.html 與 manifest 使用 no-cache，其它未指紋資源使用短效快取；補上靜態快取策略單元測試並完成後端 typecheck、單檔測試與前端 build 驗證。所在分支：feature/static-asset-cache-policy-v2。
- 2026-05-17 11:39 Asia/Taipei：完成 #2 Pipeline 階段事件標準化與 SLA 追蹤。新增 timing event schema 版本、標準化 run/stage/artifact/status/reason 值清單、SLA 目標快照與 metadata schema_version；補強 timing 測試涵蓋 schema、SLA met/warning/breached/unknown 判定與 metadata 版本；調整 server 僅在直接執行時啟動，避免測試 import 造成連接埠衝突。所在分支：feature/pipeline-stage-sla-tracking。
- 2026-05-17 11:52 Asia/Taipei：完成 #3 Regenerate 狀態持久化。新增 regenerate_jobs 資料表保存重生任務狀態 JSON、狀態索引與啟動/進度/取消/完成/失敗/rollback 的同步寫入；狀態查詢可在記憶體任務遺失後由資料庫讀回，並將伺服器重啟造成的未完成任務標示為失敗以避免前端無限等待；修正重生啟動與取消端點錯誤對應，補上持久化驗證測試。所在分支：feature/regenerate-state-persistence。
- 2026-05-17 12:20 Asia/Taipei：完成 #8 任務取消語義一致化。取消請求統一以 cancelling 作為等待安全停止點的中介狀態，重複取消保持 202 冪等回應並保留 cancel_requested；任務真正停止時收斂為 cancelled、清空 current_step，將尚未執行步驟標為 skipped，並補上 regenerate matrix 測試驗證取消回應與持久化狀態。所在分支：feature/task-cancel-semantics。
- 2026-05-17 12:28 Asia/Taipei：完成 #5 前端 API client 分域拆分。將原本集中在單一 API client 的通用錯誤處理、PDF/頁面/重生操作、系統設定與上傳功能拆分為 common、pdfs、system、uploads 等分域模組，保留原 api.ts barrel export 以維持既有呼叫端相容；已執行前端 typecheck 與 production build 驗證。所在分支：feature/frontend-api-domain-split。
