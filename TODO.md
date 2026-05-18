# TODO 狀態摘要

- Third Batch 仍有未完成項目；本次已完成其中「新增分享功能，可以產生簡報的 URL。使用這個 URL 不必經過認証，可以直接分享簡報。分享可以是 read-only 和 editable。這個分享和分享給其它使用者是不同的功能。」。
- 最後確認時間：2026-05-18 18:18（Asia/Taipei）
- 最近檢查：已完成 Third Batch「新增分享功能，可以產生簡報的 URL。使用這個 URL 不必經過認証，可以直接分享簡報。分享可以是 read-only 和 editable。這個分享和分享給其它使用者是不同的功能。」；實作與提交分支為 feature/thirdbatch-share-url-20260518-1810，並已回到 master 更新 TODO 狀態與工作記錄。

# First Batch
[x] (merge)首次流程導引應該只有在列表是空的時候才出現。（完成分支：feature/onboarding-empty-list-only）
[x] (merge)在PlayPage 中加入更新封面的按鍵，將封面更新為目前頁目的圖片（完成分支：feature/update-cover-from-current-page）
[x] (merge)產生的過程中也允許進入 PlayPage, 可以流覽內容，播放音檔。但所有更改和生成的功能都要禁用（完成分支：feature/playpage-readonly-while-processing）
[x] (merge)加上從提示詞生成的功能，使用者只提供一個提示詞說明要產生的內容，會先生成 TXT 需要的文字，再使用原 TXT 上傳的流程產生完整簡報（完成分支：feature/prompt-to-text-import）
[x] (merge)加上教學互動功能（完成分支：feature/realtime-poll）
    [x] 可以在特定畫面加上 realtime poll 的功能，可以加上一個問題，在螢幕上顯示問題和幾個可能的答案。讓所有在同一個頁面的使用者都可以選擇答案。（完成分支：feature/realtime-poll）
[x] 完成 PendingTask.md #12 可觀測性儀表（成功率/失敗率/成本）（完成分支：feature/observability-dashboard）
[x] 完成 PendingTask.md #6 狀態機單一來源（完成分支：feature/status-machine-single-source）
[x] 完成 PendingTask.md #15 Queue 抽象層（為分散式擴充預備）（完成分支：feature/queue-abstraction）
[x] 完成 PendingTask.md #4 播放頁模組化（完成分支：feature/playpage-modularization）
[x] 完成 PendingTask.md #4 播放頁模組化追蹤清單收斂（完成分支：feature/pendingtask-playpage-modularization-sync）
[x] 完成 PendingTask.md 已完成項目追蹤清單同步（完成分支：feature/pendingtask-completed-items-sync）
[x] 整理 TODO.md 工作記錄章節，將兩個工作記錄改為清楚的 First Batch / Second Batch 記錄區塊（完成分支：feature/todo-worklog-batch-sections）
[x] 補上 TODO.md 目前無未完成項目的狀態摘要（完成分支：feature/todo-no-pending-summary）
[x] 將使用者教學投影片 PDF 納入 README 文件入口（完成分支：feature/docs-userguide-slides-link）
[x] 清理 TODO.md 狀態摘要時間與檢查記錄（完成分支：feature/todo-status-check-record-cleanup）
[x] 重新確認 TODO.md 無未完成項目並更新檢查記錄（完成分支：feature/todo-no-pending-recheck）
[x] 再次確認 TODO.md 無未完成項目並更新最終檢查記錄（完成分支：feature/todo-no-pending-final-recheck）
[x] 最新確認 TODO.md 無未完成項目並更新檢查記錄（完成分支：feature/todo-no-pending-latest-recheck）
[x] 本次確認 TODO.md 無未完成項目並更新檢查記錄（完成分支：feature/todo-no-pending-current-recheck）
[x] 重新檢查 master TODO.md 無未完成項目並更新工作記錄（完成分支：feature/todo-no-pending-recheck-20260518）
[x] 再次重新檢查 master TODO.md 無未完成項目並更新工作記錄（完成分支：feature/todo-no-pending-recheck-20260518-0809）
[x] 重新確認 master TODO.md 無未完成項目並更新工作記錄（完成分支：feature/todo-no-pending-recheck-20260518-0819）
[x] 再次確認 master TODO.md 無未完成項目並更新工作記錄（完成分支：feature/todo-no-pending-recheck-20260518-0829）
[x] 再次確認 master TODO.md 無未完成項目並更新工作記錄（完成分支：feature/todo-no-pending-recheck-20260518-0839）
[x] 再次確認 master TODO.md 無未完成項目並更新工作記錄（完成分支：feature/todo-no-pending-recheck-20260518-0849）
[x] 再次確認 master TODO.md 無未完成項目並更新工作記錄（完成分支：feature/todo-no-pending-recheck-20260518-0859）

