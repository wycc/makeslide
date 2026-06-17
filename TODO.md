
- [x] 首頁簡報清單新增排序選項：目前 `HomePage.tsx` 固定以分類分組且分類內用標題排序，近期分類才使用建立時間倒序；應新增「排序方式」select，支援 `title_asc`（現有預設）、`created_desc`、`updated_desc`、`page_count_desc`，將排序偏好存入 localStorage（例如 `makeslide.home.sortMode`），並在一般分類與「最近」分類中一致套用；中英文 i18n 新增 `home.sortBy`、`home.sort.titleAsc/createdDesc/updatedDesc/pageCountDesc`。

- [x] 首頁標題搜尋支援清除按鈕與結果摘要：目前 `HomePage.tsx` 已有 `titleFilter` 並持久化，但輸入後需手動刪除文字且沒有顯示符合筆數；應在搜尋框右側新增「清除」按鈕（有文字時顯示），並在篩選區顯示 `顯示 {shown} / {total} 份簡報`，同時補齊中英文 i18n；此項僅調整前端狀態與 UI，不改 API。

- [x] `PdfCard` 新增總語音長度顯示：`PdfListItem` 已包含 `total_audio_duration_seconds`，但卡片目前只顯示建立時間與頁數；應在卡片資訊列加入格式化後的總語音長度（如 `12:34` 或 `1:02:03`），無資料時不顯示；新增共用或本地 formatter 測試可覆蓋秒數、分鐘、小時與 null/undefined 情境。

- [x] ZIP 匯入成功後自動開啟提示詞視窗：目前 `HomePage.tsx` 的 `handleImportZipChange()` 匯入成功後只 `setItems()` 與 toast，PDF 上傳則會自動開啟 `PromptModal`；應讓 ZIP 匯入成功也呼叫既有 `openPromptFor(imported)`，讓使用者能立即補提示詞並開始處理；若匯入檔案已含 `user_prompt`，應沿用初始值。

- [x] YouTube 匯入面板新增常用字幕語言快速選項：目前 `UploadButton.tsx` 需手輸 `youtubeLang`；應在輸入框旁加入快速按鈕或 select，支援 `zh-TW`、`en`、`ja`、`auto`，點選後填入語言欄位；`auto` 送出時以空字串或 undefined 表示自動選擇；補齊中英文 i18n 與基本互動測試。

- [x] 播放頁新增「清除本簡報播放進度」控制：`PlayPage.tsx` 已以 `makeslide.playback.progress.{pdfId}` 儲存頁碼與時間並自動恢復，但使用者無法手動重置；應在播放設定或頁首新增按鈕，清除該 localStorage key、將 `currentIdx` 與 `currentTime` 重設為 0，並顯示 toast/狀態訊息；分享唯讀模式仍可清除本機進度。

- [x] 本頁產生耗時區塊新增總耗時與異常摘要：`PageTimingChips.tsx` 已顯示 image/text/script/audio 四個 chip；應計算已完成 artifact 的總 `duration_ms`，在標題列顯示「總計 {duration}」，若任一 artifact 為 failed 或 SLA breached，額外顯示小型警示摘要（例如 `2 項需注意`），tooltip 保留既有細節；補齊格式化測試與 i18n。

[x] `text-callout` 效果新增內距選項 `textCalloutPadding`：目前固定使用 `'0.5em 0.75em'`；應新增 `textCalloutPadding?: 'sm' | 'md' | 'lg'`（預設 `'md'`），對應 `sm='0.25em 0.5em'`、`md='0.5em 0.75em'`（現有預設）、`lg='0.75em 1.25em'`；後端同步更新 `AnimationEffect`/`EffectSchema`（`z.enum(['sm','md','lg']).optional()`）/序列化；前端 `types.ts` 新增欄位；`SlideRenderer.tsx` 以 padding map 取代硬編碼字串；`AnimationEditorTab.tsx` 在 text-callout 設定區加入 select 選擇器；中英文 i18n 新增翻譯鍵（`play.animation.textCalloutPadding`、`play.animation.textCalloutPadding.sm/md/lg`）。

[x] Manim `animate.blink(m, progress, opts)` 閃爍效果：新增 `animate.blink(m, progress, opts)` 函式，讓元素 opacity 以週期性 on/off 閃爍；以 `Math.floor(progress * cycles * 2) % 2 === 0 ? 1 : 0` 計算每個時間點的 opacity（偶數半週期亮、奇數半週期暗）；opts 支援 `cycles`（閃爍次數，預設 3）和 `minOpacity`（暗相位最小 opacity，預設 0）；progress=1 時恢復 opacity=1 並清除殘留；新增至少 2 個 vm 測試（驗證 progress=0.5 時 opacity 符合閃爍規律，驗證 progress=1 時 opacity='1'）。

