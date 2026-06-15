# PDF 圖表素材萃取設計文件（V1）

## 1. 背景與動機

目前 worker pipeline 在處理 PDF 匯入時，`extractText` 只會把每頁的純文字抽出存成
`storage/<pdfId>/pages/<pageUid>.text.txt`，PDF 內嵌的圖片（圖表、流程圖、截圖等）
完全沒有被處理。

在「從 PDF 產生大綱 / 後續生成投影片圖片」的流程中，這些原始圖表本身、以及與圖表相關
的文字資訊（圖說、上下文說明）是很有價值的素材：未來生成投影片圖片時，可以參考原始圖表
的內容與圖說，讓產出的視覺效果更貼近 PDF 原始資料。

本文件規劃一套「PDF 圖表素材萃取」機制：在 pipeline 中新增一個步驟，從 PDF 中找出所有
有意義的內嵌圖片，連同其在頁面上的位置、圖說與上下文文字，整理成 manifest，供日後的
圖片生成流程使用。

## 2. 目標與範圍

### 2.1 V1 必須完成

- 針對每個 PDF page，透過 `page.getOperatorList()` 找出所有內嵌影像（`paintImageXObject`
  / `paintInlineImageXObject`），並計算其在頁面上的 bounding box（以頁面寬高的百分比表示）。
- 以面積百分比過濾掉過小（icon / logo / 裝飾線條）與幾乎佔滿整頁（背景圖、整頁掃描）的影像。
- 將符合條件的影像，透過 `page.objs.get()` 取得解碼後的原始像素資料，轉成 PNG 檔案存到
  `storage/<pdfId>/figures/`。
- 透過 `page.getTextContent()`，比對影像 bounding box 附近的文字行，找出圖說
  （`Figure N` / `Fig. N` / `圖N` / `圖表N` / `Table N` / `表N`）與緊接其後的說明文字
  （context）。
- 產出 manifest：`storage/<pdfId>/figures.json`，記錄每頁的圖表清單（位置、檔案路徑、
  圖說、上下文）。
- 整合進 worker pipeline：在 `extract_text` 之後新增 `extract_figures` stage，僅針對
  「真正的 PDF 匯入」（非文字 / YouTube 匯入）執行；具備 idempotent 重跑能力；失敗不
  中斷整個 pipeline。
- 提供讀取用的 service 函式（`loadFigureManifest` / `getPageFigures`），方便未來的圖片
  生成步驟引用這些素材。

### 2.2 V1 不處理（留待未來）

- ~~純向量繪圖（沒有內嵌 raster image 的圖表，例如直接用線段/路徑畫出的圖）的偵測與輸出。~~
  → V2 已於第 12 節完成。
- ~~自動將圖表對應到大綱投影片、自動注入到 `buildImagePrompt`。~~ → 一般文件模式
  （`pdf_import_mode === 'document'`）已於第 11 節完成；其餘匯入模式維持原樣（第 10 節）。
- 圖片內文字的 OCR。
- 跨頁圖表的合併、圖說跨頁比對。
- 前端瀏覽 / 挑選圖表素材的 UI。

## 3. 技術調查結果

在實作前，針對「如何從 PDF 取得圖片」做了兩種方案的驗證：

### 3.1 方案 A：整頁渲染後裁切（已放棄）

原本設想重用 `renderPdfPages()` 的整頁渲染結果，依 bounding box 裁切出圖表。但實測發現：
只要頁面中含有 `paintImageXObject` / `paintInlineImageXObject`（即內嵌 raster 圖片），
`page.render()` 在目前環境（pdfjs-dist legacy build + node-canvas）會丟出
`TypeError: Image or Canvas expected`（發生在 `paintInlineImageXObject` →
`drawImageAtIntegerCoords`）。

用 `storage/jBaLIg8vMa/source.pdf`（真實的 production PDF）驗證，第 1、4、5 頁等含圖片
的頁面皆會觸發此錯誤；不含圖片的頁面（第 2、3 頁）則渲染正常。這代表現有
`renderPdfPages()` 在含內嵌圖片的頁面上本身就有缺陷 —— 但這是既有 bug，超出本功能範圍，
因此本設計刻意避免依賴整頁渲染。

**V2 更新（已解決）**：上述 `TypeError: Image or Canvas expected` 問題已在 V2
（第 12 節）修正，根因有兩個：

1. pdf.js 在 Node 18+ 環境會優先用全域的 `createImageBitmap` / `ImageDecoder`
   解碼內嵌影像，其輸出物件與 `canvas`（node-canvas）的 `ctx.drawImage()` 不相容。
2. pdf.js 內建的 Node canvas factory 是用 `@napi-rs/canvas` 建立中介 canvas，
   與本專案 `canvasContext` 所用的 `canvas`（node-canvas）是不同的原生模組，
   兩者的 canvas/image 物件互不相容。

修正方式（`backend/src/worker/poppler.ts`）：模組載入時 `delete
globalThis.createImageBitmap` / `delete globalThis.ImageDecoder` 強制走相容解碼
路徑；新增 `NodeCanvasFactory`（`create`/`reset`/`destroy` 皆透過 `canvas` 套件的
`createCanvas()`），呼叫 `getDocument()` 時傳入 `CanvasFactory: NodeCanvasFactory`，
確保 pdf.js 內部所有中介 canvas 與 `canvasContext` 同源。修正後 `page.render()`
在含 `paintImageXObject` 的頁面上可正常輸出，第 12.5 節「整頁 render + 裁切」
因此改用 pdf.js 本身（而非原規劃的 poppler `pdftoppm`），詳見第 12.5 節。
V1 的 raster 影像萃取（§3.2，直接讀取 `page.objs.get()` 的像素資料）不受影響、
維持不變。

### 3.2 方案 B：直接讀取影像物件的原始像素資料（採用）

改用以下流程，不需要整頁渲染：

1. `const opList = await page.getOperatorList()` 取得 operator list。
2. 在 operator list 中尋找 `OPS.paintImageXObject` / `OPS.paintInlineImageXObject`，
   取得其影像物件 id（如 `img_p25_1`）。
3. `page.objs.get(id, callback)`（callback 形式，物件在 `getOperatorList()` 過程中
   非同步解析）取得 `{ data, width, height, kind }`，其中 `data` 已是 pdf.js 解碼好的
   原始像素 buffer（RGB / RGBA / 1bpp 灰階），不論原始編碼是 JPEG / PNG / Flate 等。
