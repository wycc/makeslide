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