[x] Manim `animate.colorCycle(m, progress, opts)` 顏色循環效果：新增 `animate.colorCycle(m, progress, opts)` 函式，讓元素的 stroke 在多個顏色之間循環變化（如 ROYGBIV 彩虹效果）；opts 支援 `colors`（hex 色碼陣列，必填，至少 2 色）和 `attr`（`'stroke'`|`'fill'`|`'both'`，預設 `'stroke'`）；以 `progress * (colors.length - 1)` 計算當前位置，用 `lerpColor` 在相鄰兩色插值；progress=1 時設為最後一色；新增至少 2 個 vm 測試（驗證中間 progress 顏色在兩色之間、驗證 progress=1 等於最後一色）。

[x] `pointer` 效果新增可見時透明度選項 `pointerOpacity`：目前 pointer 在可見時固定 opacity=1；應新增 `pointerOpacity?: number`（0–1，預設 1）讓指針在可見狀態的不透明度可調整（半透明指針適合不遮擋內容的場景）；後端同步更新 `AnimationEffect`/`EffectSchema`（`z.number().min(0).max(1).optional()`）/序列化（帶 min/max clamp）；前端 `types.ts` 新增欄位；`buildGsapTimeline.ts` 中 pointer 效果的 gsap to() 目標 opacity 改為 `effect.pointerOpacity ?? 1`（目前可能硬編碼為 1）；`AnimationEditorTab.tsx` 加入 range slider 或 number input（min=0.1, max=1, step=0.1）；中英文 i18n 新增 `play.animation.pointerOpacity`（'Opacity'／'透明度'）。

[x] 將系統設定項重改成左邊是 navigation bar，右邊是同一類別的設定的形式。把所有設定分類放到不同頁中。
[ ] 降低 jpeg 的畫質，目前每個檔1.3MB 太大了，請準備一個 749x500 的縮圖。只有在全螢幕才用全圖。
[ ] 建立分享功能連結時，每一個簡報可以獨立的設定分享成 private, read-only or read-write。當設定成分 read-only/read-write 時，除了使用分享連接外，簡報會自動出現在其它帳號的列表中。

---

- 時間: 2026-06-17 22:30:00 +0800
- 分支: workspace-current
- 內容: 依照 LOOP.md 在 TODO.md 已無未完成項目時重新檢視主要程式區塊。快速檢查首頁清單/分類與搜尋、卡片資訊、PDF/ZIP/YouTube 匯入流程、播放頁進度恢復、本頁產生耗時顯示，以及後端管線進度與設定頁現況後，新增 7 個偏小型且可分次完成的功能改進：(1) 首頁排序選項；(2) 搜尋清除與結果摘要；(3) 卡片總語音長度；(4) ZIP 匯入後開啟提示詞；(5) YouTube 字幕語言快速選項；(6) 清除本簡報播放進度；(7) 本頁耗時總計與異常摘要。

- 時間: 2026-06-17 22:35:00 +0800
- 分支: workspace-current
- 內容: 完成首頁簡報清單排序選項。`HomePage.tsx` 新增 `SortMode`、`makeslide.home.sortMode` localStorage 持久化、排序 comparator 與「排序方式」select；支援標題 A-Z、建立時間新到舊、更新時間新到舊、頁數多到少，並讓一般分類與「最近的簡報」分類都使用相同排序邏輯，不再讓最近分類固定建立時間倒序。同步新增中英文 `home.sortBy` 與 `home.sort.*` i18n，並於 BLOG.md 補充功能目的、使用方式與技術細節。

- 時間: 2026-06-17 22:45:00 +0800
- 分支: workspace-current
- 內容: 完成首頁標題搜尋清除與結果摘要。`HomePage.tsx` 在標題篩選輸入框內新增只於有文字時顯示的「清除」按鈕，點擊會重用既有 `updateTitleFilter('')` 清空畫面狀態與 localStorage；篩選區新增 `顯示 {shown} / {total} 份簡報` 摘要，其中 `shown` 是套用目前分類/最近視圖與 title filter 後的可見數量，`total` 是同一分類/最近視圖下未套用 title filter 的總數。同步新增中英文 `home.clearTitleFilter` 與 `home.resultSummary` i18n，僅調整前端 UI/狀態，不改 API。

