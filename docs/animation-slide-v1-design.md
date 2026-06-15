# makeslide 動畫投影片 V1 設計文件

- 文件版本：V1.0
- 狀態：Approved（2026-06-12）
- 目標版本：第一版可落地實作
- 動畫基底：GSAP Timeline
- 適用專案：`wycc/makeslide`

> 實作對照註記（2026-06-12）：
> - 後端 page 路由參數實際為 `:n`（沿用 `PageParamSchema`），本文件中的 `:pageNumber` 一律以 `:n` 實作。
> - 前端 API client 實際位於 `frontend/src/lib/api/` 目錄（`pdfs.ts` 等），非單一 `api.ts`。
> - 路由檔案命名沿用既有 kebab-case 慣例：`page-animation.ts`。
> - 播放用 spec 由 PlayPage 集中載入並經 context 傳入 renderer（編輯中 draft 可即時預覽），renderer 不自行 fetch。
>
> 擴充註記（2026-06-12，逐字稿同步啟動）：
> - 新增 `effect.startTrigger`：可將效果的開始時間改為「綁定逐字稿句子」，播放到該句時動畫同步開始。詳見 §4.3、§6.5、§7。
>
> 擴充註記（2026-06-12，向前秒數）：
> - `startTrigger` 新增選填欄位 `offsetSeconds`：可指定動畫提前於對應逐字稿句子幾秒開始。詳見 §4.3、§7.1。
>
> 擴充註記（2026-06-12，焦點效果）：
> - 新增兩種「焦點」效果類型 `highlight-box`（紅框標示）與 `spotlight`（聚光燈），以疊加層（overlay）方式渲染於 animated stage 內，可指定位置與大小。詳見 §5.1、§6.2、§6.6。
>
> 擴充註記（2026-06-12，自動產生逐字稿焦點動畫）：
> - 動畫編輯器新增「自動產生逐字稿焦點動畫」按鈕：依本頁逐字稿句數，一次產生對應數量的 `highlight-box` 效果並各自綁定 `startTrigger`（每句一個，使用預設焦點位置 30/30/40/40，使用者可再逐一調整位置與大小）。為 TODO 第 720 項的 v1 範圍，詳見 §7.2。
>
> 擴充註記（2026-06-12，文字說明效果）：
> - 新增 `text-callout` 效果類型：與 `highlight-box`/`spotlight` 同為 overlay 疊加層，並新增 `effect.text`（純文字，上限 80 字）作為顯示內容，渲染為深色圓角文字框。為 TODO 第 721 項「除了焦點以外，也可以生成一張小圖或文字做為動畫內容」的 v1 範圍（僅文字，圖片內容留待後續項目）。詳見 §5.2、§6.6、§7。
>
> 擴充註記（2026-06-12，逐字稿動畫指引）：
> - `AnimationSpec` 新增選填欄位 `hints?: Record<string, string>`（依逐字稿句子索引對應的自由文字動畫指引），動畫編輯器新增逐句輸入 UI。為 TODO「加上手動在逐字稿加上動畫指引的功能，這個指引會在生成動畫時傳給 LLM 做參考」的 v1 範圍——本次僅提供資料模型、驗證與輸入 UI；「生成動畫時傳給 LLM 做參考」留待 V2 LLM 生成動畫管線消費這些 hints。詳見 §4.4、§7.3、§12。
>
> 擴充註記（2026-06-12，效果自動消失）：
> - `highlight-box`/`spotlight`/`text-callout`（`OVERLAY_EFFECT_TYPES`）新增選填欄位 `exitDuration?: number`（秒）：淡入完成後維持顯示 `exitDuration` 秒，再以相同 `duration`/`ease` 自動淡出。為 TODO「每一個動畫都要有消失時間」之 v1 範圍——僅套用於 overlay 效果；`fade-in`/`zoom-*`/`pan-*` 等整頁 transform 效果本身已有明確的最終狀態，其對稱「恢復原狀」機制留待後續版本（見 §12）。詳見 §5.3、§7。
>
> 擴充註記（2026-06-12，AI 自動產生逐字稿焦點動畫）：
> - 新增 `POST /api/pdfs/:id/pages/:n/animation/auto-focus-ai`：依本頁逐字稿句子（與選填的逐句動畫指引 `hints`、頁面 OCR 文字）呼叫 LLM（`callChatJSON`，沿用 `LLM_PROVIDER` 設定），由 AI 逐句決定是否顯示 `highlight-box`/`spotlight` 焦點方框，以及其位置（`xPct`/`yPct`/`widthPct`/`heightPct`）與消失時間（`exitDuration`，選填）。動畫編輯器新增「🤖 AI 自動產生焦點動畫」按鈕，與既有「🪄 自動產生逐字稿焦點動畫」（固定規則版）並列。為 TODO「自動產生逐字稿焦點功能要用 AI 選擇要在什麼時顯示在什麼位置」之 v1 範圍，亦是 §12 V2「依 `AnimationSpec.hints` 與逐字稿內容由 LLM 生成動畫 JSON」的初步落地（先涵蓋焦點方框的時機與位置，`text-callout` 與其他效果類型留待後續）。詳見 §7.4、§8。
>
> 擴充註記（2026-06-15，AI 自動產生 text-callout 文案）：
> - `auto-focus-ai`（§7.4）新增 `text-callout` 效果選項：`AUTO_FOCUS_AI_EFFECT_TYPES` 新增 `'text-callout'`，LLM 可為適合以精簡摘要強化重點的句子選擇淡入一段 AI 生成文案（`text`，上限 `MAX_TEXT_CALLOUT_LENGTH` = 80 字，與逐字稿同語言），位置建議放在畫面空白處避免遮住重點；若選擇 `text-callout` 卻未提供有效文字，後端會退回為 `highlight-box`（避免空白文字框）。為 §12 V2「`text-callout`（含 AI 生成文案）的 AI 生成」之落地。詳見 §7.4、§12。

---

## 1. 背景

目前 makeslide 的播放頁以靜態圖片為核心。每一頁投影片由圖片、逐字稿與音訊構成，播放器以音訊作為播放主軸，並支援播放/暫停/seek、播放速度調整、字幕、全螢幕、教室同步模式、手寫標註、圖片局部選取與編輯、縮圖重排等功能。

現有實作中，一般播放區與全螢幕播放區直接使用 `<img />` 顯示投影片。第一版動畫功能的目標，是將顯示圖片的責任集中到新的 `<SlideRenderer />` 元件，並使用 GSAP Timeline 對投影片視覺容器套用動畫效果。

第一版刻意不處理任意 HTML、任意 JavaScript、SVG 圖元編輯、Three.js、Manim DSL 或動畫影片輸出。先完成穩定且可擴充的圖片動畫頁面，作為後續數學動畫與多物件動畫的基礎。

## 2. 設計目標

### 2.1 第一版必須完成

1. 將播放頁直接使用的 `<img />` 升級為 `<SlideRenderer />`。
2. 靜態頁面維持原本行為，不影響既有簡報。
3. 動畫頁面仍使用原本 JPG 圖片作為內容，但可套用 GSAP 動畫效果。
4. 動畫時間軸與音訊播放時間同步。
5. 使用者可以在播放頁的編輯區開啟「動畫」Tab。
6. 使用者可以為目前頁面新增、修改、刪除動畫效果。
7. 支援儲存動畫設定與立即預覽。
8. 全螢幕模式、字幕、手寫標註與教室同步模式仍可運作。
9. 縮圖仍然顯示靜態圖片，不播放動畫。
10. 動畫設定格式需保留未來擴充多物件動畫的空間。

### 2.2 第一版不處理

任意 JavaScript、任意 HTML、iframe sandbox、SVG 圖元編輯器、拖拉式時間軸 UI、關鍵影格編輯器、動畫影片輸出、既有匯入流程改寫、LLM 自動生成動畫、縮圖播放動畫。

## 3. 核心設計決策

### 3.1 圖片是主要內容，動畫是可選效果

每一頁仍然保留 `<page_uid>.jpg` / `<page_uid>.text.txt` / `<page_uid>.script.txt` / `<page_uid>.m4a`。動畫頁面額外加入 `<page_uid>.animation.json`。動畫設定遺失、載入失敗或瀏覽器不支援時，仍可退回靜態圖片。

### 3.2 以音訊作為唯一播放時鐘

播放器已維護 `currentTime`、`duration`、`isPlaying`、`playbackRate`。動畫不可建立獨立且不受控的計時器。`<SlideRenderer />` 必須使用音訊的 `currentTime` 對 GSAP Timeline 執行 `seek()`，並依照 `isPlaying` 執行 `play()` 或 `pause()`。

實作細節：`currentTime` 由 `<audio>` 的 `timeupdate` 餵入（約 4Hz），timeline 平時由 `isPlaying` 驅動 play/pause，`currentTime` 只做漂移校正（差距 > 0.3s 才 seek），避免逐 tick seek 造成抖動。

### 3.3 動畫套用在「投影片視覺容器」（animated stage）

若只對 `<img />` 縮放或平移，手寫標註層會與圖片錯位。因此 GSAP 套用在包含圖片與疊加層的 stage：

```text
SlideRenderer root（overflow clip）
└── animated stage（GSAP transform 目標）
    ├── img
    ├── DrawingCanvas
    └── image edit selection overlay
```

