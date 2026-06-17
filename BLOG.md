# MakeSlide 功能說明

## Pointer 效果方向自訂

### 功能目的

動畫編輯器中的 `pointer`（指標）效果，原本只能顯示一個固定的發光圓點作為視覺引導。這個更新將其改造為可旋轉的 SVG 箭頭游標，讓使用者能明確指向投影片上的任意方向。

### 使用方式

1. 在動畫編輯器中，新增一個類型為 `pointer` 的效果。
2. 在指標位置（`X%`、`Y%`）的控制區段下方，會出現「**指標旋轉角度（°）**」輸入框。
3. 輸入旋轉角度（-180 至 180 度，步進 15 度）：
   - `0°`（預設）：箭頭指向右下方
   - `90°`：箭頭旋轉 90 度（指向右下方旋轉至右下偏下）
   - `-90°`：反方向旋轉
4. 播放時，箭頭游標會依設定角度旋轉，明確指引觀眾注意投影片特定區域。

### 技術細節

- `AnimationEffect` 型別新增 `angle?: number` 欄位（前後端同步）
- `SlideRenderer` 將 pointer 渲染從 CSS 漸層圓點改為 SVG `<path>` 箭頭，並以 CSS `transform: rotate(Xdeg)` 套用旋轉
- 後端 `EffectSchema` 以 `z.number().finite()` 驗證 angle 值，通透傳遞至儲存的 animation spec JSON
- 編輯器使用 `<input type="number" step={15}>` 讓使用者快速以 15 度為單位調整方向

## 動畫效果播放預覽跳轉

### 功能目的

在動畫編輯器中，每個效果卡片上新增 ⏮「跳至效果起點」按鈕，讓使用者可以立即將音訊播放器定位到該效果的開始時間，快速預覽效果從頭播放的視覺呈現，大幅縮短反覆調整效果位置與時間點的來回操作。

### 使用方式

1. 在動畫編輯器中，展開任一效果卡片。
2. 卡片頂端操作列新增了 **⏮** 按鈕（「跳至效果起點」）。
3. 點擊 ⏮ 後，音訊播放器的 `currentTime` 會立即跳至該效果的 `start` 秒數，讓使用者可以直接觀看效果的出現過程。
4. 原有的 **⏱**（跳至效果中點）按鈕仍保留，可用於在效果完全顯示後才開始觀察的場景。

### 技術細節

- `AnimationEditorTab.tsx` 在各效果卡片的 ⏱ 按鈕旁新增 ⏮ 按鈕，點擊時呼叫已有的 `handleSeekToTime(effectStart)` 函式
- 使用 `effectStart`（已由 `startTrigger` 解析後的實際秒數），確保 `transcript-line` 觸發器的效果也能正確定位
- 新增翻譯鍵 `play.animation.jumpToEffectStart`（中文：「跳至效果起點」；英文：「Jump to effect start」）

## Custom-Script 對話框範例提示詞

### 功能目的

自訂腳本（custom-script）動畫編輯器的聊天輸入區上方，新增了「範例提示詞」下拉選單，提供 5 種預設提示讓使用者快速開始，包括 `Manim.tex` 數學公式顯示範例。選擇後即自動填入輸入框，使用者可直接修改後送出。

### 使用方式

1. 在動畫編輯器中，新增或開啟一個 `custom-script` 效果，點擊「AI 自訂動畫」按鈕。
2. 對話框右側的聊天區上方，有一個「**範例提示詞…**」下拉選單。
3. 選擇其中一個範例：
   - **Manim.tex：顯示愛因斯坦公式 E=mc²** — 展示如何使用 `Manim.tex()` 渲染 LaTeX 公式並動畫化
   - **Manim：座標平面上的拋物線動畫** — 使用 `Manim.coordinateSystems.axes()` 建立座標系並繪製點軌跡
   - **Manim：圓形變形為正方形** — 使用 `Manim.animate.transform()` 做形狀變形
   - **Canvas：0 到 100 計數器** — 使用原生 Canvas API 顯示大型數字計數動畫
   - **SVG：箭頭延伸並標記文字** — 使用 SVG 做延伸箭頭動畫
4. 選擇後，提示詞會自動填入下方輸入框，可直接送出或修改後再送出。

### 技術細節

- `AnimationEditorTab.tsx` 新增 `CUSTOM_SCRIPT_EXAMPLE_PROMPTS` 常數陣列，儲存標籤鍵與提示詞文字
- 下拉選單使用 `<select value="">` 觸發 `onChange` 後重設回空值，下次可再次選同一項
- 後端新增測試 `findUnsafeScriptPattern allows Manim.tex call patterns without flagging them`，確認：(1) `await Manim.tex(...)` 呼叫不含 `window.parent` 不被拒絕；(2) `Manim.tex(...).then(...)` 鏈也是安全的；(3) 一般識別字 `parentEl`/`.postMessage` 不被誤判為 `window.parent` 存取

## Overlay-Image 縮放比例鎖定

### 功能目的

在動畫編輯器的 `overlay-image`（插入圖片）效果卡片中，新增 🔒/🔓 比例鎖定按鈕。啟用後，當使用者調整圖片寬度（透過數字輸入框或拖曳 resize handle）時，高度會自動依照圖片的原始長寬比計算，避免圖片被拉伸或壓扁。

### 使用方式

1. 在動畫編輯器中，新增或選擇一個 `overlay-image` 效果。
2. 在「插入圖片」下拉選單選擇圖片後，旁邊會出現圖片縮圖，以及一個 **🔓**（解鎖）按鈕。
3. 點擊 🔓 按鈕切換為 **🔒**（鎖定，紫色高亮），此時比例鎖定生效。
4. 在下方的「焦點位置與大小（%）」區段：
   - 修改 **W（寬度）** 輸入框，高度會自動依原始圖片比例更新
   - 拖曳 resize handle 調整寬度時，高度也同步計算
   - 直接修改高度不受影響（只有寬度觸發比例計算）
5. 點擊 🔒 可切回 🔓 解除鎖定，恢復自由調整。

### 技術細節

- 使用圖片縮圖的 `onLoad` 事件取得 `naturalWidth`/`naturalHeight`，計算比例後存入 `figureNaturalRatios` state
- 比例鎖定狀態存於 `lockedAspectEffectIds` (Set)，不儲存至 animation spec JSON（只在 UI 狀態中）
- 寬度變化攔截在：(1) 數字輸入框的 `onChange` handler；(2) `EffectPositionEditor` 的 `onParamsChange` callback wrapper

## 動畫效果批次套用至多頁

### 功能目的

在動畫編輯器中，新增「套用至全部頁面」按鈕，讓使用者可以將目前頁面的完整動畫設定一鍵複製到簡報的所有其他頁面。相較於既有的「複製本頁效果」（複製後需手動逐頁切換貼上），批次套用可直接對所有頁面同時生效，適合製作風格一致的動畫模板。

### 使用方式

1. 在動畫編輯器中設定好某一頁的動畫效果（例如開場 shape 效果、收場 pointer 等）。
2. 在編輯器頂部操作列找到藍色「**套用至全部頁面**」按鈕（僅在投影片有 2 頁以上時顯示）。
3. 點擊後會出現確認對話框，顯示將套用至幾頁。
4. 確認後，系統依序將目前頁面的動畫設定寫入其他所有頁面；按鈕在套用期間切換為「套用中…」並停用，完成後恢復。

> 注意：此操作會覆蓋其他頁面原有的動畫設定，建議在套用前確認當前頁面的動畫設定正確。

### 技術細節

- `AnimationEditorTab.tsx` 新增 `handleApplyToAllPages` 非同步函式，透過 `for` 迴圈逐頁呼叫 `savePageAnimation(pdfId, n, spec)`（略過當前頁）
- 從 `usePlayPageContext()` 解構 `totalPages`，控制按鈕顯示條件與確認對話框的頁數描述
- 新增 `applyingToAll` boolean state 作為 loading indicator，套用期間停用按鈕並替換文字
- 確認訊息使用翻譯鍵 `play.animation.applyToAllConfirm`，含 `{n}` 佔位符動態插入受影響的頁數

