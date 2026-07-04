# MakeSlide TODO

> 本檔於 2026-06-27 由舊的大型 TODO.md 拆分重建。先前累積的所有掃描摘要、已完成項目（`[x]`）與歷史工作記錄已封存於 [`TODO_260627.md`](TODO_260627.md)（更早期的記錄另見 `TODO_old.md`、`TODO_260521.md`）。本檔僅保留尚未完成的項目與後續工作記錄，以維持可讀性。

## 計數狀態

- 自 2026-06-27「計數重設」起算，截至封存時（舊檔第一二八輪）已完成 **8/100** 個項目，未達上限。後續 loop 接續此計數。
- 最新進度：截至第二一一輪已完成 **90/100**，未達上限。

## 未完成項目（待使用者決定）

以下兩項屬範圍大或涉 CI 行為變更，**不宜於自動 loop 中逕行**，需使用者裁示後再進行：

- [ ] 系統性採用 `mapApiErrorToHumanMessage`：目前約 55 處 catch 區塊直接 `setError(err.message)` 顯示後端原始 message、繞過既有的錯誤訊息映射（前端僅 2 處 `UploadButton`、`ImportTextPage` 使用 mapper）。全面改造屬較大工程，且各 catch 上下文不同、許多後端 message 已是中文（未必都是英文洩漏），逐點需產品判斷顯示風格，故列為待使用者決定。
- [ ] 把前端測試納入 root `npm test`：目前 root 測試腳本未涵蓋前端 `node:test` 測試。納入涉及 CI 行為變更與 `npm install`（sandbox 無法驗證），列為待使用者決定。

## AI 導師錯誤與空答處理（第一八八輪，2026-07-04）

推進 §「AI 導師（PageAskPanel）回答品質改善」backlog 的「錯誤與空答處理」項：強化 prompt 防杜撰、
空答保底，並把前端錯誤改走 `mapApiErrorToHumanMessage`。

- [x] AI 導師禁止杜撰 + 空答保底 + 前端錯誤走人性化 mapper。
  - 修改說明（2026-07-04）：
    - **禁止杜撰（prompt）**：`/ask` system prompt 的「查無資訊」條款由「請誠實說明」強化為「只能依
      提供內容作答、嚴禁杜撰／臆測，找不到時明確回『找不到相關資訊』並建議換個問法或查看相關頁面」。
    - **空答保底 + 換行正規化收斂（可測純函式）**：新增 [tutorAnswer.ts](backend/src/routes/pdfs/tutorAnswer.ts)
      的 `finalizeTutorAnswer(raw)`——把原本內聯於 `/ask` 的「字面 `\n`→真換行（保留 `\nabla` 等 LaTeX
      指令）」正規化抽出並固化，且在 trim 後為空字串時回傳固定提示 `TUTOR_NO_ANSWER_FALLBACK`（避免前端
      出現空白導師泡泡、涵蓋模型回空的情況）。route 改用之。
    - **前端錯誤人性化**：`usePageAsk` 的 catch 由 `err.message`／`askFailed` 改為
      `mapApiErrorToHumanMessage(err, t).message`（code-aware、已在地化，與 UploadButton／ImportTextPage 一致）。
  - 測試：後端新增 `tutor-answer.test.ts`（7 組：字面 `\n\n`/`\n`/`\r\n`→換行、保留 `\nabla`/`\rho`/
    `\right`/`\times`、trim、空/空白/`\n\n`→fallback、正常答案不變）+ `page-ask.test.ts` 新增 2 整合測試
    （prompt 含「禁止杜撰／找不到相關資訊」、模型回空白→回應為 fallback 文案）。前後端 `tsc --noEmit` 通過；
    後端 ask 相關 13/13（Node 22）、前端錯誤映射 7/7、i18n parity 不變。分支 `feat/ask-error-and-empty-answer`，
    已 merge 回 master。BLOG.md 新增對應 section。
  - 說明：「偵測『查無資訊』語句給固定提示」一項，改以**空答保底**（模型回空→固定提示）實作，刻意不做
    脆弱的自然語言片語偵測（易誤判傷 UX）；防杜撰改由 prompt 從源頭處理。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 67 個完成項目（67/100，未達上限）。

## AI 導師回答長度精簡／詳細切換（第一八七輪，2026-07-04）

推進 §「AI 導師（PageAskPanel）回答品質改善」backlog 的「輸出長度／結構控制」項：原 system prompt
一律要求「完整、不刻意精簡」，長答常過度冗長且無進度感。新增每次提問可選「精簡／詳細」。

- [x] AI 導師新增「精簡／詳細」回答長度切換（可測純函式 + 前後端接線）。
  - 修改說明（2026-07-04）：後端新增純函式 [askVerbosity.ts](backend/src/routes/pdfs/askVerbosity.ts)
    的 `askVerbosityInstruction(verbosity)`——`brief` 回精簡指示（結論先行、1～3 句重點、避免冗長）、
    `detailed`（含未指定）回詳盡指示（同樣「結論先行、先給重點摘要再展開」以改善長答可讀性）。
    `AskPageBodySchema` 新增 `verbosity: z.enum(['brief','detailed']).optional()`；`/ask` 把該指示接到
    system prompt 末尾，並把原硬編的「盡量解釋透徹、不要刻意精簡」改為中性的「清楚、有條理」（長度改由
    verbosity 控制）。前端：`askPageQuestion` 新增 `verbosity` 參數；`usePageAsk` 新增 `pageAskVerbosity`
    狀態（預設 detailed）+ setter 並隨每次提問送出；`PlayPageContext` 型別同步；`PageAskPanel` 於輸入框
    上方加「回答長度：精簡｜詳細」分段切換。新增 i18n 三鍵（zh-TW／en，parity 24/24）。
  - 測試：後端 `ask-verbosity.test.ts`（4 組純函式）+ `page-ask.test.ts` 新增整合測試（未指定→prompt 帶
    「本次回答長度：詳細」、`verbosity:'brief'`→帶「精簡」且不含「詳細」）。前後端 `tsc --noEmit` 通過；
    後端 ask 相關 8/8（Node 22）、前端 i18n 24/24。分支 `feat/ask-verbosity-toggle`，已 merge 回 master。
    BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 66 個完成項目（66/100，未達上限）。

## AI 導師回答的引用頁碼可點擊跳頁（第一八六輪，2026-07-04）

推進 §「AI 導師（PageAskPanel）回答品質改善」backlog 的「引用頁碼可點擊」項：AI 導師回答會依
prompt 規則以「（第 N 頁）」標示跨頁引用，但先前是純文字，讀者得自行手動翻頁查證。

- [x] AI 導師回答下方新增「引用頁碼」可點擊捷徑（可測純函式解析 + 點擊跳頁）。
  - 修改說明（2026-07-04）：新增前端純函式 [extractCitedPages.ts](frontend/src/lib/extractCitedPages.ts)
    的 `extractCitedPages(text)`——以「第 N 頁」寬鬆樣式（容許空白變化）掃描回答全文，回傳升冪、
    去重、正整數的頁碼清單（是否有效／排除當前頁交由呼叫端）。[PageAskPanel.tsx](frontend/src/pages/play/PageAskPanel.tsx)
    在每則 AI 導師答案下方（非答案本身、不動 `MarkdownMath` 渲染路徑）新增一列「引用頁碼」晶片，
    僅顯示實際存在於 `deckPages` 且非目前頁的頁碼，點擊以 `setCurrentIdx` 對應索引跳頁。新增 i18n 鍵
    `play.sidebar.pageAsk.citedPagesLabel`／`jumpToPage`（zh-TW／en，parity 24/24）。新增
    `extractCitedPages.test.ts`（7 組：單頁、多頁升冪去重、空白變化、忽略原始來源、忽略第 0 頁、
    空／無引用回空、重複呼叫穩定不受 regex lastIndex 影響）。前端 `tsc --noEmit` 通過、新測試 7/7、
    i18n 24/24。分支 `feat/ask-clickable-page-citations`，已 merge 回 master。BLOG.md 新增對應 section。
  - 同輪順帶更新：確認「Markdown 渲染」項已由 `MarkdownMath` 於先前輪次解決，補記為完成（**不計入**）。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 65 個完成項目（65/100，未達上限）。

## AI 導師多輪對話脈絡字數上限管理（第一八五輪，2026-07-04）

推進 §「AI 導師（PageAskPanel）回答品質改善」backlog 的「保留對話脈絡的上限管理」項：`/ask`
端點原本把 history 全量帶入 prompt，schema 僅限輪數（20）與單則長度（8000），最壞約 160,000 字，
會反過來把 corpus（14000）/來源全文（12000）擠出 token 預算。

- [x] AI 導師 `/ask` history 加字數上限（保留最新連續數輪 / 可測純函式）。
  - 修改說明（2026-07-04）：新增 `backend/src/routes/pdfs/askHistoryBudget.ts` 純函式
    `budgetChatHistory(history, maxChars)`——由新到舊累加 content 長度、保留能放入預算的最新連續
    數輪（先丟最舊）；最新一則單獨超標時截斷保留（前綴「……（前略）……」、保留尾段）而非整段
    丟棄；`maxChars ≤ 0`／空歷史回空、不改動輸入。`page-operations.ts` 新增常數
    `ASK_HISTORY_MAX_CHARS = 8000`，`/ask` 在送入模型前先 `budgetChatHistory` 收斂再 `.map`；
    輪數上限仍由 schema 把關。新增 `ask-history-budget.test.ts`（7 組）。後端 `tsc --noEmit` 通過；
    新測試 7/7 + `page-ask` 整合測試回歸（Node 22，共 10 綠）。分支 `feat/ask-history-char-budget`，
    已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 64 個完成項目（64/100，未達上限）。

## 設定頁快取清除改用 api client（第二一一輪，2026-07-04）

延續盤點：`SettingsPage` 以直接 `fetch` 打 `system/thumbnail-cache`、`admin/cache`（DELETE），各自寫
`if(!resp.ok){setMsg;return}`＋`catch{setMsg(null)}`，繞過 api client 一致的錯誤處理。

- [x] 縮圖/產物快取清除改用 api client `clearThumbnailCache`／`clearArtifactCache`。
  - 修改說明（2026-07-04）：`api/system.ts` 新增 `clearThumbnailCache()`／`clearArtifactCache()`（DELETE、
    走 `parseErrorBody`、回各自的 JSON 形狀）。`SettingsPage` 兩個 handler 改用之、移除元件內 raw fetch 與
    `resp.ok` 判斷。行為微調（更佳）：原本網路錯誤（catch）不顯示訊息，現與 !ok 一致改顯示按鈕標籤 fallback
    訊息，讓失敗都有回饋；成功路徑不變。前端 `tsc --noEmit` 通過（api HTTP 包裝一向不另做單元測試）。分支
    `refactor/settings-cache-api-client`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 90 個完成項目（90/100，未達上限）。

## 課後報告面板改用 api client（去重型別/直呼 fetch）（第二一〇輪，2026-07-04）

延續盤點：`PostClassReportPanel` 自行定義 `StudentRecord`／`StudentAttempt`／`StudentQuestionResult`（與
api client 既有的同名/結構完全一致者重複），且以直接 `fetch` 讀 `report/students`、`report/ai-suggestions`，
繞過 api client 一致的 `parseErrorBody` 錯誤處理。

- [x] 課後報告面板改用 api client：去重型別 + 收斂直呼 fetch。
  - 修改說明（2026-07-04）：`api/pdfs.ts` 新增 `fetchReportAiSuggestions(id)`（比照 `fetchPdfStudentRecords`、
    走 `parseErrorBody`）。`PostClassReportPanel` 移除 3 個與 api client 結構相同的本地 interface，改 `import`
    api 的 `StudentRecord`；學生名單改用既有 `fetchPdfStudentRecords(pdfId)`、AI 建議改用 `fetchReportAiSuggestions(pdfId)`，
    移除元件內兩段 ad-hoc `fetch`＋`r.ok ? … : reject` 樣板。前端 `tsc --noEmit` 通過（型別相容由 tsc 保證）。
    分支 `refactor/report-panel-api-client`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 89 個完成項目（89/100，未達上限）。

## 檔案下載樣板收斂為共用工具（第二〇九輪，2026-07-04）

延續盤點：`document.createElement('a')` + 設 href/download + click（+object URL 建/釋放）的下載樣板在 5 處
重複（首頁匯出/批次匯出、報告摘要、測驗 JSON、課程包），無測試。

- [x] 抽出檔案下載共用工具 `triggerDownload`／`downloadBlob`（去重 5 處 / 可測 / DI）。
  - 修改說明（2026-07-04）：新增 [download.ts](frontend/src/lib/download.ts)——`triggerDownload(href, filename)`
    下載已知 URL（伺服器端點或 object URL）；`downloadBlob(blob, filename)` 建 object URL 後下載並 `revoke`。
    沿用 `clipboard.ts` 的依賴注入風格（可注入 document／URL 供測試、無 DOM 環境為 no-op）。5 處改用之：
    `HomePage` 匯出＋批次匯出（`triggerDownload`）、`PostClassReportPanel` 報告摘要、`QuizBuilderPage` 測驗
    JSON、`PlayPageHeader` 課程包（`downloadBlob`）。blob 路徑統一加上 appendChild/remove（更穩健、對既有行為
    無害）。新增 `download.test.ts`（3 組：triggerDownload 設屬性/append/click/remove、downloadBlob 建 URL→下載
    →revoke、無 DOM/URL 時 no-op）。前端 `tsc --noEmit` 通過、3/3 通過。分支 `refactor/download-helper`，已 merge
    回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 88 個完成項目（88/100，未達上限）。

## [0,1] 內聯夾界改用共用 clamp（第二〇八輪，2026-07-04）

延續盤點：`PlayPage`／`AnimationEditorTab` 尚有 6 處以 `Math.min(1, Math.max(0, value))` 內聯夾界到 [0,1]
（游標座標、spotlight/overlay/pointer 透明度），未使用既有且已測的 `clamp`。

- [x] 6 處 [0,1] 內聯夾界改用共用 `clamp`（一致性 / 復用已測 helper）。
  - 修改說明（2026-07-04）：`PlayPage`（cursor_x/cursor_y 各 1）與 `AnimationEditorTab`（spotlightOpacity、
    overlayImageOpacity、pointerOpacity×2）的 `Math.min(1, Math.max(0, …))` 改為 `clamp(…, 0, 1)`（兩檔皆已
    import clamp）。與原式位元等價、無行為變更；`clamp` 已有測試故不另加。屬一致性清理（消除內聯 min/max、
    收斂到單一 helper）。前端 `tsc --noEmit` 通過。分支 `refactor/reuse-clamp-opacity`，已 merge 回 master。
    BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 87 個完成項目（87/100，未達上限）。

## 指標正規化座標收斂為共用純函式（第二〇七輪，2026-07-04）

延續盤點：播放頁/遙控頁多處 onPointerMove/Up 內聯 `Math.min(1, Math.max(0, (clientX-rect.left)/rect.width))`
（x、y 各一份）計算「元素內正規化 [0,1] 座標」，重複且無測試。

- [x] 抽出指標正規化座標純函式 `normalizedPointerPosition`（去重 4 處 / 可測 / 復用 clamp）。
  - 修改說明（2026-07-04）：新增 [normalizedPointerPosition.ts](frontend/src/lib/normalizedPointerPosition.ts) 的
    `normalizedPointerPosition(clientX, clientY, rect)`——回 `{x, y}`、各以既有 `clamp(..,0,1)` 夾界（與原
    `Math.min(1,Math.max(0,..))` 位元等價、含 width/height=0 的 NaN 行為）。`PlayPageSlidePanel`（2 處影像框選）、
    `RemoteControllerPage`（`getNormCoords`）、`PlayPage`（游標推送）共 4 處改用之。新增
    `normalizedPointerPosition.test.ts`（4 組：中心、左上/右下角、超界夾 0/1）。前端 `tsc --noEmit` 通過、4/4
    通過。分支 `refactor/normalized-pointer-position`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 86 個完成項目（86/100，未達上限）。

## 投票選項清理收斂為共用純函式（第二〇六輪，2026-07-04）

延續盤點（轉後端）：`detail.ts` 建立投票有 2 處內聯 `options.map(o=>o.trim()).filter(Boolean)`（AI 版另
`.slice(0,6)`），送出前清理無測試。

- [x] 抽出投票選項清理純函式 `sanitizePollOptions`（去重 2 處 / 可測）。
  - 修改說明（2026-07-04）：在 [pollOptions.ts](backend/src/routes/pdfs/pollOptions.ts) 新增
    `sanitizePollOptions(options, limit?)`——去空白、濾空項，並在有 `limit` 時清理後取前 N 個。`detail.ts` 手動
    建立投票改用 `sanitizePollOptions(body.data.options)`、AI 產生投票改用 `sanitizePollOptions(generated.data.options, 6)`，
    行為等價。`poll-options.test.ts` 新增 4 組（去空白濾空、清理後夾 limit、無 limit 保留全部、全空/空回空）。
    後端 `tsc --noEmit` 通過、poll-options 9/9 通過。分支 `refactor/sanitize-poll-options`，已 merge 回 master。
    BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 85 個完成項目（85/100，未達上限）。

## 標籤字串解析收斂為共用純函式（第二〇五輪，2026-07-04）

延續既有程式碼盤點：`HomePage`／`PdfCard` 有 5 處內聯相同的「逗號分隔標籤字串 → 去空白非空陣列」解析、
無測試。

- [x] 抽出標籤解析純函式 `parseTags`（去重 5 處 / 可測）。
  - 修改說明（2026-07-04）：新增 [parseTags.ts](frontend/src/lib/parseTags.ts) 的 `parseTags(raw)`——
    `(raw ?? '').split(',').map(trim).filter(Boolean)`，null/undefined/空回空陣列。`HomePage` 4 處（標籤晶片、
    標籤過濾、加標籤）與 `PdfCard` 1 處改用之。其中標籤過濾原變體未 filter 空字串，但因比對的 tagFilter 皆非
    空、`includes` 結果不受影響，改用 filter 版行為等價。新增 `parseTags.test.ts`（4 組：split+trim、濾空項、
    null/undefined/空回空、單一標籤）。前端 `tsc --noEmit` 通過、4/4 通過。分支 `refactor/parse-tags`，已 merge
    回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 84 個完成項目（84/100，未達上限）。

## 逐字稿朗讀時間預估抽出純函式（第二〇四輪，2026-07-04）

延續既有程式碼盤點：`PlayPageSlidePanel` 逐字稿編輯區即時預估「字數 → 朗讀時間 mm:ss」的內聯邏輯
（`Math.round(chars/4)` 再手組字串）無測試。

- [x] 抽出朗讀時間預估純函式 `estimateSpeakingSeconds`／`estimateSpeakingTimeLabel`（可測 / 固化 chars/4 heuristic）。
  - 修改說明（2026-07-04）：新增 [speakingTimeEstimate.ts](frontend/src/lib/speakingTimeEstimate.ts)——
    `estimateSpeakingSeconds(chars)`（每秒約 4 字、四捨五入、非正/非有限回 0）與 `estimateSpeakingTimeLabel(chars)`
    （組成 m:ss、分不補零、秒補兩位，沿用原格式）。`PlayPageSlidePanel` 改用之，行為完全等價。新增
    `speakingTimeEstimate.test.ts`（4 組：chars/4 四捨五入、非正/NaN 回 0、m:ss 格式、空輸入 0:00）。前端
    `tsc --noEmit` 通過、4/4 通過。分支 `refactor/speaking-time-estimate`，已 merge 回 master。BLOG.md 新增對應
    section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 83 個完成項目（83/100，未達上限）。

## 錄音 session 模型純函式（第二〇三輪，2026-07-04）

推進錄音功能的資料層：銜接「錄音期間逐次切頁通知」與已固化的 `buildSlideTimeline`／`slideAtTime`
（第一九〇、一九四輪），補上中間的 session 累積層。仍不含 MediaRecorder／儲存／UI。

- [x] 抽出錄音 session 模型 `startRecording`／`recordSlideSwitch`／`stopRecording`（可測 / 錄音資料層中間層）。
  - 修改說明（2026-07-04）：新增 [recordingSession.ts](frontend/src/lib/recordingSession.ts)——`startRecording(page, now)`
    以起始頁建立 session；`recordSlideSwitch(session, page, now)` append 事件（切到同頁則回原參考 no-op、
    不改輸入）；`stopRecording(session, now)` 以 `max(0, now−start)` 為時長交給 `buildSlideTimeline` 產出時間軸。
    新增 `recordingSession.test.ts`（7 組：起始事件、切頁 append、同頁 no-op 同參考、不改輸入、停止產出時間軸、
    無切頁單一整段、停止時間 ≤ 起點回空）。前端 `tsc --noEmit` 通過、7/7 通過。分支 `feat/recording-session`，
    已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 82 個完成項目（82/100，未達上限）。

## 後端測驗分數加總驗證補單元測試（第二〇二輪，2026-07-04）

延續盤點，轉後端：`explicitScoreSum` 支撐 `POST /quizzes` 伺服器端「自訂分數加總不得超過 100 分」的權威
驗證（zod superRefine），但為 module-local、無單元測試。

- [x] 匯出並為 `explicitScoreSum` 補單元測試（伺服器權威計分驗證的覆蓋）。
  - 修改說明（2026-07-04）：`quizzes.ts` 的 `explicitScoreSum` 改為 `export`（用途/風險見既有註解：兩題各
    80 分會讓滿分被撐到 160/100）。新增 `explicit-score-sum.test.ts`（5 組：加總有效分數、缺/null 視為 0、
    負數/NaN/Infinity 視為 0、空清單回 0、偵測加總超過 100）。未改行為、僅加匯出與測試。後端 `tsc --noEmit`
    通過、5/5 通過。分支 `test/explicit-score-sum`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 81 個完成項目（81/100，未達上限）。

