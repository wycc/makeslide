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

easing 白名單：`none`、`power1.in`、`power1.out`、`power1.inOut`、`power2.inOut`。

驗證規則：`start >= 0`、`0 < duration <= 600`、`effects.length <= 20`、`target === 'slide'`、type/ease 必須在白名單、`params` 只接受該 effect type 已定義的數值欄位（未知鍵直接過濾）。

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

## 8. Backend API

```text
GET /api/pdfs/:id/pages/:n/animation        → { page_number, render_type, spec }（無檔案回 default spec）
PUT /api/pdfs/:id/pages/:n/animation        → 驗證、寫 JSON、更新 render_type/animation_spec_path
GET /api/pdfs/:id/pages/:n/animation/spec   → 純 spec JSON，Cache-Control: no-store
```

PUT 規則：`spec.enabled === true` → `render_type='gsap-image'`；`false` → `render_type='static-image'`（JSON 保留以便再次啟用）。驗證失敗回 `400 INVALID_ANIMATION_SPEC`。

detail API 的 page 物件增加 `render_type` 與 `animation_spec_url`。

驗證邏輯集中於 `backend/src/services/pageAnimation.ts`（zod），route 於 `backend/src/routes/pdfs/page-animation.ts`。

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

- V1.1：drawing mode 自動暫停、preset 快速套用、raw JSON 檢視、效果排序、跨頁複製。
- V2：overlay text、SVG 圖元、物件 target、公式、逐步條列、LLM 生成動畫 JSON。
- V3：視覺化時間軸、關鍵影格、3D renderer、動畫 MP4 匯出。
