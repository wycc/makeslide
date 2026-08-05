# Playwright 介面測試規劃：讓 LLM 拿得到前後端的執行結果

> 對應 [`V2_PLAN.md`](V2_PLAN.md) 的 P1-5。實作位於 [`e2e/`](../e2e/)。

## 1. 這件事真正的目標

一般的 E2E 只回答「過了沒」。這裡的目標不同：**當測試失敗時，LLM 要能只靠產出的檔案就診斷出原因，不必再問人、不必重跑。**

一個前端的失敗症狀（按鈕沒反應、清單是空的、卡在載入中）在後端可能是 401、500、schema 驗證失敗、或根本沒收到請求。只給截圖或只給 log 都會讓診斷停在猜測。所以每個測試都要產出**一條把前端動作、瀏覽器 console、network 往返、後端 log 依時間對齊的時間軸**。

## 2. 三個必須先解掉的阻礙

這三項不解，Playwright 測試寫出來也跑不動或不可信。

### 2.1 AI 呼叫：假的 OpenAI 相容伺服器

生成流程（逐字稿、配圖、語音、embedding）全部經過 OpenAI SDK。真的打會**燒錢、慢、而且每次結果不同**——不確定的輸出無法斷言。

作法：`OPENAI_BASE_URL` 已經是可覆寫的設定（`aiSettings.ts:227`），所以 harness 起一個本地 HTTP 伺服器實作 OpenAI 相容端點，把後端指過去：

| 端點 | 回傳 |
|---|---|
| `POST /v1/chat/completions` | 依請求內容決定的**決定性**文字；支援 `stream`（SSE）與 `tool_calls` |
| `POST /v1/images/generations`·`/edits` | 以 sharp 即時產生的純色 PNG（`b64_json`），尺寸依請求 |
| `POST /v1/audio/speech` | 真實可解碼的無聲 MP3／PCM（ffmpeg 產生後快取），因為後端會交給 ffmpeg 量長度 |
| `POST /v1/embeddings` | 由輸入字串雜湊出的固定向量（同輸入必同向量，可測相似度） |

關鍵是**回應要真實到足以通過後端的解析**：音檔必須真的能被 ffmpeg 讀出時長，圖片必須真的是 PNG，否則測到的是假伺服器的 bug 而不是產品的。

假伺服器同時**記錄每一次呼叫**（模型、prompt 長度、時間），成為證據的一部分——「這個功能到底有沒有打 LLM、打了幾次」本身就是常見的 bug（例如重複扣額度）。

### 2.2 自動登入：直接鑄造 session cookie

登入是 Google OAuth。E2E 不可能、也不該真的走一次 Google。

作法：session cookie 的格式是 `base64url(JSON).HMAC-SHA256(payload, AUTH_SESSION_SECRET)`，而 `encodeSession()` 在 [`backend/src/routes/auth.ts`](../backend/src/routes/auth.ts) 是 exported 的。harness 用同一把 secret 啟動後端，就能直接鑄造合法 session 並用 `context.addCookies()` 注入瀏覽器。

這條路的好處不只是「跳過登入」：

- **走的是真正的登入後路徑**。不是繞過驗證，是產生一個後端無法與真實登入區分的 session，`owner_sub`、每帳號 AI 設定隔離、權限判定全部照常運作。
- **可以有多個角色**。`asTeacher()` / `asStudent()` / `asStranger()` 只是鑄造不同的 `sub`，因此權限測試（別人的簡報看不到、別人的測驗成績不計入）才寫得出來。
- **可以測未登入**。不注入 cookie 就是匿名，用來驗證 401 與分享連結的能力憑證行為。

> 安全性：鑄造能力只存在於 e2e harness，且需要 `AUTH_SESSION_SECRET`——與生產的 secret 不同。harness 啟動的後端一律使用專屬的測試 secret、測試 DB 與測試 storage，不會碰到 `data/app.db` 或 `storage/`。

### 2.3 選擇器：目前全庫 0 個 `data-testid`

而且介面是雙語的，文字會隨語言設定改變。用中文字串當選擇器，之後有人把 UI 語言預設改成英文，測試就全紅。

作法（分兩層，不要求一次到位）：

1. **現在**：harness 在每個測試開始前把 UI 語言鎖定為 `zh-TW`（寫入 localStorage），選擇器優先用 `getByRole` 搭配 accessible name，其次才用文字。
2. **逐步**：在寫測試時**只對真的抓不到的元素**補 `data-testid`，不做全庫預先標注。標注本身是產品程式碼的變更，應該由需求驅動。