## 測驗題目完整性檢查抽出純函式（第二〇一輪，2026-07-04）

延續既有程式碼盤點：`QuizBuilderPage` 的 `canSave` 內聯一段非平凡的「每題是否完整」判斷、無測試。

- [x] 抽出測驗題目完整性檢查純函式 `allQuestionsComplete`（可測 / 固化可儲存規則）。
  - 修改說明（2026-07-04）：新增 [quizValidation.ts](frontend/src/lib/quizValidation.ts) 的
    `allQuestionsComplete(questions)`——每題須有非空題幹，且申論題（essay）免選項、其餘題型至少 2 個非空
    選項（空陣列回 true，呼叫端另檢查「至少一題」）。`QuizBuilderPage` 的 `canSave` 改用之。新增
    `quizValidation.test.ts`（6 組：選擇題合格、空題幹不合格、選項不足不合格、申論題免選項、需每題皆完整、
    空陣列回 true）。前端 `tsc --noEmit` 通過、6/6 通過。分支 `refactor/quiz-questions-complete`，已 merge 回
    master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 80 個完成項目（80/100，未達上限）。

## 已作答題數計算抽出共用純函式（第二〇〇輪，2026-07-04）

延續既有程式碼盤點：`QuizBuilderPage` 有 3 處內聯相同的「已作答題數」計算、無測試。

- [x] 抽出已作答題數純函式 `countAnsweredQuestions`（去重 3 處 / 可測）。
  - 修改說明（2026-07-04）：新增 [countAnsweredQuestions.ts](frontend/src/lib/countAnsweredQuestions.ts) 的
    `countAnsweredQuestions(questions, answers)`——一題只要有至少一個選取答案即算已作答（泛型）。
    `QuizBuilderPage` 三處（送出前檢查、進度顯示）改用之。新增 `countAnsweredQuestions.test.ts`（5 組：計已答、
    缺/空視為未答、無題回 0、全答、忽略無對應題目的答案）。前端 `tsc --noEmit` 通過、5/5 通過。分支
    `refactor/count-answered-questions`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 79 個完成項目（79/100，未達上限）。

## 書籤/重點頁切換抽出共用純函式（第一九九輪，2026-07-04）

延續既有程式碼盤點：`PlayPage` 的 `toggleBookmark`（書籤頁）與 `toggleImportantPage`（重點頁）內聯同一段
「切換數字於升冪清單」邏輯、無測試。

- [x] 抽出升冪數字切換純函式 `toggleSortedNumber`（去重 2 處 / 可測）。
  - 修改說明（2026-07-04）：新增 [toggleSortedNumber.ts](frontend/src/lib/toggleSortedNumber.ts) 的
    `toggleSortedNumber(list, value)`——存在→移除、不存在→加入並保持升冪（沿用原 filter/append 語意、不改
    輸入）。`PlayPage` 兩個 handler 改用之。新增 `toggleSortedNumber.test.ts`（5 組：加入保持升冪、移除已存在、
    空集合加入、移除唯一值變空、不改輸入）。前端 `tsc --noEmit` 通過、5/5 通過。分支
    `refactor/toggle-sorted-number`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 78 個完成項目（78/100，未達上限）。

## 首頁繁中排序比較器收斂為共用純函式（第一九八輪，2026-07-04）

延續既有程式碼盤點：`HomePage` 有 5 處分類/標籤排序重複同一個 `localeCompare(b, 'zh-Hant', {…})`，
字串字面易打錯、且排序規則無測試。

- [x] 抽出繁中排序比較器 `compareZhHant`（去重 5 處 / 可測）。
  - 修改說明（2026-07-04）：新增 [compareZhHant.ts](frontend/src/lib/compareZhHant.ts) 的
    `compareZhHant(a, b, { numeric })`——`sensitivity:'base'`（大小寫/腔調不敏感）、`numeric` 預設 `true`
    （自然數排序）。`HomePage` 4 處 `{numeric:true,…}` 改用 `.sort(compareZhHant)`、標籤排序（無 numeric）改用
    `.sort((a,b)=>compareZhHant(a,b,{numeric:false}))`，行為等價。新增 `compareZhHant.test.ts`（5 組：基本大小
    與符號一致、numeric 自然數排序、numeric:false 字典序、大小寫視為相等、可直接當 sort 比較器）。前端
    `tsc --noEmit` 通過、compareZhHant 5/5＋groupItemsByCategory 5/5＋HomePage.sort 6/6 回歸通過。分支
    `refactor/compare-zh-hant`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 77 個完成項目（77/100，未達上限）。

## 課後報告作答時間軸攤平排序抽出純函式（第一九七輪，2026-07-04）

延續既有程式碼盤點：`PostClassReportPanel` 的「作答時間軸」區塊在 JSX 內聯 IIFE 攤平所有學生的作答並依
送出時間排序，無測試。

- [x] 抽出作答時間軸攤平排序純函式 `flattenAttemptsChronologically`（可測）。
  - 修改說明（2026-07-04）：新增 [reportAttemptsTimeline.ts](frontend/src/lib/reportAttemptsTimeline.ts) 的
    `flattenAttemptsChronologically(students)`——把每位學生的 `attempts` 攤平、逐筆掛上該學生 `client_id`、
    依 `submitted_at` 升冪排序（泛型、不改輸入）。`PostClassReportPanel` 時間軸區塊改用之。新增
    `reportAttemptsTimeline.test.ts`（4 組：跨學生攤平＋依時間排序、掛 client_id、空學生/空 attempts 回空、
    不改輸入）。前端 `tsc --noEmit` 通過、4/4 通過。分支 `refactor/attempts-timeline`，已 merge 回 master。
    BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 76 個完成項目（76/100，未達上限）。

## 「複製全部逐字稿」Markdown 組裝抽出純函式（第一九六輪，2026-07-04）

延續既有程式碼盤點：`PlayPageHeader` 的「複製全部逐字稿」按鈕在 onClick 內聯了「依頁碼排序＋每頁組
`## 第N頁` 標題接逐字稿＋join」的組裝，無測試。

- [x] 抽出「複製全部逐字稿」Markdown 組裝純函式 `buildAllScriptsMarkdown`（去重雛形 / 可測）。
  - 修改說明（2026-07-04）：新增 [allScriptsMarkdown.ts](frontend/src/lib/allScriptsMarkdown.ts) 的
    `buildAllScriptsMarkdown(pages, scripts, {pagePrefix, pageSuffix})`——依 `page_number` 排序（不改輸入）、
    每頁輸出 `## <前綴>N<後綴>\n<逐字稿>`（缺稿留空）、頁間空一行。`PlayPageHeader` 的按鈕改用之。新增
    `allScriptsMarkdown.test.ts`（5 組：排序＋格式、缺稿留空、空頁回空字串、不改輸入、自訂前後綴）。前端
    `tsc --noEmit` 通過、5/5 通過。分支 `refactor/all-scripts-markdown`，已 merge 回 master。BLOG.md 新增對應
    section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 75 個完成項目（75/100，未達上限）。

## 測驗選項勾選切換抽出共用純函式（第一九五輪，2026-07-04）

轉回既有程式碼盤點（掃描確認：前端 lib 除 `api.ts`（HTTP/re-export）外皆有測試、後端 route 的 JSON.parse
皆已防護，無補漏測/防護的低垂果實）。於 `QuizBuilderPage` 發現一處**真實重複且無測試**的邏輯並收斂。

- [x] 抽出測驗選項勾選切換純函式 `toggleAnswerIndex`（去重 / 可測）。
  - 修改說明（2026-07-04）：`QuizBuilderPage` 的 `toggleAnswer`（設定正解）與 `toggleStudentAnswer`（學生
    作答）各自內聯同一段「單選→只留該選項；複選→用 Set 加/減後升冪排序」邏輯、無測試。新增
    [toggleAnswerIndex.ts](frontend/src/lib/toggleAnswerIndex.ts) 的
    `toggleAnswerIndex(current, index, single)`（單選回 `[index]`、複選加/減後去重升冪、不改輸入），兩處
    handler 改用之、各收斂為一行。新增 `toggleAnswerIndex.test.ts`（7 組：單選忽略現況、複選加/減、空集合加、
    移除最後一個、去重、不改輸入）。前端 `tsc --noEmit` 通過、7/7 通過。分支 `refactor/toggle-answer-index`，
    已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 74 個完成項目（74/100，未達上限）。

## 錄音模式播放讀取側純函式 slideAtTime（第一九四輪，2026-07-04）

接續第一九〇輪的 `buildSlideTimeline`（寫入側：把切頁事件正規化為時間軸），補上讀取側：同步播放時
依目前播放秒數查出「當下該顯示哪一頁」。這是「同步播放簡報+錄音」不可或缺的一環。

- [x] 新增時間軸讀取純函式 `slideAtTime(segments, ms)`（可測 / 錄音同步播放基礎）。
  - 修改說明（2026-07-04）：在 [slideTimeline.ts](frontend/src/lib/slideTimeline.ts) 新增
    `slideAtTime(segments, ms)`——回傳相對錄音起點 `ms` 當下顯示的頁碼，區段為半開區間 `[startMs, endMs)`
    （剛好落在某段 endMs 者屬下一段）；落在時間軸外（早於第一段、到達/超過結尾）或 `ms` 非有限值回 `null`。
    擴充 `slideTimeline.test.ts` 新增 4 組（區間內取頁、邊界半開歸屬、時間軸外/結尾回 null、空時間軸/NaN 回
    null），全檔 13/13。前端 `tsc --noEmit` 通過。分支 `feat/slide-at-time`，已 merge 回 master。BLOG.md 新增
    對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 73 個完成項目（73/100，未達上限）。

## Jupyter Notebook 唯讀渲染元件（第一九三輪，2026-07-04）

接續第一九二輪的 `.ipynb` 解析純函式，完成 NEW_FEATURE「Jupyter notebook 支持」首步 b 的**渲染元件**部分
（頁面接線拆為步驟 c 待續）。

- [x] 新增 Jupyter Notebook 唯讀渲染元件 `NotebookView`（建立在 `parseNotebook` 之上）。
  - 修改說明（2026-07-04）：新增 [NotebookView.tsx](frontend/src/components/NotebookView.tsx)。吃
    `ParsedNotebook`：markdown cell 走既有 `MarkdownMath`（標題／粗體／條列／表格／LaTeX）、code/raw cell 以
    等寬 `<pre><code>` 區塊顯示原始碼（空白 source 略過）、code cell 的 outputs 依三類呈現——text/error 用
    `<pre>`（error 以 rose 色系並粗體標 `ename: evalue`＋traceback）、image 以 `data:` URI `<img>`；空 notebook
    回 `null`。沿用專案 surface/border 色票、深色模式相容。前端 `tsc --noEmit` 通過（專案無 React 元件測試框架，
    元件以 tsc 驗證；解析邏輯已於步驟 a 的 `notebook.test.ts` 覆蓋）。分支 `feat/notebook-view`，已 merge 回 master。
    BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 72 個完成項目（72/100，未達上限）。

## Jupyter Notebook 解析純函式（第一九二輪，2026-07-04）

接續第一八九輪拆分的 NEW_FEATURE「Jupyter notebook 支持」首步。原「解析＋唯讀渲染」拆為 a（解析純函式，
本輪）與 b（前端唯讀渲染＋頁面接線，待續），先固化可測的解析核心。

- [x] 抽出 `.ipynb` 解析純函式 `parseNotebook`（可測 / Notebook 頁面基礎）。
  - 修改說明（2026-07-04）：新增 [notebook.ts](frontend/src/lib/notebook.ts) 的 `parseNotebook(raw)`（＋
    `ParsedNotebook`／`NotebookCell`／`NotebookOutput` 型別）。把 .ipynb 原始 JSON 正規化為依序 cell：
    `cell_type` 映射為 `markdown`／`code`／`raw`（未知歸 raw）、`source`（字串或字串陣列）併為單一字串；
    僅 code cell 解析 `outputs`，收斂三類——`stream`→text、`execute_result`／`display_data`→優先 image（`image/*`）
    否則 `text/plain`、`error`→{ename,evalue,traceback}（traceback 併行）。全程防護：損壞 JSON／非物件／
    無 cells 陣列→空 notebook，非物件 cell／無法呈現的 output 跳過但保留該 cell。新增 `notebook.test.ts`
    （9 組：md/code+陣列 source、stream→text、image 優先、text/plain fallback、error 併 traceback、未知型別歸
    raw 且忽略 outputs、丟棄無法呈現 output 保留 cell、損壞/缺 cells→空、跳過非物件 cell）。前端 `tsc --noEmit`
    通過、9/9 通過。分支 `feat/notebook-parser`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 71 個完成項目（71/100，未達上限）。

## 測驗錄影人頭偵測提示狀態機純函式（第一九一輪，2026-07-04）

接續第一八九輪拆分的 NEW_FEATURE「測驗錄影加人頭偵測」首步：逐幀偵測會有單幀誤判，若每次抓不到臉就
閃提示會很干擾。先固化「偵測結果序列 → 是否提示」的去抖狀態機，作為之後接偵測迴圈／UI 的可測基礎。

- [x] 抽出人頭偵測提示去抖狀態機 `updateHeadDetectionState`（可測 / 人頭偵測基礎）。
  - 修改說明（2026-07-04）：新增 [headDetectionPrompt.ts](frontend/src/lib/headDetectionPrompt.ts) 的
    `updateHeadDetectionState(state, headDetected, missThreshold)`（＋`HeadDetectionState` 型別與
    `initialHeadDetectionState`）。遲滯設計避免閃爍：開啟提示需「連續 `missThreshold` 幀未偵測」（on-delay
    去抖、threshold 夾為至少 1 並向下取整），偵測到人頭則立即清除提示並歸零計數（快速恢復）；提示開啟後維持
    到偵測到人頭為止。detect 為 no-op 時回傳同一物件參考。新增 `headDetectionPrompt.test.ts`（8 組：未達門檻
    不提示、達門檻提示、單幀偵測不觸發、偵測即清除提示、提示持續到偵測、門檻夾 ≥1、非整數門檻向下取整、
    no-op 同參考）。前端 `tsc --noEmit` 通過、8/8 通過。分支 `feat/head-detection-prompt`，已 merge 回 master。
    BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 70 個完成項目（70/100，未達上限）。

## 錄音模式簡報切換時間軸純函式（第一九〇輪，2026-07-04）

接續第一八九輪拆分的 NEW_FEATURE「錄音模式」首步：先固化「錄音時記錄簡報切頁時間點 → 正規化時間軸」
的資料模型與純函式，作為未來「同步播放簡報+錄音」或「合成影片」的共同基礎（尚不含錄音 UI／儲存／
MediaRecorder 接線）。

- [x] 抽出簡報切換時間軸純函式 `buildSlideTimeline`（可測 / 錄音模式基礎）。
  - 修改說明（2026-07-04）：新增 [slideTimeline.ts](frontend/src/lib/slideTimeline.ts) 的
    `buildSlideTimeline(recordingStartMs, events, recordingDurationMs)`（＋`SlideSwitchEvent`／
    `SlideTimelineSegment` 型別）。把原始切頁事件（絕對時間戳、可能亂序）換算成相對錄音起點的 0-based
    連續區段 `{page, startMs, endMs}`：夾到 `[0, duration]`（濾掉錄音前/後雜訊）、依偏移穩定排序、合併
    連續同頁、第一段回溯到 0 覆蓋整段錄音、濾除零長度區段（同一時間點以較晚事件勝出）；空事件或
    `duration ≤ 0` 回空。沿用既有 `clamp`。新增 `slideTimeline.test.ts`（9 組：連續區段、首段回溯、亂序
    排序、同頁合併、真實回看前頁保留、前後雜訊夾界、同刻零長度濾除、空/非正 duration、忽略非整數頁/
    非有限時間）。前端 `tsc --noEmit` 通過、9/9 通過。分支 `feat/recording-slide-timeline`，已 merge 回 master。
    BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 69 個完成項目（69/100，未達上限）。

## 規畫輪：批次匯出進度條 + 依 NEW_FEATURE 補充項目（第一八九輪，2026-07-04）

盤點：AI 導師（PageAskPanel）品質 backlog 已幾乎清空（僅剩 SSE 串流，屬大項、不宜自動 loop 逕行）；
其餘未完成 `[ ]` 多為**待使用者決定**（系統性 mapApiErrorToHumanMessage、前端測試納入 root）、
**需產品／身分裁示**（課後報告個人層級——`quiz_attempts.client_id`／`page_poll_votes.voter_id`／
`page_watch_progress.viewer_id`／`page_comments.author` 身分鍵不統一，跨表彙整需先定義「同一人」）、
或 **§8.1.5 header 分組需產品確認**。乾淨、低風險、可自動完成的既有 backlog 已實質見底。依 LOOP.md
第 2 條，分析後參考 [NEW_FEATURE.md](NEW_FEATURE.md) 方向新增五個項目，並完成其一（匯出進度條）。

- [x] **批次匯出「匯出全部 ZIP」顯示視覺進度條**（NEW_FEATURE「匯出時顯示進度條」）：`HomePage` 的批次
  匯出（`/api/export/batch` job + `pollBatchExport`）原本只在按鈕文字顯示「打包中… N/total」，無視覺
  進度條。
  - 修改說明（2026-07-04）：`HomePage` 在匯入 ZIP 進度條區塊旁新增批次匯出進度條（僅
    `batchExportJobId !== null && batchExportTotal > 0` 時顯示），沿用既有 `batchExportProgress`/
    `batchExportTotal` 狀態與已測純函式 `progressPercent(current,total)`（clamp 0–100、防 NaN）計算寬度與
    `aria-valuenow`，樣式比照既有 importZip 進度條（emerald 色系、`role="progressbar"`）。新增 i18n 鍵
    `home.batchExportProgressAriaLabel`（zh-TW／en）。純前端、無新邏輯風險（百分比走既有測試覆蓋的
    helper）。前端 `tsc --noEmit` 通過、i18n parity 24/24。分支 `feat/batch-export-progress-bar`，已 merge
    回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 68 個完成項目（68/100，未達上限）。

以下為本輪新增、待後續 loop 接續的四個項目（依 NEW_FEATURE.md 方向，已拆成 autonomous-friendly 首步）：

- [ ] **單份簡報匯出（export.zip）進度回報**（NEW_FEATURE「匯出進度條」延伸）：`GET /api/pdfs/:id/export.zip`
  目前為同步一次性打包（`runZipCommand` 後整包 `readFile` 回傳）、前端無進度。改為 job 化（比照 batch-export
  的 `job + poll + download` 三段式）或串流，讓 PlayPage 的單份匯出也能顯示進度條。可拆：後端 job scaffolding +
  status 端點（可測）／前端輪詢與進度條（複用 `progressPercent`）。
- [x] **錄音模式——第一步：簡報切換時間軸純函式**（NEW_FEATURE「錄音模式」）：定義「錄音 session + 簡報
  切換事件」資料結構，抽出可測純函式把 `(recordingStartMs, pageSwitchEvents[])` 正規化為 `{page, startMs,
  endMs}` 連續區段（處理亂序、同頁連續、結尾以錄音長度收尾），供未來「同步播放簡報+錄音」或「產生影片」使用。
  先做時間軸模型與測試，不含錄音 UI／儲存／MediaRecorder 接線。（第一九〇輪完成，見下方「錄音模式簡報切換時間軸純函式」section）
- [x] **測驗錄影人頭偵測——第一步：提示狀態純函式**（NEW_FEATURE「測驗錄影加人頭偵測」）：在既有
  `useQuizRecorder` 錄影流程加 in-browser 人臉/人頭偵測（優先用瀏覽器原生 `FaceDetector`，退回輕量模型），
  偵測不到時提示並顯示鏡頭預覽。先抽出「偵測結果序列 → 是否提示」的純函式（連續 N 次未偵測才提示、含去抖，
  避免單幀誤報造成閃爍），可測；再接 UI／偵測迴圈。（第一九一輪完成，見下方「測驗錄影人頭偵測提示狀態機純函式」section）
- [x] **Jupyter Notebook 頁面型別——第一步 a：解析純函式**（NEW_FEATURE「Jupyter notebook 支持」）：把 `.ipynb`
  原始 JSON 解析成正規化 cell 模型（markdown／code／raw，code 的 outputs 收斂為 text／image／error，防護損壞
  JSON 與缺欄位）。（第一九二輪完成，見下方「Jupyter Notebook 解析純函式」section）
- [x] **Jupyter Notebook 頁面型別——第一步 b：前端唯讀渲染元件**（NEW_FEATURE「Jupyter notebook 支持」）：
  以第一步 a 的 `parseNotebook` 模型做唯讀渲染元件（markdown 走 `MarkdownMath`、code 以等寬樣式、outputs 支援
  text／image／error）。（第一九三輪完成，見下方「Jupyter Notebook 唯讀渲染元件」section）
- [ ] **Jupyter Notebook 頁面型別——第一步 c：頁面接線**（NEW_FEATURE「Jupyter notebook 支持」）：定義
  「.ipynb 如何成為一個頁面」的上傳/載入/儲存接線，並在播放/檢視流程把 `NotebookView` 接上實際資料。「在頁面中
  執行代碼」列為後續獨立項目。

## 測驗監考錄影只錄影不錄音（使用者要求，2026-07-02）

使用者要求：測驗錄影時不要錄音，只錄影就好。

