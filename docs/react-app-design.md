# MakeSlide 互動 React 頁（`react-app`）＋ 外部 coding agent 迴圈 設計文件

- 文件版本：V1.0
- 狀態：Draft（尚未實作）
- 分支：`docs/react-app-design`（文件本身）；實作分支見 §10 分階段落地
- 前置文件：[`docs/react-slide-design.md`](react-slide-design.md)（靜態 React 頁，已實作）
- 日期：2026-08-16

---

## 1. 背景與問題

現有的 `render_type = 'react'` 頁（見前置文件）把投影片變成一個 React 元件，但它在契約上是**靜態**的：系統提示詞第 4 條要求元件掛載後不得改寫自己，因為覆寫（overrides）是在 React 掛載完成後才套用一次的。

使用者要的是下一步：**在投影片頁裡放一個可以互動的小程式**——輸入資料、按下按鈕、做計算、顯示結果，極端情況下是「一個完整的應用程式在一頁裡執行」。

同時使用者提出一個重要的架構判斷：與其在 MakeSlide 內部整合一個 coding agent，不如**讓外部的 coding agent（如 Claude Code）透過 MCP 把程式送進來、在 MakeSlide 環境中試跑、依結果修正，直到能運行為止**。MakeSlide 因此不需要內建生成互動程式的能力，只需要提供三件事：一份明確的規格、一個寫入通道、一個誠實的執行回饋。

本文件只處理**執行策略**與**外部 agent 迴圈**。它不改動既有靜態 `react` 頁的任何行為。

### 1.1 現況盤點（本文件的事實基礎）