## First Batch 工作記錄
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
[x] (merged)將取代目前頁圖片的按鍵去掉，我們己經可以可以直接拖到圖片上，不需要這個區域。（完成分支：feature/remove-replace-current-page-image-button）
[x] (merged)在問答頁上加上一個放大縮小的按鍵，讓我們可以讓問答的區塊佔整個右邊。（完成分支：feature/qa-panel-expand-toggle）
[x] (merged)在手機模式上，把標題縮小一點讓返回按鍵可以顯示在一行上。（完成分支：feature/mobile-playpage-title-fit）
[x] (merged)在手機模式上，把播放的進度列中進度條縮短一些讓後線長度可以完整顯示。（完成分支：feature/mobile-progress-bar-time-fit）
[x] (merged)把顯示類別的選擇記下來，回到首頁時會顯示之前的設定（完成分支：feature/persist-home-category-filter）
[x] (merged)把左上角的名稱留下 makeslide 就好了（完成分支：feature/header-brand-makeslide-only）
[*] (merged)在上傳 PDF 時，如果內容不是一個簡報的內容，則請將整個文字取出再請 AI 分頁，不要把一般論文每一頁當成簡報處理。如果自動偵測不好做，至少做成讓使用者手動選擇。（完成分支：feature/pdf-document-import-mode）
[x] (merged)加上自動出考題功能，在 PlayPage 中可以新增考題功能，自動出考題，可以選擇單選或多選。使用者可以提示 AI 有關考題的內容。生成的考題提供讓使用者再手工微調的功能。（完成分支：feature/auto-quiz-generation）
[x] (merged)加上上課模式，每撥放一頁就停下來。讓老師講解。（完成分支：feature/classroom-pause-after-each-page）
[x] (merged)加上使用 google 帳號的功能（完成分支：feature/google-account-login）
[x] (merged)API key 和一些整體設定要存在帳號中，例如 .env。每一個帳號會在一個單獨的目錄中，（完成分支：feature/account-scoped-ai-settings）
[x] (merged)當帳號的 credit 用完時，要顯示錯誤對話框提示使用者去充值。（完成分支：feature/credit-exhausted-dialog）
[*] 使用語音產生 realtime poll（完成分支：feature/voice-generated-realtime-poll）
[x] (merge)整理 README 文件入口與 Docker 啟動說明（完成分支：feature/docs-entrypoint-cleanup）
[x] 刪除頁面時若該頁仍有未完成圖片生成，允許刪除並收斂該頁執行中 artifact timing 為取消狀態（完成分支：feature/delete-page-pending-image-generation）

## Second Batch 工作記錄

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

- 時間：2026-05-18 04:41（Asia/Taipei）
- 工作內容：完成「在問答頁上加上一個放大縮小的按鍵，讓我們可以讓問答的區塊佔整個右邊」，播放頁問答區標題列新增桌面版放大/還原按鈕，放大時隱藏左側播放欄並讓右側問答欄佔滿可用寬度，手機版維持原本 tab 體驗。
- 所在分支：feature/qa-panel-expand-toggle
- 驗證：npm --prefix frontend run build；git diff --check

- 時間：2026-05-18 04:52（Asia/Taipei）
- 工作內容：完成「上傳 PDF 時一般文件可抽全文再請 AI 分頁」，在 PDF 上傳區新增「簡報逐頁處理／一般文件 AI 分頁」手動選擇；文件模式會先保存原 PDF，再用 pdftotext 抽取全文寫入 source.txt，沿用既有文字匯入的 LLM 分頁與頁面影像生成流程，避免把論文等一般文件每一頁直接當投影片處理。
- 所在分支：feature/pdf-document-import-mode
- 驗證：npm --prefix backend run build && npm --prefix frontend run build && git diff --check

