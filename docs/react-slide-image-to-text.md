# React 投影片頁：修圖套用到背景 ＋ 區域文字轉 React 文字

- 文件版本：V1.1（**已依此規格實作**）
- 分支：`feat/react-slide-image-to-text`
- 前置：[`react-slide-design.md`](react-slide-design.md)（React 頁、主題、覆寫、背景、烘焙）
- 日期：2026-08-13

---

## 1. 這份規格要解決的兩件事

使用者要求：

1. **React 模式下，修改圖片後按「套用取代原圖」時，要改成取代背景圖。**
2. **新增「轉換成文字」按鈕**：把選取區域內的文字**從圖片中移除**，並轉成 React 文字；文字大小與字型要儘量與原圖一致。

第 2 項是這份規格的主體。它的價值在於：一頁從 PDF 轉來的投影片，文字是**像素**——改一個字要重畫整張圖。把文字抽出來變成真正的文字之後，它就能被編輯、被主題套色、在任何解析度下保持銳利，而背景仍是原本那張圖。這是「圖片投影片」走向「可編輯投影片」最實際的一步。

---

## 2. 需求一：修圖套用到背景圖

### 2.1 現況

圖片編輯（`/inpaint-image`、`/regenerate-image`）產生一張候選圖，使用者在預覽對話框按「套用」→ 前端 `handleApplyPreviewImage()` → `POST /replace-image` → 覆寫 `<page_uid>.jpg`。

### 2.2 問題

在 React 頁上，`<page_uid>.jpg` 是**烘焙的產物**（§9.1）：下一次存檔或編輯就會被重新烘焙覆蓋掉。使用者辛苦修的圖會無聲消失。而 React 頁真正的視覺底層是 `<page_uid>.slide-bg.png`。

### 2.3 設計

新增 `POST /api/pdfs/:id/pages/:n/react-slide/background-image`（multipart，欄位 `file`）：把上傳的圖寫成該頁的背景圖、把 `config.background` 設為 `mode: 'image'`，並排程一次烘焙。

前端 `handleApplyPreviewImage()` 依目前頁面型別分流：

| 頁面型別 | 套用目標 |
| --- | --- |
| `static-image` / `gsap-image` / `notebook` | 既有行為：`replace-image`（頁面 JPG） |
| `react` | 新端點：背景圖 |

**修圖的來源圖也要對**：`/inpaint-image` 目前讀 `image_path` 當來源。React 頁應該讀**背景圖**——否則使用者是在修一張烘焙結果（上面已經有 React 文字層），修完再當背景，文字就會重複出現一次。

預覽對話框的按鈕文案在 React 頁改為「套用為背景圖」，讓使用者知道會蓋掉什麼。

---

## 3. 需求二：區域文字 → React 文字

### 3.1 使用者流程

1. 在投影片上拉出一個選取框（既有的 `imageEditRegion` 機制）。
2. 按 **「轉換成文字」**。
3. 系統：辨識該區域的文字與樣式 → 把該區域的文字從背景圖抹掉 → 在同一位置放上一個 React 文字圖層。
4. 畫面上看起來幾乎沒變，但那段文字現在是真正的文字：可以改字、改色、改大小，並且會跟著主題。

### 3.2 核心設計決策：文字存成「圖層」，不改程式碼

抽出來的文字有兩種存法：

| 做法 | 評估 |
| --- | --- |
| **(A) 插入 `.slide.jsx` 程式碼** | 要用字串或 AST 改動 LLM 寫的程式碼——脆弱（縮排、JSX 結構、既有元素的路徑會位移，讓所有既有覆寫失效），而且重新生成程式碼時會整段消失 |
| **(B) 存進 `config.textLayers`（採用）** | 與既有的 `overrides` / `background` 同一層級：config 與 code 分離。重新生成程式碼時文字圖層**保留**（就像背景一樣），元素路徑不受影響，每一層都能單獨刪除或還原 |

採用 **(B)**。這也符合這些文字的本質：它們不是元件的一部分，而是從背景抽出來、疊在上面的一層。

### 3.3 資料模型

`ReactSlideConfig` 新增：

