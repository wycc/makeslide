# MakeSlide TODO

> 本檔於 2026-06-27 由舊的大型 TODO.md 拆分重建。先前累積的所有掃描摘要、已完成項目（`[x]`）與歷史工作記錄已封存於 [`TODO_260627.md`](TODO_260627.md)（更早期的記錄另見 `TODO_old.md`、`TODO_260521.md`）。本檔僅保留尚未完成的項目與後續工作記錄，以維持可讀性。

## 計數狀態

- 自 2026-06-27「計數重設」起算，截至封存時（舊檔第一二八輪）已完成 **8/100** 個項目，未達上限。後續 loop 接續此計數。

## 未完成項目（待使用者決定）

以下兩項屬範圍大或涉 CI 行為變更，**不宜於自動 loop 中逕行**，需使用者裁示後再進行：

- [ ] 系統性採用 `mapApiErrorToHumanMessage`：目前約 55 處 catch 區塊直接 `setError(err.message)` 顯示後端原始 message、繞過既有的錯誤訊息映射（前端僅 2 處 `UploadButton`、`ImportTextPage` 使用 mapper）。全面改造屬較大工程，且各 catch 上下文不同、許多後端 message 已是中文（未必都是英文洩漏），逐點需產品判斷顯示風格，故列為待使用者決定。
- [ ] 把前端測試納入 root `npm test`：目前 root 測試腳本未涵蓋前端 `node:test` 測試。納入涉及 CI 行為變更與 `npm install`（sandbox 無法驗證），列為待使用者決定。

## 新增可執行項目（第一三四輪，2026-06-27）

第一二九輪新增的 4 個可執行項目已全部完成（計數 9–13），TODO 僅剩 2 個待使用者決定項目。依 LOOP.md 第 2 條再次分析前端程式，新增以下小顆粒、可單輪完成、可加測試、低風險項目（並參考 `docs/FUTURE_ROADMAP.md` 的「教學閉環」方向，惟其主要功能多需後端與產品判斷，故此批先聚焦純前端可測收斂）：

- [x] 模板字串內插（`{key}` 取代）收斂為共用純函式（去重 / 可測性）：`ImportTextPage`(`formatTemplate`)、`AddPagesFromPromptModal`、`PlayPageSidebar`、`SystemDataPage`、`QuizBuilderPage`、`PlayPageFullscreen` 六處各自內嵌 `Object.entries(values).reduce((acc,[k,v]) => acc.replaceAll('{k}', String(v)), template)`（或等價 `for...of`）的內插邏輯，重複且無測試。抽成共用純函式並補測試。純前端、不動後端、不需新 i18n。
  - 修改說明（2026-06-27）：新增 `frontend/src/lib/interpolateTemplate.ts`（`interpolateTemplate(template, values)`：以 `replaceAll` 取代所有 `{key}`、值以 `String()` 轉換、無對應 key 的佔位符原樣保留）。六處收斂：`ImportTextPage`／`AddPagesFromPromptModal` 以 `import { interpolateTemplate as formatTemplate/formatMessage }` 取代本地函式（呼叫點不變）；`PlayPageSidebar`／`SystemDataPage`／`QuizBuilderPage`／`PlayPageFullscreen` 的 `formatMessage` 改為 `interpolateTemplate(t(key), values)` 薄包裝（保留各自 `useCallback`/簽章）。新增 `interpolateTemplate.test.ts` 6 組測試。前端 `tsc --noEmit` 通過、測試 6/6 通過、全專案已無殘留內聯內插寫法。分支 `refactor/interpolate-template`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 14 個完成項目（14/100，未達上限）。
- [ ] 抽出音訊時長加總純函式：`PlayPageSlidePanel`(`futurePages.reduce(...audio_duration_seconds??0)`)、`play/formatters.ts` 等多處重複「累加各頁 `audio_duration_seconds ?? 0`」。抽成 `sumAudioDurationSeconds(pages)` 純函式並補測試。純前端。
- [ ] 比例條百分比收斂為共用純函式：`HomePage` 用量比例條 `max > 0 ? Math.round((value / max) * 100) : 0` 與其他比例顯示重複。抽成 `ratioPercent(value, max)`（除以 0 回 0、clamp 0–100）純函式並補測試。純前端。
- [ ] 抽出測驗計分加總純函式：`QuizBuilderPage` 多處 `reduce` 計算總分／滿分／平均分（含 `roundToTwoDecimals`），邏輯分散且無獨立測試。抽成可測純函式。純前端。
- [ ] 報告面板個人層級延伸（方向，需使用者裁示）：依 `docs/FUTURE_ROADMAP.md` 2.1，目前課後報告為班級層級，roadmap 建議延伸到個人層級報表（每位學生答題完成率、提問次數、投票參與率）。涉後端聚合與隱私呈現，屬較大項目，列為待使用者決定方向。

## 新增可執行項目（第一二九輪，2026-06-27）

依 LOOP.md 第 2 條（剩餘兩項皆待使用者決定、不宜自動逕行），分析前端程式後新增以下小顆粒、可單輪完成、可加測試、低風險項目：

