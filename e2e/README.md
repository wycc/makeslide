# E2E 測試

Playwright 介面測試。設計理由與取捨見 [`docs/e2e-testing-plan.md`](../docs/e2e-testing-plan.md)。

## 跑

```bash
npm run e2e                    # 全部
npm run e2e -- --grep 播放     # 篩選
npm run e2e:headed             # 看著它跑
E2E_RUN_ID=my-run npm run e2e  # 指定產出目錄名
```

第一次跑之前需要安裝瀏覽器：

```bash
npx playwright install chromium
```

## 它做了什麼

每次執行會：

1. 起一個 **假 OpenAI 相容伺服器**，把後端的 `OPENAI_BASE_URL` 指過去——不燒錢、輸出可預期，而且回應真實到能通過後端的解析（音檔真的能被 ffmpeg 讀出時長、圖片真的是 PNG）。
2. 以**專屬的 DB / storage / accounts 目錄**啟動一份後端（`NODE_ENV=production`，所以它同時服務 `frontend/dist`，前端與 API 同源）。不會碰到 `data/app.db` 或 `storage/`。
3. **自動登入**：直接鑄造後端認得的 session cookie（見下），不走 Google OAuth。
4. 收集證據並寫進 `artifacts/<run-id>/`。

## 自動登入

session cookie 是 `base64url(JSON).HMAC-SHA256(payload, AUTH_SESSION_SECRET)`。harness 用同一把（測試專屬的）金鑰簽出合法的票，後端無從、也不需要區分它與真實登入產生的票——所以 `owner_sub`、每帳號設定隔離、權限判定全部照常運作。

```ts
test('...', async ({ page, login }) => {
  await login('student');       // 換身分
  await page.goto(appUrl('/'));
});
```

預設身分是 `teacher`。另有 `student`、`stranger`，也可以傳自訂的 `{sub, email, name}`。不注入 cookie（`logoutUser()`）就是匿名。

## 讀失敗結果

```
artifacts/<run-id>/<spec>/<test>/
├── timeline.md      ← 先看這個
├── screenshot.png   失敗當下
├── dom.html         失敗當下的 DOM
├── console.json     瀏覽器 console
├── network.json     每個 /api 往返
├── backend.log      該測試時間窗內的後端 log
└── llm-calls.json   假 OpenAI 收到的呼叫
```

`timeline.md` 把上面全部依時間戳併成一條敘事，前端症狀與後端原因並排：

```
| 12.044s | network | → POST /api/pdfs/abc123/start |
| 12.051s | backend | ERROR ZodError: host_mode 必須是 solo 或 dual |
| 12.052s | network | ← 400 /api/pdfs/abc123/start |
```

## 寫測試時

- **路由是 hash**：前端用 `HashRouter`，所以要用 `appUrl('/play/xxx')`（產生 `/#/play/xxx`）。直接 `goto('/play/xxx')` 會 404。
- **選擇器**：全庫目前沒有 `data-testid`。優先 `getByRole`；按鈕的 accessible name 取自**內文**而不是 `title`（想用 title 就 `getByTitle`）。harness 會把 UI 語言鎖為 `zh-TW`。
- **前置資料用 `api` fixture 佈置**，比點 UI 快也穩；要驗證的那一段才走 UI。
- **斷言 `evidence.jsErrors`（未捕捉的 JS 例外），不要用 `browserErrors`**——後者含無害的資源 404，會讓人習慣忽略紅字。
- `evidence.step()` 標記動作，時間軸才讀得像敘事。

## 探索用 spec

`_explore.spec.ts`（盤點頁面上的可操作元素）與 `_probe.spec.ts`（印出 API 實際回應形狀）預設跳過，需要時：

```bash
E2E_EXPLORE=1 npm run e2e -- --grep 探索
E2E_EXPLORE=1 npm run e2e -- --grep 探測
```

寫新測試前先跑一次，比讀 3000 行的 `PlayPage.tsx` 猜選擇器快得多。
