# 帶動畫 PPTX 匯入設計（V1）

2026-09-12。目標：讓 AI agent 透過 MCP 把一份**帶動畫的 pptx** 搬進 makeslide，
靜態頁變成一般圖片頁，動畫頁變成**可用上下鍵逐步播放的 React 頁**，每一步配一段旁白語音；
播放模式會依序播放動畫與語音，暫停模式可用上下鍵看動畫但不出聲。

## 1. 為什麼不靠 AI 重畫版面

第一版曾考慮把每頁截圖丟給 AI，請它寫一個「看起來像」的 React 元件。實測後放棄：

pptx 的動畫在 OOXML 裡是 `p:timing` 下的一串 **click step**，每一步的 `p:spTgt/@spid`
指名這一步要顯示（`presetClass="entr"`）或隱藏（`exit`）哪些 shape。也就是說，
**每一步的畫面＝把該步之後才出現的 shape 拿掉之後的那張投影片**。把那些 shape 從
slide XML 切掉再交給 LibreOffice 算圖，得到的就是原檔等級的畫面，一個像素都不用猜。

實測（`docs/computational Graph.pptx`，26 頁 / 17 頁有動畫 / 136 個 frame）：
LibreOffice 6.4 每個變體約 1.25 秒，整份約 3 分鐘；192 dpi 出圖剛好 1920×1081，
縮成 1920×1080 即可。

AI 因此不負責「畫得像不像」，只負責它真正擅長的事：**寫旁白**。

## 2. 資料模型

一張動畫投影片 = 一個 React 頁面 + 一份步驟清單。

```
pages/<uid>.slide.jsx        React 程式碼（既有機制）
pages/<uid>.slide.js         編譯結果（既有機制）
pages/<uid>.steps.json       新增：步驟清單
pages/<uid>.step-00.jpg      新增：第 0 步（點擊前）的畫面
pages/<uid>.step-01.jpg      ...
pages/<uid>.step-00.m4a      新增：第 0 步的旁白語音
```

`steps.json`：

```jsonc
{
  "version": 1,
  "source": "pptx",
  "steps": [
    { "index": 0, "image": "pages/<uid>.step-00.jpg", "script": "…旁白…",
      "audio": "pages/<uid>.step-00.m4a", "audioDurationSeconds": 4.2 }
  ]
}
```

頁面本身：`render_type = 'react'`、`react_slide_path` 指向 JSX。
`pages.image_path` 仍是**最後一步**的畫面（烘焙結果），讓縮圖、封面、匯出、
簡報清單這些既有功能不需要知道步驟的存在。

### 為什麼步驟不做成「每步一頁」

那樣 26 頁會變成 136 頁，編輯和瀏覽都會壞掉。步驟屬於一頁之內的狀態。

### 為什麼不沿用既有的 GSAP 動畫

`render_type` 互斥：存下啟用的動畫規格會把 `react` 覆寫成 `gsap-image`
（`services/pageAnimation.ts` 的 `renderTypeForSpec`），設計文件也把「兩者共存」
列在未來工作。步驟式 React 頁因此走自己的機制，不動既有動畫系統。

## 3. React 頁怎麼顯示步驟

既有的 React 頁契約要求元件**是靜態的**——掛載後再改 DOM 會把使用者的
文字覆寫（overrides）洗掉。所以步驟**不能**用 React state 做。

改成：JSX 把每一步的畫面都畫出來，並在元素上標記它屬於第幾步，
由沙箱執行環境（不是投影片程式碼）負責顯示／隱藏：

```jsx
function Slide() {
  return (
    <div style={{ position:'relative', width:'100%', height:'100%' }}>
      <img data-ms-step-layer="0" src={STEP_0} style={{ position:'absolute', inset:0 }} />
      <img data-ms-step-layer="1" src={STEP_1} style={{ position:'absolute', inset:0 }} />
    </div>
  );
}
window.SlideComponent = Slide;
```

- 沙箱文件新增一段執行環境程式：把 `[data-ms-step-layer="k"]` 中 `k > 目前步驟` 的
  元素設為 `opacity:0`，其餘為 1，並加上轉場。
- 主頁面透過既有的 `postMessage` 通道送 `{ type:'step', step }`，與主題、背景、
  overrides 走同一條路，不用重新掛載元件。
- 這是**通用能力**，不限於 pptx 匯入：任何 React 頁都能用 `data-ms-step-layer`
  宣告分步顯示。

步驟數以 `steps.json` 為準（播放器要用它排語音），JSX 的層數必須一致，存檔時驗證。

## 4. 播放

`pages` 詳細資料新增 `step_count` 與每步的語音 URL。播放器在有步驟的頁面上：

| 狀態 | 行為 |
|---|---|
| 播放中 | 播第 k 步的語音；播完自動前進到 k+1 並播它的語音；最後一步播完後沿用既有的換頁邏輯 |
| 暫停 | 上下鍵（與左右鍵）在步驟間移動，只換畫面不出聲 |
| 換頁 | 步驟歸零 |

既有的分步只在全螢幕有效，且只支援 gsap-image 頁；步驟式 React 頁在**一般模式也可用**，
因為使用者要的就是「上下鍵看動畫」。

## 5. 匯入流程

`POST /api/pdfs/from-pptx`（multipart，檔案欄位 `file`）→ 建立簡報並跑背景工作：

1. 存 `source.pptx`。
2. 解析：投影片順序、每頁的 click step 與目標 shape、每頁文字。
3. 產生每一步的變體 pptx → LibreOffice 一次批次轉 PDF → 取出對應頁 → 1920×1080 JPG。
4. 靜態頁：一般圖片頁（`image_path` = 該頁畫面，`text` = 抽出的文字大綱）。
   動畫頁：React 頁 + `steps.json` + 每步畫面。
5. 旁白：AI 依「這一步新出現了什麼」為每一步寫一段話，逐步 TTS。
6. 進度以工作狀態端點回報，MCP 可輪詢。

MCP 新增 `upload_pptx`（傳本機檔案）與 `get_pptx_import_status`。
`mcp-server.ts` 必須維持零相依單檔，所以解析與算圖全部在後端。

## 6. 分期

| 期 | 內容 | 分支 |
|---|---|---|
| 1 | OOXML 解析：投影片、click step、文字、shape 切除 | `feat/pptx-parse` |
| 2 | 步驟畫面算圖（LibreOffice → PDF → JPG） | `feat/pptx-frames` |
| 3 | React 頁步驟機制（`steps.json`、沙箱執行環境、postMessage、驗證） | `feat/react-slide-steps` |
| 4 | 播放：上下鍵分步、每步語音、播放/暫停行為 | `feat/step-playback` |
| 5 | 匯入端點與背景工作，串起 1–4 | `feat/pptx-import` |
| 6 | 每步旁白與 TTS | `feat/pptx-narration` |
| 7 | MCP 工具 | `feat/mcp-pptx` |

每一期各自一個分支、各自可驗證，完成後 merge 回 master 並記錄在 TODO.md。

## 7. 已知限制

- 只處理 click step（`mainSeq`）。自動播放（`afterEffect`／`withEffect` 接在前一步之後）
  會被併入它所屬的那一步，不另外計時。
- 動作路徑、旋轉、縮放等連續動畫不會逐格重現——每一步只取**該步結束後**的靜止畫面。
- 需要主機有 LibreOffice 與 `pdftoppm`；沒有時匯入會明確失敗，不會默默產生空白頁。