4. 用 `sharp(buffer, { raw: { width, height, channels } }).png().toFile(...)` 轉成 PNG。

用同一份 `jBaLIg8vMa/source.pdf` 第 26 頁驗證：成功取出一張 2970×870、RGBA
（`kind = ImageKind.RGBA_32BPP`）的長條圖（matplotlib 圖表），且該頁文字內容中包含
`"Figure 10: The first MLP layer has the strongest causal effects on the model's logits
prediction."`，其文字 y 座標恰好緊接在圖片 bounding box 下方 —— 證實「依位置鄰近比對
圖說」策略可行。此方案完全避開 `page.render()`，也能取得圖片原始解析度。

## 4. 資料模型

### 4.1 `figures.json`

```ts
interface FigureManifest {
  pdfId: string;
  generatedAt: string; // ISO 8601
  pages: FigurePageEntry[];
}

interface FigurePageEntry {
  pageNumber: number;
  figures: FigureEntry[];
}

interface FigureEntry {
  /** 穩定 id：`p<pageNumber>-<pdfObjectId>`，例如 "p26-img_p25_1" */
  id: string;
  /** 相對於 storage/<pdfId>/ 的路徑，例如 "figures/p26-img_p25_1.png" */
  imagePath: string;
  /** 圖片原始像素尺寸 */
  width: number;
  height: number;
  /** 在頁面上的位置與大小，皆為頁面寬高的百分比（0~1），y 由上往下計算 */
  bbox: {
    xPct: number;
    yPct: number;
    widthPct: number;
    heightPct: number;
  };
  /** 比對到的圖說（如「Figure 10: ...」），找不到則為 null */
  caption: string | null;
  /** 圖說之後緊接的說明文字（1~2 行），找不到則為 null */
  context: string | null;
}
```

### 4.2 儲存佈局

```
storage/<pdfId>/
  figures.json          # manifest
  figures/
    p<pageNumber>-<objId>.png
    ...
```

## 5. 萃取演算法

### 5.1 影像偵測與 bounding box 計算

`page.getOperatorList()` 回傳的第一個 op 是 pdf.js 額外加上的 viewport 轉換
（例如 `[1,0,0,-1,0,pageHeight]`），代表「PDF 使用者座標 → canvas 裝置座標」的轉換。
為了取得「PDF 頁面座標系」下的 bounding box，CTM 追蹤從第二個 op 開始，初始值為單位矩陣：

- `OPS.save` → push 目前 CTM
- `OPS.restore` → pop CTM
- `OPS.transform`（即 `cm`）→ `ctm = mul(args, ctm)`（PDF row-vector 慣例：先套用 `cm`，
  再套用舊 CTM）
- `OPS.paintImageXObject` / `OPS.paintInlineImageXObject` → 將影像座標系的單位正方形
  四個角 `(0,0) (1,0) (1,1) (0,1)` 透過目前 CTM 轉換，取得四點的 min/max，即為該影像在
  PDF 使用者座標系下的 bounding box。

再用 `page.view`（mediabox，`[x0, y0, x1, y1]`）將 bounding box 轉成百分比：

```
pageWidth  = x1 - x0
pageHeight = y1 - y0
xPct      = (bbox.x0 - x0) / pageWidth
yPct      = (y1 - bbox.y1) / pageHeight   // 從頂部算起
widthPct  = (bbox.x1 - bbox.x0) / pageWidth
heightPct = (bbox.y1 - bbox.y0) / pageHeight
```

`OPS.paintImageMaskXObject`（1bpp stencil mask）V1 不處理：這類物件通常用來畫單色形狀
或遮罩，不具備色彩資訊，不適合作為「圖表素材」。

### 5.2 面積過濾

```
areaPct = widthPct * heightPct * 100
保留條件：FIGURE_MIN_AREA_PCT <= areaPct <= FIGURE_MAX_AREA_PCT
```

預設常數：`FIGURE_MIN_AREA_PCT = 1`（過濾 icon / logo / 裝飾線），
`FIGURE_MAX_AREA_PCT = 95`（過濾整頁背景 / 掃描頁）。

### 5.3 影像資料解碼與輸出

對通過面積過濾的每個影像 id：

1. `page.objs.get(id, callback)`，加上 timeout（例如 5 秒）保護，避免物件永遠不解析時
   pipeline 卡住；timeout 或物件缺少 `data` 時記錄 warning 並跳過該圖。
2. 依 `kind` 決定 sharp 的 `channels`：
   - `ImageKind.RGBA_32BPP (3)` → 4 channels，直接使用 `data`
   - `ImageKind.RGB_24BPP (2)` → 3 channels，直接使用 `data`
   - `ImageKind.GRAYSCALE_1BPP (1)` → 先將每行 1bpp 資料展開成 8bpp 灰階（1 channel）
3. `await sharp(Buffer.from(data), { raw: { width, height, channels } }).png().toFile(figurePath)`
4. 檔名：`p<pageNumber>-<objId>.png`（id 由 PDF 資源名稱決定，同一份 PDF 重新萃取會得到
   相同檔名，便於 idempotent 判斷）。

### 5.4 圖說（caption）與上下文比對

1. `await page.getTextContent()`，依 `item.hasEOL` 將 items 串接成「行」，每行記錄第一個
   item 的 `transform`（取 `transform[5]` 作為該行的 y 座標，與影像 bbox 同一座標系）。
2. Caption 正規表示式（不分大小寫）：

   ```
   /^(Fig(?:ure)?\.?|Table|圖表?|表)\s*\.?\s*\d+/i
   ```

3. 在影像 bbox 正下方（`line.y < bbox.y0`，取差值最小者）一定距離內
   （例如 `bbox.y0 - line.y <= 36pt`，約半行到一行的距離）尋找符合上述正規式的行作為
   `caption`；若找不到，往上方（`line.y > bbox.y1`）以同樣邏輯尋找。
4. 若找到 caption，取該行之後緊接的 1～2 行非空文字（同一段落的延伸說明）與 caption 合併
   存入 `context`；若找不到 caption，`caption` 與 `context` 皆為 `null`。

## 6. Pipeline 整合

### 6.1 新檔案

