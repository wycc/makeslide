# makeslide — 功能加強 TODO

> 本文件整理自專案全面分析結果，依「結構性問題 → 功能加強（P0/P1/P2）→ 工程品質」排列。
> 每項以 `[ ]` 開頭，完成後改為 `[x]` 以便追蹤。章節內的小項可獨立領取實作。
> 相關檔案連結為點擊跳轉：[`backend/src/routes/pdfs.ts`](backend/src/routes/pdfs.ts:1)、[`backend/src/worker/pipeline.ts`](backend/src/worker/pipeline.ts:1)、[`frontend/src/pages/PlayPage.tsx`](frontend/src/pages/PlayPage.tsx:1) 等。

---

## 0. 專案現況速覽

| 面向 | 現況 |
|------|------|
| 架構 | Fastify + TypeScript + SQLite（[`better-sqlite3`](backend/package.json:17)）+ [`p-queue`](backend/src/worker/queue.ts:1) + React/Vite/Tailwind SPA |
| 輸入 | PDF（`pdftoppm` 轉圖 + `pdfjs-dist` 抽文字）、TXT（LLM splitText → 逐頁 `images.generate`） |
| AI | OpenAI Chat（`gpt-4o-mini`）、TTS（`gpt-4o-mini-tts`）、Image（`gpt-image-2`） |
| Pipeline | rendering → extracting_text → scripting → synthesizing →（可選 rendering_video）→ ready |
| 已實作的編輯能力 | 重寫逐字稿、重生單頁圖片、替換單頁圖片、新增/刪除單頁、整份重生圖、頁面 chat、合成整片 MP4 |
| 狀態管理 | `status + progress_step/current/total`，崩潰復原靠 [`rescanPendingOnStartup()`](backend/src/worker/pipeline.ts:727) |

核心 pipeline 設計相當扎實（idempotent、crash recovery、雙寫 metadata）。主要機會在**體驗、內容、工程**三個方向。

---

## 1. 結構性問題（建議先處理）

### 1.1 單檔案過度膨脹
- [ ] 拆 [`backend/src/routes/pdfs.ts`](backend/src/routes/pdfs.ts:1)（目前 1919 行、25 個 endpoint）為：
  - [ ] [`routes/pdfs.upload.ts`](backend/src/routes/pdfs.upload.ts:1)
  - [ ] [`routes/pdfs.pages.ts`](backend/src/routes/pdfs.pages.ts:1)
  - [ ] [`routes/pdfs.regenerate.ts`](backend/src/routes/pdfs.regenerate.ts:1)
  - [ ] [`routes/pdfs.chat.ts`](backend/src/routes/pdfs.chat.ts:1)
  - [ ] [`routes/pdfs.video.ts`](backend/src/routes/pdfs.video.ts:1)
  - [ ] [`routes/pdfs.assets.ts`](backend/src/routes/pdfs.assets.ts:1)（image/text/script/audio/cover/video 串流）
- [ ] DB 存取抽離到 [`repositories/pdfRepo.ts`](backend/src/repositories/pdfRepo.ts:1)、[`repositories/pageRepo.ts`](backend/src/repositories/pageRepo.ts:1)；`db.prepare(...).run(...)` 不再散佈於 route / pipeline。
- [ ] 拆 [`frontend/src/pages/PlayPage.tsx`](frontend/src/pages/PlayPage.tsx:1)（1131 行、28+ `useState`）：
  - [ ] 用 `useReducer` 或 zustand 集中狀態
  - [ ] 拆成 `<DeckViewer/>` / `<ScriptEditor/>` / `<PageChat/>` / `<TtsControls/>` / `<RegenerateDialog/>` / `<SlideThumbnailList/>`

### 1.2 DB schema 版本化
- [ ] 將 [`db.ts`](backend/src/db.ts:30) 的 `migrate()` 改為 `PRAGMA user_version` 驅動的 numbered migrations（`migrations/001_init.sql`、`002_progress.sql`……），或採用 `drizzle-orm`/`knex`。
- [ ] 補缺失索引：
  - [ ] `CREATE INDEX idx_pages_status ON pages(status)`（方便找 failed 頁面重試）
  - [ ] `CREATE INDEX idx_pdfs_status_updated ON pdfs(status, updated_at)`（後台列表排序）