- [x] 監考錄影改為只擷取影像、不請求麥克風。
  - 修改說明（2026-07-02）：[useQuizRecorder.ts](frontend/src/hooks/useQuizRecorder.ts) 的
    `getUserMedia` 由 `{ video, audio: true }` 改為 `audio: false`，避免收錄考場環境音或學生說話；
    串流無音軌後，即使 MediaRecorder 用含 opus 的 mime 字串，產出仍為純視訊 webm。更新模組與
    呼叫處註解。無測試斷言 `audio: true`，前端 `tsc --noEmit` 通過。分支
    `feat/quiz-recording-video-only`，已 merge 回 master。
  - 本項為使用者要求的功能變更，**不計入** 100 輪計數。

## 身分式分享權限：只讀/讀寫名單 + 預設權限（使用者要求，2026-07-03）

使用者要求：更改分享模式，可設定特定使用者為只讀或讀寫，並設定一個預設權限；不在名單中的人套用
預設權限。後續補充：名單提供 search（email／display name／群組名稱）挑選、可把名單存成群組、
系統設定加群組定義；預設權限沿用現有 `visibility`。分成多個步驟推進：

- [x] 步驟 1：ACL 資料層 + 權限解析核心。新增 `pdf_permissions` 表（principal user／預留 group、
  access read_only/read_write）與 [pdfAccess.ts](backend/src/routes/pdfs/pdfAccess.ts) 的
  `resolvePdfAccessLevel`／純函式 `decidePdfAccessLevel`（擁有者永遠 edit、名單命中覆蓋預設、
  未列名回退 visibility、email 不分大小寫）。11 單元測試。分支 `feat/pdf-acl-step1-resolver`（已 merge）。
- [x] 步驟 2a：`canReadPdf`/`canEditPdf` 加可選 ACL context（不傳則行為不變）；接線 detail 的列表過濾與
  GET 讀取閘門，detail 回應加 `access_level`。新增 `sessionEmail()`。5 HTTP 測試 + 既有 92 權限測試無回歸。
  分支 `feat/pdf-acl-step2a-read-gate`（已 merge）。
- [x] 步驟 2b：新增 `aclCtx(request, id)` 並接線全站約 130 個 `canReadPdf`/`canEditPdf` 呼叫點（detail、
  page-operations、figures、drawings、page-animation、comments、watchProgress、subtitles、quizzes、
  generate-*、regenerate、add-pages、from-pages、versioning、search、匯出/報告類、sync follower/名單）。
  保留 admin.ts／upload.ts（建立流程、不同 auth helper）與 `canDestructivelyEditPdf`（owner-strict）——
  未接線者 fail-closed、安全。權限套件無回歸。分支 `feat/pdf-acl-step2b-wire-routes`（已 merge）。
- [x] 步驟 3：管理 API [pdfPermissions.ts](backend/src/routes/pdfs/pdfPermissions.ts)——擁有者
  GET/PUT/DELETE `/api/pdfs/:id/permissions`（名單增刪查、email 正規化小寫）＋ `GET /api/accounts/search`
  （依 email／display name 比對已知帳號，供挑選）。預設權限沿用既有 visibility PATCH。5 API 測試。
  分支 `feat/pdf-acl-step3-admin-api`（已 merge）。
- [x] 步驟 4：前端分享對話框新增「存取權限」分頁（僅擁有者可見）——
  [AccessControlPanel.tsx](frontend/src/pages/play/AccessControlPanel.tsx)：預設權限選擇（對應 visibility）、
  含 search 的加入框（帳號 search 或直接輸入 email）、名單逐項改權限/移除。新增 API client 與 zh-TW/en
  文案（i18n parity 24/24）。前端 typecheck + ShareDialog 測試通過。分支 `feat/pdf-acl-step4-share-ui`（已 merge）。
- [x] 步驟 5：群組。DB 表 `groups`/`group_members` + 後端 owner-scoped CRUD
  [groups.ts](backend/src/routes/pdfs/groups.ts)（POST 可帶 seed emails 供「存成群組」；4 測試）；
  resolver `fetchMatchedGrants` 展開群組成員（成員繼承群組授權、直接與群組取最高）；管理 API 的
  PUT/DELETE/list 支援 group principal（回傳群組名稱＋人數）。前端：系統設定新增「群組」分類
  [GroupsManager.tsx](frontend/src/components/GroupsManager.tsx)（建群組/成員增刪含 search）；分享
  「存取權限」分頁 search 納入群組、名單顯示群組（👥＋人數）、「把目前名單存成群組」。分支
  `feat/pdf-acl-step5-groups-backend`／`-step5c-groups-ui`／`-step5d-share-groups`（皆已 merge）。
- [x] 步驟 6：收尾。前端 `PdfDetail` 加 `access_level`，`PlayPage` 的 `shareIsReadOnly` 納入
  `access_level==='read'`——只讀名單使用者顯示唯讀 UI（不再出現會被後端擋下的編輯鈕）；讀寫授權
  仍解析為 edit、可編輯。前後端 typecheck 通過；ACL/群組/權限測試 42 綠（pdf-access 13、
  permissions-api 6、groups-api 4、read-gate 5、sync-join 14）。分支 `feat/pdf-acl-step6-readonly-ui`
  （已 merge）。

本功能（身分式分享權限：只讀/讀寫名單＋群組＋預設權限）**六步驟全部完成**。保留項：admin.ts／
upload.ts 的權限判斷仍為 visibility-only（建立流程／管理情境，fail-closed 安全，非核心分享路徑）。

## 分享權限模型統一：兩套系統＋分享連結成為能力憑證（使用者要求，2026-07-04）

先前檢討發現「誰能存取簡報」由三套語意重疊的機制決定：`visibility`、分享連結 token（`pdf_shares`）、
身分式 ACL（`pdf_permissions`／群組）。其中分享連結並非真正的能力憑證——建立連結時會**偷偷翻動
全域 `visibility`**（read_only→public、editable→public_editable），token 本身不具保密力，且 editable
連結的編輯能力其實來自 visibility 而非 token；`hasShareAccess` 也未檢查到期。使用者要求：把三套整併成
**兩套一致的系統**，每個動作都以兩套系統的**較高權限**為準。

- [x] 統一為兩套系統：
  - **系統一（身分權限）**：`visibility` 預設 ＋ per-user/group ACL，合併由 `resolvePdfAccessLevel` 解析。
    前端「存取權限」分頁即此設定（預設權限＋名單），與分享連結分頁分離呈現。
  - **系統二（Token 能力憑證）**：新增 `resolveTokenAccessLevel`（含到期檢查），任何持有有效 token 的人
    （含未登入）取得 token 內含的 read／edit 能力；建立連結**不再改動 visibility**（後端移除翻動、前端
    移除送出 `visibility` 與本地誤設 public）。
  - **合併決策**：`aclCtx` 帶入 token 能力，`canReadPdf`/`canEditPdf` 內部以 `max(身分, token)` 決策；
    全站約 146 個讀寫閘門呼叫點無需改動即同時吃兩套系統。清掉 40 處多餘且有到期 bug 的
    `hasShareAccess`／`shareAccessForPdf` 讀取前綴，收斂為單一路徑。detail 回應的 `access_level` 改為
    **有效權限**（身分 max token），前端 `shareIsReadOnly` 隨之一致。
  - **破壞性操作**：刪頁／刪測驗／刪投票／刪畫板等改以 `canDestructivelyEditPdf`＋合併 context，需解析出
    edit（不論來源）**且已登入**；**刪除整份簡報**限縮為**僅擁有者**（`isPdfOwner`）。
  - 後端 tsc 通過；既有權限套件無回歸（delete 測試更新為 owner-only）＋新增 `token-capability` 測試；
    前端 tsc 通過、i18n 文案更新以區分兩套概念。分支 `feat/unified-access-capability-tokens`。
  - 測試缺口補齊（使用者要求）：後端 `token-capability` 擴充至 **22 測試**——`resolveTokenAccessLevel`
    邊界（無 token／格式錯／對到別份／read↔edit／過期）、detail `access_level` 為**有效權限**（editable
    token→edit、read_only token→read）、破壞性操作**經 read_write 名單授權**（非 visibility）＋整合
    DELETE drawing 驗證接線、editable token 於第二條編輯路由（PATCH title）賦權。前端把 `shareIsReadOnly`
    抽成純函式 [deckAccess.ts](frontend/src/pages/play/deckAccess.ts) 的 `resolveDeckReadOnly` 並接回
    `PlayPage`，新增 7 測試（`deckAccess.test.ts`）。後端各權限套件與前端 tsc／deckAccess＋ShareDialog＋i18n
    全綠。備註：多個 buildApp 整合檔並跑會遇 SQLite 檔鎖競爭，分組序跑即正常。
  - 二次矩陣覆核（使用者要求，2026-07-04）發現並修復一個**提權漏洞**：`PATCH /api/pdfs/:id/visibility`
    的閘門原為 `canEditPdf(...aclCtx)`，新模型下匿名 editable-token 持有者或 read_write 名單使用者可
    改「預設權限」（如改成 public_editable 讓全世界永久可編輯、token 過期後仍有效）。visibility 變更屬
    **存取管理**而非內容編輯，改為 owner-only（`hasOwnerOrLegacyAccess`），與 ACL 管理 API／建立分享
    連結一致。`token-capability` 擴充至 **27 測試**，補齊矩陣：建立分享連結 owner-only（非擁有者／
    token 持有者 403）、visibility owner-only（read_write 名單與匿名 token 皆 403、owner 200）、
    read_write 名單刪整份簡報 403、只讀名單＋editable token→有效 edit（反向 max）、群組授權 HTTP
    端對端（read_only 群組可讀不可編、升 read_write 可編、陌生人 403）。相關 9 套件序跑全綠。分支
    `fix/access-admin-owner-only`。

## 同步 master/follower 定義改為以擁有者為準（使用者要求，2026-07-02）

使用者要求變更 master/follower 的定義：「自己的簡報按下同步模式會變成 master，不是的會變成 follower」。
原本 master 是「第一個以編輯權限（owner 或 public_editable 協作者）加入同步的人」，導致有編輯權限的
協作者也能搶下主控權。新定義收斂為：**只有簡報擁有者**按下同步會成為 master，其他所有人（分享連結
訪客、public 唯讀觀看者、public_editable 協作者）一律為 follower。

- [x] 同步 master 角色改以「簡報擁有者」為判準（取代「有編輯權限且先搶先贏」）。
  - 修改說明（2026-07-02）：後端 [sync.ts](backend/src/routes/pdfs/sync.ts) 的 `/sync/join` 與 `/sync/state`
    取得主控權的門檻由 `canEditPdf` 改為 `isPdfOwner`——非擁有者（含 public_editable 協作者）呼叫
    master 路徑回 403，只能以 follower 走 `/sync/share-join`。前端 [PlayPage.tsx](frontend/src/pages/PlayPage.tsx)
    新增 `isSyncMasterEligible = Boolean(detail?.is_owner)`，加入路徑（join vs share-join）、自動跟隨、
    master 失效後是否自動重奪，全部改以此判準（取代原本的 `currentShareToken || shareIsReadOnly`）。
    更新 `sync-join-permission.test.ts`：原「public_editable 協作者可取得 master」改為「被拒（403）、
    但可以 follower 身分 share-join」，並新增「非擁有者協作者無法於 /sync/state 空窗期搶 master」測試。
    前後端 `tsc --noEmit` 通過；sync 權限 13/13 測試 + 其餘 sync 測試 7/7 回歸通過（以 Node 22 執行）。
    分支 `feat/sync-master-follower-by-ownership`，已 merge 回 master。
  - 本項為使用者要求的功能變更，**不計入** 100 輪計數。

## AI 導師（PageAskPanel）回答品質改善（使用者要求，2026-06-28）

背景：AI 導師回答先前把換行輸出成字面 `\n`，已於後端 `/pages/:n/ask`（[page-operations.ts](backend/src/routes/pdfs/page-operations.ts)）回傳前正規化成真換行（分支 `fix/ai-tutor-newline-readability`）。以下為可進一步提升回答可讀性與品質的後續項目：

- [x] **Markdown 渲染**：~~回答含 `**粗體**`、`##` 標題、`-`/數字條列，但目前以純文字顯示~~。**已完成**（非本輪）：`PageAskPanel` 現以自寫的輕量渲染器 [MarkdownMath.tsx](frontend/src/components/MarkdownMath.tsx) 呈現 AI 導師回答，支援標題／粗體／斜體／行內碼／條列／表格與 LaTeX（katex），文字走 React text node、不用 innerHTML（僅 katex 產出的受信任 HTML 例外）。此項於先前輪次隨 MarkdownMath 導入而解決，僅補記狀態、**不計入**計數。
- [ ] **串流輸出（streaming）**：目前 `/ask` 一次回傳完整 JSON，長答需等待且無進度感。改為 SSE 串流（比照 `animation/custom-script` 既有 SSE 模式），逐段顯示、可中途取消。
- [x] **輸出長度／結構控制**：system prompt 要求「完整、不刻意精簡」常導致過長。新增「精簡／詳細」切換或長度上限，並引導模型先給重點摘要再展開。（第一八七輪完成，見下方「AI 導師回答長度精簡／詳細切換」section）
- [x] **引用頁碼可點擊**：回答中的「（第 N 頁）」目前是純文字。解析成可點連結，點擊跳到該頁，提升跨頁查證效率。（第一八六輪完成，見下方「AI 導師回答的引用頁碼可點擊跳頁」section）
- [x] **錯誤與空答處理**：當所有內容皆無相關資訊時，模型偶爾仍杜撰；強化 prompt 與後處理（偵測「查無資訊」語句時給固定提示），並把後端原始錯誤改走 `mapApiErrorToHumanMessage`。（第一八八輪完成，見下方「AI 導師錯誤與空答處理」section）
- [x] **保留對話脈絡的上限管理**：`history` 全量帶入長對話會超出 token 預算；加上輪數/字數截斷與必要的摘要壓縮。（第一八五輪完成，見下方「AI 導師多輪對話脈絡字數上限管理」section）

## add-pages 失敗導致 metadata 與 DB 分歧 + Uhga6bY0Bm 修復（使用者回報 bug，2026-06-27）

使用者回報：簡報 `Uhga6bY0Bm` 第 42 頁以後資料因前一次失敗的「多面產生」而像是不見了。

- 診斷：`runAddPagesFromPrompt` 的 `runAddPagesJob` 會**先**就地改動 DB 結構（把既有頁碼整批位移、`pdfs.page_count` +N、插入新頁列），卻只在**成功路徑**才重寫 `metadata.json`。那次任務在產圖/逐字稿/語音途中失敗（第 42 頁僅產出圖、43/44 全空），重啟後 `recoverOrphanedAddPagesPages()` 把這 3 頁半成品標成 `failed`。結果 DB 是位移後的 86 頁（原 42–83 → 45–86，外加 42–44 三筆 failed），但 `metadata.json` 仍停在舊的 83 頁佈局 → **DB 與 metadata 分歧**，使信任 metadata 的消費端（匯出／GitHub 同步／重新匯入）呈現殘缺或整份壞掉的簡報，但其實沒有任何頁面真的遺失（原始 83 頁檔案完整）。
- 實例修復：依使用者裁示「保留 3 頁並重新產生」，把 `Uhga6bY0Bm/metadata.json` 重建為與 DB 一致的 86 頁（原 83 頁時間戳保留、新增 42/43/44 三頁 failed 條目），消除分歧。三頁的實際內容重產（LLM 產圖／TTS，計費且需後端執行）保留給使用者於 UI 觸發。
- 程式碼修復（分支 `fix/add-pages-failure-metadata-consistency`，已 merge）：抽出 `rebuildAddPagesMetadataFromDb(pdfId)`（從 DB 重建 metadata 的 pages/page_count），在**成功與失敗（含取消）兩條終結路徑都呼叫**，使 DB↔metadata 永不分歧；best-effort（寫入失敗只記 log，不掩蓋原始錯誤）。新增 `add-pages-metadata-resync.test.ts`（2 測試），前後端 typecheck 通過、新測試 + orphan-recovery 5 回歸全綠。
- 本項為使用者回報 bug 修復，**不計入** 100 輪計數。

### 後續可執行項目（本輪盤點新增）

- [x] **`regenerate-image` 對「無底圖」頁面退而用文字→圖生成**：原本單頁 `POST /api/pdfs/:id/pages/:n/regenerate-image`（[page-operations.ts](backend/src/routes/pdfs/page-operations.ts)）與「重生」批次 job 的圖檔步驟（[regenerate.ts](backend/src/worker/regenerate.ts)）都一律以 `client.images.edit` 拿現有圖當基底；像 `Uhga6bY0Bm` 第 42/43/44 頁這種失敗後底圖檔不存在的頁面，會在讀檔時 `ENOENT` 整個任務失敗、無法於 UI 重產（使用者實際遇到）。
  - 修改說明（2026-06-27）：兩處都改為「底圖檔缺失時不丟錯、改走文字→圖生成」——讀底圖以 `try/catch` 包覆（僅吞 `ENOENT`、其餘照拋並記 warn）；有 figure 參考圖則 `images.edit`（以參考圖為輸入、用 base prompt）、否則純 `images.generate`，比照初次產圖 `renderTextPagesWithLlm` 的選擇邏輯；有真底圖時行為完全不變（仍用 edit + edit 模板）。新增 `regenerate-image-missing-base.test.ts`（單頁路由 + 重生 job 各驗證缺底圖時呼叫 generate 而非 edit、且 job 完成並寫出新圖）。後端 typecheck 通過，新測試 2/2 + figure-reference/image-edit-timeout 回歸通過。分支 `fix/regenerate-image-missing-base`（已 merge）。
  - 本項為使用者回報 bug 修復，**不計入** 100 輪計數。

- [x] **Uhga6bY0Bm 第 42/43 頁焦點動畫紅框位置全錯（使用者回報，2026-06-27）**：使用者回報「AI 產生動畫時似乎沒看到正確的圖片，紅框位置都差很多」，以第 42 頁為例。
  - 診斷（2026-06-27）：經完整查證，**目前的程式碼是正常的**——圖片有正確送出、模型也看得到。(1) 第 42 頁 `image_path` 指向的 `gVY2JLjpeT.jpg`（1920×1080）內容正確、`sharp` 能正常載入成 1024px data URL；(2) 該帳號用 `LLM_PROVIDER=cgu-air`、`CGU_AIR_LLM_MODEL=gpt-5.5`，直接把圖片送該端點問它看到什麼，它精準描述出版面（左 5 項目卡片、右側矩陣 A×x=y 與展開式、底部說明框），證實 gpt-5.5 支援 vision 且圖片有被處理；(3) 用真正的 `generateAiFocusEffects` 程式路徑對第 42 頁重跑 4 次，全部產生**貼合版面、多樣**的方框（左欄穩定落在 xPct≈16、底部展開式框在右下、無視覺元素的句子被正確略過），從未退化。對照存檔的壞規格：第 42/43 頁全是 `xPct:10`、`yPct` 機械遞增（10/25/40/55/70/85/95…）、幾乎每句都顯示——這是**純文字模型「看不到圖片」時平均分散方框**的典型特徵。結論：第 42/43 頁是先前 add-pages 失敗後那批補產動畫的**舊殘留**，當時圖片未被模型使用（推測為當下用了不具 vision 的模型或閘道暫時性丟棄圖片），與現行程式碼無關。
  - 資料修復（2026-06-27）：以現行 gpt-5.5 設定，透過真正的持久化路徑 `generateAnimationForPage` 重產第 42、43 頁焦點動畫並寫回 `animation.json` + `pages` 資料表。重產後 distinct xPct 由 1（全 x10）變為 4–5、效果數由 13/6 收斂為 8/5、方框位置貼合實際版面。第 44 頁為 `static-image`、本就無動畫規格（非壞殘留），未變動。
  - 程式碼修復（分支 `fix/autofocus-image-provider-comment`，已 merge）：修正 [animationAutoFocus.ts](backend/src/services/animationAutoFocus.ts) `generateAiFocusEffects` docstring 中**已過時且會誤導排查的註解**——原稱圖片「only actually used when `LLM_PROVIDER=openai`」（因 Gemini 會剝除非文字內容）。此說法已不正確：`buildGeminiContents` 會把 data URL 轉成 `inlineData`、OpenAI 相容 provider（openai/cgu-air/openrouter）直接透傳 `image_url`，故圖片在**所有現行 provider 都會送達模型**；改寫為依實際逐 provider 行為描述，並點明「結果看似純文字（方框機械排成一欄、無視版面）代表模型/閘道未套用 vision，而非本程式碼把圖片丟掉」。僅改註解，後端 `tsc --noEmit` 通過。
  - 本項為使用者回報 bug 修復，**不計入** 100 輪計數。

## 品質檢查面板徽章狀態抽出純函式（第一八四輪，2026-06-28）

推進 §7.2（品質檢查自動化）的前端基礎：`QualityCheckPanel` 三個分析區塊（品質/逐字稿/圖片）的標題徽章顯示判斷以巢狀三元運算式重複了三份、無獨立測試，且為 §7.2 後續「側邊欄分頁品質徽章」所需。

- [x] 抽出品質檢查徽章狀態純函式 `analysisBadgeState`（去重 / 可測 / §7.2 基礎）。
  - 修改說明（2026-06-28）：`lib/qualityCheckSelection.ts` 新增 `analysisBadgeState(hasRun, running, issueCount)`，回傳判別聯集 `{kind:'hidden'} | {kind:'ok'} | {kind:'issues',count}`（未執行/執行中→hidden、完成無問題→ok、否則→帶數量 issues）。`QualityCheckPanel` 三區塊改用之（品質區塊問題數用過濾後的 `issuePages.length`），移除三份重複巢狀三元；顏色仍由各區塊 JSX 依語意自選、顯示行為等價。新增 4 組測試。前端 `tsc --noEmit` 通過、qualityCheckSelection 9 測試通過。分支 `refactor/analysis-badge-state`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 63 個完成項目（63/100，未達上限）。