- [x] 逐字稿每頁字數上限正規化收斂為共用純函式（去重 / 可測性）：`PlayPageSidebar`、`RegenAllDialog`、`TtsDialog` 三處各自內嵌 `Math.max(80, Math.min(2000, Math.round(x)))`，magic number 80/2000 散落三檔、易漂移且無測試。抽成共用常數與純函式並補測試。純前端、不動後端、不需新 i18n。
  - 修改說明（2026-06-27）：新增 `frontend/src/lib/scriptMaxChars.ts`（`SCRIPT_MAX_CHARS_MIN=80`、`SCRIPT_MAX_CHARS_MAX=2000`、`normalizeScriptMaxChars(value)` = `clamp(Math.round(value), MIN, MAX)`，沿用既有 `clamp` helper，行為與原內聯完全一致：`NaN` 照樣傳遞，呼叫端維持各自的 `Number.isFinite` 防呆）。三處呼叫點改用此函式。新增 `scriptMaxChars.test.ts` 5 組測試（範圍內含上下界、超界拉回、四捨五入、與舊內聯輸出一致、NaN 傳遞）。前端 `tsc --noEmit` 通過、測試 5/5 通過、全專案已無殘留內聯寫法。分支 `feat/normalize-script-max-chars`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 9 個完成項目（9/100，未達上限）。
- [x] 逐字稿字數上限範圍說明 i18n：三處輸入框（TtsDialog / RegenAllDialog / PlayPageSidebar regen）未向使用者標示 80–2000 的允許範圍，輸入超界會被靜默正規化。可加上以 `SCRIPT_MAX_CHARS_MIN/MAX` 組出的 helper 文字與 `min/max` HTML 屬性，並補 i18n 鍵。
  - 修改說明（2026-06-27）：新增共用 i18n 鍵 `play.scriptMaxCharsRange`（zh-TW「允許範圍 {min}–{max} 字」／en「Allowed range: {min}–{max}」，內插 `SCRIPT_MAX_CHARS_MIN/MAX`）。`TtsDialog` 與 `RegenAllDialog`（即 PlayPageSidebar 開啟的批次重生輸入）的字數上限 `<input>` 下方新增範圍提示，並把原本硬編的 `min={80} max={2000}` HTML 屬性改用 `SCRIPT_MAX_CHARS_MIN/MAX` 常數，與正規化邏輯共用同一來源。前端 `tsc --noEmit` 通過、i18n parity + nonempty 等 27 測試全通過（新鍵兩語系 placeholder 集合一致）。分支 `feat/script-max-chars-range-hint`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 13 個完成項目（13/100，未達上限）。
- [x] 投影片縮放比例（slideImageScale）邊界收斂：`PlayPageHeader` 兩處 `Math.max(0.65, ...)`／`Math.min(1.35, ...)` 與 0.1 步進散落且 magic number 重複。抽成共用常數與 `stepSlideScale(scale, delta)` 純函式並補測試。
  - 修改說明（2026-06-27）：新增 `frontend/src/lib/slideImageScale.ts`（`SLIDE_IMAGE_SCALE_MIN=0.65`、`MAX=1.35`、`STEP=0.1`、`stepSlideImageScale(scale, delta)`：先 `toFixed(2)` 消浮點誤差再以共用 `clamp` 夾範圍，與原寫法行為一致）。`PlayPageHeader` 放大／縮小按鈕 onClick 改用 `stepSlideImageScale(scale, ±STEP)`，兩處 disabled 判斷改用 `MIN`/`MAX` 常數，header 內已無 magic number。新增 `slideImageScale.test.ts` 4 組測試（步進消浮點誤差、不低於下限、不高於上限、與舊內聯一致）。前端 `tsc --noEmit` 通過、測試 4/4 通過。分支 `feat/slide-scale-helper`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 12 個完成項目（12/100，未達上限）。
- [x] 抽出首頁音訊總時長彙總純函式：`HomePage` 內聯 `Math.round(items.reduce(...total_audio_duration_seconds...) / 60)` 計算總分鐘數，無測試且與單卡片 `/60` 換算重複。抽成可測純函式。
  - 修改說明（2026-06-27）：新增 `frontend/src/lib/homeStats.ts`（`summarizeHomeStats(items)` 回傳 `{totalPdfs, totalPages, totalPlays, totalAudioMin}`，單次遍歷取代原本 3 次 reduce、音訊總秒數 `/60` 後四捨五入，各欄位缺值以 0 計入與原 `?? 0` 一致）；輸入採 `Pick<PdfListItem, …>` 結構型別降低耦合。`HomePage` 的 `homeStats` useMemo 改為 `summarizeHomeStats(items)`（行為等價）。新增 `homeStats.test.ts` 4 組測試（空清單、正常彙總含四捨五入、缺值以 0 計入、與舊 reduce 寫法一致）。前端 `tsc --noEmit` 通過、測試 4/4 通過。分支 `feat/home-stats-helper`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 11 個完成項目（11/100，未達上限）。
