# makeslide 設計文件（實作對齊版）

> 目的：記錄目前程式已落地的核心架構與流程，避免與規劃稿脫節。  
> 範圍：僅描述現況重點，不展開成完整規格書。

## 1) 系統概述

`makeslide` 是以 **Fastify + React** 為核心的語音簡報系統，支援三種來源：

- PDF 匯入（檔案上傳）
- 文字匯入（以投影片文字結構生成頁面）
- YouTube 匯入（擷取字幕後轉投影片大綱）

產物主要落在 `storage/<pdf_id>/`，包含每頁圖片、文字、講稿、音訊、`metadata.json`，可選擇手動生成影片檔。

## 2) 匯入與來源流程

### 2.1 PDF 匯入

- 路由入口：[`app.post('/api/pdfs', ...)`](backend/src/routes/pdfs/legacy.ts:444)
- 寫入來源檔後建立資料列，初始狀態可進入 `awaiting_prompt`，再由使用者送出提示開始正式處理：[`app.post('/api/pdfs/:id/start', ...)`](backend/src/routes/pdfs/legacy.ts:660)

### 2.2 文字匯入

- 前端頁面：[`ImportTextPage`](frontend/src/pages/ImportTextPage.tsx)
- 後端流程會將文字切頁（含 LLM 切頁支援）並產生對應頁面素材（圖片/講稿/音訊）。

### 2.3 YouTube 匯入

- 相關欄位與來源型別：`source_type= youtube`、`source_video_id`、`source_caption_language`
- 入口：[`app.post('/api/pdfs/youtube', ...)`（同檔定義）](backend/src/routes/pdfs/legacy.ts:1)
- pipeline 會呼叫字幕擷取服務 [`fetchYoutubeCaptions()`](backend/src/worker/pipeline.ts:20)，整理 `normalized captions`，再以 LLM 產生 `Slide N + bullets` 文字大綱，後續沿用文字流程生成頁面。

## 3) Worker Pipeline（主要步驟）

主要實作於 [`runPipeline()`](backend/src/worker/pipeline.ts:366)。依來源走不同分支，但核心可概括為：

1. 進入 `processing` 並更新 `progress_step/current/total`
2. 來源前處理  
   - PDF：轉頁圖 + 抽文字  
   - Text/YouTube：切頁或大綱化
3. 逐頁生成講稿（script）
4. 逐頁語音合成（audio）
5. 生成標題
6. 回寫 `pages` 與 `metadata.json`，完成後進入 `ready`

佇列使用 [`getProcessingQueue()`](backend/src/worker/pipeline.ts:43)（`p-queue` in-process）。

## 4) Regenerate / Rollback（現況）

已支援批次重生與可取消、可回滾：

- 啟動：[`app.post('/api/pdfs/:id/regenerate', ...)`](backend/src/routes/pdfs/legacy.ts:1401)
- 狀態查詢：[`app.get('/api/pdfs/:id/regenerate/status', ...)`](backend/src/routes/pdfs/legacy.ts:1491)
- 取消：[`app.post('/api/pdfs/:id/regenerate/cancel', ...)`](backend/src/routes/pdfs/legacy.ts:1620)
- 回滾：[`app.post('/api/pdfs/:id/regenerate/rollback', ...)`](backend/src/routes/pdfs/legacy.ts:1654)

另有單頁重生（如 `regenerate-image`、`regenerate-audio`）與 script 重寫。

## 5) Video 生成（現況）

- 手動觸發：[`app.post('/api/pdfs/:id/generate-video', ...)`](backend/src/routes/pdfs/legacy.ts:2184)
- 下載/串流：[`app.get('/api/pdfs/:id/video', ...)`](backend/src/routes/pdfs/legacy.ts:2669)
- 主要步驟實作：[`generateVideo()`](backend/src/worker/steps/generateVideo.ts:1)

此功能是「既有素材（圖片+音訊）後處理」，不是上傳後自動必跑步驟。

## 6) 主要前端頁面與狀態流

### 6.1 路由

- 首頁：[`/`](frontend/src/App.tsx:43) → [`HomePage`](frontend/src/pages/HomePage.tsx:26)
- 文字匯入：[`/import-text`](frontend/src/App.tsx:44) → [`ImportTextPage`](frontend/src/pages/ImportTextPage.tsx)
- 播放：[`/play/:id`](frontend/src/App.tsx:45) → [`PlayPage`](frontend/src/pages/PlayPage.tsx)
- 設定：[`/settings`](frontend/src/App.tsx:46) → [`SettingsPage`](frontend/src/pages/SettingsPage.tsx)

### 6.2 狀態流（使用者可見）

首頁輪詢並依狀態顯示卡片與操作：[`HomePage` polling](frontend/src/pages/HomePage.tsx:67)

- `awaiting_prompt`：等待使用者補 prompt（點卡片開 Prompt modal）
- `uploaded` / `processing`：背景處理中（5s 輪詢）
- `ready`：可進入播放頁
- `failed`：可觸發 retry

## 7) 已實作 vs 規劃中

### 已實作

- PDF/文字/YouTube 三種來源匯入流程
- 每頁圖片、文字、講稿、音訊產生與儲存
- 標題生成、首頁列表與播放頁
- regenerate（批次/單頁）、cancel、rollback
- 手動 video 生成與讀取
- prompt / tts / image-style 相關設定與更新路由

### 規劃中（尚未完整落地或仍演進）

- 更細緻的模組切分（目前 `pdfs` 路由有 legacy 委派結構）
- 更完整的可觀測性與成本儀表
- 進一步標準化 API 文件（目前以程式行為為準）
- 可能的分散式 queue/worker 架構升級

## 8) 錯誤碼與使用者提示

請參考 [`docs/error-codes.md`](docs/error-codes.md)。

