# 頁面元素層：像簡報軟體一樣在底圖上加文字／圖片／圖案

- 文件版本：V1.9（2026-09-06：§9.9 剪下歷史與草稿式編輯；V1.8：§9.8 編輯時顯示已剪下的區域；V1.7：§9.5 標題立即顯示、其餘提早一句；V1.6：§9.7 重生對話框的批次剪下；V1.5：§9.6 改為 XY-cut 遞迴切割；V1.4：§9.6 自動偵測剪下區域；V1.3：§9.5 出現時機與位置由 AI 決定；V1.2：新增 §9 剪下區域做動畫；V1.1：文字改為 Markdown＋數學、線條獨立成型別、合成改以 Chrome 優先）
- 狀態：依本文件實作中
- 分支：`feat/page-elements`
- 相關文件：[`page-overlay-and-fusion.md`](page-overlay-and-fusion.md)（React 頁的加字加圖與烘焙）、[`react-slide-design.md`](react-slide-design.md)
- 日期：2026-09-04

---

## 1. 要解決的事

使用者要的是**一般簡報軟體的操作方式**：目前這一頁的圖片變成底圖，在上面直接放文字框、圖片、圖案，拖曳擺位、拉角縮放、旋轉，調字型、字級、粗斜體、對齊，顏色要能精細指定（含透明度）。圖片可以從電腦上傳，也可以直接 `Ctrl+V` 貼上——**一頁可以放多張**，而不是像現在貼一張就把整頁底圖換掉。

同時所有 AI 功能（重繪、局部重繪、看圖寫逐字稿、頁面問答、品質檢查……）與所有匯出（PPTX、講義 PDF、影片、SCORM、縮圖）都必須看得到這些元素——也就是**先把底圖與所有元素合成為單張圖片，再交給原本的流程**，一行都不用改那些流程。

### 1.1 為什麼不直接沿用 React 頁的做法

[`page-overlay-and-fusion.md`](page-overlay-and-fusion.md) 已經做了「加文字／圖片」：把頁面轉成 React 頁，元素以 JSX 存在 `.slide.jsx`，用 headless Chrome 烘焙回 JPG。它解決的是「程式碼產生的投影片」的問題，但拿來當簡報軟體的元素層有四個不合：

| | React 頁＋烘焙 | 本設計要的 |
| --- | --- | --- |
| 進入門檻 | 轉換頁面型別（確認對話框、GSAP 動畫停播、需要 Chrome 才准進入） | 按一下「加入文字」就在圖上出現一個文字框 |
| 編輯模型 | 元素是程式碼裡的 JSX，樣式是 CSS 白名單字串 | 元素是**結構化資料**，面板上每個欄位對應一個屬性 |
| 合成 | headless Chrome 截圖；沒有 Chrome 就整條路不能走 | 伺服器端 `node-canvas` 直接畫，沒有外部依賴（`canvas` 已是本專案的相依，`extractPdfFigures.ts` 在用） |
| 與動畫的關係 | 互斥 | 元素合成進圖片後，GSAP 動畫照常在合成圖上播放 |

所以本設計是**與 React 頁平行的另一條路**：React 頁給「用程式碼做的投影片」，元素層給「圖片上疊東西」。兩者不混用——React 頁與 notebook 頁不提供元素層（它們的畫面本來就不是一張圖）。

### 1.2 真相來源的原則不變

`page-overlay-and-fusion.md` §1 的原則在這裡同樣成立：`<uid>.jpg` 是所有匯出與 AI 讀的那一張，**不新增第三個被人讀的圖層**。元素層的做法與 React 頁完全同構——

| | 可編輯的來源 | 大家讀的產物 |
| --- | --- | --- |
| React 頁 | `<uid>.slide.jsx` ＋ `<uid>.slide-bg.png` | `<uid>.jpg`（烘焙） |
| **元素層** | `<uid>.elements.json` ＋ `<uid>.base.jpg` ＋ 素材檔 | `<uid>.jpg`（合成） |

也就是說：**`<uid>.jpg` 從「底圖」變成「合成結果」，底圖搬到 `<uid>.base.jpg`**。全 codebase 十幾個讀 `image_path` 的 AI 路徑與八個匯出路徑因此一個都不用改，這正是使用者要的「先產生成單張圖再用原來的」。

手寫畫布（`page_drawings`）與 GSAP 的 `text-callout` 仍是「畫面看得到、匯出看不到」的既有缺陷，本設計不處理。

---

## 2. 資料模型

### 2.1 檔案佈局

```text
storage/<pdfId>/pages/
├── <uid>.jpg                 合成結果（有元素時）／底圖本身（沒有元素時）——所有人讀這張
├── <uid>.base.jpg            底圖。只在該頁有元素時存在
├── <uid>.elements.json       元素文件
└── <uid>.el-<nanoid8>.<ext>  圖片元素的素材檔（png / jpg / webp / gif）
```

