# Jupyter Notebook 整合實作計畫（接環境內既有 kernel）

> 目標：把一個 `.ipynb` 當成「一個簡報頁」，在該頁中**一次顯示一個 cell**並可就地執行，使用真正的 Jupyter kernel。
>
> 本計畫為「先出計畫供審核」的產物，尚未開工。審核通過後依 CLAUDE.md 流程開獨立分支實作。

## 0. 確定的前提（依使用者裁示）

1. **環境內已有一台 JupyterLab/Jupyter server**，我們只做一個前端去連它的 kernel —— 不自己 spawn server、不做 server 生命週期管理。
2. **一個簡報頁 = 一個 `.ipynb` 檔 = 一個 kernel**。同一頁的所有 cell 共用同一個 kernel（變數跨 cell 保留）；不同頁是不同檔、不同 kernel（狀態天然隔離）。
3. **一次只顯示一個 cell**。cell 內容超過一個螢幕時，cell 區域自身出現**垂直捲軸**（不溢出頁面）。
4. **鍵盤**：
   - `↑`/`↓`：在當前 notebook 內切換上一個／下一個 cell。
   - `Space` / `←` / `→`：維持既有的**換簡報頁**行為（切到前後頁）。
   - 編輯某個 cell 時（焦點在編輯器內）按鍵交給編輯器，不換 cell/頁。
5. **notebook 頁沒有語音**：不產生 TTS、不參與播放計時/自動換頁，純互動式手動執行。
6. **執行結果即時存回 `.ipynb`**：每次執行後把輸出寫回該頁的 `.ipynb`，下次開啟或他人觀看時看得到上次結果（不是階段 4 才做，屬核心）。