## Formula 效果 AI 自動生成品質提升

### 功能目的

`auto-focus-ai` 功能已能讓 AI 選擇 `formula` 類型並生成 LaTeX 公式，但原始提示詞對「哪些情況算公式」及「如何處理口語公式描述」說明不夠明確。本次更新優化系統提示詞，提升 AI 在正確識別並轉換公式方面的準確率，同時補充兩個整合測試確保公式自動生成的流程正確。

### 主要改善

**提示詞優化**：
- 明確說明「以文字描述的公式」也算公式（例如「E 等於 mc 的平方」→ `E = mc^2`）
- 新增負面範例：單純百分比（如「成長 35%」）、日期或簡單計數不應選 formula，應選 text-callout
- `formulaLatex` 欄位說明加入轉換指引：AI 應將口語描述轉為 LaTeX，無法轉換時回退 highlight-box

**新增整合測試**：
1. `POST auto-focus-ai returns a formula effect with formulaLatex` — 驗證 AI 回傳 `type: 'formula'` + `formulaLatex` 時，效果正確映射為 `formula` 型別並帶有 `formula` 欄位，且通過 `validateAnimationSpec`
2. `POST auto-focus-ai falls back formula without formulaLatex to highlight-box` — 驗證 AI 回傳 `type: 'formula'` 但沒有提供 `formulaLatex` 時，效果正確退回 `highlight-box`

### 技術細節

- 只修改 `animationAutoFocus.ts` 的 `buildAutoFocusSystemPrompt()` 提示詞，不影響型別定義或資料流
- 兩個新測試均使用 mock LLM client，不依賴真實 OpenAI 呼叫

## Manim.animate.transform 路徑變形（Path Morphing）

### 功能目的

原本的 `Manim.animate.transform(from, to, progress)` 只對相同類型的形狀（例如 circle→circle）做屬性線性插值（半徑、位置等），對不同類型（例如 circle→square）則只做不自然的交叉淡化。這次更新實作了真正的 SVG 路徑變形：兩個形狀都被轉換為 4 段 cubic Bézier 路徑，然後對控制點進行逐點插值，讓圓形平滑地變形為正方形。

### 使用方式

```javascript
// 在 custom-script 中使用，進度從 0 到 1
var circle = Manim.shapes.circle(svg, { x: 0, y: 0, radius: 1.5, color: Manim.colors.BLUE });
var square = Manim.shapes.square(svg, { x: 0, y: 0, size: 3, color: Manim.colors.RED });

window.renderAnimation = function(root, api) {
  // 播放時 api.onFrame 每幀呼叫，frame.t 為 0→1 進度
  api.onFrame(function(frame) {
    Manim.animate.transform(circle, square, frame.t);
  });
};
```

**支援的跨型態變形**：
- `circle` ↔ `square`
- `circle` ↔ `rectangle`

**自動退回交叉淡化**（不支援 path morphing 的組合）：
- `line`、`arrow`、`text`、`dot`、`polygon` 等仍使用原本的交叉淡化 + 屬性插值

### 技術細節

- **圓形**以 κ=0.5523 分解為 4 段 cubic Bézier（KAPPA 近似法），從正上方（top）順時鐘排列錨點（top → right → bottom → left → top）
- **矩形**以相同的 4 個 cardinal 錨點（各邊中點）+ 角落位置的控制點分解為 4 段 Bézier，使每個錨點的切線方向與對應的圓形切線方向相同（水平或垂直），插值時不產生旋轉感
- 第一次呼叫 `transform` 時，在 `from.svg` 新增共用 `<path>` 元素（`from._morphEl`）並隱藏原始 `from.el` 和 `to.el`；後續呼叫更新 `d` 屬性和顏色插值
- 不依賴任何外部函式庫（無需 flubber.js），完全以 ES5 純 JavaScript 實作，符合 sandboxed iframe 的限制

## MCP Server — Agent 整合

### 功能目的

新增 MCP（Model Context Protocol）Server，讓 Claude Code 或任何其他 MCP 相容的 AI agent 可以直接透過程式呼叫 makeslide 的 API，不需要打開瀏覽器，即可上傳 PDF、啟動簡報生成流程，並取得最終影片 URL。

### 使用方式

**Step 1：設定 MCP_AUTH_TOKEN**

在 makeslide 的 `.env` 檔中設定一個密鑰：
```
MCP_AUTH_TOKEN=your-secret-token-here
```

**Step 2：在 Claude Code 設定 MCP server**

編輯 `~/.claude/mcp_servers.json`（Claude Code 的 MCP 設定）：
```json
{
  "makeslide": {
    "command": "npx",
    "args": ["--prefix", "/path/to/makeslide/backend", "tsx", "src/mcp-server.ts"],
    "env": {
      "MAKESLIDE_URL": "http://localhost:3000",
      "MAKESLIDE_MCP_TOKEN": "your-secret-token-here"
    }
  }
}
```

**Step 3：在 Claude Code 中使用**

重啟 Claude Code 後，可以這樣要求 Claude 操作 makeslide：
- 「列出所有簡報」→ `list_presentations`
- 「上傳 /tmp/slides.pdf 並生成簡報影片」→ `upload_pdf` + `start_generation`
- 「查詢最新生成進度」→ `get_generation_status`

### 可用工具

| 工具名稱 | 說明 |
|---------|------|
| `list_presentations` | 列出所有簡報（ID、標題、狀態） |
| `get_presentation` | 取得指定簡報的詳細資訊與影片 URL |
| `upload_pdf` | 從本機路徑上傳 PDF |
| `start_generation` | 啟動 AI 生成流程（可選指定 stages） |
| `get_generation_status` | 查詢最新任務狀態與各階段進度 |

### 技術細節

- MCP 傳輸：stdio over newline-delimited JSON（JSON-RPC 2.0），相容 Claude Code 和 Claude Desktop
- 認證：後端新增 `MCP_AUTH_TOKEN` 設定；server.ts 在 OAuth auth hook 中新增 Bearer token 驗證分支
- 啟動方式：`npm --prefix backend run mcp-server`（開發用）或 `node backend/dist/mcp-server.js`（生產用）
- 不依賴 `@modelcontextprotocol/sdk`，以純 TypeScript 手動實作 JSON-RPC 協議

## MCP Server 腳本讀寫工具（2026-06-17）

### 功能目的

原有 MCP server 的 5 個工具只能管理簡報整體（上傳、啟動生成、查詢狀態），無法讀取或修改個別頁面的 AI 腳本。本次新增 `get_page_script` 和 `set_page_script` 兩個工具，讓 agent（如 Claude Code）可在啟動 AI 生成前先自訂各頁的逐字稿文案，再只重新生成語音部分，省去重跑 LLM 腳本生成的時間與費用。

### 新增的 REST API

`PUT /api/pdfs/:id/pages/:page/script`
- 接受 `{ script: string }` body（最長 4096 字元）
- 將腳本寫入對應的 `.script.txt` 檔案；若該頁尚無 `script_path` 記錄，會從 `page_uid` 自動派生路徑並存入 DB
- 回傳 `{ id, page_number, script }`

搭配既有的 `GET /api/pdfs/:id/pages/:page/script`，完整支援腳本的讀取與覆寫。

### 新增的 MCP 工具

| 工具名 | 說明 |
|--------|------|
| `get_page_script` | 讀取指定頁的逐字稿腳本，回傳純文字內容 |
| `set_page_script` | 覆寫指定頁的腳本（最長 4096 字元），成功後回傳確認訊息 |

### 典型使用流程

