# MakeSlide 2.0 重點改善方向

> 本文件是 2026-08-03 針對整個程式庫做一次完整檢討後，對下一個大版本（2.0）的規劃。
> 與 [`FUTURE_ROADMAP.md`](FUTURE_ROADMAP.md) 的分工：那份談「還可以做哪些功能」，本文談「要先把哪些底層問題解決，功能才長得下去」。
> 文中所有數字都在 master（commit `2ec2f60d`）實測取得，量測方式附在 [附錄 A](#附錄-a量測方式)。
>
> English version: [`V2_PLAN.en.md`](V2_PLAN.en.md)

---

## 1. 一句話結論

**1.x 的主軸是「把功能做出來」，2.0 的主軸應該是「讓它撐得住一堂真實的課」。**

程式本身的健康度其實不差——`tsc --noEmit` 前後端全綠、全庫只有 7 處 `any`、2463 個測試、關鍵邏輯普遍抽成純函式並單獨測試。問題不在程式碼寫得好不好，而在**規模累積出來的結構性風險**：一個 3014 行的播放頁、一個 419 欄位的 context、一份 1.68 MB 的單塊 JS、一個沒有 ErrorBoundary 的教學現場、一個用 `npx tsx` 跑原始碼的生產映像。

這些在「一個人開發、自己 demo」時都不會痛；在「老師站在教室前面，30 個學生用手機掃 QR 進來」時，每一項都會痛。

---

## 2. 現況盤點（實測）

### 2.1 規模

| 項目 | 數值 |
|---|---:|
| 後端原始碼 | 38,484 行 / 146 個 `.ts` |
| 前端原始碼 | 58,061 行 / 320 個 `.ts`·`.tsx` |
| HTTP 路由 | 225 支 |
| 資料表 | 34 張（`db.ts` 957 行的累積式 migration） |
| i18n 鍵 | 2,420 鍵 × 2 語系 |
| 後端測試 | 226 檔 / 1,610 項 |
| 前端測試 | 123 檔 / 853 項 |

### 2.2 健康的部分（不要在 2.0 破壞掉）

- **型別紀律**：後端 5 處、前端 2 處 `any`，`tsc --noEmit` 全綠。
- **純函式抽取**：難的邏輯（難度階梯、選項重排、時間軸對齊、動畫幾何、報告聚合）都抽成可單測的純函式，前端 123 個測試檔幾乎全是這類。這是這個專案最值得保留的習慣。
- **測試速度**：後端 1,610 項 23 秒跑完，前端 853 項數秒。快到可以每次改動都跑。
- **帳號情境隔離**：`AsyncLocalStorage` 承載 account context，背景工作以簡報 `owner_sub` 重新進入情境，不受觸發者身分污染——這個設計是對的。
- **註解品質**：關鍵決策點多半寫了「為什麼」而不只是「做什麼」。

### 2.3 風險清單（依嚴重度）

| # | 問題 | 實測證據 |
|---|---|---|
| R1 | 播放頁沒有錯誤邊界 | 全庫 **0 個 ErrorBoundary**；任一 render 例外 = 上課中整頁白畫面 |
| R2 | 學生端沒有行動版 | `PlayPage.tsx` 全檔僅 **2 處**響應式 class（`sm:`/`md:`/`lg:`） |
| R3 | 前端載入成本 | 主 chunk **1.68 MB**（未壓縮），無路由層 code splitting；2,420×2 個 i18n 鍵全部進主 bundle |
| R4 | 播放頁複雜度 | `PlayPage.tsx` **3,014 行 / 173 個 hook 呼叫**；`PlayPageContext` **419 個欄位** |
| R5 | 生產映像跑原始碼 | Dockerfile runtime 用 `npx tsx backend/src/server.ts`，build 階段產出的 `dist/` 被複製進去卻沒用；外層 `while true` 當 supervisor，無 healthcheck、無 graceful shutdown |
| R6 | 沒有 CI 測試 | `.github/workflows/` 只有 `release.yml`；push / PR **不跑任何測試** |
| R7 | 測試互相污染 | 完整套件 1,610 項有 **5 項失敗**，隔離重跑全過（全域 mock / 共用 DB·fs 殘留） |
| R8 | 即時性靠輪詢 | 前端 **20 處 `setInterval`**，同步播放、投票、匯出進度全是輪詢；除 Jupyter proxy 外無 SSE / WebSocket |
| R9 | 產物無生命週期 | `storage/` **5.6 GB / 1,680 個簡報**，無保留策略；`data/` 留著兩份 16 MB 手動 `.bak` |
| R10 | 後端檔案過大 | `detail.ts` 87 KB / **45 支路由**、`page-operations.ts` 76 KB、`quizzes.ts` 61 KB、`pipeline.ts` 55 KB；`db.ts` 957 行為累積式 migration |
| R11 | 無 lint / 無元件測試 / 無 E2E | 無 ESLint·Prettier；前端 **0 個元件測試**（123 檔全是純函式）；`playwright` 在 devDeps 但**零使用** |
| R12 | 無速率限制 | 後端無任何 rate limit；分享連結是能力憑證，一支公開的生成端點即可燒完帳號配額 |

---

## 3. 2.0 的六個重點方向

排序依據：**先保住上課不中斷，再降低改動風險，最後才談擴充。**

---

### P0-1　教學現場的可靠性：不要在課堂上白畫面

**問題**　播放頁是這個產品唯一「有人在現場等」的畫面，卻是全庫防護最薄的：0 個 ErrorBoundary，任何一個 render 例外（一筆壞掉的動畫 spec、一則畸形的投票 JSON、一次 API 回傳形狀不符）都會讓整頁消失。老師當下沒有任何補救手段，只能重新整理並祈禱。

同一類問題還有：20 處輪詢在網路抖動時沒有統一的退避與復原策略；同步 session 的 follower 斷線後靠下一次輪詢自癒，中間那段時間畫面停在舊頁。

**做法**

1. **三層 ErrorBoundary**：頁面層（保住 header 與「回首頁」）、面板層（單一側欄分頁掛掉不影響播放）、投影片層（單頁 render 失敗顯示原圖 + 錯誤徽章，仍可翻頁與播音）。
2. **錯誤回報通道**：boundary 觸發時把 component stack、簡報 id、頁碼、最近 N 個動作寫到後端 `page_artifact_events` 之外的新事件表，讓「上課出事了」變成可查的資料而不是口述。
3. **輪詢收斂為一個 hook**：統一的 `usePolling(fetcher, {interval, backoff, onReconnect})`，取代散落的 20 處 `setInterval`；斷線時指數退避、恢復時立即補一次。
4. **同步播放改 SSE**：`GET /api/pdfs/:id/sync/stream` 推送頁碼與播放狀態，輪詢降為 fallback。教室裡 30 個 follower 每 2 秒打一次 API 是純粹的浪費，而且延遲下限就是輪詢間隔。

**驗收**　注入式故障測試：對播放頁的動畫 spec / 投票資料 / 詳情 API 各注入一種壞資料，確認頁面仍可翻頁播音且錯誤被記錄；SSE 下 follower 跟頁延遲 p95 < 500 ms。

---

### P0-2　學生端行動裝置：一半的使用者在手機上

**問題**　分享連結 + QR code 是既有功能，也就是說**產品預期學生用手機加入**——但 `PlayPage.tsx` 3,014 行裡只有 2 處響應式 class。學生端實際會用到的東西（看投影片、聽語音、答投票、作測驗、提問、課後輔導測試）全部擠在為桌機設計的三欄佈局裡。

**做法**

1. **拆出學生端佈局**，而不是把老師端擠小：單欄、投影片優先、互動元件從底部抽屜升起。共用同一組資料 hook，只換 shell。
2. **觸控優先的互動**：投票/測驗選項最小點擊區 44×44、答題不需要精準點選、手寫標註在觸控裝置預設關閉。
3. **直向/橫向都可用**：直向看投影片 + 字幕，橫向全螢幕投影片。
4. **a11y 一併補**：目前 320 個檔案共 174 個 `aria-*`、34 個 `role=`，密度偏低。至少把互動主線（播放控制、投票、測驗）補到可用鍵盤與螢幕閱讀器完成。

**驗收**　在 375×667 與 390×844 兩種尺寸下，學生端完整走完「加入 → 看 → 投票 → 作測驗 → 提問」不需要橫向捲動；鍵盤可完成同一條路徑。

---

### P1-3　前端解構：讓播放頁可以被安全地改

**問題**　`PlayPage.tsx` 3,014 行、173 個 hook 呼叫，`PlayPageContext` 419 個欄位。實務上的後果是：**任何改動的影響範圍都無法靠閱讀判斷**，只能靠「跑起來看看」。這也是為什麼前端 123 個測試檔全是純函式測試、0 個元件測試——目前的元件根本無法在測試裡實例化。

主 bundle 1.68 MB 是同一個問題的另一面：所有東西都在一張圖上，自然也就切不開。

**做法**

1. **context 按領域切開**：`PlaybackContext`（頁碼、音訊、時間軸）、`AuthoringContext`（編輯、重生、動畫）、`ClassroomContext`（同步、投票、提問）、`AnalyticsContext`（報告、測驗）。419 個欄位裡有很大一部分只被單一分頁使用。
2. **播放核心狀態機化**：目前播放/暫停/等待/同步/互動模式是多個 boolean 的組合，其中有相當多組合是不合法的。改成顯式狀態機後，「互動模式下暫停又剛好在切頁」這類 bug 從邏輯上不可能發生。
3. **路由層 code splitting**：`HomePage` / `PlayPage` / `SettingsPage` / `QuizBuilderPage` / `RemoteControllerPage` 各自 lazy；目前只有 CodeMirror 被切出去（472 KB）。
4. **i18n 動態載入**：2,420 鍵 × 2 語系（原始碼 305 KB）全部進主 bundle，而使用者一次只用一種語言。按語系切 chunk，並加上「鍵覆蓋率」檢查（zh-TW 有、en 沒有的鍵在 CI 擋下）。
5. **導入元件測試**（Testing Library）：先只覆蓋學生端主線與播放控制，不追求覆蓋率數字。

**驗收**　主 chunk < 600 KB；`PlayPage.tsx` < 800 行；學生端主線有元件測試；改動一個側欄分頁不需要碰 `PlayPageContext`。

---

### P1-4　部署與營運：讓 2.0 可以被別人裝起來

**問題**　目前的 Dockerfile 有幾個具體缺陷：

- runtime 執行 `npx tsx backend/src/server.ts`——**跑的是 TypeScript 原始碼**，build 階段辛苦產出的 `backend/dist` 被 `COPY` 進映像卻從未使用。啟動慢、記憶體多、每次重啟重新轉譯。
- runtime stage 仍安裝 `make` / `g++` 並再跑一次完整 `npm install`（含 devDependencies），映像遠比需要的肥。
- 程序監管是 `while true; do ...; sleep 2; done`——沒有 healthcheck、沒有 graceful shutdown（正在合成語音的工作直接被砍）、沒有退出碼判讀（設定錯誤會無限重啟）。
- CI 只有 `release.yml`；**push 和 PR 不跑任何測試**，1,610 項後端測試只在本機跑。

**做法**

1. runtime 改跑 `node backend/dist/server.js`，runtime stage 只 `npm ci --omit=dev`，移除編譯工具鏈。
2. 加 `HEALTHCHECK` 與 `/api/health` 的實質檢查（DB 可讀、storage 可寫、poppler/ffmpeg 在位）。
3. `SIGTERM` graceful shutdown：停止收新工作、等待進行中的 pipeline 到可中斷點、flush WAL。
4. **新增 `ci.yml`**：PR 與 push 跑 `typecheck` + 後端 + 前端測試。這是投報率最高的一項——成本一小時，之後每次改動都受保護。
5. `npm test` 納入前端（TODO 已記錄為待決事項，2.0 應該直接做掉）。
6. **產物生命週期**：`storage/` 5.6 GB、1,680 個簡報且無保留策略。加入可設定的保留規則（影片與匯出 ZIP 這類可重生的中間產物優先）、刪除簡報時的孤兒檔案回收、以及一支盤點腳本。

**驗收**　映像體積下降 ≥ 40%；`docker stop` 不中斷進行中的語音合成；CI 在 PR 上綠燈才可 merge。

---

### P1-5　測試與變更安全網

**問題**　完整套件 1,610 項有 5 項失敗，隔離重跑全過（`figure-reference-image-generation`、`share` 可見性、`sync` follower）。根因是測試間的全域狀態污染：`setOpenAIClientForTest` 的 mock、`setSystemAuthSettings`、共用的 DB 與 `data/test-storage`（目前已累積 29 MB / 1,166 個目錄）。

這件事的真正代價不是「5 個紅字」，而是**團隊會學會忽略紅字**——一旦「有幾個是本來就會失敗的」變成常識，真正的回歸就藏得住了。

**做法**

1. 每個測試檔自帶 setup/teardown 還原全域；`data/test-storage` 每檔獨立目錄並在結束時清除。
2. 修掉這 5 項，讓完整套件**必須全綠**，並在 CI 上以此為門檻。
3. 查清本機「測試 process 跑完不自行退出、需要 `--test-force-exit`」的根因——那代表有沒關掉的 handle（timer / DB / 子程序），在生產同樣會漏。
4. 導入 ESLint + Prettier（規則從嚴到寬逐步收，先擋 `no-floating-promises`、`no-misused-promises` 這類真的會出事的）。
5. 用已在 devDeps 卻零使用的 `playwright` 補 3 條 E2E：上傳→生成→播放、老師開同步→學生加入→投票、學生作測驗→看課後報告。

**驗收**　完整套件全綠且無需 `--test-force-exit`；CI 上 lint + test + 3 條 E2E 為 merge 門檻。

---

### P2-6　後端模組邊界與 API 契約

**問題**　`detail.ts` 87 KB 裡塞了 45 支路由，`page-operations.ts` 76 KB、`quizzes.ts` 61 KB。這些檔案已經到了「要改一個端點得先讀 2,000 行找到它」的程度。

`db.ts` 是 957 行、涵蓋 34 張表的累積式 migration：一長串 `if (!columnExists(...)) ALTER TABLE ...`。它有效，但**沒有版本號、沒有回滾、沒有「這個 schema 應該長什麼樣」的單一事實來源**。TODO 裡已經有一次因為新表被寫進別的 `tableExists` 區塊、導致既有資料庫永遠拿不到那張表的紀錄——這正是這種 migration 風格的典型故障。

225 支路由沒有 OpenAPI 契約，前端 `lib/api/pdfs.ts` 2,814 行是手寫的鏡像。

**做法**

1. `detail.ts` / `page-operations.ts` / `quizzes.ts` 按資源切成子模組（每檔 < 15 KB），純搬移不改行為，一次一檔並以既有測試護航。
2. **schema 版本化**：`schema_version` 表 + 有序 migration 檔（`001_*.ts`…），啟動時檢查並依序執行；保留現有 `columnExists` 路徑作為既有資料庫的一次性收斂。
3. **從 zod schema 產生 OpenAPI**（路由已大量使用 zod），前端型別由此生成，取代手寫鏡像。
4. 收掉已知重複：`buildContentDisposition` 目前有兩份不同實作（TODO 已記錄待裁示）。

**驗收**　無單檔 > 20 KB 的路由檔；migration 有版本號且可從空資料庫與現有資料庫兩條路徑重建；前端 API 型別由契約生成。

---

## 4. 兩個值得一併處理的產品面問題

這兩項不是技術債，是 1.x 快速長功能的自然結果。

### 4.1 功能密度

播放頁 header 已經塞不下了（TODO 中已列為待辦）。2.0 應該做**任務導向的資訊架構**：製作 / 授課 / 自學 / 報告 / 匯出五組，依當前簡報狀態與使用者角色決定顯示哪些。老師不需要看到「課後輔導測試」的設定，學生不需要看到「重新生成全部語音」。

### 4.2 AI 成本治理

已有 `llmUsage` 與每週配額的基礎。2.0 可補上：每帳號成本上限與軟性告警、生成前的成本預估（尤其整份重生）、模型路由策略（草稿用便宜模型、定稿用好模型）、以及供應商失敗時的降級鏈。目前新增第四個 TTS/LLM 供應商仍需散落修改多處——`scriptStyleForTtsProvider` / `globalSpeakerVoicesFor` 的收斂方向是對的，應該擴大到所有 provider 判斷點。

---

## 5. 建議分期

| 階段 | 內容 | 判準 |
|---|---|---|
| **2.0-alpha** | P0-1 可靠性、P0-2 行動版、CI（P1-4 的第 4 項）、測試全綠（P1-5 前 3 項） | 一堂 30 人的真實課程從頭到尾不中斷 |
| **2.0-beta** | P1-3 前端解構、P1-4 其餘（映像、生命週期）、lint + E2E | 主 chunk < 600 KB；`docker stop` 安全 |
| **2.0** | P2-6 後端邊界與契約、4.1 資訊架構 | 新人可在一天內加一支端點並知道要改哪裡 |
| **2.1+** | 4.2 成本治理、`FUTURE_ROADMAP.md` 的個人層級報表 | — |

**先做 CI**。它是唯一一項會讓後面每一項都變便宜的工作。

---

## 6. 明確不做的事

- **不換框架**。Fastify + React + SQLite 對這個產品的規模是合適的；SQLite 的 WAL 模式在單機教學場景沒有瓶頸證據。換框架的成本會吃掉整個 2.0。
- **不追覆蓋率數字**。既有的「難邏輯抽純函式 + 單測」策略比覆蓋率百分比有效，繼續照做。
- **不做微服務**。225 支路由的單體在這個團隊規模是資產不是負債，問題是檔案邊界不是程序邊界。
- **不重寫播放頁**。P1-3 是逐步解構（切 context → 狀態機 → lazy），每一步都可獨立驗證並隨時停下。

---

## 附錄 A：量測方式

| 數據 | 指令 |
|---|---|
| 原始碼行數 | `find backend/src -name '*.ts' \| xargs wc -l` / 前端同理 |
| 路由數 | `grep -rn "\.\(get\|post\|put\|patch\|delete\)(\s*[\`'\"]/" backend/src/routes` |
| bundle 大小 | `ls -la frontend/dist/assets`（`index-B0shRI3-.js` = 1,684,924 bytes） |
| 響應式 class | `grep -c "sm:\|md:\|lg:" frontend/src/pages/PlayPage.tsx` |
| ErrorBoundary | `grep -rln "ErrorBoundary\|componentDidCatch" frontend/src`（無結果） |
| 測試結果 | `MAKESLIDE_TEST=1 npx tsx --test --test-force-exit ./backend/test/*.test.ts` → 1610 / 1604 pass / 5 fail，23 秒 |
| 前端測試 | `npx tsx --test 'frontend/src/**/*.test.ts'` → 853 / 853 pass |
| 型別檢查 | `npm run typecheck` → 前後端皆無錯誤 |
| 儲存空間 | `du -sh storage data`（5.6 GB / 85 MB） |

量測時間：2026-08-03，master `2ec2f60d`。
