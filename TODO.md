# MakeSlide TODO

> 本檔於 2026-06-27 由舊的大型 TODO.md 拆分重建。先前累積的所有掃描摘要、已完成項目（`[x]`）與歷史工作記錄已封存於 [`TODO_260627.md`](TODO_260627.md)（更早期的記錄另見 `TODO_old.md`、`TODO_260521.md`）。本檔僅保留尚未完成的項目與後續工作記錄，以維持可讀性。

## 計數狀態

- 自 2026-06-27「計數重設」起算，截至封存時（舊檔第一二八輪）已完成 **8/100** 個項目，未達上限。後續 loop 接續此計數。

## 未完成項目（待使用者決定）

以下兩項屬範圍大或涉 CI 行為變更，**不宜於自動 loop 中逕行**，需使用者裁示後再進行：

- [ ] 系統性採用 `mapApiErrorToHumanMessage`：目前約 55 處 catch 區塊直接 `setError(err.message)` 顯示後端原始 message、繞過既有的錯誤訊息映射（前端僅 2 處 `UploadButton`、`ImportTextPage` 使用 mapper）。全面改造屬較大工程，且各 catch 上下文不同、許多後端 message 已是中文（未必都是英文洩漏），逐點需產品判斷顯示風格，故列為待使用者決定。
- [ ] 把前端測試納入 root `npm test`：目前 root 測試腳本未涵蓋前端 `node:test` 測試。納入涉及 CI 行為變更與 `npm install`（sandbox 無法驗證），列為待使用者決定。

## 後端分析新增可執行項目（第一四〇輪，2026-06-27）

前端小型純函式 backlog 接近見底，依 LOOP.md 第 2 條轉向後端（受重構關注較少）分析。新增以下項目並完成其一：

- [x] 抽出課後報告共用比例／四捨五入純函式（去重 / 防呆 / 可測）：`report.ts` 多處內聯 `denom > 0 ? num/denom : 0`（correct_rate、wrong_rate、participation_rate、completion_rate×2）、`round4` 重複定義兩次、投票分歧 `1 - max/total`，散落且無針對純邏輯的測試。抽成後端共用純函式並補測試。
  - 修改說明（2026-06-27）：新增 `backend/src/routes/pdfs/reportMetrics.ts`（`safeRatio(num, denom)` 分母非正回 0、`round4(n)`、`pollDivergence(maxVotes, totalVotes)` 無票回 0）。收斂 `report.ts`：correct_rate/wrong_rate/participation_rate/completion_rate(×2) 改用 `safeRatio`、兩處 local `round4` 改用共用、頁面 CSV 投票分歧改用 `pollDivergence`。新增 `report-metrics.test.ts` 4 組測試（safeRatio 正常/除以 0、round4、pollDivergence 共識/分裂/無票）。backend `tsc --noEmit` 通過；新測試 4/4 + 既有 `report-pages-csv`/`report-questions-csv`/`report-summary`/`report-question-stats` 共 16/16 回歸通過（行為等價）。分支 `refactor/report-metrics-helpers`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 20 個完成項目（20/100，未達上限）。
- [ ] 抽出 `avg_listened_ratio` 的 SQL 聚合為共用片段或測試：`report.ts` 兩處（pages.csv 與 summary）重複同一段 `AVG(CASE WHEN w.duration_ms ... MIN(listened_ms/duration_ms, 1.0) ...)` SQL，易漂移。評估抽成共用常數字串或補一個針對該聚合的整合測試固化語意。
- [ ] 後端搜尋語意索引上限可設定：`search.ts` 的 `MAX_SEMANTIC_PDFS = 20`（STATUS_REPORT §4.4）為硬編，教材知識庫成長後需要更大或可調。評估改為可由系統設定調整並補測試。
- [ ] 抽出學生平均分計算純函式：`report.ts` 的 `computeStudentRecords` 內聯 `scores.reduce((a,b)=>a+b,0)/scores.length`（平均分），與其他平均邏輯重複，抽成可測純函式（含空陣列回 null）。

## 修正既有失敗測試（第一三七輪，2026-06-27）