```
1. list_presentations          → 取得簡報 ID
2. get_presentation            → 確認頁數與各頁狀態
3. get_page_script id=X page=1 → 讀取第 1 頁現有腳本
4. set_page_script id=X page=1 script="..." → 自訂第 1 頁文案
5. start_generation id=X stages=["audio"]  → 只重新合成語音
6. get_generation_status id=X              → 輪詢進度
```

### 技術細節

- `detail.ts` 新增 `PUT /api/pdfs/:id/pages/:n/script` route，與 GET route 相鄰
- `mcp-server.ts` 新增 `apiGetText()`（回傳純文字）和 `apiPut()`（PUT JSON）兩個輔助函式
- 兩個新工具的 handler 驗證 `id`、`page`（正整數）與 `script` 長度後呼叫對應 API

## Formula 效果字型大小控制（2026-06-17）

### 功能目的

`formula` 效果使用 KaTeX 在投影片上顯示數學公式，但原本固定以約 1×em 的大小渲染，不同大小的投影片或不同複雜度的公式看起來可能太小或太大。本次新增 `formulaFontSize` 欄位，讓使用者可在動畫編輯器中即時調整公式的顯示大小。

### 使用方式

在動畫編輯器中，選擇一個 `formula` 效果後：
1. 在「公式內容（LaTeX）」欄位下方，新增了「字型大小（em）」輸入框
2. 預設值為 **1.5em**，可調整範圍為 **0.5 ~ 4em**，步進 0.1
3. 編輯器中的公式預覽會即時反映字型大小的變化
4. 儲存後，投影片播放時公式會以指定大小顯示

### 技術細節

- `pageAnimation.ts`：新增 `DEFAULT_FORMULA_FONT_SIZE_EM = 1.5`、`MIN_FORMULA_FONT_SIZE_EM = 0.5`、`MAX_FORMULA_FONT_SIZE_EM = 4` 三個常數；`AnimationEffect` interface 新增 `formulaFontSize?: number` 欄位；`EffectSchema`（Zod）新增 `formulaFontSize: z.number().min(0.5).max(4).optional()`；`validateAnimationSpec` 序列化時納入此欄位
- `types.ts`（前端）：同步新增 `formulaFontSize?: number` 欄位
- `SlideRenderer.tsx`：formula 容器 div 加入 `fontSize: \`${formulaFontSize ?? 1.5}em\`` 樣式
- `AnimationEditorTab.tsx`：在 LaTeX input 下方加入 `<input type="number" min=0.5 max=4 step=0.1>`；預覽 div 也套用 `fontSize` 樣式
- i18n：中英文 locale 各新增一個翻譯鍵 `play.animation.formulaFontSize`

## Step-List 效果顏色自訂（2026-06-17）

### 功能目的

`step-list` 效果原本固定使用深色半透明背景（`#0f172a` 約 85% 不透明度）與淺色文字，無法搭配不同風格的投影片。本次新增 `stepListBgColor` 和 `stepListTextColor` 兩個欄位，讓使用者可在動畫編輯器中用顏色選擇器自訂背景色與文字色。

### 使用方式

在動畫編輯器中，選擇一個 `step-list` 效果後，條列項目輸入框下方新增了兩個顏色選擇器：
- **背景顏色**：預設 `#1e293b`（深藍灰），可改為任何 CSS hex 色碼
- **文字顏色**：預設 `#f1f5f9`（亮白），可搭配背景自訂對比色

顏色選擇器為 `<input type="color">`，支援所有現代瀏覽器的原生顏色選色盤。

### 技術細節

- `pageAnimation.ts`：新增 `DEFAULT_STEP_LIST_BG_COLOR = '#1e293b'` 與 `DEFAULT_STEP_LIST_TEXT_COLOR = '#f1f5f9'` 常數；`AnimationEffect` interface 新增兩個 optional 欄位；`EffectSchema` 重用 hex color regex（`/^#[0-9a-fA-F]{3,8}$/`，最長 20 字元）驗證；`validateAnimationSpec` 序列化時一併輸出
- `types.ts`（前端）：同步新增兩個欄位
- `SlideRenderer.tsx`：step-list 容器 div 改用 `effect.stepListBgColor ?? '#1e293b'` 和 `effect.stepListTextColor ?? '#f1f5f9'` 作為 CSS 樣式
- `AnimationEditorTab.tsx`：items textarea 後面加入兩個並排的 `<input type="color">` 選色器
- i18n：中英文 locale 各新增 `play.animation.stepListBgColor` 和 `play.animation.stepListTextColor` 翻譯鍵

## Manim Polygon 路徑變形（2026-06-17）

### 功能目的

`Manim.animate.transform` 原本只能對 `circle`、`square`、`rectangle` 進行平滑路徑變形（SVG cubic Bézier 插值），`polygon` 形狀（三角形、菱形、五邊形等）遇到跨類型 transform 時只能退回到交叉淡化（cross-fade）效果，視覺上較不連貫。本次讓 polygon 也能和 circle/rect 做到逐格插值路徑的平滑 morphing。

### 技術原理

`polygonMorphSegs(el)` 函式將 SVG `<polygon>` 分解為 4 段 cubic Bézier：
1. 找出多邊形的 4 個 **cardinal 最遠點**：topmost（min SVG-y）、rightmost（max x）、bottommost（max SVG-y）、leftmost（min x）
2. 以 4 個極值點為錨點，產生 4 段 Bézier `top→right→bottom→left→top`
3. 控制點使用 **axis-aligned 切線**，水平方向控制量 `kh = KAPPA × (right.x − left.x) / 2`，垂直方向 `kv = KAPPA × (bottom.y − top.y) / 2`，與 `circleMorphSegs` 和 `rectMorphSegs` 的切線慣例一致，使三種形狀之間的 morphing 都能銜接流暢

這樣，一個正三角形 morphing 成圓形時，三角形會先「膨脹」成橢圓形狀再圓化，而不是直接淡出又淡入。

### 注意事項：template literal 中的正規表示式逸出

在 TypeScript template literal（`` ` `` ）中，`\s` 是無效的逸出序列，會被 JS 引擎靜默忽略反斜線，導致字串中出現字面字元 `s`。因此 `parsePolygonPoints` 解析 `points` 屬性時，正則必須寫成 `/[\\s,]+/`（兩個反斜線）才能讓產生的 JS 字串含有 `/[\s,]+/` 並正確匹配空白字元。

### 測試覆蓋

新增 3 個測試至 `manimHelperScript.test.ts`：
- `polygon→circle`：三角形變形成圓形，確認 `el.style.display = 'none'`、morphEl 已建立、路徑在 t=0 與 t=1 不同
- `polygon→polygon`：三角形變形成五邊形（同類型），確認同樣走路徑插值而非交叉淡化
- `polygon→rect`：菱形（diamond）變形成矩形，確認路徑封閉且兩端不同

全部 18 項測試通過。

## Highlight-Box 效果邊框顏色自訂（2026-06-17）

### 功能目的

`highlight-box` 效果原本固定使用紅色邊框（`#ef4444`），無法搭配不同風格的投影片（例如藍色主題、公司品牌色）。本次新增 `highlightColor` 欄位，讓使用者可在動畫編輯器中自訂邊框顏色。

### 使用方式

在動畫編輯器中，選擇一個 `highlight-box` 效果後，位置/大小欄位旁邊新增了「邊框顏色」顏色選擇器。點擊即可選擇任何顏色；預設值為紅色（`#ef4444`）。顏色選定後，醒目方框的邊框與外發光（box-shadow）都會更新為對應顏色。

### 技術細節