`backend/src/worker/steps/extractPdfFigures.ts`：

```ts
export interface ExtractPdfFiguresResult {
  manifest: FigureManifest;
  figureCount: number;
}

export async function extractPdfFigures(
  pdfId: string,
  pageCount: number,
): Promise<ExtractPdfFiguresResult>;
```

### 6.2 整合點

在 `pipeline.ts` 的 Step 2（`extract_text`）完成之後，新增 Step 2.1：

```ts
const sourceType = row.source_type ?? 'pdf';
const isTextImport = fs.existsSync(sourceTextPath(pdfId));
if (sourceType === 'pdf' && !isTextImport) {
  const figuresStage = startStage(run, 'extract_figures', { pageCount });
  try {
    const { figureCount } = await extractPdfFigures(pdfId, pageCount);
    finishStage(figuresStage, 'succeeded', { figureCount });
  } catch (err) {
    logger.warn({ pdfId, err }, 'Pipeline: extract_figures failed (non-fatal)');
    finishStage(figuresStage, 'failed', undefined, {
      code: (err as { code?: string })?.code ?? null,
      message: (err as Error)?.message ?? String(err),
    });
  }
}
```

- 新增 `PipelineStage` 列舉值 `'extract_figures'`，並加入
  `TIMING_EVENT_VALUES.stages` 與 `SLA_TARGETS_MS.stages`（沿用 `extract_text` 的
  120,000ms SLA）。
- 不新增 `progress_step` / DB schema 變更：idempotency 直接以
  `storage/<pdfId>/figures.json` 是否存在判斷 —— 若已存在則讀取既有 manifest 並回傳，
  不重新計算。
- 失敗（例如 PDF 結構異常導致 `getOperatorList()` 出錯）僅記錄 log、`finishStage('failed')`，
  不會 throw，不影響後續 `split_text` / `generate_scripts` 等步驟。

## 7. 提供給後續使用的 API

新增 `backend/src/services/pdfFigures.ts`：

```ts
export function loadFigureManifest(pdfId: string): FigureManifest | null;
export function getPageFigures(pdfId: string, pageNumber: number): FigureEntry[];
export function figureImagePath(pdfId: string, figure: FigureEntry): string; // 絕對路徑
export function getFigureReferencesForPage(pdfId: string, pageNumber: number, max?: number): FigureEntry[];
export function buildFigureReferenceNotes(figures: FigureEntry[]): string | null;
```

並在 `storage.ts` 新增對應的路徑 helper：`figuresDir(pdfId)`、`figureManifestPath(pdfId)`、
`figureFilePath(pdfId, filename)`。

`getFigureReferencesForPage` / `buildFigureReferenceNotes` 是給「投影片圖片重新生成」流程使用的
整合 API，詳見第 10 節。

## 8. 測試計畫

- 使用 `storage/jBaLIg8vMa/source.pdf`（既有、含真實圖表的 production PDF）作為整合測試
  fixture：
  - 對第 26 頁執行萃取，預期得到 1 張圖（`img_p25_1`），bbox 面積約 9~10%，
    `caption` 包含 `"Figure 10"`。
  - 對不含圖片的頁面（第 2、3 頁）執行萃取，預期 `figures` 為空陣列。
  - 對含小圖示（面積 < 1%）的頁面（第 1 頁），預期該圖示被過濾、不出現在結果中。
- 重新執行 `extractPdfFigures` 兩次，驗證第二次因 `figures.json` 已存在而直接回傳既有
  manifest（idempotent）。
- `npx tsc --noEmit`（backend）需通過。
- `npx tsx --test backend/test/pdf-figures.test.ts`（新測試）需通過。

## 9. 未來工作

- ~~偵測純向量繪圖區域（無 raster image，但該頁有大量繪圖類 operator 集中於特定區域）。~~
  → V2 已於第 12 節完成。
- ~~前端提供圖表素材瀏覽 / 挑選介面。~~ → 已於第 13 節完成。

## 10. 整合至投影片圖片（重新）生成（已完成）

由於一般 PDF 匯入的「投影片圖片」就是 PDF 原始頁面的 render（`renderPages`，與
`extract_figures` 一樣以 1..pageCount 的 PDF 頁碼為索引，兩者天然 1:1 對應），第一次產生
投影片時並不會呼叫 LLM 重新畫圖，圖表本來就已經包含在頁面截圖中。

真正會呼叫 `buildImagePrompt` + `images.edit` 重新生成投影片圖片的是「AI 重新生成圖片」
流程，且其 `page_number` 即為原始 PDF 頁碼，因此可以直接用
`getFigureReferencesForPage(pdfId, pageNumber)` 取得該頁的圖表：

- `backend/src/routes/pdfs/page-operations.ts`
  （`POST /api/pdfs/:id/pages/:n/regenerate-image`，單頁、依提示詞重新生成候選圖）
- `backend/src/worker/regenerate.ts` 的 `runRegenerateImages`
  （`POST /api/pdfs/:id/regenerate` 的 `images` 步驟，批次重新生成多頁）

兩處皆在組 prompt 與呼叫 `images.edit` 前加入：

```ts
const figureRefs = getFigureReferencesForPage(pdfId, pageNumber); // 面積最大的最多 2 張
const basePrompt = buildImagePrompt({
  // ...原有參數
  figureNotes: buildFigureReferenceNotes(figureRefs),
});
const figureRefFiles = await Promise.all(
  figureRefs.map((figure, i) =>
    fs.promises.readFile(figureImageAbsPath(pdfId, figure))
      .then((buf) => toFile(buf, `figure-ref-${i + 1}.png`, { type: 'image/png' })),
  ),
);
const editImage = figureRefFiles.length > 0
  ? [currentImageForEdit, ...figureRefFiles]
  : currentImageForEdit; // images.edit 支援多圖陣列（沿用 inpaint-image 已驗證的模式）
```

- `buildImagePrompt` 新增 `figureNotes?: string | null` 參數，插在「頁面逐字稿」之後、
  `textBody` 之前。`buildFigureReferenceNotes` 會列出每張參考圖的 `caption`/`context`，
  並提示 LLM 「盡量保留這些圖表的關鍵資訊、數據或趨勢，不需要逐一複製其外觀」。