```ts
interface ReactSlideTextLayer {
  id: string;                 // nanoid(8)
  /** 位置與大小，相對 1920×1080 畫布的百分比（與焦點動畫的座標慣例一致）。 */
  xPct: number; yPct: number; widthPct: number; heightPct: number;
  text: string;               // 上限 2000 字，可含換行
  fontSizePx: number;         // 相對 1920×1080 畫布
  color: string;              // #rrggbb
  fontWeight: number;         // 300–900
  fontFamily: 'heading' | 'body' | 'mono';   // 對應主題 token，不寫死字型名
  textAlign: 'left' | 'center' | 'right';
  lineHeight: number;         // 1.0–2.0
  /** 來源紀錄：這一層是從哪一塊區域抽出來的，供「還原」與除錯用。 */
  extractedAt?: string;
}
```

**為什麼 `fontFamily` 只有三個值**：我們沒有原圖用的字型檔，猜到具體字型名也載入不了（沙箱不能抓外部字型）。對應到主題的 `--slide-font-heading/body/mono`，結果是「風格接近且跟著主題」，而不是假裝完全一致。

### 3.4 辨識：一次 vision 呼叫

沿用既有的 vision 管道（`callChatJSON` ＋ `image_url` 的 data URL，與 `animationAutoFocus.ts` 相同）。送出：

- **裁切後的區域影像**（不是整頁）——模型只需要判斷這一塊，裁切能大幅提高小字的準確度；
- 該區域在畫布上的實際像素尺寸，讓模型知道字級的絕對基準；
- 要求回傳 §3.3 的欄位（JSON schema 驗證）。

**字級的防呆**：模型對字級的估計常常偏大或偏小，而字級錯了整段文字就會溢出或縮成一團。因此後端做兩件事：

1. `fontSizePx` 夾在 `[8, regionHeightPx]`；
2. 依行數再夾一次：`fontSizePx ≤ regionHeightPx / max(1, 行數) / lineHeight × 1.05`。

寧可略小也不要溢出——溢出會蓋到旁邊的內容，略小只是留白多一點，而且使用者可以直接在面板上調。

### 3.5 從背景圖移除文字

用既有的 inpaint 路徑（`images.edit` ＋ mask），但對象是**背景圖**：

- mask：選區為透明（要重繪的區域），其餘不透明；
- prompt：固定指示「移除這塊區域裡的所有文字，延續周圍的背景圖案與漸層，不要畫任何文字或圖形」；
- 結果寫回 `.slide-bg.png`，**舊的背景先備份為 `.slide-bg.prev.png`**。

**為什麼要備份**：這一步不可逆且會失敗得很難看（模型有時會在該區域畫出奇怪的東西）。備份讓「復原」是一個按鈕的事，而不是「重新生成整張背景」。

若該頁**沒有背景圖**（例如純色背景或還沒設定），這一步跳過——沒有像素需要抹掉，直接建立文字圖層即可。

### 3.6 兩步驟、可預覽，而不是一鍵到底

抹圖是一次圖片生成呼叫（數秒、有成本、結果不保證）。因此流程拆成：

1. **辨識**（快、便宜）→ 立刻建立文字圖層，畫面上先出現真正的文字；
2. **抹圖**（慢、有成本）→ 在背景執行，完成後畫面上的重複文字消失。

抹圖失敗時：文字圖層仍在，背景維持原樣（使用者會看到文字重疊兩份），面板顯示「背景文字未能移除」並提供重試與復原。這比「整個功能失敗、什麼都沒發生」好——辨識的結果本身就有價值。

### 3.7 沙箱與烘焙都要渲染文字圖層

- 沙箱（`buildReactSlideSandboxDoc`）：在 `#ms-root` **之上**新增 `#ms-text-layers`，每層一個絕對定位的 `div`，帶 `data-ms-text-layer="<id>"`。
- 烘焙文件（`buildBakeDocument`）：同樣渲染——否則匯出的圖會少掉這些文字。
- 點選模式：點到文字圖層時，沙箱回報 `{ type: 'ms-slide-select-layer', layerId }`，面板切換成**文字圖層編輯器**（文字、字級、顏色、字重、對齊、位置、刪除）。文字圖層不走 `data-ms-path` 的覆寫機制——它本身就是可編輯的資料，不需要再套一層覆寫。

### 3.8 API