DrawingCanvas 與選取 overlay 的座標均為「相對自身 boundingRect 的 normalized 值」，與 img 一起被 transform 後映射不變，不需改座標程式。

### 3.4 第一版動畫 target 固定為 slide

保留 `target` 欄位但只接受 `"slide"`。未來再加入 `title`、`object:<id>`、`svg:<id>`、`formula:<id>` 等。

## 4. 資料模型

### 4.1 SQLite migration

```sql
ALTER TABLE pages ADD COLUMN render_type TEXT NOT NULL DEFAULT 'static-image';
ALTER TABLE pages ADD COLUMN animation_spec_path TEXT;
```

合法值：`static-image`、`gsap-image`。`animation_spec_path` 儲存動畫 JSON 相對路徑（`pages/<page_uid>.animation.json`），靜態頁面可為 NULL。整份 JSON 不放入 SQLite，維持素材檔案化。

### 4.2 JSON schema 與範例

```json
{
  "version": 1,
  "enabled": true,
  "effects": [
    { "id": "effect-1", "target": "slide", "type": "fade-in", "start": 0, "duration": 0.8, "ease": "power1.out" },
    { "id": "effect-2", "target": "slide", "type": "zoom-in", "start": 0, "duration": 8, "ease": "none",
      "params": { "fromScale": 1, "toScale": 1.08 } },
    { "id": "effect-3", "target": "slide", "type": "pan-left", "start": 4, "duration": 2, "ease": "power1.inOut",
      "params": { "distancePct": 5 },
      "startTrigger": { "type": "transcript-line", "line": 2 } }
  ]
}
```

effect-3 設定了 `startTrigger`：實際播放時的開始秒數會改用「本頁逐字稿第 3 句（index 2）」的估計播放起始時間；`start: 4` 僅作為找不到對應句子時的退回值。詳見 §4.3。

### 4.3 逐字稿同步啟動（startTrigger）

```ts
interface AnimationStartTrigger {
  type: 'transcript-line';
  /** 0-based，對應本頁逐字稿切句後的句子索引 */
  line: number;
  /** 選填，提前於對應句子開始時間幾秒觸發動畫（0~60） */
  offsetSeconds?: number;
}
```

- `AnimationEffect.startTrigger?: AnimationStartTrigger`：選填欄位，前後端型別與 zod schema 同步定義於 `backend/src/services/pageAnimation.ts` 與 `frontend/src/types.ts`。
- 驗證規則（`StartTriggerSchema`）：`type` 必須為 `'transcript-line'`；`line` 必須為 `0 <= line <= 999`（`MAX_TRANSCRIPT_LINE`）的整數；`offsetSeconds`（選填）必須為 `0 <= offsetSeconds <= 60`（`MAX_START_OFFSET_SECONDS`）。
- 語意：
  - 設定 `startTrigger` 後，效果的播放開始時間 = 本頁逐字稿第 `line` 句（0-based）的估計播放起始秒數，再減去 `offsetSeconds`（預設 0），並下限為 0（不會變成負數）。
  - `start` 欄位仍會儲存，作為「找不到對應句子」時的退回值（例如逐字稿被編輯、句子數量變少導致 `line` 超出範圍）；此時 `offsetSeconds` 不生效。
  - 一個 spec 內可有部分效果使用 `startTrigger`、部分使用固定秒數 `start`，互不影響。
- 解析時機：完全在前端進行（後端僅驗證/儲存原始 `startTrigger`），詳見 §6.5、§7.1。前端 `frontend/src/lib/animationSpec.ts` 的 `resolveStartTriggerSeconds(startTrigger, sentenceTimeline)` 為共用的解析函式，`resolveAnimationSpec` 與 `AnimationEditorTab.tsx` 的「預估開始」顯示皆呼叫它。

### 4.4 逐字稿動畫指引（hints）

```ts
interface AnimationSpec {
  version: 1;
  enabled: boolean;
  effects: AnimationEffect[];
  /** 選填，依逐字稿句子索引（字串）對應的動畫指引文字 */
  hints?: Record<string, string>;
}
```

- `hints` 為選填欄位，key 為本頁逐字稿切句後的句子索引（0-based，以字串表示，如 `"0"`、`"2"`），value 為使用者手動輸入的自由文字動畫指引（例如「放大顯示這個數字」、「指向圖表右下角」）。
- 驗證規則（`HintsSchema`，定義於 `backend/src/services/pageAnimation.ts`）：key 必須符合 `^\d+$`；value 長度 `<= 200`（`MAX_HINT_LENGTH`）；entries 數量 `<= 50`（`MAX_HINTS`）；空物件 `{}` 會被正規化為 `undefined`（不寫入 spec）。前端常數同步定義於 `frontend/src/lib/animationSpec.ts`。
- 為 TODO「加上手動在逐字稿加上動畫指引的功能，這個指引會在生成動畫時傳給 LLM 做參考」之 v1 範圍：本次僅提供資料模型、驗證與編輯器 UI（§7.3），讓使用者可逐句填寫指引並隨 spec 一併儲存；「生成動畫時傳給 LLM 做參考」需等待 V2 的 LLM 生成動畫管線（見 §12）才會實際讀取並使用這些 hints。

## 5. 動畫效果定義

| Effect type | 行為 | 預設參數 |
|---|---|---|
| fade-in | 從透明淡入 | opacity: 0 → 1 |
| zoom-in | 緩慢放大 | scale: 1 → 1.08 |
| zoom-out | 緩慢縮小 | scale: 1.08 → 1 |
| pan-left | 由右向左平移 | xPercent: 3 → -3 |
| pan-right | 由左向右平移 | xPercent: -3 → 3 |
| pan-up | 由下向上平移 | yPercent: 3 → -3 |
| pan-down | 由上向下平移 | yPercent: -3 → 3 |
| highlight-box | 於指定區域淡入一個紅色外框，提示焦點 | opacity: 0 → 1 |
| spotlight | 於指定區域外淡入半透明黑色遮罩，聚焦該區域 | opacity: 0 → 1 |
| text-callout | 於指定區域淡入一個文字說明框 | opacity: 0 → 1，文字內容見 `effect.text` |
| custom-script | 於指定區域立即顯示一個由 AI 依提示詞產生的自訂 JavaScript 動畫（sandboxed iframe），不套用淡入 | opacity: 直接設為 1（無淡入過渡），程式碼見 `effect.code`，詳見 §5.4 |

easing 白名單：`none`、`power1.in`、`power1.out`、`power1.inOut`、`power2.inOut`。

驗證規則：`start >= 0`、`0 < duration <= 600`、`effects.length <= 20`、`target === 'slide'`、type/ease 必須在白名單、`params` 只接受該 effect type 已定義的數值欄位（未知鍵直接過濾）。

### 5.1 焦點效果（highlight-box / spotlight）

`highlight-box` 與 `spotlight` 是「提供多種焦點」的第一版實作：以疊加層（overlay）標示投影片上的一個矩形區域，而非對整個 stage 做 transform。

```ts
// effect.params（皆為 0~100 的百分比，相對於投影片顯示尺寸；未提供時套用預設值）
{
  xPct?: number;     // 左上角 X 位置，預設 30
  yPct?: number;     // 左上角 Y 位置，預設 30
  widthPct?: number; // 寬度，預設 40
  heightPct?: number; // 高度，預設 40
}
```

- `highlight-box`：在 `(xPct, yPct)` ~ `(xPct+widthPct, yPct+heightPct)` 範圍內渲染一個紅色圓角外框（`border + box-shadow`），`autoAlpha` 由 0 淡入至 1。
- `spotlight`：在同一範圍內渲染一個橢圓形區域，外側以 `box-shadow: 0 0 0 9999px rgba(0,0,0,0.6)` 形成大範圍暗化遮罩，達到「聚光燈」效果；`autoAlpha` 同樣由 0 淡入至 1。
- 兩者皆與 `fade-in` 相同：淡入後預設維持顯示；可選填 `exitDuration` 讓 overlay 在淡入完成後自動淡出，詳見 §5.3。
- 驗證規則沿用既有 `params` 白名單機制（`ALLOWED_PARAM_KEYS`），未知鍵過濾、僅接受數值；v1 不對 `xPct`/`yPct`/`widthPct`/`heightPct` 做範圍限制，前端輸入框會夾在 0~100。
- 「依逐字稿自動產生焦點」的編輯器內手動產生按鈕已於 §7.2 提供 v1；「文字說明」疊加內容已於 §5.2 提供 v1，「引言(圖)」中的圖片內容仍屬於後續項目（見 §12 / TODO 新功能區塊）。

### 5.2 文字說明效果（text-callout）

`text-callout` 是「除了焦點以外，也可以生成文字做為動畫內容」（TODO 第 721 項）的 v1 實作：與 `highlight-box`/`spotlight` 共用同一套 overlay 疊加層機制（§6.6），額外新增 `effect.text` 欄位作為顯示文字。

```ts
// effect.params 同 §5.1（位置與大小，0~100 百分比，未提供時套用預設值 30/30/40/40）
{
  xPct?: number;
  yPct?: number;
  widthPct?: number;
  heightPct?: number;
}
// effect.text：顯示的文字內容（純文字，上限 80 字 = MAX_TEXT_CALLOUT_LENGTH）
```