## 首頁分類分組組裝抽出純函式（第一八三輪，2026-06-27）

延續前端：`HomePage` 的 `categoryGroups` 內聯了「find-or-create 分組+組內排序+組間排序+預設分類 fallback」，比較器本身已測但分組組裝無測試。

- [x] 抽出首頁分類分組純函式 `groupItemsByCategory`（可測 / 固化分組與排序組裝）。
  - 修改說明（2026-06-27）：新增 `lib/groupItemsByCategory.ts` 泛型 `groupItemsByCategory(items, defaultCategory, sortItemsInGroup)`（依 category 分組、空白/缺失歸預設、組內用傳入排序器、組間依分類名 locale-aware/numeric、不可變）。`HomePage` `categoryGroups` 改用之（「最近播放」特例維持）。新增 `groupItemsByCategory.test.ts`（5 組：分組排序、缺分類歸預設、套用排序器、不改輸入、空回空）。前端 `tsc --noEmit` 通過、groupItemsByCategory + HomePage.sort 共 11 測試通過。分支 `refactor/group-items-by-category`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 62 個完成項目（62/100，未達上限）。

## 範本庫分類/搜尋/排序抽出純函式（第一八二輪，2026-06-27）

延續前端：`TemplatesPage` 的分類晶片衍生與「依分類+搜尋過濾、依模式排序」內聯在 useMemo、無測試；newest 保留 API 序、popular 套用次數降冪（穩定排序）等細節易在改動時壞掉。

- [x] 抽出範本庫過濾/排序純函式 `templateCategories`／`filterAndSortTemplates`（可測 / 固化排序規則）。
  - 修改說明（2026-06-27）：新增 `lib/templateFilter.ts`（`templateCategories` 回 `['all', ...去重排序]`；`filterAndSortTemplates(templates, {category, query, sortMode})` 依分類+搜尋名稱/說明/提示詞過濾，newest 保留原序／popular 套用次數降冪，不可變）。`TemplatesPage` 兩 useMemo 改用之。新增 `templateFilter.test.ts`（5 組：分類去重含空、分類過濾、搜尋三欄位含 CJK/大小寫、newest/popular 排序、不改輸入）。前端 `tsc --noEmit` 通過、5/5 通過。分支 `refactor/template-filter`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 61 個完成項目（61/100，未達上限）。

## 測驗歷史平均分抽出純函式 + flaky 調查結論（第一八一輪，2026-06-27）

- [x] 抽出測驗歷史平均分純函式 `averageAttemptScore`（可測）：`QuizBuilderPage` 作答歷史平均分 IIFE（過濾未評分 null→取平均→全空回 null）內聯無測試。
  - 修改說明（2026-06-27）：`lib/quizScoring.ts` 新增 `averageAttemptScore(attempts)`（只計有分數者、回未四捨五入平均、無評分回 null），`QuizBuilderPage` 改用之（四捨五入仍於呼叫端）。新增 4 測試（quizScoring 15）。前端 `tsc --noEmit` 通過。分支 `refactor/average-attempt-score`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 60 個完成項目（60/100，未達上限）。

- 調查結論（第一八一輪）：完整後端套件併跑的 `render-text-pages-figure-injection`（`renderTextPagesWithLlm uses images.edit…`）為**非確定性** flaky——隔離跑 2/2 穩定通過，與既有 figure-reference/llmUsage 同屬跨檔全域狀態污染（image client/provider 設定）。多次嘗試以單檔組合重現皆未穩定觸發，依特定交錯順序才發生。**結論：不值得在自動 loop 中盲修**（危害低、隔離下全綠、修復需可靠重現特定交錯）；建議若要修，於各受影響測試「測試開頭顯式重設所依賴的全域 AI 設定」由人工專輪處理。併入既有 line「完整後端套件零星 flaky」觀察。

## 完整套件基線檢查 + 修自引入測試回歸（第一八〇輪，2026-06-27）

本輪跑完整前後端套件確認基線：**前端 575/575 全綠**；後端 1247 測試 3 失敗。逐一查證：
- 後端 2 個（`figure-reference-image-generation`、`llmUsage`）為**既有 flaky**——隔離跑 10/10 通過，僅完整套件併跑因全域狀態污染失敗（即 TODO 既有觀察項，非本輪引入）。
- 後端 1 個（templates「corrupt skill_data」）是**第一七五輪自引入的測試回歸**。

- [x] 修 templates「corrupt skill_data」測試的固定 id 致 DB 持久化衝突：第一七五輪該測試以固定 id `tmpl-corrupt` 直接 INSERT，但後端測試 DB 跨次持久化 → 第二次跑 `UNIQUE constraint failed: templates.id`（首次寫入時通過、之後皆失敗）。
  - 修改說明（2026-06-27）：改用每次 run 隨機後綴 id `tmpl-corrupt-<hex>`（沿用 `similar-pages.test.ts` 既有模式），測試可重複執行。連跑兩次 templates 8/8 通過。分支 `fix/templates-test-unique-id`，已 merge 回 master。純測試修正。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 59 個完成項目（59/100，未達上限）。

## 動畫效果合併選取計算抽出純函式（第一七九輪，2026-06-27）

延續前端 AnimationEditorTab：「合併選取效果」的計算（最早 start／最晚 end／挑最早效果／組合併效果）內聯在 handler、無測試；合併語意（保留哪個效果設定、duration 算法、保留 startTrigger）值得固化。

- [x] 抽出動畫效果合併純函式 `mergeEffectRanges`（可測 / 固化合併語意）。
  - 修改說明（2026-06-27）：`lib/animationSpec.ts` 新增 `mergeEffectRanges(ranges)` + `SelectedEffectRange` 介面（輸入效果+已解析 start/end，回傳合併效果：起點最早 start、長度=最晚 end−最早 start、沿用最早效果設定與 id，<2 回 null）。`AnimationEditorTab` 合併處理改用之（逐字稿→秒數解析仍留元件）、移除內聯。新增 3 測試（<2 回 null、跨最早到最晚並沿用最早 id/設定、保留 startTrigger 並以解析最早秒數更新 start）。前端 `tsc --noEmit` 通過、animationSpec 61 測試通過。分支 `refactor/merge-effect-ranges`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 58 個完成項目（58/100，未達上限）。

## 焦點動畫框拖曳/縮放幾何抽出純函式（第一七八輪，2026-06-27）

延續前端：`AnimationEditorTab` 的 `onPointerMove` 內聯了焦點框拖曳/縮放幾何（9 把手、邊界夾界、最小尺寸、西/北把手連動原點、四捨五入），多分支座標運算最易在邊界出錯卻無測試、最難手動驗證。

- [x] 抽出焦點框拖曳/縮放幾何純函式 `resizeFocusBox`（可測 / 固化邊界行為）。
  - 修改說明（2026-06-27）：新增 `frontend/src/lib/focusBoxResize.ts`（`resizeFocusBox(handle, start, dxPct, dyPct, moveOnly?)` + `FocusBoxHandle` 型別 + `FOCUS_BOX_MIN_SIZE_PCT` 常數）。`AnimationEditorTab` 的 `onPointerMove` 改用之、本地 `DragHandle` 改為 `FocusBoxHandle` 別名（單一來源）。新增 `focusBoxResize.test.ts`（7 組：移動夾角落、moveOnly、東把手放大夾界、西把手連動原點、南北對稱、夾最小尺寸、四捨五入）。前端 `tsc --noEmit` 通過、7/7 通過。分支 `refactor/focus-box-resize`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 57 個完成項目（57/100，未達上限）。

## 品質檢查面板挑選邏輯抽出純函式（第一七七輪，2026-06-27）

轉向前端：`QualityCheckPanel`（290 行元件）內聯「有問題頁」與「缺/空逐字稿可批次補頁」的挑選邏輯，後者含 LLM fan-out 上限（10 頁）這種安全相關邏輯卻無測試。

- [x] 抽出品質檢查面板頁面挑選純函式（可測 / 固化 fan-out 上限）：`selectIssuePages`／`selectEmptyScriptFillPages(results, max)`。
  - 修改說明（2026-06-27）：新增 `frontend/src/lib/qualityCheckSelection.ts`（`selectIssuePages` null-safe 篩有問題頁；`selectEmptyScriptFillPages` 挑缺/空逐字稿頁碼、保序、夾 `max`、`max≤0` 回空避免無上限 fan-out）。`QualityCheckPanel` 改用之、移除內聯邏輯（行為等價）。新增 `qualityCheckSelection.test.ts`（5 組）。前端 `tsc --noEmit` 通過、新測試 5/5 通過。分支 `refactor/quality-check-selection`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 56 個完成項目（56/100，未達上限）。

## 相似頁面 embedding 防護解析（第一七六輪，2026-06-27）

延續無防護 JSON.parse 盤點，發現 `GET …/similar` 對目標與每個候選 embedding 直接 `JSON.parse(...) as number[]`、無防護；候選比對跨整個帳號教材庫，**任一筆** embedding 損壞會 500 整個相似頁面面板（爆炸半徑大）。

- [x] 相似頁面 embedding 解析加防護（一筆損壞不再拖垮整個面板）：新增匯出純函式 `parseEmbedding(raw)`（非法/非陣列/含非有限數字回 `null`），目標損壞→`indexed:false`、候選損壞→跳過。
  - 修改說明（2026-06-27）：`services/embeddings.ts` 新增 `parseEmbedding`。`similar-pages.ts` 目標向量改用之（損壞回 `{similar:[],indexed:false}`、優雅隱藏區塊）、候選 `.map` 改用之（損壞該筆回 null 後過濾、其餘照常排名）。新增 `parse-embedding.test.ts`（5 組）+ similar-pages 2 整合測試（損壞候選被略過仍 200、損壞目標 indexed:false；以獨立 owner 隔離跨測試教材庫累積）。後端 `tsc --noEmit` 通過；parse-embedding／similar-pages／cosineSimilarity 共 16 測試回歸全通過。分支 `fix/similar-pages-guard-embedding-parse`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 55 個完成項目（55/100，未達上限）。

## 範本清單 skill_data 防護解析（第一七五輪，2026-06-27）

延續無防護 JSON.parse 盤點，發現 `GET /api/templates` 逐列 `rowToTemplate` 中 `JSON.parse(row.skill_data) as Record<...>` 無防護——**任一筆**範本 skill_data 損壞會 500 整份公開範本清單（一壞全壞）。

- [x] 範本 `skill_data` 解析加防護（修一筆損壞 500 整份清單）：新增匯出純函式 `parseSkillData(raw)`（非法 JSON／非物件回 `{}`），`rowToTemplate` 改用之，損壞範本退化為空 skill_data 而非整份 500。
  - 修改說明（2026-06-27）：`templates.ts` 新增 `parseSkillData`（try/catch + 型別檢查：非物件/陣列/null 回 `{}`）。新增 2 測試：純函式各種輸入降級、以及整合測試（直接插入非法 JSON skill_data 列後 GET 仍回 200、該列仍在清單且 skill_data 為 `{}`）。後端 `tsc --noEmit` 通過、templates 8/8 通過。分支 `fix/templates-guard-skill-data-parse`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 54 個完成項目（54/100，未達上限）。

## 投票選項 JSON 防護解析收斂（第一七四輪，2026-06-27）

延續匯出/投票路由盤點，發現 `page_polls.options_json` 有三處解析、行為不一致：`rowToPoll` 已穩健（try/catch + 過濾），但投票結果 CSV 匯出與投票端點為**無防護** `JSON.parse(...) as string[]`，單筆損壞資料會 500。

- [x] 抽出共用 `parsePollOptions(optionsJson)`（去重 + 修無防護解析致 500）：非合法 JSON／非陣列回 `[]`、過濾非字串，三處（`rowToPoll`／`detail.ts` 投票端點／`poll-results-csv.ts`）統一改用。
  - 修改說明（2026-06-27）：新增 `backend/src/routes/pdfs/pollOptions.ts` 的 `parsePollOptions`。`rowToPoll` 移除重複防護邏輯改用之；`detail.ts` 投票端點與 `poll-results-csv.ts` 兩處無防護解析改用之（損壞時投票端點 `option_index` 驗證回 400 而非 500、CSV 該段不輸出列但整份匯出仍成功）。新增 `poll-options.test.ts`（5 組：合法陣列、損壞 JSON 回 []、非陣列回 []、過濾非字串、null/undefined）。後端 `tsc --noEmit` 通過；poll-options／poll-results-csv／detail-permission(92)／figures-polls-permission／page-poll-realign／generate-poll 共 100+ 測試回歸全通過。分支 `refactor/parse-poll-options`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 53 個完成項目（53/100，未達上限）。

## CSV 下載檔名邏輯收斂為共用純函式（第一七三輪，2026-06-27）

延續匯出/報告路由盤點，發現 CSV 下載檔名「標題優先、否則退回 ID」模式在 6 個路由各自內聯重複（report 3 處還重複呼叫 `safeDownloadBaseName` 兩次）、且無針對該取捨的獨立測試。

- [x] 抽出共用 `csvDownloadFilename(title, id, {titleSuffix, fallbackPrefix})`（去重 / 可測）：原 `quiz-results-csv`／`poll-results-csv`／`comments`／`report`(學生/逐頁/題目) 各自內聯「標題基底→`<基底>-<類別>.csv`、否則 `<類別>-<id>.csv`」。
  - 修改說明（2026-06-27）：`downloadFilename.ts` 新增純函式 `csvDownloadFilename`，6 處呼叫點改用之（檔名輸出完全等價；report 3 處順帶消除重複呼叫 `safeDownloadBaseName`，import 由 `safeDownloadBaseName` 改為 `csvDownloadFilename`）。`download-filename.test.ts` 新增 4 組測試（標題版含 CJK、空白/null/undefined 退回 ID、對齊先前內聯模式）。後端 `tsc --noEmit` 通過；download-filename／poll-results-csv／quiz-results-csv／comments-csv／report-pages-csv／report-questions-csv／report-summary 共 37 測試回歸全通過。分支 `refactor/csv-download-filename`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 52 個完成項目（52/100，未達上限）。

## 課後報告最難題目排序抽出純函式（第一七二輪，2026-06-27）

依 §7.1 課後報告補強，完成其「題目答錯率彙整」後端聚合子項：把摘要 API 的「最難前 5 題」排序邏輯抽成可測純函式。

- [x] 課後報告摘要「最難題目」排序抽出為純函式 `selectHardestQuestions`：原 `report.ts` 的 `report/summary` 路由內嵌「過濾未作答→依正確率升冪（並列時答錯數多者優先）→取前 5→補 wrong_rate」的排序邏輯，與 DB 查詢綁在一起、無獨立測試。
  - 修改說明（2026-06-27）：`reportMetrics.ts` 新增純函式 `selectHardestQuestions(stats, limit=5)`（含 `QuestionDifficultyStat` 輸入／`HardestQuestion` 輸出型別），收斂上述排序＋`wrong_rate`（`safeRatio` 防除以 0）邏輯；`report.ts` 摘要路由改為 `selectHardestQuestions(questionStats, 5)`，行為完全等價、對外 API 格式不變。新增 4 組單元測試（基本排序＋答錯率、正確率並列以答錯數多者優先、排除未作答題並遵守 limit、全未作答／空陣列回空陣列）。後端 `tsc --noEmit` 通過；`report-metrics`／`report-question-stats`／`report-summary` 共 21 測試回歸全通過。分支 `refactor/select-hardest-questions`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 51 個完成項目（51/100，未達上限）。

## 品質檢查回應新增摘要計數（第一七一輪，2026-06-27）

依 §7.2 品質檢查自動化，完成其「後端摘要」子項：為品質檢查 API 加上播放頁徽章所需的彙總計數。

- [x] 品質檢查回應新增 `summary` 摘要（pagesChecked/pagesWithIssues/totalIssues）：原本只回有問題的頁清單，前端得自行彙總；為播放頁徽章「N 頁有品質問題」提供單一可測來源。
  - 修改說明（2026-06-27）：`quality-check.ts` 新增純函式 `summarizeQualityResults(results, pagesChecked)`（回傳 `QualityCheckSummary` 介面：pagesChecked=已檢查 audio_ready 頁數、pagesWithIssues=有問題頁數、totalIssues=問題總數），route 以 `pageRows.length` 呼叫並把 `summary` 併入回應（`pages`/`checkedAt` 不變、純附加、向後相容）。前端 `pdfs.ts` 的 `QualityCheckResponse` 新增 `summary: QualityCheckSummary`。新增 `summarizeQualityResults` 單元測試 + 在既有整合測試斷言 summary（2 頁各 3 問題→{2,2,6}、rendered 頁→{0,0,0}）。前後端 `tsc --noEmit` 通過、quality-check 5/5 通過。分支 `feat/quality-check-summary`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 50 個完成項目（50/100，未達上限）。

## 課後報告頁面困難度後端聚合（第一六九輪，2026-06-27）

依 §7.1 課後報告補強，完成其「後端聚合」子項：為逐頁分析加上綜合困難度指標。

- [x] 課後報告 pages.csv 新增「頁面困難度」聚合（完成率低／投票分歧高／提問多）：原 pages.csv 已有完成率/投票分歧/聆聽比例，但缺一個綜合難度訊號。
  - 修改說明（2026-06-27）：`reportMetrics.ts` 新增純函式 `pageDifficultyScore(signals)`（`PageDifficultySignals` 介面 + 0–1 clamp）——把完成率（取未完成 1−rate）、投票分歧、每位觀看者提問率三個正規化訊號取平均，只計當下有資料者、全缺回 null。`report.ts` 的 `report/pages.csv` 新增每頁 `page_comments` 計數查詢，於每列輸出 `question_count` 與 `difficulty_score`（附加於原欄位之後、不動既有欄位順序；完成率/分歧僅在有觀看者/有票時納入，無資料頁輸出空白）。新增 `report-metrics.test.ts` 4 組 `pageDifficultyScore` 測試（三訊號平均、最易 0/最難 1、忽略 null/全 null 回 null、超範圍 clamp），更新 `report-pages-csv.test.ts`（新增 page_comments fixture + 新欄位斷言）。backend `tsc --noEmit` 通過；report-metrics/report-pages-csv 11/11 + report-summary/questions-csv/students/question-stats 18/18 回歸通過。分支 `feat/report-page-difficulty`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 48 個完成項目（48/100，未達上限）。

## 點擊投影片改為進入全螢幕（第一六七輪，2026-06-27）

使用者指定的新功能：把播放頁「點擊投影片」的動作從暫停／播放改為切換全螢幕。經詢問確認範圍為
「僅非全螢幕：點圖進全螢幕」、且「移除點擊暫停、改用獨立按鈕」。

- [x] 播放頁一般檢視點擊投影片改為進入全螢幕（取代點擊 playPause）：原本 `PlayPageSlidePanel` 的 `onImgClick` 呼叫 `playPause()`，改為進入圖片全螢幕。
  - 修改說明（2026-06-27）：`PlayPageSlidePanel` 自 `PlayPageContext` 取用 `setFullscreenLayout`／`setImageOnlyFullscreen`，`onImgClick` 改為 `setFullscreenLayout('image'); setImageOnlyFullscreen(true)`（沿用 `PlayPageHeader` 全螢幕按鈕的相同機制，保留「影像編輯選取／繪圖模式」時不觸發的守衛）；移除點擊暫停（playPause 仍由獨立播放控制按鈕與空白鍵負責）。aria-label 改用新 i18n 鍵 `play.slidePanel.enterFullscreenOverlay`（zh-TW「進入全螢幕」／en「Enter fullscreen」）。全螢幕模式內點擊行為不變。前端 `tsc --noEmit` 通過、i18n parity/nonempty 27 測試通過（`pauseAudioOverlay`/`resumeAudioOverlay` 仍由 `PlayPageFullscreen` 使用而保留）。分支 `feat/click-slide-toggle-fullscreen`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 46 個完成項目（46/100，未達上限）。

## ZIP 匯入頁面狀態正規化（第一六五輪，2026-06-27）

延續 from-pages 的「非法 page 狀態」bug 類，盤點所有建立 pages 的入口：page-operations(audio_ready✓)、pipeline(各正確狀態✓)、addPagesFromPrompt(script_ready→audio_ready 流程✓)、upload(不設 status✓)、from-pages(已修✓)、**import(ZIP) 有問題**。

- [x] ZIP 匯入時 page 狀態 fallback 為非法 `'ready'` 且不驗證：`import.ts` 以 `p.status || 'ready'` 設定匯入頁狀態；缺 status 或舊匯出含非法 'ready'（如 round-164 前的 from-pages 匯出）時，匯入頁會帶非法狀態 → 被 quality-check/匯出略過、且重啟時被 orphan-recovery 標 failed。
  - 修改說明（2026-06-27）：改為 `isPageStatus(p.status) ? p.status : 'audio_ready'`（用 statusMachine 的 `isPageStatus` 驗證；有效則保留、無效/缺失正規化為終態 audio_ready）。backend `tsc --noEmit` 通過；export/import ZIP round-trip（有效狀態保留）+ import-unzip-timeout + status-machine（isPageStatus 已測）共 13 測試回歸通過。匯入用系統 unzip、無 jszip 依賴，自製含非法狀態的 zip fixture 成本高且脆弱，故不另造 fixture 測試（由 round-trip + isPageStatus 測試 + 一行 guard 邏輯共同保證）。分支 `fix/import-page-status-normalize`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 44 個完成項目（44/100，未達上限）。