## 3. 架構

```
e2e/
├── harness/
│   ├── fakeOpenAI.ts   # OpenAI 相容假伺服器 + 呼叫記錄
│   ├── stack.ts        # 建置前端 → 以測試 DB/storage 啟動後端 → 收集後端 log
│   ├── session.ts      # 鑄造 session cookie（多角色自動登入）
│   ├── evidence.ts     # 收集 console/network/後端 log/截圖，合併成時間軸
│   └── fixtures.ts     # Playwright fixture：page / api / evidence / db
├── specs/*.spec.ts
└── artifacts/<run>/    # 產出（gitignored）
```

**單一 origin**：後端在 `NODE_ENV=production` 下會以 `@fastify/static` 服務 `frontend/dist`，所以 harness 只啟動**一個** process，Playwright 打同一個位址。沒有 dev proxy、沒有跨埠 cookie 問題，而且前端行為與後端 log 天然對得起來。

**完全隔離**：專屬 `DB_PATH`、`STORAGE_ROOT`、`AUTH_SESSION_SECRET`、`PORT`，每次執行前清空。跑 E2E 不會動到開發資料。

## 4. 證據模型（這份規劃的重點）

每個測試產出一個目錄：

```
artifacts/<run-id>/<spec>/<test>/
├── timeline.md      # ← LLM 主要讀這個
├── screenshot.png   # 失敗當下（或每個關鍵步驟）
├── console.json     # 瀏覽器 console，含 stack
├── network.json     # 每個 /api 往返：method/path/status/耗時/請求與回應摘要
├── backend.log      # 該測試時間窗內的後端 log（已對齊）
├── llm-calls.json   # 假 OpenAI 收到的呼叫
└── dom.html         # 失敗當下的 DOM 快照
```

`timeline.md` 是把上述來源依時間戳合併成一條可讀的敘事：

```markdown
## ❌ 上傳 PDF 後應進入生成流程

- 12.031s  [action]   click "開始生成"
- 12.044s  [network]  → POST /api/pdfs/abc123/start
- 12.051s  [backend]  ERROR ZodError: host_mode 必須是 solo 或 dual
- 12.052s  [network]  ← 400 (8ms) {"error":{"code":"VALIDATION_FAILED",...}}
- 12.070s  [console]  Error: 開始生成失敗
- 12.090s  [assert]   FAILED expect(status).toBe('processing') — 實際為 'awaiting_prompt'
```

前端症狀（按鈕沒反應）與後端原因（zod 拒絕）**並排在同一條時間軸上**，這是整個設計的目的。

另外每次執行產出 `report.md` 總表：通過／失敗、耗時、失敗測試的一行摘要與其 `timeline.md` 連結。

## 5. 覆蓋範圍

依「壞掉最痛」排序，而非依程式碼結構。

| 層級 | 範圍 |
|---|---|
| **P0 主線** | 匿名/登入的存取控制、首頁清單與篩選、建立空白簡報、文字大綱→生成→播放、播放控制與翻頁 |
| **P0 課堂** | 投票建立與作答、同步 session（老師開→學生加入→跟頁）、提問 |
| **P1 評量** | 測驗編輯與作答計分、課後輔導測試（出題／難度升降／主題分數）、課後報告 |
| **P1 編輯** | 新增／刪除／重排頁面、單頁重生、逐字稿編輯 |
| **P1 設定** | 設定頁讀寫、供應商切換、API key 對話框（含語言切換） |
| **P2 匯出** | ZIP 匯出入、字幕、handout |

**權限與多角色**是橫切關注點，不獨立成一節：每個涉及資料的測試都應該有一個「換一個 `sub` 就看不到／改不動」的斷言。

## 6. 執行

```bash
npm run e2e              # 全部
npm run e2e -- --grep 播放   # 篩選
npm run e2e:headed       # 看著它跑
```

CI（`ci.yml`，V2_PLAN P1-4 第 4 項）先跑 typecheck 與單元測試，再跑 E2E；artifacts 於失敗時上傳。

## 7. 刻意不做

- **不測 AI 產出的品質**。假伺服器回的是決定性內容，測的是「流程有沒有把它正確地存下來、顯示出來」。品質評估是另一件事。
- **不追求覆蓋所有頁面**。E2E 昂貴且脆弱，把預算放在主線與跨元件的互動上；純函式邏輯已經有 2463 項單元測試覆蓋。
- **不在 E2E 裡驗證視覺樣式**。截圖是給人和 LLM 看的證據，不做像素比對——那會在字型與渲染差異上不斷誤報。