`pages` 表新增 `elements_path TEXT`（相對路徑 `pages/<uid>.elements.json`；NULL ＝ 這一頁沒有元素）。與 `animation_spec_path`／`notebook_path` 同一個模式：檔案跟著 `pdfDir()` 打包，「這一頁有元素」這件事記在資料表，匯出時序列化成 sidecar `page-elements.json`、匯入時依 `page_number` 套回。

### 2.2 元素文件

```ts
interface PageElementsDoc {
  version: 1;
  elements: PageElement[];           // 陣列順序 = 疊放順序（後者在上）
}

interface PageElementBase {
  id: string;                        // nanoid(8)
  x: number; y: number;              // 左上角，0..1（相對於底圖寬／高）
  w: number; h: number;              // 0..1
  rotation: number;                  // 度，繞元素中心
  opacity: number;                   // 0..1
}

interface TextElement extends PageElementBase {
  type: 'text';
  text: string;                      // Markdown（§2.6）；≤ 2000 字
  fontFamily: 'sans' | 'serif' | 'mono' | 'kai';
  fontSize: number;                  // 參考像素（見 §2.3），8..400
  bold: boolean; italic: boolean; underline: boolean;
  align: 'left' | 'center' | 'right';
  valign: 'top' | 'middle' | 'bottom';
  lineHeight: number;                // 倍數，0.8..3
  color: string;                     // 見 §2.4
  background: string | null;         // 文字框底色，null = 透明
  padding: number;                   // 參考像素
  borderRadius: number;              // 參考像素
}

interface ImageElement extends PageElementBase {
  type: 'image';
  asset: string;                     // 素材檔名 `<uid>.el-xxxxxxxx.png`（只有檔名，沒有路徑）
  fit: 'contain' | 'cover' | 'fill';
  borderRadius: number;
}

interface ShapeElement extends PageElementBase {
  type: 'shape';
  shape: 'rect' | 'ellipse' | 'triangle' | 'diamond' | 'star';
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;               // 參考像素
  borderRadius: number;              // 只對 rect 有效
}

interface LineElement {              // 不繼承 PageElementBase：線條不是一個旋轉的框
  id: string;
  type: 'line';
  x1: number; y1: number;            // 起點，0..1
  x2: number; y2: number;            // 終點，0..1
  stroke: string;
  strokeWidth: number;               // 參考像素
  arrowStart: boolean; arrowEnd: boolean;
  opacity: number;
}
```

**線條為什麼不是圖案**：第一版把直線／箭頭做成「一個很扁的框＋旋轉」，結果要改長度得拉把手、要改方向得轉整個框，兩個端點沒有任何一個能直接抓。簡報軟體的線條就是兩個點——所以 `LineElement` 存的是兩個端點，編輯時各自拖曳（Shift 吸附水平／垂直／45°），拖線身則整條平移；箭頭是旗標而不是另一種圖案，同一條線兩端都能有。

### 2.3 座標系：位置用比例、尺寸用參考像素

位置與寬高存 0..1 的比例，與手寫畫布（[`DrawingCanvas.tsx`](../frontend/src/components/DrawingCanvas.tsx)）相同——不管畫面把投影片縮到多大，`left: x*100%` 就對得上底圖。

字級、線寬、內距、圓角則存「參考像素」：**以底圖高度 1080 為基準的像素值**（手寫畫布的 `REF_H` 也是這個數）。瀏覽器渲染時乘上 `容器高度 / 1080`，伺服器合成時乘上 `底圖高度 / 1080`。這樣一份 3:2 的圖片頁（1536×1024）與 16:9 的空白頁（1920×1080）用同一個 `fontSize: 48` 看起來是一樣的比例，而不是同一個絕對像素。

### 2.4 顏色

只接受兩種寫法：`#rrggbb`／`#rrggbbaa` 與 `rgba(r, g, b, a)`。面板上用原生 `<input type="color">` 選色、旁邊的文字框可直接貼十六進位、再一條透明度滑桿——「精細顏色」要的是能打出確切的值，不是更多的預設色塊。伺服器端 `node-canvas` 兩種寫法都直接吃，不需要轉換。

不接受 `hsl()`、具名顏色、`var(--x)` 等：白名單越窄，伺服器合成與瀏覽器顯示不一致的機會越小，而且這些都能在面板上用 hex 表達。

### 2.6 文字是 Markdown

文字元素的內容是 Markdown，用的是筆記、留言、AI 回答共用的同一個方言（[`MarkdownMath.tsx`](../frontend/src/components/MarkdownMath.tsx)）：`# 標題`、`**粗體**`、`*斜體*`、`` `行內碼` ``、`[文字](網址)`、`-`／`1.` 條列、表格，以及 KaTeX 數學（`$…$`、`\(…\)`、`$$…$$`、`\[…\]`）。連結的網址走同一套 `safeMarkdownLinkHref()`（只收 `http`／`https`／`mailto` 與站內路徑）。