## from-pages 頁面狀態 bug（第一六四輪，2026-06-27）

稽核 `from-pages`（從多份簡報選頁組「複習簡報」）：複製頁面用新 page_uid、循序 page_number、uid 路徑——大致正確。但發現**嚴重真 bug**。

- [x] from-pages 建立的頁面用非法 page 狀態 `'ready'` → 伺服器重啟後整批被標 failed：`from-pages.ts` INSERT pages 時 status 寫死 `'ready'`，但 `'ready'` 不是合法 page 狀態（終態為 `audio_ready`）。後果：(1) quality-check/匯出（filter audio_ready）抓不到；(2) **`recoverOrphanedAddPagesPages()`（server.ts 啟動時呼叫）會把 ready PDF 中 status NOT IN ('audio_ready','failed') 的頁標成 failed** → 每次重啟後複習簡報全頁變 failed。
  - 修改說明（2026-06-27）：from-pages 的 pages INSERT 改用終態 `'audio_ready'`（pdfs.status='ready' 為合法 PDF 狀態、不動）。新增測試：from-pages 頁面為 audio_ready，且呼叫 `recoverOrphanedAddPagesPages()` 後仍維持 audio_ready（不被標 failed）。backend `tsc --noEmit` 通過、`from-pages` 6/6。分支 `fix/from-pages-page-status`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 43 個完成項目（43/100，未達上限）。
- [ ] （觀察，待處理）完整後端套件有零星 flaky 測試：`figure-reference-image-generation`、`llmUsage` 在完整套件併跑時偶發失敗、隔離下穩定通過，屬測試間全域狀態（setOpenAIClientForTest mock／setSystemAuthSettings／共用 DB/fs）污染。建議後續加強測試隔離（每檔自帶 setup/teardown 還原全域），非單一 bug。

## addPagesFromPrompt 補 defer FK（第一六三輪，2026-06-27）

延續稽核：`addPagesFromPrompt`（AI 批次加頁）在中間插頁時也位移頁碼並呼叫 `shiftChildPageNumbers`，但**缺 `defer_foreign_keys = ON`**——與 page-operations 修前同樣的 FK-timing bug：先 `UPDATE pages` 即讓 polls 變孤兒 → 在後續頁有投票時 FK 500。

- [x] `addPagesFromPrompt` 中間插頁缺 defer FK → 後續頁有投票時 FK 失敗：在其 page-shift 交易開頭加 `db.pragma('defer_foreign_keys = ON')`（`shiftChildPageNumbers` 已涵蓋 polls/comments/drawings）。
  - 修改說明（2026-06-27）：於 `addPagesFromPrompt.ts` 的「中間插頁」交易加 defer pragma。worker 難以端到端單元測，以重現腳本驗證（在第 3 頁有 poll/comment、insertAfter=1/insertCount=2 → 交易成功、poll/comment 正確移到第 5 頁、無 FK error）；既有 `add-pages-permission`/`add-pages-orphan-recovery` 17 測試回歸通過。backend `tsc --noEmit` 通過。分支 `fix/addpages-defer-fk`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 42 個完成項目（42/100，未達上限）。

## 擴展頁面重排的子表對齊（第一六二輪，2026-06-27）

延續 round-161：盤點所有以 `page_number` 關聯 pages 的子表，發現除 polls 外，**comments 與 drawings 在增刪移頁時也會錯位**（無 FK 故不崩、但附到錯頁；drawings 刪頁時甚至不會被清掉而殘留）。embeddings 以 `page_uid` 為鍵不受影響；watch_progress/timings/events 屬歷史分析、刻意不重排。

- [x] 頁面增/刪/移時 comments 與 drawings 未隨頁碼對齊（錯位 / 殘留）：`shiftChildPageNumbers` 僅位移 page_polls；comments/drawings 的 FK 只到 pdfs（非 pages），故不會 cascade，重排後錯附到別頁、刪頁時殘留。
  - 修改說明（2026-06-27）：`shiftChildPageNumbers` 擴為位移三個「每頁使用者內容」子表（`page_polls`/`page_comments`/`page_drawings`，以常數 `PAGE_CONTENT_CHILD_TABLES` 表列、附註說明為何排除分析表與 uid 化的 embeddings）；move handler 的 per-page 迴圈一併移動三表；delete handler 顯式刪除被刪頁的 comments/drawings（polls 由 FK cascade）。新增測試涵蓋刪/插/移頁後三表對齊、以及刪頁移除該頁 comments/drawings 不殘留。backend `tsc --noEmit` 通過；相關 86 測試回歸；**完整後端套件 1203/1203 全綠**。分支 `fix/realign-page-content-children`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 41 個完成項目（41/100，未達上限）。

## 修正頁面增刪移的 FK/投票對齊真 bug（第一六一輪，2026-06-27）

延續 round-157 的 page renumber 稽核，發現並修復一個真實 production bug：

- [x] 頁面增/刪/移時 page_polls 未跟著重編號 → `foreign_keys=ON` 下 FK 失敗（500）且投票錯位：`page_polls` 以 FK `(pdf_id, page_number) REFERENCES pages` 關聯，但 delete handler **完全沒有**位移子表；insert/move 雖呼叫 `shiftChildPageNumbers`，卻在「先 `UPDATE pages +100000`、後 shift 子表」的順序下、於子表 shift 前就讓投票變孤兒 → FK 立即失敗。實測：在第 3 頁有投票時刪第 2 頁 → `FOREIGN KEY constraint failed`（刪頁 500）；insert/move 同類。
  - 修改說明（2026-06-27）：三個 renumber 交易（insert/move/delete）開頭加 `db.pragma('defer_foreign_keys = ON')`（FK 延到 commit 檢查、交易內可安全分步重排父子表，SQLite 於 commit 後自動關閉此 pragma）；delete handler 補上 `shiftChildPageNumbers` 兩步 lockstep 位移（與 pages 的 +100000/-100001 offset 同步），使後續頁的投票正確跟隨（刪第 2 頁後，原第 3 頁→第 2 頁、其投票也→第 2 頁）。新增 `page-poll-realign.test.ts`（2 測試：刪頁/插頁後投票對齊且無 FK error）。backend `tsc --noEmit` 通過；`pages-api`/`page-operations-permission` 50/50 回歸；**完整後端套件 1201/1201 全綠**。分支 `fix/page-renumber-fk-defer-and-poll-shift`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 40 個完成項目（40/100，未達上限）。

## 規畫輪：補充可執行項目（第一六〇輪，2026-06-27）

前後端測試套件皆全綠；後端權限/分享/身分去重、既有失敗修復、前端 lib 測試覆蓋皆完成。乾淨且低風險的「純函式抽出／補測試」自動 backlog 已實質見底。依 LOOP.md 第 2 條，分析後依 `docs/STATUS_REPORT_2026_06_27.md` §7–§8 與 `docs/FUTURE_ROADMAP.md` 補充以下優先項目。這些多為需 UI／後端整合的功能，**單輪可完成但較難在現有測試框架自動驗證 UI**，部分建議由使用者確認方向後再投入：

- [ ] （驗證確認）round-136 品質檢查狀態修正已驗證完整：頁面終態為 `audio_ready`（`addPagesFromPrompt.ts` 的 normalization 與 pipeline 註解均證實 ready PDF 全頁為 audio_ready/failed），`script_ready` 僅為 require_script_confirmation 流程的暫態。**無需再擴充狀態集合**。（本項為分析結論，非待辦。）
- [ ] （P0，§7.2）品質檢查自動化：生成完成後自動跑一次 quality-check，於播放頁以徽章顯示「N 頁有品質問題」摘要，點擊開啟既有 `QualityCheckPanel`。延伸 `quality-check` route 與前端面板，屬前端整合。
  - 進度（第一七一輪，2026-06-27）：**後端摘要子項已完成**（見下方「品質檢查回應新增摘要計數」section，計數第 50 項）——`quality-check` 回應新增 `summary`（`pagesChecked`/`pagesWithIssues`/`totalIssues`），前端型別同步。**仍待辦**：播放頁 header 徽章顯示「N 頁有品質問題」+ 生成完成後自動觸發 quality-check。
- [x] （§8.1.4）首頁／播放頁搜尋結果加入「加入複習清單」動作：`GlobalSearchBox` 結果列加入按鈕，複用既有 `reviewList.addReviewItems`（已有測試）。純前端 UI 整合。（第一七〇輪，2026-06-27 完成）
  - 修改說明（2026-06-27）：`GlobalSearchBox` 選取模式原僅有「建立新簡報」批次動作，新增「加入複習清單（N 頁）」按鈕。新增純函式 `lib/searchResultsToReviewItems.ts`（過濾無頁碼標題結果、snippet 去空白作 questionText、null 標題回空字串）；`handleAddToReviewList` 將勾選結果轉換後交 `addReviewItems`（沿用其 pdfId+頁碼+文字 去重）並收合選取狀態。新增 i18n 鍵 `home.search.addToReviewList`（zh-TW/en）。新增 `searchResultsToReviewItems.test.ts` 3 測試；前端 `tsc --noEmit` 通過、helper 3/3 + i18n parity/nonempty + 既有 GlobalSearchBox 測試回歸通過（共 35）。分支 `feat/search-add-to-review-list`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 49 個完成項目（49/100，未達上限）。
- [ ] （P0，§7.1）課後報告個人層級報表：後端 `computeStudentRecords` 已彙整每位學生作答；補前端「個人」分頁顯示每位學生完成率／提問／投票參與。前端為主、後端視需要補欄位。
- [ ] （§8.1.5／§4.1）播放頁 header 入口分組為「製作／授課／自學／報告／匯出」任務流：降低功能密度造成的新手阻力（資訊架構調整，純前端、需產品確認分組）。
- [x] （§7.5）生成前成本估算覆蓋確認：確認 PDF／文字／YouTube 三個生成入口皆於 `PromptModal` 顯示 `costEstimate` 估算；補缺口並為 pageCount 傳遞補測試。（第一六八輪，2026-06-27 完成）
  - 修改說明（2026-06-27）：盤點發現**真缺口**——`PromptModal` 僅在 `pageCount > 0` 顯示成本估算，但剛上傳的 PDF／文字／YouTube 在 DB 的 `page_count` 皆為 `null`（pipeline 分頁後才有），故三入口在**首次生成前都不顯示估算**（只有已生成簡報重生時才有）。修法：上傳 PDF 時後端計算來源 PDF 實體頁數（slides 模式用 `getPdfPageCount()`、document 模式用 `pageTexts.length`），於 `POST /api/pdfs` 回應新增 `source_page_count`（**不寫入** persisted `page_count`，純作估算依據；TXT 為 null）。前端 `UploadResponse` 加 `source_page_count?: number | null`，新增純函式 `lib/promptTargetPageCount.ts`（優先真實 `page_count`、否則 `source_page_count`、皆非正數回 null），`HomePage.openPromptFor` 改用之 → 首次上傳 PDF 即可在生成前看到成本估算。**確認結論**：文字／YouTube 的投影片數於生成前由 AI 分頁才定、本就無從估算，維持不顯示（非缺口）。新增 `upload-source-page-count.test.ts`（PDF 回實體頁數 7、TXT 為 null，poppler 不可用時跳過）與 `promptTargetPageCount.test.ts`（優先序/fallback/無值回 null 共 3 測試）；前後端 `tsc --noEmit` 通過、相關上傳路由回歸通過。分支 `feat/upload-source-page-count-cost-estimate`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 47 個完成項目（47/100，未達上限）。

## 前端補測試 debugLog（第一五九輪，2026-06-27）

前後端套件皆全綠；盤點前端 lib 僅 `api.ts`（HTTP/re-export）與 `debugLog.ts` 無測試。補後者：

- [x] 為 `debugLog.ts` 補單元測試（覆蓋）：`debugLog`/`debugWarn` 依 `localStorage['makeslide.debug']==='1'` 開關、含 try/catch 防呆，原無測試。
  - 修改說明（2026-06-27）：新增 `frontend/src/lib/debugLog.test.ts`（3 測試：旗標='1' 才經 `console.info`/`warn` 輸出且帶原引數、旗標非 '1' 不輸出、localStorage 存取拋錯時靜默不拋）。以可還原的 console 與 globalThis.localStorage 注入測試、finally 清理避免污染。未動產品碼。前端 `tsc --noEmit` 通過、3/3；完整前端 532/532 全綠。至此前端 lib 中含邏輯的模組皆有測試（僅 api.ts 屬 HTTP/re-export 未測）。分支 `test/debug-log`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 39 個完成項目（39/100，未達上限）。

## 前端去重 hasLocalStorage（第一五八輪，2026-06-27）

確認後端 1199/1199、前端 551/551 全綠（全棧綠燈基線）。掃描前端後完成一個小去重：

- [x] 抽出共用 `hasLocalStorage`（去重）：`recentSearches.ts`、`commentAuthor.ts` 各有相同的 `typeof window !== 'undefined' && !!window.localStorage` 守衛。抽成 `lib/hasLocalStorage.ts` 並補測試。
  - 修改說明（2026-06-27）：新增 `frontend/src/lib/hasLocalStorage.ts`（window-based 穩健版）+ `hasLocalStorage.test.ts`（3 測試：無 window、有 window.localStorage、有 window 無 localStorage；每次清理 globalThis.window 避免污染）。`recentSearches`/`commentAuthor` 移除本地定義改 import。**`reviewList.ts` 刻意不動**——其守衛為 `typeof localStorage !== 'undefined'`（bare localStorage），且其測試注入 bare `localStorage`（非 window），改用 window-based 版會使測試 mutator no-op（已實測 4 失敗）；為零行為變更，保留 reviewList 自身守衛。前端 `tsc --noEmit` 通過；相關 lib 測試 23/23；完整前端 551/551 全綠。分支 `refactor/shared-has-local-storage`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 38 個完成項目（38/100，未達上限）。

## 完整後端測試套件基線 + 既有失敗盤點（第一五四輪，2026-06-27）

本輪以 `scripts/run-tests.sh backend` 跑完整後端套件：**1199 測試，18 失敗**。經抽查與在去重前 commit（`e0d9db8`）比對，**18 個全為既有失敗、與近期去重無關**。逐一分類並修復其一：

- [x] 修 `input-security.test.ts`（4 失敗）：4 個 upload/youtube 驗證測試全回 **401**（未授權）——測試未呼叫 `setSystemAuthSettings({ googleAuthEnabled: false })`，請求在到達驗證邏輯前就被 auth 擋下（驗證邏輯本身正常）。確認無任何測試把 `googleAuthEnabled` 設 true（無全域順序衝突），於檔頭加上該設定。`input-security.test.ts` 4/4 通過。純測試修正。分支 `fix/input-security-test-auth`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 34 個完成項目（34/100，未達上限）。
- [x] （既有失敗）`pages-api.test.ts`（7 失敗）：測試預期連號 `pages/002.png`，實際為 uid 化 `pages/<uid>.jpg`。
  - 修改說明（2026-06-27）：確認 uid 化為現行設計（page-operations.ts 註解明言「檔案以 page_uid 為鍵、不重命名」、前端/storage 皆 uid 化），測試過時。重寫 `seedReadyPdfFor`（uid 路徑 `pages/u<i>.jpg/.text.txt/.script.txt/.m4a` + 建檔 + 設 page_uid）與 `assertDeckAligned`（改為斷言 page_number 連續 1..N），並更新 670/672/673/675 的內聯路徑斷言為 uid 契約（既有頁保留 uid 路徑、僅 page_number 連續；刪除只移除被刪頁 uid 檔）。
  - **順帶修真實潛在 bug**：重寫後 test 676 暴露 delete handler 的 `UPDATE page_number = page_number - 1` 在多次增刪後（rowid 與 page_number 分歧）會暫態違反 `UNIQUE(pdf_id, page_number)` → 500。改用與 insert 一致的 +offset 兩步 renumber（+100000 再 -100001）。此為 production 也可能觸發的真 bug（增頁後刪頁）。
  - 驗證：backend `tsc --noEmit` 通過；`pages-api` 19/19；page-operations/delete 相關 51/51 回歸通過。**完整後端套件 1199/1199 全綠（exit 0）**。分支 `fix/pages-api-uid-tests-and-delete-renumber`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 37 個完成項目（37/100，未達上限）。
- [x] （既有失敗）`skills.test.ts`（1）：`updateUserSkill` 回傳物件與磁碟 round-trip 形狀不符。
  - 修改說明（2026-06-27）：根因為 `createUserSkill`（條件 spread、省略 undefined 模板鍵）與 `updateUserSkill`（**總是**寫入 4 個模板鍵，即使值 undefined）不一致——回傳物件帶 `imageStylePrompt:undefined` 等鍵，但 JSON.stringify 丟棄 undefined，讀回後缺鍵，`deepStrictEqual(回傳, 磁碟)` 失敗。修法：`updateUserSkill` 改為先解析各欄位值、再以條件 spread 僅在 truthy 時納入（行為不變、與 create 形狀一致）。順帶修掉這個 create/update 形狀不一致。`skills.test.ts` 5/5 通過。分支 `fix/update-skill-omit-undefined-template-fields`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 35 個完成項目（35/100，未達上限）。
- [x] （既有失敗）`timing.test.ts`(1) + `regenerate-matrix.test.ts`(4)：同 input-security 的 401 根因——兩檔皆缺 `setSystemAuthSettings({ googleAuthEnabled: false })`，HTTP 請求被 auth 擋下回 401。兩檔加上該設定後，timing 12/12、regenerate-matrix 4/4 通過（連跑 3 次穩定 16/16；首次觀察到的 regenerate test 2 一次性 flake 未再現）。純測試修正。分支 `fix/timing-regen-test-auth`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 36 個完成項目（36/100，未達上限）。
- [x] （既有失敗）`figure-reference-image-generation.test.ts`(1)：隔離下穩定通過、僅在完整套件中失敗，屬測試順序污染。第一五四–一五六輪新增多個 `setSystemAuthSettings` 改變全域順序後，重跑完整套件已自然通過，無需改動。

## 後端去重 canDestructivelyEditPdf（第一五三輪，2026-06-27）

- [x] 抽出共用 `canDestructivelyEditPdf`（去重 / 可測 / 安全一致）：破壞性動作（刪簡報/頁/測驗/投票/手寫）的嚴格編輯權限（`Boolean(sub) && public_editable`，禁止匿名）在 4 檔以 `canDestructivelyEditPdf` 重複、且 `delete.ts` 以同邏輯的 local `canEditPdf` 存在（同名不同 body 易混淆）。抽成共用並補測試。
  - 修改說明（2026-06-27）：在 `permissions.ts` 新增 `canDestructivelyEditPdf`（含註解說明與 canEditPdf 的差異）。4 檔（page-operations/detail/quizzes/drawings）移除本地定義並併入既有 `./permissions` import。`delete.ts` 移除其 local stricter `canEditPdf`、改 `import { canDestructivelyEditPdf }` 並把呼叫點改名（消除同名不同 body 的混淆）。`permissions.test.ts` 新增測試（匿名於 public_editable 不可破壞性編輯、與 canEditPdf 對比）。backend `tsc --noEmit` 通過；`delete-permission`/`delete-pdf-job-cleanup`/`permissions`/`quizzes`/`drawings`/`page-operations-permission`/`detail-permission` 共 177 測試回歸通過（嚴格匿名行為保留）。分支 `refactor/shared-can-destructively-edit`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 33 個完成項目（33/100，未達上限）。

## 後端去重 share 存取群（第一五〇輪，2026-06-27）

- [x] 抽出共用 share 存取工具（去重 / 可測）：`ShareTokenParamSchema`、`getShareToken`、`hasShareAccess` 在約 10 個路由檔成組逐字重複。抽成共用 `share.ts` 並補測試。
  - 修改說明（2026-06-27）：新增 `backend/src/routes/pdfs/share.ts` 匯出三者（含註解）。以腳本移除 10 個一致檔（add-pages/runs/drawings/watchProgress/quizzes/figures/slow-artifacts/page-operations/versioning/page-animation）的本地三定義並改 `import { ShareTokenParamSchema, getShareToken, hasShareAccess } from './share'`，清理因此未使用的 `FastifyRequest` import。過程中腳本一度誤把 share.ts 自身納入（grep 命中）導致毀損，已重寫修復。新增 `share.test.ts` 6 組測試（getShareToken header/query/優先序/trim/陣列、ShareTokenParamSchema 長度與字元）。backend `tsc --noEmit` 通過；share 相關路由回歸約 263 測試全通過（quizzes/drawings/page-animation/權限類 watch/runs/versioning/page-operations…）。分支 `refactor/shared-share-access`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 30 個完成項目（30/100，未達上限）。
- [x] 收斂 `getPdfPermissionRow`（10 標準）至 permissions.ts；`report.ts` 的 title 變體保留。
  - 修改說明（2026-06-27）：在 `permissions.ts` 新增 `getPdfPermissionRow(id)`（`SELECT owner_sub, visibility`，加 `db` import）。以腳本移除 10 個標準檔（watchProgress/regenerate/versioning/figures/add-pages/drawings/quizzes/page-animation/sync/page-operations）的本地定義並合併進其既有 `./permissions` import。`report.ts` 另含 `title` 的變體維持不動（註解標明）。backend `tsc --noEmit` 通過；migrated 路由回歸約 274 測試全通過（quizzes/drawings/page-animation/sync/regenerate/add-pages/figures/各權限測試）。分支 `refactor/shared-get-pdf-permission-row`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 31 個完成項目（31/100，未達上限）。
