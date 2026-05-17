# First Batch
[x] (merge)首次流程導引應該只有在列表是空的時候才出現。（完成分支：feature/onboarding-empty-list-only）
[x] (merge)在PlayPage 中加入更新封面的按鍵，將封面更新為目前頁目的圖片（完成分支：feature/update-cover-from-current-page）
[x] (merge)產生的過程中也允許進入 PlayPage, 可以流覽內容，播放音檔。但所有更改和生成的功能都要禁用（完成分支：feature/playpage-readonly-while-processing）
[x] (merge)加上從提示詞生成的功能，使用者只提供一個提示詞說明要產生的內容，會先生成 TXT 需要的文字，再使用原 TXT 上傳的流程產生完整簡報（完成分支：feature/prompt-to-text-import）
[x] 加上教學互動功能（完成分支：feature/realtime-poll）
    [x] 可以在特定畫面加上 realtime poll 的功能，可以加上一個問題，在螢幕上顯示問題和幾個可能的答案。讓所有在同一個頁面的使用者都可以選擇答案。（完成分支：feature/realtime-poll）
[x] 完成 PendingTask.md #12 可觀測性儀表（成功率/失敗率/成本）（完成分支：feature/observability-dashboard）
[x] 完成 PendingTask.md #6 狀態機單一來源（完成分支：feature/status-machine-single-source）
[x] 完成 PendingTask.md #15 Queue 抽象層（為分散式擴充預備）（完成分支：feature/queue-abstraction）
[x] 完成 PendingTask.md #4 播放頁模組化（完成分支：feature/playpage-modularization）
[x] 完成 PendingTask.md #4 播放頁模組化追蹤清單收斂（完成分支：feature/pendingtask-playpage-modularization-sync）
[x] 完成 PendingTask.md 已完成項目追蹤清單同步（完成分支：feature/pendingtask-completed-items-sync）

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

- 時間：2026-05-17 20:20（Asia/Taipei）
- 工作內容：完成 PendingTask.md 已完成項目追蹤清單同步，依 TODO.md 既有完成記錄將 PendingTask.md 的 #4、#6、#12、#15 標記完成、補上完成分支、更新已完成摘要與後續建議順序，讓追蹤清單反映所有改善項目皆已完成。
- 所在分支：feature/pendingtask-completed-items-sync
- 驗證：grep -n "\\[ \\]" PendingTask.md || true；git diff --check；git show --stat --oneline HEAD

# Second Batch
[x] 將取代目前頁圖片的按鍵去掉，我們己經可以可以直接拖到圖片上，不需要這個區域。（完成分支：feature/remove-replace-current-page-image-button）
[ ] 在問答頁上加上一個放大縮小的按鍵，讓我們可以讓問答的區塊佔整個右邊。
[x] 在手機模式上，把標題縮小一點讓返回按鍵可以顯示在一行上。（完成分支：feature/mobile-playpage-title-fit）
[x] 在手機模式上，把播放的進度列中進度條縮短一些讓後線長度可以完整顯示。（完成分支：feature/mobile-progress-bar-time-fit）
[x] 把顯示類別的選擇記下來，回到首頁時會顯示之前的設定（完成分支：feature/persist-home-category-filter）
[x] 把左上角的名稱留下 makeslide 就好了（完成分支：feature/header-brand-makeslide-only）
[ ] 在上傳 PDF 時，如果內容不是一個簡報的內容，則請將整個文字取出再請 AI 分頁，不要把一般論文每一頁當成簡報處理。如果自動偵測不好做，至少做成讓使用者手動選擇。
[ ] 加上自動出考題功能，在 PlayPage 中可以新增考題功能，自動出考題，可以選擇單選或多選。使用者可以提示 AI 有關考題的內容。生成的考題提供讓使用者再手工微調的功能。
[ ] 加上上課模式，每撥放一頁就停下來。讓老師講解。
[ ] 加上使用 google 帳號的功能
[ ] API key 和一些整體設定要存在帳號中，例如 .env。每一個帳號會在一個單獨的目錄中，
[ ] 當帳號的 credit 用完時，要顯示錯誤對話框提示使用者去充值。
[ ] 使用語音產生 realtime poll

## 工作記錄

- 時間：2026-05-18 03:50（Asia/Taipei）
- 工作內容：完成「把左上角的名稱留下 makeslide 就好了」，移除首頁左上角品牌名稱下方的「PDF 語音簡報生成與播放（M2 預覽）」副標，讓頁首只保留 makeslide 名稱。
- 所在分支：feature/header-brand-makeslide-only
- 驗證：npm --prefix frontend run build

- 時間：2026-05-18 04:00（Asia/Taipei）
- 工作內容：完成「把顯示類別的選擇記下來，回到首頁時會顯示之前的設定」，首頁顯示類別選擇會寫入瀏覽器 localStorage，重新進入首頁時自動套用上次選擇；若刪除目前選取的類別，會同步回復並記錄為全部類別。
- 所在分支：feature/persist-home-category-filter
- 驗證：npm --prefix frontend run build

- 時間：2026-05-18 04:10（Asia/Taipei）
- 工作內容：完成「將取代目前頁圖片的按鍵去掉」，移除播放頁投影片管理區底部的「取代目前頁圖片（可拖放/貼上）」檔案選擇按鈕與專用隱藏 input，保留既有拖放與貼上圖片取代流程。
- 所在分支：feature/remove-replace-current-page-image-button
- 驗證：npm --prefix frontend run build

- 時間：2026-05-18 04:20（Asia/Taipei）
- 工作內容：完成「在手機模式上，把標題縮小一點讓返回按鍵可以顯示在一行上」，調整播放頁手機版 header 間距、返回按鍵與標題輸入框字級，並避免返回按鍵、更新標題與頁碼換行，讓窄螢幕標題列可維持單行顯示。
- 所在分支：feature/mobile-playpage-title-fit
- 驗證：npm --prefix frontend run build

- 時間：2026-05-18 04:30（Asia/Taipei）
- 工作內容：完成「在手機模式上，把播放的進度列中進度條縮短一些讓後線長度可以完整顯示」，調整播放頁播放器控制列手機版排版，讓按鈕列可換行，進度條與時間顯示共用下一列並保留固定時間欄寬，避免目前時間/總長度在窄螢幕被截斷。
- 所在分支：feature/mobile-progress-bar-time-fit
- 驗證：npm --prefix frontend run build；git diff --check