- 渲染為一個深色半透明圓角矩形，文字置中顯示（白字、粗體），`autoAlpha` 由 0 淡入至 1，淡入後預設維持顯示；可選填 `exitDuration` 自動淡出，詳見 §5.3（與 highlight-box/spotlight 相同機制）。
- 驗證規則：`text` 為選填字串，最長 80 字（`MAX_TEXT_CALLOUT_LENGTH`，定義於 `backend/src/services/pageAnimation.ts`，前端常數同步於 `frontend/src/lib/animationSpec.ts`）；超過長度回 400 `INVALID_ANIMATION_SPEC`。
- 圖片內容（「生成一張小圖」）需額外的圖片產生/上傳管線，本次不處理，留待後續項目。

### 5.3 效果自動消失／恢復原狀（exitDuration）

所有效果類型皆可選填：

```ts
// effect.exitDuration?: number  — 秒，0 <= exitDuration <= 600（MAX_DURATION_SECONDS）
```

- 未設定（`undefined`）時行為與既有版本相同：進場動畫結束後維持結果狀態，直到換頁或 timeline 結束。
- 設定後，動畫會在進場完成（`start + duration`）後再經過 `exitDuration` 秒，以相同的 `duration`/`ease` 觸發第二段動畫，對應 timeline 時間點為 `start + duration + exitDuration`。
- `exitDuration = 0` 代表進場完成後立即開始第二段動畫（不停留）。
- 驗證規則：`z.number().min(0).max(600).optional()`，定義於 `backend/src/services/pageAnimation.ts` 的 `EffectSchema`；超出範圍回 400 `INVALID_ANIMATION_SPEC`。
- 編輯器 UI 見 §7。

第二段動畫的語意依效果類型分為兩種（見 `frontend/src/lib/animationSpec.ts` 的 `OVERLAY_EFFECT_TYPES`/`TRANSFORM_EFFECT_TYPES`）：

- **`highlight-box`/`spotlight`/`pointer`/`text-callout`/`custom-script`（`OVERLAY_EFFECT_TYPES`）**：「自動消失」——以 `autoAlpha: 1 → 0` 淡出整個 overlay。渲染：`buildGsapTimeline.ts` 於既有 `fromTo(overlay, {autoAlpha:0}, {autoAlpha:1, ...})` 之後，若 `effect.exitDuration !== undefined`，再加一個 `to(overlay, {autoAlpha:0, ...}, start+duration+exitDuration)`。
- **`fade-in`/`zoom-*`/`pan-*`（`TRANSFORM_EFFECT_TYPES`）**：「自動恢復原狀」——將整頁 `stage` 動畫回進場前的狀態（進場 tween 的反向，相同 `duration`/`ease`）。渲染：`buildGsapTimeline.ts` 於既有 `fromTo(stage, from, {...to, ...})` 之後，若 `effect.exitDuration !== undefined`，再加一個 `to(stage, {...from, ...}, start+duration+exitDuration)`（`from`/`to` 即進場 tween 的起訖值，例如 `fade-in` 為 `{autoAlpha:0}`/`{autoAlpha:1}`、`pan-left` 為 `{xPercent:d}`/`{xPercent:-d}`）。

### 5.4 自訂腳本動畫（custom-script）

`custom-script` 是「使用提示詞生成動畫」（TODO 新功能）的 v1 實作：使用者透過多輪對話描述想要的動畫效果，由 LLM 產生一段 JavaScript 原始碼，於 sandboxed `<iframe>` 中執行並疊加顯示；每一輪訊息都會帶著先前對話紀錄送給 LLM，讓使用者可逐步修改/調整直到滿意為止；產生的動畫可與其他效果（包含其他 `custom-script`）一起播放。

```ts
// effect.params 同 §5.1（位置與大小，0~100 百分比）；編輯器未提供欄位讓使用者調整，
// 未提供時預設鋪滿整張投影片 (0,0) ~ (100,100)（即 xPct/yPct = 0、widthPct/heightPct = 100），
// 讓自訂動畫可使用全部畫面，與 §5.1 其他焦點效果的預設值 30/30/40/40 不同。
{
  xPct?: number;
  yPct?: number;
  widthPct?: number;
  heightPct?: number;
}
// effect.code?: string    — AI 產生的 JavaScript 原始碼，上限 24000 字 = MAX_CUSTOM_SCRIPT_CODE_LENGTH
// effect.prompt?: string  — 舊版欄位（產生 code 所用的最後一次提示詞），schema 仍保留以相容舊 spec，
//                           但多輪對話 UI 已不再寫入此欄位，改用 effect.conversation。
// effect.conversation?: ConversationMessage[]  — 與 AI 的多輪對話紀錄，同時用於：
//                           (1) 編輯器中的對話框顯示；(2) 作為下一輪請求的 history 送給 LLM，
//                           讓 LLM 能參考先前對話內容做漸進式調整。
//   每則 { role: 'user' | 'assistant'; content: string }，content 上限 2000 字
//   = MAX_CUSTOM_SCRIPT_CONVERSATION_MESSAGE_LENGTH（提高自 500，以容納完整步驟清單）；
//   陣列上限 40 筆 = MAX_CUSTOM_SCRIPT_CONVERSATION_MESSAGES（超過時捨棄最舊的訊息）。
//   assistant 訊息分兩類：(1) LLM 產生的「實作步驟」清單（見下方兩階段流程），
//   附加 `play.animation.customScriptPlanLabel` 前綴；(2) 本地產生的「完成」/
//   錯誤提示文字（已 i18n 本地化），不含程式碼本身。
```

**沙箱與安全模型**

- `effect.code` 會被注入到 `<iframe sandbox="allow-scripts">`（**不含** `allow-same-origin`）中執行；該 iframe 因此是不透明來源（opaque origin），無法存取上層頁面 DOM、cookie、`localStorage`/`sessionStorage`/`indexedDB`、`window.parent`/`window.top`，也無法發出任何網路請求（`fetch`/`XMLHttpRequest`/`WebSocket`）。
- `frontend/src/lib/animationSpec.ts` 的 `buildCustomScriptSandboxDoc(code, durationSeconds)` 組出完整 iframe `srcDoc`：將 `code` 以 base64 編碼後嵌入（避免 `</script>`/引號跳脫問題），於受信任的包裝 script 中以 `atob` + `TextDecoder` 還原後用 `new Function(code)()` 執行；`durationSeconds`（見下方 `api.duration`）來自 `customScriptDurationSeconds(effect) = effect.duration + (effect.exitDuration ?? 0)`。
- 後端 `backend/src/services/animationCustomScript.ts` 的 `findUnsafeScriptPattern(code)` 對 LLM 產生的程式碼做縱深防禦黑名單檢查（`fetch`、`XMLHttpRequest`、`WebSocket`、`import(`、`require(`、`eval(`、`new Function(`、`document.cookie`、`localStorage`、`sessionStorage`、`indexedDB`、`window.parent`、`window.top`、`frameElement`），命中則回 `422 UNSAFE_SCRIPT`，不寫入 draft。

**程式碼契約（window.renderAnimation）**

`effect.code` 必須定義全域函式 `window.renderAnimation(root, api)`：

- `root`：一個已設定好寬高的 `<div id="root">`，產生的視覺內容（canvas / svg / DOM）應加入此元素。
- `api.duration`：這個效果的總長度（秒，數字）＝ `effect.duration + (effect.exitDuration ?? 0)`，由使用者在編輯器中設定，由 host 端注入（嵌入 `srcDoc` 時的常數），並非由產生的程式碼自行假設。
- `api.onFrame(callback)`：註冊回呼，每當收到 host 端的 `{ type: 'sync', t, playing }` postMessage 時被呼叫：
  - `t`：自此效果開始（`effect.start`）起算的秒數，下限 0。
  - `playing`：投影片目前是否在播放。
  - 回呼應以 `Math.min(t / api.duration, 1)` 計算 0~1 進度並重繪畫面，讓動畫在 `t: 0 → api.duration` 期間播放「一輪」；達到 1 後維持最終畫面（不重置/不循環），之後效果整體依 `exitDuration`（§5.3）淡出消失。回呼也需能承受 `t` 變小（倒退/重播）而正確重算畫面。

**manim 風格輔助函式庫（window.Manim）**

「支援 manim 式的動畫」（TODO 新功能）v1 以一個內建的 sandbox 輔助函式庫交付，而非真正的 Python manim：