元素本身的字型、字級、顏色、對齊仍由面板設定，Markdown 只決定結構；標題、條列、程式碼等的尺寸以 `em` 相對於元素字級（`.ms-el-md` 樣式，[`index.css`](../frontend/src/index.css)），所以一個 48px 的文字框裡的 `# 標題` 是 72px，而不是筆記面板裡那個固定的小標題。播放時連結可以點（元素層本身不吃指標，只有 `<a>` 吃）；編輯模式下點連結是選取，不是導航。

### 2.5 字型

四個字型鍵，前端與後端各自對到一組字型堆疊：

| 鍵 | 瀏覽器 CSS | 伺服器（fontconfig） |
| --- | --- | --- |
| `sans` | "Noto Sans CJK TC", "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif | "Noto Sans CJK TC", "Noto Sans CJK JP", sans-serif |
| `serif` | "Noto Serif CJK TC", "Noto Serif TC", PMingLiU, serif | "Noto Serif CJK TC", "AR PL UMing TW", serif |
| `mono` | "Noto Sans Mono CJK TC", Menlo, Consolas, monospace | "Noto Sans Mono CJK TC", "DejaVu Sans Mono", monospace |
| `kai` | "AR PL UKai TW", BiauKai, DFKai-SB, "Noto Serif CJK TC", serif | "AR PL UKai TW", "AR PL UMing TW", serif |

**誠實的限制**：合成用的是伺服器的字型，畫面用的是瀏覽器的字型，兩邊不會逐像素相同——換行位置可能差一兩個字，字重可能略有不同。這與所有簡報軟體「匯出 PDF 跟螢幕上不完全一樣」是同一件事。伺服器缺 CJK 字型會畫出方塊，這是操作者的環境問題，本設計不內嵌字型（CJK 字型一個就 15 MB）。

---

## 3. 合成（compose）

`services/pageElements.ts` 提供整個生命週期；合成有兩條路：

| 路徑 | 條件 | 做法 | 文字 |
| --- | --- | --- | --- |
| **瀏覽器（優先）** | `bakeAvailability()` 說有 Chrome（與 React 頁烘焙同一個檢查） | [`pageElementsDocument.ts`](../backend/src/services/pageElementsDocument.ts) 把底圖（data URL）＋所有元素排成一份 HTML——與前端元素層**相同的 CSS**、文字經 [`markdownMathHtml.ts`](../backend/src/services/markdownMathHtml.ts)（`MarkdownMath` 的伺服器端雙胞胎，KaTeX 由 `katex.renderToString` 產生，字型內嵌成 data URL）——交給既有的 `renderSlideToJpeg()` 截圖 | Markdown、數學、瀏覽器字型與換行，與畫面一致 |
| **node-canvas（備援）** | 沒有 Chrome，或瀏覽器在執行時失敗 | [`pageElementsRender.ts`](../backend/src/services/pageElementsRender.ts) 直接畫 | 只有純文字投影（`markdownToPlainText()`：去掉標記、條列加圓點、數學保留 TeX 原文） |

Markdown 方言在前後端各有一份實作（後端無法 import 前端原始碼）；前端有測試比對兩邊的 token 正規表達式與 `.ms-el-md` 樣式區塊，漂移會紅。

### 3.1 何時合成

**每一次元素儲存都同步合成**（`PUT …/elements` 在合成完成後才回應）。node-canvas 畫一頁在數十到數百毫秒之間，等它結束的代價遠小於「畫面上看到的與縮圖／匯出不一致」。合成完順手重做縮圖，第 1 頁再更新封面，然後把 `elements.json`、`base.jpg`、`jpg` 一起提交進該簡報的 git（既有的 `commitPresentationFiles()`）。

### 3.2 第一次加元素：採用目前的圖片當底圖

頁面第一次有元素時，把當下的 `<uid>.jpg` 複製成 `<uid>.base.jpg`——這就是「目前的圖片變成底圖」。之後每次合成都從 `base.jpg` 出發，`jpg` 純粹是產物。

### 3.3 元素清空：回到單純的圖片頁

元素陣列變空時，把 `base.jpg` 複製回 `jpg`、刪掉 `base.jpg` 與 `elements.json`、`elements_path` 設 NULL、清掉沒人引用的素材檔。這一頁從任何角度看都和沒發生過一樣。

### 3.4 換底圖 vs. 融合（fuse）：兩種寫入 `jpg` 的語意

有元素的頁面上，「寫入一張新圖片」有兩種完全不同的意思，端點必須分辨：