- 時間: 2026-06-17 22:55:00 +0800
- 分支: workspace-current
- 內容: 完成 `PdfCard` 總語音長度顯示。新增共用 `formatAudioDuration()`，將 `total_audio_duration_seconds` 格式化為 `M:SS` 或 `H:MM:SS`，並在缺少、null、undefined 或無效資料時回傳 null 讓卡片不顯示；`PdfCard.tsx` 的資訊列現在會在建立時間與頁數旁顯示「語音 {duration}」／「Audio {duration}」，同步補齊中英文 i18n 與 formatter 測試，覆蓋秒數、分鐘、小時、null/undefined 與無效值情境。

- 時間: 2026-06-17 23:00:00 +0800
- 分支: workspace-current
- 內容: 完成 ZIP 匯入成功後自動開啟提示詞視窗。`HomePage.tsx` 將既有 `openPromptFor()` 移到 ZIP 匯入 handler 前方供其使用，並在 `handleImportZipChange()` 的 `importPdfZip()` 成功回傳後先 `setItems()` 再呼叫 `openPromptFor(imported)`，讓匯入完成的簡報立即開啟 `PromptModal` 供使用者補提示詞並開始處理。既有 `openPromptFor()` 已會讀取 `user_prompt` 作為 `initialValue`，因此 ZIP 內若已有提示詞會自動沿用；此修改僅調整前端流程，不改 API。

- 時間: 2026-06-17 23:05:00 +0800
- 分支: workspace-current
- 內容: 完成 YouTube 匯入面板常用字幕語言快速選項。`UploadButton.tsx` 在字幕語言輸入框旁新增 `zh-TW`、`en`、`ja`、`auto` 快速按鈕，點選會直接填入既有 `youtubeLang` 欄位並以 `aria-pressed` 顯示目前選擇；送出時改用 `normalizeYoutubeSubtitleLanguageForSubmit()`，保留明確語言代碼並將空白或 `auto` 轉為 `undefined`，沿用既有 `createYoutubeTask()` payload 的最小改動語意讓後端自動選擇字幕。同步補齊中英文 i18n，並新增 `youtubeLanguage.test.ts` 純函式測試；目前專案沒有元件互動測試依賴，因此先以可測 helper 覆蓋快速選項清單與 `auto` 提交轉換規則。

- 時間: 2026-06-18 03:15:00 +0800
- 分支: workspace-current
- 內容: 完成播放頁「清除本簡報播放進度」控制。`PlayPage.tsx` 新增播放狀態訊息與 `handleClearPlaybackProgress()`，會清除 `makeslide.playback.progress.{pdfId}`、取消尚未寫回的進度 timer、重設恢復位置、停止播放與動畫延長計時、將 `currentIdx`/`currentTime` 與 audio element 回到 0，並顯示短暫狀態訊息；此操作不依賴編輯權限，因此分享唯讀模式也能清除本機進度。`PlayPageSlidePanel.tsx` 在播放設定中加入「播放進度」區塊與清除按鈕，並補齊中英文 `play.playbackProgress.*` i18n；BLOG.md 新增目的、使用方式與技術細節。

- 時間: 2026-06-18 03:20:00 +0800
- 分支: workspace-current
- 內容: 完成本頁產生耗時區塊總耗時與異常摘要。`PageTimingChips.tsx` 標題列現在會彙總 image/text/script/audio 中狀態為 `succeeded` 且具有限 `duration_ms` 的 artifact，顯示「總計 {duration}」；若任一 artifact 為 `failed` 或 `sla_status === 'breached'`，會額外顯示「{count} 項需注意」小型警示 badge。既有每個 chip 的 tooltip 細節保留不變。`formatters.ts` 新增 `sumCompletedDurationMs()` 並補上 `formatters.test.ts` 覆蓋耗時格式化、無效值與只累計完成項目的規則；同步新增中英文 `play.timing.*` i18n，BLOG.md 補充目的、使用方式與技術細節。

- 時間: 2026-06-17 17:15:00 +0800
- 分支: feature/todo-add-items-20260617d
- 內容: 分析現有系統後，新增 7 個待辦項目：(1) shape 效果新增 hexagon 六角形；(2) shape 效果新增 shapeGlow 發光選項；(3) step-list 高亮指定步驟；(4) text-callout 內距選項；(5) Manim animate.blink 閃爍效果；(6) Manim animate.colorCycle 顏色循環效果；(7) pointer 效果可見時透明度選項。

- 時間: 2026-06-17 17:30:00 +0800
- 分支: feature/shape-hexagon-20260617
- 內容: 新增 `hexagon` 六角形到 `shape` 效果。以 SVG `<polygon>` 繪製正六角形，6 個頂點（半徑 46、中心 50,50、頂點從正上方起順時針），points 字串：`50,4 89.84,27 89.84,73 50,96 10.16,73 10.16,27`。strokeLinejoin="round" 讓角點圓滑，支援 fill/stroke/strokeWidth/strokeDasharray。前後端 TypeScript 均通過。