- [x] 修正 `status-machine.test.ts` 的 PROGRESS_STEPS 鏡像 drift（上輪跑測試時發現的既有失敗）：測試期望的 `PROGRESS_STEPS` 只有 7 個，但 `statusMachine.ts` 已新增 3 個 YouTube 相關步驟（`downloading_captions`／`downloading_audio`／`transcribing_audio`，於 `youtubeCaptions.ts`／`pipeline.ts` 實際使用、前端 `types.ts` 亦已鏡像），導致 `deepEqual` 失敗。確認 source 正確、test 過時，更新測試期望陣列（依 backend 陣列順序）並補 `isProgressStep('transcribing_audio')` 斷言。後端 `tsc --noEmit` 通過、`status-machine.test.ts` 5/5 通過（以 `scripts/run-tests.sh` 執行）。分支 `fix/progress-steps-test-mirror`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 17 個完成項目（17/100，未達上限）。

## 依 STATUS_REPORT 新增可執行項目（第一三五輪，2026-06-27）

使用者提示產生新項目時應參考 `docs/STATUS_REPORT_2026_06_27.md`（該檔此前因檔名問題不存在、現已補上）。依其 §4.2／§7.2／§9 的優先建議，新增以下項目（P0 bug 列首，已初步以 grep 驗證）：

- [x] **（P0 bug）修正品質檢查／匯出漏頁**：`quality-check.ts`、`image-quality.ts`、`script-quality.ts`、`h5p.ts` 皆以 `pages WHERE status = 'ready'` 取頁，但主 pipeline 完成後**頁面層級**停在 `audio_ready`（[`pipeline.ts:1260`]）、`pipeline.ts:1299` 只把 **pdfs**.status 設為 `'ready'`，頁面從不設 `'ready'`（grep 全 backend 確認頁面無 `status:'ready'` 賦值）。結果這些功能對正常生成的簡報可能回傳空頁清單。修正方向：改以「完成狀態集合（`audio_ready`／`ready`）」過濾，並先寫一個重現測試再修，補後端測試涵蓋 audio_ready 頁面被納入。屬後端、需測試、跨 4 路由，建議單獨一輪謹慎處理。
  - 修改說明（2026-06-27）：根因確認——`'ready'` **根本不是合法 page 狀態**（`statusMachine.ts` 的 `PAGE_STATUSES` 無 `ready`，終態為 `audio_ready`；`'ready'` 僅為 PDF 狀態），故 4 路由的 `WHERE status = 'ready'` 對 `pages` 永遠匹配 0 列。將 4 路由的頁面查詢一律改為 `status = 'audio_ready'` 並加註解說明。修正既有 3 個測試（image-quality/script-quality/h5p）的 fixture——原本用**不存在的** `'ready'` page 狀態（所以測試過但 production 壞），改為 `'audio_ready'`，使其反映真實狀態並成為回歸測試（pdfs INSERT 的 `'ready'` 為正確 PDF 狀態，維持不動）。為原本無測試的 quality-check 新增 `quality-check.test.ts`（4 子測試：audio_ready 頁面被檢查〔回歸〕、非完成頁〔rendered〕不檢查、404、403）。backend `tsc --noEmit` 通過；4 個路由測試以 Node 22（`.nvmrc`）+ `--test-force-exit` 執行，子測試全通過（quality-check 4/4、image-quality 4/4、script-quality 5/5、h5p 4/4）。分支 `fix/quality-export-page-status`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 16 個完成項目（16/100，未達上限）。
- [ ] **（P0）課後報告補強**：依 §7.1，`registerReportRoutes()`／`PostClassReportPanel` 補上頁面困難度（完成率低／提問多／投票分歧高）、題目答錯率與 CSV 下載入口。可分拆為純函式（前端彙總）+ 後端聚合兩個子項。
- [ ] **（P1）生成前成本估算 modal 串接**：已有 `lib/costEstimate.ts` helper 與 `PromptModal` 估算，依 §7.5 確認是否已於所有來源（PDF／文字／YouTube）生成前顯示，補齊缺口並加測試。
- [ ] **（P1）教材知識庫：搜尋結果加入動作**：依 §7.4／§8.1，首頁搜尋結果加入「加入新簡報」或「收藏頁」入口（延伸 `search.ts`／`from-pages.ts`）。
- [ ] **（P1）AI 導師自學模式入口正式化**：依 §7.3，將既有 `PageAskPanel`／`usePageAsk` 包裝成學生端自學入口（測驗後個人化複習清單、答錯題回看）。