- `pageAnimation.ts`：新增 `DEFAULT_HIGHLIGHT_BOX_COLOR = '#ef4444'` 常數；`AnimationEffect` interface 新增 `highlightColor?: string` 欄位；`EffectSchema` 重用現有 hex color regex（`/^#[0-9a-fA-F]{3,8}$/`，最長 20 字元）；`validateAnimationSpec` 序列化時一併輸出
- `types.ts`（前端）：同步新增 `highlightColor?: string` 欄位
- `SlideRenderer.tsx`：`highlight-box` 渲染改用 `effect.highlightColor ?? '#ef4444'`；box-shadow 也使用相同顏色（附加 `b3` 後綴 = ~70% 不透明度的 hex alpha）
- `AnimationEditorTab.tsx`：`effect.type === 'highlight-box'` 條件下新增 `<input type="color">` 選色器
- i18n：中英文 locale 各新增 `play.animation.highlightColor` 翻譯鍵

## Text-Callout 效果顏色自訂（2026-06-17）

### 功能目的

`text-callout` 效果原本固定使用深色背景（`#0f172a`）和白色文字（`#f8fafc`），若投影片是淺色主題或品牌色系，文字框的顏色就會顯得格格不入。本次新增 `textCalloutBgColor` 和 `textCalloutTextColor` 欄位，讓使用者可自由搭配。

### 使用方式

在動畫編輯器中，選擇一個 `text-callout` 效果後，文字內容輸入框下方新增了兩個顏色選擇器：
- **背景顏色**：預設 `#0f172a`（深藍黑），適合在深色投影片上使用
- **文字顏色**：預設 `#f8fafc`（接近白色），對比鮮明

兩個顏色選擇器並排顯示，支援瀏覽器原生顏色盤，選完後立即在投影片上預覽。

### 技術細節

- `pageAnimation.ts`：新增兩個預設色常數；`AnimationEffect` interface 新增兩個 optional 欄位；`EffectSchema` 重用既有 hex color regex；序列化時一併輸出
- `types.ts`（前端）：同步新增兩個欄位
- `SlideRenderer.tsx`：text-callout 容器改用 `effect.textCalloutBgColor ?? '#0f172a'` 和 `effect.textCalloutTextColor ?? '#f8fafc'` 作為 inline style
- `AnimationEditorTab.tsx`：text-callout 分支改包 `<>...</>` 並加入兩個 `<input type="color">` 選色器
- i18n：中英文 locale 各新增 `play.animation.textCalloutBgColor` 和 `play.animation.textCalloutTextColor`

## Spotlight 效果遮罩顏色與透明度自訂（2026-06-17）

### 功能目的

`spotlight` 效果原本固定使用黑色遮罩（`rgba(0,0,0,0.6)`）來暗化聚光燈以外的區域，無法搭配不同風格的投影片（例如淺色背景需要較淡的遮罩，或品牌色系需要有色遮罩）。本次新增 `spotlightColor` 和 `spotlightOpacity` 兩個欄位，讓使用者可自由調整。

### 使用方式

在動畫編輯器中，選擇一個 `spotlight` 效果後，位置/大小欄位旁邊新增了：
- **遮罩顏色**：顏色選擇器，預設黑色（`#000000`）
- **透明度**：數字輸入框，範圍 0–1，步進 0.05，預設 0.6（代表遮罩蓋住 60% 光線）

兩個控制項並排顯示。調整後立即在投影片上預覽遮罩效果。

### 技術細節

- `pageAnimation.ts`：新增 `DEFAULT_SPOTLIGHT_COLOR = '#000000'` 和 `DEFAULT_SPOTLIGHT_OPACITY = 0.6` 常數；`AnimationEffect` 新增 `spotlightColor?: string` 和 `spotlightOpacity?: number`；`EffectSchema` 分別用 hex color regex 和 `z.number().min(0).max(1)` 驗證；序列化時輸出
- `types.ts`（前端）：同步新增兩個欄位
- `SlideRenderer.tsx`：spotlight 渲染從 `spotlightColor` 解析 r/g/b channel（`parseInt(hex.slice(1,3), 16)` 等），組合成 `rgba(r, g, b, opacity)` 字串套用至 box-shadow
- `AnimationEditorTab.tsx`：spotlight 分支新增 `<input type="color">` 和 `<input type="number" min=0 max=1 step=0.05>`，並排在 `flex gap-2 items-end` 容器中
- i18n：中英文 locale 各新增 `play.animation.spotlightColor` 和 `play.animation.spotlightOpacity`

## Manim `indicateAround` 強調動畫（2026-06-17）

### 功能目的

Manim 的 `Indicate` 動畫是最具識別性的效果之一：讓一個圖形瞬間放大並閃爍對比色，然後縮回原本大小，讓觀眾的注意力一眼集中到該物件上。本次在 `window.Manim.animate` 中新增 `indicateAround(m, progress, opts)` 實現這個動畫。

### 使用方式

```javascript
// 在 custom-script 效果中使用：
function onFrame(progress, duration) {
  Manim.animate.indicateAround(myCircle, progress, { scale: 1.4, color: '#f59e0b' });
}
```

**opts 參數**（皆為選填）：
- `scale`：放大倍率，預設 `1.3`（放大 30%）
- `color`：閃爍顏色，預設 `'#f59e0b'`（琥珀橘）

動畫節奏：
- progress 0→0.5：物件縮放至 `scale` 倍，stroke/fill 漸變為 flash color
- progress 0.5→1：縮放縮回 1，顏色漸回原本顏色
- progress=1：完全還原 transform 和顏色，清除暫存狀態

### 技術細節

- 使用對稱 `phase` 計算（0→0.5 時 `phase=p*2`，0.5→1 時 `phase=1-(p-0.5)*2`），對 phase 套用 `smooth()` 做 eased 插值
- `transform="scale(s)"` 直接覆寫 transform attribute（不考慮與其他 transform 組合）
- 用 `m._indicateOrigStroke` / `m._indicateOrigFill` 在首次呼叫時保存原始顏色，progress=1 時恢復並刪除
- 新增 2 個 vm 測試確認峰值縮放正確、progress=1 完全復原

## AI 自動聚焦 Pointer 箭頭角度建議（2026-06-17）

### 功能目的

`pointer` 效果會在投影片上顯示一支從畫面外側射入的指示箭頭，引導觀眾目光到 AI 認為重要的位置。過去所有 AI 建議的 pointer 效果都使用預設方向（從左上角向右下刺入，angle=0），不論目標在畫面的哪個位置，這常導致箭頭從奇怪的角度指向目標，甚至和其他效果重疊。

本次讓 AI 在建議 `pointer` 效果時，同時選擇最合適的進入角度。

### 角度說明

`angle` 欄位是箭頭「從畫面外側切入的方向」，以整數度數表示（0-359）：

| angle 值 | 箭頭進入方向 | 適用情境 |
|----------|------------|---------|
| 0        | 從左上向右下 | 目標在畫面左上角 |
| 90       | 從右上向左下 | 目標在畫面右半部 |
| 180      | 從左下向右上 | 目標在畫面左下角 |
| 270      | 從右下向左上 | 目標在畫面左半部 |

AI 會根據目標點（xPct, yPct）的畫面位置自動選擇讓箭頭「從外側指入」的最佳角度——例如目標在右半部通常選 90（箭頭從右側進入），目標在左半部通常選 270（箭頭從左側進入）。

### 技術細節

- `AutoFocusItemSchema` 新增 `angle: z.number().int().min(0).max(359).optional()`
- system prompt 第 3 點補充 angle 說明及 4 個方向示例
- `mapAutoFocusResponseToEffects` 在 `type === 'pointer'` 時將 `item.angle` 傳遞至 `effect.angle`
- `page-animation.test.ts` 新增 2 個單元測試：有 angle 時正確傳遞並通過 schema 驗證；無 angle 時 effect.angle 保持 undefined

## Pointer 箭頭顏色自訂（2026-06-17）

### 功能目的

`pointer` 效果的指示箭頭原本固定使用玫瑰紅色（`#f43f5e`），在某些投影片配色下（如深色系、科技感藍色等）與背景對比不足，或與整體設計風格不搭。本次新增 `pointerColor` 欄位，讓使用者可以選擇任意顏色讓箭頭融入投影片主題。