- `frontend/src/lib/manimHelperScript.ts` 匯出 `MANIM_HELPER_SCRIPT`——一段純 ES5 JavaScript 原始碼字串。`buildCustomScriptSandboxDoc` 會在使用者/AI 的 `code` 之前以獨立的 `<script>` 注入此字串，定義全域 `window.Manim`，因此 `code` 執行時即可直接使用。
- 座標系：以 `root` 中心為原點，x 約 -7~7、y 約 -4~4，`+y` 朝上（與 SVG 相反，函式庫內部以 `toSvgY` 處理 y 軸翻轉），對應 `Manim.config = { width: 14, height: 8 }`；`Manim.createSvg(root)` 會建立一個 `viewBox="-7 -4 14 8"`、`preserveAspectRatio="xMidYMid meet"` 並填滿 `root` 的 `<svg>`。
- `Manim.colors`：manim 慣用色票（`WHITE`/`BLACK`/`GREY`/`BLUE`/`GREEN`/`RED`/`YELLOW`/`PURPLE`/`ORANGE`/`PINK`/`TEAL`，例如 `BLUE = '#58C4DD'`）。
- `Manim.rate.linear/smooth/thereAndBack/rushInto/rushFrom(t)`：manim 標準 rate function（`smooth` 為 5 次方 smoothstep `t*t*t*(10-15t+6t*t)`），輸入/輸出皆為 0~1 進度，可疊加在 `Math.min(t/api.duration,1)` 之上調整動畫的速度曲線。
- `Manim.shapes.circle/square/rectangle/line/arrow/dot/polygon/text(svg, opts)`：建立對應 SVG 形狀並加入 `svg`，回傳 mobject（`{ el, kind, svg }`）；`opts` 可含 `x`/`y`（中心座標，manim 座標系）、`radius`/`size`/`width`/`height`/`points`（`[[x,y],...]`，限 polygon）/`text`，以及 `color`（邊框/線條/文字色，預設 `Manim.colors.WHITE`）、`fill`、`fillOpacity`、`strokeWidth`、`fontSize`。
- `Manim.animate.create/write/fadeIn/fadeOut/grow/shift/rotate/scale/transform(mobject, ...)`：manim 招牌動畫手法，依「目前進度」（0~1）直接設定 mobject 的視覺狀態，可在每次 `onFrame` 重複呼叫（即覆寫，非累加）：
  - `create(m, progress)`：以 `el.getTotalLength()` + `stroke-dasharray`/`stroke-dashoffset` 做「描邊繪製」效果（manim 的 `Create`），並同步淡入 `fill-opacity`；`text`/`dot`/`arrow` 退化為 `fadeIn`。
  - `write(m, progress)`：對 `text` mobject 依進度截斷 `textContent`（manim 的 `Write`）；其他 kind 退化為 `create`。
  - `fadeIn`/`fadeOut(m, progress)`：設定 `opacity`。
  - `grow(m, progress, cx?, cy?)`：以 `(cx,cy)` 為中心由 0 縮放到 1（manim 的 `GrowFromCenter`）。
  - `shift(m, dx, dy, progress)`：依進度位移 `(dx,dy)` 的對應比例（manim 的 `.shift()`）。
  - `rotate`/`scale(m, value, progress, cx?, cy?)`：以 `(cx,cy)` 為中心旋轉/縮放。
  - `transform(from, to, progress)`：交叉淡化兩個 mobject 的 `opacity`；若 `from.kind === to.kind`，額外線性插值兩者共有的幾何屬性（`cx`/`cy`/`r`/`x`/`y`/`width`/`height`/`x1`/`y1`/`x2`/`y2`/`font-size`），近似 manim 的 `Transform`。
- `Manim.lerp(a, b, t)` / `Manim.lerpColor(hex1, hex2, t)`：數值/顏色線性插值（`t` 會被夾在 0~1）。
- 後端 `animationCustomScript.ts` 的系統提示詞已說明上述 API；當使用者要求「manim 風格」（幾何圖形、座標平面、Create/Write/Transform/FadeIn、深色背景＋粉彩配色等）時，LLM 可選擇使用 `window.Manim` 而非從零手刻 Canvas/SVG。一般（非 manim 風格）的 `custom-script` 請求仍可忽略 `window.Manim`。
- 編輯器預覽（§7.5 的 `CustomScriptPreview`）與正式播放使用同一個 `buildCustomScriptSandboxDoc`，因此 `window.Manim` 在兩者皆可用，無需額外設定。
- **v1 範圍**：純 SVG 2D 向量圖形 + 上述動畫手法；不含 LaTeX/MathTex 渲染（需 KaTeX/字型等外部資源，sandbox 禁止網路存取）、不含 `Axes`/`NumberPlane` 座標軸繪製輔助、不含 3D、`transform` 僅做簡單屬性線性插值（非真正路徑變形）。後續版本見 §12。

**播放同步**

- 實際播放時，`useGsapSlideTimeline.ts` 新增一個 effect：每當 `currentTime`/`isPlaying`/`spec`/`pageKey` 變化，對每個 `custom-script` 效果的 iframe `contentWindow` 送出 `{ type: 'sync', t: max(0, currentTime - effect.start), playing: isPlaying }`。
- `EffectOverlay`（`SlideRenderer.tsx`）渲染方式與其他 `OVERLAY_EFFECT_TYPES` 相同（`data-effect-id`、位置/大小取自 `getFocusEffectParams`），內容是一個 `<iframe sandbox="allow-scripts" srcDoc={buildCustomScriptSandboxDoc(effect.code, customScriptDurationSeconds(effect))} />`。**差異**：custom-script 不套用 §5.1 的淡入效果——`buildGsapTimeline.ts` 在 `effect.start` 以 `tl.set(overlay, { autoAlpha: 1 }, effect.start)` 直接顯示（無 0→1 過渡），讓自訂動畫從一開始即完全可見、由其內部腳本自行控制畫面呈現；若設定 `exitDuration`，仍依 §5.3 在 `start + duration + exitDuration` 淡出。

**AI 產生/迭代（多輪對話，兩階段：先規劃步驟、再產生程式碼）**

- `POST /api/pdfs/:id/pages/:n/animation/custom-script`（見 §8）：帶入 `{ prompt, previousCode?, history? }`，後端讀取本頁 OCR 文字作為主題參考，分兩階段呼叫 LLM（皆以**串流**回應）：
  1. **規劃步驟**：以 `generateCustomScriptPlanStream`（`backend/src/services/animationCustomScript.ts`）組成 `messages = [planSystemPrompt, ...history.map(toChatCompletionMessage), { role: 'user', content: userPrompt }]`（`userPrompt` 含 `previousCode`/頁面文字但不含 `plan`），請 LLM 以 `stream: true`（上限 `MAX_CUSTOM_SCRIPT_PLAN_OUTPUT_TOKENS = 1200` tokens）輸出條列式「實作步驟」純文字（每行「數字. 步驟描述」，若有 `previousCode`/`history` 則只列出需新增/修改的步驟）。逐段以 `event: plan-delta`（`{ text }`）送出，完成後以 `event: plan-done`（`{ plan }`）送出完整步驟清單。
  2. **產生程式碼**：以 `generateCustomScriptCodeStream` 組成 `messages = [codeSystemPrompt, ...history.map(toChatCompletionMessage), { role: 'user', content: userPrompt }]`（`userPrompt` 這次另外帶上步驟 1 的 `plan`，置於 `【實作步驟】` 區段），請 LLM 以 `stream: true`（上限 `MAX_CUSTOM_SCRIPT_OUTPUT_TOKENS = 24000` tokens）產生原始 JavaScript 程式碼（非 JSON 包裝，必要時去除 LLM 誤加的 ```` ``` ```` 圍欄）；`codeSystemPrompt` 要求 LLM 依步驟清單撰寫程式碼，並在對應位置以單行註解標示步驟（例如 `// 步驟 1：...`），方便使用者對照步驟手動調整。逐段以 `event: delta`（`{ text }`）送出，完成後以 `event: done`（`{ code }`，完整、已通過檢查的最終程式碼）送出。

  `history`（即 `effect.conversation`，每則 `{ role, content }`，上限 40 筆、每則 2000 字，見 `ConversationMessageSchema`/`CustomScriptAiBodySchema`）讓兩階段 LLM 呼叫皆能取得先前對話脈絡，`previousCode` 則以目前 `effect.code` 帶入提示詞文字中供 LLM 在此基礎上調整。任一階段失敗時送出 `event: error`（`{ code, message }`）並結束串流；步驟 2 的結果需通過 `findUnsafeScriptPattern`/`findCustomScriptContractIssue`/長度檢查後才送出 `done`。整個流程**不會**寫入已儲存的 spec。SSE 事件順序固定為：一或多個 `plan-delta` → 一個 `plan-done` → 一或多個 `delta` → 一個 `done`（或任一階段改為 `error` 並結束）。
- 編輯器（§7.5）以 `generateCustomScriptCode`（`frontend/src/lib/api/pdfs.ts`）消費此 SSE 串流：送出訊息時先以 `appendConversationMessages` 將使用者訊息樂觀加入 `effect.conversation`，並帶入目前 `effect.code`（作為 `previousCode`）與 `effect.conversation`（作為 `history`）；呼叫時傳入 `{ onPlanDelta, onPlanDone, onDelta }` 回呼。`plan-delta` 即時累積顯示於對話框中的「規劃中」泡泡（`usePageAnimation.ts` 的 `customScriptStreamingPlan`，依 effect id 索引；空字串時顯示 `play.animation.customScriptPlanBusy`）；`plan-done` 時將完整步驟清單（加上 `play.animation.customScriptPlanLabel` 前綴）以 assistant 訊息加入 `conversation` 並清除該串流暫存。接著 `delta` 即時累積顯示於程式碼編輯器（`customScriptStreamingCode`，依 effect id 索引），此時對話框改顯示一般忙碌泡泡（`play.animation.customScriptGenerateBusy`）；`done` 時寫入該效果的 `code`（其中含步驟註解）並於 `conversation` 追加一則完成訊息（`play.animation.customScriptDone`），`error` 則於 `conversation` 追加對應錯誤訊息並設定 `animationError`（`UNSAFE_SCRIPT`/`INVALID_SCRIPT_CONTRACT` 對應專屬訊息，其餘為通用錯誤；此時步驟串流暫存亦會清除）。使用者可持續在對話框輸入新訊息（例如「改成藍色」）迭代調整，直到滿意為止；最終仍需按「儲存動畫」才會持久化（含 `conversation`）。