- 沒有 `figures.json`（非 PDF 匯入）或該頁無圖表時，`figureRefs` 為空陣列，
  `editImage` 維持原本單圖、`figureNotes` 為 `null`（不插入新段落）——行為與整合前完全相同。
- `runRegenerateImages` 另在 `startArtifact` 的 metadata 加入 `figureReferenceCount`，
  方便之後從時間紀錄觀察圖表參考的命中率。
- 測試：`backend/test/image-prompt-templates.test.ts`、
  `backend/test/pdf-figures.test.ts`（新增 `getFigureReferencesForPage` /
  `buildFigureReferenceNotes` 案例）、
  `backend/test/figure-reference-image-generation.test.ts`（端對端驗證
  `/regenerate-image` 與 `/regenerate` 的 `images` 步驟皆會把圖表當作參考圖傳給
  `images.edit`，且 prompt 含圖說文字）。

## 11. 一般文件模式（`pdf_import_mode === 'document'`）整合（已完成）

### 11.1 問題背景

「一般文件」匯入模式會先用 `extractPdfTextPages` 取得 PDF 逐頁文字，再交給
`splitTextWithLlm` 做 AI 重新分頁（大綱優先策略），最後對每一張 AI 分頁呼叫
`renderTextPagesWithLlm` 用 LLM 直接生成投影片圖片（`images.generate`），完全不會
render 原始 PDF 頁面截圖。

在第 10 節完成之前，這條路徑：

1. 完全跳過 `extract_figures`（`pipeline.ts` 的條件式只在
   `!fs.existsSync(sourceTextPath(pdfId))` 時執行）。
2. 即使跑了 `extract_figures`，AI 重新分頁後的「投影片頁碼」與原始 PDF 頁碼也不是
   1:1 對應，無法直接用 `getFigureReferencesForPage(pdfId, pageNumber)` 取圖。

因此一般文件 PDF 中的圖表、圖片完全沒有機會被保留到最終投影片中。

### 11.2 `[[PDF_PAGE_N]]` 頁碼標記

新增 `backend/src/services/pdfPageMarkers.ts`：

```ts
export function formatPdfPageMarker(pageNumber: number): string; // -> "[[PDF_PAGE_N]]"
export function containsPdfPageMarkers(text: string): boolean;
export function stripPdfPageMarkers(text: string): string;
export function buildTextWithPdfPageMarkers(pageTexts: string[]): string;
```

`backend/src/worker/poppler.ts` 新增 `extractPdfTextPages(pdfPath): Promise<string[]>`
（逐頁文字陣列；`extractPdfText` 改為呼叫它後 `join('\n')`，行為不變）。

一般文件模式上傳時（`backend/src/routes/pdfs/upload.ts`），改用
`extractPdfTextPages` 取得逐頁文字，並透過 `buildTextWithPdfPageMarkers` 寫入
`source.txt`：

```
[[PDF_PAGE_1]]
...第 1 頁文字...

[[PDF_PAGE_2]]
...第 2 頁文字...
```

`pdf_sources.content_text`（給其他流程使用的全文）仍是不含標記的純文字（各頁
trim + 去除 NUL byte 後 `join('\n')`，與既有行為一致）。

### 11.3 大綱 LLM 回報 `source_pages`

`splitTextWithLlm.ts` 的 `OutlineSchema` 新增可選欄位：

```ts
slides: z.array(z.object({
  title: z.string().min(1),
  bullets: z.array(z.string().min(1)).min(2).max(6),
  source_pages: z.array(z.number().int().positive()).max(10).optional(),
})).min(3).max(20),
```

當輸入文字含 `[[PDF_PAGE_N]]` 標記時（`containsPdfPageMarkers`），system prompt
額外要求 LLM 針對每張投影片回報 `source_pages`（該投影片內容主要參考自哪些原始 PDF
頁碼），並明確禁止把標記文字寫進 `title` / `bullets`。

「大綱優先策略」（`OUTLINE_THRESHOLD_CHARS = 800` 字以上的文件）將
`outlineResult.slides[idx].sourcePdfPages`（去重、排序）依索引對應到
`splitBySlideMarkers(outlineText)` 產生的每一張 AI 分頁，寫入
`SplitTextWithLlmResult.pages[i].sourcePdfPages`。

其餘策略（Strategy 1：原文已含 `Slide N:` 標記；Strategy 3：chunk fallback）不產生
`sourcePdfPages`（維持 `undefined`）——圖表注入對這兩種情況是 no-op，屬於可接受的
best-effort 降級。

對外的 `splitTextWithLlm()`（包一層 `splitTextWithLlmCore`）會將所有分頁
`content` 中殘留的 `[[PDF_PAGE_N]]` 標記透過 `stripPdfPageMarkers` 移除，確保標記
不會出現在最終投影片文字中。

### 11.4 提前執行 `extract_figures` + `split-figure-map.json`

`pipeline.ts` 的 Step 1（一般文件 / TXT 匯入分支）在呼叫 `splitTextWithLlm` 之前，
若該 pdf 有 `source.pdf`（`source_type === 'pdf'` 且為一般文件模式），先呼叫

```ts
runExtractFiguresStage(run, pdfId, pageCount); // 包一層 startStage/finishStage，失敗不中斷
```

`extractPdfFigures` 本身已是 idempotent（檢查 `figures.json` 是否存在），所以即使
Step 2.1 之後又跑一次也只是直接回傳既有 manifest。

AI 分頁完成後，`pages[i].sourcePdfPages`（若有）會被收集成

```ts
type SplitPageFigureMap = Record<number /* 投影片頁碼 */, number[] /* 來源 PDF 頁碼 */>;
```

並透過新增的 `saveSplitPageFigureMap(pdfId, map)` 寫入
`storage/<pdfId>/split-figure-map.json`（對應的路徑 helper：
`splitFigureMapPath(pdfId)`，定義於 `storage.ts`）。

這個 sidecar 檔案的存在理由：pipeline 可能會 resume —— 若 `existingPages.length > 0`
（該次分頁已經做過），pipeline 不會重新呼叫 `splitTextWithLlm`，只會從磁碟上既有的
`pages/*.text.txt` 重建頁面物件，此時記憶體中原本的 `sourcePdfPages` 早已遺失，必須
從 `split-figure-map.json` 讀回（`loadSplitPageFigureMap`）並重新附加到每個重建的
頁面物件上。