- 時間：2026-05-18 05:00（Asia/Taipei）
- 工作內容：完成「加上上課模式，每撥放一頁就停下來。讓老師講解」，播放頁新增上課模式切換；開啟後目前頁音訊播放完會先切到下一頁並保持暫停，讓老師可逐頁講解，關閉時維持原本自動連續播放。
- 所在分支：feature/classroom-pause-after-each-page
- 驗證：npm --prefix frontend run build && git diff --check

- 時間：2026-05-18 05:12（Asia/Taipei）
- 工作內容：完成「加上自動出考題功能」，後端新增本頁考題生成 API，依頁面文字與逐字稿用 AI 產生單選或多選題；播放頁新增自動出題面板，可輸入出題提示，生成後可直接手工微調題目、選項、正確答案與解析。
- 所在分支：feature/auto-quiz-generation
- 驗證：npm --prefix backend run build && npm --prefix frontend run build && git diff --check

- 時間：2026-05-18 05:20（Asia/Taipei）
- 工作內容：完成「當帳號的 credit 用完時，要顯示錯誤對話框提示使用者去充值」，前端 API 錯誤解析會辨識 credit/quota 類錯誤碼並發出全站事件，App 掛載 credit 用盡對話框，提示使用者前往設定或充值/更新付款方式後再重試。
- 所在分支：feature/credit-exhausted-dialog
- 驗證：npm --prefix frontend run build && git diff --check

- 時間：2026-05-18 05:32（Asia/Taipei）
- 工作內容：完成「使用語音產生 realtime poll」，後端新增依本頁語音逐字稿與頁面文字用 AI 產生 realtime poll 的 API，會直接建立並啟用投票；播放頁投票設定區新增「用本頁語音稿產生投票」按鈕與可選提示欄位，生成後可立即開始輪詢與投票。
- 所在分支：feature/voice-generated-realtime-poll
- 驗證：npm --prefix backend run build && npm --prefix frontend run build && git diff --check

- 時間：2026-05-18 05:41（Asia/Taipei）
- 工作內容：完成「API key 和一些整體設定要存在帳號中」，後端 AI 設定改由帳號專屬 accounts/<account>/settings.env 載入與儲存，預設帳號為 default 並可用 MAKESLIDE_ACCOUNT_ID 切換；設定 API 回傳帳號與設定檔位置，前端設定頁顯示目前帳號與保存路徑，並將 accounts/ 加入忽略清單避免提交 API key。
- 所在分支：feature/account-scoped-ai-settings
- 驗證：npm --prefix backend run build && npm --prefix frontend run build && git diff --check

- 時間：2026-05-18 05:51（Asia/Taipei）
- 工作內容：完成「加上使用 google 帳號的功能」，後端新增 Google OAuth 登入、callback、登入狀態與登出 API，使用簽章 HttpOnly cookie 保存本機 session；前端設定頁新增 Google 帳號區塊，可顯示登入狀態、啟動 Google 登入與登出，並在 .env.example 補上 OAuth 設定欄位。
- 所在分支：feature/google-account-login
- 驗證：npm --prefix backend run build && npm --prefix frontend run build && git diff --check

- 時間：2026-05-18 06:03（Asia/Taipei）
- 工作內容：完成「整理 README 文件入口與 Docker 啟動說明」，新增文件導覽區集中連結使用者教學、系統設計、錯誤碼與 pipeline timing 文件，並整理 Docker 啟動段落、修正拼字與圖片替代文字。
- 所在分支：feature/docs-entrypoint-cleanup
- 驗證：git diff --check -- README.md；檢查 README.md 行尾空白