### 使用方式

在動畫編輯器的 `pointer` 效果設定中，角度輸入框下方會出現「箭頭顏色」色彩選擇器，點擊即可選色。選擇的顏色會同時套用到 SVG 箭頭的 fill 和光暈（drop-shadow）效果，讓整體視覺一致。

預設仍為玫瑰紅 `#f43f5e`，若未設定則行為與先前相同。

### 技術細節

- `AnimationEffect`（後端）和 `SlideAnimationEffect`（前端）新增 `pointerColor?: string`
- `EffectSchema` 使用現有 hex color regex（`^#[0-9a-fA-F]{3,8}$`）驗證
- `SlideRenderer.tsx` 從 hex 字串解析 r/g/b channel，生成 `rgba(r,g,b,0.95)` 用於 SVG fill、`rgba(r,g,b,0.9)` 用於 drop-shadow filter
- 後端新增 `DEFAULT_POINTER_COLOR = '#f43f5e'` 常數

## Pointer 箭頭大小自訂（2026-06-17）

### 功能目的

`pointer` 效果的箭頭原本固定為 2.5rem × 2.5rem，在高解析度、全螢幕或小尺寸投影片中，箭頭可能顯得太大或太小，影響視覺比例。本次新增 `pointerSize` 欄位，讓使用者可彈性調整箭頭大小。

### 使用方式

在動畫編輯器的 `pointer` 效果設定中，顏色選擇器下方新增「**箭頭大小（rem）**」數字輸入框，範圍 1-6rem，步進 0.5。

- 預設 `2.5rem`（不填時行為不變）
- 較大值（如 4rem）在 4K 大型投影片或需要強調時更清晰
- 較小值（如 1.5rem）適合精細標示、不遮擋文字

### 技術細節

- `AnimationEffect` 和 `SlideAnimationEffect` 新增 `pointerSize?: number`
- `validateAnimationSpec` 以 `Math.max(MIN, Math.min(MAX, value))` 夾至合法範圍（1-6）
- `SlideRenderer.tsx` 用 `${pointerSize}rem` 設定 pointer div 的 width/height
- 後端新增 `DEFAULT_POINTER_SIZE_REM = 2.5`、`MIN_POINTER_SIZE_REM = 1`、`MAX_POINTER_SIZE_REM = 6` 常數

## Text-Callout 字型大小自訂（2026-06-17）

### 功能目的

`text-callout` 效果用於在投影片上疊加標注文字（如關鍵數字、結論摘要）。原本字型大小固定為 1.25rem，對於較長的文字可能顯得太大（造成 overflow）；對於需要強調的短文字則可能太小。本次新增 `textCalloutFontSize` 欄位，讓使用者彈性調整字型大小。

### 使用方式

在動畫編輯器的 `text-callout` 效果設定中，顏色選擇器（背景色、文字色）下方新增「**字型大小（rem）**」數字輸入框，範圍 0.5-3rem，步進 0.125。

- 預設 `1.25rem`（與先前行為相同）
- 較小值（如 0.75rem）適合在有限空間內顯示較長文字
- 較大值（如 2rem）適合強調短標題或單一關鍵數字

### 技術細節

- `AnimationEffect`（後端）和 `SlideAnimationEffect`（前端）新增 `textCalloutFontSize?: number`
- `validateAnimationSpec` 以 Math.max/min 夾至 [0.5, 3] 範圍
- `SlideRenderer.tsx` 以 `` `${textCalloutFontSize ?? 1.25}rem` `` 字串作為 `fontSize` CSS 屬性
- 後端新增 `DEFAULT_TEXT_CALLOUT_FONT_SIZE_REM = 1.25`、`MIN_TEXT_CALLOUT_FONT_SIZE_REM = 0.5`、`MAX_TEXT_CALLOUT_FONT_SIZE_REM = 3` 常數

## Shape 效果填充顏色（2026-06-17）

### 功能目的

`shape` 效果（圓形、矩形、橢圓）原本只能繪製空心輪廓（`fill="none"`），若需要實心標記（如圓點高亮、色塊背景）必須改用 `custom-script`。本次新增 `shapeFillColor` 選項，讓使用者直接在 shape 效果中啟用填充。

### 使用方式

在動畫編輯器的 `shape` 效果設定中，描邊顏色與線寬下方新增「**填充顏色**」核取方塊：

- 未勾選（預設）：圖形空心，行為與先前相同
- 勾選後：顯示填充顏色選擇器，可選任意 hex 顏色；初始值預設與描邊顏色相同

> 注意：`arrow`（箭頭）形狀為線段，填充顏色對其無效，不會顯示在渲染中。

### 技術細節

- `AnimationEffect`（後端）和 `SlideAnimationEffect`（前端）新增 `shapeFillColor?: string`
- `EffectSchema` 使用現有 hex color regex 驗證
- `SlideRenderer.tsx` 以 `effect.shapeFillColor ?? 'none'` 作為 SVG fill 屬性值
- AnimationEditorTab 使用「checkbox 勾選 + 條件顯示 color input」的 UI 模式，避免強迫使用者看顏色選擇器

## Manim `animate.flash` 閃爍效果（2026-06-17）

### 功能目的

`indicateAround` 強調動畫同時縮放 + 改色，視覺上比較「大動作」。有時只需要讓一個元素快速閃白光（類似閃光燈），不需要縮放，例如強調數值的瞬間變化、步驟完成的確認效果等。`Manim.animate.flash` 提供了這個更輕量的選項。

### 使用方式

```javascript
// 在 custom-script 效果中使用：
function onFrame(progress, duration) {
  Manim.animate.flash(myRect, progress, { color: '#ffff00', maxOpacity: 1 });
}
```

**opts 參數**（皆為選填）：
- `color`：閃光顏色，預設 `'#ffffff'`（白色）
- `maxOpacity`：閃光峰值時的 opacity，預設 `1`（完全不透明）

動畫節奏：
- progress 0→0.5：fill/stroke 漸變為 `color`，opacity 漸升至 `maxOpacity`
- progress 0.5→1：fill/stroke 漸回原色，opacity 漸回原始值
- progress=1：完全還原所有屬性，清除暫存狀態

### 技術細節

- `m._flashOrigStroke` / `m._flashOrigFill` / `m._flashOrigOpacity` 在首次呼叫時儲存原始值，progress=1 時刪除
- 與 `indicateAround` 使用相同的對稱 `phase` 模式，但不修改 `transform`（無縮放）
- 新增 2 個 vm 測試確認：(1) 自訂顏色+opacity 時中間閃爍、結尾完全還原；(2) 預設白色從 RED 偏移後還原

## Step-List 字型大小自訂（2026-06-18）

### 功能目的

`step-list` 效果（條列清單）的文字大小原本固定為 1.1rem。當項目數量較多時，較小的字型可以讓所有項目都在可視區域內；當項目較少或要強調時，較大字型效果更好。本次新增 `stepListFontSize` 欄位。

### 使用方式

在動畫編輯器的 `step-list` 效果設定中，顏色選擇器下方新增「**字型大小（rem）**」數字輸入框，範圍 0.5-2.5rem，步進 0.1。

- 預設 `1.1rem`（行為與先前相同）
- 較小值（如 0.8rem）適合 5-6 個項目的密集清單
- 較大值（如 1.5rem）適合 2-3 個重點項目

### 技術細節

- `AnimationEffect` 和 `SlideAnimationEffect` 新增 `stepListFontSize?: number`
- `validateAnimationSpec` 以 Math.max/min 夾至 [0.5, 2.5]
- `SlideRenderer.tsx` 以 `` `${stepListFontSize ?? 1.1}rem` `` 作為 `<ul>` 的 fontSize
- 後端新增 `DEFAULT_STEP_LIST_FONT_SIZE_REM = 1.1`、`MIN/MAX` 常數

## Highlight-Box 邊框寬度自訂（2026-06-18）

### 功能目的