| 語意 | 誰觸發 | 做法 |
| --- | --- | --- |
| **換底圖**（`mode=base`，預設） | 使用者在元素面板按「更換底圖」選檔 | 新圖寫進 `base.jpg`，元素保留，重新合成 |
| **融合**（`mode=fuse`） | AI 重繪／局部重繪的結果套用到頁面上 | 新圖直接成為 `jpg`，`base.jpg`、`elements.json` 刪除，`elements_path` 設 NULL |

融合的理由：AI 收到的輸入是**合成後**的圖（§1.2），它產出的圖裡已經含有那些文字與圖案的像素。若還把元素再疊上去，每個元素都會出現兩次。所以 AI 的產物取代整頁，元素成為像素——與 React 頁「轉回圖片頁」的 fusion 是同一個語意。套用前的預覽對話框會講明這件事，使用者是知情地按下去的。

背景批次重繪（`worker/regenerate.ts`）走同一條規則：它讀合成圖當編輯來源、寫回 `jpg` 之後呼叫 `fusePageElements()`。

### 3.5 渲染細節

- 畫布尺寸 ＝ 底圖的實際尺寸；所有比例座標乘上它、所有參考像素乘上 `高 / 1080`。
- 每個元素：`translate` 到中心 → `rotate` → 以中心為原點畫；`globalAlpha = opacity`。
- **文字**：用 `measureText` 逐字換行（CJK 逐字、拉丁字以空白為單位，超長單字強制切），先算出各行再依 `align`／`valign` 擺；有 `background` 先畫圓角矩形；`underline` 用 `fillRect` 在基線下畫一條 `fontSize/14` 粗的線。
- **圖片**：`loadImage` 素材，依 `fit` 算出來源與目標矩形，`borderRadius` 用 `clip`。
- **圖案**：各自的路徑。
- **線條**：從 `(x1,y1)` 畫到 `(x2,y2)`，箭頭是與線寬成比例的三角形（HTML 路徑用 SVG `marker`、`markerUnits="strokeWidth"`，兩邊比例一致）。
- 輸出經 `sharp` 轉 JPEG（quality 82, mozjpeg），與其他寫入 `jpg` 的路徑一致。

---

## 4. API

| 方法 | 路徑 | 權限 | 說明 |
| --- | --- | --- | --- |
| `GET` | `/api/pdfs/:id/pages/:n/elements` | read | `{ elements, updated_at }` |
| `PUT` | `/api/pdfs/:id/pages/:n/elements` | edit | body `{ elements }`，zod 驗證（上限 100 個元素）→ 採用底圖（首次）→ 寫檔 → 清孤兒素材 → 合成 → 回 `{ updated_at, has_elements }` |
| `POST` | `/api/pdfs/:id/pages/:n/elements/assets` | edit | multipart `file`；`sharp` 實際解碼驗證、≤ 8 MB、長邊 > 2048 就縮；回 `{ asset, width, height }` |
| `GET` | `/api/pdfs/:id/pages/:n/elements/assets/:name` | read | 檔名須符 `^[A-Za-z0-9_-]+\.el-[A-Za-z0-9_-]{8}\.(png\|jpe?g\|webp\|gif)$`，且前綴須是該頁的 `page_uid`；`Cache-Control: immutable` |
| `GET` | `/api/pdfs/:id/pages/:n/base-image` | read | 有 `base.jpg` 回它，否則回 `jpg`（沒有元素時兩者是同一張） |
| `POST` | `/api/pdfs/:id/pages/:n/replace-image` | edit | 既有端點，多收 multipart 欄位 `mode`：`base`（預設）或 `fuse`（§3.4） |

detail 回應的每一頁多兩個欄位：`elements: PageElement[] | null`（有元素的頁直接內嵌，避免翻頁時先看到沒有元素的底圖再閃出元素）與 `base_image_url`。

### 4.1 刪頁、分頁、匯出入

- 刪頁：`elements.json`、`base.jpg`、所有 `<uid>.el-*` 一併刪除。
- 分頁（split）：新頁只帶合成圖當暫時圖片（既有行為），元素不複製——新頁馬上會被重新產生。
- 匯出：sidecar `page-elements.json`（`page_number` → `elements_path`），檔案隨目錄打包；匯入時套回。
- 「從既有頁面建立簡報」（`from-pages.ts`）只複製合成圖；新簡報裡那一頁是純圖片頁。

---

## 5. 前端

### 5.1 顯示：底圖 ＋ 元素層

有元素的頁面，`<img>` 顯示的是 `base_image_url` 而不是 `image_url`——否則合成圖裡已經有元素、上面再疊一層元素層就會重影。`PageElementsLayer` 是 `SlideRenderer` 的 `children`（與手寫畫布同一層，所以動畫頁時會跟著 GSAP 一起動），用 `ResizeObserver` 量容器高度算出 `scale = 高 / 1080`，字級與線寬乘上它。三個顯示點（一般面板、全螢幕分割版面、全螢幕純圖片版面）都掛這一層；播放、同步 follower、分享唯讀都看得到元素。

