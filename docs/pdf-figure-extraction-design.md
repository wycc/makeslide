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

- 純向量繪圖（沒有內嵌 raster image 的圖表，例如直接用線段/路徑畫出的圖）的偵測與輸出。
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

- 偵測純向量繪圖區域（無 raster image，但該頁有大量繪圖類 operator 集中於特定區域）。
- 前端提供圖表素材瀏覽 / 挑選介面。

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