**v1 範圍與後續**

- v1 提供的是「通用」的 sandboxed 自訂腳本框架 + AI 生成/迭代迴圈，使用者可請 AI 產生任意 Canvas/SVG 視覺化（在無外部資源的限制下）。
- TODO 原始需求中「載入 MNIST 資料集、用 ResNet50 產生 embedding、PCA 降維顯示分類過程」這類具體範例，因需要外部資料集/模型推論管線（且 sandbox 禁止網路存取），**v1 不內建此資料集/模型管線**；使用者仍可請 AI 產生「視覺上模擬」此類分類器訓練過程的動畫（以程式產生的示意資料點），但不會是真實 MNIST/ResNet50/PCA 計算結果。真正串接資料集與模型推論留待後續版本（見 §12）。

## 6. 前端架構

### 6.1 新增檔案

```text
frontend/src/components/slide/
├── SlideRenderer.tsx        # 依 render_type/spec 分流 static 或 gsap
├── useGsapSlideTimeline.ts  # timeline 建立/seek/play/pause/timeScale/kill
└── buildGsapTimeline.ts     # 白名單 preset → tween

frontend/src/lib/animationSpec.ts  # 前端型別 + default spec + resolveAnimationSpec
frontend/src/lib/subtitles.ts      # 逐字稿切句與每句起訖時間估算（字幕高亮、動畫同步共用）
frontend/src/pages/play/
├── AnimationEditorTab.tsx
└── usePageAnimation.ts
```

### 6.2 SlideRenderer

Props：`renderType`、`src`（由呼叫端算好，含 displayedImageSrc 防閃爍邏輯）、`alt`、`imgClassName`、`imgStyle`、`imgRef`（callback ref merge）、`onImgClick`、`imgProps`、`spec`、`currentTime`、`isPlaying`、`playbackRate`、`pageKey`（換頁重建 timeline）、`onAnimationError`、`children`（進 stage 的疊加層）、`overlay`（stage 外、clip 框內的元素，如版本按鈕）。

`renderType === 'static-image' || !spec?.enabled || effects 為空 || 動畫錯誤` 時走 static 分支，DOM 與現行完全一致。

### 6.3 播放同步原則

- 初始化後先 `pause()`，建好後立即 `seek(currentTime)` 對齊。
- 換頁（pageKey 變更）重建 timeline；unmount / 重建前 `kill()` + `clearProps`。
- `isPlaying` 變更 → `play()` / `pause()`；`playbackRate` 變更 → `timeScale()`。
- `currentTime` 與 `tl.time()` 差距 > 0.3s → `seek()`（涵蓋拖 seek bar 與 follower 同步）。
- 動畫 JSON 載入失敗或 GSAP 錯誤 → kill + clearProps 退回靜態圖片，顯示非阻斷式警告。

### 6.4 縮圖不改寫

縮圖仍用 `<img />`；`render_type === 'gsap-image'` 時加「動畫」小標記。

### 6.6 效果 overlay（EffectOverlay）

`highlight-box`/`spotlight`/`text-callout`/`custom-script` 效果（`OVERLAY_EFFECT_TYPES`，定義於 `frontend/src/lib/animationSpec.ts`）以額外的疊加 `<div>`（或 `custom-script` 為 `<iframe>`）實作，渲染於 animated stage 內（`img` 與 `children` 之後）：

- `SlideRenderer.tsx` 對 `spec.effects` 中屬於 `OVERLAY_EFFECT_TYPES` 的每個效果，渲染一個帶 `data-effect-id={effect.id}` 的元素（`EffectOverlay`），初始 `opacity: 0`、`position: absolute`、`pointer-events: none`，位置/大小取自 `getFocusEffectParams(effect)`（`xPct`/`yPct`/`widthPct`/`heightPct`，含預設值）；`text-callout` 額外以 `effect.text` 作為文字內容，`custom-script` 則為 `<iframe sandbox="allow-scripts" srcDoc={buildCustomScriptSandboxDoc(effect.code)} />`（詳見 §5.4）。
- `buildGsapTimeline.ts` 透過 `stage.querySelector('[data-effect-id="..."]')` 找到對應 overlay，對其 `autoAlpha` 做 `fromTo(0 → 1)`（與 `fade-in` 相同手法，但作用對象是 overlay 而非整個 stage）。
- overlay 是 `stage` 的子元素，因此會跟著 `stage` 的 pan/zoom transform 一起移動縮放，位置（百分比座標）相對於投影片內容維持不變。
- static 分支（無動畫）不渲染 overlay。

### 6.5 逐字稿同步解析（resolveAnimationSpec）

字幕高亮原本就需要「整頁逐字稿切句」與「每句估計起訖時間」，動畫的 `startTrigger` 直接重用同一份計算，避免兩套估時邏輯不一致：

- `splitScriptIntoSentences(script)` 與 `buildSentenceTimeline(sentences, duration)` 從 `PlayPage.tsx` 抽出至 `frontend/src/lib/subtitles.ts`，回傳 `SentenceTimelineItem[]`（`{ text, start, end }`，單位秒）。
- `PlayPage.tsx` 以 `useMemo` 計算：
  - `pageSentences = splitScriptIntoSentences(currentScript)`，依賴 `[currentScript]`。
  - `sentenceTimeline = buildSentenceTimeline(pageSentences, duration)`，依賴 `[pageSentences, duration]`（**不**依賴 `currentTime`，避免每次 `timeupdate` 都重算）。
  - `activeSentenceIdx`（字幕高亮用）改為消費同一份 `sentenceTimeline`，依賴 `[pageSentences, sentenceTimeline, currentTime]`。
- `frontend/src/lib/animationSpec.ts` 新增 `resolveAnimationSpec(spec, sentenceTimeline)`：
  - 若 `spec` 內沒有任何效果設定 `startTrigger`，直接回傳原物件參照（不做任何複製）。
  - 否則回傳一份新 spec，其中每個有 `startTrigger` 的效果，其 `start` 被改寫為 `sentenceTimeline[startTrigger.line].start`；若該 index 不存在（逐字稿被編輯），則保留原本 `start`。
- `PlayPage.tsx` 的 `currentAnimationSpec` 計算方式：

  ```ts
  const rawAnimationSpec = editTab === 'animation' && animationDraft ? animationDraft : animationSavedSpec;
  const currentAnimationSpec = useMemo(
    () => resolveAnimationSpec(rawAnimationSpec, sentenceTimeline),
    [rawAnimationSpec, sentenceTimeline],
  );
  ```

  `resolveAnimationSpec` 在無 `startTrigger` 時回傳同一個物件參照，因此 `currentAnimationSpec` 的參照只在「`rawAnimationSpec` 真的變了」或「`sentenceTimeline` 真的變了（句子數或 duration 改變）」時才改變，`useGsapSlideTimeline` 不會因為每次渲染都拿到新物件而頻繁重建 timeline。
- `sentenceTimeline` 同時透過 `PlayPageContext` 提供給 `AnimationEditorTab.tsx`，作為「依逐字稿句子」起始時間模式的句子下拉選單與秒數預覽資料來源（見 §7）。

## 7. 動畫編輯器 Tab

編輯區由四個 Tab（逐字稿/提示詞/系統資料/來源）擴充為五個，`EditTab` 增加 `'animation'`。

最小 UI：啟用 checkbox、效果清單（type select / start / duration / ease / 刪除）、新增效果、從頭預覽（先儲存 → 音訊 seek 0 → play）、儲存。

效果類型為 `highlight-box`、`spotlight` 或 `text-callout`（`OVERLAY_EFFECT_TYPES`）時，效果列額外顯示「焦點位置與大小（%）」四個數字輸入框（X / Y / 寬 / 高，0~100，整數），對應 `effect.params.{xPct,yPct,widthPct,heightPct}`；未設定時顯示預設值（30/30/40/40），輸入會夾在 0~100 並寫回 `params`。

效果類型為 `text-callout` 時，另額外顯示「文字內容」文字輸入框，對應 `effect.text`（純文字，上限 80 字 = `MAX_TEXT_CALLOUT_LENGTH`）。

效果類型為 `highlight-box`、`spotlight` 或 `text-callout`（`OVERLAY_EFFECT_TYPES`）時，再額外顯示「顯示後自動消失」控制項（`play.animation.exitDuration`）：一個 checkbox 加一個秒數輸入框（0~600，步距 0.1，預設 2 秒 = `DEFAULT_EXIT_DURATION_SECONDS`）。勾選後寫入 `effect.exitDuration`，對應 §5.3 的自動淡出行為；取消勾選則將 `exitDuration` 設為 `undefined`，回到「淡入後常駐顯示」的既有行為。

### 7.1 起始時間方式（依秒數 / 依逐字稿句子）