- [x] 抽出上傳進度百分比計算純函式：`UploadButton`、`ImportTextPage`、`HomePage`(zip)、`AddPagesFromPromptModal` 多處重複 `Math.round((loaded/total)*100)`（且 total 為 0 時行為不一）。收斂為帶除以 0 防呆的共用純函式並補測試。
  - 修改說明（2026-06-27）：新增 `frontend/src/lib/uploadProgress.ts`（`uploadProgressPercent(loaded, total)`：`total <= 0`／`NaN` 回 0 避免除以 0 產生 `NaN`/`Infinity`，其餘四捨五入後以既有 `clamp` 夾在 [0,100]）。收斂 5 處內聯（`UploadButton`、`ImportTextPage` 2 處、`HomePage` zip 匯入、`AddPagesFromPromptModal`），各呼叫端保留原本的外層 fallback 語意（位元組進度點維持 `if (total > 0)` 略過更新、`AddPagesFromPromptModal` 維持 `null` 顯示）。新增 `uploadProgress.test.ts` 4 組測試（一般換算、分母無效回 0、超界夾 100、與舊內聯一致）。前端 `tsc --noEmit` 通過、測試 4/4 通過、無殘留上傳進度內聯寫法。`HomePage` 第 1441 行的音訊用量比例條語意不同（非上傳進度），未納入。分支 `feat/upload-progress-percent`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 10 個完成項目（10/100，未達上限）。

## 工作記錄

| 日期 | 工作內容 | 分支 |
|------|---------|------|
| 2026-06-27 | 依 LOOP.md 第 2 條分析前端程式（第一三四輪）：TODO 僅剩 2 個待使用者決定項目，新增 5 個項目並完成其一——模板字串內插收斂為 `lib/interpolateTemplate.ts`，收斂 6 處內聯（ImportTextPage/AddPagesFromPromptModal/PlayPageSidebar/SystemDataPage/QuizBuilderPage/PlayPageFullscreen）；補 6 測試；typecheck 通過、無殘留（計數 14/100） | refactor/interpolate-template（已 merge） |
| 2026-06-27 | 逐字稿字數上限範圍說明 i18n：新增共用鍵 `play.scriptMaxCharsRange`（內插 MIN/MAX），`TtsDialog`/`RegenAllDialog` 輸入下方加範圍提示、`min/max` 屬性改用常數；i18n parity+nonempty 27 測試通過（計數 13/100）。至此第一二九輪新增的 4 個可執行項目已全部完成，TODO 僅剩 2 個待使用者決定項目 | feat/script-max-chars-range-hint（已 merge） |
| 2026-06-27 | 投影片縮放比例邊界收斂：新增 `lib/slideImageScale.ts`（`stepSlideImageScale` + MIN/MAX/STEP 常數，toFixed 消浮點誤差 + clamp）；`PlayPageHeader` 放大/縮小按鈕與 disabled 判斷改用之，header 無殘留 magic number；補 4 測試；typecheck 通過（計數 12/100） | feat/slide-scale-helper（已 merge） |
| 2026-06-27 | 首頁總覽統計彙總純函式：新增 `lib/homeStats.ts`（`summarizeHomeStats`，單次遍歷取代 3 次 reduce，音訊總秒數 /60 四捨五入）；`HomePage` homeStats 改用之；補 4 測試；typecheck 通過（計數 11/100） | feat/home-stats-helper（已 merge） |
| 2026-06-27 | 上傳進度百分比計算收斂：新增 `lib/uploadProgress.ts`（`uploadProgressPercent`，分母無效回 0 + clamp 0–100），收斂 `UploadButton`/`ImportTextPage`(2)/`HomePage`(zip)/`AddPagesFromPromptModal` 共 5 處內聯，各保留原 fallback 語意；補 4 測試；typecheck 通過、無殘留（計數 10/100） | feat/upload-progress-percent（已 merge） |
| 2026-06-27 | 逐字稿每頁字數上限正規化收斂：新增 `lib/scriptMaxChars.ts`（`normalizeScriptMaxChars` + MIN/MAX 常數，委派既有 `clamp`），收斂 `PlayPageSidebar`/`RegenAllDialog`/`TtsDialog` 三處內聯 `Math.max(80,Math.min(2000,round))`；補 5 測試；typecheck 通過、無殘留內聯（計數 9/100） | feat/normalize-script-max-chars（已 merge） |
| 2026-06-27 | 依 LOOP.md 第 2 條分析前端程式，新增 5 個小顆粒可執行項目（逐字稿字數上限正規化〔已完成〕、範圍說明 i18n、slideImageScale 邊界收斂、首頁音訊總時長彙總純函式、上傳進度百分比純函式） | feat/normalize-script-max-chars |
| 2026-06-27 | TODO.md 過大，依既有 `TODO_YYMMDD` 封存慣例將其改名為 `TODO_260627.md`，重建精簡新 TODO.md（保留計數狀態、兩個待使用者決定的未完成項目與工作記錄區） | master（僅文件） |