### 1.3 Queue 與並行模型強化
- [ ] 現有 [`getProcessingQueue()`](backend/src/worker/queue.ts:7) + `inFlight` Set **跨程序不安全**；若要 pm2 cluster 會踩雷。
- [ ] 為 job 增加以下能力（可在 p-queue 上包一層，不一定要換 BullMQ）：
  - [ ] `AbortSignal` 支援：使用者刪除處理中 PDF → cancel 對應 worker
  - [ ] Exponential backoff 重試（針對 OpenAI 5xx / 429 獨立於 SDK 的上層重試）
  - [ ] Dead-letter：超過重試上限的 job 寫 `failed_jobs` 表供人工診斷
  - [ ] 優先級（使用者手動觸發 > 自動掃描復原）
- [ ] 把 render / script / TTS 拆成獨立 queue，個別設 concurrency（CPU-bound vs IO-bound 不應混用 `PROCESS_CONCURRENCY`）。

### 1.4 Auth 與多使用者
- [ ] 目前完全沒有 auth，任何人知道 10 字元 `pdfId` 即可全權操作。
- [ ] 導入 [`@fastify/jwt`](https://github.com/fastify/fastify-jwt) + `users` 表（argon2 雜湊密碼）。
- [ ] `pdfs` 加 `owner_id` FK；未登入或查詢非擁有者的 pdfId 一律回 **404**（隱匿存在性）。
- [ ] 前端加登入/註冊頁與 token refresh 流程。

### 1.5 成本控管可見性
- [ ] metadata 有 `usage.llm_tokens_total` / `usage.tts_chars_total` 但前端未呈現。
- [ ] 建 `usage_events` 表（`pdf_id, kind, tokens, chars, est_cost_usd, created_at`）。
- [ ] 可配置費率表 [`config.pricing.ts`](backend/src/config.pricing.ts:1)（依模型 per-1K token 費率），每次 OpenAI call 後估算並入庫。
- [ ] 前端：
  - [ ] [`PlayPage`](frontend/src/pages/PlayPage.tsx:1) 右上角常駐顯示本 deck 累計 $。
  - [ ] 破壞性動作（整份重生、影片重製、`regenerateAllImages`）顯示「預估 $X.XX，按確認繼續」Modal。
  - [ ] 新增「帳務頁」顯示每月 / 每份 PDF 的 LLM、TTS、Image 費用分布。

---

## 2. 功能加強 — P0（使用者每天會痛的）

### 2.1 SSE 取代輪詢
- [ ] 現況：[`HomePage`](frontend/src/pages/HomePage.tsx:68) 5s 輪詢、[`PlayPage`](frontend/src/pages/PlayPage.tsx:84) 3s 輪詢。
- [ ] 新增 `GET /api/pdfs/:id/events`（SSE）：
  - [ ] 後端在 [`setProgress()`](backend/src/worker/pipeline.ts:75) / [`updatePdf()`](backend/src/worker/pipeline.ts:46) 統一呼叫 `eventBus.emit(pdfId, payload)`。
  - [ ] route handler 訂閱並 `reply.raw.write(\`data: ${JSON.stringify(...)}\\n\\n\`)`。
  - [ ] 事件類型：`progress`、`page_ready`、`status_changed`、`error`、`done`。
- [ ] 前端用 `EventSource`；保留輪詢作為 fallback（舊瀏覽器/斷線重連）。

### 2.2 批次上傳 + 上傳進度條
- [ ] [`UploadButton`](frontend/src/components/UploadButton.tsx:1) 目前一次一個檔、無進度。
- [ ] 改用 `XMLHttpRequest` 或 `fetch` + `ReadableStream` 計算 `loaded/total`。
- [ ] 支援 multi-select 與 drag-drop（整個 HomePage 做為 drop zone）。
- [ ] 後端 queue 已天然支援並行，無需改動。

### 2.3 播放器體驗強化（`PlayPage`）
- [ ] **變速播放**：`audio.playbackRate` 0.75×/1×/1.25×/1.5×/2×，記憶使用者偏好（localStorage）。
- [ ] **逐字跟讀高亮**：
  - [ ] 方案 A：用 TTS 時同時請求 word timestamps（若模型支援）存 `pages.audio_timestamps_json`。
  - [ ] 方案 B：用 `audio_duration_seconds / script.length` 線性分配；已比現狀好。
- [ ] **鍵盤快捷鍵擴充**：`J/K/L` 倒退/播放/快進、`↑/↓` 調速、`F` 全螢幕、`M` 靜音、`R` 重播當前頁。
- [ ] **全螢幕簡報模式**：隱藏側欄、置中放大投影片、下方固定一行當前逐字稿 + 細進度條。
- [ ] 顯示下一頁預覽縮圖於右下角。

### 2.4 腳本品質工具
- [ ] 編輯器顯示「當前字數 / 目標字數」（[`config.openaiScriptTargetChars`](backend/src/config.ts:50)）即時計數。
- [ ] **試聽片段**：新 API `POST /api/tts/preview`（無 pdfId、短文字、有 rate limit），前端按鈕「只試聽、不覆寫 mp3」。
- [ ] **多語音快速預覽**：下拉選 voice 即播放 5 秒同段文字（沿用 `/api/tts/preview`）。
- [ ] **全部頁腳本匯出 / 匯入**：
  - [ ] `GET /api/pdfs/:id/scripts.md`：頁碼為 heading 的單檔 Markdown。
  - [ ] `POST /api/pdfs/:id/scripts`：upload 編輯後版本；backend diff 並批次重生對應頁 audio。

---

## 3. 功能加強 — P1（重要但可分批完成）

### 3.1 簡報層級編輯
- [ ] **拖拉重排頁面**：善用 [`renumberPageArtifacts()`](backend/src/services/storage.ts:132) 既有基礎；API `PATCH /api/pdfs/:id/pages/order`（body: `[{from, to}, ...]`）。
- [ ] **從另一份 PDF 匯入某幾頁**：`POST /api/pdfs/:id/merge`（source pdf_id + page ranges）。
- [ ] **封面自訂**：`pdfs.cover_page_number` 欄位 + `POST /api/pdfs/:id/cover`（也允許直接 upload）。目前硬編 page 1。
- [ ] **逐頁標籤 / 章節**：`pages.chapter_label TEXT`，播放時顯示「第 2 章 / 共 4 章」。

### 3.2 匯出與分享
- [ ] **公開分享連結**：
  - [ ] `POST /api/pdfs/:id/share` 產生 signed token（短 URL）。
  - [ ] `GET /s/:token` 僅允許讀 detail/assets，不可下載原始 PDF。
  - [ ] 可設定過期時間 / 撤銷。
- [ ] **多格式匯出**：
  - [ ] `.zip`（所有 mp3 + images + scripts + metadata.json）— 離線播放包
  - [ ] `.srt` 字幕檔（基於 script + audio duration 線性切分）
  - [ ] `.pdf` 講義（`pdfkit`；image + script 合成「投影片 + 備註」）
  - [ ] `.pptx`（[`pptxgenjs`](https://gitbrent.github.io/PptxGenJS/)；script 放進 slide notes）
- [ ] **影片加強**（擴充 [`generateVideo()`](backend/src/worker/steps/generateVideo.ts:17)）：
  - [ ] 插入章節標題卡、片頭片尾
  - [ ] 加入背景音樂（ffmpeg `amix`，可調音量）
  - [ ] 支援不同解析度輸出（720p / 1080p / 4K）

### 3.3 語音能力加強
- [ ] **SSML 標記支援**：
  - [ ] 讓使用者在 script 寫 `<break time="500ms"/>`、`<emphasis>`
  - [ ] 不支援 SSML 的 model 做 pre-processing（`…` → 停頓、`**粗體**` → 重音）
- [ ] **多講者**：一份簡報用兩種 voice 交替；加 `pages.tts_voice_override TEXT`。
- [ ] **背景音樂 / 轉場音效**：`generateVideo` 階段以 ffmpeg 疊加。

### 3.4 互動學習模式
- [ ] **整份簡報 Q&A**：`POST /api/pdfs/:id/chat`，後端先做 embedding 檢索挑最相關 3-5 頁 image + script 為 context。
- [ ] **自動小測驗**：`POST /api/pdfs/:id/quiz`；每章 3-5 題選擇題，側欄呈現、做完給分。
- [ ] **Anki 匯出**：從 script 抽「重要名詞 → 解釋」成 `.apkg`。

---

## 4. 功能加強 — P2（差異化亮點）

### 4.1 多語系輸出
- [ ] [`OPENAI_SCRIPT_LANGUAGE`](backend/src/config.ts:46) 改為 per-pdf 欄位。
- [ ] 「一鍵再生英文版 / 日文版」：保留 `source.pdf/txt`，clone 一份新 pdfId（或加 `pdfs.language` 欄位）。
- [ ] 自動翻譯 script 並重新 TTS（沿用既有 pipeline + `regenerate_flags`）。

### 4.2 知識庫 / 系列簡報
- [ ] 新增 `collections` 表 + 多對多 `collection_pdfs`。
- [ ] 可建立「某門課 / 某本書」合集、排序、統一樣式 prompt。
- [ ] 合集層級匯出單一長影片、長 MP3、長 PDF 講義。

### 4.3 `gpt-image` 風格一致性
- [ ] 現況：[`renderTextPagesWithLlm()`](backend/src/worker/steps/renderTextPagesWithLlm.ts:66) 每頁獨立 `images.generate`，頁面間風格會漂移。
- [ ] **Style seed**：第一頁生成後，呼叫 vision LLM 產出 `{palette, typography, layout_grid, illustration_style}` JSON。
- [ ] 後續頁面 prompt 前綴固定附上此 JSON。
- [ ] 新增欄位 `pdfs.style_seed_json TEXT` 長期保存。
- [ ] 進階：pre-render 一張「style seed 圖」並用 `images.edit` / reference image 做風格 transfer。

### 4.4 智慧型首次流程
- [ ] 上傳後的 [`PromptModal`](frontend/src/components/PromptModal.tsx:1) 目前只有一個自由文本框。
- [ ] 改為：
  - [ ] 後端先跑輕量 LLM 分析 PDF 前 3 頁 → 推薦聽眾類型、語氣、建議長度。
  - [ ] UI 改為「我的聽眾是 ☐ 高中生 ☐ 專業人士 …」、「我的目的是 ☐ 教學 ☐ 簡報 …」快速選單 + 微調文字框。
  - [ ] 內部把選項組成結構化 prompt。

### 4.5 增量 / 草稿模式
- [ ] **Preview 模式**：只跑第 1 頁 / 前 3 頁，讓使用者確認風格後才跑全部。
- [ ] `pdfs.mode ENUM('preview', 'full')` + `pages.is_preview BOOL`。
- [ ] `PromptModal` 多一顆「先試產 3 頁預覽」按鈕；試產滿意後再點「繼續跑完全部」。

---

## 5. 工程品質加強

### 5.1 測試覆蓋率
- [ ] 目前只有 [`backend/test/pages-api.test.ts`](backend/test/pages-api.test.ts:1) 一支。
- [ ] 為每一 pipeline step 補單元測試：
  - [ ] [`renderPages`](backend/src/worker/steps/renderPages.ts:1)
  - [ ] [`extractText`](backend/src/worker/steps/extractText.ts:1)
  - [ ] [`generateScript`](backend/src/worker/steps/generateScript.ts:1)（stub LLM 回應）
  - [ ] [`synthesizeAudio`](backend/src/worker/steps/synthesizeAudio.ts:1)（stub TTS）
  - [ ] [`generateTitle`](backend/src/worker/steps/generateTitle.ts:1)
  - [ ] [`renderTextPagesWithLlm`](backend/src/worker/steps/renderTextPagesWithLlm.ts:1)
- [ ] 把 OpenAI 呼叫抽成 `LlmGateway` / `TtsGateway` / `ImageGateway` interface；測試注入 fake 實作。
- [ ] 加一支 E2E smoke（用小 PDF + stub OpenAI）。
- [ ] 前端加 Vitest + React Testing Library 單元測試、Playwright 跑 happy path。

### 5.2 Error handling 與 observability
- [ ] 錯誤結構化：`error_message` 改存 `{ code, retryable, at_step, details }` JSON。
- [ ] 前端依 `retryable` 決定是否顯示「重試」按鈕。
- [ ] [`llm-requests.log.jsonl`](backend/src/services/openai.ts:10) 加 log rotation（pino 的 stream + `pino-roll`，或改寫 [`logger.ts`](backend/src/logger.ts:1)）。
- [ ] 接入 OpenTelemetry（fastify 有現成 plugin）：pipeline 每步做成 span，本地 jaeger / grafana tempo。
- [ ] 暴露 `/api/metrics`（Prometheus 格式）：
  - [ ] `makeslide_queue_length`
  - [ ] `makeslide_pipeline_duration_seconds` histogram
  - [ ] `makeslide_openai_cost_usd_total`
  - [ ] `makeslide_pipeline_failures_total`

### 5.3 安全性
- [ ] **TXT 上傳限制**：[`pdfs.ts`](backend/src/routes/pdfs.ts:245) 只擋 MIME + size；50MB TXT 可能切成數千頁 → 成本爆炸。加：
  - [ ] 每頁最大字數
  - [ ] 總頁數上限（重用 `openaiMaxPages` 或另設一項）
- [ ] **Prompt injection 防禦**：[`sanitiseUserPrompt()`](backend/src/worker/steps/generateScript.ts:160) 目前只截斷長度。加：
  - [ ] System prompt 最後重申規則優先
  - [ ] `user_prompt` 放到標記 `<USER_STYLE_HINT>...</USER_STYLE_HINT>`，明示只能用於風格
- [ ] [`safeJoinPdfPath()`](backend/src/services/storage.ts:170) 維持；把散佈各處的 `fs.existsSync` 改為 `fs.promises.stat` + try/catch，避免 TOCTOU。
- [ ] API 限流（[`@fastify/rate-limit`](https://github.com/fastify/fastify-rate-limit)）：對 chat、rewrite-script、regenerate-image 等貴的 endpoint 單獨設限。

### 5.4 前端效能
- [ ] [`PlayPage`](frontend/src/pages/PlayPage.tsx:128) 一次 `Promise.all` fetch 所有頁 script（30 頁 = 30 requests）。改為：
  - [ ] 後端 `GET /api/pdfs/:id?include=scripts` 直接塞 script 內容
  - [ ] 或改 lazy load（當前頁 ±2）
- [ ] 圖片加 `ETag` + `If-None-Match`；`cache-control` 改 `immutable` + 帶版號路徑。
- [ ] Code-split（React.lazy）把 `PlayPage`、`ImportTextPage` 懶載入。

### 5.5 CI / 開發體驗
- [ ] 加 `.github/workflows/ci.yml`：
  - [ ] typecheck（`npm --workspace backend run typecheck` + frontend）
  - [ ] 測試
  - [ ] ESLint + Prettier 檢查
- [ ] 加 pre-commit hook（[`husky`](https://typicode.github.io/husky/) + [`lint-staged`](https://github.com/okonet/lint-staged)）。
- [ ] 提供 Windows 相容啟動方式：
  - [ ] `npm run dev:full`（純 Node.js / `concurrently`，不靠 [`start.sh`](start.sh:1)）
  - [ ] 或提供 `start.ps1`
- [ ] 加 `docker-compose.yml`：一鍵起 backend + frontend（build 階段可選）+ 可選 Redis。
- [ ] 文件加「常見問題 / 疑難排解」小節（poppler 裝不起來、ffmpeg 缺失、OpenAI 429）。

---

## 6. 建議的實施順序（6 週示意）

| 週次 | 目標 |
|------|------|
| W1 | 拆 [`routes/pdfs.ts`](backend/src/routes/pdfs.ts:1)、導入 DB migration 版本化、加 ESLint/CI |
| W2 | SSE 取代輪詢 + 上傳進度 + 批次上傳 |
| W3 | 播放器：變速 / 全螢幕模式 / 逐字跟讀；試聽片段 & 多語音預覽 |
| W4 | 匯出：zip / srt / pptx；公開分享連結（含 token） |
| W5 | 風格一致性（style seed）+ 智慧型首次流程（prompt 推薦） |
| W6 | Auth（單人 → 多人）、成本可視化、測試補強 |

---

## 7. 優先級一覽（快查）

| 優先級 | 主題 | 重點 |
|--------|------|------|
| **P0** | SSE 進度推送 | 取代現有 3/5s 輪詢，省流量、即時回饋 |
| **P0** | 上傳進度 + 批次上傳 | 大檔體驗改善 |
| **P0** | 播放器變速 / 全螢幕 / 逐字跟讀 | 聽課類情境必備 |
| **P0** | 腳本試聽 + 多語音預覽 | 降低 TTS 重生成本的試錯 |
| **P0** | 成本可見性 | 重大動作預估費用才敢下手 |
| **P1** | 匯出 zip/srt/pptx/pdf 講義 | 從自用工具延伸到產品 |
| **P1** | 公開分享連結 | 對外分享能力 |
| **P1** | 頁面拖拉重排 / 章節 | 編輯力升級 |
| **P1** | SSML / 多講者 | 音訊品質上一階 |
| **P1** | 整份 Q&A / 自動測驗 / Anki | 學習場景擴展 |
| **P2** | 多語系、合集、style seed | 產品差異化 |
| **P2** | 智慧型首次流程、preview 模式 | 新手友善 + 成本預防 |
| **工程** | 拆檔 / 測試 / auth / observability | 可持續演進的基礎 |

---

> 📌 新需求或已完成的項目，直接修改此檔並推上 git 即可。建議在每個大節完成時，於 `docs/design.md` 同步更新對應設計章節。