每個效果新增「起始時間方式」下拉（`play.animation.startMode`），二擇一：

- **依秒數**（預設、`startTrigger` 為 `undefined`）：維持原本的 `start` 數字輸入框。
- **依逐字稿句子**（`startTrigger = { type: 'transcript-line', line, offsetSeconds? }`）：數字輸入框改為「句子」下拉選單，列出 `pageSentences`（`1. <句子前 18 字>…`），其旁新增「提前秒數」數字輸入框（`offsetSeconds`，0~60，預設 0，步距 0.1），並在下方顯示「預估開始：X.X 秒」（取自 `resolveStartTriggerSeconds(startTrigger, sentenceTimeline)` = `sentenceTimeline[line].start - offsetSeconds`，下限 0）。

切換行為：

- 切到「依逐字稿句子」：若效果尚未設定 `startTrigger`，預設指向第 1 句（`line: 0`，`offsetSeconds` 未設定）；已設定者保留原本的 `line`/`offsetSeconds`。
- 切回「依秒數」：將目前換算出的秒數（`resolveStartTriggerSeconds(startTrigger, sentenceTimeline)`，找不到則沿用舊 `start`）寫回 `start`，並清除 `startTrigger`，讓使用者接手微調。

若該頁尚未有逐字稿（`pageSentences.length === 0`），「依逐字稿句子」選項停用；若效果已設定 `startTrigger` 但本頁逐字稿為空，顯示「本頁尚無逐字稿」提示文字而非空白下拉選單。

`pageSentences` 與 `sentenceTimeline` 透過 `PlayPageContext` 提供給 `AnimationEditorTab.tsx`（與字幕高亮共用同一份計算結果，見 §6.5）。

狀態流（`usePageAnimation.ts`）：

- `savedSpec`：最後一次自 server 載入或儲存成功的 spec。
- `draft`：編輯中副本；切到動畫 Tab 或 render_type 為 gsap-image 時載入。
- 換頁時清空並重載（AbortController 防 race）。
- 儲存成功後以 `setDetail` 就地更新該頁 `render_type` / `animation_spec_url`。
- renderer 吃 `effectiveSpec = (editTab === 'animation' && draft) ? draft : savedSpec`，編輯立即預覽、免儲存。

### 7.2 自動產生逐字稿焦點動畫

新增「🪄 自動產生逐字稿焦點動畫」按鈕（`play.animation.autoGenerateFocus`），位於「＋ 新增效果」按鈕旁。

行為：

- 透過 `generateFocusEffectsFromTranscript(pageSentences.length)`（`frontend/src/lib/animationSpec.ts`）為本頁每一句逐字稿產生一個 `highlight-box` 效果，數量上限為 `MAX_SLIDE_ANIMATION_EFFECTS`（20）；每個效果：
  - `startTrigger = { type: 'transcript-line', line }`（`line` 為句子索引，從 0 開始，依序對應每一句）。
  - `duration = 1.2`、`ease = 'power1.out'`、`params` 未設定（套用 §5.1 預設焦點位置 30/30/40/40）。
- 點擊後會以產生結果**取代**目前的 `draft.effects`，並將 `enabled` 設為 `true`；若目前已有效果設定，會先以 `window.confirm` 確認是否覆蓋。
- 本頁尚無逐字稿（`pageSentences.length === 0`）時按鈕停用，提示文字沿用「本頁尚無逐字稿」（`play.animation.noTranscript`）。
- 產生後每個效果仍可於效果清單中個別調整類型、起始時間、長度、緩動與焦點位置/大小，與手動新增的效果一致。
- 本功能僅在編輯器內提供「一次性產生」的手動操作；TODO 第 720 項所述「打開功能後，產生語音時自動產生」的常駐設定與後端管線整合留待後續項目（見 §12）。

### 7.3 逐字稿動畫指引

當本頁有逐字稿（`pageSentences.length > 0`）時，「自動產生逐字稿焦點動畫」按鈕下方新增「逐字稿動畫指引」區塊（`play.animation.hints`）：

- 上方顯示說明文字（`play.animation.hintsDescription`），告知使用者這些指引未來會作為 AI 自動產生動畫時的參考依據（V2，見 §12）。
- 為 `pageSentences` 中的每一句顯示一行：左側為該句完整文字（`<idx+1>. <句子>`），右側為一個文字輸入框（`play.animation.hintsPlaceholder`），對應 `draft.hints?.[String(idx)]`（選填，上限 200 字 = `MAX_HINT_LENGTH`）。
- 輸入框內容變更時即時寫回 `draft.hints`；輸入框清空時會從 `hints` 中移除該 key，整個物件變為 `{}` 時改寫為 `undefined`，避免儲存無意義的空欄位。
- 與效果清單一樣隨 `handleSaveAnimation` 一併儲存於 `<page_uid>.animation.json`；本次不影響任何效果的產生或播放結果。

### 7.4 AI 自動產生焦點動畫

新增「🤖 AI 自動產生焦點動畫」按鈕（`play.animation.autoGenerateFocusAi`），位於「🪄 自動產生逐字稿焦點動畫」按鈕旁。與 §7.2 的固定規則版不同，本功能由 LLM 針對每一句逐字稿個別決定是否顯示效果、效果類型與位置/大小/消失時間。

行為：

- 點擊後呼叫 `POST /api/pdfs/:id/pages/:n/animation/auto-focus-ai`（`generateAiFocusEffects`，`frontend/src/lib/api/pdfs.ts`），帶入 `{ sentences: pageSentences, hints: draft.hints }`。
- 後端（`backend/src/routes/pdfs/page-animation.ts`）讀取本頁 OCR 文字（`text_path`）與本頁渲染圖片（`image_path`，縮小至 `OPENAI_SCRIPT_IMAGE_MAX_WIDTH`、轉 JPEG base64，沿用 `generateScript` 的縮圖設定；讀取失敗則回退為純文字，不中斷）；連同請求中的逐字稿句子、`hints` 一起傳入 `generateAiFocusEffects`（`backend/src/services/animationAutoFocus.ts`）組成提示詞，透過 `callChatJSON`（沿用 `LLM_PROVIDER`/`openaiLlmModel`/`geminiLlmModel` 設定）請 LLM 針對每句（最多 `MAX_SLIDE_ANIMATION_EFFECTS` = 20 句）回傳：
  - `show`：是否顯示效果。
  - `type`：`highlight-box`、`spotlight` 或 `text-callout`（淡入一段 AI 生成的精簡文字摘要，適合用一句重點數據或結論強化畫面）。
  - `xPct`/`yPct`/`widthPct`/`heightPct`：方框（或文字框）位置與大小（百分比，0-100）；`text-callout` 建議放在畫面空白處，避免遮住重點內容。
  - `text`（僅當 `type` 為 `text-callout` 時提供）：要顯示的文案，限制在 `MAX_TEXT_CALLOUT_LENGTH`（80）字以內，並使用與逐字稿相同的語言。
  - `exitDuration`（選填，秒，0-30）：淡入完成後停留多久自動淡出。
- 後端將 `show: true` 的項目轉換為 `AnimationEffect`：`type`/`params`/`exitDuration`/`text`（`text-callout` 時）取自 AI 回應（數值與文字長度會 clamp 到合理範圍），`start = 0`、`duration = 1.2`、`ease = 'power1.out'`、`startTrigger = { type: 'transcript-line', line }`；`show: false` 或重複/超出範圍的 `line` 會被忽略。若 AI 選擇 `text-callout` 卻未提供有效（非空白）`text`，該項目會退回為 `highlight-box`（避免產生空白文字框）。回應 `{ effects: AnimationEffect[] }`，**不會**寫入已儲存的 spec。
- 前端收到 `effects` 後以其**取代**目前的 `draft.effects` 並將 `enabled` 設為 `true`（與 §7.2 相同的覆蓋語意）；若目前已有效果設定，先以 `window.confirm`（`play.animation.autoGenerateFocusAiConfirm`）確認。產生中按鈕顯示忙碌文字（`play.animation.autoGenerateFocusAiBusy`）並停用；完成後顯示提示訊息（`play.animation.autoGenerateFocusAiDone`），失敗則顯示錯誤（`play.animation.autoGenerateFocusAiError`）。
- 本頁尚無逐字稿時按鈕停用，提示文字沿用「本頁尚無逐字稿」（`play.animation.noTranscript`）。
- 產生後仍是一般 `draft.effects`，可於效果清單中個別調整（包含 `text-callout` 的文案內容），並需按「儲存動畫」才會持久化。
- v1 範圍：產生 `highlight-box`/`spotlight`/`text-callout` 三種效果；overlay image、SVG 圖元、物件 target、公式、逐步條列、`custom-script` 等其他效果類型的 AI 生成留待後續版本（見 §12）。
- 圖片輸入：提示詞會說明「若附帶投影片頁面圖片，請參考圖片中的實際版面決定座標」，讓 `xPct`/`yPct`/`widthPct`/`heightPct` 更貼近畫面實際內容；圖片僅在 `LLM_PROVIDER=openai`（預設）時實際送出——Gemini 路徑（`callGeminiJson`/`normalizeMessages`）目前會將非文字內容部分一律替換為 `'[image]'` 占位字串，與 `generateScript` 的既有限制相同，留待後續一併處理。