| 能力 | 現況 |
|---|---|
| MCP 認證 | ✅ 已 per-account。[`server.ts:152`](../backend/src/server.ts#L152) 把 bearer token 經 `findAccountIdByMcpAuthToken`（[`aiSettings.ts:565`](../backend/src/services/aiSettings.ts#L565)）換成該帳號的合成 session cookie，下游 `canReadPdf`／`canEditPdf` 原封不動就生效 |
| 寫入程式碼 | ✅ `PUT /api/pdfs/:id/pages/:n/react-slide` 已 validate ＋ compile ＋ 回 422 |
| 伺服器端渲染 | ✅ 已有 headless chromium（`playwright-core` ＋ 系統 Chrome，[`reactSlideBake.ts:280`](../backend/src/services/reactSlideBake.ts#L280)），目前只用來截圖 |
| 沙箱隔離 | ✅ `<iframe sandbox="allow-scripts">` ＋ `srcDoc` = opaque origin（[`ReactSlideFrame.tsx:207`](../frontend/src/components/slide/ReactSlideFrame.tsx#L207)） |
| MCP 的 react 工具 | ❌ **一個都沒有**。`mcp-server.ts` 有 40+ 個工具，react-slide 完全缺席 |
| 執行結果回饋 | ❌ 只有 compile 錯誤。runtime 錯誤、console、互動後的畫面全部拿不到 |
| CSP | ❌ **完全沒有**。後端與 `frontend/index.html` 都沒有任何 Content-Security-Policy |
| 執行併發控制 | ❌ 烘焙沒有任何 semaphore／queue／配額 |

另外一個容易誤判的事實：**互動元件現在就能通過存檔驗證**。deny list（[`animationCustomScript.ts:17`](../backend/src/services/animationCustomScript.ts#L17)）擋的是 `fetch`／`eval`／storage 那一類，`useState`、`onClick`、`setTimeout` 一個都沒擋。真正擋住互動的是執行期的三個機制，見 §6。

---

## 2. 設計目標

1. 互動頁在**觀眾自己的瀏覽器**裡執行，伺服器不參與，因此觀眾人數不構成任何伺服器負擔。
2. 隔離邊界由**瀏覽器強制**（sandbox 屬性 ＋ CSP），而不是由我們檢查程式碼字串。
3. 外部 coding agent 能透過 MCP 完成「取得規格 → 寫入 → 試跑 → 看結果 → 修正」的完整迴圈，不需要瀏覽器、不需要人在旁邊。
4. 不改變既有靜態 `react` 頁的任何行為；互動是**另一種頁面型別**，不是既有型別的開關。
5. 一個寫壞的互動頁不能拖垮觀眾的瀏覽器分頁——這由存檔前的伺服器端准入檢查把關。

### 2.1 這一版不做

多頁之間共享狀態、互動頁的作答結果回寫後端（那是測驗系統的範疇）、互動頁參與影片匯出時的「錄製操作過程」、npm 套件、Tailwind、外部字型與圖片。

---

## 3. 核心決策：執行在 client，驗證在 server

這是整份設計最重要的一條，因為它決定了成本結構。

|  | 執行在 client | 驗證在 server |
|---|---|---|
| 誰付出成本 | 每個觀眾自己的瀏覽器 | MakeSlide 的機器 |
| 100 個觀眾看同一頁 | 100 台機器各跑 1 個 iframe，伺服器只送出一份 HTML 字串 | 不涉及 |
| 觸發時機 | 觀眾開啟該頁時 | agent 迭代時、存檔時 |
| 需要配額嗎 | **不需要** | **必須有** |

「多人使用時的 scalability」在 client 端執行模型下**不成立**：iframe 的成本天然隨觀眾分散，伺服器端只是送出一份字串。這與伺服器端執行是完全相反的成本結構，兩者不能混為一談。

因此伺服器端的 headless 瀏覽器（§7 的 harness）**不是執行環境，而是上架前的准入檢查（CI gate）**。它只在 agent 迭代與存檔時跑，跑完就結束，與觀眾人數無關。這個定位也剛好補上 client 端唯一擋不住的風險（§5.3）。

---

## 4. 隔離方法：維持現有 iframe，補上 CSP

### 4.1 四種方案的評估

| 方案 | 隔離力 | 成本 | 判斷 |
|---|---|---|---|
| **A. 現有 `sandbox="allow-scripts"` ＋ `srcDoc`** | opaque origin：拿不到父頁 DOM、cookie、storage、session | 1 個 iframe／觀眾 | ✅ **維持** |
| B. 獨立 sandbox 網域 | 同 A，多一層「就算 sandbox 屬性寫錯也安全」 | 多一個網域＋憑證＋部署複雜度；srcdoc 不能用，要改走 URL | ❌ 過重，opaque origin 已等效 |
| C. Web Worker ＋ DOM patch 橋接 | 邏輯完全無 DOM 存取 | 要自建 virtual DOM 與事件 round-trip，互動有延遲 | ❌ 工程量不成比例 |
| D. 宣告式 spec（完全不執行 JS） | 沒有任意程式碼 | 表達力有限 | 見 §9，作為互補的 tier 1 |

沒有 `allow-same-origin` 的 iframe 是 opaque origin，已經是瀏覽器能提供的最強隔離，而且**不需要額外的 origin 或網域**。方向不必改動。

### 4.2 真正的缺口：沒有 CSP

sandbox 屬性擋的是「讀取宿主」，擋不住「往外送」。目前全站沒有任何 CSP，這代表一個互動頁——正是「觀眾輸入資料按按鈕計算」這個情境——**可以把觀眾輸入的內容送到任意外部伺服器**。

這是本設計唯一必須補的隔離缺口，而且補起來很便宜。`srcdoc` 沒有 HTTP header，因此用 `<meta http-equiv>`，放在任何 `<script>` 之前：

```
default-src  'none';
script-src   'unsafe-inline' 'unsafe-eval' <app-origin>;
style-src    'unsafe-inline';
img-src      data:;
font-src     data:;
connect-src  'none';
form-action  'none';
base-uri     'none';
```

`connect-src 'none'` 一次關掉 `fetch`／`XMLHttpRequest`／`WebSocket`／`sendBeacon`／`EventSource`，**不管程式碼怎麼寫、怎麼混淆、怎麼動態組字串**。安全性因此從「我們有沒有想到那個 API」變成「瀏覽器不讓它連」。

### 4.3 三個必須知道的實作細節

1. **必須保留 `'unsafe-eval'`**，因為沙箱 runtime 用 `new Function(code)()` 執行編譯後的程式碼（[`reactSlide.ts:902`](../frontend/src/lib/reactSlide.ts#L902)）。這看起來像讓 CSP 破功，其實不然：CSP 各 directive 互相獨立，`unsafe-eval` 只影響「能不能執行動態產生的程式碼」，`connect-src 'none'` 照樣完全有效。**我們要擋的是資料外洩，不是程式碼執行**——程式碼本來就是要執行的，那是這個功能的全部意義。
2. 若想連 `unsafe-eval` 都拿掉：把 compiled code 包成 `Blob` → `URL.createObjectURL` → 動態 `<script>`，CSP 改用 `script-src blob:`。順便可以省掉現在為了避免 `</script>` 提前結束元素而做的 base64 編碼。這是可選的乾淨化，不是安全上的必要。
3. `script-src` 需要列出 app origin，因為 React UMD 目前從 `vendorUrl()`（[`reactSlide.ts:508`](../frontend/src/lib/reactSlide.ts#L508)）載入。另一個選擇是比照烘焙路徑把 UMD **內嵌**進 srcdoc，`default-src 'none'` 就能做到零外部依賴，代價是 srcdoc 多約 130KB；因為 srcdoc 只在 compiled 或 customCss 改變時才重建（[`ReactSlideFrame.tsx:76`](../frontend/src/components/slide/ReactSlideFrame.tsx#L76) 的 `useMemo`），這個代價可以接受。

**meta CSP 的已知限制**：`frame-ancestors`、`report-uri`／`report-to`、`sandbox` 這三個 directive 在 `<meta>` 中無效。前者由 iframe 的 sandbox 屬性負責，後兩者代表**違規回報必須另外做**——見 §7.2，harness 用 CDP 收集被擋下的請求。

### 4.4 靜態 `react` 頁也要一起加

CSP 對既有靜態頁只有好處（它本來就不該外連），而且同一份 `buildReactSlideSandboxDoc()` 兩種型別共用。這是本設計中唯一會碰到既有頁面的改動，且是純收緊。

---

## 5. 能執行什麼：用能力清單，不用 deny list

使用者明確表示「不需要可以執行任意的程式」。以下把它具體化。

### 5.1 允許

React hooks（`useState`／`useReducer`／`useMemo`／`useCallback`／`useRef`）、事件處理（`onClick`／`onChange`／`onSubmit`／`onKeyDown`）、純計算（`Math`／`Intl`／`Date`）、CSS 動畫與 `requestAnimationFrame`、inline SVG、Canvas 2D。

這一組足以做出「輸入資料 → 按鈕 → 計算 → 顯示圖表」的完整小應用，也足以驅動比現在複雜得多的視覺效果。

### 5.2 由環境擋掉（瀏覽器強制，不可繞過）

所有網路（`connect-src 'none'`）、所有外部資源（`default-src 'none'`）、表單提交（`form-action 'none'`）、新視窗（sandbox 不給 `allow-popups`）、storage 與 cookie（opaque origin 天然沒有）。

既有的 regex deny list **保留但降級**：它是存檔時的 UX 提示（能給出「你用了 fetch，這裡不能連網」這種清楚訊息，比 CSP 的靜默失敗好懂得多），但**不再是安全邊界**。`window['fet'+'ch']` 一行就能繞過 regex，繞不過 CSP。

### 5.3 由 harness 擋掉（CSP 管不到的部分）

CSP 管得住外連，管不住**無窮迴圈**。一個 `while(true)` 或失控的 `useEffect` 會吃滿 CPU，而 sandboxed iframe 是否與宿主頁分屬不同 process 不可依賴——實務上必須假設**一個寫壞的互動頁會讓觀眾的整個瀏覽器分頁卡死**。這在多人簡報場合是最難堪的失敗模式，而且不需要惡意，agent 寫錯就會發生。

client 端沒有乾淨的辦法擋（無法從外部中止一個同步迴圈），因此：

> **存檔前必須在 server harness 跑一次，超時就拒絕存檔。**

記憶體爆量同理。這就是 §3 所說 harness 作為准入檢查的具體價值。

---

## 6. 新頁面型別 `react-app`

### 6.1 為什麼是新型別，不是既有型別加旗標

既有 `react` 的契約是「靜態 ＋ 可點選編輯 ＋ 覆寫在掛載後套用一次」，這與互動是**結構性衝突**而非參數差異：

- **覆寫機制會跟互動打架**：[`reactSlide.ts:913`](../frontend/src/lib/reactSlide.ts#L913) 的 `MutationObserver` 在每次 React re-render 時重跑 `applyOverrides()`，把 `data-ms-original-text` 還原回去。互動元件一改狀態就會被覆寫機制拉回去。
- **覆寫會殺死動畫**：覆寫用 `setProperty(..., 'important')` 套用，而 `transform` 與 `opacity` 都在那 31 個可覆寫屬性裡；在 CSS cascade 中 `!important` 作者宣告勝過 animation。使用者調一次不透明度，那頁的動畫就停了，且沒有任何訊息說明原因。

`react-app` 因此**關閉元素覆寫與 MutationObserver 重套**，換取自由使用 state、事件與計時器。代價是不能在畫面上點選編輯——這代價是合理的，那頁的內容本來就由程式決定，而不是由排版決定。

### 6.2 三個必須決策的非安全障礙

這些比安全更難，而且專案裡已經有一個現成的先例可以參照：**notebook 頁就是「一個在投影片裡執行的互動應用」**。

**(1) 播放時 iframe 收不到事件。** [`ReactSlideFrame.tsx:222`](../frontend/src/components/slide/ReactSlideFrame.tsx#L222) 目前寫死 `pointerEvents: inspect ? 'auto' : 'none'`，註解說明得很清楚：播放時的點擊屬於 player（seek、全螢幕、手寫標註）。互動頁需要相反的行為，這是真實的語意衝突。

> **決策**：`react-app` 頁在播放時把指標事件交給 iframe；player 的 seek 與手寫標註在這種頁面上改由投影片**外部**的控制列負責。理由是互動頁的全部價值就在於觀眾能操作它，而 seek／標註在別處仍有入口。

**(2) 互動狀態會在進出全螢幕時消失。** 觀眾輸入到一半按全螢幕，`SlideRenderer` 換一個 slot 就是 remount，state 全沒。notebook 已經解過這題：[`PlayPage.tsx:2991`](../frontend/src/pages/PlayPage.tsx#L2991) 用**全頁唯一實例 ＋ DOM reparenting**，把同一個面板搬進當下作用中的 slot。

> **決策**：`react-app` 照抄 `NotebookPanelSingleton` 的模式。**注意**：iframe 的 DOM reparenting 在多數瀏覽器會觸發 reload，等於狀態照樣消失；因此實作時必須實測，若 reparenting 不可行，退而求其次的方案是在切換前把互動狀態透過 postMessage 撈出來、在新 slot 掛載後推回去（代價是需要元件配合，寫進 §8 的契約）。

**(3) 烘焙拍到的是初始狀態。** 互動頁匯出成 PDF／PPTX／影片時只能是一張靜態圖，這本身合理（沒有人能在 PDF 裡按按鈕），但必須確保**初始狀態是可讀的**，而不是一片空白等著使用者輸入。

> **決策**：契約要求 `react-app` 的初始畫面必須自我說明（有標題、有欄位標籤、有預設值），harness 的驗證項目之一就是初始截圖不得為空白。

---

## 7. MCP 介面與 agent 迴圈

### 7.1 工具

```
get_react_slide_contract()                        ← 規格的單一事實來源
get_page_react_slide(pdf_id, page)
set_page_react_slide(pdf_id, page, code, kind)    ← kind: 'react' | 'react-app'
run_react_slide(pdf_id, page, actions?, viewport?) ← 核心新工具
bake_react_slide(pdf_id, page)
```

`get_react_slide_contract()` 值得特別說明：它回傳 MakeSlide **當下**的規格——`window.SlideComponent` 契約、可用全域、CSP 允許與禁止的清單、16 個主題 token、1920×1080 畫布、`react-app` 的額外規則（初始畫面自我說明、狀態外撈協定）。這樣外部 agent 不必猜規格，也不必把規格硬寫進自己的提示詞裡；規格改了，agent 下一次呼叫就自動跟上。**這是「用外部 agent 取代內建 coding agent」這個決定能夠成立的前提**。

其餘四個工具都是既有 HTTP 端點的薄包裝，沿用同一條 ACL 路徑（§4 的認證機制已經讓 MCP 請求等同該帳號本人），**不另開任何後門**。

### 7.2 `run_react_slide`：執行報告

重用 `reactSlideBake.ts` 的 playwright 基礎，但產出的是執行報告而非圖片。新服務 `backend/src/services/reactSlideHarness.ts`。

輸入的 `actions` 刻意設計成**宣告式 JSON，而不是讓 agent 送 JS 進來 `page.evaluate()`**——送 JS 等於在伺服器上開一個任意程式碼執行面，而宣告式動作可以逐項白名單化：

```json
[{"fill": {"target": "#amount", "value": "1500"}},
 {"click": "#calc"},
 {"waitMs": 200},
 {"screenshot": "after"}]
```

輸出：

```json
{ "ok": false,
  "consoleErrors": [...],
  "pageErrors": [...],
  "blockedRequests": ["https://fonts.googleapis.com/..."],
  "screenshots": [{"label": "after", "png": "<base64, 960×540>"}],
  "timings": {"mountMs": 120, "totalMs": 1840} }
```

三個設計決定：

- **回傳截圖**。外部 agent（Claude Code）看得懂圖，可以直接判斷「按下按鈕後數字有沒有出現」，這比任何 DOM assertion 都省事，也比要求 agent 事先寫好斷言務實。截圖縮到 960×540 以免撐爆 MCP 回應。
- **`blockedRequests` 同時是安全機制與診斷訊息**。「你的程式想載入外部字型，被 CSP 擋了」是 agent 修得動的錯誤；靜默失敗不是。因為 meta CSP 不支援 `report-to`（§4.3），這份清單由 CDP 的 network 事件收集。
- **同一個 harness 加一個 `seek(t)` 動作就能驅動 GSAP 時間軸**，滿足「這個底層也能用在 GSAP 動畫上」的需求，不必做第二套。

### 7.3 配額與併發（必須與 harness 同批實作）

烘焙目前沒有任何併發控制。一個 agent 迭代迴圈可以每秒送一次 `run`，每次開一個 Chrome；單一帳號的迴圈——哪怕只是寫壞了停不下來——就能吃光整台機器的 CPU，拖垮所有其他使用者。這是多人環境中**最現實**的風險，而且不需要惡意。

- 全域 semaphore：同時最多 2–4 個 headless 執行個體
- per-account token bucket：例如每分鐘 20 次執行
- 單次逾時 15 秒（比烘焙的 `BAKE_TIMEOUT_MS = 30_000` 更短，因為 harness 是互動迴圈的一環）
- `actions` 長度上限、截圖數量上限

> 這一節**不可以延後到後續階段**。沒有它，harness 本身就是一個 DoS 面。

### 7.4 agent 的實際迴圈

1. `get_react_slide_contract()` → 拿到規格
2. 寫程式碼 → `set_page_react_slide(kind: 'react-app')` → 若 422，讀 compile 錯誤，修正
3. `run_react_slide(actions: [...])` → 讀 `consoleErrors`／`screenshots`／`blockedRequests`
4. 修正 → 回到 2，直到 `ok: true`
5. `bake_react_slide()` → 確認匯出用的靜態圖也正確（§6.2 的第三點）

---

## 8. 安全模型總表

| 風險 | 防線 | 層級 |
|---|---|---|
| 讀取宿主 DOM／cookie／session | `sandbox="allow-scripts"`（無 `allow-same-origin`），已實作 | 瀏覽器 |
| 把觀眾輸入送到外部 | `connect-src 'none'`（**新增**） | 瀏覽器 |
| 載入外部資源 | `default-src 'none'`（**新增**） | 瀏覽器 |
| 表單提交／開新視窗 | `form-action 'none'` ＋ sandbox 不給 `allow-popups`（**新增**） | 瀏覽器 |
| 無窮迴圈／記憶體爆量 | harness 准入檢查，超時拒絕存檔（**新增**） | 伺服器 |
| agent 迴圈拖垮機器 | semaphore ＋ per-account 配額（**新增**） | 伺服器 |
| 越權讀寫他人簡報 | 既有 `canReadPdf`／`canEditPdf`，MCP 走同一條路徑 | 應用 |
| 匯入的 ZIP 挾帶程式碼 | 匯入端**必須重新編譯驗證**，不得信任 sidecar 內現成的 `compiled` 欄位（**待查證現況**） | 應用 |

最後一項需要在實作階段先查證既有 import 路徑的行為：若匯入時直接採用 sidecar 的 `compiled`，那麼匯入一份 ZIP 就等於執行任意 JS。

### 8.1 觀看端的知情

互動頁不只是 agent 的沙箱，它會被存起來、分享出去、由其他人在瀏覽器打開——**分享一份簡報等於分享一段可執行程式碼**。CSP 已經讓它無法把資料送出去，但編輯器仍應標示「這一頁含可執行程式」，讓簡報擁有者知道自己在散布什麼。

---

## 9. 互補方案：宣告式互動（tier 1）

如果「輸入欄位 ＋ 公式 ＋ 輸出繫結」就能涵蓋大部分實際需求（試算表式的計算頁多半如此），一個宣告式 spec 可以：

- 完全不執行任意 JS，因此沒有 §5.3 的無窮迴圈問題，也不需要 harness 准入
- 不需要 iframe，可以直接在主文件渲染，零額外成本
- **能被既有的覆寫機制理解**，因此仍可在畫面上點選編輯
- 可 diff、可版本化、可被 LLM 穩定生成

它與 `react-app` 不衝突：宣告式是 tier 1（便宜、安全、可編輯），`react-app` 是 tier 2（表達力完整，代價是不可點選編輯且需要准入檢查）。建議在階段 3 之前先評估 tier 1 能覆蓋多少實際需求——若覆蓋率高，`react-app` 的優先度可以往後調。

---

## 10. 分階段落地

| 階段 | 內容 | 風險 | 可獨立交付 |
|---|---|---|---|
| 1 | MCP 加 `get_page_react_slide`／`set_page_react_slide`／`get_react_slide_contract`，純包裝既有端點 | 極低 | ✅ 立刻讓外部 agent 能寫靜態 React 頁 |
| 2 | 沙箱與烘焙文件加 CSP（靜態頁一併收緊，§4.4） | 低 | ✅ 純安全強化，不依賴後續階段 |
| 3 | `run_react_slide` harness ＋ 配額／併發（**三者同批**，§7.3） | 中 | ✅ 完成 agent 迴圈 |
| 4 | `react-app` 頁面型別：關閉覆寫、pointer events 決策、狀態保存、烘焙策略 | 中高 | ✅ |
| 5 | GSAP 共用同一 harness（`seek` 動作），對應前置文件 §16 第 5 點 | 低 | ✅ |

階段 1 與 2 彼此獨立，都不觸碰執行路徑，可以先做。階段 3 是整個構想的核心。階段 4 的三個障礙（§6.2）建議在動工前各自先做一次技術驗證，特別是 iframe reparenting 是否真能保住狀態。

---

## 11. 待決事項

1. **iframe reparenting 能否保住互動狀態**——決定 §6.2(2) 走哪一條路，需要實測。
2. **匯入路徑是否重新編譯**——決定 §8 最後一列是既有漏洞還是已經安全。
3. **tier 1 宣告式方案的覆蓋率**——決定 `react-app` 的優先度（§9）。
4. **`react-app` 頁在影片匯出時的呈現**——目前是初始狀態的靜態圖；是否需要「錄製一段操作」是產品決策，本版不做。