### 5.2 編輯：「🧩 元素」分頁

投影片下方的編輯分頁列新增 **元素** 分頁。選到它時：

- 投影片上疊一層編輯面：點選元素、拖曳移動、八個縮放把手、一個旋轉把手，線條則是兩個端點各自拖曳、拖線身整條平移；`Delete` 刪除、方向鍵微調（Shift ×10）、`Ctrl+D` 複製、`Ctrl+Z`／`Ctrl+Shift+Z` 復原重做、雙擊文字元素就地編輯 Markdown 原文。
- 分頁內容是工具列（加入文字／上傳圖片／加入圖案／更換底圖）與**屬性面板**——選到什麼就顯示什麼的欄位：位置尺寸旋轉透明度、疊放順序（上移／下移／最上／最下）、文字的字型字級粗斜底線對齊行高顏色底色內距圓角、圖片的填滿方式與圓角、圖案的種類填色描邊。
- 所有修改先進本機草稿（畫面即時反映），**停止操作 800ms 後自動 `PUT`**；離開頁面或分頁前若有未存的草稿立即送出。儲存中／已儲存／失敗以小字顯示在面板頂端，失敗時保留草稿並提供重試。

### 5.3 貼上與上傳

- **貼上圖片**：圖片頁（`static-image`／`gsap-image`）上 `Ctrl+V` 一律**新增一個圖片元素**（自動採用底圖），預設寬 40%、依圖片長寬比算高、置中，隨即進入元素分頁並選取它。連貼三張就是三個元素。React 頁維持既有行為（換底圖），notebook 頁忽略。
- **貼上文字**：只在元素分頁開著、且焦點不在輸入框時，把純文字貼成一個文字元素——這是簡報軟體的行為；在其他分頁貼文字仍照瀏覽器預設。
- **上傳圖片**：工具列「上傳圖片」開檔案選擇器，多選就是多個元素。
- **更換底圖**：工具列另一顆按鈕，走 `replace-image`（`mode=base`）。這是原本「貼上就換底圖」唯一保留下來的入口，變成一個明確的動作。

### 5.4 AI 功能的提示

AI 重繪的預覽對話框（`ImagePreviewDialog`）在頁面有元素時多一行說明：套用後元素會成為圖片的一部分、不再能個別編輯。「更換底圖」不在此列——它保留元素。

---

## 6. 安全性

| 項目 | 對策 |
| --- | --- |
| 元素文件 | zod schema 全面驗證：型別聯集、數值範圍（座標 -1..2 允許稍微出界、字級 8..400、透明度 0..1）、文字長度 ≤ 2000、陣列 ≤ 100；不認得的欄位丟掉 |
| 顏色 | 正規表達式白名單（§2.4）；不合法的值整份 400，不靜默改寫 |
| 素材檔名 | 嚴格正規表達式 ＋ 必須以該頁 `page_uid` 為前綴 ＋ `safeJoinPdfPath`；`PUT` 時引用不存在的素材 → 400 |
| 上傳 | `sharp` 實際解碼（副檔名不是證據）、≤ 8 MB、不收 SVG（可帶腳本） |
| 文字內容 | 前端以 React text node 渲染（永不當 HTML）；後端只進 `fillText` |
| 權限 | 讀走 `canReadPdf`（含 share token），寫走 `canEditPdf`，與底圖一致 |
| 合成的 canvas | 不執行任何使用者提供的程式；字型鍵是白名單，不接受任意字型名稱 |

---

## 7. 不在這一版

1. 元素動畫（進場／強調）——GSAP 動畫層已經有時間軸型的 `text-callout`，兩者未來可以對接。
2. 群組、對齊輔助線、磁吸。
3. 富文字編輯器（所見即所得）——文字框內混合樣式靠 Markdown 語法（粗體、斜體、標題、程式碼），不做工具列式的選取套用。
4. 素材跨頁共用、素材庫。
5. 把手寫畫布與 GSAP overlay 合成進匯出（既有缺陷，另案）。

---

## 8. 測試計畫

後端：

- `pageElements.ts` 的 schema：合法文件通過；非法顏色、超範圍字級、未知型別、超過 100 個元素、素材檔名不符各自被拒。
- Markdown：伺服器端渲染器對同一段輸入產出標題／條列／連結／表格／KaTeX，原始 HTML 被轉義、不安全 scheme 的連結留作文字；純文字投影去掉標記；合成文件在有數學時才帶 KaTeX 樣式（字型已內嵌）。
- 渲染：純色底圖上放一個實心矩形，合成後取樣該區域的像素顏色正確、區域外仍是底色；旋轉 90° 的長方形佔位正確；文字元素合成不擲錯且區域內像素有變化（不比對字形）。
- `PUT` 流程：第一次寫入建立 `base.jpg` 並把 `elements_path` 寫進資料表；`jpg` 與 `base.jpg` 不同；清空後 `base.jpg` 消失、`jpg` 回到原圖位元組、`elements_path` 為 NULL；孤兒素材被清掉。
- `replace-image`：`mode=base` 保留元素並重新合成；`mode=fuse` 清掉元素與底圖。
- 素材上傳：非圖片、SVG、超大被拒；讀取時路徑穿越與他頁前綴回 404。
- 權限：非擁有者 `PUT` 403；share token 唯讀可 `GET` 元素與素材。
- 刪頁清檔；匯出 sidecar 與匯入套回。