### 7.5 AI 自訂腳本動畫（custom-script）

效果類型為 `custom-script` 時，效果列下方額外顯示一個區塊（§5.4 的編輯器入口）：

- **對話框**：可捲動的訊息清單，顯示 `effect.conversation`——使用者訊息靠右（紫色系泡泡）、AI 訊息（含實作步驟、完成、錯誤）靠左（灰色系泡泡）；無訊息時顯示提示文字（`play.animation.customScriptChatEmpty`）。產生中於清單底部額外顯示忙碌泡泡：第一階段（規劃步驟）即時顯示 `customScriptStreamingPlan` 累積的串流文字（尚未收到內容時顯示 `play.animation.customScriptPlanBusy`）；第二階段（產生程式碼）顯示一般忙碌泡泡（`play.animation.customScriptGenerateBusy`）。並自動捲動到最新訊息。
- **輸入框**（多行文字，上限 300 字 = `MAX_CUSTOM_SCRIPT_PROMPT_LENGTH`，placeholder 為 `play.animation.customScriptChatInputPlaceholder`）＋「送出」按鈕（`play.animation.customScriptChatSend`，產生中顯示 `customScriptGenerateBusy`）；輸入為空、產生中或效果停用時停用送出。按 Enter 送出、Shift+Enter 換行。
- 送出後呼叫 `handleSendCustomScriptMessage(effectId, message)`（`usePageAnimation.ts`）：先以 `appendConversationMessages` 將使用者訊息樂觀加入 `effect.conversation` 並清空輸入框，再呼叫 `POST /api/pdfs/:id/pages/:n/animation/custom-script`（`generateCustomScriptCode`，`frontend/src/lib/api/pdfs.ts`），帶入 `{ prompt: message, previousCode: effect.code, history: effect.conversation }`，並傳入 `{ onPlanDelta, onPlanDone, onDelta }` 回呼以 SSE 串流消費回應：第一階段 `plan-delta` 累積顯示於對話框的規劃中泡泡（`customScriptStreamingPlan`），`plan-done` 時將完整「實作步驟」清單（加上 `play.animation.customScriptPlanLabel` 前綴）以 assistant 訊息加入 `conversation` 並清除該串流暫存；第二階段 `delta` 即時顯示於 JavaScript 原始碼編輯器（`customScriptStreamingCode`，唯讀），讓使用者看到逐步輸出的程式碼（含對應步驟的單行註解），`done` 時將完整 `code` 寫回該效果並於 `conversation` 追加完成訊息（`play.animation.customScriptDone`）後清除串流暫存，編輯器恢復可編輯。失敗則於 `conversation` 追加錯誤訊息並於 UI 顯示錯誤（`animationError`），同時清除任何尚未完成的 `customScriptStreamingPlan` 暫存——`error` 事件的 `UNSAFE_SCRIPT`/`INVALID_SCRIPT_CONTRACT` 對應專屬訊息（`play.animation.customScriptUnsafe`/`customScriptContractError`），其餘（含網路錯誤、`SCRIPT_TOO_LONG`、空輸出、串流中斷無 `done`）顯示 `customScriptError` 或後端訊息；`customScriptStreamingCode` 內容會保留在編輯器中，方便使用者對照錯誤訊息。
- `effect.code` 尚未產生時顯示提示文字（`play.animation.customScriptEmpty`）；已產生時，下方即時顯示 `CustomScriptPreview`——一個 sandboxed `<iframe>`，以 `requestAnimationFrame` 持續送出 `{ type: 'sync', t, playing: true }`（`t` 在 `0 ~ previewLoopSeconds(effect)` 之間迴圈，`previewLoopSeconds = clamp(customScriptDurationSeconds(effect), 2, 20)`），讓使用者在反覆對話調整時立即看到迴圈播放的結果，無需先儲存或進入播放模式。預覽傳給 sandbox 的 `api.duration` 即為 `previewLoopSeconds(effect)`，與實際播放時的 `customScriptDurationSeconds(effect)` 採同一公式（僅預覽端額外夾在 2~20 秒之間），確保預覽中看到的「一輪」進度與實際播放一致。
- 效果類型為 `custom-script` 時亦適用 §7（效果列）中對 `OVERLAY_EFFECT_TYPES` 共用的「焦點位置與大小（%）」與「顯示後自動消失」控制項。
- 與其他效果一樣，調整完成後需按「儲存動畫」才會持久化；`code`/`conversation` 皆隨 spec 一併儲存，重新進入編輯器可繼續對話迭代。舊版以 `prompt`+`code` 儲存的 spec 仍可載入並繼續以 `code` 作為基礎迭代，僅 `conversation` 從空白開始。

## 8. Backend API

```text
GET  /api/pdfs/:id/pages/:n/animation              → { page_number, render_type, spec }（無檔案回 default spec）
PUT  /api/pdfs/:id/pages/:n/animation              → 驗證、寫 JSON、更新 render_type/animation_spec_path
GET  /api/pdfs/:id/pages/:n/animation/spec         → 純 spec JSON，Cache-Control: no-store
POST /api/pdfs/:id/pages/:n/animation/auto-focus-ai → { effects }（AI 產生，不寫入已儲存 spec，見 §7.4）
POST /api/pdfs/:id/pages/:n/animation/custom-script → SSE（text/event-stream），兩階段：event: plan-delta {text} * → event: plan-done {plan} → event: delta {text} * → event: done {code}；任一階段失敗則改送 event: error {code, message} 並結束（AI 產生/迭代自訂腳本，不寫入已儲存 spec，見 §5.4/§7.5；UNSAFE_SCRIPT/INVALID_SCRIPT_CONTRACT/SCRIPT_TOO_LONG/INTERNAL_ERROR 為可能的錯誤 code）
```

PUT 規則：`spec.enabled === true` → `render_type='gsap-image'`；`false` → `render_type='static-image'`（JSON 保留以便再次啟用）。驗證失敗回 `400 INVALID_ANIMATION_SPEC`。

detail API 的 page 物件增加 `render_type` 與 `animation_spec_url`。

驗證邏輯集中於 `backend/src/services/pageAnimation.ts`（zod），route 於 `backend/src/routes/pdfs/page-animation.ts`；AI 自動產生焦點動畫的提示詞與回應映射集中於 `backend/src/services/animationAutoFocus.ts`；AI 自訂腳本動畫的提示詞、回應驗證與黑名單檢查集中於 `backend/src/services/animationCustomScript.ts`。

## 9. 錯誤處理與 fallback

- 動畫 JSON 載入失敗 → 顯示 JPG、照常播音訊、顯示非阻斷式警告。
- spec 檔損毀 → 後端讀取時回 default spec，不回 500。
- GSAP runtime 錯誤 → kill timeline、`gsap.set(stage, { clearProps: 'all' })`、退回靜態顯示、console.error、非阻斷警告。

## 10. 與現有功能的相容性

- 字幕：依音訊 currentTime 顯示，置於 renderer 外層，不跟著縮放平移。
- 手寫標註 / 圖片局部選取：置於 animated stage 內，跟著圖片移動；normalized 座標映射不受 transform 影響。
- 教室同步：follower 載入相同 JSON，收到 `current_time` 即 seek，不需同步每個動畫物件。
- 全螢幕：image 與 split/edit 模式皆用同一 renderer。
- 影片輸出：維持靜態 JPG fallback，不輸出 GSAP 動畫。

## 11. 驗收條件（摘要）

靜態頁面：舊簡報免手動 migration 正常播放；`render_type` 未提供視為 static-image；播放/全螢幕/縮圖/手寫/選取與現行一致。

動畫頁面：可啟用、可新增/修改/刪除效果、儲存後重整保留、從頭預覽自 0 秒播放、seek 跳至正確位置、暫停即停、1.5x 同步加速、換頁無殘留 transform、載入失敗退回靜態圖。

同步播放：master/follower 顯示相同動畫頁面；follower 收到 seek 後跳至相同位置；reload 後可恢復。

逐字稿同步：效果設為「依逐字稿句子」並儲存後，重整可保留設定；播放到對應句子時動畫準時開始；逐字稿被編輯導致該行不存在時，效果退回原本 `start` 秒數而非報錯。

## 12. 後續擴充方向

