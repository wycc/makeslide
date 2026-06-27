# MakeSlide TODO

> 本檔於 2026-06-27 由舊的大型 TODO.md 拆分重建。先前累積的所有掃描摘要、已完成項目（`[x]`）與歷史工作記錄已封存於 [`TODO_260627.md`](TODO_260627.md)（更早期的記錄另見 `TODO_old.md`、`TODO_260521.md`）。本檔僅保留尚未完成的項目與後續工作記錄，以維持可讀性。

## 計數狀態

- 自 2026-06-27「計數重設」起算，截至封存時（舊檔第一二八輪）已完成 **8/100** 個項目，未達上限。後續 loop 接續此計數。

## 未完成項目（待使用者決定）

以下兩項屬範圍大或涉 CI 行為變更，**不宜於自動 loop 中逕行**，需使用者裁示後再進行：

- [ ] 系統性採用 `mapApiErrorToHumanMessage`：目前約 55 處 catch 區塊直接 `setError(err.message)` 顯示後端原始 message、繞過既有的錯誤訊息映射（前端僅 2 處 `UploadButton`、`ImportTextPage` 使用 mapper）。全面改造屬較大工程，且各 catch 上下文不同、許多後端 message 已是中文（未必都是英文洩漏），逐點需產品判斷顯示風格，故列為待使用者決定。
- [ ] 把前端測試納入 root `npm test`：目前 root 測試腳本未涵蓋前端 `node:test` 測試。納入涉及 CI 行為變更與 `npm install`（sandbox 無法驗證），列為待使用者決定。

## 新增可執行項目（第一二九輪，2026-06-27）

依 LOOP.md 第 2 條（剩餘兩項皆待使用者決定、不宜自動逕行），分析前端程式後新增以下小顆粒、可單輪完成、可加測試、低風險項目：

- [x] 逐字稿每頁字數上限正規化收斂為共用純函式（去重 / 可測性）：`PlayPageSidebar`、`RegenAllDialog`、`TtsDialog` 三處各自內嵌 `Math.max(80, Math.min(2000, Math.round(x)))`，magic number 80/2000 散落三檔、易漂移且無測試。抽成共用常數與純函式並補測試。純前端、不動後端、不需新 i18n。
  - 修改說明（2026-06-27）：新增 `frontend/src/lib/scriptMaxChars.ts`（`SCRIPT_MAX_CHARS_MIN=80`、`SCRIPT_MAX_CHARS_MAX=2000`、`normalizeScriptMaxChars(value)` = `clamp(Math.round(value), MIN, MAX)`，沿用既有 `clamp` helper，行為與原內聯完全一致：`NaN` 照樣傳遞，呼叫端維持各自的 `Number.isFinite` 防呆）。三處呼叫點改用此函式。新增 `scriptMaxChars.test.ts` 5 組測試（範圍內含上下界、超界拉回、四捨五入、與舊內聯輸出一致、NaN 傳遞）。前端 `tsc --noEmit` 通過、測試 5/5 通過、全專案已無殘留內聯寫法。分支 `feat/normalize-script-max-chars`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 9 個完成項目（9/100，未達上限）。
- [ ] 逐字稿字數上限範圍說明 i18n：三處輸入框（TtsDialog / RegenAllDialog / PlayPageSidebar regen）未向使用者標示 80–2000 的允許範圍，輸入超界會被靜默正規化。可加上以 `SCRIPT_MAX_CHARS_MIN/MAX` 組出的 helper 文字與 `min/max` HTML 屬性，並補 i18n 鍵。
- [ ] 投影片縮放比例（slideImageScale）邊界收斂：`PlayPageHeader` 兩處 `Math.max(0.65, ...)`／`Math.min(1.35, ...)` 與 0.1 步進散落且 magic number 重複。抽成共用常數與 `stepSlideScale(scale, delta)` 純函式並補測試。
- [ ] 抽出首頁音訊總時長彙總純函式：`HomePage` 內聯 `Math.round(items.reduce(...total_audio_duration_seconds...) / 60)` 計算總分鐘數，無測試且與單卡片 `/60` 換算重複。抽成可測純函式。
- [ ] 抽出上傳進度百分比計算純函式：`UploadButton`、`ImportTextPage`、`HomePage`(zip)、`AddPagesFromPromptModal` 多處重複 `Math.round((loaded/total)*100)`（且 total 為 0 時行為不一）。收斂為帶除以 0 防呆的共用純函式並補測試。

## 工作記錄

| 日期 | 工作內容 | 分支 |
|------|---------|------|
| 2026-06-27 | 逐字稿每頁字數上限正規化收斂：新增 `lib/scriptMaxChars.ts`（`normalizeScriptMaxChars` + MIN/MAX 常數，委派既有 `clamp`），收斂 `PlayPageSidebar`/`RegenAllDialog`/`TtsDialog` 三處內聯 `Math.max(80,Math.min(2000,round))`；補 5 測試；typecheck 通過、無殘留內聯（計數 9/100） | feat/normalize-script-max-chars（已 merge） |
| 2026-06-27 | 依 LOOP.md 第 2 條分析前端程式，新增 5 個小顆粒可執行項目（逐字稿字數上限正規化〔已完成〕、範圍說明 i18n、slideImageScale 邊界收斂、首頁音訊總時長彙總純函式、上傳進度百分比純函式） | feat/normalize-script-max-chars |
| 2026-06-27 | TODO.md 過大，依既有 `TODO_YYMMDD` 封存慣例將其改名為 `TODO_260627.md`，重建精簡新 TODO.md（保留計數狀態、兩個待使用者決定的未完成項目與工作記錄區） | master（僅文件） |