- 時間: 2026-06-17 21:50:00 +0800
- 分支: feature/shape-glow-20260617b
- 內容: 新增 `shapeGlow?: boolean` 到 shape 動畫效果。後端 `AnimationEffect`、`EffectSchema` 與序列化流程均保留此布林欄位；前端 `SlideAnimationEffect` 同步新增欄位，`SlideRenderer.tsx` 在 shape SVG 啟用時套用 `filter: drop-shadow(0 0 8px ${stroke})`，讓形狀以描邊色產生發光輪廓；`AnimationEditorTab.tsx` 在 shape 線寬設定後新增「發光效果」勾選框；中英文 i18n 新增 `play.animation.shapeGlow`。前後端 TypeScript 均通過。


- 時間: 2026-06-17 22:05:00 +0800
- 分支: feature/text-callout-padding-20260617
- 內容: 新增 `textCalloutPadding?: 'sm' | 'md' | 'lg'` 到 `text-callout` 效果。後端 `AnimationEffect`、`EffectSchema` 與 `validateAnimationSpec()` 序列化均支援此欄位；前端 `SlideAnimationEffect` 同步新增欄位，`SlideRenderer.tsx` 以 padding map 套用 `sm=0.25em 0.5em`、`md=0.5em 0.75em`、`lg=0.75em 1.25em`，未設定時維持既有 `md` 外觀；`AnimationEditorTab.tsx` 新增內距 select；中英文 i18n 與 BLOG.md 功能說明同步更新。前後端 TypeScript 均通過。

- 時間: 2026-06-17 22:10:00 +0800
- 分支: feature/manim-blink-20260617
- 內容: 新增 Manim helper `animate.blink(m, progress, opts)` 閃爍動畫。此函式以 `Math.floor(progress * cycles * 2) % 2 === 0 ? 1 : 0` 判斷亮暗半週期，支援 `cycles`（預設 3）與 `minOpacity`（預設 0），暗相位使用 `minOpacity`，完成時強制恢復 `style.opacity = '1'` 避免殘留透明狀態。同步新增 VM 測試驗證 `progress=0.5` 的閃爍規律與 `progress=1` 的 opacity 還原。

- 時間: 2026-06-17 22:20:00 +0800
- 分支: feature/manim-color-cycle-20260617
- 內容: 新增 Manim helper `animate.colorCycle(m, progress, opts)` 顏色循環動畫。此函式要求 `opts.colors` 至少包含 2 個 hex 色碼，不符合時安全 no-op；支援 `attr: 'stroke' | 'fill' | 'both'`（預設 `stroke`），以 `progress * (colors.length - 1)` 找出相鄰色段並用既有 `lerpColor()` 插值，`progress=1` 時固定輸出最後一色。同步新增 VM 測試覆蓋中間進度顏色插值與完成時等於最後一色，並於 BLOG.md 補充目的與使用方式。

- 時間: 2026-06-17 22:18:00 +0800
- 分支: feature/pointer-opacity-20260617
- 內容: 新增 `pointerOpacity?: number` 到 `pointer` 動畫效果，讓指標可見狀態透明度可調整且預設維持 1。後端 `AnimationEffect`、`EffectSchema` 與 `validateAnimationSpec()` 序列化均支援此欄位，並以 0–1 範圍驗證與 clamp；前端 `SlideAnimationEffect` 同步新增欄位，`buildGsapTimeline.ts` 將 pointer 淡入目標改為 `effect.pointerOpacity ?? 1`；`AnimationEditorTab.tsx` 新增透明度 range slider 與 number input（0.1–1、step 0.1）；中英文 i18n 新增 `play.animation.pointerOpacity`。前後端 TypeScript 均通過。

- 時間: 2026-06-17 22:26:00 +0800
- 分支: workspace-current
- 內容: 重構系統設定頁為左側分類 navigation bar、右側單一分類內容的版面。分類包含「帳號與偏好」、「AI 與語音」、「同步」、「AI 技能」與 admin 才顯示的「管理員」；保留原有 Google 登入/登出、使用者代碼、語言、播放速度、API Key、模型、TTS speaker/voice、CGU Air、自動產生動畫、GitHub 同步、AI 技能 CRUD/啟停、Google Auth 管理、admin 移交與 Pipeline SLA 設定。新增中英文 i18n 分類名稱/描述與登入狀態文字。frontend TypeScript typecheck 通過。