前端（純函式，`node:test`）：

- 幾何：拖曳／縮放把手／旋轉的座標換算、最小尺寸、鍵盤微調。
- 預設元素工廠（文字、圖片依長寬比算高、圖案）。
- 顏色解析與組合（hex ↔ rgba、透明度滑桿）。
- 貼上分流：圖片頁貼圖 → 新增元素；React 頁 → 換底圖；notebook → 忽略。
- 圖片來源選擇：有元素用 `base_image_url`，沒有用 `image_url`。
- i18n 鍵平衡（既有 `i18n.test.ts`）。

---

## 9. 剪下區域做動畫（cut-outs）

### 9.1 要解決的事

AI 產生底圖之後，常常想讓其中**一部分逐漸出現**——先講左邊的圖，再讓右邊的表格浮出來。底圖是一張完整的圖片，沒有「一部分」可言；要做到這件事必須先把那一塊從圖片裡拿出來。

### 9.2 流程

使用者在元素分頁按「框選區域」，在投影片上拖曳畫出一個或多個矩形（座標 0..1，與元素同一套），按「剪下並移除背景」後伺服器（[`pageCutouts.ts`](../backend/src/services/pageCutouts.ts)、`POST /api/pdfs/:id/pages/:n/cutouts`）對每一個框依序做三件事：

1. **裁下**：從底圖（有元素層時是 `base.jpg`）把框內像素裁成 PNG，存成該頁的**插圖素材**（figure，`source: 'cutout'`，`bbox` 記著原位）。裁切一律取自**未動過的原圖**，重疊的框才不會裁到已經被抹掉的區域。
2. **抹除**：沿用 React 頁抽文字的擦背景做法（`computeEraseContext` ＋ `compositeErasedRegion`）——只把加了 padding、已符合模型長寬比的裁切送給影像編輯模型，遮罩的洞正好落在框上；模型回來後**只把框內像素貼回**，框外一個位元組都不變。預設提示詞要求「延續周圍背景、不要畫任何新東西」，使用者可以加補充說明（例如背景是什麼）。
3. **放回去當動畫**：預設為每個框在該頁的 GSAP 規格加一個 `overlay-image` 效果——`figureId` 指向剛存的素材、`params` 是原位（百分比）、淡入 0.8 秒、依序間隔 1 秒、**沒有 exitDuration**（出現了就留著，這正是「逐漸顯示」要的）。頁面因此變成 `gsap-image`；之後所有調整都在動畫分頁裡做，那裡本來就會列出這些素材與效果。

抹除後的圖寫回的位置與「更換底圖」相同：有元素層就寫 `base.jpg` 並重新合成，沒有就直接成為 `<uid>.jpg`。所以匯出與 AI 看到的是**已經沒有那一塊**的底圖，而動畫在播放時把它疊回來。

### 9.3 失敗的處理

框是逐一處理的，一個框的模型呼叫失敗不影響其他框：失敗的框**不建立素材、不加效果、底圖上保留原樣**，回應逐框回報 `done`／`failed` 與原因；全部失敗時回 502 且什麼都不寫。模型呼叫本身以 `CutoutEraser` 注入——路由給的是真的影像編輯模型，測試給的是把洞塗白的假函式，因此裁切、遮罩幾何、只貼回框內、素材與規格的簿記全部有測試涵蓋，不需要模型。

### 9.4 已知取捨

- 這一步用的是既有的 GSAP `overlay-image`，所以它繼承了 §8 第 1 點的既有缺陷：**動畫疊層進不了匯出**——匯出的 JPG 是抹除後的底圖。要匯出「最終全部出現」的畫面，可以把素材改放成圖片元素（元素層會合成進去），但那就不是動畫了；兩者的取捨留給使用者。
- 抹除品質取決於影像編輯模型；背景複雜（照片、漸層文字）時可能留下痕跡，補充說明欄就是為此存在。

### 9.5 出現的時機與位置：交給模型

剪下之後的動畫效果若只是「依序每隔一秒出現」，使用者還得逐一對到講稿。因此加動畫時多一步（[`cutoutPlacement.ts`](../backend/src/services/cutoutPlacement.ts)）：把**抹除後的頁面**、每一塊剪下的圖片（附原位）、以及該頁逐字稿的句子（與播放同一套切句 `splitScriptIntoSentences`，最多 20 句）一起交給有視覺能力的 LLM，請它為每一塊回答兩件事——