- [x] 收斂 share 群剩餘變體：`detail.ts`（getShareToken + object schema，無 hasShareAccess）、bare-string schema + `shareTokenFromRequest` 的 outlier 檔。評估改用共用版本。
  - 修改說明（2026-06-27）：`detail.ts` 的 `getShareToken` 與 object 版 `ShareTokenParamSchema` 與共用版完全相同，改 `import { getShareToken, ShareTokenParamSchema } from './share'` 並移除本地定義；其獨有的 `shareAccessForPdf`/`isShareTokenExpired`（含到期判斷、回傳 access level）保留並改用 imported 版本。經評估，`sync.ts`/`server.ts` 的 `shareTokenFromRequest` 為 **header-only 變體**（不讀 `?share=` query、用 bare-string schema），行為與 `getShareToken` 不同，若替換會改變行為，故**刻意不統一**。backend `tsc --noEmit` 通過；`detail-permission`(92)、`share-expiry`(3)、`share`(6) 共 101 測試回歸通過。分支 `refactor/detail-reuse-share`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 32 個完成項目（32/100，未達上限）。

## 後端去重 canEditPdf（第一四八輪，2026-06-27）

- [x] 抽出共用 `canEditPdf` 權限函式（去重 / 可測）：標準 `canEditPdf`（owner / public_editable）在 21 個路由檔逐字重複。抽成共用並補測試；**delete.ts 的版本刻意更嚴格**（`Boolean(sub) && public_editable`，禁止匿名刪除），不替換。
  - 修改說明（2026-06-27）：在 `permissions.ts` 新增 `canEditPdf`（標準版，含註解說明 delete.ts 例外）。以腳本移除 21 檔標準本地定義並合併 import（已有 `import { canReadPdf } from './permissions'` 的 12 檔改為 `{ canReadPdf, canEditPdf }`、其餘 9 檔新增 import）。delete.ts 的嚴格版維持不動。新增 `permissions.test.ts` 的 canEditPdf 測試（見下）。修正腳本誤把 permissions.ts 自身納入而加的自我 import。backend `tsc --noEmit` 通過；抽查約 12 個路由測試檔回歸全通過（quizzes 24、drawings、page-comments、detail-permission 92、figures-polls-permission、add-pages…）；標準本地定義 0。分支 `refactor/shared-can-edit-pdf`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 28 個完成項目（28/100，未達上限）。
- [x] （既有失敗，待修）`page-animation.test.ts` 1/123 失敗：`validateAnimationSpec rejects a shape effect with an invalid shape kind`。在 master 即失敗、與權限重構無關。待查 `validateAnimationSpec` 對 shape kind 的驗證。
  - 修改說明（2026-06-27）：又一個 mirror drift——測試用 `shape: 'triangle'` 當「不合法」案例，但 `ANIMATION_SHAPE_KINDS` 早已新增 `triangle`/`star`/`hexagon`（前端 `types.ts` 與 i18n 三角形/五角星/六角形齊備、為**已支援**形狀），故 triangle 實為合法、測試斷言過時。確認 enum 正確、測試過時後，將測試改用真正不在清單的 `'octagon'`。`page-animation.test.ts` 123/123 通過（先前 122/123）。純測試修正、未動產品碼。分支 `fix/animation-shape-kind-test`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 29 個完成項目（29/100，未達上限）。

## 後端大量去重 sessionSub（第一四六輪，2026-06-27）

- [x] 抽出共用 `sessionSub` 工具（大量去重 / 可測）：`sessionSub(request)`（解 session cookie 取 account sub）在 **40 個** PDF 路由檔逐字重複定義（38 同名 + 2 個 `sessionSubFromRequest` 同 body）。抽成共用並補測試。
  - 修改說明（2026-06-27）：在 `backend/src/routes/auth.ts` 新增 `export function sessionSub(request)`（與既有 `decodeSession`/`parseCookies` 同模組）。以腳本移除 38 個 `sessionSub` 同名定義並改 `import { sessionSub } from '../auth'`（其中 admin.ts 保留其 `SESSION_COOKIE, clearCookie` 匯入）；同時清理 26 個因移除而未使用的 `FastifyRequest` type import。2 個 `sessionSubFromRequest`（命名不同）暫不動。新增 `session-sub.test.ts` 4 組測試（無 cookie/竄改/有效/無關 cookie）。backend `tsc --noEmit` 通過；抽查約 14 個路由測試檔回歸全通過（detail-permission 92、quizzes 24、quality/h5p/report-summary…）；殘留本地定義 0。分支 `refactor/shared-session-sub`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 26 個完成項目（26/100，未達上限）。
- [x] 收斂 2 個 `sessionSubFromRequest` 同 body 函式：與共用 `sessionSub` 實作相同但命名不同，評估改用共用版本或統一命名。
  - 修改說明（2026-06-27）：`export.ts`、`subtitles.ts` 的 `sessionSubFromRequest`（與共用 `sessionSub` 實作完全相同）移除本地定義、4 處呼叫改用 `import { sessionSub } from '../auth'`，並清掉因此未使用的 `decodeSession`/`parseCookies`/`FastifyRequest` import。backend `tsc --noEmit` 通過；`subtitles`/`export-import-zip-sources`/`batch-export`/`export-zip-cjk-filename` 共 10/10 回歸通過；全 repo 已無 `sessionSubFromRequest`。分支 `refactor/collapse-session-sub-from-request`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 27 個完成項目（27/100，未達上限）。

## 後端去重 + 發現既有失敗（第一四三輪，2026-06-27）

- [x] 抽出共用 `canReadPdf` 權限函式（大量去重 / 可測）：`canReadPdf(sub, row)` 在 **27 個** PDF 路由檔案中**逐字重複**定義（grep 確認 27 份實作完全一致），維護風險高。抽成共用模組並補測試。
  - 修改說明（2026-06-27）：新增 `backend/src/routes/pdfs/permissions.ts` 匯出 `canReadPdf`（含註解說明規則：無 owner 公開、owner 可讀、其餘僅 public/public_editable）。以腳本機械式移除 27 檔的本地定義並改 `import { canReadPdf } from './permissions'`（移除後各檔 `PdfRow` 仍有其他用途、且未啟用 `noUnusedLocals`，無未使用 import 問題）。新增 `permissions.test.ts` 3 組測試（無 owner、owner、非 owner×可見度）。backend `tsc --noEmit` 通過；抽查 30 個路由測試檔回歸（detail-permission 92、quality/h5p/script/image/report-summary 等）全通過，殘留本地定義 0。分支 `refactor/shared-can-read-pdf`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 23 個完成項目（23/100，未達上限）。
- [x] （既有失敗，待修）`notes-txt.test.ts` 4/5 失敗：`NOT NULL constraint failed: pages.page_notes`——測試插入 pages 未給 `page_notes`，但該欄為 NOT NULL。在 master 即失敗、與權限重構無關。評估是測試 fixture 漏給欄位、或 schema 應給預設值。
  - 修改說明（2026-06-27）：根因為**測試 fixture 與 schema 不符**——`pages.page_notes` 是 `NOT NULL DEFAULT ''`（production 不會是 NULL），但測試 2 處明確塞 `NULL`（seedPdf 第 2 頁、fallback 測試的 `UPDATE ... SET page_notes = NULL`），違反 NOT NULL。路由本身用 `COALESCE(page_notes,'')` + `.trim()` 對 ''/NULL 行為相同，無需改。將兩處 `NULL` 改為 `''`（代表「無備註」、符合 schema）。`notes-txt.test.ts` 5/5 通過（先前 1/5）。純測試修正、未動產品碼。分支 `fix/notes-txt-test-page-notes-not-null`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 24 個完成項目（24/100，未達上限）。
- [x] （既有失敗，待修）`quizzes.test.ts` 1/24 失敗：`POST /quizzes/:quizId/copy-to/:targetId` 預期 201 卻得 **400**。
  - 修改說明（2026-06-27）：以隔離重現腳本確認——copy-to 端點本身**正常回 201**；400 並非來自 `safeParse`，而是 Fastify 的 JSON body parser。測試用共用 `OWNER_HEADERS`/`OTHER_HEADERS`（含 `content-type: application/json`）但此 POST **無 body**，Fastify 對「宣告 application/json 卻空 body」回 400（在 handler 之前）。前端 `copyQuizSetTo` 用 `fetch(url, { method: 'POST' })`（不帶 content-type），production 不會觸發。屬**測試 bug**：將 copy-to 測試的 3 個無 body 請求改為只帶 `cookie`（移除 content-type）。`quizzes.test.ts` 24/24 通過（先前 23/24）。未動產品碼。分支 `fix/quizzes-copyto-test-headers`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 25 個完成項目（25/100，未達上限）。

## 後端分析新增可執行項目（第一四〇輪，2026-06-27）

前端小型純函式 backlog 接近見底，依 LOOP.md 第 2 條轉向後端（受重構關注較少）分析。新增以下項目並完成其一：

- [x] 抽出課後報告共用比例／四捨五入純函式（去重 / 防呆 / 可測）：`report.ts` 多處內聯 `denom > 0 ? num/denom : 0`（correct_rate、wrong_rate、participation_rate、completion_rate×2）、`round4` 重複定義兩次、投票分歧 `1 - max/total`，散落且無針對純邏輯的測試。抽成後端共用純函式並補測試。
  - 修改說明（2026-06-27）：新增 `backend/src/routes/pdfs/reportMetrics.ts`（`safeRatio(num, denom)` 分母非正回 0、`round4(n)`、`pollDivergence(maxVotes, totalVotes)` 無票回 0）。收斂 `report.ts`：correct_rate/wrong_rate/participation_rate/completion_rate(×2) 改用 `safeRatio`、兩處 local `round4` 改用共用、頁面 CSV 投票分歧改用 `pollDivergence`。新增 `report-metrics.test.ts` 4 組測試（safeRatio 正常/除以 0、round4、pollDivergence 共識/分裂/無票）。backend `tsc --noEmit` 通過；新測試 4/4 + 既有 `report-pages-csv`/`report-questions-csv`/`report-summary`/`report-question-stats` 共 16/16 回歸通過（行為等價）。分支 `refactor/report-metrics-helpers`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 20 個完成項目（20/100，未達上限）。
- [x] 抽出 `avg_listened_ratio` 的 SQL 聚合為共用片段或測試：`report.ts` 兩處（pages.csv 與 summary）重複同一段 `AVG(CASE WHEN w.duration_ms ... MIN(listened_ms/duration_ms, 1.0) ...)` SQL，易漂移。評估抽成共用常數字串或補一個針對該聚合的整合測試固化語意。
  - 修改說明（2026-06-27）：兩處 watch 聚合查詢實質相同（僅空白/別名差異），抽成模組層級函式 `queryWatchPages(pdfId): WatchPageRow[]`（含完整 SQL 與註解說明 avg_listened_ratio 語意），pages.csv 與 summary 兩處 `const watchPages = db.prepare(...).all(id)` 改為 `queryWatchPages(id)`，整段 SQL 收斂為單一來源。backend `tsc --noEmit` 通過；既有 `report-pages-csv`/`report-summary` 共 7/7 回歸通過（行為等價）；殘留 inline watch SQL 由 2 降為 1（即共用函式內）。分支 `refactor/query-watch-pages`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 22 個完成項目（22/100，未達上限）。
- [x] 後端搜尋語意索引上限可設定：`search.ts` 的 `MAX_SEMANTIC_PDFS = 20`（STATUS_REPORT §4.4）為硬編，教材知識庫成長後需要更大或可調。評估改為可由系統設定調整並補測試。（第一六六輪，2026-06-27 完成）
  - 修改說明（2026-06-27）：改為每帳號可調設定 `semanticSearchMaxPdfs`（預設 20、範圍 1–200），沿用既有 per-account `settings.env` 機制（同 `monthlyBudgetUsd` 模式）。`aiSettings.ts` 新增常數 + `clampSemanticSearchMaxPdfs`（取整 + 夾範圍 + 非有限值回退預設）+ interface 欄位 + base 預設 + override 解析（`SEMANTIC_SEARCH_MAX_PDFS`）+ env pair；`admin.ts` GET 回傳 `semantic_search_max_pdfs`、PATCH 解析 clamp；`shared.ts` schema 加 `z.number().int().min(1).max(200).optional()`；`search.ts` 改用 `getRuntimeAiSettings().semanticSearchMaxPdfs`（request 範圍帳號情境、讀取時再夾一次防呆）。前端 `system.ts` 兩 interface、`SettingsPage` 數字輸入欄位（留空維持預設）、zh-TW/en 三個 i18n 鍵。新增 `semantic-search-max-pdfs.test.ts` 4 測試（clamp 行為、GET 預設 20、PATCH 持久化到 settings.env + 讀回、超範圍 schema 擋 400）。前後端 `tsc --noEmit` 通過；新測試 4/4、search/admin/i18n 相關回歸通過。分支 `feat/configurable-semantic-search-limit`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 45 個完成項目（45/100，未達上限）。
- [x] 抽出學生平均分計算純函式：`report.ts` 的 `computeStudentRecords` 內聯 `scores.reduce((a,b)=>a+b,0)/scores.length`（平均分），與其他平均邏輯重複，抽成可測純函式（含空陣列回 null）。
  - 修改說明（2026-06-27）：於 `reportMetrics.ts` 新增 `average(values): number | null`（空陣列回 null），`report.ts` 的 `computeStudentRecords` 學生平均分改用之（行為等價）。`report-metrics.test.ts` 補 1 組測試（平均/單值/空陣列回 null/小數）。backend `tsc --noEmit` 通過；新測試 5/5 + 既有 `report-students`/`student-report` 共 15/15 回歸通過。分支 `refactor/report-average-helper`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 21 個完成項目（21/100，未達上限）。

## 修正既有失敗測試（第一三七輪，2026-06-27）

- [x] 修正 `status-machine.test.ts` 的 PROGRESS_STEPS 鏡像 drift（上輪跑測試時發現的既有失敗）：測試期望的 `PROGRESS_STEPS` 只有 7 個，但 `statusMachine.ts` 已新增 3 個 YouTube 相關步驟（`downloading_captions`／`downloading_audio`／`transcribing_audio`，於 `youtubeCaptions.ts`／`pipeline.ts` 實際使用、前端 `types.ts` 亦已鏡像），導致 `deepEqual` 失敗。確認 source 正確、test 過時，更新測試期望陣列（依 backend 陣列順序）並補 `isProgressStep('transcribing_audio')` 斷言。後端 `tsc --noEmit` 通過、`status-machine.test.ts` 5/5 通過（以 `scripts/run-tests.sh` 執行）。分支 `fix/progress-steps-test-mirror`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 17 個完成項目（17/100，未達上限）。

## 依 STATUS_REPORT 新增可執行項目（第一三五輪，2026-06-27）

使用者提示產生新項目時應參考 `docs/STATUS_REPORT_2026_06_27.md`（該檔此前因檔名問題不存在、現已補上）。依其 §4.2／§7.2／§9 的優先建議，新增以下項目（P0 bug 列首，已初步以 grep 驗證）：

- [x] **（P0 bug）修正品質檢查／匯出漏頁**：`quality-check.ts`、`image-quality.ts`、`script-quality.ts`、`h5p.ts` 皆以 `pages WHERE status = 'ready'` 取頁，但主 pipeline 完成後**頁面層級**停在 `audio_ready`（[`pipeline.ts:1260`]）、`pipeline.ts:1299` 只把 **pdfs**.status 設為 `'ready'`，頁面從不設 `'ready'`（grep 全 backend 確認頁面無 `status:'ready'` 賦值）。結果這些功能對正常生成的簡報可能回傳空頁清單。修正方向：改以「完成狀態集合（`audio_ready`／`ready`）」過濾，並先寫一個重現測試再修，補後端測試涵蓋 audio_ready 頁面被納入。屬後端、需測試、跨 4 路由，建議單獨一輪謹慎處理。
  - 修改說明（2026-06-27）：根因確認——`'ready'` **根本不是合法 page 狀態**（`statusMachine.ts` 的 `PAGE_STATUSES` 無 `ready`，終態為 `audio_ready`；`'ready'` 僅為 PDF 狀態），故 4 路由的 `WHERE status = 'ready'` 對 `pages` 永遠匹配 0 列。將 4 路由的頁面查詢一律改為 `status = 'audio_ready'` 並加註解說明。修正既有 3 個測試（image-quality/script-quality/h5p）的 fixture——原本用**不存在的** `'ready'` page 狀態（所以測試過但 production 壞），改為 `'audio_ready'`，使其反映真實狀態並成為回歸測試（pdfs INSERT 的 `'ready'` 為正確 PDF 狀態，維持不動）。為原本無測試的 quality-check 新增 `quality-check.test.ts`（4 子測試：audio_ready 頁面被檢查〔回歸〕、非完成頁〔rendered〕不檢查、404、403）。backend `tsc --noEmit` 通過；4 個路由測試以 Node 22（`.nvmrc`）+ `--test-force-exit` 執行，子測試全通過（quality-check 4/4、image-quality 4/4、script-quality 5/5、h5p 4/4）。分支 `fix/quality-export-page-status`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 16 個完成項目（16/100，未達上限）。
- [ ] **（P0）課後報告補強**：依 §7.1，`registerReportRoutes()`／`PostClassReportPanel` 補上頁面困難度（完成率低／提問多／投票分歧高）、題目答錯率與 CSV 下載入口。可分拆為純函式（前端彙總）+ 後端聚合兩個子項。
  - 進度（第一六九輪，2026-06-27）：**後端聚合子項「頁面困難度」已完成**（見下方「課後報告頁面困難度後端聚合」section，計數第 48 項）——`reportMetrics.ts` 新增純函式 `pageDifficultyScore`，`report/pages.csv` 新增 `question_count`／`difficulty_score` 欄位。
  - 進度（第一七二輪，2026-06-27）：**「題目答錯率彙整」後端聚合已收斂為可測純函式**（見下方「課後報告最難題目排序抽出純函式」section，計數第 51 項）——`reportMetrics.ts` 新增 `selectHardestQuestions`，`report/summary` 的最難前 5 題排序＋答錯率改用之。**仍待辦**：前端 `PostClassReportPanel` 困難度呈現／排序、答錯率呈現與 CSV 下載入口（純前端 UI）。
