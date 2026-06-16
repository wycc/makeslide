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