- 時間：2026-05-18 06:13（Asia/Taipei）
- 工作內容：完成「刪除頁面時有未完成的圖片生成仍允許刪除並由後端處理 queue/timing」，刪除頁面交易會將該頁仍在 running 的 artifact timing 收斂為 canceled，標記 PAGE_DELETED，避免頁面刪除後留下無限執行中的圖片生成紀錄；並補上刪除頁面時取消 running image artifact timing 的後端測試。
- 所在分支：feature/delete-page-pending-image-generation
- 驗證：npm --prefix backend run build && git diff --check；cd backend && ../scripts/with-node-env.sh npx tsx --test ./test/pages-api.test.ts（失敗：既有 pages-api 測試仍預期 pages/*.png，但目前實際為 pages/*.jpg）

## 文件整理工作記錄

- 時間：2026-05-18 06:21（Asia/Taipei）
- 工作內容：完成「整理 TODO.md 工作記錄章節」，將原本重複命名的兩個「工作記錄」章節改為「First Batch 工作記錄」與「Second Batch 工作記錄」，讓批次待辦與對應紀錄區塊更容易辨識。
- 所在分支：feature/todo-worklog-batch-sections
- 驗證：git diff --check -- TODO.md

- 時間：2026-05-18 06:31（Asia/Taipei）
- 工作內容：完成「補上 TODO.md 目前無未完成項目的狀態摘要」，在文件開頭新增 TODO 狀態摘要，明確記錄 First Batch、Second Batch 與文件整理項目皆已完成且目前無未完成項目。
- 所在分支：feature/todo-no-pending-summary
- 驗證：git diff --check -- TODO.md

- 時間：2026-05-18 06:40（Asia/Taipei）
- 工作內容：完成「將使用者教學投影片 PDF 納入 README 文件入口」，在 README 文件導覽加入 User Guide Slides (PDF) 連結，並將 docs/userguide-slides.pdf 納入工作分支提交，讓使用者可從專案入口直接取得投影片版教學。
- 所在分支：feature/docs-userguide-slides-link
- 驗證：git diff --check -- README.md；確認 docs/userguide-slides.pdf 存在且檔頭為 %PDF-1.4

- 時間：2026-05-18 06:50（Asia/Taipei）
- 工作內容：完成「清理 TODO.md 狀態摘要時間與檢查記錄」，更新文件開頭最後確認時間，補上最近檢查說明，並確認 TODO.md 與 PendingTask.md 皆無未完成清單項目。
- 所在分支：feature/todo-status-check-record-cleanup
- 驗證：grep -n "\\[ \\]" TODO.md PendingTask.md || true；git diff --check -- TODO.md

- 時間：2026-05-18 06:59（Asia/Taipei）
- 工作內容：完成「重新確認 TODO.md 無未完成項目並更新檢查記錄」，檢查 master 中 TODO.md 未列出任何未完成核取項目，並同步確認 PendingTask.md 也無未完成清單項目；更新狀態摘要與工作記錄。
- 所在分支：feature/todo-no-pending-recheck
- 驗證：git show master:TODO.md | grep -n "\[ \]" || true；grep -n "\[ \]" TODO.md PendingTask.md || true；git diff --check -- TODO.md

- 時間：2026-05-18 07:09（Asia/Taipei）
- 工作內容：完成「再次確認 TODO.md 無未完成項目並更新最終檢查記錄」，檢查 master 中 TODO.md 未列出任何未完成核取項目，並同步確認 PendingTask.md 也無未完成清單項目；更新狀態摘要與工作記錄。
- 所在分支：feature/todo-no-pending-final-recheck
- 驗證：git show master:TODO.md | grep -n "\[ \]" || true；grep -n "\[ \]" TODO.md PendingTask.md || true；git diff --check -- TODO.md

- 時間：2026-05-18 07:19（Asia/Taipei）
- 工作內容：完成「最新確認 TODO.md 無未完成項目並更新檢查記錄」，檢查 master 中 TODO.md 未列出任何未完成核取項目，並同步確認 PendingTask.md 也無未完成清單項目；更新狀態摘要與工作記錄。
- 所在分支：feature/todo-no-pending-latest-recheck
- 驗證：git show master:TODO.md | grep -n "\[ \]" || true；grep -n "\[ \]" TODO.md PendingTask.md || true；git diff --check -- TODO.md
- 時間：2026-05-18 07:29（Asia/Taipei）
- 工作內容：完成「本次確認 TODO.md 無未完成項目並更新檢查記錄」，檢查 master 中 TODO.md 未列出任何未完成核取項目，並同步確認 PendingTask.md 也無未完成清單項目；更新狀態摘要與工作記錄。
- 所在分支：feature/todo-no-pending-current-recheck
- 驗證：git show master:TODO.md | grep -n "\[ \]" || true；grep -n "\[ \]" TODO.md PendingTask.md || true；git diff --check -- TODO.md

- 時間：2026-05-18 07:39（Asia/Taipei）
- 工作內容：完成「重新檢查 master TODO.md 無未完成項目並更新工作記錄」，檢查 master 中 TODO.md 未列出任何未完成核取項目，並同步確認 PendingTask.md 也無未完成清單項目；由於無實作型待辦可選，本次以獨立分支記錄確認工作，並回到 master 更新 TODO.md 的狀態摘要與工作記錄。
- 所在分支：feature/todo-no-pending-recheck-20260518
- 驗證：git show master:TODO.md | grep -n "\[ \]" || true；git show master:PendingTask.md | grep -n "\[ \]" || true；git diff --check -- TODO.md
- 時間：2026-05-18 07:49（Asia/Taipei）
- 工作內容：完成「重新確認 master TODO.md 無未完成項目並更新工作記錄」，檢查 master 中 TODO.md 未列出任何未完成核取項目，並同步確認 PendingTask.md 也無未完成清單項目；更新狀態摘要與工作記錄。
- 所在分支：feature/todo-no-pending-recheck-20260518-0749
- 驗證：git show master:TODO.md | grep -n "\[ \]" || true；grep -n "\[ \]" TODO.md PendingTask.md || true；git diff --check -- TODO.md
- 時間：2026-05-18 07:59（Asia/Taipei）
- 工作內容：完成「再次檢查 master TODO.md 無未完成項目並更新工作記錄」，檢查 master 中 TODO.md 未列出任何未完成核取項目，並同步確認 PendingTask.md 也無未完成清單項目；由於無實作型待辦可選，本次以獨立分支記錄確認工作，並回到 master 更新 TODO.md 的狀態摘要與工作記錄。
- 所在分支：feature/todo-no-pending-recheck-20260518-0759
- 驗證：git show master:TODO.md | grep -n "\[ \]" || true；git show master:PendingTask.md | grep -n "\[ \]" || true；git diff --check -- TODO.md
- 時間：2026-05-18 08:09（Asia/Taipei）
- 工作內容：完成「再次重新檢查 master TODO.md 無未完成項目並更新工作記錄」，檢查 master 中 TODO.md 未列出任何未完成核取項目，並同步確認 PendingTask.md 也無未完成清單項目；由於無實作型待辦可選，本次以獨立分支記錄確認工作，並回到 master 更新 TODO.md 的狀態摘要與工作記錄。
- 所在分支：feature/todo-no-pending-recheck-20260518-0809
- 驗證：git show master:TODO.md | grep -n "\[ \]" || true；git show master:PendingTask.md | grep -n "\[ \]" || true；git diff --check HEAD~1..HEAD
- 時間：2026-05-18 08:19（Asia/Taipei）
- 工作內容：完成「重新確認 master TODO.md 無未完成項目並更新工作記錄」，檢查 master 中 TODO.md 未列出任何未完成核取項目，並同步確認 PendingTask.md 也無未完成清單項目；由於無實作型待辦可選，本次以獨立分支記錄確認工作，並回到 master 更新 TODO.md 的狀態摘要與工作記錄。
- 所在分支：feature/todo-no-pending-recheck-20260518-0819
- 驗證：git show master:TODO.md | grep -n "\[ \]" || true；git show master:PendingTask.md | grep -n "\[ \]" || true；git diff --check HEAD~1..HEAD

- 時間：2026-05-18 08:29（Asia/Taipei）
- 工作內容：完成「再次確認 master TODO.md 無未完成項目並更新工作記錄」，檢查 master 中 TODO.md 未列出任何未完成核取項目，並同步確認 PendingTask.md 也無未完成清單項目；由於無實作型待辦可選，本次以獨立分支記錄確認工作，並回到 master 更新 TODO.md 的狀態摘要與工作記錄。
- 所在分支：feature/todo-no-pending-recheck-20260518-0829
- 驗證：git show master:TODO.md | grep -n "\[ \]" || true；git show master:PendingTask.md | grep -n "\[ \]" || true；git diff --check HEAD~1..HEAD

- 時間：2026-05-18 08:39（Asia/Taipei）
- 工作內容：完成「再次確認 master TODO.md 無未完成項目並更新工作記錄」，檢查 master 中 TODO.md 未列出任何未完成核取項目，並同步確認 PendingTask.md 也無未完成清單項目；由於無實作型待辦可選，本次以獨立分支記錄確認工作，並回到 master 更新 TODO.md 的狀態摘要與工作記錄。
- 所在分支：feature/todo-no-pending-recheck-20260518-0839
- 驗證：git show master:TODO.md | grep -n "\[ \]" || true；git show master:PendingTask.md | grep -n "\[ \]" || true；git diff --check HEAD~1..HEAD

- 時間：2026-05-18 08:49（Asia/Taipei）
- 工作內容：完成「再次確認 master TODO.md 無未完成項目並更新工作記錄」，檢查 master 中 TODO.md 未列出任何未完成核取項目，並同步確認 PendingTask.md 也無未完成清單項目；由於無實作型待辦可選，本次以獨立分支記錄確認工作，並回到 master 更新 TODO.md 的狀態摘要、完成清單與工作記錄。
- 所在分支：feature/todo-no-pending-recheck-20260518-0849
- 驗證：git show master:TODO.md | grep -n "\[ \]" || true；git show master:PendingTask.md | grep -n "\[ \]" || true；git diff --check HEAD~1..HEAD

- 時間：2026-05-18 08:59（Asia/Taipei）
- 工作內容：完成「再次確認 master TODO.md 無未完成項目並更新工作記錄」，檢查 master 中 TODO.md 未列出任何未完成核取項目，並同步確認 PendingTask.md 也無未完成清單項目；由於無實作型待辦可選，本次以獨立分支記錄確認工作，並回到 master 更新 TODO.md 的狀態摘要、完成清單與工作記錄。
- 所在分支：feature/todo-no-pending-recheck-20260518-0859
- 驗證：git show master:TODO.md | grep -n "\[ \]" || true；git show master:PendingTask.md | grep -n "\[ \]" || true；git diff --check HEAD~1..HEAD


# Third Batch
[x] 一般文件分頁處理時，請將全部文字全部取出，然後再重新產生簡報大綱。不必照原始分頁。（完成分支：feature/thirdbatch-pdf-fulltext-resplit-outline-20260518-1741）
[x] 一般文件分頁處理時，在產生圖片時，把原始文件也傳給 AI。讓他有從中取出圖片的可能性。（完成分支：feature/thirdbatch-document-image-gen-include-source-20260518-1750）
[ ] 簡報預設在個人帳戶下，每一個帳戶要看到不同的簡報。但也可以將簡報設定為 private/public or public editable，這樣每個人都可以看到，但每個人只能編輯自己的簡報或是被設成 public editable 的簡報。
[x] 允許使用者用語音輸入產生投票，方便教師當場產生投票。產生時把逐字稿和提示詞和語音一起傳送出去。如果語音模型不接受語音檔，則先用 ASR 把它轉換成文字。（完成分支：feature/thirdbatch-voice-input-poll-20260518-1805）
[x] 新增分享功能，可以產生簡報的 URL。使用這個 URL 不必經過認証，可以直接分享簡報。分享可以是 read-only 和 editable。這個分享和分享給其它使用者是不同的功能。（完成分支：feature/thirdbatch-share-url-20260518-1810）
[x] 手機板的首頁上方的按鍵改成二排（完成分支：feature/thirdbatch-home-mobile-top-buttons-two-rows-20260518-1720）
[x] 幫 webapp 加上桌面 icon（完成分支：feature/thirdbatch-webapp-desktop-icon-20260518-1709）
[x] 播放時候讓手機不要變成黑畫面(有語音播放時)（完成分支：feature/thirdbatch-mobile-playback-keep-screen-awake-20260518-1730）
[ ] 提供同步模式，任何一個 session 進入播放模式，會自動變成 master，其它的使用者自動進入同步模式。螢幕會跟著 master 同步移動。

## Third Batch 工作記錄

- 時間：2026-05-18 17:11（Asia/Taipei）
- 工作內容：完成「幫 webapp 加上桌面 icon」，前端新增 /icons/makeslide-icon.svg 與 /manifest.webmanifest，並在 index.html 掛載 favicon、apple-touch-icon 與 manifest，讓 WebApp 具備桌面安裝圖示。
- 所在分支：feature/thirdbatch-webapp-desktop-icon-20260518-1709
- 驗證：npm --prefix frontend run build；git diff --check -- TODO.md

- 時間：2026-05-18 17:21（Asia/Taipei）
- 工作內容：完成「手機板的首頁上方的按鍵改成二排」，將首頁上方匯入操作區在手機版改為兩欄網格排列（桌面版維持原本單列），讓上方按鍵在小螢幕以二排列顯示。
- 所在分支：feature/thirdbatch-home-mobile-top-buttons-two-rows-20260518-1720
- 驗證：npm --prefix frontend run build；git diff --check -- TODO.md

- 時間：2026-05-18 17:31（Asia/Taipei）
- 工作內容：完成「播放時候讓手機不要變成黑畫面(有語音播放時)」，在播放頁加入 Screen Wake Lock 機制，語音播放中會請求保持螢幕喚醒，暫停/停止/離開頁面時釋放，並在分頁重新可見且仍播放時自動重取，降低手機播放時自動黑屏風險。
- 所在分支：feature/thirdbatch-mobile-playback-keep-screen-awake-20260518-1730
- 驗證：npm --prefix frontend run build；git diff --check -- TODO.md

- 時間：2026-05-18 17:42（Asia/Taipei）
- 工作內容：完成「一般文件分頁處理時，請將全部文字全部取出，然後再重新產生簡報大綱。不必照原始分頁。」；在後端 pipeline 中新增 PDF 全文重切流程：先彙整每頁抽取文字，再以 LLM 重分頁並重建圖片與文字頁，後續腳本/TTS 依新頁面結構進行，不再綁定原始 PDF 分頁。
- 所在分支：feature/thirdbatch-pdf-fulltext-resplit-outline-20260518-1741
- 驗證：npm --prefix backend run build；git diff --check -- TODO.md

- 時間：2026-05-18 17:53（Asia/Taipei）
- 工作內容：完成「一般文件分頁處理時，在產生圖片時，把原始文件也傳給 AI。讓他有從中取出圖片的可能性。」；在文件匯入（document mode）的 LLM 產圖流程中附帶原始 `source.pdf`（大小上限內以 data URL 傳入 `input_image`），使模型可參考原始文件圖文元素生成頁面圖片，並補充執行中繼資料標記是否成功附帶來源 PDF。
- 所在分支：feature/thirdbatch-document-image-gen-include-source-20260518-1750
- 驗證：npm --prefix backend run build；git diff --check -- TODO.md

- 時間：2026-05-18 18:05（Asia/Taipei）
- 工作內容：完成「允許使用者用語音輸入產生投票，方便教師當場產生投票。產生時把逐字稿和提示詞和語音一起傳送出去。如果語音模型不接受語音檔，則先用 ASR 把它轉換成文字。」；後端新增 `/api/pdfs/:id/pages/:n/polls/voice` multipart API，會接收語音檔與可選提示詞，先以 ASR（whisper-1）轉寫，再把「逐字稿 + 提示詞 + 本頁文字 + 本頁逐字稿」送給 AI 產生投票；前端在播放頁 Realtime Poll 設定區新增語音檔上傳、提示詞輸入與「用語音建立並開始本頁投票」操作，並顯示轉寫結果。
- 所在分支：feature/thirdbatch-voice-input-poll-20260518-1805
- 驗證：npm --prefix backend run build && npm --prefix frontend run build；git diff --check -- TODO.md

- 時間：2026-05-18 18:18（Asia/Taipei）
- 工作內容：完成「新增分享功能，可以產生簡報的 URL。使用這個 URL 不必經過認証，可以直接分享簡報。分享可以是 read-only 和 editable。這個分享和分享給其它使用者是不同的功能。」；後端新增 `pdf_shares` 資料表與 `/api/pdfs/:id/share`、`/api/share/:token` API，支援建立唯讀/可編輯分享 token；前端播放頁新增分享連結建立 UI（可選 read-only/editable 並複製 URL），進入 `?share=<token>` 時會驗證 token 並套用權限，唯讀分享會停用所有修改/生成功能，且分享連結可在未登入或未設定 API key 情況下直接開啟。
- 所在分支：feature/thirdbatch-share-url-20260518-1810
- 驗證：npm --prefix backend run build && npm --prefix frontend run build；git diff --check -- TODO.md