`highlight-box` 效果的邊框粗細原本固定為 4px。在小型投影片或次要內容的提示時，4px 可能顯得過粗；在主要重點或大型投影片上，希望邊框更明顯時又太細。本次新增 `highlightBorderWidth` 欄位，讓使用者可自由調整邊框粗細。

### 使用方式

在動畫編輯器的 `highlight-box` 效果設定中，顏色選擇器旁新增「**邊框寬度（px）**」數字輸入框，範圍 1-12px，步進 1。

- 預設 4px（行為與先前相同）
- 光暈（box-shadow）的模糊半徑會隨邊框寬度等比縮放（`bw × 4 px`）

### 技術細節

- `AnimationEffect` 和 `SlideAnimationEffect` 新增 `highlightBorderWidth?: number`
- `EffectSchema` 以 `z.number().int().min(1).max(12)` 驗證
- `SlideRenderer.tsx` border 與 box-shadow 均依 `highlightBorderWidth ?? 4` 動態計算
- 後端新增 `DEFAULT_HIGHLIGHT_BORDER_WIDTH = 4`、`MAX_HIGHLIGHT_BORDER_WIDTH = 12` 常數

## highlight-box 圓角半徑控制（highlightBorderRadius）

`highlight-box` 效果現在支援自訂邊框圓角半徑。使用者可以在動畫編輯器中設定 `highlightBorderRadius`（px 整數，預設 `8`，範圍 0-50），讓高亮框在尖角矩形到圓潤圓角之間自由調整，配合投影片視覺風格。

**使用方式：**
在動畫編輯器的 `highlight-box` 效果設定中，調整「圓角半徑（px）」數字輸入框（步進 2px）。

**技術說明：**
- `AnimationEffect` 和 `SlideAnimationEffect` 新增 `highlightBorderRadius?: number`
- `EffectSchema` 以 `z.number().int().min(0).max(50)` 驗證
- `SlideRenderer.tsx` 以 `effect.highlightBorderRadius ?? 8` 作為 `borderRadius` 值
- 後端新增 `DEFAULT_HIGHLIGHT_BORDER_RADIUS = 8`、`MAX_HIGHLIGHT_BORDER_RADIUS = 50` 常數

## Manim animate.uncreate 路徑消除效果

`window.Manim.animate.uncreate(m, progress)` 現在可以讓 SVG 路徑從頭到尾逐漸消失，是 `animate.create` 的對稱反向效果。

**使用方式：**
```javascript
// 自訂腳本範例
const circ = Manim.shapes.circle(svg, { x: 0, y: 0, radius: 1.5, color: Manim.colors.BLUE });
// create 繪製 → uncreate 消除
Manim.animate.create(circ, t);       // 0→1: 從尾到頭繪製
Manim.animate.uncreate(circ, t);     // 0→1: 從頭到尾消除
```

**技術說明：**
- text/dot/arrow/axes/numberPlane：opacity 從 1 線性降至 0
- 路徑/形狀：`strokeDashoffset` 從 0 增加至路徑總長度，fill-opacity 同步遞減，progress=1 時將 opacity 設為 0
- 新增 2 個 vm 測試（共 24 項全通過）

## shape 效果基礎透明度控制（shapeOpacity）

`shape` 效果現在支援自訂基礎透明度。使用者可以在動畫編輯器中設定 `shapeOpacity`（0-1 浮點數，預設 `1`，步進 0.05），讓圓形/橢圓/矩形/箭頭等 SVG 形狀以半透明方式疊加在投影片上，製造出玻璃質感或柔和提示效果，且透明度獨立於 GSAP 淡入淡出動畫之外。

**使用方式：**
在動畫編輯器的 `shape` 效果設定中，調整「透明度（0-1）」數字輸入框（步進 0.05）。

**技術說明：**
- `AnimationEffect` 和 `SlideAnimationEffect` 新增 `shapeOpacity?: number`
- `EffectSchema` 以 `z.number().min(0).max(1)` 驗證
- `SlideRenderer.tsx` 將 `effect.shapeOpacity ?? 1` 套用至 SVG 的 `opacity` style
- 此透明度疊加在 GSAP 的淡入淡出動畫效果之上（不衝突）

## formula 效果背景色與文字色自訂（formulaBgColor / formulaTextColor）

`formula` 效果（KaTeX 數學公式）現在支援自訂背景色和文字色。使用者可以在動畫編輯器中透過顏色選擇器調整公式方塊的背景顏色（預設深藍 `#0f172a`）和文字顏色（預設近白 `#f8fafc`），配合投影片的整體配色。

**使用方式：**
在動畫編輯器的 `formula` 效果設定中，字型大小輸入框下方有「背景顏色」和「文字顏色」兩個顏色選擇器。

**技術說明：**
- `AnimationEffect` 和 `SlideAnimationEffect` 新增 `formulaBgColor?: string` 和 `formulaTextColor?: string`
- `EffectSchema` 重用現有 hex color regex 驗證（`^#[0-9a-fA-F]{3,8}$`）
- `SlideRenderer.tsx` 以動態值取代硬編碼的 `rgba(15, 23, 42, 0.85)`/`#f8fafc`

## Manim animate.wiggle 抖動效果

`window.Manim.animate.wiggle(m, progress, opts)` 讓 SVG 元素左右小幅搖擺，用來吸引觀眾注意特定內容。

**使用方式：**
```javascript
const circ = Manim.shapes.circle(svg, { x: 0, y: 0, radius: 1.5, color: Manim.colors.YELLOW });
Manim.animate.wiggle(circ, t, { amplitude: 12, frequency: 4 });
// t: 0→1, amplitude: 位移像素(預設8), frequency: 振盪次數(預設3)
```

**技術說明：**
- 以 `sin(progress * frequency * 2π) * amplitude * (1 - progress)` 計算 translateX
- 振幅因子 `(1 - progress)` 讓動畫在結尾自然衰減至靜止
- progress=1 時清除 transform 屬性，確保無殘留偏移
- 新增 2 個 vm 測試（共 26 項全通過）

## text-callout 圓角半徑控制（textCalloutBorderRadius）

`text-callout` 效果現在支援自訂邊框圓角半徑。使用者可以在動畫編輯器中設定 `textCalloutBorderRadius`（px 整數，預設 `8`，範圍 0-32，步進 2px），讓文字說明框在尖角到圓潤之間調整，配合投影片的視覺設計語言。

**使用方式：**
在動畫編輯器的 `text-callout` 效果設定中，字型大小輸入框下方有「圓角半徑（px）」數字輸入框（步進 2px）。

**技術說明：**
- `AnimationEffect` 和 `SlideAnimationEffect` 新增 `textCalloutBorderRadius?: number`
- `EffectSchema` 以 `z.number().int().min(0).max(32)` 驗證
- `SlideRenderer.tsx` 以 `${effect.textCalloutBorderRadius ?? 8}px` 取代硬編碼 `'8px'`
- 後端新增 `DEFAULT_TEXT_CALLOUT_BORDER_RADIUS = 8`、`MAX_TEXT_CALLOUT_BORDER_RADIUS = 32` 常數

## Manim animate.spinAround 完整旋轉效果

`window.Manim.animate.spinAround(m, progress, opts)` 讓 SVG 元素完整自轉一圈或多圈，比 `rotate` 更適合展示旋轉動態或強調元素的圓形對稱性。

**使用方式：**
```javascript
const star = Manim.shapes.circle(svg, { x: 0, y: 0, radius: 1.5, color: Manim.colors.YELLOW });
// 旋轉 2 圈
Manim.animate.spinAround(star, t, { turns: 2 });
// 以自訂中心旋轉
Manim.animate.spinAround(star, t, { turns: 1, cx: 2, cy: 1 });
```