### 11.5 `renderTextPagesWithLlm`：依 `sourcePdfPages` 注入圖表參考圖

`backend/src/services/pdfFigures.ts` 新增：

```ts
export function getFigureReferencesForPages(
  pdfId: string,
  pageNumbers: number[],
  max?: number, // 預設 MAX_FIGURE_REFERENCES_PER_PAGE = 2
): FigureEntry[];
```

聚合多個原始 PDF 頁碼的圖表（依 `id` 去重），再用既有的 `capFiguresByArea` 依面積
取前 `max` 張——`getFigureReferencesForPage`（第 10 節）也改為呼叫
`capFiguresByArea` 共用同一份邏輯。

`RenderTextPagesWithLlmOptions.pages[i]` 新增可選欄位 `sourcePdfPages?: number[]`。
每一頁開始生成圖片前：

```ts
const figureRefs = p.sourcePdfPages?.length
  ? getFigureReferencesForPages(opts.pdfId, p.sourcePdfPages)
  : [];
const figureNotes = buildFigureReferenceNotes(figureRefs);
// ...buildImagePrompt({ ..., figureNotes })

const figureRefFiles = await Promise.all(
  figureRefs.map((figure, i) =>
    fs.promises.readFile(figureImageAbsPath(opts.pdfId, figure))
      .then((buf) => toFile(buf, `figure-ref-${i + 1}.png`, { type: 'image/png' })),
  ),
);
```

生成圖片時依 `figureRefFiles` 是否為空二選一：

- 有參考圖：呼叫 `client.images.edit({ image: figureRefFiles, prompt, ... })`
  （單張時傳單一檔案，多張時傳陣列——與第 10 節 `images.edit` 的用法一致）。
- 無參考圖（多數匯入模式 / 該分頁無對應圖表）：沿用原本的
  `client.images.generate({...})`，行為與整合前完全相同。

成功時的 `onPage` metadata 加入 `figureReferenceCount: figureRefs.length`，與
`runRegenerateImages`（第 10 節）一致，方便觀察命中率。

### 11.6 測試

- `backend/test/pdf-page-markers.test.ts`：`pdfPageMarkers.ts` 各函式的單元測試
  （格式化、偵測、移除標記、round-trip）。
- `backend/test/split-text-with-llm.test.ts`：模擬 `chat.completions.create`，驗證
  含 `[[PDF_PAGE_N]]` 標記的輸入會讓大綱優先策略回傳對應的 `sourcePdfPages`，且最終
  `content` 不含殘留標記；無標記輸入則 `sourcePdfPages` 為 `undefined`。
- `backend/test/pdf-figures.test.ts`：新增 `getFigureReferencesForPages`（跨頁聚合 /
  去重 / 依面積取前 N）與 `loadSplitPageFigureMap` / `saveSplitPageFigureMap` 的案例。
- `backend/test/render-text-pages-figure-injection.test.ts`：模擬
  `images.edit` / `images.generate`，驗證 `sourcePdfPages` 對應到 `figures.json`
  時會呼叫 `images.edit` 並帶上圖表參考圖 + 圖說 prompt；無對應圖表時維持呼叫
  `images.generate`。

## 12. 向量圖形萃取（V2，已完成）

### 12.1 問題分析：`hRUVHXrNqW`（37 頁論文 `2605.29548v2.pdf`）Figure 1-9 全數抽取失敗

以實際匯入的 `storage/hRUVHXrNqW`（與 §11.4 提到的 `myGMS0ahnF` 為同一份論文）檢查
`figures.json`，目前僅在第 4、7、8、26、30、32、33、34、37 頁有萃取結果，對應論文中
Figure 10/13/17/22/23（皆有 caption），但論文正文最先出現、最重要的 **Figure 1～9
全部不在 manifest 中或抽到不相關的內容**：

| Figure | PDF 頁碼 | 目前結果 | 問題 |
| --- | --- | --- | --- |
| 1 | 2 | `figures: []` | 整頁是 6 個子圖的向量折線/散佈圖，無任何 raster image |
| 2 | 4 | 1 張 `p4-img_p3_1.png`（806×713 漸層三角形），`caption: null` | 真正的 (a)(b) 折線圖是向量繪製；抽到的這張在頁面渲染結果中完全不可見，疑似被向量內容蓋住的 colormap 殘留 raster，與圖 2 內容無關 |
| 3 | 5 | `figures: []` | 純向量單圖 |
| 4 | 6 | `figures: []` | 多子圖向量圖 |
| 5/6 | 7 | 1 張 `p7-img_p6_1.png`（折線圖＋"N Examples/N Batch" 圖例），`caption: null` | 抓到的可能是其中一個子面板（資料點多被 matplotlib rasterize），但配不到任何 caption |
| 7 | 8 | 2 張 PCA 散佈圖，`caption: null` | 看起來確實是「Representational Evidence」的子面板，但同樣配不到 caption |
| 8/9 | 9 | `figures: []` | 純向量圖 |

**根因**：matplotlib 對折線圖、長條圖等資料點較少的圖表，PDF backend 預設輸出向量路徑
（`re`/`m`/`l`/`c` 等 path 構造 operator + `f`/`S`/`B` 填色/筆畫/兩者皆有 operator）；
只有資料點極多（如 PCA/embedding 散佈圖，數百~數千個點）才會被 matplotlib 自動 rasterize
成內嵌 image XObject。`extractPdfFigures()`（第 5 節）只追蹤
`OPS.paintImageXObject`，完全不處理向量繪圖 operator，因此純向量圖（Figure 1/3/4/8/9）
該頁 `figures` 永遠是空陣列；混合圖（Figure 2/5/6/7）只抓到被 rasterize 的散佈圖子面板，
折線/長條圖子面板仍會漏掉。

**次要問題（caption 比對）**：即使抓到 raster 子面板（page 4/7/8），三者的 `caption`
皆為 `null`。`CAPTION_MAX_DISTANCE_PT = 40`pt 對「整頁單圖＋下方緊接 caption」（如
Figure 10）很準，但多面板圖的 caption 通常位於整組面板最下方，距離單個小面板的 bbox
經常超過 40pt。

### 12.2 V2 目標

1. 偵測「密集向量繪圖區域」的 bounding box，補上純向量圖表（Figure 1/3/4/8/9 這類）。
2. 將同一個 Figure 的多個子面板（向量 + 既有 raster）群組化，群組共用同一個
   `caption`/`context`。
