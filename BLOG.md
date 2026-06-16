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