| 問題 | 落到規格的哪裡 |
| --- | --- |
| 講到哪一句時該出現 | 模型回答的是「圖片說明的是第 N 句」；效果寫成 `startTrigger: { type: 'transcript-line', line: N-1, anchor: 'start' }`——**前一句開始時**就淡入，保證圖片一定在講到它之前出現。N 是第一句時直接一開始就顯示。數字 `start` 仍寫成依序排列的值，作為沒有旁白時間時的備援 |
| 顯示在哪裡 | `params`（xPct／yPct／widthPct，heightPct 由圖片本身的長寬比推出，永不拉伸；超出頁面就往內推） |

提示詞明說：原位通常就是對的（那裡現在已經是空背景），只有明顯更好時才搬——例如圖太小、旁邊有大片空白可以放大——而且不能蓋到文字或其他剪下的圖。模型沒回答或回答超出範圍的部分，一律退回原位；模型呼叫失敗或環境沒有 LLM（`llmAvailability()`）時整組退回「原位＋依序出現」，剪下本身不受影響。回應與面板會逐塊顯示「第 N 句開始時出現：『…』」與位置，讓使用者一眼看出模型的決定，要改就到動畫分頁。

**開場不留白**：最上方的那一塊（且它的上緣在頁面上方 25% 內，也就是標題的位置）不等任何句子，`start: 0` 立刻顯示——一頁若一開始整片空白，看起來像壞掉，而那一塊幾乎總是標題。其他塊依上表在前一句開始時淡入。

`placer` 與 `eraser` 一樣是注入的：測試用假的 placer 驗證觸發與位置真的寫進規格、失敗時真的退回原位。

### 9.6 自動偵測要剪的區域

一張圖有七八個區塊時，逐一框選是苦工。「自動偵測區域」（`POST …/cutouts/detect`，[`cutoutDetect.ts`](../backend/src/services/cutoutDetect.ts)）分兩段：

1. **影像分析（決定性、不需模型）**：把底圖縮到 480px 寬，取邊框最常見的顏色當背景色，與背景色距離超過門檻的像素視為內容；先做一次粗略的膨脹＋連通元件＋合併找出大塊，再對每個夠大的塊（≥ 12% 頁面）做**遞迴 XY-cut**——在塊內重新估計背景色（卡片自己的淺色底就是背景），找最寬的一條內部空白帶（橫向的帶容許穿過一條細箭頭；直向的必須全空，因為稀疏的直欄多半是座標軸或圖中的箭頭），從那裡切成兩半，反覆到切不動或塊已經很小為止；較小的塊（4–12%）只在空白帶很寬（≥ 4%）時才切，免得把條列切成一行一行；墨很密的塊（照片、圖表）不切。切完再把「緊貼在大塊上下、寬度對得上的薄條」（座標軸標籤、圖說、小標題）吸回那個大塊。最後去掉太小（< 0.15% 面積）與太大（> 85%）的框，最多 20 個，由上到下、由左到右排序。

   第一版只有「膨脹＋合併」那一步，在排版很密的頁面（例如卡片式版面）會把整頁黏成一塊——使用者在 `TNQ62wZM_z` 第 9、11、12 頁看到的就是這個：框「都選太大了」，第 9 頁甚至因為超過 85% 被整個丟掉。XY-cut 正是為此加的；在那四頁上實測，現在每頁各得到 8–13 個貼著卡片與圖塊的框。
2. **模型分組與標註（有 LLM 時）**：把畫了紅色編號框的圖片、各框座標與該頁講稿交給視覺模型，請它把屬於同一個單位的框合併（圖表與它的說明文字、圖示與標籤、一段被切成多塊的圖）、把應該留在背景的裝飾（邊框、分隔線、頁尾、logo、頁碼）標成不保留，並為每個保留的單位寫幾個字的說明。**模型不產生座標**，只指定「哪些編號合在一起」——像素分析找到的框才是座標來源，這避開了 VLM 報座標不準的老問題（見 2026-08-15 的實測記錄：專用偵測比 VLM 高 39 個百分點）。模型失敗或沒有 LLM 就直接用第一段的結果。

偵測結果**不會直接剪**：它填進區域清單並打開框選模式，讓使用者在投影片上看到每個框、刪掉不要的、補畫漏掉的，再按「剪下」。模型給的說明會成為剪下素材的 caption。

### 9.7 批次：在「重新生成」裡一次處理很多頁

一頁一頁按「自動偵測」再按「剪下」，在一份五十頁的簡報上仍是苦工。因此重新生成對話框多一個選項「✂️ 自動剪下區域並產生動畫」：它是重生工作的一個新步驤 `cutout`，對所有選中的圖片頁依序做 §9.6 的偵測（有 LLM 就分組標註）→ §9.2 的裁下、抹除 → §9.5 的定時定位。