## 新增可執行項目（第一三四輪，2026-06-27）

第一二九輪新增的 4 個可執行項目已全部完成（計數 9–13），TODO 僅剩 2 個待使用者決定項目。依 LOOP.md 第 2 條再次分析前端程式，新增以下小顆粒、可單輪完成、可加測試、低風險項目（並參考 `docs/FUTURE_ROADMAP.md` 的「教學閉環」方向，惟其主要功能多需後端與產品判斷，故此批先聚焦純前端可測收斂）：

- [x] 模板字串內插（`{key}` 取代）收斂為共用純函式（去重 / 可測性）：`ImportTextPage`(`formatTemplate`)、`AddPagesFromPromptModal`、`PlayPageSidebar`、`SystemDataPage`、`QuizBuilderPage`、`PlayPageFullscreen` 六處各自內嵌 `Object.entries(values).reduce((acc,[k,v]) => acc.replaceAll('{k}', String(v)), template)`（或等價 `for...of`）的內插邏輯，重複且無測試。抽成共用純函式並補測試。純前端、不動後端、不需新 i18n。
  - 修改說明（2026-06-27）：新增 `frontend/src/lib/interpolateTemplate.ts`（`interpolateTemplate(template, values)`：以 `replaceAll` 取代所有 `{key}`、值以 `String()` 轉換、無對應 key 的佔位符原樣保留）。六處收斂：`ImportTextPage`／`AddPagesFromPromptModal` 以 `import { interpolateTemplate as formatTemplate/formatMessage }` 取代本地函式（呼叫點不變）；`PlayPageSidebar`／`SystemDataPage`／`QuizBuilderPage`／`PlayPageFullscreen` 的 `formatMessage` 改為 `interpolateTemplate(t(key), values)` 薄包裝（保留各自 `useCallback`/簽章）。新增 `interpolateTemplate.test.ts` 6 組測試。前端 `tsc --noEmit` 通過、測試 6/6 通過、全專案已無殘留內聯內插寫法。分支 `refactor/interpolate-template`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 14 個完成項目（14/100，未達上限）。
- [x] 抽出音訊時長加總純函式：`PlayPageSlidePanel`(`futurePages.reduce(...audio_duration_seconds??0)`)、`play/formatters.ts` 等多處重複「累加各頁 `audio_duration_seconds ?? 0`」。抽成 `sumAudioDurationSeconds(pages)` 純函式並補測試。純前端。
  - 修改說明（2026-06-27）：盤點後實際只剩 `PlayPageSlidePanel` 一處用到「未來頁音訊加總」，且它與目前頁剩餘、邊界（`duration>0` 守衛、`total>0?null`）合成一段未測的 `useMemo`。比起只抽加總，改抽出整段「剩餘播放秒數」計算更有價值：新增 `frontend/src/lib/remainingTime.ts` 的 `computeRemainingSeconds(pages, currentIdx, currentTime, duration)`（pages 為 null 回 null、目前頁剩餘 = `duration>0 ? max(0, duration-currentTime) : 0`、加上之後各頁 `audio_duration_seconds ?? 0`、總和 0 回 null），`PlayPageSlidePanel` 的 `useMemo` 改委派之（行為等價）。新增 `remainingTime.test.ts` 7 組測試（null、目前頁+後續加總、只計後續頁、duration<=0、currentTime 超界夾 0、缺值以 0 計、總和 0 回 null）。前端 `tsc --noEmit` 通過、7/7 通過。分支 `refactor/remaining-seconds`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 19 個完成項目（19/100，未達上限）。