3. 為向量區域產生 PNG：因為沒有像素資料可直接讀，改用 poppler 整頁 render 後依 bbox
   裁切。
4. 過濾掉像 `p4-img_p3_1.png` 這種「被後繪製的向量內容完全遮蓋、實際不可見」的 raster
   殘留影像。

### 12.3 向量區域偵測演算法

在 `extractPdfFigures()` 既有的 CTM 追蹤迴圈（§5.1）中，除了現有的
`OPS.paintImageXObject` 分支，新增對繪圖類 operator 的 bbox 累積：

- `OPS.constructPath`（`argsArray[i]` 內含 op 碼陣列與座標陣列，需確認 pdf.js
  legacy build 實際的參數結構）：將每個 path 的座標點透過目前 CTM 轉換到 PDF 使用者
  座標系，累積進一個「path bbox 列表」。
- 文字（`OPS.showText` / `OPS.showSpacedText`）**不**計入 path bbox 列表——避免把
  軸標籤/標題文字單獨判定成一張圖；但文字行的 y 座標（已由 §5.4 的
  `collectTextLentent` / `getTextContent()` 取得）仍用於後續的 caption 比對與群組
  邊界判斷。

聚類（clustering）：

1. 對 path bbox 列表做簡單的 union-find：若兩個 bbox 各往四周擴張 `pad`（例如
   5pt）後仍有重疊，則合併為同一群。
2. 每一群最終的合併 bbox 需滿足：
   - 群內 path 數量 `>= VECTOR_FIGURE_MIN_PATHS`（初始建議 20，避免把表格框線、
     底線等少量路徑誤判為圖）。
   - 套用既有 `FIGURE_MIN_AREA_PCT` / `FIGURE_MAX_AREA_PCT` 面積過濾（§5.2）。
3. 與既有 raster image 候選的 bbox 有顯著重疊（例如 IoU > 0.5）的向量群，視為
   同一個候選並合併 bbox（避免重複輸出同一塊區域）。

### 12.4 多面板群組化與 caption 比對

論文中常見「一個 Figure 由多個並排/堆疊的子面板組成，caption 置於整組下方」的版面。
V2 在比對 caption 前，先對該頁所有圖表候選（向量群 + raster image）做幾何群組化：

1. 依 bbox 的 y 範圍是否重疊，將候選分成「列」（同一列代表水平並排的子面板）。
2. 同一列內，依 x 座標排序；若相鄰候選的水平間距小於某門檻（例如該列平均寬度的
   20%），視為同一組的子面板。
3. 對每一組，取其所有子面板 bbox 的聯集作為「群組 bbox」，用既有 `findCaption()`
   （§5.4）在群組 bbox 上下方找 caption——因聯集 bbox 比單個面板大，`CAPTION_MAX_DISTANCE_PT`
   命中率會大幅提升。
4. 找到的 `caption`/`context` 套用到該組內所有子面板的 `FigureEntry`。

**Anchor 校正**：幾何群組化可能誤判（例如同一頁有兩個不同 Figure 但水平相鄰）。
建議反向驗證：先用 `CAPTION_RE` 找出該頁所有 caption 行及其 `Figure N` 編號，再以
每個 caption 的 x 範圍與群組 x 範圍是否重疊作為交叉檢查，避免把 caption 配給錯誤
的群組。

### 12.5 影像輸出：整頁 render + 裁切（已改用 pdf.js + NodeCanvasFactory）

§3.1 提到 pdf.js 的 `page.render()` 在含 `paintImageXObject` 的頁面會丟出
"Image or Canvas expected"，原規劃因此改用 poppler `pdftoppm` 整頁 render。實作時
改採 §3.1「V2 更新」所述的 `NodeCanvasFactory` 修正——直接讓 pdf.js
`page.render()` 在含內嵌影像的頁面上也能正常輸出，省去額外的 poppler 子行程：

- `renderPageToPng(page, FIGURE_RENDER_DPI)`（`FIGURE_RENDER_DPI = 150`）用
  `page.getViewport({ scale })` + `createCanvas()` + `page.render()` 產生整頁 PNG。
- 每頁僅 render 一次（`pagePngPromise` 快取），供該頁所有向量裁切與 §12.6 的
  遮蔽像素比對共用。
- 依候選 bbox 的百分比座標（`toPctBBox`）換算成整頁 PNG 的像素座標，用
  `sharp(fullPagePng).extract({ left, top, width, height }).png().toBuffer()`
  輸出，檔名為 `p<pageNumber>-vec<index>.png`（與既有
  `p<pageNumber>-img_p<x>_<y>.png` 命名區分），`FigureEntry` 新增
  `source?: 'raster' | 'vector'` 欄位輔助除錯。

### 12.6 過濾「被遮蓋」的 raster 殘留影像（pixel-diff，已改用）

原規劃僅以「後繪製、面積更大的向量群組 bbox 覆蓋率 > 0.9」判斷是否遮蓋，實作後發現
單純比較 bbox 覆蓋率容易誤判（向量群組常因 §12.3 提到的大型背景/邊框路徑而 bbox
遠大於實際可見內容）。改為兩階段判斷：

1. **候選篩選**：對每個 raster 候選 `r`，尋找是否存在 `opIndex` 更大（後繪製）、
   bbox 交集面積 / `r` 面積 > `OCCLUDED_RASTER_OVERLAP_THRESHOLD`（0.5）的其他候選
   （raster 或 vector 皆可）。沒有則直接保留 `r`，不做後續像素比對。
2. **像素比對**：若有候選遮蓋者，才呼叫 §12.5 的 `getPagePng()` 取得整頁渲染結果，
   將 `r` 自身的解碼像素（`resolveRasterImage`）resize 成與整頁渲染裁切相同尺寸，
   計算兩者逐 pixel 的平均 per-channel 差異（`computeOcclusionDiff`，0-255 範圍）。
   若平均差異 > `OCCLUDED_RASTER_DIFF_THRESHOLD`（60），代表 `r` 自身像素與「最終
   實際畫面」明顯不同，視為被完全蓋住的不可見殘留（例如 `p4-img_p3_1.png` 這類
   colormap 取樣背景），從輸出中排除。

