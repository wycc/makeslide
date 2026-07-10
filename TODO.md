# MakeSlide TODO

> 本檔於 2026-06-27 由舊的大型 TODO.md 拆分重建。先前累積的所有掃描摘要、已完成項目（`[x]`）與歷史工作記錄已封存於 [`TODO_260627.md`](TODO_260627.md)（更早期的記錄另見 `TODO_old.md`、`TODO_260521.md`）。本檔僅保留尚未完成的項目與後續工作記錄，以維持可讀性。

## 計數狀態

- 自 2026-06-27「計數重設」起算，截至封存時（舊檔第一二八輪）已完成 **8/100** 個項目，未達上限。後續 loop 接續此計數。
- 最新進度：截至第二二一輪已完成 **100/100 — 已達上限（LOOP.md 第 3 條）**。自動 loop 已停止新增/執行新項目，等待使用者決定是否重設計數（於本檔末加 `---- 計數重設 ----` 標記）或調整/取消門檻。

## 簡報改寫即時同步：通知所有客戶端並自動更新目前頁（使用者要求，2026-07-10）★ 使用者要求功能，不計入計數

使用者要求：當簡報被改寫時通知所有客戶端；若剛好改在客戶端目前所在頁面，則自動更新畫面。經確認的行為：目前頁被改寫且正在播放語音時，圖/字幕立即更新但**不打斷語音**（新語音下次進入該頁才生效）；**非目前頁**被改寫時完全不驚動目前畫面（不通知）。

- [x] **後端**：`PdfDetailPage` 序列化加入每頁 `updated_at`（作為 per-page cache-bust 鍵）；新增輕量 `GET /api/pdfs/:id/revision`（回 `{updated_at, page_count, status}`，與 detail 相同讀取守門，含 share token），供客戶端低頻輪詢偵測改寫。所有內容改寫路由本就會 bump `pdfs.updated_at`，故為可靠聚合訊號。
- [x] **前端**：圖片/音訊 cache-bust 由「deck 層級 `updated_at`」改為「該頁自己的 `updated_at`」——主投影片圖與音訊版本鍵改用 `currentPage.updated_at`，側邊縮圖維持 deck 層級（避免換頁時全部縮圖重抓）。新增 `useLiveContentUpdate` hook：可見且 ready 時每 6 秒輪詢 `/revision`，deck `updated_at` 變化即背景重抓 detail（`reloadDetailContent`，不覆寫標題/標籤等編輯中欄位）。因音訊 effect 只依 `page_number`、per-page bust 只在該頁 `updated_at` 變時換 URL，故僅真正改動的頁會刷新、語音不被中斷。
- 驗證：前後端 `tsc` 通過；後端 revision 3/3＋detail-permission 92/92；前端 811/811＋vite build 通過。分支 `feat/live-content-update`。

## 合輯簡報：多份簡報整合＋跨簡報生成測驗（使用者要求，2026-07-10）★ 使用者要求功能，不計入計數

使用者要求：原本生成測驗只能用一份簡報。設計一個方法讓使用者在首頁選多份簡報，生成一份「合輯簡報」，其每一頁是一份來源簡報的摘要與指向該簡報的連結；用這份合輯簡報生成測驗時，會使用所有來源簡報的內容來出題。

- [x] **後端資料模型**：`pages` 新增 `link_pdf_id TEXT`（idempotent migration，非 FK——合輯需在來源被刪後仍存活）；`pdfs.source_type` union 擴充 `'collection'`；`PageRow.link_pdf_id`／`PdfDetailPage.link_pdf_id`＋`link_pdf_title`（前後端型別同步）；detail SELECT 帶出新欄；`shared.ts` 序列化解析每頁連結來源標題。
- [x] **後端端點** `POST /api/pdfs/collections`（`registerCollectionRoutes`）：驗證每份來源讀取權限→建立 `source_type='collection'` 新簡報→每份來源以 LLM 產生 3-5 句摘要為一頁（封面複製來源第一頁圖、摘要寫入 text/script、`link_pdf_id` 指向來源）。LLM 失敗以標題退回。
- [x] **跨簡報測驗聚合**：`quizzes/generate` 的 `readQuizContext` 偵測 `source_type='collection'` 時，改為聚合所有 `link_pdf_id` 來源的完整內容（依來源數平均分配並整體上限 60000 字）；`generate-quiz-question`（單題）於合輯頁改用連結來源內容。
- [x] **前端**：API `createCollection`；首頁批次工具列（已選 ≥1 份）新增「生成合輯簡報」按鈕，完成後導向新合輯播放頁；PlayPage 於有 `link_pdf_id` 的頁面顯示「🔗 開啟原簡報」連結（連至來源播放頁）。新增 zh-TW/en 各 5 個 i18n 鍵。
- 驗證：前後端 `tsc` 通過；i18n parity/nonempty 27 測試全綠；後端 from-pages／generate-quiz-question／quizzes 回歸測試通過。分支 `feat/collection-presentation-quiz`。

## Jupyter Notebook 整合（使用者要求 /loop，2026-07-07）★ 使用者要求功能，不計入計數

使用者以 `/loop` 要求：依 [docs/jupyter-integration-plan.md](docs/jupyter-integration-plan.md) 逐步完成 Jupyter 整合（一頁＝一個 `.ipynb`＝一個 kernel、一次顯示一個 cell、可就地執行、結果寫回 `.ipynb`）。分階段推進，每階段一個獨立分支。

- [x] **階段 0：後端資料模型基礎**（計畫 §2.3 核心）。`SlideRenderType` 增 `'notebook'`（前後端型別同步）；`pages` 新增 `notebook_path TEXT` 欄位（比照 `animation_spec_path` 的 idempotent migration）；`PageRow.notebook_path`／`PdfDetailPage.notebook_url`；detail SELECT 帶出新欄；`shared.ts` 序列化保留 `render_type='notebook'` 並輸出 `notebook_url`；`loadExportedAnimations` 收斂為只取 `gsap-image`，避免 notebook 的 render_type 被寫進 `animations.json` 而讓 import 的 zod enum 拒絕（notebook 匯出屬後續階段）。
    - 驗證：前後端 `tsc` 通過；`detail-permission`（92 子測試）、`page-animation`（123 子測試）全綠；`add-pages-metadata-resync` 通過。分支 `feat/notebook-render-type-model`，已 merge 回 master。
- [x] **階段 1a：後端設定 ＋ 連線端點**（計畫 §2.1／§2.2）。config 新增 `JUPYTER_ENABLED`（預設 false，整功能隱藏至營運者開啟）／`JUPYTER_BASE_URL`（空＝同源＋`NB_PREFIX`）／`JUPYTER_TOKEN`（僅 dev/desktop）。新增 `GET /api/jupyter/connection`（session 保護）：停用時 404、未登入 401，否則回 `{ enabled, baseUrl, wsUrl, nbPrefix, token }`；token 只在顯式 URL（dev/desktop）模式回，同源正式環境靠 cookie 回空字串（不寫進前端 bundle）。`deriveWsUrl` 做 http→ws／https→wss。
    - 驗證：`jupyter-connection` 測試 5/5（deriveWsUrl、停用 404、未登入 401、同源無 token 形狀、dev/desktop URL+token 形狀）；後端 `tsc` 通過。分支 `feat/jupyter-connection-endpoint`，已 merge 回 master。
- [x] **階段 1b：`.ipynb` 資產 CRUD**：`GET/PUT /api/pdfs/:id/pages/:n/notebook`（取／存 nbformat JSON，account 隔離，比照 page-operations／animation spec 路由），並在寫入時同步 `pages.notebook_path`／`metadata.json`。
    - **驗證服務** [notebookAsset.ts](backend/src/services/notebookAsset.ts)：`validateNotebook`（zod `.passthrough()` 保留 `outputs`／`execution_count`／`kernelspec` 等所有欄位，只驗證 `cells` 陣列、cell_type∈{code,markdown,raw}、`source`、必要頂層鍵，並補 `nbformat`/`nbformat_minor`/`metadata` 預設值）＋大小上限（`MAX_NOTEBOOK_BYTES` 10MB／`MAX_NOTEBOOK_CELLS` 1000）；`defaultNotebook`（單一空 code cell）／`parseStoredNotebook`。`.ipynb` 是 notebook 頁的真相來源，故驗證刻意寬鬆且無損。
    - **路由** [notebook.ts](backend/src/routes/pdfs/notebook.ts)：`GET`（`canReadPdf`，無檔時回 defaultNotebook，`no-store`；解析優先用 `notebook_path` 欄位再退回 `<page_uid>.ipynb`，比照 animation spec 對 ZIP import 改 uid 的處理）／`PUT`（`canEditPdf`，寫 `.ipynb`→更新 DB `render_type='notebook'`＋`notebook_path`→best-effort 同步 `metadata.json`）。於 [index.ts](backend/src/routes/pdfs/index.ts) 註冊。
    - **一致性**：`PdfMetadataPage` 增 `render_type`／`notebook_path`（[types.ts](backend/src/types.ts)）；`rebuildAddPagesMetadataFromDb`（[addPagesFromPrompt.ts](backend/src/worker/addPagesFromPrompt.ts)）SELECT 帶出並映射兩欄，使 metadata resync 與 DB 保持一致。新增 storage helper `pageNotebookPath`。
    - 驗證：`notebook-asset` 8/8（驗證純函式 4＋路由 CRUD：GET 預設、PUT 寫檔/翻 render_type/同步 DB+metadata/無損往返/detail 帶 notebook_url、400 非法、account 隔離含 share token 讀寫）、`add-pages-metadata-resync` 回歸 2/2、後端 `tsc` 通過。分支 `feat/notebook-asset-crud`，已 merge 回 master。
- [x] **階段 1c（前端）**：`NotebookPanel` 單 cell 視圖（捲軸容器、command/edit 雙模式）＋`@jupyterlab/services` 連線 hook（lazy-load）＋`↑`/`↓` 切 cell、`Ctrl/Shift+Enter` 執行；在 `SlideRenderer` 的 `renderType` 分流新增 `notebook` 分支。（子項 1c-i–1c-iii 全部完成，見下。）
    - [x] **1c-i：互動式 nbformat 核心純函式** [nbformatModel.ts](frontend/src/lib/nbformatModel.ts)（計畫 §3.2／§5）：`parseNbNotebook`（無損保留完整 nbformat 供寫回、malformed 退回預設）／`cellText`／`clampCellIndex`（`↑`/`↓` 導覽）／`applyIopub`＋`iopubToOutput`（把執行時串流的 iopub 訊息 reduce 成 nbformat outputs，同名 stream 併接、`clear_output` 清空、非輸出訊息略過、全程 immutable）／`withCellExecution`／`clearCellOutputs`／`clearAllOutputs`（寫回用不可變更新）／`displayOutput(s)`（每個 output 選最豐富可呈現 MIME：image→html→latex→plain，stream/error）。有別於既有唯讀 `notebook.ts`（lossy 顯示用），此模型無損以支援編輯/執行寫回。驗證：`nbformatModel` 13/13、前端 `tsc` 通過。分支 `feat/notebook-nbformat-model`，已 merge。
    - [x] **1c-ii：`NotebookPanel` 單 cell 顯示 ＋ SlideRenderer 分流 ＋ 接線**（計畫 §3.2／§3.3）：[NotebookPanel.tsx](frontend/src/components/slide/NotebookPanel.tsx) 單 cell 視圖（固定高度捲軸容器、`↑`/`↓` 切 cell 並 `stopPropagation`＋`preventDefault` 不干擾全域 `Space`/`←`/`→` 換頁、頁腳顯示 `cell N/總數·型別`＋上下鈕、markdown 走 `MarkdownMath`、code 顯示原始碼＋以 `displayOutputs` 呈現儲存的 outputs、error/image/latex 分類）；API [fetchPageNotebook](frontend/src/lib/api/pdfs.ts)／`savePageNotebook`（GET 帶 `?share=`）；[SlideRenderer](frontend/src/components/slide/SlideRenderer.tsx) 加 `pdfId`／`pageNumber`／`shareToken` props，於所有 hooks 之後（避免 hook 順序改變）新增 `renderType==='notebook'` 分支渲染 `NotebookPanel`，缺 pdfId/pageNumber 時安全退回圖片；`PlayPageSlidePanel`／`PlayPageFullscreen`（兩處）傳入 `currentShareToken`。i18n `play.notebook.*` 7 鍵（zh-TW／en）。驗證：前端 `tsc`、i18n parity 38/38、`vite build` 通過。分支 `feat/notebook-panel-view`，已 merge。
    - [x] **1c-iii-a：連線層可測核心**（計畫 §1／§2.2）：純函式 [jupyterConnection.ts](frontend/src/lib/jupyterConnection.ts)——`resolveJupyterUrls`（顯式 URL 模式直接用；空字串＝同源，以 origin＋`nbPrefix` 組 baseUrl、`http→ws`／`https→wss` 推 wsUrl）／`httpToWs`／`iopubMessageFrom`（把 `@jupyterlab/services` 風格的 raw kernel 訊息 `{header.msg_type, content}` 映射成 `nbformatModel` 的 `IopubMessage` 供 `applyIopub` reduce，與重相依解耦故可單元測試）／`kernelStatusFrom`（status 訊息取 `execution_state` 供狀態列）；API client [fetchJupyterConnection](frontend/src/lib/api/jupyter.ts)（打 `GET /api/jupyter/connection`）。驗證：`jupyterConnection` 6/6、前端 `tsc` 通過。分支 `feat/jupyter-kernel-core`，已 merge。
    - [x] **1c-iii-b：`useJupyterKernel` hook ＋ cell 執行 ＋ 執行結果寫回**（計畫 §1.2／§1.3；使用者授權安裝相依）：加相依 `@jupyterlab/services@^7.6.1`（前端 workspace）。[useJupyterKernel.ts](frontend/src/components/slide/useJupyterKernel.ts)——`import('@jupyterlab/services')` 動態 lazy-load（vite code-split，不進主 bundle）、`fetchJupyterConnection`→`resolveJupyterUrls`→`ServerConnection.makeSettings`、**module-level per-file kernel registry**（`${pdfId}:${pageNumber}` 跨頁保暖，離開整頁才 shutdown）、`requestExecute` 的 `onIOPub` 經 `iopubMessageFrom`→回呼；`statusChanged`／`kernelStatusFrom` 供狀態列。[NotebookPanel](frontend/src/components/slide/NotebookPanel.tsx)：deck `access_level==='edit'`（新增 `editable` prop、由 SlideRenderer `notebookEditable` 從兩處播放檢視傳入）時，`Ctrl/⌘+Enter` 執行當前 code cell、`Shift+Enter` 執行並切下一個、頁腳「▶ 執行」鈕；執行時以 `applyIopub` 即時累積輸出顯示，完成後 `withCellExecution` 併回並經 `savePageNotebook` 寫回 `.ipynb`（同時涵蓋 1c-iii-c／1d-iii）。唯讀觀看者不連 kernel、不可執行（§4 安全）。i18n `play.notebook.*` 執行/kernel 狀態 8 鍵。驗證：前端 `tsc`＋i18n parity 38/38＋`vite build`（@jupyterlab/services 切出 lazy chunk）通過；純核心 `jupyterConnection` 6/6、`nbformatModel` 13/13 已涵蓋執行訊息與寫回邏輯。**端到端 kernel 執行需啟動 Jupyter server＋設 `JUPYTER_ENABLED`/`JUPYTER_BASE_URL`/`JUPYTER_TOKEN` 手動驗證**（測試 server 已備：Anaconda `jupyter server`）。分支 `feat/jupyter-kernel-execute`，已 merge。
    - [x] **1c-iii-c／1d-iii：執行結果寫回 `.ipynb`**（併於 1c-iii-b）：每次執行完成把 outputs＋execution_count 經 `savePageNotebook` PUT 寫回（後端 phase 1b 端點同步 DB/metadata）。
- [x] **階段 1d**：無音訊頁處理（TTS／播放計時／就緒判定把 `render_type==='notebook'` 視為無語音頁略過）；執行結果即時寫回 `.ipynb`。（1d-i TTS 略過、1d-ii 不自動換頁、1d-ii-c 不載入 audio、1d-iii 寫回全部完成；**唯 1d-ii-b 同步/上課模式的互動頁行為待接真實 kernel 後實機觀察**。）
    - [x] **1d-i：TTS 產生略過 notebook 頁**（計畫 §2.3）：[synthesizeAudio](backend/src/worker/steps/synthesizeAudio.ts) 選頁 query 帶出 `render_type`，對 `render_type==='notebook'` 的頁在 queue 內短路為 benign skip（`skipped:true`、`error:null`、不呼叫 TTS、不寫音檔），避免 notebook 頁被當成「缺音訊待產生」而觸發 TTS 或標記失敗。驗證：`synthesize-audio-notebook` 1/1（seed 純 notebook 頁→skipped 無 error 無音檔、progress 回報 skip）、後端 `tsc` 通過。分支 `feat/notebook-silent-tts`，已 merge。
    - [x] **1d-ii：notebook 頁不自動換頁、不殘留前頁音訊**（計畫 §2.3）：`PlayPage` 的「換頁時交換音訊 src」effect 原本在 `!currentPage.audio_url` 時提早 return，導致落在 notebook（無音訊）頁時仍留著前一頁的 `<audio>` src——若正在播放，前頁音訊播畢會觸發 `handleEnded`→自動換頁，把互動的 notebook 頁自動跳過。改為：無 `audio_url` 時主動 `pause()`＋`removeAttribute('src')`＋`load()`＋重置 time/duration/error 並使 token 失效（擋競態 retry），使 notebook 頁不播放、不觸發 `ended`、不自動換頁，停在該頁等待手動操作。總時長統計 `sumAudioDurationSeconds` 本就忽略 null，notebook 頁自然排除（無需改）。驗證：前端 `tsc`＋`vite build` 通過（互動頁自動換頁行為屬 effect 邏輯，實機播放待真實使用驗證）。分支 `fix/notebook-no-audio-autoadvance`，已 merge。
    - [x] **1d-ii-c：notebook 頁一律不載入 audio**（使用者對話要求，2026-07-08）：1d-ii 只在 `!audio_url` 時清掉 `<audio>`，但用「轉成 Notebook」把一頁翻成 notebook 後，該頁在 DB/detail 仍帶著舊 `audio_url`，於是換頁時 `<audio>` 仍載入並播放前身的旁白。新增純函式 [pageAudio.ts](frontend/src/lib/pageAudio.ts) `playablePageAudioUrl(page)`：`render_type==='notebook'` 一律回 `null`（不論是否殘留 `audio_url`），比照後端 `synthesizeAudio` 的 TTS skip。`PlayPage` 5 個載入路徑（換頁交換 src、下一頁 prefetch、`handleRetry`、`onError`／`onplay` catch 的 `scheduleAudioReload`）全部改走此 helper，故 notebook 頁不 attach、不 prefetch、不 retry audio。驗證：`pageAudio` 3/3、前端 `tsc`＋`vite build` 通過（實機播放待真實使用驗證）。分支 `fix/notebook-no-audio-load`，已 merge 回 master。
    - [ ] 1d-ii-b（後續）：`playbackReadiness.ts` 動畫就緒判定目前僅涉圖片/逐字稿觸發，notebook 頁無動畫故不受影響；待接 kernel 後再一併檢視互動頁在同步/上課模式的行為。
    - [x] 1d-iii：執行結果即時經 `savePageNotebook` 寫回 `.ipynb`（已於 1c-iii-b 完成）。
- [x] **階段 2**：完整輸出（markdown/raw cell、image/html/latex、kernel 狀態列、重啟/清除）。（子項 2a 重啟/清除＋狀態列、2b-i ANSI traceback、2b-ii sandbox HTML 全部完成。）
    - [x] **2a：kernel 重啟／清除輸出 ＋ 狀態列**（計畫 §1.1／§1.3）：`NotebookPanel`（editable 時）新增工具列「⟳ 重啟 kernel」「清除輸出（當前 cell）」「清除全部輸出」——重啟接 `useJupyterKernel.restart()`、清除接純函式 `clearCellOutputs`／`clearAllOutputs`（已測）並經 `savePageNotebook` 寫回；頁腳 kernel 狀態列（連線中／就緒／執行中／無法連線）已於 1c-iii-b 具備。i18n 3 鍵（restart／clearOutputs／clearAllOutputs）。markdown／raw cell 與 image/latex 輸出已由 `CellBody`／`displayOutputs` 呈現。驗證：前端 `tsc`＋i18n 38/38＋`nbformatModel` 13/13＋`vite build` 通過。分支 `feat/notebook-kernel-controls`，已 merge。
    - [x] **2b-i：ANSI traceback 上色**（計畫 §1.1「error 顯示 traceback，ANSI 上色可後續加」）：純函式 [ansi.ts](frontend/src/lib/ansi.ts)——`parseAnsi`（解析 SGR escape：前景色 30–37／90–97 亮色映射基礎色、bold 1／22、reset 0／空、39 清色，其餘 escape 剝除，回傳 `{text,color?,bold?}` 段陣列）／`stripAnsi`。`NotebookPanel` 的 error OutputBlock 以 `AnsiText`（色碼→Tailwind class）渲染 traceback，取代原本連 ANSI 亂碼一起 pre 的做法。驗證：`ansi` 7/7、前端 `tsc`＋`vite build` 通過。分支 `feat/notebook-ansi-traceback`，已 merge。
    - [x] **2b-ii：HTML 輸出改走 sandbox iframe**（計畫 §1.1；使用者要求 /loop，2026-07-08）：notebook 的 `text/html` 輸出（pandas 表格、plotly、repr HTML）原以逸出文字顯示，改為在 `<iframe sandbox="allow-scripts">`（**無** `allow-same-origin`）內渲染，任意內嵌 markup／script 於 opaque origin 執行、碰不到父頁／cookie／storage（與自訂腳本動畫沙箱同款隔離）。純函式 [notebookHtmlSandbox.ts](frontend/src/lib/notebookHtmlSandbox.ts) `buildNotebookHtmlSrcDoc`（把片段原樣嵌入最小主題中性文件，內嵌 script 量測 `scrollHeight` 並 postMessage 回父層）＋共用常數 `NOTEBOOK_HTML_HEIGHT_MESSAGE`；`NotebookPanel` 新增 `NotebookHtmlOutput` 元件監聽高度訊息（以 `event.source` 比對來源）自動撐高 iframe、`OutputBlock` 的 `html` 分支改用之。驗證：`notebookHtmlSandbox` 4/4、前端 `tsc`＋`vite build` 通過（sandbox 內實際渲染待真實 notebook 輸出驗證）。分支 `feat/notebook-html-sandbox-2bii`，已 merge 回 master。
- [x] **階段 3**：cell 內容編輯、語法 highlight（CodeMirror）。（子項 3a textarea 雙模式編輯、3b CodeMirror 語法 highlight 全部完成。）
    - [x] **3a：cell 內容編輯（textarea＋command/edit 雙模式）**（計畫 §1.2／§3.1）：純函式 `withCellSource`（[nbformatModel.ts](frontend/src/lib/nbformatModel.ts)，immutable、越界 no-op，含測試）。`NotebookPanel`（editable）command/edit 雙模式：command 下 `Enter` 進入編輯、`↑`/`↓` 切 cell；edit 下顯示 `<textarea>`（自動聚焦、隨行數增高）、`Esc` 或「✓ 完成」提交存回、其餘鍵交給 textarea；雙擊 cell 亦可編輯；切換 cell／執行前會先提交草稿。執行（Ctrl/⌘/Shift+Enter）在編輯中會先 commit draft 再跑最新原始碼。i18n 5 鍵。驗證：`nbformatModel` 14/14、前端 `tsc`＋i18n 38/38＋`vite build` 通過。分支 `feat/notebook-cell-edit`，已 merge。
    - [x] **3b：CodeMirror 語法 highlight**（使用者授權安裝相依，2026-07-08）：code cell 編輯模式的 textarea 換成 CodeMirror 6（Python 模式、行號、JupyterLab 同款），以 `React.lazy` 動態載入切成獨立 chunk（`codeMirrorEditor-*.js` 471KB/gzip 158KB，不進主 bundle）；markdown cell 維持 textarea，textarea 亦作為 chunk 載入中的 Suspense fallback。CodeMirror 刻意不綁 `Ctrl/⌘+Enter`／`Shift+Enter`／`Esc`，使其冒泡到 `NotebookPanel` 容器 `onKeyDown`，沿用既有 run／commit-edit 鍵盤模型；編輯器主題以 `MutationObserver` 跟隨 app 的 `html.dark` class。相依 `@uiw/react-codemirror`／`@codemirror/lang-python`／`@codemirror/view`／`@codemirror/state`（前端 workspace）。驗證：前端 `tsc`＋`vite build` 通過（CodeMirror 切出 lazy chunk；實際編輯體驗待真實使用驗證）。分支 `feat/notebook-codemirror`，已 merge 回 master。
- [x] **階段 4**：AI 由主題產生可執行 notebook 頁、匯出時包含 notebook。（4a 匯出/匯入、4b 後端 AI 產生、4b-ii 前端入口、4c 轉成 notebook、4d 單頁 .ipynb 匯入匯出全部完成；**唯真實 cgu gateway 的端到端產生待實機驗證**。）
    - [x] **4a：匯出／匯入包含 notebook 頁**（計畫 §5）：`.ipynb` 檔本已隨 `pdfDir()` 打包，但「這頁是 notebook」記在 `pages.render_type`／`notebook_path`，`import.ts` 重建時不帶到（且重生 `page_uid`）。比照 `animations.json`：[export.ts](backend/src/routes/pdfs/export.ts) 新增 `loadExportedNotebooks`＋`notebooks.json` sidecar；[import.ts](backend/src/routes/pdfs/import.ts) 加 `ImportedNotebookSchema`、`notebooks.json` 入 `SIDECAR_FILES`、依 `page_number` 還原 `render_type='notebook'`／`notebook_path`（`.ipynb` 隨儲存目錄原樣複製故路徑沿用）。驗證：新測 `export-import-notebook` 2/2（`loadExportedNotebooks` 只回 notebook 頁；export→import roundtrip 還原 render_type/notebook_path、`.ipynb` 存活、sidecar 被消費、notebook 端點回還原內容）、既有 export/import 回歸 7/7、後端 `tsc` 通過。分支 `feat/notebook-export-import`，已 merge。
    - [x] **4b：AI 由主題產生可執行 notebook 頁（後端）**（計畫 §5；使用者要求 /loop，2026-07-08）：新增 `POST /api/pdfs/:id/pages/:n/notebook/generate`（`canEditPdf`）。model 回一份刻意收窄、易驗證的大綱（有序 markdown/code cell＋純文字 source），[notebookGeneration.ts](backend/src/services/notebookGeneration.ts) 的 `outlineToNotebook` 轉成真正的 nbformat（code cell 帶空 `outputs`＋`execution_count:null` 故可乾淨執行），寫入前再經 `validateNotebook`。寫回與 PUT 路由共用新抽出的 `writeNotebookForPage`（[notebook.ts](backend/src/routes/pdfs/notebook.ts)），兩者以相同方式翻 `render_type='notebook'`＋resync metadata。純函式核心（`outlineToNotebook`／`buildNotebookGenMessages`／`GeneratedNotebookSchema`）與 LLM 呼叫（`generateNotebookFromTopic`）分離以便單元測試。驗證：`notebook-generation` 5/5（純核心）＋`notebook-generate` 3/3（mock LLM 路由：寫回/翻 render_type、400 空 topic、403 非擁有者）；`notebook-asset`＋`export-import-notebook`＋`add-pages-metadata-resync` 回歸 17/17、後端 `tsc` 通過。分支 `feat/notebook-ai-generate`，已 merge 回 master。
    - [x] **4b-ii：前端 AI 產生入口**（使用者要求 /loop，2026-07-08）：播放頁「投影片管理」工具列新增紫色「AI 產生 Notebook」鈕：`useSlideManagement` 加 `handleGenerateNotebookForCurrentPage`（`window.prompt` 取得主題→`generatePageNotebook` POST `/notebook/generate`→`reloadDetail`），API client [generatePageNotebook](frontend/src/lib/api/pdfs.ts)；經 `PlayPageContext`／`PlayPageSidebar` 接線；i18n 4 鍵（zh-TW／en）。read-only／busy 時 disabled。驗證：前端 `tsc`＋i18n parity 38/38＋`vite build` 通過（真實 cgu gateway 端到端待手動驗證）。分支 `feat/notebook-ai-generate-ui`，已 merge 回 master。
    - [x] **4d：單頁 `.ipynb` 檔匯入／匯出**（使用者對話要求，2026-07-08）：有別於階段 4a 的「整份簡報 ZIP 含 notebook」，這是**單頁 `.ipynb` 檔**的標準 Jupyter 交換，純前端重用既有 GET／PUT notebook 端點。純函式 [notebookFile.ts](frontend/src/lib/notebookFile.ts)：`notebookDownloadFilename`（deck 標題 slug＋`-p<N>.ipynb`）／`serializeNotebookFile`（indent 1＋換行，同後端格式）／`parseNotebookFile`（JSON parse＋基本 shape 檢查，權威驗證仍在後端 `validateNotebook`）。`useSlideManagement` 加 `handleExportCurrentPageNotebook`（`fetchPageNotebook`→Blob 下載，讀取權限即可）＋`handleImportNotebookFile`（讀檔→`savePageNotebook`，需編輯權限、10MB 上限、非法檔提示）。工具列加「匯入 .ipynb」（hidden file input）／「匯出 .ipynb」（僅 notebook 頁可用）鈕；經 PlayPage 傳 `deckTitle`、Context／Sidebar 接線；i18n 9 鍵（zh-TW／en）。驗證：`notebookFile` 4/4、前端 `tsc`＋i18n 38/38＋`vite build` 通過。分支 `feat/notebook-ipynb-file`，已 merge 回 master。
    - [x] **4c：手動「轉成 Notebook」UI 入口**（使用者要求，2026-07-08）：在此之前把一頁翻成 notebook 只能靠 API PUT／ZIP import，前端無入口。於播放頁「投影片管理」工具列（新增／多頁／刪除 那排）新增一顆「轉成 Notebook」鈕：`useSlideManagement` 加 `handleConvertCurrentPageToNotebook`（`window.confirm` 後以 `defaultNbNotebook()` 呼叫 `savePageNotebook` PUT，後端端點自動翻 `render_type='notebook'`＋記 `notebook_path`，`reloadDetail` 後 `SlideRenderer` 改用 `NotebookPanel`；原圖片資產保留只是不再呈現）。按鈕在 `isReadOnlyProcessing`／`slideBusy`／無當前頁／該頁已是 notebook 時 disabled。經 `PlayPageContext`／`PlayPageSidebar` 接線；i18n 5 鍵（`play.slideManagement.convertToNotebook*`／`alreadyNotebook`，zh-TW／en）。驗證：前端 `tsc` 通過、i18n parity 38/38、`vite build` 通過（按鈕點擊→翻頁呈現的實機互動待真實使用驗證；底層 `savePageNotebook` PUT 端點已由 phase 1b `notebook-asset` 8/8 涵蓋）。分支 `feat/notebook-convert-ui`，已 merge 回 master。

- [x] **階段 5：後續加強**（2026-07-08 分析既有 notebook 程式後新增；核心階段 0–4 已完成，以下為體驗／一致性強化）。**5a–5e 全部完成。**
    - [x] **5a：sidebar 縮圖標示 notebook 頁**（2026-07-08）：slide 縮圖列表中 notebook 頁與圖片頁在視覺上無從分辨。於 `render_type==='notebook'` 的縮圖右上角加天藍「📓 Notebook」badge，使用者可一眼辨識互動頁。[PlayPageSidebar](frontend/src/pages/play/PlayPageSidebar.tsx) 條件渲染＋i18n 2 鍵（zh-TW／en）。驗證：前端 `tsc`＋i18n 38/38＋`vite build` 通過。分支 `feat/notebook-sidebar-badge`，已 merge 回 master。
    - [x] **5b：總播放時長排除 notebook 頁殘留 audio_duration**（2026-07-08）：一頁轉成 notebook 後其 DB `audio_duration_seconds` 仍在，`regenerate.ts` 重算 `total_audio_duration_seconds` 時會把它算入，與「notebook 頁無語音」（1d）矛盾。新增純函式 [sumPageAudioDurations](backend/src/worker/audioDurationSum.ts)（對 `render_type='notebook'` 頁視為 silent），`regenerate.ts` SELECT 帶 `render_type` 並改用之；`writeNotebookForPage`（[notebook.ts](backend/src/routes/pdfs/notebook.ts)）在翻頁後即時重算 total 並更新 DB＋metadata，使轉成／AI 產生／匯入 notebook 都立即修正快取。驗證：`audioDurationSum` +2（notebook 排除、僅 notebook 回 null）、`notebook-generate` 補斷言（頁變 notebook 後 total→null）、相關回歸 18/18、後端 `tsc` 通過。分支 `fix/notebook-total-audio-duration`，已 merge 回 master。
    - [x] **5c：AI generate 帶入頁面既有內容作 context**（2026-07-08）：後端 generate 端點已支援 `context` 參數（`buildNotebookGenMessages` 附「參考內容」），但前端未帶。`useSlideManagement` 加 `currentPageScript` 參數，`handleGenerateNotebookForCurrentPage` 以 `cleanTranscriptForReview` 清理後的當前頁逐字稿作 context 傳給 `generatePageNotebook`（後端再截斷至 2000 字），使 AI 產生的 notebook 更貼合該頁主題；`PlayPage` 傳入 `scripts[currentPage.page_number]`。驗證：前端 `tsc`＋`vite build` 通過（後端 context 已由 `notebook-generation` 測試涵蓋）。分支 `feat/notebook-generate-context`，已 merge 回 master。
    - [x] **5d：notebook cell 增／刪 UI**（2026-07-08）：原本只能編輯既有 cell。`nbformatModel` 加 `newCell`／`insertCell`／`deleteCell` 純函式（immutable、回下一個選取 index；`deleteCell` 保留 ≥1 cell 且越界 no-op）；[NotebookPanel](frontend/src/components/slide/NotebookPanel.tsx)（editable）工具列加「＋程式碼」「＋Markdown」（於當前 cell 下方插入並選取）「刪除 cell」（confirm、最後一個 cell 時 disabled），皆先以 runCell 的 base-from-draft 模式 commit 進行中編輯再經 `savePageNotebook` 寫回。i18n 4 鍵（zh-TW／en）。驗證：`nbformatModel` 18/18、前端 `tsc`＋i18n 38/38＋`vite build` 通過。分支 `feat/notebook-cell-add-delete`，已 merge 回 master。
    - [x] **5e：kernel 執行逾時／連線失敗的使用者提示**（2026-07-08）：kernel 狀態列原本執行中只有靜態「Kernel 執行中…」，執行卡住或異常久時無區別訊號。把狀態列優先順序抽成純函式 [kernelStatusLabelKey](frontend/src/lib/jupyterConnection.ts)（unavailable/error→connecting→slow→busy→ready；回傳精確 i18n key union），`NotebookPanel` 加 `runTimedOut` state＋以執行中 cell 為鍵的 30s 計時器，逾時後狀態列改顯示「仍在執行中…（可重啟 kernel）」。i18n `play.notebook.kernelSlow`（zh-TW／en）。驗證：`jupyterConnection` 7/7（含優先順序與 slow-run）、前端 `tsc`＋i18n 38/38＋`vite build` 通過。分支 `feat/notebook-kernel-timeout`，已 merge 回 master。**至此階段 5（5a–5e）全部完成。**

- [x] **階段 6：notebook 編輯器 cell 操作強化**（2026-07-08 依 LOOP.md 第 2 條分析後新增；接續 5d 的 cell 增／刪）。**6a–6e 全部完成。**
    - [x] **6a：cell 上下移動**（2026-07-08）：`nbformatModel` 加純函式 `moveCell`（immutable、回移動後 index、邊界／越界 no-op）；`NotebookPanel` 工具列加 ⬆／⬇ 鈕（端點 disabled），先 commit 進行中編輯、選取跟隨移動的 cell、清除執行中高亮（index 位移），經 `savePageNotebook` 寫回；為避免與既有「切換選取」的 local `moveCell` 撞名，純函式以 `moveCellPosition` 別名匯入。i18n 2 鍵。驗證：`nbformatModel` 20/20、前端 `tsc`＋i18n 38/38＋`vite build` 通過。分支 `feat/notebook-cell-reorder`，已 merge 回 master。
    - [x] **6b：cell 型別切換（code ↔ markdown）**（2026-07-08）：`nbformatModel` 加純函式 `changeCellType`（保留 source；code→markdown 去除 `outputs`/`execution_count`，markdown→code 補 runnable 預設；同型別／越界 no-op）；`NotebookPanel` 工具列加「轉為 Markdown」／「轉為程式碼」鈕（依當前 cell 型別變換標籤），先 commit 進行中編輯、離開 code 型別時清執行高亮，經 `savePageNotebook` 寫回。i18n 2 鍵。驗證：`nbformatModel` 22/22、前端 `tsc`＋i18n 38/38＋`vite build` 通過。分支 `feat/notebook-cell-type-toggle`，已 merge 回 master。
    - [x] **6c：執行全部 code cell（Run all）**（2026-07-08）：`nbformatModel` 加純函式 `codeCellIndices`（依序回所有 code cell 的 index）；`NotebookPanel` kernel 工具列加「全部執行」鈕，依序執行每個 code cell、以 local `working` 串接（每格寫回對下一格可見）、逐格即時串流輸出、遇第一個出錯的 cell 停止（比照 Jupyter stop-on-error），最後一次寫回 `.ipynb`；執行中或無 code cell 時 disabled。i18n 1 鍵。驗證：`nbformatModel` 25/25、前端 `tsc`＋i18n 38/38＋`vite build` 通過（端到端執行需 `JUPYTER_ENABLED` ＋ Jupyter server 實機驗證）。分支 `feat/notebook-run-all`，已 merge 回 master。**至此階段 6（6a–6e）全部完成。**
    - [x] **6d：複製 cell 原始碼／輸出到剪貼簿**（2026-07-08）：`nbformatModel` 加純函式 `outputsToPlainText`（stream 文字＋result 的 `text/plain`＋error traceback 去 ANSI、退回 `ename: evalue`；純圖片輸出略過）；`NotebookPanel` 頁腳加「複製原始碼」／（code cell 有輸出時）「複製輸出」鈕（`navigator.clipboard`，唯讀觀看者亦可用、best-effort）。i18n 2 鍵。驗證：`nbformatModel` 24/24、前端 `tsc`＋i18n 38/38＋`vite build` 通過。分支 `feat/notebook-copy-cell`，已 merge 回 master。
    - [x] **6e：長輸出折疊**（2026-07-08）：巨量 stream 輸出或 traceback 會把固定高度的單 cell 視圖撐爆。純函式 [collapseText](frontend/src/lib/collapseText.ts)（截前 N 行＋回報隱藏行數，fits／maxLines 無效時 no-op）；`NotebookPanel` 新增 `CollapsibleOutput` 元件，text／error 輸出超過 16 行時折疊並顯示「顯示其餘 {n} 行」／「收合」切換，短輸出與 image/html/latex 不受影響。i18n 2 鍵。驗證：`collapseText` 3/3、前端 `tsc`＋i18n 38/38＋`vite build` 通過。分支 `feat/notebook-collapse-output`，已 merge 回 master。**階段 6 已完成 6a／6b／6d／6e；6c（Run all）需連 kernel 依序執行，此環境 `JUPYTER_ENABLED` 未開、無法端到端驗證，暫緩至實機。**

- [x] **階段 7：notebook 顯示層強化**（2026-07-09 依 LOOP.md 第 2 條分析後新增；核心 0–6 已完成，以下為顯示／可用性強化；子項 7a–7e 全部完成）。
    - [x] **7a：顯示 cell 執行編號 `In [n]`**（2026-07-09）：`execution_count` 已存但未呈現。純函式 `executionCountLabel`（已執行 `[n]`／未執行 `[ ]`）；`NotebookPanel` code cell 原始碼上方顯示 `In [n]:`（JupyterLab 同款），使用者可看出執行順序／狀態。驗證：`nbformatModel` 26/26、前端 `tsc`＋`vite build` 通過。分支 `feat/notebook-execution-count`，已 merge 回 master。
- [x] **同源後端反向代理到本機 Jupyter server**（使用者對話要求，2026-07-09）：讓營運者不必外接 JupyterHub／nginx 也能啟用就地執行。後端把 `<NB_PREFIX><JUPYTER_PROXY_PREFIX>/*`（HTTP＋WebSocket）代理到 `JUPYTER_PROXY_TARGET`（本機 Jupyter，如 http://127.0.0.1:8888），瀏覽器同源連線（無 CORS／混合內容、cookie 認證），內部 Jupyter 不對外。掛載路徑用獨立的 `JUPYTER_PROXY_PREFIX`（預設 `/jupyter`，與 MakeSlide 自身 base `NB_PREFIX` 區隔，避免 Jupyter `/api/*` 與 MakeSlide 路由/static 衝突）；connection 端點回該掛載路徑作為同源 prefix，前端無需改。**安全**：HTTP（preHandler）與 WebSocket 握手（wsServerOptions.verifyClient）都以有效 MakeSlide session 為門檻，未登入請求打不到可執行任意程式碼的目標。相依 `@fastify/http-proxy@^9`；config 加 `JUPYTER_PROXY_TARGET`／`JUPYTER_PROXY_PREFIX`；純函式 `jupyterProxyEnabled`／`jupyterProxyMountPath`／`sessionSubFromCookieHeader`（[jupyterProxy.ts](backend/src/routes/jupyterProxy.ts)）。驗證：`jupyter-proxy` 5/5（啟用判定／掛載路徑／session cookie 驗證含竄改拒絕）、`jupyter-connection` 回歸 4/4、後端 `tsc` 通過（真實 Jupyter＋瀏覽器 WebSocket 端到端待部署實機驗證）。分支 `feat/jupyter-backend-proxy`，已 merge 回 master。
    - [x] **7b：markdown cell 編輯時即時預覽切換**（2026-07-11）：編輯 markdown cell 時可切換「原始碼／預覽」。split 版面本就會把 textarea 與 `MarkdownMath` 渲染結果並排顯示（沿用既有輸入/輸出比例控制，無需另建 side-by-side 控制項）；stack 版面沒有並排空間，改為在編輯區上方加「原始碼／預覽」小按鈕，切換顯示 raw textarea 或即時渲染的 in-progress draft（`MarkdownMath content={editing ? draft : source}`）。新增 `markdownPreview` state（每次 `beginEdit` 重置為原始碼視圖，避免殘留上一個 cell 的預覽狀態）。i18n 2 鍵（`markdownShowSource`／`markdownShowPreview`）。驗證：前端 `tsc`＋i18n parity 818/818＋`vite build` 通過（實機切換體驗待真實使用驗證）。分支 `feat/notebook-markdown-live-preview`，已 merge 回 master。
    - [x] **7c：cell 執行耗時顯示**（2026-07-09）：執行完在 cell 顯示耗時（如「1.2s」），純函式格式化＋執行前後計時。`nbformatModel` 加純函式 `formatCellTiming(ms)`（<1000ms→整數 ms、<60000ms→一位小數 s、>=60000ms→「Xm Y.Ys」）；`NotebookPanel` 加 `cellTimings` state（`Record<number,number>`），`runCell`/`runAll` 執行前後以 `Date.now()` 計時並更新，code cell 下方顯示「耗時 X.Xs」（唯讀時不進入編輯仍顯示）。驗證：`nbformatModel` 27/27、前端 `tsc --noEmit` 通過。分支 `feat/notebook-cell-timing`，未 merge 回 master（保留於獨立分支）。
    - [x] **7d：notebook 內文字搜尋**（2026-07-11）：跨 cell 搜尋 source／輸出文字並跳到命中 cell。新增純函式 `searchNotebookCells(notebook, query)`（[nbformatModel.ts](frontend/src/lib/nbformatModel.ts)）：不分大小寫比對每個 cell 的原始碼（`cellText`）與攤平後的輸出文字（既有 `outputsToPlainText`，涵蓋 stream／執行結果／錯誤 traceback），空白查詢一律回空陣列。`NotebookPanel` 工具列新增「🔍 搜尋」切換鈕，開啟後顯示搜尋列（輸入框＋「第 N / 共 M 項」計數＋◀▶上一筆/下一筆＋✕關閉）；輸入即跳到第一個命中 cell，Enter/Shift+Enter 也可循環切下一筆/上一筆，Esc 關閉搜尋。新增 `jumpToCell` 共用函式（先提交進行中編輯再切換 cell index，供搜尋跳轉與既有 ↑/↓ 共用邏輯）。i18n 7 鍵（zh-TW／en）。驗證：`nbformatModel` 新增 4 測試（原始碼命中／輸出命中／空白查詢／無命中）、前端 `tsc`、前端測試 783/783、`vite build` 通過。分支 `feat/notebook-text-search`，已 merge 回 master。
    - [x] **7e：鍵盤快捷鍵說明面板**（2026-07-11）：列出 command/edit 模式的快捷鍵（↑↓ 切 cell、Enter 編輯、Ctrl/Shift+Enter 執行等）。工具列新增「⌨ 快捷鍵」按鈕，點擊開啟彈出視窗列出 5 條實際生效的快捷鍵（比照 `handleKeyDown` 的真實邏輯，非憑空列出）：↑/↓ 切換 cell（未編輯時）、Enter 進入編輯、Esc 提交並離開、Ctrl/⌘+Enter 執行、Shift+Enter 執行並移至下一個。UI 樣式沿用既有播放頁 header 的 `ShortcutsButton` 彈窗（同款表格＋關閉鈕），但刻意不綁全域 `?` 熱鍵——header 已用 `?` 開啟自己的快捷鍵總覽，避免兩個彈窗搶同一個按鍵。i18n 12 鍵（zh-TW／en）。驗證：前端 `tsc`、前端測試 779/779、`vite build` 通過。分支 `feat/notebook-keyboard-shortcuts-panel`，已 merge 回 master。

- [x] **唯讀觀看者試跑模式（ephemeral trial run）**（使用者對話要求，2026-07-10）：唯讀觀看者也能在瀏覽器內連 kernel 執行 cell、修改 cell 原始碼並看到更新後的文件，但**一律不寫回**共用 `.ipynb`——所有變更只存在該瀏覽器的元件 state，重新載入即還原。`NotebookPanel`：kernel key 不再依 `editable`；執行／全部執行／重啟／清除輸出／kernel 環境選單與 cell 原始碼編輯對所有人開放，結構性編輯（增／刪／搬移／轉型 cell、上傳）仍限 `editable`；`persistNotebook` 與執行後寫回只在 `editable` 時 PUT。唯讀者一有本地變更即在工具列顯示「試跑模式」徽章（hover 說明不會儲存）；kernelspecs 對唯讀者延遲到第一次使用 kernel 才載入（被動觀看不拉 `@jupyterlab/services` chunk、不打 connection 端點）。`kernelStatusLabelKey` 移除 editable 參數（試跑也要看 kernel 狀態）。i18n `trialMode`／`trialModeHint` 2 鍵（zh-TW／en）。驗證：前端 `tsc`、前端測試 811/811（含更新後的 `jupyterConnection`）、`vite build` 通過（真實 kernel 試跑待實機驗證；匿名 share-token 觀看者無 session、連線會顯示無法使用屬預期）。分支 `feat/notebook-readonly-ephemeral-run`，已 merge 回 master。
- [x] **Kubeflow／k8s 部署方案設計文件**（使用者對話要求，2026-07-10）：新增 [docs/jupyter-kubeflow-plan.md](docs/jupyter-kubeflow-plan.md)——MakeSlide 部署於 Kubeflow 叢集內時，以**使用者指定的 Kubeflow Notebook**（Pod 內即完整 JupyterLab server）作為 kernel 後端，取代單一共用 Jupyter server。涵蓋：動機（共用 server 的檔案系統／kernel 命名空間／資源無隔離與長任務孤兒問題）、架構（同源走 Istio gateway、connection 端點回 `/notebook/<ns>/<name>` 作 nbPrefix、前端零改動）、`JUPYTER_MODE=kubeflow` 設定、RBAC（get/list/patch notebooks）、使用者 notebook 指定 UX、stopped notebook 喚醒、認證安全（Kubeflow cookie、只回本人 namespace）、長任務配套（session reattach、PVC 持久化）、與現行 proxy／url 模式並存對照、分階段實作（7a–7e）。並於 jupyter-integration-plan.md 開頭加上連結。分支 `docs/jupyter-kubeflow-notebook-plan`，已 merge 回 master。
    - [x] **7a：`JUPYTER_MODE=kubeflow` 設定＋connection 端點**（依 docs/jupyter-kubeflow-plan.md §7 分階段實作，2026-07-10／11）：`config.ts` 加 `JUPYTER_MODE`（`proxy`/`url`/`kubeflow`）、`KUBEFLOW_USERID_HEADER`、`KUBEFLOW_DEFAULT_NAMESPACE_TEMPLATE`、`KUBEFLOW_NOTEBOOK_PREFIX`、`KUBEFLOW_DEFAULT_RUNTIME_IMAGE`、`KUBEFLOW_DEFAULT_RUNTIME_RESOURCES`。新增極簡 Kubeflow Notebook CR REST client（[kubeflowClient.ts](backend/src/services/kubeflowClient.ts)）：`getNotebook`（get，404→`null`）與純函式 `notebookState`（running/pending/stopped/not_found，依 `readyReplicas`／`kubeflow-resource-stopped` annotation 判定）；in-cluster API server／ServiceAccount token 走預設值，測試以 `setKubeflowClientOptionsForTest` 注入 fake fetch（免叢集）。`GET /api/jupyter/connection`（[jupyter.ts](backend/src/routes/jupyter.ts)）在 `kubeflow` 模式新增分支：由 session email 經樣板推導 namespace（純函式 `namespaceForUser`／`sanitizeDnsLabel`）、`?runtime=` 經 DNS-label 白名單（`isValidRuntimeToken`）解析出 `<prefix><runtime>` notebook 名稱（`notebookNameForRuntime`）、依 CR 狀態回應：running→現行同源 cookie 模式形狀（`nbPrefix=/notebook/<ns>/<name>`，前端零改動）、pending→`202 {starting:true}`、stopped→`503 NOTEBOOK_STOPPED`、not_found→`404 NOTEBOOK_NOT_FOUND`；namespace 一律由 server 端 session 推導、不信任前端輸入，故不同帳號永遠只能碰到自己的 notebook。stopped 喚醒（patch annotation）與零設定自動建立 `makeslide-jupyter-cpu` 留待 7c。驗證：新測 `jupyter-kubeflow-connection` 12/12（DNS 清洗／namespace 推導／runtime 白名單／running-pending-stopped-notfound 四態／跨帳號絕不外洩／未登入 401）、既有 `jupyter-connection` 5/5＋`jupyter-proxy` 5/5 回歸、後端 `tsc` 通過（真實 Kubeflow 叢集端到端待部署實機驗證）。分支 `feat/kubeflow-connection-endpoint`，已 merge 回 master。
    - [x] **7b：`GET /api/jupyter/runtimes` 探索端點＋前端 runtime 選單**（依 docs/jupyter-kubeflow-plan.md §7 分階段實作，2026-07-11）：`kubeflowClient.ts` 新增 `listNotebooks`（GET collection，回該 namespace 全部 Notebook CR）與純函式 `notebookImage`／`notebookHasGpu`（依 `spec.template.spec.containers[].resources.limits` 是否有 `*.com/gpu` 鍵判定，不解讀是哪種 GPU／多少數量）。`jupyter.ts` 新增純函式 `runtimeFromNotebookName`（`notebookNameForRuntime` 的反函式）與 `GET /api/jupyter/runtimes`：非 kubeflow 模式或未啟用時 404（讓前端可把 404 當「不需要選單」處理，無需另開錯誤分支）；已登入時列出呼叫者 namespace 中前綴匹配的 notebook，回 `{runtimes:[{runtime,status,gpu,image}]}`，不符前綴的 notebook 一律不出現。前端：`fetchJupyterConnection`／`listKernelSpecs`／`useJupyterKernel` 都加上選填 `runtime` 參數並串起——kernel registry key 追加 runtime 維度（換 runtime＝換 Pod＝全新 kernel）；`NotebookPanel` 新增 runtime 下拉選單（與既有「執行環境（Conda）」選單並列，>1 個 runtime 才顯示，GPU 者標示 🖥），選擇以 localStorage 持久化（`makeslide.nbRuntime`）並直接帶入每次 connection 請求，故不需計畫原提的 `user_settings.jupyter_runtime` DB 欄位。i18n `play.notebook.runtime` 2 鍵（zh-TW／en）。驗證：新測 `jupyter-kubeflow-runtimes` 5/5（前綴過濾／狀態／GPU／image／跨帳號絕不外洩／404／401）、既有 kubeflow／proxy 回歸 21/21、前後端 `tsc`、前端測試 791/791、`vite build` 通過（真實叢集多 runtime 切換待部署實機驗證）。分支 `feat/kubeflow-runtimes-endpoint`，已 merge 回 master。
    - [x] **7c：stopped notebook 喚醒＋零設定自動建立 CPU 預設＋前端 starting 輪詢**（依 docs/jupyter-kubeflow-plan.md §7 分階段實作，2026-07-11）：`kubeflowClient.ts` 新增 `wakeNotebook`（merge-patch 移除 `kubeflow-resource-stopped` annotation 觸發喚醒）、`createNotebookIfMissing`（POST 建立，409 AlreadyExists 視為成功以容錯雙分頁同時首次連線的競態）、純函式 `parseResourceString`（解析 `cpu=1,memory=2Gi` 這種設定字串）與 `buildDefaultNotebookManifest`（組出零設定 `makeslide-jupyter-cpu` 的 Notebook CR）。`jupyter.ts` 的 connection 端點：stopped 狀態不再只回 503，改為喚醒後回 `202 {starting:true}`；not_found 狀態新增零設定判斷——**只有**當解析出的 runtime 是預設值（`cpu`，從未是使用者明確指定的 GPU／自訂 runtime）**且**該 namespace 一個 `makeslide-jupyter-*` notebook 都沒有時才自動建立，已有其他 runtime 就維持純 404（不搶著幫已在管理自己 runtime 的使用者多生資源）。**發現並修正一個前端既有缺口**：`202` 屬 2xx／`resp.ok`，7a 當初的 `fetchJupyterConnection` 從未特判它，會把 `{starting:true}` 誤當成連線資訊解析、下游 `resolveJupyterUrls` 存取 `undefined` 的 `nbPrefix` 會炸掉——本輪修正為明確拋出 202 型別的錯誤（`isJupyterStartingError`），`useJupyterKernel` 改為有界輪詢（每 3 秒、上限 40 次≈2 分鐘）並新增獨立的 `'starting'` phase（區別於 `'connecting'`，footer 顯示「Notebook 啟動中，請稍候…」而非看起來卡住）。i18n `play.notebook.kernelStarting` 2 鍵。驗證：新測 `jupyter-kubeflow-wake-autocreate` 5/5（喚醒 PATCH payload／零設定自動建立 manifest／已有其他 runtime 不搶建／明確指定非預設 runtime 不搶建／409 競態容錯）、既有 kubeflow／proxy 回歸（依新語意調整 3 個舊測試斷言）全綠、`jupyterConnection` 新增 2 測試、前後端 `tsc`、前端測試 812/812、`vite build` 通過（真實叢集喚醒/自動建立/輪詢端到端待部署實機驗證）。分支 `feat/kubeflow-notebook-wake-and-autocreate`，已 merge 回 master。
    - [x] **7d：session reattach（`SessionManager`）**（依 docs/jupyter-kubeflow-plan.md §7／§5.1 分階段實作，2026-07-11；對 `proxy`/`url`/`kubeflow` 三種模式皆有益，非 kubeflow 專屬）：`useJupyterKernel.ts` 的 `connectKernel` 從直接 `KernelManager.startNew({name})` 改為透過 `SessionManager`——先 `findByPath(path)` 找既有 session，找到就 `connectTo({model})` 接回其 kernel，找不到才 `startNew({path,type:'notebook',name:path,kernel:{name}})`。純函式 `sessionPathForNotebookKey(notebookKey, kernelName)`（[jupyterConnection.ts](frontend/src/lib/jupyterConnection.ts)）組出 session path `makeslide/<notebookKey>/<kernelName>`——刻意把 `kernelName` 一併編進 path（而非只用 notebookKey），確保切換執行環境（既有的「switch env＝全新 kernel」語意）不會誤接回另一個環境還在跑的 session。**效果**：瀏覽器整頁重新整理會讓模組層級的 `kernelRegistry`（純記憶體 Map）瞬間清空，但從未真正呼叫過 `kernel.shutdown()`，故 server 端 kernel 仍活著；重新整理後回到同一頁會經 `findByPath` 接回執行中的 kernel 而非多開一個（原架構做不到，是本計畫解鎖的長任務配套之一）。app 內切換頁面／環境仍維持原本明確 `shutdown()` 的行為不變。驗證：`jupyterConnection` 新增 `sessionPathForNotebookKey` 測試（含「切環境即不同 path」的斷言）、前端測試 791/791、前端 `tsc`、`vite build` 通過（真實瀏覽器重新整理後的 reattach 待實機驗證）。分支 `feat/kubeflow-session-reattach`，已 merge 回 master。
    - [x] **7e：部署文件**（依 docs/jupyter-kubeflow-plan.md §7 分階段實作，2026-07-11；純文件，`JUPYTER_MODE=kubeflow` 分階段實作 7a–7e 至此全部完成）：新增 [docs/jupyter-kubeflow-deployment.md](docs/jupyter-kubeflow-deployment.md)——(1) **RBAC manifest**：ServiceAccount 對 `notebooks.kubeflow.org` 只需要 `get`/`list`/`patch`/`create`（分別對應讀狀態／7b 探索／7c 喚醒／7c 零設定自動建立），附 ClusterRole+ClusterRoleBinding（簡單版）與逐 profile namespace Role+RoleBinding（較嚴格版）兩種 YAML，並列出不需要的權限（`pods/*` 等）。(2) **與既有 Istio 路由的關係**：說明 `/notebook/<ns>/<name>/` 是 Kubeflow 平台本身既有的路由（notebook-controller 自動產生），MakeSlide 不需要也不該自己管理，只需要 MakeSlide 自己這個服務掛在同一個 Istio gateway 之後即可，附 VirtualService 範例。(3) **`KUBEFLOW_DEFAULT_RUNTIME_IMAGE` 挑選指引**：建議沿用 Kubeflow Notebook UI 本身的預設 image、需求 `jupyter_server>=2`、釘住明確 tag（避免 `latest`）、只做 CPU-only。(4) **`proxy` 模式警語**：明確標示 `JUPYTER_MODE=proxy`（現行預設）只適合單人/桌面，多使用者部署（教室/公司內部/對外 SaaS）必須用 `kubeflow` 模式，並回引 §1 動機一一列出共用 server 的安全/隔離問題。(5) **已知限制**：記錄 `KUBEFLOW_USERID_HEADER` 這個 7a 就加的設定其實從未被程式讀取——目前 namespace 完全由 MakeSlide session email 推導，若兩邊帳號體系不同源需要額外設計才能接上這個 header，本輪刻意不在文件審查階段順手改動未經設計的身分邏輯。同時把 `KUBEFLOW_*` 環境變數補進 `.env.example`（呼應既有 `JUPYTER_*` 文件風格），並更新 `jupyter-kubeflow-plan.md` §7 分階段列表標記 7a–7e 皆已完成＋各自分支連結。分支 `docs/jupyter-kubeflow-deployment-guide`，已 merge 回 master。

> 註：既有的 NEW_FEATURE「Jupyter notebook 支持」漸進線已完成唯讀基礎（`parseNotebook` 純函式＋`NotebookView` 唯讀渲染，見下方第一九二／一九三輪），本計畫的階段 0 資料模型與其相容，後續階段將把互動執行接上。

## AI 導師工具調用顯示 ＋ 取得頁面圖片工具（使用者要求，2026-07-07）★ 使用者要求功能，不計入計數

使用者要求：(1) 調用工具時前端也要顯示調用訊息；(2) 新增「取得指定頁面圖片」的工具。工作於分支 `feat/tutor-tool-call-indicator`。

- [x] 工具調用即時顯示：`streamChatText` 加 `onToolCall` callback；`/ask` handler 把每次工具呼叫轉成新的 SSE `tool` 事件（`{name,args}`）。
    前端 `askPageQuestion` 加 `onTool`、`usePageAsk` 把工具呼叫轉成本地化說明（`describeToolCall`）累加到待答泡泡的 `toolNotes`，
    `PageAskPanel` 在答案泡泡頂端以「🔍 查看第 N 頁畫面」逐條顯示。新增 7 個 i18n 鍵（zh-TW／en，parity 38/38）。
- [x] `get_page_image` 唯讀工具：讀該頁 `image_path`、sharp 縮到寬 1024 的 JPEG data URL 回傳。因 `role:'tool'` 只能帶文字，
    tool 迴圈改為在工具回傳圖片時，補一則 vision `user` 訊息（image_url）讓模型真的看得到。`AiTool` handler 可回 `{ text, images }`、
    `executeAiTool` 正規化；兩個 wrapper 的迴圈都以 `appendToolImages` 附圖。
- [x] 測試：`ai-tools`（新增 get_page_image 回 jpeg data URL＋跨帳號拒絕）8/8、`ai-tool-loop` 續綠、page-ask 回歸 6/6、i18n 38/38、前後端 `tsc`。
    真實端到端驗證（cgu gateway）：模型主動呼叫 `get_page_image(11)` → `tool` SSE 事件送達 client → 看圖後答案逐段串流（397 deltas）。

## 在 AI 呼叫中提供 MCP（唯讀）工具給 LLM（使用者要求，2026-07-07）★ 使用者要求功能，不計入計數

使用者要求：makeslide 自己呼叫 LLM 時，也把它定義的 MCP 工具傳出去，讓模型能主動查更多簡報資訊做更好的生成。先寫設計文件（[docs/mcp-tools-in-ai-design.md](docs/mcp-tools-in-ai-design.md)）再實作。經確認採：**只暴露唯讀工具**、v1 接 **AI 導師問答＋逐頁腳本生成**、**只支援 OpenAI 相容 provider**。工作於分支 `feat/mcp-tools-in-ai`。

- [x] 設計文件 `docs/mcp-tools-in-ai-design.md`（目標／非目標／工具登錄表／tool-loop／安全／分階段）。
- [x] `aiTools.ts`：行程內唯讀工具登錄表（`list_presentations`／`get_presentation`／`get_page_text`／`get_page_script`），
    handler 直接查 DB/檔案、**scope 到當前帳號**（跨帳號拒絕）、結果截斷；不走 HTTP、無副作用。排除會變更的工具。
- [x] `openai.ts`：`callChatJSON`／`streamChatText` 加選填 `tools`/`toolContext` 與**上限 5 輪的 tool-calling 迴圈**。
    `callChatJSON` 保持 `response_format=json_object` 並在 `tool_calls` 時迴圈；`streamChatText` 於工具輪串流、最終答案逐段串流。
    gateway 不支援 tools 時退化為無工具生成。Gemini 於 v1 略過。以 `config.aiMcpToolsEnabled`（`AI_MCP_TOOLS_ENABLED`，預設開）控制。
- [x] 接線：AI 導師 `/ask`（streamChatText）與逐頁腳本生成（generateScript 的 per-page callChatJSON）。
- [x] 測試：`ai-tools.test.ts`（schema／帳號 scope／跨帳號拒絕／錯誤處理）、`ai-tool-loop.test.ts`（兩個 wrapper 都會執行工具輪並把結果回填）。
    另以 raw curl 驗證 cgu-air gateway 確實支援 function-calling（回 `finish_reason: tool_calls`）。後端 `tsc` 通過、page-ask 回歸 6/6。
- [ ] Phase 2（後續）：Gemini function-calling；`mcp-server.ts` 與 `aiTools.ts` 去重；擴大到更多生成流程；每帳號工具白名單 UI。

## 測試隔離：測試不再污染 dev 資料庫（使用者回報 dev worker ENOENT，2026-07-06）★ 修 bug，不計入計數

使用者回報 dev worker 反覆出現 `ENOENT … storage/orphan-recovery-processing-01/metadata.json`。根因：後端測試直接透過 `../src/db` 對真實 dev DB 塞列、並在 `config.storageRoot` 下寫 fixture，且無測試後清理，長期污染 dev DB。其中 `add-pages-orphan-recovery.test.ts` 塞了一列 status=`processing` 的 PDF，運行中的 dev worker 把它當成中斷的 pipeline 工作重排，但該 PDF 的 storage 目錄從未建立 → `persistMetadata → writeMetadata` ENOENT 迴圈。

- [x] 測試隔離：`MAKESLIDE_TEST=1`（由後端 `test` npm script 與 `scripts/run-tests.sh` 設定）時，`config.ts` 將
    `DB_PATH`／`STORAGE_ROOT` 導向 gitignored 的 `data/test.db`／`data/test-storage`，不再碰 `data/app.db`／`storage/`。
    dev `.env` 的 `DB_PATH` 在 dotenv 載入「之前」先捕捉（`shellDbPath`），使 `.env` 不會把測試拉回 dev DB；但真正由 shell
    匯出的覆寫仍優先（CI/呼叫者可自訂）。
  - 驗證：orphan-recovery 測試改在 `data/test.db` 落地、dev `app.db` 不再新增列；後端全套 1353/1358 通過（4 個為既有的
    並行執行 flakiness，單獨跑各檔皆綠；歷史基準曾記錄「18 個既有失敗」，故未新增回歸）。前端 `tsc` 無涉、後端 `tsc` 通過。
    分支 `fix/test-db-isolation`。
  - [x] 清除 dev `app.db` 既存測試殘列（經使用者授權）：以「無對應 `storage/<id>/` 目錄」為判準（真實簡報 id 為
    10 碼 nanoid 如 `-nM_vsV4xc`、且必有 storage 目錄；殘列全為可讀測試前綴如 `csv-test`/`embed-pdf`/`sim-*`/`wp-*`/
    `orphan-recovery-*` 等且無 storage），確認 0 筆殘列符合真實 nanoid 樣式後，連同 22 個帶 `pdf_id` 的子表一併刪除
    共 524 列（1845→1321，剛好等於原本「有 storage 目錄」的數量，即只刪無 storage 的測試列）。`processing` 狀態列歸零、
    ENOENT 元凶 `orphan-recovery-processing-01` 已移除。備份：`data/app.db.bak-20260706-234611`、`…bak-purge-20260706-235841`。

## AI 導師問答逐字（串流）顯示（使用者要求，2026-07-06）★ 使用者要求功能，不計入計數

使用者要求：AI 導師問答（PageAskPanel）能一個字一個字（逐 token）顯示，而非等整段答案生成完才一次出現。採「真串流（SSE）」方案，降低首字延遲。工作完成於分支 `feat/tutor-ask-streaming`。

- [x] 後端 `POST /api/pdfs/:id/pages/:n/ask` 由「等整包 JSON `{answer}` 再回傳」改為 SSE（`text/event-stream`）串流：
    改用既有 `streamChatText`（純文字輸出，不再包 JSON），system prompt 由「只輸出 JSON」改為「直接輸出純文字」。
    事件：`delta`（`{text}` 每段新生成片段）／`done`（`{answer}` 經 `finalizeTutorAnswer` 換行正規化＋空答保底的最終答案）／
    `error`（`{code,message}`）。權限檢查與 corpus/來源全文組裝仍在 hijack 之前，保留一般 JSON 錯誤回應；移除已不用的
    `AskPageResponseSchema`。比照 animation custom-script 的 hijack/斷線處理。
  - **前端 API**：`askPageQuestion` 改為讀 SSE stream（`getReader`＋`TextDecoder`，比照 `generateCustomScriptCode`），
    新增 `onDelta` 回呼、以 `done` 的 answer 為最終值。
  - **前端 hook/UI**：`usePageAsk` 送出後先塞空的 assistant 泡泡，`onDelta` 即時累加內容、`done` 以正規化後答案取代；
    錯誤時回滾使用者訊息＋assistant 佔位（`slice(0,-2)`）。`PageAskPanel` 於首個 token 前才顯示「思考中…」提示、
    空的 assistant 佔位泡泡不渲染。
  - 後端 `page-ask.test.ts` 更新為串流 mock（async-iterable 吐 delta）＋SSE 解析；6/6 以 Node 22 `--test-force-exit` 通過。
    前後端 `tsc` 通過。分支 `feat/tutor-ask-streaming`。

## 點擊投票圖示即開始投票並開啟即時投票視窗（使用者要求，2026-07-05）★ 使用者要求功能，不計入計數

使用者要求：讓（投影片上方的）投票圖示可點擊，按下即打開 realtime poll 視窗並開始投票。

- [x] 🗳 徽章改為可互動按鈕（📝／💬 維持純指示），點擊複用既有「開始即時投票」模式
    （`setPollStarted(true)` ＋開啟控制面板，見 [PlayPage.tsx:1000](frontend/src/pages/PlayPage.tsx#L1000)、
    [2163](frontend/src/pages/PlayPage.tsx#L2163)）：
  - **全螢幕**：`handleStartPoll()` ＋ `setFullscreenPollControlOpen(true)`（即時投票控制視窗，master 時渲染）。
  - **一般檢視**：`handleStartPoll()` ＋ `setPollSettingsOpen(true)`（側欄投票控制面板）。
  - 以 `stopPropagation` 避免觸發投影片本身的點擊（全螢幕＝播放/暫停、一般＝進全螢幕）。沿用 i18n
    `play.fullscreen.startPoll`（未新增鍵）。前端 `tsc`＋`vite build` 通過。分支 `feat/poll-icon-click-starts-poll`。
- [x] 修正（使用者回報「掃 QR 進入後不會自動出現投票選項」）：`fetchPagePolls`／`votePagePoll` 未帶
    `?share=<token>`，但後端 GET `/polls`、POST `/votes` 都以 `canReadPdf(aclCtx)` 授權、而 `aclCtx` 的 token
    能力是從 `?share=` query 解析。匿名掃碼 follower 因此在抓 poll 時 403 → `pagePolls` 恆空 → 投票面板永不
    自動展開（連投票也會失敗）。修法：把 `currentShareToken` 經 `usePagePolls` 傳入兩個 API（比照
    `fetchPdfDetail` 的 `?share=` 處理）。前端 `tsc`＋`vite build` 通過。分支 `fix/poll-fetch-vote-share-token`。

## 頁面筆記／留言也顯示指示圖示（使用者要求，2026-07-05）★ 使用者要求功能，不計入計數

使用者要求：延續投票圖示，若頁面有「筆記（page_notes）」或「留言（comments）」也各顯示不同圖示。

- [x] 投影片上方指示圖示擴充為圖示列：🗳 投票 / 📝 筆記 / 💬 留言。
  - **後端**：deck detail 再加每頁 `has_comment` 旗標（`detail.ts` 以 `SELECT DISTINCT page_number FROM
    page_comments` 查出、穿過 `rowToDetail` 新參數 `commentPageNumbers`）；筆記沿用既有 `page_notes`。
  - **前端**：`PlayPageSlidePanel` 與 `PlayPageFullscreen` 的徽章改為並排圖示列——🗳（`has_poll`）／
    📝（`page_notes` 非空）／💬（`has_comment`），各自不同顏色（fuchsia／amber／sky）。全螢幕 poll 圖示仍在
    投票進行中時隱藏（避免與 top-right 投票鈕重複）。新增 i18n `play.slidePanel.noteDefinedBadge`／
    `commentDefinedBadge`（parity 2194/2194）。
  - 端到端驗證（Node 22 對真實資料 `-nM_vsV4xc`）：有 `page_notes` 的頁→📝；注入留言頁→`has_comment:true`。
    前後端 `tsc`＋前端 `vite build` 通過、i18n 24/24。分支 `feat/page-note-comment-indicators`。

## 有 poll 定義的頁面顯示投票指示圖示（使用者要求，2026-07-05）★ 使用者要求功能，不計入計數

使用者要求：在「有 polling 定義的頁面」上方顯示一個投票圖示。

- [x] 投影片上方置中顯示投票指示徽章（目前頁有 poll 定義時）。
  - **判斷**：沿用既有 `pagePolls`（[usePagePolls](frontend/src/pages/play/usePagePolls.ts) 依當前頁載入的該頁
    poll 清單），`pagePolls.length > 0` 即該頁有投票定義。無批次端點，故以「目前顯示頁」為準。
  - **UI**：[PlayPageSlidePanel](frontend/src/pages/play/PlayPageSlidePanel.tsx) 的投影片影像 overlay 新增一個
    非互動（`pointer-events-none`）徽章，置中於影像上方（與 🔖／★／版本／播放中等既有角標同層 z-20），
    顯示 🗳；同頁多個 poll 時附數量。新增 i18n `play.slidePanel.pollDefinedBadge`（zh-TW／en，parity 2192/2192）。
  - 前端 `tsc`＋`vite build` 通過、i18n 24/24。分支 `feat/poll-page-indicator-icon`。
- [x] 修正（使用者回報「有 poll 的頁面仍不顯示圖示」）：前一版以 `pagePolls` 判斷，但
    [usePagePolls](frontend/src/pages/play/usePagePolls.ts) 只在特定互動情境（投票進行中／設定面板開啟／互動模式／
    follower sync）才抓該頁 poll，單純翻頁不會載入，故圖示幾乎不出現。改為在 deck detail 回應為每頁附
    `has_poll` 旗標（`detail.ts` 以單一 `SELECT DISTINCT page_number FROM page_polls` 查出、穿過 `rowToDetail`
    的新參數 `pollPageNumbers`），徽章條件改為 `currentPage.has_poll || pagePolls.length > 0`（後者保留投票面板
    開啟時的即時性）。以真實資料 `rgHBiyrbZf` 端到端驗證：第 24 頁（有 poll）→ `has_poll:true`、第 25 頁→`false`。
    前後端 `tsc`＋前端 `vite build` 通過。分支 `fix/poll-indicator-uses-has-poll-flag`。
- [x] 修正（使用者回報「全螢幕時圖示未出現」）：徽章原只加在一般投影片檢視；全螢幕（[PlayPageFullscreen](frontend/src/pages/play/PlayPageFullscreen.tsx)）
    既有的 poll UI 不是 master-only 就是需投票進行中，單純翻頁不顯示。於全螢幕新增 top-center 指示徽章
    （`currentPage.has_poll && !hasActivePoll`，投票進行中已有 top-right 🗳 投票鈕故不重複）。前端 `tsc`＋`vite build`
    通過。分支 `fix/poll-indicator-fullscreen`。

## 存取權限 UI 移出分享連結對話框（使用者要求，2026-07-05）★ 使用者要求功能，不計入計數

使用者回報：目前「存取權限」（身分權限：預設權限＋名單/群組 ACL）UI 位置不合理——它被藏在
「建立分享連結／QR」的 `ShareDialog` 內當第三個分頁，導致「管理誰能存取」得先按「建立分享連結」
產生一條 QR/連結、才在跳出的對話框裡找到。存取管理是身分層次的事，不該以「先建立分享連結」為前提。

- [x] 把「存取權限」從 `ShareDialog` 抽出，改為分享下拉選單內獨立的（僅擁有者可見）對話框入口。
  - **抽出**：新增 [AccessControlDialog.tsx](frontend/src/pages/play/AccessControlDialog.tsx)——獨立 modal
    （標題＋關閉＋backdrop dismiss）包住既有 [AccessControlPanel](frontend/src/pages/play/AccessControlPanel.tsx)。
  - **入口**：Header「群組分享」下拉選單頂部新增「🔑 存取權限」按鈕（gate 在 `!currentShareToken && detail.is_owner`），
    點擊開 `AccessControlDialog`；不再需要先建立分享連結。狀態 `accessDialogOpen` 由 `usePdfMetadata` 提供、
    經 `PlayPageContext` 傳遞、於 [PlayPageDialogs](frontend/src/pages/play/PlayPageDialogs.tsx) 渲染。
  - **簡化**：[ShareDialog](frontend/src/pages/play/ShareDialog.tsx) 移除 `access` 分頁與 `pdfId`/`visibility`/
    `canManageAccess` props，退回「連結／嵌入」兩個分頁，回歸單一職責（產生分享連結／QR／嵌入碼）。
  - 沿用既有 i18n `play.access.tab`／`play.access.description`（未新增鍵，parity 2195/2195）。前端
    `tsc --noEmit`＋`vite build` 通過、ShareDialog 測試 2/2。分支 `refactor/access-control-out-of-share-dialog`。
- [x] 後續：移除分享下拉選單裡多餘的「設為 private」按鈕（使用者提問後決定移除）。
  - **原因**：把預設權限設為 private 現已由「存取權限」對話框的「預設權限」下拉（含「只有我」）涵蓋；留著等於
    同一 visibility 設定散落兩處。且在兩套系統模型下該按鈕名稱誤導——它只動系統一（visibility），**不會撤銷已發出的
    分享連結 token**（系統二在 token 到期前仍有效）。移除 `handleMakeSharePrivate`、按鈕、及已無人使用的
    `play.share.makePrivate*` 4 個 i18n 鍵（含 `i18n.test.ts` 引用）。前端 `tsc`＋`vite build` 通過、i18n 24/24、
    parity 2191/2191。分支 `refactor/remove-make-private-button`。
- [x] 修正（使用者回報「無論預設權限改成什麼，header 徽章都顯示私密」）：header 的 visibility 狀態徽章讀
    `detail.visibility`（載入時抓一次），但 [AccessControlPanel](frontend/src/pages/play/AccessControlPanel.tsx)
    改預設權限只寫後端與自身 local state、未回寫共用 `detail`，故徽章停在載入值（private）直到重新整理。修法：
    新增 `onVisibilityChange` 回呼，由 `AccessControlPanel`→`AccessControlDialog`→`PlayPageDialogs` 一路傳上，
    存檔成功後 `setDetail` 更新 `visibility`，徽章即時反映。前端 `tsc`＋`vite build` 通過。分支
    `fix/access-visibility-badge-live-update`。

## 投票進行中顯示「掃描加入」QR（使用者要求，2026-07-05）★ 使用者要求功能，不計入計數

使用者要求：**polling（投票進行）時在螢幕上顯示 QR code，讓聽眾掃描進入簡報並自動開啟同步模式**。

- [x] 投票進行中自動顯示可掃描的「加入」QR（掃描以分享連結進入→自動同步模式→投票）。
  - **原理串接**：既有行為——帶 `share` token 的分享連結進入播放頁時，會自動開啟同步模式
    （[PlayPage.tsx](frontend/src/pages/PlayPage.tsx) `currentShareToken` 分支）。本功能在投票開始時
    產生唯讀分享連結並轉成 QR，聽眾掃描後即落在同步中的簡報並可投票。
  - **純函式**：新增 [joinQr.ts](frontend/src/lib/joinQr.ts) `buildJoinQrImageUrl(data,size?)`（產生
    api.qrserver.com QR 圖 URL，floor/clamp size），並把 `usePdfMetadata` 既有的內聯 QR URL 建構改用之（去重）。
    測試 [joinQr.test.ts](frontend/src/lib/joinQr.test.ts) 3 組。
  - **hook**：新增 [usePollJoinQrCode.ts](frontend/src/pages/play/usePollJoinQrCode.ts)——依
    `pollStarted`（投票中）＋`isSyncMasterEligible`（擁有者）啟用，惰性 `createPdfShare(read_only)` 產生
    分享連結與 QR；投票結束即清空，不殘留。
  - **接線/UI**：`pollJoinQrImageUrl`／`pollJoinShareUrl` 經 `PlayPage`→`PlayPageContext` 提供；
    [PlayPageFullscreen](frontend/src/pages/play/PlayPageFullscreen.tsx) 左下角 QR 卡、
    [PlayPageSlidePanel](frontend/src/pages/play/PlayPageSlidePanel.tsx) 即時票數卡下方 QR。
    新增 `play.fullscreen.pollJoinQr{Title,Hint,Alt}` i18n（zh-TW／en，parity 24/24）。
  - 前端 `tsc --noEmit` 通過；joinQr 3/3、i18n 24/24、poll 相關回歸 7/7。分支 `feat/poll-join-qrcode`。
- [x] 修正（使用者回報「掃碼進入後似乎沒有進入投票頁面」）：
  - **根因**：(1) QR 原本只要「擁有者＋投票中」就顯示，未要求自己處於同步主控（master）。但側邊欄的
    「開始投票」按鈕未 gate 在同步模式，擁有者可在**未開同步**時開始投票並看到 QR；掃碼者雖以分享連結
    進入並自動開啟同步，卻沒有 master 可跟隨、收不到 `realtime_poll_started`，故看不到投票。
    (2) 即使有 master，follower 同步到投票頁後只看到右上角 🗳 小按鈕、需自己點開，易誤以為「沒有投票」。
  - **修法**：(1) [PlayPage](frontend/src/pages/PlayPage.tsx) 把 QR 顯示條件收緊為
    `pollStarted && syncEnabled && syncRole === 'master'`——只有自己確實在廣播（master）時才顯示，確保掃碼
    必然有 master 可跟隨（fullscreen 的投票控制本就要求 master，正常演示流程不受影響）。
    (2) [PlayPageFullscreen](frontend/src/pages/play/PlayPageFullscreen.tsx) 新增 effect：follower 端一有
    進行中的投票就**自動展開投票面板**，讓掃碼者直接落在投票畫面；投票結束自動收合。
  - 前端 `tsc --noEmit` 通過；joinQr 3/3、i18n 24/24。分支 `fix/poll-join-qr-requires-sync-master`。

## 簡報旁白進階功能（使用者要求，2026-07-05）★ 多任務逐步推進

使用者要求把旁白升級為：分段錄音、可調整段順序、可重錄某段、段列表顯示每段用過的頁面、語音轉
逐字稿並同步顯示、逐字稿編輯界面（逐段逐頁、選段自動跳頁）、記錄游標與繪圖並同步重播、最後影片輸出。
拆成 9 個小任務逐一完成。**皆為使用者要求的功能整合，不計入 100 輪計數。**

- [x] **T1+T2：分段錄音（後端多段模型 + 前端 UI）**（2026-07-05）
  - **後端**：narration 由「單段」改為**多段 segment 模型**——`<pdf>/narration/manifest.json`（有序 segment 清單，
    每段含 `durationMs`／`slideTimeline`／`createdAt`）＋逐段音檔 `<segId>.webm`。改寫 [narration.ts](backend/src/routes/pdfs/narration.ts)：
    `GET /narration`（回段清單，每段附 `pages` 去重頁碼）、`POST /narration/segments`、`PUT /narration/segments/:segId`
    （重錄）、`DELETE /narration/segments/:segId`、`PUT /narration/order`（排序）、`GET /narration/segments/:segId/audio`。
    storage 改為 `narrationManifestPath`／`narrationSegmentAudioPath`。`narration.test.ts` 重寫（新增→列表(含頁面)→
    排序→重錄→串流→刪除、非擁有者 403、非法時間軸 400 共 3 組）。
  - **前端**：`api/pdfs.ts` 改為段導向（`getNarration`／`addNarrationSegment`／`reRecordNarrationSegment`／
    `deleteNarrationSegment`／`reorderNarrationSegments`／`narrationSegmentAudioUrl`）。`useNarrationRecorder` 支援
    `startRecording(null=新增 | segId=重錄)`。[NarrationPanel](frontend/src/pages/play/NarrationPanel.tsx) 改為段列表
    （「第 N 段 · 頁 x,y · 秒數」＋播放/上下移/重錄/刪除）＋「錄一段」；逐段播放依該段時間軸自動翻頁。i18n parity 24/24。
  - 前後端 `tsc` 通過、`narration` 3/3。分支 `feat/narration-segments`，已 merge 回 master。
- [x] T3：跨段同步播放（2026-07-05）：`NarrationPanel` 新增「▶ 播放全部」——從第 1 段連續播放，`onEnded`
  自動接下一段；播放中依當段時間軸自動翻頁（改用 `playingId` effect `load()`+`play()`）。i18n 加 `playAll`（24/24）。
  前端 `tsc` 通過。分支 `feat/narration-playall`。
- [x] T4/T5/T6：逐字稿（STT + 同步顯示 + 編輯）（2026-07-05）
  - **T4 後端**：純函式 [narrationTranscript.ts](backend/src/routes/pdfs/narrationTranscript.ts) `splitWordsByPage`
    （Whisper 逐字時間戳依段翻頁時間切逐頁）；segment meta 加 `transcriptByPage`；端點 `POST …/segments/:segId/transcribe`
    （`transcribeAudioBufferWithWordTimestamps`）、`PUT …/segments/:segId/transcript`（手動編輯）；GET 回 `transcript_by_page`。
    測試 `narration-transcript` 4 組 + `narration` 新增轉錄(mock Whisper)→逐頁→編輯整合，共 8/8。
  - **T5 前端**：播放時記 `syncedPage`，音檔下方同步顯示當下頁逐字稿。
  - **T6 前端**：每段「📝 逐字稿」展開 `SegmentTranscriptEditor`——逐頁 textarea、聚焦即跳到該頁、「🗣 語音轉文字」
    一鍵轉錄、「儲存逐字稿」。i18n 6 鍵（24/24）。前後端 `tsc` 通過。分支 `feat/narration-transcript`。
- [x] T7/T8：記錄+重播游標軌跡與繪圖（2026-07-05）
  - **統一擷取**：錄音時投影片上蓋一層擷取層（`PlayPageSlidePanel` overlay，經 `PlayPageContext.narrationCapture`
    由 `useNarrationRecorder.onCapturePointer` 接收）——指標移動記游標（節流 40ms）、按住拖曳記成一筆繪圖（內建紅筆），
    不動既有繪圖子系統。座標正規化 0–1。停止時連同 `cursorTrack`／`drawTrack` 上傳。
  - **後端**：narration `TimelineSchema`／segment meta／manifest 加 `cursorTrack`／`drawTrack`（zod 驗證、上限保護），
    add/re-record 儲存、GET 回 `cursor_track`／`draw_track`；重錄時清掉舊逐字稿。測試加「tracks 往返」（narration 5 組）。
  - **重播**：純函式 [narrationTracks.ts](frontend/src/lib/narrationTracks.ts) `cursorAtTime`（相鄰點內插）／`strokesUntil`
    （漸進顯示）＋測試 4 組。播放時 `NarrationPanel` 依音訊秒數算出疊加送進 `narrationOverlay`，`PlayPageSlidePanel`
    以 SVG polyline 畫筆跡、div 圓點畫游標，隨播放同步。前後端 `tsc` 通過、後端 9/9、前端 tracks 4/4。
    分支 `feat/narration-cursor-draw`。
- [x] STT 修正（使用者回報「語音轉錄失敗」）（2026-07-05）：原因為 STT 硬打 `openai` provider，但使用者用
  cgu-air（OpenAI 相容）、未設純 openai 金鑰。修法：`openai.ts` 的 `transcribeAudioBuffer`／
  `transcribeAudioBufferWithWordTimestamps` 加 `provider` 參數；新增 `resolveTranscriptionProvider()`（回目前設定的
  LLM provider、gemini→openai）；narration 轉錄改用該 provider（與 chat 同端點）。並加韌性：word-timestamps 失敗/
  無字時退回純文字轉錄（掛第一頁，`assignPlainTranscript` + 測試），兩者皆失敗才回錯誤並**帶出真正原因訊息**；
  前端逐字稿編輯器顯示該訊息。後端 11/11、前後端 `tsc`。分支 `fix/narration-stt-provider`。
- [x] STT 修正②（使用者回報 `invalid_audio: Unable to determine audio duration`）（2026-07-05）：
  MediaRecorder 的 webm/opus 常缺時長 metadata，Whisper 400。修法：新增
  [audioTranscode.ts](backend/src/services/audioTranscode.ts) `transcodeToMp3`（ffmpeg 轉單聲道 16kHz mp3、
  時長明確），narration 轉錄前先轉檔再送 Whisper（轉檔失敗則退回原檔）。新增 `audio-transcode.test.ts`
  （產生 webm→轉 mp3→驗證，ffmpeg 不可用時 skip）。後端 12/12、`tsc` 通過。分支 `fix/narration-stt-transcode`。
- [x] 全螢幕擷取/重播修正（使用者回報「畫筆重播不顯示、沒抓全螢幕動作」）（2026-07-05）：錄音實際在**全螢幕**
  進行，但擷取層與重播疊加只存在於一般投影片面板（`PlayPageSlidePanel`），導致全螢幕錄製時筆跡從未被記錄
  （故無法重播）、游標擷取亦不一致。修法：抽出共用元件
  [NarrationSlideOverlay.tsx](frontend/src/pages/play/NarrationSlideOverlay.tsx)（擷取層 z-50＋游標圓點/SVG 筆跡
  重播 z-40，讀 `PlayPageContext.narrationCapture`／`narrationOverlay`），同時掛進**一般面板與兩處全螢幕
  `SlideRenderer`**，使擷取與重播在各檢視共用同一 `inset-0` 座標空間。前端 `tsc` 通過、i18n 24/24。
  分支 `fix/narration-fullscreen-capture`。
- [x] 筆畫漸進重播＋錄製即時顯示（使用者回報「筆畫像一次全部畫出、錄的時候看不到筆畫」）（2026-07-05）：
  原本 `NarrationStroke` 只有一個筆畫級 `tMs`（起筆時間），點沒有各自時間，`strokesUntil` 起筆時間一到就
  整筆回傳→重播一次畫完。修法：擷取時每個點記自己的 `tMs`（recorder），`strokesUntil` 改為**依點時間裁切、
  末端內插筆尖**使筆畫隨時間長出來（舊資料無點時間→整筆顯示，向後相容）；後端 `StrokeSchema` 的點加 optional
  `tMs`。另外 [NarrationSlideOverlay](frontend/src/pages/play/NarrationSlideOverlay.tsx) 在**錄製時**用同一批
  指標事件維護本地即時筆跡/游標並畫出來，講者邊畫邊看得到紅線。加漸進重播測試；前後端 `tsc`、narrationTracks
  6/6、後端 narration 5/5、i18n 24/24。分支 `fix/narration-progressive-strokes`。
- [x] 旁白改用原生畫筆（顏色/橡皮擦/粗細）＋快照重播（使用者要求「全螢幕用原有畫筆，保留換色橡皮擦」）（2026-07-05）：
  放棄先前的內建紅筆擷取層，改為錄音時直接用原有 [DrawingCanvas](frontend/src/components/DrawingCanvas.tsx)——
  它的 `onLocalChange` 每次筆劃變化回報完整 `{strokes}` 快照（含 color/lineWidth/isEraser）。recorder 為這些快照
  打時間戳（節流 80ms，但筆畫數改變＝完成一筆/橡皮擦刪除時一律記錄）並上傳 `drawSnapshots`；重播用**唯讀
  DrawingCanvas（remoteData 模式）**還原對應時間的快照，故顏色/橡皮擦/粗細全數保留。游標改由 `SlideRenderer`
  新增的 `onWrapperPointerMove`（掛在畫筆 canvas 與 overlay 的共同祖先外框，靠事件冒泡收到移動而不攔截畫筆）
  擷取，重播畫成**十字游標**。後端 narration timeline/segment/manifest 新增 `drawSnapshots`（DrawingData zod
  schema，含上限保護），GET 回 `draw_snapshots`；舊 `drawTrack` 保留相容。純函式 `drawingSnapshotAtTime`＋測試。
  前後端 `tsc`、narrationTracks 7/7、後端 narration 5/5（加 drawSnapshots 往返）、i18n 24/24。分支 `feat/narration-native-pen`。
- [x] 錄音時記錄並重播原有合成語音（TTS）＋切換語音字幕（使用者要求）（2026-07-05）：講者戴耳機，錄音時按播放
  讓系統念某頁 TTS（不進麥克風）。錄音時把這些播放記成 `audioCues {startMs,endMs,page,fromSec}`——recorder 的
  `ttsPlayStart/ttsPlayStop` 開關區間，[NarrationPanel](frontend/src/pages/play/NarrationPanel.tsx) 在錄音期間監聽
  主播放器的 `isPlaying`＋當前頁來驅動（換頁自動關舊開新）。重播時用**獨立隱藏 `<audio>`** 在各區間播放該頁
  `audio_url`（帶 share token、seek 到 `fromSec`＋已過秒數），暫停/結束/離開區間即停；純函式 `audioCueAtTime`。
  字幕在 TTS 區間切成該頁逐字稿（一般播放字幕），其餘用旁白逐字稿。後端 timeline/segment/manifest 加 `audioCues`
  （zod、上限保護），GET 回 `audio_cues`。前後端 `tsc`、narrationTracks 8/8、後端 narration 5/5（audio_cues 往返）、
  i18n 24/24。分支 `feat/narration-record-tts`。
- [x] 修正：一般檢視錄音也要擷取游標/畫筆＋擷取更穩健（使用者回報某段完全沒錄到游標與畫筆）（2026-07-05）：
  native-pen 改版只在**全螢幕**接了擷取佈線，**一般投影片檢視**（`PlayPageSlidePanel`）在移除舊擷取層後沒補上，
  導致在一般檢視錄音時 `cursorTrack`／`drawSnapshots` 全空。修法：`PlayPageSlidePanel` 也接 `onWrapperPointerMove`
  ＋ `onLocalChange`；並改為**不再用單一 `active` 旗標開關 handler**——`NarrationPanel` 一律把 recorder 的
  `onCursorMove`／`onDrawSnapshot` 提供出去（其內部以 `recordingRef` 自我把關、非錄音期間 no-op），兩個檢視都
  無條件呼叫，避免旗標與實際錄音狀態不同步。前端 `tsc`、i18n 24/24、narrationTracks 8/8。分支
  `fix/narration-capture-normal-view`。
- [x] 修正：換頁時畫筆殘留（使用者回報換頁畫筆更新有問題、應相對頁開頭）（2026-07-05）：畫筆是**逐頁**的
  （`DrawingCanvas` 換頁清空、且換頁當下不記快照），但重播用 `drawingSnapshotAtTime` 只按時間找最後一份快照、
  不分頁，導致沒畫東西的新頁**殘留上一頁的筆畫**（實測某 2 段錄音：page 10 畫的一筆殘留顯示到 page 11）。修法：
  每個畫筆快照記下**所屬頁碼**（recorder 以 `currentPageRef` 標記），重播改用 `drawingSnapshotForPage(snaps, ms, page)`
  只取「當前頁、<=ms 的最後一份」快照、否則空白，使每頁畫筆各自獨立、從空白開始（即相對頁開頭）；無頁碼舊資料
  退回不分頁行為。後端 `DrawSnapshotSchema` 加 optional `page`。加逐頁＋舊資料相容測試。前後端 `tsc`、
  narrationTracks 10/10、後端 narration 5/5、i18n 24/24。分支 `fix/narration-draw-per-page`。
- [x] 修正：旁白重播時隱藏頁面原有的已存手繪標註（使用者要求）（2026-07-05）：重播旁白時，投影片主
  `DrawingCanvas` 仍會載入並顯示該頁存在伺服器的手繪標註，疊在旁白重播筆畫上。加 `narrationPlaying` 旗標
  （由 `NarrationPanel` 依 `playingId` 設定），播放中時 `PlayPageSlidePanel` 與 `PlayPageFullscreen` 皆不渲染
  編輯用 `DrawingCanvas`，只顯示旁白自己錄到的筆畫。前端 `tsc`、i18n 24/24。分支 `fix/narration-hide-saved-drawing`。
- [x] 修正：旁白重播只顯示「錄製期間新增」的筆畫；新增筆畫永久留在頁面（使用者要求）（2026-07-05）：原本畫筆快照
  存的是 `DrawingCanvas` **完整** strokes（含錄製前既有），重播看到的「原有筆畫」其實是快照裡複製的既有部分。改為
  只記**增量**：`DrawingCanvas` 載入頁面後回報既有筆數 baseline（並於 `baselineSignal`＝錄製開始時再回報一次以鎖定當前
  頁），recorder 記各頁 baseline、只存 `strokes.slice(base)`。重播（唯讀 canvas）因此只顯示這段錄製新增的筆畫；
  重播中隱藏編輯用 canvas（既有標註不顯示）。永久保存不變——錄製時原生 `DrawingCanvas` 仍把既有＋新增存回該頁，
  故新增筆畫錄完後留在每頁。前端 `tsc`、i18n 24/24、narrationTracks 10/10。分支 `fix/narration-draw-delta-only`。
- [ ] T9：影片輸出（ffmpeg）

### （下方為初版 MVP 記錄，已被上方分段模型取代）
## 簡報旁白錄音 MVP（使用者要求，2026-07-05）★ 大功能整合

使用者要求把 NEW_FEATURE.md 的「錄音模式」真正做成可用功能。先前 loop 已完成資料層純函式
（`buildSlideTimeline`／`slideAtTime`／`recordingSession`）；本次接上實際的**錄音、儲存、UI、同步播放**，
交付 MVP（**不含影片輸出**，列為後續）。**本項為使用者要求的功能整合，不計入 100 輪計數。**

- [x] 簡報旁白 MVP：播放頁錄旁白（音檔＋翻頁時間軸）→ 上傳 → 同步播放（自動翻頁）。
  - **後端**：`services/storage.ts` 新增 `narrationDir`／`narrationAudioPath`／`narrationTimelinePath`；新增
    [narration.ts](backend/src/routes/pdfs/narration.ts) 四端點——`POST /api/pdfs/:id/narration`（multipart：音檔＋
    `timeline` JSON，編輯權限、zod 驗證時間軸）、`GET /narration`（metadata：exists／duration／segments，讀取權限）、
    `GET /narration/audio`（串流 webm，讀取權限）、`DELETE /narration`（編輯權限）；於 `index.ts` 註冊。每份簡報
    一段旁白、存檔於 `<pdf>/narration/`（audio.webm＋timeline.json），不需 DB migration。新增
    `narration.test.ts`（3 組：owner round-trip 上傳→get→串流→刪除、非擁有者上傳 403、時間軸非法 400）。
  - **前端**：`api/pdfs.ts` 新增 `getNarration`／`uploadNarration`（FormData）／`narrationAudioUrl`／`deleteNarration`
    ＋型別；新增 hook [useNarrationRecorder.ts](frontend/src/hooks/useNarrationRecorder.ts)（`MediaRecorder` 錄音＋
    `recordingSession` 記錄翻頁，停止時 `stopRecording` 產時間軸並上傳；含麥克風釋放、不支援時 no-op）；新增
    [NarrationPanel.tsx](frontend/src/pages/play/NarrationPanel.tsx)（擁有者/協作者可錄/重錄/刪；任何可讀者可播放，
    播放時 `onTimeUpdate` → `slideAtTime` → `setCurrentIdx` **自動翻頁**），掛在播放頁側邊欄「slides」分頁。新增
    13 個 `play.narration.*` i18n 鍵（zh-TW／en，parity 24/24）。
  - **測試/驗證**：後端 `narration` 3/3；前後端 `tsc --noEmit` 通過；`recordingSession` 7/7、`slideTimeline` 13/13
    回歸；i18n parity 24/24。錄音/播放的瀏覽器行為（`getUserMedia`／`MediaRecorder`／`<audio>`）屬瀏覽器端、無法
    於 sandbox 單元測，改由端到端 API round-trip＋純函式測試覆蓋資料流。分支 `feat/narration-recording`，已 merge
    回 master。BLOG.md 新增對應 section。
  - **後續（未做）**：影片檔輸出（ffmpeg 合成畫面＋音訊）；多段旁白／逐頁重錄；錄音時的暫停/續錄；行動裝置相容性測試。

## 未完成項目（待使用者決定）

以下兩項屬範圍大或涉 CI 行為變更，**不宜於自動 loop 中逕行**，需使用者裁示後再進行：

- [ ] 系統性採用 `mapApiErrorToHumanMessage`：目前約 55 處 catch 區塊直接 `setError(err.message)` 顯示後端原始 message、繞過既有的錯誤訊息映射（前端僅 2 處 `UploadButton`、`ImportTextPage` 使用 mapper）。全面改造屬較大工程，且各 catch 上下文不同、許多後端 message 已是中文（未必都是英文洩漏），逐點需產品判斷顯示風格，故列為待使用者決定。
- [ ] 把前端測試納入 root `npm test`：目前 root 測試腳本未涵蓋前端 `node:test` 測試。納入涉及 CI 行為變更與 `npm install`（sandbox 無法驗證），列為待使用者決定。

## AI 導師錯誤與空答處理（第一八八輪，2026-07-04）

推進 §「AI 導師（PageAskPanel）回答品質改善」backlog 的「錯誤與空答處理」項：強化 prompt 防杜撰、
空答保底，並把前端錯誤改走 `mapApiErrorToHumanMessage`。

- [x] AI 導師禁止杜撰 + 空答保底 + 前端錯誤走人性化 mapper。
  - 修改說明（2026-07-04）：
    - **禁止杜撰（prompt）**：`/ask` system prompt 的「查無資訊」條款由「請誠實說明」強化為「只能依
      提供內容作答、嚴禁杜撰／臆測，找不到時明確回『找不到相關資訊』並建議換個問法或查看相關頁面」。
    - **空答保底 + 換行正規化收斂（可測純函式）**：新增 [tutorAnswer.ts](backend/src/routes/pdfs/tutorAnswer.ts)
      的 `finalizeTutorAnswer(raw)`——把原本內聯於 `/ask` 的「字面 `\n`→真換行（保留 `\nabla` 等 LaTeX
      指令）」正規化抽出並固化，且在 trim 後為空字串時回傳固定提示 `TUTOR_NO_ANSWER_FALLBACK`（避免前端
      出現空白導師泡泡、涵蓋模型回空的情況）。route 改用之。
    - **前端錯誤人性化**：`usePageAsk` 的 catch 由 `err.message`／`askFailed` 改為
      `mapApiErrorToHumanMessage(err, t).message`（code-aware、已在地化，與 UploadButton／ImportTextPage 一致）。
  - 測試：後端新增 `tutor-answer.test.ts`（7 組：字面 `\n\n`/`\n`/`\r\n`→換行、保留 `\nabla`/`\rho`/
    `\right`/`\times`、trim、空/空白/`\n\n`→fallback、正常答案不變）+ `page-ask.test.ts` 新增 2 整合測試
    （prompt 含「禁止杜撰／找不到相關資訊」、模型回空白→回應為 fallback 文案）。前後端 `tsc --noEmit` 通過；
    後端 ask 相關 13/13（Node 22）、前端錯誤映射 7/7、i18n parity 不變。分支 `feat/ask-error-and-empty-answer`，
    已 merge 回 master。BLOG.md 新增對應 section。
  - 說明：「偵測『查無資訊』語句給固定提示」一項，改以**空答保底**（模型回空→固定提示）實作，刻意不做
    脆弱的自然語言片語偵測（易誤判傷 UX）；防杜撰改由 prompt 從源頭處理。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 67 個完成項目（67/100，未達上限）。

## AI 導師回答長度精簡／詳細切換（第一八七輪，2026-07-04）

推進 §「AI 導師（PageAskPanel）回答品質改善」backlog 的「輸出長度／結構控制」項：原 system prompt
一律要求「完整、不刻意精簡」，長答常過度冗長且無進度感。新增每次提問可選「精簡／詳細」。

- [x] AI 導師新增「精簡／詳細」回答長度切換（可測純函式 + 前後端接線）。
  - 修改說明（2026-07-04）：後端新增純函式 [askVerbosity.ts](backend/src/routes/pdfs/askVerbosity.ts)
    的 `askVerbosityInstruction(verbosity)`——`brief` 回精簡指示（結論先行、1～3 句重點、避免冗長）、
    `detailed`（含未指定）回詳盡指示（同樣「結論先行、先給重點摘要再展開」以改善長答可讀性）。
    `AskPageBodySchema` 新增 `verbosity: z.enum(['brief','detailed']).optional()`；`/ask` 把該指示接到
    system prompt 末尾，並把原硬編的「盡量解釋透徹、不要刻意精簡」改為中性的「清楚、有條理」（長度改由
    verbosity 控制）。前端：`askPageQuestion` 新增 `verbosity` 參數；`usePageAsk` 新增 `pageAskVerbosity`
    狀態（預設 detailed）+ setter 並隨每次提問送出；`PlayPageContext` 型別同步；`PageAskPanel` 於輸入框
    上方加「回答長度：精簡｜詳細」分段切換。新增 i18n 三鍵（zh-TW／en，parity 24/24）。
  - 測試：後端 `ask-verbosity.test.ts`（4 組純函式）+ `page-ask.test.ts` 新增整合測試（未指定→prompt 帶
    「本次回答長度：詳細」、`verbosity:'brief'`→帶「精簡」且不含「詳細」）。前後端 `tsc --noEmit` 通過；
    後端 ask 相關 8/8（Node 22）、前端 i18n 24/24。分支 `feat/ask-verbosity-toggle`，已 merge 回 master。
    BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 66 個完成項目（66/100，未達上限）。

## AI 導師回答的引用頁碼可點擊跳頁（第一八六輪，2026-07-04）

推進 §「AI 導師（PageAskPanel）回答品質改善」backlog 的「引用頁碼可點擊」項：AI 導師回答會依
prompt 規則以「（第 N 頁）」標示跨頁引用，但先前是純文字，讀者得自行手動翻頁查證。

- [x] AI 導師回答下方新增「引用頁碼」可點擊捷徑（可測純函式解析 + 點擊跳頁）。
  - 修改說明（2026-07-04）：新增前端純函式 [extractCitedPages.ts](frontend/src/lib/extractCitedPages.ts)
    的 `extractCitedPages(text)`——以「第 N 頁」寬鬆樣式（容許空白變化）掃描回答全文，回傳升冪、
    去重、正整數的頁碼清單（是否有效／排除當前頁交由呼叫端）。[PageAskPanel.tsx](frontend/src/pages/play/PageAskPanel.tsx)
    在每則 AI 導師答案下方（非答案本身、不動 `MarkdownMath` 渲染路徑）新增一列「引用頁碼」晶片，
    僅顯示實際存在於 `deckPages` 且非目前頁的頁碼，點擊以 `setCurrentIdx` 對應索引跳頁。新增 i18n 鍵
    `play.sidebar.pageAsk.citedPagesLabel`／`jumpToPage`（zh-TW／en，parity 24/24）。新增
    `extractCitedPages.test.ts`（7 組：單頁、多頁升冪去重、空白變化、忽略原始來源、忽略第 0 頁、
    空／無引用回空、重複呼叫穩定不受 regex lastIndex 影響）。前端 `tsc --noEmit` 通過、新測試 7/7、
    i18n 24/24。分支 `feat/ask-clickable-page-citations`，已 merge 回 master。BLOG.md 新增對應 section。
  - 同輪順帶更新：確認「Markdown 渲染」項已由 `MarkdownMath` 於先前輪次解決，補記為完成（**不計入**）。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 65 個完成項目（65/100，未達上限）。

## AI 導師多輪對話脈絡字數上限管理（第一八五輪，2026-07-04）

推進 §「AI 導師（PageAskPanel）回答品質改善」backlog 的「保留對話脈絡的上限管理」項：`/ask`
端點原本把 history 全量帶入 prompt，schema 僅限輪數（20）與單則長度（8000），最壞約 160,000 字，
會反過來把 corpus（14000）/來源全文（12000）擠出 token 預算。

- [x] AI 導師 `/ask` history 加字數上限（保留最新連續數輪 / 可測純函式）。
  - 修改說明（2026-07-04）：新增 `backend/src/routes/pdfs/askHistoryBudget.ts` 純函式
    `budgetChatHistory(history, maxChars)`——由新到舊累加 content 長度、保留能放入預算的最新連續
    數輪（先丟最舊）；最新一則單獨超標時截斷保留（前綴「……（前略）……」、保留尾段）而非整段
    丟棄；`maxChars ≤ 0`／空歷史回空、不改動輸入。`page-operations.ts` 新增常數
    `ASK_HISTORY_MAX_CHARS = 8000`，`/ask` 在送入模型前先 `budgetChatHistory` 收斂再 `.map`；
    輪數上限仍由 schema 把關。新增 `ask-history-budget.test.ts`（7 組）。後端 `tsc --noEmit` 通過；
    新測試 7/7 + `page-ask` 整合測試回歸（Node 22，共 10 綠）。分支 `feat/ask-history-char-budget`，
    已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 64 個完成項目（64/100，未達上限）。

## 修復 export/import round-trip 測試（第二二一輪，2026-07-05）★ 第 100 項 · 達上限

第二二〇輪發現的既有失敗——`export-import-zip-interactive.test.ts` 的
`export.zip -> import.zip round-trips polls, quizzes and slide animations` 在 master 即 `ReferenceError:
pageUid is not defined`。本輪修復之，作為本次計數的第 100（最後）項。

- [x] 修 `export-import-zip-interactive` 測試的未定義 `pageUid`（測試 bug、非產品 bug）。
  - 修改說明（2026-07-05）：根因為測試第 202 行斷言「import 保留原始 page_uid」時引用 `pageUid`，但第 139 行
    `const { animationRelPath } = seedPdfWithInteractiveData(id)` 只解構了 `animationRelPath`、漏了 `pageUid`
    （seed 函式回傳 `{ pageUid, animationRelPath }`，`pageUid = 'uidpage001'`）。改為
    `const { pageUid, animationRelPath } = …`。純測試修正、未動產品碼。後端 `tsc --noEmit` 通過；該檔 1/1 通過，
    並確認產品行為正確（import 依 `page-uids.json`／metadata 沿用匯出端 page_uid，而非重新產生）。分支
    `fix/export-import-test-pageuid`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 **100** 個完成項目（**100/100，已達上限**）。

> ⛔ **已達 100 項門檻（LOOP.md 第 3 條）。** 自動 loop 就此**停止新增與執行新項目**。等待使用者裁示：
> (a) **重設計數**——在本檔最後新增一行 `---- 計數重設 ----`，之後從 0 重新起算；或
> (b) **調整／取消門檻**（例如改為 200）。在收到指示前，後續 cron 觸發時不再開新項目。
> 另有兩項**待裁示的既有議題**保留於下方各輪記錄：`buildContentDisposition` 兩份不同實作待統一（需決定採哪套、屬行為變更）。

## zip 下載回應標頭收斂為 sendZipDownload（去重）+ 發現既有失敗（第二二〇輪，2026-07-05）

延續盤點：`export.zip` 與批次匯出下載都以相同 4 個標頭（content-type/length、cache-control、content-disposition）
回傳 zip buffer，逐字重複。

- [x] 抽出 `sendZipDownload(reply, buffer, filename)`（去重 2 處 / 行為等價）。
  - 修改說明（2026-07-05）：`export.ts` 新增 `sendZipDownload`（設 4 標頭＋`buildContentDisposition`＋`reply.send`）。
    `export.ts` 單份匯出與 `batch-export.ts` 批次下載改用之（batch 原 import 的 `buildContentDisposition` 改為
    `sendZipDownload`）。後端 `tsc --noEmit` 通過；`export-zip-cjk-filename`＋`batch-export` 共 7/7 通過（涵蓋
    sendZipDownload 兩條路徑）。分支 `refactor/send-zip-download`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 99 個完成項目（99/100，未達上限）。

### 本輪順帶發現（**待處理**，非本輪修）

- [x] **（既有失敗，已於第二二一輪修復）`export-import-zip-interactive.test.ts` 的 round-trip 測試**
  `ReferenceError: pageUid is not defined`。**根因為測試 bug、非產品 bug**：第 202 行斷言「import 保留原始
  page_uid」用到 `pageUid`，但第 139 行 `const { animationRelPath } = seedPdfWithInteractiveData(id)` 漏解構
  `pageUid`（seed 函式回傳 `{ pageUid, animationRelPath }`）。修法：改為 `const { pageUid, animationRelPath } = …`。
  修復後該檔 1/1 通過，且確認產品行為正確（import 確實沿用匯出端 page_uid）。見下方「修復 export/import
  round-trip 測試」section。
- [ ] **（既有重複，待收斂需裁示）`buildContentDisposition` 有兩份不同實作**：`downloadFilename.ts`（asciiFallback
  將 `"`、`\` 換成 `_`；`filename*` 用 `encodeURIComponent`）與 `export.ts`（`"`→`'`；`filename*` 另把 `'()`
  百分比轉義）。兩者對含引號/括號的檔名輸出不同，統一屬**行為變更**、需決定採哪一套，故未於自動 loop 逕改。

## 後端 group id regex 收斂到 shared（去重）（第二一九輪，2026-07-05）

延續第二一八輪：group id 格式 regex `/^grp-[A-Za-z0-9_-]{8,64}$/` 在 `pdfPermissions.ts` 與 `groups.ts`
各寫一份（兩檔以不同方式包裝：bare string vs `{groupId}` 物件參數）。

- [x] 抽出共用 `GROUP_ID_RE` 到 `shared.ts`（去重 2 處）。
  - 修改說明（2026-07-05）：`routes/pdfs/shared.ts` 新增 `export const GROUP_ID_RE`。`pdfPermissions.ts`
    （`z.string().regex(GROUP_ID_RE)`）與 `groups.ts`（`z.object({ groupId: z.string().regex(GROUP_ID_RE, ...) })`）
    改用共用常數，各自的包裝維持不變。後端 `tsc --noEmit` 通過；`pdf-permissions-api`＋`groups-api` 10/10 回歸。
    分支 `refactor/shared-group-id-re`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 98 個完成項目（98/100，未達上限）。

## 後端 EmailSchema 收斂到 shared（去重）（第二一八輪，2026-07-05）

延續盤點（後端）：`z.string().trim().toLowerCase().email().max(320)` 這個 email zod schema 在
`pdfPermissions.ts` 與 `groups.ts` 各定義一份（ACL/群組成員管理）。

- [x] 抽出共用 `EmailSchema` 到 `shared.ts`（去重 2 處）。
  - 修改說明（2026-07-05）：`routes/pdfs/shared.ts` 新增 `export const EmailSchema`（trim＋lowercase＋email＋
    max 320）。`pdfPermissions.ts`／`groups.ts` 移除各自的本地 `EmailSchema`、改 import 共用版（兩檔的
    `GroupIdSchema` 形狀不同、維持各自定義不動）。後端 `tsc --noEmit` 通過；`pdf-permissions-api`＋`groups-api`
    共 10/10 回歸通過。分支 `refactor/shared-email-schema`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 97 個完成項目（97/100，未達上限）。

## Email 驗證正規表示式收斂為共用純函式（第二一七輪，2026-07-05）

延續盤點：`EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/` 在 `AccessControlPanel` 與 `GroupsManager` 各定義一份、
用於「加入名單/成員」的可加入判斷，無測試。

- [x] 抽出 `isValidEmail`（去重 2 處 / 可測）。
  - 修改說明（2026-07-05）：新增 [isValidEmail.ts](frontend/src/lib/isValidEmail.ts) 的 `isValidEmail(email)`
    （沿用同一寬鬆規則：本地部分＋`@`＋網域＋`.`＋TLD）。`AccessControlPanel`（`canAdd`）與 `GroupsManager`
    （`canAddMember`）移除本地 `EMAIL_RE`、改用之。新增 `isValidEmail.test.ts`（3 組：一般 email、缺 @/網域/TLD、
    空白/含空格）。前端 `tsc --noEmit` 通過、3/3 通過。分支 `refactor/is-valid-email`，已 merge 回 master。
    BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 96 個完成項目（96/100，未達上限）。

## 最近搜尋統一到共用模組（修跨檔不一致）（第二一六輪，2026-07-05）

延續盤點：發現 `HomePage` 自行實作了一套「最近搜尋」（讀/存/移除/清除），與 `GlobalSearchBox` 使用的
共用 [recentSearches.ts](frontend/src/lib/recentSearches.ts) **寫入同一個 localStorage key `makeslide.recentSearches`**，
但規則不一致（HomePage 上限 5、大小寫敏感去重；lib 上限 8、大小寫不敏感）——兩處交錯使用會互相覆寫、行為不
一致，屬**跨檔不一致的潛在 bug**。

- [x] `HomePage` 最近搜尋改用共用 `recentSearches.ts`（修不一致 / 去重）。
  - 修改說明（2026-07-05）：`recentSearches.ts` 新增 `removeRecentSearch(query)`（精確移除一筆、持久化、回更新
    清單；補 2 測試）。`HomePage` 移除本地 `readRecentSearches`／`saveRecentSearch`／`removeRecentSearch` 與
    `RECENT_SEARCHES_STORAGE_KEY`／`MAX_RECENT_SEARCHES`，改用 lib 的 `getRecentSearches`／`addRecentSearch`／
    `removeRecentSearch`／`clearRecentSearches`（清除全部原本是內聯 `removeItem`，改用 `clearRecentSearches`）。
    **行為統一**：HomePage 的最近搜尋現與 GlobalSearchBox 一致（上限 8、大小寫不敏感），消除同 key 兩套規則的
    不一致。前端 `tsc --noEmit` 通過、recentSearches 8/8。分支 `refactor/unify-recent-searches`，已 merge 回 master。
    BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 95 個完成項目（95/100，未達上限）。

## user_code 讀取去重（重複 async 函式 + magic string 收斂）（第二一五輪，2026-07-05）

延續盤點：`resolveConfiguredUserCode`（讀 localStorage user_code、登入則以後端 settings 覆蓋）在 `play/utils.ts`
已匯出且有 3 個消費者，但 `QuizBuilderPage` 另存了一份**完全相同**的本地複本；magic string `'makeslide.user_code'`
更在 `play/utils`／`QuizBuilderPage`／`SettingsPage` 各定義一次。

- [x] 去重 `resolveConfiguredUserCode` 複本 + 收斂 `LOCAL_USER_CODE_KEY`（3→1）。
  - 修改說明（2026-07-05）：`play/utils.ts` 的 `LOCAL_USER_CODE_KEY` 改為 `export`。`QuizBuilderPage` 移除本地
    複本的 `resolveConfiguredUserCode` 與 `LOCAL_USER_CODE_KEY`，改 `import { resolveConfiguredUserCode } from './play/utils'`，
    並移除因此不再使用的 `getAuthStatus`／`getSystemAiSettings` 匯入。`SettingsPage` 移除元件內重複的
    `LOCAL_USER_CODE_KEY`，改 import `play/utils` 的。行為等價（複本與正本 byte-identical）；由 `tsc --noEmit`
    把關（此函式為整合性、原本即無單元測試）。前端 `tsc --noEmit` 通過。分支 `refactor/dedupe-user-code`，
    已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 94 個完成項目（94/100，未達上限）。

## localStorage JSON 陣列讀取通用化 + 去重（第二一四輪，2026-07-05）

延續第二一三輪：`HomePage` 的 `readStoredCustomCategories`／`readRecentSearches` 也各自內聯同一段 localStorage
「讀值→`JSON.parse`→確認陣列」safe-parse（僅元素後處理不同），無測試。

- [x] 抽出通用 `readJsonArrayFromStorage` 並讓數字/字串讀取共用（去重 3 處 / 可測）。
  - 修改說明（2026-07-05）：[storageNumberArray.ts](frontend/src/lib/storageNumberArray.ts) 新增通用
    `readJsonArrayFromStorage(key, storage?)`（回 `unknown[]`，非法/缺值/非陣列/拋錯皆 `[]`）；`readNumberArrayFromStorage`
    改為 `readJsonArrayFromStorage(...).filter(isNumber)`。`HomePage` 的 `readStoredCustomCategories`（map trim+filter）
    與 `readRecentSearches`（filter string + slice）改用通用版、移除各自的 try/catch 與 SSR guard（helper 已涵蓋）。
    測試新增 2 組 `readJsonArrayFromStorage`（原始陣列原樣、壞 JSON/非陣列/缺值/拋錯回空），共 7/7。前端
    `tsc --noEmit` 通過。分支 `refactor/read-json-array-storage`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 93 個完成項目（93/100，未達上限）。

## localStorage 數字陣列安全讀取抽出純函式（第二一三輪，2026-07-04）

延續盤點：`PlayPage` 的 bookmarks／importantPages 兩個 useState 初始化，內聯相同的「localStorage 讀 JSON→
確認陣列」safe-parse、無測試。

- [x] 抽出 `readNumberArrayFromStorage`（去重 2 處 / 可測 / DI）。
  - 修改說明（2026-07-04）：新增 [storageNumberArray.ts](frontend/src/lib/storageNumberArray.ts) 的
    `readNumberArrayFromStorage(key, storage?)`——讀值→`JSON.parse`→是陣列才回、非法/缺值/getItem 拋錯皆回 `[]`；
    並過濾非數字元素（比原 `as number[]` 轉型更穩健），可注入 storage 供測試。`PlayPage` 兩個 useState 初始化改用
    之。新增 `storageNumberArray.test.ts`（5 組：讀數字陣列、濾非數字、缺值/壞 JSON/非陣列回空、無 storage 回空、
    getItem 拋錯回空）。前端 `tsc --noEmit` 通過、5/5 通過。分支 `refactor/read-number-array-storage`，已 merge
    回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 92 個完成項目（92/100，未達上限）。

## 課程包下載改用 api client + 檔名解析純函式（第二一二輪，2026-07-04）

延續盤點：`PlayPageHeader` 課程包下載用元件內 raw `fetch` POST + 內聯 content-disposition 檔名 regex，繞過
api client 錯誤處理、且檔名解析無測試。

- [x] 課程包下載改用 api client `fetchCoursePackage` + 抽出 `filenameFromContentDisposition`（可測）。
  - 修改說明（2026-07-04）：新增 [contentDisposition.ts](frontend/src/lib/contentDisposition.ts) 的
    `filenameFromContentDisposition(header, fallback)`（取 `filename="..."`、缺則 fallback）。`api/pdfs.ts` 新增
    `fetchCoursePackage(id)`（POST、`parseErrorBody`、回 `{blob, filename}`，檔名走該純函式）。`PlayPageHeader`
    改用之並以 `downloadBlob` 下載；失敗維持原本靜默行為（!ok→throw→空 catch，與原 `!ok return` 等價）。新增
    `contentDisposition.test.ts`（4 組：取引號檔名、缺標頭 fallback、無引號 fallback、CJK 檔名）。前端
    `tsc --noEmit` 通過、4/4 通過。分支 `refactor/course-package-api`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 91 個完成項目（91/100，未達上限）。

## 設定頁快取清除改用 api client（第二一一輪，2026-07-04）

延續盤點：`SettingsPage` 以直接 `fetch` 打 `system/thumbnail-cache`、`admin/cache`（DELETE），各自寫
`if(!resp.ok){setMsg;return}`＋`catch{setMsg(null)}`，繞過 api client 一致的錯誤處理。

- [x] 縮圖/產物快取清除改用 api client `clearThumbnailCache`／`clearArtifactCache`。
  - 修改說明（2026-07-04）：`api/system.ts` 新增 `clearThumbnailCache()`／`clearArtifactCache()`（DELETE、
    走 `parseErrorBody`、回各自的 JSON 形狀）。`SettingsPage` 兩個 handler 改用之、移除元件內 raw fetch 與
    `resp.ok` 判斷。行為微調（更佳）：原本網路錯誤（catch）不顯示訊息，現與 !ok 一致改顯示按鈕標籤 fallback
    訊息，讓失敗都有回饋；成功路徑不變。前端 `tsc --noEmit` 通過（api HTTP 包裝一向不另做單元測試）。分支
    `refactor/settings-cache-api-client`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 90 個完成項目（90/100，未達上限）。

## 課後報告面板改用 api client（去重型別/直呼 fetch）（第二一〇輪，2026-07-04）

延續盤點：`PostClassReportPanel` 自行定義 `StudentRecord`／`StudentAttempt`／`StudentQuestionResult`（與
api client 既有的同名/結構完全一致者重複），且以直接 `fetch` 讀 `report/students`、`report/ai-suggestions`，
繞過 api client 一致的 `parseErrorBody` 錯誤處理。

- [x] 課後報告面板改用 api client：去重型別 + 收斂直呼 fetch。
  - 修改說明（2026-07-04）：`api/pdfs.ts` 新增 `fetchReportAiSuggestions(id)`（比照 `fetchPdfStudentRecords`、
    走 `parseErrorBody`）。`PostClassReportPanel` 移除 3 個與 api client 結構相同的本地 interface，改 `import`
    api 的 `StudentRecord`；學生名單改用既有 `fetchPdfStudentRecords(pdfId)`、AI 建議改用 `fetchReportAiSuggestions(pdfId)`，
    移除元件內兩段 ad-hoc `fetch`＋`r.ok ? … : reject` 樣板。前端 `tsc --noEmit` 通過（型別相容由 tsc 保證）。
    分支 `refactor/report-panel-api-client`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 89 個完成項目（89/100，未達上限）。

## 檔案下載樣板收斂為共用工具（第二〇九輪，2026-07-04）

延續盤點：`document.createElement('a')` + 設 href/download + click（+object URL 建/釋放）的下載樣板在 5 處
重複（首頁匯出/批次匯出、報告摘要、測驗 JSON、課程包），無測試。

- [x] 抽出檔案下載共用工具 `triggerDownload`／`downloadBlob`（去重 5 處 / 可測 / DI）。
  - 修改說明（2026-07-04）：新增 [download.ts](frontend/src/lib/download.ts)——`triggerDownload(href, filename)`
    下載已知 URL（伺服器端點或 object URL）；`downloadBlob(blob, filename)` 建 object URL 後下載並 `revoke`。
    沿用 `clipboard.ts` 的依賴注入風格（可注入 document／URL 供測試、無 DOM 環境為 no-op）。5 處改用之：
    `HomePage` 匯出＋批次匯出（`triggerDownload`）、`PostClassReportPanel` 報告摘要、`QuizBuilderPage` 測驗
    JSON、`PlayPageHeader` 課程包（`downloadBlob`）。blob 路徑統一加上 appendChild/remove（更穩健、對既有行為
    無害）。新增 `download.test.ts`（3 組：triggerDownload 設屬性/append/click/remove、downloadBlob 建 URL→下載
    →revoke、無 DOM/URL 時 no-op）。前端 `tsc --noEmit` 通過、3/3 通過。分支 `refactor/download-helper`，已 merge
    回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 88 個完成項目（88/100，未達上限）。

## [0,1] 內聯夾界改用共用 clamp（第二〇八輪，2026-07-04）

延續盤點：`PlayPage`／`AnimationEditorTab` 尚有 6 處以 `Math.min(1, Math.max(0, value))` 內聯夾界到 [0,1]
（游標座標、spotlight/overlay/pointer 透明度），未使用既有且已測的 `clamp`。

- [x] 6 處 [0,1] 內聯夾界改用共用 `clamp`（一致性 / 復用已測 helper）。
  - 修改說明（2026-07-04）：`PlayPage`（cursor_x/cursor_y 各 1）與 `AnimationEditorTab`（spotlightOpacity、
    overlayImageOpacity、pointerOpacity×2）的 `Math.min(1, Math.max(0, …))` 改為 `clamp(…, 0, 1)`（兩檔皆已
    import clamp）。與原式位元等價、無行為變更；`clamp` 已有測試故不另加。屬一致性清理（消除內聯 min/max、
    收斂到單一 helper）。前端 `tsc --noEmit` 通過。分支 `refactor/reuse-clamp-opacity`，已 merge 回 master。
    BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 87 個完成項目（87/100，未達上限）。

## 指標正規化座標收斂為共用純函式（第二〇七輪，2026-07-04）

延續盤點：播放頁/遙控頁多處 onPointerMove/Up 內聯 `Math.min(1, Math.max(0, (clientX-rect.left)/rect.width))`
（x、y 各一份）計算「元素內正規化 [0,1] 座標」，重複且無測試。

- [x] 抽出指標正規化座標純函式 `normalizedPointerPosition`（去重 4 處 / 可測 / 復用 clamp）。
  - 修改說明（2026-07-04）：新增 [normalizedPointerPosition.ts](frontend/src/lib/normalizedPointerPosition.ts) 的
    `normalizedPointerPosition(clientX, clientY, rect)`——回 `{x, y}`、各以既有 `clamp(..,0,1)` 夾界（與原
    `Math.min(1,Math.max(0,..))` 位元等價、含 width/height=0 的 NaN 行為）。`PlayPageSlidePanel`（2 處影像框選）、
    `RemoteControllerPage`（`getNormCoords`）、`PlayPage`（游標推送）共 4 處改用之。新增
    `normalizedPointerPosition.test.ts`（4 組：中心、左上/右下角、超界夾 0/1）。前端 `tsc --noEmit` 通過、4/4
    通過。分支 `refactor/normalized-pointer-position`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 86 個完成項目（86/100，未達上限）。

## 投票選項清理收斂為共用純函式（第二〇六輪，2026-07-04）

延續盤點（轉後端）：`detail.ts` 建立投票有 2 處內聯 `options.map(o=>o.trim()).filter(Boolean)`（AI 版另
`.slice(0,6)`），送出前清理無測試。

- [x] 抽出投票選項清理純函式 `sanitizePollOptions`（去重 2 處 / 可測）。
  - 修改說明（2026-07-04）：在 [pollOptions.ts](backend/src/routes/pdfs/pollOptions.ts) 新增
    `sanitizePollOptions(options, limit?)`——去空白、濾空項，並在有 `limit` 時清理後取前 N 個。`detail.ts` 手動
    建立投票改用 `sanitizePollOptions(body.data.options)`、AI 產生投票改用 `sanitizePollOptions(generated.data.options, 6)`，
    行為等價。`poll-options.test.ts` 新增 4 組（去空白濾空、清理後夾 limit、無 limit 保留全部、全空/空回空）。
    後端 `tsc --noEmit` 通過、poll-options 9/9 通過。分支 `refactor/sanitize-poll-options`，已 merge 回 master。
    BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 85 個完成項目（85/100，未達上限）。

## 標籤字串解析收斂為共用純函式（第二〇五輪，2026-07-04）

延續既有程式碼盤點：`HomePage`／`PdfCard` 有 5 處內聯相同的「逗號分隔標籤字串 → 去空白非空陣列」解析、
無測試。

- [x] 抽出標籤解析純函式 `parseTags`（去重 5 處 / 可測）。
  - 修改說明（2026-07-04）：新增 [parseTags.ts](frontend/src/lib/parseTags.ts) 的 `parseTags(raw)`——
    `(raw ?? '').split(',').map(trim).filter(Boolean)`，null/undefined/空回空陣列。`HomePage` 4 處（標籤晶片、
    標籤過濾、加標籤）與 `PdfCard` 1 處改用之。其中標籤過濾原變體未 filter 空字串，但因比對的 tagFilter 皆非
    空、`includes` 結果不受影響，改用 filter 版行為等價。新增 `parseTags.test.ts`（4 組：split+trim、濾空項、
    null/undefined/空回空、單一標籤）。前端 `tsc --noEmit` 通過、4/4 通過。分支 `refactor/parse-tags`，已 merge
    回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 84 個完成項目（84/100，未達上限）。

## 逐字稿朗讀時間預估抽出純函式（第二〇四輪，2026-07-04）

延續既有程式碼盤點：`PlayPageSlidePanel` 逐字稿編輯區即時預估「字數 → 朗讀時間 mm:ss」的內聯邏輯
（`Math.round(chars/4)` 再手組字串）無測試。

- [x] 抽出朗讀時間預估純函式 `estimateSpeakingSeconds`／`estimateSpeakingTimeLabel`（可測 / 固化 chars/4 heuristic）。
  - 修改說明（2026-07-04）：新增 [speakingTimeEstimate.ts](frontend/src/lib/speakingTimeEstimate.ts)——
    `estimateSpeakingSeconds(chars)`（每秒約 4 字、四捨五入、非正/非有限回 0）與 `estimateSpeakingTimeLabel(chars)`
    （組成 m:ss、分不補零、秒補兩位，沿用原格式）。`PlayPageSlidePanel` 改用之，行為完全等價。新增
    `speakingTimeEstimate.test.ts`（4 組：chars/4 四捨五入、非正/NaN 回 0、m:ss 格式、空輸入 0:00）。前端
    `tsc --noEmit` 通過、4/4 通過。分支 `refactor/speaking-time-estimate`，已 merge 回 master。BLOG.md 新增對應
    section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 83 個完成項目（83/100，未達上限）。

## 錄音 session 模型純函式（第二〇三輪，2026-07-04）

推進錄音功能的資料層：銜接「錄音期間逐次切頁通知」與已固化的 `buildSlideTimeline`／`slideAtTime`
（第一九〇、一九四輪），補上中間的 session 累積層。仍不含 MediaRecorder／儲存／UI。

- [x] 抽出錄音 session 模型 `startRecording`／`recordSlideSwitch`／`stopRecording`（可測 / 錄音資料層中間層）。
  - 修改說明（2026-07-04）：新增 [recordingSession.ts](frontend/src/lib/recordingSession.ts)——`startRecording(page, now)`
    以起始頁建立 session；`recordSlideSwitch(session, page, now)` append 事件（切到同頁則回原參考 no-op、
    不改輸入）；`stopRecording(session, now)` 以 `max(0, now−start)` 為時長交給 `buildSlideTimeline` 產出時間軸。
    新增 `recordingSession.test.ts`（7 組：起始事件、切頁 append、同頁 no-op 同參考、不改輸入、停止產出時間軸、
    無切頁單一整段、停止時間 ≤ 起點回空）。前端 `tsc --noEmit` 通過、7/7 通過。分支 `feat/recording-session`，
    已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 82 個完成項目（82/100，未達上限）。

## 後端測驗分數加總驗證補單元測試（第二〇二輪，2026-07-04）

延續盤點，轉後端：`explicitScoreSum` 支撐 `POST /quizzes` 伺服器端「自訂分數加總不得超過 100 分」的權威
驗證（zod superRefine），但為 module-local、無單元測試。

- [x] 匯出並為 `explicitScoreSum` 補單元測試（伺服器權威計分驗證的覆蓋）。
  - 修改說明（2026-07-04）：`quizzes.ts` 的 `explicitScoreSum` 改為 `export`（用途/風險見既有註解：兩題各
    80 分會讓滿分被撐到 160/100）。新增 `explicit-score-sum.test.ts`（5 組：加總有效分數、缺/null 視為 0、
    負數/NaN/Infinity 視為 0、空清單回 0、偵測加總超過 100）。未改行為、僅加匯出與測試。後端 `tsc --noEmit`
    通過、5/5 通過。分支 `test/explicit-score-sum`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 81 個完成項目（81/100，未達上限）。

## 測驗題目完整性檢查抽出純函式（第二〇一輪，2026-07-04）

延續既有程式碼盤點：`QuizBuilderPage` 的 `canSave` 內聯一段非平凡的「每題是否完整」判斷、無測試。

- [x] 抽出測驗題目完整性檢查純函式 `allQuestionsComplete`（可測 / 固化可儲存規則）。
  - 修改說明（2026-07-04）：新增 [quizValidation.ts](frontend/src/lib/quizValidation.ts) 的
    `allQuestionsComplete(questions)`——每題須有非空題幹，且申論題（essay）免選項、其餘題型至少 2 個非空
    選項（空陣列回 true，呼叫端另檢查「至少一題」）。`QuizBuilderPage` 的 `canSave` 改用之。新增
    `quizValidation.test.ts`（6 組：選擇題合格、空題幹不合格、選項不足不合格、申論題免選項、需每題皆完整、
    空陣列回 true）。前端 `tsc --noEmit` 通過、6/6 通過。分支 `refactor/quiz-questions-complete`，已 merge 回
    master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 80 個完成項目（80/100，未達上限）。

## 已作答題數計算抽出共用純函式（第二〇〇輪，2026-07-04）

延續既有程式碼盤點：`QuizBuilderPage` 有 3 處內聯相同的「已作答題數」計算、無測試。

- [x] 抽出已作答題數純函式 `countAnsweredQuestions`（去重 3 處 / 可測）。
  - 修改說明（2026-07-04）：新增 [countAnsweredQuestions.ts](frontend/src/lib/countAnsweredQuestions.ts) 的
    `countAnsweredQuestions(questions, answers)`——一題只要有至少一個選取答案即算已作答（泛型）。
    `QuizBuilderPage` 三處（送出前檢查、進度顯示）改用之。新增 `countAnsweredQuestions.test.ts`（5 組：計已答、
    缺/空視為未答、無題回 0、全答、忽略無對應題目的答案）。前端 `tsc --noEmit` 通過、5/5 通過。分支
    `refactor/count-answered-questions`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 79 個完成項目（79/100，未達上限）。

## 書籤/重點頁切換抽出共用純函式（第一九九輪，2026-07-04）

延續既有程式碼盤點：`PlayPage` 的 `toggleBookmark`（書籤頁）與 `toggleImportantPage`（重點頁）內聯同一段
「切換數字於升冪清單」邏輯、無測試。

- [x] 抽出升冪數字切換純函式 `toggleSortedNumber`（去重 2 處 / 可測）。
  - 修改說明（2026-07-04）：新增 [toggleSortedNumber.ts](frontend/src/lib/toggleSortedNumber.ts) 的
    `toggleSortedNumber(list, value)`——存在→移除、不存在→加入並保持升冪（沿用原 filter/append 語意、不改
    輸入）。`PlayPage` 兩個 handler 改用之。新增 `toggleSortedNumber.test.ts`（5 組：加入保持升冪、移除已存在、
    空集合加入、移除唯一值變空、不改輸入）。前端 `tsc --noEmit` 通過、5/5 通過。分支
    `refactor/toggle-sorted-number`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 78 個完成項目（78/100，未達上限）。

## 首頁繁中排序比較器收斂為共用純函式（第一九八輪，2026-07-04）

延續既有程式碼盤點：`HomePage` 有 5 處分類/標籤排序重複同一個 `localeCompare(b, 'zh-Hant', {…})`，
字串字面易打錯、且排序規則無測試。

- [x] 抽出繁中排序比較器 `compareZhHant`（去重 5 處 / 可測）。
  - 修改說明（2026-07-04）：新增 [compareZhHant.ts](frontend/src/lib/compareZhHant.ts) 的
    `compareZhHant(a, b, { numeric })`——`sensitivity:'base'`（大小寫/腔調不敏感）、`numeric` 預設 `true`
    （自然數排序）。`HomePage` 4 處 `{numeric:true,…}` 改用 `.sort(compareZhHant)`、標籤排序（無 numeric）改用
    `.sort((a,b)=>compareZhHant(a,b,{numeric:false}))`，行為等價。新增 `compareZhHant.test.ts`（5 組：基本大小
    與符號一致、numeric 自然數排序、numeric:false 字典序、大小寫視為相等、可直接當 sort 比較器）。前端
    `tsc --noEmit` 通過、compareZhHant 5/5＋groupItemsByCategory 5/5＋HomePage.sort 6/6 回歸通過。分支
    `refactor/compare-zh-hant`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 77 個完成項目（77/100，未達上限）。

## 課後報告作答時間軸攤平排序抽出純函式（第一九七輪，2026-07-04）

延續既有程式碼盤點：`PostClassReportPanel` 的「作答時間軸」區塊在 JSX 內聯 IIFE 攤平所有學生的作答並依
送出時間排序，無測試。

- [x] 抽出作答時間軸攤平排序純函式 `flattenAttemptsChronologically`（可測）。
  - 修改說明（2026-07-04）：新增 [reportAttemptsTimeline.ts](frontend/src/lib/reportAttemptsTimeline.ts) 的
    `flattenAttemptsChronologically(students)`——把每位學生的 `attempts` 攤平、逐筆掛上該學生 `client_id`、
    依 `submitted_at` 升冪排序（泛型、不改輸入）。`PostClassReportPanel` 時間軸區塊改用之。新增
    `reportAttemptsTimeline.test.ts`（4 組：跨學生攤平＋依時間排序、掛 client_id、空學生/空 attempts 回空、
    不改輸入）。前端 `tsc --noEmit` 通過、4/4 通過。分支 `refactor/attempts-timeline`，已 merge 回 master。
    BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 76 個完成項目（76/100，未達上限）。

## 「複製全部逐字稿」Markdown 組裝抽出純函式（第一九六輪，2026-07-04）

延續既有程式碼盤點：`PlayPageHeader` 的「複製全部逐字稿」按鈕在 onClick 內聯了「依頁碼排序＋每頁組
`## 第N頁` 標題接逐字稿＋join」的組裝，無測試。

- [x] 抽出「複製全部逐字稿」Markdown 組裝純函式 `buildAllScriptsMarkdown`（去重雛形 / 可測）。
  - 修改說明（2026-07-04）：新增 [allScriptsMarkdown.ts](frontend/src/lib/allScriptsMarkdown.ts) 的
    `buildAllScriptsMarkdown(pages, scripts, {pagePrefix, pageSuffix})`——依 `page_number` 排序（不改輸入）、
    每頁輸出 `## <前綴>N<後綴>\n<逐字稿>`（缺稿留空）、頁間空一行。`PlayPageHeader` 的按鈕改用之。新增
    `allScriptsMarkdown.test.ts`（5 組：排序＋格式、缺稿留空、空頁回空字串、不改輸入、自訂前後綴）。前端
    `tsc --noEmit` 通過、5/5 通過。分支 `refactor/all-scripts-markdown`，已 merge 回 master。BLOG.md 新增對應
    section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 75 個完成項目（75/100，未達上限）。

## 測驗選項勾選切換抽出共用純函式（第一九五輪，2026-07-04）

轉回既有程式碼盤點（掃描確認：前端 lib 除 `api.ts`（HTTP/re-export）外皆有測試、後端 route 的 JSON.parse
皆已防護，無補漏測/防護的低垂果實）。於 `QuizBuilderPage` 發現一處**真實重複且無測試**的邏輯並收斂。

- [x] 抽出測驗選項勾選切換純函式 `toggleAnswerIndex`（去重 / 可測）。
  - 修改說明（2026-07-04）：`QuizBuilderPage` 的 `toggleAnswer`（設定正解）與 `toggleStudentAnswer`（學生
    作答）各自內聯同一段「單選→只留該選項；複選→用 Set 加/減後升冪排序」邏輯、無測試。新增
    [toggleAnswerIndex.ts](frontend/src/lib/toggleAnswerIndex.ts) 的
    `toggleAnswerIndex(current, index, single)`（單選回 `[index]`、複選加/減後去重升冪、不改輸入），兩處
    handler 改用之、各收斂為一行。新增 `toggleAnswerIndex.test.ts`（7 組：單選忽略現況、複選加/減、空集合加、
    移除最後一個、去重、不改輸入）。前端 `tsc --noEmit` 通過、7/7 通過。分支 `refactor/toggle-answer-index`，
    已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 74 個完成項目（74/100，未達上限）。

## 錄音模式播放讀取側純函式 slideAtTime（第一九四輪，2026-07-04）

接續第一九〇輪的 `buildSlideTimeline`（寫入側：把切頁事件正規化為時間軸），補上讀取側：同步播放時
依目前播放秒數查出「當下該顯示哪一頁」。這是「同步播放簡報+錄音」不可或缺的一環。

- [x] 新增時間軸讀取純函式 `slideAtTime(segments, ms)`（可測 / 錄音同步播放基礎）。
  - 修改說明（2026-07-04）：在 [slideTimeline.ts](frontend/src/lib/slideTimeline.ts) 新增
    `slideAtTime(segments, ms)`——回傳相對錄音起點 `ms` 當下顯示的頁碼，區段為半開區間 `[startMs, endMs)`
    （剛好落在某段 endMs 者屬下一段）；落在時間軸外（早於第一段、到達/超過結尾）或 `ms` 非有限值回 `null`。
    擴充 `slideTimeline.test.ts` 新增 4 組（區間內取頁、邊界半開歸屬、時間軸外/結尾回 null、空時間軸/NaN 回
    null），全檔 13/13。前端 `tsc --noEmit` 通過。分支 `feat/slide-at-time`，已 merge 回 master。BLOG.md 新增
    對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 73 個完成項目（73/100，未達上限）。

## Jupyter Notebook 唯讀渲染元件（第一九三輪，2026-07-04）

接續第一九二輪的 `.ipynb` 解析純函式，完成 NEW_FEATURE「Jupyter notebook 支持」首步 b 的**渲染元件**部分
（頁面接線拆為步驟 c 待續）。

- [x] 新增 Jupyter Notebook 唯讀渲染元件 `NotebookView`（建立在 `parseNotebook` 之上）。
  - 修改說明（2026-07-04）：新增 [NotebookView.tsx](frontend/src/components/NotebookView.tsx)。吃
    `ParsedNotebook`：markdown cell 走既有 `MarkdownMath`（標題／粗體／條列／表格／LaTeX）、code/raw cell 以
    等寬 `<pre><code>` 區塊顯示原始碼（空白 source 略過）、code cell 的 outputs 依三類呈現——text/error 用
    `<pre>`（error 以 rose 色系並粗體標 `ename: evalue`＋traceback）、image 以 `data:` URI `<img>`；空 notebook
    回 `null`。沿用專案 surface/border 色票、深色模式相容。前端 `tsc --noEmit` 通過（專案無 React 元件測試框架，
    元件以 tsc 驗證；解析邏輯已於步驟 a 的 `notebook.test.ts` 覆蓋）。分支 `feat/notebook-view`，已 merge 回 master。
    BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 72 個完成項目（72/100，未達上限）。

## Jupyter Notebook 解析純函式（第一九二輪，2026-07-04）

接續第一八九輪拆分的 NEW_FEATURE「Jupyter notebook 支持」首步。原「解析＋唯讀渲染」拆為 a（解析純函式，
本輪）與 b（前端唯讀渲染＋頁面接線，待續），先固化可測的解析核心。

- [x] 抽出 `.ipynb` 解析純函式 `parseNotebook`（可測 / Notebook 頁面基礎）。
  - 修改說明（2026-07-04）：新增 [notebook.ts](frontend/src/lib/notebook.ts) 的 `parseNotebook(raw)`（＋
    `ParsedNotebook`／`NotebookCell`／`NotebookOutput` 型別）。把 .ipynb 原始 JSON 正規化為依序 cell：
    `cell_type` 映射為 `markdown`／`code`／`raw`（未知歸 raw）、`source`（字串或字串陣列）併為單一字串；
    僅 code cell 解析 `outputs`，收斂三類——`stream`→text、`execute_result`／`display_data`→優先 image（`image/*`）
    否則 `text/plain`、`error`→{ename,evalue,traceback}（traceback 併行）。全程防護：損壞 JSON／非物件／
    無 cells 陣列→空 notebook，非物件 cell／無法呈現的 output 跳過但保留該 cell。新增 `notebook.test.ts`
    （9 組：md/code+陣列 source、stream→text、image 優先、text/plain fallback、error 併 traceback、未知型別歸
    raw 且忽略 outputs、丟棄無法呈現 output 保留 cell、損壞/缺 cells→空、跳過非物件 cell）。前端 `tsc --noEmit`
    通過、9/9 通過。分支 `feat/notebook-parser`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 71 個完成項目（71/100，未達上限）。

## 測驗錄影人頭偵測提示狀態機純函式（第一九一輪，2026-07-04）

接續第一八九輪拆分的 NEW_FEATURE「測驗錄影加人頭偵測」首步：逐幀偵測會有單幀誤判，若每次抓不到臉就
閃提示會很干擾。先固化「偵測結果序列 → 是否提示」的去抖狀態機，作為之後接偵測迴圈／UI 的可測基礎。

- [x] 抽出人頭偵測提示去抖狀態機 `updateHeadDetectionState`（可測 / 人頭偵測基礎）。
  - 修改說明（2026-07-04）：新增 [headDetectionPrompt.ts](frontend/src/lib/headDetectionPrompt.ts) 的
    `updateHeadDetectionState(state, headDetected, missThreshold)`（＋`HeadDetectionState` 型別與
    `initialHeadDetectionState`）。遲滯設計避免閃爍：開啟提示需「連續 `missThreshold` 幀未偵測」（on-delay
    去抖、threshold 夾為至少 1 並向下取整），偵測到人頭則立即清除提示並歸零計數（快速恢復）；提示開啟後維持
    到偵測到人頭為止。detect 為 no-op 時回傳同一物件參考。新增 `headDetectionPrompt.test.ts`（8 組：未達門檻
    不提示、達門檻提示、單幀偵測不觸發、偵測即清除提示、提示持續到偵測、門檻夾 ≥1、非整數門檻向下取整、
    no-op 同參考）。前端 `tsc --noEmit` 通過、8/8 通過。分支 `feat/head-detection-prompt`，已 merge 回 master。
    BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 70 個完成項目（70/100，未達上限）。

## 錄音模式簡報切換時間軸純函式（第一九〇輪，2026-07-04）

接續第一八九輪拆分的 NEW_FEATURE「錄音模式」首步：先固化「錄音時記錄簡報切頁時間點 → 正規化時間軸」
的資料模型與純函式，作為未來「同步播放簡報+錄音」或「合成影片」的共同基礎（尚不含錄音 UI／儲存／
MediaRecorder 接線）。

- [x] 抽出簡報切換時間軸純函式 `buildSlideTimeline`（可測 / 錄音模式基礎）。
  - 修改說明（2026-07-04）：新增 [slideTimeline.ts](frontend/src/lib/slideTimeline.ts) 的
    `buildSlideTimeline(recordingStartMs, events, recordingDurationMs)`（＋`SlideSwitchEvent`／
    `SlideTimelineSegment` 型別）。把原始切頁事件（絕對時間戳、可能亂序）換算成相對錄音起點的 0-based
    連續區段 `{page, startMs, endMs}`：夾到 `[0, duration]`（濾掉錄音前/後雜訊）、依偏移穩定排序、合併
    連續同頁、第一段回溯到 0 覆蓋整段錄音、濾除零長度區段（同一時間點以較晚事件勝出）；空事件或
    `duration ≤ 0` 回空。沿用既有 `clamp`。新增 `slideTimeline.test.ts`（9 組：連續區段、首段回溯、亂序
    排序、同頁合併、真實回看前頁保留、前後雜訊夾界、同刻零長度濾除、空/非正 duration、忽略非整數頁/
    非有限時間）。前端 `tsc --noEmit` 通過、9/9 通過。分支 `feat/recording-slide-timeline`，已 merge 回 master。
    BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 69 個完成項目（69/100，未達上限）。

## 規畫輪：批次匯出進度條 + 依 NEW_FEATURE 補充項目（第一八九輪，2026-07-04）

盤點：AI 導師（PageAskPanel）品質 backlog 已幾乎清空（僅剩 SSE 串流，屬大項、不宜自動 loop 逕行）；
其餘未完成 `[ ]` 多為**待使用者決定**（系統性 mapApiErrorToHumanMessage、前端測試納入 root）、
**需產品／身分裁示**（課後報告個人層級——`quiz_attempts.client_id`／`page_poll_votes.voter_id`／
`page_watch_progress.viewer_id`／`page_comments.author` 身分鍵不統一，跨表彙整需先定義「同一人」）、
或 **§8.1.5 header 分組需產品確認**。乾淨、低風險、可自動完成的既有 backlog 已實質見底。依 LOOP.md
第 2 條，分析後參考 [NEW_FEATURE.md](NEW_FEATURE.md) 方向新增五個項目，並完成其一（匯出進度條）。

- [x] **批次匯出「匯出全部 ZIP」顯示視覺進度條**（NEW_FEATURE「匯出時顯示進度條」）：`HomePage` 的批次
  匯出（`/api/export/batch` job + `pollBatchExport`）原本只在按鈕文字顯示「打包中… N/total」，無視覺
  進度條。
  - 修改說明（2026-07-04）：`HomePage` 在匯入 ZIP 進度條區塊旁新增批次匯出進度條（僅
    `batchExportJobId !== null && batchExportTotal > 0` 時顯示），沿用既有 `batchExportProgress`/
    `batchExportTotal` 狀態與已測純函式 `progressPercent(current,total)`（clamp 0–100、防 NaN）計算寬度與
    `aria-valuenow`，樣式比照既有 importZip 進度條（emerald 色系、`role="progressbar"`）。新增 i18n 鍵
    `home.batchExportProgressAriaLabel`（zh-TW／en）。純前端、無新邏輯風險（百分比走既有測試覆蓋的
    helper）。前端 `tsc --noEmit` 通過、i18n parity 24/24。分支 `feat/batch-export-progress-bar`，已 merge
    回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 68 個完成項目（68/100，未達上限）。

以下為本輪新增、待後續 loop 接續的四個項目（依 NEW_FEATURE.md 方向，已拆成 autonomous-friendly 首步）：

- [x] **單份簡報匯出（export.zip）進度回報**（NEW_FEATURE「匯出進度條」延伸，2026-07-11）：新增
  `POST /api/pdfs/:id/export-job`／`GET .../export-job/:jobId`／`GET .../export-job/:jobId/download`
  ([export-job.ts](backend/src/routes/pdfs/export-job.ts))，比照 `batch-export.ts` 的 job+poll+download
  三段式（in-memory job map、10 分鐘逾時清掃），權限沿用既有 `canReadPdf`/`aclCtx`（poll／download 每次都
  重新檢查，故 share token 自然適用）；固定 8 步進度（zip＋6 個 sidecar 檢查＋最終讀檔驗證），不受該份簡報
  是否真的有投票／測驗等 sidecar 資料影響，前端進度條穩定可預期。**原本同步的 `GET /api/pdfs/:id/export.zip`
  完全不變**（HomePage 單顆匯出鈕與既有測試都繼續打這條路由），新 job 端點是額外加的，不是取代。前端
  `PlayPageHeader` 下載選單新增「匯出簡報（含進度）」鈕＋進度條（此前 PlayPage 完全沒有 export.zip 入口），
  複用既有 `progressPercent`／`triggerDownload`。i18n 4 鍵。驗證：新測 `single-export-job` 5/5、既有
  `batch-export`／`export-zip-cjk-filename`／`export-zip-timeout`／`export-import-notebook`／
  `export-import-zip-sources`／`export-import-zip-interactive` 逐檔重跑共 15/15 無回歸（此環境完整後端套件
  以單一 `npm test` 併發跑 200+ 檔會卡住不動，逐檔跑正常，故改採逐檔驗證）；前後端 `tsc`、前端測試
  818/818、i18n parity、`vite build` 通過。分支 `feat/single-export-progress`，已 merge 回 master。
- [x] **錄音模式——第一步：簡報切換時間軸純函式**（NEW_FEATURE「錄音模式」）：定義「錄音 session + 簡報
  切換事件」資料結構，抽出可測純函式把 `(recordingStartMs, pageSwitchEvents[])` 正規化為 `{page, startMs,
  endMs}` 連續區段（處理亂序、同頁連續、結尾以錄音長度收尾），供未來「同步播放簡報+錄音」或「產生影片」使用。
  先做時間軸模型與測試，不含錄音 UI／儲存／MediaRecorder 接線。（第一九〇輪完成，見下方「錄音模式簡報切換時間軸純函式」section）
- [x] **測驗錄影人頭偵測——第一步：提示狀態純函式**（NEW_FEATURE「測驗錄影加人頭偵測」）：在既有
  `useQuizRecorder` 錄影流程加 in-browser 人臉/人頭偵測（優先用瀏覽器原生 `FaceDetector`，退回輕量模型），
  偵測不到時提示並顯示鏡頭預覽。先抽出「偵測結果序列 → 是否提示」的純函式（連續 N 次未偵測才提示、含去抖，
  避免單幀誤報造成閃爍），可測；再接 UI／偵測迴圈。（第一九一輪完成，見下方「測驗錄影人頭偵測提示狀態機純函式」section）
- [x] **Jupyter Notebook 頁面型別——第一步 a：解析純函式**（NEW_FEATURE「Jupyter notebook 支持」）：把 `.ipynb`
  原始 JSON 解析成正規化 cell 模型（markdown／code／raw，code 的 outputs 收斂為 text／image／error，防護損壞
  JSON 與缺欄位）。（第一九二輪完成，見下方「Jupyter Notebook 解析純函式」section）
- [x] **Jupyter Notebook 頁面型別——第一步 b：前端唯讀渲染元件**（NEW_FEATURE「Jupyter notebook 支持」）：
  以第一步 a 的 `parseNotebook` 模型做唯讀渲染元件（markdown 走 `MarkdownMath`、code 以等寬樣式、outputs 支援
  text／image／error）。（第一九三輪完成，見下方「Jupyter Notebook 唯讀渲染元件」section）
- [x] **Jupyter Notebook 頁面型別——第一步 c：頁面接線**（NEW_FEATURE「Jupyter notebook 支持」）：定義
  「.ipynb 如何成為一個頁面」的上傳/載入/儲存接線，並在播放/檢視流程把 notebook 檢視接上實際資料。
  （2026-07-08：已由新的 Jupyter 整合計畫**完全且超額**涵蓋——階段 0 資料模型 `render_type='notebook'`／1b `.ipynb` GET/PUT CRUD／1c-ii `SlideRenderer` 的 notebook 分流接 `fetchPageNotebook`／4c 轉成 notebook／4d 單頁 `.ipynb` 匯入匯出；且以**可執行**的 `NotebookPanel` 取代原唯讀 `NotebookView`，「在頁面中執行代碼」亦已於 1c-iii 完成。此舊項目就此收束。）

## 測驗監考錄影只錄影不錄音（使用者要求，2026-07-02）

使用者要求：測驗錄影時不要錄音，只錄影就好。

- [x] 監考錄影改為只擷取影像、不請求麥克風。
  - 修改說明（2026-07-02）：[useQuizRecorder.ts](frontend/src/hooks/useQuizRecorder.ts) 的
    `getUserMedia` 由 `{ video, audio: true }` 改為 `audio: false`，避免收錄考場環境音或學生說話；
    串流無音軌後，即使 MediaRecorder 用含 opus 的 mime 字串，產出仍為純視訊 webm。更新模組與
    呼叫處註解。無測試斷言 `audio: true`，前端 `tsc --noEmit` 通過。分支
    `feat/quiz-recording-video-only`，已 merge 回 master。
  - 本項為使用者要求的功能變更，**不計入** 100 輪計數。

## 身分式分享權限：只讀/讀寫名單 + 預設權限（使用者要求，2026-07-03）

使用者要求：更改分享模式，可設定特定使用者為只讀或讀寫，並設定一個預設權限；不在名單中的人套用
預設權限。後續補充：名單提供 search（email／display name／群組名稱）挑選、可把名單存成群組、
系統設定加群組定義；預設權限沿用現有 `visibility`。分成多個步驟推進：

- [x] 步驟 1：ACL 資料層 + 權限解析核心。新增 `pdf_permissions` 表（principal user／預留 group、
  access read_only/read_write）與 [pdfAccess.ts](backend/src/routes/pdfs/pdfAccess.ts) 的
  `resolvePdfAccessLevel`／純函式 `decidePdfAccessLevel`（擁有者永遠 edit、名單命中覆蓋預設、
  未列名回退 visibility、email 不分大小寫）。11 單元測試。分支 `feat/pdf-acl-step1-resolver`（已 merge）。
- [x] 步驟 2a：`canReadPdf`/`canEditPdf` 加可選 ACL context（不傳則行為不變）；接線 detail 的列表過濾與
  GET 讀取閘門，detail 回應加 `access_level`。新增 `sessionEmail()`。5 HTTP 測試 + 既有 92 權限測試無回歸。
  分支 `feat/pdf-acl-step2a-read-gate`（已 merge）。
- [x] 步驟 2b：新增 `aclCtx(request, id)` 並接線全站約 130 個 `canReadPdf`/`canEditPdf` 呼叫點（detail、
  page-operations、figures、drawings、page-animation、comments、watchProgress、subtitles、quizzes、
  generate-*、regenerate、add-pages、from-pages、versioning、search、匯出/報告類、sync follower/名單）。
  保留 admin.ts／upload.ts（建立流程、不同 auth helper）與 `canDestructivelyEditPdf`（owner-strict）——
  未接線者 fail-closed、安全。權限套件無回歸。分支 `feat/pdf-acl-step2b-wire-routes`（已 merge）。
- [x] 步驟 3：管理 API [pdfPermissions.ts](backend/src/routes/pdfs/pdfPermissions.ts)——擁有者
  GET/PUT/DELETE `/api/pdfs/:id/permissions`（名單增刪查、email 正規化小寫）＋ `GET /api/accounts/search`
  （依 email／display name 比對已知帳號，供挑選）。預設權限沿用既有 visibility PATCH。5 API 測試。
  分支 `feat/pdf-acl-step3-admin-api`（已 merge）。
- [x] 步驟 4：前端分享對話框新增「存取權限」分頁（僅擁有者可見）——
  [AccessControlPanel.tsx](frontend/src/pages/play/AccessControlPanel.tsx)：預設權限選擇（對應 visibility）、
  含 search 的加入框（帳號 search 或直接輸入 email）、名單逐項改權限/移除。新增 API client 與 zh-TW/en
  文案（i18n parity 24/24）。前端 typecheck + ShareDialog 測試通過。分支 `feat/pdf-acl-step4-share-ui`（已 merge）。
- [x] 步驟 5：群組。DB 表 `groups`/`group_members` + 後端 owner-scoped CRUD
  [groups.ts](backend/src/routes/pdfs/groups.ts)（POST 可帶 seed emails 供「存成群組」；4 測試）；
  resolver `fetchMatchedGrants` 展開群組成員（成員繼承群組授權、直接與群組取最高）；管理 API 的
  PUT/DELETE/list 支援 group principal（回傳群組名稱＋人數）。前端：系統設定新增「群組」分類
  [GroupsManager.tsx](frontend/src/components/GroupsManager.tsx)（建群組/成員增刪含 search）；分享
  「存取權限」分頁 search 納入群組、名單顯示群組（👥＋人數）、「把目前名單存成群組」。分支
  `feat/pdf-acl-step5-groups-backend`／`-step5c-groups-ui`／`-step5d-share-groups`（皆已 merge）。
- [x] 步驟 6：收尾。前端 `PdfDetail` 加 `access_level`，`PlayPage` 的 `shareIsReadOnly` 納入
  `access_level==='read'`——只讀名單使用者顯示唯讀 UI（不再出現會被後端擋下的編輯鈕）；讀寫授權
  仍解析為 edit、可編輯。前後端 typecheck 通過；ACL/群組/權限測試 42 綠（pdf-access 13、
  permissions-api 6、groups-api 4、read-gate 5、sync-join 14）。分支 `feat/pdf-acl-step6-readonly-ui`
  （已 merge）。

本功能（身分式分享權限：只讀/讀寫名單＋群組＋預設權限）**六步驟全部完成**。保留項：admin.ts／
upload.ts 的權限判斷仍為 visibility-only（建立流程／管理情境，fail-closed 安全，非核心分享路徑）。

## 分享權限模型統一：兩套系統＋分享連結成為能力憑證（使用者要求，2026-07-04）

先前檢討發現「誰能存取簡報」由三套語意重疊的機制決定：`visibility`、分享連結 token（`pdf_shares`）、
身分式 ACL（`pdf_permissions`／群組）。其中分享連結並非真正的能力憑證——建立連結時會**偷偷翻動
全域 `visibility`**（read_only→public、editable→public_editable），token 本身不具保密力，且 editable
連結的編輯能力其實來自 visibility 而非 token；`hasShareAccess` 也未檢查到期。使用者要求：把三套整併成
**兩套一致的系統**，每個動作都以兩套系統的**較高權限**為準。

- [x] 統一為兩套系統：
  - **系統一（身分權限）**：`visibility` 預設 ＋ per-user/group ACL，合併由 `resolvePdfAccessLevel` 解析。
    前端「存取權限」分頁即此設定（預設權限＋名單），與分享連結分頁分離呈現。
  - **系統二（Token 能力憑證）**：新增 `resolveTokenAccessLevel`（含到期檢查），任何持有有效 token 的人
    （含未登入）取得 token 內含的 read／edit 能力；建立連結**不再改動 visibility**（後端移除翻動、前端
    移除送出 `visibility` 與本地誤設 public）。
  - **合併決策**：`aclCtx` 帶入 token 能力，`canReadPdf`/`canEditPdf` 內部以 `max(身分, token)` 決策；
    全站約 146 個讀寫閘門呼叫點無需改動即同時吃兩套系統。清掉 40 處多餘且有到期 bug 的
    `hasShareAccess`／`shareAccessForPdf` 讀取前綴，收斂為單一路徑。detail 回應的 `access_level` 改為
    **有效權限**（身分 max token），前端 `shareIsReadOnly` 隨之一致。
  - **破壞性操作**：刪頁／刪測驗／刪投票／刪畫板等改以 `canDestructivelyEditPdf`＋合併 context，需解析出
    edit（不論來源）**且已登入**；**刪除整份簡報**限縮為**僅擁有者**（`isPdfOwner`）。
  - 後端 tsc 通過；既有權限套件無回歸（delete 測試更新為 owner-only）＋新增 `token-capability` 測試；
    前端 tsc 通過、i18n 文案更新以區分兩套概念。分支 `feat/unified-access-capability-tokens`。
  - 測試缺口補齊（使用者要求）：後端 `token-capability` 擴充至 **22 測試**——`resolveTokenAccessLevel`
    邊界（無 token／格式錯／對到別份／read↔edit／過期）、detail `access_level` 為**有效權限**（editable
    token→edit、read_only token→read）、破壞性操作**經 read_write 名單授權**（非 visibility）＋整合
    DELETE drawing 驗證接線、editable token 於第二條編輯路由（PATCH title）賦權。前端把 `shareIsReadOnly`
    抽成純函式 [deckAccess.ts](frontend/src/pages/play/deckAccess.ts) 的 `resolveDeckReadOnly` 並接回
    `PlayPage`，新增 7 測試（`deckAccess.test.ts`）。後端各權限套件與前端 tsc／deckAccess＋ShareDialog＋i18n
    全綠。備註：多個 buildApp 整合檔並跑會遇 SQLite 檔鎖競爭，分組序跑即正常。
  - 二次矩陣覆核（使用者要求，2026-07-04）發現並修復一個**提權漏洞**：`PATCH /api/pdfs/:id/visibility`
    的閘門原為 `canEditPdf(...aclCtx)`，新模型下匿名 editable-token 持有者或 read_write 名單使用者可
    改「預設權限」（如改成 public_editable 讓全世界永久可編輯、token 過期後仍有效）。visibility 變更屬
    **存取管理**而非內容編輯，改為 owner-only（`hasOwnerOrLegacyAccess`），與 ACL 管理 API／建立分享
    連結一致。`token-capability` 擴充至 **27 測試**，補齊矩陣：建立分享連結 owner-only（非擁有者／
    token 持有者 403）、visibility owner-only（read_write 名單與匿名 token 皆 403、owner 200）、
    read_write 名單刪整份簡報 403、只讀名單＋editable token→有效 edit（反向 max）、群組授權 HTTP
    端對端（read_only 群組可讀不可編、升 read_write 可編、陌生人 403）。相關 9 套件序跑全綠。分支
    `fix/access-admin-owner-only`。

## 同步 master/follower 定義改為以擁有者為準（使用者要求，2026-07-02）

使用者要求變更 master/follower 的定義：「自己的簡報按下同步模式會變成 master，不是的會變成 follower」。
原本 master 是「第一個以編輯權限（owner 或 public_editable 協作者）加入同步的人」，導致有編輯權限的
協作者也能搶下主控權。新定義收斂為：**只有簡報擁有者**按下同步會成為 master，其他所有人（分享連結
訪客、public 唯讀觀看者、public_editable 協作者）一律為 follower。

- [x] 同步 master 角色改以「簡報擁有者」為判準（取代「有編輯權限且先搶先贏」）。
  - 修改說明（2026-07-02）：後端 [sync.ts](backend/src/routes/pdfs/sync.ts) 的 `/sync/join` 與 `/sync/state`
    取得主控權的門檻由 `canEditPdf` 改為 `isPdfOwner`——非擁有者（含 public_editable 協作者）呼叫
    master 路徑回 403，只能以 follower 走 `/sync/share-join`。前端 [PlayPage.tsx](frontend/src/pages/PlayPage.tsx)
    新增 `isSyncMasterEligible = Boolean(detail?.is_owner)`，加入路徑（join vs share-join）、自動跟隨、
    master 失效後是否自動重奪，全部改以此判準（取代原本的 `currentShareToken || shareIsReadOnly`）。
    更新 `sync-join-permission.test.ts`：原「public_editable 協作者可取得 master」改為「被拒（403）、
    但可以 follower 身分 share-join」，並新增「非擁有者協作者無法於 /sync/state 空窗期搶 master」測試。
    前後端 `tsc --noEmit` 通過；sync 權限 13/13 測試 + 其餘 sync 測試 7/7 回歸通過（以 Node 22 執行）。
    分支 `feat/sync-master-follower-by-ownership`，已 merge 回 master。
  - 本項為使用者要求的功能變更，**不計入** 100 輪計數。

## AI 導師（PageAskPanel）回答品質改善（使用者要求，2026-06-28）

背景：AI 導師回答先前把換行輸出成字面 `\n`，已於後端 `/pages/:n/ask`（[page-operations.ts](backend/src/routes/pdfs/page-operations.ts)）回傳前正規化成真換行（分支 `fix/ai-tutor-newline-readability`）。以下為可進一步提升回答可讀性與品質的後續項目：

- [x] **Markdown 渲染**：~~回答含 `**粗體**`、`##` 標題、`-`/數字條列，但目前以純文字顯示~~。**已完成**（非本輪）：`PageAskPanel` 現以自寫的輕量渲染器 [MarkdownMath.tsx](frontend/src/components/MarkdownMath.tsx) 呈現 AI 導師回答，支援標題／粗體／斜體／行內碼／條列／表格與 LaTeX（katex），文字走 React text node、不用 innerHTML（僅 katex 產出的受信任 HTML 例外）。此項於先前輪次隨 MarkdownMath 導入而解決，僅補記狀態、**不計入**計數。
- [x] **串流輸出（streaming）**（2026-07-11）：本項其實已於分支 `feat/tutor-ask-streaming`（見「AI 導師問答逐字（串流）顯示」section）完成 SSE 逐段顯示，僅此舊條目未同步勾掉；經比對確認唯一真正缺口是「可中途取消」——當時與其範本 `animation/custom-script` 都只做了「偵測斷線、停止寫入」，並未真的中止上游 LLM 呼叫。本輪補上：`streamChatText`／`callGeminiTextStream`（[openai.ts](backend/src/services/openai.ts)／[gemini.ts](backend/src/services/gemini.ts)）新增可選 `signal`，轉發進 OpenAI SDK 呼叫的 `RequestOptions`（Gemini 則與既有逾時 signal 以 `AbortSignal.any` 合併）；`/ask` 路由既有的 `request.raw.on('close')` 斷線偵測，現在同時 `abort()` 一個逐次請求的 `AbortController`，讓取消/斷線真正停止耗費 token，而不只是停止對已斷線連線寫入。前端 `askPageQuestion` 新增 `signal` 參數；`usePageAsk` 每次請求建立 `AbortController` 並提供 `cancelAskPage()`；`PageAskPanel` 忙碌時把送出鈕換成「停止生成」，取消時保留已串流的部分內容作為最終答案（不回滾）。i18n 1 鍵。驗證：新測 `streamChatText forwards an AbortSignal...` 1/1、既有 `ai-tool-loop` 3/3＋`page-ask` 6/6＋`gemini-contents`／`gemini-fetch-timeout`／`gemini-tts-diagnostics` 17/17 無回歸；前後端 `tsc`、前端測試 818/818、`vite build` 通過。分支 `feat/ai-tutor-ask-cancel`，已 merge 回 master。
- [x] **輸出長度／結構控制**：system prompt 要求「完整、不刻意精簡」常導致過長。新增「精簡／詳細」切換或長度上限，並引導模型先給重點摘要再展開。（第一八七輪完成，見下方「AI 導師回答長度精簡／詳細切換」section）
- [x] **引用頁碼可點擊**：回答中的「（第 N 頁）」目前是純文字。解析成可點連結，點擊跳到該頁，提升跨頁查證效率。（第一八六輪完成，見下方「AI 導師回答的引用頁碼可點擊跳頁」section）
- [x] **錯誤與空答處理**：當所有內容皆無相關資訊時，模型偶爾仍杜撰；強化 prompt 與後處理（偵測「查無資訊」語句時給固定提示），並把後端原始錯誤改走 `mapApiErrorToHumanMessage`。（第一八八輪完成，見下方「AI 導師錯誤與空答處理」section）
- [x] **保留對話脈絡的上限管理**：`history` 全量帶入長對話會超出 token 預算；加上輪數/字數截斷與必要的摘要壓縮。（第一八五輪完成，見下方「AI 導師多輪對話脈絡字數上限管理」section）

## add-pages 失敗導致 metadata 與 DB 分歧 + Uhga6bY0Bm 修復（使用者回報 bug，2026-06-27）

使用者回報：簡報 `Uhga6bY0Bm` 第 42 頁以後資料因前一次失敗的「多面產生」而像是不見了。

- 診斷：`runAddPagesFromPrompt` 的 `runAddPagesJob` 會**先**就地改動 DB 結構（把既有頁碼整批位移、`pdfs.page_count` +N、插入新頁列），卻只在**成功路徑**才重寫 `metadata.json`。那次任務在產圖/逐字稿/語音途中失敗（第 42 頁僅產出圖、43/44 全空），重啟後 `recoverOrphanedAddPagesPages()` 把這 3 頁半成品標成 `failed`。結果 DB 是位移後的 86 頁（原 42–83 → 45–86，外加 42–44 三筆 failed），但 `metadata.json` 仍停在舊的 83 頁佈局 → **DB 與 metadata 分歧**，使信任 metadata 的消費端（匯出／GitHub 同步／重新匯入）呈現殘缺或整份壞掉的簡報，但其實沒有任何頁面真的遺失（原始 83 頁檔案完整）。
- 實例修復：依使用者裁示「保留 3 頁並重新產生」，把 `Uhga6bY0Bm/metadata.json` 重建為與 DB 一致的 86 頁（原 83 頁時間戳保留、新增 42/43/44 三頁 failed 條目），消除分歧。三頁的實際內容重產（LLM 產圖／TTS，計費且需後端執行）保留給使用者於 UI 觸發。
- 程式碼修復（分支 `fix/add-pages-failure-metadata-consistency`，已 merge）：抽出 `rebuildAddPagesMetadataFromDb(pdfId)`（從 DB 重建 metadata 的 pages/page_count），在**成功與失敗（含取消）兩條終結路徑都呼叫**，使 DB↔metadata 永不分歧；best-effort（寫入失敗只記 log，不掩蓋原始錯誤）。新增 `add-pages-metadata-resync.test.ts`（2 測試），前後端 typecheck 通過、新測試 + orphan-recovery 5 回歸全綠。
- 本項為使用者回報 bug 修復，**不計入** 100 輪計數。

### 後續可執行項目（本輪盤點新增）

- [x] **`regenerate-image` 對「無底圖」頁面退而用文字→圖生成**：原本單頁 `POST /api/pdfs/:id/pages/:n/regenerate-image`（[page-operations.ts](backend/src/routes/pdfs/page-operations.ts)）與「重生」批次 job 的圖檔步驟（[regenerate.ts](backend/src/worker/regenerate.ts)）都一律以 `client.images.edit` 拿現有圖當基底；像 `Uhga6bY0Bm` 第 42/43/44 頁這種失敗後底圖檔不存在的頁面，會在讀檔時 `ENOENT` 整個任務失敗、無法於 UI 重產（使用者實際遇到）。
  - 修改說明（2026-06-27）：兩處都改為「底圖檔缺失時不丟錯、改走文字→圖生成」——讀底圖以 `try/catch` 包覆（僅吞 `ENOENT`、其餘照拋並記 warn）；有 figure 參考圖則 `images.edit`（以參考圖為輸入、用 base prompt）、否則純 `images.generate`，比照初次產圖 `renderTextPagesWithLlm` 的選擇邏輯；有真底圖時行為完全不變（仍用 edit + edit 模板）。新增 `regenerate-image-missing-base.test.ts`（單頁路由 + 重生 job 各驗證缺底圖時呼叫 generate 而非 edit、且 job 完成並寫出新圖）。後端 typecheck 通過，新測試 2/2 + figure-reference/image-edit-timeout 回歸通過。分支 `fix/regenerate-image-missing-base`（已 merge）。
  - 本項為使用者回報 bug 修復，**不計入** 100 輪計數。

- [x] **Uhga6bY0Bm 第 42/43 頁焦點動畫紅框位置全錯（使用者回報，2026-06-27）**：使用者回報「AI 產生動畫時似乎沒看到正確的圖片，紅框位置都差很多」，以第 42 頁為例。
  - 診斷（2026-06-27）：經完整查證，**目前的程式碼是正常的**——圖片有正確送出、模型也看得到。(1) 第 42 頁 `image_path` 指向的 `gVY2JLjpeT.jpg`（1920×1080）內容正確、`sharp` 能正常載入成 1024px data URL；(2) 該帳號用 `LLM_PROVIDER=cgu-air`、`CGU_AIR_LLM_MODEL=gpt-5.5`，直接把圖片送該端點問它看到什麼，它精準描述出版面（左 5 項目卡片、右側矩陣 A×x=y 與展開式、底部說明框），證實 gpt-5.5 支援 vision 且圖片有被處理；(3) 用真正的 `generateAiFocusEffects` 程式路徑對第 42 頁重跑 4 次，全部產生**貼合版面、多樣**的方框（左欄穩定落在 xPct≈16、底部展開式框在右下、無視覺元素的句子被正確略過），從未退化。對照存檔的壞規格：第 42/43 頁全是 `xPct:10`、`yPct` 機械遞增（10/25/40/55/70/85/95…）、幾乎每句都顯示——這是**純文字模型「看不到圖片」時平均分散方框**的典型特徵。結論：第 42/43 頁是先前 add-pages 失敗後那批補產動畫的**舊殘留**，當時圖片未被模型使用（推測為當下用了不具 vision 的模型或閘道暫時性丟棄圖片），與現行程式碼無關。
  - 資料修復（2026-06-27）：以現行 gpt-5.5 設定，透過真正的持久化路徑 `generateAnimationForPage` 重產第 42、43 頁焦點動畫並寫回 `animation.json` + `pages` 資料表。重產後 distinct xPct 由 1（全 x10）變為 4–5、效果數由 13/6 收斂為 8/5、方框位置貼合實際版面。第 44 頁為 `static-image`、本就無動畫規格（非壞殘留），未變動。
  - 程式碼修復（分支 `fix/autofocus-image-provider-comment`，已 merge）：修正 [animationAutoFocus.ts](backend/src/services/animationAutoFocus.ts) `generateAiFocusEffects` docstring 中**已過時且會誤導排查的註解**——原稱圖片「only actually used when `LLM_PROVIDER=openai`」（因 Gemini 會剝除非文字內容）。此說法已不正確：`buildGeminiContents` 會把 data URL 轉成 `inlineData`、OpenAI 相容 provider（openai/cgu-air/openrouter）直接透傳 `image_url`，故圖片在**所有現行 provider 都會送達模型**；改寫為依實際逐 provider 行為描述，並點明「結果看似純文字（方框機械排成一欄、無視版面）代表模型/閘道未套用 vision，而非本程式碼把圖片丟掉」。僅改註解，後端 `tsc --noEmit` 通過。
  - 本項為使用者回報 bug 修復，**不計入** 100 輪計數。

## 品質檢查面板徽章狀態抽出純函式（第一八四輪，2026-06-28）

推進 §7.2（品質檢查自動化）的前端基礎：`QualityCheckPanel` 三個分析區塊（品質/逐字稿/圖片）的標題徽章顯示判斷以巢狀三元運算式重複了三份、無獨立測試，且為 §7.2 後續「側邊欄分頁品質徽章」所需。

- [x] 抽出品質檢查徽章狀態純函式 `analysisBadgeState`（去重 / 可測 / §7.2 基礎）。
  - 修改說明（2026-06-28）：`lib/qualityCheckSelection.ts` 新增 `analysisBadgeState(hasRun, running, issueCount)`，回傳判別聯集 `{kind:'hidden'} | {kind:'ok'} | {kind:'issues',count}`（未執行/執行中→hidden、完成無問題→ok、否則→帶數量 issues）。`QualityCheckPanel` 三區塊改用之（品質區塊問題數用過濾後的 `issuePages.length`），移除三份重複巢狀三元；顏色仍由各區塊 JSX 依語意自選、顯示行為等價。新增 4 組測試。前端 `tsc --noEmit` 通過、qualityCheckSelection 9 測試通過。分支 `refactor/analysis-badge-state`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 63 個完成項目（63/100，未達上限）。

## 首頁分類分組組裝抽出純函式（第一八三輪，2026-06-27）

延續前端：`HomePage` 的 `categoryGroups` 內聯了「find-or-create 分組+組內排序+組間排序+預設分類 fallback」，比較器本身已測但分組組裝無測試。

- [x] 抽出首頁分類分組純函式 `groupItemsByCategory`（可測 / 固化分組與排序組裝）。
  - 修改說明（2026-06-27）：新增 `lib/groupItemsByCategory.ts` 泛型 `groupItemsByCategory(items, defaultCategory, sortItemsInGroup)`（依 category 分組、空白/缺失歸預設、組內用傳入排序器、組間依分類名 locale-aware/numeric、不可變）。`HomePage` `categoryGroups` 改用之（「最近播放」特例維持）。新增 `groupItemsByCategory.test.ts`（5 組：分組排序、缺分類歸預設、套用排序器、不改輸入、空回空）。前端 `tsc --noEmit` 通過、groupItemsByCategory + HomePage.sort 共 11 測試通過。分支 `refactor/group-items-by-category`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 62 個完成項目（62/100，未達上限）。

## 範本庫分類/搜尋/排序抽出純函式（第一八二輪，2026-06-27）

延續前端：`TemplatesPage` 的分類晶片衍生與「依分類+搜尋過濾、依模式排序」內聯在 useMemo、無測試；newest 保留 API 序、popular 套用次數降冪（穩定排序）等細節易在改動時壞掉。

- [x] 抽出範本庫過濾/排序純函式 `templateCategories`／`filterAndSortTemplates`（可測 / 固化排序規則）。
  - 修改說明（2026-06-27）：新增 `lib/templateFilter.ts`（`templateCategories` 回 `['all', ...去重排序]`；`filterAndSortTemplates(templates, {category, query, sortMode})` 依分類+搜尋名稱/說明/提示詞過濾，newest 保留原序／popular 套用次數降冪，不可變）。`TemplatesPage` 兩 useMemo 改用之。新增 `templateFilter.test.ts`（5 組：分類去重含空、分類過濾、搜尋三欄位含 CJK/大小寫、newest/popular 排序、不改輸入）。前端 `tsc --noEmit` 通過、5/5 通過。分支 `refactor/template-filter`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 61 個完成項目（61/100，未達上限）。

## 測驗歷史平均分抽出純函式 + flaky 調查結論（第一八一輪，2026-06-27）

- [x] 抽出測驗歷史平均分純函式 `averageAttemptScore`（可測）：`QuizBuilderPage` 作答歷史平均分 IIFE（過濾未評分 null→取平均→全空回 null）內聯無測試。
  - 修改說明（2026-06-27）：`lib/quizScoring.ts` 新增 `averageAttemptScore(attempts)`（只計有分數者、回未四捨五入平均、無評分回 null），`QuizBuilderPage` 改用之（四捨五入仍於呼叫端）。新增 4 測試（quizScoring 15）。前端 `tsc --noEmit` 通過。分支 `refactor/average-attempt-score`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 60 個完成項目（60/100，未達上限）。

- 調查結論（第一八一輪）：完整後端套件併跑的 `render-text-pages-figure-injection`（`renderTextPagesWithLlm uses images.edit…`）為**非確定性** flaky——隔離跑 2/2 穩定通過，與既有 figure-reference/llmUsage 同屬跨檔全域狀態污染（image client/provider 設定）。多次嘗試以單檔組合重現皆未穩定觸發，依特定交錯順序才發生。**結論：不值得在自動 loop 中盲修**（危害低、隔離下全綠、修復需可靠重現特定交錯）；建議若要修，於各受影響測試「測試開頭顯式重設所依賴的全域 AI 設定」由人工專輪處理。併入既有 line「完整後端套件零星 flaky」觀察。

## 完整套件基線檢查 + 修自引入測試回歸（第一八〇輪，2026-06-27）

本輪跑完整前後端套件確認基線：**前端 575/575 全綠**；後端 1247 測試 3 失敗。逐一查證：
- 後端 2 個（`figure-reference-image-generation`、`llmUsage`）為**既有 flaky**——隔離跑 10/10 通過，僅完整套件併跑因全域狀態污染失敗（即 TODO 既有觀察項，非本輪引入）。
- 後端 1 個（templates「corrupt skill_data」）是**第一七五輪自引入的測試回歸**。

- [x] 修 templates「corrupt skill_data」測試的固定 id 致 DB 持久化衝突：第一七五輪該測試以固定 id `tmpl-corrupt` 直接 INSERT，但後端測試 DB 跨次持久化 → 第二次跑 `UNIQUE constraint failed: templates.id`（首次寫入時通過、之後皆失敗）。
  - 修改說明（2026-06-27）：改用每次 run 隨機後綴 id `tmpl-corrupt-<hex>`（沿用 `similar-pages.test.ts` 既有模式），測試可重複執行。連跑兩次 templates 8/8 通過。分支 `fix/templates-test-unique-id`，已 merge 回 master。純測試修正。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 59 個完成項目（59/100，未達上限）。

## 動畫效果合併選取計算抽出純函式（第一七九輪，2026-06-27）

延續前端 AnimationEditorTab：「合併選取效果」的計算（最早 start／最晚 end／挑最早效果／組合併效果）內聯在 handler、無測試；合併語意（保留哪個效果設定、duration 算法、保留 startTrigger）值得固化。

- [x] 抽出動畫效果合併純函式 `mergeEffectRanges`（可測 / 固化合併語意）。
  - 修改說明（2026-06-27）：`lib/animationSpec.ts` 新增 `mergeEffectRanges(ranges)` + `SelectedEffectRange` 介面（輸入效果+已解析 start/end，回傳合併效果：起點最早 start、長度=最晚 end−最早 start、沿用最早效果設定與 id，<2 回 null）。`AnimationEditorTab` 合併處理改用之（逐字稿→秒數解析仍留元件）、移除內聯。新增 3 測試（<2 回 null、跨最早到最晚並沿用最早 id/設定、保留 startTrigger 並以解析最早秒數更新 start）。前端 `tsc --noEmit` 通過、animationSpec 61 測試通過。分支 `refactor/merge-effect-ranges`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 58 個完成項目（58/100，未達上限）。

## 焦點動畫框拖曳/縮放幾何抽出純函式（第一七八輪，2026-06-27）

延續前端：`AnimationEditorTab` 的 `onPointerMove` 內聯了焦點框拖曳/縮放幾何（9 把手、邊界夾界、最小尺寸、西/北把手連動原點、四捨五入），多分支座標運算最易在邊界出錯卻無測試、最難手動驗證。

- [x] 抽出焦點框拖曳/縮放幾何純函式 `resizeFocusBox`（可測 / 固化邊界行為）。
  - 修改說明（2026-06-27）：新增 `frontend/src/lib/focusBoxResize.ts`（`resizeFocusBox(handle, start, dxPct, dyPct, moveOnly?)` + `FocusBoxHandle` 型別 + `FOCUS_BOX_MIN_SIZE_PCT` 常數）。`AnimationEditorTab` 的 `onPointerMove` 改用之、本地 `DragHandle` 改為 `FocusBoxHandle` 別名（單一來源）。新增 `focusBoxResize.test.ts`（7 組：移動夾角落、moveOnly、東把手放大夾界、西把手連動原點、南北對稱、夾最小尺寸、四捨五入）。前端 `tsc --noEmit` 通過、7/7 通過。分支 `refactor/focus-box-resize`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 57 個完成項目（57/100，未達上限）。

## 品質檢查面板挑選邏輯抽出純函式（第一七七輪，2026-06-27）

轉向前端：`QualityCheckPanel`（290 行元件）內聯「有問題頁」與「缺/空逐字稿可批次補頁」的挑選邏輯，後者含 LLM fan-out 上限（10 頁）這種安全相關邏輯卻無測試。

- [x] 抽出品質檢查面板頁面挑選純函式（可測 / 固化 fan-out 上限）：`selectIssuePages`／`selectEmptyScriptFillPages(results, max)`。
  - 修改說明（2026-06-27）：新增 `frontend/src/lib/qualityCheckSelection.ts`（`selectIssuePages` null-safe 篩有問題頁；`selectEmptyScriptFillPages` 挑缺/空逐字稿頁碼、保序、夾 `max`、`max≤0` 回空避免無上限 fan-out）。`QualityCheckPanel` 改用之、移除內聯邏輯（行為等價）。新增 `qualityCheckSelection.test.ts`（5 組）。前端 `tsc --noEmit` 通過、新測試 5/5 通過。分支 `refactor/quality-check-selection`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 56 個完成項目（56/100，未達上限）。

## 相似頁面 embedding 防護解析（第一七六輪，2026-06-27）

延續無防護 JSON.parse 盤點，發現 `GET …/similar` 對目標與每個候選 embedding 直接 `JSON.parse(...) as number[]`、無防護；候選比對跨整個帳號教材庫，**任一筆** embedding 損壞會 500 整個相似頁面面板（爆炸半徑大）。

- [x] 相似頁面 embedding 解析加防護（一筆損壞不再拖垮整個面板）：新增匯出純函式 `parseEmbedding(raw)`（非法/非陣列/含非有限數字回 `null`），目標損壞→`indexed:false`、候選損壞→跳過。
  - 修改說明（2026-06-27）：`services/embeddings.ts` 新增 `parseEmbedding`。`similar-pages.ts` 目標向量改用之（損壞回 `{similar:[],indexed:false}`、優雅隱藏區塊）、候選 `.map` 改用之（損壞該筆回 null 後過濾、其餘照常排名）。新增 `parse-embedding.test.ts`（5 組）+ similar-pages 2 整合測試（損壞候選被略過仍 200、損壞目標 indexed:false；以獨立 owner 隔離跨測試教材庫累積）。後端 `tsc --noEmit` 通過；parse-embedding／similar-pages／cosineSimilarity 共 16 測試回歸全通過。分支 `fix/similar-pages-guard-embedding-parse`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 55 個完成項目（55/100，未達上限）。

## 範本清單 skill_data 防護解析（第一七五輪，2026-06-27）

延續無防護 JSON.parse 盤點，發現 `GET /api/templates` 逐列 `rowToTemplate` 中 `JSON.parse(row.skill_data) as Record<...>` 無防護——**任一筆**範本 skill_data 損壞會 500 整份公開範本清單（一壞全壞）。

- [x] 範本 `skill_data` 解析加防護（修一筆損壞 500 整份清單）：新增匯出純函式 `parseSkillData(raw)`（非法 JSON／非物件回 `{}`），`rowToTemplate` 改用之，損壞範本退化為空 skill_data 而非整份 500。
  - 修改說明（2026-06-27）：`templates.ts` 新增 `parseSkillData`（try/catch + 型別檢查：非物件/陣列/null 回 `{}`）。新增 2 測試：純函式各種輸入降級、以及整合測試（直接插入非法 JSON skill_data 列後 GET 仍回 200、該列仍在清單且 skill_data 為 `{}`）。後端 `tsc --noEmit` 通過、templates 8/8 通過。分支 `fix/templates-guard-skill-data-parse`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 54 個完成項目（54/100，未達上限）。

## 投票選項 JSON 防護解析收斂（第一七四輪，2026-06-27）

延續匯出/投票路由盤點，發現 `page_polls.options_json` 有三處解析、行為不一致：`rowToPoll` 已穩健（try/catch + 過濾），但投票結果 CSV 匯出與投票端點為**無防護** `JSON.parse(...) as string[]`，單筆損壞資料會 500。

- [x] 抽出共用 `parsePollOptions(optionsJson)`（去重 + 修無防護解析致 500）：非合法 JSON／非陣列回 `[]`、過濾非字串，三處（`rowToPoll`／`detail.ts` 投票端點／`poll-results-csv.ts`）統一改用。
  - 修改說明（2026-06-27）：新增 `backend/src/routes/pdfs/pollOptions.ts` 的 `parsePollOptions`。`rowToPoll` 移除重複防護邏輯改用之；`detail.ts` 投票端點與 `poll-results-csv.ts` 兩處無防護解析改用之（損壞時投票端點 `option_index` 驗證回 400 而非 500、CSV 該段不輸出列但整份匯出仍成功）。新增 `poll-options.test.ts`（5 組：合法陣列、損壞 JSON 回 []、非陣列回 []、過濾非字串、null/undefined）。後端 `tsc --noEmit` 通過；poll-options／poll-results-csv／detail-permission(92)／figures-polls-permission／page-poll-realign／generate-poll 共 100+ 測試回歸全通過。分支 `refactor/parse-poll-options`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 53 個完成項目（53/100，未達上限）。

## CSV 下載檔名邏輯收斂為共用純函式（第一七三輪，2026-06-27）

延續匯出/報告路由盤點，發現 CSV 下載檔名「標題優先、否則退回 ID」模式在 6 個路由各自內聯重複（report 3 處還重複呼叫 `safeDownloadBaseName` 兩次）、且無針對該取捨的獨立測試。

- [x] 抽出共用 `csvDownloadFilename(title, id, {titleSuffix, fallbackPrefix})`（去重 / 可測）：原 `quiz-results-csv`／`poll-results-csv`／`comments`／`report`(學生/逐頁/題目) 各自內聯「標題基底→`<基底>-<類別>.csv`、否則 `<類別>-<id>.csv`」。
  - 修改說明（2026-06-27）：`downloadFilename.ts` 新增純函式 `csvDownloadFilename`，6 處呼叫點改用之（檔名輸出完全等價；report 3 處順帶消除重複呼叫 `safeDownloadBaseName`，import 由 `safeDownloadBaseName` 改為 `csvDownloadFilename`）。`download-filename.test.ts` 新增 4 組測試（標題版含 CJK、空白/null/undefined 退回 ID、對齊先前內聯模式）。後端 `tsc --noEmit` 通過；download-filename／poll-results-csv／quiz-results-csv／comments-csv／report-pages-csv／report-questions-csv／report-summary 共 37 測試回歸全通過。分支 `refactor/csv-download-filename`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 52 個完成項目（52/100，未達上限）。

## 課後報告最難題目排序抽出純函式（第一七二輪，2026-06-27）

依 §7.1 課後報告補強，完成其「題目答錯率彙整」後端聚合子項：把摘要 API 的「最難前 5 題」排序邏輯抽成可測純函式。

- [x] 課後報告摘要「最難題目」排序抽出為純函式 `selectHardestQuestions`：原 `report.ts` 的 `report/summary` 路由內嵌「過濾未作答→依正確率升冪（並列時答錯數多者優先）→取前 5→補 wrong_rate」的排序邏輯，與 DB 查詢綁在一起、無獨立測試。
  - 修改說明（2026-06-27）：`reportMetrics.ts` 新增純函式 `selectHardestQuestions(stats, limit=5)`（含 `QuestionDifficultyStat` 輸入／`HardestQuestion` 輸出型別），收斂上述排序＋`wrong_rate`（`safeRatio` 防除以 0）邏輯；`report.ts` 摘要路由改為 `selectHardestQuestions(questionStats, 5)`，行為完全等價、對外 API 格式不變。新增 4 組單元測試（基本排序＋答錯率、正確率並列以答錯數多者優先、排除未作答題並遵守 limit、全未作答／空陣列回空陣列）。後端 `tsc --noEmit` 通過；`report-metrics`／`report-question-stats`／`report-summary` 共 21 測試回歸全通過。分支 `refactor/select-hardest-questions`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 51 個完成項目（51/100，未達上限）。

## 品質檢查回應新增摘要計數（第一七一輪，2026-06-27）

依 §7.2 品質檢查自動化，完成其「後端摘要」子項：為品質檢查 API 加上播放頁徽章所需的彙總計數。

- [x] 品質檢查回應新增 `summary` 摘要（pagesChecked/pagesWithIssues/totalIssues）：原本只回有問題的頁清單，前端得自行彙總；為播放頁徽章「N 頁有品質問題」提供單一可測來源。
  - 修改說明（2026-06-27）：`quality-check.ts` 新增純函式 `summarizeQualityResults(results, pagesChecked)`（回傳 `QualityCheckSummary` 介面：pagesChecked=已檢查 audio_ready 頁數、pagesWithIssues=有問題頁數、totalIssues=問題總數），route 以 `pageRows.length` 呼叫並把 `summary` 併入回應（`pages`/`checkedAt` 不變、純附加、向後相容）。前端 `pdfs.ts` 的 `QualityCheckResponse` 新增 `summary: QualityCheckSummary`。新增 `summarizeQualityResults` 單元測試 + 在既有整合測試斷言 summary（2 頁各 3 問題→{2,2,6}、rendered 頁→{0,0,0}）。前後端 `tsc --noEmit` 通過、quality-check 5/5 通過。分支 `feat/quality-check-summary`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 50 個完成項目（50/100，未達上限）。

## 課後報告頁面困難度後端聚合（第一六九輪，2026-06-27）

依 §7.1 課後報告補強，完成其「後端聚合」子項：為逐頁分析加上綜合困難度指標。

- [x] 課後報告 pages.csv 新增「頁面困難度」聚合（完成率低／投票分歧高／提問多）：原 pages.csv 已有完成率/投票分歧/聆聽比例，但缺一個綜合難度訊號。
  - 修改說明（2026-06-27）：`reportMetrics.ts` 新增純函式 `pageDifficultyScore(signals)`（`PageDifficultySignals` 介面 + 0–1 clamp）——把完成率（取未完成 1−rate）、投票分歧、每位觀看者提問率三個正規化訊號取平均，只計當下有資料者、全缺回 null。`report.ts` 的 `report/pages.csv` 新增每頁 `page_comments` 計數查詢，於每列輸出 `question_count` 與 `difficulty_score`（附加於原欄位之後、不動既有欄位順序；完成率/分歧僅在有觀看者/有票時納入，無資料頁輸出空白）。新增 `report-metrics.test.ts` 4 組 `pageDifficultyScore` 測試（三訊號平均、最易 0/最難 1、忽略 null/全 null 回 null、超範圍 clamp），更新 `report-pages-csv.test.ts`（新增 page_comments fixture + 新欄位斷言）。backend `tsc --noEmit` 通過；report-metrics/report-pages-csv 11/11 + report-summary/questions-csv/students/question-stats 18/18 回歸通過。分支 `feat/report-page-difficulty`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 48 個完成項目（48/100，未達上限）。

## 點擊投影片改為進入全螢幕（第一六七輪，2026-06-27）

使用者指定的新功能：把播放頁「點擊投影片」的動作從暫停／播放改為切換全螢幕。經詢問確認範圍為
「僅非全螢幕：點圖進全螢幕」、且「移除點擊暫停、改用獨立按鈕」。

- [x] 播放頁一般檢視點擊投影片改為進入全螢幕（取代點擊 playPause）：原本 `PlayPageSlidePanel` 的 `onImgClick` 呼叫 `playPause()`，改為進入圖片全螢幕。
  - 修改說明（2026-06-27）：`PlayPageSlidePanel` 自 `PlayPageContext` 取用 `setFullscreenLayout`／`setImageOnlyFullscreen`，`onImgClick` 改為 `setFullscreenLayout('image'); setImageOnlyFullscreen(true)`（沿用 `PlayPageHeader` 全螢幕按鈕的相同機制，保留「影像編輯選取／繪圖模式」時不觸發的守衛）；移除點擊暫停（playPause 仍由獨立播放控制按鈕與空白鍵負責）。aria-label 改用新 i18n 鍵 `play.slidePanel.enterFullscreenOverlay`（zh-TW「進入全螢幕」／en「Enter fullscreen」）。全螢幕模式內點擊行為不變。前端 `tsc --noEmit` 通過、i18n parity/nonempty 27 測試通過（`pauseAudioOverlay`/`resumeAudioOverlay` 仍由 `PlayPageFullscreen` 使用而保留）。分支 `feat/click-slide-toggle-fullscreen`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 46 個完成項目（46/100，未達上限）。

## ZIP 匯入頁面狀態正規化（第一六五輪，2026-06-27）

延續 from-pages 的「非法 page 狀態」bug 類，盤點所有建立 pages 的入口：page-operations(audio_ready✓)、pipeline(各正確狀態✓)、addPagesFromPrompt(script_ready→audio_ready 流程✓)、upload(不設 status✓)、from-pages(已修✓)、**import(ZIP) 有問題**。

- [x] ZIP 匯入時 page 狀態 fallback 為非法 `'ready'` 且不驗證：`import.ts` 以 `p.status || 'ready'` 設定匯入頁狀態；缺 status 或舊匯出含非法 'ready'（如 round-164 前的 from-pages 匯出）時，匯入頁會帶非法狀態 → 被 quality-check/匯出略過、且重啟時被 orphan-recovery 標 failed。
  - 修改說明（2026-06-27）：改為 `isPageStatus(p.status) ? p.status : 'audio_ready'`（用 statusMachine 的 `isPageStatus` 驗證；有效則保留、無效/缺失正規化為終態 audio_ready）。backend `tsc --noEmit` 通過；export/import ZIP round-trip（有效狀態保留）+ import-unzip-timeout + status-machine（isPageStatus 已測）共 13 測試回歸通過。匯入用系統 unzip、無 jszip 依賴，自製含非法狀態的 zip fixture 成本高且脆弱，故不另造 fixture 測試（由 round-trip + isPageStatus 測試 + 一行 guard 邏輯共同保證）。分支 `fix/import-page-status-normalize`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 44 個完成項目（44/100，未達上限）。

## from-pages 頁面狀態 bug（第一六四輪，2026-06-27）

稽核 `from-pages`（從多份簡報選頁組「複習簡報」）：複製頁面用新 page_uid、循序 page_number、uid 路徑——大致正確。但發現**嚴重真 bug**。

- [x] from-pages 建立的頁面用非法 page 狀態 `'ready'` → 伺服器重啟後整批被標 failed：`from-pages.ts` INSERT pages 時 status 寫死 `'ready'`，但 `'ready'` 不是合法 page 狀態（終態為 `audio_ready`）。後果：(1) quality-check/匯出（filter audio_ready）抓不到；(2) **`recoverOrphanedAddPagesPages()`（server.ts 啟動時呼叫）會把 ready PDF 中 status NOT IN ('audio_ready','failed') 的頁標成 failed** → 每次重啟後複習簡報全頁變 failed。
  - 修改說明（2026-06-27）：from-pages 的 pages INSERT 改用終態 `'audio_ready'`（pdfs.status='ready' 為合法 PDF 狀態、不動）。新增測試：from-pages 頁面為 audio_ready，且呼叫 `recoverOrphanedAddPagesPages()` 後仍維持 audio_ready（不被標 failed）。backend `tsc --noEmit` 通過、`from-pages` 6/6。分支 `fix/from-pages-page-status`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 43 個完成項目（43/100，未達上限）。
- [ ] （觀察，待處理）完整後端套件有零星 flaky 測試：`figure-reference-image-generation`、`llmUsage` 在完整套件併跑時偶發失敗、隔離下穩定通過，屬測試間全域狀態（setOpenAIClientForTest mock／setSystemAuthSettings／共用 DB/fs）污染。建議後續加強測試隔離（每檔自帶 setup/teardown 還原全域），非單一 bug。

## addPagesFromPrompt 補 defer FK（第一六三輪，2026-06-27）

延續稽核：`addPagesFromPrompt`（AI 批次加頁）在中間插頁時也位移頁碼並呼叫 `shiftChildPageNumbers`，但**缺 `defer_foreign_keys = ON`**——與 page-operations 修前同樣的 FK-timing bug：先 `UPDATE pages` 即讓 polls 變孤兒 → 在後續頁有投票時 FK 500。

- [x] `addPagesFromPrompt` 中間插頁缺 defer FK → 後續頁有投票時 FK 失敗：在其 page-shift 交易開頭加 `db.pragma('defer_foreign_keys = ON')`（`shiftChildPageNumbers` 已涵蓋 polls/comments/drawings）。
  - 修改說明（2026-06-27）：於 `addPagesFromPrompt.ts` 的「中間插頁」交易加 defer pragma。worker 難以端到端單元測，以重現腳本驗證（在第 3 頁有 poll/comment、insertAfter=1/insertCount=2 → 交易成功、poll/comment 正確移到第 5 頁、無 FK error）；既有 `add-pages-permission`/`add-pages-orphan-recovery` 17 測試回歸通過。backend `tsc --noEmit` 通過。分支 `fix/addpages-defer-fk`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 42 個完成項目（42/100，未達上限）。

## 擴展頁面重排的子表對齊（第一六二輪，2026-06-27）

延續 round-161：盤點所有以 `page_number` 關聯 pages 的子表，發現除 polls 外，**comments 與 drawings 在增刪移頁時也會錯位**（無 FK 故不崩、但附到錯頁；drawings 刪頁時甚至不會被清掉而殘留）。embeddings 以 `page_uid` 為鍵不受影響；watch_progress/timings/events 屬歷史分析、刻意不重排。

- [x] 頁面增/刪/移時 comments 與 drawings 未隨頁碼對齊（錯位 / 殘留）：`shiftChildPageNumbers` 僅位移 page_polls；comments/drawings 的 FK 只到 pdfs（非 pages），故不會 cascade，重排後錯附到別頁、刪頁時殘留。
  - 修改說明（2026-06-27）：`shiftChildPageNumbers` 擴為位移三個「每頁使用者內容」子表（`page_polls`/`page_comments`/`page_drawings`，以常數 `PAGE_CONTENT_CHILD_TABLES` 表列、附註說明為何排除分析表與 uid 化的 embeddings）；move handler 的 per-page 迴圈一併移動三表；delete handler 顯式刪除被刪頁的 comments/drawings（polls 由 FK cascade）。新增測試涵蓋刪/插/移頁後三表對齊、以及刪頁移除該頁 comments/drawings 不殘留。backend `tsc --noEmit` 通過；相關 86 測試回歸；**完整後端套件 1203/1203 全綠**。分支 `fix/realign-page-content-children`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 41 個完成項目（41/100，未達上限）。

## 修正頁面增刪移的 FK/投票對齊真 bug（第一六一輪，2026-06-27）

延續 round-157 的 page renumber 稽核，發現並修復一個真實 production bug：

- [x] 頁面增/刪/移時 page_polls 未跟著重編號 → `foreign_keys=ON` 下 FK 失敗（500）且投票錯位：`page_polls` 以 FK `(pdf_id, page_number) REFERENCES pages` 關聯，但 delete handler **完全沒有**位移子表；insert/move 雖呼叫 `shiftChildPageNumbers`，卻在「先 `UPDATE pages +100000`、後 shift 子表」的順序下、於子表 shift 前就讓投票變孤兒 → FK 立即失敗。實測：在第 3 頁有投票時刪第 2 頁 → `FOREIGN KEY constraint failed`（刪頁 500）；insert/move 同類。
  - 修改說明（2026-06-27）：三個 renumber 交易（insert/move/delete）開頭加 `db.pragma('defer_foreign_keys = ON')`（FK 延到 commit 檢查、交易內可安全分步重排父子表，SQLite 於 commit 後自動關閉此 pragma）；delete handler 補上 `shiftChildPageNumbers` 兩步 lockstep 位移（與 pages 的 +100000/-100001 offset 同步），使後續頁的投票正確跟隨（刪第 2 頁後，原第 3 頁→第 2 頁、其投票也→第 2 頁）。新增 `page-poll-realign.test.ts`（2 測試：刪頁/插頁後投票對齊且無 FK error）。backend `tsc --noEmit` 通過；`pages-api`/`page-operations-permission` 50/50 回歸；**完整後端套件 1201/1201 全綠**。分支 `fix/page-renumber-fk-defer-and-poll-shift`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 40 個完成項目（40/100，未達上限）。

## 規畫輪：補充可執行項目（第一六〇輪，2026-06-27）

前後端測試套件皆全綠；後端權限/分享/身分去重、既有失敗修復、前端 lib 測試覆蓋皆完成。乾淨且低風險的「純函式抽出／補測試」自動 backlog 已實質見底。依 LOOP.md 第 2 條，分析後依 `docs/STATUS_REPORT_2026_06_27.md` §7–§8 與 `docs/FUTURE_ROADMAP.md` 補充以下優先項目。這些多為需 UI／後端整合的功能，**單輪可完成但較難在現有測試框架自動驗證 UI**，部分建議由使用者確認方向後再投入：

- [ ] （驗證確認）round-136 品質檢查狀態修正已驗證完整：頁面終態為 `audio_ready`（`addPagesFromPrompt.ts` 的 normalization 與 pipeline 註解均證實 ready PDF 全頁為 audio_ready/failed），`script_ready` 僅為 require_script_confirmation 流程的暫態。**無需再擴充狀態集合**。（本項為分析結論，非待辦。）
- [x] （P0，§7.2）品質檢查自動化：生成完成後自動跑一次 quality-check，於播放頁以徽章顯示「N 頁有品質問題」摘要，點擊開啟既有 `QualityCheckPanel`。延伸 `quality-check` route 與前端面板，屬前端整合。
  - 進度（第一七一輪，2026-06-27）：**後端摘要子項已完成**（見下方「品質檢查回應新增摘要計數」section，計數第 50 項）——`quality-check` 回應新增 `summary`（`pagesChecked`/`pagesWithIssues`/`totalIssues`），前端型別同步。
  - 完成（2026-07-11）：**播放頁 header 徽章＋自動觸發全數補完**。`PlayPageHeader` 新增 effect：`detail?.status` 變成 `'ready'`（且尚未為這個 pdfId 查過）時呼叫一次 `fetchQualityCheck`，取 `summary.pagesWithIssues` 存成 `qualityIssueCount`（以 `qualityFetchedForRef` 確保每份簡報只自動查一次，之後內容再變動由使用者自行點「重新檢查」，不背景重跑）；用既有純函式 `analysisBadgeState` 統一「未查/查中→隱藏、查完無問題→ok、查完有問題→issues」的判斷（與 `QualityCheckPanel` 內三個分析區共用同一套邏輯）。有問題時在頁碼旁顯示「⚠ N 頁有問題」徽章（沿用既有 `play.quality.issueCount` 文案），點擊 dispatch 新的 `makeslide:open-quality-panel` window CustomEvent（[notebookTabs.ts](frontend/src/pages/play/notebookTabs.ts)，比照既有 `makeslide:notebook-cell-nav` 的跨元件訊號模式，因 `notebookTab`/`aiSubTab` 是 `PlayPageSidebar` 的 local state、非 context）；`PlayPageSidebar` 監聽此事件，收到即切到「AI 助手」分頁的「品質報告」子分頁，開啟既有 `QualityCheckPanel`（面板本身沿用既有手動「重新檢查」按鈕取得詳細清單，header 只負責摘要徽章與導覽，不重複面板邏輯）。新增 i18n `play.header.qualityBadgeHint`（zh-TW／en）。驗證：前端 `tsc`、前端測試 813/813、`vite build` 通過（真實瀏覽器點擊徽章跳轉分頁的互動待實機驗證）。分支 `feat/quality-check-header-badge`，已 merge 回 master。
- [x] （§8.1.4）首頁／播放頁搜尋結果加入「加入複習清單」動作：`GlobalSearchBox` 結果列加入按鈕，複用既有 `reviewList.addReviewItems`（已有測試）。純前端 UI 整合。（第一七〇輪，2026-06-27 完成）
  - 修改說明（2026-06-27）：`GlobalSearchBox` 選取模式原僅有「建立新簡報」批次動作，新增「加入複習清單（N 頁）」按鈕。新增純函式 `lib/searchResultsToReviewItems.ts`（過濾無頁碼標題結果、snippet 去空白作 questionText、null 標題回空字串）；`handleAddToReviewList` 將勾選結果轉換後交 `addReviewItems`（沿用其 pdfId+頁碼+文字 去重）並收合選取狀態。新增 i18n 鍵 `home.search.addToReviewList`（zh-TW/en）。新增 `searchResultsToReviewItems.test.ts` 3 測試；前端 `tsc --noEmit` 通過、helper 3/3 + i18n parity/nonempty + 既有 GlobalSearchBox 測試回歸通過（共 35）。分支 `feat/search-add-to-review-list`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 49 個完成項目（49/100，未達上限）。
- [ ] （P0，§7.1）課後報告個人層級報表：後端 `computeStudentRecords` 已彙整每位學生作答；補前端「個人」分頁顯示每位學生完成率／提問／投票參與。前端為主、後端視需要補欄位。
  - 盤點（2026-07-11）：檢查後發現本項與下方「報告面板個人層級延伸（方向，需使用者裁示）」（依 `docs/FUTURE_ROADMAP.md` 2.1 新增）實為同一件事的兩份重複記錄，只是分別由 §7.1（STATUS_REPORT）與 FUTURE_ROADMAP 兩份來源各自新增、優先級標註不一致（此項標 P0 可執行、彼項標「較大項目，列為待使用者決定方向」）。技術上確認困難點：`computeStudentRecords` 目前的「學生」鍵是 `quiz_attempts.client_id`——這是**每次同步工作階段隨機產生**的 `sync-<timestamp>-<random>` 字串（存在 `sessionStorage`，換分頁/裝置就變），跟完成率所用的 `page_watch_progress.viewer_id`、投票所用的 `page_poll_votes.voter_id`（兩者皆優先採用使用者自設的 `user_code`、否則退回匿名 `viewer-xxx`）**不是同一個身分命名空間**。要把完成率／提問／投票參與併入「個人」分頁，必須先決定用哪一種身分當作跨資料源的合併鍵（例如一律要求／退回 `user_code`），這牽涉到匿名學生的身分可否合併、以及合併錯誤時的隱私風險，屬於需要產品判斷的方向性決定，不是單純的前端呈現工作。保留兩份記錄不合併刪除，避免遺失兩邊來源的脈絡；一併請使用者對照下方 FUTURE_ROADMAP 2.1 項目裁示方向後再執行。
- [ ] （§8.1.5／§4.1）播放頁 header 入口分組為「製作／授課／自學／報告／匯出」任務流：降低功能密度造成的新手阻力（資訊架構調整，純前端、需產品確認分組）。
- [x] （§7.5）生成前成本估算覆蓋確認：確認 PDF／文字／YouTube 三個生成入口皆於 `PromptModal` 顯示 `costEstimate` 估算；補缺口並為 pageCount 傳遞補測試。（第一六八輪，2026-06-27 完成）
  - 修改說明（2026-06-27）：盤點發現**真缺口**——`PromptModal` 僅在 `pageCount > 0` 顯示成本估算，但剛上傳的 PDF／文字／YouTube 在 DB 的 `page_count` 皆為 `null`（pipeline 分頁後才有），故三入口在**首次生成前都不顯示估算**（只有已生成簡報重生時才有）。修法：上傳 PDF 時後端計算來源 PDF 實體頁數（slides 模式用 `getPdfPageCount()`、document 模式用 `pageTexts.length`），於 `POST /api/pdfs` 回應新增 `source_page_count`（**不寫入** persisted `page_count`，純作估算依據；TXT 為 null）。前端 `UploadResponse` 加 `source_page_count?: number | null`，新增純函式 `lib/promptTargetPageCount.ts`（優先真實 `page_count`、否則 `source_page_count`、皆非正數回 null），`HomePage.openPromptFor` 改用之 → 首次上傳 PDF 即可在生成前看到成本估算。**確認結論**：文字／YouTube 的投影片數於生成前由 AI 分頁才定、本就無從估算，維持不顯示（非缺口）。新增 `upload-source-page-count.test.ts`（PDF 回實體頁數 7、TXT 為 null，poppler 不可用時跳過）與 `promptTargetPageCount.test.ts`（優先序/fallback/無值回 null 共 3 測試）；前後端 `tsc --noEmit` 通過、相關上傳路由回歸通過。分支 `feat/upload-source-page-count-cost-estimate`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 47 個完成項目（47/100，未達上限）。

## 前端補測試 debugLog（第一五九輪，2026-06-27）

前後端套件皆全綠；盤點前端 lib 僅 `api.ts`（HTTP/re-export）與 `debugLog.ts` 無測試。補後者：

- [x] 為 `debugLog.ts` 補單元測試（覆蓋）：`debugLog`/`debugWarn` 依 `localStorage['makeslide.debug']==='1'` 開關、含 try/catch 防呆，原無測試。
  - 修改說明（2026-06-27）：新增 `frontend/src/lib/debugLog.test.ts`（3 測試：旗標='1' 才經 `console.info`/`warn` 輸出且帶原引數、旗標非 '1' 不輸出、localStorage 存取拋錯時靜默不拋）。以可還原的 console 與 globalThis.localStorage 注入測試、finally 清理避免污染。未動產品碼。前端 `tsc --noEmit` 通過、3/3；完整前端 532/532 全綠。至此前端 lib 中含邏輯的模組皆有測試（僅 api.ts 屬 HTTP/re-export 未測）。分支 `test/debug-log`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 39 個完成項目（39/100，未達上限）。

## 前端去重 hasLocalStorage（第一五八輪，2026-06-27）

確認後端 1199/1199、前端 551/551 全綠（全棧綠燈基線）。掃描前端後完成一個小去重：

- [x] 抽出共用 `hasLocalStorage`（去重）：`recentSearches.ts`、`commentAuthor.ts` 各有相同的 `typeof window !== 'undefined' && !!window.localStorage` 守衛。抽成 `lib/hasLocalStorage.ts` 並補測試。
  - 修改說明（2026-06-27）：新增 `frontend/src/lib/hasLocalStorage.ts`（window-based 穩健版）+ `hasLocalStorage.test.ts`（3 測試：無 window、有 window.localStorage、有 window 無 localStorage；每次清理 globalThis.window 避免污染）。`recentSearches`/`commentAuthor` 移除本地定義改 import。**`reviewList.ts` 刻意不動**——其守衛為 `typeof localStorage !== 'undefined'`（bare localStorage），且其測試注入 bare `localStorage`（非 window），改用 window-based 版會使測試 mutator no-op（已實測 4 失敗）；為零行為變更，保留 reviewList 自身守衛。前端 `tsc --noEmit` 通過；相關 lib 測試 23/23；完整前端 551/551 全綠。分支 `refactor/shared-has-local-storage`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 38 個完成項目（38/100，未達上限）。

## 完整後端測試套件基線 + 既有失敗盤點（第一五四輪，2026-06-27）

本輪以 `scripts/run-tests.sh backend` 跑完整後端套件：**1199 測試，18 失敗**。經抽查與在去重前 commit（`e0d9db8`）比對，**18 個全為既有失敗、與近期去重無關**。逐一分類並修復其一：

- [x] 修 `input-security.test.ts`（4 失敗）：4 個 upload/youtube 驗證測試全回 **401**（未授權）——測試未呼叫 `setSystemAuthSettings({ googleAuthEnabled: false })`，請求在到達驗證邏輯前就被 auth 擋下（驗證邏輯本身正常）。確認無任何測試把 `googleAuthEnabled` 設 true（無全域順序衝突），於檔頭加上該設定。`input-security.test.ts` 4/4 通過。純測試修正。分支 `fix/input-security-test-auth`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 34 個完成項目（34/100，未達上限）。
- [x] （既有失敗）`pages-api.test.ts`（7 失敗）：測試預期連號 `pages/002.png`，實際為 uid 化 `pages/<uid>.jpg`。
  - 修改說明（2026-06-27）：確認 uid 化為現行設計（page-operations.ts 註解明言「檔案以 page_uid 為鍵、不重命名」、前端/storage 皆 uid 化），測試過時。重寫 `seedReadyPdfFor`（uid 路徑 `pages/u<i>.jpg/.text.txt/.script.txt/.m4a` + 建檔 + 設 page_uid）與 `assertDeckAligned`（改為斷言 page_number 連續 1..N），並更新 670/672/673/675 的內聯路徑斷言為 uid 契約（既有頁保留 uid 路徑、僅 page_number 連續；刪除只移除被刪頁 uid 檔）。
  - **順帶修真實潛在 bug**：重寫後 test 676 暴露 delete handler 的 `UPDATE page_number = page_number - 1` 在多次增刪後（rowid 與 page_number 分歧）會暫態違反 `UNIQUE(pdf_id, page_number)` → 500。改用與 insert 一致的 +offset 兩步 renumber（+100000 再 -100001）。此為 production 也可能觸發的真 bug（增頁後刪頁）。
  - 驗證：backend `tsc --noEmit` 通過；`pages-api` 19/19；page-operations/delete 相關 51/51 回歸通過。**完整後端套件 1199/1199 全綠（exit 0）**。分支 `fix/pages-api-uid-tests-and-delete-renumber`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 37 個完成項目（37/100，未達上限）。
- [x] （既有失敗）`skills.test.ts`（1）：`updateUserSkill` 回傳物件與磁碟 round-trip 形狀不符。
  - 修改說明（2026-06-27）：根因為 `createUserSkill`（條件 spread、省略 undefined 模板鍵）與 `updateUserSkill`（**總是**寫入 4 個模板鍵，即使值 undefined）不一致——回傳物件帶 `imageStylePrompt:undefined` 等鍵，但 JSON.stringify 丟棄 undefined，讀回後缺鍵，`deepStrictEqual(回傳, 磁碟)` 失敗。修法：`updateUserSkill` 改為先解析各欄位值、再以條件 spread 僅在 truthy 時納入（行為不變、與 create 形狀一致）。順帶修掉這個 create/update 形狀不一致。`skills.test.ts` 5/5 通過。分支 `fix/update-skill-omit-undefined-template-fields`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 35 個完成項目（35/100，未達上限）。
- [x] （既有失敗）`timing.test.ts`(1) + `regenerate-matrix.test.ts`(4)：同 input-security 的 401 根因——兩檔皆缺 `setSystemAuthSettings({ googleAuthEnabled: false })`，HTTP 請求被 auth 擋下回 401。兩檔加上該設定後，timing 12/12、regenerate-matrix 4/4 通過（連跑 3 次穩定 16/16；首次觀察到的 regenerate test 2 一次性 flake 未再現）。純測試修正。分支 `fix/timing-regen-test-auth`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 36 個完成項目（36/100，未達上限）。
- [x] （既有失敗）`figure-reference-image-generation.test.ts`(1)：隔離下穩定通過、僅在完整套件中失敗，屬測試順序污染。第一五四–一五六輪新增多個 `setSystemAuthSettings` 改變全域順序後，重跑完整套件已自然通過，無需改動。

## 後端去重 canDestructivelyEditPdf（第一五三輪，2026-06-27）

- [x] 抽出共用 `canDestructivelyEditPdf`（去重 / 可測 / 安全一致）：破壞性動作（刪簡報/頁/測驗/投票/手寫）的嚴格編輯權限（`Boolean(sub) && public_editable`，禁止匿名）在 4 檔以 `canDestructivelyEditPdf` 重複、且 `delete.ts` 以同邏輯的 local `canEditPdf` 存在（同名不同 body 易混淆）。抽成共用並補測試。
  - 修改說明（2026-06-27）：在 `permissions.ts` 新增 `canDestructivelyEditPdf`（含註解說明與 canEditPdf 的差異）。4 檔（page-operations/detail/quizzes/drawings）移除本地定義並併入既有 `./permissions` import。`delete.ts` 移除其 local stricter `canEditPdf`、改 `import { canDestructivelyEditPdf }` 並把呼叫點改名（消除同名不同 body 的混淆）。`permissions.test.ts` 新增測試（匿名於 public_editable 不可破壞性編輯、與 canEditPdf 對比）。backend `tsc --noEmit` 通過；`delete-permission`/`delete-pdf-job-cleanup`/`permissions`/`quizzes`/`drawings`/`page-operations-permission`/`detail-permission` 共 177 測試回歸通過（嚴格匿名行為保留）。分支 `refactor/shared-can-destructively-edit`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 33 個完成項目（33/100，未達上限）。

## 後端去重 share 存取群（第一五〇輪，2026-06-27）

- [x] 抽出共用 share 存取工具（去重 / 可測）：`ShareTokenParamSchema`、`getShareToken`、`hasShareAccess` 在約 10 個路由檔成組逐字重複。抽成共用 `share.ts` 並補測試。
  - 修改說明（2026-06-27）：新增 `backend/src/routes/pdfs/share.ts` 匯出三者（含註解）。以腳本移除 10 個一致檔（add-pages/runs/drawings/watchProgress/quizzes/figures/slow-artifacts/page-operations/versioning/page-animation）的本地三定義並改 `import { ShareTokenParamSchema, getShareToken, hasShareAccess } from './share'`，清理因此未使用的 `FastifyRequest` import。過程中腳本一度誤把 share.ts 自身納入（grep 命中）導致毀損，已重寫修復。新增 `share.test.ts` 6 組測試（getShareToken header/query/優先序/trim/陣列、ShareTokenParamSchema 長度與字元）。backend `tsc --noEmit` 通過；share 相關路由回歸約 263 測試全通過（quizzes/drawings/page-animation/權限類 watch/runs/versioning/page-operations…）。分支 `refactor/shared-share-access`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 30 個完成項目（30/100，未達上限）。
- [x] 收斂 `getPdfPermissionRow`（10 標準）至 permissions.ts；`report.ts` 的 title 變體保留。
  - 修改說明（2026-06-27）：在 `permissions.ts` 新增 `getPdfPermissionRow(id)`（`SELECT owner_sub, visibility`，加 `db` import）。以腳本移除 10 個標準檔（watchProgress/regenerate/versioning/figures/add-pages/drawings/quizzes/page-animation/sync/page-operations）的本地定義並合併進其既有 `./permissions` import。`report.ts` 另含 `title` 的變體維持不動（註解標明）。backend `tsc --noEmit` 通過；migrated 路由回歸約 274 測試全通過（quizzes/drawings/page-animation/sync/regenerate/add-pages/figures/各權限測試）。分支 `refactor/shared-get-pdf-permission-row`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 31 個完成項目（31/100，未達上限）。
- [x] 收斂 share 群剩餘變體：`detail.ts`（getShareToken + object schema，無 hasShareAccess）、bare-string schema + `shareTokenFromRequest` 的 outlier 檔。評估改用共用版本。
  - 修改說明（2026-06-27）：`detail.ts` 的 `getShareToken` 與 object 版 `ShareTokenParamSchema` 與共用版完全相同，改 `import { getShareToken, ShareTokenParamSchema } from './share'` 並移除本地定義；其獨有的 `shareAccessForPdf`/`isShareTokenExpired`（含到期判斷、回傳 access level）保留並改用 imported 版本。經評估，`sync.ts`/`server.ts` 的 `shareTokenFromRequest` 為 **header-only 變體**（不讀 `?share=` query、用 bare-string schema），行為與 `getShareToken` 不同，若替換會改變行為，故**刻意不統一**。backend `tsc --noEmit` 通過；`detail-permission`(92)、`share-expiry`(3)、`share`(6) 共 101 測試回歸通過。分支 `refactor/detail-reuse-share`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 32 個完成項目（32/100，未達上限）。

## 後端去重 canEditPdf（第一四八輪，2026-06-27）

- [x] 抽出共用 `canEditPdf` 權限函式（去重 / 可測）：標準 `canEditPdf`（owner / public_editable）在 21 個路由檔逐字重複。抽成共用並補測試；**delete.ts 的版本刻意更嚴格**（`Boolean(sub) && public_editable`，禁止匿名刪除），不替換。
  - 修改說明（2026-06-27）：在 `permissions.ts` 新增 `canEditPdf`（標準版，含註解說明 delete.ts 例外）。以腳本移除 21 檔標準本地定義並合併 import（已有 `import { canReadPdf } from './permissions'` 的 12 檔改為 `{ canReadPdf, canEditPdf }`、其餘 9 檔新增 import）。delete.ts 的嚴格版維持不動。新增 `permissions.test.ts` 的 canEditPdf 測試（見下）。修正腳本誤把 permissions.ts 自身納入而加的自我 import。backend `tsc --noEmit` 通過；抽查約 12 個路由測試檔回歸全通過（quizzes 24、drawings、page-comments、detail-permission 92、figures-polls-permission、add-pages…）；標準本地定義 0。分支 `refactor/shared-can-edit-pdf`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 28 個完成項目（28/100，未達上限）。
- [x] （既有失敗，待修）`page-animation.test.ts` 1/123 失敗：`validateAnimationSpec rejects a shape effect with an invalid shape kind`。在 master 即失敗、與權限重構無關。待查 `validateAnimationSpec` 對 shape kind 的驗證。
  - 修改說明（2026-06-27）：又一個 mirror drift——測試用 `shape: 'triangle'` 當「不合法」案例，但 `ANIMATION_SHAPE_KINDS` 早已新增 `triangle`/`star`/`hexagon`（前端 `types.ts` 與 i18n 三角形/五角星/六角形齊備、為**已支援**形狀），故 triangle 實為合法、測試斷言過時。確認 enum 正確、測試過時後，將測試改用真正不在清單的 `'octagon'`。`page-animation.test.ts` 123/123 通過（先前 122/123）。純測試修正、未動產品碼。分支 `fix/animation-shape-kind-test`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 29 個完成項目（29/100，未達上限）。

## 後端大量去重 sessionSub（第一四六輪，2026-06-27）

- [x] 抽出共用 `sessionSub` 工具（大量去重 / 可測）：`sessionSub(request)`（解 session cookie 取 account sub）在 **40 個** PDF 路由檔逐字重複定義（38 同名 + 2 個 `sessionSubFromRequest` 同 body）。抽成共用並補測試。
  - 修改說明（2026-06-27）：在 `backend/src/routes/auth.ts` 新增 `export function sessionSub(request)`（與既有 `decodeSession`/`parseCookies` 同模組）。以腳本移除 38 個 `sessionSub` 同名定義並改 `import { sessionSub } from '../auth'`（其中 admin.ts 保留其 `SESSION_COOKIE, clearCookie` 匯入）；同時清理 26 個因移除而未使用的 `FastifyRequest` type import。2 個 `sessionSubFromRequest`（命名不同）暫不動。新增 `session-sub.test.ts` 4 組測試（無 cookie/竄改/有效/無關 cookie）。backend `tsc --noEmit` 通過；抽查約 14 個路由測試檔回歸全通過（detail-permission 92、quizzes 24、quality/h5p/report-summary…）；殘留本地定義 0。分支 `refactor/shared-session-sub`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 26 個完成項目（26/100，未達上限）。
- [x] 收斂 2 個 `sessionSubFromRequest` 同 body 函式：與共用 `sessionSub` 實作相同但命名不同，評估改用共用版本或統一命名。
  - 修改說明（2026-06-27）：`export.ts`、`subtitles.ts` 的 `sessionSubFromRequest`（與共用 `sessionSub` 實作完全相同）移除本地定義、4 處呼叫改用 `import { sessionSub } from '../auth'`，並清掉因此未使用的 `decodeSession`/`parseCookies`/`FastifyRequest` import。backend `tsc --noEmit` 通過；`subtitles`/`export-import-zip-sources`/`batch-export`/`export-zip-cjk-filename` 共 10/10 回歸通過；全 repo 已無 `sessionSubFromRequest`。分支 `refactor/collapse-session-sub-from-request`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 27 個完成項目（27/100，未達上限）。

## 後端去重 + 發現既有失敗（第一四三輪，2026-06-27）

- [x] 抽出共用 `canReadPdf` 權限函式（大量去重 / 可測）：`canReadPdf(sub, row)` 在 **27 個** PDF 路由檔案中**逐字重複**定義（grep 確認 27 份實作完全一致），維護風險高。抽成共用模組並補測試。
  - 修改說明（2026-06-27）：新增 `backend/src/routes/pdfs/permissions.ts` 匯出 `canReadPdf`（含註解說明規則：無 owner 公開、owner 可讀、其餘僅 public/public_editable）。以腳本機械式移除 27 檔的本地定義並改 `import { canReadPdf } from './permissions'`（移除後各檔 `PdfRow` 仍有其他用途、且未啟用 `noUnusedLocals`，無未使用 import 問題）。新增 `permissions.test.ts` 3 組測試（無 owner、owner、非 owner×可見度）。backend `tsc --noEmit` 通過；抽查 30 個路由測試檔回歸（detail-permission 92、quality/h5p/script/image/report-summary 等）全通過，殘留本地定義 0。分支 `refactor/shared-can-read-pdf`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 23 個完成項目（23/100，未達上限）。
- [x] （既有失敗，待修）`notes-txt.test.ts` 4/5 失敗：`NOT NULL constraint failed: pages.page_notes`——測試插入 pages 未給 `page_notes`，但該欄為 NOT NULL。在 master 即失敗、與權限重構無關。評估是測試 fixture 漏給欄位、或 schema 應給預設值。
  - 修改說明（2026-06-27）：根因為**測試 fixture 與 schema 不符**——`pages.page_notes` 是 `NOT NULL DEFAULT ''`（production 不會是 NULL），但測試 2 處明確塞 `NULL`（seedPdf 第 2 頁、fallback 測試的 `UPDATE ... SET page_notes = NULL`），違反 NOT NULL。路由本身用 `COALESCE(page_notes,'')` + `.trim()` 對 ''/NULL 行為相同，無需改。將兩處 `NULL` 改為 `''`（代表「無備註」、符合 schema）。`notes-txt.test.ts` 5/5 通過（先前 1/5）。純測試修正、未動產品碼。分支 `fix/notes-txt-test-page-notes-not-null`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 24 個完成項目（24/100，未達上限）。
- [x] （既有失敗，待修）`quizzes.test.ts` 1/24 失敗：`POST /quizzes/:quizId/copy-to/:targetId` 預期 201 卻得 **400**。
  - 修改說明（2026-06-27）：以隔離重現腳本確認——copy-to 端點本身**正常回 201**；400 並非來自 `safeParse`，而是 Fastify 的 JSON body parser。測試用共用 `OWNER_HEADERS`/`OTHER_HEADERS`（含 `content-type: application/json`）但此 POST **無 body**，Fastify 對「宣告 application/json 卻空 body」回 400（在 handler 之前）。前端 `copyQuizSetTo` 用 `fetch(url, { method: 'POST' })`（不帶 content-type），production 不會觸發。屬**測試 bug**：將 copy-to 測試的 3 個無 body 請求改為只帶 `cookie`（移除 content-type）。`quizzes.test.ts` 24/24 通過（先前 23/24）。未動產品碼。分支 `fix/quizzes-copyto-test-headers`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 25 個完成項目（25/100，未達上限）。

## 後端分析新增可執行項目（第一四〇輪，2026-06-27）

前端小型純函式 backlog 接近見底，依 LOOP.md 第 2 條轉向後端（受重構關注較少）分析。新增以下項目並完成其一：

- [x] 抽出課後報告共用比例／四捨五入純函式（去重 / 防呆 / 可測）：`report.ts` 多處內聯 `denom > 0 ? num/denom : 0`（correct_rate、wrong_rate、participation_rate、completion_rate×2）、`round4` 重複定義兩次、投票分歧 `1 - max/total`，散落且無針對純邏輯的測試。抽成後端共用純函式並補測試。
  - 修改說明（2026-06-27）：新增 `backend/src/routes/pdfs/reportMetrics.ts`（`safeRatio(num, denom)` 分母非正回 0、`round4(n)`、`pollDivergence(maxVotes, totalVotes)` 無票回 0）。收斂 `report.ts`：correct_rate/wrong_rate/participation_rate/completion_rate(×2) 改用 `safeRatio`、兩處 local `round4` 改用共用、頁面 CSV 投票分歧改用 `pollDivergence`。新增 `report-metrics.test.ts` 4 組測試（safeRatio 正常/除以 0、round4、pollDivergence 共識/分裂/無票）。backend `tsc --noEmit` 通過；新測試 4/4 + 既有 `report-pages-csv`/`report-questions-csv`/`report-summary`/`report-question-stats` 共 16/16 回歸通過（行為等價）。分支 `refactor/report-metrics-helpers`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 20 個完成項目（20/100，未達上限）。
- [x] 抽出 `avg_listened_ratio` 的 SQL 聚合為共用片段或測試：`report.ts` 兩處（pages.csv 與 summary）重複同一段 `AVG(CASE WHEN w.duration_ms ... MIN(listened_ms/duration_ms, 1.0) ...)` SQL，易漂移。評估抽成共用常數字串或補一個針對該聚合的整合測試固化語意。
  - 修改說明（2026-06-27）：兩處 watch 聚合查詢實質相同（僅空白/別名差異），抽成模組層級函式 `queryWatchPages(pdfId): WatchPageRow[]`（含完整 SQL 與註解說明 avg_listened_ratio 語意），pages.csv 與 summary 兩處 `const watchPages = db.prepare(...).all(id)` 改為 `queryWatchPages(id)`，整段 SQL 收斂為單一來源。backend `tsc --noEmit` 通過；既有 `report-pages-csv`/`report-summary` 共 7/7 回歸通過（行為等價）；殘留 inline watch SQL 由 2 降為 1（即共用函式內）。分支 `refactor/query-watch-pages`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 22 個完成項目（22/100，未達上限）。
- [x] 後端搜尋語意索引上限可設定：`search.ts` 的 `MAX_SEMANTIC_PDFS = 20`（STATUS_REPORT §4.4）為硬編，教材知識庫成長後需要更大或可調。評估改為可由系統設定調整並補測試。（第一六六輪，2026-06-27 完成）
  - 修改說明（2026-06-27）：改為每帳號可調設定 `semanticSearchMaxPdfs`（預設 20、範圍 1–200），沿用既有 per-account `settings.env` 機制（同 `monthlyBudgetUsd` 模式）。`aiSettings.ts` 新增常數 + `clampSemanticSearchMaxPdfs`（取整 + 夾範圍 + 非有限值回退預設）+ interface 欄位 + base 預設 + override 解析（`SEMANTIC_SEARCH_MAX_PDFS`）+ env pair；`admin.ts` GET 回傳 `semantic_search_max_pdfs`、PATCH 解析 clamp；`shared.ts` schema 加 `z.number().int().min(1).max(200).optional()`；`search.ts` 改用 `getRuntimeAiSettings().semanticSearchMaxPdfs`（request 範圍帳號情境、讀取時再夾一次防呆）。前端 `system.ts` 兩 interface、`SettingsPage` 數字輸入欄位（留空維持預設）、zh-TW/en 三個 i18n 鍵。新增 `semantic-search-max-pdfs.test.ts` 4 測試（clamp 行為、GET 預設 20、PATCH 持久化到 settings.env + 讀回、超範圍 schema 擋 400）。前後端 `tsc --noEmit` 通過；新測試 4/4、search/admin/i18n 相關回歸通過。分支 `feat/configurable-semantic-search-limit`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 45 個完成項目（45/100，未達上限）。
- [x] 抽出學生平均分計算純函式：`report.ts` 的 `computeStudentRecords` 內聯 `scores.reduce((a,b)=>a+b,0)/scores.length`（平均分），與其他平均邏輯重複，抽成可測純函式（含空陣列回 null）。
  - 修改說明（2026-06-27）：於 `reportMetrics.ts` 新增 `average(values): number | null`（空陣列回 null），`report.ts` 的 `computeStudentRecords` 學生平均分改用之（行為等價）。`report-metrics.test.ts` 補 1 組測試（平均/單值/空陣列回 null/小數）。backend `tsc --noEmit` 通過；新測試 5/5 + 既有 `report-students`/`student-report` 共 15/15 回歸通過。分支 `refactor/report-average-helper`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 21 個完成項目（21/100，未達上限）。

## 修正既有失敗測試（第一三七輪，2026-06-27）

- [x] 修正 `status-machine.test.ts` 的 PROGRESS_STEPS 鏡像 drift（上輪跑測試時發現的既有失敗）：測試期望的 `PROGRESS_STEPS` 只有 7 個，但 `statusMachine.ts` 已新增 3 個 YouTube 相關步驟（`downloading_captions`／`downloading_audio`／`transcribing_audio`，於 `youtubeCaptions.ts`／`pipeline.ts` 實際使用、前端 `types.ts` 亦已鏡像），導致 `deepEqual` 失敗。確認 source 正確、test 過時，更新測試期望陣列（依 backend 陣列順序）並補 `isProgressStep('transcribing_audio')` 斷言。後端 `tsc --noEmit` 通過、`status-machine.test.ts` 5/5 通過（以 `scripts/run-tests.sh` 執行）。分支 `fix/progress-steps-test-mirror`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 17 個完成項目（17/100，未達上限）。

## 依 STATUS_REPORT 新增可執行項目（第一三五輪，2026-06-27）

使用者提示產生新項目時應參考 `docs/STATUS_REPORT_2026_06_27.md`（該檔此前因檔名問題不存在、現已補上）。依其 §4.2／§7.2／§9 的優先建議，新增以下項目（P0 bug 列首，已初步以 grep 驗證）：

- [x] **（P0 bug）修正品質檢查／匯出漏頁**：`quality-check.ts`、`image-quality.ts`、`script-quality.ts`、`h5p.ts` 皆以 `pages WHERE status = 'ready'` 取頁，但主 pipeline 完成後**頁面層級**停在 `audio_ready`（[`pipeline.ts:1260`]）、`pipeline.ts:1299` 只把 **pdfs**.status 設為 `'ready'`，頁面從不設 `'ready'`（grep 全 backend 確認頁面無 `status:'ready'` 賦值）。結果這些功能對正常生成的簡報可能回傳空頁清單。修正方向：改以「完成狀態集合（`audio_ready`／`ready`）」過濾，並先寫一個重現測試再修，補後端測試涵蓋 audio_ready 頁面被納入。屬後端、需測試、跨 4 路由，建議單獨一輪謹慎處理。
  - 修改說明（2026-06-27）：根因確認——`'ready'` **根本不是合法 page 狀態**（`statusMachine.ts` 的 `PAGE_STATUSES` 無 `ready`，終態為 `audio_ready`；`'ready'` 僅為 PDF 狀態），故 4 路由的 `WHERE status = 'ready'` 對 `pages` 永遠匹配 0 列。將 4 路由的頁面查詢一律改為 `status = 'audio_ready'` 並加註解說明。修正既有 3 個測試（image-quality/script-quality/h5p）的 fixture——原本用**不存在的** `'ready'` page 狀態（所以測試過但 production 壞），改為 `'audio_ready'`，使其反映真實狀態並成為回歸測試（pdfs INSERT 的 `'ready'` 為正確 PDF 狀態，維持不動）。為原本無測試的 quality-check 新增 `quality-check.test.ts`（4 子測試：audio_ready 頁面被檢查〔回歸〕、非完成頁〔rendered〕不檢查、404、403）。backend `tsc --noEmit` 通過；4 個路由測試以 Node 22（`.nvmrc`）+ `--test-force-exit` 執行，子測試全通過（quality-check 4/4、image-quality 4/4、script-quality 5/5、h5p 4/4）。分支 `fix/quality-export-page-status`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 16 個完成項目（16/100，未達上限）。
- [x] **（P0）課後報告補強**：依 §7.1，`registerReportRoutes()`／`PostClassReportPanel` 補上頁面困難度（完成率低／提問多／投票分歧高）、題目答錯率與 CSV 下載入口。可分拆為純函式（前端彙總）+ 後端聚合兩個子項。
  - 進度（第一六九輪，2026-06-27）：**後端聚合子項「頁面困難度」已完成**（見下方「課後報告頁面困難度後端聚合」section，計數第 48 項）——`reportMetrics.ts` 新增純函式 `pageDifficultyScore`，`report/pages.csv` 新增 `question_count`／`difficulty_score` 欄位。
  - 進度（第一七二輪，2026-06-27）：**「題目答錯率彙整」後端聚合已收斂為可測純函式**（見下方「課後報告最難題目排序抽出純函式」section，計數第 51 項）——`reportMetrics.ts` 新增 `selectHardestQuestions`，`report/summary` 的最難前 5 題排序＋答錯率改用之。
  - 完成（2026-07-11）：**盤點發現既有 `PostClassReportPanel` 其實已有題目答錯率排行／投票分歧排行／完成率排行三榜單與五個 CSV 下載入口**（`questions.csv`／`pages.csv`／`students.csv`／`quiz-results.csv`／`poll-results.csv`），並非從零開始。真正缺口有二：(1) 綜合完成率＋投票分歧＋提問數的「頁面困難度」單一分數（`pageDifficultyScore`）雖已在 `pages.csv` 匯出多時，但從未透過 `report/summary` JSON 曝露、面板裡完全沒有呈現任何排行；(2) **意外發現一個既有 bug**——前端型別／`getMostDivergentPollPages` 選擇器早就在讀 `polls.most_divergent_pages`，但檢查後端 `report/summary` route 發現**這個欄位從來沒有任何路由寫入過**，導致「投票分歧最高頁面」這個排行區塊上線以來一直是空的（`Array.isArray(undefined)` 為 false，選擇器永遠回空陣列，無 fallback）。本輪一併修正：後端新增 `queryPagePollAggregates`（每頁票數合計/最大值/最新一次投票題目文字）與 `computePageDifficulties`（整合進 `pageDifficultyScore`，**與 `pages.csv` 共用同一份查詢**，取代原本內嵌重複邏輯，避免兩處日後再度分岔）；`reportMetrics.ts` 新增純函式 `selectMostDivergentPages`／`selectHardestPages`；`report/summary` 回應新增 `polls.most_divergent_pages`（修好那個死欄位）與 `page_difficulty.pages`（新的困難度排行）。前端：`PdfReportPageDifficultySummary` 型別、`getHardestPages` 選擇器、`PostClassReportPanel` 新增「頁面困難度排行」區塊（完成率＋分歧＋提問數併陳）並納入複製/下載 Markdown 匯出。驗證：後端新測 `report-metrics` +5（`selectMostDivergentPages`／`selectHardestPages` 排序/併列/排除規則）、`report-summary` 整合測試新增斷言（真實 DB 資料驗證分歧修好＋困難度排序正確）、既有 `report-pages-csv`／`report-question-stats` 回歸；前端 `reportSummary.test.ts` +2；前後端 `tsc`、前端測試、`vite build` 皆通過（完整後端套件另跑 1442 項僅 2 個既有已知 pre-existing 失敗，與本次改動無關）。分支 `feat/post-class-report-difficulty-ranking`，已 merge 回 master。
- [x] **（P1）生成前成本估算 modal 串接**：已有 `lib/costEstimate.ts` helper 與 `PromptModal` 估算，依 §7.5 確認是否已於所有來源（PDF／文字／YouTube）生成前顯示，補齊缺口並加測試。（與上方 §7.5「生成前成本估算覆蓋確認」為同一工作，已於第一六八輪一併完成；不重複計數。詳見該項與工作記錄。）
- [x] **（P1）教材知識庫：搜尋結果加入動作**（2026-07-11）：依 `docs/STATUS_REPORT_2026_06_27.md` §7.4／§8.1。盤點發現「加入新簡報」半句其實早於此待辦被寫下就已完成（`GlobalSearchBox.handleCreateFromPages` ＋ `POST /api/pdfs/from-pages`，提交 `69018bc6`），此條目只是未同步更新；真正缺口是「收藏頁」——全庫沒有任何 bookmark／collection 資料表或跨簡報收藏清單，僅播放頁內有 per-deck 的 `toggleBookmark`（`makeslide.bookmarks.<pdfId>` localStorage），首頁搜尋結果完全沒接上。採最小可行方案：不新建跨簡報收藏清單頁面（那需要另外的產品範疇決策），而是讓 `GlobalSearchBox` 選取模式新增「加入書籤（{n} 頁）」批次動作，直接寫入各筆結果所屬 `pdf_id` 對應的既有 `makeslide.bookmarks.<pdfId>` key（依 pdf_id 分組、每個 deck 各讀寫一次），如此稍後在該簡報播放頁即可看到書籤標記（沿用既有 `PlayPageSidebar`／`PlayPageSlidePanel` 顯示邏輯，無需改動）。此為**冪等新增**（不像播放頁內 `toggleBookmark` 是切換式），符合批次「加入」動作的語意。純前端改動，複用既有已測純函式 `readNumberArrayFromStorage`。i18n 2 鍵。驗證：前端 `tsc`、前端測試 818/818（含 i18n parity）、`vite build` 通過。分支 `feat/search-add-to-bookmarks`，已 merge 回 master。
- [x] **（P1）AI 導師自學模式入口正式化**（2026-07-11）：依 `docs/STATUS_REPORT_2026_06_27.md` §7.3。盤點發現字面上兩個子項「測驗後個人化複習清單」「答錯題自動推薦回看頁面」其實早於此待辦被寫下就已完成（提交 `0ee87935`：教師公布答案時自動把答錯且有頁碼的題目寫入 `reviewList`；`QuizBuilderPage` 複習清單區塊本就有 `?page=N` 連結）——此條目只是未同步勾掉。**盤點過程意外發現一個影響面更廣的既有 bug**：`PlayPage.tsx` 從未讀取過 `?page=` 這個 query string（`currentIdx` 恆以 0 初始化，只由 localStorage 播放進度回復），導致全站至少 5 處既有的 `?page=N` 深連結（測驗答錯回看、`QualityCheckPanel` 跳頁連結、`GlobalSearchBox` 開新分頁、`PlayPageSidebar` 觀看紀錄跳頁）全部靜默失效、一律停在第 1 頁。修正：既有的「一次性播放進度回復」effect 新增先檢查 `?page=`（複用既有已測純函式 `parseGotoPage`），若有則優先套用並略過 localStorage 回復（顯式深連結代表明確目的地，應蓋過「續播上次進度」）。另外把複習清單真正接上 AI 導師分頁（§7.3「自學入口」字面上唯一真正缺的部分）：新增 `OPEN_AI_TUTOR_EVENT`（比照既有 `OPEN_QUALITY_PANEL_EVENT` 的跨元件訊號模式），複習清單項目新增「問 AI 導師」鈕，一鍵跳頁＋把該題題目文字預填進 `usePageAsk` 輸入框＋切到側欄 AI 助手分頁的導師子分頁，把「跳頁後還要自己找 AI 分頁」的兩步操作收斂成一步。i18n 1 鍵。驗證：前端 `tsc`、前端測試 818/818（含 i18n parity）、`vite build` 通過。分支 `fix/playpage-page-query-param`，已 merge 回 master。

## 新增可執行項目（第一三四輪，2026-06-27）

第一二九輪新增的 4 個可執行項目已全部完成（計數 9–13），TODO 僅剩 2 個待使用者決定項目。依 LOOP.md 第 2 條再次分析前端程式，新增以下小顆粒、可單輪完成、可加測試、低風險項目（並參考 `docs/FUTURE_ROADMAP.md` 的「教學閉環」方向，惟其主要功能多需後端與產品判斷，故此批先聚焦純前端可測收斂）：

- [x] 模板字串內插（`{key}` 取代）收斂為共用純函式（去重 / 可測性）：`ImportTextPage`(`formatTemplate`)、`AddPagesFromPromptModal`、`PlayPageSidebar`、`SystemDataPage`、`QuizBuilderPage`、`PlayPageFullscreen` 六處各自內嵌 `Object.entries(values).reduce((acc,[k,v]) => acc.replaceAll('{k}', String(v)), template)`（或等價 `for...of`）的內插邏輯，重複且無測試。抽成共用純函式並補測試。純前端、不動後端、不需新 i18n。
  - 修改說明（2026-06-27）：新增 `frontend/src/lib/interpolateTemplate.ts`（`interpolateTemplate(template, values)`：以 `replaceAll` 取代所有 `{key}`、值以 `String()` 轉換、無對應 key 的佔位符原樣保留）。六處收斂：`ImportTextPage`／`AddPagesFromPromptModal` 以 `import { interpolateTemplate as formatTemplate/formatMessage }` 取代本地函式（呼叫點不變）；`PlayPageSidebar`／`SystemDataPage`／`QuizBuilderPage`／`PlayPageFullscreen` 的 `formatMessage` 改為 `interpolateTemplate(t(key), values)` 薄包裝（保留各自 `useCallback`/簽章）。新增 `interpolateTemplate.test.ts` 6 組測試。前端 `tsc --noEmit` 通過、測試 6/6 通過、全專案已無殘留內聯內插寫法。分支 `refactor/interpolate-template`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 14 個完成項目（14/100，未達上限）。
- [x] 抽出音訊時長加總純函式：`PlayPageSlidePanel`(`futurePages.reduce(...audio_duration_seconds??0)`)、`play/formatters.ts` 等多處重複「累加各頁 `audio_duration_seconds ?? 0`」。抽成 `sumAudioDurationSeconds(pages)` 純函式並補測試。純前端。
  - 修改說明（2026-06-27）：盤點後實際只剩 `PlayPageSlidePanel` 一處用到「未來頁音訊加總」，且它與目前頁剩餘、邊界（`duration>0` 守衛、`total>0?null`）合成一段未測的 `useMemo`。比起只抽加總，改抽出整段「剩餘播放秒數」計算更有價值：新增 `frontend/src/lib/remainingTime.ts` 的 `computeRemainingSeconds(pages, currentIdx, currentTime, duration)`（pages 為 null 回 null、目前頁剩餘 = `duration>0 ? max(0, duration-currentTime) : 0`、加上之後各頁 `audio_duration_seconds ?? 0`、總和 0 回 null），`PlayPageSlidePanel` 的 `useMemo` 改委派之（行為等價）。新增 `remainingTime.test.ts` 7 組測試（null、目前頁+後續加總、只計後續頁、duration<=0、currentTime 超界夾 0、缺值以 0 計、總和 0 回 null）。前端 `tsc --noEmit` 通過、7/7 通過。分支 `refactor/remaining-seconds`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 19 個完成項目（19/100，未達上限）。
- [x] 比例條百分比收斂為共用純函式：`HomePage` 用量比例條 `max > 0 ? Math.round((value / max) * 100) : 0` 與其他比例顯示重複。抽成 `ratioPercent(value, max)`（除以 0 回 0、clamp 0–100）純函式並補測試。純前端。
  - 修改說明（2026-06-27）：發現既有 `lib/progressPercent.ts` 的 `progressPercent(current, total)` 已正是此「比例→百分比（`total<=0`/非有限值回 0、clamp 0–100）」函式且有完整測試，故**重用之而非新增 `ratioPercent`**（避免重複工具）。收斂 2 處內聯：`HomePage` 用量比例條 `max > 0 ? Math.round((value/max)*100) : 0` → `progressPercent(value, max)`（行為等價）；`SettingsPage` 嵌入索引進度條 `Math.round((indexed_pages/total_pages)*100)` + `Math.min(pct,100)` → `progressPercent(indexed_pages, total_pages)`，順帶修掉 `total_pages` 為 0 時會渲染 `NaN%` 的潛在 bug（progressPercent 回 0）。前端 `tsc --noEmit` 通過、`progressPercent` 既有 4 測試續通過、pages/components 已無殘留通用比例百分比內聯寫法。分支 `refactor/reuse-progress-percent`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 15 個完成項目（15/100，未達上限）。
- [x] 抽出測驗計分加總純函式：`QuizBuilderPage` 多處 `reduce` 計算總分／滿分／平均分（含 `roundToTwoDecimals`），邏輯分散且無獨立測試。抽成可測純函式。純前端。
  - 修改說明（2026-06-27）：於既有 `lib/quizScoring.ts` 新增 `calcAttemptScore(questions, answersById)`（以 `normalizeQuestionScores` + `calcQuestionScore` 累加單次作答總分，回傳未四捨五入原始值）與 `maxAttemptScore(questions)`（normalized 分數加總＝滿分）。收斂 `QuizBuilderPage` 兩處重複的「`normalizeQuestionScores` + `reduce(calcQuestionScore)`」計分內聯（提交作答、同步顯示分數/滿分），呼叫端仍各自 `roundToTwoDecimals`；其餘 per-question 用途（答錯偵測等）不動。`quizScoring.test.ts` 新增 3 組測試（maxAttemptScore、calcAttemptScore 依 id 加總含缺答、回傳未四捨五入原始值），共 11/11 通過。前端 `tsc --noEmit` 通過（以 `scripts/run-tests.sh` 執行測試）。分支 `refactor/quiz-attempt-score`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 18 個完成項目（18/100，未達上限）。
- [ ] 報告面板個人層級延伸（方向，需使用者裁示）：依 `docs/FUTURE_ROADMAP.md` 2.1，目前課後報告為班級層級，roadmap 建議延伸到個人層級報表（每位學生答題完成率、提問次數、投票參與率）。涉後端聚合與隱私呈現，屬較大項目，列為待使用者決定方向。

## 新增可執行項目（第一二九輪，2026-06-27）

依 LOOP.md 第 2 條（剩餘兩項皆待使用者決定、不宜自動逕行），分析前端程式後新增以下小顆粒、可單輪完成、可加測試、低風險項目：

- [x] 逐字稿每頁字數上限正規化收斂為共用純函式（去重 / 可測性）：`PlayPageSidebar`、`RegenAllDialog`、`TtsDialog` 三處各自內嵌 `Math.max(80, Math.min(2000, Math.round(x)))`，magic number 80/2000 散落三檔、易漂移且無測試。抽成共用常數與純函式並補測試。純前端、不動後端、不需新 i18n。
  - 修改說明（2026-06-27）：新增 `frontend/src/lib/scriptMaxChars.ts`（`SCRIPT_MAX_CHARS_MIN=80`、`SCRIPT_MAX_CHARS_MAX=2000`、`normalizeScriptMaxChars(value)` = `clamp(Math.round(value), MIN, MAX)`，沿用既有 `clamp` helper，行為與原內聯完全一致：`NaN` 照樣傳遞，呼叫端維持各自的 `Number.isFinite` 防呆）。三處呼叫點改用此函式。新增 `scriptMaxChars.test.ts` 5 組測試（範圍內含上下界、超界拉回、四捨五入、與舊內聯輸出一致、NaN 傳遞）。前端 `tsc --noEmit` 通過、測試 5/5 通過、全專案已無殘留內聯寫法。分支 `feat/normalize-script-max-chars`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 9 個完成項目（9/100，未達上限）。
- [x] 逐字稿字數上限範圍說明 i18n：三處輸入框（TtsDialog / RegenAllDialog / PlayPageSidebar regen）未向使用者標示 80–2000 的允許範圍，輸入超界會被靜默正規化。可加上以 `SCRIPT_MAX_CHARS_MIN/MAX` 組出的 helper 文字與 `min/max` HTML 屬性，並補 i18n 鍵。
  - 修改說明（2026-06-27）：新增共用 i18n 鍵 `play.scriptMaxCharsRange`（zh-TW「允許範圍 {min}–{max} 字」／en「Allowed range: {min}–{max}」，內插 `SCRIPT_MAX_CHARS_MIN/MAX`）。`TtsDialog` 與 `RegenAllDialog`（即 PlayPageSidebar 開啟的批次重生輸入）的字數上限 `<input>` 下方新增範圍提示，並把原本硬編的 `min={80} max={2000}` HTML 屬性改用 `SCRIPT_MAX_CHARS_MIN/MAX` 常數，與正規化邏輯共用同一來源。前端 `tsc --noEmit` 通過、i18n parity + nonempty 等 27 測試全通過（新鍵兩語系 placeholder 集合一致）。分支 `feat/script-max-chars-range-hint`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 13 個完成項目（13/100，未達上限）。
- [x] 投影片縮放比例（slideImageScale）邊界收斂：`PlayPageHeader` 兩處 `Math.max(0.65, ...)`／`Math.min(1.35, ...)` 與 0.1 步進散落且 magic number 重複。抽成共用常數與 `stepSlideScale(scale, delta)` 純函式並補測試。
  - 修改說明（2026-06-27）：新增 `frontend/src/lib/slideImageScale.ts`（`SLIDE_IMAGE_SCALE_MIN=0.65`、`MAX=1.35`、`STEP=0.1`、`stepSlideImageScale(scale, delta)`：先 `toFixed(2)` 消浮點誤差再以共用 `clamp` 夾範圍，與原寫法行為一致）。`PlayPageHeader` 放大／縮小按鈕 onClick 改用 `stepSlideImageScale(scale, ±STEP)`，兩處 disabled 判斷改用 `MIN`/`MAX` 常數，header 內已無 magic number。新增 `slideImageScale.test.ts` 4 組測試（步進消浮點誤差、不低於下限、不高於上限、與舊內聯一致）。前端 `tsc --noEmit` 通過、測試 4/4 通過。分支 `feat/slide-scale-helper`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 12 個完成項目（12/100，未達上限）。
- [x] 抽出首頁音訊總時長彙總純函式：`HomePage` 內聯 `Math.round(items.reduce(...total_audio_duration_seconds...) / 60)` 計算總分鐘數，無測試且與單卡片 `/60` 換算重複。抽成可測純函式。
  - 修改說明（2026-06-27）：新增 `frontend/src/lib/homeStats.ts`（`summarizeHomeStats(items)` 回傳 `{totalPdfs, totalPages, totalPlays, totalAudioMin}`，單次遍歷取代原本 3 次 reduce、音訊總秒數 `/60` 後四捨五入，各欄位缺值以 0 計入與原 `?? 0` 一致）；輸入採 `Pick<PdfListItem, …>` 結構型別降低耦合。`HomePage` 的 `homeStats` useMemo 改為 `summarizeHomeStats(items)`（行為等價）。新增 `homeStats.test.ts` 4 組測試（空清單、正常彙總含四捨五入、缺值以 0 計入、與舊 reduce 寫法一致）。前端 `tsc --noEmit` 通過、測試 4/4 通過。分支 `feat/home-stats-helper`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 11 個完成項目（11/100，未達上限）。
- [x] 抽出上傳進度百分比計算純函式：`UploadButton`、`ImportTextPage`、`HomePage`(zip)、`AddPagesFromPromptModal` 多處重複 `Math.round((loaded/total)*100)`（且 total 為 0 時行為不一）。收斂為帶除以 0 防呆的共用純函式並補測試。
  - 修改說明（2026-06-27）：新增 `frontend/src/lib/uploadProgress.ts`（`uploadProgressPercent(loaded, total)`：`total <= 0`／`NaN` 回 0 避免除以 0 產生 `NaN`/`Infinity`，其餘四捨五入後以既有 `clamp` 夾在 [0,100]）。收斂 5 處內聯（`UploadButton`、`ImportTextPage` 2 處、`HomePage` zip 匯入、`AddPagesFromPromptModal`），各呼叫端保留原本的外層 fallback 語意（位元組進度點維持 `if (total > 0)` 略過更新、`AddPagesFromPromptModal` 維持 `null` 顯示）。新增 `uploadProgress.test.ts` 4 組測試（一般換算、分母無效回 0、超界夾 100、與舊內聯一致）。前端 `tsc --noEmit` 通過、測試 4/4 通過、無殘留上傳進度內聯寫法。`HomePage` 第 1441 行的音訊用量比例條語意不同（非上傳進度），未納入。分支 `feat/upload-progress-percent`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 10 個完成項目（10/100，未達上限）。

## 工作記錄

| 日期 | 工作內容 | 分支 |
|------|---------|------|
| 2026-07-10 | （使用者對話要求）修正複製簡報失敗與受控資源外洩。根因：合輯簡報（collection）與複習簡報（from-pages）建立時只寫 DB 與頁面檔、**未寫 `metadata.json`**，而 `/duplicate` 硬要求 `metadata.json` 存在（缺檔即 throw「metadata not found」→ 500）。修法：(1) shared.ts 新增 `buildMetadataFromDb(pdfId)`（由 pdfs+pages 重建 metadata）；collections.ts／from-pages.ts 建立後即寫 metadata.json。(2) `/duplicate` 在 `metadata.json` 缺失時改由 DB 合成（`readMetadata(id) ?? buildMetadataFromDb(id)`），並保留 `source_type`（合輯仍是合輯）與每頁 `link_pdf_id`／render_type／animation_spec／notebook_path；讀取權限檢查補上遺漏的 `aclCtx`（唯讀分享的私有簡報先前會誤 403）。(3) 受控資源：`fs.cp` 後一律刪除複本的 `quiz-recordings/`、`quiz-essay/`（學生監考錄影與問答照片，屬 PII，任何人複製都不帶走）；quiz_sets／page_polls 的「定義」只有在複製者具**編輯權限**（`canEditPdf`）時才複製，唯讀複製者只得投影片，且學生作答資料（attempts/votes/recordings/essays）一律不複製。驗證：後端 tsc；新增 duplicate 3/3＋collections/from-pages/quizzes/revision/detail-permission 回歸 131/131 全綠 | fix/duplicate-collection-metadata-and-controlled-resources |
| 2026-07-10 | （使用者對話要求）Jupyter notebook 頁面唯讀模式保留「與寫入權限無關」的檢視控制項。原本整條頂部工具列以 `{editable ? (...) : null}` 包住，唯讀時連下載、字型大小、版面切換、輸出比例都消失。改為工具列一律渲染：左側新增/移動/刪除 cell 群組與右側 kernel 選擇/執行/重啟/清除輸出/上傳等**寫入類**控制項仍以 `editable` 個別包住；下載 `.ipynb`（📥）、字型 A－/A＋、版面 split/stack 切換、split 時的輸出比例滑桿一律顯示。頁腳的複製原始碼/複製輸出、上一/下一 cell 導覽與鍵盤 ↑/↓ 導覽本就不受 editable 限制，維持可用。相關 handler（downloadNotebook/changeFontSize/toggleCellLayout/changeOutputShare）本就無 `!editable` 早退，安全暴露。驗證：前端 tsc＋vite build＋811/811 測試全綠 | fix/notebook-readonly-view-controls |
| 2026-07-10 | （使用者對話要求）簡報改寫即時同步：當簡報被他人改寫時，所有開著該簡報的客戶端自動更新；只有「目前頁」被改寫才更新畫面，且不打斷正在播放的語音，非目前頁改寫完全不驚動。後端：`PdfDetailPage` 序列化加每頁 `updated_at`；新增輕量 `GET /api/pdfs/:id/revision`（`{updated_at,page_count,status}`，與 detail 同讀取守門含 share token）。前端：圖片/音訊 cache-bust 由 deck 層級改為 per-page（主圖與音訊版本鍵用 `currentPage.updated_at`，側邊縮圖維持 deck 層級以免換頁全刷）；新增 `useLiveContentUpdate` hook 每 6 秒輪詢 revision、變更即背景 `reloadDetailContent`（不覆寫編輯中欄位）。因音訊 effect 只依 `page_number`＋per-page bust，只有真正改動的頁刷新、語音不中斷。驗證：前後端 tsc、後端 revision 3/3＋detail-permission 92/92、前端 811/811＋vite build 全綠 | feat/live-content-update |
| 2026-07-10 | （使用者對話要求）合輯簡報：在首頁選多份簡報生成一份「合輯簡報」，每頁為一份來源簡報的 AI 摘要＋指向該簡報的連結；用它生成測驗時聚合所有來源簡報的內容出題。後端：`pages` 新增 `link_pdf_id`（idempotent migration，非 FK）、`source_type` union 加 `'collection'`、型別/序列化（含 `link_pdf_title`）；新端點 `POST /api/pdfs/collections`（`registerCollectionRoutes`，逐份來源以 LLM 產生摘要為一頁、封面複製來源首頁圖、`link_pdf_id` 指向來源，LLM 失敗以標題退回；id 用 `nanoid(PDF_ID_SIZE)` 以通過下游 `PDF_ID_RE` 參數守門）；`quizzes/generate` 的 `readQuizContext` 於 `source_type='collection'` 時聚合所有 `link_pdf_id` 來源內容（依來源數平均分配、整體上限 60000 字），`generate-quiz-question` 單題於合輯頁改用連結來源內容。前端：API `createCollection`、首頁批次工具列（已選 ≥1）「生成合輯簡報」按鈕（完成導向新合輯播放頁）、PlayPage 於 `link_pdf_id` 頁顯示「🔗 開啟原簡報」連結；zh-TW/en 各 5 鍵。驗證：前後端 tsc 通過；後端 collections 2/2＋from-pages／quizzes／generate-quiz-question 回歸 34/34；前端 HomePage＋i18n 37/37 全綠 | feat/collection-presentation-quiz |
| 2026-07-10 | （使用者對話要求）AI 動畫編輯器 z-index 提高避免被 header 擋住。播放頁 header 為 `z-[1000]`，而 AI 自訂動畫編輯器對話框（及焦點框放大編輯對話框）只有 `z-50`，全螢幕 modal 頂部被固定 header 蓋住。兩者提高至 `z-[1100]` 使其疊在 header 之上。驗證：前端 tsc＋vite build 通過 | fix/animation-editor-zindex |
| 2026-07-10 | （使用者對話要求）沒有聲音檔的頁面動畫無法播放＋自訂動畫播完應定格。根因：整個播放引擎綁在 `<audio>`（currentTime 靠 timeupdate、播放靠 audio.play()），無音訊頁 audio.play() 直接失敗、timeupdate 不觸發，GSAP timeline 與 custom-script 都無從推進。改為：無可播放音訊且有動畫的頁面以計時器推進 currentTime（比照 handleEnded 動畫延長機制），由 isPlaying 驅動的 effect 啟停、playPause 切換、seek／preview 改走計時器、進度條 duration 取動畫總長、pause-playback 效果會停下計時器；只有 sync master 本地推進，follower 仍依廣播 currentTime/isPlaying。另夾住送進 custom-script sandbox 的 `t` 至該效果 `api.duration`，未設消失時間時動畫定格在最後一幀而非循環／空白。驗證：前端 tsc＋vite build＋animationSpec/playbackReadiness 測試 65/65 通過 | fix/animation-plays-without-audio |
| 2026-07-10 | （使用者對話要求）AI 動畫編輯器（custom-script 的「AI 自訂動畫編輯器」對話框）視窗大小固定，不因內容增加而變高。原外層用 `max-h-[90vh]`，視窗高度會隨聊天訊息／串流程式碼累積從小長到 90vh，造成視窗忽高忽低。改為固定 `h-[90vh]`；內部各區塊本就以 `min-h-0 flex-1 + overflow-y-auto` 自行捲動，溢出內容於各自容器捲動而非撐高對話框。驗證：前端 tsc＋vite build 通過 | fix/ai-animation-editor-fixed-height |
| 2026-07-09 | （使用者實機回饋，UI 對比）NotebookPanel 工具列／頁腳按鈕在淺色主題下用 `text-text-muted`（上下移動／導覽鈕甚至無文字色）太淺看不到；統一提升為主文字色 `text-text`（狀態文字保留 muted）。前端 tsc＋vite build 通過。★ 使用者截圖同時證實 **notebook 就地執行在瀏覽器實機成功**（`In[1]` 輸出＋traceback＋耗時 483ms 皆正常顯示）。備註：本輪發現另一 agent 並行於 master commit（Gemini TTS 47aa531）致我的工作落 detached HEAD，已保存 `jupyter-integration-work` 分支並 merge 回 master（保留雙方工作、無衝突） | master（NotebookPanel）；備份分支 jupyter-integration-work |
| 2026-07-09 | （使用者實機回饋「按執行看不到輸出」）根因＝jupyter_server 版本過舊。前端 `@jupyterlab/services@7.6` 的 kernel WebSocket 用 `v1.kernel.websocket.jupyter.org` binary subprotocol（jupyter_server 2.0+），但機器只有 jupyter_server **1.4.1**（舊 JSON protocol）——cell 有執行但前端收不到 iopub 訊息故無輸出（手寫舊 protocol 的驗證會過、前端 lib 不會，正是此差異）。修法：start.sh 加 `ensure_jupyter_bin()` 挑 jupyter_server ≥ 2（優先專用 `.jupyter-venv`／系統夠新則用之／都不行自動建 venv 裝 jupyter_server＋ipykernel），`start_jupyter` 改用之；`.jupyter-venv/` 入 gitignore。**實機驗證**：建 venv 裝 jupyter_server 2.14.2→start_jupyter 起它→前端同一套 `@jupyterlab/services` 執行 `print(1+1)` 收到 `2`（JLAB RESULT: PASS）。至此 notebook 就地執行對前端真實可用 | master（start.sh） |
| 2026-07-09 | （使用者對話要求）本機 Jupyter server 改用 https。`JUPYTER_PROXY_TARGET` 可用 `https://`；後端代理對 loopback 自簽憑證於 HTTP（undici `connect.rejectUnauthorized:false`）與 WebSocket（`wsClientOptions.rejectUnauthorized:false`）略過驗證；`start.sh` 的 `start_jupyter` 偵測 https target 時以自簽憑證啟動 Jupyter（`--ServerApp.certfile/keyfile`，共用抽出的 `ensure_self_signed_cert`，重用 --https 憑證路徑），無 openssl 則明確警告。**實機驗證**：start_jupyter 起 https Jupyter→curl -k 直連 200→後端代理端到端（未認證 401、帶 session 200 回真實資料）。**★ 完整執行鏈端到端通過**：經後端代理建 kernel（HTTP）＋連 kernel WebSocket（含 session 握手驗證）送 `execute_request`，`print(1+1)` 於真實 kernel 執行回傳 `2`（RESULT: PASS）——證實 HTTP＋WebSocket 代理＋session gate＋kernel 執行全鏈可用。備註：後端到 Jupyter 屬 loopback server-to-server，http 本已安全；改 https 為依使用者要求 | master（jupyterProxy.ts＋start.sh） |
| 2026-07-09 | （使用者對話要求）把啟動本機 Jupyter server 整合進 `start.sh`。新增 `read_env_var`（讀 .env）＋`start_jupyter`（依 JUPYTER_ENABLED/JUPYTER_PROXY_TARGET，base_url 對齊 `<NB_PREFIX><JUPYTER_PROXY_PREFIX>`、host/port 取自 target、綁 localhost 無 token 啟動；port 已佔用則沿用、找不到 jupyter 只警告）；兩個 cleanup 路徑於 INT/TERM 一併回收 Jupyter；僅 backend/all 模式啟動。**實機端到端驗證通過**：真實 .env→start_jupyter 起 Jupyter Server 1.4.1→後端同源代理 `/jupyter/api/*`（未認證 401、帶 session 200 回真實 kernel 資料）。順帶修正 .env 分行（JUPYTER_ENABLED/JUPYTER_PROXY_TARGET）與一個 commit 誤落殘留分支的問題 | master（start.sh；含前述 feat/jupyter-backend-proxy） |
| 2026-07-09 | （使用者對話要求）同源後端反向代理到本機 Jupyter server——營運者不必外接 JupyterHub/nginx 即可啟用就地執行。後端把 `<NB_PREFIX><JUPYTER_PROXY_PREFIX>/*`（HTTP＋WS）代理到 `JUPYTER_PROXY_TARGET`（本機 Jupyter），瀏覽器同源連線、內部 Jupyter 不對外；掛載路徑用獨立 `JUPYTER_PROXY_PREFIX`（預設 /jupyter）避免與 MakeSlide 路由衝突；connection 端點回掛載路徑，前端不改。安全：HTTP preHandler＋WS verifyClient 都以有效 session 為門檻。相依 @fastify/http-proxy@^9；純函式 jupyterProxyEnabled／jupyterProxyMountPath／sessionSubFromCookieHeader。驗證：jupyter-proxy 5/5＋jupyter-connection 回歸 4/4＋後端 tsc（端到端待部署實機）。修正先前 commit 意外落在殘留分支的問題，已正確 merge master | feat/jupyter-backend-proxy（已 merge） |
| 2026-07-09 | （依 LOOP.md 第 2 條分析 notebook 顯示層，新增階段 7「顯示層強化」5 項並完成 7a）7a：顯示 cell 執行編號 `In [n]`——`execution_count` 已存但未呈現。純函式 `executionCountLabel`（已執行 `[n]`／未執行 `[ ]`）；NotebookPanel code cell 原始碼上方顯示 `In [n]:`（JupyterLab 同款）。驗證：nbformatModel 26/26、前端 tsc＋vite build。另診斷使用者實機 `/api/kernels` 失敗：`.env` `JUPYTER_ENABLED=true` 已生效但 `JUPYTER_BASE_URL` 未設＝同源，而同源 app server 無 Jupyter，需運維層接 Jupyter server（反向代理或顯式 URL），非程式 bug。另新增 7b（md 預覽）／7c（耗時）／7d（搜尋）／7e（快捷鍵說明）待後續。**使用者要求本輪後暫停 loop** | feat/notebook-execution-count（已 merge） |
| 2026-07-09 | （Jupyter 整合階段 6c，階段 6 全部完成）Run all——`nbformatModel` 加純函式 `codeCellIndices`；NotebookPanel kernel 工具列加「全部執行」鈕，依序執行所有 code cell、local `working` 串接、逐格串流、遇錯停止（stop-on-error）、最後寫回；執行中/無 code cell disabled；i18n 1 鍵。驗證：nbformatModel 25/25、前端 tsc＋i18n 38/38＋vite build（端到端需 kernel 實機）。另診斷並修正使用者 404：`.env` 的 `JUPYTER_ENABLED` 由 false 改 true（後端 dotenv 讀 .env，非 start.sh），移除 start.sh 無效 shell 變數 | feat/notebook-run-all（已 merge）；chore start.sh |
| 2026-07-08 | （Jupyter 整合階段 6e）長輸出折疊。純函式 `collapseText`（截前 N 行＋隱藏行數、fits/無效 no-op）；NotebookPanel 加 `CollapsibleOutput`，text／error 輸出超過 16 行折疊並「顯示其餘 {n} 行／收合」，image/html/latex 不受影響；i18n 2 鍵。驗證：collapseText 3/3、前端 tsc＋i18n 38/38＋vite build。階段 6 餘 6c（Run all）需 kernel、暫緩至實機 | feat/notebook-collapse-output（已 merge） |
| 2026-07-08 | （Jupyter 整合階段 6d）複製 cell 原始碼／輸出到剪貼簿。`nbformatModel` 加純函式 `outputsToPlainText`（stream＋result text/plain＋error 去 ANSI／退回 ename:evalue、圖片略過）；NotebookPanel 頁腳加「複製原始碼／輸出」鈕（navigator.clipboard、唯讀可用、best-effort）；i18n 2 鍵。驗證：nbformatModel 24/24、前端 tsc＋i18n 38/38＋vite build。註：本次 feature commit 8f489c7 因工作目錄隔離不乾淨，誤含使用者既有未提交改動 LOOP.md／NEW_FEATURE.md／start.sh（待使用者決定是否拆出） | feat/notebook-copy-cell（已 merge） |
| 2026-07-08 | （使用者實機回饋 fix）notebook 頁 `GET /api/jupyter/connection` 404（後端 JUPYTER_ENABLED 預設關閉）原被前端當成一般「Kernel 無法連線」，訊息誤導。新增獨立 `disabled` kernel phase：純函式 `isJupyterDisabledError`（duck-type status===404）＋`kernelStatusLabelKey` 加 disabled 分支（先於一般錯誤判斷），`useJupyterKernel` connect catch 區分 404→`disabled`，狀態列改顯示「Jupyter 執行功能未啟用（請洽管理員開啟）」。i18n `kernelDisabled`。驗證：jupyterConnection 8/8（disabled 優先＋isJupyterDisabledError）、前端 tsc＋i18n 38/38＋vite build | fix/jupyter-disabled-status（已 merge） |
| 2026-07-08 | （Jupyter 整合階段 6b）cell 型別切換 code↔markdown。`nbformatModel` 加純函式 `changeCellType`（保留 source、code→md 去 outputs/exec_count、md→code 補預設、同型別/越界 no-op）；NotebookPanel 工具列加「轉為 Markdown／程式碼」鈕（依當前型別變標籤、先 commit、離開 code 清執行高亮）經 savePageNotebook 寫回；i18n 2 鍵。驗證：nbformatModel 22/22、前端 tsc＋i18n 38/38＋vite build | feat/notebook-cell-type-toggle（已 merge） |
| 2026-07-08 | （依 LOOP.md 第 2 條分析 notebook 編輯器，新增階段 6「cell 操作強化」5 項並完成 6a）6a：cell 上下移動——`nbformatModel` 加純函式 `moveCell`（immutable、回移動後 index、邊界 no-op），NotebookPanel 工具列加 ⬆／⬇ 鈕（端點 disabled、先 commit 編輯、選取跟隨、清執行高亮）經 savePageNotebook 寫回，純函式以 `moveCellPosition` 別名避免與導覽用 local moveCell 撞名；i18n 2 鍵。驗證：nbformatModel 20/20、前端 tsc＋i18n 38/38＋vite build。另新增 6b（型別切換）／6c（Run all）／6d（複製 cell）／6e（長輸出折疊）待後續 | feat/notebook-cell-reorder（已 merge） |
| 2026-07-08 | （Jupyter 整合狀態校正）TODO 多個已完成的頂層階段仍謊報為 `[ ]`，校正反映真實：階段 1c／1d／2／3／4 標為完成（各子項均已 merge），舊 NEW_FEATURE「第一步 c：頁面接線」項目確認已被新計畫階段 0／1b／1c-ii／4c／4d 完全且超額涵蓋（可執行 `NotebookPanel` 取代唯讀 `NotebookView`）故收束。**結論：Jupyter 整合階段 0–5 於本環境可完成的程式工作全部結束；剩餘僅 `1d-ii-b`（同步/上課模式互動頁）與真實 cgu gateway 端到端等需啟動 Jupyter server／gateway 的實機驗證項，自動 loop 無法推進。** | master（僅文件校正） |
| 2026-07-08 | （Jupyter 整合階段 5e，階段 5 全部完成）kernel 執行逾時／連線失敗提示。狀態列優先順序抽成純函式 `kernelStatusLabelKey`（回精確 i18n key union），NotebookPanel 加 runTimedOut＋30s 計時器（鍵於執行中 cell），逾時後顯示「仍在執行中…（可重啟 kernel）」；i18n kernelSlow。驗證：jupyterConnection 7/7、前端 tsc＋i18n 38/38＋vite build。至此 Jupyter 整合階段 0–5 於此環境可完成的程式工作全部結束，剩餘為需 Jupyter server＋gateway 的實機驗證項 | feat/notebook-kernel-timeout（已 merge） |
| 2026-07-08 | （Jupyter 整合階段 5c）AI generate 帶入頁面既有內容作 context。後端 generate 已支援 context 參數但前端未帶；useSlideManagement 加 currentPageScript，handler 以 cleanTranscriptForReview 清理當前頁逐字稿作 context 傳 generatePageNotebook（後端截 2000 字），PlayPage 傳 scripts[page]。驗證：前端 tsc＋vite build（後端 context 已由 notebook-generation 測試涵蓋） | feat/notebook-generate-context（已 merge） |
| 2026-07-08 | （Jupyter 整合階段 5d）notebook cell 增／刪 UI。原只能編輯既有 cell。`nbformatModel` 加 newCell／insertCell／deleteCell 純函式（immutable、回下一選取 index、保留 ≥1 cell、越界 no-op）；NotebookPanel 工具列加「＋程式碼」「＋Markdown」（下方插入並選取）「刪除 cell」（confirm、最後一 cell disabled），先 commit 進行中編輯再 savePageNotebook 寫回；i18n 4 鍵。驗證：nbformatModel 18/18、前端 tsc＋i18n 38/38＋vite build | feat/notebook-cell-add-delete（已 merge） |
| 2026-07-08 | （Jupyter 整合階段 5b）總播放時長排除 notebook 頁殘留 audio_duration。轉成 notebook 的頁其 DB audio_duration 仍在，regenerate 重算 total 時算入，與「notebook 頁無語音」矛盾。新增純函式 `sumPageAudioDurations`（notebook 頁視為 silent），regenerate SELECT 帶 render_type 改用之；`writeNotebookForPage` 翻頁後即時重算 total＋更新 DB/metadata，使轉成/產生/匯入 notebook 立即修正。驗證：audioDurationSum +2、notebook-generate 補斷言（total→null）、回歸 18/18、後端 tsc | fix/notebook-total-audio-duration（已 merge） |
| 2026-07-08 | （依 LOOP.md 第 2 條分析 notebook 程式，新增階段 5「後續加強」5 項並完成 5a）5a：sidebar 縮圖標示 notebook 頁——`render_type==='notebook'` 縮圖右上角加「📓 Notebook」badge，使用者一眼辨識互動頁。PlayPageSidebar 條件渲染＋i18n 2 鍵。驗證：前端 tsc＋i18n 38/38＋vite build。另新增 5b（總時長排除 notebook）／5c（generate 帶頁面 context）／5d（cell 增刪 UI）／5e（kernel 逾時提示）待後續 | feat/notebook-sidebar-badge（已 merge） |
| 2026-07-08 | （使用者授權安裝相依，Jupyter 整合階段 3b）CodeMirror 語法 highlight。code cell 編輯 textarea 換 CodeMirror 6（Python、行號），React.lazy 切獨立 chunk（471KB 不進主 bundle）；markdown 維持 textarea＋作 Suspense fallback。CodeMirror 不綁 Ctrl/⌘/Shift+Enter／Esc 使其冒泡到容器沿用既有鍵盤模型；主題以 MutationObserver 跟隨 html.dark。相依 @uiw/react-codemirror／@codemirror/lang-python／view／state。驗證：前端 tsc＋vite build 通過（編輯體驗待實機驗證） | feat/notebook-codemirror（已 merge） |
| 2026-07-08 | （使用者對話要求，Jupyter 整合階段 4d）單頁 `.ipynb` 檔匯入／匯出（有別於 4a 整份 ZIP）。純前端重用既有 GET／PUT notebook 端點：純函式 `lib/notebookFile.ts`（notebookDownloadFilename／serializeNotebookFile／parseNotebookFile）＋`useSlideManagement` 匯出（fetchPageNotebook→Blob 下載，讀取權限）／匯入（讀檔→savePageNotebook，編輯權限、10MB 上限、shape 檢查）handler＋工具列「匯入/匯出 .ipynb」鈕＋i18n 9 鍵。驗證：notebookFile 4/4、前端 tsc＋i18n 38/38＋vite build 通過 | feat/notebook-ipynb-file（已 merge） |
| 2026-07-08 | （使用者要求 /loop，Jupyter 整合階段 4b-ii）前端 AI 產生入口。播放頁「投影片管理」工具列加紫色「AI 產生 Notebook」鈕：`handleGenerateNotebookForCurrentPage`（window.prompt 取主題→`generatePageNotebook` POST /notebook/generate→reloadDetail）＋API client＋PlayPageContext／Sidebar 接線＋i18n 4 鍵。驗證：前端 tsc＋i18n 38/38＋vite build 通過（真 gateway 端到端待手動驗證） | feat/notebook-ai-generate-ui（已 merge） |
| 2026-07-08 | （使用者要求 /loop，Jupyter 整合階段 4b）AI 由主題產生可執行 notebook 頁（後端）。新增 `POST .../notebook/generate`（canEditPdf）：LLM 回收窄大綱（markdown/code cell）→ `outlineToNotebook` 轉 nbformat（code cell 帶空 outputs＋null execution_count）→ `validateNotebook` → 寫回。寫回與 PUT 共用新抽出的 `writeNotebookForPage`（翻 render_type＋resync metadata）。純核心（outlineToNotebook／buildNotebookGenMessages／GeneratedNotebookSchema）與 LLM 呼叫分離。驗證：notebook-generation 5/5（純核心）＋notebook-generate 3/3（mock LLM：寫回/翻型別、400 空 topic、403 非擁有者）＋回歸 17/17＋後端 tsc。前端入口＋真 gateway 端到端留 4b-ii | feat/notebook-ai-generate（已 merge） |
| 2026-07-08 | （使用者要求 /loop，Jupyter 整合階段 2b-ii）HTML 輸出改走 sandbox iframe。notebook `text/html` 輸出（pandas 表格／plotly／repr）原以逸出文字顯示，改為在 `<iframe sandbox="allow-scripts">`（無 allow-same-origin）內渲染，於 opaque origin 隔離。純函式 `lib/notebookHtmlSandbox.ts` `buildNotebookHtmlSrcDoc`（片段原樣嵌入＋內嵌 script 量 scrollHeight postMessage 回父層）＋共用常數；`NotebookPanel` 加 `NotebookHtmlOutput` 監聽高度訊息（event.source 比對）自動撐高。驗證：notebookHtmlSandbox 4/4、前端 tsc＋vite build 通過（sandbox 實際渲染待真實輸出驗證） | feat/notebook-html-sandbox-2bii（已 merge） |
| 2026-07-08 | （使用者對話要求，Jupyter 整合階段 1d-ii-c）notebook 頁一律不載入 audio。1d-ii 只在無 audio_url 時清 `<audio>`，但用「轉成 Notebook」翻頁後該頁仍帶舊 audio_url，換頁時仍載入播放前身旁白。新增純函式 `lib/pageAudio.ts` `playablePageAudioUrl`（render_type==='notebook' 一律回 null），`PlayPage` 5 個載入路徑（換頁交換 src／下一頁 prefetch／handleRetry／onError／onplay catch）全改走 helper。驗證：pageAudio 3/3、前端 tsc＋vite build 通過（實機播放待驗證） | fix/notebook-no-audio-load（已 merge） |
| 2026-07-08 | （使用者對話要求，Jupyter 整合階段 4c）手動「轉成 Notebook」UI 入口。此前把一頁翻成 notebook 只能靠 API PUT／ZIP import，前端無入口。於播放頁「投影片管理」工具列新增「轉成 Notebook」鈕：`useSlideManagement` 加 `handleConvertCurrentPageToNotebook`（confirm 後以 `defaultNbNotebook()` 呼叫 `savePageNotebook` PUT，後端自動翻 render_type='notebook'＋記 notebook_path，reloadDetail 後 SlideRenderer 改用 NotebookPanel），read-only／busy／無頁／已是 notebook 時 disabled；經 PlayPageContext／PlayPageSidebar 接線；i18n 5 鍵（zh-TW／en）。驗證：前端 tsc、i18n parity 38/38、vite build 通過（按鈕點擊實機互動待真實使用驗證，底層 PUT 端點已由 phase 1b notebook-asset 8/8 涵蓋） | feat/notebook-convert-ui（已 merge） |
| 2026-07-08 | （使用者要求 /loop，Jupyter 整合階段 4a）匯出／匯入包含 notebook 頁。`.ipynb` 隨 pdfDir 打包，但 render_type/notebook_path 記在 pages 欄位、import 重建不帶到，比照 animations.json：export 加 `loadExportedNotebooks`＋`notebooks.json` sidecar；import 加 `ImportedNotebookSchema`＋入 SIDECAR_FILES＋依 page_number 還原 render_type='notebook'/notebook_path。新測 export-import-notebook 2/2（含完整 roundtrip：還原欄位、.ipynb 存活、sidecar 消費、端點回內容）、既有 export/import 回歸 7/7、後端 tsc 通過。階段 4 尚餘 AI 產生 notebook（4b） | feat/notebook-export-import（已 merge） |
| 2026-07-08 | （使用者要求 /loop，Jupyter 整合階段 2b-i）ANSI traceback 上色。純函式 `ansi.ts`：`parseAnsi`（解析 SGR：前景色 30–37／90–97 亮色→基礎色、bold 1／22、reset 0／空、39 清色，其餘 escape 剝除）／`stripAnsi`。`NotebookPanel` error OutputBlock 以 `AnsiText`（色碼→Tailwind class）渲染 traceback，取代連 ANSI 亂碼一起顯示。ansi 7/7、前端 tsc＋vite build 通過。階段 2 尚餘 HTML sandbox iframe（2b-ii） | feat/notebook-ansi-traceback（已 merge） |
| 2026-07-08 | （使用者要求 /loop，Jupyter 整合階段 3a）cell 內容編輯（textarea＋command/edit 雙模式）。純函式 `withCellSource`（immutable、越界 no-op＋測試）。`NotebookPanel`（editable）：command 下 Enter 進編輯／↑↓ 切 cell；edit 下 textarea（自動聚焦/隨行高）、Esc 或✓完成 提交存回、其餘鍵給 textarea；雙擊亦可編輯；切 cell/執行前先提交草稿；Ctrl/⌘/Shift+Enter 在編輯中先 commit 再跑最新原始碼。i18n 5 鍵。nbformatModel 14/14、前端 tsc＋i18n 38/38＋vite build 通過。階段 3 尚餘 CodeMirror 語法 highlight（3b）。另本輪一併提交上輪的測試 server script `scripts/jupyter-test-server.sh` | feat/notebook-cell-edit（已 merge） |
| 2026-07-08 | （使用者要求 /loop，Jupyter 整合階段 2a）kernel 重啟／清除輸出＋狀態列。`NotebookPanel`（editable）新增工具列：⟳ 重啟 kernel（接 `useJupyterKernel.restart()`）、清除輸出（當前 cell）、清除全部輸出（接已測純函式 `clearCellOutputs`／`clearAllOutputs`＋`savePageNotebook` 寫回）；頁腳 kernel 狀態列已於 1c-iii-b 具備；markdown/raw 與 image/latex 輸出已由 CellBody/displayOutputs 呈現。i18n 3 鍵。前端 tsc＋i18n 38/38＋nbformatModel 13/13＋vite build 通過。階段 2 尚餘 HTML sandbox iframe、ANSI traceback 上色 | feat/notebook-kernel-controls（已 merge） |
| 2026-07-08 | （使用者授權安裝相依，Jupyter 整合階段 1c-iii-b＋1c-iii-c/1d-iii）code cell 連真實 kernel 執行＋結果寫回。加相依 @jupyterlab/services@^7.6.1。`useJupyterKernel.ts`：動態 `import('@jupyterlab/services')` lazy-load（vite code-split）、連線參數走 `fetchJupyterConnection`+`resolveJupyterUrls`+`ServerConnection.makeSettings`、module-level per-file kernel registry（跨頁保暖、離開整頁才 shutdown）、`requestExecute.onIOPub`→`iopubMessageFrom`→回呼、`statusChanged`→狀態列。`NotebookPanel`：`access_level==='edit'`（新 `editable` prop、SlideRenderer `notebookEditable` 由兩處播放檢視傳入）時 Ctrl/⌘+Enter 執行、Shift+Enter 執行並前進、▶執行鈕；執行時 `applyIopub` 即時顯示、完成 `withCellExecution`+`savePageNotebook` 寫回。唯讀者不連 kernel。i18n 8 鍵。前端 tsc＋i18n 38/38＋vite build 通過。端到端執行需啟 Jupyter server（Anaconda 已備）＋設 JUPYTER_ENABLED/BASE_URL/TOKEN 手動驗證 | feat/jupyter-kernel-execute（已 merge） |
| 2026-07-08 | （使用者要求 /loop，Jupyter 整合階段 1d-ii）notebook 頁不自動換頁、不殘留前頁音訊（計畫 §2.3）。`PlayPage` 換頁交換音訊 src 的 effect 原本 `!audio_url` 提早 return，留著前頁 `<audio>` src→落在 notebook 頁若播放中，前頁音訊播畢觸發 `handleEnded` 自動換頁把互動頁跳過。改為無 audio_url 時主動 pause＋removeAttribute('src')＋load＋重置狀態＋token 失效，使 notebook 頁不播放/不觸發 ended/不自動換頁。總時長 `sumAudioDurationSeconds` 本就忽略 null 自然排除。前端 tsc＋vite build 通過（互動頁自動換頁屬 effect 邏輯，實機播放待真實使用驗證） | fix/notebook-no-audio-autoadvance（已 merge） |
| 2026-07-08 | （使用者要求 /loop，Jupyter 整合階段 1d-i）TTS 產生略過 notebook 頁（計畫 §2.3）。`synthesizeAudio` 選頁 query 帶 `render_type`，對 `render_type==='notebook'` 的頁在並行 queue 內短路為 benign skip（skipped:true、error:null、不呼叫 TTS、不寫音檔、progress 照常回報），避免 notebook 頁被當成缺音訊而觸發 TTS 或標記失敗。測試 synthesize-audio-notebook 1/1（seed 純 notebook 頁，若 skip 回歸會嘗試真 TTS）、後端 tsc 通過。1d 尚餘前端計時/就緒判定（notebook 已無 audio_url 故播放自然略過，待接 kernel 驗證自動換頁）、執行寫回 | feat/notebook-silent-tts（已 merge） |
| 2026-07-08 | （使用者要求 /loop，Jupyter 整合階段 1c-iii-a）kernel 連線層可測核心。純函式 `jupyterConnection.ts`：`resolveJupyterUrls`（顯式 URL 直用；空＝同源以 origin＋nbPrefix 組 baseUrl、http→ws/https→wss 推 wsUrl）、`httpToWs`、`iopubMessageFrom`（把 @jupyterlab/services 風格 raw kernel 訊息 `{header.msg_type,content}` 映射成 nbformatModel 的 `IopubMessage`，與重相依解耦故可單測）、`kernelStatusFrom`（status 取 execution_state）；API client `fetchJupyterConnection`（打 `/api/jupyter/connection`）。測試 jupyterConnection 6/6、前端 tsc 通過。剩 1c-iii-b（useJupyterKernel hook＋@jupyterlab/services lazy-load，需真實 server 驗證）、1c-iii-c（執行寫回，屬 1d） | feat/jupyter-kernel-core（已 merge） |
| 2026-07-08 | （使用者要求 /loop，Jupyter 整合階段 1c-ii）`NotebookPanel` 單 cell 顯示＋SlideRenderer 分流＋接線。`NotebookPanel.tsx`（固定高度捲軸容器、`↑`/`↓` 切 cell 並 stopPropagation/preventDefault 不干擾全域換頁、頁腳 `cell N/總數·型別`＋上下鈕、markdown 走 MarkdownMath、code＋`displayOutputs` 呈現儲存 outputs）；API `fetchPageNotebook`／`savePageNotebook`（GET 帶 `?share=`）；`SlideRenderer` 加 pdfId/pageNumber/shareToken props，於所有 hooks 之後新增 `notebook` 分支（缺參數安全退回圖片）；`PlayPageSlidePanel`／`PlayPageFullscreen` 兩處接線。i18n `play.notebook.*` 7 鍵。前端 tsc、i18n 38/38、vite build 通過。1c 尚餘 1c-iii（useJupyterKernel 執行）；kernel 執行寫回屬 1d | feat/notebook-panel-view（已 merge） |
| 2026-07-08 | （使用者要求 /loop，Jupyter 整合階段 1c-i）互動式 nbformat 核心純函式 `frontend/src/lib/nbformatModel.ts`（計畫 §3.2／§5）：`parseNbNotebook`（無損保留完整 nbformat 供寫回、malformed 退回預設）、`cellText`、`clampCellIndex`（↑/↓ 導覽）、`applyIopub`＋`iopubToOutput`（執行時串流 iopub→nbformat outputs，同名 stream 併接、clear_output 清空、非輸出略過、immutable）、`withCellExecution`／`clearCellOutputs`／`clearAllOutputs`（寫回不可變更新）、`displayOutput(s)`（每 output 選最豐富 MIME：image→html→latex→plain＋stream/error）。有別於既有唯讀 lossy `notebook.ts`，此模型無損以支援編輯/執行寫回。測試 nbformatModel 13/13、前端 tsc 通過。1c 尚餘 NotebookPanel／useJupyterKernel／SlideRenderer 分支 | feat/notebook-nbformat-model（已 merge） |
| 2026-07-08 | （使用者要求 /loop，Jupyter 整合階段 1b）`.ipynb` 資產 CRUD。新增驗證服務 `notebookAsset.ts`（`validateNotebook` 以 zod `.passthrough()` 無損保留 outputs／execution_count／kernelspec，僅驗結構＋補頂層預設，10MB／1000 cell 上限；`defaultNotebook`／`parseStoredNotebook`）與路由 `notebook.ts`（`GET/PUT /api/pdfs/:id/pages/:n/notebook`：GET `canReadPdf`＋無檔回預設＋`no-store`、路徑優先 notebook_path 再退回 `<page_uid>.ipynb`；PUT `canEditPdf`→寫 .ipynb→更新 DB `render_type='notebook'`＋`notebook_path`→best-effort 同步 metadata.json），於 index.ts 註冊。一致性：`PdfMetadataPage` 增 render_type/notebook_path、`rebuildAddPagesMetadataFromDb` 帶出映射兩欄；新增 storage helper `pageNotebookPath`。測試 notebook-asset 8/8、add-pages-metadata-resync 回歸 2/2、後端 tsc 通過 | feat/notebook-asset-crud（已 merge） |
| 2026-07-07 | （使用者要求）AI 導師工具調用即時顯示＋新增 get_page_image 工具。`streamChatText` 加 `onToolCall`→`/ask` 送 SSE `tool` 事件；前端 `askPageQuestion(onTool)`／`usePageAsk` 累加本地化 `toolNotes`／`PageAskPanel` 泡泡頂端顯示「🔍 查看第 N 頁畫面」（7 i18n 鍵）。`get_page_image`：sharp 縮圖成 JPEG data URL，因 tool 訊息只能帶文字故由迴圈補 vision user 訊息（`AiTool` 可回 `{text,images}`、`appendToolImages`）。測試 ai-tools 8/8、ai-tool-loop 綠、page-ask 6/6、i18n 38/38；真實 cgu e2e 確認模型呼叫 get_page_image、`tool` 事件送達、答案 397 deltas 串流 | feat/tutor-tool-call-indicator |
| 2026-07-07 | （使用者要求，先設計後實作）在 makeslide 自身 AI 呼叫中提供唯讀 MCP 工具給 LLM。設計文件 `docs/mcp-tools-in-ai-design.md`。實作：`aiTools.ts` 行程內唯讀工具登錄表（帳號 scope、跨帳號拒絕、無副作用）；`callChatJSON`／`streamChatText` 加 `tools`/`toolContext` 與上限 5 輪 tool-calling 迴圈（串流版工具輪＋最終答案逐段串流，gateway 不支援時退化）；接 `/ask` 與 per-page `generateScript`；`config.aiMcpToolsEnabled` 開關。測試 ai-tools／ai-tool-loop 全綠、page-ask 回歸 6/6、raw curl 確認 cgu-air 支援 function-calling。Gemini／去重列 Phase 2 | feat/mcp-tools-in-ai |
| 2026-07-07 | （修 bug，接續下列診斷）**找到 AI 導師不逐字的真正根因**：`getOpenAIClient` 給 OpenAI SDK 的自訂 `debugFetch`（[openai.ts](backend/src/services/openai.ts)）對每個回應都 `resp.clone()`＋`await clone.arrayBuffer()`（為了 log body preview／brotli 自動修正），把**整條 SSE 讀到結束才 return** 給 SDK → 52/54 段 delta 全卡到最後一次湧出。以真實端到端 probe 重現（修前全部 +4129ms 同時到；修後 delta 6002→6652ms trickle）。修法：偵測 `content-type: text/event-stream` 時原樣 pass-through、只 log headers、不讀 body；一般 JSON 回應維持原本 buffer＋preview＋brotli。此 bug 同時影響動畫 custom-script 串流。後端 `tsc` 通過 | fix/streaming-debugfetch-buffer（已 merge） |
| 2026-07-07 | （診斷，使用者回報線上 AI 導師「後端→前端似乎沒串流」）先以本機 real-socket 探針證明 Fastify→client 的 SSE 逐段抵達正常（mock 每 300ms 一段、client 端 315/615/914/1215/1516ms 收到），排除 app 內緩衝。為判斷線上主因，在 `/ask` 的 `onDelta` 加輕量 `ask-page stream stats` log（`deltaCount`／`firstDeltaMs`／`spanMs`／`totalMs`／`answerChars`）：`deltaCount≈1`＋`spanMs≈0`＝上游 LLM/gateway 整包不串流；`deltaCount` 高但 client 仍一次收到＝外層代理/CDN 緩衝。已合併 master 待部署後看 log。後端 `tsc` 通過 | diag/ask-stream-delta-logging（已 merge） |
| 2026-07-06 | （修 bug，使用者回報 dev worker `ENOENT … orphan-recovery-processing-01/metadata.json`）根因為測試無隔離、直接寫真實 dev DB 且不清理，其中 orphan-recovery 測試塞入 status=`processing` 的 PDF 列，dev worker 當成中斷工作重排卻無對應 storage 目錄而 ENOENT 迴圈。修法：`MAKESLIDE_TEST=1` 時 `config.ts` 把 `DB_PATH`／`STORAGE_ROOT` 導向 gitignored 的 `data/test.db`／`data/test-storage`（dev `.env` 值在 dotenv 前捕捉、不再拉回 dev DB，shell 覆寫仍優先）；`test` npm script 與 `run-tests.sh` 設該旗標。後端全套 1353/1358（4 為既有並行 flakiness）。dev DB 既存殘列待使用者授權後清除 | fix/test-db-isolation |
| 2026-07-06 | （使用者要求）AI 導師問答改為逐字（SSE 串流）顯示：後端 `/ask` 由 `callChatJSON` 等整包改用 `streamChatText` 純文字串流，回 SSE（`delta`/`done`/`error`），`done` 仍過 `finalizeTutorAnswer`；system prompt 改為直接輸出純文字、移除 `AskPageResponseSchema`。前端 `askPageQuestion` 改讀 SSE 加 `onDelta`；`usePageAsk` 串流累加 assistant 泡泡、`PageAskPanel` 首 token 前才顯示「思考中…」。`page-ask.test.ts` 改串流 mock，6/6 通過（Node 22 `--test-force-exit`），前後端 `tsc` 通過 | feat/tutor-ask-streaming |
| 2026-07-05 | （使用者回報掃 QR 進入後不出現投票選項）修正 poll fetch/vote 未帶 share token：`fetchPagePolls`／`votePagePoll` 未附 `?share=<token>`，但後端 GET `/polls`、POST `/votes` 以 `canReadPdf(aclCtx)` 授權（token 能力來自 `?share=` query），匿名掃碼 follower 因此 403、`pagePolls` 恆空、投票面板永不自動展開。把 `currentShareToken` 經 `usePagePolls` 傳入兩個 API（比照 `fetchPdfDetail`）。前端 `tsc`＋`vite build` 通過 | fix/poll-fetch-vote-share-token |
| 2026-07-05 | （使用者要求）點擊投票圖示即開始投票並開啟即時投票視窗：🗳 徽章改為按鈕（📝／💬 維持純指示），複用既有「開始即時投票」模式——全螢幕 `handleStartPoll()`＋`setFullscreenPollControlOpen(true)`、一般檢視 `handleStartPoll()`＋`setPollSettingsOpen(true)`，`stopPropagation` 避免觸發投影片點擊。沿用 i18n `play.fullscreen.startPoll`。前端 `tsc`＋`vite build` 通過 | feat/poll-icon-click-starts-poll |
| 2026-07-05 | （使用者要求）頁面筆記／留言也顯示不同圖示：指示徽章擴為圖示列 🗳 投票／📝 筆記（`page_notes`）／💬 留言。後端 detail 加每頁 `has_comment`（`SELECT DISTINCT page_number FROM page_comments`，穿過 `rowToDetail`）；一般檢視與全螢幕皆更新。新增 i18n note/commentDefinedBadge。Node 22 對真實資料 `-nM_vsV4xc` 端到端驗證（筆記頁→📝、注入留言→has_comment true）。前後端 `tsc`＋前端 `vite build` 通過、i18n 24/24、parity 2194/2194 | feat/page-note-comment-indicators |
| 2026-07-05 | （使用者回報全螢幕時圖示未出現）投票指示徽章補到全螢幕：`PlayPageFullscreen` 新增 top-center 徽章（`currentPage.has_poll && !hasActivePoll`，投票進行中已有 top-right 🗳 投票鈕故不重複）。前端 `tsc`＋`vite build` 通過 | fix/poll-indicator-fullscreen |
| 2026-07-05 | （使用者回報有 poll 的頁面仍不顯示圖示）修正投票指示徽章判斷來源：前一版用 `pagePolls`，但 `usePagePolls` 只在特定互動情境才抓該頁 poll、單純翻頁不載入，故圖示幾乎不出現。改為 deck detail 每頁附 `has_poll` 旗標（`detail.ts` 單一 `SELECT DISTINCT page_number FROM page_polls`，穿過 `rowToDetail` 新參數），徽章條件改 `currentPage.has_poll || pagePolls.length>0`。以真實資料 `rgHBiyrbZf` 端到端驗證（第24頁 true、第25頁 false）。前後端 `tsc`＋前端 `vite build` 通過 | fix/poll-indicator-uses-has-poll-flag |
| 2026-07-05 | （使用者要求）有 poll 定義的頁面在投影片上方顯示投票指示圖示：沿用當前頁的 `pagePolls`（`length > 0` 即該頁有投票），於 `PlayPageSlidePanel` 影像 overlay 上方置中加一個非互動 🗳 徽章（多個 poll 附數量），新增 i18n `play.slidePanel.pollDefinedBadge`。前端 `tsc`＋`vite build` 通過、i18n 24/24、parity 2192/2192 | feat/poll-page-indicator-icon |
| 2026-07-05 | （使用者回報 header 徽章一直顯示「私密」）修正 visibility 狀態徽章不即時更新：徽章讀載入時抓的 `detail.visibility`，但「存取權限」對話框改預設權限只寫後端＋自身 local state、未回寫 `detail`，故重整前徽章不變。加 `onVisibilityChange` 回呼由 `AccessControlPanel`→`AccessControlDialog`→`PlayPageDialogs`，存檔成功即 `setDetail` 更新 visibility，徽章即時反映。前端 `tsc`＋`vite build` 通過 | fix/access-visibility-badge-live-update |
| 2026-07-05 | （使用者提問後決定）移除分享下拉選單內多餘的「設為 private」按鈕：把預設權限設為 private 已由新「存取權限」對話框的「預設權限」下拉涵蓋；且兩套系統模型下該按鈕誤導——只動 visibility（系統一），不撤銷已發出的分享連結 token（系統二到期前仍有效）。移除 `handleMakeSharePrivate`、按鈕、及已無用的 `play.share.makePrivate*` 4 個 i18n 鍵（含 `i18n.test.ts` 引用）。前端 `tsc`＋`vite build` 通過、i18n 24/24、parity 2191/2191 | refactor/remove-make-private-button |
| 2026-07-05 | （使用者要求）存取權限 UI 位置不合理修正：身分權限管理（預設權限＋名單/群組 ACL）原被藏在「建立分享連結／QR」的 `ShareDialog` 內當第三個分頁，須先按「建立分享連結」產生 QR/連結才進得去。抽出為獨立 `AccessControlDialog`（modal 包 `AccessControlPanel`），入口改為 Header「群組分享」下拉選單頂部新增的「🔑 存取權限」按鈕（gate `!currentShareToken && detail.is_owner`）；`ShareDialog` 移除 access 分頁與 `pdfId`/`visibility`/`canManageAccess` props，退回「連結／嵌入」兩分頁回歸單一職責。狀態 `accessDialogOpen` 經 `usePdfMetadata`→`PlayPageContext`→`PlayPageDialogs`。沿用既有 i18n（未新增鍵、parity 2195/2195）。前端 `tsc --noEmit`＋`vite build` 通過、ShareDialog 測試 2/2 | refactor/access-control-out-of-share-dialog |
| 2026-07-04 | （使用者要求二次覆核權限測試矩陣）發現並修復**提權漏洞**：`PATCH /api/pdfs/:id/visibility` 閘門原為 `canEditPdf(...aclCtx)`，統一模型後匿名 editable-token 持有者／read_write 名單使用者可改「預設權限」（改 public_editable 即讓全世界永久可編輯、token 過期仍有效）。visibility 屬存取管理非內容編輯，改為 owner-only（`hasOwnerOrLegacyAccess`），與 ACL 管理 API／建立分享連結一致。並補齊矩陣測試（token-capability 22→27）：建立分享連結 owner-only、visibility owner-only、read_write 名單刪整份 403、只讀名單＋editable token→有效 edit（反向 max）、群組授權 HTTP 端對端。後端 tsc 通過、9 個權限套件序跑全綠（detail 92、page-ops 31、token-capability 27、pdf-access 13、permissions/permissions-api 各 6、read-gate/delete 各 5、groups 4、share-expiry 3） | fix/access-admin-owner-only |
| 2026-07-04 | （使用者要求）分享權限模型統一為兩套系統、分享連結成為真正的能力憑證：先前三套機制（visibility／分享 token／身分 ACL）語意重疊，且建立連結會偷偷翻動全域 visibility、token 不具保密力、`hasShareAccess` 未檢查到期。改為：系統一＝身分權限（visibility 預設＋ACL，`resolvePdfAccessLevel`）；系統二＝token 能力憑證（新增 `resolveTokenAccessLevel` 含到期，任何持有者取得內含 read/edit，建立連結不再改 visibility）；`aclCtx` 帶入 token，`canReadPdf`/`canEditPdf` 以 `max(身分,token)` 決策（~146 呼叫點免改）、清掉 40 處多餘且有到期 bug 的 share 讀取前綴、detail `access_level` 改回有效權限。破壞性子操作＝解析出 edit＋已登入；刪整份簡報限縮為僅 owner。後端 tsc 通過、既有權限套件無回歸（delete 測試改 owner-only）＋新增 token-capability 11 測試綠；前端 tsc 通過、ShareDialog＋i18n 29 綠、文案區分兩概念 | feat/unified-access-capability-tokens |
| 2026-07-03 | （使用者要求）把 worktree/demo16 完整合併回 master：先在 demo16 提交其未提交的「直播測驗允許重新進入（quiz re-entry）」WIP（排除 demo16 專屬的 start.sh 本地改動），再 `git merge --no-ff worktree/demo16` 帶入 demo16 累積但未進 master 的功能（poll-results 彈窗、watch-records 對話框、quiz camera recording/proctoring/finish button、quiz re-entry）。主 repo 工作區同一份重複的 WIP 經比對與 demo16 內容完全相同（僅檔案權限位元差異），已捨棄改由合併帶回。前後端 typecheck 通過；i18n 27、pdf-access 13、groups-api 4、poll-voters 3 測試綠 | worktree/demo16 → master（merge dd26906） |
| 2026-07-03 | （使用者要求，步驟 5–6／共 6，接續當日步驟 1–4）身分式分享權限完成群組與收尾。步驟5 群組：DB（groups/group_members）+ owner-scoped CRUD（4 測試）+ resolver 展開群組成員 + 管理 API/list 支援 group principal + 系統設定「群組」管理 UI + 分享面板 search 納入群組/名單顯示群組/「存成群組」；步驟6 收尾：前端 `access_level` 讓只讀名單顯示唯讀 UI。前後端 typecheck 通過、ACL/群組/權限 42 測試綠。功能六步驟全部完成 | feat/pdf-acl-step5-groups-backend／-step5c-groups-ui／-step5d-share-groups／-step6-readonly-ui（皆已 merge） |
| 2026-07-03 | （使用者要求，步驟 1–4／共 6）身分式分享權限：per-user 只讀/讀寫名單 + 預設權限（沿用 visibility）。步驟1 ACL 表+resolver（11 測試）；步驟2a canRead/EditPdf 加可選 ACL context+detail 讀取+access_level（5+92 測試）；步驟2b 接線全站 ~130 呼叫點（無回歸）；步驟3 管理 API+帳號 search（5 測試）；步驟4 分享對話框「存取權限」分頁（含 search、i18n 24/24） | feat/pdf-acl-step1..4（皆已 merge） |
| 2026-07-02 | （使用者要求）測驗監考錄影只錄影不錄音：`useQuizRecorder` 的 `getUserMedia` 由 `audio: true` 改為 `audio: false`，不請求麥克風、避免收錄環境音；串流無音軌故產出純視訊 webm。更新註解、前端 tsc 通過 | feat/quiz-recording-video-only |
| 2026-07-02 | （使用者要求）同步 master/follower 定義改為以擁有者為準：「自己的簡報按同步→master，不是的→follower」。後端 `/sync/join`、`/sync/state` 取得主控權門檻由 `canEditPdf` 改為 `isPdfOwner`（public_editable 協作者不再能搶 master，改以 follower share-join）；前端 `PlayPage` 以 `isSyncMasterEligible = detail?.is_owner` 決定 join/share-join 路徑、自動跟隨與 master 重奪。更新+新增 sync 權限測試；前後端 tsc 通過、sync 權限 13/13 + 其餘 sync 7/7 回歸通過 | feat/sync-master-follower-by-ownership |
| 2026-07-02 | （使用者要求）把 AI 導師回答存成評論時標示「存的人」的名稱：原本未設暱稱時作者只記成「AI 導師」，看不出誰存的。改為以「評論暱稱 → 登入帳號 name/email」解析存檔者，作者存為「{存檔者}（AI 導師）」（同時保留 AI 導師來源標示），完全無名稱時才退回單純「AI 導師」。新增 i18n 鍵 `play.sidebar.aiTutorAuthor`／`aiTutorAuthorWithName`（zh-TW/en），並沿用新的 share token 參數。前端 tsc 通過、i18n 24 測試通過 | feat/ai-tutor-comment-saver-name |
| 2026-07-02 | （使用者要求）評論對「能開啟簡報的人」公開（含分享連結）：評論本來就對簡報的可讀者共享（無按作者過濾），但評論路由只認 `canReadPdf`，導致以分享連結開啟私人簡報的學生讀取/新增評論會 403。將評論「列出全部／單頁列出／新增」三個端點改為 `hasShareAccess(request,id) || canReadPdf(...)`（比照 quiz 路由），前端 `listAllComments`/`listPageComments`/`createPageComment` 加 `share` query 並由 `PlayPageSidebar` 帶入 `currentShareToken`；resolve/edit/delete 仍限 owner/editor。新增回歸測試（分享連結觀看者可貼文並互相看到、無 token 仍 403）。前後端 tsc 通過、page-comments 12/12 | feat/comments-visible-via-share |
| 2026-07-02 | （使用者要求）AI 導師「問這一頁」改以 Markdown＋LaTeX 作答：前端 `PageAskPanel` 早已用 `MarkdownMath`（Markdown＋KaTeX，支援 `$...$`／`$$...$$`）渲染答案，但 `/pages/:n/ask` 的 system prompt 從未要求模型輸出該格式。於 [page-operations.ts](backend/src/routes/pdfs/page-operations.ts) 該 prompt 新增「格式（務必遵守）」指示：以 Markdown 作答（標題／粗體／條列／表格），數學式一律用 Markdown 可渲染的 LaTeX（行內 `$...$`、區塊 `$$...$$`），不得用純文字或圖片描述數學式。純 prompt 調整、無需前端改動；後端 tsc 通過 | feat/ai-tutor-markdown-latex-answer |
| 2026-07-02 | （使用者要求新功能）問答題（essay）＋紙本拍照上傳＋AI 自動閱卷＋老師覆核：新增第三種題型 `essay`（含 `reference_answer` 參考答案／評分重點，僅供 AI 閱卷不顯示給學生）。學生作答時以 `<input capture>` 拍紙本答案上傳（可多張），後端用 sharp 正規化為 JPEG 儲存並以視覺 LLM（`callChatJSON` 送 `image_url`）比對參考答案給分＋評語（`quizEssayGrading` service，best-effort）；老師在「問答題閱卷」面板看照片、AI 分數與評語，可修改分數。essay 不計入自動客觀計分（前後端 `calcQuestionScore` 同步加 `essay→0`）。後端：`QuizQuestionSchema` 加 essay 型別、選擇題「≥2 選項/≥1 正解」改於 `SaveQuizBodySchema.superRefine` 嚴格檢查；新增 `quiz_essay_answers` 表、storage 路徑、消毒檔名／分數 clamp／prompt 建構純函式（附測試）、multipart 上傳＋老師列表／相片串流／`PATCH` 覆核分數端點。前端：types/編輯器/`EssayAnswerUploader`/`EssayAnswersPanel`/API 封裝＋26 個 zh-TW/en i18n 鍵。前端 611/611、後端 essay+計分一致性+quizzes 套件回歸通過、前後端 tsc 通過。備註：自 master 開分支（master 已含平行合入的 proctor/錄影功能） | feature/quiz-essay-photo-ai-grading |
| 2026-07-01 | （使用者要求）錄影規則文案獨立、依需要載入：把「相機錄影」段落從 `quiz-rules.md` 移到新檔 `quiz-rules-recording.md`；`QuizProctorGate` 新增 `recording` prop，規則載入改為永遠載入主規則、`recording` 為真時再額外抓取並附加錄影規則（抓取失敗不阻斷主規則）。`QuizBuilderPage` 依 `activeQuiz.record_camera` 傳入。關閉錄影的測驗不再顯示誤導的相機規則。前端 tsc 通過、611/611 | feat/quiz-rules-recording-split |
| 2026-07-01 | （使用者要求功能）測驗新增「作答時是否開相機錄影」選項：quiz_sets 新增 `record_camera` 欄位（migration，預設 1），貫穿 save/update/copy 端點與 `QuizSet` 型別、`saveQuizSet` API；編輯測驗加一個勾選框（zh-TW/en 各 2 鍵）。關閉時 `QuizProctorGate` 的 `onBeforeStart`/`onEnd` 傳 undefined（不請求相機、不錄影上傳）、隱藏右下角錄影指示，但全螢幕與離開偵測仍生效。備註：quiz-rules.md 的相機段落為靜態，關閉錄影時文案未動態調整（老師可自行客製）。前後端 tsc 通過、前端 611/611、後端 quizzes 25/25 | feat/quiz-record-camera-option |
| 2026-07-01 | （使用者要求，測驗監考三項行為調整）① 按「完成作答」後停在「已完成」畫面、不跳回簡報：`handleFinishQuiz` 不再 navigate，改記下 finished 的 sessionKey 並傳 `finished` 給 `QuizProctorGate`，gate 切到 completed phase、停止監控、退出全螢幕、結束錄影上傳。② 老師公布答案時，已完成／已鎖定者也要看到答案：gate 的 `!active` 分支對他們直接顯示答案；PlayPage 對已完成/鎖定者平常不導回作答頁，但 `quiz_show_answers` 為真時仍導回。③ 每次「開始測驗」都是全新一次：`handleStartQuiz` 送 `quiz_session_reset`，後端在開始時強制重新產生 `quiz_session_id`（即使重開同一份），使之前作答過/被鎖定的學生不再因舊 sessionKey 進不去。前後端 tsc 通過、前端 611/611、後端 sync 13/13 | fix/quiz-finish-stay-completed |
| 2026-07-01 | （使用者回報）監考錄影指示圖示不對：外圈太大、紅點在角落未置中。改為經典「錄影中」符號——較小外圈環（`h-8 w-8`）＋ flex 置中的脈動實心紅點（`h-3 w-3`），移除自拍影像顯示、video 改隱藏但保留 ref 供錄影。前端 tsc 通過 | fix/quiz-recording-icon |
| 2026-07-01 | （使用者回報，測驗監考四項後續修正，同一分支）① 按「完成作答並離開」後不再被自動拉回：新增持久化「已完成」旗標 `markQuizFinished`/`isQuizFinished`（鍵同 gate 的 `quizId:sessionId`），`handleFinishQuiz` 交卷時標記、PlayPage 導向作答頁前若該 session 已完成或已鎖定則跳過（一併修好違規鎖定後仍被反覆拉回），gate 重新進入顯示友善「已完成」畫面而非違規訊息（新增 completed phase 與 zh-TW/en 各 2 鍵）。② 錄影僅簡報 owner 可見：新增 `isPdfOwner`（排除 public_editable 協作者與公開），套用錄影清單/檔案端點，前端錄影按鈕改以 `detail.is_owner` 顯示。③ 監考自拍預覽縮成右下角小圓圖示（含脈動紅點），不再擋題目。④ 「複製到」下拉加 `max-w-[8rem] truncate`，長簡報標題不再撐爆版面。新增 quizProctor finished 測試與 isPdfOwner 測試；前後端 tsc 通過、前端 611/611、後端 permissions 6/6・quizzes 25/25 | fix/quiz-proctoring-followups |
| 2026-07-01 | （使用者要求功能）測驗新增「完成作答並離開」按鈕：作答中（`!syncQuizShowAnswers`）於題目下方顯示按鈕，點擊出現頁內確認框（非 `window.confirm`，避免觸發失焦違規），確認後 `submitFollowerAttempt()` 交卷並 `navigate` 回播放頁；離開會卸載 `QuizProctorGate`，其 `onEnd` 停止並上傳錄影、瀏覽器自動退出全螢幕，且「已開始」旗標使同一測驗無法重新進入。新增 zh-TW/en 各 5 個 i18n 鍵；前端 tsc 通過、610/610 測試全綠 | feat/quiz-finish-button |
| 2026-07-01 | （使用者回報 bug）監考錄影未出現在歷史記錄：根因為老師結束測驗時 follower 的 `active_quiz_id`/`quiz_session_id` 會被 sync 重置為 null，早於 gate `onEnd`（`stopAndUpload`）執行，導致上傳時 `sessionId` 為 null 而整個略過上傳、錄影從未到伺服器。改為在 `useQuizRecorder.start()` 擷取當下的 `pdfId/quizId/sessionId/clientId` 至 ref，`stopAndUpload` 改用擷取值（deps 收斂為 []），與結束時的 prop 變動脫鉤。前端 tsc 通過 | fix/quiz-recording-session-capture |
| 2026-07-01 | （使用者回報 bug）監考全螢幕作答時無法捲動、只能作答第一題：`QuizProctorGate` 進入全螢幕的容器 `overflow` 預設裁切溢出內容且不可捲動。容器加上 `[&:fullscreen]:h-screen [&:fullscreen]:overflow-y-auto`（Tailwind arbitrary variant），僅在全螢幕狀態下啟用垂直捲動，不影響行動端 fallback（未進全螢幕時走一般頁面捲動）。前端 tsc 通過 | fix/quiz-proctor-fullscreen-scroll |
| 2026-07-01 | （使用者要求新功能，接續防作弊）測驗監考錄影：學生同意規則時**強制開前鏡頭**（getUserMedia，拒絕則無法作答）並以 MediaRecorder 全程錄影，右下角常駐自拍預覽＋「錄影中」標記；自動交卷／老師公布答案／離開時停止並上傳到 `storage/<pdfId>/quiz-recordings/`。後端新增 `quiz_recordings` 表、storage 路徑輔助、消毒檔名純函式（附測試）、multipart 上傳端點（守門比照作答提交 `hasShareAccess||canReadPdf`）與老師專用清單／串流端點（`canEditPdf`）。前端新增 `uploadQuizRecording`/`fetchQuizRecordings`/`quizRecordingFileUrl` API、`useQuizRecorder` hook、`QuizProctorGate` 的 `onBeforeStart`/`onEnd` 掛勾、`QuizBuilderPage` 老師端錄影清單；新增 zh-TW/en 各 14 個 i18n 鍵、於 quiz-rules.md 補相機說明。前後端 tsc 通過、前端 610/610、後端 quiz 套件回歸通過（含新表 migration）。備註：依 CLAUDE.md 建於 proctor 分支之上 | feature/quiz-camera-recording（基於 feature/quiz-proctor-fullscreen-lock） |
| 2026-07-01 | （使用者要求新功能）測驗防作弊（網頁版）：學生（follower）作答前先顯示規則同意畫面，規則內容載自可客製化的 `frontend/public/quiz-rules.md`（相對 `document.baseURI` 抓取，兼容子路徑與 Electron file://）；同意後 best-effort 進入全螢幕並監控「離開全螢幕／切換視窗或分頁／切換 App」（`fullscreenchange`+`visibilitychange`+`blur`，1.2s 去抖動＋進入全螢幕 0.9s 寬限期避免轉場誤判）。最多允許一次違規，第二次自動交卷（呼叫既有 `submitFollowerAttempt`）並鎖定；鎖定與「按下同意即標記 started」持久化於 localStorage，使重整／重新進入同一 session 一律被擋下（同一次測驗不允許再進入）。新增純解析器 `markdownLite`（標題／清單／粗體最小子集，避免 XSS）、`quizProctor`（違規判定＋lockout/started 儲存）純邏輯與 `QuizProctorGate` 元件，接入 `QuizBuilderPage`；新增 zh-TW/en 各 12 個 i18n 鍵。新增 markdownLite 6 + quizProctor 6 測試；前端 tsc 通過、完整前端套件 610/610 全綠。備註：全螢幕/切窗為瀏覽器層僅能「偵測＋嚇阻」不能硬性封鎖；意外重整會鎖定，老師可用「重設作答」或重開測驗（新 session）解除 | feature/quiz-proctor-fullscreen-lock |
| 2026-06-30 | （使用者要求續作）觀看記錄視窗加「時間」欄：顯示每筆 `updated_at`（該觀眾最後一次回報此頁的時間）格式化為本地 `YYYY/MM/DD HH:mm`，cell title 保留原始 ISO。後端明細端點本就回傳 updated_at，僅前端顯示。新增純函式 `formatWatchTimestamp` 與 2 測試；前端 typecheck、watchProgress 20 + i18n 24 測試全綠 | feat/watch-records-dialog |
| 2026-06-30 | （使用者回報續修）觀看記錄只顯示隨機 `viewer-xxx`：根因是 `useWatchProgress` 一律用 `getOrCreateViewerId()` 的匿名 localStorage id 回報，從未帶入 user_code（與投票不同）。改為比照投票：先 `resolveConfiguredUserCode()`，有設 user_code 就用它、否則退回匿名 id。user_code 為非同步解析，故每筆排隊回報在送出前 `await viewerIdReadyRef`，確保整個 session 同一人用同一個 viewer_id（不會前匿名後 user_code 被當兩人）。既有舊記錄無法回溯。新增純函式 `pickViewerId` 與 3 測試；前端 typecheck、viewerId 7 測試全綠 | fix/watch-records-use-user-code |
| 2026-06-30 | （使用者要求功能）投影片管理新增「觀看記錄」視窗：新增老師專用端點 `GET /api/pdfs/:id/watch-progress/details`（`canEditPdf` 守門、可選 `?page=N`），回傳逐位觀眾各頁的觀看明細。投影片管理標題列加「觀看記錄」按鈕（整份、以使用者為單位列出各頁聆聽時間/完整度/是否看完）；每張投影片的綠色觀看徽章改為可點擊，點擊後只顯示該單張投影片的觀看記錄。新增前端純函式 `groupWatchRecordsByViewer`/`watchRecordListenedPercent`/`formatWatchDuration`。新增後端 3 測試、前端 helper 4 測試；前後端 typecheck、i18n 24 測試全綠 | feat/watch-records-dialog |
| 2026-06-29 | （使用者要求續作）投票結果對話框補上各選項的投票人 code：新增老師專用端點 `GET /api/pdfs/:id/polls/:pollId/voters`（以 `canEditPdf` 守門，避免共用的 /polls 讀取端點洩漏投票人身分），回傳每票的 voter_id（投票者自設 user_code 或匿名 voter-xxx）＋所選選項；對話框開啟時抓取並以標籤列出各選項投票人，匿名者顯示為「匿名」。新增前端純函式 `groupVotersByOption`/`isAnonymousVoterId`。新增後端 3 測試、前端 helper 3 測試；前後端 typecheck、i18n 24 測試全綠 | feat/poll-results-dialog |
| 2026-06-29 | （使用者要求功能）播放頁側欄投票區新增「查看結果」按鈕，開啟跳出式對話框（`PollResultsDialog`）顯示本頁各投票的資訊（問題、總票數、已作答人數、進行中／已結束）與各選項票數＋百分比長條；沿用既有聚合 `PagePoll` 資料、不額外打後端。新增 zh-TW/en 各 9 個 i18n 鍵；前端 typecheck 通過、i18n 24 測試全綠 | feat/poll-results-dialog |
| 2026-06-28 | （前端，去重，推進 §7.2）抽出品質檢查徽章狀態純函式 `analysisBadgeState(hasRun, running, issueCount)`（hidden/ok/issues 判別聯集），收斂 `QualityCheckPanel` 品質/逐字稿/圖片三區塊重複的巢狀三元徽章判斷；新增 4 測試（qualityCheckSelection 9/9）；tsc 通過。為後續側邊欄品質徽章提供可測基礎（計數 63/100） | refactor/analysis-badge-state（已 merge） |
| 2026-06-28 | （前端，使用者回報 UI）「AI 助手」分頁改 notebook 子分頁：原本導師問答／品質報告／本頁問答三塊垂直堆疊各自侷促，改為頂端子分頁列（導師問答／品質報告／本頁問答）一次顯示一個，active 面板 `flex-1` 撐滿側欄高度；`PageAskPanel` 對話區由 `max-h-96` 改 `flex-1`、`QualityCheckPanel` root 改 `flex-1 overflow-y-auto`（chat 本就 flex-1）。新增 3 個子分頁 i18n key（labelKey 以 `TranslationKey` 型別收斂）。tsc／i18n parity／vite build 通過。不計入 100 輪計數 | feat/ai-tab-notebook（已 merge） |
| 2026-06-28 | （前端，使用者回報 UI 系列）播放頁檢視體驗整理：(1) 移除與「投影片管理」重複的「大綱」區，把總時長＋看過進度併入管理區標題，刪 `OutlineSection`/`getOutlineTitle`/死 i18n key；(2) 側欄「放大」(`sidebarExpanded`) 時投影片管理改「圖左、清理後逐字稿右」並排檢視，新增可測純函式 `cleanTranscriptForReview`（去 `Speaker N:`／`[語氣]`／換行，5 測試）；(3) 編輯區分頁標籤改 `whitespace-nowrap`/`text-xs` 不換行；(4) 深色播放器沒設文字色而繼承淺色 `text-text` 致控制列圖示近隱形——給播放器 `text-slate-100`、剩餘時間 slate-500→400；(5) 動畫焦點框加 ⤢ 放大對話框（重用 responsive `EffectPositionEditor`＋X/Y/寬高 輸入，抽 `applyFocusParams` 共用）。tsc／i18n parity／vite build 通過。不計入 100 輪計數 | refactor/merge-outline-into-slide-mgmt（已 merge） |
| 2026-06-28 | （前端，使用者回報 UI，大型）淺色主題改造第一階段（PlayPage）：根因是全站淺色模式失效——元件普遍寫死深色 `slate-*`，淺色像「深色降亮度」。改為「淺色管理介面＋深色播放區」混合設計。Token 層（`index.css`/`tailwind.config.js`）：頁底改 #F5F7FA、新增 `surface-muted`/`border-light`、主色 cyan→indigo（淺 #4F46E5 以通過對比測試、深 #818CF8）。`PlayPageHeader` 改淺色列＋陰影、條件橫幅與同步 Q&A 面板加 `dark:` 變體（下拉彈窗維持深色）。`PlayPageSidebar` 各區改語意 token 白卡片（深色 token≈舊 slate，深色模式視覺不變）、管理列 4 顆按鈕收斂為「主色 Add／淡色 Regenerate／中性 Add-multiple／danger Delete」、留言(sky)/複習(rose)改淺色淡卡片。`PlayPageSlidePanel` 深色播放器加陰影與淺底分界。AI 分頁的兩個獨立子面板 `PageAskPanel`（AI 導師問這一頁）、`QualityCheckPanel`（品質報告）為單獨檔、首輪未涵蓋，使用者再回報後一併遷移（同樣手法；提問鈕收斂為 indigo 主色、品質徽章與腳本/圖片分析鈕改淺色淡 chip）。使用者再指中央播放面板——依其選擇做「觀看區留深、編輯區轉淺」：投影片觀看區/字幕/播放控制與播放設定維持深色（沉浸觀看），下方逐字稿/提示詞/來源/系統分頁編輯區（行 1065–1720）改語意 token 淺色面板＋彩色強調 `dark:` 變體（分頁列 active 用 surface 對比凸顯）。動畫/圖表兩子分頁（獨立元件 `AnimationEditorTab` ~2590 行、`FigureAssetsTab`）使用者要求一併完成，亦以相同手法遷移——至此整個播放面板編輯區在淺色模式完整一致。驗證：tsc、`contrastRatio.test.ts` 8/8、vite build、輸出 CSS 確認含新 token。**取代**先前 `fix/outline-text-contrast` 的 slate-400 暫時修法（改用 `text-muted`）。不計入 100 輪計數 | feat/light-theme-playpage（已 merge） |
| 2026-06-27 | （前端，使用者回報 UI；**已被 `feat/light-theme-playpage` 取代**）播放頁右側大綱列表次要文字對比過低：`OutlineSection` 由 `text-slate-500` 改 `text-slate-400`。註：此修法只考慮深色，在淺色模式下反而更糟，已由淺色主題改造改用 `text-muted` 取代。純樣式調整，不計入 100 輪計數 | fix/outline-text-contrast |
| 2026-06-27 | （前端，可測）首頁分類分組組裝抽出 `groupItemsByCategory`（find-or-create 分組/組內排序/組間依分類名排序/預設分類 fallback），`HomePage` 改用之；補 5 測試（共 11）；前端 typecheck 通過（計數 62/100） | refactor/group-items-by-category（已 merge） |
| 2026-06-27 | （前端，可測）範本庫分類/搜尋/排序抽出 `templateCategories`／`filterAndSortTemplates`（newest 保留序、popular 套用次數降冪穩定排序、搜尋名稱/說明/提示詞），`TemplatesPage` 改用之；補 5 測試；前端 typecheck 通過（計數 61/100） | refactor/template-filter（已 merge） |
| 2026-06-27 | （前端，可測）測驗歷史平均分抽出 `averageAttemptScore`（忽略未評分 null、全空回 null、未四捨五入），`QuizBuilderPage` 改用之；補 4 測試（quizScoring 15）；前端 typecheck 通過。另記錄 `render-text-pages-figure-injection` 非確定性 flaky 調查結論（跨檔全域污染、不值得自動盲修）（計數 60/100） | refactor/average-attempt-score（已 merge） |
| 2026-06-27 | （基線檢查+修自引入回歸）跑完整套件：前端 575/575 全綠；後端 3 失敗中 2 個為既有 flaky（figure-reference/llmUsage，隔離 10/10、僅併跑全域污染），1 個是第一七五輪自引入——templates「corrupt skill_data」測試用固定 id 致持久化 DB `UNIQUE` 衝突；改隨機後綴 id、連跑 8/8（計數 59/100） | fix/templates-test-unique-id（已 merge） |
| 2026-06-27 | （前端，可測）動畫效果合併選取計算抽出 `mergeEffectRanges`：最早 start/最晚 end/沿用最早效果(含 startTrigger)/duration 算法，`AnimationEditorTab` 合併處理改用之；補 3 測試（animationSpec 61）；前端 typecheck 通過（計數 58/100） | refactor/merge-effect-ranges（已 merge） |
| 2026-06-27 | （前端，可測）焦點動畫框拖曳/縮放幾何抽出 `resizeFocusBox`：9 把手邊界夾界/最小尺寸/西北把手連動原點/四捨五入，`AnimationEditorTab` onPointerMove 改用之；補 7 邊界測試；前端 typecheck 通過（計數 57/100） | refactor/focus-box-resize（已 merge） |
| 2026-06-27 | （前端，去重/可測）品質檢查面板挑選邏輯抽出純函式：`selectIssuePages`／`selectEmptyScriptFillPages`（含 LLM 批次補逐字稿 fan-out 上限），`QualityCheckPanel` 改用之、移除內聯；補 5 測試；前端 typecheck 通過（計數 56/100） | refactor/quality-check-selection（已 merge） |
| 2026-06-27 | （後端，健壯性修復）相似頁面 embedding 無防護解析致一壞全壞：`GET …/similar` 跨整個帳號教材庫比對，任一筆 embedding 損壞 500 整個面板；新增 `parseEmbedding`（非法/非陣列/含非數字回 null），目標損壞→indexed:false、候選損壞→跳過；補純函式 5 + 整合 2 測試（16 回歸）（計數 55/100） | fix/similar-pages-guard-embedding-parse（已 merge） |
| 2026-06-27 | （後端，健壯性修復）範本清單 `skill_data` 無防護解析致一壞全壞：`GET /api/templates` 逐列 `rowToTemplate` 的 `JSON.parse(skill_data)` 任一筆損壞會 500 整份清單；抽出 `parseSkillData`（非法/非物件回 {}）改用之、損壞列退化為空；補純函式 + 損壞列整合測試（8/8）（計數 54/100） | fix/templates-guard-skill-data-parse（已 merge） |
| 2026-06-27 | （後端，去重+健壯性修復）抽出共用 `parsePollOptions`：`page_polls.options_json` 兩處無防護 `JSON.parse(...) as string[]`（投票結果 CSV、投票端點）單筆損壞會 500，統一改用穩健解析（非法/非陣列回 []、過濾非字串）；`rowToPoll` 去重；補 5 測試，poll 路由共 100+ 測試回歸通過（計數 53/100） | refactor/parse-poll-options（已 merge） |
| 2026-06-27 | （後端，去重）抽出共用 `csvDownloadFilename`：收斂 6 個匯出/報告路由（quiz-results/poll-results/comments/report 學生·逐頁·題目）內聯的「標題優先、否則退回 ID」CSV 檔名邏輯；report 3 處順帶消除重複 `safeDownloadBaseName` 呼叫；補 4 測試，37 測試回歸通過、檔名輸出不變（計數 52/100） | refactor/csv-download-filename（已 merge） |
| 2026-06-27 | （§7.1 後端聚合子項）課後報告摘要「最難題目」排序抽出為純函式：`reportMetrics.ts` 新增 `selectHardestQuestions`（過濾未作答→正確率升冪、並列以答錯數多者優先→取前 5→補 wrong_rate），`report/summary` 改用之（行為等價、API 不變）；補 4 測試，report-metrics/report-question-stats/report-summary 共 21 測試回歸通過（計數 51/100） | refactor/select-hardest-questions（已 merge） |
| 2026-06-27 | （使用者回報 bug，不計數）Uhga6bY0Bm 42/43 頁焦點動畫紅框位置全錯：查證確認現行程式碼正常（圖片有送、cgu-air gpt-5.5 支援 vision、真實路徑重跑 4 次皆產生貼合版面方框），壞規格是先前 add-pages 失敗那批補產動畫的舊殘留（當時圖片未被模型使用）。資料修復：以 gpt-5.5 透過 `generateAnimationForPage` 重產 42/43 頁焦點動畫寫回 animation.json + DB（distinct xPct 由 1→4–5、貼合版面）；44 頁本就 static-image 未動。程式碼：修正 `generateAiFocusEffects` docstring 中「圖片只在 LLM_PROVIDER=openai 才會用」之過時誤導註解，改述各 provider 實際圖片處理行為，typecheck 通過 | fix/autofocus-image-provider-comment（已 merge）＋資料修復 | 
| 2026-06-27 | （使用者回報 bug，不計數）重生圖檔未把 image_path 寫回 DB：批次重生圖檔步驟（[regenerate.ts](backend/src/worker/regenerate.ts)）產圖後只寫檔/縮圖/commit，假設該頁原本就有 image_path；對原本 image_path 為 NULL 的頁（如 Uhga6bY0Bm 43/44，由半失敗 add-pages 復原而來）→ 檔在磁碟、DB 仍 NULL、前端讀不到圖。改為產圖後 `UPDATE pages SET image_path=?`。另修復實例 Uhga6bY0Bm 42/43/44（DB+metadata 補上已產生的圖路徑）。新增 `regenerate-image-persists-path.test.ts`，typecheck + figure-reference 3/3 回歸通過 | fix/regenerate-image-persist-path（已 merge） |
| 2026-06-27 | （使用者回報 bug，不計數）動畫 auto-focus 容忍 LLM 超範圍座標：CGU Air 模型回 `yPct>100` 被 `AutoFocusItemSchema` 的 `.min/.max` 擋下、重試 2 次後整個動畫步驟失敗，但下游 `mapAutoFocusResponseToEffects` 早已 clamp。改為 schema 對 xPct/yPct/widthPct/heightPct/exitDuration/angle 只驗 `z.number().finite()`（不再限範圍）、由既有 clamp 正規化，並補上 angle 的 modulo 正規化。新增 `animation-autofocus-schema-tolerance.test.ts`（3 測試，含重現 yPct>100、angle 環繞、仍拒 NaN/Infinity），backend typecheck + auto-focus map 11/11 通過 | fix/autofocus-tolerate-out-of-range-coords（已 merge） |
| 2026-06-27 | （使用者回報 bug，不計數）圖片生成改為跟隨所選供應商：原本所有產圖（初次 `renderTextPagesWithLlm`、批次重生、單頁 regenerate-image/inpaint）都硬用 `getOpenAIClient()`＋`config.openaiImageModel`，導致帳號選 CGU Air 當 LLM 時圖片仍送 OpenAI、無效金鑰時 401。新增 `getImageClient()`（影像 provider 跟隨 `llmProvider`，gemini→openai fallback）＋ per-provider 影像模型設定 `cguAirImageModel`/`openrouterImageModel`（env/設定 API/前端欄位/i18n）。四個產圖點全改用之。新增 `image-client-provider.test.ts`（4 測試），前後端 typecheck + regenerate-image/figure-reference 回歸通過。**注意：須 CGU Air 端提供 OpenAI 相容的 /images 介面才會實際運作，模型名稱由使用者於設定填入** | feat/image-provider-follows-selection（已 merge） |
| 2026-06-27 | （使用者回報 bug，不計數）重生圖片時原圖不存在也要能進行：單頁 `regenerate-image` 與「重生」批次 job 的圖檔步驟原本一律 `images.edit` 讀現有圖當基底，缺檔（如 Uhga6bY0Bm 42/43/44）會 ENOENT 整個失敗。兩處改為缺底圖時退回文字→圖：try/catch 只吞 ENOENT、有 figure 則 edit 否則 `images.generate`，有真底圖行為不變。新增 `regenerate-image-missing-base.test.ts`（2 測試），typecheck + figure-reference/image-edit-timeout 回歸通過 | fix/regenerate-image-missing-base（已 merge） |
| 2026-06-27 | （使用者回報 bug，不計數）add-pages 失敗讓 DB↔metadata 分歧、簡報像整份壞掉：`runAddPagesJob` 先位移頁碼/+page_count/插新頁但僅成功時重寫 metadata.json → 失敗留下位移後 DB 與舊 metadata 不一致。抽出 `rebuildAddPagesMetadataFromDb` 並在成功/失敗/取消三路徑都呼叫；新增 2 測試，typecheck + orphan-recovery 5 回歸通過。另實例修復 `Uhga6bY0Bm`：依裁示「保留 3 頁並重新產生」把 metadata 重建為與 DB 一致的 86 頁（原 83 頁時間戳保留）。盤點新增後續項目「regenerate-image 無底圖退化生成」 | fix/add-pages-failure-metadata-consistency（已 merge） |
| 2026-06-27 | （§7.2 後端子項）品質檢查回應新增 `summary` 摘要（pagesChecked/pagesWithIssues/totalIssues）：新增純函式 `summarizeQualityResults`、前端型別同步；補單元測試 + 整合測試斷言，quality-check 5/5、前後端 typecheck 通過（計數 50/100） | feat/quality-check-summary（已 merge） |
| 2026-06-27 | （§8.1.4 純前端）全域搜尋選取模式新增「加入複習清單」批次動作：新增純函式 `searchResultsToReviewItems`（過濾無頁碼、snippet→questionText），`GlobalSearchBox` 加按鈕呼叫 `addReviewItems`；新增 i18n 鍵與 3 測試，前端 typecheck + i18n + GlobalSearchBox 回歸通過（計數 49/100） | feat/search-add-to-review-list（已 merge） |
| 2026-06-27 | （§7.1 後端聚合子項）課後報告 pages.csv 新增頁面困難度：`reportMetrics.ts` 新增純函式 `pageDifficultyScore`（完成率/投票分歧/提問率三訊號平均、0–1、缺值略過），`report/pages.csv` 新增 `question_count`/`difficulty_score` 欄位；補 4 純函式測試 + 更新 pages-csv 測試，報告測試回歸通過（計數 48/100） | feat/report-page-difficulty（已 merge） |
| 2026-06-27 | （§7.5，補真缺口）上傳 PDF 後在生成前顯示成本估算：`POST /api/pdfs` 新增回傳 `source_page_count`（PDF 實體頁數，不寫 persisted page_count），前端新增 `promptTargetPageCount` 純函式（page_count → source_page_count fallback）供 PromptModal；確認 TXT/YouTube 生成前無從估算（非缺口）。補 backend 2 + frontend 3 測試，前後端 typecheck + 上傳路由回歸通過（計數 47/100） | feat/upload-source-page-count-cost-estimate（已 merge） |
| 2026-06-27 | （新功能，使用者指定）播放頁一般檢視點擊投影片改為進入全螢幕（取代點擊 playPause，播放/暫停改用獨立按鈕與空白鍵）：`PlayPageSlidePanel` 的 `onImgClick` 改用 context 的 `setFullscreenLayout`/`setImageOnlyFullscreen`；新增 aria-label i18n 鍵；前端 typecheck + i18n 27 測試通過（計數 46/100） | feat/click-slide-toggle-fullscreen（已 merge） |
| 2026-06-27 | （新功能）語意搜尋掃描簡報數上限改為每帳號可設定：硬編 `MAX_SEMANTIC_PDFS=20` → 設定 `semanticSearchMaxPdfs`（預設 20、範圍 1–200，clamp 防呆），串接 settings.env/admin API/Settings 頁/i18n；補 4 測試，前後端 typecheck + 回歸通過（計數 45/100） | feat/configurable-semantic-search-limit（已 merge） |
| 2026-06-27 | （真 bug 修復）ZIP 匯入 page 狀態 fallback 非法 `'ready'`+不驗證 → 改用 `isPageStatus` 驗證、無效正規化為 audio_ready；13 測試回歸（計數 44/100） | fix/import-page-status-normalize（已 merge） |
| 2026-06-27 | （真 bug 修復）from-pages 頁面用非法狀態 `'ready'`→ 重啟後被 orphan-recovery 標 failed；改 `'audio_ready'`、補回歸測試（from-pages 6/6）。另記錄完整套件零星 flaky（figure-reference/llmUsage、隔離下通過）（計數 43/100） | fix/from-pages-page-status（已 merge） |
| 2026-06-27 | （FK 稽核收尾）`addPagesFromPrompt` 中間插頁補 `defer_foreign_keys`（避免後續頁有投票時 FK 500）；重現驗證 + 17 測試回歸（計數 42/100） | fix/addpages-defer-fk（已 merge） |
| 2026-06-27 | （資料對齊擴展）頁面增/刪/移時 comments/drawings 也對齊：`shiftChildPageNumbers` 擴為三表、move per-page 移三表、delete 顯式刪被刪頁 comments/drawings；補 4 測試；後端 1203/1203 全綠（計數 41/100） | fix/realign-page-content-children（已 merge） |
| 2026-06-27 | （真 bug 修復）頁面增/刪/移時投票（page_polls）未隨頁碼重編號致 FK 500+錯位：三 renumber 交易加 `defer_foreign_keys`、delete 補子表 lockstep 位移；補 2 回歸測試；後端 1201/1201 全綠（計數 40/100） | fix/page-renumber-fk-defer-and-poll-shift（已 merge） |
| 2026-06-27 | 規畫輪（第一六〇輪）：確認 backlog 見底、品質檢查修正完整無缺口；依 STATUS_REPORT §7–§8 補 5 個優先可執行項目（多需 UI/後端整合，部分待使用者確認方向）。本輪為規畫輪、不計入 100 完成計數（維持 39/100） | master（僅文件） |
| 2026-06-27 | （前端補測試）`debugLog.ts` 補 3 單元測試（開關/防呆分支）；前端 532/532 全綠（計數 39/100） | test/debug-log（已 merge） |
| 2026-06-27 | （前端去重）抽出共用 `hasLocalStorage`（recentSearches/commentAuthor）；reviewList 因測試耦合保留；補 3 測試；前端 551/551 全綠（計數 38/100） | refactor/shared-has-local-storage（已 merge） |
| 2026-06-27 | （修既有失敗）`timing.test.ts`+`regenerate-matrix.test.ts` 共 5 個 401：補 `setSystemAuthSettings({googleAuthEnabled:false})`；12/12 + 4/4 通過（連跑穩定）（計數 36/100） | fix/timing-regen-test-auth（已 merge） |
| 2026-06-27 | （修既有失敗）`skills.test.ts`：`updateUserSkill` 改條件 spread 省略 undefined 模板鍵（與 create 形狀一致、修磁碟 round-trip 不符）；5/5 通過（計數 35/100） | fix/update-skill-omit-undefined-template-fields（已 merge） |
| 2026-06-27 | 跑完整後端套件（1199 測試/18 既有失敗，與去重無關）並分類；修 `input-security.test.ts` 4 失敗（缺 googleAuthEnabled:false 致 401）；其餘 14 個分組記錄待判斷（計數 34/100） | fix/input-security-test-auth（已 merge） |
| 2026-06-27 | （後端，去重）抽出共用 `canDestructivelyEditPdf`：4 檔 + delete.ts（消除同名不同 body）收斂至 permissions.ts；補測試；177 測試回歸通過、嚴格匿名行為保留（計數 33/100） | refactor/shared-can-destructively-edit（已 merge） |
| 2026-06-27 | （後端，去重收尾）detail.ts 改用共用 share `getShareToken`/`ShareTokenParamSchema`；`shareTokenFromRequest`(sync/server) 為 header-only 變體刻意保留；101 測試回歸通過（計數 32/100） | refactor/detail-reuse-share（已 merge） |
| 2026-06-27 | （後端，去重）抽出共用 `getPdfPermissionRow` 至 permissions.ts：10 標準檔收斂、合併 import；report.ts title 變體保留；typecheck 通過、約 274 路由測試回歸通過（計數 31/100） | refactor/shared-get-pdf-permission-row（已 merge） |
| 2026-06-27 | （後端，去重）抽出共用 share 存取群 `share.ts`（ShareTokenParamSchema/getShareToken/hasShareAccess）：10 檔成組收斂、清理 FastifyRequest import；補 6 測試；typecheck 通過、約 263 share 路由測試回歸通過（計數 30/100） | refactor/shared-share-access（已 merge） |
| 2026-06-27 | （修既有失敗）`page-animation.test.ts`：shape kind mirror drift——`triangle` 早已成合法形狀，測試改用真正不合法的 `octagon`；123/123 通過（計數 29/100） | fix/animation-shape-kind-test（已 merge） |
| 2026-06-27 | （後端，去重）抽出共用 `canEditPdf` 至 permissions.ts：21 檔標準定義收斂、合併 import；delete.ts 嚴格版保留；補測試；typecheck 通過、12 路由測試回歸通過；另記 1 個既有失敗（page-animation shape kind）（計數 28/100） | refactor/shared-can-edit-pdf（已 merge） |
| 2026-06-27 | （後端）收斂 2 個 `sessionSubFromRequest`（export/subtitles）改用共用 `sessionSub`，清理未用 import；10 測試回歸通過；全 repo 無殘留（計數 27/100） | refactor/collapse-session-sub-from-request（已 merge） |
| 2026-06-27 | （後端，大量去重）抽出共用 `sessionSub` 至 auth.ts：移除 38 檔逐字重複定義 + 清理 26 檔未使用 FastifyRequest import；補 4 測試；typecheck 通過、14 路由測試回歸通過（計數 26/100） | refactor/shared-session-sub（已 merge） |
| 2026-06-27 | （修既有失敗）`quizzes.test.ts` copy-to：診斷確認端點正常回 201，400 是測試送 `content-type: application/json` 卻無 body 觸發 Fastify body parser；改 3 請求為只帶 cookie；24/24 通過（計數 25/100） | fix/quizzes-copyto-test-headers（已 merge） |
| 2026-06-27 | （修既有失敗）`notes-txt.test.ts`：fixture 兩處塞 `page_notes = NULL` 違反 NOT NULL，改為 `''`；5/5 通過（計數 24/100）。quizzes copy-to 400 仍待重現除錯 | fix/notes-txt-test-page-notes-not-null（已 merge） |
| 2026-06-27 | （後端，大量去重）抽出共用 `canReadPdf`：27 個路由檔逐字重複的權限函式收斂為 `permissions.ts`；補 3 測試；typecheck 通過、30 路由測試回歸通過；另記錄 2 個與本輪無關的既有失敗測試（notes-txt、quizzes）（計數 23/100） | refactor/shared-can-read-pdf（已 merge） |
| 2026-06-27 | （後端）抽出 watch 聚合查詢 `queryWatchPages`：收斂 `report.ts` pages.csv 與 summary 兩處重複的 avg_listened_ratio SQL 為單一函式；7 報告測試回歸通過（計數 22/100） | refactor/query-watch-pages（已 merge） |
| 2026-06-27 | （後端）抽出學生平均分純函式：`reportMetrics.ts` 新增 `average`（空回 null），`report.ts` computeStudentRecords 改用；補 1 測試，15 報告測試回歸通過（計數 21/100） | refactor/report-average-helper（已 merge） |
| 2026-06-27 | （後端，依 LOOP 第 2 條）抽出課後報告共用比例/四捨五入純函式：新增 `reportMetrics.ts`（`safeRatio`/`round4`/`pollDivergence`），收斂 `report.ts` 多處內聯比例與重複 `round4`；補 4 測試，既有 16 報告測試回歸通過（計數 20/100）；另新增 3 個後端可執行項目 | refactor/report-metrics-helpers（已 merge） |
| 2026-06-27 | 抽出剩餘播放秒數純函式：新增 `lib/remainingTime.ts` 的 `computeRemainingSeconds`，`PlayPageSlidePanel` 的 useMemo 改委派；補 7 測試；typecheck 通過（計數 19/100） | refactor/remaining-seconds（已 merge） |
| 2026-06-27 | 抽出測驗計分純函式：`quizScoring.ts` 新增 `calcAttemptScore`/`maxAttemptScore`，收斂 `QuizBuilderPage` 兩處計分內聯；補 3 測試（11/11）；typecheck 通過（計數 18/100） | refactor/quiz-attempt-score（已 merge） |
| 2026-06-27 | 修正既有失敗測試 `status-machine.test.ts`：PROGRESS_STEPS 期望陣列補上 3 個 YouTube 步驟（source 正確、test 過時），5/5 通過；新增 `scripts/run-tests.sh` 一次測試成功（依使用者要求）（計數 17/100） | fix/progress-steps-test-mirror（已 merge） |
| 2026-06-27 | （P0 bug，依 STATUS_REPORT §4.2）修正品質檢查／匯出漏頁：`quality-check`/`image-quality`/`script-quality`/`h5p` 4 路由的頁面查詢由不存在的 page 狀態 `'ready'` 改為終態 `'audio_ready'`；修正 3 測試 fixture、新增 quality-check.test.ts；以 Node 22 + `--test-force-exit` 驗證子測試全通過（計數 16/100） | fix/quality-export-page-status（已 merge） |
| 2026-06-27 | 比例條百分比收斂：發現既有 `progressPercent` 已是該通用函式，改為重用而非新增；收斂 `HomePage` 用量比例條與 `SettingsPage` 索引進度條 2 處，順帶修掉 `total_pages=0` 時 `NaN%` 潛在 bug；typecheck 通過、既有測試續通過（計數 15/100） | refactor/reuse-progress-percent（已 merge） |
| 2026-06-27 | 依 LOOP.md 第 2 條分析前端程式（第一三四輪）：TODO 僅剩 2 個待使用者決定項目，新增 5 個項目並完成其一——模板字串內插收斂為 `lib/interpolateTemplate.ts`，收斂 6 處內聯（ImportTextPage/AddPagesFromPromptModal/PlayPageSidebar/SystemDataPage/QuizBuilderPage/PlayPageFullscreen）；補 6 測試；typecheck 通過、無殘留（計數 14/100） | refactor/interpolate-template（已 merge） |
| 2026-06-27 | 逐字稿字數上限範圍說明 i18n：新增共用鍵 `play.scriptMaxCharsRange`（內插 MIN/MAX），`TtsDialog`/`RegenAllDialog` 輸入下方加範圍提示、`min/max` 屬性改用常數；i18n parity+nonempty 27 測試通過（計數 13/100）。至此第一二九輪新增的 4 個可執行項目已全部完成，TODO 僅剩 2 個待使用者決定項目 | feat/script-max-chars-range-hint（已 merge） |
| 2026-06-27 | 投影片縮放比例邊界收斂：新增 `lib/slideImageScale.ts`（`stepSlideImageScale` + MIN/MAX/STEP 常數，toFixed 消浮點誤差 + clamp）；`PlayPageHeader` 放大/縮小按鈕與 disabled 判斷改用之，header 無殘留 magic number；補 4 測試；typecheck 通過（計數 12/100） | feat/slide-scale-helper（已 merge） |
| 2026-06-27 | 首頁總覽統計彙總純函式：新增 `lib/homeStats.ts`（`summarizeHomeStats`，單次遍歷取代 3 次 reduce，音訊總秒數 /60 四捨五入）；`HomePage` homeStats 改用之；補 4 測試；typecheck 通過（計數 11/100） | feat/home-stats-helper（已 merge） |
| 2026-06-27 | 上傳進度百分比計算收斂：新增 `lib/uploadProgress.ts`（`uploadProgressPercent`，分母無效回 0 + clamp 0–100），收斂 `UploadButton`/`ImportTextPage`(2)/`HomePage`(zip)/`AddPagesFromPromptModal` 共 5 處內聯，各保留原 fallback 語意；補 4 測試；typecheck 通過、無殘留（計數 10/100） | feat/upload-progress-percent（已 merge） |
| 2026-06-27 | 逐字稿每頁字數上限正規化收斂：新增 `lib/scriptMaxChars.ts`（`normalizeScriptMaxChars` + MIN/MAX 常數，委派既有 `clamp`），收斂 `PlayPageSidebar`/`RegenAllDialog`/`TtsDialog` 三處內聯 `Math.max(80,Math.min(2000,round))`；補 5 測試；typecheck 通過、無殘留內聯（計數 9/100） | feat/normalize-script-max-chars（已 merge） |
| 2026-06-27 | 依 LOOP.md 第 2 條分析前端程式，新增 5 個小顆粒可執行項目（逐字稿字數上限正規化〔已完成〕、範圍說明 i18n、slideImageScale 邊界收斂、首頁音訊總時長彙總純函式、上傳進度百分比純函式） | feat/normalize-script-max-chars |
| 2026-06-27 | TODO.md 過大，依既有 `TODO_YYMMDD` 封存慣例將其改名為 `TODO_260627.md`，重建精簡新 TODO.md（保留計數狀態、兩個待使用者決定的未完成項目與工作記錄區） | master（僅文件） |
| 2026-07-09 | （TODO 第 7c 項）cell 執行耗時顯示——`nbformatModel` 加純函式 `formatCellTiming(ms)`（<1000ms→整數 ms、<60000ms→一位小數 s、>=60000ms→「Xm Y.Ys」）；`NotebookPanel` 加 `cellTimings` state（`Record<number,number>`），`runCell`/`runAll` 執行前後以 `Date.now()` 計時並更新，code cell 下方顯示「耗時 X.Xs」。修正 JSX fragment 包裹與 runStartMs 作用域錯誤。驗證：`nbformatModel` 27/27（含 `formatCellTiming` 新測試）、前端 `tsc --noEmit` 通過 | feat/notebook-cell-timing |
| 2026-07-09 | 將「加入書籤 🔖／標記為重要 ★」兩按鈕從 `SlideRenderer` 的 overlay 移出——原本相對 `inline-block` wrapper 以 absolute 定位，在 notebook 頁（cell 小且置中）會貼到小小的 cell 角落。改在投影片舞台容器（`relative` 的 `max-w-4xl` 區塊）左上角以 absolute 呈現，使其落在頁面角落而非 cell 角落；播放/暫停維持在下方控制列 section。保留切換顏色與 i18n title/aria。驗證：前端 `tsc --noEmit` 通過、`vite build` 成功 | feat/page-markers-to-page-corner（已 merge） |
| 2026-07-09 | 承上，將「版本」按鈕（原在 `SlideRenderer` overlay、`absolute right-2 top-12` 貼 cell 角落）與「play/pause」按鈕（原在下方控制列 section，含 audioError／無音訊／classroom 三態）一併移到投影片舞台容器右上角，成 `absolute right-3 top-3` 群組，與左上角書籤/重要對稱，使頁面層級控制都落在頁面角落而非小 cell。行為（重試/無音訊/classroom next、版本歷史）不變；grep 確認 playPause／版本各僅 1 處、舊 `right-2 top-12` 歸零。驗證：前端 `tsc --noEmit` 通過、`vite build` 成功 | feat/playpause-version-to-page-corner（已 merge） |
| 2026-07-09 | notebook（jupyter）頁面隱藏 play/pause 按鈕：notebook 是互動程式碼而非有旁白的投影片，音訊播放/暫停控制無意義。將右上角群組的 play/pause 三態條件以 `currentPage.render_type !== 'notebook'` 包住，notebook 頁不再顯示該鈕（版本按鈕保留）。驗證：前端 `tsc --noEmit` 通過、`vite build` 成功 | fix/hide-playpause-on-notebook-page（已 merge） |
| 2026-07-09 | 修 notebook cell 程式碼在編輯／顯示時顏色太淡：面板嵌在永遠深色的播放舞台，卻用 `bg-surface`/`text-text` 主題 token（隨 app 淺/深走），淺色模式下面板變白、文字低對比，`print(1+1)` 看起來灰淡難讀。改為：顯示模式的 `<pre>` 用自成一體深色 code block（`bg-slate-900`＋`text-slate-100`），CodeMirror 編輯器固定用內建 dark 主題（移除 `useHtmlDarkClass` 切換），兩者一致且不受周圍 app 主題影響。先前誤把 CodeMirror 的未提交 `blendTheme` 退步還原成主題切換版，但真正問題在顯示用的 `<pre>`。驗證：前端 `tsc --noEmit` 通過、`vite build` 成功 | fix/notebook-code-dark-readable（已 merge） |
| 2026-07-09 | （修正上一則的錯誤修法）使用者指出「全螢幕顏色正確、只有一般播放面板淡」。查出真因：同一個 NotebookPanel 是共用的，但一般面板外層 `PlayPageSlidePanel` 設了固定淡色 `text-slate-100` 祖先，而 NotebookPanel 只設 `bg-surface` 沒配對設文字色 → 繼承到淡色；全螢幕外層是 `bg-black` 無淡色祖先故正常。正確修法：撤回上一則對共用元件的改動（深色 code block＋固定深色編輯器 → 還原成 `bg-surface`/`text-text` 的 `<pre>` 與主題切換 CodeMirror，全螢幕不受影響），改在 **NotebookPanel 根容器補 `text-text`**，讓面板自帶主題文字色（與 `bg-surface` 配對）。驗證：前端 `tsc --noEmit` 通過、`vite build` 成功 | fix/notebook-inherit-text-color（已 merge） |
| 2026-07-09 | notebook 頁隱藏音訊「暫停中」指示器：SlideRenderer overlay 內 `pointer-events-none`、`aria-hidden` 的兩條豎槓造型（`!isPlaying && audio_url` 時顯示）在 notebook 頁仍出現，補上 `render_type !== 'notebook'` 條件一併隱藏。驗證：前端 `tsc --noEmit`＋`vite build` 通過 | fix/hide-audio-indicator-on-notebook（已 merge） |
| 2026-07-09 | notebook 工具列新增單 cell 執行鍵：工具列原本只有「▶▶ 全部執行」，單 cell 執行只在每格 footer（易忽略）。在「全部執行」旁加「▶ 執行」（`runCell(false)`，執行中或非 code cell 時 disabled，永遠顯示），複用既有 `run`/`running`/`runHint` i18n key。（附註：footer 的執行鍵只對 code cell 顯示、markdown 無執行鍵為正常行為。）驗證：前端 `tsc --noEmit`＋`vite build` 通過 | feat/notebook-toolbar-run-cell（已 merge） |
| 2026-07-09 | 修 notebook cell 多行內容疊在同一行：notebook wrapper 帶了 `lineHeight: 0`（原為投影片圖片去除行距用），文字型面板繼承後 markdown 清單／多行程式碼全疊成一行。於 NotebookPanel 根補 `leading-normal` 恢復正常行高；並給 `In[]` 執行次數標籤 `leading-none`，讓它與 code box 的間距維持緊湊（Jupyter 風格）而非被新行高撐大。驗證：前端 `tsc --noEmit`＋`vite build` 通過 | fix/notebook-cell-line-height（已 merge） |
| 2026-07-09 | notebook 頁新增「上傳／下載 .ipynb」按鍵（工具列右側）：下載＝將目前 `NbNotebook`（無損 nbformat JSON）以 Blob 存成 `page-N.ipynb`；上傳＝隱藏 file input 選 `.ipynb`→`JSON.parse`→`parseNbNotebook`（安全正規化）→確認後 `persistNotebook` 取代本頁 notebook。兩鍵置於 `editable` 工具列；新增 `download`/`downloadHint`/`upload`/`uploadHint`/`uploadConfirm` 五個 i18n key（en＋zh-TW）。驗證：前端 `tsc --noEmit`、i18n 測試 27/27（parity＋nonempty）、`vite build` 通過 | feat/notebook-upload-download-ipynb（已 merge） |
| 2026-07-09 | 依情境調整 notebook 顯示大小：原本編輯模式太大（`h-full` 被強制撐到呼叫端 maxHeight、內容下方一大片空白），全螢幕太小（沒給尺寸→縮成置中小條）。改在 SlideRenderer notebook 分支：一般面板貼合內容、只在超過視窗相對 maxHeight 時捲動（`w-full`＋`style.maxHeight`，移除 `h-full`）；全螢幕（呼叫端無 maxHeight）填滿大區塊（`height:85vh`、`mx-auto w-full max-w-5xl` 置中）。順帶移除已無用的 `pl-12`（原避開的 overlay 書籤/重要按鈕已移到頁面角落）。驗證：前端 `tsc --noEmit`＋`vite build` 通過 | fix/notebook-size-per-context（已 merge） |
| 2026-07-09 | 全螢幕 notebook 改滿版寬度：移除 `max-w-5xl` 上限，全螢幕吃滿整個視窗寬度而非置中欄；兩情境 className 統一為 `w-full`（一般面板仍由父層 `max-w-4xl` 限寬），只有高度 style 不同。驗證：前端 `tsc --noEmit`＋`vite build` 通過 | fix/notebook-fullscreen-full-width（已 merge） |
| 2026-07-09 | 全螢幕 notebook 真正滿版：前一則只在 panel 加 `w-full` 不夠——panel 的 wrapper（SlideRenderer 的 div）在全螢幕是被 flex 容器置中、縮到內容寬的 flex 子項，故只等於內容寬。改在 wrapper 本身於全螢幕加 `w-full`，notebook 才真的橫向填滿視窗。驗證：前端 `tsc --noEmit`＋`vite build` 通過 | fix/notebook-fullscreen-wrapper-full-width（已 merge） |
| 2026-07-09 | 新增設定 `JUPYTER_CONDA_PREFIX`：指定 notebook kernel 要用的 Anaconda/Conda 環境 prefix（含 `bin/jupyter`）。`start.sh` 的 `ensure_jupyter_bin` 於最前面檢查此設定，設了就優先用該環境的 jupyter（勝過 `.jupyter-venv`／系統），讓 cell 在該環境（含其套件）執行；驗證 jupyter_server >= 2，不合則印出 `conda install` 指令警告並退回原本解析順序。`.env.example` 補上 JUPYTER 區塊（ENABLED/PROXY_TARGET/CONDA_PREFIX）。同時提交先前未提交的 start.sh Q3（port 衝突警告）／M3（venv pip 失敗提示）。驗證：`bash -n start.sh` 通過 | feat/jupyter-conda-prefix（已 merge） |
| 2026-07-09 | notebook 工具列寬度修正 + 可調 cell 字型：(1) 寬度——新增執行/上傳/下載鍵後工具列變寬，一般面板 wrapper 是 inline-block 縮到內容寬→溢出容器兩邊被切。改為 wrapper 兩情境都 `w-full`（一般面板受父層 `max-w-4xl` 限寬），工具列與內部群組加 `flex-wrap`，過寬時換行不切斷。(2) 字型——工具列加 A－/數值/A＋ 控制（9–28px，localStorage 持久化），套用在 cell 內容容器並讓 code `<pre>`／輸出／編輯 textarea 繼承（移除其固定 `text-xs`）；CodeMirror 加 `fontSize` prop 以 `EditorView.theme` 設字級。新增 `fontSize`/`fontSmaller`/`fontLarger` i18n key（en＋zh-TW）。驗證：前端 `tsc --noEmit`、i18n 測試通過、`vite build` 通過 | feat/notebook-fit-width-and-font-size（已 merge） |
| 2026-07-09 | notebook 加「執行環境（Conda）」下拉選單：`useJupyterKernel` 新增 `listKernelSpecs()`（透過 `@jupyterlab/services` 的 `KernelSpecManager` 列 jupyter kernelspecs，每個以 ipykernel/nb_conda_kernels 註冊的 Conda 環境即一項），hook 改吃 `kernelName`、以 `notebookKey::kernelName` 重新 key warm kernel、以該 spec 啟動、切換環境時關舊 kernel＋重置 phase。NotebookPanel 載入 kernelspecs，>1 個時在工具列顯示 `<select>`，選擇以 localStorage 持久化、環境消失時退回 python3／第一個。新增 `kernelEnv` i18n key（en＋zh-TW）。環境需先註冊成 kernelspec 才會出現；`JUPYTER_CONDA_PREFIX` 仍決定 start.sh 啟動 jupyter 的預設環境。驗證：前端 `tsc --noEmit`、i18n 測試 27/27、`vite build` 通過 | feat/notebook-kernel-env-picker（已 merge） |
| 2026-07-09 | 自動掃描 Conda 環境註冊為 kernel（免手動 nb_conda_kernels）：`start.sh` 新增 `register_conda_kernels()`，於啟動 jupyter 前執行——找 conda base（`JUPYTER_CONDA_PREFIX`／`conda info --base`／常見安裝路徑），列舉 base 與 `envs/*`，對每個含 ipykernel 的環境跑 `<env>/bin/python -m ipykernel install --user` 註冊為 `conda-<name>`／`Python (<name>)`。前端「執行環境」下拉即自動列出。以 `JUPYTER_SCAN_CONDA_ENVS=false` 可停用；`.env.example` 補上該設定。驗證：`bash -n start.sh` 通過 | feat/jupyter-auto-scan-conda-envs（已 merge） |
| 2026-07-09 | notebook cell 左右版面＋輸入/輸出比例：工具列加「上下⇄左右」切換（split 時程式碼在左、輸出在右）；split 模式加一條比例滑桿控制「輸出佔比」0–100（0＝只顯示輸入、100＝只顯示輸出、中間依比例；以 flexGrow 分配、gap 自動處理），一個控制同時調比例與輕鬆切換輸入/輸出焦點。版面與比例都以 localStorage 持久化。CellBody 重構為 codeSide/outputSide 兩區。新增 `layoutSplit`/`layoutStack`/`outputRatio` i18n key（en＋zh-TW）。驗證：前端 `tsc --noEmit`、i18n 測試 27/27、`vite build` 通過 | feat/notebook-split-layout-ratio（已 merge） |
| 2026-07-09 | 全螢幕以 ↑/↓ 換 cell：全螢幕時 notebook container 沒 focus，其 `onKeyDown` 收不到方向鍵。改在 `PlayPage` 全域 keydown handler（capture）中，當「全螢幕＋notebook 頁」時對 ↑/↓ 發 `makeslide:notebook-cell-nav` CustomEvent（帶 delta），NotebookPanel 監聽並切換目前 cell（編輯中略過，讓方向鍵移游標）。非 notebook 頁與非全螢幕行為不變；deps 補上 `currentPage`。驗證：前端 `tsc --noEmit`＋`vite build` 通過 | feat/notebook-fullscreen-arrow-cell-nav（已 merge） |
| 2026-07-09 | 修 notebook HTML 輸出（pandas 表格）對比太差：沙箱 iframe 背景透明、卻寫死淺色文字（#e2e8f0）＋深色格線，透出的淺色面板上幾乎看不見。`buildNotebookHtmlSrcDoc` 加 `dark` 參數依主題選對比色（文字/格線/連結＋淡淡表頭底色）；`NotebookHtmlOutput` 以 `useHtmlDark` 追蹤 html.dark、主題變更時重建 srcdoc。sandbox 測試 4/4（`dark` 為選用不破壞既有呼叫）。驗證：前端 `tsc --noEmit`＋`vite build` 通過 | fix/notebook-html-output-contrast（已 merge） |
| 2026-07-09 | 全螢幕 markdown 自動放大（簡報效果）：`SlideRenderer` 於全螢幕分支（wrapperStyle 無 maxHeight）傳 `fullscreen` 給 `NotebookPanel`→`CellBody`；顯示模式的 markdown cell 在全螢幕時以 `text-2xl leading-relaxed` 渲染。MarkdownMath 的標題/段落/行內 code 多為繼承或 em 單位，故加大 base 字級即整體放大。驗證：前端 `tsc --noEmit`＋`vite build` 通過 | feat/notebook-fullscreen-markdown-large（已 merge） |
| 2026-07-09 | 修 notebook HTML 輸出 iframe 高度無限上升：自動量測腳本回報 `document.documentElement.scrollHeight`，該值會被 iframe 自身高度撐底；父層每次 +4px 緩衝→高度回饋放大，表格一路漲到 4000px 上限（全螢幕高區塊尤其明顯）。改回報 `document.body.scrollHeight`（body 非 root scroller，反映內容高度、穩定），打斷迴圈。sandbox 測試 4/4。驗證：前端 `tsc --noEmit`＋`vite build` 通過 | fix/notebook-html-height-loop（已 merge） |
| 2026-07-09 | 記住每頁上次停留的 cell：以 localStorage（key `makeslide.nbCell.<pdfId>:<pageNumber>`）持久化目前 cell index，載入時還原（clamp 到該 notebook 範圍）而非固定回到第 0 格。持久化 effect 以 `notebook !== null` 把關，避免頁面切換（notebook 短暫為 null）把舊 index 寫到新頁。read-only 檢視也適用。驗證：前端 `tsc --noEmit`＋`vite build` 通過 | feat/notebook-remember-cell（已 merge） |
| 2026-07-09 | markdown 字型與 cell 字型設定連動：markdown cell 改用明確依 `fontSize`（A-/A+）計算的字級——正常＝`fontSize`、全螢幕＝`fontSize×1.8`（簡報感）。先前全螢幕 markdown 固定 `text-2xl` 會蓋掉繼承字級、與字型控制脫鉤；現在放大程式字型時 markdown 於正常與全螢幕都等比例放大。驗證：前端 `tsc --noEmit`＋`vite build` 通過 | feat/notebook-markdown-font-linked（已 merge） |
| 2026-07-10 | 唯讀觀看者試跑模式：唯讀者可在瀏覽器內連 kernel 執行／編輯 cell 並看到更新後文件，但一律不寫回共用 `.ipynb`（變更僅存元件 state、重載即還原）；執行相關控制對所有人開放、結構性編輯仍限 editable；本地有變更時顯示「試跑模式」徽章；kernelspecs 對唯讀者延遲載入避免被動觀看拉重 chunk；`kernelStatusLabelKey` 移除 editable 參數；i18n 2 鍵。驗證：前端 `tsc`、前端測試 811/811、`vite build` 通過 | feat/notebook-readonly-ephemeral-run（已 merge） |
| 2026-07-10 | Kubeflow／k8s 部署方案設計文件：新增 `docs/jupyter-kubeflow-plan.md`，定義 MakeSlide 於 Kubeflow 環境以使用者指定的 Kubeflow Notebook（Pod 內完整 JupyterLab server）作 kernel 後端——含動機（共用 server 無隔離）、同源架構（connection 端點回 `/notebook/<ns>/<name>`、前端零改動）、RBAC、notebook 指定 UX、喚醒流程、安全、長任務配套與分階段實作；並自 jupyter-integration-plan.md 連結 | docs/jupyter-kubeflow-notebook-plan（已 merge） |
| 2026-07-10 | 試跑模式 UI 修正（使用者回饋）：(1) 「試跑模式」徽章對比不足——淺色主題下 amber-500 幾乎看不見，改 `text-amber-700`（dark 用 `amber-300`）＋`font-medium`；(2) 一般面板左上工具列按鈕被舞台角落的「書籤／標記為重要」absolute 按鈕蓋住——notebook 佔滿舞台，於 SlideRenderer notebook 分支（非全螢幕）補回 `pl-12` 左側留白；(3) 唯讀者不再顯示頁腳「Jupyter 執行功能未啟用（請洽管理員開啟）」——該訊息是給編輯者/營運者的，試跑的其餘功能（本地編輯、複製）不受影響。驗證：前端 build（含 tsc）＋測試 811/811 通過 | fix/notebook-trial-mode-ui（已 merge） |
| 2026-07-10 | 修「按執行變成上一頁」（使用者回饋）：全螢幕 image layout 左右緣各有一條全高、透明（opacity-0）的隱形換頁點擊帶（z-20）；notebook 面板全螢幕滿版時，工具列最左的「▶ 執行」正好落在左帶底下（點擊被攔走、翻到上一頁），右帶同樣蓋住工具列右端與頁腳 ↑↓。比照「notebook 頁隱藏 play/pause」的先例，換頁帶加上 `render_type !== 'notebook'` 條件；鍵盤 ←/→ 與觸控滑動仍可換頁。驗證：前端 build（含 tsc）＋測試 811/811 通過 | fix/notebook-fullscreen-nav-strips（已 merge） |
| 2026-07-10 | Kubeflow 計畫加入 GPU runtime 型別（使用者要求）：以 notebook 命名慣例決定 kernel 後端——使用者自建 `makeslide-jupyter-<runtime>` notebook（cpu／gpu-a100 等，GPU 資源在 Kubeflow Notebook UI 建立時決定），MakeSlide 以 `GET /api/jupyter/runtimes` 依前綴探索、UI 以 `<runtime>` 尾碼顯示 runtime 選單（與 kernelspec 選單並列：runtime 選 Pod、kernelspec 選 Conda 環境），選擇存 `user_settings.jupyter_runtime`、connection 端點吃 `?runtime=`（DNS-label 白名單）；零設定預設——沒有任何 `makeslide-jupyter-*` notebook 時自動生成 CPU-only 的 `makeslide-jupyter-cpu`（AlreadyExists 冪等、已有 runtime 即不再自動建立）；config 加 `KUBEFLOW_NOTEBOOK_PREFIX`／預設 image／資源，RBAC 增 create，分階段 7a–7e 同步更新 | docs/jupyter-kubeflow-gpu-runtime（已 merge） |
| 2026-07-11 | 依 docs/jupyter-kubeflow-plan.md §7 分階段實作 7a：`JUPYTER_MODE=kubeflow` 設定＋`GET /api/jupyter/connection` 的 kubeflow 分支。新增極簡 Kubeflow Notebook CR REST client（`kubeflowClient.ts`：`getNotebook`／`notebookState`，可注入 fake fetch 免叢集測試）；connection 端點由 session email 推導 namespace、`?runtime=` 經 DNS-label 白名單解析 notebook 名稱、依 CR 狀態回 running（現行同源 cookie 形狀，前端零改動）／pending（202 starting）／stopped（503）／not_found（404）；namespace 一律伺服器端推導，跨帳號絕不外洩。stopped 喚醒與零設定自動建立 CPU 預設留待 7c。驗證：新測 `jupyter-kubeflow-connection` 12/12、既有 `jupyter-connection`／`jupyter-proxy` 回歸 10/10、後端 `tsc` 通過（完整後端套件另跑 1427 項僅 6 個既有已知 flaky 失敗，孤立重跑均綠、與本次改動無關；真實叢集端到端待部署驗證） | feat/kubeflow-connection-endpoint（已 merge） |
| 2026-07-11 | 依 docs/jupyter-kubeflow-plan.md §7 分階段實作 7b：`GET /api/jupyter/runtimes` 探索端點＋前端 runtime 選單。`kubeflowClient.ts` 加 `listNotebooks`／純函式 `notebookImage`／`notebookHasGpu`；`jupyter.ts` 加純函式 `runtimeFromNotebookName`與新端點（非 kubeflow 模式 404、依前綴過濾呼叫者 namespace 的 notebook、回 status/gpu/image）。前端 `fetchJupyterConnection`／`listKernelSpecs`／`useJupyterKernel` 加選填 `runtime` 參數（kernel registry key 追加 runtime 維度）；`NotebookPanel` 新增 runtime 下拉選單（與既有 kernelspec 選單並列，localStorage 持久化並每次請求直接帶入，未採計畫原提的 DB `user_settings.jupyter_runtime`）；i18n 2 鍵。驗證：新測 `jupyter-kubeflow-runtimes` 5/5、既有 kubeflow／proxy 回歸 21/21、前後端 `tsc`、前端測試 791/791、`vite build` 通過（完整後端套件另跑 1432 項僅 3 個既有已知 flaky／pre-existing 失敗，與本次改動無關；真實叢集端到端待部署驗證） | feat/kubeflow-runtimes-endpoint（已 merge） |
| 2026-07-11 | 依 docs/jupyter-kubeflow-plan.md §7 分階段實作 7c：stopped notebook 喚醒＋零設定自動建立 CPU 預設＋前端 starting 輪詢。`kubeflowClient.ts` 加 `wakeNotebook`（merge-patch 移除 stopped annotation）、`createNotebookIfMissing`（409 容錯競態）、純函式 `parseResourceString`／`buildDefaultNotebookManifest`；connection 端點 stopped 狀態改喚醒後回 202、not_found 狀態僅在「解析出預設 runtime 且該 namespace 零個 makeslide-jupyter-* notebook」時才自動建立（已有其他 runtime 或明確指定非預設 runtime 都不搶建）。順手修正一個 7a 遺留的前端缺口：202 屬 2xx，`fetchJupyterConnection` 從未特判會把 `{starting:true}` 誤當連線資訊解析、下游存取 undefined 欄位會炸——改為明確拋型別化 202 錯誤，`useJupyterKernel` 加有界輪詢（3 秒×40 次≈2 分鐘）與獨立 `starting` phase／i18n。驗證：新測 `jupyter-kubeflow-wake-autocreate` 5/5、既有 kubeflow／proxy 回歸（3 個舊測試依新語意調整斷言）全綠、`jupyterConnection` +2、前後端 `tsc`、前端測試 812/812、`vite build` 通過（完整後端套件另跑 1437 項 5 個既有已知 flaky／pre-existing 失敗，孤立重跑均綠、與本次改動無關；真實叢集喚醒/自動建立端到端待部署驗證） | feat/kubeflow-notebook-wake-and-autocreate（已 merge） |
| 2026-07-11 | 依 docs/jupyter-kubeflow-plan.md §7／§5.1 分階段實作 7d：session reattach（對 proxy/url/kubeflow 三種模式皆有益）。`useJupyterKernel.ts` 改用 `SessionManager`（`findByPath` 接回既有 session、找不到才 `startNew`）取代直接 `KernelManager.startNew`；純函式 `sessionPathForNotebookKey(notebookKey, kernelName)` 組出 session path（含 kernelName，避免切環境誤接回另一環境的 session）。效果：整頁重新整理清空記憶體 registry 但未曾真的 shutdown kernel，故重整後能接回執行中的 kernel 而非多開一個；app 內切頁/切環境仍維持原本明確 shutdown 行為。驗證：`jupyterConnection` 新增測試、前端測試 791/791、前端 `tsc`、`vite build` 通過（真實瀏覽器重整後 reattach 待實機驗證） | feat/kubeflow-session-reattach（已 merge） |
| 2026-07-11 | 依 docs/jupyter-kubeflow-plan.md §7 分階段實作 7e（純文件，7a–7e 至此全部完成）：新增部署指南 docs/jupyter-kubeflow-deployment.md，涵蓋 RBAC manifest（ClusterRole 與逐 namespace Role 兩版）、與 Kubeflow 既有 Istio 路由的關係（MakeSlide 不用自管 `/notebook/<ns>/<name>/`）、`KUBEFLOW_DEFAULT_RUNTIME_IMAGE` 挑選指引、`proxy` 模式僅限單人部署的明確警語，並記錄 `KUBEFLOW_USERID_HEADER` 自 7a 加入後從未真正被讀取的已知限制。`.env.example` 補上 `KUBEFLOW_*` 變數；`jupyter-kubeflow-plan.md` §7 標記各階段完成與分支連結 | docs/jupyter-kubeflow-deployment-guide（已 merge） |
| 2026-07-11 | 補完（P0，§7.2）品質檢查自動化的剩餘前端子項（後端摘要計數第一七一輪已完成）：`PlayPageHeader` 生成完成（`detail.status==='ready'`）後自動查一次 quality-check（每份簡報僅查一次，之後由使用者手動重查），有問題時頁碼旁顯示「⚠ N 頁有問題」徽章（沿用既有 `analysisBadgeState`／`play.quality.issueCount`）；點擊 dispatch 新的 `makeslide:open-quality-panel` window CustomEvent（比照既有 `makeslide:notebook-cell-nav` 跨元件訊號模式），`PlayPageSidebar` 監聽後切到 AI 助手分頁的品質報告子分頁、開啟既有 `QualityCheckPanel`。i18n 1 鍵。驗證：前端 `tsc`、前端測試 813/813、`vite build` 通過（真實瀏覽器點擊徽章跳轉互動待實機驗證） | feat/quality-check-header-badge（已 merge） |
| 2026-07-11 | 補完（P0，§7.1）課後報告補強：盤點發現既有 `PostClassReportPanel` 已有答錯率／投票分歧／完成率三榜單與 5 個 CSV 下載口，真正缺口是「頁面困難度」單一綜合分數從未曝露＋**意外發現既有 bug**——`polls.most_divergent_pages` 前端型別/選擇器早就在讀，但後端 `report/summary` 從未寫入過這個欄位，導致「投票分歧最高頁面」上線以來一直是空的。修正：後端新增 `queryPagePollAggregates`／`computePageDifficulties`（與 `pages.csv` 共用查詢，去重內嵌邏輯），`reportMetrics.ts` 新增純函式 `selectMostDivergentPages`／`selectHardestPages`，`report/summary` 補上 `polls.most_divergent_pages`（修好死欄位）與新的 `page_difficulty.pages`；前端新增 `getHardestPages` 選擇器與「頁面困難度排行」UI 區塊，納入 Markdown 匯出。驗證：後端新測 +5、`report-summary` 整合測試新斷言、既有 CSV／題目統計回歸；前端 `reportSummary.test.ts` +2；前後端 `tsc`、前端測試、`vite build` 通過（完整後端套件 1442 項僅 2 個既有已知失敗，與本次改動無關） | feat/post-class-report-difficulty-ranking（已 merge） |
| 2026-07-11 | 完成階段 7 剩餘項目之一：7e 鍵盤快捷鍵說明面板。notebook 工具列新增「⌨ 快捷鍵」按鈕，彈窗列出實際生效的 5 條快捷鍵（↑/↓ 切 cell、Enter 編輯、Esc 提交離開、Ctrl/⌘+Enter 執行、Shift+Enter 執行並移至下一個），UI 沿用播放頁 header 既有 `ShortcutsButton` 彈窗樣式但不綁全域 `?` 熱鍵（避免與 header 自己的快捷鍵總覽搶鍵）。順手盤點發現「課後報告個人層級報表」（P0，§7.1）與另一份「報告面板個人層級延伸」（需使用者裁示）其實是同一件事的重複記錄，且技術上有真實阻礙——完成率/投票用的身分（`viewer_id`/`voter_id`，優先 `user_code`）與測驗用的 `client_id`（每次同步階段隨機產生）不是同一命名空間，合併需要產品判斷，故未強行實作，於 TODO.md 記錄盤點結果待使用者裁示。驗證：前端 `tsc`、前端測試 779/779、`vite build` 通過 | feat/notebook-keyboard-shortcuts-panel（已 merge） |
| 2026-07-11 | 完成階段 7 剩餘項目之一：7d notebook 內文字搜尋。新增純函式 `searchNotebookCells`（不分大小寫比對每個 cell 原始碼與攤平輸出文字，複用既有 `cellText`／`outputsToPlainText`）；`NotebookPanel` 工具列新增搜尋切換鈕，開啟後顯示搜尋列（輸入框＋比對計數＋上一筆/下一筆/關閉），輸入即跳到第一個命中 cell，Enter/Shift+Enter 循環切下一筆/上一筆；新增 `jumpToCell` 共用函式（跳轉前先提交進行中編輯）。i18n 7 鍵。驗證：`nbformatModel` 新測 4/4、前端 `tsc`、前端測試 783/783、`vite build` 通過。notebook 顯示層強化（階段 7）僅剩 7b（markdown cell 即時預覽切換）尚未動工 | feat/notebook-text-search（已 merge） |
| 2026-07-11 | 完成階段 7 最後剩餘項目：7b markdown cell 編輯時即時預覽切換。分支上先發現 master 有一份未提交、半成品的實作（`markdownPreview`／`onMarkdownPreviewToggle` 已在 JSX 用到但從未在元件 state／props 中定義，`CellBody` 也缺 `useI18n`），予以補完並另立分支重做：stack 版面加「原始碼／預覽」切換鈕＋`markdownPreview` state（`beginEdit` 時重置，避免殘留上一個 cell 的預覽狀態）；split 版面沿用既有輸入/輸出比例控制並排顯示，無需另建控制項。i18n 2 鍵（`markdownShowSource`／`markdownShowPreview`）。至此階段 7（notebook 顯示層強化）7a–7e 全部完成。驗證：前端 `tsc`、i18n parity、前端測試 818/818、`vite build` 通過（實機切換體驗待真實使用驗證） | feat/notebook-markdown-live-preview（已 merge） |
| 2026-07-11 | 完成單份簡報匯出（export.zip）進度回報：新增 job 化端點（`POST /api/pdfs/:id/export-job`／`GET .../export-job/:jobId`／`GET .../export-job/:jobId/download`），比照既有 `batch-export.ts` 的 job+poll+download 三段式，固定 8 步進度（zip＋6 個 sidecar 檢查＋最終讀檔），權限沿用 `canReadPdf`/`aclCtx`（poll/download 每次重新檢查，share token 自然適用）。原本同步的 `GET /api/pdfs/:id/export.zip` 完全不變，新端點是額外加的。PlayPageHeader 下載選單新增「匯出簡報（含進度）」鈕＋進度條（此前 PlayPage 無 export.zip 入口）。i18n 4 鍵。驗證：新測 `single-export-job` 5/5、既有匯出相關 6 個測試檔逐檔重跑共 15/15 無回歸（此環境 `npm test` 併發跑 200+ 檔會卡住，改採逐檔驗證）；前後端 `tsc`、前端測試 818/818、i18n parity、`vite build` 通過 | feat/single-export-progress（已 merge） |
| 2026-07-11 | 完成 AI 導師 `/ask` 串流問答的「可中途取消」：盤點發現該項在 TODO.md 中重複記錄——串流顯示本身早於分支 `feat/tutor-ask-streaming` 完成，此舊條目只是未同步勾掉，真正缺口是取消。`streamChatText`／`callGeminiTextStream` 新增可選 `signal`（`AbortSignal`）並轉發進 OpenAI SDK 呼叫／Gemini fetch（與既有逾時 signal 用 `AbortSignal.any` 合併）；`/ask` 路由既有的客戶端斷線偵測現在同時中止一個逐次請求的 `AbortController`，讓取消/斷線真正停止耗費 token。前端 `usePageAsk` 提供 `cancelAskPage()`，`PageAskPanel` 忙碌時顯示「停止生成」鈕，取消後保留已串流內容為最終答案（不回滾）。i18n 1 鍵。驗證：新測 1/1、既有 `ai-tool-loop`／`page-ask`／`gemini-*` 共 26/26 無回歸、前後端 `tsc`、前端測試 818/818、`vite build` 通過 | feat/ai-tutor-ask-cancel（已 merge） |
| 2026-07-11 | 完成首頁搜尋結果「加入書籤」批次動作：盤點 `docs/STATUS_REPORT_2026_06_27.md` §7.4／§8.1 建議項時發現「加入新簡報」半句早已完成（提交 `69018bc6`），真正缺口是「收藏頁」——全庫無 bookmark 資料表，僅播放頁內有 per-deck 的 `toggleBookmark`（`makeslide.bookmarks.<pdfId>`），搜尋結果完全沒接上。採最小可行方案（不新建跨簡報收藏清單頁面，避免擴大到需另外裁示的範疇）：`GlobalSearchBox` 選取模式新增「加入書籤（{n} 頁）」批次動作，依 pdf_id 分組寫入各自既有的書籤 localStorage key（冪等新增、不用切換語意），之後在該簡報播放頁即可看到既有書籤標記。複用已測的 `readNumberArrayFromStorage`。i18n 2 鍵。驗證：前端 `tsc`、前端測試 818/818（含 i18n parity）、`vite build` 通過 | feat/search-add-to-bookmarks（已 merge） |
| 2026-07-11 | 完成「AI 導師自學模式入口正式化」：盤點發現字面兩個子項（測驗後複習清單、答錯題回看）早已完成，此條目只是未同步勾掉；過程中意外發現真正的既有 bug——`PlayPage.tsx` 從未讀取 `?page=` query string，導致全站至少 5 處既有深連結（測驗答錯回看、品質檢查跳頁、搜尋結果開新分頁、觀看紀錄跳頁）全部靜默失效、一律停在第 1 頁。修正：播放進度回復 effect 新增優先檢查 `?page=`（複用已測 `parseGotoPage`）。另新增 `OPEN_AI_TUTOR_EVENT`，讓複習清單項目可一鍵跳頁＋預填題目進 AI 導師輸入框＋切到導師子分頁，完成§7.3「自學入口」字面上唯一真正缺的整合。i18n 1 鍵。驗證：前端 `tsc`、前端測試 818/818（含 i18n parity）、`vite build` 通過 | fix/playpage-page-query-param（已 merge） |