### 本系統的既有基礎（使整合輕量）
- **部署已是 JupyterHub 風格**：[server.ts](../backend/src/server.ts) 已支援 `NB_PREFIX`（base-URL 前綴，第 92–118 行），`Dockerfile` 用 `/home/jovyan`、`PORT=8888`。MakeSlide 與 Jupyter server 很可能**同源**，瀏覽器已持有該 session 的認證 cookie。
- **全域鍵盤導覽**集中在 [PlayPage.tsx:1656-1763](../frontend/src/pages/PlayPage.tsx#L1656)：`Space`/`←`/`→` 已是換頁；**焦點在 `INPUT`/`TEXTAREA`/`contentEditable` 時整段略過**；`↑`/`↓` 目前未被使用 → 可無衝突地配給 cell 切換。
- 前端已有沙箱 iframe 執行模式（[buildCustomScriptSandboxDoc](../frontend/src/lib/animationSpec.ts)）與 **KaTeX** 依賴，可直接複用於輸出渲染。

## 1. 連線模型（最小化）

我們只需要「Jupyter server 的 base URL + 認證」兩項，用官方 **[`@jupyterlab/services`](https://www.npmjs.com/package/@jupyterlab/services)** 的 `ServerConnection` / `KernelManager` / `SessionManager` 連線。

- **同源 cookie 模式（首選，正式環境）**：MakeSlide 由 Jupyter server / 同一 Hub 代理在同源下提供時，`@jupyterlab/services` 用瀏覽器既有 cookie + XSRF token 即可呼叫 `/api/kernels`，**不需要把 token 寫進前端**。base URL 預設為當前 origin + `NB_PREFIX`。
- **顯式 URL + token 模式（開發/桌面）**：以 `ServerConnection.makeSettings({ baseUrl, token, wsUrl })` 連線。連線參數由後端一條受 session 保護的端點下發（見 §2.2），token 不寫死在前端 bundle。

> 因為「環境內已有 server」，本計畫**不含** spawn jupyter server、不含 per-account server 生命週期。kernel 由我們建立、用完回收（見 §1.3）。

### 1.1 渲染：一次一個 cell 的自製極簡 notebook
不嵌完整 JupyterLab UI（風格不合、且我們只要單一 cell 視圖）。以 `@jupyterlab/services` 走 WebSocket 直接跟 kernel 溝通，前端自畫：

- **單 cell 視圖**：只渲染「目前 cell」。容器固定為頁面可視高度，`overflow-y: auto` → 內容過長時 cell 內捲動（約束 3）。
- cell 種類：`code`（可執行，顯示輸入 + 輸出）、`markdown`（渲染顯示）、`raw`（純文字）。
- 頁腳顯示 cell 位置（如 `3 / 12`）與 kernel 狀態（idle/busy/dead）。
- **輸出 MIME 渲染**（復用既有資產）：`stream`/`text/plain` 純文字；`text/markdown` 走計畫中的 markdown 渲染器；`image/png|jpeg`/`text/html` 放沙箱 iframe；`text/latex` 走 KaTeX；`error` 顯示 traceback（ANSI 上色可後續加）。

### 1.2 cell 切換與執行（鍵盤）
採 Jupyter 的 **command / edit 雙模式**，與既有全域鍵盤天然相容：

| 模式 | 觸發 | `↑`/`↓` | `Space`/`←`/`→` | `Enter` |
|---|---|---|---|---|
| **command**（未聚焦編輯器） | 預設 | 切換 cell（在 NotebookPanel 攔截、`stopPropagation`） | 換簡報頁（全域 handler，照舊） | 進入 edit |
| **edit**（聚焦編輯器） | 點 cell / 按 Enter | 移動游標（編輯器接管） | 輸入字元 / 移動游標 | 換行 |

- command 模式下 `↑`/`↓` 由 NotebookPanel 的 keydown 處理並 `stopPropagation`，避免冒泡；`Space`/`←`/`→` **不攔截**，自然交給 [PlayPage.tsx](../frontend/src/pages/PlayPage.tsx) 全域換頁。
- edit 模式下編輯器是 `textarea`/`contentEditable`，全域 handler 既有的「焦點在輸入元件就略過」邏輯讓所有鍵自動讓位，無需改全域程式。
- **執行**：`Ctrl+Enter` 執行當前 cell（原地）、`Shift+Enter` 執行並切到下一個 cell；另提供執行鈕。執行送 `kernel.requestExecute`，串流 `iopub` 訊息即時更新輸出。

### 1.3 kernel 生命週期（per 檔案）
- 前端維護 `Map<notebookFileKey, KernelConnection>`：第一次需要時（進入該頁或首次執行）才 `startNew`，之後該頁的所有 cell 共用。
- 換到別的簡報頁時 kernel **保留為 warm**（回到該頁時變數與輸出還在）；離開整個播放頁、或閒置逾時時關閉（`kernel.shutdown`），避免累積。
- 提供「重啟 kernel」「清除輸出」動作（比照 Jupyter）。
- **輸出持久化**：每次 cell 執行結束（`iopub` 收到 `status: idle`、`execution_count` 確定後），把該 cell 的 outputs 與 `execution_count` 併回 nbformat，呼叫 `PUT .../notebook` 寫回 `.ipynb`（debounce 合併連續執行）。重啟/清除輸出同樣寫回。

## 2. 後端工作項（很薄）

### 2.1 設定（[config.ts](../backend/src/config.ts) EnvSchema，沿用既有 zod 寫法）
- `JUPYTER_ENABLED`：default `false`（未開啟時整功能隱藏，零風險上線）。
- `JUPYTER_BASE_URL`：default 空 → 前端用同源 + `NB_PREFIX`。
- `JUPYTER_TOKEN`：選配（開發/桌面顯式 token；正式走同源 cookie 時留空）。

### 2.2 端點
- `GET /api/jupyter/connection`（受 session 保護）：回 `{ baseUrl, wsUrl, token? }` 給前端建立連線；正式環境不回 token（靠 cookie）。
- `.ipynb` 資產（沿用既有 page-operations 路由與 account 隔離）：
  - `GET /api/pdfs/:id/pages/:n/notebook` 取 nbformat JSON。
  - `PUT /api/pdfs/:id/pages/:n/notebook` 存檔（編輯 cell / 寫回執行結果時）＋更新 DB/metadata。

### 2.3 資料模型
- `SlideRenderType` 擴充：`'static-image' | 'gsap-image' | 'notebook'`（[backend/src/types.ts:171](../backend/src/types.ts#L171) 與 [frontend/src/types.ts:196](../frontend/src/types.ts#L196) 兩處同步）。
- `pages` 新欄位 `notebook_path TEXT`（比照既有 `animation_spec_path` 的 migration 寫法）。
- `.ipynb` 存 `pages/<page_uid>.ipynb`（比照 [storage.ts](../backend/src/services/storage.ts) `pageImagePath` 慣例，重排序免改檔名）。
- `metadata.json` 同步 notebook 欄位，維持 DB↔metadata 一致（呼應 TODO 既有的一致性教訓，成功/失敗路徑都重寫）。
- **notebook 頁無音訊**：`audio_path`/`audio_duration_seconds` 維持 null；播放就緒判定（[playbackReadiness.ts](../frontend/src/pages/play/playbackReadiness.ts)）、TTS 產生、總時長統計、自動換頁計時都要把 `render_type === 'notebook'` 視為「無語音頁」略過，避免被當成「缺音訊待產生」。

## 3. 前端工作項

### 3.1 依賴
- 新增 `@jupyterlab/services`（+ 必要 `@lumino/*` peer）。bundle 不小，**lazy-load**：只在開啟 notebook 頁時動態 `import()`，不拖累主播放頁。
- 程式編輯器：先用 `<textarea>` + 等寬字體與捲動（最小可用）；若要語法highlight 再評估 CodeMirror（JupyterLab 同款），列為後續。

### 3.2 元件
- `NotebookPanel.tsx`：單 cell 視圖（含捲軸容器）、command/edit 模式、cell 計數、kernel 狀態列、執行/重啟/清除。
- `useJupyterKernel.ts` hook：用 `@jupyterlab/services` 建 session/kernel、`requestExecute`、串流 `iopub`、維護 §1.3 的 per-file 連線 registry。連線參數來自 §2.2。
- `nbformatModel.ts`（純函式、可單元測試）：解析/序列化 nbformat、cell 索引切換、把 `iopub` 訊息 reduce 成輸出陣列。
- 在 [SlideRenderer.tsx](../frontend/src/components/slide/SlideRenderer.tsx) 的 `renderType` 分流（`gsap-image` 在第 433 行）新增 `notebook` 分支，渲染 `NotebookPanel`。
- 輸出沙箱：`image/*`、`text/html` 走沙箱 iframe（沿用 `buildCustomScriptSandboxDoc` 的 sandbox 屬性思路）；`text/latex` 走 KaTeX。

### 3.3 鍵盤整合
- NotebookPanel 在 command 模式攔 `↑`/`↓`（`stopPropagation`），不動 [PlayPage.tsx](../frontend/src/pages/PlayPage.tsx) 全域 handler。
- 驗證：notebook 頁時 `Space`/`←`/`→` 仍正確換頁；`↑`/`↓` 切 cell；編輯 cell 時兩者都讓位給編輯器。

### 3.4 i18n
字串進 [locales](../frontend/src/locales/)（en + zh-TW），比照既有 `play.sidebar.notebook.*` 命名。

## 4. 安全性
- kernel 在使用者自己的 Jupyter 情境執行（同源 cookie / Hub single-user server 天然如此）。
- 連線 token 不寫進前端 bundle；正式走同源 cookie。
- 執行能力對應權限：簡報擁有者 / `public_editable` 協作者可執行；read-only 觀看者僅看輸出、不可執行。
- 輸出大小上限、執行逾時、ANSI/HTML 經沙箱與淨化後再渲染。

## 5. 測試
- 後端：notebook 資產 CRUD、account 隔離、`/api/jupyter/connection` 行為、DB↔metadata 一致性（比照 `add-pages-metadata-resync.test.ts`）。
- 前端：`nbformatModel` 的 cell 切換 / `iopub` reduce / MIME 選擇（純函式，比照 `notebookTabs.test.ts` 的可測風格）；鍵盤 command/edit 分流的單元測試。
- kernel 連線走手動/整合驗證，不在單元測試起真 kernel。

## 6. 分期交付
1. **MVP**：notebook render type + 無音訊頁處理 + 同源連線 + 單 cell 顯示（含捲軸）+ `↑`/`↓` 切 cell + code cell `Ctrl/Shift+Enter` 執行 + 純文字/錯誤輸出 + **執行結果寫回 `.ipynb`**。
2. **完整輸出**：markdown/raw cell、`image`/`html`/`latex` 輸出、kernel 狀態列、重啟/清除（同步寫回）。
3. **編輯**：cell 內容編輯、語法 highlight（CodeMirror）。
4. **進階**（選配）：AI 由主題產生可執行 notebook 頁、匯出時包含 notebook。

## 7. 已釐清（全部敲定）
- ✅ kernel 來源：環境內既有 server，前端只連。
- ✅ 顆粒度：一頁一檔一 kernel，cell 內共用、跨頁隔離。
- ✅ 顯示：一次一 cell，溢出捲動；`↑`/`↓` 切 cell、`Space`/`←`/`→` 換頁。
- ✅ notebook 頁**無語音**：排除於 TTS／播放計時／就緒判定。
- ✅ 執行結果**即時寫回 `.ipynb`**（MVP 即含）。