**技術說明：**
- opts 支援 `turns`（圈數，預設 `1`）和 `cx`/`cy`（旋轉中心，預設使用 `getBBox()` 計算包圍框中心）
- 以 `progress * turns * 360` 計算累積角度，映射至 SVG `rotate(angle cx cy)` transform
- progress=1 時清除 transform 屬性，確保無殘留旋轉
- 新增 2 個 vm 測試（共 28 項全通過）

## formula 效果圓角半徑控制（formulaBorderRadius）

`formula` 效果（KaTeX 公式）現在支援自訂邊框圓角半徑。使用者可以在動畫編輯器中設定 `formulaBorderRadius`（px 整數，預設 `8`，範圍 0-32，步進 2px），讓公式框在尖角到圓潤之間調整，配合投影片的視覺設計語言。

**技術說明：**
- `AnimationEffect` 和 `SlideAnimationEffect` 新增 `formulaBorderRadius?: number`
- `EffectSchema` 以 `z.number().int().min(0).max(32)` 驗證
- `SlideRenderer.tsx` 以 `${effect.formulaBorderRadius ?? 8}px` 取代硬編碼 `'8px'`
- 後端新增 `DEFAULT_FORMULA_BORDER_RADIUS = 8`、`MAX_FORMULA_BORDER_RADIUS = 32` 常數

## Manim animate.bounce 彈跳效果

`window.Manim.animate.bounce(m, progress, opts)` 讓 SVG 元素向上彈跳再回到原位，模擬拋物線物理運動，使元素在靜止前多次彈跳以吸引注意。

**使用方式：**
```javascript
const circ = Manim.shapes.circle(svg, { x: 0, y: 0, radius: 1.5, color: Manim.colors.ORANGE });
// 彈跳 3 次，最高 50 SVG 單位
Manim.animate.bounce(circ, t, { height: 50, bounces: 3 });
```

**技術說明：**
- opts 支援 `height`（最高點 SVG 單位，預設 `30`）和 `bounces`（彈跳次數，預設 `2`）
- 以 `|sin(phase * π)|` 產生拋物線弧度，`height * (1 - p * 0.5)` 讓高度隨進度自然衰減
- progress=1 時清除 transform，確保元素回到原位
- 新增 2 個 vm 測試（共 30 項全通過）

## highlight-box 雙色邊框（highlightOuterColor）

`highlight-box` 效果現在支援選配外框顏色，讓高亮框在任何投影片背景上都清晰可見。勾選「外框顏色」後，可在主邊框外圍加上一圈 2px 的對比色環（預設白色），形成雙色輪廓效果。

**使用方式：**
在動畫編輯器的 `highlight-box` 效果設定中，勾選「外框顏色」核取方塊並選擇顏色即可啟用；取消勾選則移除外框。

**技術說明：**
- `AnimationEffect` 和 `SlideAnimationEffect` 新增 `highlightOuterColor?: string`（選填，未設定時不顯示外框）
- `SlideRenderer.tsx` 以 `0 0 0 2px ${hOuter}, 0 0 ${hBw*4}px ${hColor}b3` 雙層 box-shadow 實現雙色邊框
- `AnimationEditorTab.tsx` 以 checkbox 控制開/關，checkbox 啟用後顯示顏色選擇器

## pointer 效果形狀選項（pointerShape）

`pointer` 效果現在除了預設的箭頭（cursor）之外，還支援「圓點」模式。使用者可以在動畫編輯器的指標區塊選擇形狀（箭頭/圓點），圓點模式適合在投影片上標記精確位置而不需要方向性指示。

**使用方式：**
在動畫編輯器的 `pointer` 效果設定中，最上方新增「指標形狀」下拉選單：
- **箭頭（arrow）**：游標形狀，可旋轉，搭配 `angle` 設定
- **圓點（dot）**：填滿圓形，不受 `angle` 影響

**技術說明：**
- `AnimationEffect` 和 `SlideAnimationEffect` 新增 `pointerShape?: 'arrow' | 'dot'`
- `EffectSchema` 以 `z.enum(['arrow', 'dot'])` 驗證
- `SlideRenderer.tsx`：`dot` 時渲染 `<circle cx="12" cy="12" r="10">`，並去除 transform 中的 rotate

## step-list 效果：AI 自動建議背景色與文字色

AI 自動焦點（auto-focus）現在可以根據投影片背景色系，自動為 `step-list` 效果建議適合的背景色和文字色。過去 AI 生成的 step-list 都使用固定的深色背景（`#1e293b`），在淺色投影片上可能對比不足；現在 AI 可以判斷投影片色調並選用對比較好的配色。

**使用方式：**
使用 AI 自動焦點功能時（需提供投影片圖片供 AI 視覺判斷），AI 會在為逐字稿句子選擇 `step-list` 效果的同時，依投影片背景色系給出配色建議：
- 淺色系投影片（白色、淡灰等）：AI 會建議深色背景（如深藍 `#1e3a5f`）搭配淺色文字（如近白 `#f0f4ff`）
- 深色系投影片：AI 沿用預設值，不額外提供顏色欄位
- 使用者在動畫編輯器中仍可手動覆蓋顏色設定

**技術說明：**
- `AutoFocusItemSchema`（Zod）新增 `stepListBgColor`/`stepListTextColor`（選填，hex color regex 驗證）
- `buildAutoFocusSystemPrompt()` 新增 step 6b 說明，指引 AI 依投影片背景色系決定是否提供配色
- `mapAutoFocusResponseToEffects()` 在 `step-list` 分支中提取並傳遞顏色欄位至 `AnimationEffect`

## highlight-box 效果：脈動光暈（Pulse）模式

`highlight-box` 效果現在支援「脈動光暈」模式，讓邊框光暈週期性放大縮小，形成視覺吸引效果，適合用於強調投影片中最重要的數據或結論。

**使用方式：**
在動畫編輯器的 `highlight-box` 效果設定中，勾選「脈動光暈」核取方塊即可啟用。啟用後：
- 邊框在淡入完成後開始週期性脈動（約 0.7 秒一個週期）
- 光暈在正常大小與約 2.5 倍放大之間來回切換
- 若同時啟用外框顏色（`highlightOuterColor`），外框也會隨之脈動
- 脈動動畫在效果淡出時自動停止

**技術說明：**
- `AnimationEffect` 和 `SlideAnimationEffect` 新增 `highlightPulse?: boolean`（選填，預設不脈動）
- `EffectSchema` 以 `z.boolean().optional()` 驗證
- `buildGsapTimeline.ts` 將 `highlight-box` 分離為獨立 case，當 `highlightPulse` 為 `true` 時，在淡入完成的時間點插入一個 `fromTo` 動畫，以 `yoyo: true, repeat: -1` 讓 `boxShadow` 在正常光暈與放大光暈間無限循環

## spotlight 效果：柔邊模糊（Soft Edge）

`spotlight` 效果現在支援「柔邊模糊」選項，讓聚光燈的邊界從硬邊（box-shadow 直接截斷）變成漸層淡出，產生更自然的舞台聚光燈視覺效果。

**使用方式：**
在動畫編輯器的 `spotlight` 效果設定中，新增「柔邊模糊」數字輸入框（預設 `0`，範圍 0–80px）：
- **0px**：保持原有硬邊效果
- **20–40px**：輕微柔邊，邊界自然漸淡
- **60–80px**：大幅模糊，邊界幾乎消失，適合背景暗化效果

**技術說明：**
- `AnimationEffect` 和 `SlideAnimationEffect` 新增 `spotlightSoftEdge?: number`（px，0-80）
- `EffectSchema` 以 `z.number().int().min(0).max(80)` 驗證
- `SlideRenderer.tsx` 在 `spotlightSoftEdge > 0` 時加入 `filter: blur(${spSoft}px)` style 到遮罩 div

## overlay-image 效果：透明度控制

`overlay-image` 效果現在支援透明度設定，讓插入的圖片可以半透明疊加在投影片上，適合浮水印或淡入底圖的視覺設計。