| 方法 | 路徑 | 說明 |
| --- | --- | --- |
| `POST` | `/api/pdfs/:id/pages/:n/react-slide/extract-text` | body `{ region: {xPct,yPct,widthPct,heightPct}, eraseBackground?: boolean }`；回傳新的 `config`（含新圖層）與 `erase: 'skipped' \| 'pending' \| 'failed'` |
| `POST` | `/api/pdfs/:id/pages/:n/react-slide/background-image` | multipart `file`；把圖設為背景（需求一） |
| `POST` | `/api/pdfs/:id/pages/:n/react-slide/background/undo` | 還原 `.slide-bg.prev.png` |

文字圖層的增刪改沿用既有的 `PUT …/react-slide`（config 的一部分）。

### 3.9 UI

- 選取框工具列（既有的圖片編輯區）在 React 頁多一顆 **「🔤 轉換成文字」**。
- 浮動的元素編輯面板新增「文字圖層」模式。
- React 分頁的背景區塊新增「復原上一張背景」。

---

## 4. 安全性

文字圖層的每一個值都會進到沙箱與烘焙文件，因此走與覆寫相同的檢查：`color` / 尺寸 / `textAlign` 等以 zod 限定型別與範圍，字串值再過 `isSafeCssValue()`（禁 `url(`、`@import`、`expression(`、`javascript:`、`<`、`;`、`}`）；`text` 以 `textContent` 寫入，永不當 HTML 解析。`fontFamily` 只接受三個列舉值，實際輸出是主題 token。

---

## 5. 測試計畫

後端：

- `clampExtractedFontSize()`：溢出的估計會被行數與區域高度夾住；
- `sanitizeTextLayers()`：非法顏色、超範圍字級/位置、超長文字、未知 `fontFamily` 會被丟棄或夾回範圍；
- `buildExtractTextMessages()`：訊息含裁切影像與區域像素尺寸；
- 背景備份/還原：`undo` 會把上一版換回來；
- 轉換流程（`app.inject`）：辨識成功→config 多一層、抹圖失敗→圖層仍在且回報 `failed`。

前端：

- 文字圖層在沙箱文件中被渲染、且值經過白名單；
- 烘焙文件同樣包含文字圖層（與沙箱一致，用同一組斷言）；
- 套用候選圖時，React 頁走背景端點、其他型別走 `replace-image`。

---

## 6. 已知限制

1. **字型只能到類別層級**（sans / serif / mono ＋ 字重），不會與原圖的字型完全一致——我們沒有那個字型檔，也不能從沙箱載入外部字型。
2. **抹圖是生成式的**：複雜背景（照片、漸層＋圖案）可能留下痕跡。備份與復原是為此存在的。
3. **一次一塊區域**：不做整頁自動抽取。整頁的文字結構（欄位、清單、表格）需要的是版面分析，那是另一個題目。
4. 文字圖層永遠疊在 React 元件之上，不參與元件的排版流。

---

## 7. 實作狀態

全部完成（分支 `feat/react-slide-image-to-text`）：

1. ✅ 修圖套用到背景（`POST …/react-slide/background-image`）＋ inpaint 來源在 React 頁改讀背景圖。
2. ✅ `textLayers` 資料模型、驗證（超範圍/危險值一律丟棄）、沙箱與烘焙皆渲染（共用同一個 `textLayerCss()`）。
3. ✅ 辨識端點（`POST …/react-slide/extract-text`，vision ＋ 字級依區域幾何夾制）。
4. ✅ 抹圖（區域 mask ＋ 背景備份 ＋ `POST …/react-slide/background/undo`）。
5. ✅ UI：React 分頁的「🔤 轉換成文字」與「復原上一張背景」、浮動面板的文字層編輯器。

### 實作後補充的兩個細節

- **mask 的合成方向**：`dest-out` 是用**來源的 alpha** 去減目標，所以挖洞用的矩形必須是**不透明**的。用透明矩形（直覺上「這裡要透明」）會什麼都不減，mask 完全沒有洞，抹圖就變成重畫整張背景。這一點由測試直接斷言像素的 alpha 值把關。
- **抹圖是 best-effort 且分開回報**：端點回傳 `erase: 'done' | 'skipped' | 'failed'`，前端據此顯示不同訊息——抹圖失敗時使用者會在畫面上看到兩份文字，這件事必須明講，而不是回報成功。