- **順序排在最後**：先跑完圖片、逐字稿、語音、AI 焦點動畫，再剪——它要處理的是重生後的圖片，而 AI 焦點動畫會整份改寫規格，排在它之後會把剪下的效果洗掉。
- **快照與回復**：`cutout` 步驤會改寫圖片並改動畫規格，所以快照把這兩種資產都備份（`snapshotTargetsFor()`），「回復」能把底圖與動畫設定一起還原。剪出來的插圖素材不在快照裡，回復後會留在素材庫，無害。
- **逐頁容錯**：偵測不到東西的頁面直接略過；某一頁抹除失敗只記錄、不中斷整批，步驤結束時在錯誤欄回報失敗頁數。React 頁與 notebook 頁不在範圍內。
- **相依集中**：抹除模型、分組模型、定位模型三個協作者由 [`cutoutDeps.ts`](../backend/src/services/cutoutDeps.ts) 統一解析，互動路由與批次步驤拿到的是同一組——測試替換其中任何一個時兩條路都會跟著換。

### 9.8 編輯時看得到已經剪下的東西

剪下之後底圖上那一塊已經被抹成背景，而疊回來的圖片只在播放到它的動畫時才出現——於是回到元素分頁編輯時，投影片看起來像少了東西，使用者會以為剪下的區域不見了。因此元素分頁多一節「這一頁已剪下 N 個區域」：列出該頁 `source: 'cutout'` 的插圖素材（縮圖、說明、位置），並在「編輯時顯示在原位」勾選時，把每一塊以虛線框畫回它的動畫效果所指定的位置（沒有對應效果的用原本的 bbox）。這一層是純顯示、不吃指標，只在元素分頁開著時出現；要改出現時機或位置，一鍵跳到動畫分頁。

### 9.9 還原、重新框選、隱藏：剪下歷史與草稿式編輯

剪下之後一塊區域變成三樣東西（底圖上被抹成背景的像素、裁下的素材、放回原位的動畫效果），所以「刪除」與「調整大小」各有兩種意思。這一節把它們做成明確的動作，並解決兩個底層問題：抹除是 AI 重繪，每次結果都不同，底圖若是一次次改寫累積出來的，任何一步的還原都只能近似；每次寫回又多壓一次 JPEG。

**底圖不再被改寫，而是從原圖算出來**（[`cutoutHistory.ts`](../backend/src/services/cutoutHistory.ts)）：第一次剪下時把當時的底圖存成無損 PNG 的「剪下原圖」；每剪一塊，把 AI 重繪後框內的像素存成「補丁」PNG；`pages/<uid>.cutouts.json` 記錄每塊的框、素材、補丁與動畫效果。底圖永遠等於「原圖＋所有仍生效的補丁」一次合成、只壓一次 JPEG。

| 動作 | 做法 | 需要模型？ |
| --- | --- | --- |
| 還原 | 從清單拿掉那塊、刪補丁、刪素材與效果，重新合成底圖。原圖從未被動過，位元組級精確 | 否 |
| 重新框選 | ＝還原＋以新框重剪：裁圖從原圖取，抹除時交給模型的是「原圖＋其他仍生效的補丁」，即目前畫面 | 是，只有新框 |
| 隱藏／顯示 | 只把效果從規格拿掉／放回（拿掉的效果存在清單裡以便原樣放回），底圖與素材不動 | 否 |

**草稿與一次套用**（[`usePageCutouts.ts`](../frontend/src/pages/play/usePageCutouts.ts)）：還原、重新框選、新框全部先記在前端草稿，畫面用快速近似即時反映——標記還原的塊以裁圖疊回原框（框內本來就精確），新框以斜線網底標示「將被抹除」（不做假的填補，任何瀏覽器端的填補都會與 AI 結果不同）。按「套用變更」才送 `POST …/cutouts/apply { restore, cut }`：伺服器先套用還原、從歷史合成底圖，只對新框跑 AI 抹除，底圖寫一次。失敗的框留在草稿裡，再按一次只補做它。隱藏／顯示不動圖片，立即生效（`PATCH …/cutouts/:figureId`）。

**邊界**：這一頁若之後做了 AI 重繪、更換底圖或融合，新圖片就是新的真相——歷史（原圖與補丁）被清掉，素材與效果保留，那些項目只剩隱藏／顯示與「貼回式還原」。改版前剪下的區域沒有補丁，還原時把裁下的 PNG 貼回原框：當初抹除只改了框內像素，貼回框內是精確的，只多一次 JPEG 重壓，清單以「舊資料」標示。重生對話框的批次剪下走同一條 `applyCutoutChanges()`，因此也會建立歷史。