**使用方式：**
在動畫編輯器的 `overlay-image` 效果設定中，圖片選擇器下方新增「透明度」數字輸入框（預設 `1.0`，範圍 0–1，步進 0.05）：
- **1.0**：完全不透明（預設）
- **0.5**：半透明，可透過圖片看到底下的投影片內容
- **0.1-0.3**：極淡的浮水印效果

**技術說明：**
- `AnimationEffect` 和 `SlideAnimationEffect` 新增 `overlayImageOpacity?: number`（0-1）
- `EffectSchema` 以 `z.number().min(0).max(1)` 驗證
- `SlideRenderer.tsx` 在 `<img>` 元素的 style 中加入 `opacity: imgOpacity`

## text-callout 效果：文字對齊方式

`text-callout` 效果現在支援左/置中/右三種文字對齊方式，解決多行長文字標注的排版需求。

**使用方式：**
在動畫編輯器的 `text-callout` 效果設定中，圓角輸入框下方新增「文字對齊」下拉選單：
- **靠左（Left）**：文字靠左對齊，適合條列式說明
- **置中（Center）**：預設，適合簡短的標題式文字
- **靠右（Right）**：文字靠右對齊

**技術說明：**
- `AnimationEffect` 和 `SlideAnimationEffect` 新增 `textCalloutAlign?: 'left' | 'center' | 'right'`
- `EffectSchema` 以 `z.enum(['left', 'center', 'right'])` 驗證
- `SlideRenderer.tsx` 同步設定 CSS `textAlign` 和 flexbox `justifyContent`（left→flex-start、right→flex-end）

## step-list 效果：圓角半徑控制

`step-list` 效果現在支援自訂圓角半徑，讓條列清單方框可以從直角到完全圓角自由調整。

**使用方式：**
在動畫編輯器的 `step-list` 效果設定中，字型大小輸入框後方新增「圓角半徑」數字輸入框（預設 `8px`，範圍 0–32px，步進 2）。

**技術說明：**
- `AnimationEffect` 和 `SlideAnimationEffect` 新增 `stepListBorderRadius?: number`（px，0-32）
- `EffectSchema` 以 `z.number().int().min(0).max(32)` 驗證
- `SlideRenderer.tsx` 使用 `${effect.stepListBorderRadius ?? 8}px` 取代硬編碼 `'8px'`

## Manim animate.typewrite 打字機效果

`window.Manim.animate.typewrite(m, progress, opts)` 為自訂動畫腳本新增打字機效果，讓文字元素的字元逐一出現或消失。

**使用方式（自訂動畫腳本）：**
```javascript
// 正向：從左到右逐字顯示
Manim.animate.typewrite(label, progress);

// 反向：從右側開始，逐字顯示（適合「從尾端打字」效果）
Manim.animate.typewrite(label, progress, { reverse: true });
```

**行為說明：**
- `progress = 0`：不顯示任何字元
- `progress = 0.5`：顯示約一半的字元
- `progress = 1`：顯示完整文字
- `reverse: true`：顯示字串尾部的字元（從右向左累積）
- 非文字元素退回為透明度淡入

**技術說明：**
- 以 `data-full-text` 屬性快取原始 textContent，確保任何 progress 值下都能正確還原
- 共新增 2 個 vm 測試（正向與反向各一），全部 32 個 manimHelperScript 測試通過

## shape 效果描邊虛線樣式

`shape` 動畫效果（圓形、橢圓、矩形、箭頭）的描邊現在支援虛線樣式，可在動畫編輯器中輸入 SVG `stroke-dasharray` 值（例如 `8 4`）來設定虛線間距。

**使用方式：**
在動畫編輯器的 `shape` 效果設定中，透明度輸入框後方新增「描邊虛線樣式」文字輸入框。輸入格式為數字加空白（例如 `8 4` = 8px 實線 + 4px 空隙，`4 2 1 2` = 點線段）；留空則維持實線。

**技術說明：**
- `AnimationEffect` 和 `SlideAnimationEffect` 新增 `shapeDashArray?: string`（最長 20 字元，僅允許數字與空白）
- `EffectSchema` 以 `z.string().max(20).regex(/^[\d. ]*$/)` 驗證
- `SlideRenderer.tsx` 在 `<circle>`、`<ellipse>`、`<line>`、`<rect>` SVG 元素上加入 `strokeDasharray` 屬性
- 空字串或 undefined 時不套用 `strokeDasharray`（維持實線）

## AI 技能系統（Skills）

使用者現在可以在設定頁中管理「AI 技能」——預先定義的提示指令，在 AI 生成逐字稿時自動注入，讓生成結果符合特定的風格或語氣需求，無需每次手動輸入指示。

**使用方式：**
在設定頁底部的「AI 技能」區塊中：
1. **啟用內建技能**：勾選任一內建技能（教學風格、學術嚴謹、故事敘述、精簡摘要），下次生成逐字稿時就會自動套用對應指令。
2. **新增自訂技能**：填寫技能名稱與指令內容，選擇套用範圍（逐字稿生成 或 所有 AI 呼叫），按「新增技能」即可儲存。
3. **刪除自訂技能**：點擊技能列表中的「刪除」按鈕移除。

**內建技能清單：**
| 技能 | 用途 |
|------|------|
| 教學風格 | 使用親切比喻，適合一般聽眾 |
| 學術嚴謹 | 精確術語、結構性論述，適合學術場合 |
| 故事敘述 | 以情境故事帶入，增加投入感 |
| 精簡摘要 | 只講最核心重點，省略細節 |

**技術說明：**
- 技能資料存於 `accounts/<accountId>/skills.json`（每帳號獨立）
- 內建技能的啟用狀態存於 `enabledBuiltIns` 陣列，自訂技能存於 `userSkills` 陣列
- 生成逐字稿前，pipeline 讀取所有已啟用、`applyTo: 'script' | 'all'` 的技能，將其 prompt 合併至 `userPrompt`
- REST API：`GET /api/skills`、`POST /api/skills`、`PATCH /api/skills/:id`、`DELETE /api/skills/:id`、`POST /api/skills/:id/toggle`

## Manim 搖晃效果（shake）

自訂動畫腳本現在支援 `Manim.animate.shake(m, progress, opts)` 水平搖晃效果，適合用於強調重點、警示錯誤、或引導注意力。

**使用方式：**
```javascript
// 基本用法（幅度 8px，4 個週期）
Manim.animate.shake(myShape, progress);

// 自訂選項
Manim.animate.shake(myShape, progress, {
  amplitude: 15,  // 最大水平偏移量（px，預設 8）
  cycles: 2,      // 搖晃週期數（預設 4）
});
```

**動畫特性：**
- `progress=0`：元素靜止於原位（translateX = 0）
- 中間 progress：依正弦波左右搖晃，幅度最大可達 amplitude px
- `progress=1`：元素自動回到原位（整數 cycles 使 sin 值精確為 0）

**技術說明：**
- 位移公式：`Math.sin(progress * Math.PI * cycles) * amplitude`
- 整數 cycles 確保端點（progress=0 和 1）的 sin 值恰好為 0，無需額外 envelope
- 2 個 vm 單元測試覆蓋端點零偏移及中間非零偏移驗證

## text-callout 效果邊框顏色

`text-callout` 效果現在支援自訂外框顏色，讓標注方框能更清晰地從投影片背景中突出，或配合視覺設計主題。

**使用方式：**
在動畫編輯器的 text-callout 設定中，勾選「邊框顏色」後選擇顏色，即可為標注框加上 2px 實線外框。不勾選時維持原有無外框的外觀。

**技術說明：**
- `textCalloutBorderColor?: string` — CSS hex 格式，後端以 regex 驗證（3–8 位 hex）
- SlideRenderer 條件性加入 `border: 2px solid {color}` style，未設定時不影響既有樣式
- AnimationEditorTab 以勾選框控制啟用/停用，預設顏色為白色（`#ffffff`）