此方式同時保留了「raster 確實仍可見、只是恰好被一個 bbox 較大的向量群組包圍」
的情況（diff 低 → 不排除），與原規劃單純看 bbox 覆蓋率相比更準確。

### 12.7 預期效果（以 `hRUVHXrNqW` 為例，已驗證）

- Figure 1（page 2）：向量群組 `p2-vec1` → caption 比對到
  「Figure 1: Learning a part of the distribution re-...」。
- Figure 2（page 4）：向量 (a)(b) 兩子圖群組化為 `p4-vec1`，比對到「Figure 2」；
  `p4-img_p3_1.png` 因 §12.6 的 pixel-diff 判定為被覆蓋的殘留，已從輸出排除。
- Figure 3（page 5）：1 個向量區域 `p5-vec1`，比對到「Figure 3」。
- Figure 4（page 6）：多子圖向量群組 `p6-vec1`，比對到「Figure 4」。
- Figure 5/6（page 7）：與預期略有不同——並未與既有 raster 合併成單一群組，而是
  各自形成獨立的向量群組 `p7-vec1`（比對到「Figure 6」）與 `p7-vec2`（比對到
  「Figure 5」）；§12.4 的群組化＋caption 比對仍正確地分辨出兩者分屬不同 Figure。
- Figure 7（page 8）：單一向量群組 `p8-vec1`（含原本的 2 張 raster 子圖，因
  §12.3 的 containment 合併規則併入同一群組），比對到「Figure 7」。
- Figure 8/9（page 9）：與 page 7 同樣形成兩個獨立向量群組
  `p9-vec1`（比對到「Figure 9」）與 `p9-vec2`（比對到「Figure 8」）。

完整結果（`figureCount = 23`，Figure 1-23 全數正確比對到 caption，詳見 §12.10）：

| Figure | 頁碼 | id | source |
| --- | --- | --- | --- |
| 1 | 2 | `p2-vec1` | vector |
| 2 | 4 | `p4-vec1` | vector |
| 3 | 5 | `p5-vec1` | vector |
| 4 | 6 | `p6-vec1` | vector |
| 5 | 7 | `p7-vec2` | vector |
| 6 | 7 | `p7-vec1` | vector |
| 7 | 8 | `p8-vec1` | vector |
| 8 | 9 | `p9-vec2` | vector |
| 9 | 9 | `p9-vec1` | vector |
| 10 | 26 | `p26-img_p25_1` | raster |
| 11 | 28 | `p28-vec1` | vector |
| 12 | 29 | `p29-vec1` | vector |
| 13 | 30 | `p30-vec1` | vector |
| 14 | 30 | `p30-vec2` | vector |
| 15 | 31 | `p31-vec1` | vector |
| 16 | 32 | `p32-vec1` | vector |
| 17 | 33 | `p33-vec1` | vector |
| 18 | 34 | `p34-vec1` | vector |
| 19 | 34 | `p34-vec2` | vector |
| 20 | 35 | `p35-vec1` | vector |
| 21 | 36 | `p36-vec1` | vector |
| 22 | 37 | `p37-img_p36_1` | raster |
| 23 | 37 | `p37-img_p36_2` | raster |

### 12.8 風險與待確認事項（已確認）

- ~~`OPS.constructPath` 在 pdf.js legacy build 的 `argsArray` 實際結構需要先用真實
  PDF dump 確認~~ → 已確認：`args[2]` 是 pdf.js 預先算好的 `[x0, y0, x1, y1]`
  （部分曲線路徑為 `[Infinity, Infinity, -Infinity, -Infinity]`），此時改用
  `args[1]`（座標陣列）自行算 min/max（`pathBBoxFromArgs`）。
- `VECTOR_FIGURE_MIN_PATHS=20`、`VECTOR_CLUSTER_PAD_PT=5pt`、
  `GROUP_X_GAP_RATIO=0.2` 以 `hRUVHXrNqW`/`jBaLIg8vMa`（同一份 PDF）調參，
  在 37 頁範圍內（含單面板、多面板、與既有 raster 混合等情境）皆得到正確結果；
  其他論文排版差異仍可能需要微調，未來若發現新 fixture 結果不佳，應優先檢視
  這三個常數。
- ~~每頁新增一次 poppler 整頁 render~~ → 改用 §12.5 的 pdf.js
  `page.render()`（`NodeCanvasFactory`），且每頁僅在「該頁確實有向量/遮蔽候選」
  時才 lazy render 一次（`pagePngPromise`），37 頁 fixture 全流程耗時約 11 秒，
  遠低於 120 秒的 `extract_figures` SLA。
- 12.4 的幾何群組化＋caption 比對屬於 heuristic，無法保證 100% 正確；`FigureEntry`
  已保留 `source` 欄位（`raster`/`vector`）輔助日後複查；37 頁 fixture 中
  23 個 Figure 的 caption 經人工比對皆正確。

### 12.9 實作順序（已完成）

1. ~~先寫一個獨立腳本（不進 pipeline）對 `hRUVHXrNqW/source.pdf` 做向量區域偵測 +
   裁切，人工檢視輸出圖片是否對應 Figure 1-9，反覆調整 12.8 提到的參數。~~ 已完成
   （`/tmp/figcheck/` 下的診斷腳本，未納入 repo）。
2. ~~參數穩定後整合進 `extractPdfFigures()`：新增向量候選偵測（12.3）、群組化與
   caption 比對（12.4）、裁切（12.5）、遮蓋過濾（12.6）。~~ 已完成。
3. ~~新增/擴充 `backend/test/pdf-figures.test.ts`，以 `jBaLIg8vMa` fixture 驗證
   Figure 1-9 皆能被抽出且 caption 正確。~~ 已完成，並一併驗證 Figure 10-23
   （`figureCount === 23`）。
4. 已將本節標題改為「（已完成）」，並更新 §2.2 / §3.1 / §9 對應項目。

### 12.10 已知限制

