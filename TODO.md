[x] (merge)首次流程導引應該只有在列表是空的時候才出現。（完成分支：feature/onboarding-empty-list-only）
[x] (merge)在PlayPage 中加入更新封面的按鍵，將封面更新為目前頁目的圖片（完成分支：feature/update-cover-from-current-page）
[x] 產生的過程中也允許進入 PlayPage, 可以流覽內容，播放音檔。但所有更改和生成的功能都要禁用（完成分支：feature/playpage-readonly-while-processing）
[x] 加上從提示詞生成的功能，使用者只提供一個提示詞說明要產生的內容，會先生成 TXT 需要的文字，再使用原 TXT 上傳的流程產生完整簡報（完成分支：feature/prompt-to-text-import）
[x] 加上教學互動功能（完成分支：feature/realtime-poll）
    [x] 可以在特定畫面加上 realtime poll 的功能，可以加上一個問題，在螢幕上顯示問題和幾個可能的答案。讓所有在同一個頁面的使用者都可以選擇答案。（完成分支：feature/realtime-poll）
[x] 完成 PendingTask.md #12 可觀測性儀表（成功率/失敗率/成本）（完成分支：feature/observability-dashboard）
[x] 完成 PendingTask.md #6 狀態機單一來源（完成分支：feature/status-machine-single-source）
[x] 完成 PendingTask.md #15 Queue 抽象層（為分散式擴充預備）（完成分支：feature/queue-abstraction）
[x] 完成 PendingTask.md #4 播放頁模組化（完成分支：feature/playpage-modularization）
[x] 完成 PendingTask.md #4 播放頁模組化追蹤清單收斂（完成分支：feature/pendingtask-playpage-modularization-sync）

## 工作記錄
- 時間：2026-05-17 16:10（Asia/Taipei）
- 工作內容：完成「首次流程導引應該只有在列表是空的時候才出現」，在首頁列表載入完成、無錯誤且簡報列表為空時才顯示首次流程導引。
- 所在分支：feature/onboarding-empty-list-only
- 驗證：npm --prefix frontend run build

- 時間：2026-05-17 17:02（Asia/Taipei）
- 工作內容：完成「加上從提示詞生成的功能」，在文字匯入頁新增「從提示詞生成」模式，後端新增提示詞轉投影片 TXT 的 API，生成內容會以原 TXT 上傳流程建立 awaiting_prompt 簡報並接續既有提示詞設定流程。
- 所在分支：feature/prompt-to-text-import
- 驗證：npm --prefix backend run build && npm --prefix frontend run build

- 時間：2026-05-17 16:22（Asia/Taipei）
- 工作內容：完成「在 PlayPage 中加入更新封面的按鍵，將封面更新為目前頁目的圖片」，新增後端以指定頁面圖片重建封面與縮圖的 API，並在播放頁投影片管理區加入「將目前頁設為封面」按鈕。
- 所在分支：feature/update-cover-from-current-page
- 驗證：npm --prefix backend test -- --runInBand（失敗：既有 pages-api 測試仍預期 pages/*.png，但目前實際為 pages/*.jpg）；npm --prefix backend run build；npm --prefix frontend run build

- 時間：2026-05-17 16:32（Asia/Taipei）
- 工作內容：完成「產生的過程中也允許進入 PlayPage, 可以流覽內容，播放音檔。但所有更改和生成的功能都要禁用」，首頁處理中項目可進入播放頁，播放頁在非 ready 狀態保留瀏覽與播放能力並以唯讀提示停用標題、提示詞、語音設定、圖片替換、投影片管理、問答修改、逐字稿重生、圖片重生、影片產生與整份重生等會寫入或生成的操作。
- 所在分支：feature/playpage-readonly-while-processing
- 驗證：npm --prefix frontend run build

- 時間：2026-05-17 17:13（Asia/Taipei）
- 工作內容：完成「加上教學互動功能」中的 realtime poll，後端新增每頁投票與投票紀錄資料表/API，播放頁可為目前頁建立投票問題與多個答案選項，同頁使用者可選擇答案並透過輪詢看到即時票數與比例。
- 所在分支：feature/realtime-poll
- 驗證：npm --prefix backend run build && npm --prefix frontend run build

- 時間：2026-05-17 17:24（Asia/Taipei）
- 工作內容：完成 PendingTask.md #12「可觀測性儀表（成功率/失敗率/成本）」，新增後端 /api/system/observability 統計簡報成功率/失敗率、pipeline run 狀態、stage/artifact 分布與 LLM token/估算成本，前端新增 /system 系統可觀測性儀表頁與設定頁入口。
- 所在分支：feature/observability-dashboard
- 驗證：npm --prefix backend run build && npm --prefix frontend run build

- 時間：2026-05-17 17:33（Asia/Taipei）
- 工作內容：完成 PendingTask.md #6「狀態機單一來源」，新增後端 lifecycle status 單一來源模組，集中定義 PDF/Page 狀態、進度步驟、狀態辨識與轉換規則；後端型別改由該模組匯出，資料庫啟動遷移會依單一來源清單正規化非法 PDF/Page 狀態，並補上狀態機與正規化測試。
- 所在分支：feature/status-machine-single-source
- 驗證：cd backend && ../scripts/with-node-env.sh npx tsx --test ./test/status-machine.test.ts && cd .. && npm --prefix backend run build；npm --prefix backend test -- status-machine.test.ts（失敗：專案測試腳本會先執行全部 backend/test/*.test.ts，既有 pages-api 測試仍預期 pages/*.png，但目前實際為 pages/*.jpg）

- 時間：2026-05-17 17:41（Asia/Taipei）
- 工作內容：完成 PendingTask.md #15「Queue 抽象層（為分散式擴充預備）」，將後端 PDF processing queue 從直接依賴 PQueue 收斂為 ProcessingQueue/ProcessingQueueAdapter 抽象，保留記憶體 PQueue 實作並提供可替換 adapter 與佇列統計，為後續分散式 queue adapter 預留介面；補上 adapter 建立、單例重用與切換重建的單元測試。
- 所在分支：feature/queue-abstraction
- 驗證：cd backend && ../scripts/with-node-env.sh npx tsx --test ./test/queue.test.ts && cd .. && npm --prefix backend run build；npm --prefix backend test -- queue.test.ts（失敗：專案測試腳本會先執行全部 backend/test/*.test.ts，既有 pages-api 測試仍預期 pages/*.png，但目前實際為 pages/*.jpg）

- 時間：2026-05-17 17:51（Asia/Taipei）
- 工作內容：完成 PendingTask.md #4「播放頁模組化」，將 PlayPage 中可獨立維護的格式化工具、頁面耗時晶片與重生進度 UI 拆分到 frontend/src/pages/play/ 子模組，降低播放頁主檔責任並維持既有播放、耗時顯示與重生進度行為。
- 所在分支：feature/playpage-modularization
- 驗證：npm --prefix frontend run build

- 時間：2026-05-17 20:15（Asia/Taipei）
- 工作內容：完成 PendingTask.md #4「播放頁模組化追蹤清單收斂」，依 TODO.md 既有完成記錄將 PendingTask.md 的 #4 標記完成、補上完成分支、更新已完成摘要與後續建議順序，使待辦追蹤文件與 master TODO.md 對齊。
- 所在分支：feature/pendingtask-playpage-modularization-sync
- 驗證：git show --stat --oneline HEAD && git diff-tree --no-commit-id --name-only -r HEAD