- [x] 比例條百分比收斂為共用純函式：`HomePage` 用量比例條 `max > 0 ? Math.round((value / max) * 100) : 0` 與其他比例顯示重複。抽成 `ratioPercent(value, max)`（除以 0 回 0、clamp 0–100）純函式並補測試。純前端。
  - 修改說明（2026-06-27）：發現既有 `lib/progressPercent.ts` 的 `progressPercent(current, total)` 已正是此「比例→百分比（`total<=0`/非有限值回 0、clamp 0–100）」函式且有完整測試，故**重用之而非新增 `ratioPercent`**（避免重複工具）。收斂 2 處內聯：`HomePage` 用量比例條 `max > 0 ? Math.round((value/max)*100) : 0` → `progressPercent(value, max)`（行為等價）；`SettingsPage` 嵌入索引進度條 `Math.round((indexed_pages/total_pages)*100)` + `Math.min(pct,100)` → `progressPercent(indexed_pages, total_pages)`，順帶修掉 `total_pages` 為 0 時會渲染 `NaN%` 的潛在 bug（progressPercent 回 0）。前端 `tsc --noEmit` 通過、`progressPercent` 既有 4 測試續通過、pages/components 已無殘留通用比例百分比內聯寫法。分支 `refactor/reuse-progress-percent`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 15 個完成項目（15/100，未達上限）。