- **多面板向量群組的裁切留白偏大**：`p7-vec1`（Figure 6）與 `p9-vec1`（Figure 9）
  的裁切結果內容正確完整，但因聚類時納入了與整個 cluster bbox 完全相同、面積
  遠大於實際可見圖表（約 32%、24% 頁面面積）的「背景/邊框」`constructPath`
  路徑（4 個座標相同的大矩形），裁切範圍因而比視覺上的圖表本體大上不少
  （周圍留白較多）。圖表內容、caption 比對皆正確，僅影響裁切的緊湊程度，
  判定為可接受的 V2 限制。未來若要優化，可考慮在 §12.3 收集 path bbox 時，
  排除「與其他多個路徑共享完全相同 bbox、且面積超過頁面一定比例」的路徑——但
  需注意避免誤傷如 `p32-vec1`（94.4% × 54.7% 頁面面積）這類本身就很大的合法
  多面板圖表，故本輪未處理。
- §12.2 第 1 點「將同一個 Figure 的多個子面板群組化為單一條目」與實作結果略有
  差異：page 7／page 9 的兩個子圖各自輸出獨立的 `FigureEntry`（各自一張裁切
  PNG），但共用同一個 caption 比對結果（透過 §12.4 的群組化），符合
  `getFigureReferencesForPage` 的使用情境（取面積最大的 1-2 張作為參考圖）。

## 13. 前端圖表素材瀏覽 / 挑選介面（已完成）

### 13.1 目標

讓使用者在編輯每一張投影片時，可以看到該頁（或其對應的原始 PDF 頁面，document
模式下透過 split-figure-map 對應多頁）所偵測到的所有圖表素材，並可逐一
排除某張圖表，使其不再被「AI 重新生成圖片」流程當作參考圖（第 10 節）。

### 13.2 後端

- 新增 `backend/src/routes/pdfs/figures.ts`（`registerFigureRoutes`，於
  `routes/pdfs/index.ts` 註冊）：
  - `GET /api/pdfs/:id/pages/:n/figures`：回傳 `{ page_number, source_pdf_pages,
    figures: [{ id, caption, context, bbox, source, image_url, excluded }] }`。
    `source_pdf_pages` 透過 `loadSplitPageFigureMap` 解析（document 模式下一張
    投影片可能對應多個原始 PDF 頁），並用 `collectFigures` 依 id 去重彙整。
    `excluded` 來自 `loadFigureSelection(pdfId, page_uid)`。
  - `PUT /api/pdfs/:id/pages/:n/figures/selection`：body 為
    `{ excluded: string[] }`（最多 50 筆、自動去重），寫入
    `pages/<page_uid>.figure-selection.json`，回傳
    `{ page_number, excluded, updated_at }`。
  - `GET /api/pdfs/:id/figures/:figureId/image`：以 `findFigureById` 找出該
    figure 所屬的 PNG 並 `streamFile`；找不到 manifest 條目或檔案不存在皆回
    `404 FIGURE_NOT_FOUND`。
  - 找不到對應頁面（`page_number` 超出範圍）時，GET / PUT 皆回
    `404 PAGE_NOT_FOUND`。
- `backend/src/services/pdfFigures.ts` 新增：
  - `findFigureById(pdfId, figureId): FigureEntry | null` — 跨頁尋找單一 figure。
  - `FigureSelection = { excluded: string[] }` 與
    `loadFigureSelection(pdfId, pageUid)` / `saveFigureSelection(pdfId, pageUid,
    selection)` — 持久化每頁的圖表排除清單，檔案不存在或內容損毀時回傳
    `{ excluded: [] }`（不丟例外）。
  - `getFigureReferencesForPage` / `getFigureReferencesForPages` 新增第三個參數
    `excludeIds?: ReadonlySet<string>`：在 `capFiguresByArea` 之前先過濾掉被
    排除的 figure id，因此使用者排除的圖表不會出現在「AI 重新生成圖片」的參考圖
    中（第 10 節的兩處呼叫點已改為傳入
    `loadFigureSelection(pdfId, pageUid).excluded` 的 Set）。
- `backend/src/services/storage.ts` 新增 `figureSelectionPath(pdfId, pageUid)` →
  `pages/<page_uid>.figure-selection.json`，延續既有「每頁一個 JSON、以
  page_uid 命名」的慣例。

### 13.3 前端

- 新增 `frontend/src/pages/play/FigureAssetsTab.tsx`：在投影片編輯面板的分頁列
  （`PlayPageSlidePanel.tsx`）新增「📊 圖表素材」分頁（`figures`，sky 色），
  進入該分頁時呼叫 `fetchPageFigures(pdfId, pageNumber, shareToken)` 載入圖表
  清單，以縮圖網格呈現每張圖表的 `caption`/`context`、來源標籤
  （`source === 'vector'` → 「向量圖」，否則「內嵌圖片」）與一個核取方塊
  （勾選=作為圖片參考，取消勾選=排除）。切換核取方塊會立即呼叫
  `savePageFigureSelection(pdfId, pageNumber, excludedIds)`，失敗時還原 UI 並顯示
  錯誤訊息。
- `frontend/src/lib/api/pdfs.ts` 新增 `fetchPageFigures` /
  `savePageFigureSelection`；`frontend/src/types.ts` 新增 `PageFigure` /
  `PageFiguresResponse` 型別；`useScriptEditor.ts` 的 `EditTab` union 加入
  `'figures'`。
- 新增 i18n 字串 `play.figures.*`（`zh-TW.ts` / `en.ts`），涵蓋分頁標題、說明
  文字、載入/錯誤/空清單狀態、圖表來源標籤等。

### 13.4 測試

- `backend/test/pdf-figures.test.ts` 新增：
  - `findFigureById` 跨頁查找與查無結果案例。
  - `getFigureReferencesForPage` / `getFigureReferencesForPages` 在排除指定
    figure id 後才進行依面積排序與裁切的案例。
  - `loadFigureSelection` / `saveFigureSelection` 的讀寫往返與損毀檔案的
    fallback 案例。
- 新增 `backend/test/figure-assets.test.ts`：端對端驗證
  `GET /pages/:n/figures`（含 split-figure-map 彙整多頁）、
  `PUT /pages/:n/figures/selection`、`GET /figures/:figureId/image`，以及
  未知頁面/圖表的 404 行為。
- `backend/test/figure-reference-image-generation.test.ts` 新增：使用者透過
  `saveFigureSelection` 排除唯一一張圖表後，`POST /pages/:n/regenerate-image`
  不再附帶任何參考圖（`image` 維持單一頁面圖、prompt 不含圖表參考段落）。
- `npx tsc --noEmit`（backend、frontend）皆需通過；
  `npm run build`（frontend）需通過。