- [x] **（P1）生成前成本估算 modal 串接**：已有 `lib/costEstimate.ts` helper 與 `PromptModal` 估算，依 §7.5 確認是否已於所有來源（PDF／文字／YouTube）生成前顯示，補齊缺口並加測試。（與上方 §7.5「生成前成本估算覆蓋確認」為同一工作，已於第一六八輪一併完成；不重複計數。詳見該項與工作記錄。）
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
| 2026-07-04 | （使用者要求二次覆核權限測試矩陣）發現並修復**提權漏洞**：`PATCH /api/pdfs/:id/visibility` 閘門原為 `canEditPdf(...aclCtx)`，統一模型後匿名 editable-token 持有者／read_write 名單使用者可改「預設權限」（改 public_editable 即讓全世界永久可編輯、token 過期仍有效）。visibility 屬存取管理非內容編輯，改為 owner-only（`hasOwnerOrLegacyAccess`），與 ACL 管理 API／建立分享連結一致。並補齊矩陣測試（token-capability 22→27）：建立分享連結 owner-only、visibility owner-only、read_write 名單刪整份 403、只讀名單＋editable token→有效 edit（反向 max）、群組授權 HTTP 端對端。後端 tsc 通過、9 個權限套件序跑全綠（detail 92、page-ops 31、token-capability 27、pdf-access 13、permissions/permissions-api 各 6、read-gate/delete 各 5、groups 4、share-expiry 3） | fix/access-admin-owner-only |
| 2026-07-04 | （使用者要求）分享權限模型統一為兩套系統、分享連結成為真正的能力憑證：先前三套機制（visibility／分享 token／身分 ACL）語意重疊，且建立連結會偷偷翻動全域 visibility、token 不具保密力、`hasShareAccess` 未檢查到期。改為：系統一＝身分權限（visibility 預設＋ACL，`resolvePdfAccessLevel`）；系統二＝token 能力憑證（新增 `resolveTokenAccessLevel` 含到期，任何持有者取得內含 read/edit，建立連結不再改 visibility）；`aclCtx` 帶入 token，`canReadPdf`/`canEditPdf` 以 `max(身分,token)` 決策（~146 呼叫點免改）、清掉 40 處多餘且有到期 bug 的 share 讀取前綴、detail `access_level` 改回有效權限。破壞性子操作＝解析出 edit＋已登入；刪整份簡報限縮為僅 owner。後端 tsc 通過、既有權限套件無回歸（delete 測試改 owner-only）＋新增 token-capability 11 測試綠；前端 tsc 通過、ShareDialog＋i18n 29 綠、文案區分兩概念 | feat/unified-access-capability-tokens |
| 2026-07-03 | （使用者要求）把 worktree/demo16 完整合併回 master：先在 demo16 提交其未提交的「直播測驗允許重新進入（quiz re-entry）」WIP（排除 demo16 專屬的 start.sh 本地改動），再 `git merge --no-ff worktree/demo16` 帶入 demo16 累積但未進 master 的功能（poll-results 彈窗、watch-records 對話框、quiz camera recording/proctoring/finish button、quiz re-entry）。主 repo 工作區同一份重複的 WIP 經比對與 demo16 內容完全相同（僅檔案權限位元差異），已捨棄改由合併帶回。前後端 typecheck 通過；i18n 27、pdf-access 13、groups-api 4、poll-voters 3 測試綠 | worktree/demo16 → master（merge dd26906） |
| 2026-07-03 | （使用者要求，步驟 5–6／共 6，接續當日步驟 1–4）身分式分享權限完成群組與收尾。步驟5 群組：DB（groups/group_members）+ owner-scoped CRUD（4 測試）+ resolver 展開群組成員 + 管理 API/list 支援 group principal + 系統設定「群組」管理 UI + 分享面板 search 納入群組/名單顯示群組/「存成群組」；步驟6 收尾：前端 `access_level` 讓只讀名單顯示唯讀 UI。前後端 typecheck 通過、ACL/群組/權限 42 測試綠。功能六步驟全部完成 | feat/pdf-acl-step5-groups-backend／-step5c-groups-ui／-step5d-share-groups／-step6-readonly-ui（皆已 merge） |
| 2026-07-03 | （使用者要求，步驟 1–4／共 6）身分式分享權限：per-user 只讀/讀寫名單 + 預設權限（沿用 visibility）。步驟1 ACL 表+resolver（11 測試）；步驟2a canRead/EditPdf 加可選 ACL context+detail 讀取+access_level（5+92 測試）；步驟2b 接線全站 ~130 呼叫點（無回歸）；步驟3 管理 API+帳號 search（5 測試）；步驟4 分享對話框「存取權限」分頁（含 search、i18n 24/24） | feat/pdf-acl-step1..4（皆已 merge） |
| 2026-07-02 | （使用者要求）測驗監考錄影只錄影不錄音：`useQuizRecorder` 的 `getUserMedia` 由 `audio: true` 改為 `audio: false`，不請求麥克風、避免收錄環境音；串流無音軌故產出純視訊 webm。更新註解、前端 tsc 通過 | feat/quiz-recording-video-only |
| 2026-07-02 | （使用者要求）同步 master/follower 定義改為以擁有者為準：「自己的簡報按同步→master，不是的→follower」。後端 `/sync/join`、`/sync/state` 取得主控權門檻由 `canEditPdf` 改為 `isPdfOwner`（public_editable 協作者不再能搶 master，改以 follower share-join）；前端 `PlayPage` 以 `isSyncMasterEligible = detail?.is_owner` 決定 join/share-join 路徑、自動跟隨與 master 重奪。更新+新增 sync 權限測試；前後端 tsc 通過、sync 權限 13/13 + 其餘 sync 7/7 回歸通過 | feat/sync-master-follower-by-ownership |
| 2026-07-02 | （使用者要求）把 AI 導師回答存成評論時標示「存的人」的名稱：原本未設暱稱時作者只記成「AI 導師」，看不出誰存的。改為以「評論暱稱 → 登入帳號 name/email」解析存檔者，作者存為「{存檔者}（AI 導師）」（同時保留 AI 導師來源標示），完全無名稱時才退回單純「AI 導師」。新增 i18n 鍵 `play.sidebar.aiTutorAuthor`／`aiTutorAuthorWithName`（zh-TW/en），並沿用新的 share token 參數。前端 tsc 通過、i18n 24 測試通過 | feat/ai-tutor-comment-saver-name |
| 2026-07-02 | （使用者要求）評論對「能開啟簡報的人」公開（含分享連結）：評論本來就對簡報的可讀者共享（無按作者過濾），但評論路由只認 `canReadPdf`，導致以分享連結開啟私人簡報的學生讀取/新增評論會 403。將評論「列出全部／單頁列出／新增」三個端點改為 `hasShareAccess(request,id) || canReadPdf(...)`（比照 quiz 路由），前端 `listAllComments`/`listPageComments`/`createPageComment` 加 `share` query 並由 `PlayPageSidebar` 帶入 `currentShareToken`；resolve/edit/delete 仍限 owner/editor。新增回歸測試（分享連結觀看者可貼文並互相看到、無 token 仍 403）。前後端 tsc 通過、page-comments 12/12 | feat/comments-visible-via-share |
| 2026-07-02 | （使用者要求）AI 導師「問這一頁」改以 Markdown＋LaTeX 作答：前端 `PageAskPanel` 早已用 `MarkdownMath`（Markdown＋KaTeX，支援 `$...$`／`$$...$$`）渲染答案，但 `/pages/:n/ask` 的 system prompt 從未要求模型輸出該格式。於 [page-operations.ts](backend/src/routes/pdfs/page-operations.ts) 該 prompt 新增「格式（務必遵守）」指示：以 Markdown 作答（標題／粗體／條列／表格），數學式一律用 Markdown 可渲染的 LaTeX（行內 `$...$`、區塊 `$$...$$`），不得用純文字或圖片描述數學式。純 prompt 調整、無需前端改動；後端 tsc 通過 | feat/ai-tutor-markdown-latex-answer |
| 2026-07-02 | （使用者要求新功能）問答題（essay）＋紙本拍照上傳＋AI 自動閱卷＋老師覆核：新增第三種題型 `essay`（含 `reference_answer` 參考答案／評分重點，僅供 AI 閱卷不顯示給學生）。學生作答時以 `<input capture>` 拍紙本答案上傳（可多張），後端用 sharp 正規化為 JPEG 儲存並以視覺 LLM（`callChatJSON` 送 `image_url`）比對參考答案給分＋評語（`quizEssayGrading` service，best-effort）；老師在「問答題閱卷」面板看照片、AI 分數與評語，可修改分數。essay 不計入自動客觀計分（前後端 `calcQuestionScore` 同步加 `essay→0`）。後端：`QuizQuestionSchema` 加 essay 型別、選擇題「≥2 選項/≥1 正解」改於 `SaveQuizBodySchema.superRefine` 嚴格檢查；新增 `quiz_essay_answers` 表、storage 路徑、消毒檔名／分數 clamp／prompt 建構純函式（附測試）、multipart 上傳＋老師列表／相片串流／`PATCH` 覆核分數端點。前端：types/編輯器/`EssayAnswerUploader`/`EssayAnswersPanel`/API 封裝＋26 個 zh-TW/en i18n 鍵。前端 611/611、後端 essay+計分一致性+quizzes 套件回歸通過、前後端 tsc 通過。備註：自 master 開分支（master 已含平行合入的 proctor/錄影功能） | feature/quiz-essay-photo-ai-grading |
| 2026-07-01 | （使用者要求）錄影規則文案獨立、依需要載入：把「相機錄影」段落從 `quiz-rules.md` 移到新檔 `quiz-rules-recording.md`；`QuizProctorGate` 新增 `recording` prop，規則載入改為永遠載入主規則、`recording` 為真時再額外抓取並附加錄影規則（抓取失敗不阻斷主規則）。`QuizBuilderPage` 依 `activeQuiz.record_camera` 傳入。關閉錄影的測驗不再顯示誤導的相機規則。前端 tsc 通過、611/611 | feat/quiz-rules-recording-split |
| 2026-07-01 | （使用者要求功能）測驗新增「作答時是否開相機錄影」選項：quiz_sets 新增 `record_camera` 欄位（migration，預設 1），貫穿 save/update/copy 端點與 `QuizSet` 型別、`saveQuizSet` API；編輯測驗加一個勾選框（zh-TW/en 各 2 鍵）。關閉時 `QuizProctorGate` 的 `onBeforeStart`/`onEnd` 傳 undefined（不請求相機、不錄影上傳）、隱藏右下角錄影指示，但全螢幕與離開偵測仍生效。備註：quiz-rules.md 的相機段落為靜態，關閉錄影時文案未動態調整（老師可自行客製）。前後端 tsc 通過、前端 611/611、後端 quizzes 25/25 | feat/quiz-record-camera-option |
| 2026-07-01 | （使用者要求，測驗監考三項行為調整）① 按「完成作答」後停在「已完成」畫面、不跳回簡報：`handleFinishQuiz` 不再 navigate，改記下 finished 的 sessionKey 並傳 `finished` 給 `QuizProctorGate`，gate 切到 completed phase、停止監控、退出全螢幕、結束錄影上傳。② 老師公布答案時，已完成／已鎖定者也要看到答案：gate 的 `!active` 分支對他們直接顯示答案；PlayPage 對已完成/鎖定者平常不導回作答頁，但 `quiz_show_answers` 為真時仍導回。③ 每次「開始測驗」都是全新一次：`handleStartQuiz` 送 `quiz_session_reset`，後端在開始時強制重新產生 `quiz_session_id`（即使重開同一份），使之前作答過/被鎖定的學生不再因舊 sessionKey 進不去。前後端 tsc 通過、前端 611/611、後端 sync 13/13 | fix/quiz-finish-stay-completed |
| 2026-07-01 | （使用者回報）監考錄影指示圖示不對：外圈太大、紅點在角落未置中。改為經典「錄影中」符號——較小外圈環（`h-8 w-8`）＋ flex 置中的脈動實心紅點（`h-3 w-3`），移除自拍影像顯示、video 改隱藏但保留 ref 供錄影。前端 tsc 通過 | fix/quiz-recording-icon |
| 2026-07-01 | （使用者回報，測驗監考四項後續修正，同一分支）① 按「完成作答並離開」後不再被自動拉回：新增持久化「已完成」旗標 `markQuizFinished`/`isQuizFinished`（鍵同 gate 的 `quizId:sessionId`），`handleFinishQuiz` 交卷時標記、PlayPage 導向作答頁前若該 session 已完成或已鎖定則跳過（一併修好違規鎖定後仍被反覆拉回），gate 重新進入顯示友善「已完成」畫面而非違規訊息（新增 completed phase 與 zh-TW/en 各 2 鍵）。② 錄影僅簡報 owner 可見：新增 `isPdfOwner`（排除 public_editable 協作者與公開），套用錄影清單/檔案端點，前端錄影按鈕改以 `detail.is_owner` 顯示。③ 監考自拍預覽縮成右下角小圓圖示（含脈動紅點），不再擋題目。④ 「複製到」下拉加 `max-w-[8rem] truncate`，長簡報標題不再撐爆版面。新增 quizProctor finished 測試與 isPdfOwner 測試；前後端 tsc 通過、前端 611/611、後端 permissions 6/6・quizzes 25/25 | fix/quiz-proctoring-followups |
| 2026-07-01 | （使用者要求功能）測驗新增「完成作答並離開」按鈕：作答中（`!syncQuizShowAnswers`）於題目下方顯示按鈕，點擊出現頁內確認框（非 `window.confirm`，避免觸發失焦違規），確認後 `submitFollowerAttempt()` 交卷並 `navigate` 回播放頁；離開會卸載 `QuizProctorGate`，其 `onEnd` 停止並上傳錄影、瀏覽器自動退出全螢幕，且「已開始」旗標使同一測驗無法重新進入。新增 zh-TW/en 各 5 個 i18n 鍵；前端 tsc 通過、610/610 測試全綠 | feat/quiz-finish-button |
| 2026-07-01 | （使用者回報 bug）監考錄影未出現在歷史記錄：根因為老師結束測驗時 follower 的 `active_quiz_id`/`quiz_session_id` 會被 sync 重置為 null，早於 gate `onEnd`（`stopAndUpload`）執行，導致上傳時 `sessionId` 為 null 而整個略過上傳、錄影從未到伺服器。改為在 `useQuizRecorder.start()` 擷取當下的 `pdfId/quizId/sessionId/clientId` 至 ref，`stopAndUpload` 改用擷取值（deps 收斂為 []），與結束時的 prop 變動脫鉤。前端 tsc 通過 | fix/quiz-recording-session-capture |
| 2026-07-01 | （使用者回報 bug）監考全螢幕作答時無法捲動、只能作答第一題：`QuizProctorGate` 進入全螢幕的容器 `overflow` 預設裁切溢出內容且不可捲動。容器加上 `[&:fullscreen]:h-screen [&:fullscreen]:overflow-y-auto`（Tailwind arbitrary variant），僅在全螢幕狀態下啟用垂直捲動，不影響行動端 fallback（未進全螢幕時走一般頁面捲動）。前端 tsc 通過 | fix/quiz-proctor-fullscreen-scroll |
| 2026-07-01 | （使用者要求新功能，接續防作弊）測驗監考錄影：學生同意規則時**強制開前鏡頭**（getUserMedia，拒絕則無法作答）並以 MediaRecorder 全程錄影，右下角常駐自拍預覽＋「錄影中」標記；自動交卷／老師公布答案／離開時停止並上傳到 `storage/<pdfId>/quiz-recordings/`。後端新增 `quiz_recordings` 表、storage 路徑輔助、消毒檔名純函式（附測試）、multipart 上傳端點（守門比照作答提交 `hasShareAccess||canReadPdf`）與老師專用清單／串流端點（`canEditPdf`）。前端新增 `uploadQuizRecording`/`fetchQuizRecordings`/`quizRecordingFileUrl` API、`useQuizRecorder` hook、`QuizProctorGate` 的 `onBeforeStart`/`onEnd` 掛勾、`QuizBuilderPage` 老師端錄影清單；新增 zh-TW/en 各 14 個 i18n 鍵、於 quiz-rules.md 補相機說明。前後端 tsc 通過、前端 610/610、後端 quiz 套件回歸通過（含新表 migration）。備註：依 CLAUDE.md 建於 proctor 分支之上 | feature/quiz-camera-recording（基於 feature/quiz-proctor-fullscreen-lock） |
| 2026-07-01 | （使用者要求新功能）測驗防作弊（網頁版）：學生（follower）作答前先顯示規則同意畫面，規則內容載自可客製化的 `frontend/public/quiz-rules.md`（相對 `document.baseURI` 抓取，兼容子路徑與 Electron file://）；同意後 best-effort 進入全螢幕並監控「離開全螢幕／切換視窗或分頁／切換 App」（`fullscreenchange`+`visibilitychange`+`blur`，1.2s 去抖動＋進入全螢幕 0.9s 寬限期避免轉場誤判）。最多允許一次違規，第二次自動交卷（呼叫既有 `submitFollowerAttempt`）並鎖定；鎖定與「按下同意即標記 started」持久化於 localStorage，使重整／重新進入同一 session 一律被擋下（同一次測驗不允許再進入）。新增純解析器 `markdownLite`（標題／清單／粗體最小子集，避免 XSS）、`quizProctor`（違規判定＋lockout/started 儲存）純邏輯與 `QuizProctorGate` 元件，接入 `QuizBuilderPage`；新增 zh-TW/en 各 12 個 i18n 鍵。新增 markdownLite 6 + quizProctor 6 測試；前端 tsc 通過、完整前端套件 610/610 全綠。備註：全螢幕/切窗為瀏覽器層僅能「偵測＋嚇阻」不能硬性封鎖；意外重整會鎖定，老師可用「重設作答」或重開測驗（新 session）解除 | feature/quiz-proctor-fullscreen-lock |
| 2026-06-30 | （使用者要求續作）觀看記錄視窗加「時間」欄：顯示每筆 `updated_at`（該觀眾最後一次回報此頁的時間）格式化為本地 `YYYY/MM/DD HH:mm`，cell title 保留原始 ISO。後端明細端點本就回傳 updated_at，僅前端顯示。新增純函式 `formatWatchTimestamp` 與 2 測試；前端 typecheck、watchProgress 20 + i18n 24 測試全綠 | feat/watch-records-dialog |
| 2026-06-30 | （使用者回報續修）觀看記錄只顯示隨機 `viewer-xxx`：根因是 `useWatchProgress` 一律用 `getOrCreateViewerId()` 的匿名 localStorage id 回報，從未帶入 user_code（與投票不同）。改為比照投票：先 `resolveConfiguredUserCode()`，有設 user_code 就用它、否則退回匿名 id。user_code 為非同步解析，故每筆排隊回報在送出前 `await viewerIdReadyRef`，確保整個 session 同一人用同一個 viewer_id（不會前匿名後 user_code 被當兩人）。既有舊記錄無法回溯。新增純函式 `pickViewerId` 與 3 測試；前端 typecheck、viewerId 7 測試全綠 | fix/watch-records-use-user-code |
| 2026-06-30 | （使用者要求功能）投影片管理新增「觀看記錄」視窗：新增老師專用端點 `GET /api/pdfs/:id/watch-progress/details`（`canEditPdf` 守門、可選 `?page=N`），回傳逐位觀眾各頁的觀看明細。投影片管理標題列加「觀看記錄」按鈕（整份、以使用者為單位列出各頁聆聽時間/完整度/是否看完）；每張投影片的綠色觀看徽章改為可點擊，點擊後只顯示該單張投影片的觀看記錄。新增前端純函式 `groupWatchRecordsByViewer`/`watchRecordListenedPercent`/`formatWatchDuration`。新增後端 3 測試、前端 helper 4 測試；前後端 typecheck、i18n 24 測試全綠 | feat/watch-records-dialog |
| 2026-06-29 | （使用者要求續作）投票結果對話框補上各選項的投票人 code：新增老師專用端點 `GET /api/pdfs/:id/polls/:pollId/voters`（以 `canEditPdf` 守門，避免共用的 /polls 讀取端點洩漏投票人身分），回傳每票的 voter_id（投票者自設 user_code 或匿名 voter-xxx）＋所選選項；對話框開啟時抓取並以標籤列出各選項投票人，匿名者顯示為「匿名」。新增前端純函式 `groupVotersByOption`/`isAnonymousVoterId`。新增後端 3 測試、前端 helper 3 測試；前後端 typecheck、i18n 24 測試全綠 | feat/poll-results-dialog |
| 2026-06-29 | （使用者要求功能）播放頁側欄投票區新增「查看結果」按鈕，開啟跳出式對話框（`PollResultsDialog`）顯示本頁各投票的資訊（問題、總票數、已作答人數、進行中／已結束）與各選項票數＋百分比長條；沿用既有聚合 `PagePoll` 資料、不額外打後端。新增 zh-TW/en 各 9 個 i18n 鍵；前端 typecheck 通過、i18n 24 測試全綠 | feat/poll-results-dialog |
| 2026-06-28 | （前端，去重，推進 §7.2）抽出品質檢查徽章狀態純函式 `analysisBadgeState(hasRun, running, issueCount)`（hidden/ok/issues 判別聯集），收斂 `QualityCheckPanel` 品質/逐字稿/圖片三區塊重複的巢狀三元徽章判斷；新增 4 測試（qualityCheckSelection 9/9）；tsc 通過。為後續側邊欄品質徽章提供可測基礎（計數 63/100） | refactor/analysis-badge-state（已 merge） |
| 2026-06-28 | （前端，使用者回報 UI）「AI 助手」分頁改 notebook 子分頁：原本導師問答／品質報告／本頁問答三塊垂直堆疊各自侷促，改為頂端子分頁列（導師問答／品質報告／本頁問答）一次顯示一個，active 面板 `flex-1` 撐滿側欄高度；`PageAskPanel` 對話區由 `max-h-96` 改 `flex-1`、`QualityCheckPanel` root 改 `flex-1 overflow-y-auto`（chat 本就 flex-1）。新增 3 個子分頁 i18n key（labelKey 以 `TranslationKey` 型別收斂）。tsc／i18n parity／vite build 通過。不計入 100 輪計數 | feat/ai-tab-notebook（已 merge） |
| 2026-06-28 | （前端，使用者回報 UI 系列）播放頁檢視體驗整理：(1) 移除與「投影片管理」重複的「大綱」區，把總時長＋看過進度併入管理區標題，刪 `OutlineSection`/`getOutlineTitle`/死 i18n key；(2) 側欄「放大」(`sidebarExpanded`) 時投影片管理改「圖左、清理後逐字稿右」並排檢視，新增可測純函式 `cleanTranscriptForReview`（去 `Speaker N:`／`[語氣]`／換行，5 測試）；(3) 編輯區分頁標籤改 `whitespace-nowrap`/`text-xs` 不換行；(4) 深色播放器沒設文字色而繼承淺色 `text-text` 致控制列圖示近隱形——給播放器 `text-slate-100`、剩餘時間 slate-500→400；(5) 動畫焦點框加 ⤢ 放大對話框（重用 responsive `EffectPositionEditor`＋X/Y/寬高 輸入，抽 `applyFocusParams` 共用）。tsc／i18n parity／vite build 通過。不計入 100 輪計數 | refactor/merge-outline-into-slide-mgmt（已 merge） |
| 2026-06-28 | （前端，使用者回報 UI，大型）淺色主題改造第一階段（PlayPage）：根因是全站淺色模式失效——元件普遍寫死深色 `slate-*`，淺色像「深色降亮度」。改為「淺色管理介面＋深色播放區」混合設計。Token 層（`index.css`/`tailwind.config.js`）：頁底改 #F5F7FA、新增 `surface-muted`/`border-light`、主色 cyan→indigo（淺 #4F46E5 以通過對比測試、深 #818CF8）。`PlayPageHeader` 改淺色列＋陰影、條件橫幅與同步 Q&A 面板加 `dark:` 變體（下拉彈窗維持深色）。`PlayPageSidebar` 各區改語意 token 白卡片（深色 token≈舊 slate，深色模式視覺不變）、管理列 4 顆按鈕收斂為「主色 Add／淡色 Regenerate／中性 Add-multiple／danger Delete」、留言(sky)/複習(rose)改淺色淡卡片。`PlayPageSlidePanel` 深色播放器加陰影與淺底分界。AI 分頁的兩個獨立子面板 `PageAskPanel`（AI 導師問這一頁）、`QualityCheckPanel`（品質報告）為單獨檔、首輪未涵蓋，使用者再回報後一併遷移（同樣手法；提問鈕收斂為 indigo 主色、品質徽章與腳本/圖片分析鈕改淺色淡 chip）。使用者再指中央播放面板——依其選擇做「觀看區留深、編輯區轉淺」：投影片觀看區/字幕/播放控制與播放設定維持深色（沉浸觀看），下方逐字稿/提示詞/來源/系統分頁編輯區（行 1065–1720）改語意 token 淺色面板＋彩色強調 `dark:` 變體（分頁列 active 用 surface 對比凸顯）。動畫/圖表兩子分頁（獨立元件 `AnimationEditorTab` ~2590 行、`FigureAssetsTab`）使用者要求一併完成，亦以相同手法遷移——至此整個播放面板編輯區在淺色模式完整一致。驗證：tsc、`contrastRatio.test.ts` 8/8、vite build、輸出 CSS 確認含新 token。**取代**先前 `fix/outline-text-contrast` 的 slate-400 暫時修法（改用 `text-muted`）。不計入 100 輪計數 | feat/light-theme-playpage（已 merge） |
| 2026-06-27 | （前端，使用者回報 UI；**已被 `feat/light-theme-playpage` 取代**）播放頁右側大綱列表次要文字對比過低：`OutlineSection` 由 `text-slate-500` 改 `text-slate-400`。註：此修法只考慮深色，在淺色模式下反而更糟，已由淺色主題改造改用 `text-muted` 取代。純樣式調整，不計入 100 輪計數 | fix/outline-text-contrast |
| 2026-06-27 | （前端，可測）首頁分類分組組裝抽出 `groupItemsByCategory`（find-or-create 分組/組內排序/組間依分類名排序/預設分類 fallback），`HomePage` 改用之；補 5 測試（共 11）；前端 typecheck 通過（計數 62/100） | refactor/group-items-by-category（已 merge） |
| 2026-06-27 | （前端，可測）範本庫分類/搜尋/排序抽出 `templateCategories`／`filterAndSortTemplates`（newest 保留序、popular 套用次數降冪穩定排序、搜尋名稱/說明/提示詞），`TemplatesPage` 改用之；補 5 測試；前端 typecheck 通過（計數 61/100） | refactor/template-filter（已 merge） |
| 2026-06-27 | （前端，可測）測驗歷史平均分抽出 `averageAttemptScore`（忽略未評分 null、全空回 null、未四捨五入），`QuizBuilderPage` 改用之；補 4 測試（quizScoring 15）；前端 typecheck 通過。另記錄 `render-text-pages-figure-injection` 非確定性 flaky 調查結論（跨檔全域污染、不值得自動盲修）（計數 60/100） | refactor/average-attempt-score（已 merge） |
| 2026-06-27 | （基線檢查+修自引入回歸）跑完整套件：前端 575/575 全綠；後端 3 失敗中 2 個為既有 flaky（figure-reference/llmUsage，隔離 10/10、僅併跑全域污染），1 個是第一七五輪自引入——templates「corrupt skill_data」測試用固定 id 致持久化 DB `UNIQUE` 衝突；改隨機後綴 id、連跑 8/8（計數 59/100） | fix/templates-test-unique-id（已 merge） |
| 2026-06-27 | （前端，可測）動畫效果合併選取計算抽出 `mergeEffectRanges`：最早 start/最晚 end/沿用最早效果(含 startTrigger)/duration 算法，`AnimationEditorTab` 合併處理改用之；補 3 測試（animationSpec 61）；前端 typecheck 通過（計數 58/100） | refactor/merge-effect-ranges（已 merge） |
| 2026-06-27 | （前端，可測）焦點動畫框拖曳/縮放幾何抽出 `resizeFocusBox`：9 把手邊界夾界/最小尺寸/西北把手連動原點/四捨五入，`AnimationEditorTab` onPointerMove 改用之；補 7 邊界測試；前端 typecheck 通過（計數 57/100） | refactor/focus-box-resize（已 merge） |
| 2026-06-27 | （前端，去重/可測）品質檢查面板挑選邏輯抽出純函式：`selectIssuePages`／`selectEmptyScriptFillPages`（含 LLM 批次補逐字稿 fan-out 上限），`QualityCheckPanel` 改用之、移除內聯；補 5 測試；前端 typecheck 通過（計數 56/100） | refactor/quality-check-selection（已 merge） |
| 2026-06-27 | （後端，健壯性修復）相似頁面 embedding 無防護解析致一壞全壞：`GET …/similar` 跨整個帳號教材庫比對，任一筆 embedding 損壞 500 整個面板；新增 `parseEmbedding`（非法/非陣列/含非數字回 null），目標損壞→indexed:false、候選損壞→跳過；補純函式 5 + 整合 2 測試（16 回歸）（計數 55/100） | fix/similar-pages-guard-embedding-parse（已 merge） |
| 2026-06-27 | （後端，健壯性修復）範本清單 `skill_data` 無防護解析致一壞全壞：`GET /api/templates` 逐列 `rowToTemplate` 的 `JSON.parse(skill_data)` 任一筆損壞會 500 整份清單；抽出 `parseSkillData`（非法/非物件回 {}）改用之、損壞列退化為空；補純函式 + 損壞列整合測試（8/8）（計數 54/100） | fix/templates-guard-skill-data-parse（已 merge） |
| 2026-06-27 | （後端，去重+健壯性修復）抽出共用 `parsePollOptions`：`page_polls.options_json` 兩處無防護 `JSON.parse(...) as string[]`（投票結果 CSV、投票端點）單筆損壞會 500，統一改用穩健解析（非法/非陣列回 []、過濾非字串）；`rowToPoll` 去重；補 5 測試，poll 路由共 100+ 測試回歸通過（計數 53/100） | refactor/parse-poll-options（已 merge） |
| 2026-06-27 | （後端，去重）抽出共用 `csvDownloadFilename`：收斂 6 個匯出/報告路由（quiz-results/poll-results/comments/report 學生·逐頁·題目）內聯的「標題優先、否則退回 ID」CSV 檔名邏輯；report 3 處順帶消除重複 `safeDownloadBaseName` 呼叫；補 4 測試，37 測試回歸通過、檔名輸出不變（計數 52/100） | refactor/csv-download-filename（已 merge） |
| 2026-06-27 | （§7.1 後端聚合子項）課後報告摘要「最難題目」排序抽出為純函式：`reportMetrics.ts` 新增 `selectHardestQuestions`（過濾未作答→正確率升冪、並列以答錯數多者優先→取前 5→補 wrong_rate），`report/summary` 改用之（行為等價、API 不變）；補 4 測試，report-metrics/report-question-stats/report-summary 共 21 測試回歸通過（計數 51/100） | refactor/select-hardest-questions（已 merge） |
| 2026-06-27 | （使用者回報 bug，不計數）Uhga6bY0Bm 42/43 頁焦點動畫紅框位置全錯：查證確認現行程式碼正常（圖片有送、cgu-air gpt-5.5 支援 vision、真實路徑重跑 4 次皆產生貼合版面方框），壞規格是先前 add-pages 失敗那批補產動畫的舊殘留（當時圖片未被模型使用）。資料修復：以 gpt-5.5 透過 `generateAnimationForPage` 重產 42/43 頁焦點動畫寫回 animation.json + DB（distinct xPct 由 1→4–5、貼合版面）；44 頁本就 static-image 未動。程式碼：修正 `generateAiFocusEffects` docstring 中「圖片只在 LLM_PROVIDER=openai 才會用」之過時誤導註解，改述各 provider 實際圖片處理行為，typecheck 通過 | fix/autofocus-image-provider-comment（已 merge）＋資料修復 | 
| 2026-06-27 | （使用者回報 bug，不計數）重生圖檔未把 image_path 寫回 DB：批次重生圖檔步驟（[regenerate.ts](backend/src/worker/regenerate.ts)）產圖後只寫檔/縮圖/commit，假設該頁原本就有 image_path；對原本 image_path 為 NULL 的頁（如 Uhga6bY0Bm 43/44，由半失敗 add-pages 復原而來）→ 檔在磁碟、DB 仍 NULL、前端讀不到圖。改為產圖後 `UPDATE pages SET image_path=?`。另修復實例 Uhga6bY0Bm 42/43/44（DB+metadata 補上已產生的圖路徑）。新增 `regenerate-image-persists-path.test.ts`，typecheck + figure-reference 3/3 回歸通過 | fix/regenerate-image-persist-path（已 merge） |
| 2026-06-27 | （使用者回報 bug，不計數）動畫 auto-focus 容忍 LLM 超範圍座標：CGU Air 模型回 `yPct>100` 被 `AutoFocusItemSchema` 的 `.min/.max` 擋下、重試 2 次後整個動畫步驟失敗，但下游 `mapAutoFocusResponseToEffects` 早已 clamp。改為 schema 對 xPct/yPct/widthPct/heightPct/exitDuration/angle 只驗 `z.number().finite()`（不再限範圍）、由既有 clamp 正規化，並補上 angle 的 modulo 正規化。新增 `animation-autofocus-schema-tolerance.test.ts`（3 測試，含重現 yPct>100、angle 環繞、仍拒 NaN/Infinity），backend typecheck + auto-focus map 11/11 通過 | fix/autofocus-tolerate-out-of-range-coords（已 merge） |
| 2026-06-27 | （使用者回報 bug，不計數）圖片生成改為跟隨所選供應商：原本所有產圖（初次 `renderTextPagesWithLlm`、批次重生、單頁 regenerate-image/inpaint）都硬用 `getOpenAIClient()`＋`config.openaiImageModel`，導致帳號選 CGU Air 當 LLM 時圖片仍送 OpenAI、無效金鑰時 401。新增 `getImageClient()`（影像 provider 跟隨 `llmProvider`，gemini→openai fallback）＋ per-provider 影像模型設定 `cguAirImageModel`/`openrouterImageModel`（env/設定 API/前端欄位/i18n）。四個產圖點全改用之。新增 `image-client-provider.test.ts`（4 測試），前後端 typecheck + regenerate-image/figure-reference 回歸通過。**注意：須 CGU Air 端提供 OpenAI 相容的 /images 介面才會實際運作，模型名稱由使用者於設定填入** | feat/image-provider-follows-selection（已 merge） |
| 2026-06-27 | （使用者回報 bug，不計數）重生圖片時原圖不存在也要能進行：單頁 `regenerate-image` 與「重生」批次 job 的圖檔步驟原本一律 `images.edit` 讀現有圖當基底，缺檔（如 Uhga6bY0Bm 42/43/44）會 ENOENT 整個失敗。兩處改為缺底圖時退回文字→圖：try/catch 只吞 ENOENT、有 figure 則 edit 否則 `images.generate`，有真底圖行為不變。新增 `regenerate-image-missing-base.test.ts`（2 測試），typecheck + figure-reference/image-edit-timeout 回歸通過 | fix/regenerate-image-missing-base（已 merge） |
| 2026-06-27 | （使用者回報 bug，不計數）add-pages 失敗讓 DB↔metadata 分歧、簡報像整份壞掉：`runAddPagesJob` 先位移頁碼/+page_count/插新頁但僅成功時重寫 metadata.json → 失敗留下位移後 DB 與舊 metadata 不一致。抽出 `rebuildAddPagesMetadataFromDb` 並在成功/失敗/取消三路徑都呼叫；新增 2 測試，typecheck + orphan-recovery 5 回歸通過。另實例修復 `Uhga6bY0Bm`：依裁示「保留 3 頁並重新產生」把 metadata 重建為與 DB 一致的 86 頁（原 83 頁時間戳保留）。盤點新增後續項目「regenerate-image 無底圖退化生成」 | fix/add-pages-failure-metadata-consistency（已 merge） |
| 2026-06-27 | （§7.2 後端子項）品質檢查回應新增 `summary` 摘要（pagesChecked/pagesWithIssues/totalIssues）：新增純函式 `summarizeQualityResults`、前端型別同步；補單元測試 + 整合測試斷言，quality-check 5/5、前後端 typecheck 通過（計數 50/100） | feat/quality-check-summary（已 merge） |
| 2026-06-27 | （§8.1.4 純前端）全域搜尋選取模式新增「加入複習清單」批次動作：新增純函式 `searchResultsToReviewItems`（過濾無頁碼、snippet→questionText），`GlobalSearchBox` 加按鈕呼叫 `addReviewItems`；新增 i18n 鍵與 3 測試，前端 typecheck + i18n + GlobalSearchBox 回歸通過（計數 49/100） | feat/search-add-to-review-list（已 merge） |
| 2026-06-27 | （§7.1 後端聚合子項）課後報告 pages.csv 新增頁面困難度：`reportMetrics.ts` 新增純函式 `pageDifficultyScore`（完成率/投票分歧/提問率三訊號平均、0–1、缺值略過），`report/pages.csv` 新增 `question_count`/`difficulty_score` 欄位；補 4 純函式測試 + 更新 pages-csv 測試，報告測試回歸通過（計數 48/100） | feat/report-page-difficulty（已 merge） |
| 2026-06-27 | （§7.5，補真缺口）上傳 PDF 後在生成前顯示成本估算：`POST /api/pdfs` 新增回傳 `source_page_count`（PDF 實體頁數，不寫 persisted page_count），前端新增 `promptTargetPageCount` 純函式（page_count → source_page_count fallback）供 PromptModal；確認 TXT/YouTube 生成前無從估算（非缺口）。補 backend 2 + frontend 3 測試，前後端 typecheck + 上傳路由回歸通過（計數 47/100） | feat/upload-source-page-count-cost-estimate（已 merge） |
| 2026-06-27 | （新功能，使用者指定）播放頁一般檢視點擊投影片改為進入全螢幕（取代點擊 playPause，播放/暫停改用獨立按鈕與空白鍵）：`PlayPageSlidePanel` 的 `onImgClick` 改用 context 的 `setFullscreenLayout`/`setImageOnlyFullscreen`；新增 aria-label i18n 鍵；前端 typecheck + i18n 27 測試通過（計數 46/100） | feat/click-slide-toggle-fullscreen（已 merge） |
| 2026-06-27 | （新功能）語意搜尋掃描簡報數上限改為每帳號可設定：硬編 `MAX_SEMANTIC_PDFS=20` → 設定 `semanticSearchMaxPdfs`（預設 20、範圍 1–200，clamp 防呆），串接 settings.env/admin API/Settings 頁/i18n；補 4 測試，前後端 typecheck + 回歸通過（計數 45/100） | feat/configurable-semantic-search-limit（已 merge） |
| 2026-06-27 | （真 bug 修復）ZIP 匯入 page 狀態 fallback 非法 `'ready'`+不驗證 → 改用 `isPageStatus` 驗證、無效正規化為 audio_ready；13 測試回歸（計數 44/100） | fix/import-page-status-normalize（已 merge） |
| 2026-06-27 | （真 bug 修復）from-pages 頁面用非法狀態 `'ready'`→ 重啟後被 orphan-recovery 標 failed；改 `'audio_ready'`、補回歸測試（from-pages 6/6）。另記錄完整套件零星 flaky（figure-reference/llmUsage、隔離下通過）（計數 43/100） | fix/from-pages-page-status（已 merge） |
| 2026-06-27 | （FK 稽核收尾）`addPagesFromPrompt` 中間插頁補 `defer_foreign_keys`（避免後續頁有投票時 FK 500）；重現驗證 + 17 測試回歸（計數 42/100） | fix/addpages-defer-fk（已 merge） |
| 2026-06-27 | （資料對齊擴展）頁面增/刪/移時 comments/drawings 也對齊：`shiftChildPageNumbers` 擴為三表、move per-page 移三表、delete 顯式刪被刪頁 comments/drawings；補 4 測試；後端 1203/1203 全綠（計數 41/100） | fix/realign-page-content-children（已 merge） |
| 2026-06-27 | （真 bug 修復）頁面增/刪/移時投票（page_polls）未隨頁碼重編號致 FK 500+錯位：三 renumber 交易加 `defer_foreign_keys`、delete 補子表 lockstep 位移；補 2 回歸測試；後端 1201/1201 全綠（計數 40/100） | fix/page-renumber-fk-defer-and-poll-shift（已 merge） |
| 2026-06-27 | 規畫輪（第一六〇輪）：確認 backlog 見底、品質檢查修正完整無缺口；依 STATUS_REPORT §7–§8 補 5 個優先可執行項目（多需 UI/後端整合，部分待使用者確認方向）。本輪為規畫輪、不計入 100 完成計數（維持 39/100） | master（僅文件） |
| 2026-06-27 | （前端補測試）`debugLog.ts` 補 3 單元測試（開關/防呆分支）；前端 532/532 全綠（計數 39/100） | test/debug-log（已 merge） |
| 2026-06-27 | （前端去重）抽出共用 `hasLocalStorage`（recentSearches/commentAuthor）；reviewList 因測試耦合保留；補 3 測試；前端 551/551 全綠（計數 38/100） | refactor/shared-has-local-storage（已 merge） |
| 2026-06-27 | （修既有失敗）`timing.test.ts`+`regenerate-matrix.test.ts` 共 5 個 401：補 `setSystemAuthSettings({googleAuthEnabled:false})`；12/12 + 4/4 通過（連跑穩定）（計數 36/100） | fix/timing-regen-test-auth（已 merge） |
| 2026-06-27 | （修既有失敗）`skills.test.ts`：`updateUserSkill` 改條件 spread 省略 undefined 模板鍵（與 create 形狀一致、修磁碟 round-trip 不符）；5/5 通過（計數 35/100） | fix/update-skill-omit-undefined-template-fields（已 merge） |
| 2026-06-27 | 跑完整後端套件（1199 測試/18 既有失敗，與去重無關）並分類；修 `input-security.test.ts` 4 失敗（缺 googleAuthEnabled:false 致 401）；其餘 14 個分組記錄待判斷（計數 34/100） | fix/input-security-test-auth（已 merge） |
| 2026-06-27 | （後端，去重）抽出共用 `canDestructivelyEditPdf`：4 檔 + delete.ts（消除同名不同 body）收斂至 permissions.ts；補測試；177 測試回歸通過、嚴格匿名行為保留（計數 33/100） | refactor/shared-can-destructively-edit（已 merge） |
| 2026-06-27 | （後端，去重收尾）detail.ts 改用共用 share `getShareToken`/`ShareTokenParamSchema`；`shareTokenFromRequest`(sync/server) 為 header-only 變體刻意保留；101 測試回歸通過（計數 32/100） | refactor/detail-reuse-share（已 merge） |
| 2026-06-27 | （後端，去重）抽出共用 `getPdfPermissionRow` 至 permissions.ts：10 標準檔收斂、合併 import；report.ts title 變體保留；typecheck 通過、約 274 路由測試回歸通過（計數 31/100） | refactor/shared-get-pdf-permission-row（已 merge） |
| 2026-06-27 | （後端，去重）抽出共用 share 存取群 `share.ts`（ShareTokenParamSchema/getShareToken/hasShareAccess）：10 檔成組收斂、清理 FastifyRequest import；補 6 測試；typecheck 通過、約 263 share 路由測試回歸通過（計數 30/100） | refactor/shared-share-access（已 merge） |
| 2026-06-27 | （修既有失敗）`page-animation.test.ts`：shape kind mirror drift——`triangle` 早已成合法形狀，測試改用真正不合法的 `octagon`；123/123 通過（計數 29/100） | fix/animation-shape-kind-test（已 merge） |
| 2026-06-27 | （後端，去重）抽出共用 `canEditPdf` 至 permissions.ts：21 檔標準定義收斂、合併 import；delete.ts 嚴格版保留；補測試；typecheck 通過、12 路由測試回歸通過；另記 1 個既有失敗（page-animation shape kind）（計數 28/100） | refactor/shared-can-edit-pdf（已 merge） |
| 2026-06-27 | （後端）收斂 2 個 `sessionSubFromRequest`（export/subtitles）改用共用 `sessionSub`，清理未用 import；10 測試回歸通過；全 repo 無殘留（計數 27/100） | refactor/collapse-session-sub-from-request（已 merge） |
| 2026-06-27 | （後端，大量去重）抽出共用 `sessionSub` 至 auth.ts：移除 38 檔逐字重複定義 + 清理 26 檔未使用 FastifyRequest import；補 4 測試；typecheck 通過、14 路由測試回歸通過（計數 26/100） | refactor/shared-session-sub（已 merge） |
| 2026-06-27 | （修既有失敗）`quizzes.test.ts` copy-to：診斷確認端點正常回 201，400 是測試送 `content-type: application/json` 卻無 body 觸發 Fastify body parser；改 3 請求為只帶 cookie；24/24 通過（計數 25/100） | fix/quizzes-copyto-test-headers（已 merge） |
| 2026-06-27 | （修既有失敗）`notes-txt.test.ts`：fixture 兩處塞 `page_notes = NULL` 違反 NOT NULL，改為 `''`；5/5 通過（計數 24/100）。quizzes copy-to 400 仍待重現除錯 | fix/notes-txt-test-page-notes-not-null（已 merge） |
| 2026-06-27 | （後端，大量去重）抽出共用 `canReadPdf`：27 個路由檔逐字重複的權限函式收斂為 `permissions.ts`；補 3 測試；typecheck 通過、30 路由測試回歸通過；另記錄 2 個與本輪無關的既有失敗測試（notes-txt、quizzes）（計數 23/100） | refactor/shared-can-read-pdf（已 merge） |
| 2026-06-27 | （後端）抽出 watch 聚合查詢 `queryWatchPages`：收斂 `report.ts` pages.csv 與 summary 兩處重複的 avg_listened_ratio SQL 為單一函式；7 報告測試回歸通過（計數 22/100） | refactor/query-watch-pages（已 merge） |
| 2026-06-27 | （後端）抽出學生平均分純函式：`reportMetrics.ts` 新增 `average`（空回 null），`report.ts` computeStudentRecords 改用；補 1 測試，15 報告測試回歸通過（計數 21/100） | refactor/report-average-helper（已 merge） |
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