- [x] 抽出測驗計分加總純函式：`QuizBuilderPage` 多處 `reduce` 計算總分／滿分／平均分（含 `roundToTwoDecimals`），邏輯分散且無獨立測試。抽成可測純函式。純前端。
  - 修改說明（2026-06-27）：於既有 `lib/quizScoring.ts` 新增 `calcAttemptScore(questions, answersById)`（以 `normalizeQuestionScores` + `calcQuestionScore` 累加單次作答總分，回傳未四捨五入原始值）與 `maxAttemptScore(questions)`（normalized 分數加總＝滿分）。收斂 `QuizBuilderPage` 兩處重複的「`normalizeQuestionScores` + `reduce(calcQuestionScore)`」計分內聯（提交作答、同步顯示分數/滿分），呼叫端仍各自 `roundToTwoDecimals`；其餘 per-question 用途（答錯偵測等）不動。`quizScoring.test.ts` 新增 3 組測試（maxAttemptScore、calcAttemptScore 依 id 加總含缺答、回傳未四捨五入原始值），共 11/11 通過。前端 `tsc --noEmit` 通過（以 `scripts/run-tests.sh` 執行測試）。分支 `refactor/quiz-attempt-score`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 18 個完成項目（18/100，未達上限）。
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
| 2026-06-27 | （後端，依 LOOP 第 2 條）抽出課後報告共用比例/四捨五入純函式：新增 `reportMetrics.ts`（`safeRatio`/`round4`/`pollDivergence`），收斂 `report.ts` 多處內聯比例與重複 `round4`；補 4 測試，既有 16 報告測試回歸通過（計數 20/100）；另新增 3 個後端可執行項目 | refactor/report-metrics-helpers（已 merge） |
| 2026-06-27 | 抽出剩餘播放秒數純函式：新增 `lib/remainingTime.ts` 的 `computeRemainingSeconds`，`PlayPageSlidePanel` 的 useMemo 改委派；補 7 測試；typecheck 通過（計數 19/100） | refactor/remaining-seconds（已 merge） |
| 2026-06-27 | 抽出測驗計分純函式：`quizScoring.ts` 新增 `calcAttemptScore`/`maxAttemptScore`，收斂 `QuizBuilderPage` 兩處計分內聯；補 3 測試（11/11）；typecheck 通過（計數 18/100） | refactor/quiz-attempt-score（已 merge） |
| 2026-06-27 | 修正既有失敗測試 `status-machine.test.ts`：PROGRESS_STEPS 期望陣列補上 3 個 YouTube 步驟（source 正確、test 過時），5/5 通過；新增 `scripts/run-tests.sh` 一次測試成功（依使用者要求）（計數 17/100） | fix/progress-steps-test-mirror（已 merge） |
| 2026-06-27 | （P0 bug，依 STATUS_REPORT §4.2）修正品質檢查／匯出漏頁：`quality-check`/`image-quality`/`script-quality`/`h5p` 4 路由的頁面查詢由不存在的 page 狀態 `'ready'` 改為終態 `'audio_ready'`；修正 3 測試 fixture、新增 quality-check.test.ts；以 Node 22 + `--test-force-exit` 驗證子測試全通過（計數 16/100） | fix/quality-export-page-status（已 merge） |
| 2026-06-27 | 比例條百分比收斂：發現既有 `progressPercent` 已是該通用函式，改為重用而非新增；收斂 `HomePage` 用量比例條與 `SettingsPage` 索引進度條 2 處，順帶修掉 `total_pages=0` 時 `NaN%` 潛在 bug；typecheck 通過、既有測試續通過（計數 15/100） | refactor/reuse-progress-percent（已 merge） |
| 2026-06-27 | 依 LOOP.md 第 2 條分析前端程式（第一三四輪）：TODO 僅剩 2 個待使用者決定項目，新增 5 個項目並完成其一——模板字串內插收斂為 `lib/interpolateTemplate.ts`，收斂 6 處內聯（ImportTextPage/AddPagesFromPromptModal/PlayPageSidebar/SystemDataPage/QuizBuilderPage/PlayPageFullscreen）；補 6 測試；typecheck 通過、無殘留（計數 14/100） | refactor/interpolate-template（已 merge） |
| 2026-06-27 | 逐字稿字數上限範圍說明 i18n：新增共用鍵 `play.scriptMaxCharsRange`（內插 MIN/MAX），`TtsDialog`/`RegenAllDialog` 輸入下方加範圍提示、`min/max` 屬性改用常數；i18n parity+nonempty 27 測試通過（計數 13/100）。至此第一二九輪新增的 4 個可執行項目已全部完成，TODO 僅剩 2 個待使用者決定項目 | feat/script-max-chars-range-hint（已 merge） |
| 2026-06-27 | 投影片縮放比例邊界收斂：新增 `lib/slideImageScale.ts`（`stepSlideImageScale` + MIN/MAX/STEP 常數，toFixed 消浮點誤差 + clamp）；`PlayPageHeader` 放大/縮小按鈕與 disabled 判斷改用之，header 無殘留 magic number；補 4 測試；typecheck 通過（計數 12/100） | feat/slide-scale-helper（已 merge） |
| 2026-06-27 | 首頁總覽統計彙總純函式：新增 `lib/homeStats.ts`（`summarizeHomeStats`，單次遍歷取代 3 次 reduce，音訊總秒數 /60 四捨五入）；`HomePage` homeStats 改用之；補 4 測試；typecheck 通過（計數 11/100） | feat/home-stats-helper（已 merge） |
| 2026-06-27 | 上傳進度百分比計算收斂：新增 `lib/uploadProgress.ts`（`uploadProgressPercent`，分母無效回 0 + clamp 0–100），收斂 `UploadButton`/`ImportTextPage`(2)/`HomePage`(zip)/`AddPagesFromPromptModal` 共 5 處內聯，各保留原 fallback 語意；補 4 測試；typecheck 通過、無殘留（計數 10/100） | feat/upload-progress-percent（已 merge） |
| 2026-06-27 | 逐字稿每頁字數上限正規化收斂：新增 `lib/scriptMaxChars.ts`（`normalizeScriptMaxChars` + MIN/MAX 常數，委派既有 `clamp`），收斂 `PlayPageSidebar`/`RegenAllDialog`/`TtsDialog` 三處內聯 `Math.max(80,Math.min(2000,round))`；補 5 測試；typecheck 通過、無殘留內聯（計數 9/100） | feat/normalize-script-max-chars（已 merge） |
| 2026-06-27 | 依 LOOP.md 第 2 條分析前端程式，新增 5 個小顆粒可執行項目（逐字稿字數上限正規化〔已完成〕、範圍說明 i18n、slideImageScale 邊界收斂、首頁音訊總時長彙總純函式、上傳進度百分比純函式） | feat/normalize-script-max-chars |
| 2026-06-27 | TODO.md 過大，依既有 `TODO_YYMMDD` 封存慣例將其改名為 `TODO_260627.md`，重建精簡新 TODO.md（保留計數狀態、兩個待使用者決定的未完成項目與工作記錄區） | master（僅文件） |
