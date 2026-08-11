# MakeSlide React 投影片頁設計文件

- 文件版本：V1.0
- 狀態：Draft → 依本文件實作中
- 分支：`feat/react-slide-pages`
- 參考來源：[open-slide](https://github.com/1weiho/open-slide)（React 元件即投影片、1920×1080 固定畫布、瀏覽器內點選元素回饋）
- 日期：2026-08-12

---

## 1. 背景

MakeSlide 目前每一頁投影片的視覺內容都是一張 JPG：PDF 轉檔而來，或由 LLM 依逐字稿生成。這個模型的好處是「什麼都能畫」，代價是**產出後不可編輯**——想把標題改一個字、把強調色從藍換成橘，只能重新生成整張圖，等數十秒、付一次圖片費用，而且其他部分也會跟著變。

[open-slide](https://github.com/1weiho/open-slide) 提出的作法是「投影片就是一個 React 元件」：固定 1920×1080 畫布，AI 直接寫 React 程式碼，頁面因此是**結構化、可局部修改**的。本文件把這個作法引進 MakeSlide，成為第四種頁面型別 `render_type = 'react'`，並補上三件 MakeSlide 使用者實際需要的能力：

1. **主題（theme）**：整份簡報共用一組設計 token（色票、字體、圓角、間距），可由 AI 依一句描述生成，換主題不必改任何一頁的程式碼。
2. **頁面上的文字與 CSS 屬性編輯**：點選投影片上的任一元素，直接改文字、改 CSS 屬性，不必看懂也不必重跑程式碼生成。
3. **背景圖生成**：為單頁生成一張背景圖（沿用既有的圖片供應商），程式碼只負責前景排版。

### 1.1 這一版不做

匯出成影片/PPTX/PDF 時把 React 頁「烘焙」成點陣圖（見 §9 的相容性說明與 §11）、Tailwind class、npm 套件 import、多頁一次生成整套版型、open-slide 那種「在瀏覽器內留言 → 代理套用修改」的迴圈、GSAP 動畫與 React 頁並存。

---

## 2. 設計目標

1. 新增頁面型別 `react`，與既有 `static-image` / `gsap-image` / `notebook` 並列，且**可雙向轉換**（轉回一般投影片不刪除程式碼）。
2. React 頁仍是一頁正常的簡報頁：有逐字稿、有語音、有計時、能播放、能同步、能被問答與測驗引用——只有「畫面怎麼來的」不同。
3. 生成的程式碼在**沙箱 iframe** 內執行，拿不到父頁面、cookie、storage 與後端 API。
4. 文字/CSS 的編輯**不改動生成的程式碼**，而是存成覆寫（overrides），因此重新生成程式碼與手動微調可以並存，也隨時能還原。
5. 全部離線可用：不從 CDN 載入 React、Babel、Tailwind 或字型。
6. 前端不做 JSX 編譯——編譯在後端做，錯誤在「儲存」當下就回報。

---

## 3. 核心設計決策

### 3.1 圖片仍是 fallback，React 是「另一種畫面來源」

React 頁的 `pages` 資料列照舊保留 `image_path`（多半是轉成 React 頁之前的那張圖，或空白頁的白底圖）。這使得：

- 縮圖列、匯出 PDF/PPTX、影片合成、封面等**既有以 `<img>` 為前提的路徑不需要任何修改**就不會壞掉（顯示的是舊圖，不是空白）。
- 沙箱載入失敗、瀏覽器不支援 iframe、或程式碼在執行期丟例外時，播放器可以退回顯示圖片，而不是給使用者一片黑。

### 3.2 固定 1920×1080 畫布，等比縮放

沙箱內部的座標系統固定為 1920×1080（與 open-slide 相同、也與 MakeSlide 既有 16:9 空白頁一致）。外層量測 iframe 容器實際寬度 `w`，以 `transform: scale(w / 1920)` 縮放內容。生成的程式碼因此永遠只需要對著 1920×1080 排版，不必寫 responsive；而播放頁、全螢幕、編輯預覽三處縮放比例不同也不會跑版。

### 3.3 沙箱：`<iframe sandbox="allow-scripts">`（不含 `allow-same-origin`）

沿用既有 `custom-script` 動畫效果的隔離模型（`frontend/src/lib/animationSpec.ts` 的 `buildCustomScriptSandboxDoc`）：沒有 `allow-same-origin` 的 iframe 是 opaque origin，因此拿不到父頁面的 DOM、cookie、localStorage，也帶不出登入態；它與外界唯一的通道是 `postMessage`。

React / ReactDOM 以 `<script src="{origin}/vendor/react.production.min.js">` 載入——跨 origin 載入 script 是允許的，且檔案由自家伺服器提供，離線環境照樣可用。

### 3.4 JSX 在後端用 esbuild 編譯

儲存或生成程式碼時，後端以 `esbuild.transform(code, { loader: 'jsx', jsxFactory: 'React.createElement', jsxFragment: 'React.Fragment', target: 'es2018' })` 把 JSX 轉成瀏覽器可直接執行的 JS，存成 `<page_uid>.slide.js`；原始碼 `<page_uid>.slide.jsx` 也一併保存供編輯與重新生成。

這樣決定的理由：

- **前端 bundle 不必背 `@babel/standalone`**（約 2.5MB），而 esbuild 已是後端既有依賴（改列為 `dependencies`）。
- **語法錯誤在儲存當下就回報**，不會存進一個載入後才炸掉的頁面；LLM 生成流程也因此有明確的「編譯不過 → 重試一次」判準。
- 沙箱端只需要跑一段普通 JS，啟動快。

若執行環境取不到 esbuild（例如某些精簡打包），儲存端回傳 422 並說明編譯不可用，而不是默默存下未編譯的程式碼。

### 3.5 樣式規範：inline style + `<style>` + CSS 變數，不用 Tailwind

open-slide 用 Tailwind，但 Tailwind 需要建置期掃描 class；在沙箱裡即時渲染就得引進 runtime 版本（又一個 CDN 級的大檔）。因此本設計要求生成的程式碼只用：

- `style={{ ... }}` inline 樣式，或元件內的 `<style>` 區塊；
- 主題 token：`var(--slide-accent)`、`var(--slide-font-heading)` 等（§4.4）。

這同時讓 §5 的「點元素改 CSS」有意義：覆寫直接寫在該元素的 inline style 上，優先權最高，不會被外部 class 蓋掉。

### 3.6 編輯用「覆寫」而非改程式碼

點選元素後修改的文字與 CSS 屬性，存成以**元素路徑**為 key 的覆寫表（§5），渲染時在 React 掛載完成後套用到 DOM 上。

- 重新生成程式碼時可以選擇保留或清空覆寫；
- 覆寫的元素路徑在程式碼結構改變後可能失效，此時該筆覆寫**靜默略過**（不會讓整頁壞掉），UI 上標示為「找不到對應元素」；
- 使用者可以逐筆刪除覆寫，回到程式碼原本的樣子。

---

## 4. 資料模型

### 4.1 檔案佈局

```text
storage/<pdfId>/
├── slide-theme.json              # 整份簡報共用的主題（§4.4）
└── pages/
    ├── <page_uid>.jpg            # 既有：fallback 圖 / 縮圖來源
    ├── <page_uid>.script.txt     # 既有：逐字稿
    ├── <page_uid>.slide.jsx      # React 原始碼（使用者/AI 可讀可編輯）
    ├── <page_uid>.slide.js       # esbuild 編譯後的 JS（沙箱實際執行的內容）
    ├── <page_uid>.slide.json     # ReactSlideConfig：覆寫、背景設定、生成紀錄
    └── <page_uid>.slide-bg.png   # 生成的背景圖（僅 background.mode==='image'）
```

檔名沿用「以 `page_uid` 命名」的既有慣例，因此重新排序頁面不需要搬檔案。

### 4.2 資料庫

`pages` 新增一欄（`db.ts` 的 migration 區塊，與 `notebook_path` 同樣的作法）：

```sql
ALTER TABLE pages ADD COLUMN react_slide_path TEXT
```

`render_type` 型別擴充為 `'static-image' | 'gsap-image' | 'notebook' | 'react'`。

### 4.3 `ReactSlideConfig`（`<page_uid>.slide.json`）

```ts
interface ReactSlideConfig {
  version: 1;
  /** 最近一次用來生成程式碼的描述，重新生成時作為預設值。 */
  prompt?: string;
  /** 元素路徑 → 覆寫內容（§5）。 */
  overrides: Record<string, {
    text?: string;                     // 上限 2000 字
    styles?: Record<string, string>;   // 屬性名限白名單，值上限 200 字
  }>;
  background: {
    mode: 'none' | 'color' | 'image';
    color?: string;                    // #rgb / #rrggbb
    /** mode==='image'：背景圖的生成描述與檔名。 */
    prompt?: string;
    file?: string;                     // 例：pages/<uid>.slide-bg.png
    fit?: 'cover' | 'contain';
    position?: string;                 // 例：'center'
    /** 疊在背景圖上的遮罩，讓前景文字讀得清楚。 */
    overlayColor?: string;
    overlayOpacity?: number;           // 0~1
  };
  updated_at: string;
}
```

### 4.4 `SlideTheme`（`slide-theme.json`）

主題是一組 CSS 變數，注入沙箱的 `:root`：

```ts
interface SlideTheme {
  version: 1;
  name: string;
  tokens: Record<SlideThemeTokenKey, string>;
  /** 主題層級的自由 CSS（例如 h1 的預設樣式），同樣注入沙箱。上限 4000 字。 */
  customCss?: string;
  updated_at: string;
}
```

Token 清單（固定，未列的 key 一律拒絕，避免主題變成任意 CSS 注入點）：

| Token | 用途 | 預設值 |
| --- | --- | --- |
| `--slide-bg` | 頁面底色 | `#0f172a` |
| `--slide-surface` | 卡片/區塊底色 | `#1e293b` |
| `--slide-fg` | 主要文字 | `#f8fafc` |
| `--slide-fg-muted` | 次要文字 | `#94a3b8` |
| `--slide-accent` | 強調色 | `#38bdf8` |
| `--slide-accent-fg` | 強調色上的文字 | `#0f172a` |
| `--slide-border` | 分隔線/外框 | `#334155` |
| `--slide-font-heading` | 標題字體 | `"Noto Sans TC", system-ui, sans-serif` |
| `--slide-font-body` | 內文字體 | `"Noto Sans TC", system-ui, sans-serif` |
| `--slide-font-mono` | 等寬字體 | `ui-monospace, monospace` |
| `--slide-heading-size` | 標題級距 | `88px` |
| `--slide-body-size` | 內文級距 | `36px` |
| `--slide-radius` | 圓角 | `24px` |
| `--slide-gap` | 元素間距 | `32px` |
| `--slide-padding` | 頁面留白 | `96px` |
| `--slide-shadow` | 陰影 | `0 24px 60px rgba(0,0,0,0.35)` |

Token 值同樣走 §8 的 CSS 值檢查（禁止 `url(`、`expression(`、`@import`、`javascript:`、`<`）。

---

## 5. 元素路徑與覆寫

### 5.1 路徑格式

沙箱在 React 掛載完成後，從畫布根節點開始深度走訪，為每個元素節點指派一條路徑：

```text
根節點的第 0 個子元素      → "0"
它的第 2 個子元素          → "0/2"
再往下第 1 個              → "0/2/1"
```

只計元素節點（略過文字節點與註解），所以路徑對空白與換行不敏感。路徑寫在 DOM 上（`data-ms-path`），點選與套用覆寫都靠它。

這個路徑「跟著結構走」：改文字、改樣式不影響它；但插入/刪除兄弟節點會讓後面的路徑位移。這是刻意的取捨——比起 `nth-of-type` 選擇器或 AI 自行標註 id（LLM 未必照做），結構路徑最簡單且完全由 runtime 決定；程式碼一改就可能失效，因此失效時靜默略過並在 UI 上標示（§3.6）。

### 5.2 套用順序

沙箱內每次渲染的順序固定為：

1. 注入主題 token 與 `customCss`；
2. 套用背景（顏色 / 圖片 + 遮罩）；
3. `ReactDOM.createRoot(...).render(<SlideComponent />)`；
4. 走訪 DOM 指派 `data-ms-path`；
5. 依覆寫表逐筆套用：`text` 寫入 `element.textContent`，`styles` 逐項 `element.style.setProperty(...)`（轉為 kebab-case，帶 `important` 以壓過元件內的 `<style>`）。

因為覆寫在 render 之後套用，投影片元件必須是**靜態**的（不可在掛載後自行改寫內容）——這一點寫進生成程式碼的系統提示。

### 5.3 可編輯的 CSS 屬性白名單

`color`、`background-color`、`font-size`、`font-weight`、`font-family`、`font-style`、`line-height`、`letter-spacing`、`text-align`、`text-transform`、`text-shadow`、`opacity`、`padding`、`margin`、`border-radius`、`border-width`、`border-style`、`border-color`、`box-shadow`、`width`、`height`、`min-width`、`min-height`、`max-width`、`max-height`、`display`、`flex-direction`、`justify-content`、`align-items`、`gap`、`transform`、`z-index`。

白名單之外的屬性在後端被拒（422），UI 也只提供這些欄位。刻意排除 `background-image`、`content`、`filter: url(...)` 這類會把外部資源拉進沙箱的屬性；背景圖走 §6 的專用流程。

---

## 6. 背景圖生成

`POST /api/pdfs/:id/pages/:n/react-slide/background`，body `{ prompt, overlayOpacity? }`：

1. 沿用 `getImageClient()` / `withImageProviderFailover()`（與既有頁面圖片生成同一條路徑，因此 API key、供應商切換、失效轉移、費用記錄全部照舊）；
2. prompt 前置一段固定指示：**這是簡報頁的背景**，不要有文字、主體留在邊緣、中央保持乾淨、與主題色協調（把當前 theme 的 `--slide-bg` / `--slide-accent` 一併寫進 prompt）；
3. 產出圖存為 `<page_uid>.slide-bg.png`，寫入 `config.background = { mode: 'image', file, prompt, fit: 'cover', overlayColor: tokens['--slide-bg'], overlayOpacity: 0.45 }`；
4. 前端透過 `GET /api/pdfs/:id/pages/:n/react-slide/background.png` 讀圖（權限沿用 `canReadPdf` / share token）。

背景圖在沙箱裡是最底層的 `<div>`（`background-image` + 遮罩），不進 React 元件，因此重新生成程式碼不會弄丟背景。

---

## 7. API

所有路由都走既有的權限檢查（`getPdfPermissionRow` / `canReadPdf` / `canEditPdf`），寫入類需要編輯權，LLM 類額外經過 `replyIfLlmDisabled`。

| 方法 | 路徑 | 說明 |
| --- | --- | --- |
| `GET` | `/api/pdfs/:id/pages/:n/react-slide` | 取得 `{ render_type, code, compiled, config }`（頁面尚未是 React 頁時回預設骨架） |
| `PUT` | `/api/pdfs/:id/pages/:n/react-slide` | 儲存 `{ code?, config? }`：編譯 → 安全檢查 → 寫檔 → `render_type='react'` |
| `DELETE` | `/api/pdfs/:id/pages/:n/react-slide` | 轉回一般投影片（依 animation spec 還原 `static-image`/`gsap-image`），檔案保留 |
| `POST` | `/api/pdfs/:id/pages/:n/react-slide/generate` | 依 `{ prompt, keepOverrides? }` 用 LLM 生成程式碼並儲存 |
| `POST` | `/api/pdfs/:id/pages/:n/react-slide/background` | 生成背景圖 |
| `GET` | `/api/pdfs/:id/pages/:n/react-slide/background.png` | 讀背景圖 |
| `GET` | `/api/pdfs/:id/slide-theme` | 取得主題（沒有就回預設） |
| `PUT` | `/api/pdfs/:id/slide-theme` | 儲存主題 |
| `POST` | `/api/pdfs/:id/slide-theme/generate` | 依 `{ prompt }` 用 LLM 生成主題 token |

`GET /api/pdfs/:id`（deck detail）的每頁物件新增 `react_slide_url`（`render_type === 'react'` 時才有值），播放頁據此載入。

### 7.1 程式碼生成的契約

系統提示要求 LLM 輸出**單一檔案、單一元件**，並且：

- 定義 `function Slide() { ... }` 後以 `window.SlideComponent = Slide` 匯出；
- 只能用 `React`（全域）與 JSX，**不得** `import` / `require` / `fetch` / 讀 storage / 用計時器改內容；
- 版面對著 1920×1080 排，根節點 `width: '100%', height: '100%'`；
- 顏色、字體、間距一律用主題 token（`var(--slide-accent)` …）而非寫死；
- 背景交給外層，元件本身不要畫滿版底色（除非使用者明確要求）；
- 內容以本頁逐字稿與 OCR 文字為依據，**不要把整段逐字稿貼上投影片**——投影片是要點。

輸出以 ```` ```jsx ```` 圍籬包住，後端取出圍籬內文字 → 安全檢查（§8）→ esbuild 編譯；編譯失敗時附上錯誤訊息重試一次，仍失敗則回 422 並把錯誤原樣顯示給使用者。

---

## 8. 安全性

| 風險 | 對策 |
| --- | --- |
| 生成/貼上的程式碼竊取登入態 | `sandbox="allow-scripts"`（無 `allow-same-origin`）→ opaque origin，取不到 cookie/storage/父 DOM |
| 程式碼向後端或外部發請求 | 沿用 `animationCustomScript.ts` 的 `findUnsafeScriptPattern()` 靜態檢查（`fetch`、`XMLHttpRequest`、`WebSocket`、`import(`、`require(`、`eval`、`Function(`、`document.cookie`、`localStorage`、`window.parent`、`window.top`、`frameElement`），存檔前就擋下 |
| 覆寫的 CSS 值夾帶外部資源 | 白名單屬性（§5.3）+ 值檢查（禁 `url(`、`expression(`、`@import`、`javascript:`、`<`）+ 200 字上限 |
| 主題 `customCss` 變成任意注入點 | 同一組值檢查 + 4000 字上限；token key 限固定清單 |
| 沙箱把父頁面撐爆 | iframe 固定尺寸、`overflow: hidden`；沙箱腳本包在 try/catch，錯誤以 `postMessage` 回報並在畫面上顯示紅字，不影響播放器 |
| 檔案路徑穿越 | 一律走 `pageReactSlide*Path(pdfId, page_uid)` / `safeJoinPdfPath` |

程式碼上限 60000 字元、prompt 上限 2000 字元。

---

## 9. 與既有功能的相容性

| 功能 | React 頁的行為 |
| --- | --- |
| 逐字稿 / TTS / 播放計時 | 完全照舊（React 頁只是換掉畫面來源） |
| 縮圖列、封面 | 顯示既有 `<page_uid>.thumb.jpg`（轉成 React 頁之前的圖或空白圖） |
| 匯出 PDF / PPTX / 影片 / SCORM | 使用既有 JPG——**React 頁的實際畫面不會出現在匯出檔中**，這是本版已知限制（§11 有後續規劃），UI 上明確標示 |
| 手寫標註、圖片局部編輯 | React 頁停用（它們的座標系綁在 `<img>` 上） |
| GSAP 動畫 | 與 React 頁互斥：一頁只能是 `gsap-image` 或 `react` |
| 教室同步、問答、測驗 | 照舊（都以頁碼與逐字稿為單位） |

---

## 10. 前端結構

```text
frontend/src/
├── lib/reactSlide.ts              # 型別、預設主題、路徑工具、CSS 白名單、沙箱 HTML 組裝
├── lib/api/pdfs.ts                # 新增 7 支 API 呼叫
├── components/slide/
│   ├── ReactSlideFrame.tsx        # 沙箱 iframe + postMessage（點選回報 / 覆寫套用 / 錯誤回報）
│   └── SlideRenderer.tsx          # 新增 renderType === 'react' 分支
└── pages/play/
    ├── ReactSlideTab.tsx          # 編輯區的「⚛️ React」分頁
    └── PlayPageSlidePanel.tsx     # 分頁按鈕
public/vendor/react.production.min.js, react-dom.production.min.js
```

### 10.1 `ReactSlideTab` 的四個區塊

1. **生成**：一句話描述 → 生成程式碼（顯示編譯錯誤）；可勾選「保留既有的文字/CSS 調整」。
2. **主題**：token 逐項編輯（顏色用 color input、其餘文字框）＋「用一句話生成主題」＋自由 CSS。主題是整份簡報共用，改一次全部頁面跟著變。
3. **背景**：無 / 純色 / AI 生成圖；圖片模式可調 `fit`、遮罩濃度、重新生成。
4. **元素編輯**：開啟「點選模式」後，點投影片上任一元素 → 面板顯示該元素的標籤與目前文字，可改文字、可加 CSS 屬性（白名單下拉 + 值輸入），並列出所有覆寫可逐筆刪除。

程式碼本身也可直接編輯（既有的 CodeMirror 元件），存檔即編譯。

---

## 11. 測試計畫

後端（`backend/test/reactSlide.test.ts`）：

- `parseStoredReactSlideConfig()` 對壞掉的 JSON、未知欄位、超長文字、非白名單 CSS 屬性、危險 CSS 值的處理；
- `sanitizeSlideTheme()` 只保留白名單 token、拒絕危險值；
- `findUnsafeReactSlideCode()` 擋下 `fetch`/`import`/`window.parent` 等；
- `extractJsxFromLlmOutput()` 能從圍籬與純文字兩種輸出取出程式碼；
- `compileReactSlide()` 對合法 JSX 成功、對語法錯誤回傳可讀錯誤。

前端（`frontend/src/lib/reactSlide.test.ts`）：

- `buildReactSlideSandboxDoc()` 會注入 token、覆寫、背景與編譯後程式碼，且對 `</script>` 之類的內容做過跳脫；
- `normalizeStyleOverrides()` 過濾非白名單屬性；
- 元素路徑工具（`parsePath` / `formatPath`）；
- `slideScale()` 依容器寬度算出正確縮放比例。

另加 i18n 平衡測試（既有 `i18n.test.ts` 會自動涵蓋新 key）。

---

## 12. 後續工作

1. **烘焙成圖**：以無頭瀏覽器把 React 頁截成 1920×1080 JPG 寫回 `image_path`，讓匯出/縮圖/影片自動跟上（本版最大的缺口）。
2. **整份簡報一次生成**：依大綱一次產生每頁 React 版型，而非逐頁。
3. **版型元件庫**：提供 `TitleSlide` / `BulletSlide` / `TwoColumn` 等可重用元件給 LLM 直接組裝，降低生成失敗率。
4. **穩定的元素 id**：由 LLM 在關鍵元素上標 `data-ms-slot`，覆寫改綁語意 id，程式碼重生後仍能存活。
5. **React 頁與 GSAP 動畫共存**：讓動畫時間軸能驅動元件內的過場。