- V1.1：~~drawing mode 自動暫停~~（已於 `PlayPage.tsx` 新增 `useEffect`，當 `drawingMode` 變為 `true` 時自動呼叫 `audioRef.current?.pause()`，避免講者繪圖時投影片自動切換或動畫繼續播放；分支 `feature/drawing-mode-auto-pause-20260615`）、~~preset 快速套用~~（已於動畫編輯器「新增效果」按鈕旁新增「套用範本」下拉選單，選擇後依範本預設值新增一個效果，例如「標題淡入」、「鏡頭推進強調」、「向左移動鏡頭」、「紅框圈選重點」、「聚光燈聚焦」、「左下角文字說明」、「指標標示」，涵蓋常用 type/duration/ease/exitDuration/params 組合，新增後仍可自行調整；分支 `feature/animation-effect-presets-20260615`）、~~raw JSON 檢視~~（已於動畫編輯器新增「原始 JSON」分頁，以唯讀 `<textarea>` 顯示 `JSON.stringify(draft, null, 2)` 並提供「複製 JSON」按鈕；分支 `feature/animation-effects-raw-json-view-20260615`）、~~效果排序~~（已於動畫編輯器效果卡片新增「上移／下移」按鈕，調整 `AnimationSpec.effects` 陣列順序，同時決定重疊 overlay 效果的疊加層次；分支 `feature/animation-effects-reorder-20260615`）、~~跨頁複製~~（已於動畫編輯器新增「複製本頁效果」／「貼上效果」按鈕：複製結果存於不隨頁面切換清空的本地狀態，貼上時為每個效果產生新的 `id` 並附加到目前頁面的效果清單，上限為 `MAX_SLIDE_ANIMATION_EFFECTS`；分支 `feature/animation-effects-cross-page-copy-20260615`）、~~為 `fade-in`/`zoom-*`/`pan-*` 等整頁 transform 效果提供對稱的「消失（恢復原狀）」可選機制（見 §5.3）~~（已將 `exitDuration` 擴展至 `TRANSFORM_EFFECT_TYPES`：設定後 `buildGsapTimeline.ts` 會在 `start+duration+exitDuration` 時間點新增一個將 `stage` 動畫回進場前狀態的 `to()` tween（進場 tween 的反向，相同 `duration`/`ease`），動畫編輯器的「顯示後自動消失」控制項同步顯示於 transform 效果並改用「完成後自動恢復原狀」文案；分支 `feature/animation-transform-exit-revert-20260615`）。
- V2：overlay image（小圖疊加內容）、SVG 圖元、物件 target、公式、逐步條列；依 `AnimationSpec.hints` 與逐字稿內容由 LLM 生成動畫 JSON——焦點方框（`highlight-box`/`spotlight`）的時機與位置已於 §7.4 落地，~~`text-callout`（含 AI 生成文案）的 AI 生成~~（已將 `auto-focus-ai` 的 `AUTO_FOCUS_AI_EFFECT_TYPES` 擴充為 `highlight-box`/`spotlight`/`text-callout`，LLM 可為適合以精簡摘要強化重點的句子選擇淡入一段 AI 生成文案（`text`，上限 `MAX_TEXT_CALLOUT_LENGTH` = 80 字），缺少有效文字時退回 `highlight-box`；分支 `feature/animation-auto-focus-ai-text-callout-20260615`）；`custom-script` 等其他效果類型的 AI 生成仍待後續。
- V2.x：`custom-script`（§5.4）的資料集/模型推論管線——例如載入 MNIST 並以 ResNet50 產生 embedding、PCA 降維至二維後動態顯示分類過程——需要後端提供資料集存取與模型推論服務（sandbox 本身禁止網路存取，無法在前端直接載入外部資料）；v1 僅提供通用 sandboxed 自訂腳本框架與 AI 生成/迭代迴圈，不含此類資料管線。
- V2.x：`window.Manim`（manim 風格輔助函式庫，§5.4）的擴充——`Axes`/`NumberPlane`（座標軸、格線、`coordsToPoint`）、`MathTex`/`Tex`（需離線 vendored KaTeX 字型，避免 sandbox 網路存取限制）、`transform` 的真正路徑變形（path morphing，而非目前僅線性插值共有屬性）、3D 場景；v1 僅提供 2D SVG mobject（`circle`/`square`/`rectangle`/`line`/`arrow`/`dot`/`polygon`/`text`）與 `Create`/`Write`/`FadeIn`/`FadeOut`/`Transform`/`Shift`/`Rotate`/`Scale`/`GrowFromCenter` 等基本動畫手法。
- V3：視覺化時間軸、關鍵影格、3D renderer、動畫 MP4 匯出。

## 13. custom-script V1 hardening checklist

V1 的「使用提示詞生成動畫」以 `custom-script` 效果交付，重點是安全、可迭代、可播放同步，而非真實資料集或模型推論：

- 使用者在動畫 Tab 新增 `custom-script` 效果，於對話框輸入訊息後呼叫 `POST /api/pdfs/:id/pages/:n/animation/custom-script` 產生 JavaScript（連同 `effect.conversation` 作為 `history` 一併送出）；回傳結果只寫入前端 draft，必須再按「儲存動畫」才會持久化到 `<page_uid>.animation.json`。
- 產生程式碼前，後端先請 LLM 將提示詞轉換成一份條列「實作步驟」（`plan-delta`/`plan-done`），即時顯示於對話框；再依此步驟清單產生程式碼，並要求 LLM 在程式碼對應位置以單行註解標示每個步驟（例如 `// 步驟 1：...`），方便使用者對照步驟手動調整。
- 產生的程式碼必須符合 `window.renderAnimation(root, api)` 與 `api.onFrame(callback)` 契約；後端會拒絕明顯缺少契約的輸出，前端 sandbox 也會在缺少 `renderAnimation` 時顯示錯誤訊息。
- 程式碼在 `<iframe sandbox="allow-scripts">` 中執行，不含 `allow-same-origin`，並且後端會額外拒絕 `fetch`、`XMLHttpRequest`、`WebSocket`、`import`、`require`、`eval`、`new Function`、storage、cookie、parent/top/frameElement 等高風險 API。
- 播放時 host 端以音訊 currentTime 為主時鐘，對每個 `custom-script` iframe 送出 `{ type: 'sync', t, playing }`；`t` 是相對該 effect 起始時間的秒數，支援 seek、暫停、重播與和其他 GSAP/overlay 效果一起播放。
- 動畫長度由效果設定決定，而非由 AI 自行假設：sandbox 在建立時注入 `api.duration = customScriptDurationSeconds(effect)`（= `effect.duration + (effect.exitDuration ?? 0)`），LLM 提示詞要求以 `Math.min(t / api.duration, 1)` 計算進度，於 `t: 0 → api.duration` 播放「一輪」後維持最終畫面（不重置/不循環）；效果本身再依 `exitDuration`（§5.3）整體淡出消失。
- 編輯器預覽同樣使用 sandbox iframe，以迴圈時間送出 sync 訊息（迴圈長度 = `previewLoopSeconds(effect)`，與 `api.duration` 同一公式但夾在 2~20 秒），讓使用者能透過多輪對話反覆調整直到滿意。
- 編輯器主效果列對 `custom-script` 保持簡化：不顯示 X/Y/W/H 與 ease（速度變化）欄位，只顯示「編輯動畫」按鈕與基本時間控制。對話框、JavaScript 原始碼與 sandbox display preview 皆移至獨立對話框中。
- `custom-script` 對話框提供 JavaScript 原始碼編輯器；使用者可在 AI 產生後手動修改 `effect.code`，或直接貼上自寫程式。手動修改會即時更新 sandbox 預覽，並在按「儲存動畫」後與 spec 一起持久化。
- 若 LLM 產生了不安全或不符合契約的程式，前端顯示可行的重試提示，不會儲存或播放該程式。
- sandbox 在使用者 `code` 之前注入 `window.Manim`（`frontend/src/lib/manimHelperScript.ts` 的 `MANIM_HELPER_SCRIPT`），提供 manim 風格座標系、色票、rate function、SVG mobject 形狀與 `Create`/`Write`/`FadeIn`/`FadeOut`/`Transform`/`Shift`/`Rotate`/`Scale`/`GrowFromCenter` 動畫；後端系統提示詞已說明此 API，使用者要求「manim 風格」時 LLM 可直接呼叫，詳見 §5.4。

手動 QA 建議：

1. 新增 `custom-script` 效果，於對話框輸入「用 Canvas 畫出多群資料點移動到二維特徵空間並形成分類邊界」之類訊息，確認可產生、預覽、儲存、重新整理後保留（含對話紀錄）。
2. 在同一對話框繼續輸入修改指示（例如「把背景改成深色」），確認對話紀錄保留前一輪內容、目前列顯示 busy，生成完成後 iframe 重新載入新結果且對話框出現完成訊息。
3. 在 JavaScript 原始碼編輯器中手動修改顏色、速度或文字，確認預覽即時更新，儲存後重新整理仍保留修改。
4. 播放、暫停、seek、從頭預覽、換頁再回來，確認動畫時間與音訊一致且不殘留舊 iframe 狀態。
5. 調整效果的「時長」與「顯示後自動消失」秒數後，於對話框送出任一訊息觸發重新產生，確認動畫的「一輪」長度（progress 從 0 到 1 的時間）隨之改變，且播放到底後畫面停留在最終狀態、不會自行重置重播；效果在 `exitDuration` 後依既有淡出機制消失。
6. 嘗試要求「用 fetch 載入外部 MNIST」或「使用 localStorage」，確認後端回拒絕訊息且 draft 不被寫入不安全 code。
7. 確認此 v1 只能模擬 MNIST/embedding/PCA 類視覺過程；真正的 MNIST、ResNet50 embedding 與 PCA 計算需後續資料/模型推論服務。
8. 輸入「用 manim 風格畫一個圓形 Transform 成正方形，並用 Write 顯示一段文字說明」之類提示詞，確認產生的程式碼使用 `window.Manim`（例如 `Manim.shapes.circle`/`Manim.animate.create`/`Manim.animate.transform`/`Manim.animate.write`），預覽中可看到深色背景＋manim 配色、描邊繪製與文字逐字顯示效果，且隨 `t` 從 0 到 `api.duration` 播放一輪後停留在最終畫面。
