# MakeSlide TODO

本輪依照 `LOOP.md` 規則，在 `TODO.md` 無未完成項目的情況下，參考 `docs/FUTURE_ROADMAP.md` 與現有前後端程式結構完成一次系統掃描，新增以下可執行項目。這批項目優先選擇能直接利用目前已有資料表、路由、頁面與測試基礎的功能，避免從零打造過大的新模組。

## 掃描摘要（2026-06-22）

- 已確認專案目前為 React + Vite 前端、Fastify + TypeScript 後端，根目錄 `package.json` 已提供 build、typecheck 與 workspace 測試腳本。
- 後端已具備 quiz、poll、sync、watch progress、run history、slow artifacts、SLA settings、LLM usage 等資料基礎，可支撐路線圖 Phase 1 的課後學習報告。
- 前端已有播放頁、測驗編輯頁、系統資料頁與設定頁，適合先新增局部入口與報表畫面，而不是重做整體導覽。
- 目前最值得優先處理的方向是把已收集的互動與生成資料轉成教師可行動的洞察，並補上成本、搜尋與品質檢查的低風險 MVP。

## 新增可執行項目

- [x] 建立課後學習報告後端摘要 API：新增一個只讀路由，彙總單份簡報的 quiz attempts、page poll votes、sync follower questions 與 watch progress，回傳班級層級統計（參與人數、平均分數、投票參與率、提問數、每頁完成率），並補上後端單元測試。
  - 修改說明（2026-06-22）：新增 `GET /api/pdfs/:id/report/summary` 只讀後端路由，限制簡報擁有者或 `public_editable` 協作者讀取；彙總測驗作答次數/平均分數、投票數與投票參與率、同步提問數、以及每頁觀看完成率與平均聽取比例，並新增後端測試涵蓋聚合結果、權限、404 與空頁面統計。
- [x] 在播放頁加入「課後報告」入口與 MVP 畫面：讓簡報擁有者可從播放頁進入報告面板，顯示總覽卡片、最容易答錯的題目、投票分歧最高頁面與觀看完成率最低頁面；非擁有者與分享訪客不可見。
  - 修改說明（2026-06-22）：在播放頁 header 新增僅簡報擁有者且非分享連結情境可見的「課後報告」入口，前端串接 `GET /api/pdfs/:id/report/summary` 並新增報告面板。MVP 先顯示參與人數、測驗平均分數、投票參與率、學生提問等總覽卡片；觀看完成率最低頁面以既有 `watch_progress.pages` 排序呈現；逐題答錯與投票分歧則預留 `hardest_questions`、`most_divergent_pages` 型別與 UI，當後端尚未提供細節時顯示可擴充空狀態。新增純函式測試驗證排序、空資料與百分比格式化。
- [x] 補強 AI 導師「問這一頁」MVP：基於現有 follower question / AI answer 與 page script/source text，新增只針對目前頁面的提問入口，回答中標示引用來源（頁碼、逐字稿或來源文字），並限制匿名分享連結的可用權限。
  - 修改說明（2026-06-22）：新增 `POST /api/pdfs/:id/pages/:n/ask` 後端路由，要求登入（`sub !== null`）且具讀取權限；AI 提示詞指示以括號標示引用來源（「來自逐字稿」或「來自頁面文字」）。後端 detail 路由新增 `is_authenticated` 欄位供前端判斷。前端新增 `usePageAsk` hook、`PageAskPanel` 元件（置於 sidebar QA 分頁），以及 zh-TW/en 對應 i18n 鍵值。變更位於分支 `feature/ai-tutor-ask-page`，已 merge 回 master。
- [x] 建立生成前成本預估 modal：在 PDF/文字/YouTube 開始生成前，以頁數、來源字數、預估 TTS 長度與目前 LLM/TTS provider 計算粗估成本，顯示省錢/平衡/高品質三種方案，並將預估邏輯抽成可測試 helper。
  - 修改說明（2026-06-22）：新增 `frontend/src/lib/costEstimate.ts` 純函式 helper（`estimateGenerationCost`、`formatUsd`、`COST_TIERS`），內含 16 個 node:test 單元測試；`PromptModal` 新增 `pageCount` prop，於 modal 底部顯示「精簡／均衡／豐富」三種方案的預估 LLM + TTS 費用，並 on-mount 呼叫 `getSystemAiSettings` 取得目前模型名稱以提高估算準確度；`HomePage` 傳入 `promptTarget.pageCount`。zh-TW/en i18n 鍵值同步新增。變更位於分支 `feat/global-search-mvp`，已 merge 回 master。
- [x] 實作全域教材搜尋 MVP：先索引或即時查詢 pdf title、page text、page script，在首頁新增搜尋框與結果列表，結果可直接跳到對應播放頁頁碼；後端需限制 owner/public/share 可讀權限。
  - 修改說明（2026-06-22）：新增 `GET /api/search?q=<keyword>&limit=<n>` 後端路由（`backend/src/routes/pdfs/search.ts`），回傳統一的 `{query, results: [{pdf_id, pdf_title, page_number, match_type, snippet}]}` 格式；依 canReadPdf() 權限規則搜尋可讀 PDF（owner + public/public_editable），最多掃描 100 份；以 PDF 標題（match_type: 'title'）、頁面逐字稿（match_type: 'script'）和頁面文字（match_type: 'text'）三種來源搜尋，每份 PDF 最多回傳 3 頁結果；snippet 取前後各 60 字元。前端新增 `GlobalSearchBox` 元件（防抖 300ms），以 match_type badge、頁碼標示與 snippet 顯示結果，點擊直接導航至播放頁或指定頁碼。後端新增 6 個 node:test 單元測試（均通過）。初始版本位於分支 `feature/global-search-mvp`，完整實作位於分支 `feat/global-search-mvp-v2`，均已 merge 回 master。
- [x] 新增生成品質檢查摘要：在生成完成或使用者手動觸發時，檢查缺失圖片、空逐字稿、音檔不存在、腳本長度異常、動畫效果超出上限等規則，於播放頁顯示每頁品質警告並提供重生入口。
  - 修改說明（2026-06-22）：新增 `GET /api/pdfs/:id/quality-check` 後端路由（`backend/src/routes/pdfs/quality-check.ts`），掃描所有 `ready` 頁面的圖片、音檔、逐字稿檔案存在性與內容長度，並檢查動畫效果數量是否超過 20 個上限；前端新增 `QualityCheckPanel` 元件，置於播放頁側邊欄 AI 導師問答下方，提供手動觸發按鈕並顯示每頁問題清單及跳頁連結。變更位於分支 `feat/global-search-mvp-v2`，已 merge 回 master。
- [x] 補上 SRT / VTT 字幕匯出：利用既有逐字稿與 timeline/subtitle alignment 資料新增匯出端點，前端在匯出區提供字幕檔下載，並補測試涵蓋無 timeline 時的 fallback。
  - 修改說明（2026-06-22）：新增 `GET /api/pdfs/:id/subtitles.srt` 與 `GET /api/pdfs/:id/subtitles.vtt` 後端路由；有 `.timeline.json` 時直接使用 Whisper 對齊時間軸，無則以 `splitScriptIntoSentences()` 切句後將 `audio_duration_seconds` 等比例分配；多頁累計偏移確保全域時間戳正確。前端 `PlayPageHeader` 在講義 PDF 按鈕旁加入下載 SRT/VTT 按鈕，並補上 zh-TW/en i18n 鍵值。後端測試涵蓋 timeline 模式 SRT/VTT 格式正確性、fallback 模式回傳 200、無音頻時長時回傳有效字幕、不存在 PDF 回傳 404、私人 PDF 無權限回傳 403、多頁全域偏移正確性，共 9 個 test 全數通過。變更位於分支 `feat/srt-vtt-subtitle-export`。
- [x] 將 skills 擴充為教學模板資料模型：先定義 template schema（script prompt、image style、quiz prompt、tts preference），在設定或首頁提供「從模板建立」入口，並保留既有 skills API 相容性。
  - 修改說明（2026-06-22）：在 `UserSkill` 介面新增 4 個可選模板欄位（`imageStylePrompt`、`quizPrompt`、`ttsProvider`、`ttsVoice`），以向下相容方式更新 Create/Update API schema；`PromptModal` 在開啟時從 `GET /api/skills` 載入使用者技能，顯示紫羅蘭色「從技能模板套用」區塊，點擊模板可自動填入提示詞、圖片風格與 TTS 聲音；有圖片風格設定的模板顯示 🎨 icon。變更位於分支 `feature/skills-as-teaching-templates`，已 merge 回 master。
- [x] 新增手機/平板課堂控制器 MVP：在前端新增 `/remote/:id` 路由，讓教師可用手機作為遙控器控制課堂同步播放；共用既有 sync 狀態機（POST /api/pdfs/:id/sync/join、POST /api/pdfs/:id/sync/state、GET /api/pdfs/:id/sync/state），介面含目前頁碼/總頁數、上下頁按鈕、目前頁逐字稿，並支援開始/結束同步會話。
  - 修改說明（2026-06-22）：新增 `frontend/src/pages/RemoteControllerPage.tsx`，使用 `joinPlaybackSync()` 以 master 身份加入/接管同步會話，每 2 秒輪詢 `fetchPlaybackSyncState()`，換頁時呼叫 `updatePlaybackSyncState()` 同步頁碼給所有 follower；介面以大字頁碼、觸控友善的上下頁按鈕與目前頁逐字稿為主，底部提供「開始/結束同步播放」按鈕，頁面返回時自動呼叫 `leavePlaybackSync()`。`PlayPageHeader` 同步 master 面板新增「遠端控制」連結（以新分頁開啟），供教師快速在手機上打開。zh-TW/en i18n 鍵值同步新增。變更位於分支 `feature/mobile-remote-controller`，已 merge 回 master。
- [x] 新增 PPTX 匯出功能：安裝 pptxgenjs，新增後端端點 `GET /api/pdfs/:id/export.pptx`，每頁一張投影片圖片搭配 speaker notes（逐字稿），前端在播放頁 header 匯出區提供下載按鈕，並補上後端單元測試涵蓋有/無逐字稿、不存在/無權限場景。
  - 修改說明（2026-06-22）：安裝 `pptxgenjs@4.0.1`；新增 `GET /api/pdfs/:id/slides.pptx` 端點，使用 `createRequire` 載入 CJS 版本（避免 ESM 循環依賴），每頁放入投影片圖片（`image_path`）並在 speaker notes 填入逐字稿（優先 `script_path`，fallback `text_path`）；前端 `PlayPageHeader` 新增「下載 PPTX」按鈕；4 個後端測試全通過。同時修復 `report.ts` merge conflict 遺留的重複 interface 與實作，更新對應測試欄位名稱。分支 `feat/pptx-export`，已 merge 回 master。
- [x] 新增 AI 課程包一鍵下載：新增後端端點 `POST /api/pdfs/:id/course-package`，呼叫 LLM 根據全份逐字稿生成學習單（Markdown）與課後作業，並將講義 PDF、測驗 JSON、學習單 Markdown 打包成 ZIP 回傳；前端在播放頁或匯出區提供下載按鈕，並補上後端單元測試。
  - 修改說明（2026-06-22）：新增 `backend/src/routes/pdfs/course-package.ts`，使用 `callChatJSON` 呼叫 LLM 生成學習單（study_sheet）與課後作業（homework），使用 `jszip` 將講義 PDF（透過 `buildHandoutPdf`）、測驗 JSON、學習單 Markdown 打包成 ZIP；端點限制擁有者或 `public_editable` 協作者；前端 `PlayPageHeader` 新增紫羅蘭色「下載課程包」按鈕（含 loading 狀態）；zh-TW/en i18n 鍵值同步新增；3 個後端測試全通過（200 ZIP、404、403）。分支 `feat/ai-course-package`，已 merge 回 master。

## 工作記錄

| 日期 | 工作內容 | 分支 |
|------|---------|------|
| 2026-06-25 | 修正英文相對時間單複數：`RelativeTimeLabels` 各單位改 `{one,other}`、`formatRelativeTime` 依 count===1 選用；locale 改 11 個 `time.*` key（en 完整單複數，修掉「1 days ago」）；測試補單數斷言；typecheck + 292 前端測試全通過 | fix/relative-time-en-plural（已 merge） |
| 2026-06-25 | 分析並新增可執行項目（第四十一輪）：確認 computeLineDiff 已接 VersionHistoryDialog、backlog 大致消化；找到真實小瑕疵（英文相對時間缺單複數，「1 days ago」），新增該修正項；再次說明高價值工作需使用者方向 | master（僅文件） |
| 2026-06-25 | apiKeyErrors.ts 補單元測試：新增 `apiKeyErrors.test.ts`（5 測試，涵蓋 ApiKeyMissingError 屬性/訊息與 isApiKeyMissingError 的 instance/duck-typing/拒絕分支）；以 tsx 直跑通過、backend typecheck 通過；未改產品碼 | test/api-key-errors（已 merge） |
| 2026-06-25 | 分析並新增可執行項目（第四十輪）：盤點確認前端純 helper 與後端測試覆蓋已大致完整、i18n 對等檢查健全；唯一明確小缺口為 apiKeyErrors.ts 無測試，新增該項；並記錄低風險清理項目近枯竭、後續高價值工作需使用者方向 | master（僅文件） |
| 2026-06-25 | 抽出測驗進度彙總純函式：新增 `lib/quizProgress.ts` 的 `summarizeQuizProgress`（total/submitted/inProgress），QuizBuilderPage 改用之；補 3 個單元測試；typecheck + 291 前端測試全通過 | feat/quiz-progress-summary-helper（已 merge） |
| 2026-06-25 | localStorage 存取防護一致性：reviewList 新增 `hasLocalStorage()` 守衛（get 回[]、mutators no-op）、viewerId 無 window 時回未持久化 id；各補 1 個回退測試（10 lib 測試）；typecheck + 288 前端測試全通過 | fix/localstorage-guard（已 merge） |
| 2026-06-25 | 分析並新增可執行項目（第三十九輪）：TODO 清空、無新使用者項目，依 LOOP.md 聚焦健全性/可測性，新增 2 個低風險項目（viewerId/reviewList localStorage 存取防護一致性、抽出測驗進度彙總純函式 + 測試） | master（僅文件） |
| 2026-06-25 | 動畫文字依解析度等比縮放：`SlideRenderer` 動畫 stage 以 ResizeObserver 量寬度、設 `font-size = 16*(width/960)px`，覆蓋層文字單位 rem/clamp→em 以繼承縮放（text-callout/step-list/pause/realtime/formula），使各解析度下文字相對投影片比例一致；typecheck + 286 前端測試通過 | fix/animation-text-resolution-scaling（已 merge） |
| 2026-06-25 | 全螢幕提問圖示：`PlayPageFullscreen` 在 master 且有學生提問時於左上角顯示 💬 + 提問數徽章（pointer-events-none、含 sr-only 文字）；新增 1 個 i18n key；typecheck + 286 前端測試全通過 | feat/fullscreen-question-indicator（已 merge） |
| 2026-06-25 | 全螢幕投票按鈕：`PlayPageFullscreen` 本頁有進行中投票時右上角加 🗳 按鈕，點擊開可投票 overlay（複用 handleVotePoll/pollVotes，顯示選項得票/比例）；master 票數 overlay 移至按鈕下方且開啟時隱藏；新增 1 個 i18n key；typecheck + 286 前端測試全通過 | feat/fullscreen-poll-button（已 merge） |
| 2026-06-25 | 全螢幕顯示已投票人數：`PlayPageFullscreen` 在 master+本頁有投票時於右上角加 pointer-events-none 投票數 overlay（🗳 N 人已投票，逐題）；沿用既有 liveVotesCount key；typecheck + 286 前端測試全通過 | feat/fullscreen-vote-count（已 merge） |
| 2026-06-25 | master 畫面顯示測驗回答進度：QuizBuilderPage master「測驗中的學員」面板（原已逐位顯示進度條）新增彙總行「已提交 X / 共 Y 人，作答中 Z」；新增 1 個 `quiz.progressSummary` key；typecheck + 286 前端測試全通過 | feat/master-quiz-progress-summary（已 merge） |
| 2026-06-25 | master 畫面顯示已投票人數：`PlayPageSlidePanel` 在 master+本頁有投票時於同步控制區新增「即時投票狀況」面板，列各題「N 人已投票」（poll.total_votes）；解構 pagePolls；新增 2 個 i18n key；typecheck + 286 前端測試全通過 | feat/master-live-vote-count（已 merge） |
| 2026-06-25 | viewerId.ts 補單元測試：新增 `viewerId.test.ts`（stub `window.localStorage` + 動態 import），3 個測試涵蓋產生/持久化/沿用既有值；未改邏輯；typecheck + 286 前端測試全通過 | test/viewer-id-unit（已 merge） |
| 2026-06-25 | reviewList.ts 補單元測試：新增 `reviewList.test.ts`（in-memory localStorage stub + 動態 import），5 個測試涵蓋去重/移除/壞資料 fallback/清空；未改邏輯；typecheck + 283 前端測試全通過 | test/review-list-unit（已 merge） |
| 2026-06-25 | 消除 relativeTimeLabels 重複：`lib/relativeTime.ts` 新增 `buildRelativeTimeLabels(t)` + `RELATIVE_TIME_LABEL_KEYS`，PdfCard/QuizBuilderPage/HomePage 三處各 6 行的 labels 物件改為一行呼叫；補 1 個 helper 測試；typecheck + 278 前端測試 + i18n 對等全通過 | feat/dedup-relative-time-labels（已 merge） |
| 2026-06-25 | 分析並新增可執行項目（第三十八輪）：TODO 清空、前端 i18n 大致完成，依 LOOP.md 轉向品質改善，新增 3 個低風險項目（消除 relativeTimeLabels 三處重複、reviewList.ts 補單元測試、viewerId.ts 補單元測試） | master（僅文件） |
| 2026-06-25 | AI 草稿投票題支援已輸入題目：`generate-poll` 端點新增可選 body `question`——有輸入則只依本頁內容生成選項並保留原題（新 GeneratedOptionsSchema + 專用 prompt），無輸入維持整題生成；前端 `generatePollDraft`/`handleGeneratePollDraft` 傳入目前 pollQuestion；新增 1 個後端測試；backend+frontend typecheck + 277 前端測試通過（後端測試 sandbox timeout，改 typecheck+邏輯核對） | feat/poll-draft-options-for-given-question（已 merge） |
| 2026-06-25 | 複製/匯出文字國際化：QuizBuilderPage 複製題目「解說：」用新增 `quiz.exportExplanationLabel`；PlayPageHeader 逐字稿 markdown 匯出「## 第 N 頁」改用既有 `play.common.pagePrefix/pageSuffix`；新增 1 個 key；typecheck + 277 前端測試 + i18n 對等全通過 | feat/copy-export-text-i18n（已 merge） |
| 2026-06-25 | App.tsx 設定載入畫面國際化：載入畫面「載入設定中…」改用 `t('app.loadingSettings')`（App 新增 useI18n）；新增 1 個 key；grep 確認 App 無中文；typecheck + 277 前端測試 + i18n 對等全通過 | feat/app-loading-i18n（已 merge） |
| 2026-06-25 | PageTimingChips tooltip 文字國際化：`timingTitle()` 改接 labels 參數，元件以 `t('play.timing.tooltip.*')` 傳入（耗時/原因/開始/結束/錯誤/尚無紀錄/冒號）；SLA、run 保留字面；新增 7 個 key；grep 確認無中文；typecheck + 277 前端測試 + i18n 對等全通過 | feat/timing-tooltip-i18n（已 merge） |
| 2026-06-25 | 分析並新增可執行項目（第三十七輪）：TODO 清空後依 LOOP.md 全面掃描可見硬編中文，新增 3 個低風險清理項目（PageTimingChips tooltip i18n、App.tsx 載入設定畫面 i18n、複製/匯出文字 i18n） | master（僅文件） |
| 2026-06-25 | FigureAssetsTab header「（第 N 頁）」國際化：新增 `play.figures.headerPagePrefix/Suffix` 並改用之；2 個 key；grep 確認該檔無可見中文；typecheck + 277 前端測試 + i18n 對等全通過 | feat/figures-header-i18n（已 merge） |
| 2026-06-25 | SystemDataPage 殘留中文國際化：`formatCost`/`formatDuration` 改接 label 參數，呼叫端傳 `t()`；「模型價格未知」與時長「秒」抽成 2 個 `systemData.*` key；grep 確認該檔無中文；typecheck + 277 前端測試 + i18n 對等全通過 | feat/systemdata-i18n（已 merge） |
| 2026-06-25 | HomePage 改用共用 relativeTime helper：移除第三份重複的本地 formatRelativeTime（消硬編中文 + NaN 舊問題），改用 `lib/relativeTime.ts` 並以 `t('time.*')` 傳 labels；三處相對時間格式化全統一；無新增 key；typecheck + 277 前端測試 + i18n 對等全通過 | feat/homepage-relative-time-dedup（已 merge） |
| 2026-06-25 | 分析並新增可執行項目（第三十六輪）：TODO 清空後依 LOOP.md 掃描，新增 3 個低風險清理項目（HomePage 改用共用 relativeTime helper 完成第三份去重、SystemDataPage「模型價格未知」i18n、FigureAssetsTab header「（第 N 頁）」i18n） | master（僅文件） |
| 2026-06-25 | AnimationEditorTab 國際化：掃描後確認 ~50 處中文多為程式碼註解、UI 早已 i18n；真正可見殘留為 header「（第 N 頁）」與 5 個範例提示詞插入內容——改用新增的 `headerPagePrefix/Suffix` 與 `customScriptExamplePrompt.*`（promptKey，en 提供英文版），共 7 個 key；typecheck + 277 前端測試 + i18n 對等全通過 | feat/animation-editor-i18n（已 merge） |
| 2026-06-25 | PlayPage.tsx 錯誤與狀態訊息國際化（第二批）：setAudioError/setSyncError 8 種/loadError 預設/分享不符 ApiError/課後報告載入失敗/文稿不可為空/重生語音失敗、唯讀與產生中橫幅全部改用 t()；新增 18 個 `play.banner.*`/`play.error.*` key；僅保留生成用預設圖片風格 prompt；typecheck + 277 前端測試 + i18n 對等全通過 | feat/playpage-error-messages-i18n（已 merge） |
| 2026-06-25 | 零星小元件殘留中文國際化：PageTimingChips「產生中」、SlidePanel 分頁進度/清除搜尋 aria-label、Sidebar「此頁已有筆記」與書籤/重點頁「第 N 頁」alt/文字/複製清單抽成 i18n；新增 7 個 key（含共用 `play.common.pagePrefix/pageSuffix`）；LLM 提示詞/錯誤字串/markdown 匯出標頭留待後續；typecheck + 277 前端測試 + i18n 對等全通過 | feat/misc-components-i18n（已 merge） |
| 2026-06-25 | 相對時間格式化抽共用 i18n helper：新增 `lib/relativeTime.ts` 純函式（接受 label 字串、修掉無效日期 NaN bug），`PdfCard`/`QuizBuilderPage` 移除重複本地版改用之並以 `t('time.*')` 傳 label；新增 6 個 `time.*` key、2 個單元測試；typecheck + 277 前端測試 + i18n 對等全通過 | feat/shared-relative-time-i18n（已 merge） |
| 2026-06-25 | 分析並新增可執行項目（第三十五輪）：TODO 清空後依 LOOP.md 掃描程式 + 參考 FUTURE_ROADMAP，新增 4 個低風險增量項目（相對時間格式化抽共用 i18n helper 消除 PdfCard/QuizBuilderPage 重複、PlayPage.tsx 錯誤/狀態訊息 i18n 第二批、AnimationEditorTab i18n、零星小元件殘留中文 i18n） | master（僅文件） |
| 2026-06-25 | AI 導師跨頁引用強制化：`ask` 端點系統提示詞新增「【引用規則（務必遵守）】」，回答用到「學生目前所在頁」以外頁面資訊時必須主動以括號標示頁碼（如「（第 3 頁）」），引用原始來源標示「（原始來源）」；page-ask 測試加 2 條斷言；backend typecheck 通過（後端測試 sandbox timeout，改以 typecheck + 提示詞字串核對確認） | feat/ai-tutor-mandatory-cross-page-citation（已 merge） |
| 2026-06-25 | PlayPage.tsx 行動分頁與狀態畫面國際化：行動版「播放／問答」分頁、新投票 aria-label、四個全螢幕狀態畫面（invalid id/載入/無頁面/產生中）、圖片產生中浮層改用 t()；新增 11 個 `play.mobileTab.*`/`play.status.*` key（對等總數 1750）；錯誤訊息字串依項目允許延後；typecheck + i18n 對等 21 全通過 | feat/playpage-mobile-status-i18n（已 merge） |
| 2026-06-25 | RemoteControllerPage 殘留中文國際化：投影片 alt「第 N 頁」與投票「N 票」抽成 3 個 `remote.*` key（slideAltPrefix/Suffix、votesSuffix）；grep 確認無殘留中文；zh-TW/en 各補 3 key；typecheck + i18n 對等全通過 | feat/remote-controller-i18n（已 merge） |
| 2026-06-25 | notebook 分頁鍵盤 Home/End 跳首末分頁：新增純函式 `getEdgeNotebookTab`，`handleTabKeyDown` 支援 Home/End（跳首/末分頁並移動焦點，沿用 roving tabindex）；補 1 單元測試；無新 i18n key；typecheck + 275 前端測試 + i18n 對等全通過 | feat/notebook-home-end-keys（已 merge） |
| 2026-06-25 | notebook「投影片」分頁總頁數 badge：把分頁數量計算抽成純函式 `computeNotebookTabCounts`（slides=總頁數、interact=書籤+重點頁+投票），`PlayPageSidebar` 改用之，投影片分頁現顯示總頁數 badge；補 2 個單元測試；無新 i18n key；typecheck + 274 前端測試 + i18n 對等全通過 | feat/notebook-slides-count-badge（已 merge） |
| 2026-06-25 | 分析並新增可執行項目（第三十四輪）：notebook 大項目完成後 TODO 已清空，依 LOOP.md 掃描程式 + 參考 FUTURE_ROADMAP（2.1–2.10 多已實作）後，新增 4 個低風險增量項目（PlayPage.tsx 行動分頁/狀態畫面 i18n、RemoteControllerPage 殘留中文 i18n、notebook 投影片分頁總頁數 badge、notebook Home/End 鍵盤跳首末分頁） | master（僅文件） |
| 2026-06-25 | Notebook 側邊欄分頁（階段三 → 整項完成）：分頁列 ARIA roving tabindex + ArrowLeft/Right 循環切換（抽純函式 `getAdjacentNotebookTab` + 測試，焦點限定分頁列不與翻頁衝突）；分頁數量 badge（課堂互動顯示 bookmarks+重點頁+投票合計）；行動版面 flex-wrap/flex-1、放大鈕 md 限定。「右邊改成 notebook 界面」三階段全部完成標記 [x]。typecheck + 272 前端測試 + i18n 對等全通過 | feat/notebook-sidebar-phase3（已 merge） |
| 2026-06-25 | Notebook 側邊欄分頁（階段二）：`qaPanelExpanded` 重命名為全域 `sidebarExpanded`；放大改為隱藏左側播放區（`PlayPageSlidePanel` md:hidden）+ 右側欄全寬（aside md:w-full md:flex-1）；放大/還原按鈕移到分頁列尾端（任一分頁可放大）；移除殘留 md:hidden、切換分頁不再重置展開；沿用既有 i18n key；typecheck + 271 前端測試 + i18n 對等全通過。階段三待續 | feat/notebook-sidebar-expand-phase2（已 merge） |
| 2026-06-25 | Notebook 側邊欄分頁（階段一）：新增純函式 `notebookTabs.ts`（NotebookTab 型別、4 分頁定義、normalize/persist helper）＋3 測試；`PlayPageSidebar` 頂端加 4 個分頁標籤（投影片／AI 助手／課堂互動／筆記留言），13 個頂層區塊依分頁條件渲染、一次只顯示一個分頁，localStorage 記住上次分頁，切換時重置 qaPanelExpanded；zh-TW/en 各補 4 key；typecheck + 271 前端測試 + i18n 對等全通過。階段二、三待續 | feat/notebook-sidebar-tabs-phase1（已 merge） |
| 2026-06-25 | 側邊欄 QA 面板拆分逐字稿改寫（notebook 化第一步）：QA 面板移除「修改逐字稿」按鈕與 rewriteError 顯示（不再塞入共用 chatHistory），改由投影片面板的獨立「對話式改寫」對話框處理；QA 面板專注問答+生圖並加用途說明；context 解構移除 handleRewriteScript/rewriteBusy/rewriteError（保留於 hook/context）；zh-TW/en 各補 1 key；typecheck + 268 前端測試 + i18n 對等全通過 | feat/qa-panel-split-rewrite（已 merge） |
| 2026-06-25 | PostClassReportPanel 國際化（第二階段）：把面板內文所有殘留硬編中文全面抽成 i18n key（SummaryCard、各區塊標題/副標/空狀態、個別學生分析、作答時間軸、AI 教學建議、頁尾、列印頁首、熱力圖 tooltip、reset 訊息），插值處以前後綴 key + 樣板字串組合；zh-TW/en 各補 60 個 `play.report.*` key（共 1731 對等）；grep 確認元件無中文、typecheck 通過、i18n 對等 21 個全通過 | feat/report-panel-i18n-phase2（已 merge） |
| 2026-06-25 | 逐字稿改寫對話框顯示原稿並可復原：`ScriptRewriteDialog` 頂端新增唯讀「目前逐字稿」區與「復原上一次改寫」按鈕；新增 `undoStack`（送出前記住原稿）與純函式 `popRewriteUndo`（還原 script + 移除最後一則 assistant 訊息）；清除對話一併清空 undoStack；zh-TW/en 各補 3 個 key。新增 3 個 popRewriteUndo 測試（共 6 helper）、i18n 對等 21 個、typecheck 全通過 | feat/script-rewrite-show-original-undo（已 merge） |
| 2026-06-25 | 釐清「右邊改成 notebook 界面」需求並更新 TODO：經 AskUserQuestion 與使用者確認三項決策（介面＝頂部分頁標籤切換、粒度＝合併成約 4 個主題分頁、放大＝全域放大任一分頁）；將原模糊項目改寫為含 4 分頁歸併建議與三階段執行計畫的可執行規格，並更新對應掃描摘要 | feat/clarify-notebook-todo（僅文件，已 merge） |
| 2026-06-25 | 分析並新增可執行項目：唯一剩餘項目「右邊改成 notebook 界面」範圍大且需求模糊、需使用者釐清，暫不盲做；依 LOOP.md 分析程式後新增 3 個低風險可執行項目（PostClassReportPanel i18n 第二階段、逐字稿改寫對話框顯示原稿+復原、側邊欄 QA 面板拆分逐字稿改寫=notebook 化第一步） | master（僅文件） |
| 2026-06-25 | 修正 AI 動畫紅框錯位：編輯器預覽容器原寫死 16:9 致非 16:9 投影片被 letterbox、方框錯位；改為依圖片實際比例（`imageAspectPaddingPct` + img onLoad）。查證後端圖片以 sharp `fit:'inside'` 保比例傳送無誤。新增單元測試；typecheck/4 測試通過 | fix/animation-focus-box-aspect（已 merge） |
| 2026-06-25 | 逐字稿對話式改寫對話框：新增自包含 `ScriptRewriteDialog`（自有多輪對話 state，不共用 QA chat），透過既有 rewrite-script 端點逐步改寫並套用到編輯器；`PlayPageSlidePanel` 加「對話式改寫」按鈕開啟；抽出 `buildRewriteContext` 純函式 + 3 個單元測試；zh-TW/en 各補 13 個 key；typecheck/測試/i18n 對等全通過 | feat/script-rewrite-dialog（已 merge） |
| 2026-06-25 | AI 導師 ask 加入原始來源全文：`POST /pages/:n/ask` corpus 除逐頁文字+逐字稿外，另附 `source.txt`（上限 12000 字）並更新提示詞，使原文獨有的答案也能回答；新增後端測試（以獨立 inject 腳本驗證通過）；backend typecheck 通過 | feat/ai-tutor-source-text（已 merge） |
| 2026-06-25 | UI 顯示簡報生成提示詞：`user_prompt` 早已記錄於 `pdfs` 表，`PlayPageHeader` 簡介下方新增「顯示生成提示詞」折疊區（非分享檢視限定、含複製按鈕）；zh-TW/en 各補 4 個 key；純前端；typecheck 通過、i18n 對等測試 21 個全通過 | feat/show-generation-prompt（已 merge） |
| 2026-06-25 | 記下動畫生成提示詞：custom-script 生成成功時寫入 `effect.prompt`（隨存檔持久化，後端 `validateAnimationSpec` 早已保留該欄位），`AnimationEditorTab` 開啟對話框時以記錄的 prompt 回填輸入框供迭代；純前端；typecheck 通過、`AnimationEditorTab.test.ts` 3 個測試全通過 | feat/animation-record-prompt（已 merge） |
| 2026-06-25 | AI 導師問這一頁（確認既有功能）：經檢視 `page-operations.ts` ask 端點已送全份簡報每頁 text+script（corpus 上限 14000 字）、接受最多 20 輪 history、回答 token 上限 4000 且移除簡短指示，前端 `usePageAsk`/`PageAskPanel` 為多輪 thread；需求已由 commit `e51302b` 滿足，標記完成（無新增程式碼） | feat/ai-tutor-fulldeck-multiturn（已 merge） |
| 2026-06-25 | 課後報告面板 i18n（第一階段）：`PostClassReportPanel` 引入 `useI18n()`，標題/副標/工具列 7 個按鈕/重置確認文字改用 `t()`；zh-TW/en 各補 12 個 `play.report.*` key；純前端；typecheck 通過、i18n 對等測試 21 個全通過 | feat/report-panel-i18n（已 merge） |
| 2026-06-25 | 課後報告列印頁首：`PostClassReportPanel` 新增 `pdfTitle` prop，面板頂端加入僅列印顯示（`hidden print:block`）的頁首，含簡報標題與列印日期；`PlayPage` 傳入 `detail.title`；純前端，無新 i18n；typecheck 通過、既有測試 4 個全通過 | feat/report-print-header（已 merge） |
| 2026-06-25 | 相似頁面推薦空狀態：similar 端點改回傳 `{ similar, indexed }`，側邊欄「未索引」隱藏、「已索引無相似」顯示提示；補後端測試 1 個；i18n 1 key | feat/similar-pages-empty-state（已 merge） |
| 2026-06-25 | 設定頁語意索引涵蓋率長條：embedding-stats 端點加 `total_pages`（JOIN pages），SettingsPage 加 indexed/total 覆蓋率長條；更新後端測試；i18n 1 key | feat/embedding-coverage-bar（已 merge） |
| 2026-06-25 | 播放頁簡介「複製」按鈕：折疊簡介展開時於描述下方加「複製簡介」按鈕（複用 copyTextToClipboard，2 秒「已複製」toast）；純前端；i18n 2 key | feat/copy-description（已 merge） |
| 2026-06-25 | （已達 100 上限 → 經使用者同意重設計數，於第三十三輪項目區開頭加「---- 計數重設 ----」標記，重新起算） | — |
| 2026-06-25 | TemplatesPage 依使用次數排序：搜尋框旁加「最新／最熱門」切換，最熱門以既有 apply_count 排序（穩定排序保留 recency）；純前端；i18n 2 key。**此項使重設後完成數達 100，觸及 LOOP.md 上限** | feat/templates-sort-popular（已 merge） |
| 2026-06-25 | 自動生成 PDF 描述：新增 generateDescription worker step（前 3 頁逐字稿 → LLM 2–3 句摘要）+ owner 限定 `POST /api/pdfs/:id/generate-description`（持久化）；PlayPageHeader 描述為空時顯示「✨ AI 生成描述」按鈕；補後端測試 4 個（mock LLM）；i18n 2 key | feat/ai-generate-description（已 merge） |
| 2026-06-25 | 播放頁鍵盤快捷鍵說明 overlay：既有按鈕+modal 基礎上補 `?` 全域熱鍵切換顯示（輸入框忽略）並新增 `?` 說明列；i18n 1 key；純前端 | feat/shortcuts-help-hotkey（已 merge） |
| 2026-06-25 | 相似頁面推薦：新增 owner 限定 `GET /api/pdfs/:id/pages/:n/similar`，以既有 page_embeddings + cosineSimilarity 找同 owner 其他頁面 top-5（無新 LLM）；PlayPageSidebar 加「相似頁面」縮圖卡片可跨簡報跳轉；補後端測試 3 個；i18n 3 key | feat/similar-pages（已 merge） |
| 2026-06-25 | 課後報告加入頁面觀看率：經檢視 report/summary 已內建每頁 avg_listened_ratio + completion_rate，PostClassReportPanel 也已顯示完成率熱力圖，需求已由既有程式碼滿足，標記完成（無新增程式碼） | （既有功能） |
| 2026-06-25 | AI 一鍵補全空白逐字稿：QualityCheckPanel 偵測 missing/empty script 頁面時顯示「批次補全」按鈕，依序呼叫既有 rewrite-script API（上限 10 頁、進度 badge、完成後重檢）；i18n 2 key；純前端 | feat/quality-batch-fill-scripts（已 merge） |
| 2026-06-25 | 課後班級報告列印樣式：經檢視 PostClassReportPanel 已內建 @media print 樣式 + window.print() 按鈕 + data-no-print，需求已由既有程式碼滿足，標記完成（無新增程式碼） | （既有功能） |
| 2026-06-25 | 測驗結果分享按鈕：QuizBuilderPage 成績顯示區加入「分享成績」按鈕，使用 `navigator.share`（fallback clipboard 複製 + toast），分享文字含得分/滿分與測驗標題；i18n 2 key；純前端 | feat/quiz-share-score（已 merge） |
| 2026-06-25 | TemplatesPage 模板使用次數顯示：templates 表新增 `apply_count` 欄位（含 migration），新增無驗證 `POST /api/templates/:id/apply` 遞增端點（404 防護），前端套用時 fire-and-forget 呼叫並樂觀更新，卡片顯示「已套用 N 次」徽章；補後端測試 2 個（共 6 通過）；i18n 1 key | feat/template-apply-count（已 merge） |
| 2026-06-25 | 設定頁語意搜尋索引統計：Settings「技能」分頁底部新增「語意搜尋索引」小節，新增登入限定 `GET /api/me/embedding-stats`（JOIN page_embeddings 與 pdfs.owner_sub），顯示「已索引 N 頁（共 M 份簡報）」；補後端測試 2 個；i18n 3 key | feat/embedding-index-stats（已 merge） |
| 2026-06-25 | 播放頁 PDF 描述折疊顯示：PlayPageHeader 標題列下方加入折疊描述區塊，description 非空時顯示「▼ 顯示簡介」切換鈕（純 state toggle，分享訪客亦可見）；補 i18n 2 個 key（`play.header.showDescription`/`hideDescription`，zh-TW/en）；純前端改動 | feat/play-description-collapse（已 merge） |
| 2026-06-25 | 首頁近期搜尋刪除個別記錄：搜尋下拉清單每筆記錄右側加入 × 按鈕，新增 `removeRecentSearch()` helper 只移除單筆並同步 localStorage；補 i18n key `home.search.removeRecent`（zh-TW/en）；純前端改動 | feat/recent-search-remove-item（已 merge） |
| 2026-06-22 | 建立課後學習報告後端摘要 API（`GET /api/pdfs/:id/report/summary`） | feature/post-class-report-summary-api（已 merge） |
| 2026-06-22 | 在播放頁加入課後報告入口與 MVP 畫面（PostClassReportPanel） | feature/post-class-report-mvp（已 merge） |
| 2026-06-22 | 補強 AI 導師「問這一頁」MVP：新增 `POST /api/pdfs/:id/pages/:n/ask`、`is_authenticated` 欄位、`PageAskPanel` 元件 | feature/ai-tutor-ask-page（已 merge） |
| 2026-06-22 | 補上 SRT / VTT 字幕匯出：新增 `GET /api/pdfs/:id/subtitles.srt` 與 `GET /api/pdfs/:id/subtitles.vtt`，前端加入下載按鈕，共 9 個新測試通過 | feat/srt-vtt-subtitle-export |
| 2026-06-22 | 建立生成前成本預估 modal：`PromptModal` 新增費用預估區塊（精簡/均衡/豐富三方案），新增 `costEstimate.ts` 純函式 helper 與 16 個 node:test 單元測試 | feat/global-search-mvp（已 merge） |
| 2026-06-22 | 實作全域教材搜尋 MVP（完整版）：新增 `GET /api/search?q=&limit=` 統一格式後端路由，搜尋標題/逐字稿/頁面文字、權限過濾、最多 100 份 PDF；`GlobalSearchBox` 前端元件含 match_type badge 與 snippet；6 個後端測試全通過 | feat/global-search-mvp-v2（已 merge） |
| 2026-06-22 | 新增生成品質檢查摘要：`GET /api/pdfs/:id/quality-check` 後端 + `QualityCheckPanel` 前端，檢查缺失圖片/音檔/逐字稿、空/短逐字稿、動畫效果超上限 | feat/global-search-mvp-v2（已 merge） |
| 2026-06-22 | 將 skills 擴充為教學模板：`UserSkill` 新增 `imageStylePrompt`/`quizPrompt`/`ttsProvider`/`ttsVoice` 欄位，`PromptModal` 新增「從技能模板套用」UI | feature/skills-as-teaching-templates（已 merge） |
| 2026-06-22 | 新增手機/平板課堂控制器 MVP：`/remote/:id` 新頁面，大頁碼顯示、觸控友善上下頁按鈕、逐字稿、開始/結束同步播放，`PlayPageHeader` 加入「遠端控制」連結 | feature/mobile-remote-controller（已 merge） |
| 2026-06-22 | 品質檢查面板加入一鍵重生：`QualityCheckPanel` 每頁問題旁加入「重生此頁」按鈕，抽出 `getRegenFlags()` helper，8 個 node:test 測試全通過 | feat/quality-check-one-click-regen（已 merge） |
| 2026-06-22 | 測驗答錯後推薦回看頁面：`QuizQuestion` 新增可選 `page_number` 欄位，編輯器加入頁碼輸入框，答案公布後顯示「建議複習」面板附跳頁連結 | feat/quiz-wrong-answer-review（已 merge） |
| 2026-06-22 | 課後報告補上逐題答對率：後端新增 `computeQuestionStats()` 函式，回傳 `question_stats`（選項分佈、答對率）；前端 `QuestionStatCard` 含彩色 badge、進度條、逐選項統計；5 個新測試全通過 | feat/report-question-stats（commit 96e5474） |
| 2026-06-22 | 月費用預算警告：新增 `GET /api/usage/monthly-cost` 端點、`useBudgetWarning` hook，HomePage 與 PlayPage 費用超限時顯示琥珀色警告橫幅；設定頁新增費用上限輸入框 | feat/monthly-budget-warning（已 merge） |
| 2026-06-22 | PPTX 匯出：新增 `GET /api/pdfs/:id/slides.pptx` 端點（pptxgenjs CJS），每頁投影片圖片 + speaker notes（逐字稿）；PlayPageHeader 新增下載按鈕；修復 report.ts merge conflict；4 個新測試通過 | feat/pptx-export（已 merge） |
| 2026-06-22 | AI 課程包一鍵下載：`POST /api/pdfs/:id/course-package`，LLM 生成學習單 + 課後作業，jszip 打包講義 PDF + 測驗 JSON；PlayPageHeader 紫羅蘭色下載按鈕；3 個測試通過 | feat/ai-course-package（已 merge） |

## 掃描摘要（2026-06-22 第二輪）

- 所有第一批 8 個項目已完成，持續參考 `docs/FUTURE_ROADMAP.md` Phase 2–5 方向新增可執行項目。
- `QualityCheckPanel` 已可顯示問題清單但缺少直接觸發重生的快捷入口。
- 播放頁測驗已可作答並記錄，但尚無答錯後推薦回看對應頁面的引導。
- 後端已有逐字稿與時間軸，可進一步匯出 PPTX（圖片 + speaker notes）。
- 課後報告目前只有班級總覽，缺少逐題答對率明細。
- 首頁搜尋結果 snippet 已顯示，但關鍵字未高亮。
- 現有 run history 頁有成本資料，但尚無月費用預算警告機制。

## 新增可執行項目（第二輪）

- [x] 品質檢查面板加入一鍵重生：在 `QualityCheckPanel` 每頁問題項目旁新增「重生此頁」按鈕，依問題類型（缺圖/缺音/缺逐字稿）決定重生旗標（`images`/`audio`/`scripts`），呼叫現有 `POST /api/pdfs/:id/regenerate`（`page_numbers: [n]`），重生進行中顯示 loading 狀態，完成後自動重跑品質檢查。
  - 實作於分支 `feat/quality-check-one-click-regen`（commit 363db0e）
  - 新增 `getRegenFlags()` 純函式（`qualityCheckRegen.ts`），8 個單元測試全通過
  - 新增 i18n 鍵值：`play.quality.regenerate` / `play.quality.regenerating`（zh-TW + en）
- [x] 測驗答錯後推薦回看頁面：測驗提交後，在結果顯示區新增「建議複習」清單，依答錯題目對應的 `page_number` 提供跳頁連結；後端不需改動，純前端利用 quiz question 的 `page` 欄位。
  - 修改說明（2026-06-22）：在 `QuizQuestion` 型別（前端 `types.ts` + 後端 Zod schema）新增可選 `page_number` 欄位；quiz 編輯器每題新增「對應頁碼（選填）」輸入框；答案公布後在測驗作答頁底部顯示「建議複習」面板，列出所有答錯題目並附帶跳頁連結（有 page_number 跳到指定頁，否則連回簡報播放頁）。分支 `feat/quiz-wrong-answer-review`，已 merge 回 master。
- [x] 匯出 PPTX MVP：利用 `pptxgenjs` npm 套件，新增 `GET /api/pdfs/:id/slides.pptx` 端點，每頁放入投影片圖片（`pageImagePath`）並在 speaker notes 填入逐字稿（`pageScriptPath`）；前端在匯出區加入下載按鈕，補測試驗證 HTTP 200 與 content-type。
  - 同「新增 PPTX 匯出功能」，已於 `feat/pptx-export` 分支合併。
- [x] 課後報告補上逐題答對率：擴充 `GET /api/pdfs/:id/report/summary` 回傳中新增 `question_stats` 陣列（含題目文字、選項分佈、答對率），前端在課後報告面板新增「逐題分析」卡片；補測試涵蓋無作答時的空陣列情況。
  - 修改說明（2026-06-22 完整實作）：後端新增 `computeQuestionStats()` 純函式（report.ts），掃描所有 `quiz_sets` 及其 `quiz_attempts`，計算每題的 `total_attempts`、`correct_count`、`accuracy_rate`、`option_counts`、選項文字與正確答案 index；`/api/pdfs/:id/report/summary` 的 `quiz` 物件新增 `question_stats` 陣列。前端新增 `PdfReportQuestionStat` 型別與 `QuestionStatCard` 元件，顯示每題答對率彩色 badge（≥70% 綠、50-69% 黃、<50% 紅）、橫向進度條與逐選項被選次數（正確選項旁顯示 ✓）。後端測試 5 個全部通過（空 set、0 attempt、accuracy_rate、option_counts、多 set）。分支 `feat/report-question-stats`，commit 96e5474。
- [x] 搜尋結果關鍵字高亮：在 `GlobalSearchBox` 元件的 snippet 顯示中，將關鍵字以 `<mark>` 標籤（或 Tailwind `bg-yellow-300/30` span）高亮標記；純前端改動，不需後端修改。
  - 修改說明（2026-06-22）：在 `GlobalSearchBox` 元件新增 `highlightText(text, query)` 純函式，將 snippet 拆分成符合/不符合的區段，符合部分用 `<mark className="bg-yellow-400/25 text-yellow-200">` 高亮標記；不分大小寫匹配、多處關鍵字同步高亮。純前端改動，無需後端修改。分支 `feat/search-keyword-highlight`，已 merge 回 master。
- [x] 月費用預算警告：在系統設定新增「每月 LLM/TTS 費用上限（USD）」欄位，後端記錄到 settings；每次生成完成後檢查當月累計費用是否超過上限，若超過則在播放頁頂部顯示警告橫幅，並在首頁卡片上標示費用超限符號。
  - 修改說明（2026-06-22）：後端 `aiSettings.ts` 新增 `monthlyBudgetUsd` 設定欄位（對應 env `MONTHLY_BUDGET_USD`）；新增 `GET /api/usage/monthly-cost` 端點，查詢當月已結束 pipeline runs 對應的 LLM 費用並彙總；前端 `SettingsPage` 新增費用上限輸入框；新增 `useBudgetWarning` hook，同時呼叫設定與費用 API，費用 ≥ 上限時回傳警告物件；`HomePage` 與 `PlayPage` 頂部在費用超限時顯示琥珀色警告橫幅。分支 `feat/monthly-budget-warning`，已 merge 回 master。

## 掃描摘要（2026-06-22 第三輪）

- 所有第一、二批共 17 個項目已完成，含 PPTX 匯出、AI 課程包、逐題答對率、搜尋高亮、預算警告等。
- `quiz_attempts` 表已有 `client_id`、`score`、`answers_json`，可直接匯出為 CSV 供教師分析。
- 播放頁目前無播放進度條（橫向視覺進度），若加入可提升學生自學體驗。
- 課後報告目前缺乏「個別學生」維度，可補充每位學生的作答記錄下載。

## 新增可執行項目（第三輪）

- [x] 測驗作答結果 CSV 匯出：新增 `GET /api/pdfs/:id/quiz-results.csv` 端點，將所有測驗作答記錄（student_id/client_id、score、submitted_at、每題選答索引）匯出為 CSV；限制擁有者存取；前端課後報告面板加入「匯出 CSV」按鈕；補後端測試驗證 200 / content-type / 404 / 403。
  - 修改說明（2026-06-22）：新增 `backend/src/routes/pdfs/quiz-results-csv.ts`，JOIN `quiz_attempts` 與 `quiz_sets` 取出測驗標題，輸出 8 欄 CSV（attempt_id、quiz_id、quiz_title、client_id、code、score、submitted_at、answers_json），欄位含逗號/引號自動加 quote；`PostClassReportPanel` 新增 `pdfId` prop 與綠色「匯出 CSV」按鈕（`<a download>`），`PlayPage.tsx` 補上傳值；4 個後端測試全通過（200 CSV 含資料列、空資料僅 header、404、403）。分支 `feat/quiz-csv-export`，已 merge 回 master。
- [x] 播放頁投影片縮圖預覽列：在播放頁 sidebar 加入縮圖列，顯示所有頁投影片縮圖（複用現有 `image_path`），點擊可跳頁，目前頁面以高亮框標示，支援鍵盤 ↑↓ 切換；純前端改動，不需後端新增端點。
  - 確認說明（2026-06-22）：此功能已於 `PlayPageSidebar.tsx` 的「🧩 投影片管理」區塊中實作，含 4 欄縮圖 grid、lazy loading、點擊跳頁、拖曳重排、目前頁藍框高亮、觀看進度 badge；屬既有功能，無需額外開發。
- [x] 課後報告個別學生分析下拉：在課後報告面板新增「依學生篩選」下拉選單，列出所有有作答的 client_id，選擇後顯示該學生的答題明細（各題正確/錯誤、分數）；純前端消費現有 `question_stats`，或在後端新增 `GET /api/pdfs/:id/report/student/:clientId` 回傳個別學生資料。
  - 修改說明（2026-06-22）：新增 `GET /api/pdfs/:id/report/students` 端點，回傳所有學生的 quiz_attempts 明細（含 question_results，含每題 is_correct、selected、correct_indices、options）；`PostClassReportPanel` 新增「個別學生分析」section，含學生下拉選單、作答詳情與每題選項高亮（綠色=答對選項、紅色=答錯選項）；5 個後端測試全通過（200 含 2 學生、is_correct 驗證、空資料、404、403）。分支 `feat/student-report-drilldown`，已 merge 回 master。
| 2026-06-22 | 測驗作答結果 CSV 匯出：`GET /api/pdfs/:id/quiz-results.csv`，JOIN quiz_sets 取標題，8 欄 CSV；`PostClassReportPanel` 新增綠色「匯出 CSV」按鈕；4 個測試通過 | feat/quiz-csv-export（已 merge） |
| 2026-06-22 | 課後報告個別學生分析下拉：`GET /api/pdfs/:id/report/students` 回傳每位學生的測驗明細與每題 is_correct；`PostClassReportPanel` 新增學生下拉與答題詳情；5 個測試通過 | feat/student-report-drilldown（已 merge） |

---

---- 計數重設 ----

<!-- 以下為第四輪計數起點（2026-06-22），前 20 項已全數完成 -->

## 掃描摘要（2026-06-22 第四輪）

- 前三輪完成了課後報告、AI 導師、成本預估、搜尋、品質檢查、字幕匯出、PPTX、課程包、預算警告、CSV 匯出、個別學生分析等功能。
- 播放頁目前缺乏視覺上的「目前位於第幾頁/共幾頁」進度指示（除了文字顯示外）。
- 沒有提供全份逐字稿的純文字批次下載，教師複習或備課需手動複製。
- 測驗系統未支援作答時限，無法控制課堂上的作答節奏。
- 課後報告面板未提供列印/存為 PDF 的友善樣式。
- 播放頁的音訊語速設定在頁面刷新後會重置，未持久化至 localStorage。
- 首頁排序尚未提供「依音頻時長」選項，無法快速找到長/短課程。
- 頁面投票目前需手動輸入題目，可利用既有頁面逐字稿讓 AI 自動草稿一道投票題。
- 分享連結目前永久有效，缺乏有效期設定選項。

## 新增可執行項目（第四輪）

- [x] 播放頁底部分頁進度條：在投影片顯示區底部加入一條細色進度條，以 `currentPage / totalPages` 比例填色；純前端改動，利用既有 `currentIdx`/`totalPages` 數值，不需後端修改。（確認既有功能）
- [x] 全份逐字稿批次匯出 TXT：新增 `GET /api/pdfs/:id/scripts.txt` 後端端點，依頁碼順序串接所有頁面的 `script_path` 或 `text_path` 內容，回傳純文字檔案；前端在播放頁 header 匯出區新增「下載逐字稿 TXT」按鈕；補後端測試驗證 200 / content-type / 404 / 403。（確認既有功能）
- [x] 測驗作答時限（Countdown Timer）：在 `quiz_sets` 資料表新增可選欄位 `time_limit_seconds INTEGER`；測驗建立/編輯頁加入「作答時限（秒）」輸入框；播放頁學生作答時若有時限，顯示倒數計時器，時間到自動提交；後端 API 傳遞時限欄位。（確認既有功能）
- [x] 課後報告列印樣式：在 `PostClassReportPanel` 加入「列印 / 儲存為 PDF」按鈕，呼叫 `window.print()`；為面板加入 `@media print` CSS（隱藏側邊欄、全寬、黑白友善色調）；純前端改動，無需後端修改。
  - 修改說明（2026-06-22）：在 header 的按鈕列加入琥珀色「列印 / 儲存 PDF」按鈕（`window.print()`）；以 `data-no-print="true"` 包裹所有操作按鈕使其列印時隱藏；在 JSX 中插入 `<style>` 含 `@media print` 規則：覆蓋 `fixed` 定位為 `static`、強制白底、調整文字顏色為可讀深色、各 `section` 加 `break-inside: avoid`；外層 div 改 id `pcr-print-root` 作為 scope。分支 `feat/report-print-style`，已 merge 回 master。
- [x] 播放頁語速偏好持久化：將 `ttsSpeed`（播放語速）儲存至 `localStorage`（key：`makeslide.ttsSpeed`），下次開啟播放頁時自動套用已記憶的語速；在 `usePdfMetadata` hook 中新增讀取/寫入邏輯；純前端改動。
  - 修改說明（2026-06-22）：`i18n.ts` 新增 `TTS_SPEED_STORAGE_KEY`、`getStoredTtsSpeed()`（讀取，範圍 0.5–2）與 `setStoredTtsSpeed()`（寫入）；`usePdfMetadata.ts` 的 `ttsSpeed` 初始化改為 `useState(() => getStoredTtsSpeed())`，`handleSaveTtsSettings` 成功後呼叫 `setStoredTtsSpeed(ttsSpeed)` 將偏好寫入 localStorage；`PlayPage.tsx` 的 `setTtsSpeed(d.tts_speed ?? 1)` 改為 `setTtsSpeed(d.tts_speed ?? getStoredTtsSpeed())`，使新 PDF 繼承上次儲存的語速偏好。分支 `feat/tts-speed-persist`，已 merge 回 master。
- [x] 首頁依音頻時長排序：在首頁排序下拉選單新增「最長課程優先」與「最短課程優先」兩個選項，以 `pdf.audio_duration_seconds`（現有欄位）排序；若音頻時長為 null 則排到最後；純前端改動，補對應 `en`/`zh-TW` i18n 鍵值。
  - 修改說明（2026-06-22）：新增 `compareByAudioDurationDesc`/`compareByAudioDurationAsc` comparator，null 在 desc 排到最後（視為 -1）、在 asc 排到最後（視為 Infinity）；`SortMode` 新增 `audio_desc`/`audio_asc`；`SORT_MODES` 陣列與 `getComparatorForSortMode` switch-case 同步更新；`<select>` 新增兩個 `<option>`；zh-TW/en i18n 新增 `home.sort.audioDurationDesc`/`audioDurationAsc`。分支 `feat/home-audio-duration-sort`，已 merge 回 master。
- [x] AI 自動草稿頁面投票題目：新增 `POST /api/pdfs/:id/pages/:n/generate-poll` 後端端點，讀取頁面逐字稿/文字，呼叫 LLM 生成一道 2–4 選項的投票題目（JSON 格式：`{ question, options }`），回傳給前端；播放頁 sidebar 投票分頁加入「AI 草稿投票題」按鈕，讓教師確認後一鍵建立投票；補後端測試驗證 200 / 404 / 403。（確認既有功能）
- [x] 分享連結有效期設定：在 `ShareDialog` 加入「連結有效期」下拉（永久 / 7 天 / 30 天 / 自訂日期）；後端 `pdfs` 表新增可選欄位 `share_expires_at TEXT`；`GET /api/pdfs/:id` 讀取分享時檢查有效期，過期則回傳 `410 Gone`；`PATCH /api/pdfs/:id` 支援更新 `share_expires_at`；補測試驗證 410 回應。
  - 修改說明（2026-06-23）：`db.ts` migration 新增 `pdf_shares.expires_at TEXT`；`POST /api/pdfs/:id/share` body schema 新增 `expires_days`（1–3650 天），計算並儲存 `expires_at`，回傳欄位包含 `expires_at`；對已有分享連結再次呼叫時若帶 `expires_days` 則同步更新到期日；`shareAccessForPdf()` 检查到期時間回傳 null；新增 `isShareTokenExpired()` helper；`GET /api/pdfs/:id` 若 token 存在但已到期回傳 410 Gone；`ShareDialog.tsx` 新增有效期下拉選單（永久/7/30/90 天）與到期日顯示；`usePdfMetadata`/`PlayPageContext`/`PlayPageDialogs` 補上 `shareExpiresDays`/`setShareExpiresDays`/`shareExpiresAt` state；zh-TW/en i18n 新增 6 個 `play.shareDialog.expiry*` 鍵值；3 個後端測試通過（stores expires_at、410 expired、200 valid）。分支 `feat/share-link-expiry`，已 merge 回 master。

---- 計數重設 ----

## 掃描摘要（2026-06-22 第四輪）

- 所有前三輪 20 個項目已完成；本輪計數從零重新開始。
- 課後報告已有班級摘要與逐學生答題明細，但缺少 AI 自動分析與建議（FUTURE_ROADMAP 2.1 明確提及）。
- 測驗目前無作答時間限制，無法在限時考試場景使用。
- 首頁 PDF 列表無標籤/分類機制，大量教材難以管理。
- 同步場次沒有出席名單功能，教師無法一目了然確認學生是否到課。
- 課後報告的觀看完成率低頁面已顯示，但缺少「AI 解釋為何這頁最難」的輔助。

## 新增可執行項目（第四輪）

- [x] 課後報告 AI 教學建議：在課後報告面板新增「生成 AI 建議」按鈕，後端新增 `POST /api/pdfs/:id/report/ai-suggestions` 端點，彙整測驗答對率（各題 correct_rate）與每頁觀看完成率，呼叫 LLM 生成 Markdown 格式教學建議（哪些概念需補強、下一堂課重點、答錯最多的題目解析）；前端在面板底部以可展開區塊顯示建議，補後端測試涵蓋 200 / 403 / 404 / LLM mock。
  - 修改說明（2026-06-22）：新增 `backend/src/routes/pdfs/report-ai-suggestions.ts`，讀取本 PDF 的 quiz_sets/quiz_attempts 計算每題答對率，讀取 page_watch_progress 取得每頁完成率，以 `callChatJSON` 呼叫 LLM 輸出 Markdown 建議（zod schema 驗證 `suggestions` 字串）；`PostClassReportPanel` 新增「生成 AI 建議」紫羅蘭色按鈕（支援 loading 與重新生成）與建議展示區塊；3 個測試通過（200 LLM mock、404、403）。分支 `feat/report-ai-suggestions`，已 merge 回 master。
- [x] 播放頁底部分頁進度條：在投影片顯示區底部加入一條細色進度條，以 `currentPage / totalPages` 比例填色；純前端改動。
  - 修改說明（2026-06-22）：在 `PlayPageSlidePanel.tsx` 的投影片區塊（`<section>`）與操作控制列之間插入 `h-1` 高度的 emerald 進度條，`aria-role="progressbar"` 並帶 `aria-valuenow/min/max` 屬性；`totalPages <= 1` 時不渲染；過渡動畫 `transition-all duration-300`。純前端改動，直接 commit 到 master（`b198d46`）。
- [x] 測驗限時模式：`quiz_sets` 資料表新增 `time_limit_seconds INTEGER DEFAULT 0` 欄位，測驗編輯頁新增「作答時限」輸入框（0 代表無限制），測驗進行中若有時限則顯示紅色倒數計時器，時間到自動提交目前作答；補後端 schema 測試與前端倒數邏輯單元測試。
  - 修改說明（2026-06-22）：後端 `db.ts` 以 `columnExists()` migration 新增 `time_limit_seconds` 欄位；`quizzes.ts` API 新增 Zod 驗證（0–3600s，default 0）、SELECT/INSERT/UPDATE 全部包含新欄位；前端 `types.ts`、`pdfs.ts` API、`QuizBuilderPage.tsx` 編輯器表單（輸入框 + i18n）、倒數計時 `useEffect`（`setInterval` 每秒遞減，0 時停止）、作答視圖中顯示 MM:SS 倒數（最後 10 秒變紅）全部完成；i18n 鍵值 `quiz.timeLimitLabel/None/Unit/countdownPrefix/countdownSuffix` 新增至 zh-TW 及 en。分支 `feat/quiz-time-limit-v2`，已 merge 回 master。
- [x] 簡報標籤與首頁篩選：`pdfs` 資料表新增 `tags TEXT DEFAULT ''` 欄位（以逗號分隔），播放頁新增標籤編輯 UI（簡單 tag chip 輸入），首頁 PDF 卡片顯示標籤，並新增標籤篩選列讓使用者快速篩選教材；後端新增 `PATCH /api/pdfs/:id/tags` 端點，補測試驗證 200 / 權限。
  - 修改說明（2026-06-22）：`db.ts` migration 新增 `pdfs.tags TEXT NOT NULL DEFAULT ''`；`backend/src/types.ts` / `frontend/src/types.ts` 新增 `tags` 欄位；`detail.ts` 的 GET /api/pdfs 與 GET /api/pdfs/:id SELECT 補 `tags`；`PATCH /api/pdfs/:id/tags` 端點已存在 detail.ts；`PdfCard` 新增 `onTagsEdit` prop 與內嵌標籤編輯 UI（鉛筆按鈕展開輸入框，儲存/取消）；`HomePage` 從 `allTags` 算出所有標籤並以可點擊 chip 列提供篩選，`handleTagsEdit` 呼叫 `updatePdfTags` API；i18n 新增 `card.editTags/tagsPlaceholder/saveTags/cancelEditTags`；4 個後端測試（200/404/403/list）通過。直接 commit 至 master（359d1a4）。
- [x] 同步場次出席名單：同步播放進行時，後端記錄 follower join/leave 事件（利用既有 `sync_sessions` 或新增 `sync_attendees` 表），並提供 `GET /api/pdfs/:id/sync/attendees` 端點；教師端同步面板顯示目前線上學生列表（client_id + 加入時間），課後可在課後報告頁回顧出席記錄。
  - 修改說明（2026-06-22）：`db.ts` 新增 `sync_attendees` 表（id/pdf_id/client_id/user_code/joined_at）及索引；`sync.ts` 的 `/sync/join` 與 `/sync/share-join` 在首次 join 時寫入出席記錄；新增 `GET /api/pdfs/:id/sync/attendees` 端點（owner-only，回傳依時間排序的名單）；`PlayPageSlidePanel.tsx` 加入可折疊出席名單面板（master 角色才顯示，展開時 fetch），顯示 user_code 或 client_id 前 12 碼 + 加入時間；`fetchSyncAttendees` API 函式新增至 `pdfs.ts`；i18n 新增 `play.slidePanel.attendeesTitle/attendeesEmpty`；4 個後端測試通過（200/404/403/list）。master 直接 commit（4d8dd61）。
- [x] 首頁依音頻時長排序：在首頁排序下拉選單新增「最長課程優先」與「最短課程優先」兩個選項，以 `pdf.total_audio_duration_seconds`（現有欄位）排序；若音頻時長為 null 則排到最後；純前端改動，補對應 `en`/`zh-TW` i18n 鍵值。
  - 修改說明（2026-06-22）：新增 `compareByAudioDurationDesc`/`compareByAudioDurationAsc` comparator（null 在 desc=-1、asc=Infinity）；`SortMode` 新增 `audio_desc`/`audio_asc`，select 新增對應 option；i18n 鍵值 `home.sort.audioDurationDesc`/`audioDurationAsc`。分支 `feat/home-audio-duration-sort`，已 merge 回 master。

## 掃描摘要（2026-06-22 第四輪繼續）

- 第四輪目前已完成 6/20 項目（含音頻時長排序）。
- 舊批尚有「全份逐字稿批次匯出 TXT」、「AI 自動草稿頁面投票題目」、「分享連結有效期設定」三個 `[ ]` 項目。
- 課後報告面板已能顯示學生分析，但缺乏「發送通知給學生」的後續行動功能。
- 播放頁目前無鍵盤快捷鍵說明對話框（Help Modal），教師與學生不易發現快捷鍵。
- 首頁無法將簡報加入「我的最愛」快速存取，需靠分類管理。
- 全份播放結束後沒有「自動跳回第一頁」或「重播」選項。
- Follower 模式下尚無「舉手」功能，學生只能用提問框發問。
- 設定頁尚缺「清除所有生成快取」功能，讓管理員可手動清除暫存圖片/音訊。

## 新增可執行項目（第四輪繼續）

- [x] 全份逐字稿批次匯出 TXT：新增 `GET /api/pdfs/:id/scripts.txt` 後端端點，依頁碼順序串接所有頁面的 `script_path` 或 `text_path` 內容，回傳純文字檔案；前端在播放頁 header 匯出區新增「下載逐字稿 TXT」按鈕；補後端測試驗證 200 / content-type / 404 / 403。
  - 確認說明（2026-06-22）：`backend/src/routes/pdfs/scripts-txt.ts` 已完整實作，已在 `index.ts` 註冊；`PlayPageHeader.tsx` 已有「下載逐字稿 TXT」下載連結；`backend/test/scripts-txt.test.ts` 已涵蓋 4 個測試。屬既有功能確認。
- [x] AI 自動草稿頁面投票題目：新增 `POST /api/pdfs/:id/pages/:n/generate-poll` 後端端點，讀取頁面逐字稿/文字，呼叫 LLM 生成一道 2–4 選項的投票題目（JSON 格式：`{ question, options }`），回傳給前端；播放頁 sidebar 投票分頁加入「AI 草稿投票題」按鈕，讓教師確認後一鍵建立投票；補後端測試驗證 200 / 404 / 403。
  - 修改說明（2026-06-22）：新增 `generate-poll.ts` 後端路由（LLM 生成草稿不插入 DB）；`PlayPageSidebar` 投票設定區新增紫羅蘭色「AI 草稿投票題」按鈕；`usePagePolls` 新增 `aiPollBusy`/`handleGeneratePollDraft`；4 個後端測試通過。commit 99ebd68。
- [x] 分享連結有效期設定：在 `ShareDialog` 加入「連結有效期」下拉（永久 / 7 天 / 30 天 / 自訂日期）；後端 `pdfs` 表新增可選欄位 `share_expires_at TEXT`；`GET /api/pdfs/:id` 讀取分享時檢查有效期，過期則回傳 `410 Gone`；`PATCH /api/pdfs/:id` 支援更新 `share_expires_at`；補測試驗證 410 回應。
  - 修改說明（2026-06-23）：後端 `pdf_shares` 表已有 `expires_at TEXT` 欄位、`detail.ts` 的分享建立 schema 已有 `expires_days` 欄位（min:1 max:3650）、410 Gone 邏輯已完整；前端 `usePdfMetadata.ts` / `PlayPageContext.tsx` 已有 `shareExpiresDays`/`setShareExpiresDays` 狀態，`createPdfShare` API 已接受 `expiresDays`；本次僅需在 `PlayPageHeader.tsx` 的分享面板 select 旁加入有效期 `<select>`（永久/7天/30天/90天），並將 `shareExpiresDays`/`setShareExpiresDays` 加入解構；i18n `play.share.expiryLabel/Forever/7days/30days/90days` 新增至 zh-TW/en。分支 `feature/share-link-expiry-ui`，已 merge 回 master。
- [x] 播放頁鍵盤快捷鍵說明對話框：在播放頁 header 加入「快捷鍵」按鈕（`?` 圖示），開啟說明對話框，列出目前所有可用快捷鍵（← → 換頁、Space 播放/暫停、F 全螢幕、A 插入暫停效果等）；純前端改動，補 i18n。
  - 修改說明（2026-06-22）：新增 `ShortcutsButton` 子元件（`PlayPageHeader.tsx`），含 `useState` 控制開關；`?` 按鈕開啟覆蓋層對話框，列出 7 個快捷鍵（←/→/Space×2/W/P/A/Esc）以 table 呈現；i18n `play.shortcuts.*` 鍵值新增至 zh-TW/en；純前端。分支 `feat/keyboard-shortcuts-modal`，已 merge 回 master。
- [x] 首頁簡報「我的最愛」功能：在 `PdfCard` 加入星號按鈕，收藏狀態存至 `localStorage`（key: `makeslide.favorites`）；首頁篩選列新增「我的最愛」分類按鈕；純前端改動，不需後端修改。
  - 修改說明（2026-06-23）：`PdfCardProps` 新增可選 `isFavorited`/`onToggleFavorite`；card 圖片右下角加入 ★/☆ 絕對定位按鈕（琥珀色高亮）；`HomePage` 新增 `favorites`（Set）與 `favoritesOnly` state，`handleToggleFavorite` 讀寫 localStorage，filter chain 新增 `favFilteredItems` 步驟；tag filter 列上方加入「☆ 我的最愛」chip；i18n 鍵值 `card.favorite`/`card.unfavorite`/`home.filter.favoritesOnly`。分支 `feat/homepage-favorites`，已 merge 回 master。
- [x] 播放完成後顯示重播提示：播放最後一頁音訊結束後，在投影片顯示區覆蓋「播放完成」面板，提供「重播」（跳回第一頁）與「繼續手動瀏覽」兩個按鈕；純前端改動，補 i18n。
  - 修改說明（2026-06-23）：`PlayPageSlidePanel.tsx` 的 `{finished && (...)}` 區塊改為 IIFE 渲染，新增「重播」（`setCurrentIdx(0)`+`setIsPlaying(true)`+`setFinished(false)`）與「繼續手動瀏覽」（`setFinished(false)`）按鈕；解構補 `setCurrentIdx`/`setIsPlaying`/`setFinished`；i18n `play.slidePanel.replay`/`continueManual` 新增。分支 `feat/playback-completion-overlay`，已 merge 回 master。
- [x] Follower 舉手功能：在 follower 播放頁加入「舉手」按鈕，呼叫現有 `POST /api/pdfs/:id/sync/question`（body: `{ question: '🖐' }`）送出舉手信號；master 端 Q&A 面板顯示舉手 icon 而非文字；純前端改動，不改後端 schema。
  - 修改說明（2026-06-22）：`PlayPage.tsx` 新增 `handleRaiseHand` callback，直接呼叫 `submitSyncFollowerQuestion(pdfId, clientId, '🖐', userCode)`；`PlayPageContext.tsx` 介面新增 `handleRaiseHand: () => void`；`PlayPageHeader.tsx` follower 區塊加入琥珀色「🖐 舉手」按鈕（不需輸入框，一鍵送出），master 端問題列表中 `q.question === '🖐'` 時改以琥珀色 border 呈現並顯示本地化「舉手」文字；zh-TW/en i18n 新增 `play.sync.raiseHand`/`raiseHandTitle`。純前端改動。分支 `feat/follower-raise-hand`，已 merge 回 master。
- [x] 設定頁「清除所有生成快取」功能：新增 `DELETE /api/admin/cache` 後端端點，清除 `data/pdfs/*/` 下所有 `artifact_cache/` 子目錄（保留 images/audio/script 等成品），限 admin；設定頁新增按鈕並顯示釋放空間統計；補後端測試驗證 200 / 403。
  - 修改說明（2026-06-23）：`backend/src/services/storage.ts` 新增 `artifactCacheDir()` helper；`backend/src/routes/pdfs/admin.ts` 新增 `DELETE /api/admin/cache` 端點，掃描 storageRoot 下各 PDF 的 `artifact_cache/` 子目錄，移除並累計釋放空間，回傳 `{ ok, dirs_cleared, bytes_freed }`；`SettingsPage.tsx` 在縮圖快取按鈕下方新增「清除生成快取」琥珀色按鈕（含 loading 狀態與完成訊息）；zh-TW/en i18n 各新增 5 個 `settings.clearArtifactCache*` 鍵值；2 個後端測試通過（200 / 403）。分支 `feat/admin-cache-clear`，已 merge 回 master。

| 2026-06-22 | 課後報告 AI 教學建議：`POST /api/pdfs/:id/report/ai-suggestions`，彙整答對率+觀看完成率交給 LLM 生成 Markdown 建議；`PostClassReportPanel` 紫羅蘭色「生成 AI 建議」按鈕；3 個測試通過 | feat/report-ai-suggestions（已 merge） |
| 2026-06-22 | 播放頁底部分頁進度條：`PlayPageSlidePanel` 投影片與控制列之間插入 emerald `h-1` 進度條，依 `currentIdx/totalPages` 填色，附 ARIA 屬性；純前端 | master（直接 commit b198d46） |
| 2026-06-22 | 測驗限時模式：`quiz_sets.time_limit_seconds` 欄位（migration）、後端 Zod 驗證、前端編輯器輸入框、倒數計時器 useEffect（10 秒內變紅）、i18n 鍵值 | feat/quiz-time-limit-v2（已 merge） |
| 2026-06-22 | 簡報標籤與首頁篩選：`pdfs.tags` 欄位 migration、PATCH 端點、PdfCard 內嵌編輯 UI（鉛筆按鈕 + 輸入框）、首頁 chip 篩選列；4 個後端測試通過 | master（直接 commit 359d1a4） |
| 2026-06-22 | 課後報告列印樣式：`PostClassReportPanel` 新增琥珀色「列印 / 儲存 PDF」按鈕（`window.print()`）、`data-no-print` 隱藏操作按鈕、`@media print` 白底/黑字/固定定位轉靜態 CSS | feat/report-print-style（已 merge） |
| 2026-06-22 | 同步場次出席名單：`sync_attendees` 表、`/sync/join` 寫入、GET 端點（owner-only）、教師同步面板可折疊名單 UI；4 個後端測試通過 | master（直接 commit 4d8dd61） |
| 2026-06-22 | 播放頁語速偏好持久化：`i18n.ts` 新增 `getStoredTtsSpeed`/`setStoredTtsSpeed`（key: `makeslide.ttsSpeed`）；`usePdfMetadata` 初始化從 localStorage 讀取，儲存設定時寫回；`PlayPage` fallback 改用 localStorage 值 | feat/tts-speed-persist（已 merge） |
| 2026-06-22 | 首頁依音頻時長排序：新增 `audio_desc`/`audio_asc` SortMode，comparator null 容錯；首頁 select 新增兩個 option；i18n 鍵值 `home.sort.audioDurationDesc/audioDurationAsc` | feat/home-audio-duration-sort（已 merge） |
| 2026-06-22 | 全份逐字稿批次匯出 TXT：`GET /api/pdfs/:id/scripts.txt`，依頁碼串接逐字稿/text，附 Content-Disposition；PlayPageHeader 下載連結；4 個測試通過 | master（既有功能確認） |
| 2026-06-22 | AI 自動草稿頁面投票題目：`POST /api/pdfs/:id/pages/:n/generate-poll`（LLM 生成草稿，不插入 DB）；PlayPageSidebar 紫羅蘭色「AI 草稿投票題」按鈕；4 個後端測試通過 | master（commit 99ebd68） |
| 2026-06-22 | Follower 舉手功能：follower header 加入琥珀色「🖐 舉手」按鈕，呼叫 `POST /api/pdfs/:id/sync/questions`（body: `{ question: '🖐' }`）；master 問題列表對 🖐 以琥珀色高亮顯示；i18n `play.sync.raiseHand/raiseHandTitle` | feat/follower-raise-hand（已 merge） |
| 2026-06-22 | 播放頁鍵盤快捷鍵說明對話框：`ShortcutsButton` 子元件（含 useState），`?` 按鈕開啟覆蓋層，table 列出 7 個快捷鍵（←/→/Space×2/W/P/A/Esc）；i18n `play.shortcuts.*` | feat/keyboard-shortcuts-modal（已 merge） |
| 2026-06-23 | 首頁簡報「我的最愛」：`PdfCard` 圖片右下角 ★/☆ 按鈕（琥珀色高亮）；`HomePage` favorites Set + localStorage；tag filter 上方加「我的最愛」chip；i18n `card.favorite/unfavorite`/`home.filter.favoritesOnly` | feat/homepage-favorites（已 merge） |
| 2026-06-23 | 播放完成後顯示重播提示：`finished` 覆蓋層加入「重播」（setCurrentIdx(0)+setIsPlaying+setFinished=false）與「繼續手動瀏覽」按鈕；i18n `play.slidePanel.replay`/`continueManual` | feat/playback-completion-overlay（已 merge） |
| 2026-06-23 | 設定頁「清除所有生成快取」功能：`DELETE /api/admin/cache`（掃描 artifact_cache/ 子目錄、回傳 dirs_cleared/bytes_freed）；`artifactCacheDir()` helper；SettingsPage 琥珀色按鈕；2 個測試通過 | feat/admin-cache-clear（已 merge） |
| 2026-06-23 | 分享連結有效期設定前端 UI：PlayPageHeader 分享面板新增有效期 `<select>`（永久/7天/30天/90天），連接既有 `shareExpiresDays`/`setShareExpiresDays` 狀態；i18n `play.share.expiryLabel/Forever/7days/30days/90days` | feature/share-link-expiry-ui（已 merge） |

## 掃描摘要（2026-06-23 第五輪）

- 第四輪計數目前已完成 14/20 項目（含分享連結有效期設定）。
- 首頁缺少關鍵字搜尋欄，使用者只能靠分類/標籤篩選，教材多時難以快速找到目標。
- 課後報告目前只能在頁面上查看，缺少匯出 CSV 供外部分析的功能。
- 播放頁 sidebar 投票結果只顯示票數文字，缺乏視覺化長條圖。
- `PdfCard` hover 時未顯示頁數、音頻時長等摘要資訊，使用者需進入播放頁才能得知。
- 播放頁單頁逐字稿目前無法一鍵複製，需手動選取文字。
- 首頁搜尋不支援對簡報標籤搜尋，搜尋功能不完整。

## 新增可執行項目（第五輪）

- [x] 首頁關鍵字搜尋欄：在首頁標題/類別篩選列上方新增搜尋輸入框，以 `includes`（case-insensitive）同時比對 `pdf.title`、`pdf.tags`；搜尋結果即時更新，輸入框右側顯示清除（×）按鈕；純前端改動，補 i18n `home.search.placeholder`/`home.search.clear`。
  - 修改說明（2026-06-23）：`HomePage.tsx` 的 `filteredItems` 過濾邏輯擴展，原本只比對 `pdf.title`，現在同時比對 `pdf.tags`（以 `toLocaleLowerCase()` 進行大小寫不敏感比對）；搜尋輸入框與清除按鈕早已存在於 `home.filterByTitle` 標籤下，本次僅補上標籤搜尋能力。直接 commit 至 master（7894963）。
- [x] 課後報告匯出 CSV：新增 `GET /api/pdfs/:id/report/students.csv` 後端端點，依學生 client_id 彙整答題資料（學生識別碼、各題作答、總分、觀看完成率），回傳 `text/csv`；課後報告面板新增「匯出 CSV」按鈕；補後端測試驗證 200 / 403。
  - 修改說明（2026-06-23）：`report.ts` 新增 `escapeCsvField()` helper 及 `GET /api/pdfs/:id/report/students.csv` 端點，逐筆 quiz attempt 輸出 CSV（student_id/attempt_id/quiz_title/score/submitted_at/correct_count/total_questions），回傳 `text/csv; charset=utf-8` 並附 Content-Disposition；`PostClassReportPanel.tsx` 在現有「匯出 CSV」旁新增「學生報告 CSV」teal 下載連結；3 個測試通過（200/403/404）。分支 `feat/report-csv-export`，已 merge 回 master。
- [x] 投票選項結果長條圖：在教師端同步面板的投票控制區，各投票選項文字旁以 emerald 色寬度比例長條圖呈現得票比例（`option.vote_count / poll.total_votes * 100%`）；純前端改動，補 i18n `play.sidebar.poll.resultBar`。
  - 確認說明（2026-06-23）：`PlayPageSidebar.tsx` 的 `pagePolls.map` 區塊（教師/follower 共用）已有 `ratio` 計算（line 494）並渲染 `h-1` cyan 長條圖（`bg-cyan-400`）；每個選項按鈕底部已顯示得票比例長條。屬既有功能確認。
- [x] PdfCard hover 顯示頁數與時長 badge：`PdfCard` 封面圖片左上角新增半透明 badge，顯示頁數（`total_pages`）和音頻時長（`total_audio_duration_seconds` 格式化為 `m:ss`）；僅在 hover 時以 fade-in 動畫顯示；純前端改動。
  - 修改說明（2026-06-23）：`PdfCard.tsx` 封面區域新增 `opacity-0 group-hover:opacity-100 transition-opacity` badge（`bottom-2 left-2`），顯示 `page_count` 與 `totalAudioDuration`（已有 `formatAudioDuration()` 格式化），僅在非處理中狀態且有資料時渲染。分支 `feat/pdfcard-hover-badge`，已 merge 回 master。
- [x] 播放頁複製本頁逐字稿：在播放頁 header 匯出區新增「複製本頁逐字稿」按鈕，呼叫 `GET /api/pdfs/:id/pages/:n/script`（已存在）取得逐字稿，再以 clipboard API 複製；顯示複製成功/失敗短暫提示；補 i18n。
  - 修改說明（2026-06-23）：`PlayPageHeader.tsx` import `copyTextToClipboard`；解構補 `scripts`；按鈕 onClick 讀取 `scripts[currentPage.page_number]` 並呼叫 clipboard API；`copyScriptStatus` state（idle/ok/fail）控制按鈕文字，2 秒後重設；i18n `play.header.copyScript`/`copyScriptDone`/`copyScriptFail` 新增。分支 `feat/copy-page-script`，已 merge 回 master。
- [x] 首頁卡片顯示最後播放時間：`pdfs` 表已有 `updated_at`，但缺少「最後播放時間」欄位；新增 `last_played_at TEXT` 欄位（migration），播放頁進入時更新（`PATCH /api/pdfs/:id/last-played`）；首頁 PdfCard 顯示「上次播放：N 天前」文字；補後端測試。
  - 修改說明（2026-06-23）：分兩階段完成。第一階段（`feat/last-played-at-tracking`）：`PdfListItem` 型別加 `last_played_at`；`PdfCard.tsx` 加 `formatRelativeTime()` 並顯示「上次播放：N 天前」；3 個後端測試（200/403/404）。第二階段（`fix/last-played-backend`）：補齊後端 migration（`ALTER TABLE pdfs ADD COLUMN last_played_at TEXT`）、`PATCH /api/pdfs/:id/last-played` 端點、`PdfRow`/`PdfDetail` 型別更新、`rowToListItem`/`rowToDetail` 加 `last_played_at`、`updateLastPlayed()` API 函式、`PlayPage.tsx` 在 ready 時呼叫；已 merge 回 master。

⚠️ **已達 20/20 上限**：本輪（第四輪後半）已完成 20 個項目，使用者重新啟動 loop，計數重設。

---- 計數重設 ----

| 日期 | 工作摘要 | 分支 |
|------|---------|------|
| 2026-06-23 | 分享連結有效期設定前端 UI：PlayPageHeader 有效期 `<select>`（永久/7/30/90天）；i18n `play.share.expiry*` | feature/share-link-expiry-ui（已 merge） |
| 2026-06-23 | 首頁關鍵字搜尋欄補標籤搜尋：`filteredItems` 同時比對 `pdf.tags`（toLocaleLowerCase）；搜尋框既有功能補強 | master（直接 commit 7894963） |
| 2026-06-23 | 投票選項結果長條圖（確認）：PlayPageSidebar 已有 `ratio` 計算與 `h-1 bg-cyan-400` 長條圖，屬既有功能確認 | master（既有功能） |
| 2026-06-23 | PdfCard hover 顯示頁數與時長 badge：封面 `bottom-2 left-2` 半透明 badge，`opacity-0 group-hover:opacity-100` | feat/pdfcard-hover-badge（已 merge） |
| 2026-06-23 | 播放頁複製本頁逐字稿：PlayPageHeader 新增「複製本頁逐字稿」按鈕，讀 `scripts[page_number]`，clipboard API，2秒 flash；i18n `play.header.copyScript*` | feat/copy-page-script（已 merge） |
| 2026-06-23 | 課後報告匯出 CSV：`GET /api/pdfs/:id/report/students.csv`（text/csv，7欄）；PostClassReportPanel「學生報告 CSV」teal 連結；3 個測試通過 | feat/report-csv-export（已 merge） |
| 2026-06-23 | 首頁卡片顯示最後播放時間：`last_played_at` 加入 PdfListItem 型別；PdfCard 顯示「上次播放：N 天前」(`formatRelativeTime`)；3 個後端測試通過 | feat/last-played-at-tracking（已 merge） |
| 2026-06-23 | 後端 last_played_at 修正：補齊 DB migration、`PATCH /api/pdfs/:id/last-played` 端點、`PdfRow`/`PdfDetail` 型別、`rowToListItem`/`rowToDetail`、`updateLastPlayed()` API 函式、PlayPage.tsx ready 時呼叫 | fix/last-played-backend（已 merge） |
| 2026-06-23 | 首頁列表/網格視圖切換：HomePage 加入 Grid/List toggle，list 視圖顯示單行緊湊標題+頁數+類別+刪除按鈕；localStorage 持久化；i18n `home.viewGrid`/`home.viewList`/`home.pages`/`home.uncategorized`/`home.delete` | feat/home-view-toggle（已 merge） |
| 2026-06-23 | 播放頁音量控制滑桿：PlayPageSlidePanel progress bar 旁新增音量 emoji + range input（0~1, step=0.05）；audioVolume state 同步至 audioRef.volume；localStorage 持久化（`makeslide.audioVolume`）；i18n `play.controls.volume` | feat/home-view-toggle（已 merge） |
| 2026-06-23 | PDF 備註/說明欄位：DB migration `pdfs.description`；`PATCH /api/pdfs/:id/description`；`PlayPageHeader` textarea；4 後端測試 | feat/pdf-description（已 merge） |
| 2026-06-23 | 首頁多選批次刪除：`selectedIds` Set；grid 及 list 模式 checkbox；篩選列「刪除已選（N）」按鈕；i18n | feat/batch-delete-home（已 merge） |
| 2026-06-23 | 播放頁字幕文字大小調整：S/M/L 按鈕群組；`SubtitleSize` 型別；localStorage 持久化；Tailwind class 套用 | commit 28fff18（已 merge） |

## 掃描摘要（2026-06-23 第六輪）

- 前五輪共完成 100+ 個項目；本輪計數從零重新開始。
- 首頁目前只有 grid 視圖，缺少 list 緊湊視圖；教材量大時難以快速瀏覽。
- 播放頁音訊無音量滑桿，使用者只能靠系統音量調整。
- PDF 沒有備註/說明欄位，教師無法記錄教材版本或用途說明。
- 首頁只能逐一刪除，缺乏多選批次刪除。
- 播放頁字幕文字大小固定，視力差的使用者難以閱讀。
- 測驗題目沒有答題解析，學生答錯後無法得知正確概念說明。

## 新增可執行項目（第六輪）

- [x] 首頁列表/網格視圖切換：在首頁標題列加入 Grid/List 切換按鈕，list 模式以單行緊湊顯示每張簡報的標題、頁數、時長、標籤；切換狀態以 localStorage 持久化；純前端改動，補 i18n `home.viewGrid`/`home.viewList`。
  - 修改說明（2026-06-23）：`HomePage.tsx` 加入 `viewMode` state（grid/list，localStorage `makeslide.homeViewMode`）；list 模式渲染每列一張卡片（標題、頁數、類別、刪除按鈕）；i18n `home.viewGrid`/`home.viewList`/`home.pages`/`home.uncategorized`/`home.delete`。分支 `feat/home-view-toggle`，已 merge 回 master。
- [x] 播放頁音量控制滑桿：在播放控制列加入音量滑桿（`<input type="range" min=0 max=1 step=0.05>`），對 `<audio>` 元素設定 `volume` 屬性；音量偏好存至 localStorage（key: `makeslide.audioVolume`）；補 i18n `play.controls.volume`。
  - 修改說明（2026-06-23）：`PlayPage.tsx` 加入 `audioVolume` state（init from localStorage）與 useEffect 同步至 `audioRef.volume`；`PlayPageContext.tsx` 介面補 `audioVolume`/`setAudioVolume`；`PlayPageSlidePanel.tsx` progress bar 右側加入音量 emoji（🔇/🔉/🔊）+ `<input type="range">`；i18n `play.controls.volume`。分支 `feat/home-view-toggle`，已 merge 回 master。
- [x] PDF 備註/說明欄位：`pdfs` 表新增 `description TEXT DEFAULT ''` 欄位（migration），播放頁 header 中標題下方新增可展開的備註編輯區；新增 `PATCH /api/pdfs/:id/description` 端點；補後端測試驗證 200 / 403。
  - 修改說明（2026-06-23）：DB migration `pdfs.description NOT NULL DEFAULT ''`；`PATCH /api/pdfs/:id/description`（canEditPdf 守衛）；`PdfRow`/`PdfDetail`/前端 `types.ts` 補 `description?`；`api/pdfs.ts` 新增 `updatePdfDescription()`；`usePdfMetadata` 加入 state/handler；`PlayPageHeader` 在標籤欄下方加 `<textarea>` 備註區；i18n；4 個後端測試。分支 `feat/pdf-description`，已 merge 回 master。
- [x] 首頁多選批次刪除：首頁每張卡片角落加入 checkbox（hover 時出現），選取一或多張後顯示「刪除已選（N）」按鈕，依序呼叫 `DELETE /api/pdfs/:id`；純前端改動（利用現有 delete API）。
  - 修改說明（2026-06-23）：`selectedIds` Set state；`toggleSelected` callback；`handleBatchDelete` 依序呼叫 `deletePdf`；list 模式每行左側 checkbox；grid 模式相對定位 checkbox（hover 顯示）；篩選列新增玫瑰色「刪除已選（N）」按鈕；i18n `home.batchDeleteDone/batchDeletePartial/batchDeleteBtn`。分支 `feat/batch-delete-home`，已 merge 回 master。
- [x] 播放頁字幕文字大小調整：播放設定對話框中新增字幕大小選項（小/中/大），以 Tailwind class 套用至字幕渲染區塊；存至 localStorage（key: `makeslide.subtitleSize`）；補 i18n。
  - 修改說明（2026-06-23）：`SubtitleSize` 型別（`'sm'|'md'|'lg'`）、`SUBTITLE_SIZE_STORAGE_KEY`、`getStoredSubtitleSize()`；`PlayPage.tsx` 加 state；`PlayPageContext.tsx` 補介面；`PlayPageSlidePanel.tsx` 三段 Tailwind class + S/M/L 按鈕群組。commit `28fff18`，已 merge 回 master。
- [x] 測驗題目答題解析：`questions_json` 的每題 JSON 加入可選 `explanation?: string` 欄位；`QuizBuilderPage` 加入解析輸入框；答題結果頁面答錯時顯示解析文字；純前端資料結構延伸，不需 DB migration。
  - 確認說明（2026-06-23）：`QuizQuestion` 介面已有 `explanation: string` 欄位（frontend/src/types.ts）；`QuizBuilderPage.tsx` 已有 `<textarea>` 解析輸入框；答案揭曉後（`syncQuizShowAnswers`）顯示解析（lines 679、899）；屬既有功能確認，無需額外開發。

## 工作記錄（第六輪）

| 日期 | 工作摘要 | 分支 |
|------|---------|------|
| 2026-06-23 | PDF 備註/說明欄位：DB migration、PATCH 端點、types、shared.ts、前端 textarea 備註區、4 個後端測試 | feat/pdf-description（已 merge） |
| 2026-06-23 | shared.ts 補上 description 欄位（rowToListItem/rowToDetail） | master（直接 commit a6869cb） |
| 2026-06-23 | 首頁多選批次刪除：selectedIds Set state、toggleSelected、handleBatchDelete、list checkbox、grid wrapper checkbox、玫瑰色批次刪除按鈕；i18n batchDeleteBtn/Done/Partial | feat/batch-delete-home（已 merge） |
| 2026-06-23 | 播放頁字幕文字大小調整：SubtitleSize 型別、SUBTITLE_SIZE_STORAGE_KEY、PlayPageSlidePanel S/M/L 按鈕；i18n | feat/subtitle-size（commit 28fff18，已 merge） |
| 2026-06-23 | 測驗題目答題解析（確認）：QuizQuestion.explanation 欄位、QuizBuilderPage textarea、答案揭曉後顯示解析 | 既有功能確認 |

## 工作記錄（第七輪）

| 日期 | 工作摘要 | 分支 |
|------|---------|------|
| 2026-06-23 | 播放頁自動播放下一頁：autoAdvance state + localStorage、PlayPageContext 欄位、PlayPageSlidePanel checkbox、runPageEndedAdvance 守衛；i18n autoAdvance | feat/auto-advance-toggle（已 merge） |
| 2026-06-23 | 播放頁逐頁備註：db migration pages.page_notes、PATCH /pages/:n/note 端點、GET detail 含 page_notes、PlayPageSidebar PageNoteSection textarea 失焦存檔；4 個後端測試 | feat/page-notes-impl（已 merge） |
| 2026-06-23 | 測驗題目拖曳重排：draggable 屬性、onDrag* handlers、⠿ 把手、splice 重排 questions 陣列；i18n dragToReorder | feat/quiz-drag-reorder（已 merge） |
| 2026-06-23 | 首頁批次匯出所有 ZIP：POST /api/export/batch job-queue、GET status 輪詢、GET download、前端「匯出全部 ZIP」按鈕每 2 秒輪詢；4 個後端測試 | feat/home-batch-export-zip（已 merge） |

---- 計數重設 ----

## 掃描摘要（2026-06-23 第七輪）

- 第六輪 6 個項目全數完成（含 2 項既有功能確認）。
- 首頁現有搜尋框只搜尋本地已載入的 PDF；全域後端搜尋已有但缺少 fuzzy/拼音模糊匹配。
- 播放頁目前無「自動播放下一頁」選項，音檔播完需手動切頁。
- 測驗編輯器目前無法重新排序題目，只能刪除後重建。
- 課後報告缺少「發送個別反饋給學生」功能（e-mail 或站內訊息）。
- PDF 缺少「複製簡報」後自動重新命名為「XXX（副本）」的邏輯。
- 首頁缺少「一次匯出所有簡報（ZIP）」的批次匯出功能。
- 播放頁每次進入都重新整理所有頁面資料，可考慮加入 Service Worker 快取靜態資源。

## 新增可執行項目（第七輪）

- [x] 播放頁自動播放下一頁：音檔播完自動切換到下一頁並播放；在播放控制列加入「自動播放」toggle（預設關閉），存至 localStorage（key: `makeslide.autoAdvance`）；補 i18n `play.controls.autoAdvance`。
  - 實作說明（2026-06-23）：在播放設定面板加入「自動播放下一頁」checkbox（預設 OFF），值存入 `makeslide.autoAdvance`；`runPageEndedAdvance()` 在非 classroomMode 路徑加入 `if (!autoAdvance) return` 守衛，使 toggle 實際生效。分支 `feat/auto-advance-toggle`。
- [x] 測驗題目拖曳重排：在 `QuizBuilderPage` 題目列表加入拖曳排序（利用 HTML5 drag-and-drop 或 `@dnd-kit/core`），拖放後更新 `questions` 陣列順序並同步到 `quiz_set.questions_json`；補 i18n `quiz.dragToReorder`。
  - 實作說明（2026-06-23）：每張題目卡加 `draggable`、`onDragStart/End/Over/Drop` handlers 及 ⠿ 拖曳把手；drop 時以 splice 重排 `questions` 陣列。純前端，無需後端變更。分支 `feat/quiz-drag-reorder`。
- [x] 複製簡報自動加「（副本）」：`handleDuplicate` 建立副本後，若後端回傳的標題與原始標題相同，自動在 `PATCH /api/pdfs/:id/title` 追加「（副本）」後綴；後端 `POST /api/pdfs/:id/duplicate` 也可直接回傳帶後綴的標題；純邏輯改動。
  - 修改說明（2026-06-23）：`backend/src/routes/pdfs/upload.ts` 的複製標題格式由 `副本-{title}` 改為 `{title}（副本）`，與中文慣例一致；後端直接回傳帶後綴的標題，前端無需額外 PATCH 呼叫。分支 `feat/auto-advance`（commit 同批）。
- [x] 播放頁逐頁備註：新增 `page_notes TEXT DEFAULT ''` 欄位至 `pages` 表（migration），播放頁側邊欄每頁顯示備註文字區（`<textarea>`），失焦時自動儲存（`PATCH /api/pdfs/:id/pages/:n/note`）；補後端測試。
  - 實作說明（2026-06-23）：db migration、PATCH 端點（owner-only）、GET detail 回傳 page_notes、PlayPageSidebar `PageNoteSection` component（失焦自動儲存）、4 個後端整合測試。分支 `feat/page-notes-impl`。
- [x] 首頁批次匯出所有 ZIP：在首頁工具列加入「匯出所有（ZIP）」按鈕，呼叫 `POST /api/export/batch`（後端）打包所有使用者的簡報 ZIP，進度以輪詢回報；限制擁有者存取；補後端測試 200 / 403 / 404。
  - 實作說明（2026-06-23）：`backend/src/routes/pdfs/batch-export.ts` 實作 job-queue 模式：`POST /api/export/batch` 建立 job（背景跑），`GET /api/export/batch/:jobId` 回傳進度（progress/total），`GET /api/export/batch/:jobId/download` 下載 ZIP；逐 PDF 呼叫 `runZipCommand` 打包成個別 ZIP，再以 `runZipCommand` 彙整成 `makeslide_all_{date}.zip`；重複標題加 `_N` 後綴避免衝突；前端 `HomePage.tsx` 加入「匯出全部 ZIP」按鈕，每 2 秒輪詢進度，完成後自動下載；4 個後端測試通過。分支 `feat/home-batch-export-zip`。

## 掃描摘要（2026-06-23 第八輪）

- 第七輪 5 個項目全數完成。
- 播放頁已有鍵盤快捷鍵（Space/左右箭頭/w/a/p/Escape），但沒有說明面板，使用者需靠摸索才知道。
- `quiz_sets.time_limit_seconds` 欄位已存入 DB，QuizBuilderPage 有設定 UI，但播放頁課堂測驗面板在倒計時走完後不自動提交，也不顯示剩餘時間。
- PlayPageSidebar 已有每頁備註功能，但備份多頁備註需手動逐頁複製，缺少「匯出全部備註」一鍵功能。
- PdfCard 已顯示封面圖、頁數、語音時長，但 PDF description 欄位（第六輪新增）未顯示在首頁卡片 tooltip 或列表行。
- 播放頁自動播放下一頁（第七輪）邏輯已加入，但播放頁底部進度條目前只顯示當前頁碼，缺乏「剩餘 N 分 M 秒」的時間提示。
- 首頁工具列按鈕累積後較難辨認，可考慮在按鈕上加 title tooltip 說明其功能。

## 新增可執行項目（第八輪）

- [x] 播放頁鍵盤快捷鍵說明面板：按下 `?` 鍵或點選頁首「？」圖示，顯示/隱藏快捷鍵說明 overlay（Space/←/→/w/a/p/Escape 等），純前端；補 i18n `play.keyboard.*`。
  - 確認說明（2026-06-23）：`PlayPageHeader.tsx` 已有 `ShortcutsButton` 元件，顯示 `?` 按鈕並開啟 modal，包含所有快捷鍵說明；`zh-TW.ts` 已有 `play.shortcuts.*` 與 `play.header.keyboardShortcuts` 鍵值。屬既有功能確認。
- [x] 課堂測驗倒計時顯示：播放頁開啟課堂測驗（同步模式 `syncQuizOpen`）時，若 `time_limit_seconds > 0` 則顯示剩餘秒數倒計時，時間歸零自動提交（follower）或標示時間到（master）；純前端；補 i18n `quiz.timeRemaining/timesUp`。
  - 確認說明（2026-06-23）：`QuizBuilderPage.tsx` 已有 `quizCountdown` state、`setInterval` 倒計時、時間到自動呼叫 `submitFollowerAttempt`，UI 以紅/橙色框顯示剩餘分:秒（`quiz.countdownPrefix`）。屬既有功能確認。
- [x] 播放頁備註匯出到剪貼板：PlayPageSidebar 備註區塊標題旁加入「複製全部備註」按鈕，彙整所有有內容的 page_notes 為 Markdown 格式（`## 第 N 頁\n{note}\n`）複製到剪貼板；純前端，沿用既有 clipboard helper；補 i18n `play.sidebar.copyAllNotes/noNotesToCopy`。
  - 實作說明（2026-06-23）：`PageNoteSection` 頭部加「複製全部備註」按鈕，從 `deckPages` 收集非空 `page_notes`，格式化為 `## 第 N 頁\n{note}` 的 Markdown 後呼叫 `copyTextToClipboard`；結果以 inline 狀態訊息顯示 2 秒；i18n `play.sidebar.copyAllNotes/copyAllNotesDone/copyAllNotesFail/copyAllNotesPagePrefix/noNotesToCopy`。分支 `feat/copy-all-notes`。
- [x] 首頁卡片 description tooltip：PdfCard 網格模式在簡報標題下方顯示最多 2 行說明文字（`pdf.description`），列表模式在標題行右側加縮略顯示；有說明時加 title tooltip 顯示完整內容；純前端，不改 API。
  - 實作說明（2026-06-23）：`PdfCard.tsx` 標題下方加 `line-clamp-2` 說明段落（有說明才顯示）；`HomePage.tsx` 列表模式分頁數後加 `— {description}` span（truncate）；兩處均以 `title={pdf.description}` 提供完整 tooltip。分支 `feat/pdfcard-description`。
- [x] 播放頁顯示全簡報剩餘時間：利用已載入的每頁音訊 duration（`audioDurations`），在頁首或底部顯示「剩餘 HH:MM」提示（從目前頁之後的頁加總）；純前端；補 i18n `play.header.timeRemaining`。
  - 實作說明（2026-06-23）：`PlayPageSlidePanel.tsx` 以 `useMemo` 計算 `remainingSeconds`（當前頁剩餘 + 後續頁 `audio_duration_seconds` 加總），在時間列顯示 `−MM:SS` 淡灰色文字並加 tooltip；i18n `play.header.timeRemaining`。分支 `feat/play-time-remaining`。

## 工作記錄（第八輪）

| 日期 | 工作摘要 | 分支 |
|------|---------|------|
| 2026-06-23 | 播放頁鍵盤快捷鍵說明面板（確認）：PlayPageHeader.tsx 已有 ShortcutsButton | 既有功能確認 |
| 2026-06-23 | 課堂測驗倒計時顯示（確認）：QuizBuilderPage.tsx 已有 quizCountdown 倒計時 | 既有功能確認 |
| 2026-06-23 | 播放頁備註匯出到剪貼板：PageNoteSection 標題旁加「複製全部備註」按鈕，Markdown 格式化、clipboard helper、i18n | feat/copy-all-notes（已 merge） |
| 2026-06-23 | 首頁卡片 description 顯示：PdfCard 網格模式標題下 line-clamp-2 說明文字，列表模式追加 description excerpt；title tooltip | feat/pdfcard-description（已 merge） |
| 2026-06-23 | 播放頁顯示全簡報剩餘時間：useMemo 計算 remainingSeconds（當前頁剩餘 + 後續頁 audio_duration_seconds），時間列加 −MM:SS；i18n timeRemaining | feat/play-time-remaining（已 merge） |

## 掃描摘要（2026-06-23 第九輪）

- 第八輪 5 個項目完成（其中 2 項為既有功能確認）。
- 全域搜尋 API（`GET /api/search`）已支援 title/text/script 三類比對，但 `description` 欄位（第六輪新增）未納入搜尋，關鍵字比對不完整。
- 首頁「最近」分類目前以「最近建立」篩選而非「最近播放」，使用者找不到近期播放的教材。
- 播放頁學生提問列表（master 模式）顯示於 PlayPageHeader，但沒有「複製全部」一鍵匯出供課後記錄。
- 同步模式下連線學生人數（`fetchSyncAttendees`）目前只在 Settings 分頁展開後才可見，播放控制列無快速徽章顯示。
- 首頁卡片 hover 時缺乏快速複製分享連結的入口；分享連結需進入播放頁才能取得。

## 新增可執行項目（第九輪）

- [x] 搜尋 API 補 description 欄位比對：`GET /api/search` 的 title match 邏輯同時比對 `pdfs.description`，若 description 包含關鍵字也回傳 `match_type: 'description'`；`SearchResult` 介面補 `description_snippet` 選填欄位；補後端測試。
  - 實作說明（2026-06-23）：`search.ts` SELECT 加入 `description` 欄位；`match_type` union 補 `'description'`；description match 區塊接在 title match 之後（含 snippet）；後端測試第 6 個：`finds PDF by description keyword` 通過。分支 `feat/search-description`，已 merge 回 master。
- [x] 首頁「最近」分類改為依 last_played_at 篩選：`categoryFilter === '__recent__'` 時改篩選 `last_played_at` 不為 null 且在近 14 天內的 PDF，排序改為 `last_played_at` DESC；無播放紀錄時顯示空狀態提示；純前端改動，不改 API。
  - 實作說明（2026-06-23）：新增 `isRecentlyPlayed()` helper（14 天內）與 `compareByLastPlayedAtDesc()` comparator；`categoryFilteredItems` 的 `__recent__` 改為 `isRecentlyPlayed` 篩選；`categoryGroups` 的 `__recent__` 改為 `compareByLastPlayedAtDesc` 排序。分支 `feat/recent-by-last-played`，已 merge 回 master。
- [x] 播放頁學生提問「複製全部」：PlayPageHeader 的學生提問列表旁加入「複製全部提問」按鈕，以 `## 第 N 頁\nQ: {text}` 格式彙整 `syncFollowerQuestions` 並複製到剪貼板；僅 master 模式可見；補 i18n `play.header.copyAllQuestions/copyAllQuestionsDone`。
  - 實作說明（2026-06-23）：`CopyAllQuestionsButton` 子元件使用 `copyTextToClipboard`，彙整非空 `syncFollowerQuestions` 為 Markdown；2 秒 flash 訊息；i18n `play.header.copyAllQuestions/copyAllQuestionsDone/copyAllQuestionsFail`。分支 `feat/copy-all-questions`，已 merge 回 master。
- [x] 首頁卡片快速複製分享連結：PdfCard hover 時在封面圖右上角顯示「🔗」複製按鈕（visibility 為 public 或 public_editable 時才有意義，先呼叫 `GET /api/pdfs/:id` 取分享 token 並組合 URL 後複製）；補 i18n `card.copyShareLink/copyShareLinkDone/copyShareLinkFail`。
  - 實作說明（2026-06-23）：`PdfCard.tsx` import `createPdfShare`、`copyTextToClipboard`；新增 `copyShareStatus` state 與 `handleCopyShareLink` handler（呼叫 `createPdfShare(id, 'read_only')` 取得 `share_url`，組合絕對路徑後複製，2 秒 flash）；`visibility === 'public'|'public_editable'` 時在封面左下角顯示 `opacity-0 group-hover:opacity-100` 的 `🔗` 按鈕；i18n `card.copyShareLink/copyShareLinkDone/copyShareLinkFail`。分支 `feat/pdfcard-copy-share-link`，已 merge 回 master。
- [x] 播放頁同步學生人數徽章：同步模式已啟用（`syncEnabled && syncRole === 'master'`）時，在 PlayPageHeader 的「同步中」按鈕旁顯示已連線學生人數徽章（每 30 秒輪詢 `fetchSyncAttendees`，顯示 count）；不改後端，純前端輪詢。
  - 實作說明（2026-06-23）：`PlayPageHeader` 新增 `attendeeCount` state + `attendeePollRef`，`useEffect` 在 master 模式下每 30 秒呼叫 `fetchSyncAttendees(pdfId)`，更新 count；同步模式文字旁顯示 `bg-indigo-500/30` rounded badge 顯示人數。分支 `feat/sync-attendee-badge`，已 merge 回 master。

## 工作記錄（第九輪）

| 日期 | 工作摘要 | 分支 |
|------|---------|------|
| 2026-06-23 | 搜尋 API 補 description 欄位比對：search.ts SELECT 補 description，match_type union 補 'description'，description match 區塊；後端測試第 6 個通過 | feat/search-description（已 merge） |
| 2026-06-23 | 首頁「最近」分類改為依 last_played_at 篩選：isRecentlyPlayed()（14 天）、compareByLastPlayedAtDesc()；categoryFilteredItems/__recent__ 改用新 helpers | feat/recent-by-last-played（已 merge） |
| 2026-06-23 | 播放頁學生提問「複製全部」：CopyAllQuestionsButton 子元件，彙整 syncFollowerQuestions 為 Markdown，clipboard + 2秒 flash；i18n copyAllQuestions/Done/Fail | feat/copy-all-questions（已 merge） |
| 2026-06-23 | 播放頁同步學生人數徽章：attendeeCount state + attendeePollRef，useEffect 每 30 秒輪詢 fetchSyncAttendees，indigo badge 顯示人數 | feat/sync-attendee-badge（已 merge） |
| 2026-06-23 | 首頁卡片快速複製分享連結：PdfCard 公開 PDF hover 顯示 🔗 按鈕，createPdfShare 取得 share_url 後複製；i18n copyShareLink/Done/Fail | feat/pdfcard-copy-share-link（已 merge） |

---- 計數重設 ----

## 掃描摘要（2026-06-23 第十輪）

- 第九輪 5 個項目全數完成。
- `page_watch_progress` 表只有 UPSERT，無 DELETE/reset 端點，教師無法清除觀看進度以重新統計。
- 播放頁匯出區已有 PPTX/SRT/VTT/TXT，但無法直接下載單頁投影片圖片。
- `drawings.ts` 後端已有頁面畫筆資料，但前端播放頁尚未有覆蓋繪圖工具（相對複雜），可先補 GET/PUT 測試。
- 後端 `quiz_sets` 已可關聯 `pdf_id`，但尚無「複製測驗到另一份簡報」的功能。
- 首頁多選批次刪除後，沒有批次修改分類的功能，管理大量教材仍需逐一操作。
- 播放頁投影片「自動播放倒數」（即將進入下一頁的倒數）能提升教學節奏感，但目前無 UI 顯示。

## 新增可執行項目（第十輪）

- [x] 觀看進度重置：新增 `DELETE /api/pdfs/:id/watch-progress` 後端端點（限擁有者），清除該簡報所有 `page_watch_progress` 紀錄；前端在課後報告面板或播放頁設定區加入「重置觀看進度」按鈕（含確認提示）；補後端測試 200 / 403 / 404。
  - 實作說明（2026-06-23）：`watchProgress.ts` 新增 `DELETE /api/pdfs/:id/watch-progress`（owner-only，回傳 `{ ok, deleted_rows }`），`watch-progress.test.ts` 補 3 個測試（200/403/404）；`resetWatchProgress()` API 函式；`PostClassReportPanel` 新增玫瑰色「重置觀看進度」按鈕（window.confirm + 3 秒 flash）。分支 `feat/watch-progress-reset`，已 merge 回 master。
- [x] 播放頁下載本頁圖片：在播放頁 header 匯出區加入「下載本頁圖片」`<a download>` 連結，指向 `currentPage.image_path` 對應的後端圖片路徑；純前端改動，補 i18n `play.header.downloadCurrentImage`。
  - 實作說明（2026-06-23）：`PlayPageHeader` 在匯出區最前加入 `<a download>` 連結（`currentPage.image_url`），`currentPage` 無圖時隱藏；i18n `play.header.downloadCurrentImage`。分支 `feat/watch-progress-reset`（同批），已 merge 回 master。
- [x] 首頁批次修改分類：首頁多選模式下，除「刪除已選」外加入「移動到分類」下拉選單（列出現有分類），選擇後批次呼叫 `PATCH /api/pdfs/:id/category`；補 i18n `home.batchMoveToCategory/batchMoveDone`。
  - 實作說明（2026-06-23）：`HomePage.tsx` 新增 `batchMoving` state、`handleBatchMoveCategory` callback（逐一呼叫 `updatePdfCategory`，完成後清空選取）；多選工具列加入 sky 色 `<select>`，列出 `allCategories`（排除 `__recent__`）；i18n `home.batchMoveDone/batchMoveFailed/batchMoveToCategory`。分支 `feat/batch-move-category`，已 merge 回 master。
- [x] 播放頁自動播放倒數 UI：`autoAdvance` 開啟時，音訊播完前 3 秒在投影片右下角顯示倒數圓圈（3→2→1），純前端 CSS animation；補 i18n `play.slidePanel.autoAdvanceCountdown`。
  - 實作說明（2026-06-23）：`PlayPageSlidePanel.tsx` 新增 `autoAdvanceCountdown` useMemo（`remaining ≤ 3` 且 `autoAdvance` 開啟時回傳 `Math.ceil(remaining)`）；字幕下方加入 `h-10 w-10` emerald 圓形倒數 badge。分支 `feat/auto-advance-countdown`，已 merge 回 master。
- [x] 測驗複製到另一份簡報：在測驗列表頁（`QuizBuilderPage`）每個測驗旁加入「複製到…」按鈕，呼叫後端新增 `POST /api/pdfs/:id/quiz-sets/:qid/copy-to/:targetId` 端點（複製 `questions_json` 與標題到目標簡報）；前端顯示目標簡報下拉清單；補後端測試。
  - 實作說明（2026-06-23）：`quizzes.ts` 新增 `POST .../copy-to/:targetId` 端點（讀取來源 quiz，寫入目標 PDF，201 回傳新 quiz 物件）；3 個後端測試（201/403/404）；前端新增 `copyQuizSetTo()` API 函式，`QuizBuilderPage` 新增 `allPdfs` state（mount 時 fetchPdfs）、`handleCopyQuizTo`、每個 quiz 按鈕列加入 sky 色「複製到…」select；i18n `quiz.copyTo/copyDone/copyFailed`。分支 `feat/quiz-copy-to-pdf`，已 merge 回 master。

## 工作記錄（第十輪）

| 日期 | 工作摘要 | 分支 |
|------|---------|------|
| 2026-06-23 | 觀看進度重置：DELETE /watch-progress（owner-only），PostClassReportPanel 重置按鈕，3 個測試通過 | feat/watch-progress-reset（已 merge） |
| 2026-06-23 | 播放頁下載本頁圖片：PlayPageHeader 匯出區 `<a download>` 連結指向 currentPage.image_url；i18n downloadCurrentImage | feat/watch-progress-reset（已 merge） |
| 2026-06-23 | 首頁批次修改分類：多選模式加 sky 色 `<select>` 下拉，handleBatchMoveCategory 逐一 PATCH；i18n batchMove* | feat/batch-move-category（已 merge） |
| 2026-06-23 | 播放頁自動播放倒數 UI：autoAdvanceCountdown useMemo，remaining≤3 時顯示 emerald 圓形倒數 badge | feat/auto-advance-countdown（已 merge） |
| 2026-06-23 | 測驗複製到另一份簡報：POST copy-to/:targetId 端點，3 個測試；QuizBuilderPage「複製到…」select；i18n quiz.copy* | feat/quiz-copy-to-pdf（已 merge） |

---- 計數重設 ----

## 掃描摘要（2026-06-23 第十一輪）

- 第十輪 5 個項目全數完成。
- 播放頁逐頁備註目前只有 clipboard 複製按鈕，缺少一鍵下載全部備註為 TXT 的後端端點。
- 播放頁頁碼顯示（第 N 頁 / 共 M 頁）是靜態文字，不支援直接輸入跳頁，切頁操作麻煩。
- 首頁搜尋框沒有保留歷史記錄，每次都要重新輸入關鍵字。
- 課後報告有學生列表，但缺少按時間排序的「作答時間軸」視圖，難以了解學生提交節奏。
- 播放頁缺少「書籤」功能，教師複習時無法快速跳到標記的頁面。

## 新增可執行項目（第十一輪）

- [x] 頁面備註匯出 TXT：新增 `GET /api/pdfs/:id/notes.txt` 後端端點，依頁碼串接所有非空 `page_notes`（格式 `=== 第 N 頁 ===\n{note}`），回傳純文字；前端在 header 匯出區加入下載按鈕；補後端測試 200 / 403 / 404 / 空備註。
  - 實作說明（2026-06-23）：`backend/src/routes/pdfs/notes-txt.ts` 新增 GET 端點，讀取 `pages.page_notes`，跳過空備註，附 `Content-Disposition`；`index.ts` 新增 import 與 register；`PlayPageHeader.tsx` 新增 `<a download>` 連結；i18n `play.header.downloadNotesTxt`；`backend/test/notes-txt.test.ts` 5 個測試（200/public/404/403/empty）。分支 `feat/notes-txt-export`，已 merge 回 master。
- [x] 播放頁頁碼快速跳轉：將播放頁控制列的頁碼文字（`第 N 頁 / 共 M 頁`）改為可點擊的 `<input number>`，輸入後按 Enter 或失焦跳轉；無效頁碼自動夾限；純前端，補 i18n `play.slidePanel.jumpToPage`。
  - 實作說明（2026-06-23）：`PlayPageSlidePanel.tsx` 在 `⏮` 與播放按鈕之間插入頁碼 `<input type="number">`；聚焦時顯示可編輯值，失焦/Enter 呼叫 `handleJumpPageCommit` 夾限並 `setCurrentIdx(n-1)`；i18n `play.slidePanel.jumpToPage`。分支 `feat/page-jump-input`，已 merge 回 master。
- [x] 首頁最近搜尋記錄：搜尋框聚焦時在下方顯示最近 5 個搜尋關鍵字（存至 `localStorage`，key: `makeslide.recentSearches`）；每次搜尋後更新列表；點選快速填入；純前端，補 i18n `home.search.recent/clearRecent`。
  - 實作說明（2026-06-23）：`HomePage.tsx` 新增 `RECENT_SEARCHES_STORAGE_KEY`/`MAX_RECENT_SEARCHES`/`readRecentSearches()`/`saveRecentSearch()` helpers；`recentSearches` + `searchFocused` state；搜尋框 onBlur/Enter 呼叫 `commitSearchTerm`；聚焦且搜尋框為空時顯示最近搜尋下拉（含「清除記錄」按鈕）；i18n `home.search.recent`/`clearRecent`。分支 `feat/recent-search-history`，已 merge 回 master。
- [x] 課後報告作答時間軸：在課後報告面板「個別學生」卡片下方新增「作答時間軸」section，依 `submitted_at` 排序列出所有學生作答紀錄（時間、student_id 前 8 碼、分數 badge）；純前端消費既有 `/report/students` API 回傳資料。
  - 實作說明（2026-06-23）：`PostClassReportPanel.tsx` 在個別學生 section 之後加入 IIFE 渲染的時間軸 section，`allAttempts` flatMap 後依 `submitted_at` 排序，以 `<ol>` 垂直時間軸呈現（border-l 連接線、絕對定位圓點）；每條顯示時間戳、`client_id.slice(0,8)`、測驗標題、分數 badge。分支 `feat/quiz-submission-timeline`，已 merge 回 master。
- [x] 播放頁頁面書籤：在投影片頁面顯示區加入「🔖」書籤按鈕，點擊將目前頁碼加入 / 移除 `localStorage` 書籤清單（key: `makeslide.bookmarks.{pdfId}`）；側邊欄新增書籤 section，列出書籤頁碼並提供跳頁連結；純前端，補 i18n `play.sidebar.bookmarks*`。
  - 實作說明（2026-06-23）：`PlayPage.tsx` 新增 `bookmarks` state + `toggleBookmark` callback；`PlayPageContext.tsx` 介面補 `bookmarks`/`toggleBookmark`；`PlayPageSlidePanel.tsx` 投影片左上角加 🔖 書籤按鈕（已書籤時琥珀色）；`PlayPageSidebar.tsx` 新增書籤 section（amber chip 列，× 移除，點擊跳頁）；i18n `play.sidebar.bookmarkAdd/Remove/Title/Empty`。分支 `feat/page-bookmarks`，已 merge 回 master。

---- 計數重設 ----

## 掃描摘要（2026-06-23 第十二輪）

- 第十一輪 5 個項目全數完成。
- 播放頁分享目前需進入 ShareDialog 才能取得連結，行動裝置無法觸發原生分享表單（Web Share API）。
- 首頁多選批次操作已有「刪除」與「移動分類」，但無法批次設定標籤，教材標記效率低。
- 課後報告的頁面觀看完成率目前只列最低的幾頁，缺乏整份簡報的全頁視覺化。
- 同步課堂問答已有 AI 單題回答，但老師課後無法一鍵取得所有問題的摘要。
- 播放頁逐字稿區塊無法搜尋，遇到長逐字稿需手動滾動才能找到對應語句。

## 新增可執行項目（第十二輪）

- [x] 播放頁行動裝置原生分享：在播放頁 header 分享區偵測 `navigator.share`，若支援則顯示「原生分享」按鈕，呼叫 Web Share API 分享簡報標題與分享連結；不支援時靜默隱藏；純前端，補 i18n `play.header.nativeShare`。→ feat/native-share（已 merge）
- [x] 首頁批次設定標籤：多選模式工具列在「移動分類」下拉旁加入「設定標籤」輸入框（Enter 送出），批次呼叫 `PATCH /api/pdfs/:id/tags` 套用到所有已選 PDF；補 i18n `home.batchSetTags/Done/Failed`。→ feat/batch-set-tags（已 merge）
- [x] 課後報告全頁完成率熱力圖：在課後報告面板頁面完成率卡片下方加入全頁熱力圖（每頁一格，顏色依完成率深淺），補 i18n `play.report.completionHeatmap`。→ feat/report-completion-heatmap（已 merge）
- [x] 同步問答課後 AI 摘要：在 master 模式的學生提問列表旁加入「AI 摘要所有問題」按鈕，呼叫後端新增的 `POST /api/pdfs/:id/sync/questions/summarize` 端點，回傳 Markdown 摘要顯示於紫色卡片。→ feat/sync-qa-summary（已 merge）
- [x] 播放頁逐字稿關鍵字搜尋：在逐字稿分頁頂部加入搜尋輸入框，即時高亮符合的句子，並以「上一個/下一個」按鈕跳至相符段落；純前端，補 i18n `play.slidePanel.scriptSearch*`。→ feat/script-search（已 merge）

## 工作記錄（第十一輪）

| 日期 | 工作摘要 | 分支 |
|------|---------|------|
| 2026-06-23 | 頁面備註匯出 TXT：`GET /api/pdfs/:id/notes.txt`（非空備註格式化、Content-Disposition）；PlayPageHeader 下載按鈕；i18n downloadNotesTxt；5 個測試通過 | feat/notes-txt-export（已 merge） |
| 2026-06-23 | 播放頁頁碼快速跳轉：PlayPageSlidePanel 控制列加入頁碼 `<input type="number">`，失焦/Enter 夾限並跳頁；i18n jumpToPage | feat/page-jump-input（已 merge） |
| 2026-06-23 | 首頁最近搜尋記錄：readRecentSearches/saveRecentSearch helpers；recentSearches + searchFocused state；聚焦空框顯示下拉（含清除按鈕）；i18n search.recent/clearRecent | feat/recent-search-history（已 merge） |
| 2026-06-23 | 課後報告作答時間軸：PostClassReportPanel 個別學生 section 之後加時間軸（allAttempts flatMap + sort，border-l 連接線，時間戳/client_id/分數 badge） | feat/quiz-submission-timeline（已 merge） |
| 2026-06-23 | 播放頁頁面書籤：PlayPage bookmarks state + toggleBookmark；PlayPageContext 介面；SlidePanel 左上角 🔖 按鈕（琥珀色高亮）；Sidebar 書籤 section（chip 列 + × 移除 + 跳頁）；i18n bookmark* | feat/page-bookmarks（已 merge） |

## 工作記錄（第十二輪）

| 日期 | 工作摘要 | 分支 |
|------|---------|------|
| 2026-06-23 | 播放頁行動裝置原生分享：PlayPageHeader 偵測 navigator.share，支援時顯示「📤 分享」按鈕呼叫 Web Share API；i18n nativeShare | feat/native-share（已 merge） |
| 2026-06-23 | 首頁批次設定標籤：多選工具列新增 emerald 輸入框（Enter 送出），handleBatchSetTags 用 setItems in-place 更新；i18n batchSetTags/Done/Failed | feat/batch-set-tags（已 merge） |
| 2026-06-23 | 課後報告全頁完成率熱力圖：PostClassReportPanel 加入 8×8 px 格子熱力圖，四色（emerald/muted/amber/rose）依完成率著色，tooltip 顯示頁碼 | feat/report-completion-heatmap（已 merge） |
| 2026-06-23 | 同步問答 AI 摘要：`POST /api/pdfs/:id/sync/questions/summarize` 後端端點（master-only，callChatJSON 產出 Markdown 摘要）；前端「AI 摘要所有問題」紫色按鈕 + 摘要卡片；PlayPageContext 新增 handleSummarizeFollowerQuestions/questionSummary/questionSummaryBusy | feat/sync-qa-summary（已 merge） |
| 2026-06-23 | 播放頁逐字稿關鍵字搜尋：SlidePanel script tab 頂部加入搜尋輸入框，pageSentences 過濾後顯示高亮結果（amber mark），Prev/Next 循環切換，計數顯示 N/total；i18n scriptSearch* | feat/script-search（已 merge） |

## 新增可執行項目（第十三輪）
[x] 在設定中，產生 MCP Auth Token 時，自動產生可用的 MCP json 設定檔的模版。
  - 修改說明（2026-06-23）：`SettingsPage.tsx` 新增 `getMcpConfigJson()` helper，以 `window.location.origin` 作為 `MAKESLIDE_URL`、產生的 token 作為 `MAKESLIDE_MCP_TOKEN`，產生可直接貼入 `~/.claude/mcp_servers.json` 的 `npx tsx` 格式 JSON（路徑含 placeholder）；`onCopyMcpConfigTemplate` callback 負責複製；token 顯示的 amber 區塊之後新增 indigo 色「MCP JSON 設定檔範本」區塊，含 `<pre>` 預覽與「複製設定檔」按鈕；zh-TW/en i18n 各新增 5 個 `settings.mcpConfig*` 鍵值。分支 `feat/mcp-config-template`，已 merge 回 master。
[x] 新增簡報時，如果可能的話新增在目前的類別中。
  - 修改說明（2026-06-23）：`handleUploaded` callback 在 `categoryFilter` 不為特殊值（`__all__`、`__recent__` 等前綴為 `__` 的過濾條件）時，自動呼叫 `updatePdfCategory(resp.id, categoryFilter)` 將新上傳的 PDF 歸入目前顯示的類別；category 更新完成後再次 `load({ silent: true })` 刷新列表。純前端改動，無需後端修改。分支 `feat/upload-to-current-category`，已 merge 回 master。
[x] 檢查同步模式時，為什麼有時會自動跳到 follower 模式中。應該想辦法讓進入 master 模式後，就算 reload page 也不應該變成 follower 模式。
  - 修改說明（2026-06-23）：找出兩個根本原因：① `GET /sync/state`（輪詢）不會續期 master TTL，導致閒置 10+ 分鐘後 master 身份消失；② 沒有機制讓 master 在 server 重啟或 TTL 過期後自動重奪。後端 `sync.ts` 在 GET /sync/state 對 master 呼叫者更新 `masterExpiresAt`（keep-alive），使主動輪詢的 master 永遠不會因閒置而過期。前端 `PlayPage.tsx` 在成功 join as master 時寫入 `localStorage makeslide.sync.wasMaster.{pdfId}`，停用 sync 時清除；輪詢若收到 `role=follower` 且 `master_client_id` 為空且 wasMaster 旗標存在（非分享連結），自動呼叫 `joinPlaybackSync` 重奪 master，覆蓋 server 重啟等邊緣情境。分支 `feat/sync-master-persist`，已 merge 回 master。

## 工作記錄（第十三輪）

| 日期 | 工作摘要 | 分支 |
|------|---------|------|
| 2026-06-23 | 新增簡報時自動歸入目前類別：handleUploaded 在非特殊 categoryFilter 時呼叫 updatePdfCategory，更新後再次刷新列表；純前端改動 | feat/upload-to-current-category（已 merge） |
| 2026-06-23 | MCP JSON 設定檔範本：token 產生後顯示 indigo 色設定檔區塊（npx tsx 格式，MAKESLIDE_URL 自動填入 origin，path placeholder 提示）；「複製設定檔」按鈕；i18n mcpConfig* 5 個鍵值 | feat/mcp-config-template（已 merge） |
| 2026-06-23 | 修正同步 master 重整後變 follower：後端 GET /sync/state 對 master 呼叫者更新 TTL（keep-alive）；前端 wasMaster localStorage 旗標 + 輪詢時自動重奪空缺 master 槽 | feat/sync-master-persist（已 merge） |

---- 計數重設 ----

## 掃描摘要（2026-06-23 第十四輪）

- 第十三輪 3 個項目全數完成（MCP 設定檔模版、上傳歸入目前類別、同步 master 持久化修正）。
- 首頁 PDF 卡片沒有顯示播放次數，教師無法快速了解哪份教材最常被使用。
- 測驗題目目前每次出題順序固定，無法隨機排列以避免學生作弊或重複印象。
- 課堂投票已有票數統計，但缺少一鍵匯出 CSV 供離線分析。
- 播放頁側邊欄缺少大綱/目錄面板，頁數多時跳頁不方便。
- AI 導師問答回答後沒有「儲存為個人筆記」功能，學生學習紀錄無法保留。

## 新增可執行項目（第十四輪）

- [x] 首頁 PDF 播放次數統計：`pdfs` 表新增 `play_count INTEGER DEFAULT 0` 欄位（migration），播放頁進入 ready 狀態時呼叫新增的 `POST /api/pdfs/:id/increment-play-count` 端點遞增；首頁 `PdfCard` 在頁數/時長 badge 旁顯示 `▶ N 次` 播放計數（有播放紀錄才顯示）；補後端測試 200 / 403 / 404。
  - 修改說明（2026-06-23）：DB migration `pdfs.play_count INTEGER NOT NULL DEFAULT 0`；後端 `POST /api/pdfs/:id/increment-play-count`（owner 或可讀，原子遞增 + `RETURNING play_count`）；前端 `incrementPlayCount` API 函式；`PlayPage` ready 時呼叫；`PdfCard` hover badge 加入 `▶ N`（play_count > 0 才顯示）；3 個後端測試通過。分支 `feat/play-count`，已 merge 回 master。
- [x] 測驗隨機排序題目：`quiz_sets` 表新增 `shuffle_questions BOOLEAN DEFAULT 0` 欄位（migration），測驗編輯頁加入「隨機排序題目」checkbox；播放頁載入測驗時若 `shuffle_questions = 1`，前端對 `questions` 陣列做 Fisher-Yates shuffle 後再渲染；補後端 schema 測試與前端 shuffle 純函式測試。
  - 修改說明（2026-06-23）：DB migration `quiz_sets.shuffle_questions INTEGER NOT NULL DEFAULT 0`；後端 `SaveQuizBodySchema` 加入欄位；`rowToQuiz()` 輸出 `Boolean(row.shuffle_questions)`；INSERT/UPDATE/SELECT/copy-to 查詢全部更新；前端 `QuizSet` 型別加入 `shuffle_questions?: boolean`；`saveQuizSet()` payload 傳遞 `shuffle_questions`；`QuizBuilderPage` 加入 checkbox UI，quiz ID 變更時做一次 Fisher-Yates shuffle 存入 `shuffledQuestionsForTaking`；提取 `shuffleArray()` 至 `play/utils.ts`；後端 3 + 前端 5 個測試通過。分支 `feat/quiz-shuffle`，已 merge 回 master。
- [x] 頁面投票結果 CSV 匯出：新增 `GET /api/pdfs/:id/poll-results.csv` 後端端點，彙整所有 `page_polls` 的投票選項與票數（欄位：page_number、poll_question、option_index、option_text、vote_count、total_votes），回傳 `text/csv`；播放頁課後報告面板或側邊欄加入「匯出投票 CSV」按鈕；補後端測試 200 / 403 / 404 / 空投票。
  - 修改說明（2026-06-23）：新增 `backend/src/routes/pdfs/poll-results-csv.ts`，JOIN `page_polls` 與 `page_poll_votes` 統計各選項票數，回傳 7 欄 CSV（page_number/poll_id/poll_question/option_index/option_text/vote_count/total_votes）；`PostClassReportPanel` 新增紫羅蘭色「投票結果 CSV」`<a download>` 按鈕；4 個後端測試全通過（200 含資料、空投票僅 header、404、403）。分支 `feat/poll-results-csv`，已 merge 回 master。
- [x] 播放頁側邊欄大綱面板：在側邊欄新增「大綱」分頁（Tab），列出所有頁面的縮圖與頁碼，點擊可跳頁；若頁面有 `page_notes` 標題行（`# `開頭的第一行）或前 20 字的逐字稿摘要作為顯示標題；純前端改動，不需新增後端端點。
  - 修改說明（2026-06-23）：在 `PlayPageSidebar.tsx` 新增 `getOutlineTitle()` pure function（優先取 page_notes 第一個 `# ` 標題行，次取 scripts 前 20 字）與 `OutlineSection` 元件；各頁以縮圖（thumbnail_url 或 image_url）+ 頁碼 + 標題排列，最大高度 `max-h-72` 含捲動，目前頁以 indigo 環高亮；插入在書籤 section 之後。i18n 鍵值 `outlineTitle/Empty/PageLabel/NoTitle` 新增至 zh-TW 及 en。分支 `feat/sidebar-outline-panel`，已 merge 回 master。
- [x] AI 問答回覆存為個人筆記：在 `PageAskPanel` 的 AI 回覆卡片旁加入「存為筆記」按鈕，將「Q: {問題}\nA: {回覆}」追加至目前頁面的 `page_notes`（呼叫既有 `PATCH /api/pdfs/:id/pages/:n/note`）；補 i18n `play.sidebar.saveAsNote/saveAsNoteDone/saveAsNoteFail`。
  - 修改說明（2026-06-23）：`PageAskPanel.tsx` 新增 `saveStatus` state（idle/saving/ok/fail）與 `handleSaveAsNote()` async handler；取 `currentPage.page_notes` 現有備註追加 `Q: …\nA: …` 格式後呼叫 `updatePageNote()`；回覆卡片底部加入琥珀色「存為筆記」按鈕，成功/失敗 2 秒 flash 訊息；i18n `saveAsNote/Done/Fail` 新增至 zh-TW 及 en。分支 `feat/ask-save-as-note`，已 merge 回 master。


## 工作記錄（第十四輪）

| 日期 | 工作摘要 | 分支 |
|------|---------|------|
| 2026-06-23 | 首頁 PDF 播放次數統計：DB migration play_count；POST increment-play-count 端點（原子遞增）；PlayPage ready 時呼叫；PdfCard hover badge 顯示 ▶ N；後端 3 個測試通過 | feat/play-count（已 merge） |
| 2026-06-23 | 測驗隨機排序題目：DB migration shuffle_questions；SaveQuizBodySchema 與 SQL 查詢更新；QuizBuilderPage checkbox UI + Fisher-Yates shuffle effect；shuffleArray() 提取至 play/utils.ts；後端 3 + 前端 5 個測試通過 | feat/quiz-shuffle（已 merge） |
| 2026-06-23 | 頁面投票結果 CSV 匯出：`GET /api/pdfs/:id/poll-results.csv`，JOIN page_polls+page_poll_votes 統計選項票數，7 欄 CSV；PostClassReportPanel 紫羅蘭色「投票結果 CSV」下載按鈕；4 個後端測試通過（200/空header/404/403） | feat/poll-results-csv（已 merge） |
| 2026-06-23 | 播放頁側邊欄大綱面板：`OutlineSection` 元件（縮圖+頁碼+標題）插入書籤 section 後；`getOutlineTitle()` 優先取 `# ` 標題行，次取逐字稿前 20 字；目前頁 indigo 環高亮；i18n outline* 4 個鍵值 | feat/sidebar-outline-panel（已 merge） |
| 2026-06-23 | AI 問答回覆存為個人筆記：PageAskPanel 回覆卡片底部新增琥珀色「存為筆記」按鈕，追加 Q/A 至 page_notes；2 秒 ok/fail flash；i18n saveAsNote/Done/Fail | feat/ask-save-as-note（已 merge） |

---- 計數重設 ----

## 掃描摘要（2026-06-23 第十五輪）

- 第十四輪 5 個項目全數完成（播放次數統計、測驗隨機排序、投票 CSV、大綱面板、AI 問答存筆記）。
- `QuizBuilderPage` 已有 AI 投票草稿的前例，但測驗題目仍需手動新增，缺少 AI 一鍵草稿。
- 播放頁字幕目前固定顯示在投影片底部，視覺空間受限時（如底部有動畫）遮擋內容。
- `PdfCard` 顯示的是格式化日期（created_at），對當天建立的教材缺乏時效感，改為相對時間（「3 分鐘前」）更直覺。
- 播放頁標題只能在 Settings 對話框修改，常見的快速改名場景需要多步操作。
- 同步模式目前無法從出席名單踢出特定學生，教師缺乏課堂管理控制能力。

## 新增可執行項目（第十五輪）

- [x] 測驗題目 AI 草稿：新增 `POST /api/pdfs/:id/pages/:n/generate-quiz-question` 後端端點，讀取頁面逐字稿/文字，呼叫 LLM 生成一道四選項選擇題（含正確答案索引與解析），回傳 `{ question, options, correct_index, explanation }`；`QuizBuilderPage` 新增「AI 生成一題」按鈕（每次一題，可連續點擊），直接插入題目列表；補後端測試 200 / 404 / 403。
  - 修改說明（2026-06-23）：新增 `backend/src/routes/pdfs/generate-quiz-question.ts` 後端路由，呼叫 LLM 生成四選項題目（含 correct_index 與 explanation）；`index.ts` 新增 import 與 register；前端新增 `generateAiQuizQuestion()` API 函式；`QuizBuilderPage` 新增 `aiQuizPageNumber`/`aiQuizBusy` state 與 `handleAiGenerateQuestion` handler；題目按鈕列加入頁碼數字輸入框 + 紫羅蘭色「AI 生成一題」按鈕；i18n `quiz.aiGenerateQuestion/aiGenerating/aiGenerateFailed/aiGeneratePageLabel/aiGeneratePageSuffix` 新增至 zh-TW 及 en；3 個後端測試（200/404/403）。分支 `feat/quiz-ai-draft-question`，已 merge 回 master。
- [x] 播放頁字幕位置切換：在播放設定對話框新增「字幕位置」選項（底部 / 頂部），存至 localStorage（key: `makeslide.subtitlePosition`）；`PlayPageSlidePanel` 依設定切換字幕區塊的 `top-*` 或 `bottom-*` 絕對定位 class；補 i18n `play.settings.subtitlePosition/Top/Bottom`。
  - 修改說明（2026-06-23）：`i18n.ts` 新增 `SubtitlePosition` 型別、`SUBTITLE_POSITION_STORAGE_KEY`、`getStoredSubtitlePosition()` helper；`PlayPageContext` 介面補 `subtitlePosition`/`setSubtitlePosition`；`PlayPage.tsx` 新增對應 state 並傳入 context；`PlayPageSlidePanel.tsx` 字幕 div 依 `subtitlePosition` 切換 `top-3`/`bottom-3`，設定面板在字幕開啟時顯示底部/頂部按鈕群組並寫入 localStorage；i18n `subtitlePosition/bottom/top` 新增至 zh-TW 及 en。分支 `feat/subtitle-position`，已 merge 回 master。
- [x] 首頁卡片建立時間改為相對顯示：`PdfCard` 目前顯示 `formatDate(pdf.created_at)` 格式化日期，改為 `formatRelativeTime(pdf.created_at)` 相對時間（如「3 分鐘前」、「2 天前建立」），純前端改動；補 i18n `card.createdAt`。
  - 修改說明（2026-06-23）：`PdfCard.tsx` 將 `<span>{formatDate(pdf.created_at)}</span>` 改為使用 `formatRelativeTime(pdf.created_at)`（已有同函式用於 last_played_at）；原始格式化日期保留在 `title` tooltip 中供 hover 查看；i18n `card.createdAt/createdAtLabel` 新增至 zh-TW 及 en。分支 `feat/pdfcard-relative-created-at`，已 merge 回 master。
- [x] 播放頁標題行內編輯：播放頁 header 的標題文字雙擊（dblclick）進入 inline `<input>` 編輯模式，Enter 或失焦時呼叫 `PATCH /api/pdfs/:id/title` 儲存，Escape 取消；補 i18n `play.header.editTitlePlaceholder`。
  - 修改說明（2026-06-23）：`PlayPageHeader.tsx` 移除常駐 `<input>` + 「Update Title」按鈕，改為標題 `<span>`（雙擊進入編輯模式）+ 條件式 `<input>`（Enter/blur commit、Escape cancel）；新增 `editingTitle`/`titleBeforeEdit`/`inlineTitleRef` 狀態與 `startEditTitle`/`commitTitleEdit`/`cancelTitleEdit` handlers；儲存中時顯示行內灰色「儲存中…」文字，`titleBusy` 期間不可重複觸發；i18n `play.header.editTitlePlaceholder`/`editTitleHint` 新增至 zh-TW 及 en；TypeCheck 無誤。分支 `feat/inline-title-edit`，已 merge 回 master。
- [x] 同步模式踢出學生：`PlayPageSlidePanel` 出席名單每位學生旁加入「踢出」按鈕；新增後端 `DELETE /api/pdfs/:id/sync/attendees/:clientId` 端點（owner-only，從 `sync_attendees` 標記封鎖，或直接清除該 client 的 attendee 紀錄）；follower 被踢後下次輪詢 GET /sync/state 可回傳 forbidden 訊號；補後端測試 200 / 403 / 404。
  - 修改說明（2026-06-23）：後端 `sync.ts` 新增 `DELETE /api/pdfs/:id/sync/attendees/:clientId`（owner-only，直接清除出席紀錄）；前端 `kickSyncAttendee()` API 函式；`PlayPageSlidePanel` 引入 `kickSyncAttendee`、新增 `kickingClientId` state 與 `handleKickAttendee` async handler；出席名單每位學生旁加入玫瑰色「踢出」按鈕（踢出中顯示「…」），踢出後立即從本地列表移除；i18n `play.slidePanel.kickAttendee` 新增至 zh-TW 及 en；`sync-attendees.test.ts` 補 3 個 DELETE 測試（200/403/404）。分支 `feat/sync-kick-attendee`，已 merge 回 master。

## 工作記錄（第十五輪）

| 日期 | 工作摘要 | 分支 |
|------|---------|------|
| 2026-06-23 | 首頁卡片建立時間改相對顯示：`formatDate(created_at)` → `formatRelativeTime(created_at)`，原始日期保留為 title tooltip；i18n `card.createdAt/createdAtLabel` | feat/pdfcard-relative-created-at（已 merge） |
| 2026-06-23 | 播放頁字幕位置切換：`SubtitlePosition` 型別+helper；PlayPageContext/PlayPage/SlidePanel 全串接；設定面板底部/頂部按鈕群組；i18n subtitlePosition/bottom/top | feat/subtitle-position（已 merge） |
| 2026-06-23 | 播放頁標題行內編輯：標題改為雙擊進入 inline input，Enter/blur commit，Escape cancel；移除常駐 input+Update 按鈕；儲存中顯示灰色文字；i18n editTitlePlaceholder/editTitleHint | feat/inline-title-edit（已 merge） |
| 2026-06-23 | 測驗題目 AI 草稿：`POST /api/pdfs/:id/pages/:n/generate-quiz-question`（四選項+correct_index+explanation）；`generateAiQuizQuestion()` API 函式；QuizBuilderPage 頁碼選擇器 + 紫羅蘭色按鈕；3 個後端測試通過 | feat/quiz-ai-draft-question（已 merge） |
| 2026-06-23 | 同步模式踢出學生：`DELETE /api/pdfs/:id/sync/attendees/:clientId`（owner-only）；`kickSyncAttendee()` API；SlidePanel 出席名單玫瑰色「踢出」按鈕 + handleKickAttendee；3 個後端測試（200/403/404） | feat/sync-kick-attendee（已 merge） |

---- 計數重設 ----

## 工作記錄（第十六輪）

| 日期 | 工作摘要 | 分支 |
| ---- | -------- | ---- |
| 2026-06-23 | 播放頁嵌入分享 iframe 代碼：ShareDialog 新增 embed tab，iframe snippet textarea，青色「複製嵌入代碼」按鈕 2s flash；i18n tabLink/embedTab/embedCode/copyEmbed/embedCopied | feat/share-embed-code（已 merge） |
| 2026-06-23 | 播放頁頁面重要性旗標：SlidePanel 左下角黃色 ★ 按鈕，localStorage 持久化；Sidebar 新增重要頁面 section（chip 跳頁+×移除）；i18n importantTitle/Empty/mark/unmark | feat/important-pages-flag（已 merge） |
| 2026-06-23 | 同步投票新投票紅點提示：PlayPage 新增 newPollBadge state，follower 模式收到新 activePollId 時在「問答」tab 顯示玫瑰色紅點，點擊清除；i18n pollNewBadge | feat/poll-new-badge（已 merge） |
| 2026-06-23 | 逐字稿 AI 改寫入口：SlidePanel script tab 搜尋框上方插入紫色 AI 改寫區塊，style select（精簡/詳細/對話式）+ 按鈕呼叫 rewritePageScript()，結果顯示 diff 卡片（接受/取消）；i18n rewriteScript* 11 個鍵值 | feat/script-ai-rewrite（已 merge） |
| 2026-06-23 | 首頁 list 模式使用量橫條圖：每列右側 80px 三列橫條圖（sky/emerald/amber = play/pages/audio），以全域 max 做相對比例，hover tooltip 顯示數值；sm 以上顯示 | feat/home-usage-bar-chart（已 merge） |

## 工作記錄（第十七輪）

| 日期 | 工作摘要 | 分支 |
| ---- | -------- | ---- |
| 2026-06-23 | 播放頁 G 鍵跳頁 dialog：gotoPageOpen/Input/Ref state；Enter 跳轉，Escape 關閉；PlayPageHeader 補快捷鍵說明；i18n 4 鍵值 | feat/goto-page-dialog（已 merge） |
| 2026-06-23 | 首頁 list 最後播放時間：formatRelativeTime helper；last_played_at 非空時顯示「最後播放 N 分鐘前」；i18n home.listLastPlayed | feat/list-last-played-at（已 merge） |
| 2026-06-23 | 首頁 list 標籤 chips：pdf.tags 逗號分隔渲染 indigo chip 列，與 PdfCard grid 模式一致 | feat/list-tag-chips（已 merge） |
| 2026-06-23 | 測驗歷史相對時間：formatRelativeTime 替換 toLocaleString()，ⓘ title tooltip 保留完整時間 | feat/quiz-history-relative-time（已 merge） |
| 2026-06-23 | 全螢幕跳頁快捷鍵：gotoPage state 加入 PlayPageContext；PlayPageFullscreen 內渲染 absolute z-50 dialog（native fullscreen 可見）；G 鍵觸發時暫停播放 | feat/fullscreen-goto-key（已 merge） |

## 工作記錄（第十八輪）

| 日期 | 工作摘要 | 分支 |
| ---- | -------- | ---- |
| 2026-06-24 | 首頁 list 模式收藏按鈕：刪除按鈕前插入 ★/☆ 收藏切換按鈕，呼叫 handleToggleFavorite；利用已有 favorites Set state 與 localStorage | feat/list-favorite-button（已 merge） |
| 2026-06-24 | 播放頁逐字稿 tab 一鍵複製：標題列加「📋 複製」按鈕，呼叫 copyTextToClipboard，scriptCopied state 1.5s 後重置；i18n 2 個 key | feat/script-tab-copy-button（已 merge） |
| 2026-06-24 | 播放頁書籤 B 鍵循環跳轉：鍵盤 handler 加 b 鍵，排序 bookmarks 後取下一個大於 currentPageNumber 的頁碼（循環回第一個）；PlayPageHeader 補快捷鍵說明；i18n 1 個 key | feat/bookmark-b-key（已 merge） |
| 2026-06-24 | 首頁統計摘要列：homeStats useMemo（totalPdfs/totalPages/totalPlays/totalAudioMin from items）；visibleSummary 下方插入統計摘要 div；i18n 4 個 key | feat/home-stats-summary（已 merge） |
| 2026-06-24 | 逐字稿搜尋關鍵字全高亮：改用 split(RegExp gi) 切分句子並對所有匹配 part 套 mark 元素；RegExp 特殊字元逃脫防注入 | feat/script-search-highlight-all（已 merge） |

## 掃描摘要（2026-06-23 第十六輪）

- 第十五輪 5 個項目全數完成（AI 草稿投票題、字幕位置切換、相對建立時間、標題行內編輯、踢出學生）。
- 播放頁逐字稿分頁已有 AI 改寫功能（`rewritePageScript`），但尚未在前端側邊欄逐字稿 tab 加入入口。
- 同步課堂中，follower 被踢出後仍可重新加入，缺少「封鎖清單」持久化機制。
- 播放頁嵌入分享（embed）尚無 iframe snippet 生成功能，教師無法將課程嵌入外部頁面。
- 個人化複習清單功能：測驗答錯後尚無「收集到複習清單」並在首頁顯示的完整流程。
- 播放頁頁面重要性旗標尚無實作，教師無法快速標記「必看頁面」。
- 同步場次中，follower 端收到投票的時機依賴輪詢，缺少「有新投票時立即高亮提示」。

## 新增可執行項目（第十六輪）

- [x] 播放頁嵌入分享 iframe 代碼產生器：在 `ShareDialog` 加入「嵌入代碼」tab，自動產生 `<iframe src="..." />` HTML 片段（含 share_url 與建議的 width/height），提供複製按鈕；純前端改動，不需新增後端端點；補 i18n `play.shareDialog.embedTab/embedCode/copyEmbed/embedCopied`。
  - 修改說明（2026-06-23）：`ShareDialog.tsx` 新增 `activeTab`（link/embed）與 `embedCopyStatus` state；dialog 頂部加入 tab 切換列；link tab 保留原有功能；embed tab 顯示 `<iframe src="{shareUrl}" ...>` 代碼的 monospace textarea 與青色「複製嵌入代碼」按鈕（2 秒 flash）；i18n `tabLink/embedTab/embedCode/copyEmbed/embedCopied` 新增至 zh-TW 及 en。分支 `feat/share-embed-code`，已 merge 回 master。
- [x] 播放頁頁面重要性旗標：在 `PlayPageSlidePanel` 投影片左下角加入「★ 標記重要」按鈕，旗標狀態存至 `localStorage`（key: `makeslide.importantPages.{pdfId}`）；在側邊欄書籤 section 下方加入「重要頁面」section，以星號 chip 列出已標記頁面並提供跳頁連結；補 i18n `play.sidebar.importantTitle/importantEmpty/markImportant/unmarkImportant`。
  - 修改說明（2026-06-23）：`PlayPage.tsx` 新增 `importantPagesStorageKey`、`importantPages` state 與 `toggleImportantPage` callback（localStorage 持久化）；`PlayPageContext.tsx` 介面補對應欄位；`PlayPageSlidePanel.tsx` 投影片左下角新增黃色 ★ 按鈕（已標記時 `border-yellow-500/60 text-yellow-300`）；`PlayPageSidebar.tsx` 書籤 section 後新增「重要頁面」section（yellow chip 列 + × 移除 + 跳頁）；i18n `importantTitle/Empty/markImportant/unmarkImportant` 新增至 zh-TW 及 en。分支 `feat/important-pages-flag`，已 merge 回 master。
- [x] 同步投票新投票高亮提示：follower 模式播放中收到新投票（轉換自 `syncState.activePollId` 變化），在 sidebar 投票 tab icon 旁顯示紅點；點擊後清除紅點；純前端改動，利用既有 syncState 輪詢；補 i18n `play.sidebar.pollNewBadge`。
  - 修改說明（2026-06-23）：`PlayPage.tsx` 新增 `newPollBadge` state 與 `clearPollBadge` callback，以 `useEffect` 監聽 `syncDisplayedPollId` 變化，在 `isSyncFollower && activeTab !== 'qa'` 條件下設置紅點；context interface 補 `newPollBadge/clearPollBadge`；tab 按鈕 onClick 呼叫 `clearPollBadge()`，按鈕內渲染 `newPollBadge && <span className="...rose-500" />`；i18n `play.sidebar.pollNewBadge` 新增至 zh-TW 及 en。分支 `feat/poll-new-badge`，已 merge 回 master。
- [x] 播放頁逐字稿 AI 改寫入口：在 `PlayPageSidebar` 逐字稿分頁頂部加入「AI 改寫」按鈕與風格選單（精簡/詳細/對話式），呼叫既有 `rewritePageScript()` API（`POST /api/pdfs/:id/pages/:n/rewrite-script`）；顯示改寫前後 diff（舊→新），提供「接受」與「取消」按鈕；補 i18n `play.sidebar.rewriteScript/rewriteStyle/rewriteAccept/rewriteCancel`。
  - 修改說明（2026-06-23）：`PlayPageSlidePanel.tsx` 新增 `aiRewriteStyle`（compact/detailed/conversational）、`aiRewriteBusy`、`aiRewriteDraft`、`aiRewriteError` state；`handleAiRewriteScript` 以風格對應固定 prompt 呼叫 `rewritePageScript()`；在逐字稿搜尋框上方插入紫色邊框 AI 改寫區塊（style select + 按鈕）；收到結果後顯示 diff 卡片（新稿文字 + 接受（emerald）/取消 按鈕）；Accept 將 editingScript 替換為 draft；i18n `rewriteScript/Busy/StyleLabel/StyleCompact/StyleDetailed/StyleConversational/Accept/Cancel/DiffOld/DiffNew` 新增至 zh-TW 及 en。分支 `feat/script-ai-rewrite`，已 merge 回 master。
- [x] 首頁 PDF 使用量橫條圖：在首頁 list 模式右側（或 grid 模式卡片底部）加入彩色 mini 橫條圖（3 個指標：play_count、total_pages、audio_duration），以各 PDF 的最大值做相對比例；hover 顯示數值 tooltip；純前端改動，利用已有欄位。
  - 修改說明（2026-06-23）：`HomePage.tsx` 新增 `usageBarMaxValues` useMemo（遍歷 categoryGroups 取三指標最大值）；list 模式每列右側加入寬 80px 三列橫條圖（sky=play_count、emerald=page_count、amber=audio_duration），以 max 做相對比例；hover 顯示 tooltip 文字（`group/bar`）；sm 以上才顯示（`hidden sm:flex`）。分支 `feat/home-usage-bar-chart`，已 merge 回 master。

## 掃描摘要（2026-06-23 第十七輪）

- 第十六輪 5 個項目全數完成（嵌入分享、重要頁面旗標、投票紅點提示、逐字稿 AI 改寫、使用量橫條圖）。
- 播放頁目前沒有直接輸入頁碼的跳頁功能，需滾動縮圖列或連按方向鍵才能到達遠處頁面。
- 首頁 list 模式已有 `last_played_at` 欄位但未顯示，使用者無法快速判斷哪份簡報最近播過。
- 首頁 list 模式沒有顯示標籤（tags），grid 模式的 PdfCard 有，造成兩種瀏覽模式資訊不一致。
- QuizBuilderPage 歷史答題 session 列表的 `submitted_at` 以 `toLocaleString()` 顯示，缺乏「3 分鐘前」相對時間感。
- 播放頁全螢幕模式下頁碼顯示已存在（pageNumberLabel），但缺少從全螢幕模式直接跳頁的快捷鍵。

## 新增可執行項目（第十七輪）

- [x] 播放頁跳頁對話框：在 `PlayPage.tsx` 的鍵盤事件 handler 加入 `G` 鍵，彈出一個輸入頁碼的小型 dialog（`<input type="number">`），Enter 確認後跳轉至指定頁（`setCurrentIdx(n-1)`），Escape 取消；同步在 `PlayPageHeader.tsx` 的快捷鍵說明列表補上 `G` 的說明；補 i18n `play.gotoPageDialog/gotoPagePlaceholder/gotoPageConfirm/gotoPageInvalid`；純前端改動。
  - 修改說明（2026-06-23）：`PlayPage.tsx` 新增 `gotoPageOpen/gotoPageInput/gotoPageInputRef` state；G 鍵 handler（`ev.key.toLowerCase() === 'g'`）設置 state 並 focus input；Escape 關閉；dialog 為 `fixed inset-0 z-50` overlay；`PlayPageHeader.tsx` 快捷鍵列表補 G 條目；i18n 4 個鍵值。分支 `feat/goto-page-dialog`，已 merge 回 master。
- [x] 首頁 list 模式最後播放時間：在 list 模式每列的「頁數 · 類別」文字後加入 `· 最後播放：{相對時間}` 顯示（僅當 `last_played_at` 非空時顯示）；`formatRelativeTime` 已在 `PdfCard.tsx` 定義，可提取為共用 helper 或內聯使用；補 i18n `home.listLastPlayed`；純前端改動。
  - 修改說明（2026-06-23）：`HomePage.tsx` 新增本地 `formatRelativeTime` 函式（與 PdfCard 相同邏輯）；list 模式文字行後插入「最後播放 {time}」span（僅 `last_played_at` 非空時顯示）；i18n `home.listLastPlayed` 新增至 zh-TW 及 en。分支 `feat/list-last-played-at`，已 merge 回 master。
- [x] 首頁 list 模式顯示標籤 chips：在 list 模式每列的下方（`p` 元素行之後）加入 `pdf.tags` 的 chip 列（逗號分隔，indigo 樣式，同 PdfCard），當 `pdf.tags` 為空時不顯示；純前端改動，利用已有 `pdf.tags` 欄位。
  - 修改說明（2026-06-23）：`HomePage.tsx` list 模式 `div.min-w-0` 內 `p` 下方新增條件式 chip 列；`pdf.tags` 以逗號分隔 + trim + filter 後渲染 indigo 圓角 span。分支 `feat/list-tag-chips`，已 merge 回 master。
- [x] 測驗歷史答題相對時間：`QuizBuilderPage.tsx` 中歷史答題 session 列表（`historySessions`）的時間顯示由 `new Date(session.submitted_at).toLocaleString()` 改為相對時間格式（`formatRelativeTime`），保留原始時間作 `title` tooltip；純前端改動，提取或複製 PdfCard 的 `formatRelativeTime` 函式。
  - 修改說明（2026-06-23）：`QuizBuilderPage.tsx` 新增 `formatRelativeTime`；`session.submitted_at` 改用相對時間渲染，並在旁邊加入 `ⓘ` 圖示 title tooltip 顯示完整時間。分支 `feat/quiz-history-relative-time`，已 merge 回 master。
- [x] 播放頁全螢幕模式跳頁快捷鍵：在全螢幕模式（`PlayPageFullscreen.tsx`）的鍵盤事件 handler 或現有 `PlayPage.tsx` onKey handler 中加入 `G` 鍵支援，與普通模式共用同一個跳頁 dialog state；確保全螢幕模式中彈出 dialog 時投影片不繼續自動播放（暫停）；純前端改動。
  - 修改說明（2026-06-23）：`PlayPageContext.tsx` 介面新增 `gotoPageOpen/setGotoPageOpen/gotoPageInput/setGotoPageInput/gotoPageInputRef/deckPages/setCurrentIdx`；`PlayPage.tsx` context value 補對應欄位，G 鍵 handler 加入 `if (isPlaying) playPause()` 暫停；`PlayPageFullscreen.tsx` destructure 新增欄位並在 return 結尾渲染 `absolute inset-0 z-50` dialog（確保出現在 native fullscreen 中）。分支 `feat/fullscreen-goto-key`，已 merge 回 master。

## 掃描摘要（2026-06-24 第十八輪）

- 第十七輪 5 個項目全數完成（G 鍵跳頁、list 最後播放、list 標籤、測驗相對時間、全螢幕跳頁）。
- 首頁 list 模式缺少收藏（★）按鈕，grid 模式的 `PdfCard` 有 `handleToggleFavorite`，list 模式未實作。
- `PlayPageSlidePanel.tsx` 逐字稿編輯 tab 本身沒有「一鍵複製」按鈕，`PlayPageHeader.tsx` 有 copy script 功能但位置不直覺。
- 播放頁書籤（Bookmarks）功能已有 DB 儲存與 sidebar 顯示，但缺少 `B` 鍵快速循環跳轉至下一個書籤。
- 首頁沒有統計摘要列（總簡報數、總播放次數等），使用者無法一眼看到整體狀況。
- `QuizBuilderPage` 出題時無計時限制設定，所有測驗使用者可無限時作答；部分使用情境需要限時。

## 新增可執行項目（第十八輪）

- [x] 首頁 list 模式收藏按鈕：在 list 模式每列的右側加入 ★ 收藏切換按鈕（同 `PdfCard` 的 `handleToggleFavorite` 邏輯），點擊時呼叫 `toggleFavorite` API 並更新本地 state；純前端改動。
  - 修改說明（2026-06-24）：`HomePage.tsx` list 模式刪除按鈕前插入 ★/☆ 收藏按鈕，呼叫已有的 `handleToggleFavorite`；已有 `favorites` Set state 與 localStorage 同步；i18n key `card.favorite/unfavorite` 已存在。分支 `feat/list-favorite-button`，已 merge 回 master。
- [x] 播放頁逐字稿 tab 一鍵複製：在 `PlayPageSlidePanel.tsx` 的逐字稿編輯區塊（script edit tab）頂部加入「複製」按鈕，複製 `editingScript` 到剪貼簿，短暫顯示「已複製！」提示；補 i18n；純前端改動。
  - 修改說明（2026-06-24）：`PlayPageSlidePanel.tsx` 新增 `scriptCopied` state；在逐字稿標題列右側加入「📋 複製」按鈕，呼叫已有的 `copyTextToClipboard`，1.5s 後重置 `scriptCopied`；i18n `play.slidePanel.transcript.copyScript/copyScriptDone` 新增至 zh-TW 及 en。分支 `feat/script-tab-copy-button`，已 merge 回 master。
- [x] 播放頁書籤 B 鍵循環跳轉：在 `PlayPage.tsx` 的鍵盤 handler 加入 `B` 鍵，按下時從 `bookmarks` 陣列中找出下一個大於 `currentIdx` 的書籤頁，若無則循環回第一個（`setCurrentIdx`）；在快捷鍵說明中補 `B` 的說明；補 i18n；純前端改動。
  - 修改說明（2026-06-24）：`PlayPage.tsx` 鍵盤 handler 加入 `b` 鍵分支：排序 bookmarks 後找第一個 `> currentPageNumber` 的頁碼，否則取 `sorted[0]`（循環），`next !== undefined` 防衛後呼叫 `setCurrentIdx(next - 1)`；`PlayPageHeader.tsx` 快捷鍵列表新增 B 項；i18n `play.shortcuts.nextBookmark` 新增至 zh-TW 及 en。分支 `feat/bookmark-b-key`，已 merge 回 master。
- [x] 首頁統計摘要列：在 `HomePage.tsx` 頁面頂部（搜尋列之下、簡報格之上）新增一列統計資訊（總簡報數、總頁數、總播放次數），從已有的 `pdfs` state 即可計算，無需新 API；純前端改動。
  - 修改說明（2026-06-24）：`HomePage.tsx` 新增 `homeStats` useMemo（totalPdfs/totalPages/totalPlays/totalAudioMin from `items`）；在 `visibleSummary` 段落後插入統計摘要 div，以 `·` 分隔各項，語音分鐘數為 0 時不顯示；i18n `home.stats.*` 4 個 key 新增至 zh-TW 及 en。分支 `feat/home-stats-summary`，已 merge 回 master。
- [x] 播放頁逐字稿搜尋關鍵字高亮：`PlayPageSlidePanel.tsx` 已有搜尋框，但目前只是 filter 顯示列，搜尋時讓匹配到的關鍵字在文字中以黃色高亮顯示（`<mark>` 或 span），提升可讀性；純前端改動。
  - 修改說明（2026-06-24）：原本搜尋結果只高亮每句的第一個匹配（`indexOf`）；改用 `String.prototype.split(RegExp)` 加 `gi` 旗標將句子切分成 parts 陣列，並用 `<mark>` 渲染所有匹配的 part（case-insensitive 比對）；加入 `replace(/[.*+?^${}()|[\]\\]/g, '\\$&')` 逃脫 RegExp 特殊字元。分支 `feat/script-search-highlight-all`，已 merge 回 master。

## 掃描摘要（2026-06-24 第十九輪）

- 第十八輪 5 個項目全數完成（list 收藏、逐字稿複製、B 鍵書籤、首頁統計摘要、搜尋全高亮）。
- 首頁排序選項缺少「最近播放時間（由新到舊）」，`compareByLastPlayedAtDesc` 函式已存在但未加入 `SortMode` 下拉選單。
- `PlayPageFullscreen.tsx` 的字幕渲染使用硬寫的 `bottom-4` 和 `text-base md:text-lg`，完全未讀取 `subtitleSize` / `subtitlePosition` context 值，導致側邊欄設定對全螢幕字幕無效。
- `PlayPageSlidePanel.tsx` 逐字稿編輯區底部只有「儲存提示」，缺少即時字數統計與預估講解時長（粗估 4 字/秒）。
- 首頁 list 模式每列外層 `div` 只有 `onClick`，缺少 `tabIndex` 和 `onKeyDown` Enter 鍵處理，滑鼠以外的使用者無法操作。
- `QuizBuilderPage` 儲存的測驗集列表（`savedQuizzes`）沒有搜尋/過濾框，題庫多時難以找到指定測驗。

## 新增可執行項目（第十九輪）

- [x] 首頁排序加入「最近播放」選項：在 `SortMode` union 新增 `last_played_desc`，對應 `compareByLastPlayedAtDesc`；`SORT_MODES` 陣列和 switch 補 case；`home.sort.lastPlayedDesc` i18n；純前端改動。
  - 修改說明（2026-06-24）：`HomePage.tsx` SortMode union + SORT_MODES + getComparatorForSortMode switch case 新增 `last_played_desc`；select option 新增；i18n 2 個 key。分支 `feat/home-sort-last-played`，已 merge 回 master。
- [x] 全螢幕字幕大小和位置設定生效：在 `PlayPageFullscreen.tsx` 從 context destructure `subtitleSize` / `subtitlePosition`，依 size 套用 `text-xs/sm`、`text-base/lg`、`text-lg/2xl` CSS，依 position 切換 `bottom-4` / `top-4`；純前端改動。
  - 修改說明（2026-06-24）：`PlayPageFullscreen.tsx` destructure `subtitleSize/subtitlePosition`；字幕 wrapper div 改以 `subtitlePosition` 切換 `top-4`/`bottom-4`；文字 div 改以 `subtitleSize` 套用 `text-xs md:text-sm`/`text-sm md:text-base`/`text-base md:text-xl`。分支 `feat/fullscreen-subtitle-settings`，已 merge 回 master。
- [x] 逐字稿編輯區字數與預估時長：在 `PlayPageSlidePanel.tsx` 逐字稿 textarea 下方（儲存提示同列左側）顯示當前 `editingScript` 的字數和預估講解秒數（字數 ÷ 4，以 `mm:ss` 格式顯示）；純前端改動。
  - 修改說明（2026-06-24）：`PlayPageSlidePanel.tsx` 儲存提示 div 後插入 IIFE 計算 chars/4 秒數並格式化為 `mm:ss`；i18n `play.slidePanel.transcript.charCount`。分支 `feat/script-char-count`，已 merge 回 master。
- [x] 首頁 list 模式鍵盤可聚焦：對 list 模式每列外層 div 加入 `tabIndex={0}` 及 `onKeyDown` Enter 鍵呼叫 `handleCardClick(pdf)`，使鍵盤用戶可以 Tab 移動並 Enter 開啟；純前端改動。
  - 修改說明（2026-06-24）：`HomePage.tsx` list 模式每列 div 加入 `role="button" tabIndex={0} onKeyDown Enter/Space` 及 focus ring；純 HTML/ARIA 改動。分支 `feat/list-keyboard-nav`，已 merge 回 master。
- [x] QuizBuilderPage 測驗集搜尋：在 `savedQuizzes` 清單頂部加入搜尋輸入框，以 `quiz.title` 關鍵字過濾顯示；補 i18n；純前端改動。
  - 修改說明（2026-06-24）：`QuizBuilderPage.tsx` 新增 `savedQuizzesSearch` state；測驗集 > 3 時顯示搜尋框；`.filter()` 以 title 關鍵字（大小寫忽略）過濾；i18n `quiz.searchQuizzes`。分支 `feat/quiz-saved-search`，已 merge 回 master。

## 工作記錄（第十九輪）

| 日期 | 工作摘要 | 分支 |
| ---- | -------- | ---- |
| 2026-06-24 | 首頁排序加入「最近播放優先」選項：SortMode 新增 last_played_desc；複用 compareByLastPlayedAtDesc；i18n 2 key | feat/home-sort-last-played（已 merge） |
| 2026-06-24 | 全螢幕字幕設定生效：destructure subtitleSize/subtitlePosition；依設定動態切換 top/bottom 位置與 xs/sm/base/xl 字體大小 | feat/fullscreen-subtitle-settings（已 merge） |
| 2026-06-24 | 逐字稿字數與預估時長：chars÷4 計算 mm:ss 預估；儲存提示旁顯示字數與時長；i18n 1 key | feat/script-char-count（已 merge） |
| 2026-06-24 | list 模式鍵盤可聚焦：tabIndex={0} + role=button + onKeyDown Enter/Space + focus ring | feat/list-keyboard-nav（已 merge） |
| 2026-06-24 | QuizBuilderPage 測驗集搜尋：savedQuizzesSearch state + > 3 才顯示框 + filter by title | feat/quiz-saved-search（已 merge） |

## 掃描摘要（2026-06-24 第二十輪）

- 第十九輪 5 個項目全數完成（最近播放排序、全螢幕字幕設定生效、字數統計、list 鍵盤聚焦、測驗集搜尋）。
- 首頁標籤過濾目前 `tagFilter` 為單一 string，每次只能啟用一個標籤，無法同時篩選多個。
- `PlayPage.tsx` 鍵盤 handler 未處理 `I` 鍵，但 `toggleImportantPage` 函式已存在，可作為快捷鍵。
- `PlayPageHeader.tsx` 有「複製目前頁逐字稿」按鈕，但沒有「複製全部頁面逐字稿」按鈕；側邊欄有「複製全部筆記」作為參考。
- 首頁 list 模式已顯示 `last_played_at` 相對時間，但沒有類似「近期播放」視覺標記，難以一眼識別。
- `QuizBuilderPage` 答題記錄一次性顯示所有 session，記錄多時需大量捲動；缺少折疊/顯示更多機制。

## 新增可執行項目（第二十輪）

- [x] 首頁標籤多選過濾：將 `tagFilter: string` 改為 `tagFilter: Set<string>`，讓多個標籤可同時啟用（顯示所有已選標籤皆有的簡報）；點擊已選標籤可取消；補 i18n；純前端改動。
  - 修改說明（2026-06-24）：`HomePage.tsx` tagFilter 改 `Set<string>`；filter 以 `every()` 做 AND 邏輯；All 按鈕 `new Set()`；tag 按鈕 prev-Set toggle；i18n 無需新增。分支 `feat/home-tag-multiselect`，已 merge 回 master。
- [x] 播放頁 I 鍵切換重要頁面：在 `PlayPage.tsx` 鍵盤 handler 加入 `I` 鍵，呼叫 `toggleImportantPage(currentPage.page_number)`；在快捷鍵說明中補 `I` 的說明；純前端改動。
  - 修改說明（2026-06-24）：`PlayPage.tsx` `i` key handler；`PlayPageHeader.tsx` shortcuts array 補 `I` 項目。分支 `feat/important-page-i-key`，已 merge 回 master。
- [x] 播放頁複製全部逐字稿：在 `PlayPageHeader.tsx` 加入「複製全部逐字稿」按鈕，將所有頁面的 scripts 依頁碼排序後串接（每頁前加 `## 第 N 頁` 標題），複製到剪貼簿；補 i18n；純前端改動。
  - 修改說明（2026-06-24）：`PlayPageHeader.tsx` 新增 `copyAllScriptsStatus` state + button；頁面依 page_number 排序後 join；i18n `play.header.copyAllScripts/Done`。分支 `feat/copy-all-scripts`，已 merge 回 master。
- [x] 首頁 list 模式「最近播放」綠點標記：對 `isRecentlyPlayed(pdf)` 為 true 的 list 列加入小綠點 badge（類似書籤的紅點），不影響既有的相對時間文字顯示；純前端改動。
  - 修改說明（2026-06-24）：`HomePage.tsx` list 模式 title `<p>` 改 flex + gap；`isRecentlyPlayed()` 為 true 時插入 `h-2 w-2 bg-emerald-400` 圓點；i18n `home.recentlyPlayedBadge`。分支 `feat/list-recently-played-dot`，已 merge 回 master。
- [x] QuizBuilderPage 答題記錄折疊：`historySessions` 列表預設只顯示最近 5 筆，超過時顯示「顯示更多（共 N 筆）」按鈕；點擊後展開顯示全部；補 i18n；純前端改動。
  - 修改說明（2026-06-24）：`QuizBuilderPage.tsx` 新增 `historyShowAll` state；map 改 slice(0,5)；超過 5 筆顯示 toggle button；i18n `quiz.historyShowMore/Less`。分支 `feat/quiz-history-collapse`，已 merge 回 master。

## 工作記錄（第二十輪，2026-06-24）

| 日期 | 工作內容 | 分支 |
|------|----------|------|
| 2026-06-24 | 首頁標籤多選：tagFilter 改 Set<string>，AND 邏輯過濾，toggle 選取/取消 | feat/home-tag-multiselect（已 merge） |
| 2026-06-24 | 播放頁 I 鍵快捷鍵：toggleImportantPage 綁 I 鍵；shortcuts 說明補 I 項 | feat/important-page-i-key（已 merge） |
| 2026-06-24 | 複製全部逐字稿按鈕：所有頁面 scripts 排序後 join，## 第 N 頁標題 | feat/copy-all-scripts（已 merge） |
| 2026-06-24 | list 模式最近播放綠點：isRecentlyPlayed() 為 true 顯示 emerald-400 圓點 | feat/list-recently-played-dot（已 merge） |
| 2026-06-24 | 答題記錄折疊：預設顯示 5 筆，超過時顯示「顯示更多（共 N 筆）」toggle | feat/quiz-history-collapse（已 merge） |

## 掃描摘要（2026-06-24 第二十一輪）

- 第二十輪 5 個項目全數完成（標籤多選、I 鍵快捷、複製全部稿、list 綠點、答題記錄折疊）。
- 首頁篩選同時有 categoryFilter、tagFilter、titleFilter、sortMode 四個維度，但沒有一鍵重設按鈕。
- QuizBuilderPage 答題記錄只列 session 列表，沒有顯示整體平均得分的摘要統計。
- 首頁 list 模式只顯示標題與時間，card 模式才有標籤 pill；list 模式缺少標籤可見性。
- PlayPageSlidePanel 缺少直接跳到指定頁碼的快速輸入框（目前需點縮圖一頁一頁捲）。
- 播放頁側邊欄的筆記編輯區沒有字數統計（script 編輯區第 19 輪已加過，note 區尚未加）。

## 新增可執行項目（第二十一輪）

- [x] 首頁一鍵清除所有篩選：當 categoryFilter/tagFilter/titleFilter 任一非預設時，在篩選列右側顯示「× 清除篩選」按鈕，一次重設全部篩選條件及排序；補 i18n；純前端改動。
  - 修改說明（2026-06-24）：`HomePage.tsx` 新增 `clearAllFilters` callback；條件判斷 categoryFilter/tagFilter/sortMode；按鈕插入 view mode div；i18n `home.clearAllFilters`。分支 `feat/home-clear-filters`，已 merge 回 master。
- [x] QuizBuilderPage 答題記錄平均得分摘要：在答題記錄列表頂部（historySessions 不為空時）顯示「共 N 次作答，平均得分 X.X 分」的摘要行，從 sessions.attempts[].score 計算；補 i18n；純前端改動。
  - 修改說明（2026-06-24）：`QuizBuilderPage.tsx` IIFE 計算 flatMap 所有 attempts，filter score != null，計算平均後 replace 字串；i18n `quiz.historyAvgScore`。分支 `feat/quiz-history-avg-score`，已 merge 回 master。
- [x] 首頁 list 模式標籤 pill 可點擊過濾：list 模式每列的標籤 pill 已存在；改為 `<button>` 元素，點擊可 toggle tagFilter Set（已選則高亮）；e.stopPropagation() 避免觸發行點擊；純前端改動。
  - 修改說明（2026-06-24）：`HomePage.tsx` list 模式標籤 `<span>` 改 `<button>`，onClick toggle tagFilter Set，active 時高亮樣式。分支 `feat/list-mode-tags`，已 merge 回 master。
- [x] PlayPageSidebar 筆記字數統計：在 `PlayPageSidebar.tsx` 筆記 textarea 下方加入「N / 5000」字數顯示，與儲存提示並排；pure frontend；無需新 i18n。
  - 修改說明（2026-06-24）：`PlayPageSidebar.tsx` 將 noteBusy/noteMsg 改為 flex row；右側顯示 `noteText.length / 5000` 字數（noteText 非空才顯示）。分支 `feat/slide-panel-jump-to-page`，已 merge 回 master。
- [x] 播放頁筆記字數統計（合併於上一項）：與 PlayPageSidebar 筆記字數統計同分支實作完成。

## 工作記錄（第二十一輪，2026-06-24）

| 日期 | 工作內容 | 分支 |
|------|----------|------|
| 2026-06-24 | 首頁一鍵清除篩選：clearAllFilters callback + 條件顯示 × 清除篩選 button | feat/home-clear-filters（已 merge） |
| 2026-06-24 | Quiz 答題記錄平均得分：flatMap 所有 attempts 計算平均；historyAvgScore i18n | feat/quiz-history-avg-score（已 merge） |
| 2026-06-24 | list 模式標籤可點擊：span 改 button，toggle tagFilter Set，active 高亮 | feat/list-mode-tags（已 merge） |
| 2026-06-24 | 筆記字數統計：PlayPageSidebar noteText.length / 5000 顯示，與儲存提示並排 | feat/slide-panel-jump-to-page（已 merge） |

## 掃描摘要（2026-06-24 第二十二輪）

- 第二十一輪 5 個項目全數完成（清除篩選、Quiz 平均分、list 標籤可點擊、筆記字數統計）。
- 首頁 grid 模式 PdfCard 不顯示 description，但 list 模式有；grid 使用者無法看到 description 資訊。
- PlayPageHeader 有「建立分享連結」功能，但連結生成後沒有一鍵複製按鈕，需手動選取 URL。
- QuizBuilderPage 測驗集搜尋只有無結果時不顯示任何提示，使用者不知道是篩選導致還是真的空的。
- PlayPageSidebar 書籤與重要頁面 section header 不顯示計數，需展開才知道有幾筆。
- 首頁篩選後零結果只顯示通用訊息，沒有建議清除篩選的行動呼籲。

## 新增可執行項目（第二十二輪）

- [x] QuizBuilderPage 搜尋零結果提示：當 `savedQuizzesSearch` 非空但過濾結果為空時，顯示「找不到符合「...」的測驗集」；補 i18n；純前端改動。
  - 修改說明（2026-06-24）：`QuizBuilderPage.tsx` 在 filter map 前加 some() 判斷；若無符合則顯示 `quiz.searchNoResults` 字串（含 {q} 替換）。分支 `feat/quiz-search-empty-state`，已 merge 回 master。
- [x] PlayPageSidebar 書籤/重要頁面計數徽章：在 Bookmarks 和 Important Pages section header 旁加入計數徽章，section 折疊時也可見；純前端改動。
  - 修改說明（2026-06-24）：`PlayPageSidebar.tsx` h2 改 flex；bookmarks.length > 0 時顯示 amber 徽章；importantPages.length > 0 時顯示 yellow 徽章。分支 `feat/sidebar-count-badges`，已 merge 回 master。
- [x] PlayPageSlidePanel QR Code 展示區複製連結按鈕：shareUrl 顯示時，在文字下方加入「複製連結」按鈕；補 i18n 2 個 key；純前端改動。
  - 修改說明（2026-06-24）：`PlayPageSlidePanel.tsx` 新增 shareUrlCopied state；shareUrl 文字改 flex column；加 button 點擊複製並 2s 後重置；i18n `play.slidePanel.copyShareLink/shareLinkCopied`。分支 `feat/copy-share-link`，已 merge 回 master。
- [x] 首頁 grid 模式 PdfCard 已顯示 description（既有功能）；改為「篩選零結果時加清除篩選提示」；純前端改動。
  - 修改說明（2026-06-24）：`HomePage.tsx` 空狀態 div 中，tagFilter.size > 0 || titleFilter.length > 0 時顯示清除篩選 button（複用 clearAllFilters + home.clearAllFilters i18n）。分支 `feat/grid-card-description`，已 merge 回 master。
- [x] 首頁篩選零結果時建議清除（與上一項合併實作）。

## 工作記錄（第二十二輪，2026-06-24）

| 日期 | 工作內容 | 分支 |
|------|----------|------|
| 2026-06-24 | Quiz 測驗集搜尋零結果提示：some() 判斷 + searchNoResults i18n | feat/quiz-search-empty-state（已 merge） |
| 2026-06-24 | Sidebar 書籤/重要頁面計數徽章：h2 flex + amber/yellow 徽章 | feat/sidebar-count-badges（已 merge） |
| 2026-06-24 | QR Code 區複製連結按鈕：shareUrlCopied state + button + 2 個 i18n key | feat/copy-share-link（已 merge） |
| 2026-06-24 | 篩選零結果加清除篩選按鈕：tagFilter/titleFilter 有值時顯示清除 button | feat/grid-card-description（已 merge） |

## 掃描摘要（2026-06-24 第二十三輪）

- 第二十二輪 5 個項目全數完成（Quiz 搜尋空態、Sidebar 計數徽章、QR 複製連結、清除篩選在空態）。
- PlayPageFullscreen 退出按鈕沒有說明 Esc 快捷鍵；用戶不知道可按 Esc 退出全螢幕。
- HomePage list 模式標籤按鈕已可點擊，但缺少按下視覺回饋（active 縮放/動畫）。
- QuizBuilderPage 保存測驗後不會自動選中，使用者需手動在列表中找到剛存的測驗。
- PdfCard grid 模式的標籤 pill 是 span（不可點擊），但 list 模式已改為可點擊 button；兩者行為不一致。
- QuizBuilderPage 沒有「複製所有題目」功能，無法快速把題目文本複製到剪貼簿。

## 新增可執行項目（第二十三輪）

- [x] PlayPageFullscreen 退出按鈕加 Esc 提示：在退出全螢幕按鈕的 title/tooltip 加入「(Esc)」說明；純前端改動，無需 i18n。
  - 修改說明（2026-06-24）：`PlayPageFullscreen.tsx` exit button 加 `title="Esc"` 及按鈕內 `(Esc)` span 文字提示。分支 `feat/fullscreen-esc-tooltip`，已 merge 回 master。
- [x] HomePage list 模式標籤按鈕按下動畫：對標籤 button 加入 `active:scale-95` 樣式；純前端改動。
  - 修改說明（2026-06-24）：`HomePage.tsx` list 模式標籤 className 加入 `active:scale-95`。分支 `feat/list-tag-active-animation`，已 merge 回 master。
- [x] PdfCard grid 模式標籤可點擊：與 list 模式一致，card 標籤改 `<button>`；新增 `onTagFilter`/`activeTagFilters` props；HomePage 傳入 handler；純前端改動。
  - 修改說明（2026-06-24）：`PdfCard.tsx` 新增 2 props；tag 改 button；`HomePage.tsx` 傳入 onTagFilter/activeTagFilters。分支 `feat/quiz-auto-select-saved`，已 merge 回 master。
- [x] QuizBuilderPage 保存後自動選中（既有功能）：line 636 `handleSave` 已自動 `setSelectedQuizId(saved.id)`，無需實作。
- [x] QuizBuilderPage 複製所有題目按鈕：在測驗編輯器按鈕列加入「複製所有題目」；格式化題目文字（題號、選項、✓ 標記、解說）後複製；補 i18n 3 key；純前端改動。
  - 修改說明（2026-06-24）：`QuizBuilderPage.tsx` 新增 `copyQuestionsStatus` state + button；import `copyTextToClipboard`；i18n `quiz.copyQuestions/Done/Fail`。分支 `feat/quiz-copy-all-questions`，已 merge 回 master。

## 工作記錄（第二十三輪，2026-06-24）

| 日期 | 工作內容 | 分支 |
|------|----------|------|
| 2026-06-24 | 全螢幕退出按鈕加 (Esc) 提示：title + span 文字 | feat/fullscreen-esc-tooltip（已 merge） |
| 2026-06-24 | list 標籤按下動畫：active:scale-95 | feat/list-tag-active-animation（已 merge） |
| 2026-06-24 | PdfCard grid 標籤可點擊：onTagFilter/activeTagFilters props + button | feat/quiz-auto-select-saved（已 merge） |
| 2026-06-24 | Quiz 複製所有題目：格式化題目文字 + 複製；3 個 i18n key | feat/quiz-copy-all-questions（已 merge） |

## 掃描摘要（2026-06-24 第二十四輪）

- 第二十三輪 4 個項目實作完成（全螢幕 Esc 提示、list 標籤動畫、grid 標籤可點擊、Quiz 複製題目）。
- PlayPageSidebar 書籤/重要頁面只能逐一點選跳頁，沒有「複製頁碼清單」功能以方便記錄分享。
- QuizBuilderPage 題目只能複製純文字，缺少 JSON 格式下載（可用於備份或匯入其他系統）。
- 首頁收藏過濾切換有按鈕，但沒有在按鈕旁顯示目前收藏數量（只知道有/無收藏，不知道幾筆）。
- PlayPageSlidePanel 逐字稿搜尋在換頁後 index 重置，搜尋詞不跨頁保留。
- PlayPageHeader 分享狀態（公開/私密/可編輯）在畫面上只有建立連結表單，沒有明確顯示目前狀態的標籤。

## 新增可執行項目（第二十四輪）

- [x] PlayPageSidebar 複製書籤/重要頁面頁碼清單：書籤/重要頁面 section header 各加「複製清單」按鈕；i18n 3 key；純前端改動。
  - 修改說明（2026-06-24）：`PlayPageSidebar.tsx` 加 bookmarkCopyMsg/importantCopyMsg state；兩個 section header 各加 button；i18n `play.sidebar.copyList/Done/Fail`。分支 `feat/sidebar-copy-page-list`，已 merge 回 master。
- [x] QuizBuilderPage JSON 匯出：按鈕列加「匯出 JSON」；Blob + URL.createObjectURL 下載；i18n `quiz.exportJson`；純前端改動。
  - 修改說明（2026-06-24）：`QuizBuilderPage.tsx` 新增 export button；Blob 下載；i18n 1 key。分支 `feat/quiz-export-json`，已 merge 回 master。
- [x] 首頁收藏按鈕顯示數量：收藏按鈕內加入 `favorites.size` 徽章（amber 背景）；純前端改動。
  - 修改說明（2026-06-24）：`HomePage.tsx` favoritesOnly button 文字後加 span 顯示 `favorites.size`。分支 `feat/home-favorites-count`，已 merge 回 master。
- [x] PlayPageHeader 目前分享狀態標籤：在分享表單上方加 visibility 狀態 span（🔒/🌐/✏️）；i18n 3 key；純前端改動。
  - 修改說明（2026-06-24）：`PlayPageHeader.tsx` 在 !currentShareToken div 前加狀態 span；i18n `play.share.statusPrivate/Public/Editable`。分支 `feat/play-share-status-badge`，已 merge 回 master。
- [x] PlayPageSlidePanel 逐字稿搜尋跨頁自動回到第一結果：換頁時 useEffect reset scriptSearchIdx → 0（若有搜尋詞）；純前端改動。
  - 修改說明（2026-06-24）：`PlayPageSlidePanel.tsx` 新增 useEffect([currentIdx]) reset scriptSearchIdx。分支 `feat/script-search-persist`，已 merge 回 master。

## 工作記錄（第二十四輪，2026-06-24）

| 日期 | 工作內容 | 分支 |
|------|----------|------|
| 2026-06-24 | Sidebar 複製書籤/重要頁面清單：copyList button + 3 i18n key | feat/sidebar-copy-page-list（已 merge） |
| 2026-06-24 | Quiz JSON 匯出：Blob 下載 + quiz.exportJson i18n | feat/quiz-export-json（已 merge） |
| 2026-06-24 | 首頁收藏計數徽章：favorites.size span in favoritesOnly button | feat/home-favorites-count（已 merge） |
| 2026-06-24 | Play header 分享狀態標籤：visibility span + 3 i18n key | feat/play-share-status-badge（已 merge） |
| 2026-06-24 | 逐字稿搜尋換頁回第一結果：useEffect([currentIdx]) reset index | feat/script-search-persist（已 merge） |

## 掃描摘要（2026-06-24 第二十五輪）

- 第二十四輪 5 個項目全數完成（Sidebar 複製清單、Quiz JSON 匯出、收藏計數、分享狀態標籤、搜尋換頁重置）。
- `PlayPageFullscreen.tsx` 全螢幕模式只有手勢換頁，沒有滑鼠可見的 prev/next 按鈕；滑鼠操作不直覺。
- `SettingsPage.tsx` OpenAI/Gemini API Key 輸入框沒有即時格式指示，使用者不確定填入的 key 格式是否正確。
- `PlayPageHeader.tsx` 行內標題編輯有 maxLength=200 但無字數顯示，接近上限時無警告。
- `PlayPageSidebar.tsx` 瀏覽到有筆記的頁面時，sidebar 無任何視覺提示；使用者容易遺漏既有筆記。
- `QuizBuilderPage.tsx` 測驗集列表只顯示標題，沒有題目數量 badge，難以快速比較各測驗的規模。

## 新增可執行項目（第二十五輪）

- [x] PlayPageFullscreen 兩側換頁按鈕：全螢幕模式投影片左右各加半透明 prev/next 按鈕，hover 時以 `opacity-0 hover:opacity-100` 淡入，點擊換頁；不干擾手勢滑動；純前端改動，沿用 `play.slidePanel.prevPage/nextPage` i18n。
  - 修改說明（2026-06-24）：`PlayPageFullscreen.tsx` 在暫停圓形 icon 後加入條件渲染（`fullscreenLayout === 'image' && !drawingMode`），左右各一個 `absolute` 全高按鈕（`w-14 h-full opacity-0 hover:opacity-100`），內含圓形半透明 icon；disabled 時 `pointer-events-none`。分支 `feat/fullscreen-nav-buttons`，已 merge 回 master。
- [x] SettingsPage API Key 格式指示 icon：OpenAI key 輸入框右側加格式 icon（輸入以 `sk-` 開頭時顯示 ✓、空白時顯示 -、其他顯示 ?），Gemini 以 `AIza` 開頭判斷；純前端靜態驗證，不呼叫 API；補 i18n `settings.apiKeyValid/Invalid/Empty`。
  - 修改說明（2026-06-24）：`SettingsPage.tsx` OPENAI_API_KEY 與 GEMINI_API_KEY `<label>` 改 `<span className="flex items-center gap-1.5">`，根據 `openaiApiKey`/`geminiApiKey` 值以三元運算渲染 `✓`（emerald）、`?`（amber）或 `—`（slate）的 title tooltip span；i18n 各補 3 個 `settings.apiKey*` 鍵值。分支 `feat/settings-apikey-validation`，已 merge 回 master。
- [x] PlayPageHeader 標題編輯字數顯示：行內標題編輯模式啟用時，在輸入框旁顯示「N/200」字數統計；字數 > 150 時文字轉 amber 色；純前端改動。
  - 修改說明（2026-06-24）：`PlayPageHeader.tsx` 行內編輯 `<input>` 包入 `<>...</>`，輸入框後加 `<span className="shrink-0 text-[11px] tabular-nums {amber/slate}">{titleInput.length}/200</span>`；>150 字時 amber-400，否則 slate-500。分支 `feat/title-edit-char-count`，已 merge 回 master。
- [x] PlayPageSidebar 有筆記頁面指示點：PageNoteSection 標題旁加入小圓點（emerald），當目前頁面的 `currentPage?.page_notes?.trim()` 非空時顯示，提示此頁已有筆記；純前端改動，無需 i18n。
  - 修改說明（2026-06-24）：`PlayPageSidebar.tsx` `PageNoteSection` h2 改 `flex items-center gap-1.5`，條件渲染 `h-2 w-2 rounded-full bg-emerald-400`（有筆記時）。分支 `feat/sidebar-note-indicator`，已 merge 回 master。
- [x] QuizBuilderPage 測驗題目數量 badge：在 `savedQuizzes` 列表每個測驗標題右側加入灰色 badge 顯示題目數量；若 `questions` 為空不顯示；沿用已有 `quiz.questionCount` i18n；純前端改動。
  - 修改說明（2026-06-24）：`QuizBuilderPage.tsx` 測驗列表按鈕內部由兩個 `<span>` 改為 flex row，標題後加 `rounded-full bg-slate-700/80 px-1.5 py-0.5 text-[10px]` 的題數 badge（`quiz.questions.length > 0` 才顯示）；原本在標題下方的文字行已移除。分支 `feat/quiz-question-count-badge`，已 merge 回 master。

## 工作記錄（第二十五輪，2026-06-24）

| 日期 | 工作內容 | 分支 |
|------|----------|------|
| 2026-06-24 | PlayPageFullscreen 兩側 hover 換頁按鈕：image 模式加 absolute 全高 prev/next 按鈕（opacity-0 hover:opacity-100），disabled 時 pointer-events-none | feat/fullscreen-nav-buttons（已 merge） |
| 2026-06-24 | SettingsPage API Key 格式 icon：OpenAI（sk- prefix）與 Gemini（AIza prefix）輸入框標籤加 ✓/—/? icon；i18n apiKeyValid/Invalid/Empty 3 個 key | feat/settings-apikey-validation（已 merge） |
| 2026-06-24 | PlayPageHeader 標題字數統計：行內編輯模式加 N/200 字數 span；>150 字轉 amber-400 | feat/title-edit-char-count（已 merge） |
| 2026-06-24 | PlayPageSidebar 有筆記小點：PageNoteSection h2 加條件 emerald 圓點（page_notes 非空時） | feat/sidebar-note-indicator（已 merge） |
| 2026-06-24 | QuizBuilderPage 測驗題目數 badge：標題行改 flex，右側加圓角灰色題數 badge（questions.length > 0 才顯示） | feat/quiz-question-count-badge（已 merge） |

## 掃描摘要（2026-06-24 第二十六輪）

- 第二十五輪 5 個項目全數完成（全螢幕換頁按鈕、API Key 格式 icon、標題字數、筆記小點、題目數 badge）。
- `PlayPageSidebar.tsx` QA/投票 tab 按鈕沒有未讀問題計數，教師切換其他分頁時不知道有新提問。
- `QuizBuilderPage.tsx` 編輯器缺少「一鍵清除所有題目」按鈕，需逐題手動刪除才能重置。
- 首頁批次選取模式沒有「全選/取消全選」快捷按鈕，多張簡報時需逐一勾選。
- `PlayPageSlidePanel.tsx` 控制列沒有目前播放速率文字指示（如 `1.0×`），使用者只能進設定才知道目前速率。
- `PlayPageSidebar.tsx` 書籤列表以加入順序排列，頁面多時難以定位；按頁碼升序排列更直覺。

## 新增可執行項目（第二十六輪）

- [x] PlayPageSidebar QA/問答 tab 問題計數 badge：當 `syncFollowerQuestions` 有內容時，在「問答」tab 按鈕旁顯示問題總數徽章（slate 色）；純前端改動，補 i18n `play.sidebar.qaCount`。
  - 修改說明（2026-06-24）：`PlayPage.tsx` 移動裝置 tab 按鈕（問答）內加入 `syncFollowerQuestions.length > 0` 條件渲染的 slate 色圓角徽章顯示問題數。分支 `feat/qa-tab-question-badge`，已 merge 回 master。
- [x] QuizBuilderPage 一鍵清除所有題目：在題目編輯區加入「清除所有題目」玫瑰色按鈕（`window.confirm` 確認後清空 `questions` 陣列）；補 i18n `quiz.clearAllQuestions/confirmClear`；純前端改動。
  - 修改說明（2026-06-24）：`QuizBuilderPage.tsx` 在匯出 JSON 按鈕後加入玫瑰色「清除所有題目」按鈕，呼叫 `window.confirm(t('quiz.confirmClear'))` 後 `setQuestions([emptyQuestion(0)])`；i18n 2 個 key 新增至 zh-TW 及 en。分支 `feat/quiz-clear-all-questions`，已 merge 回 master。
- [x] 首頁批次選取全選/取消全選：批次工具列（多選模式）加入「全選（N）」/「取消全選」按鈕，呼叫現有 `selectedIds` Set 邏輯；補 i18n `home.selectAll/deselectAll`；純前端改動。
  - 修改說明（2026-06-24）：`HomePage.tsx` 在收藏按鈕後新增紫羅蘭色全選切換按鈕（`filteredItems.length > 0` 才顯示），判斷 `filteredItems.every()` 決定顯示「全選」或「取消全選」；i18n 2 個 key 新增至 zh-TW 及 en。分支 `feat/home-select-all`，已 merge 回 master。
- [x] PlayPageSlidePanel 播放速率文字指示：在播放速率設定列標題旁加入「目前：{rate}x」文字標籤（cyan 色）；沿用已有 `playbackRate`；補 i18n `play.slidePanel.currentSpeed`；純前端改動。
  - 修改說明（2026-06-24）：`PlayPageSlidePanel.tsx` 播放速率 div 的標題 div 加入 `<span className="ml-2 text-xs text-cyan-400">` 顯示目前速率；i18n `play.slidePanel.currentSpeed` 新增至 zh-TW 及 en。分支 `feat/playback-speed-indicator`，已 merge 回 master。
- [x] PlayPageSidebar 書籤按頁碼排序：書籤 section 顯示前先對 `bookmarks` 陣列做 `sort((a, b) => a - b)` 升序排列；純前端改動，無需 i18n。
  - 修改說明（2026-06-24）：`PlayPageSidebar.tsx` `bookmarks.map` 改為 `[...bookmarks].sort((a, b) => a - b).map`，確保書籤以頁碼升序顯示。分支 `feat/bookmark-sort-by-page`，已 merge 回 master。

## 掃描摘要（2026-06-24 第二十七輪）

- 第二十六輪 5 個項目全數完成（問答計數 badge、清除所有題目、全選按鈕、速率文字指示、書籤排序）。
- `PlayPageSidebar.tsx` 重要頁面（importantPages）的 section 顯示也是未排序的，與剛修正的書籤排序問題相同。
- 首頁類別下拉選單（`<select>`）只顯示名稱，不知道各分類有幾份 PDF，難以決定切換哪個分類。
- `PlayPageSlidePanel.tsx` 逐字稿搜尋框輸入後無 × 清除按鈕，需手動全選刪除，操作不直覺。
- `QuizBuilderPage.tsx` 題目數超過 20 題時無任何提示，學生作答時間可能過長。
- `PlayPageSidebar.tsx` 的大綱面板（OutlineSection）標題列沒有顯示頁面總數，無法一眼知道共有幾頁。

## 新增可執行項目（第二十七輪）

- [x] PlayPageSidebar 重要頁面按頁碼排序：重要頁面 section 的 `importantPages.map` 改為 `[...importantPages].sort((a, b) => a - b).map`，確保顯示時依頁碼升序排列；純前端改動，無需 i18n。
  - 修改說明（2026-06-24）：`PlayPageSidebar.tsx` `importantPages.map` 改為 `[...importantPages].sort((a, b) => a - b).map`，與書籤排序修正一致。分支 `feat/important-pages-sort`，已 merge 回 master。
- [x] 首頁類別下拉各分類顯示 PDF 數量：在 `allCategories.map` 的 `<option>` 標籤加入各分類的 PDF 計數（`items.filter(...)` 算出），格式為「分類名稱（N）」；純前端改動。
  - 修改說明（2026-06-24）：`HomePage.tsx` `allCategories.map` 改為回傳 `<option>` 含 `items.filter(...).length` 計數，格式化為「分類名稱（N）」。分支 `feat/category-select-count`，已 merge 回 master。
- [x] PlayPageSlidePanel 逐字稿搜尋 × 清除按鈕：`scriptSearch` 有值時在搜尋框右側加入 × 按鈕（`setScriptSearch('')` 並 `setScriptSearchIdx(0)`）；純前端改動，無需 i18n。
  - 修改說明（2026-06-24）：`PlayPageSlidePanel.tsx` 搜尋框改以 `relative div` 包覆；`scriptSearch` 有值時在右側渲染絕對定位 × 按鈕，點擊清空搜尋並重置 index。分支 `feat/script-search-clear-button`，已 merge 回 master。
- [x] QuizBuilderPage 題目過多警示：`questions.length > 20` 時在編輯區頂部顯示琥珀色警告橫幅（「題目數量較多，建議精簡至 20 題以內」）；補 i18n `quiz.tooManyQuestionsWarning`；純前端改動。
  - 修改說明（2026-06-24）：`QuizBuilderPage.tsx` 在 `{questions.map...}` 前加入條件渲染，`questions.length > 20` 時顯示琥珀色橫幅；i18n 1 個 key 新增至 zh-TW 及 en。分支 `feat/quiz-too-many-questions-warning`，已 merge 回 master。
- [x] PlayPageSidebar 大綱面板頁數標題 badge：OutlineSection header 加入 `deckPages.length` 計數徽章（slate 色），方便使用者一眼確認頁數；純前端改動，無需新 i18n。
  - 修改說明（2026-06-24）：`PlayPageSidebar.tsx` OutlineSection h2 改 flex，`deckPages.length > 0` 時顯示 slate 色計數徽章。分支 `feat/outline-page-count-badge`，已 merge 回 master。

## 工作記錄（第二十七輪，2026-06-24）

| 日期 | 工作內容 | 分支 |
|------|----------|------|
| 2026-06-24 | PlayPageSidebar 重要頁面升序排列：importantPages.map 前加 [...importantPages].sort((a,b)=>a-b) | feat/important-pages-sort（已 merge） |
| 2026-06-24 | 首頁類別下拉加 PDF 計數：allCategories.map 加 items.filter(...).length，格式「分類（N）」 | feat/category-select-count（已 merge） |
| 2026-06-24 | 逐字稿搜尋框 × 清除按鈕：relative 包覆，scriptSearch 有值時 absolute × 按鈕 | feat/script-search-clear-button（已 merge） |
| 2026-06-24 | QuizBuilderPage 20 題以上警示：questions.length > 20 顯示 amber 橫幅；i18n tooManyQuestionsWarning | feat/quiz-too-many-questions-warning（已 merge） |
| 2026-06-24 | 大綱面板頁數徽章：OutlineSection h2 加 slate 計數徽章（deckPages.length） | feat/outline-page-count-badge（已 merge） |

## 工作記錄（第二十六輪，2026-06-24）

| 日期 | 工作內容 | 分支 |
|------|----------|------|
| 2026-06-24 | PlayPage 問答 tab 問題計數 badge：移動裝置「問答」tab 按鈕加入 syncFollowerQuestions.length 徽章 | feat/qa-tab-question-badge（已 merge） |
| 2026-06-24 | QuizBuilderPage 清除所有題目按鈕：玫瑰色按鈕 + window.confirm + setQuestions([emptyQuestion(0)])；i18n quiz.clearAllQuestions/confirmClear | feat/quiz-clear-all-questions（已 merge） |
| 2026-06-24 | 首頁全選/取消全選按鈕：filteredItems.every() 判斷；violet 色 toggle；i18n home.selectAll/deselectAll | feat/home-select-all（已 merge） |
| 2026-06-24 | PlayPageSlidePanel 播放速率目前值標籤：播放速率標題旁加 cyan「目前：{rate}x」span；i18n play.slidePanel.currentSpeed | feat/playback-speed-indicator（已 merge） |
| 2026-06-24 | PlayPageSidebar 書籤升序排列：bookmarks.map 前加 [...bookmarks].sort((a,b)=>a-b) | feat/bookmark-sort-by-page（已 merge） |

## 掃描摘要（2026-06-24 第二十八輪）

- 第二十七輪 5 個項目全數完成（重要頁面排序、類別計數、搜尋清除、20 題警示、大綱頁數 badge）。
- `QualityCheckPanel.tsx` 品質檢查結果呈現 `issuePages.length` 問題頁數，但標題列沒有 badge，無法在結果展示前就一眼看到問題數。
- 首頁 list 模式行文字只有頁數和類別，缺少音頻時長資訊（`total_audio_duration_seconds` 欄位已有）。
- `PlayPageSidebar.tsx` 大綱面板（OutlineSection）每個項目只有縮圖 + 頁碼 + 標題，沒有「已觀看」視覺標示。
- `PlayPageSlidePanel.tsx` 的自動播放倒數 badge（`autoAdvanceCountdown`）只顯示數字，沒有單位；新使用者不易理解倒數的意義。
- 首頁 list 模式缺少播放次數（`play_count`）欄位顯示，無法快速判斷哪份教材最常被使用。

## 新增可執行項目（第二十八輪）

- [x] QualityCheckPanel 結果問題頁數 badge：檢查完成後（`results !== null`）在「品質檢查」標題旁顯示 `issuePages.length` 徽章（有問題時 rose 色，全無問題時 emerald 色 ✓）；純前端改動，無需 i18n。
  - 修改說明（2026-06-24）：`QualityCheckPanel.tsx` 標題 h2 改 flex，`results !== null && !running` 時依 `issuePages.length` 顯示 emerald ✓ 或 rose 計數徽章。分支 `feat/quality-check-result-badge`，已 merge 回 master。
- [x] 首頁 list 模式顯示音頻時長：list 模式頁數/類別文字行後加入 `formatAudioDuration(pdf.total_audio_duration_seconds)` 音頻時長（`total_audio_duration_seconds` 非空才顯示）；純前端改動，不需後端修改。
  - 修改說明（2026-06-24）：`HomePage.tsx` list 模式類別文字後加入 `pdf.total_audio_duration_seconds > 0` 條件渲染，呼叫 `formatAudioDuration` 格式化並顯示音頻時長。分支 `feat/list-mode-audio-duration`，已 merge 回 master。
- [x] PlayPageSidebar 大綱已觀看頁面 emerald 點：OutlineSection 每個項目在頁碼旁加入 emerald 小點標記已訪問頁面（session 內追蹤 `visitedIdxSet`，非 active 頁時顯示）；`PlayPageContext` 新增 `visitedIdxSet`；純前端改動。
  - 修改說明（2026-06-24）：`PlayPageContext.tsx` 介面新增 `visitedIdxSet: ReadonlySet<number>`；`PlayPage.tsx` 加入 `useState<ReadonlySet<number>>(new Set([0]))` 及 `useEffect` 追蹤 `currentIdx` 變化；`PlayPageSidebar.tsx` OutlineSection 非 active 的已訪問頁顯示 emerald 小點。分支 `feat/outline-watched-dot`，已 merge 回 master。
- [x] autoAdvance 倒數 badge 加單位文字：`autoAdvanceCountdown` badge 的數字後加入 `s` 秒單位（小號 text-[9px]）；純前端改動，無需 i18n。
  - 修改說明（2026-06-24）：`PlayPageSlidePanel.tsx` 倒數 badge 改為 flex-col，數字下加 `text-[9px]` 的 `s` 單位標籤（emerald-400/70 色）。分支 `feat/auto-advance-countdown-unit`，已 merge 回 master。
- [x] 首頁 list 模式顯示播放次數：list 模式每列音頻時長後加入 `播放 N 次`（sky 色，`play_count > 0` 才顯示）；補 i18n `home.listPlayCount`。
  - 修改說明（2026-06-24）：`HomePage.tsx` 音頻時長 span 後加入 `pdf.play_count > 0` 條件渲染 sky 色播放計數；i18n `home.listPlayCount` 新增至 zh-TW 及 en。分支 `feat/list-mode-play-count`，已 merge 回 master。

## 工作記錄（第二十八輪，2026-06-24）

| 日期 | 工作內容 | 分支 |
|------|----------|------|
| 2026-06-24 | QualityCheckPanel 品質檢查結果 badge：h2 加 issuePages.length 徽章（emerald ✓ / rose 數字） | feat/quality-check-result-badge（已 merge） |
| 2026-06-24 | 首頁 list 模式顯示音頻時長：total_audio_duration_seconds 非空時呼叫 formatAudioDuration 顯示 | feat/list-mode-audio-duration（已 merge） |
| 2026-06-24 | 大綱已觀看頁面 emerald 點：PlayPageContext 新增 visitedIdxSet；PlayPage useEffect 追蹤；Sidebar 顯示小點 | feat/outline-watched-dot（已 merge） |
| 2026-06-24 | autoAdvance 倒數 badge 加「s」後綴：flex-col 排列，數字下 text-[9px] 秒單位 | feat/auto-advance-countdown-unit（已 merge） |
| 2026-06-24 | 首頁 list 模式顯示播放次數：play_count > 0 時顯示 sky 色「播放 N 次」；i18n home.listPlayCount | feat/list-mode-play-count（已 merge） |

## 掃描摘要（2026-06-24 第二十九輪）

- 第二十八輪 5 個項目全數完成（品質 badge、音頻時長、大綱已觀看點、倒數單位、播放次數）。
- `RemoteControllerPage.tsx` 遙控器頁面在大型頁碼旁沒有縮圖，演講者不易確認目前正在顯示哪一張投影片。
- `PlayPageSidebar.tsx` PageNoteSection textarea 有 `maxLength={5000}`，但沒有顯示目前字數，使用者不知道距離上限還有多少字。
- 書籤 section（PlayPageSidebar）只顯示頁碼 chip，缺少對應縮圖，難以一眼辨識頁面內容（大綱面板已有縮圖）。
- 首頁 list 模式行文字包含播放次數、音頻時長，但沒有 `updated_at`，無法快速判斷哪些教材是最近修改的。
- `QuizBuilderPage.tsx` 題目 textarea 沒有字元計數，出題者不易控制題目長短，容易出現過長的題幹。

## 新增可執行項目（第二十九輪）

- [x] RemoteControllerPage 當前頁縮圖預覽：在頁碼大數字下方加入 `pages[currentPage - 1]?.thumbnail_url ?? pages[currentPage - 1]?.image_url` 縮圖（`h-28 object-contain rounded-lg`），方便演講者確認目前頁面內容；純前端改動。
  - 修改說明（2026-06-24）：`RemoteControllerPage.tsx` 頁碼區改為 flex-col，縮圖渲染於大數字上方（`imgSrc` 非空才渲染）。分支 `feat/remote-page-thumbnail`，已 merge 回 master。
- [x] PlayPageSidebar 筆記字數計數器：PageNoteSection textarea 下方字數計數 `noteText.length > 4500` 時改 amber 色警示；原本已有字數顯示，補 amber 警示色即完成。
  - 修改說明（2026-06-24）：`PlayPageSidebar.tsx` 字數 span 改為三元式：`noteText.length > 4500 ? 'text-amber-400' : 'text-slate-500'`。分支 `feat/note-char-count`，已 merge 回 master。
- [x] PlayPageSidebar 書籤縮圖預覽：書籤 section 每個書籤 chip 左側加入對應頁縮圖（`deckPages.find` 找出頁物件，取 `thumbnail_url ?? image_url`，`h-6 w-10 object-cover rounded`）；純前端改動。
  - 修改說明（2026-06-24）：`PlayPageSidebar.tsx` 書籤 map 改為 block body，計算 `thumbSrc` 後在 button 內渲染縮圖 img。分支 `feat/bookmark-thumbnail`，已 merge 回 master。
- [x] 首頁 list 模式顯示 updated_at：list 模式每列在描述欄位後加入 `updated_at` 相對時間（`formatRelativeTime(pdf.updated_at)`，灰色），讓使用者快速辨識最近更新的教材；純前端改動，無需 i18n。
  - 修改說明（2026-06-24）：`HomePage.tsx` 描述 span 後加入 `pdf.updated_at` 條件渲染，呼叫 `formatRelativeTime` 顯示相對時間（text-slate-600）。分支 `feat/list-mode-updated-at`，已 merge 回 master。
- [x] QuizBuilderPage 題幹字元計數：`q.question` textarea 改以 relative div 包覆，右下角加入 `{q.question.length}` 計數（text-[10px] slate 色，有內容才顯示）；純前端改動，無需 i18n。
  - 修改說明（2026-06-24）：`QuizBuilderPage.tsx` textarea 加 relative div 包覆，`q.question.length > 0` 時顯示 absolute bottom-right 計數。分支 `feat/quiz-question-char-count`，已 merge 回 master。

## 工作記錄（第二十九輪，2026-06-24）

| 日期 | 工作內容 | 分支 |
|------|----------|------|
| 2026-06-24 | RemoteControllerPage 縮圖預覽：頁碼上方顯示當前頁 thumbnail，flex-col 排列 | feat/remote-page-thumbnail（已 merge） |
| 2026-06-24 | PlayPageSidebar 筆記 4500+ 字 amber 警示：noteText.length > 4500 時改 amber 色 | feat/note-char-count（已 merge） |
| 2026-06-24 | 書籤縮圖預覽：deckPages.find + thumbnail_url，h-6 w-10 img 插入 chip 左側 | feat/bookmark-thumbnail（已 merge） |
| 2026-06-24 | 首頁 list 模式顯示 updated_at：formatRelativeTime(pdf.updated_at) 灰色顯示 | feat/list-mode-updated-at（已 merge） |
| 2026-06-24 | QuizBuilderPage 題幹字元計數：relative 包覆 textarea，q.question.length 右下角顯示 | feat/quiz-question-char-count（已 merge） |

## 掃描摘要（2026-06-24 第三十輪）

- 第二十九輪 5 個項目全數完成（遙控器縮圖、筆記字數 amber、書籤縮圖、updated_at、題幹字數）。
- `PlayPageSidebar.tsx` 重要頁面 chip 沒有縮圖，與剛更新的書籤 chip 不一致。
- `ImportTextPage.tsx` 第 204-207 行有 hardcoded 中文模式說明文字（非 i18n），會在英文介面下顯示中文。
- `PlayPage.tsx` 跳頁 dialog（`gotoPageOpen`）只支援 Enter 確認，觸控裝置需要點擊確認按鈕才方便操作。
- `PlayPageSidebar.tsx` OutlineSection 標題列有頁數 badge，但缺少整份簡報的總播放時長資訊（`detail.total_audio_duration_seconds`）。
- `PlayPageHeader.tsx` 頁碼計數器只顯示「N / M 頁」，不顯示百分比進度，使用者難以直覺感受播放進度。

## 新增可執行項目（第三十輪）

- [x] PlayPageSidebar 重要頁面縮圖預覽：重要頁面 chip 左側加入對應縮圖（`deckPages.find`，`h-6 w-10 object-cover rounded`），與書籤 chip 視覺一致；純前端改動。
  - 修改說明（2026-06-24）：`PlayPageSidebar.tsx` 重要頁面 map 改為 block body，計算 `thumbSrc` 後在 button 內渲染縮圖 img。分支 `feat/important-pages-thumbnail`，已 merge 回 master。
- [x] ImportTextPage 模式說明文字 i18n 化：第 204-207 行 hardcoded 中文改用 `t('importText.currentModePaste')` 和 `t('importText.currentModePrompt')`；補 2 個 key 至 zh-TW 及 en。
  - 修改說明（2026-06-24）：`ImportTextPage.tsx` `mode === 'paste'` 三元式改用 t()；i18n 2 個 key 新增至 zh-TW 及 en。分支 `feat/importtext-mode-i18n`，已 merge 回 master。
- [x] GotoPage 對話框加「前往」確認按鈕：跳頁 dialog input 下方加入 indigo「前往」按鈕（按下後跳頁並關閉），頁碼無效時 disabled；補 i18n `play.gotoPageConfirm`。
  - 修改說明（2026-06-24）：`PlayPage.tsx` 跳頁 dialog 加入「前往」按鈕，邏輯與 Enter 相同；i18n `play.gotoPageConfirm` 新增至 zh-TW 及 en。分支 `feat/goto-page-confirm-button`，已 merge 回 master。
- [x] PlayPageSidebar 大綱標題顯示總播放時長：OutlineSection 加入 `detail?.total_audio_duration_seconds` 時長（`formatAudioDuration`，slate-400 色）；引入 `formatAudioDuration`，並取 `detail` 自 context；純前端改動。
  - 修改說明（2026-06-24）：`PlayPageSidebar.tsx` 匯入 `formatAudioDuration`，OutlineSection 解構 `detail`，標題 h2 flex 後加入時長 span。分支 `feat/outline-total-duration`，已 merge 回 master。
- [x] PlayPageHeader 頁碼計數加百分比：頁碼計數器下方加入 `{Math.round((currentIdx+1)/totalPages*100)}%`（text-[10px] slate-500）；`totalPages > 1` 才顯示；純前端改動。
  - 修改說明（2026-06-24）：`PlayPageHeader.tsx` 頁碼 div 加入 `totalPages > 1` 條件渲染的百分比 div（text-[10px] slate-500）。分支 `feat/header-page-percent`，已 merge 回 master。

## 工作記錄（第三十輪，2026-06-24）

| 日期 | 工作內容 | 分支 |
|------|----------|------|
| 2026-06-24 | 重要頁面縮圖預覽：deckPages.find + thumbnail_url，h-6 w-10 img 插入 chip 左側 | feat/important-pages-thumbnail（已 merge） |
| 2026-06-24 | ImportTextPage 模式說明 i18n：hardcoded 中文改 t()；補 importText.currentModePaste/Prompt | feat/importtext-mode-i18n（已 merge） |
| 2026-06-24 | GotoPage 加「前往」按鈕：indigo 按鈕，頁碼無效 disabled；i18n play.gotoPageConfirm | feat/goto-page-confirm-button（已 merge） |
| 2026-06-24 | 大綱標題顯示總時長：formatAudioDuration(detail.total_audio_duration_seconds) slate-400 | feat/outline-total-duration（已 merge） |
| 2026-06-24 | PlayPageHeader 頁碼計數加百分比：totalPages > 1 時顯示 text-[10px] 百分比 | feat/header-page-percent（已 merge） |

----

## 掃描摘要（2026-06-24 FUTURE_ROADMAP 全面盤點）

本次對照 `docs/FUTURE_ROADMAP.md`（2.1–2.10 十大主要功能）與 `BLOG.md`（所有已完成功能紀錄）逐一比對，確認哪些功能已完成、哪些尚未實作。結果如下：

- **2.1 課後學習報告**：班級摘要、個別學生分析、逐題答對率、AI 課後建議、觀看完成率全部已完成。唯「多頁理解差異分析（頁面困難度分布）」UI 仍為佔位符，可考慮補強。
- **2.2 AI 導師/自學模式**：問這一頁面板、答錯後推薦回看頁面均已完成。缺：個人化複習清單（依歷史作答生成並持久化顯示）。
- **2.3 成本預估**：生成前成本預估 modal、月費用預算警告均已完成。
- **2.4 教材知識庫與跨簡報搜尋**：全域關鍵字搜尋 MVP 已完成。缺：向量語意搜尋、從知識庫挑選頁面組成新簡報。
- **2.5 AI 課程包**：ZIP 課程包（講義+測驗+學習單）已完成。缺：SCORM/xAPI 格式匯出。
- **2.6 手機/平板課堂控制器**：基本遙控翻頁已完成。缺：遙控器投票開/關控制、遙控器手繪同步到投影端。
- **2.7 生成品質評估與自動修復**：品質檢查面板 + 一鍵重生 + AI 腳本脈絡分析已完成。缺：AI 圖片品質分析（內容不符偵測）。
- **2.8 模板市集**：Skills 擴充為教學模板已完成。缺：完整的模板市集（社群瀏覽/分享/下載/上架）。
- **2.9 協作編輯**：版本歷史查詢已完成。缺：版本差異視圖（diff 比較）、評論討論串（頁面綁定留言）、多人即時編輯。
- **2.10 更完整匯出**：SRT/VTT、PPTX 均已完成。缺：SCORM 匯出、H5P 互動內容匯出。

## 未完成項目（來自 FUTURE_ROADMAP.md）

- [x] 個人化複習清單（2.2）：依學生在各份簡報的測驗作答歷史，生成「建議複習頁面」清單並存入 localStorage 或後端；播放頁側邊欄或首頁顯示「你有 N 頁需要複習」入口，點擊直接跳到對應簡報頁碼。後端可新增 `GET /api/me/review-items` 彙整所有答錯題目的 `page_number`，前端以獨立面板或首頁提示呈現。
  - 修改說明（2026-06-24）：新增 `frontend/src/lib/reviewList.ts`（`getReviewItems`/`addReviewItems`/`removeReviewItem`/`clearAllReviewItems`，以 `makeslide.reviewItems` localStorage key 持久化）；`QuizBuilderPage.tsx` 新增 `useEffect`，在 `syncQuizShowAnswers` 變為 true 時掃描答錯且有 `page_number` 的題目並呼叫 `addReviewItems`；`PlayPageSidebar.tsx` 新增 `ReviewListSection` 元件（rose 色邊框，僅顯示當前 PDF 的複習項目，含點擊跳頁與 × 移除功能）；`HomePage.tsx` 當 `reviewCount > 0` 時顯示 rose 色提示橫幅；zh-TW/en i18n 各新增 5 個 key（`reviewListTitle/Hint/Page/Remove`、`home.reviewListBanner`）。分支 `feat/personalized-review-list`，已 merge 回 master。

- [x] 向量語意搜尋（2.4）：現有搜尋為 SQL LIKE 關鍵字比對，無法找到語意相近但用詞不同的頁面。可整合 OpenAI `text-embedding-3-small` 或 Gemini embedding API，對每頁逐字稿建立向量，儲存於後端（SQLite FTS5 或輕量向量庫），搜尋時以 cosine similarity 排序結果；前端搜尋框加入「語意搜尋」開關。
  - 修改說明（2026-06-25）：新增 `page_embeddings` DB 表（pdf_id/page_uid/content_hash/embedding JSON）；新增 `backend/src/services/embeddings.ts`（`getOrCreateEmbeddings`、`embedQuery`、`cosineSimilarity`，使用 OpenAI text-embedding-3-small，支援批次快取）；修改 `backend/src/routes/pdfs/search.ts` 加入 `?semantic=true` 路徑（只搜尋自己的 PDF，相似度門檻 0.3）；更新 `frontend/src/lib/api/pdfs.ts` 加入 `semantic` 參數；`GlobalSearchBox.tsx` 加入「AI」語意搜尋切換按鈕；i18n 3 個 key；4 個後端測試全通過。分支 `feat/vector-semantic-search`。

- [x] 從搜尋結果挑選頁面組成新簡報（2.4）：`GlobalSearchBox` 新增「多選頁面」按鈕切換多選模式（含 checkbox）；選取後點「建立新簡報（N 頁）」呼叫 `POST /api/pdfs/from-pages` 複製各頁圖片/逐字稿/音檔至新 PDF，自動導航至新簡報；i18n 4 個 key；5 個後端測試全通過。實作於 `feat/from-pages` 分支，2026-06-24 合入 master。

- [x] SCORM 1.2 課程包匯出（2.5/2.10）：新增 `GET /api/pdfs/:id/export.scorm` 後端端點，按 SCORM 1.2 規格產生標準目錄結構（`imsmanifest.xml`、`index.html`、各頁圖片與音檔），打包為 ZIP 回傳；前端播放頁匯出區加入「下載 SCORM 包」按鈕；補後端測試驗證 200 / 403 / 404 及 manifest 格式正確性。
  - 修改說明（2026-06-24）：新增 `backend/src/routes/pdfs/scorm.ts`；`GET /api/pdfs/:id/export.scorm` 讀取各頁 image/audio/script，產生 SCORM 1.2 規格的 `imsmanifest.xml`（含 resource file 清單）與自含 `index.html` SCO（鍵盤換頁、SCORM API 初始化、完課時自動回報 `lesson_status=completed`）；使用 JSZip 打包為 ZIP，Content-Disposition 設為 `.scorm.zip`；`PlayPageHeader.tsx` 匯出區加入紫羅蘭色「下載 SCORM 包」按鈕；zh-TW/en i18n 各新增 `play.header.downloadScorm` 1 個鍵值；4 個後端測試全通過（200/public/404/403）。分支 `feat/scorm-export`，已 merge 回 master。

- [x] 遙控器投票開/關控制（2.6）：`RemoteControllerPage.tsx` 目前只有翻頁功能。新增「投票」section，列出目前頁面的投票（呼叫 `GET /api/pdfs/:id/pages/:n/polls`），提供「開啟投票」/「關閉投票」按鈕（呼叫既有的 `PATCH /api/pdfs/:id/polls/:pollId`）；補 i18n `remote.pollControl/openPoll/closePoll`。

- [x] 遙控器手繪同步到投影端（2.6）：`RemoteControllerPage.tsx` 加入簡易手繪 canvas（`<canvas>` + pointer events），筆跡以 JSON 格式推送給後端 `POST /api/pdfs/:id/sync/drawing`（共用既有畫板儲存機制）；主播放頁 follower 端重新繪製接收到的筆跡；適合演講者在手機上圈重點即時顯示在大螢幕。
  - 修改說明（2026-06-25）：在 `RemoteControllerPage.tsx` 加入以 refs 管理的手繪 canvas（`<canvas>` + pointer events + `setPointerCapture`）；筆跡點正規化至 [0,1] 座標，與 `DrawingCanvas` 相同格式；同步啟用時每完成一筆劃即 100ms debounce 推送至 `updatePlaybackSyncState` 的 `drawing_page_number`/`drawing_json` 欄位（現有管道，無需新端點）；follower 端透過既有 `syncDrawingState` → `remoteDrawingData` → `DrawingCanvas remoteData` 路徑自動重繪；換頁時清空筆跡並推送空 strokes；`ResizeObserver` 保持 canvas 解析度與 CSS 尺寸一致；新增「清除」按鈕；zh-TW/en i18n 各新增 3 個 `remote.drawing.*` 鍵值。分支 `feat/remote-drawing-sync`，已 merge 回 master。

- [x] AI 圖片品質分析（2.7）：品質檢查加入 AI 視覺分析步驟，對每頁投影片截圖呼叫 Gemini/GPT-4o Vision 檢查圖片是否與逐字稿內容相符（例如：逐字稿提到「長條圖」但圖片是山脈風景），回傳 `content_mismatch` 問題代碼；`QualityCheckPanel` 新增對應警示並提供「重生圖片」快捷入口。
  - 修改說明（2026-06-24）：新增 `backend/src/routes/pdfs/image-quality.ts`，提供 `GET /api/pdfs/:id/image-quality` 端點；以 `sharp` 將頁面圖片縮至 800px 寬後轉 base64，透過 `callChatJSON` vision 呼叫 LLM 逐頁判斷圖片內容是否與逐字稿主題相符，僅回傳 `mismatch=true` 的頁面；`QualityCheckPanel.tsx` 新增天藍色「🖼️ AI 圖片內容分析」section，含執行按鈕、計數徽章（emerald ✓ 或 rose 數字）與每頁不符警示卡（rose 邊框、不符說明文字、跳頁按鈕）；前端新增 `ImageMismatchResult`/`ImageQualityResponse` 型別與 `fetchImageQuality()` API 函式；zh-TW/en i18n 各新增 5 個 `play.quality.imageAnalysis*` / `contentMismatch` 鍵值；4 個後端測試全通過（200/空頁、404、403、public 200）。分支 `feat/image-quality-ai-analysis`，已 merge 回 master。

- [x] AI 腳本品質分析（2.7）：`GET /api/pdfs/:id/script-quality` 批次呼叫 LLM 分析相鄰頁逐字稿脈絡斷裂，回傳 `contextBreaks` 陣列；`QualityCheckPanel` 新增紫色 AI 分析按鈕與琥珀色斷裂警示卡；5 個後端測試全通過（含 LLM mock）。實作於 `feat/script-quality-analysis` 分支，2026-06-24 合入 master。

- [x] 模板市集（2.8）：建立完整的模板瀏覽、下載、上架流程。後端新增 `templates` 資料表（含 name/description/category/skill_data/is_public/author），新增 CRUD 端點；前端新增「模板市集」頁面（`/templates`），以卡片列表呈現公開模板，可一鍵套用到新建簡報的 PromptModal；使用者可從 Skills 設定頁一鍵「上架為公開模板」。
  - 修改說明（2026-06-25）：後端 `db.ts` migration 新增 `templates` 資料表（id/name/description/category/skill_data JSON/is_public/author/created_at）；新增 `backend/src/routes/pdfs/templates.ts`（GET /api/templates 公開列表、POST /api/templates 建立需登入、DELETE /api/templates/:id 需為作者）；前端新增 `frontend/src/lib/api/templates.ts` API 函式與 `Template` 型別、`frontend/src/pages/TemplatesPage.tsx` 模板卡片頁面（`/templates`）；`App.tsx` 補路由；`SettingsPage.tsx` Skills 區塊加入「上架為模板」按鈕與「瀏覽模板市集」連結；`PromptModal.tsx` 技能模板區塊加入「瀏覽模板市集 →」連結；i18n zh-TW/en 各新增 15 個 `templates.*`/`settings.publishSkillAsTemplate` 鍵值；4 個後端測試通過（201/401/200 list/403）。分支 `feat/template-marketplace`，已 merge 回 master。

- [x] 版本差異視圖（2.9）：版本歷史面板（`useVersionHistory`）目前只能預覽舊版逐字稿，無 diff 比較。加入 diff 視圖：選擇一個舊版本後，以紅/綠底色顯示與目前版本的逐行差異（可用純 JavaScript Myers diff 演算法，不需後端改動）；補 i18n `play.version.diffView/noChange`。

- [x] 評論討論串（2.9）：新增 `page_comments` 資料表（pdf_id/page_number/author/text/resolved/created_at），後端新增 `GET`/`POST`/`PATCH`（標記已處理）/`DELETE` 端點（`backend/src/routes/pdfs/comments.ts`）；`PlayPageSidebar` 加入 `CommentsSection`（sky 色調，顯示/新增/標記已處理/刪除評論）；i18n 10 個 key；補 9 個 node:test 測試。

- [x] H5P 互動內容匯出（2.10）：`GET /api/pdfs/:id/export.h5p` 依 H5P Course Presentation 1.25 格式產生 `h5p.json` + `content/content.json`（含每頁 H5P.Image + H5P.AdvancedText 元素）；打包為 `.h5p` ZIP；前端加入青綠色「下載 H5P」按鈕；i18n zh-TW/en 各 1 key；4 個後端測試全通過。實作於 `feat/h5p-export` 分支，2026-06-24 合入 master。

----

## 工作記錄（第三十一輪）

| 日期 | 工作內容 | 分支 |
|------|----------|------|
| 2026-06-24 | 版本差異視圖（2.9）：新增 `computeLineDiff.ts`（LCS 逐行 diff），`VersionHistoryDialog.tsx` 加入「顯示差異」切換按鈕，以紅/綠底色呈現舊版本與現版本的逐行差異；PlayPage 傳入 `currentScript`；補 8 個 node:test 測試；補 i18n zh-TW/en | feat/version-diff-view（已 merge） |
| 2026-06-24 | 遙控器投票開/關控制（2.6）：後端新增 `PATCH /api/pdfs/:id/polls/:pollId` 端點（切換 is_active）；前端 `updatePagePoll()` API；`RemoteControllerPage` 換頁時自動抓取本頁投票，顯示投票清單與開/關按鈕；補 i18n zh-TW/en | feat/remote-poll-control（已 merge） |
| 2026-06-24 | 個人化複習清單（2.2）：新增 `reviewList.ts` localStorage helper；`QuizBuilderPage` 在答案公布時自動儲存答錯且有頁碼的題目；`PlayPageSidebar` 新增 `ReviewListSection`（rose 色，點擊跳頁，× 移除）；首頁顯示 rose 橫幅提示；i18n 5 個 key | feat/personalized-review-list（已 merge） |
| 2026-06-24 | 評論討論串（2.9）：新增 `page_comments` DB 資料表 + index；後端 GET/POST/PATCH/DELETE 四個端點（access control by pdf visibility）；前端 `listPageComments`/`createPageComment`/`resolvePageComment`/`deletePageComment` API；`PlayPageSidebar` 新增 `CommentsSection`（sky 色調，顯示/新增/標記已處理/刪除）；i18n 10 個 key；9 個 node:test | feat/page-comments |
| 2026-06-24 | SCORM 1.2 課程包匯出（2.5/2.10）：`GET /api/pdfs/:id/export.scorm`；imsmanifest.xml + index.html SCO（SCORM API + 鍵盤換頁 + 完課回報）；各頁圖片/音檔打包為 ZIP；PlayPageHeader 紫色「下載 SCORM 包」按鈕；i18n downloadScorm；4 個後端測試通過 | feat/scorm-export（已 merge） |
| 2026-06-24 | AI 腳本品質分析（2.7）：`GET /api/pdfs/:id/script-quality` 批次 LLM 分析相鄰頁逐字稿脈絡斷裂，Zod schema 驗證；QualityCheckPanel 新增紫色 AI 分析按鈕與琥珀色斷裂警示卡；i18n 5 個 key；5 個後端測試全通過（含 LLM mock） | feat/script-quality-analysis（已 merge） |
| 2026-06-24 | H5P 互動內容匯出（2.10）：`GET /api/pdfs/:id/export.h5p` H5P Course Presentation 格式（h5p.json + content.json + 各頁圖片）打包 .h5p ZIP；PlayPageHeader 青綠色下載按鈕；i18n 2 個 key；4 個後端測試全通過 | feat/h5p-export（已 merge） |
| 2026-06-24 | 從搜尋結果組成新簡報（2.4）：`POST /api/pdfs/from-pages` 複製頁面至新 PDF；GlobalSearchBox 多選模式 + checkbox + 「建立新簡報（N 頁）」按鈕；i18n 4 個 key；5 個後端測試全通過 | feat/from-pages（已 merge） |
| 2026-06-24 | AI 圖片品質分析（2.7）：`GET /api/pdfs/:id/image-quality` 以 vision LLM 逐頁判斷圖片與逐字稿是否相符；QualityCheckPanel 新增天藍色 AI 圖片分析 section，rose 警示卡顯示不符詳情；i18n 5 個 key；4 個後端測試全通過 | feat/image-quality-ai-analysis（已 merge） |
| 2026-06-25 | 遙控器手繪同步到投影端（2.6）：`RemoteControllerPage.tsx` 加入 canvas 手繪（refs 管理筆跡 + pointer events + ResizeObserver）；正規化 [0,1] 座標透過既有 `updatePlaybackSyncState` 的 drawing_page_number/drawing_json 欄位推送；follower 端透過現有 syncDrawingState→remoteDrawingData→DrawingCanvas 路徑即時顯示；換頁清空；i18n 3 個 key；TypeScript 通過 | feat/remote-drawing-sync（已 merge） |
| 2026-06-25 | 模板市集（2.8）：`templates` DB 表 migration；GET/POST/DELETE /api/templates 端點；TemplatesPage.tsx（/templates 路由）卡片列表 + Apply 跳首頁；SettingsPage Skills 區塊加「上架為模板」按鈕 + 「瀏覽市集」連結；PromptModal 技能模板區塊加「瀏覽市集 →」連結；i18n 15 個 key；4 個後端測試通過 | feat/template-marketplace（已 merge） |
| 2026-06-25 | 向量語意搜尋（2.4）：`page_embeddings` DB 表；`services/embeddings.ts`（OpenAI text-embedding-3-small 批次快取）；`/api/search?semantic=true` 路徑（cosine similarity >= 0.3 排序，限自己的 PDF）；GlobalSearchBox「AI」切換按鈕；i18n 3 個 key；4 個後端測試全通過 | feat/vector-semantic-search（已 merge） |
| 2026-06-25 | TemplatesPage 分類篩選 + 搜尋框：TemplatesPage 加入搜尋 input（client-side 過濾 name/description/prompt）與分類 chips（依實際 categories 動態生成）；i18n 3 個 key；純前端改動 | feat/templates-filter-search（已 merge） |

----

## 掃描摘要（2026-06-25 第三十二輪）

FUTURE_ROADMAP.md 2.1–2.10 全部完成（88/100），對現有程式碼再次掃描，補充以下可執行的功能增強項目。優先選擇能利用已有表結構、路由與服務的改動，避免引入全新外部依賴。

## 新增可執行項目（第三十二輪）

- [x] TemplatesPage 分類篩選 + 搜尋框：TemplatesPage 目前無法按 category 篩選也無搜尋。在標題下方加入類別 chips（依 API 回傳的實際 categories 動態生成，含「全部」選項）與文字搜尋 input（client-side 過濾 name + description）；純前端改動，不需後端修改，補 i18n 3 個 key（searchPlaceholder/categoryAll/noFilterResults）。分支 `feat/templates-filter-search`。

- [x] 設定頁語意搜尋索引統計：Settings「技能」分頁底部新增「語意搜尋索引」小節，顯示「已索引 N 頁（共 M 份簡報）」；新增登入限定端點 `GET /api/me/embedding-stats`（JOIN `page_embeddings` 與 `pdfs.owner_sub`，回傳 indexed_pages/indexed_pdfs）；補後端測試 2 個（401／計數正確排除他人 PDF）；i18n 3 個 key（`settings.embeddingIndex`/`embeddingIndexStats`/`embeddingIndexHint`，zh-TW/en）。分支 `feat/embedding-index-stats`。

- [x] 相似頁面推薦：新增 owner 限定端點 `GET /api/pdfs/:id/pages/:n/similar`，以既有 `page_embeddings` + `cosineSimilarity` 找出同 owner 其他已索引頁面的 top-5（僅查既有 embeddings，無新 LLM 呼叫；≥0.3 門檻）；PlayPageSidebar 新增「相似頁面」section，以縮圖 + 標題 + 頁碼 + 相似度卡片呈現，點擊跨簡報跳轉；補後端測試 3 個（401／排序正確且過濾正交頁／403 非 owner）；i18n 3 個 key。分支 `feat/similar-pages`。

- [x] 自動生成 PDF 描述：新增 `generateDescription` worker step（取前 3 頁逐字稿送 LLM 生成 2–3 句中文摘要，仿 `generateTitle`）與 owner 限定 `POST /api/pdfs/:id/generate-description`（會持久化 description）；PlayPageHeader 描述欄為空時於旁邊顯示「✨ AI 生成描述」按鈕，成功後自動填入欄位；補後端測試 4 個（mock LLM、無實際 API 呼叫）；i18n 2 個 key（`play.metadata.aiGenerateDescription`/`generatingDescription`，zh-TW/en）。分支 `feat/ai-generate-description`。

- [x] 測驗結果分享按鈕：QuizBuilderPage 學生作答的成績顯示區（`quiz.totalScore` 區塊）加入「分享成績」按鈕，使用 `navigator.share` API（不支援或取消時 fallback 至 `copyTextToClipboard` 複製文字 + toast），分享文字含得分/滿分與測驗標題；補 i18n 2 個 key（`quiz.shareScore`/`quiz.shareText`，zh-TW/en）；純前端改動。分支 `feat/quiz-share-score`。

- [x] 課後班級報告列印樣式：經檢視 `PostClassReportPanel` 已內建完整列印功能 —— `@media print` 樣式（行 100-132，含 `break-inside: avoid` 自動分頁、深色轉淺色）、`window.print()` 的「列印 / 儲存 PDF」按鈕、`data-no-print` 隱藏工具列。需求已由既有程式碼滿足，本項標記為已完成（無需新增程式碼）。

- [x] AI 一鍵補全空白逐字稿：QualityCheckPanel 偵測到 `missing_script`/`empty_script` 頁面時，於問題數列右側顯示「批次補全」按鈕，依序對每頁呼叫既有 `rewritePageScript()`（`POST /api/pdfs/:id/pages/:n/rewrite-script`，會持久化逐字稿），上限 10 頁，附帶生成指令 prompt；按鈕顯示「補全中… done/total」進度，完成後自動重跑品質檢查；補 i18n 2 個 key（`play.quality.batchFill`/`batchFilling`，zh-TW/en）。純前端改動。分支 `feat/quality-batch-fill-scripts`。

- [x] 播放頁鍵盤快捷鍵說明 overlay：`PlayPageHeader` 既有「快捷鍵說明」按鈕 + modal（列出 ←→/Space/G/B/I/W/P/A/Esc 等，i18n 已存在），本次補上 `?` 全域熱鍵切換顯示（輸入框聚焦時忽略），並在 overlay 中新增 `?` 說明列；補 i18n 1 個 key（`play.shortcuts.showHelp`，zh-TW/en）。純前端改動。分支 `feat/shortcuts-help-hotkey`。

- [x] TemplatesPage 模板使用次數顯示：`templates` 表新增 `apply_count INTEGER NOT NULL DEFAULT 0` 欄位（含舊庫 `columnExists` migration）；新增無需驗證的 `POST /api/templates/:templateId/apply`（遞增計數→204，不存在→404）；前端 `applyTemplate()` fire-and-forget 呼叫並樂觀遞增本地計數，卡片顯示「已套用 N 次」徽章；補後端測試 2 個（遞增+204／404）共 6 通過；i18n 1 個 key（`templates.applyCount`，zh-TW/en）。分支 `feat/template-apply-count`。

- [x] 播放頁 PDF 描述折疊顯示：PlayPageHeader 在標題列下方加入折疊描述區塊，`detail?.description` 非空時顯示「▼ 顯示簡介」切換鈕（初始收折，點擊展開/收合），純 `descExpanded` state toggle，對分享連結訪客也可見；補 i18n 2 個 key（`play.header.showDescription`/`hideDescription`，zh-TW/en）。純前端改動。分支 `feat/play-description-collapse`。

- [x] 首頁近期搜尋刪除個別記錄：近期搜尋列表（實際位於 `HomePage.tsx`，非 `GlobalSearchBox.tsx`）原本只有全部清除，無法刪除單筆。已在每筆記錄右側加入 × 按鈕，新增 `removeRecentSearch(term)` helper 只移除該筆並同步 localStorage；補 i18n 1 個 key（`home.search.removeRecent`，zh-TW/en）。純前端改動。分支 `feat/recent-search-remove-item`。

- [x] 課後報告加入頁面觀看率：經檢視 `GET /api/pdfs/:id/report/summary` 已內建每頁 `avg_listened_ratio`（`listened_ms/duration_ms` 聚合，report.ts 行 355、427）與 `completion_rate`，`PostClassReportPanel` 也已顯示「觀看完成率最低頁面」與完成率熱力圖。需求已由既有程式碼滿足，標記為已完成（無需新增程式碼）。

## 掃描摘要（2026-06-25 第三十三輪）

第三十二輪那批項目已全部結清（重設後完成 99/100）。本輪依 LOOP.md「無待辦項目時分析程式並新增項目」，
對本 session 實際讀過的程式碼再次掃描，補充以下小而明確、可獨立完成、且複用既有路由／表結構的增強項目，
避免引入新外部依賴。優先順序：純前端與低風險者在前；涉及 LLM 成本者已標註。

## 新增可執行項目（第三十三輪）

---- 計數重設 ----

> 2026-06-25：上一批已達 100/100 上限，經使用者同意重設計數，於此標記後重新起算。第三十三輪這批項目（含已完成的「依使用次數排序」）自此重新計數。

- [x] PostClassReportPanel 國際化（第一階段）：`PostClassReportPanel.tsx` 目前所有文案為硬編中文（標題、按鈕、區塊標題、`window.confirm` 文字等）。先將「工具列按鈕」與標題抽成 i18n key（重新整理／匯出 CSV／學生報告 CSV／投票結果 CSV／列印 / 儲存 PDF／重置觀看進度／關閉／課後報告標題與副標），改用 `useI18n()`；補 zh-TW/en 各約 10 個 key；純前端改動，不改資料流。
  - 修改說明（2026-06-25）：`PostClassReportPanel` 引入 `useI18n()`，將標題、副標、工具列 7 個按鈕（重新整理／更新中／匯出 CSV／學生報告 CSV／投票結果 CSV／列印 / 儲存 PDF／重置觀看進度／重置中／關閉）與 `window.confirm` 重置確認文字改為 `t()` 呼叫；列印頁首的標題 fallback 亦改用 `play.report.title`。zh-TW/en 各新增 12 個 `play.report.*` key（共 1651 對等）。內文載入訊息與各區塊細項留待後續階段。純前端改動；typecheck 通過、i18n 對等測試 21 個全通過。分支 `feat/report-panel-i18n`，已 merge 回 master。

- [x] TemplatesPage 依使用次數排序：`TemplatesPage.tsx` 搜尋框旁加入「最新／最熱門」排序切換，`最熱門` 以既有 `apply_count` 由大到小（穩定排序保留 recency 為次序）、`最新` 維持 API 的 `created_at DESC`；純前端 client-side 排序，補 i18n 2 個 key（`templates.sortNewest`/`templates.sortPopular`，zh-TW/en）。分支 `feat/templates-sort-popular`。

- [x] 播放頁簡介「複製」按鈕：`PlayPageHeader` 折疊簡介區塊（`descExpanded`）展開時，於描述文字下方加入「複製簡介」按鈕，使用既有 `copyTextToClipboard()`，成功顯示短暫「已複製」toast（2 秒）；純前端改動，補 i18n 2 個 key（`play.header.copyDescription`/`copyDescriptionDone`，zh-TW/en）。分支 `feat/copy-description`。

- [x] 相似頁面推薦空狀態與數量：`GET /api/pdfs/:id/pages/:n/similar` 改回傳 `{ similar, indexed }`（未索引→`indexed:false`、已索引→`true`）；`SimilarPagesSection`（`PlayPageSidebar.tsx`）只在「未索引」時整段隱藏，「已索引但無相似」時顯示「找不到相似頁面」提示；API 型別改為 `SimilarPagesResult`；補後端測試 1 個（`indexed:false`，共 4 通過）與 i18n 1 個 key（`play.sidebar.similarPagesEmpty`，zh-TW/en）。分支 `feat/similar-pages-empty-state`。

- [x] 設定頁語意索引涵蓋率長條：`GET /api/me/embedding-stats` 新增回傳 `total_pages`（該 owner 所有 PDF 的頁數總和，JOIN pages）；`SettingsPage`「語意搜尋索引」小節加入涵蓋率長條（indexed_pages / total_pages 百分比 + 文字）；更新既有後端測試斷言 `total_pages`（共 2 通過）；i18n 1 個 key（`settings.embeddingIndexCoverage`，zh-TW/en）。分支 `feat/embedding-coverage-bar`。

- [x] 課後報告列印頁首：`PostClassReportPanel` 列印（`@media print`）時於報告頂端顯示簡報標題與列印日期（目前列印輸出僅有「課後報告」泛標題）。利用既有 `summary`／`detail` 資料，加入一個僅列印時顯示（`hidden print:block`）的頁首；純前端改動，無新 i18n（沿用既有標題）或補 1 個 key。
  - 修改說明（2026-06-25）：`PostClassReportPanel` 新增 `pdfTitle?: string | null` prop，並在面板容器最上方插入僅列印時顯示（`hidden print:block`）的頁首區塊，顯示簡報標題（無標題則 fallback「課後報告」）與「列印日期：」+ `new Date().toLocaleDateString()`；`PlayPage` 渲染時傳入 `pdfTitle={detail?.title ?? detail?.original_filename}`。純前端改動，無新增 i18n key；typecheck 通過、reportSummary 既有測試 4 個全通過。分支 `feat/report-print-header`，已 merge 回 master。
- [x] AI 導師問這一頁的功能，應該將所有的頁面和原文都送出去。並不要限制回答的長度，目前回答都太簡短了。並且應該改成多輪對話，讓使用者可以追問。
  - 確認說明（2026-06-25）：此需求已於 commit `e51302b`（分支 `feat/ai-tutor-fulldeck-multiturn`，已 merge）完整實作並驗證既存於現行程式碼：`backend/src/routes/pdfs/page-operations.ts` 的 ask 端點改以「全份簡報每頁 text + script」組成 corpus（`ASK_DECK_CORPUS_MAX_CHARS = 14000`）而非僅當前頁；接受 `history`（多輪對話歷史，最多 20 輪）並注入提示；回答 token 上限自 1200 提高至 4000、移除「請簡短」指示讓回答更完整；前端 `usePageAsk.ts` 維護完整 user/assistant 對話、`PageAskPanel.tsx` 以多輪 thread 呈現並支援追問。對應後端測試 `backend/test/page-ask.test.ts`（full-deck + history）。本輪僅作既有功能確認，無新增程式碼。
- [x] 逐字稿 AI 改寫改成跳一個新的對話框，並在其它做多輪對話，可以根據對話結果再重新產生逐字稿。
  - 修改說明（2026-06-25）：原本逐字稿改寫只有「風格預設單次改寫」或被併進共用的 QA／圖片 chat 串（與問答、生圖共用同一條對話）。新增專屬 `ScriptRewriteDialog.tsx` 獨立對話框，擁有自己的多輪對話 state（不再共用 `chatHistory`），透過既有 `rewrite-script` 端點（早已支援 history）逐步改寫本頁逐字稿，每次結果自動套用到 `editingScript`（下方逐字稿編輯器）。對話框自包含（自有 state、讀 `PlayPageContext`，不修改共用 context 與既有 handler），由 `PlayPageSlidePanel` 風格改寫旁的「對話式改寫」按鈕開啟。抽出純函式 `buildRewriteContext()` 並新增 3 個單元測試；zh-TW/en 各補 13 個 `play.scriptRewrite.*` key（共 1668 對等）。typecheck 通過、helper 測試 3 個 + i18n 對等測試 21 個全通過。視覺版面因 sandbox 無瀏覽器未做互動驗證，但接線與邏輯均已驗證。分支 `feat/script-rewrite-dialog`，已 merge 回 master。

- [x] 右邊改成 notebook 界面，把每一個區域放在一個單獨的頁面中，並提供把整個右邊區塊放大的功能。（三階段全部完成，見下方各階段進度）
  - 需求釐清（2026-06-25，經使用者確認）：
    - **介面形式＝頂部分頁標籤切換**：把 `PlayPageSidebar` 目前一長條垂直堆疊的區塊改成右側欄頂端一排分頁標籤（tab bar），一次只顯示一個分頁的內容（取代現行 `activeTab: 'play' | 'qa'` 兩段式 + 長捲動）。
    - **分頁粒度＝合併成幾個主題分頁（約 4 個）**，建議歸併：
      1. 投影片／內容：投影片管理（縮圖 grid、重排、設封面）、大綱（OutlineSection）、相似頁面（SimilarPagesSection）。
      2. AI 助手：AI 問答（PageAskPanel）、品質檢查（QualityCheckPanel），並可放逐字稿改寫對話入口。
      3. 課堂互動：投票（polls）、書籤、重點頁、複習清單（ReviewListSection）。
      4. 筆記與留言：頁面筆記（PageNoteSection）、留言（CommentsSection）。
    - **放大功能＝全域放大任一分頁**：沿用並擴大現有 `qaPanelExpanded` 機制，使任何分頁都能放大成全寬（隱藏左側播放區），再次點擊還原；不限於 QA 分頁。
  - 建議分階段執行（每階段獨立 commit、各自跑 typecheck 與既有前端測試）：
    - 階段一：建立分頁標籤骨架（新增 `NotebookTab` 型別與 tab bar UI，狀態存於 `PlayPageContext`，可記住上次分頁），把現有區塊原封不動歸入 4 個分頁，一次只渲染一個；抽出分頁定義/預設分頁的純函式並補單元測試；補 zh-TW/en 分頁標籤 i18n key。
    - 階段二：把 `qaPanelExpanded` 重構為與分頁無關的全域 `sidebarExpanded`，任一分頁皆可放大成全寬並還原。
    - 階段三：細節打磨（鍵盤左右鍵切換分頁、各分頁未讀/數量 badge、行動裝置版面、i18n 對等測試）。
  - 進度（2026-06-25）：**階段一已完成**（分支 `feat/notebook-sidebar-tabs-phase1`，已 merge）。新增純函式模組 `frontend/src/pages/play/notebookTabs.ts`（`NotebookTab` 型別、`NOTEBOOK_TABS` 4 分頁定義、`isNotebookTab`/`normalizeNotebookTab`/`getStoredNotebookTab`/`setStoredNotebookTab`，localStorage key `makeslide.notebookTab`）＋ 3 個單元測試；`PlayPageSidebar` 頂端加入 4 個分頁標籤（投影片／AI 助手／課堂互動／筆記留言），以本地 state + localStorage 記住上次分頁（暫存於元件本地而非 `PlayPageContext`，待階段三若需跨元件再上移），現有 13 個頂層區塊原封不動依分頁條件渲染、一次只顯示一個分頁：投影片＝投影片管理+相似頁面+大綱；AI 助手＝AI 問答+品質檢查+問答面板；課堂互動＝投票+書籤+重點頁+複習清單；筆記留言＝頁面筆記(×2)+留言。切換分頁時重置 `qaPanelExpanded`（避免殘留 expand 把其他分頁 `md:hidden` 成空白）。zh-TW/en 各補 4 個 `play.sidebar.notebook.*` key。frontend typecheck 通過、全部 271 個前端測試 + i18n 對等 21 個全通過。
  - 進度（2026-06-25）：**階段二已完成**（分支 `feat/notebook-sidebar-expand-phase2`，已 merge）。把 `qaPanelExpanded` 全面重命名為與分頁無關的全域 `sidebarExpanded`（`PlayPageContext`、`PlayPage` state、`PlayPageSidebar`、`PlayPageSlidePanel`）。放大語意改為「隱藏左側播放區、右側欄全寬」：`PlayPageSlidePanel` 根容器於 `sidebarExpanded` 時 `md:hidden`，`PlayPageSidebar` 的 `<aside>` 於展開時改 `md:w-full md:flex-1`（否則 `md:w-[360px] shrink-0`）。放大/還原按鈕從原本只在 AI 分頁的 QA 表頭移到**分頁列尾端**（任一分頁皆可放大），並移除各區塊與分頁列殘留的 `${...? 'md:hidden'}`（改由分頁切換控制顯示），切換分頁不再重置展開狀態（任一分頁都能維持全寬）。沿用既有 `play.sidebar.qa.expand/restore/expandSidebarTitle/restoreSidebarTitle` i18n key（無新增）。frontend typecheck 通過、全部 271 個前端測試 + i18n 對等 21 個全通過。
  - 進度（2026-06-25）：**階段三已完成 → 整個 notebook 項目完成**（分支 `feat/notebook-sidebar-phase3`，已 merge）。① 鍵盤切換：分頁列採 ARIA roving tabindex（僅 active tab `tabIndex=0`），按 ArrowLeft/ArrowRight 在分頁間循環切換並移動焦點（抽出純函式 `getAdjacentNotebookTab(current, ±1)` 處理環繞、補單元測試），因焦點限定於分頁列故不與投影片左右鍵翻頁衝突。② 數量 badge：分頁標籤可顯示數字徽章，目前「課堂互動」分頁顯示 `bookmarks + importantPages + pagePolls` 合計（>0 才顯示），其餘分頁資料不在 sidebar scope 故暫不顯示。③ 行動版面：分頁列 `flex-wrap` 自動換行、標籤 `flex-1` 平均分配，放大鈕 `md:` 限定（手機本為單欄全寬切換）。frontend typecheck 通過、全部 272 個前端測試 + i18n 對等 21 個全通過。
- [x] AI 生成動畫的紅框位置都不正確，是否圖片有被正確的傳送。
  - 修改說明（2026-06-25）：根因為**前端編輯器預覽容器寫死 16:9**（`AnimationEditorTab.tsx` 的 `EffectPositionEditor`，`paddingTop:'56.25%'`）搭配 `object-fit:contain`：當投影片實際長寬比非 16:9（如 PDF 匯入的 4:3／直式頁面）時，圖片在容器內被 letterbox 留邊，而焦點方框的 `left/top/width/height` 是相對「容器」百分比，AI 卻是相對「真實圖片」回傳百分比，於是紅框錯位。修正：容器 `paddingTop` 改為依圖片實際比例（img `onLoad` 讀 `naturalWidth/Height`，抽出純函式 `imageAspectPaddingPct()`、預設 56.25% fallback），消除 letterbox 使百分比對齊。另查證後端圖片傳送正確（`animationAutoFocus.loadFocusAiPageImageDataUrl` 以 sharp `fit:'inside'` 保留長寬比、送的是該頁 `image_path`），播放/全螢幕側以 `object-contain` + max 尺寸依自然比例渲染、stage 緊貼圖片，故一致。新增 `imageAspectPaddingPct` 單元測試（16:9→56.25、4:3→75、直式、無效值 fallback）。typecheck 通過、`AnimationEditorTab.test.ts` 4 個測試全通過。視覺結果因 sandbox 無瀏覽器未做像素級驗證，但座標數學與最小改動已驗證。分支 `fix/animation-focus-box-aspect`，已 merge 回 master。
- [x] 動畫生成的提示詞沒有記下來。
  - 修改說明（2026-06-25）：`SlideAnimationEffect.prompt`（產生 custom-script `code` 的提示詞）型別早已定義、後端 `validateAnimationSpec` 也已保留（`pageAnimation.ts` 行 618），但前端 `usePageAnimation.ts` 生成成功時只寫入 `code` 與 `conversation`、從未寫入 `prompt`，導致提示詞未被記錄。修正：生成成功時一併設定 `effect.prompt = prompt`（隨存檔持久化）；並修改 `AnimationEditorTab.tsx` 開啟 custom-script 對話框時，以該效果已記錄的 `prompt` 回填輸入框（無則清空），方便直接在原提示詞上迭代。純前端改動；typecheck 通過、`AnimationEditorTab.test.ts` 3 個測試全通過。分支 `feat/animation-record-prompt`，已 merge 回 master。
- [x] 大網生成的提示詞也要記錄下來。並在 UI 上可以顯示出來。
  - 修改說明（2026-06-25）：簡報生成提示詞早已記錄於 `pdfs.user_prompt`（`upload.ts` 於送出生成時寫入、`detail` 路由回傳），但前端僅用於「重新生成」對話框的預填，從未在檢視時顯示。新增：`PlayPageHeader` 在簡介折疊區下方新增「顯示生成提示詞」折疊區塊（複用 description 的折疊 + 複製模式），僅在非分享檢視（`!currentShareToken`）且 `detail.user_prompt` 非空時顯示，附「複製提示詞」按鈕。zh-TW/en 各新增 4 個 `play.header.*Prompt*` key（共 1655 對等）。純前端改動；typecheck 通過、i18n 對等測試 21 個全通過。分支 `feat/show-generation-prompt`，已 merge 回 master。
- [x] AI 導師問這一頁的功能， 沒有將原文 extra 出的全文或 PDF 傳出去，所以無法顯示不在逐字稿的答案。
  - 修改說明（2026-06-25）：先前 ask 端點的全份 corpus 只含每頁的「投影片文字（text_path）+ 逐字稿（script_path）」，未納入原始 extract 出的來源全文（`source.txt`），導致答案只存在於原文、未寫進投影片/逐字稿時無法回答。修正：`page-operations.ts` 的 `POST /api/pdfs/:id/pages/:n/ask` 改為另外讀取 `sourceTextPath(id)`（`source.txt`，上限 12000 字、`ASK_SOURCE_TEXT_MAX_CHARS`），以獨立區塊「原始來源全文」附在簡報逐頁內容之後送給模型；system/user 提示詞同步說明「當答案只在原始來源全文時也要據以作答」。新增後端測試（頁面 text/script 不含關鍵字、`source.txt` 含 `ZETA9`，斷言送模型的 prompt 含原文與標籤）。因 sandbox 無法捕捉 node:test 輸出，另以獨立 Fastify inject 腳本驗證通過（STATUS 200、原文與標籤皆送達）。backend typecheck 通過。分支 `feat/ai-tutor-source-text`，已 merge 回 master。

## 掃描摘要（2026-06-25 第三十三輪後半）

- 本輪結束時，TODO 僅剩 1 個未完成項目「右邊改成 notebook 界面」。**2026-06-25 已向使用者釐清需求**（見該項目下方「需求釐清」）：介面形式為頂部分頁標籤切換、分頁粒度為合併成約 4 個主題分頁、放大功能為全域放大任一分頁；已附建議的三階段執行計畫，後續輪次可依階段逐步實作。
- 依 LOOP.md「無可安全執行項目時分析程式並新增項目」，依本輪在程式中的實際觀察新增以下可執行、低風險項目，供後續輪次處理。

## 新增可執行項目（2026-06-25）

- [x] PostClassReportPanel 國際化（第二階段）：延續第一階段（已抽工具列與標題），把面板內文其餘硬編中文抽成 i18n key，至少包含：載入訊息「正在載入課後報告…」、四張 `SummaryCard` 的 label/hint（參與人數、測驗平均分數、投票參與率、學生提問及其 hint）、各區塊標題（最容易答錯的題目／投票分歧最高頁面／觀看完成率最低頁面／全頁完成率熱力圖／逐題答對率）與其副說明、各空狀態提示、`重置失敗`／`已重置（N 筆）` 結果訊息（含插值，註：`t()` 目前不支援插值，數字部分用樣板字串組合）。改用 `useI18n()`，補 zh-TW/en 對應 key；純前端，跑 `i18n.test.ts` 對等性測試確保兩語系 key 數對齊。
  - 修改說明（2026-06-25）：把 `PostClassReportPanel.tsx` 內文所有殘留硬編中文全面抽成 i18n key（超出原列舉範圍，連同「個別學生分析」下拉/選項、「作答時間軸」、「AI 教學建議」按鈕與錯誤、頁尾「產生時間」、列印頁首「列印日期」、熱力圖 tooltip、reset title/結果訊息一併處理）；含插值處依規範以樣板字串 + 前後綴 key 組合（如 `已重置（N 筆）`＝`resetDonePrefix`+N+`resetDoneSuffix`、SummaryCard hint、學生選項 `(N 次作答，平均 M 分)` 等），頁碼/分數/括號統一用 `pagePrefix/pageSuffix`、`completionLabel`、ASCII 括號組合。zh-TW/en 各新增 60 個 `play.report.*` key（共 1731 對等）。`grep` 確認元件已無中文字元；frontend typecheck 通過、i18n 對等測試 21 個全通過。分支 `feat/report-panel-i18n-phase2`，已 merge 回 master。

- [x] 逐字稿改寫對話框顯示目前逐字稿並可復原：`ScriptRewriteDialog` 目前每輪改寫會直接覆寫 `editingScript`，使用者看不到改寫前的原稿、也無法復原。於對話框頂端（對話串上方）新增一塊唯讀區顯示「目前逐字稿」（`editingScript`），並在每次套用改寫後提供「復原上一次改寫」按鈕（送出前先記住套用前的 `editingScript`，按下即還原並從對話串移除該輪 assistant 訊息）。純前端、自包含於該對話框；補對應 i18n key 與一個記錄/還原邏輯的純函式單元測試。
  - 修改說明（2026-06-25）：`ScriptRewriteDialog.tsx` 在 header 與對話串之間新增唯讀「目前逐字稿」區（`max-h-32` 可捲動、空稿顯示提示），其右上角放「復原上一次改寫」按鈕。新增 `undoStack` state：每次改寫送出前先記下套用前的 `editingScript`（原始未 trim 值），改寫成功時 push；復原時抽出純函式 `popRewriteUndo(messages, undoStack)`，還原 script、移除對話串中最後一則 assistant（改寫結果）訊息並 pop undo stack，無可復原時回傳 null。「清除對話」一併清空 undoStack（抽成 `handleClear`）。zh-TW/en 各補 3 個 `play.scriptRewrite.*` key（currentScriptLabel/currentScriptEmpty/undo，共 1671 對等）。新增 3 個 `popRewriteUndo` 單元測試（空堆疊回 null、單輪還原、多輪逐步還原），helper 測試共 6 個 + i18n 對等測試 21 個全通過；frontend typecheck 通過。分支 `feat/script-rewrite-show-original-undo`，已 merge 回 master。

- [x] 側邊欄 QA 面板拆分逐字稿改寫與問答/生圖（notebook 化第一步）：目前 `PlayPageSidebar` 的 QA 面板讓「AI 問答」「生圖/inpaint」「逐字稿改寫」共用同一條 `chatHistory`，三種用途混在一起、語意混淆（這也是「右邊改成 notebook 界面」可獨立先做的一步）。將逐字稿改寫從共用 chat 串移除（改走已新增的獨立 `ScriptRewriteDialog`），QA 面板專注於「問答 + 生圖」，並在面板加上簡短用途說明。純前端、以既有元件與 context 為主，不新增後端；變更後跑 typecheck 與既有前端測試確認無回歸。
  - 修改說明（2026-06-25）：`PlayPageSidebar` 的 QA 面板輸入區移除「修改逐字稿」按鈕（原 `handleRewriteScript`，會把改寫塞進共用 `chatHistory`）與其 `rewriteError` 顯示，並從 context 解構中移除 `handleRewriteScript`/`rewriteBusy`/`rewriteError`（這三者仍保留在 `useScriptEditor`/`PlayPageContext` 供日後使用，僅 QA 面板不再呼叫）。QA 面板現專注於「問答 + 生圖／改圖」，標題下方新增一行用途說明，指引逐字稿改寫改用投影片面板的「對話式改寫」對話框（`ScriptRewriteDialog`，自有獨立多輪 state）。zh-TW/en 各新增 1 個 `play.sidebar.qa.usageNote` key（`editTranscript` key 保留未用）。純前端、未動後端；frontend typecheck 通過、全部 268 個前端測試 + i18n 對等 21 個全通過。分支 `feat/qa-panel-split-rewrite`，已 merge 回 master。

## 掃描摘要（2026-06-25 第三十四輪）

- 本輪開始時 TODO 已無未完成項目（notebook 三階段全數完成）。依 LOOP.md「無可安全執行項目時分析程式並參考 `docs/FUTURE_ROADMAP.md` 新增項目」進行一次掃描。
- roadmap 的十項主要功能（2.1–2.10：課後報告、AI 導師、成本預估、跨簡報搜尋、課程包、行動控制器、品質檢查、模板、協作/版本、匯出）多已於前數十輪實作完成；本輪改聚焦於既有程式中的低風險增量缺口。
- 觀察：`PlayPage.tsx` 仍有大量硬編中文（行動版「播放／問答」分頁標籤、`無效的 PDF id`／`返回首頁`／`載入中…`／`圖片產生中…`／無可播放頁面等狀態畫面、`aria-label="新投票"`、唯讀/產生中提示），與已完成的多輪 i18n 工作不一致。
- 觀察：`RemoteControllerPage.tsx` 有 2 處殘留硬編中文（投影片 alt「第 N 頁」、「N 票」）。
- 觀察：notebook 分頁數量 badge 目前只有「課堂互動」分頁；「投影片」分頁可用既有 `deckPages.length` 直接顯示總頁數，提升一致性。
- 觀察：notebook 分頁鍵盤切換已支援 ←/→，可再補 Home/End 跳到首/末分頁（延續既有 roving tabindex，純前端 a11y 小增強）。

## 新增可執行項目（2026-06-25 第三十四輪）

- [x] PlayPage.tsx 行動分頁與狀態畫面國際化：把 `frontend/src/pages/PlayPage.tsx` 中的硬編中文抽成 i18n key，至少包含：行動版頂部分頁「播放」「問答」標籤、`新投票` 的 `aria-label`、`無效的 PDF id`／`返回首頁`（出現兩處）／`載入中…`／`圖片產生中…`／「尚未產生可瀏覽的頁面（…）」／「這份 PDF 沒有可播放的語音頁面」／「系統將每 3 秒重新檢查一次狀態…」等狀態畫面文字。改用 `useI18n()`；含插值（status / progress_step）處以樣板字串 + 前後綴 key 組合。錯誤訊息字串（`setSyncError`/`setAudioError`/`ApiError` fallback 等）可一併或後續處理（量大，至少先處理使用者直接可見的版面文字）。補 zh-TW/en 對應 key 並跑 `i18n.test.ts` 對等測試。純前端。
  - 修改說明（2026-06-25）：新增 `play.mobileTab.*`（play/qa/newPollAria）與 `play.status.*`（invalidPdfId/backHome/loading/noPagesGeneratingPrefix/noPagesGeneratingSuffix/noAudioPages/recheckHint/imageGenerating）共 11 個 key（zh-TW/en 各 11，i18n 對等總數 1750）。`PlayPage.tsx` 行動版分頁「播放／問答」、新投票 `aria-label`、四個全螢幕狀態畫面（invalid id／loadError 返回首頁／載入中／totalPages=0 的產生中或無語音頁＋每 3 秒重檢提示＋返回首頁）、以及「圖片產生中…」浮層全部改用 `t()`；「尚未產生可瀏覽的頁面（status / progress_step）」以 prefix+插值+suffix 組合。`t` 早已於 PlayPage 取得（`useI18n()`，行 164），所有早期 return 皆在其後故 in scope。**範圍說明**：依本項允許，`setSyncError`/`setAudioError`/`ApiError` fallback 等錯誤訊息字串量大且多為非主要版面文字，本次未處理、留待後續輪次（可另開 i18n 項目）。frontend typecheck 通過、i18n 對等測試 21 個全通過。分支 `feat/playpage-mobile-status-i18n`，已 merge 回 master。

- [x] RemoteControllerPage 殘留硬編中文國際化：把 `frontend/src/pages/RemoteControllerPage.tsx` 的 2 處硬編中文抽成 i18n key——投影片 `alt={`第 ${currentPage} 頁`}` 與投票結果 `{poll.total_votes} 票`，沿用既有 `play.report.pagePrefix/pageSuffix`、`votesSuffix` 之類或新增 `remote.*` key（擇一致風格）。補 zh-TW/en 並跑 i18n 對等測試。純前端、小改動。
  - 修改說明（2026-06-25）：新增 3 個 `remote.*` key（`slideAltPrefix`/`slideAltSuffix`/`votesSuffix`，與該頁既有 `remote.*` 命名一致）；投影片 `alt` 改為 `${slideAltPrefix}${currentPage}${slideAltSuffix}`、投票數改為 `{poll.total_votes}{votesSuffix}`。`grep` 確認該頁已無中文字元；zh-TW/en 各補 3 key；frontend typecheck 通過、i18n 對等測試 21 個全通過。分支 `feat/remote-controller-i18n`，已 merge 回 master。

- [x] notebook「投影片」分頁顯示總頁數 badge：在 `PlayPageSidebar` 的 `notebookTabCounts` 加入 `slides: deckPages.length`（沿用既有 badge 渲染，>0 才顯示），讓使用者不必切換即可看到簡報總頁數。可把 `notebookTabCounts` 的計算抽成純函式（輸入 bookmarks/importantPages/pagePolls/deckPages 長度，輸出各分頁數量）並補一個單元測試。純前端、低風險。
  - 修改說明（2026-06-25）：把分頁數量計算抽成純函式 `computeNotebookTabCounts({ slides, bookmarks, important, polls })`（`notebookTabs.ts`），回傳 `{ slides, interact }`（slides＝總頁數、interact＝書籤+重點頁+投票合計）；`PlayPageSidebar` 改呼叫此函式並傳入 `deckPages.length` 等，沿用既有 badge 渲染（>0 才顯示）故「投影片」分頁現顯示總頁數。新增 2 個單元測試（一般值、空 deck），notebookTabs 測試共 6 個；無新增 i18n key（badge 為數字）。frontend typecheck 通過、全部 274 個前端測試 + i18n 對等 21 個全通過。分支 `feat/notebook-slides-count-badge`，已 merge 回 master。

- [x] notebook 分頁鍵盤 Home/End 跳首末分頁：延續 phase 3 的 ARIA roving tabindex，在 `handleTabKeyDown` 支援 `Home`（跳第一個分頁）與 `End`（跳最後一個分頁）並移動焦點；抽出/沿用純函式取首末分頁 id 並補單元測試。純前端 a11y 小增強。
  - 修改說明（2026-06-25）：新增純函式 `getEdgeNotebookTab('first'|'last')`（`notebookTabs.ts`）回傳首/末分頁 id；`PlayPageSidebar` 的 `handleTabKeyDown` 改為依 `ArrowRight/ArrowLeft/Home/End` 計算目標分頁，命中才 `preventDefault` 並切換 + 移動焦點（沿用 roving tabindex，焦點限定分頁列故不與翻頁衝突）。補 1 個 `getEdgeNotebookTab` 單元測試（notebookTabs 測試共 7 個）；無新增 i18n key。frontend typecheck 通過、全部 275 個前端測試 + i18n 對等 21 個全通過。分支 `feat/notebook-home-end-keys`，已 merge 回 master。
- [x] AI 導師問這一頁時，回答時如果引用其它頁的資訊，要主動加入引用。
  - 修改說明（2026-06-25）：`POST /api/pdfs/:id/pages/:n/ask`（`page-operations.ts`）的 corpus 早已把每頁標為「# 第 N 頁」並標示「（學生目前所在頁）」，系統提示詞也已提「必要時可跨頁說明並標示頁碼／引用內容時以括號標示來源」，但語氣為「必要時」「引用時」屬非強制。強化系統提示詞為**強制引用規則**：新增「【引用規則（務必遵守）】只要回答用到『學生目前所在頁』以外其他頁面的資訊，就必須在該處主動以括號標示來源頁碼（例如「（第 3 頁）」「（第 3 頁逐字稿）」），不可省略；引用原始來源全文標示「（原始來源）」；引用目前所在頁則可不標示」，並在開頭說明每頁的「# 第 N 頁」標示方式。`page-ask.test.ts` 既有「綜合全份」測試新增 2 條斷言（系統提示含「引用規則」與「學生目前所在頁…以外」）。backend typecheck 通過；後端測試於 sandbox 跑 `with-node-env.sh` 套件測試達 180s timeout 被終止（與前數輪 sandbox 限制一致），改以 backend typecheck + 核對新提示詞確含兩個斷言目標字串確認測試斷言成立。分支 `feat/ai-tutor-mandatory-cross-page-citation`，已 merge 回 master。

## 掃描摘要（2026-06-25 第三十五輪）

- 上一輪結束時 TODO 再次清空，依 LOOP.md 掃描程式 + 參考 `docs/FUTURE_ROADMAP.md`（主要功能 2.1–2.10 多已實作）後，聚焦既有程式碼的低風險增量缺口。
- 觀察：`formatRelativeTime`（「剛剛／N 分鐘前／N 小時前／N 天前／N 個月前／N 年前」）在 `components/PdfCard.tsx` 與 `pages/QuizBuilderPage.tsx` **完全重複**且硬編中文——可抽成共用、可測、i18n 化的 helper，同時消除重複。
- 觀察：`PlayPage.tsx` 仍有大量硬編中文的錯誤/狀態訊息（`setSyncError`/`setAudioError`/`ApiError` fallback、`載入失敗`、`文稿不可為空`、`重生語音失敗` 等），上一輪 i18n 已處理版面文字、這批錯誤字串留待本輪後續。
- 觀察：`AnimationEditorTab.tsx` 有約 50 處中文（UI 標籤 + 範例提示詞），尚未 i18n，是較大的一塊。
- 觀察：零星小元件仍有可見硬編中文（`PageTimingChips` 的「產生中」等）。

## 新增可執行項目（2026-06-25 第三十五輪）

- [x] 相對時間格式化抽成共用 i18n helper：`components/PdfCard.tsx` 與 `pages/QuizBuilderPage.tsx` 各有一份完全相同、硬編中文的 `formatRelativeTime`。抽成共用模組（例如 `frontend/src/lib/relativeTime.ts`）並 i18n 化（因 `t()` 不支援插值，回傳「數字 + 單位後綴 key」樣板字串組合，或讓 helper 接受一組 label 字串）；兩處改用共用版本以消除重複。補單元測試涵蓋各區間（剛剛 / 分鐘 / 小時 / 天 / 月 / 年、無效輸入 fallback）。補 zh-TW/en key、跑 i18n 對等測試。純前端、低風險。
  - 修改說明（2026-06-25）：新增 `frontend/src/lib/relativeTime.ts`：純函式 `formatRelativeTime(iso, labels, now?)` 與 `RelativeTimeLabels` 介面（labels 由呼叫端以 `t()` 組好傳入，因 `t()` 不支援插值；後綴含前導空白）；順手修掉原版對無效日期會回傳「NaN 年前」的問題（新增 `Number.isNaN(ts)` 防護回傳原字串）。`PdfCard` 與 `QuizBuilderPage` 移除各自重複的本地 `formatRelativeTime`，改 import 共用版並各自以 `t('time.*')` 建 `relativeTimeLabels` 傳入。新增 6 個 `time.*` key（justNow/minutesSuffix/hoursSuffix/daysSuffix/monthsSuffix/yearsSuffix，zh-TW/en 各 6）。新增 `relativeTime.test.ts` 2 個單元測試（各區間 bucket、無效輸入 fallback）。frontend typecheck 通過、全部 277 個前端測試 + i18n 對等 21 個全通過。分支 `feat/shared-relative-time-i18n`，已 merge 回 master。

- [x] PlayPage.tsx 錯誤與狀態訊息國際化（第二批）：延續上一輪（已處理行動分頁與全螢幕版面文字），把 `PlayPage.tsx` 仍硬編中文的錯誤/狀態訊息抽成 i18n key，至少包含 `setSyncError` 系列（同步連線/狀態更新/輪詢/送出問題/舉手/切換顯示/AI 回答/AI 摘要 失敗）、`setAudioError`（語音載入失敗）、`loadError` 預設（`載入失敗`、`分享連結與簡報不符`）、`文稿不可為空`、`重生語音失敗`、唯讀/產生中橫幅提示文字等。改用 `useI18n()` 既有 `t`；含 `status`/`progress_step` 插值處以樣板字串組合。補 zh-TW/en 並跑 i18n 對等測試。純前端。
  - 修改說明（2026-06-25）：新增 18 個 key（`play.banner.*`：readOnlyShare/generatingPrefix/generatingSuffix；`play.error.*`：audioLoad/shareMismatch/loadFailed/syncConnect/syncStateUpdate/syncPoll/submitQuestion/raiseHand/toggleQuestion/aiAnswerFollower/aiSummarizeQuestions/reportLoad/scriptEmpty/regenAudio，zh-TW/en 各 18）。`PlayPage.tsx` 把 `setAudioError`、兩處 `throw new ApiError('分享連結與簡報不符')`、`loadError` 預設、唯讀/產生中橫幅（產生中以 `generatingPrefix + status + (/progress_step) + generatingSuffix` 組合）、`setSyncError` 8 種、課後報告載入失敗（含 `||` fallback）、`文稿不可為空`、`重生語音失敗` 全部改用既有 `t`（皆在元件 scope，typecheck 驗證通過）。`grep` 確認 PlayPage.tsx 僅剩 `deckImageStylePromptRef` 的預設圖片風格 prompt（屬生成內容、非 UI 文字，刻意保留）。frontend typecheck 通過、全部 277 個前端測試 + i18n 對等 21 個全通過。分支 `feat/playpage-error-messages-i18n`，已 merge 回 master。

- [x] AnimationEditorTab 國際化：把 `pages/play/AnimationEditorTab.tsx` 的硬編中文（UI 標籤、按鈕、狀態文字，以及內建範例提示詞清單）抽成 i18n key；範例提示詞可作為預設內容 key（zh-TW 維持現中文、en 提供英文版）。改用 `useI18n()`，補 zh-TW/en 對應 key 並跑 i18n 對等測試。純前端；量較大，可只先處理 UI 標籤/按鈕、範例提示詞列為次階段。
  - 修改說明（2026-06-25）：實際掃描後發現 `AnimationEditorTab.tsx` 的 ~50 處中文絕大多數是**程式碼註解**（開發用、非 UI），UI 標籤/按鈕/狀態先前早已用 `t()`；真正殘留的使用者可見硬編中文僅兩處：① header 的「（第 N 頁）」、② 自訂腳本對話框的 5 個範例提示詞下拉（`labelKey` 已 i18n，但點選後插入輸入框的 `prompt` 仍是中文內容）。修正：header 改用新增的 `play.animation.headerPagePrefix/Suffix`；範例陣列 `prompt: string` 改為 `promptKey: string`（5 個 `play.animation.customScriptExamplePrompt.*`），`<option value={t(ex.promptKey)}>` 於點選時依語系插入對應語言的提示詞（en 提供英文版）。共新增 7 個 key（zh-TW/en 各 7）。frontend typecheck 通過、全部 277 個前端測試 + i18n 對等 21 個全通過。分支 `feat/animation-editor-i18n`，已 merge 回 master。

## 掃描摘要（2026-06-25 第三十六輪）

- 第三十五輪 4 個 i18n 項目完成後 TODO 再次清空，依 LOOP.md 掃描程式 + 參考 `docs/FUTURE_ROADMAP.md`（主要功能多已實作）後，繼續清理零星低風險缺口。
- 觀察：上一輪把 `formatRelativeTime` 抽成 `lib/relativeTime.ts` 並改寫 `PdfCard`/`QuizBuilderPage`，但 **`HomePage.tsx` 仍有第三份重複**的本地 `formatRelativeTime`（行 49，用於 1394/1401）尚未改用共用版——應一併去重 + i18n。
- 觀察：`SystemDataPage.tsx` 有 1 處可見硬編中文（`模型價格未知`）。
- 觀察：`FigureAssetsTab.tsx` header 有「（第 N 頁）」硬編中文（與 AnimationEditorTab header 同模式）。
- `DrawingCanvas`/`SlideRenderer` 等其餘元件的中文多為程式碼註解，非 UI，無需處理。

## 新增可執行項目（2026-06-25 第三十六輪）

- [x] HomePage 改用共用 relativeTime helper（完成相對時間去重）：`pages/HomePage.tsx` 仍保有一份與 `lib/relativeTime.ts` 重複的本地 `formatRelativeTime`（硬編中文）。移除本地版、改 import 共用 `formatRelativeTime` 並以 `t('time.*')` 建 `relativeTimeLabels` 傳入（沿用既有 `time.*` key，無需新增）；兩處呼叫（`last_played_at`、`updated_at`）改用之。純前端、低風險，跑 typecheck 與既有前端測試。
  - 修改說明（2026-06-25）：移除 `HomePage.tsx` 第三份重複的本地 `formatRelativeTime`（連同其硬編中文與「NaN 年前」舊問題一併消除），改 import `lib/relativeTime.ts` 的共用版並以 `t('time.*')` 建 `relativeTimeLabels`；`last_played_at`、`updated_at` 兩處呼叫改傳 labels。沿用既有 6 個 `time.*` key、無新增 key。至此三處（PdfCard/QuizBuilderPage/HomePage）的相對時間格式化已全部統一到單一共用 helper。frontend typecheck 通過、全部 277 個前端測試 + i18n 對等 21 個全通過。分支 `feat/homepage-relative-time-dedup`，已 merge 回 master。

- [x] SystemDataPage 殘留中文國際化：把 `pages/SystemDataPage.tsx` 的 `模型價格未知`（及掃描確認的其他少量可見中文）抽成 i18n key（如 `systemData.modelPriceUnknown`），改用 `useI18n()`，補 zh-TW/en 並跑 i18n 對等測試。純前端、小改動。
  - 修改說明（2026-06-25）：`formatCost`/`formatDuration` 為 module 層函式（`t` 不可用），改為各接受一個 label 參數：`formatCost(value, unknownLabel)`、`formatDuration(ms, secondsSuffix)`，呼叫端傳入 `t('systemData.modelPriceUnknown')` 與 `t('systemData.secondsSuffix')`。除原列舉的「模型價格未知」外，另一併處理掃描發現的時長單位「秒」（原於 template literal 中漏抓）。新增 2 個 key（`systemData.modelPriceUnknown`、`systemData.secondsSuffix`，zh-TW/en 各 2）。`grep` 確認該檔已無任何中文字元。frontend typecheck 通過、全部 277 個前端測試 + i18n 對等 21 個全通過。分支 `feat/systemdata-i18n`，已 merge 回 master。

- [x] FigureAssetsTab header「（第 N 頁）」國際化：把 `pages/play/FigureAssetsTab.tsx` header 的「（第 N 頁）」改用 i18n（沿用既有 `play.animation.headerPagePrefix/Suffix`，或新增 `play.figures.headerPagePrefix/Suffix` 保持語意一致），補 zh-TW/en（若新增）並跑 i18n 對等測試。純前端、小改動。
  - 修改說明（2026-06-25）：為語意一致新增 `play.figures.headerPagePrefix`/`headerPageSuffix`（與 `play.figures.*` 同命名空間，值同 animation header），header 改為 `{title}{headerPagePrefix}{pageNumber ?? '-'}{headerPageSuffix}`（zh「（第 N 頁）」、en「 (Page N)」）。新增 2 個 key（zh-TW/en 各 2）。`grep` 確認該檔已無可見硬編中文。frontend typecheck 通過、全部 277 個前端測試 + i18n 對等 21 個全通過。分支 `feat/figures-header-i18n`，已 merge 回 master。

- [x] 零星小元件殘留硬編中文國際化：把 `pages/play/PageTimingChips.tsx`（如「產生中」）與其他少量殘留可見中文（掃描 `QualityCheckPanel`、`PlayPageSlidePanel`、`PlayPageSidebar`、`PlayPageHeader` 等元件確認）抽成 i18n key，補 zh-TW/en 並跑 i18n 對等測試。純前端、低風險清理。
  - 修改說明（2026-06-25）：將使用者可見的硬編中文抽成 i18n key：`PageTimingChips` 計時「產生中」；`PlayPageSlidePanel` 分頁進度條 `aria-label`（第 X 頁，共 Y 頁）與「清除搜尋」`aria-label`；`PlayPageSidebar` 「此頁已有筆記」title、書籤/重點頁的「第 N 頁」縮圖 alt 與顯示文字、以及複製清單文字（「第 N 頁」以分隔符 join）。新增 7 個 key：`play.common.pagePrefix`/`pageSuffix`（共用「第 N 頁」前後綴）、`play.timing.generating`、`play.slidePanel.clearSearchAria`/`pageProgressMid`、`play.sidebar.hasNotesTitle`/`pageListSeparator`（zh-TW/en 各 7）。**範圍說明**：`QualityCheckPanel` 與 `PlayPageSlidePanel` 的 LLM 提示詞常數（如 BATCH_FILL_PROMPT、改寫風格 prompt）、各元件 `ApiError`/`Error` fallback 錯誤訊息、以及 `PlayPageHeader` 全文逐字稿 markdown 匯出的「## 第 N 頁」標頭屬內部/匯出內容或 PlayPage 錯誤訊息批次（第二批項目）範疇，本次未動。frontend typecheck 通過、全部 277 個前端測試 + i18n 對等 21 個全通過。分支 `feat/misc-components-i18n`，已 merge 回 master。

## 掃描摘要（2026-06-25 第三十七輪）

- 第三十六輪 3 個項目完成後 TODO 再次清空，依 LOOP.md 做一次較全面的「使用者可見硬編中文」掃描（含 JSX 文字、屬性、template literal）。
- 前端可見硬編中文已大致清乾淨，剩餘多為：① 工具提示/tooltip 文字，② 根層載入畫面，③ 複製/匯出用的文字內容，④ 刻意延後的內部 LLM 提示詞常數與錯誤 fallback。
- 觀察：`PageTimingChips.tsx` 的 `timingTitle()`（hover tooltip）仍硬編「耗時：／原因：／開始：／結束：／錯誤：／尚無紀錄」。
- 觀察：`App.tsx` 設定載入畫面有「載入設定中…」。
- 觀察：複製/匯出文字仍含中文標籤：`QuizBuilderPage` 匯出題目的「解說：」、`PlayPageHeader` 逐字稿全文 markdown 匯出的「## 第 N 頁」標頭。

## 新增可執行項目（2026-06-25 第三十七輪）

- [x] PageTimingChips tooltip 文字國際化：`pages/play/PageTimingChips.tsx` 的 module 層 `timingTitle()` 組出的 hover tooltip 仍硬編中文（`${label}：尚無紀錄`、`耗時：`、`原因：`、`開始：`、`結束：`、`錯誤：`）。將這些標籤抽成 i18n key，並把 `timingTitle` 改為接受 label 字串（或 `t`）以保持 module 層純函式可測；補 zh-TW/en 並跑 i18n 對等測試。純前端、低風險。
  - 修改說明（2026-06-25）：`timingTitle()` 維持 module 層純函式，新增第三參數 `L: TimingTooltipLabels`（colon/noRecord/elapsed/reason/started/ended/error），元件以 `t('play.timing.tooltip.*')` 組好傳入；`SLA` 與 `run` 為英數縮寫保留字面，僅冒號改用 `L.colon`。新增 7 個 `play.timing.tooltip.*` key（含全形/半形冒號差異，zh-TW/en 各 7）。`grep` 確認該檔已無可見硬編中文。frontend typecheck 通過、全部 277 個前端測試 + i18n 對等 21 個全通過。分支 `feat/timing-tooltip-i18n`，已 merge 回 master。

- [x] App.tsx 設定載入畫面國際化：`App.tsx` 設定載入時的「載入設定中…」改用 `useI18n()` 的 `t`（`useI18n` 由 localStorage 取語言、無需 provider 即可運作），補 zh-TW/en key 並跑 i18n 對等測試。純前端、小改動。
  - 修改說明（2026-06-25）：`App.tsx` 新增 `import { useI18n }` 與 `const { t } = useI18n()`，把 `checked` 為 false 時的載入畫面「載入設定中…」改為 `t('app.loadingSettings')`。新增 1 個 `app.loadingSettings` key（zh-TW/en 各 1）。`grep` 確認 App.tsx 已無中文。frontend typecheck 通過、全部 277 個前端測試 + i18n 對等 21 個全通過。分支 `feat/app-loading-i18n`，已 merge 回 master。

- [x] 複製/匯出文字國際化：`QuizBuilderPage` 複製題目時的「解說：」標籤與 `PlayPageHeader` 逐字稿全文 markdown 匯出的「## 第 N 頁」標頭抽成 i18n key（沿用既有 `play.common.pagePrefix/pageSuffix` 或新增），使匯出內容依介面語言產生；補 zh-TW/en 並跑 i18n 對等測試。純前端、低風險。
  - 修改說明（2026-06-25）：`QuizBuilderPage` 複製題目文字的「解說：」改用新增的 `quiz.exportExplanationLabel`（zh「解說：」/en「Explanation: 」）；`PlayPageHeader` 複製全文逐字稿的 markdown 標頭「## 第 N 頁」改用既有 `play.common.pagePrefix/pageSuffix`（zh「## 第 N 頁」/en「## Page N」），無需新增 page key。共新增 1 個 key（zh-TW/en 各 1）。兩處皆在元件 callback、`t` 可用。frontend typecheck 通過、全部 277 個前端測試 + i18n 對等 21 個全通過。分支 `feat/copy-export-text-i18n`，已 merge 回 master。

- [x] AI 草稿投票題的地方，如果問題有輸入，那就產生問題的選項。否則根據本頁資訊產生問題和選項。
  - 修改說明（2026-06-25）：`POST /api/pdfs/:id/pages/:n/generate-poll`（`generate-poll.ts`）新增可選 body `{ question?: string }`。若帶非空 `question`：以新 `GeneratedOptionsSchema`（只驗 `options` 2–4）與專用 system prompt「依投影片內容為『這道題目』產生互斥、貼題、不含答案提示的選項」，回傳 `{ question: <原輸入>, options }`；若無 `question`：維持原行為（同時產生題目與選項）。前端 `generatePollDraft(id, n, question?)` 在有輸入時以 JSON body 帶 `question`；`usePagePolls.handleGeneratePollDraft` 改傳目前 `pollQuestion`（deps 補 `pollQuestion`），故教師若已在投票設定輸入題目，按「AI 草稿」只補選項、否則整題生成。`generate-poll.test.ts` 新增「帶 question 只生成選項並保留原題」測試（mock options-only）。backend + frontend typecheck 通過、全部 277 個前端測試通過；後端測試於 sandbox 仍 timeout（與前數輪一致），改以 typecheck + 邏輯核對確認。分支 `feat/poll-draft-options-for-given-question`，已 merge 回 master。

## 掃描摘要（2026-06-25 第三十八輪）

- TODO 再次清空，前端使用者可見硬編中文已大致清乾淨（剩餘多為刻意保留的 LLM 生成提示詞內容）。本輪依 LOOP.md 轉向其他類型的低風險改善：消除重複、補既有純函式 helper 的測試覆蓋。
- 觀察：上一波相對時間 i18n 後，`PdfCard`、`QuizBuilderPage`、`HomePage` **三處各自重複建立相同的 `relativeTimeLabels` 物件**（6 個 `t('time.*')`）——可抽成一個小 helper 消除重複。
- 觀察：`lib/reviewList.ts`（複習清單，含 `addReviewItems` dedup、`removeReviewItem` 過濾、`getReviewItems` 解析/fallback）為真實使用中的邏輯但**無單元測試**。
- 觀察：`lib/viewerId.ts`（匿名訪客 id 產生/持久化）亦無單元測試。

## 新增可執行項目（2026-06-25 第三十八輪）

- [x] 消除 relativeTimeLabels 重複：`PdfCard`/`QuizBuilderPage`/`HomePage` 各自以 6 個 `t('time.*')` 建相同的 `relativeTimeLabels`。在 `lib/relativeTime.ts` 新增小 helper（例如 `buildRelativeTimeLabels(t)` 回傳 `RelativeTimeLabels`，或 `formatRelativeTimeI18n(iso, t)`），三處改用之以消除重複；型別上 `t` 以 `(key: TranslationKey) => string` 表示。補一個 helper 單元測試（以假 `t` 驗證對應 key）。純前端、低風險，跑 typecheck 與既有前端測試。
  - 修改說明（2026-06-25）：`lib/relativeTime.ts` 新增 `RELATIVE_TIME_LABEL_KEYS`（欄位→i18n key 對照表）與 `buildRelativeTimeLabels(t: (key: TranslationKey) => string)`（type-only import `TranslationKey`）。`PdfCard`/`QuizBuilderPage`/`HomePage` 三處原本各自展開的 6 行 `t('time.*')` 物件改為一行 `buildRelativeTimeLabels(t)`，並移除未再使用的 `RelativeTimeLabels` import。新增 1 個 helper 單元測試（以 echo 假 `t` 驗證每欄對應正確 key）。frontend typecheck 通過、全部 278 個前端測試 + i18n 對等 21 個全通過。分支 `feat/dedup-relative-time-labels`，已 merge 回 master。

- [x] 為 reviewList.ts 補單元測試：在測試檔注入 in-memory `localStorage` stub（`globalThis.localStorage`），涵蓋 `addReviewItems` 的去重（同 pdfId+pageNumber+questionText 不重複加入）、`removeReviewItem` 依 pdfId+pageNumber 過濾、`getReviewItems` 對壞資料/非陣列的 fallback、`clearAllReviewItems`。純前端、僅新增測試，不改邏輯。
  - 修改說明（2026-06-25）：新增 `frontend/src/lib/reviewList.test.ts`，以 `MemoryStorage` class 實作 in-memory `localStorage` stub 掛到 `globalThis.localStorage`（reviewList 於函式內延遲讀取，故 stub 安裝後再以動態 `await import` 載入）。5 個測試涵蓋：空清單回 []、`addReviewItems` 去重、`removeReviewItem` 依 pdfId+pageNumber 過濾、`getReviewItems` 對壞 JSON/非陣列 fallback、`clearAllReviewItems` 清空。未改動 reviewList.ts 邏輯。frontend typecheck 通過、全部 283 個前端測試 + i18n 對等 21 個全通過。分支 `test/review-list-unit`，已 merge 回 master。

- [x] 為 viewerId.ts 補單元測試：注入 in-memory `localStorage` stub，驗證 `getOrCreateViewerId` 首次產生並持久化、第二次回傳同一值、格式符合 `viewer-...` 前綴。純前端、僅新增測試。
  - 修改說明（2026-06-25）：新增 `frontend/src/lib/viewerId.test.ts`，因 viewerId 讀 `window.localStorage`，先以 `MemoryStorage` stub 設定 `globalThis.window = { localStorage }` 再動態 import。3 個測試：首次產生 `viewer-` 前綴 id 並持久化、後續呼叫回傳同一值、已有儲存值時沿用。未改動 viewerId.ts。`node --test` 各檔獨立行程故 window stub 不污染其他測試。frontend typecheck 通過、全部 286 個前端測試 + i18n 對等 21 個全通過。分支 `test/viewer-id-unit`，已 merge 回 master。
- [x] 請在 master 的畫面上顯示已投票的人數。
  - 修改說明（2026-06-25）：`PlayPageSlidePanel` 在 master（`syncEnabled && syncRole === 'master'`）且本頁有投票（`pagePolls.length > 0`）時，於同步控制區（出席名單下方）新增「即時投票狀況」面板，逐一列出本頁各投票題目與「N 人已投票」（取 `poll.total_votes`，隨既有投票輪詢更新）。這樣教師即使切到別的 notebook 分頁、主畫面仍能看到投票人數。從 context 解構 `pagePolls`；新增 2 個 i18n key（`play.slidePanel.liveVotesTitle`/`liveVotesCount`，zh-TW/en 各 2）。frontend typecheck 通過、全部 286 個前端測試 + i18n 對等 21 個全通過。分支 `feat/master-live-vote-count`，已 merge 回 master。
- [x] 已投票人數在全螢幕也要顯示
  - 修改說明（2026-06-25）：延續 master 投票數顯示，`PlayPageFullscreen` 在 master（`syncEnabled && syncRole === 'master'`）且本頁有投票時，於全螢幕右上角新增 `pointer-events-none` 的投票數 overlay，逐題以藥丸樣式顯示「🗳 N 人已投票」（`poll.total_votes`）。沿用既有 `play.slidePanel.liveVotesCount` key、無新增 key。`pagePolls`/`syncEnabled`/`syncRole` 已於 fullscreen 解構。frontend typecheck 通過、全部 286 個前端測試 + i18n 對等 21 個全通過。分支 `feat/fullscreen-vote-count`，已 merge 回 master。
- [x] 請在 master 的畫面上顯示測試回答的進度。
  - 修改說明（2026-06-25）：測驗的即時作答進度資料（`quiz_progress`：每位學生 answered_count/total_questions/submitted）由同步狀態提供，並在 `QuizBuilderPage` 的 master 視圖「測驗中的學員」面板已逐位顯示（每人完成比例進度條 + 是否提交）。本次在該面板標題下方新增一行**彙總進度**：以 `formatMessage('quiz.progressSummary', { submitted, total, inProgress })` 顯示「已提交 X / 共 Y 人，作答中 Z」，讓教師一眼掌握整體作答狀況（PlayPage 本身不含真正的測驗流程——其 `active_quiz_id` 是借用來傳即時投票 id——故測驗進度顯示於測驗主控頁 QuizBuilderPage）。新增 1 個 i18n key `quiz.progressSummary`（zh-TW/en 各 1）。frontend typecheck 通過、全部 286 個前端測試 + i18n 對等 21 個全通過。分支 `feat/master-quiz-progress-summary`，已 merge 回 master。
- [x] 當一頁有投票時，全螢幕顯示的右上角要有投票按鍵。
  - 修改說明（2026-06-25）：`PlayPageFullscreen` 當本頁有「進行中」投票（`pagePolls.filter(is_active)`）時，於右上角顯示 🗳 圓形投票按鈕（`play.fullscreen.pollButton`）。點擊切換一個投票 overlay（右上、可捲動），逐題顯示題目與可點選的選項，複用既有 `handleVotePoll`/`pollVotes`/`pollBusy` 進行投票並顯示各選項得票與比例；按鈕與 overlay 皆 `stopPropagation` 避免觸發背景的播放/暫停與翻頁。master 即時票數 overlay 移到按鈕下方（`top-20`）且 overlay 開啟時隱藏以免重疊。新增 local state `fullscreenPollOpen`、補 `useState` import；新增 1 個 i18n key（zh-TW/en 各 1）。frontend typecheck 通過、全部 286 個前端測試 + i18n 對等 21 個全通過。分支 `feat/fullscreen-poll-button`，已 merge 回 master。
- [x] 有人提問時要在在上角顯示問題的圖示。
  - 修改說明（2026-06-25）：`PlayPageFullscreen` 在 master（`syncEnabled && syncRole === 'master'`）且有學生提問（`syncFollowerQuestions.length > 0`）時，於全螢幕**左上角**（避開右上角投票按鈕，位於暫停指示器下方 `top-20`）顯示 `pointer-events-none` 的 💬 提問圖示 + 提問數量徽章（附 sr-only `play.fullscreen.pendingQuestions` 無障礙文字）。新增 1 個 i18n key（zh-TW/en 各 1）。frontend typecheck 通過、全部 286 個前端測試 + i18n 對等 21 個全通過。分支 `feat/fullscreen-question-indicator`，已 merge 回 master。
- [x] 動畫中的文字要根據解析度設定文字小大, 在不同解析度文字的比例看起來要一樣
  - 修改說明（2026-06-25）：根因為動畫覆蓋層文字用固定單位（`rem` 與 `clamp(...,3vw,...)`），不隨投影片實際渲染尺寸等比縮放——在編輯器小預覽、一般播放、全螢幕下文字相對投影片的比例不一致。修正集中於 `SlideRenderer`：① 動畫 stage（`stageRef` 容器）以 `ResizeObserver` 量測實際寬度，計算 `stageFontScale = stageWidth / 960`（參考寬度 960，無 ResizeObserver 時以 `getBoundingClientRect` fallback），並將 stage 的 `font-size` 設為 `16 * scale px`；② 將覆蓋層文字單位由絕對改為相對 `em`，以繼承 stage 字級而等比縮放：text-callout、step-list 由 `rem`→`em`，pause-playback、realtime-poll 由 `clamp(1rem,3vw,2.25rem)`→`1.6em`，formula 原即 `em`（現一併隨 stage 縮放）。如此同一動畫在任何解析度下，文字相對投影片的比例一致。pointer/shape 等非文字元素維持原樣。frontend typecheck 通過、全部 286 個前端測試通過；視覺等比結果因 sandbox 無瀏覽器未做像素級驗證，但單位/縮放數學已驗證。分支 `fix/animation-text-resolution-scaling`，已 merge 回 master。

## 掃描摘要（2026-06-25 第三十九輪）

- TODO 清空且無新使用者項目。前端使用者可見硬編中文與相對時間重複已清理；本輪聚焦健全性與可測性的小改善。
- 觀察：`lib/viewerId.ts` 直接呼叫 `window.localStorage`、`lib/reviewList.ts` 的 `addReviewItems`/`removeReviewItem`/`clearAllReviewItems` 直接呼叫 `localStorage`，皆未做 `typeof window === 'undefined'` 防護（不同於 `i18n.ts` 的既有慣例），在非瀏覽器環境會丟錯。
- 觀察：`QuizBuilderPage` 計算測驗作答彙總（submitted/total/inProgress）為 inline 邏輯，可抽成純函式以利重用與測試。

## 新增可執行項目（2026-06-25 第三十九輪）

- [x] localStorage 存取防護一致性：為 `lib/viewerId.ts`（`getOrCreateViewerId`）與 `lib/reviewList.ts`（`addReviewItems`/`removeReviewItem`/`clearAllReviewItems`）加上 `typeof window === 'undefined'`（或 `typeof localStorage === 'undefined'`）的早退防護，與 `i18n.ts` 既有慣例一致，避免非瀏覽器環境丟錯（`getReviewItems` 已有 try/catch，可一併確認）。更新/補既有測試涵蓋「無 localStorage 時安全回退」。純前端、低風險。
  - 修改說明（2026-06-25）：`reviewList.ts` 新增 `hasLocalStorage()`（`typeof localStorage !== 'undefined'`）守衛，`getReviewItems` 改為無 localStorage 時直接回 []（不再僅靠 try/catch），`addReviewItems`/`removeReviewItem`/`clearAllReviewItems` 在無 localStorage 時 no-op 早退；`viewerId.ts` 的 `getOrCreateViewerId` 先產生候選 id，於 `typeof window === 'undefined' || !window.localStorage` 時直接回傳該 id（不持久化），否則沿用既有讀/寫流程。兩測試檔各補 1 個「無 localStorage/window 時安全回退」測試（共 10 個 lib 測試）。frontend typecheck 通過、全部 288 個前端測試 + i18n 對等 21 個全通過。分支 `fix/localstorage-guard`，已 merge 回 master。

- [x] 抽出測驗進度彙總純函式：把 `QuizBuilderPage` 「測驗中的學員」面板 inline 的 `submitted / total / inProgress` 計算抽成純函式（例如 `lib/quizProgress.ts` 的 `summarizeQuizProgress(progress: SyncQuizProgress[])`），元件改用之；補單元測試涵蓋全提交/全作答中/混合/空陣列。純前端、低風險。
  - 修改說明（2026-06-25）：新增 `frontend/src/lib/quizProgress.ts`：純函式 `summarizeQuizProgress(progress)` 回傳 `{ total, submitted, inProgress }`（`QuizProgressSummary` 介面）。`QuizBuilderPage` 的彙總行改用之（`formatMessage('quiz.progressSummary', { ...summarizeQuizProgress(syncQuizProgress) } as Record<string, number>)`——因 `formatMessage` 參數為 `Record<string, string|number>`，介面型別需轉型）。新增 `quizProgress.test.ts` 3 個測試（空陣列、混合、全提交/全作答中）。frontend typecheck 通過、全部 291 個前端測試 + i18n 對等 21 個全通過。分支 `feat/quiz-progress-summary-helper`，已 merge 回 master。

## 掃描摘要（2026-06-25 第四十輪）

- TODO 清空且無新使用者項目。經本輪盤點：**前端純 helper 測試覆蓋已大致完整**（lib 與 pages/play 的純函式如 relativeTime、reviewList、viewerId、quizProgress、notebookTabs、reportSummary、computeLineDiff、formatters、playbackReadiness、shuffleArray 等皆有測試）；後端有 125 個測試檔、覆蓋廣。`i18n.test.ts` 已以 `deepEqual(sortedKeys)` 完整比對兩語系 key 集合（非僅數量），對等性檢查健全。
- 唯一明確的小覆蓋缺口：`backend/src/services/apiKeyErrors.ts` 的 `isApiKeyMissingError`（含 `instanceof` 與 `code==='API_KEY_MISSING'` duck-typing 兩分支）尚無測試；此模組無 DB 相依，可用 `node --import tsx` 直跑（不受後端整套測試於 sandbox timeout 影響）。
- 說明：明顯的低風險清理/補測試項目已接近枯竭；後續更高價值的工作（新功能）可能需要使用者提供方向。

## 新增可執行項目（2026-06-25 第四十輪）

- [x] 為 apiKeyErrors.ts 補單元測試：新增 `backend/test/apiKeyErrors.test.ts`（或就近放置），測試 `isApiKeyMissingError`：對 `new ApiKeyMissingError('openai')` 回 true、對帶 `{ code: 'API_KEY_MISSING' }` 的純物件回 true、對一般 Error / null / 無關物件回 false；並驗證 `ApiKeyMissingError` 的 `code`/`provider`/預設 message。因該模組無 DB 相依，測試可用 `node --import tsx --test` 直跑驗證（不受後端整套 sandbox timeout 影響）。純後端、僅新增測試。
  - 修改說明（2026-06-25）：新增 `backend/test/apiKeyErrors.test.ts`，5 個測試涵蓋 `ApiKeyMissingError` 的 code/provider/預設訊息與自訂訊息、`isApiKeyMissingError` 對 error 實例與 `{code:'API_KEY_MISSING'}` duck-typed 物件回 true、對一般 Error/`{code:'OTHER'}`/null/undefined/字串/空物件回 false。因該模組無 DB 相依，以 `node --import tsx --test` 直跑驗證 5 個測試全通過（避開後端整套 better-sqlite3 開機在 sandbox 的 timeout）；backend typecheck 通過。未改動產品程式碼。分支 `test/api-key-errors`，已 merge 回 master。

## 掃描摘要（2026-06-25 第四十一輪）

- TODO 清空且無新使用者項目。確認 `computeLineDiff` 已接到 `VersionHistoryDialog`（腳本版本 diff 功能完整）；roadmap 2.1–2.10 主要功能與既有低風險 backlog 已大致消化。
- 經實質檢視找到一個真實但小的正確性瑕疵：英文相對時間缺單複數——`lib/relativeTime.ts` 的 en 後綴為固定 `' min ago' / ' hr ago' / ' days ago' / ...`，當數值為 1 時會輸出文法錯誤的「1 days ago / 1 hr ago」（中文無單複數、不受影響）。
- 再次說明：明顯的低風險清理/補測試項目已枯竭；更高價值的工作（新功能）需要使用者提供方向。

## 新增可執行項目（2026-06-25 第四十一輪）

- [x] 修正英文相對時間單複數：`lib/relativeTime.ts` 的英文相對時間在數值為 1 時文法錯誤（「1 days ago」）。在不影響中文的前提下支援單複數——例如將 `RelativeTimeLabels` 各單位後綴改為可帶單/複數兩式（或讓 `buildRelativeTimeLabels` 依語言提供 singular/plural），`formatRelativeTime` 依 `count === 1` 選用；中文沿用單一形式。更新 zh-TW/en key 與 `relativeTime.test.ts`（補 count=1 的單數斷言）。純前端、低風險。
  - 修改說明（2026-06-25）：`RelativeTimeLabels` 各時間單位由單一後綴改為 `PluralSuffix { one; other }`（minutes/hours/days/months/years），`formatRelativeTime` 以 `count === 1 ? one : other` 選用（新增 `suffix()` helper）；`RELATIVE_TIME_LABEL_KEYS`/`buildRelativeTimeLabels` 同步改為 one/other 對照。locale 由原 6 個 `time.*Suffix` 改為 11 個 key（`time.justNow` + 各單位 `One`/`Other`）：en 用完整單複數（minute/minutes、day/days…，修掉「1 days ago」並順帶把縮寫改全字更清楚），zh one===other（無單複數、文字不變）。`relativeTime.test.ts` 更新為新結構並新增 count=1 單數斷言（1 minute/1 hour/1 day ago）。三個消費端（PdfCard/QuizBuilderPage/HomePage）沿用 `buildRelativeTimeLabels(t)` 無需改動。frontend typecheck 通過、全部 292 個前端測試 + i18n 對等 21 個全通過。分支 `fix/relative-time-en-plural`，已 merge 回 master。

## 掃描摘要（2026-06-25 第四十二輪）

- TODO 清空且無新使用者項目。本輪聚焦 `frontend/src/pages/play/formatters.ts` 一檔的收尾：該檔的 `formatRegen*` 系列早已 i18n 化（接受 `t`），但仍殘留少量硬編中文與死碼。
- 觀察（死碼）：`formatEta`（`約 N 秒/分/小時`）已被 `formatRegenerateEta` 取代，全專案（含 backend、測試）零引用——可直接移除。
- 觀察（i18n 殘留）：`formatCostUsd` 的 `未知` fallback、`formatDurationMs` 的 `尚無紀錄` fallback 仍為硬編中文（皆 module 層純函式，`t` 不可用，須比照前例改為接受 label 參數）。
- 其餘 `formatTime`（`00:00`）、`formatTokenCount`（M/K）無中文，無需處理。
- 再次說明：明顯的低風險清理/補測試項目已枯竭；更高價值的新功能需使用者提供方向。

## 新增可執行項目（2026-06-25 第四十二輪）

- [x] formatters.ts 死碼清理 + formatCostUsd「未知」i18n：移除未使用的 `formatEta`（已被 `formatRegenerateEta` 取代、全專案零引用）；`formatCostUsd` 的 `未知` fallback 改為接受 `unknownLabel` 參數，呼叫端（`PlayPageSlidePanel`）傳入 `t('play.system.costUnknown')`；新增 zh-TW/en key 並補 `formatCostUsd` 單元測試、跑 i18n 對等測試。純前端、低風險。
  - 修改說明（2026-06-25）：`formatters.ts` 移除整段未使用的 `formatEta`（連同其 `約 N 秒/分/小時` 硬編中文，`grep` 確認全專案僅其定義處出現、測試亦未引用）；`formatCostUsd(cost, unknownLabel = 'Unknown')` 改為以參數提供未知標籤（預設英文 `Unknown` 作為無 i18n 環境的安全 fallback、消除字面中文），`PlayPageSlidePanel` 行 1643 改傳 `t('play.system.costUnknown')`（該元件早有 `const { t } = useI18n()`）。新增 1 個 `play.system.costUnknown` key（zh-TW/en 各 1）。`formatters.test.ts` 新增 `formatCostUsd` 測試（$0／<$0.01／$1.23／帶 label 回「未知」／無 label 回 'Unknown'）。frontend typecheck 通過、全部 293 個前端測試 + i18n 對等 21 個全通過。分支 `chore/formatters-cleanup-cost-i18n`，已 merge 回 master。

- [x] formatDurationMs「尚無紀錄」i18n：`formatters.ts` 的 `formatDurationMs(ms)` 在 `ms == null || !Number.isFinite(ms)` 時回傳硬編中文 `尚無紀錄`（使用者可見於 `PageTimingChips`、`PlayPageSlidePanel` 的計時/SLA 表格）。改為接受 label 參數（如 `formatDurationMs(ms, noRecordLabel)`），約 11 處呼叫端傳入對應 label——`PageTimingChips` 的 `timingTitle()` 已有 `TimingTooltipLabels.noRecord` 可用、其餘 JSX 處傳 `t('...')`；新增 zh-TW/en key 並更新 `formatters.test.ts` 既有「尚無紀錄」斷言、跑 i18n 對等測試。純前端、低風險但牽動多處呼叫端。
  - 修改說明（2026-06-26）：`formatDurationMs` 新增**必填** `noRecordLabel` 參數（移除硬編 `尚無紀錄`），由 TypeScript 編譯期確保所有呼叫端皆傳入 label。`PageTimingChips`（chips 標題、tooltip、SLA、total 共 4 處）傳入既有 `play.timing.tooltip.noRecord`；`PlayPageSlidePanel`（計時表、run 歷史、stage、慢成品表共 6 處）傳入既有 `play.system.noRecord`。兩鍵 zh-TW=「尚無紀錄」、en=「no record/No record」皆已存在，故**沿用既有鍵、未新增重複鍵**。更新 `formatters.test.ts`：原「尚無紀錄」斷言改為傳入 label，並加一筆英文 label 斷言。typecheck 通過、formatters 測試 11 個與 i18n 對等測試 28 個全通過。純前端改動。分支 `feat/format-duration-norecord-i18n`，已 merge 回 master。
  - 暫緩說明（2026-06-25 第四十三輪）：本項先前嘗試以「`formatDurationMs(ms, noRecordLabel = '—')` 改簽章 + 11 處呼叫端傳 label」的做法實作，但使用者否決了該編輯。**保留為待辦但暫緩**，待使用者確認偏好的做法（例如預設 placeholder 用何值、是否接受改簽章/改 11 處呼叫端）後再進行，避免重複套用被否決的方案。

- [x] TTS 語音性別標籤 i18n（第七十輪，2026-06-26 掃描新增並完成）：`lib/ttsVoices.ts` 的 `geminiVoiceLabel`/`openaiVoiceLabel` 將語音性別後綴硬編成中文「（男）/（女）」，於英文介面的語音選單（`SettingsPage` 雙主持人聲音、`TtsDialog`、`PromptModal`）洩漏未翻譯文字。改為新增**必填** `genderLabels { male, female }` 參數，6 處呼叫端各以 `useI18n()` 的 `t()` 組出 label 傳入。
  - 修改說明（2026-06-26）：兩個 label helper 加 `VoiceGenderLabels` 參數（`male`/`female`），移除硬編「男/女」。新增共用鍵 `tts.voiceGenderMale`/`tts.voiceGenderFemale`（zh-TW=男/女、en=M/F）。呼叫端 `SettingsPage`（4 處）、`TtsDialog`（1 處）、`PromptModal`（1 處）各建一個 `voiceGenderLabels` 物件傳入。更新 `ttsVoices.test.ts` 既有中文斷言改傳 label、並各加一筆英文 label 案例。typecheck 通過、`ttsVoices.test.ts` 與 i18n 對等測試共 40 個全通過。純前端、低風險。分支 `feat/voice-gender-label-i18n`，已 merge 回 master。

- [x] useSlideManagement 訊息 i18n（第七十一輪，2026-06-26 掃描新增並完成）：`pages/play/useSlideManagement.ts` 有 7 處硬編中文——刪除頁的 `window.confirm`（「確定刪除第 N 頁？」）與 6 個 fallback 訊息（新增/刪除/搬移/替換圖片/封面無圖/更新封面失敗），於英文介面洩漏未翻譯文字。改為以 `useI18n()` 取得 `t()`，新增 `play.slideManagement.*` 鍵（zh-TW/en）並對 confirm 用 `{page}` 插值。
  - 修改說明（2026-06-26）：hook 引入 `useI18n()`，7 處字串改走 `t()`；新增 7 個 `play.slideManagement.*` 對等鍵（deleteConfirm/addFailed/deleteFailed/moveFailed/replaceImageFailed/coverNoImage/coverUpdateFailed）。`t` 在 `useI18n` 內以 `useCallback([language])` 記憶化為穩定參考，故安全加入各 `useCallback` 依賴陣列。typecheck 通過、i18n 對等測試 28 個全通過（確認 zh-TW/en 鍵集合一致）。純前端、低風險。分支 `feat/slide-management-i18n`，已 merge 回 master。

- [x] usePromptAndSource 訊息 i18n（第七十二輪，2026-06-26 掃描新增並完成）：`pages/play/usePromptAndSource.ts` 有 7 處硬編中文 UI 訊息（提示詞已更新／更新提示詞失敗／請先輸入來源文字內容／已新增文字來源／新增文字來源失敗／已新增 PDF 來源／新增 PDF 來源失敗），於英文介面洩漏。改為以 `useI18n()` 取得 `t()`，新增 `play.promptSource.*` 鍵（zh-TW/en）。
  - 修改說明（2026-06-26）：hook 引入 `useI18n()`，7 處狀態/錯誤/驗證訊息改走 `t()`；新增 7 個 `play.promptSource.*` 對等鍵。`t` 加入各 `useCallback` 依賴。**刻意不動**送往後端/LLM 的內容預設值。typecheck 通過、i18n 對等測試 28 個全通過。純前端、低風險。分支 `feat/prompt-source-i18n`，已 merge 回 master。

- [x] （已完成，play hooks UI 訊息 i18n 收尾）所有 `pages/play/use*.ts` hook 的硬編中文 UI 訊息已全數 i18n（`useSlideManagement`、`usePromptAndSource`、`useVersionHistory`、`useVideoGeneration`、`usePageAsk`、`useScriptEditor`、`usePagePolls`、`useImageStyle`、`useRegeneration`、`useChatAndImageEdit`，共 10 個 hook，橫跨第七十一～七十七輪）。原則：僅翻譯 UI 狀態/錯誤/確認/驗證訊息；送往後端或 LLM 的「內容預設值」（預設提示詞、預設投票選項「同意/不同意」、預設圖片風格字串、對話串訊息內容組裝）一律保留不翻譯，以免改變行為。各輪均跑 typecheck 與 i18n 對等測試。
  - 進度（2026-06-26 第七十三輪）：一次完成 4 個僅含純 UI 錯誤訊息的小型 hook——`useVersionHistory`（3：載入歷史/載入內容/還原失敗）、`useVideoGeneration`（1：產生影片失敗）、`usePageAsk`（1：問答失敗）、`useScriptEditor`（1：逐字稿改寫失敗）。新增 6 個對等鍵（`play.versionHistory.loadListFailed`/`loadContentFailed`/`restoreFailed`、`play.videoGen.generateFailed`、`play.sidebar.pageAsk.askFailed`、`play.scriptRewrite.rewriteFailed`），`t` 加入各 `useCallback` 依賴。typecheck 通過、i18n 對等測試 28 個全通過。分支 `feat/play-hooks-error-i18n`，已 merge。剩餘 4 個 hook（含內容預設值，需逐一甄別）待後續輪次。
  - 進度（2026-06-26 第七十四輪）：完成 `usePagePolls`——翻譯 8 處純 UI 訊息（讀取/建立/投票/清除結果/刪除題目失敗、AI 草稿失敗、請輸入投票問題、至少兩個選項），新增 8 個 `play.sidebar.poll.*` 對等鍵。**刻意保留** 2 處 `'同意\n不同意'`（line 96、199）內容預設值不翻譯（會成為實際投票選項送往後端、顯示給投票者）。typecheck 通過、i18n 對等測試 28 個全通過。分支 `feat/page-polls-i18n`，已 merge。剩餘 3 個 hook（`useChatAndImageEdit`、`useImageStyle`、`useRegeneration`）待後續輪次。
  - 進度（2026-06-26 第七十五輪）：完成 `useImageStyle`——翻譯 2 處 UI 訊息（已儲存整份圖片風格設定／儲存圖片風格設定失敗），新增 2 個 `play.imageStyleDialog.saved`/`saveFailed` 對等鍵。**刻意保留** line 42 預設圖片風格提示詞（送往後端的內容預設值）不翻譯。typecheck 通過、i18n 對等測試 28 個全通過。分支 `feat/image-style-i18n`，已 merge。剩餘 2 個 hook（`useChatAndImageEdit`、`useRegeneration`）待後續輪次。
  - 進度（2026-06-26 第七十六輪）：完成 `useRegeneration`——翻譯 14 處 UI 訊息（取得進度失敗、重生完成/失敗/已停止生成、請至少選擇一個重生項目、圖檔提示詞不可為空、重生任務已啟動、確認失敗、已送出停止請求、停止失敗、還原 confirm、已還原至重生前狀態、還原失敗），新增 13 個 `play.regenerate.msg.*` 對等鍵（`重生失敗` 由兩處共用）。**刻意保留** 4 處內容預設值（line 80/83 預設重生提示詞、line 256/257 送往 LLM 的 prompt 組裝標籤）不翻譯。typecheck 通過、i18n 對等測試 28 個全通過。分支 `feat/regeneration-i18n`，已 merge。剩餘 1 個 hook（`useChatAndImageEdit`）待後續輪次。
  - 進度（2026-06-26 第七十七輪，收尾完成）：完成最後的 `useChatAndImageEdit`——翻譯 6 處純 UI 錯誤訊息（讀取問答紀錄失敗、對話失敗、清除問答失敗、修改圖片失敗 ×2、套用圖片失敗），新增 5 個 `play.sidebar.qa.*` 對等鍵（「修改圖片失敗」由 inpaint 與 regenerate 兩處共用）。**刻意保留** 8 處內容字串：line 192/270 送往後端的預設 prompt、line 220/221/224/280 對話串訊息內容（含 `【修改投影片圖片】` 等標籤與使用者 prompt、且 chatHistory 由伺服器回填）、line 272/273 組進 `regenerateSlideImage` 送往 LLM 的 prompt。typecheck 通過、i18n 對等測試 28 個全通過。分支 `feat/chat-image-edit-i18n`，已 merge。**play hooks UI 訊息 i18n 收尾全部完成（10/10 hook）。**

- [x] play 元件殘留 UI 錯誤訊息 i18n（第七十八輪，2026-06-26 掃描新增並完成）：hook i18n 收尾後，掃描 `pages/play/*.tsx` 元件發現 4 處殘留硬編中文 UI 錯誤訊息——`QualityCheckPanel`（品質檢查失敗／AI 腳本分析失敗／AI 圖片分析失敗）與 `PlayPageSlidePanel`（改寫失敗，請重試。）。新增 4 個對等鍵（`play.quality.checkFailed`/`scriptAnalysisFailed`/`imageAnalysisFailed`、`play.slidePanel.aiRewriteFailed`），改走 `t()`。**刻意保留** `QualityCheckPanel` 的 `BATCH_FILL_PROMPT` 與 `PlayPageSlidePanel` 的 3 個逐字稿改寫風格 prompt（compact/detailed/conversational）——皆送往 LLM 的 prompt 內容。兩元件的處理器皆為元件內一般函式，`t` 已在 closure scope、無需改依賴。typecheck 通過、i18n 對等測試 28 個全通過。純前端、低風險。分支 `feat/quality-rewrite-error-i18n`，已 merge 回 master。

- [x] API 錯誤提示訊息 i18n（mapApiErrorToHumanMessage）（第七十九輪，2026-06-26 掃描新增並完成）：`lib/api/common.ts` 的 `ERROR_HINTS` 與 `mapApiErrorToHumanMessage` 硬編約 20 組中文 `title/message/nextStep`，於英文介面的上傳／匯入錯誤對話框與 credit 用盡對話框洩漏未翻譯文字。將 `ERROR_HINTS` 改為翻譯鍵三元組（`apiError.*`，以 `hintKeys()` 產生）、`mapApiErrorToHumanMessage(err, t)` 接受 translator；新增 zh-TW/en 各 66 個 `apiError.*` 鍵。兩呼叫端元件（`UploadButton`、`ImportTextPage`）傳入 `t`。`notifyCreditExhausted` 改為只在事件帶 `code/status`，由有 i18n context 的 `CreditExhaustedDialog` 以 mapper 推導人類可讀文字（跟隨介面語言）。更新 `api.error-mapping.test.ts` 以 zh-TW 字典解析鍵、斷言不變。typecheck 通過、前端全測試 325 個全通過。純前端、低風險（行為等價、僅文字來源改為翻譯鍵）。分支 `feat/api-error-hints-i18n`，已 merge 回 master。

- [x] 修復動畫形狀選單缺漏（前後端 shape kinds drift）（第八十輪，2026-06-26 掃描發現並修復）：前端 `animationSpec.ts` 的 `ANIMATION_SHAPE_KINDS` 只列 4 種形狀（circle/rect/ellipse/arrow），但前端型別 `SlideAnimationShapeKind`、`SlideRenderer`（實際繪製 line/triangle/star/hexagon）、8 個 `play.animation.shapeKind.*` i18n 標籤、以及後端 `pageAnimation.ts` 的 `ANIMATION_SHAPE_KINDS` 全部支援 8 種。因 `AnimationEditorTab` 的形狀下拉是用此常數產生，使用者無法選取 line/triangle/star/hexagon——是真實 bug。修復：將前端常數補回完整 8 種（順序對齊後端）。並新增後端 drift-guard 測試 `animationConstantsConsistency.test.ts`（仿第六十八輪價格表 guard），以 `fs` 讀前端 `animationSpec.ts` 原始碼、抽取 `SLIDE_ANIMATION_EFFECT_TYPES`/`SLIDE_ANIMATION_EASES`/`ANIMATION_SHAPE_KINDS` 與後端對應常數逐一比對（effect types 18、eases 7 原本就一致），未來任一端 drift 即 CI 失敗。前端 typecheck 與 animationSpec 測試 58 個通過、後端新測試 4 個通過。分支 `fix/animation-shape-kinds-drift`，已 merge 回 master。

- [x] 字幕分句邏輯三份鏡像 drift-guard（第八十一輪，2026-06-26 掃描新增並完成）：`splitScriptIntoSentences` 共有三份「需完全一致」的複本——前端 `lib/subtitles.ts`（字幕顯示＋transcript-line 動畫觸發）、後端 `services/textSentences.ts`、後端 `services/subtitleAlignment.ts`（Whisper 對齊時間軸獨立複本）。三者共用相同的 `SENTENCE_MATCH_RE`/`TONE_MARKER_RE`；若 drift，時間軸所依據的句子索引會與前端重新切句不符，悄悄使字幕／動畫去同步。原本三份各有自己的行為測試、卻無任何測試比對彼此一致。經確認三份目前完全一致（無 bug），新增 guard 測試 `subtitleSplitConsistency.test.ts`：①以一批代表性 script（CJK/ASCII 終止符、分號、tone tag、換行、無標點尾段）跑兩個後端複本斷言輸出相同；②以 `fs` 從三份原始碼抽取兩個 regex 字面值斷言完全相同。後端 typecheck 與新測試 2 個通過。純測試、低風險。分支 `test/subtitle-split-consistency`，已 merge 回 master。

- [x] 動畫效果子屬性 enum 前後端 drift-guard（第八十二輪，2026-06-26 掃描新增並完成）：延續第八十輪的動畫常數 guard，動畫效果還有 6 個子屬性 enum 是「手動維護於前端型別 union（`types.ts` 的 `SlideAnimationEffect`）、編輯器硬編 `<option>`、後端 Zod `z.enum`」三處——`pointerShape`/`highlightBorderStyle`/`textCalloutAlign`/`textCalloutPadding`/`spotlightShape`/`stepListBulletStyle`，正是 shape kinds 當初 drift 的同類風險（編輯器可選值與後端接受值不一致）。經確認 6 者目前前後端皆一致（無 bug）。將 `animationConstantsConsistency.test.ts` 擴充：以 `fs` 解析前端 `types.ts` 的 union 成員與後端 `pageAnimation.ts` 對應 `z.enum` 成員，逐欄位斷言相同（共 6 個新測試），未來任一端新增/移除值即 CI 失敗。後端 typecheck 與該檔測試 10 個（4 既有＋6 新）全通過。純測試、低風險。分支 `test/animation-enum-fields-guard`，已 merge 回 master。

- [x] 動畫型別／形狀 i18n 標籤完整性測試（第八十三輪，2026-06-26 掃描新增並完成）：動畫編輯器以 `play.animation.type.${type}` 與 `play.animation.shapeKind.${kind}` 直接插值渲染效果型別與形狀下拉。第八十／八十二輪的 drift-guard 已確保前端陣列與後端 `z.enum` 同步，但沒有任何測試確保每個成員「也有對應 i18n 標籤」——若未來新增一個型別/形狀（通過 drift-guard）卻漏補 i18n 鍵，下拉會顯示原始 key。經確認 18 種 effect type 與 8 種 shape kind 的中英鍵目前皆齊全。於 `i18n.test.ts` 新增兩個測試：直接由 `SLIDE_ANIMATION_EFFECT_TYPES`／`ANIMATION_SHAPE_KINDS` 陣列推導必需鍵，逐一斷言 zh-TW/en 皆存在且非空（未來新增成員自動納入檢查）。前端 typecheck 與 i18n 測試（含 2 新）通過。純測試、低風險。分支 `test/animation-i18n-label-completeness`，已 merge 回 master。

- [x] 字幕大小／位置標籤改為編譯期安全（第八十四輪，2026-06-26 掃描重構）：盤點所有 `t(\`prefix.${var}\`)` 動態插值點，發現 `PlayPageSlidePanel` 的字幕大小／位置選擇器以 `t(\`play.slidePanel.subtitleSize.${size}\` as TranslationKey)` 直接插值——繞過型別檢查，若 `SubtitleSize`/`SubtitlePosition` 新增值卻漏補標籤會在執行期顯示原始 key（與動畫型別/形狀同類，但動畫已有第八十三輪測試守護）。改用 `as const satisfies Record<SubtitleSize/SubtitlePosition, TranslationKey>` 的標籤 map（與既有 `EASE_LABELS` 同一手法），使漏標籤變成編譯錯誤而非執行期 footgun。其餘動態插值（動畫型別/形狀＝有完整性測試、ease＝已 satisfies、`*_LABEL_KEYS` 記錄＝`Record<EnumType>` 編譯保證）皆已安全。純重構、無行為變更；前端 typecheck 與全測試 327 個通過。分支 `refactor/subtitle-label-compile-safe`，已 merge 回 master。

- [x] 成本分級標籤改為編譯期安全＋修正過時註解（第八十五輪，2026-06-26 掃描重構）：第八十四輪的 grep 漏掉一處動態 i18n 插值——`PromptModal` 的成本估算分級以 `t(\`promptModal.costEstimate.tier${Capitalize(tier.name)}\` as TranslationKey)`（含 `Desc`）渲染，因 key 由 `tier.name` 首字母大寫拼出、未被 `prefix.${var}` 樣式命中。改用 `as const satisfies Record<CostTier['name'], { label; desc }>` 的 `COST_TIER_LABEL_KEYS` map，使漏補標籤變編譯錯誤。另修正 `costEstimate.ts` 的 `CostTier` 過時註解（原寫 `costEstimate.tier.<name>`，實際鍵為 `promptModal.costEstimate.tier<Name>`）。6 個 tier 鍵經確認皆存在、無執行期 bug。純重構＋文件修正、無行為變更；前端 typecheck 與全測試 327 個通過。分支 `refactor/cost-tier-labels-compile-safe`，已 merge 回 master。

- [x] 修復「產生中」橫幅未翻譯狀態／步驟（第八十六輪，2026-06-26 掃描修復）：`PlayPage` 的「產生中…」橫幅（兩處：`readOnlyReason` 與無頁面時的狀態列）以 `${detail.status}${' / ' + detail.progress_step}` 直接插入後端原始 enum 值，導致中英文使用者都看到 `processing / rendering_video` 而非「處理中 / 產生影片中」——`StatusBadge` 早已用私有標籤 map 正確翻譯，但橫幅沒有。將兩個標籤 map 抽到共用 `lib/statusLabels.ts`（單一真實來源，`Record<PdfStatus>`／`Record<Exclude<ProgressStep,null>>` 編譯期完整性）並提供純函式 `formatGeneratingStatusLabel()`；`StatusBadge` 改 import 共用模組（移除重複定義、`STATUS_STYLES` 精簡為 className-only），兩處橫幅改用 helper。新增 `statusLabels.test.ts`（3 測試，含「不得洩漏原始 enum 值」斷言）。`StatusBadge` 行為不變；前端 typecheck 與全測試 330 個通過。分支 `fix/generating-banner-i18n`，已 merge 回 master。

- [x] SLA override 驗證拒絕非正值（第八十七輪，2026-06-26 掃描修復）：`validateSlaOverrideSecondsInput` 僅以 `Number.isFinite` 擋非數字，再倚賴「選用參數 `bounds`」的範圍檢查擋越界值。當未傳 `bounds` 時，`0` 或負數秒會被核可為 `{ ok: true, targetMs: <= 0 }`——函式不該放行非正的 SLA 目標（合法最小值遠大於 0）。在 finite 檢查後加上 `seconds <= 0` → `invalid-number`，使契約不依賴 bounds 即成立。有 bounds 時唯一行為變化是 0/負數改報 `invalid-number`（原為 `out-of-range`，兩者皆已顯示錯誤）；`SettingsPage` 對 `invalid-number` 顯示 `settings.slaInvalidValue`，無回歸。新增 3 個測試（0／負數無 bounds、負數有 bounds）。前端 typecheck 與全測試 331 個通過。純前端、低風險。分支 `fix/sla-validation-nonpositive`，已 merge 回 master。

- [x] 前後端狀態 enum 鏡像 drift-guard（第八十八輪，2026-06-26 掃描新增）：第八十六輪修橫幅時注意到前端 `PdfStatus`/`PageStatus`/`ProgressStep` 字串 union（`types.ts`）鏡像後端 `statusMachine.ts` 的 `PDF_STATUSES`/`PAGE_STATUSES`/`PROGRESS_STEPS`，驅動狀態徽章／橫幅／步驟標籤，但無 drift guard。經確認三組值集目前一致（`ProgressStep` 與後端順序不同但集合相同、另多 `null`）。新增後端測試 `statusEnumConsistency.test.ts`：以 `fs` 解析前端 union 成員，與後端陣列**比對排序後的值集**（忽略順序，因 union 順序非契約；`ProgressStep` 排除 `null`）。任一端新增/移除狀態即 CI 失敗。後端 typecheck 與新測試 4 個通過。純測試、低風險。分支 `test/status-enum-mirror-guard`，已 merge 回 master。

- [x] 前後端 TTS 語音清單鏡像 drift-guard（第八十九輪，2026-06-26 掃描新增）：前端語音選擇器 `ttsVoices.ts` 的 `GEMINI_TTS_VOICES`（22）／`OPENAI_TTS_VOICES`（11）鏡像後端可接受的語音（`services/gemini.ts` 的 `GEMINI_VOICES` Set、`config.ts` 的 `OPENAI_TTS_VOICES`）。`GEMINI_TTS_VOICES` 原始碼註解已明言「Keep in sync with backend GEMINI_VOICES」，但跨 package 無守護——drift 會讓選擇器列出後端會 coerce 成 fallback（Gemini 一律轉 `Kore`）的語音。經確認兩組值集完全一致（OpenAI 順序 onyx/nova 互換但集合相同）。新增後端測試 `ttsVoiceConsistency.test.ts`：以 `fs` 解析前端兩份清單與後端 `GEMINI_VOICES`，並 import 後端 `OPENAI_TTS_VOICES`，比對排序值集。後端 typecheck 與新測試 3 個通過。純測試、低風險。分支 `test/tts-voice-mirror-guard`，已 merge 回 master。

- [x] Quiz 分數溢出檢查對齊後端容差＋抽出可測模組（第九十輪，2026-06-26 掃描修復）：`QuizBuilderPage` 的分數溢出警告（同時 gate「儲存」按鈕）以嚴格 `sum > 100` 比較，但後端 cap 用 `sum > 100 + QUIZ_SCORE_SUM_EPSILON`（1e-6）。對於浮點誤差落在 (100, 100+1e-6] 的總和，前端會判定溢出、後端卻接受——與「mirrors backend」註解的本意不符的潛在不一致（實測一般輸入難以觸發，屬一致性對齊而非顯性 bug）。將原本私有且無測試的計分 helper 抽到 `lib/quizScoring.ts`（`QUIZ_TOTAL_SCORE`、`explicitScoreSum`、新增套用相同 epsilon 的 `scoreSumExceedingTotal`），`QuizBuilderPage` 改用之；新增 `quizScoring.test.ts` 4 測試（總和、剛好 100、epsilon 邊界）。前端 typecheck 與全測試 335 個通過。純前端、低風險。分支 `fix/quiz-score-overflow-epsilon`，已 merge 回 master。

- [x] 抽出並測試 quiz 評分函式（第九十一輪，2026-06-26 掃描重構）：延續第九十輪，`QuizBuilderPage` 還有 3 個私有且無測試的純評分函式——`normalizeQuestionScores`（未給分題平分剩餘額度）、`isCorrectAnswer`（答案集合比對）、`calcQuestionScore`（單選 all-or-nothing／多選逐選項部分給分），均鏡像後端評分且用於 11 處 client-side 分數顯示。將三者併入 `lib/quizScoring.ts`、`QuizBuilderPage` 改 import（行為不變），並補 `quizScoring.test.ts` 4 個測試（平分分配、集合相等忽略順序/重複、單選全有或全無、多選逐選項部分給分含 0 選項）。前端 typecheck 與全測試 339 個通過。純重構＋測試、低風險。分支 `refactor/quiz-scoring-extract-test`，已 merge 回 master。

- [x] 日誌脫敏補強：git URL 憑證與 GitHub token（第九十二輪，2026-06-26 掃描安全強化）：`logSanitizer.ts` 的 `API_KEY_VALUE_PATTERN` 僅比對 OpenAI/Anthropic/Google 金鑰形狀（`sk*`/`AIza`）。但本專案的 `presentationGit` 以 `https://x-access-token:<token>@github.com` remote 推送 GitHub（`presentationGit.ts`），且支援 `GITHUB_TOKEN` 設定——一旦 git 操作失敗、該 URL 或裸 token 進入日誌，GitHub PAT 不會被遮蔽。新增兩條規則：①`URL_CREDENTIALS_PATTERN` 遮蔽任何 URL 的 `user:secret@` 部分（保留 scheme/host 供除錯，涵蓋任意 token 形狀）；②`GITHUB_TOKEN_PATTERN` 遮蔽 classic `gh*_` 與 fine-grained `github_pat_`。新增測試含「無憑證 URL 與 host:port 不被誤遮蔽」。後端 typecheck 與 sanitizer 測試 18 個通過。低風險（僅增加遮蔽）。分支 `fix/log-sanitizer-git-credentials`，已 merge 回 master。

- [x] 修復 GitHub 推送失敗時 token 洩漏到 API 回應（第九十三輪，2026-06-26 掃描安全修復）：延續第九十二輪追查 GitHub token 流向，發現真實洩漏：`pushPresentationToGitHub` 執行 `git push https://x-access-token:<token>@github.com…`，`execFile` 失敗時 Error.message 內含完整指令（含 token），而 admin 同步路由（`admin.ts`）以 `errorResponse('GITHUB_SYNC_FAILED', err.message)` 將該訊息**回傳給 client**——token 從 HTTP 回應外洩（日誌路徑已於上輪脫敏，但回應沒有）。於來源頭修復：`logSanitizer` 匯出可重用的 `redactSecretsInText()`（無截斷的脫敏鏈，已涵蓋 URL 憑證與 GitHub token），`presentationGit` 在 push 失敗時先 scrub 再 rethrow，使 token 不離開模組（自動保護 admin.ts 與未來呼叫端）。新增針對 `Command failed: git push …` 訊息形狀的測試。註：`presentationGit` 自身測試需 better-sqlite3，sandbox 無法載入（既有限制），已以 typecheck 與 sanitizer 測試 17 個驗證。安全修復、低風險。分支 `fix/git-push-error-token-leak`，已 merge 回 master。

- [x] 補測試：`buildAuthenticatedRepoUrl` token 嵌入行為（第九十四輪，2026-06-26 掃描補測試）：延續 GitHub token 安全審查。`buildAuthenticatedRepoUrl`（將 token 嵌入 https push remote）為 exported 純函式但無測試。先核對相關安全面皆健全：admin 設定回應雖回傳各 provider API key/`github_token` 明文，但屬「帳號擁有者預填自己的設定」設計（僅 MCP token 用 write-only `has_*` 布林，為刻意取捨，非 bug）；git 指令路徑參數皆有 `--` 分隔、ref 為內部產生（無 argument injection）；token 僅作 git 參數、不寫入 `.git/config`。新增 `presentation-git-auth-url.test.ts` 鎖定安全行為：①僅 http(s) URL 嵌入 token、SSH/scp-style 不嵌入；②空 token 原樣返回；③格式錯誤 URL 不丟例外；④token 特殊字元被 percent-encode（不破壞 URL 結構）。預期輸出已以 node 重實作逐一驗證；該測試檔因模組連帶載入 better-sqlite3 而於 sandbox 無法執行（既有限制），於 CI 執行、本機以 typecheck 驗證。純測試、低風險。分支 `test/auth-repo-url`，已 merge 回 master。

- [x] 修補 GitHub token 經 git 錯誤 `cmd`/`stderr` 洩漏到日誌（第九十五輪，2026-06-26 掃描安全修復）：追查日誌脫敏接線方式時發現第九十三輪修補的殘留缺口。`logSanitizer` 是在各 log 呼叫端「手動套用」（gemini/openai/worker 等），並非 pino 全域 serializer；而 `admin.ts` 以 `app.log.warn({ err })` 記錄 push 失敗的原始 error。第九十三輪僅脫敏 `err.message`，但 `execFile` 失敗的 error 還有 `cmd`（Node 設為原始 argv：`git push https://x-access-token:<token>@github.com…`）與 `stdout`/`stderr`——pino 會序列化這些屬性，故 token 仍會經 `err.cmd` 洩漏到日誌。新增 `redactGitExecError()`，對 `message`+`cmd`+`stdout`+`stderr` 全部套 `redactSecretsInText` 後再 rethrow。以 node 重實作驗證 token 從三者皆被遮蔽；`redactSecretsInText` 單元已由 logSanitizer 測試（17 個）涵蓋。後端 typecheck 通過。安全修復、低風險。分支 `fix/git-error-cmd-token-leak`，已 merge 回 master。

- [x] 全域錯誤處理：production 對所有 5xx 隱藏原始訊息（第九十六輪，2026-06-26 掃描安全修復；**此為計數第 100 項，已達 LOOP.md 上限**）：`server.ts` 的 `setErrorHandler` 原本只在 `status === 500` 時於 production 以泛用訊息取代原始 `err.message`。但帶 `statusCode` 502/503/504（或任意 5xx）的未捕捉錯誤仍會把原始訊息回傳給 client，可能洩漏伺服器內部（檔案路徑、db 識別子、嵌入的憑證等）。改為 `status >= 500`（`isServerError`）即套用泛用訊息並標為 `INTERNAL_ERROR`；4xx 客戶端錯誤維持回傳自身訊息。新增 502 測試，既有 500/dev/400 案例不變。註：handler 測試需 better-sqlite3，sandbox 無法執行（既有限制），於 CI 執行、本機以 typecheck 與既有案例一致性驗證。安全修復、低風險。分支 `fix/error-handler-redact-all-5xx`，已 merge 回 master。
## 掃描摘要（2026-06-25 第四十三輪）

- 本輪 TODO 唯一未完成項目（formatDurationMs i18n）先前的實作方案被使用者否決，已標記暫緩。經詢問使用者後，本輪改為「為後端 `logSanitizer.ts` 補單元測試」。
- 觀察：`backend/src/services/logSanitizer.ts`（日誌脫敏，安全相關純函式，被 `gemini`/`openai` 服務與多個 worker steps 使用）**無單元測試**；該模組無 DB 相依，可用 `tsx --test` 直跑（不受後端整套測試於 sandbox timeout 影響），是明確的低風險覆蓋缺口。

## 新增可執行項目（2026-06-25 第四十三輪）

- [x] 為 logSanitizer.ts 補單元測試：新增 `backend/test/logSanitizer.test.ts`，涵蓋 `redactLogValue`/`redactLogObject`/`redactPromptForLog`/`redactTextForLog`：原始型別（null/number/boolean/bigint）穿透、字串中的 API key／Bearer token／data URL／長 hex／長 base64 脫敏、長字串截斷（保留原長度）、敏感 key 摘要（短值帶 preview、長值僅 chars）、SAFE_METADATA_KEYS 白名單豁免、Buffer/TypedArray 尺寸摘要、Error 化簡、巢狀遞迴、陣列上限 20、深度上限。純後端、僅新增測試、不改產品程式碼。
  - 修改說明（2026-06-25）：新增 `backend/test/logSanitizer.test.ts`，14 個測試完整涵蓋上述各分支（含 `hasUrl` 雖結尾匹配敏感樣式但在白名單故豁免、`url` 未白名單則摘要的對照；深度上限以 8 層巢狀斷言出現 `[redacted-depth-limit]`）。因該模組無 DB 相依，以 `tsx --test` 直跑驗證 14 個測試全通過（避開後端整套 better-sqlite3 開機在 sandbox 的 timeout）；backend typecheck 通過。未改動產品程式碼。分支 `test/log-sanitizer`，已 merge 回 master。

## 掃描摘要（2026-06-25 第四十四輪）

- TODO 唯一未完成項目（formatDurationMs i18n）仍暫緩（方案待使用者確認）。延續第四十三輪被使用者接受的方向（為後端無 DB 相依的純函式服務補單元測試），繼續清理測試覆蓋缺口。
- 觀察：`backend/src/services/subtitleAlignment.ts`（Whisper 逐字時間戳的字幕精準對齊，純函式、無 DB 相依）**無單元測試**；其 `splitScriptIntoSentences`（須與前端 `lib/subtitles.ts` 的切句規則鏡像一致）與 `alignSentencesToWordTimestamps`（依字元權重比例對齊、邊界 clamping）皆有可測的邊界邏輯。
- 其餘無測試的純函式服務（`pdfPageMarkers`/`imagePromptTemplates`/`accountContext`/`promptTemplates`）可留待後續輪次。

## 新增可執行項目（2026-06-25 第四十四輪）

- [x] 為 subtitleAlignment.ts 補單元測試：新增 `backend/test/subtitleAlignment.test.ts`，涵蓋 `splitScriptIntoSentences`（CJK/ASCII 句尾標點切句並保留標點、分號、CRLF 正規化、空行丟棄、`[[tone]]` 標記移除、空輸入）與 `alignSentencesToWordTimestamps`（空輸入 fallback、等權對齊、依字元權重比例分配、末句結束於總時長、忽略空白權重、時間在界內且不遞減）。純後端、僅新增測試、不改產品程式碼。
  - 修改說明（2026-06-25）：新增 `backend/test/subtitleAlignment.test.ts`，11 個測試涵蓋上述各案例（比例分配以「權重 4:2 的兩句對單一 6 字、0–6 秒的詞」驗證切在 4 秒；忽略空白以兩個各含單一非空白字元的詞驗證對半切）。因模組無 DB 相依，以 `tsx --test` 直跑驗證 11 個測試全通過；backend typecheck 通過。未改動產品程式碼。分支 `test/subtitle-alignment`，已 merge 回 master。

## 掃描摘要（2026-06-25 第四十五輪）

- TODO 唯一未完成項目（formatDurationMs i18n）仍暫緩（方案待使用者確認）。延續第四十三、四十四輪方向，繼續為後端無 DB 相依的純函式服務補測試。
- 觀察：`backend/src/services/pdfPageMarkers.ts`（document-mode 匯入時的 `[[PDF_PAGE_N]]` 標記輔助，4 個純函式、無 I/O、無 config 相依）**無單元測試**——是最乾淨的可測缺口。
- 其餘無測試的純函式服務（`imagePromptTemplates`/`accountContext`/`promptTemplates` 的 `renderPromptTemplate`）可留待後續輪次（`promptTemplates.loadPromptTemplate` 涉及檔案 I/O，需謹慎處理）。

## 新增可執行項目（2026-06-25 第四十五輪）

- [x] 為 pdfPageMarkers.ts 補單元測試：新增 `backend/test/pdfPageMarkers.test.ts`，涵蓋 `formatPdfPageMarker`（1-indexed 包裝）、`containsPdfPageMarkers`（合法標記 vs 缺數字 vs 無標記）、`stripPdfPageMarkers`（移除標記 + 折疊 3+ 空行）、`buildTextWithPdfPageMarkers`（逐頁加 1-indexed 前綴、單頁/空輸入），以及 build→strip 往返。純後端、僅新增測試、不改產品程式碼。
  - 修改說明（2026-06-25）：新增 `backend/test/pdfPageMarkers.test.ts`，6 個測試涵蓋上述各案例（含 `[[PDF_PAGE_]]` 缺數字不算合法標記、`buildTextWithPdfPageMarkers([])` 回空字串、build→strip 往返回到 `'A\n\nB'`）。因模組為無 I/O 純函式，以 `tsx --test` 直跑驗證 6 個測試全通過；backend typecheck 通過。未改動產品程式碼。分支 `test/pdf-page-markers`，已 merge 回 master。

## 掃描摘要（2026-06-25 第四十六輪）

- TODO 唯一未完成項目（formatDurationMs i18n）仍暫緩（方案待使用者確認）。延續第四十三～四十五輪方向，繼續為後端無 DB 相依的純函式服務補測試。
- 觀察：`backend/src/services/imagePromptTemplates.ts` 的 `buildImagePrompt`（生圖提示詞組裝，純函式、無 DB/env 相依）**無單元測試**；其依各參數條件加行、trim、以及 `pageText !== undefined` 與 falsy 的差異（present-but-empty 會放 `(無)` 佔位）皆有可測分支。
- 其餘無測試的純函式服務：`accountContext`（`sanitizeAccountId` 消毒邏輯 + AsyncLocalStorage 情境，DEFAULT 依 env）、`promptTemplates`（`renderPromptTemplate` 純函式、`loadPromptTemplate` 涉檔案 I/O）可留待後續輪次。

## 新增可執行項目（2026-06-25 第四十六輪）

- [x] 為 imagePromptTemplates.buildImagePrompt 補單元測試：新增 `backend/test/imagePromptTemplates.test.ts`，涵蓋 `buildImagePrompt`（僅通則 baseline、style 行 trim、空白選填略過、deck 一致性行先於整份調整需求、`pageText`/`pageScript` 的「省略 vs 空/null（佔位 `(無)`）」差異、slideLabel/userAdjustment/figureNotes/textBody 嵌入）與 `IMAGE_PROMPT_TEMPLATES` 健全性（key 唯一、各欄位非空）。純後端、僅新增測試、不改產品程式碼。
  - 修改說明（2026-06-25）：新增 `backend/test/imagePromptTemplates.test.ts`，8 個測試涵蓋上述各案例（含 `buildImagePrompt({})` 等於通則 join、`pageText: ''`/`null` 產生 `(無)` 佔位而省略時整段不出現、deck 一致性行 index 早於整份調整需求行）。因模組為無 DB/env 相依純函式，以 `tsx --test` 直跑驗證 8 個測試全通過；backend typecheck 通過。未改動產品程式碼。分支 `test/image-prompt-templates`，已 merge 回 master。

## 掃描摘要（2026-06-25 第四十七輪）

- TODO 唯一未完成項目（formatDurationMs i18n）仍暫緩（方案待使用者確認）。延續第四十三～四十六輪方向，繼續為後端無 DB 相依的純函式服務補測試。
- 觀察：`backend/src/services/accountContext.ts`（多帳號情境隔離：`sanitizeAccountId` 檔名安全消毒 + AsyncLocalStorage 情境傳遞）**無單元測試**；其消毒邏輯有安全意涵（防止跨帳號污染、確保檔名安全），AsyncLocalStorage 的情境傳遞是核心機制，皆值得測。
- 剩餘：`promptTemplates`（`renderPromptTemplate` 純函式可測；`loadPromptTemplate` 涉檔案 I/O 需謹慎）可留待後續輪次。

## 新增可執行項目（2026-06-25 第四十七輪）

- [x] 為 accountContext.ts 補單元測試：新增 `backend/test/accountContext.test.ts`，涵蓋 `sanitizeAccountId`（空/空白回預設、檔名安全字元保留 + trim、非法字元換底線、移除開頭點、消毒後為空回預設）、`accountIdFromOwnerSub` 別名，以及 `runWithAccountId`/`currentAccountId`（情境外回預設、情境內取得消毒後 id、不外洩、null 回預設、巢狀還原、跨 await 保持）。純後端、僅新增測試、不改產品程式碼。
  - 修改說明（2026-06-25）：新增 `backend/test/accountContext.test.ts`，10 個測試涵蓋上述各案例（斷言一律以 import 的 `DEFAULT_ACCOUNT_ID` 比較而非硬編 `'default'`，避免受 `MAKESLIDE_ACCOUNT_ID` env 影響；async 案例以 `runWithAccountId('async-acct', async () => { await ...; currentAccountId() })` 驗證 AsyncLocalStorage 跨 await 保持情境且結束後不外洩）。以 `tsx --test` 直跑驗證 10 個測試全通過；backend typecheck 通過。未改動產品程式碼。分支 `test/account-context`，已 merge 回 master。

## 掃描摘要（2026-06-25 第四十八輪）

- TODO 唯一未完成項目（formatDurationMs i18n）仍暫緩（方案待使用者確認）。延續第四十三～四十七輪方向，繼續為後端純函式服務補測試。
- 觀察：`backend/src/services/promptTemplates.ts`（提示詞模板載入/渲染）**無單元測試**；其 `renderPromptTemplate`（`{{ name }}` 變數替換、空白容忍、缺值→空字串、非法 key 不替換）為純函式，`loadPromptTemplate` 的「檔案不存在→fallback」分支不需 fixture 檔即可測。
- 至此，先前盤點到的無測試純函式服務（logSanitizer/subtitleAlignment/pdfPageMarkers/imagePromptTemplates/accountContext/promptTemplates）已全部補上測試。後續輪次需重新掃描其他類型缺口或等候使用者提供新方向。

## 新增可執行項目（2026-06-25 第四十八輪）

- [x] 為 promptTemplates.ts 補單元測試：新增 `backend/test/promptTemplates.test.ts`，涵蓋 `renderPromptTemplate`（具名替換、大括號內空白容忍、缺值/空值→空字串、重複與多變數、底線/數字 key、無 placeholder 原樣、非名稱字元 token 保留）與 `loadPromptTemplate`（檔案不存在回 fallback）。純後端、僅新增測試、不改產品程式碼。
  - 修改說明（2026-06-25）：新增 `backend/test/promptTemplates.test.ts`，8 個測試涵蓋上述各案例（`{{a-b}}` 因 `-` 不在 `[a-zA-Z0-9_]` 命名集合故整個 token 原樣保留；`loadPromptTemplate('definitely/missing/...', 'FALLBACK')` 走 existsSync=false 分支回 fallback，無需建 fixture）。模組 import 連帶 `config` 無副作用問題；以 `tsx --test` 直跑驗證 8 個測試全通過；backend typecheck 通過。未改動產品程式碼。分支 `test/prompt-templates`，已 merge 回 master。

## 掃描摘要（2026-06-25 第四十九輪）

- TODO 唯一未完成項目（formatDurationMs i18n）仍暫緩（方案待使用者確認）。先前盤點的無 DB 純函式服務測試已補齊，本輪重新盤點 `backend/src/services/*.ts` 各檔的 export 與測試覆蓋，找出仍含可獨立測試之純函式者。
- 觀察：`backend/src/services/animationCustomScript.ts` 雖整體含 LLM streaming（非純），但其兩個**安全相關純函式** `findUnsafeScriptPattern`（防禦 LLM 產出的 custom-script 含 fetch/eval/localStorage/window.parent 等不安全 API）與 `findCustomScriptContractIssue`（驗證 `window.renderAnimation` + `api.onFrame` 契約）**無單元測試**——屬 defense-in-depth，值得測。import 連帶 `openai`/`pageAnimation` 無副作用問題，可 `tsx --test` 直跑。
- 其餘無測試 service 多涉 DB/外部 API/檔案 IO（aiSettings/gemini/openai/embeddings/storage/pdfFigures/presentationGit/handoutPdf/youtubeCaptions/imageMigration/accountProfiles），或為 `pageAnimation`（65 exports，含 `validateAnimationSpec` 等純驗證，可作後續較大項目）。

## 新增可執行項目（2026-06-25 第四十九輪）

- [x] 為 animationCustomScript 安全檢查補單元測試：新增 `backend/test/animationCustomScript.test.ts`，涵蓋 `findUnsafeScriptPattern`（安全碼通過；fetch/XMLHttpRequest/WebSocket/import/require/eval/new Function；cookie 與 storage 的 dot/bracket 兩式；window.parent/top/frameElement frame 逃逸；依定義順序回首個命中）與 `findCustomScriptContractIssue`（接受 renderAnimation+onFrame 的 dot/bracket 式；缺任一時各回對應訊息）。純後端、僅新增測試、不改產品程式碼。
  - 修改說明（2026-06-25）：新增 `backend/test/animationCustomScript.test.ts`，8 個測試涵蓋上述各案例（如 `eval("x"); fetch("/y")` 因 fetch 規則定義在 eval 之前故回 `fetch`；`window["renderAnimation"]` 與 `api.onFrame(...)` 的 bracket/dot 兩式皆視為合法契約）。import 連帶 `openai`/`pageAnimation` 無副作用問題；以 `tsx --test` 直跑驗證 8 個測試全通過；backend typecheck 通過。未改動產品程式碼。分支 `test/animation-custom-script`，已 merge 回 master。

## 掃描摘要（2026-06-25 第五十輪）

- TODO 唯一未完成項目（formatDurationMs i18n）仍暫緩（方案待使用者確認）。延續以純函式測試補覆蓋的方向。
- 觀察：`backend/src/services/pageAnimation.ts`（65 exports，整體含 LLM 生成等非純邏輯）中有四個**純函式**未直接測試：`defaultAnimationSpec`、`validateAnimationSpec`（zod 驗證 + 依 effect type 白名單過濾 params + hints 處理，是動畫 spec 儲存/載入的核心把關）、`renderTypeForSpec`、`parseStoredAnimationSpec`（壞 JSON/非法 spec fallback 至預設）。import 無副作用，可 `tsx --test` 直跑。

## 新增可執行項目（2026-06-25 第五十輪）

- [x] 為 pageAnimation spec 驗證純函式補單元測試：新增 `backend/test/animationSpecValidate.test.ts`，涵蓋 `defaultAnimationSpec`、`validateAnimationSpec`（最小合法 spec、拒絕非物件/錯版本、未知 effect type 訊息含 path、保留合法 typed 欄位、params 依 effect type 白名單過濾並剔除非允許/非有限/非數字、無允許 params 時整段移除、空 hints 移除但保留非空）、`renderTypeForSpec`、`parseStoredAnimationSpec`（合法 JSON 往返、壞 JSON 與非法 spec fallback 至預設）。純後端、僅新增測試、不改產品程式碼。
  - 修改說明（2026-06-25）：新增 `backend/test/animationSpecValidate.test.ts`，11 個測試涵蓋上述各案例（params 過濾以 `zoom-in` 帶 `{fromScale:1.5, toScale:2, distancePct:10, bad:NaN}` 驗證只留白名單內的有限數字 `{fromScale, toScale}`；`fade-in` 無允許 params 故整段 `params` 不出現；`hints: {}` 移除、`{'0':'note'}` 保留）。clamp/round 防禦因 schema 先以 `z.number().min/max/int` 把關、外部難觸發故未特別測。以 `tsx --test` 直跑驗證 11 個測試全通過；backend typecheck 通過。未改動產品程式碼。分支 `test/animation-spec`，已 merge 回 master。

## 掃描摘要（2026-06-25 第五十一輪）

- TODO 唯一未完成項目（formatDurationMs i18n）仍暫緩（方案待使用者確認）。`pageAnimation` 的純函式已測完，本輪檢視 `pdfFigures.ts`（14 exports，多涉檔案 I/O）中的純函式。
- 觀察：`pdfFigures.ts` 多數函式涉 `figures.json`/selection 的讀寫（I/O），但 `buildFigureReferenceNotes(figures: FigureEntry[])` 為純函式（由 figures 陣列組生圖參考說明字串、含 caption→context→佔位的優先序）且**無測試**。
- 說明：後端可獨立測試的純函式缺口已接近見底，剩餘多為 DB/檔案 I/O/外部 API 相依（需整合測試環境，於 sandbox 受 timeout 限制）。後續若無新方向，價值較高的工作（新功能）需使用者提供方向。

## 新增可執行項目（2026-06-25 第五十一輪）

- [x] 為 buildFigureReferenceNotes 補單元測試：新增 `backend/test/figureReferenceNotes.test.ts`，涵蓋空陣列回 null、逐圖 1-indexed 行、caption→context→`(無圖說文字)` 的優先序 fallback、以及說明用的 header/footer 包裹（行數）。純後端、僅新增測試、不改產品程式碼。
  - 修改說明（2026-06-25）：新增 `backend/test/figureReferenceNotes.test.ts`，4 個測試以 `makeFigure()` helper 構造符合 `FigureEntry` 型別的測試資料，涵蓋上述各案例（caption 為空白 `'   '` 時 trim 後 fallback 到 context、caption/context 皆 null 時用 `(無圖說文字)`；單圖時總行數為 header+1+footer=3）。import 連帶 `storage`/`openai`/`logger` 無副作用問題；以 `tsx --test` 直跑驗證 4 個測試全通過；backend typecheck 通過。未改動產品程式碼。分支 `test/figure-reference-notes`，已 merge 回 master。

## 掃描摘要（2026-06-25 第五十二輪）

- TODO 唯一未完成項目（formatDurationMs i18n）仍暫緩（方案待使用者確認）。後端可獨立測試的純函式缺口見底，本輪轉向前端，找「純計算但未 export 故無法測」的可測性缺口。
- 觀察：`frontend/src/components/slide/buildGsapTimeline.ts` 內的 `panDistance` 與 `transformFromTo` 為純計算（不碰 GSAP/DOM），但未 export 且同檔 import `gsap`（node 測試環境 import gsap 風險未知），故無法獨立測試；兩者含真實的預設值邏輯（`fromScale ?? 1`、zoom-in 預設 to `1.08`、pan 距離 fallback `3`、各方向軸/正負號）值得測。

## 新增可執行項目（2026-06-25 第五十二輪）

- [x] 抽出可測的投影片 transform 純函式並補測試：把 `buildGsapTimeline.ts` 內的 `panDistance`/`transformFromTo` 抽到新的、無 GSAP 相依的 `frontend/src/components/slide/slideTransforms.ts`，`buildGsapTimeline` 改 import 之；新增 `slideTransforms.test.ts` 涵蓋 pan 距離 fallback、zoom 預設/覆寫、各 pan 方向軸與正負號、overlay 型別回 null。純前端、行為不變、低風險。
  - 修改說明（2026-06-25）：新增無 GSAP 相依的 `slideTransforms.ts`（export `panDistance`/`transformFromTo`，僅 import 型別），`buildGsapTimeline.ts` 移除本地兩函式與不再使用的 `SlideAnimationEffect` import、改 import `transformFromTo`（行為不變）。新增 `slideTransforms.test.ts` 6 個測試（distancePct 缺/NaN/Infinity→3、有限值含 0、fade-in、zoom 預設 1→1.08 與 1.08→1、顯式 scales、四個 pan 方向的 x/yPercent 正負、text-callout/pointer/highlight-box 回 null）。frontend typecheck 通過、全部 299 個前端測試 + i18n 對等 21 個全通過。分支 `refactor/extract-slide-transforms`，已 merge 回 master。

## 掃描摘要（2026-06-25 第五十三輪）

- TODO 唯一未完成項目（formatDurationMs i18n）仍暫緩（方案待使用者確認）。本輪轉向找「現有測試攔不到的真實風險」：i18n 對等測試（`i18n.test.ts` 第一個測試）只比對 zh-TW/en 的 **key 集合**，不檢查同一 key 的**插值 placeholder（`{count}` 等）是否一致**。
- 觀察：以腳本比對全部 1811 個 key 的 `{...}` placeholder 集合，目前 zh-TW 與 en **完全一致（0 不一致）**；但缺乏防回歸測試——未來新增 key 時若某語系漏帶 placeholder，會在該語系 UI 執行期靜默丟失插值（如數字不顯示），而現有測試不會攔截。

## 新增可執行項目（2026-06-25 第五十三輪）

- [x] i18n placeholder 一致性防回歸測試：在 `frontend/src/i18n.test.ts` 新增一個測試，對每個共有 key 比對 zh-TW 與 en 的 `{name}` placeholder token 集合是否相同，不同則列出 key 與雙方 placeholder。純前端、僅新增測試、不改產品程式碼。
  - 修改說明（2026-06-25）：在 `i18n.test.ts` key 對等測試之後新增「English and Traditional Chinese share the same interpolation placeholders per key」測試（以 `/\{[a-zA-Z0-9_]+\}/g` 擷取雙方 placeholder 集合並比對，蒐集所有不一致 key 後一次 `deepEqual([])` 斷言）。經先期腳本掃描確認目前全部 1811 個 key 一致故測試通過，此測試固化該不變量、防止未來回歸。frontend typecheck 通過、全部 i18n 測試 22 個（原 21+1）通過。分支 `test/i18n-placeholder-consistency`，已 merge 回 master。

## 掃描摘要（2026-06-25 第五十四輪）

- TODO 唯一未完成項目（formatDurationMs i18n）仍暫緩（方案待使用者確認）。延續「找測試攔不到的真實瑕疵」角度，核對 `docs/error-codes.md` 主要錯誤碼與前端 `mapApiErrorToHumanMessage()`（`lib/api/common.ts` 的 `ERROR_HINTS`）的覆蓋。
- 發現真實缺口：`INVALID_REQUEST` 是後端最常見的 client-facing 錯誤碼（**202 處使用**、`errors.ts` 標準碼），且其 message 多為英文技術字串（'Invalid body'、'Invalid id or page number' 等），但 `ERROR_HINTS` **沒有對應條目**，導致 `mapApiErrorToHumanMessage` 對它走 fallback、把英文原文直接顯示給使用者（其他主要碼皆有友善中文訊息，唯獨此最常見者沒有，不一致也傷 UX）。

## 新增可執行項目（2026-06-25 第五十四輪）

- [x] 為 INVALID_REQUEST 補友善錯誤訊息：在 `ERROR_HINTS` 新增 `INVALID_REQUEST` 的中文 title/message/nextStep，使 `mapApiErrorToHumanMessage` 不再對最常見的請求驗證錯誤顯示後端英文原文；補一個測試斷言其映射到友善訊息且非原始字串。純前端、低風險。
  - 修改說明（2026-06-25）：在 `lib/api/common.ts` 的 `ERROR_HINTS` 最前面（對應文件順序）新增 `INVALID_REQUEST: { title: '請求格式不正確', message: '送出的資料未通過驗證。', nextStep: '請檢查輸入內容後重新送出。' }`；於 `api.error-mapping.test.ts` 新增測試斷言 `INVALID_REQUEST` 映射 title 為「請求格式不正確」、message 不等於後端原文 'Invalid body' 且有 nextStep。frontend typecheck 通過、全部 301 個前端測試（原 299+2）+ i18n 對等 22 個全通過。分支 `fix/invalid-request-human-message`，已 merge 回 master。

## 掃描摘要（2026-06-25 第五十五輪）

- 延續第五十四輪，系統性比對後端 `errorResponse('CODE',…)` 高頻 client-facing 碼與前端 `ERROR_HINTS` 覆蓋。高頻清單：INVALID_REQUEST(199)、FORBIDDEN(135)、PDF_NOT_FOUND(125)、PAGE_NOT_FOUND(42)、INTERNAL_ERROR(33)、INVALID_STATE(21)、NOT_FOUND(16)、ADMIN_REQUIRED(8)…。
- 抽查 message 內容後判定：`NOT_FOUND`（16 次）的 message **全為英文**（'PDF not found'、'Comment not found'）且無前端 hint → 純改善缺口，補。`ADMIN_REQUIRED`（全中文具體，如「只有 admin 可以刪除帳號」）與部分 `FORBIDDEN`（中文具體，如「只有簡報擁有者可以建立分享連結」）若補固定 hint 反而會**覆蓋掉後端的具體中文訊息**，故刻意不補、保留 message fallback。
- 後續觀察：`mapApiErrorToHumanMessage` 為精確 key 查表、無 pattern fallback；眾多 `*_NOT_FOUND`（QUIZ_NOT_FOUND/POLL_NOT_FOUND/VERSION_NOT_FOUND/PAGE_*_NOT_FOUND/FIGURE_NOT_FOUND…）多帶英文 message。可評估在 fallback 前加「以 `_NOT_FOUND` 結尾 → 通用『找不到資源』」規則一次涵蓋，但屬行為變更（會覆蓋具體性），列為待評估，未逕行。

## 新增可執行項目（2026-06-25 第五十五輪）

- [x] 為通用 NOT_FOUND 補友善錯誤訊息：在 `ERROR_HINTS` 新增 `NOT_FOUND` 的中文 title/message/nextStep，使最常見的通用「找不到」錯誤不再對使用者顯示後端英文原文（'PDF not found' 等）；補一個測試。`ADMIN_REQUIRED`/具體 `FORBIDDEN` 因 message 已是具體中文，刻意保留 fallback、不補固定 hint。純前端、低風險。
  - 修改說明（2026-06-25）：在 `ERROR_HINTS` 的 `PAGE_NOT_FOUND` 後新增 `NOT_FOUND: { title: '找不到資源', message: '要求的資料不存在或已被移除。', nextStep: '請重新整理後再試，或確認操作對象是否仍存在。' }`；於 `api.error-mapping.test.ts` 新增測試斷言 `NOT_FOUND` 映射 title「找不到資源」、message 不等於後端原文 'PDF not found' 且有 nextStep。frontend typecheck 通過、全部前端測試（含 error-mapping 5 個）+ i18n 對等 22 個全通過。分支 `fix/not-found-human-message`，已 merge 回 master。

- [x] `*_NOT_FOUND` pattern fallback：在 `mapApiErrorToHumanMessage` 精確查表失敗後，對「以 `_NOT_FOUND` 結尾」的未知碼回傳通用「找不到資源」訊息，一次涵蓋 QUIZ_NOT_FOUND/POLL_NOT_FOUND/VERSION_NOT_FOUND/FIGURE_NOT_FOUND/SKILL_NOT_FOUND 等。
  - 補充（第五十六輪後）：部分 legacy `*_NOT_FOUND`（PAGE_IMAGE/TEXT/SCRIPT/AUDIO_NOT_FOUND、COVER_NOT_READY、VIDEO/OUTLINE_NOT_FOUND）已於第五十六輪透過後端 `normalizeErrorCode` 接線改為送出 `RESOURCE_NOT_FOUND`，故此 pattern 項目的涵蓋面縮小，主要剩 QUIZ/POLL/VERSION/FIGURE/SKILL_NOT_FOUND 等未被 normalize 的碼。
  - 修改說明（2026-06-25 第五十七輪）：先核實剩餘未 normalize 的 `*_NOT_FOUND` 碼（QUIZ/POLL/VERSION/FIGURE/SKILL/REGENERATE_JOB/ADD_PAGES_JOB_NOT_FOUND）之後端 message **全為英文**（'Quiz X not found' 等），確認原「會覆蓋具體中文 message」的疑慮不成立、此 pattern 為純改善（英文洩漏→友善中文），故逕行實作。在 `mapApiErrorToHumanMessage` 精確查表後、fallback 前加 `if (err.code.endsWith('_NOT_FOUND')) return RESOURCE_NOT_FOUND_HINT`；抽出型別安全常數 `RESOURCE_NOT_FOUND_HINT`（因 tsconfig `noUncheckedIndexedAccess`，`ERROR_HINTS.NOT_FOUND` 索引型別含 undefined）供 `ERROR_HINTS.NOT_FOUND` 與 fallback 共用。新增 2 測試（QUIZ/FIGURE_NOT_FOUND → 通用訊息、PDF_NOT_FOUND 仍優先用專屬 hint）。frontend typecheck 通過、全部 304 個前端測試 + i18n 對等 22 個全通過。分支 `feat/not-found-pattern-fallback`，已 merge 回 master。

## 掃描摘要（2026-06-25 第五十八輪）

- 檢視 `mapApiErrorToHumanMessage` 的**採用情況**，發現結構問題：該映射函式（第 54–57 輪改進的 `ERROR_HINTS` 入口）**全前端僅 2 處使用**（`UploadButton`、`ImportTextPage`），而有約 **55 處** catch 區塊直接 `setError(err.message)` 顯示後端原始 message、繞過映射。意即前幾輪 ERROR_HINTS 改進的實際惠及面有限（主要是上傳/匯入入口）。直接顯示 message 的大戶：QuizBuilderPage(12)、PlayPage(9)、QualityCheckPanel(3)、PlayPageSlidePanel(3)。
- 判斷：全面改造 55 處改用 `mapApiErrorToHumanMessage` 屬較大工程，且每處 catch 上下文不同、許多後端 message 已是中文（未必都是英文洩漏），逐點需判斷，**不適合自動 loop 單輪盲改**；列為待使用者決定的較大項目。
- 本輪改做確定安全的測試補強：`lib/api/common.ts` 的錯誤判斷純函式僅 `isAlreadyProcessingConflict` 有測試。

## 新增可執行項目（2026-06-25 第五十八輪）

- [ ] （待使用者決定，較大工程）系統性採用 `mapApiErrorToHumanMessage`：目前約 55 處 catch 直接顯示後端 `err.message`、繞過錯誤訊息映射，使 ERROR_HINTS 友善訊息影響面受限。可逐區（先 QuizBuilderPage/PlayPage 等大戶）改為經 `mapApiErrorToHumanMessage` 顯示，但需逐點確認該處後端 message 是否本就中文、catch 上下文是否適用。範圍大、需產品判斷顯示風格，故不於自動 loop 逕行。

- [x] 補 api/common.ts 錯誤判斷純函式測試：為 `isApiErrorBody`、`isCreditExhaustedError`、`isApiKeyMissingError` 補單元測試（`isAlreadyProcessingConflict` 已有）。純前端、僅新增測試、不改產品程式碼。
  - 修改說明（2026-06-25）：在 `lib/api/common.test.ts` 新增 4 個測試：`isApiErrorBody`（良構 body vs null/非物件/缺 message/code 非字串）、`isCreditExhaustedError`（遍歷 `CREDIT_EXHAUSTED_ERROR_CODES` 全 7 碼為 true、其他碼/非 ApiError 為 false）、`isApiKeyMissingError`（僅 API_KEY_MISSING）。以 `tsx --test` 直跑驗證 8 個測試（原 4+4）全通過；frontend typecheck 通過。分支 `test/api-error-predicates`，已 merge 回 master。

## 掃描摘要（2026-06-25 第五十九輪）

- 實質檢視前端核心 `lib/subtitles.ts`（字幕切句 + 時間軸估算）：邏輯正確、邊界處理完善、與後端 `subtitleAlignment.ts` 的 `splitScriptIntoSentences` 正則/邏輯**鏡像一致**，且測試覆蓋完整（split 各案例 + timeline 不變量），無可補缺口。
- 注意：本 loop 由 cron（job `e56cc706`，每 5 分鐘）自動觸發「請依 LOOP.md 執行」，非使用者即時互動，故自主完成可獨立驗證的工作。
- 觀察：`lib/api/*` 子模組中三個純函式 URL builder（`figureImageUrl`/`imageVersionUrl`/`batchExportDownloadUrl`）皆以 `encodeURIComponent` 編碼路徑片段（前後端 URL 契約、防特殊字元破壞），但**無測試**。

## 新增可執行項目（2026-06-25 第五十九輪）

- [x] 補 URL builder 純函式測試：為 `figureImageUrl`/`imageVersionUrl`/`batchExportDownloadUrl` 新增 `lib/api.url-builders.test.ts`，涵蓋正常路徑結構與 `/`、空格、`#` 等特殊字元的 percent-encoding。純前端、僅新增測試、不改產品程式碼。
  - 修改說明（2026-06-25）：新增 `frontend/src/lib/api.url-builders.test.ts`，5 個測試斷言三個 URL builder 的路徑結構（如 `figureImageUrl('abc','p1-img2')` → `api/pdfs/abc/figures/p1-img2/image`）與特殊字元編碼（`a/b`→`a%2Fb`、空格→`%20`、`#`→`%23`、`imageVersionUrl` 各 segment 皆編碼且 pageNumber 字串化）。以 `tsx --test` 直跑驗證 5 個測試全通過；frontend typecheck 通過。分支 `test/url-builders`，已 merge 回 master。

## 掃描摘要（2026-06-25 第六十輪）

- 檢視後端 `storage.ts`（33 exports）：多數為簡單路徑拼接（測試價值低），但 `safeJoinPdfPath`（路徑穿越防護的安全函式，限制使用者可影響的路徑片段於該 pdf 的 storage 目錄內）**無測試**。屬安全關鍵（類比 logSanitizer、custom-script 安全檢查），值得測。
- 其餘無測試後端 service 多涉 DB/外部 API/檔案 IO。

## 新增可執行項目（2026-06-25 第六十輪）

- [x] 為 safeJoinPdfPath 補路徑穿越防護測試：新增 `backend/test/safeJoinPdfPath.test.ts`，涵蓋正常片段解析於 base 內、無片段回 base、base 內的 `..` 正規化、以及阻擋上層穿越/絕對路徑片段/同前綴 sibling（`../abc-evil` 不可被當成 `abc` 子路徑）。純後端、僅新增測試、不改產品程式碼。
  - 修改說明（2026-06-25）：新增 `backend/test/safeJoinPdfPath.test.ts`，6 個測試以 `path.resolve(pdfDir(id))` 為 base 比較預期，涵蓋：正常多片段解析、無片段回 base、`sub/../f.txt` 正規化仍在 base、`../../etc/passwd` 上層穿越 throw、`/etc/passwd` 絕對路徑片段 throw、`../abc-evil` 同前綴 sibling throw（驗證 prefix 檢查用 `+ path.sep` 避免 abc-evil 誤判為 abc 子路徑）。以 `tsx --test` 直跑驗證 6 個測試全通過；backend typecheck 通過。分支 `test/safe-join-path`，已 merge 回 master。

## 掃描摘要（2026-06-25 第六十一輪）

- 盤點 `backend/src/worker/` 的純函式測試缺口。多個 worker step 含未測純函式：`renderTextPages`（escapeXml/splitLines/toPages）、`synthesizeAudio`（parseWavPcmChunk/splitByToneMarkers/splitSpeakerPrefix/isRetryableTtsError/extractTtsErrorMessage）、`generateScript`（scriptCharBounds/isMinimalSlideStyleRequested）、`generateVideo`（evenCeil/buildScaleAndPadFilter）、`splitTextWithLlm`（splitBySlideMarkers）等，皆無測試。
- 本輪先處理 `renderTextPages` 的三個純函式（含安全相關的 `escapeXml`，防 SVG/XML injection）。其餘列為後續輪次候選。

## 新增可執行項目（2026-06-25 第六十一輪）

- [x] 為 renderTextPages 純函式補測試：新增 `backend/test/renderTextPagesHelpers.test.ts`，涵蓋 `escapeXml`（五個 XML 特殊字元、`&` 先行避免雙重 escape、純文字不變）、`splitLines`（CRLF/CR 正規化、空行保留、空輸入→`['']`、trailing trim、超過 CHARS_PER_LINE 硬換行）、`toPages`（LINES_PER_PAGE 分頁、空/短清單）。純後端、僅新增測試、不改產品程式碼。
  - 修改說明（2026-06-25）：新增 `backend/test/renderTextPagesHelpers.test.ts`，8 個測試。測試頂部以註解標明 `CHARS_PER_LINE=34`/`LINES_PER_PAGE=12` 對應 src module-private 常數（固化 wrapping/分頁規格，改 src 需同步）。`escapeXml` 驗證 `&`→`&amp;` 先行（`escapeXml('&lt;')`→`'&amp;lt;'`）。以 `tsx --test` 直跑驗證 8 個測試全通過；backend typecheck 通過。分支 `test/render-text-pages-helpers`，已 merge 回 master。

## 掃描摘要（2026-06-25 第六十二輪）

- 嘗試續測 worker 層純函式（synthesizeAudio/generateVideo 等），但確認這些檔的 import 鏈會觸及 `better-sqlite3` native module（`NODE_MODULE_VERSION` 127 vs 147 不符，sandbox 環境問題），無法以 `tsx --test` 直跑——這也是後端整套測試在 sandbox 失敗的主因。`renderTextPages`（上輪）是少數 import 鏈不含 db 的 worker step 例外。
- 因此改回 import 鏈乾淨的前端。發現 `frontend/src/i18n.ts` 的純函式 `normalizeLanguage`/`translate`/`normalizePlaybackSpeed` 未測（`i18n.test.ts` 只測 locale key 對等，不測這些函式）。`translate` 的 fallback 鏈（lang→zh-TW→key 本身）是缺失翻譯時的行為保證，值得測。

## 新增可執行項目（2026-06-25 第六十二輪）

- [x] 為 i18n 純函式補測試：新增 `frontend/src/i18n.helpers.test.ts`，涵蓋 `normalizeLanguage`（支援語言 vs 不支援/非字串/自訂 fallback）、`translate`（各語系條目 + 缺失 key 時 zh-TW→key 本身的 fallback 鏈）、`normalizePlaybackSpeed`（允許速度的 number/string、超集合/非數字/自訂 fallback）。純前端、僅新增測試、不改產品程式碼。
  - 修改說明（2026-06-25）：新增 `frontend/src/i18n.helpers.test.ts`，6 個測試。`translate` 缺失 key 以 `'__definitely.not.a.key__' as TranslationKey` 驗證最終 fallback 回 key 本身；正常條目以 import 的 `en`/`zhTW` 比較（不硬編字串）。`normalizePlaybackSpeed` 驗證允許集合 `[0.5,0.75,1,1.25,1.5,2]`、`'2'`/`'0.75'` 字串轉換、`1.1`/`'abc'`/null/NaN fallback。以 `tsx --test` 直跑驗證 6 個測試全通過；frontend typecheck 通過。分支 `test/i18n-helpers`，已 merge 回 master。

## 掃描摘要（2026-06-25 第六十三輪）

- `hooks/useBudgetWarning.ts` 僅單一 hook、無純 helper。`i18n.ts` 的 `getStored*` 設定讀取函式（`getStoredShowSubtitle`/`getStoredInteractiveMode`/`getStoredAutoAdvance`/`getStoredTtsSpeed`/`getStoredPlaybackSpeed`）含 boolean（`'1'`/`'true'`）與數字範圍解析及預設邏輯，但**無測試**；所有對應 `*_STORAGE_KEY` 皆有 export，可用 MemoryStorage stub（模式同 `viewerId.test.ts`）測試。

## 新增可執行項目（2026-06-25 第六十三輪）

- [x] 為 i18n getStored* 設定解析補測試：新增 `frontend/src/i18n.stored-settings.test.ts`，以 MemoryStorage window stub 測 `getStoredShowSubtitle`（預設 true、`1`/`true` vs 其他）、`getStoredInteractiveMode`/`getStoredAutoAdvance`（預設 false）、`getStoredTtsSpeed`（0.5–2 範圍）、`getStoredPlaybackSpeed`（僅允許集合）。純前端、僅新增測試、不改產品程式碼。
  - 修改說明（2026-06-25）：新增 `frontend/src/i18n.stored-settings.test.ts`，4 個測試。`(globalThis as {window?:unknown}).window = { localStorage }` 注入 MemoryStorage，動態 `await import('./i18n')` 確保 stub 先就位。涵蓋各 boolean 解析（含 `'TRUE'` 大小寫、`'nope'`→false）、TTS 速度越界（`'0.3'`/`'3'`/`'abc'`→1）、播放速度非允許集合（`'1.1'`/`'9'`→1）。以 `tsx --test` 直跑驗證 4 個測試全通過；frontend typecheck 通過。分支 `test/i18n-stored-settings`，已 merge 回 master。

## 掃描摘要（2026-06-25 第六十四輪）

- 可在 sandbox 測試的純函式缺口已枯竭（worker 層受 native module 限制）。依 LOOP.md「面向使用者的改善需於 BLOG.md 加 section」，補記第 54–57 輪的「錯誤提示友善化」成果——這批改善使用者可感知（錯誤訊息由英文技術字串改為友善中文），但當時僅記於 TODO.md 修改說明、未補 BLOG.md。

## 新增可執行項目（2026-06-25 第六十四輪）

- [x] BLOG.md 補記「錯誤提示友善化」：為第 54–57 輪的錯誤訊息 UX 改善（後端 normalizeErrorCode 接線、INVALID_REQUEST/NOT_FOUND 友善訊息、通用 `*_NOT_FOUND` fallback）在 BLOG.md 新增 section（功能目的／使用方式／技術細節）。文件、低風險。
  - 修改說明（2026-06-25）：BLOG.md 末尾新增「## 錯誤提示友善化（2026-06-25）」section，說明此批改善的目的（使用者見友善中文而非英文技術字串）、使用方式（無需操作、錯誤提示自動友善化）與技術細節（errorResponse 接線 normalizeErrorCode、ERROR_HINTS 新增 INVALID_REQUEST/NOT_FOUND、`*_NOT_FOUND` 通用 fallback 且保留具體中文訊息的 ADMIN_REQUIRED/FORBIDDEN、對應測試）。分支 `docs/blog-error-messages`，已 merge 回 master。

## 掃描摘要（2026-06-25 第六十五輪）

- 重新試探仍無測試的後端 services 中 import 鏈乾淨（不含 better-sqlite3 native module）者：`animationAutoFocus`、`handoutPdf`、`llmUsage` 可 import；`imageMigration`/`presentationGit`/`accountProfiles` 因 native module 失敗、無法測。
- `handoutPdf.ts`（講義 PDF 生成）有多個未測純函式：`escapePdfText`（PDF 字串語法 escape）、`sanitizePdfText`（CRLF/控制字元清理）、`wrapText`（依字元數換行、空格優先斷行、Array.from 處理多位元組）、`toUtf16BeHex`（UTF-16BE + BOM hex 編碼，byte 順序為常見 bug 點）——皆值得測。

## 新增可執行項目（2026-06-25 第六十五輪）

- [x] 為 handoutPdf 文字純函式補測試：新增 `backend/test/handoutPdfHelpers.test.ts`，涵蓋 `escapePdfText`（反斜線/括號 escape、反斜線先行）、`sanitizePdfText`（CRLF 正規化、控制字元→空格、保留 tab/newline）、`wrapText`（界內單行、空/空行段落、最後空格斷行、多位元組硬斷）、`toUtf16BeHex`（BOM + big-endian 大寫 hex 含 CJK）。純後端、僅新增測試、不改產品程式碼。
  - 修改說明（2026-06-25）：新增 `backend/test/handoutPdfHelpers.test.ts`，8 個測試全通過。`sanitizePdfText` 的控制字元測資以 `String.fromCharCode(0)`/`(7)` 構造（避免在源碼嵌入裸控制字元，且規避 Write 工具對 `\uXXXX` 跳脫處理不一致的問題）；`toUtf16BeHex('中')`→`'FEFF4E2D'` 驗證 big-endian 順序。以 `tsx --test` 直跑驗證 8 個測試全通過；backend typecheck 通過。分支 `test/handout-pdf-helpers`，已 merge 回 master。

## 掃描摘要（2026-06-25 第六十六輪）

- `animationAutoFocus.ts`（import 鏈乾淨）的 `mapAutoFocusResponseToEffects` 是把 AI 逐句焦點決策映射為 `AnimationEffect[]` 的純函式，含豐富邏輯（line 範圍過濾、同 line 去重保留第一、依 line 排序、`show:false` 過濾、text-callout/step-list/formula/custom-script 無內容時 fallback `highlight-box`、pointer 僅 xPct/yPct、座標/尺寸/exitDuration clamp、custom-script 每頁上限）但**無測試**。

## 新增可執行項目（2026-06-25 第六十六輪）

- [x] 為 mapAutoFocusResponseToEffects 補單元測試：新增 `backend/test/animationAutoFocusMap.test.ts`，涵蓋 show 過濾 + 依 line 排序、line 範圍外丟棄、同 line 去重（保留第一）、text-callout/step-list 無內容 fallback highlight-box、pointer 僅 xPct/yPct + angle、box 座標/尺寸 clamp、effect 骨架（target/start/ease/startTrigger/id）與 exitDuration clamp。純後端、僅新增測試、不改產品程式碼。
  - 修改說明（2026-06-25）：新增 `backend/test/animationAutoFocusMap.test.ts`，8 個測試。以 `resp()`/`box()` helper 構造已驗證型別的輸入（函式不再 validate，故 `as unknown as AutoFocusAiResponse`）。clamp 以 `xPct:200→95`、`yPct:-5→0`、`widthPct:1→5`、`heightPct:999→100` 驗證 box 範圍；id 以 `/^ai-focus-2-/` match（含 `crypto.randomUUID()` 不可預測尾段）；exitDuration `99999` 驗證被 clamp。以 `tsx --test` 直跑驗證 8 個測試全通過；backend typecheck 通過。分支 `test/auto-focus-map`，已 merge 回 master。

## 掃描摘要（2026-06-25 第六十七輪）

- 可在 sandbox 測試的純函式接近枯竭（`llmUsage` 已有測試、`animationAutoFocus` 純函式上輪已測、worker 多受 native module 限制）。改檢視測試「執行流程」本身。
- **重要發現**：此為 npm workspaces monorepo，root `package.json` 的 `test` script 只跑 backend（`npm --workspace backend test`）——前端的 **323 個** node:test 從未被 `npm test` 執行，是「孤兒測試」（typecheck 有涵蓋前端、test 沒有）。且 `frontend/package.json` 原本連 `test` script 都沒有，亦無 `tsx` 顯式依賴（既有前端測試靠 workspace hoisting 的 tsx 跑）。

## 新增可執行項目（2026-06-25 第六十七輪）

- [x] 前端 workspace 新增 test script：在 `frontend/package.json` 加 `"test": "../scripts/with-node-env.sh tsx --test 'src/**/*.test.ts'"`，提供前端測試執行入口（先前完全沒有）。tsx 靠 workspace hoisting 解析（與既有前端測試跑法一致）。低風險。
  - 修改說明（2026-06-25）：`frontend/package.json` 於 `typecheck` 後新增 `test` script。以 `npx tsx --test 'src/**/*.test.ts'` 驗證 glob 涵蓋全部 **323 個前端測試**（4 suites）全通過；script 內容與 backend 對稱。分支 `chore/frontend-test-script`，已 merge 回 master。

- [ ] （待處理，涉 CI 行為變更 / npm install）把前端測試納入 root `npm test` 並補 frontend tsx 顯式依賴：① root `package.json` 的 `test` 改為同時跑 backend 與 frontend workspace（目前只跑 backend，前端 323 測試未納入 CI）；② 為 `frontend/package.json` 補 `tsx` devDependency（目前靠 hoisting，非顯式）使依賴正確。因 ① 改變 CI 行為、② 需 `npm install`，且 sandbox 的 `with-node-env.sh` 環境無法完整驗證 `npm test`，留待正式環境處理或使用者確認後再做。

## 掃描摘要（2026-06-25 第六十八輪）

- 檢查前後端「鏡像」資料的 drift 風險。發現：前端 `lib/costEstimate.ts` 的 `LLM_PRICE_PER_1M_TOKENS` 原始碼註解明言「Mirrors the backend's MODEL_PRICE_PER_1M_TOKENS」，兩份手動維護的模型價格表必須一致（否則使用者看到的成本估算會與後端記帳不符），但分屬不同 package、無任何測試防止 drift。經完整比對，目前 6 個模型（gpt-4o-mini/gpt-4o/gemini-2.0-flash/-lite/1.5-flash/1.5-pro）的 input/output 價格**完全一致**（無 bug）。

## 新增可執行項目（2026-06-25 第六十八輪）

- [x] 前後端 LLM 價格表一致性防 drift 測試：因兩表分屬不同 package、無法以單一單元測試交叉 import 比對，於後端測試以 `fs` 讀取前端 `costEstimate.ts` 原始碼、正則抽取其 `LLM_PRICE_PER_1M_TOKENS` 條目，與後端 import 的 `MODEL_PRICE_PER_1M_TOKENS` 比對（model 集合 + 每個 input/output 價格）。純後端、僅新增測試、不改產品程式碼。
  - 修改說明（2026-06-25）：新增 `backend/test/llmPricingConsistency.test.ts`，3 個測試：前端表可正則 parse 出 ≥5 個 model（防正則失效誤判通過）、前後端 model 集合相同、每個 model 的 input/output 價格相同。以 `new URL('../../frontend/src/lib/costEstimate.ts', import.meta.url)` 定位前端檔；此測試會在任一端價格表 drift 時失敗。以 `tsx --test` 直跑驗證 3 個測試全通過；backend typecheck 通過。分支 `test/llm-pricing-consistency`，已 merge 回 master。

## 掃描摘要（2026-06-25 第五十六輪）

- 延續錯誤碼一致性調查，檢視後端 `errors.ts`。發現架構落差：`normalizeErrorCode`（legacy→standard 映射）**有單元測試**（`pages-api.test.ts`）卻**從未被產品程式碼呼叫**——路由實際用的 `errorResponse`（`routes/pdfs.ts`、`routes/pdfs/shared.ts` 兩份重複定義）直接送原始 code、不 normalize。導致 legacy 碼（PAGE_IMAGE_NOT_FOUND、COVER_NOT_READY、NO_FILE、INVALID_MIME 等）原樣洩漏到前端，而前端 `ERROR_HINTS` 無對應條目、顯示英文 fallback。
- 經 AskUserQuestion 確認，使用者選擇「接線啟用 normalize」。

## 新增可執行項目（2026-06-25 第五十六輪）

- [x] 接線 normalizeErrorCode 至 errorResponse：讓兩份 `errorResponse`（`routes/pdfs.ts` local、`routes/pdfs/shared.ts` export，後者為所有 pdf 子路由共用）套用 `normalizeErrorCode`，使 legacy 錯誤碼在 API 邊界正規化為標準碼，前端即可顯示友善訊息。補後端純函式測試。後端、低風險（normalize 目標標準碼前端皆有 hint、無 API-level 測試斷言 legacy code）。
  - 修改說明（2026-06-25）：兩份 `errorResponse` 改為 `{ error: { code: normalizeErrorCode(code), message } }`（各自 import `../errors`/`../../errors`；確認全後端僅此 2 處定義、其餘子路由皆 import 自 shared.ts 故一併涵蓋；兩檔互不 import、無循環）。新增 `backend/test/errors.test.ts`（5 測試）完整覆蓋全部 12 個 legacy→standard 映射、標準碼/未知碼 passthrough、`apiError` 正規化與 detail 條件。接線後 RESOURCE_NOT_FOUND/FILE_REQUIRED/INVALID_UPLOAD_TYPE/INVALID_URL/JOB_CONFLICT 皆對應前端既有 `ERROR_HINTS`。backend typecheck 通過、`errors.test.ts` 5 測試以 `tsx --test` 直跑全通過（既有 `pages-api.test.ts` 的 normalizeErrorCode 斷言不受影響，因函式行為不變）。分支 `feat/wire-normalize-error-code`，已 merge 回 master。

## 工作記錄（第六十九輪，2026-06-26）

- 工作內容：完成「formatDurationMs『尚無紀錄』i18n」項目。`formatters.ts` 的 `formatDurationMs(ms)` 原本在 `ms == null || !Number.isFinite(ms)` 時回傳硬編中文 `尚無紀錄`，於英文介面（`PageTimingChips` 的計時 chips／tooltip、`PlayPageSlidePanel` 的計時表／run 歷史／stage／慢成品 SLA 表）洩漏未翻譯文字。改為新增**必填** `noRecordLabel` 參數，由 TypeScript 編譯期保證所有呼叫端傳入 label；10 處呼叫端分別沿用既有鍵 `play.timing.tooltip.noRecord`（chips 4 處）與 `play.system.noRecord`（system 表 6 處），兩鍵 zh-TW/en 皆已存在，故未新增重複鍵。更新 `formatters.test.ts` 斷言並補一筆英文 label 案例。typecheck 通過、formatters 測試 11 個與 i18n 對等測試 28 個全通過。純前端、低風險。
- 時間：2026-06-26
- 分支：`feat/format-duration-norecord-i18n`（已 merge 回 master）
- 計數：自上次「---- 計數重設 ----」(2026-06-25) 起算，本項為第 73 個完成項目（73/100，未達上限）。
## 工作記錄（第七十輪，2026-06-26）

- 工作內容：TODO.md 既有未完成項目僅剩 2 個皆明確標註「待使用者決定／涉 CI 行為變更與 npm install」，不宜於自動 loop 逕行；依 LOOP.md 改為「分析程式找可加強之處並加入新項目」。延續 i18n 主題掃描，發現 `lib/ttsVoices.ts` 的 `geminiVoiceLabel`/`openaiVoiceLabel` 把語音性別後綴硬編成中文「（男）/（女）」，於英文介面的語音選單（`SettingsPage`、`TtsDialog`、`PromptModal`）洩漏未翻譯文字。將其新增為 TODO 項目並當輪完成：兩 helper 改收**必填** `genderLabels { male, female }` 參數（由 TypeScript 編譯期確保 6 處呼叫端皆傳入），新增共用鍵 `tts.voiceGenderMale`/`tts.voiceGenderFemale`（zh-TW 男/女、en M/F）。typecheck 通過、`ttsVoices.test.ts` 與 i18n 對等測試共 40 個全通過。純前端、低風險。
- 時間：2026-06-26
- 分支：`feat/voice-gender-label-i18n`（已 merge 回 master）
- 計數：自上次「---- 計數重設 ----」(2026-06-25) 起算，本項為第 74 個完成項目（74/100，未達上限）。
## 工作記錄（第七十一輪，2026-06-26）

- 工作內容：既有未完成項目仍僅 2 個皆需使用者裁示，依 LOOP.md 改為分析新增可執行項目。延續 i18n 主題，發現 `pages/play/useSlideManagement.ts` 有 7 處硬編中文（刪除頁 `window.confirm` 與 6 個 fallback 錯誤/狀態訊息），於英文介面洩漏未翻譯文字。當輪新增並完成：hook 引入 `useI18n()`，新增 7 個 `play.slideManagement.*` 對等鍵（zh-TW/en），confirm 以 `{page}` 插值；`t` 因在 `useI18n` 內 `useCallback([language])` 記憶化故安全加入各 `useCallback` 依賴。typecheck 通過、i18n 對等測試 28 個全通過。純前端、低風險。
- 時間：2026-06-26
- 分支：`feat/slide-management-i18n`（已 merge 回 master）
- 計數：自上次「---- 計數重設 ----」(2026-06-25) 起算，本項為第 75 個完成項目（75/100，未達上限）。
## 工作記錄（第七十二輪，2026-06-26）

- 工作內容：延續 play hooks UI 訊息 i18n 收尾，完成 `pages/play/usePromptAndSource.ts` 的 7 處硬編中文 UI 訊息（提示詞更新狀態、空來源驗證、文字/PDF 來源新增狀態與其 fallback 錯誤）。改用 `useI18n()`，新增 7 個 `play.promptSource.*` 對等鍵（zh-TW/en），`t` 加入各 `useCallback` 依賴。刻意保留送往後端/LLM 的內容預設值不翻譯。同時於 TODO 新增一個「持續」追蹤項，列出尚待 i18n 的 play hooks 與「內容預設值不可翻譯」的注意事項。typecheck 通過、i18n 對等測試 28 個全通過。純前端、低風險。
- 時間：2026-06-26
- 分支：`feat/prompt-source-i18n`（已 merge 回 master）
- 計數：自上次「---- 計數重設 ----」(2026-06-25) 起算，本項為第 76 個完成項目（76/100，未達上限）。
## 工作記錄（第七十三輪，2026-06-26）

- 工作內容：延續 play hooks UI 訊息 i18n 收尾，一次完成 4 個僅含純 UI 錯誤訊息的小型 hook：`useVersionHistory`（無法載入版本歷史／無法載入此版本逐字稿內容／還原失敗）、`useVideoGeneration`（產生影片失敗）、`usePageAsk`（問答失敗，請稍後再試）、`useScriptEditor`（逐字稿改寫失敗），共 6 處硬編中文。各 hook 引入 `useI18n()`，新增 6 個對等鍵（沿用既有 `play.versionHistory.*`、`play.sidebar.pageAsk.*`、`play.scriptRewrite.*` 命名空間，新增 `play.videoGen.*`），`t` 加入各 `useCallback` 依賴。確認 4 檔除註解外無其他遺漏 UI 字串。typecheck 通過、i18n 對等測試 28 個全通過。純前端、低風險。
- 時間：2026-06-26
- 分支：`feat/play-hooks-error-i18n`（已 merge 回 master）
- 計數：自上次「---- 計數重設 ----」(2026-06-25) 起算，本項為第 77 個完成項目（77/100，未達上限）。play hooks i18n 收尾尚餘 4 個含內容預設值的 hook。
## 工作記錄（第七十四輪，2026-06-26）

- 工作內容：延續 play hooks UI 訊息 i18n 收尾，處理含內容預設值的 `usePagePolls`。翻譯 8 處純 UI 訊息（讀取投票失敗、AI 草稿生成失敗、請輸入投票問題、至少需要兩個答案選項、建立投票失敗、投票失敗、清除投票結果失敗、刪除投票問題失敗），新增 8 個 `play.sidebar.poll.*` 對等鍵；`t` 加入各 `useCallback`/`useEffect` 依賴。**刻意保留** 2 處 `'同意\n不同意'` 內容預設值不翻譯——它是 textarea 預設投票選項，會成為實際投票內容送往後端並顯示給投票者，翻譯會改變行為。改後以 grep 確認檔內僅剩這 2 處中文。typecheck 通過、i18n 對等測試 28 個全通過。純前端、低風險。
- 時間：2026-06-26
- 分支：`feat/page-polls-i18n`（已 merge 回 master）
- 計數：自上次「---- 計數重設 ----」(2026-06-25) 起算，本項為第 78 個完成項目（78/100，未達上限）。play hooks i18n 收尾尚餘 3 個 hook。
## 工作記錄（第七十五輪，2026-06-26）

- 工作內容：延續 play hooks UI 訊息 i18n 收尾，完成 `useImageStyle`。翻譯 2 處 UI 訊息（儲存成功狀態「已儲存整份圖片風格設定，後續重生會自動套用」與 fallback 錯誤「儲存圖片風格設定失敗」），新增 2 個 `play.imageStyleDialog.saved`/`saveFailed` 對等鍵；`t` 加入 `handleSaveImageStyle` 的 `useCallback` 依賴。**刻意保留** line 42 的預設圖片風格提示詞（`簡潔商業風格…`）——它是 `deckImageStylePrompt` 的初始值、會經 `updatePdfImageStyleSettings` 送往後端作為實際生圖風格內容，翻譯會改變行為。改後 grep 確認檔內僅剩該 1 處內容預設中文。typecheck 通過、i18n 對等測試 28 個全通過。純前端、低風險。
- 時間：2026-06-26
- 分支：`feat/image-style-i18n`（已 merge 回 master）
- 計數：自上次「---- 計數重設 ----」(2026-06-25) 起算，本項為第 79 個完成項目（79/100，未達上限）。play hooks i18n 收尾尚餘 2 個 hook。
## 工作記錄（第七十六輪，2026-06-26）

- 工作內容：延續 play hooks UI 訊息 i18n 收尾，完成較大的 `useRegeneration`。翻譯 14 處 UI 訊息（輪詢進度錯誤、任務結束的完成/失敗/已停止狀態、選項驗證「請至少選擇一個重生項目」「圖檔提示詞不可為空」、任務啟動狀態、確認逐字稿失敗 alert、停止請求/失敗、還原 window.confirm 與還原成功/失敗），新增 13 個 `play.regenerate.msg.*` 對等鍵（「重生失敗」由 job failed fallback 與啟動 catch 兩處共用同一鍵）。`t` 加入相關 `useEffect`/`useCallback` 依賴。**刻意保留** 4 處內容預設值：line 80/83 的 `regenAllPrompt`/`regenScriptPrompt` 預設提示詞、line 256/257 組進 `startRegenerateJob` images.prompt 送往 LLM 的「整份圖片風格（固定套用）/本次圖片重生需求」標籤——翻譯會改變模型收到的 prompt 內容。改後 grep 確認檔內僅剩這 4 處內容中文。typecheck 通過、i18n 對等測試 28 個全通過。純前端、低風險。
- 時間：2026-06-26
- 分支：`feat/regeneration-i18n`（已 merge 回 master）
- 計數：自上次「---- 計數重設 ----」(2026-06-25) 起算，本項為第 80 個完成項目（80/100，未達上限）。play hooks i18n 收尾尚餘 1 個 hook（`useChatAndImageEdit`）。
## 工作記錄（第七十七輪，2026-06-26）

- 工作內容：完成 play hooks UI 訊息 i18n 收尾的最後一個 hook `useChatAndImageEdit`，整個系列（10 個 hook）就此收尾。本輪翻譯 6 處純 UI 錯誤訊息（讀取問答紀錄失敗、對話失敗、清除問答失敗、修改圖片失敗 inpaint/regenerate 兩處、套用圖片失敗），新增 5 個 `play.sidebar.qa.*` 對等鍵（兩處「修改圖片失敗」共用 `imageEditFailed`）。`t` 加入相關 `useEffect`/`useCallback` 依賴。**經最謹慎甄別後刻意保留 8 處內容字串**：line 192/270 為使用者未輸入時送往後端的預設 prompt；line 220/221/224/280 為對話串顯示訊息內容（嵌入 `【修改投影片圖片】`/`（標示區域）`/`（含參考圖）` 等標籤與使用者 prompt，且 chatHistory 由後端回填、非單純 UI chrome）；line 272/273 為組進 `regenerateSlideImage` 送往 LLM 的「整份圖片風格/單張調整需求」prompt——翻譯任一者都會改變送往後端或模型的內容。改後 grep 確認檔內僅剩這 8 處內容中文。typecheck 通過、i18n 對等測試 28 個全通過。純前端、低風險。
- 時間：2026-06-26
- 分支：`feat/chat-image-edit-i18n`（已 merge 回 master）
- 計數：自上次「---- 計數重設 ----」(2026-06-25) 起算，本項為第 81 個完成項目（81/100，未達上限）。play hooks UI 訊息 i18n 收尾系列（第七十一～七十七輪，10 個 hook）全部完成。
## 工作記錄（第七十八輪，2026-06-26）

- 工作內容：play hooks i18n 收尾後，掃描 `pages/play/*.tsx` 元件找殘留硬編中文，發現並完成 4 處 UI 錯誤訊息 i18n：`QualityCheckPanel` 的品質檢查失敗／AI 腳本分析失敗／AI 圖片分析失敗，與 `PlayPageSlidePanel` 的「改寫失敗，請重試。」。新增 4 個對等鍵（`play.quality.checkFailed`/`scriptAnalysisFailed`/`imageAnalysisFailed`、`play.slidePanel.aiRewriteFailed`）。**刻意保留** 送往 LLM 的 prompt 內容：`QualityCheckPanel` 的 `BATCH_FILL_PROMPT`（批次補全空白逐字稿提示）與 `PlayPageSlidePanel` 三個改寫風格 prompt（精簡/詳細/口語）。兩元件的錯誤處理器為元件內一般函式，`t` 已在 scope、無需動依賴。改後 grep 確認兩檔僅剩上述 prompt 內容中文。typecheck 通過、i18n 對等測試 28 個全通過。純前端、低風險。
- 時間：2026-06-26
- 分支：`feat/quality-rewrite-error-i18n`（已 merge 回 master）
- 計數：自上次「---- 計數重設 ----」(2026-06-25) 起算，本項為第 82 個完成項目（82/100，未達上限）。
## 工作記錄（第七十九輪，2026-06-26）

- 工作內容：掃描範圍擴到 `lib/`，發現 `lib/api/common.ts` 的 `ERROR_HINTS`／`mapApiErrorToHumanMessage` 硬編約 20 組中文錯誤提示（title/message/nextStep），於英文介面的上傳／匯入錯誤對話框與 credit 用盡對話框洩漏。將其完整 i18n：`ERROR_HINTS` 改為 `apiError.*` 翻譯鍵三元組（以 `hintKeys()` 工具產生）、`mapApiErrorToHumanMessage` 改簽章為 `(err, t)` 接受 translator；zh-TW/en 各新增 66 個 `apiError.*` 鍵。兩呼叫端元件 `UploadButton`、`ImportTextPage` 傳入 `t`。另處理 fetch 層的 `notifyCreditExhausted`（無 React context）：改為事件只帶 `code/status`，由具 i18n context 的 `CreditExhaustedDialog` 以 mapper 推導人類可讀文字，使其跟隨介面語言（同步調整 `CreditExhaustedEventDetail` 型別）。更新 `api.error-mapping.test.ts` 以 `(k)=>zhTW[k]` 解析鍵、既有中文斷言不變。typecheck 通過、前端全測試 325 個全通過。純前端、低風險（行為等價，僅文字來源由硬編改為翻譯鍵）。
- 時間：2026-06-26
- 分支：`feat/api-error-hints-i18n`（已 merge 回 master）
- 計數：自上次「---- 計數重設 ----」(2026-06-25) 起算，本項為第 83 個完成項目（83/100，未達上限）。
## 工作記錄（第八十輪，2026-06-26）

- 工作內容：前端 i18n 洩漏掃描已收尾（剩餘皆為註解或送往 LLM 的內容），轉而排查前後端「鏡像常數」drift。發現真實 bug：前端 `animationSpec.ts` 的 `ANIMATION_SHAPE_KINDS` 只有 4 種形狀，但前端型別、`SlideRenderer` 繪製邏輯、8 個 shapeKind i18n 標籤與後端 `ANIMATION_SHAPE_KINDS` 都支援 8 種；由於 `AnimationEditorTab` 形狀下拉用此常數產生選項，使用者無法選 line/triangle/star/hexagon。修復：補回完整 8 種（順序對齊後端）。同時新增後端 drift-guard 測試（仿第六十八輪 LLM 價格表 guard 手法，以 fs 讀前端原始碼比對 effect types/eases/shape kinds 三組鏡像），防止再次 drift。前端 typecheck + animationSpec 測試 58 個通過、後端新測試 4 個通過。低風險（補資料 + 純測試）。
- 時間：2026-06-26
- 分支：`fix/animation-shape-kinds-drift`（已 merge 回 master）
- 計數：自上次「---- 計數重設 ----」(2026-06-25) 起算，本項為第 84 個完成項目（84/100，未達上限）。
## 工作記錄（第八十一輪，2026-06-26）

- 工作內容：延續「前後端鏡像 drift」排查。逐一核對既有鏡像點：quiz 計分（`explicitScoreSum`/`normalizeQuestionScores`/`calcQuestionScore`，前後端）與 `QUIZ_TOTAL_SCORE=100` 皆一致、`splitScriptIntoSentences` 三份複本也一致——均無 bug。但發現 `splitScriptIntoSentences` 有三份「需完全一致」複本（前端 `subtitles.ts`、後端 `textSentences.ts`、後端 `subtitleAlignment.ts`，含後端內部重複），各自只有獨立行為測試、缺少交叉一致性 guard，drift 會悄悄使字幕／動畫去同步。新增 guard 測試 `subtitleSplitConsistency.test.ts`：①跑兩個後端複本對一批代表性 script 斷言輸出相同；②從三份原始碼抽取 `SENTENCE_MATCH_RE`/`TONE_MARKER_RE` 兩個 regex 字面值斷言完全相同。後端 typecheck 與新測試 2 個通過。純測試、低風險。
- 時間：2026-06-26
- 分支：`test/subtitle-split-consistency`（已 merge 回 master）
- 計數：自上次「---- 計數重設 ----」(2026-06-25) 起算，本項為第 85 個完成項目（85/100，未達上限）。
## 工作記錄（第八十二輪，2026-06-26）

- 工作內容：延續前後端鏡像 drift 排查。核對 LLM/TTS provider 清單（前端 `LlmProvider`/`TtsProvider` 型別、SettingsPage 下拉選項、後端 `config.ts`/`shared.ts` 的 `z.enum`）與動畫 6 個子屬性 enum——皆一致無 bug。為動畫子屬性 enum 補上 drift-guard：將第八十輪的 `animationConstantsConsistency.test.ts` 擴充 6 個欄位測試，以 `fs` 解析前端 `types.ts` union 與後端 `pageAnimation.ts` `z.enum` 成員逐一比對（`pointerShape`/`highlightBorderStyle`/`textCalloutAlign`/`textCalloutPadding`/`spotlightShape`/`stepListBulletStyle`），這正是 shape kinds 當初 drift 的同類風險。後端 typecheck 與該檔 10 個測試全通過。純測試、低風險。
- 時間：2026-06-26
- 分支：`test/animation-enum-fields-guard`（已 merge 回 master）
- 計數：自上次「---- 計數重設 ----」(2026-06-25) 起算，本項為第 86 個完成項目（86/100，未達上限）。
## 工作記錄（第八十三輪，2026-06-26）

- 工作內容：延續「UI 清單完整性」排查。先驗證動畫編輯器：效果型別下拉由 `SLIDE_ANIMATION_EFFECT_TYPES`（全 18 種）產生、形狀下拉由 `ANIMATION_SHAPE_KINDS`（修復後 8 種）產生，故所有型別/形狀皆可達；18 種 effect type 的 `play.animation.type.*` i18n 鍵也都齊全——無 bug。發現一個防護缺口：drift-guard 確保前端陣列↔後端 enum 一致，但無測試確保每個陣列成員「也有 i18n 標籤」，未來新增成員若漏補鍵會顯示原始 key。於 `i18n.test.ts` 新增兩個由陣列推導必需鍵的完整性測試（effect types、shape kinds），自動涵蓋未來新增成員。前端 typecheck 與 i18n 測試通過。純測試、低風險。
- 時間：2026-06-26
- 分支：`test/animation-i18n-label-completeness`（已 merge 回 master）
- 計數：自上次「---- 計數重設 ----」(2026-06-25) 起算，本項為第 87 個完成項目（87/100，未達上限）。
## 工作記錄（第八十四輪，2026-06-26）

- 工作內容：延續「動態 i18n key 插值缺鍵」bug 類別的系統性收尾。盤點全前端 `t(\`prefix.${var}\`)` 插值點共 4 處：動畫型別/形狀（第八十三輪已加完整性測試）、字幕大小、字幕位置。後兩者以 `as TranslationKey` 強制轉型插值、繞過型別檢查，是僅存的執行期 footgun。將 `PlayPageSlidePanel` 的字幕大小／位置標籤改為 `as const satisfies Record<SubtitleSize/SubtitlePosition, TranslationKey>` 的 map（沿用既有 `EASE_LABELS` 手法），使漏補標籤變成編譯錯誤。另確認 `*_LABEL_KEYS`（`Record<EnumType,...>` 編譯保證）與 ease（已 satisfies）皆安全。至此所有動態 i18n 標籤映射不是編譯期安全、就是有完整性測試守護。純重構、零行為變更；前端 typecheck 與全測試 327 個通過。
- 時間：2026-06-26
- 分支：`refactor/subtitle-label-compile-safe`（已 merge 回 master）
- 計數：自上次「---- 計數重設 ----」(2026-06-25) 起算，本項為第 88 個完成項目（88/100，未達上限）。
## 工作記錄（第八十五輪，2026-06-26）

- 工作內容：審查核心純函式（`watchProgress.ts` 觀看完成判定、`costEstimate.ts` 成本估算）——邏輯正確且測試完整，無 bug。但在 `costEstimate.ts` 發現第八十四輪 grep 漏網的一處動態 i18n 插值：`PromptModal` 的成本分級標籤以 `t(\`...tier${首字母大寫(tier.name)}\` as TranslationKey)` 渲染（key 由字串拼接、未被上輪的 `prefix.${var}` 樣式命中）。改用 `as const satisfies Record<CostTier['name'], {label,desc}>` 的 `COST_TIER_LABEL_KEYS`，使漏標籤變編譯錯誤；並修正 `CostTier` 指向不存在 key 的過時註解。6 個 tier 鍵皆存在、無執行期 bug。純重構＋文件修正、無行為變更；前端 typecheck 與全測試 327 個通過。至此前端動態 i18n 標籤映射全數為編譯期安全或有測試守護。
- 時間：2026-06-26
- 分支：`refactor/cost-tier-labels-compile-safe`（已 merge 回 master）
- 計數：自上次「---- 計數重設 ----」(2026-06-25) 起算，本項為第 89 個完成項目（89/100，未達上限）。
## 工作記錄（第八十六輪，2026-06-26）

- 工作內容：審查後端狀態機 `statusMachine.ts`（轉移表 `satisfies Record` 編譯安全、有測試，無 bug），並追查其 `PROGRESS_STEPS`/`PDF_STATUSES` 在前端的呈現。發現使用者可見的 i18n 漏洞：`PlayPage` 兩處「產生中…」橫幅以 `${detail.status} / ${detail.progress_step}` 直接插入後端原始 enum，導致中英文使用者都看到 `processing / rendering_video` 等未翻譯字串（`StatusBadge` 已正確翻譯，橫幅卻沒有）。修復：抽出共用 `lib/statusLabels.ts`（單一真實來源＋編譯期完整 Record＋純函式 `formatGeneratingStatusLabel`），`StatusBadge` 改用共用模組並移除重複定義，兩處橫幅改用 helper；新增 `statusLabels.test.ts` 3 測試（含防原始 enum 洩漏斷言）。前端 typecheck 與全測試 330 個通過。低風險（StatusBadge 行為等價、僅修橫幅文字）。
- 時間：2026-06-26
- 分支：`fix/generating-banner-i18n`（已 merge 回 master）
- 計數：自上次「---- 計數重設 ----」(2026-06-25) 起算，本項為第 90 個完成項目（90/100，未達上限）。
## 工作記錄（第八十七輪，2026-06-26）

- 工作內容：審查後端 SLA 計時邏輯（`evaluateSla` 邊界完整測試、`setSlaTargetOverride` bounds 驗證嚴謹、SLA bounds 由後端 `SLA_TARGET_BOUNDS_MS` 經 API 提供給前端＝單一真實來源無 drift）——皆健全。發現前端純函式 `validateSlaOverrideSecondsInput` 一處潛在缺口：`bounds` 為選用參數，未傳時 `0`/負數秒會被核可為 `ok:true, targetMs<=0`（非正 SLA 目標本不該放行）。加上 `seconds <= 0` 防護使契約獨立於 bounds 成立，並補 3 個測試。實務上 `SettingsPage` 一律傳入後端 bounds，故無使用者面回歸；此為防禦性正確性強化。前端 typecheck 與全測試 331 個通過。純前端、低風險。
- 時間：2026-06-26
- 分支：`fix/sla-validation-nonpositive`（已 merge 回 master）
- 計數：自上次「---- 計數重設 ----」(2026-06-25) 起算，本項為第 91 個完成項目（91/100，未達上限）。
## 工作記錄（第八十八輪，2026-06-26）

- 工作內容：審查純函式 `buildSentenceTimeline`（字幕時間軸估算）——縮放與邊界處理正確、健全，無 bug。延續第八十六輪發現，為前後端狀態 enum 鏡像補 drift-guard：前端 `PdfStatus`/`PageStatus`/`ProgressStep` union 鏡像後端 `statusMachine.ts` 三個陣列（驅動狀態徽章／橫幅／步驟標籤），原無守護。確認三組值集一致後，新增後端測試 `statusEnumConsistency.test.ts`，以 fs 解析前端 union 與後端陣列比對排序值集（忽略順序、ProgressStep 排除 null）。後端 typecheck 與新測試 4 個通過。純測試、低風險。
- 時間：2026-06-26
- 分支：`test/status-enum-mirror-guard`（已 merge 回 master）
- 計數：自上次「---- 計數重設 ----」(2026-06-25) 起算，本項為第 92 個完成項目（92/100，未達上限）。
## 工作記錄（第八十九輪，2026-06-26）

- 工作內容：延續前後端鏡像 drift 排查，鎖定 `ttsVoices.ts` 註解明示需與後端同步的語音清單。前端 `GEMINI_TTS_VOICES`（22）／`OPENAI_TTS_VOICES`（11）鏡像後端 `GEMINI_VOICES`（gemini.ts Set）／`OPENAI_TTS_VOICES`（config.ts），跨 package 無守護；drift 會讓選擇器列出後端會 coerce 成 fallback 的語音。確認兩組值集一致後，新增後端測試 `ttsVoiceConsistency.test.ts`（fs 解析前端兩清單與後端 GEMINI_VOICES、import 後端 OPENAI_TTS_VOICES，比對排序值集，忽略順序）。後端 typecheck 與新測試 3 個通過。純測試、低風險。
- 時間：2026-06-26
- 分支：`test/tts-voice-mirror-guard`（已 merge 回 master）
- 計數：自上次「---- 計數重設 ----」(2026-06-25) 起算，本項為第 93 個完成項目（93/100，未達上限）。
## 工作記錄（第九十輪，2026-06-26）

- 工作內容：審查 QuizBuilderPage 計分邏輯（並核對 a11y：所有 `<img>` 皆已有 alt、`formatUsd` 正確）。發現前端分數溢出檢查 `sum > 100`（嚴格）與後端 cap `sum > 100 + 1e-6`（含 epsilon 容差）不一致——前端可能對浮點誤差落在 (100, 100+1e-6] 的總和判定溢出並擋下儲存，後端卻接受（與「mirrors backend」註解本意不符；實測一般輸入難觸發，定位為一致性對齊）。將原本私有且無測試的計分 helper 抽出至 `lib/quizScoring.ts` 並新增套用相同 epsilon 的 `scoreSumExceedingTotal`，QuizBuilderPage 改用之；補 `quizScoring.test.ts` 4 測試（含 epsilon 邊界）。前端 typecheck 與全測試 335 個通過。純前端、低風險。
- 時間：2026-06-26
- 分支：`fix/quiz-score-overflow-epsilon`（已 merge 回 master）
- 計數：自上次「---- 計數重設 ----」(2026-06-25) 起算，本項為第 94 個完成項目（94/100，未達上限）。
## 工作記錄（第九十一輪，2026-06-26）

- 工作內容：延續第九十輪，將 `QuizBuilderPage` 剩餘 3 個私有且無測試的純評分函式（`normalizeQuestionScores`、`isCorrectAnswer`、`calcQuestionScore`，鏡像後端評分、用於 11 處 client-side 分數顯示）併入 `lib/quizScoring.ts`，QuizBuilderPage 改 import（行為不變、移除已不再使用的 `QUIZ_TOTAL_SCORE` import）。補 `quizScoring.test.ts` 4 個測試涵蓋平分分配、答案集合比對、單選/多選給分。至此 quiz 計分邏輯有單一可測之家。前端 typecheck 與全測試 339 個通過。純重構＋測試、低風險。
- 時間：2026-06-26
- 分支：`refactor/quiz-scoring-extract-test`（已 merge 回 master）
- 計數：自上次「---- 計數重設 ----」(2026-06-25) 起算，本項為第 95 個完成項目（95/100，未達上限）。
## 工作記錄（第九十二輪，2026-06-26）

- 工作內容：審查安全相關的 `logSanitizer.ts`（日誌脫敏）。發現一處真實洩漏面：本專案有 GitHub 整合（`presentationGit` 以 `https://x-access-token:<token>@github.com` remote 推送、`aiSettings` 支援 `GITHUB_TOKEN`），但脫敏的金鑰值樣式只認 `sk*`/`AIza`，未涵蓋 GitHub token；若 git 錯誤把含 token 的 remote URL 寫進日誌，PAT 會外洩。新增 `URL_CREDENTIALS_PATTERN`（遮蔽任意 URL 的 `user:secret@`、保留 scheme/host）與 `GITHUB_TOKEN_PATTERN`（`gh*_`／`github_pat_`），並補測試確認無憑證 URL 與 host:port 不被誤遮蔽。後端 typecheck 與 sanitizer 測試 18 個通過。安全強化、低風險（僅增加遮蔽範圍）。
- 時間：2026-06-26
- 分支：`fix/log-sanitizer-git-credentials`（已 merge 回 master）
- 計數：自上次「---- 計數重設 ----」(2026-06-25) 起算，本項為第 96 個完成項目（96/100，未達上限）。
## 工作記錄（第九十三輪，2026-06-26）

- 工作內容：延續第九十二輪追查 GitHub token 流向，發現比日誌更嚴重的真實洩漏：`pushPresentationToGitHub` 以 `git push https://x-access-token:<token>@github.com…` 推送，`execFile` 失敗時 Error.message 含完整指令（含 token），admin 同步路由 `admin.ts` 直接把該 message 經 `errorResponse('GITHUB_SYNC_FAILED', message)` 回傳給 client，導致 token 從 HTTP 回應外洩（上輪只脫敏了日誌、未涵蓋回應）。先確認 `pullAndMergeFromGitHub` 的 fetch 錯誤已被吞掉、且 token 僅作為 git 指令參數傳入（不寫入 .git/config，無 token at rest）。於來源頭修復：`logSanitizer` 匯出 `redactSecretsInText()`（重構自既有脫敏鏈、無截斷），`presentationGit` push 失敗時 scrub Error.message 再 rethrow，使 token 不離開模組。新增 command-failed 訊息形狀測試。註：presentationGit 測試需 better-sqlite3，sandbox 無法載入（既有限制，已確認 master 同樣失敗），以 typecheck 與 sanitizer 測試 17 個驗證。
- 時間：2026-06-26
- 分支：`fix/git-push-error-token-leak`（已 merge 回 master）
- 計數：自上次「---- 計數重設 ----」(2026-06-25) 起算，本項為第 97 個完成項目（97/100，未達上限）。
## 工作記錄（第九十四輪，2026-06-26）

- 工作內容：延續 GitHub token 安全審查並補測試。核對多處皆健全（無 bug）：①admin 設定回應回傳明文 API key/`github_token` 屬「帳號擁有者預填自己設定」的設計，MCP token 用 write-only 布林為刻意取捨；②git 指令路徑參數皆有 `--`、ref 內部產生，無 argument injection；③token 僅作 git 參數、不寫入 `.git/config`（無 token at rest）；④`formatTime` 僅用於頁內語音播放（不會超過一小時）。為 exported 但無測試的純函式 `buildAuthenticatedRepoUrl` 補上測試（僅 http(s) 嵌 token、SSH 不嵌、空 token 原樣、格式錯誤不丟例外、特殊字元 percent-encode）。預期輸出以 node 重實作驗證；測試因連帶載入 better-sqlite3 於 sandbox 無法執行（既有限制），CI 執行、本機 typecheck 驗證。
- 時間：2026-06-26
- 分支：`test/auth-repo-url`（已 merge 回 master）
- 計數：自上次「---- 計數重設 ----」(2026-06-25) 起算，本項為第 98 個完成項目（98/100，未達上限）。
## 工作記錄（第九十五輪，2026-06-26）

- 工作內容：審查全域錯誤處理與日誌脫敏接線。確認 server.ts 的 `setErrorHandler` 對 production 的 500 錯誤已回傳泛用訊息（不洩漏內部）。但發現 `logSanitizer` 是「各呼叫端手動套用」而非 pino 全域 serializer——`admin.ts` 的 `app.log.warn({ err })` 會記錄原始 error。第九十三輪只脫敏 `err.message`，但 `execFile` 失敗的 error 還帶 `cmd`（原始 argv 含 token）與 `stdout/stderr`，pino 會序列化它們→token 仍經 `err.cmd` 洩漏到日誌。新增 `redactGitExecError()` 對 message+cmd+stdout+stderr 全脫敏再 rethrow。以 node 重實作驗證三屬性 token 皆被遮蔽；`redactSecretsInText` 單元由 logSanitizer 測試 17 個涵蓋；後端 typecheck 通過。安全修復、低風險。
- 時間：2026-06-26
- 分支：`fix/git-error-cmd-token-leak`（已 merge 回 master）
- 計數：自上次「---- 計數重設 ----」(2026-06-25) 起算，本項為第 99 個完成項目（99/100，未達上限；下一個完成即達 100 上限）。
## 工作記錄（第九十六輪，2026-06-26）—— 已達 100/100 計數上限

- 工作內容：完成自上次計數重設（2026-06-25）以來的**第 100 個項目**。本項延續安全審查，將全域錯誤處理器的 production 原始訊息隱藏條件由「僅 status === 500」擴大為「所有 status >= 500」，使 502/503/504 等未捕捉錯誤也不再把可能含內部資訊/憑證的原始訊息回傳給 client，並一致標為 `INTERNAL_ERROR`；4xx 維持回傳自身訊息。新增 502 測試，既有 500/dev/400 案例不變。後端 typecheck 通過（handler 測試需 better-sqlite3，於 CI 執行）。
- 時間：2026-06-26
- 分支：`fix/error-handler-redact-all-5xx`（已 merge 回 master）
- **計數：自上次「---- 計數重設 ----」(2026-06-25) 起算，本項為第 100 個完成項目（100/100，已達 LOOP.md 門檻）。**

### ⛔ 已達 100 項上限 —— 暫停執行新項目

依 LOOP.md「完成 100 個項目後就停止做新的項目」，自本輪起**停止新增/執行新項目**，等待使用者決定：
1. 重設計數（在 TODO.md 末尾加入新的「---- 計數重設 ----」標記後可重新起算）；或
2. 調整門檻（例如提高至 150）；或
3. 結束本輪自動改善。

這一批（第 33～96 輪、共 100 項）主要成果：完整的前端 i18n 收尾（play hooks／元件硬編中文、API 錯誤提示、動畫/字幕/狀態標籤）、動態 i18n key 編譯期安全化、多組前後端鏡像 drift-guard（LLM 價格、動畫常數與子屬性 enum、字幕分句、狀態 enum、TTS 語音）、quiz 計分邏輯抽出與測試，以及一連串 GitHub token 洩漏的安全修復（日誌脫敏、API 回應、git 錯誤 cmd/stderr、全域 5xx 訊息）。

---- 計數重設 ----

<!-- 第九十七輪起點（2026-06-26）：經使用者同意重設計數，自此重新從 0 起算，繼續執行新項目。 -->

## 掃描摘要（第九十七輪，2026-06-26）

- 計數已於本輪重設；前一批（第 33～96 輪）共完成 100 項，使用者同意重新起算。
- 播放控制列的 `−剩餘時間` 直接加總各頁音訊內容秒數，未隨 `playbackRate` 換算；非 1× 倍速時顯示偏高，與實際播完所需牆鐘時間不符。

## 新增可執行項目（第九十七輪）

- [x] 剩餘播放時間隨速度校正：播放控制列的 `−剩餘時間` 改為依目前 `playbackRate` 換算實際牆鐘時間。新增純函式 `adjustRemainingForSpeed(seconds, rate)` 至 `formatters.ts`（除以倍速，含 ≤0/NaN 速率與非正秒數的安全 fallback），`PlayPageSlidePanel` 顯示處套用；`playbackRate !== 1` 時 tooltip 改用新 i18n `play.header.timeRemainingAtSpeed`（含 `{rate}` 佔位）。
  - 修改說明（2026-06-26）：`formatters.ts` 新增 `adjustRemainingForSpeed`；`formatters.test.ts` 補 2 個 node:test（倍速換算、邊界保護）；`PlayPageSlidePanel.tsx` import 並於剩餘時間 span 套用換算與條件 tooltip；zh-TW/en 各新增 `play.header.timeRemainingAtSpeed`。前端 341 測試 + typecheck 全通過。分支 `feat/remaining-time-speed-adjusted`，已 merge 回 master。
  - 計數：自上次「---- 計數重設 ----」(2026-06-26) 起算，本項為第 1 個完成項目（1/100，未達上限）。

- [x] 首頁新增「標題 Z-A」排序：排序下拉只有「標題 A-Z」升冪，補上對應降冪選項。`SortMode`/`SORT_MODES` 加入 `'title_desc'`，新增 `compareByTitleDesc`（反轉既有 `compareByTitle`），`getComparatorForSortMode` 加 case 並 export 供測試；下拉新增 option；i18n `home.sort.titleDesc`。
  - 修改說明（2026-06-26）：`HomePage.tsx` 加入 `title_desc` 排序模式（`compareByTitleDesc = compareByTitle(b, a)`，沿用 localeCompare/numeric/id fallback），export `getComparatorForSortMode`；排序下拉於 titleAsc 後插入 titleDesc option；zh-TW/en 各新增 `home.sort.titleDesc`；`HomePage.sort.test.ts` +2 測試（反向結果、id fallback）。前端 343 測試 + typecheck 全通過。分支 `feat/home-sort-title-desc`，已 merge 回 master。
  - 計數：自上次「---- 計數重設 ----」(2026-06-26) 起算，本項為第 2 個完成項目（2/100，未達上限）。

- [x] 播放時間顯示支援小時：`formatTime` 先前一律 `MM:SS`，剩餘時間超過 1 小時時顯示成 `75:30` 等難讀格式。改為 `h > 0` 時回傳 `H:MM:SS`，未滿 1 小時維持 `MM:SS`；無效輸入仍回 `00:00`。
  - 修改說明（2026-06-26）：`formatters.ts` 的 `formatTime` 加入小時計算，`h > 0` 時回傳 `H:MM:SS`（分秒補零、時不補零）；三處顯示（目前/總長/速度校正剩餘）一致受惠。`formatters.test.ts` 新增 2 個測試涵蓋臨界值與無效輸入（此函式先前無測試）。前端 345 測試 + typecheck 全通過。分支 `feat/format-time-hours`，已 merge 回 master。
  - 計數：自上次「---- 計數重設 ----」(2026-06-26) 起算，本項為第 3 個完成項目（3/100，未達上限）。

- [x] Token 數顯示百萬進位修正：`formatTokenCount` 對 999_950 以上的值會因 `(tokens / 1_000).toFixed(1)` 四捨五入成 `1000.0K`（K 位數溢位、難讀），改為該範圍直接以百萬單位顯示 `1.00M`；並新增非有限值（NaN/Infinity）守門回傳 `'0'`。此函式用於 `PlayPageSlidePanel` 的 LLM token 用量顯示。
  - 修改說明（2026-06-26）：`formatters.ts` 的 `formatTokenCount` 加入 `Number.isFinite` 守門與 `abs >= 999_950 → 百萬單位` 的進位判斷（K 與 M 邊界無縫銜接：999_949 仍為 `999.9K`）。`formatters.test.ts` 新增 3 個測試涵蓋一般格式、進位邊界與非有限輸入（此函式先前無測試）。前端 348 測試 + typecheck 全通過。分支 `feat/token-count-rollover`，已 merge 回 master。
  - 計數：自上次「---- 計數重設 ----」(2026-06-26) 起算，本項為第 4 個完成項目（4/100，未達上限）。

- [x] 成本顯示守門非有限值與負值：`formatCostUsd` 先前對 `NaN`/`Infinity` 會輸出 `$NaN`，且負成本因 `cost < 0.01` 落入微額分支誤顯示成 `<$0.01`。改為非有限值回傳 `unknownLabel`；負值改以絕對值格式化並補回負號（`-$1.23`／`-<$0.01`）。此函式用於 `PlayPageSlidePanel` 的 LLM 成本顯示。
  - 修改說明（2026-06-26）：`formatters.ts` 的 `formatCostUsd` 加入 `Number.isFinite` 守門，並以 `Math.abs(cost)` + sign 處理負值微額判斷與格式化；`formatters.test.ts` 新增 2 個測試（非有限輸入回 unknown label、負值不誤判微額）。前端 350 測試 + typecheck 全通過。分支 `fix/format-cost-guard`，已 merge 回 master。
  - 計數：自上次「---- 計數重設 ----」(2026-06-26) 起算，本項為第 5 個完成項目（5/100，未達上限）。

- [x] 觀看進度百分比夾在 0-100：側邊欄縮圖徽章的完成率 `calculateWatchProgressPercent` 在資料異常（`completed_viewers > total_viewers`）時會回傳 >100；tooltip 的平均聆聽率先前在 `PlayPageSidebar` 內聯計算（`Math.round(avg_listened_ratio * 100)`），使用者倒退重聽使比例 > 1 時會顯示「130%」。新增共用 `clampPercent` 將兩者夾在 0-100，並把平均聆聽率抽成可測純函式 `calculateAvgListenedPercent`。
  - 修改說明（2026-06-26）：`watchProgress.ts` 新增私有 `clampPercent`（非有限值回 null、夾 0-100）；`calculateWatchProgressPercent` 改用之；新增 export `calculateAvgListenedPercent(ratio)`。`PlayPageSidebar.tsx` 改呼叫新函式取代內聯計算。`watchProgress.test.ts` +3 測試（完成率夾頂、平均聆聽率 null/一般/倒退重聽夾頂）。前端 353 測試 + typecheck 全通過。分支 `fix/watch-progress-percent-clamp`，已 merge 回 master。
  - 計數：自上次「---- 計數重設 ----」(2026-06-26) 起算，本項為第 6 個完成項目（6/100，未達上限）。

- [x] 複習清單只刪指定題目：複習清單（review list）的 `addReviewItems` 以 `pdfId+pageNumber+questionText` 去重，同一頁可加入多題；但 `removeReviewItem` 只比對 `pdfId+pageNumber`，導致在側邊欄點某一題的「×」會把該頁所有題目一起刪除。為 `removeReviewItem` 加上選用的 `questionText` 參數（指定時只刪該題，省略時維持整頁刪除以向後相容），`PlayPageSidebar` 的移除 handler 改傳入 `questionText` 並同步只過濾該題的本地 state。
  - 修改說明（2026-06-26）：`reviewList.ts` 的 `removeReviewItem(pdfId, pageNumber, questionText?)` 改以「同頁且（未指定 questionText 或題目相符）才移除」的條件過濾；`PlayPageSidebar.tsx` 的 `handleRemove(pageNumber, questionText)` 傳入題目並修正本地 state 過濾條件，按鈕 onClick 傳 `item.questionText`。`reviewList.test.ts` +1 測試（同頁多題只刪指定題、保留其餘）。前端 354 測試 + typecheck 全通過。分支 `fix/review-item-remove-by-question`，已 merge 回 master。
  - 計數：自上次「---- 計數重設 ----」(2026-06-26) 起算，本項為第 7 個完成項目（7/100，未達上限）。

- [x] 首頁新增「頁數少到多」排序：排序下拉的頁數只有「頁數多到少」(`page_count_desc`)，缺少升冪選項，與音訊長度有雙向（最長/最短）不對稱。補上 `page_count_asc`，方便使用者找頁數少的短簡報。`SortMode`/`SORT_MODES` 加入 `page_count_asc`，新增 `compareByPageCountAsc`（缺頁數以 `Infinity` 排到最後，與 `audio_asc` 的 null 處理一致），`getComparatorForSortMode` 加 case；下拉新增 option；i18n `home.sort.pageCountAsc`。
  - 修改說明（2026-06-26）：`HomePage.tsx` 加入 `page_count_asc` 排序模式；排序下拉於 pageCountDesc 後插入 pageCountAsc option；zh-TW/en 各新增 `home.sort.pageCountAsc`（「頁數少到多」／「Fewest pages」）；`HomePage.sort.test.ts` +2 測試（升冪含缺頁數排尾、與降冪互為反向）。前端 356 測試 + typecheck（含 i18n key 對齊）全通過。分支 `feat/home-sort-page-count-asc`，已 merge 回 master。
  - 計數：自上次「---- 計數重設 ----」(2026-06-26) 起算，本項為第 8 個完成項目（8/100，未達上限）。

- [x] 後端字幕分句去重：`splitScriptIntoSentences` 在後端**同一套件**內有兩份 byte 相同的副本（`textSentences.ts` 與 `subtitleAlignment.ts`，連同 sentence/tone 兩個 regex），註解要求彼此「mirror exactly」——屬套件內 drift 風險。讓 `subtitleAlignment.ts` 改 re-export `textSentences.ts` 的實作，後端所有呼叫端共用單一來源；前端副本因跨套件維持獨立。原 `subtitleSplitConsistency.test.ts` 同步調整：以函式 identity 斷言兩個後端入口為同一份、regex 比對改守護真正重要的「前端 ↔ 後端」一致性。
  - 修改說明（2026-06-26）：`subtitleAlignment.ts` 移除本地 `SENTENCE_MATCH_RE`/`TONE_MARKER_RE`/`splitScriptIntoSentences`，改為 `export { splitScriptIntoSentences } from './textSentences'`（其餘 `alignSentencesToWordTimestamps` 等不變）。`subtitleSplitConsistency.test.ts` 第一個測試改斷言 `splitTextSentences === splitSubtitleAlignment`；regex 測試移除已不存在的 subtitleAlignment 字面量檢查、保留 frontend↔textSentences 比對。相關後端測試（subtitleSplitConsistency／subtitleAlignment／subtitle-alignment／textSentences）與後端 `tsc` build 全通過。分支 `refactor/dedupe-backend-split-sentences`，已 merge 回 master。
  - 計數：自上次「---- 計數重設 ----」(2026-06-26) 起算，本項為第 9 個完成項目（9/100，未達上限）。

- [x] 播放頁下拉選單支援 Esc／點外部關閉：`PlayPageHeader` 的 `HeaderDropdown` 以受控 `<details>` 實作，原本只有「開啟另一個選單」才會互斥關閉——點頁面其他空白處或按 Escape 都不會關閉，與其 commit 自稱的「accessible dropdown」不符。新增 `useEffect`（僅在 open 時掛載）監聽 Escape 與選單外部 pointer-down 關閉；決策邏輯抽成純函式 `shouldCloseOnOutsidePointer`／`isDropdownDismissKey` 以利單元測試（沿用本專案從元件抽純函式測試的慣例，避免測試載入 context-heavy 元件）。
  - 修改說明（2026-06-26）：新增 `frontend/src/pages/play/headerDropdownDismiss.ts`（兩個純決策函式）；`PlayPageHeader.tsx` 的 `HeaderDropdown` 加 `rootRef` 與 `useEffect`（`document` mousedown + `window` keydown，含 cleanup），`<details>` 掛上 ref。新增 `headerDropdownDismiss.test.ts` +2 測試（外部/內部 pointer 與 open 狀態組合、只認 Escape）。前端 358 測試 + typecheck 全通過。分支 `feat/header-dropdown-dismiss`，已 merge 回 master。
  - 計數：自上次「---- 計數重設 ----」(2026-06-26) 起算，本項為第 10 個完成項目（10/100，未達上限）。

- [x] 全域搜尋忽略過時回應（async race）：`GlobalSearchBox` 邊打邊搜（debounced，每次按鍵發一次請求）但會套用「任何先回來的」回應——較早送出的較慢請求（"ab"）若比後送的（"abc"）晚回，會用過時結果覆蓋使用者實際輸入的最新結果。debounce 只能緩解、無法消除此 race。改以單調遞增的 request id 守門，回應非最新時直接捨棄（searching spinner 重設也一併 gate）。
  - 修改說明（2026-06-26）：`GlobalSearchBox.tsx` 新增 `requestSeqRef`，`doSearch` 取 `seq = ++requestSeqRef.current`，await 後僅在 `seq === requestSeqRef.current` 時 `setResults`／清除 searching；空查詢分支則 `+= 1` 使在途回應失效。同時把原本未測試的純函式 `highlightText` export 並新增 `GlobalSearchBox.test.ts` +5 測試（空查詢、單一/多個大小寫不敏感匹配、保留原大小寫且 trim 查詢、無匹配）。前端 363 測試 + typecheck 全通過。分支 `fix/global-search-race`，已 merge 回 master。
  - 計數：自上次「---- 計數重設 ----」(2026-06-26) 起算，本項為第 11 個完成項目（11/100，未達上限）。

- [x] CSV 匯出去重並強化（防 formula injection）：`poll-results-csv.ts` 與 `quiz-results-csv.ts` 各自有一份 byte 相同的 `csvEscape`（重複）。抽成共用 `routes/pdfs/csv.ts` 並強化：① 對使用者輸入的 string，若以公式起始字元（`=`/`+`/`-`/`@`/Tab/CR）開頭，前綴單引號 `'` 以瓦解 Excel/Sheets 的 CSV formula injection（投票題目、選項文字、測驗標題等皆為使用者可控）；② 補上單獨 CR 也觸發引用（RFC 4180）；③ 數字維持原樣，避免合法負數被誤前綴。
  - 修改說明（2026-06-26）：新增 `backend/src/routes/pdfs/csv.ts` 匯出強化版 `csvEscape`；兩個 CSV 路由改 `import { csvEscape } from './csv'` 並移除本地副本（`sessionSub`/`canEditPdf` 維持各自，因非完全共用範疇）。新增 `backend/test/csvEscape.test.ts` +6 純函式測試（一般/數字、null、引用與雙引號、單獨 CR、四種 formula 起始字元含與逗號併用、負數不被前綴），sandbox 執行通過；後端 `tsc` build 通過。兩個 CSV 整合測試因 sandbox better-sqlite3 ABI 不符（NODE_MODULE_VERSION 127 vs 147）無法本機執行、留待 CI；經分析（數字不變、測試資料無危險字元開頭、header 不經 escape）確認不破壞。分支 `feat/csv-escape-shared-hardened`，已 merge 回 master。
  - 計數：自上次「---- 計數重設 ----」(2026-06-26) 起算，本項為第 12 個完成項目（12/100，未達上限）。

- [x] 分享對話框支援 Esc／背景點擊關閉：`ShareDialog`（fixed inset-0 modal）原本只能用「關閉」按鈕關閉——沒有 Escape、沒有背景點擊關閉，與同檔 `ShortcutsButton` modal（有背景關閉）及播放頁其他 overlay 不一致，也缺 `role="dialog"` 等無障礙屬性。新增 Escape keydown 監聽、背景（點到 overlay 本身時）點擊關閉、`role="dialog"`/`aria-modal`/`aria-label`，並把 `embedCode` 建構抽成可測純函式 `buildEmbedCode`。
  - 修改說明（2026-06-26）：`ShareDialog.tsx` 新增 export `buildEmbedCode(shareUrl)`（空 URL 回 ''）；加 `useEffect` 監聽 window keydown（Escape → onClose，含 cleanup）；overlay div 加 `onClick`（`event.target === event.currentTarget` 才 onClose，避免點內容誤關）；內層面板加 `role`/`aria-modal`/`aria-label`。新增 `ShareDialog.test.ts` +2 測試（有/無 URL 的 embed 片段）。前端 365 測試 + typecheck 全通過。分支 `feat/share-dialog-dismiss`，已 merge 回 master。
  - 計數：自上次「---- 計數重設 ----」(2026-06-26) 起算，本項為第 13 個完成項目（13/100，未達上限）。

- [x] 可重用 overlay 關閉 hook（套用至圖片預覽與分享對話框）：多個 `fixed inset-0` modal 缺 Escape／背景點擊關閉。新增可重用的 `useOverlayDismiss(onClose)` hook（Escape keydown + 背景點擊關閉），決策邏輯抽成可測純函式 `isOverlayDismissKey`／`isBackdropClick`。`ImagePreviewDialog` 套用後新增 Escape／背景關閉與原本缺少的 `role=dialog`/`aria-modal`/`aria-label`；同時把上一輪的 `ShareDialog` 重構為使用此 hook，移除其手寫的 keydown effect 與 inline 背景判斷（消除重複、統一行為）。
  - 修改說明（2026-06-26）：新增 `frontend/src/components/useOverlayDismiss.ts`（hook + 兩個純函式）與 `useOverlayDismiss.test.ts` +2 測試（只認 Escape、背景點擊須 target===currentTarget，使用真實 `EventTarget` 實例以符型別）。`ImagePreviewDialog.tsx` import hook、overlay 加 `onClick={onBackdropClick}`、面板加 aria 屬性。`ShareDialog.tsx` 改用 hook（移除 `useEffect`／inline onClick，`useState` import 收斂）。前端 367 測試 + typecheck 全通過。分支 `feat/overlay-dismiss-hook`，已 merge 回 master。
  - 計數：自上次「---- 計數重設 ----」(2026-06-26) 起算，本項為第 14 個完成項目（14/100，未達上限）。

- [x] students.csv 報表沿用共用強化版 csvEscape：`report.ts` 的學生報表匯出（students.csv）另有第三份 `escapeCsvField`，與先前修過的 csv.ts 同樣有 CSV formula injection 弱點與未防單獨 CR——而其欄位 `quiz_title` 為使用者可控。改用上一輪建立的共用 `csvEscape`，讓此匯出也獲得公式注入防護與 CR 引用，並消除第三份重複。
  - 修改說明（2026-06-26）：`report.ts` 移除本地 `escapeCsvField`，`import { csvEscape } from './csv'`，7 處呼叫改為 `csvEscape`。一般值/數字行為不變。後端 `tsc` build 通過、共用 `csvEscape.test.ts` 通過；students.csv 整合測試需 better-sqlite3（sandbox ABI 不符）留待 CI，經分析（header 不經 escape、測試資料無危險起始字元、數字不變）確認不破壞。分支 `refactor/report-csv-use-shared-escape`，已 merge 回 master。
  - 計數：自上次「---- 計數重設 ----」(2026-06-26) 起算，本項為第 15 個完成項目（15/100，未達上限）。

- [x] 卡片封面載入失敗退回佔位圖：`PdfCard` 的封面 `<img>` 沒有 `onError` fallback，縮圖 404／尚未產生／載入失敗時會顯示瀏覽器的破圖示。改為記錄「失敗的 src」並退回 PDF 佔位圖；以 URL（而非布林旗標）為鍵，使之後 `coverSrc` 換成新 URL（例如渲染中下一張即時頁面預覽）時會重試而非永遠停在佔位圖。
  - 修改說明（2026-06-26）：新增純函式 `frontend/src/components/pdfCardCover.ts` 的 `shouldShowCoverImage(coverSrc, failedSrc)`（有 URL 且 ≠ 失敗的 URL 才顯示圖片，附 type guard）；`PdfCard.tsx` 新增 `failedCoverSrc` state、封面改用此函式判斷、`<img>` 加 `onError={() => setFailedCoverSrc(coverSrc)}`。新增 `pdfCardCover.test.ts` +4 測試（無 URL、未失敗、失敗 URL 退回、換新 URL 重試）。前端 371 測試 + typecheck 全通過。分支 `fix/pdf-card-cover-fallback`，已 merge 回 master。
  - 計數：自上次「---- 計數重設 ----」(2026-06-26) 起算，本項為第 16 個完成項目（16/100，未達上限）。

- [x] 播放頁選單標籤 i18n：`PlayPageHeader` 的行動版選單切換鈕（aria-label 與「選單」文字）與 6 個 `HeaderDropdown` 群組標籤（資訊／播放／生成／下載／逐字稿／分享）原為硬編中文，英文介面仍顯示中文。新增 i18n key 並改用 `t()`。
  - 修改說明（2026-06-26）：zh-TW/en 各新增 8 個 key（`play.header.menuToggle`、`play.header.menu`、`play.header.groupInfo/Playback/Generate/Download/Script/Share`）；`PlayPageHeader.tsx` 對應 8 處硬編中文改用 `t()`。i18n key 對齊由 `tsc`（`TranslationKey`）與 i18n 測試把關。前端 371 測試 + typecheck 全通過。分支 `fix/play-header-menu-i18n`，已 merge 回 master。
  - 計數：自上次「---- 計數重設 ----」(2026-06-26) 起算，本項為第 17 個完成項目（17/100，未達上限）。

- [x] figure 圖片路徑越界防護（defense-in-depth）：`figureImageAbsPath` 原以裸 `path.join(pdfDir(pdfId), figure.imagePath)` 解析，無 containment 檢查；其結果由 `/api/pdfs/:id/figures/:figureId/image` 路由 stream 給 client。雖然 `figures.json` 目前由伺服器自寫，但若 manifest 被竄改/損壞、`imagePath` 含 `../` 即可逃逸 PDF 目錄。改走既有的 `safeJoinPdfPath` 助手（與 `pdfDir` 一致的越界檢查），任何 traversal 直接 throw。
  - 修改說明（2026-06-26）：`pdfFigures.ts` 的 `figureImageAbsPath` 改用 `safeJoinPdfPath(pdfId, figure.imagePath)`，移除已不需要的 `path` import。新增 `figureImageAbsPath.test.ts` +2 測試（正常 figures/ 路徑解析正確、`../` 越界 throw），sandbox 執行通過；後端 `tsc` build 通過。分支 `fix/figure-path-traversal-guard`，已 merge 回 master。
  - 計數：自上次「---- 計數重設 ----」(2026-06-26) 起算，本項為第 18 個完成項目（18/100，未達上限）。

- [x] 橡皮擦命中幾何抽離並補測試：`DrawingCanvas` 的橡皮擦命中判定幾何（`distSq`／`distPointToSegment`／`strokeHitsPoint`）原為元件內未匯出、未測試的非平凡邏輯（點到線段距離、稀疏點之間的線段命中），是繪圖標註橡皮擦正確性的核心。抽成純模組 `drawingGeometry.ts`（`DrawingCanvas` 改 import `strokeHitsPoint`），並補單元測試鎖定行為。
  - 修改說明（2026-06-26）：新增 `frontend/src/components/drawingGeometry.ts`（3 個純函式，`strokeHitsPoint` 以 `import type` 取得 `DrawingStroke` 型別、執行期無循環依賴）；`DrawingCanvas.tsx` 移除內聯 helper、改 import。新增 `drawingGeometry.test.ts` +6 測試（平方距離、點到線段距離之垂足/端點夾擠/零長線段、頂點命中、稀疏點線段命中、未命中）。前端 377 測試 + typecheck 全通過。分支 `refactor/drawing-geometry-tested`，已 merge 回 master。
  - 計數：自上次「---- 計數重設 ----」(2026-06-26) 起算，本項為第 19 個完成項目（19/100，未達上限）。

- [x] 側邊欄導覽縮圖隱藏破圖：`PlayPageSidebar` 的「從頁面建立」搜尋結果、書籤清單、重點頁清單三處的 `<img>` 缺 `onError`，縮圖載入失敗時會顯示瀏覽器破圖示——與主大綱縮圖網格（已優雅降級）不一致。三處加上 `onError` 在載入失敗時隱藏該圖，行為一致。
  - 修改說明（2026-06-26）：`PlayPageSidebar.tsx` 三個導覽縮圖 `<img>` 加 `onError={(e) => { e.currentTarget.style.display = 'none'; }}`（書籤/重點兩處同字串以 replace_all 一併處理）。此為小型 DOM 事件處理、無可抽出純邏輯，依前端 377 測試 + typecheck 全通過驗證不破壞。分支 `fix/sidebar-secondary-thumb-onerror`，已 merge 回 master。
  - 計數：自上次「---- 計數重設 ----」(2026-06-26) 起算，本項為第 20 個完成項目（20/100，未達上限）。

- [x] add-pages outline 純函式抽離並補測試：`addPagesFromPrompt.ts` 的 `parseOutlineText`／`buildInsertionContext`／`renderNewSlideTexts` 為純邏輯，但該檔 import `db`，導致這些函式無法在 sandbox 單元測試（`buildInsertionContext` 還是 export 的公開 API 卻無直接測試）。抽成無 db 依賴的 `addPagesOutline.ts`，`addPagesFromPrompt` 改 import 並 re-export `buildInsertionContext`（維持 `routes/pdfs/add-pages.ts` 既有 import 路徑）。
  - 修改說明（2026-06-26）：新增 `backend/src/worker/addPagesOutline.ts`（3 個純函式 + `OutlineSlide` 型別）；`addPagesFromPrompt.ts` 移除原定義、改 `import { ... } from './addPagesOutline'` 並 `export { buildInsertionContext }`。新增 `addPagesOutline.test.ts` +7 測試（outline 解析之 bullet 門檻/前綴去除/孤兒 bullet、插入情境的聚焦視窗/去重排序/空白略過/maxChars、新頁渲染），sandbox 執行通過；後端 `tsc` build 通過。分支 `refactor/add-pages-outline-pure`，已 merge 回 master。
  - 計數：自上次「---- 計數重設 ----」(2026-06-26) 起算，本項為第 21 個完成項目（21/100，未達上限）。

- [x] 預設投票選項 i18n：`usePagePolls` 的新投票選項欄位預設值硬編中文 `'同意\n不同意'`（初始 state 與建立後重設兩處）——英文介面的老師建立投票時會拿到中文預設選項，且這些選項會直接成為學生看到的投票項目。新增 i18n key 並改用 `t()`。（檢視時另確認投票輪詢採 `cancelled` flag + 遞迴 setTimeout，無 race。）
  - 修改說明（2026-06-26）：zh-TW/en 各新增 `play.sidebar.poll.defaultOptions`（`同意\n不同意`／`Agree\nDisagree`）；`usePagePolls.ts` 的 `useState` 初始值改 lazy initializer `() => t(...)`、建立後重設改 `t(...)`（`handleCreatePoll` 的 useCallback deps 已含 `t`）。前端 377 測試 + typecheck（含 i18n key 對齊）全通過。分支 `fix/poll-default-options-i18n`，已 merge 回 master。
  - 計數：自上次「---- 計數重設 ----」(2026-06-26) 起算，本項為第 22 個完成項目（22/100，未達上限）。

- [x] 暫停播放／即時問答動畫預設文字 i18n：`pause-playback` 與 `realtime-poll` 兩個動畫 preset 在建立時把硬編中文（`暫停：請按播放鍵繼續`／`📊 即時問答時間`）烤進 effect.text，導致英文簡報的觀看者看到中文疊加文字——且與 `text-callout` preset（不設預設 text、靠 placeholder/fallback）不一致。移除這兩個 preset 的硬編 text（與 text-callout 一致），改在 editor placeholder 與 `SlideRenderer` fallback 以 i18n 顯示。
  - 修改說明（2026-06-26）：zh-TW/en 各新增 `play.animation.defaultPausePlaybackText`／`defaultRealtimePollText`；`AnimationEditorTab.tsx` 兩個 preset 移除 `text:`、placeholder 改 `t()`、移除常數 import；`SlideRenderer.tsx` 的 `EffectOverlay` 加 `useI18n`、兩處 fallback 改 `t()`、移除常數 import；`animationSpec.ts` 移除已不再使用的兩個常數。preset 測試只檢查 exitDuration/pollId 不受影響。前端 377 測試 + typecheck（含 i18n key 對齊）全通過。分支 `fix/animation-default-text-i18n`，已 merge 回 master。
  - 計數：自上次「---- 計數重設 ----」(2026-06-26) 起算，本項為第 23 個完成項目（23/100，未達上限）。

- [x] custom-script 安全檢查擋下可呼叫的 Function 建構式：`findUnsafeScriptPattern`（AI 產生之 custom-script 程式碼於 sandboxed iframe 執行前的縱深防禦）原本擋 `new Function(...)`，卻漏了可呼叫形式 `Function("...")()`（等同 eval 的向量）。新增 case-sensitive `/\bFunction\s*\(/`（僅大寫 F，避免誤擋一般程式碼的小寫 `function(` 關鍵字）。
  - 修改說明（2026-06-26）：`animationCustomScript.ts` 的 `UNSAFE_PATTERNS` 在 `new Function` 後新增 `{ pattern: /\bFunction\s*\(/, label: 'Function constructor' }`（`new Function(` 仍由前項先回報、標籤不變）。`animation-custom-script.test.ts` 新增可呼叫 Function 建構式偵測（+2 case）與「不誤擋小寫 function 關鍵字」測試（+1 test，含函式運算式/IIFE/renderAnimation）。相關測試 17 通過、後端 build 通過。分支 `fix/unsafe-pattern-function-ctor`，已 merge 回 master。
  - 計數：自上次「---- 計數重設 ----」(2026-06-26) 起算，本項為第 24 個完成項目（24/100，未達上限）。

- [x] API 錯誤提示 key 存在性 drift-guard：`mapApiErrorToHumanMessage` 透過 `hintKeys(name)` 以 `as TranslationKey` 動態組出 `apiError.<name>.{title,message,nextStep}`，繞過 tsc 對 key 是否存在的檢查；若缺漏/打錯，使用者會看到原始 key 字串（如 `apiError.invalidRequest.title`）。新增測試掃過 `ERROR_HINT_KEYS` 所有值，斷言每個 key 在 zh-TW 與 en 皆有定義，把漂移在測試期擋下。（已實測目前全部存在、無 bug。）
  - 修改說明（2026-06-26）：`lib/api/common.ts` 將 `ERROR_HINT_KEYS` 改 export；新增 `lib/api/apiErrorHintKeys.test.ts`（迭代所有 hint 條目 × title/message/nextStep，檢查存在於兩個 locale）。`mapApiErrorToHumanMessage` 內的字面 key（requestFailed/unknownError）本就由 tsc 驗證、不需此測試。前端 378 測試 + typecheck 全通過。分支 `test/api-error-hint-keys-guard`，已 merge 回 master。
  - 計數：自上次「---- 計數重設 ----」(2026-06-26) 起算，本項為第 25 個完成項目（25/100，未達上限）。

- [x] DrawingCanvas getNorm 防零面積除法：`getNorm` 以 canvas `getBoundingClientRect()` 的寬高做除法、無守門，若 rect 寬或高為 0（畫布短暫收合/隱藏）會產生 NaN/Infinity 座標並存入筆劃資料（JSON 序列化成 null）。抽出可測純函式 `normalizeCanvasPoint`（零/無效面積回 `[0,0]`）取代內聯計算。（檢視時另確認 sandbox 屬性、存檔快照、diff/動畫驗證等皆穩健。）
  - 修改說明（2026-06-26）：`drawingGeometry.ts` 新增 `normalizeCanvasPoint(clientX, clientY, rect)`（`rect.width/height > 0` 才換算，否則回 `[0,0]`）；`DrawingCanvas.tsx` 的 `getNorm` 改呼叫之、import 更新。`drawingGeometry.test.ts` +2 測試（一般換算含邊界、零面積回 [0,0] 不產 NaN）。前端 380 測試 + typecheck 全通過。分支 `fix/drawing-getnorm-zero-guard`，已 merge 回 master。
  - 計數：自上次「---- 計數重設 ----」(2026-06-26) 起算，本項為第 26 個完成項目（26/100，未達上限）。

- [x] 移除 routes/pdfs.ts 重構前遺留死碼：`backend/src/routes/pdfs.ts` 有約 450 行重構前的舊 monolith 程式碼（route helper + 與 `pdfs/shared.ts` byte 相同的重複 `extractYoutubeVideoId`／`streamFile` 等 38 個函式），但全檔僅 export 底部的 `pdfRoutes` shim（委派給 `./pdfs/index`），其餘皆不可達死碼。`server.ts` 的 `import('./routes/pdfs')` 因檔案解析優先於目錄而命中此 shim。將整檔縮減為僅該 shim，維持相同模組解析與執行行為，消除死碼與重複。
  - 修改說明（2026-06-26）：`routes/pdfs.ts` 由 454 行縮為 9 行（僅 `import type { FastifyInstance }` 與委派 `pdfRoutes`）。確認全檔唯一 export 為 `pdfRoutes`、無頂層副作用、shim 不引用任何本地定義；後端 `tsc` build 通過（證實無其他程式依賴被移除的程式碼）。淨刪 450 行。分支 `refactor/remove-dead-pdfs-monolith`，已 merge 回 master。
  - 計數：自上次「---- 計數重設 ----」(2026-06-26) 起算，本項為第 27 個完成項目（27/100，未達上限）。

- [x] timingSafeStringEqual 收斂為單一來源：常數時間秘密比較函式在 `server.ts`、`routes/auth.ts`、`services/aiSettings.ts` 三處 byte 相同重複——任一漂移即可能在 session HMAC／OAuth state／MCP token 比對上重新引入 timing side channel。抽到共用 `backend/src/timingSafe.ts`；`server.ts` 與 `auth.ts` 改 re-export（既有 importer/測試不受影響）、`aiSettings.ts` 改 import。
  - 修改說明（2026-06-26）：新增 `timingSafe.ts`（唯一實作）；`server.ts` 改 `export { timingSafeStringEqual } from './timingSafe'`；`auth.ts` 頂部 import 供內部使用（line 80/230）並 `export { timingSafeStringEqual }`；`aiSettings.ts` 移除本地定義改 import。新增 `timingSafe.test.ts` +4（相等/不等、長度不同不拋錯、空字串、UTF-8 多位元組），sandbox 通過；後端 `tsc` build 通過。既有 auth/mcp 整合測試因 better-sqlite3 ABI 留待 CI。分支 `refactor/dedupe-timing-safe-equal`，已 merge 回 master。
  - 計數：自上次「---- 計數重設 ----」(2026-06-26) 起算，本項為第 28 個完成項目（28/100，未達上限）。

- [x] escapeXml 收斂為單一來源：`renderTextPages.ts`（SVG 文字）與 `scorm.ts`（SCORM manifest）各有一份 byte 相同的 `escapeXml`（XML 五個保留字元跳脫）。抽到共用 `backend/src/escapeXml.ts`；`renderTextPages` import+re-export（既有測試從此模組 import）、`scorm.ts` 改 import。（另比對發現 `safeFilename` 三份實作不同——CJK 允許與 fallback 各異，屬刻意變體，未合併。）
  - 修改說明（2026-06-26）：新增 `escapeXml.ts`（唯一實作）；`renderTextPages.ts` 頂部 import 供內部使用（line 61 tspan）並 `export { escapeXml }`；`scorm.ts` 移除本地定義改 import。renderTextPages 相關測試 23 通過、後端 build 通過。分支 `refactor/dedupe-escape-xml`，已 merge 回 master。
  - 計數：自上次「---- 計數重設 ----」(2026-06-26) 起算，本項為第 29 個完成項目（29/100，未達上限）。

- [x] sanitiseUserPrompt 收斂為單一來源：將使用者提示詞嵌入 LLM system prompt 前的截斷/清理函式（與 `MAX_USER_PROMPT_CHARS_IN_SYSTEM = 2000`）在 `generateTitle.ts` 與 `generateScript.ts` 兩處 byte 相同重複。抽到共用 `promptSanitize.ts`（含常數），`generateTitle` re-export、兩者 import。
  - 修改說明（2026-06-26）：新增 `backend/src/worker/steps/promptSanitize.ts`（`sanitiseUserPrompt` + `MAX_USER_PROMPT_CHARS_IN_SYSTEM`）；`generateTitle.ts` 移除本地定義、import 並 `export { sanitiseUserPrompt }`；`generateScript.ts` 移除本地定義與常數、改 import。新增 `promptSanitize.test.ts` +4（nullish/空白回空、trim、邊界不截斷、超長截斷含「……（已截斷）」標記），sandbox 通過；後端 build 通過。分支 `refactor/dedupe-sanitise-user-prompt`，已 merge 回 master。
  - 計數：自上次「---- 計數重設 ----」(2026-06-26) 起算，本項為第 30 個完成項目（30/100，未達上限）。

- [x] sumAudioDurationSeconds 收斂為單一來源：每頁音訊長度加總（忽略缺值/非正值、四捨五入到毫秒、全空回 null）在 `pipeline.ts` 與 `regenerate.ts` 兩處 byte 相同重複。抽到共用 `backend/src/worker/audioDurationSum.ts`，兩者 import。
  - 修改說明（2026-06-26）：新增 `audioDurationSum.ts`（唯一實作）；`regenerate.ts`／`pipeline.ts` 移除本地定義改 import。新增 `audioDurationSum.test.ts` +3（全空/全無效回 null、只加有限正值、浮點加總四捨五入到毫秒如 0.1+0.2→0.3），sandbox 通過；後端 build 通過。分支 `refactor/dedupe-sum-audio-duration`，已 merge 回 master。
  - 計數：自上次「---- 計數重設 ----」(2026-06-26) 起算，本項為第 31 個完成項目（31/100，未達上限）。

- [x] WAV PCM 助手抽離為共用可測模組：`parseWavPcmChunk`／`buildWavPcm16`（WAV 二進位解析/封裝，用於拼接逐段 TTS 音訊）在 `synthesizeAudio.ts`（live）與 `routes/pdfs/shared.ts`（死碼，定義後從未呼叫）各有一份。把 live 版抽到純 `services/wav.ts`、synthesizeAudio import+re-export、刪除 shared.ts 死碼，並補測試（先前無覆蓋的二進位函式）。
  - 修改說明（2026-06-26）：新增 `backend/src/services/wav.ts`（`WavPcmChunk` 型別 + 兩函式）；`synthesizeAudio.ts` 頂部 import、`export { parseWavPcmChunk, buildWavPcm16 }`；`shared.ts` 刪除 ~40 行未使用的重複定義。新增 `wav.test.ts` +4（build→parse round-trip、44-byte 標頭與各 size 欄位、非 WAV/過短回 null、跳過非 data chunk 找到 data），sandbox 通過；後端 build 通過。分支 `refactor/extract-wav-helpers`，已 merge 回 master。
  - 計數：自上次「---- 計數重設 ----」(2026-06-26) 起算，本項為第 32 個完成項目（32/100，未達上限）。

- [x] 版本歷史對話框支援 Esc／背景點擊關閉：`VersionHistoryDialog`（檢視類、無表單輸入、restore 為明確按鈕、關閉=取消無副作用）原本只能用「關閉」按鈕關閉。套用先前建立的共用 `useOverlayDismiss` hook 補上 Escape／背景關閉與 `role=dialog`/`aria-modal`/`aria-label`，與其他播放頁 overlay 一致。
  - 修改說明（2026-06-26）：`VersionHistoryDialog.tsx` import `useOverlayDismiss`、overlay 加 `onClick={onBackdropClick}`、面板加 aria 屬性、抽出 `dialogTitle` 供標題與 aria-label 共用。hook 的純函式先前已測；前端 380 測試 + typecheck 全通過。分支 `feat/version-history-dialog-dismiss`，已 merge 回 master。（註：本項實作時一度誤將 commit 直接提交至 master，已重整為標準「分支→--no-ff merge」結構。）
  - 計數：自上次「---- 計數重設 ----」(2026-06-26) 起算，本項為第 33 個完成項目（33/100，未達上限）。

- [x] 額度用盡對話框支援 Esc／背景點擊關閉：`CreditExhaustedDialog`（資訊類、無表單輸入、已有 aria）原本只能用按鈕關閉。套用共用 `useOverlayDismiss` 補 Escape／背景關閉，並以 `useCallback` 包裝 close（穩定參考，避免 hook 每次 render 重新訂閱）、兩個關閉鈕統一走同一 close handler。
  - 修改說明（2026-06-26）：`CreditExhaustedDialog.tsx` import `useOverlayDismiss` 與 `useCallback`；`const close = useCallback(() => setDetail(null), [])`、`const { onBackdropClick } = useOverlayDismiss(close)`；overlay 加 `onClick={onBackdropClick}`、兩個 `onClick` 改 `close`。前端 380 測試 + typecheck 全通過。分支 `feat/credit-exhausted-dialog-dismiss`，已 merge 回 master。
  - 計數：自上次「---- 計數重設 ----」(2026-06-26) 起算，本項為第 34 個完成項目（34/100，未達上限）。

- [x] 課後報告面板支援 Esc／背景點擊關閉：`PostClassReportPanel`（報告檢視 modal、無表單輸入、已有 role/aria、關閉=取消無副作用）原本只能用「關閉」按鈕關閉。套用共用 `useOverlayDismiss` 補 Escape／背景關閉。
  - 修改說明（2026-06-26）：`PostClassReportPanel.tsx` import `useOverlayDismiss`、`const { onBackdropClick } = useOverlayDismiss(onClose)`、最外層 overlay 加 `onClick={onBackdropClick}`（`target===currentTarget` 才關，報告內容捲動/點擊不誤關）。前端 380 測試 + typecheck 全通過。分支 `feat/post-class-report-dismiss`，已 merge 回 master。
  - 計數：自上次「---- 計數重設 ----」(2026-06-26) 起算，本項為第 35 個完成項目（35/100，未達上限）。

- [x] 首頁搜尋納入簡報描述：首頁搜尋框原本只比對標題與標籤，無法以描述（description）內的文字找到簡報。抽出可測純函式 `pdfMatchesSearch(pdf, normalizedQuery)`，加入描述比對（大小寫不敏感、容忍缺欄位），並用於列表過濾。
  - 修改說明（2026-06-26）：`HomePage.tsx` 新增 export `pdfMatchesSearch`（比對 title／tags／description，空查詢回 true），`filteredItems` 改用之取代內聯 title+tags 過濾。新增 `HomePage.search.test.ts` +4（標題大小寫不敏感、標籤、描述、空查詢/缺欄位）。前端 384 測試 + typecheck 全通過。分支 `feat/home-search-description`，已 merge 回 master。
  - 計數：自上次「---- 計數重設 ----」(2026-06-26) 起算，本項為第 36 個完成項目（36/100，未達上限）。

- [x] cosineSimilarity 抽離為純可測模組：語意搜尋／相似頁面排序所用的 `cosineSimilarity` 原住在 import `db`／OpenAI client 的 `embeddings.ts`，無法在 sandbox 單元測試。抽到純 `services/cosineSimilarity.ts`，`embeddings.ts` re-export（`search.ts`／`similar-pages.ts` 不受影響）。
  - 修改說明（2026-06-26）：新增 `backend/src/services/cosineSimilarity.ts`（零向量回 0）；`embeddings.ts` 移除本地定義改 import 並 `export { cosineSimilarity }`。新增 `cosineSimilarity.test.ts` +5（相同/正交/相反向量、零向量守門、已知中間值 1/√2、長度不一致以 0 補尾，含浮點容差），sandbox 通過；後端 build 通過。分支 `refactor/extract-cosine-similarity`，已 merge 回 master。
  - 計數：自上次「---- 計數重設 ----」(2026-06-26) 起算，本項為第 37 個完成項目（37/100，未達上限）。

- [x] 修正貼上圖片 object URL 卸載洩漏：QA 聊天可貼上參考圖片，`PlayPageSidebar` 以 `URL.createObjectURL` 產生預覽 URL。session 內重新貼上/清除已由 `clearChatPastedImage` 先 revoke，但**離開播放頁（unmount）時若有貼上未送出的圖片，其 blob URL 不會被釋放**——SPA 反覆進出播放頁會累積 blob 洩漏。於 `useChatAndImageEdit` 加 unmount cleanup 釋放。
  - 修改說明（2026-06-26）：`useChatAndImageEdit.ts` 新增 `chatPastedImageUrlRef`（每次 render 同步最新值）與 `useEffect(() => () => { if (ref.current) URL.revokeObjectURL(ref.current); }, [])`，於卸載時釋放當下的 URL；session 內的重新貼上/清除仍由 `clearChatPastedImage` 先行 revoke（ref 隨之為 null），不會重複釋放。前端 384 測試 + typecheck 全通過。分支 `fix/chat-pasted-image-url-leak`，已 merge 回 master。
  - 計數：自上次「---- 計數重設 ----」(2026-06-26) 起算，本項為第 38 個完成項目（38/100，未達上限）。

- [x] 搜尋結果片段函式抽離為純可測模組：`extractSnippet`（在搜尋命中關鍵字附近擷取預覽片段、加上下文與省略號，search.ts 內 5 處使用）原為 import `db` 的 route 內 local 函式，無法 sandbox 單元測試。抽到純 `routes/pdfs/searchSnippet.ts`（連同 `SNIPPET_CONTEXT` 常數），search.ts 改 import。
  - 修改說明（2026-06-26）：新增 `searchSnippet.ts`（`extractSnippet` + `SNIPPET_CONTEXT = 60`）；`search.ts` 移除本地定義與常數、改 import。新增 `searchSnippet.test.ts` +5（短字串不裁切無省略號、兩側裁切含前後 `...` 且長度正確、命中於開頭無前置 `...`、大小寫不敏感但保留原大小寫、查無關鍵字 fallback 取前段），sandbox 通過；後端 build 通過。分支 `refactor/extract-search-snippet`，已 merge 回 master。
  - 計數：自上次「---- 計數重設 ----」(2026-06-26) 起算，本項為第 39 個完成項目（39/100，未達上限）。

- [x] formatDurationMs 負值守門：play `formatters.ts` 的 `formatDurationMs` 原本守門 null/NaN/非有限值，但未守負值——若 `duration_ms` 為負會輸出如 `-5ms`。負的時長與「無紀錄」一樣無意義，改為回傳 noRecordLabel。此函式用於 PlayPageSlidePanel／PageTimingChips 的 timing/SLA 時長顯示。
  - 修改說明（2026-06-26）：`formatDurationMs` 的守門條件由 `ms == null || !Number.isFinite(ms)` 擴為再加 `|| ms < 0`；`formatters.test.ts` 在既有「missing/invalid」測試新增 `-1 → noRecordLabel`。前端 384 測試 + typecheck 全通過。分支 `fix/format-duration-negative-guard`，已 merge 回 master。
  - 計數：自上次「---- 計數重設 ----」(2026-06-26) 起算，本項為第 40 個完成項目（40/100，未達上限）。

- [x] 投票選項上限與索引上界以常數連結（防漂移）：`CreatePollBodySchema.options` 上限硬編 6、`VotePollBodySchema.option_index` 上界硬編 5，是兩個耦合卻獨立的魔術數字——若日後調高選項上限卻忘了同步索引上界，新選項將被投票驗證擋下而無法投票。引入 `MAX_POLL_OPTIONS` 並由它推導兩處邊界，使耦合顯式化、無法漂移。
  - 修改說明（2026-06-26）：`routes/pdfs/shared.ts` 新增 `export const MAX_POLL_OPTIONS = 6`（含註解說明連動關係）；`CreatePollBodySchema` 改 `.max(MAX_POLL_OPTIONS, ...)`、`VotePollBodySchema.option_index` 改 `.max(MAX_POLL_OPTIONS - 1)`。下界（`option_index.min(0)`）原已驗證、行為不變。後端 `tsc` build 通過；schema 整合測試因 shared.ts import db（sandbox better-sqlite3 ABI 不符）留待 CI，但耦合已由常數結構保證。分支 `refactor/poll-max-options-constant`，已 merge 回 master。
  - 計數：自上次「---- 計數重設 ----」(2026-06-26) 起算，本項為第 41 個完成項目（41/100，未達上限）。

- [x] 前端投票選項上限驗證（與後端一致）：承上輪，前端 `handleCreatePoll` 只檢查 `< 2`（下限），未檢查上限——老師填超過 6 個選項會送出後才被後端以原始 400（「最多 6 個選項」）拒絕。前端補上限檢查（鏡像後端 `MAX_POLL_OPTIONS = 6`），送出前以友善、可 i18n 的訊息攔下。
  - 修改說明（2026-06-26）：`usePagePolls.ts` 新增 `const MAX_POLL_OPTIONS = 6`（註解標明鏡像後端）；`handleCreatePoll` 在 `< 2` 檢查後加 `options.length > MAX_POLL_OPTIONS` 檢查並顯示 `play.sidebar.poll.maxOptions`（含 `{max}` 佔位）。zh-TW/en 各新增該 key。前端 384 測試 + typecheck（含 i18n key 對齊）全通過。分支 `feat/poll-max-options-frontend-validation`，已 merge 回 master。
  - 計數：自上次「---- 計數重設 ----」(2026-06-26) 起算，本項為第 42 個完成項目（42/100，未達上限）。

- [x] 測驗「答對」判定收斂為單一來源：`isCorrectAnswer`（選取集合與答案鍵完全相符、忽略順序/重複）在 `quizzes.ts`（計分）有正式版、`report.ts`（課後報告）內聯重複兩次——三份等價但獨立，漂移會使報告與其所報告的計分結果不一致。抽到純 `services/quizCorrectness.ts`，三處共用（鏡像前端 `lib/quizScoring.ts`）。
  - 修改說明（2026-06-26）：新增 `backend/src/services/quizCorrectness.ts`（`isCorrectAnswer`）；`quizzes.ts` 移除本地定義改 import；`report.ts` 兩處內聯（computeQuestionStats／computeStudentRecords）改呼叫之、移除多餘的 `correctSet`/`selectedSet`。新增 `quizCorrectness.test.ts` +4（單選相符、多選忽略順序/重複、子集/超集/相異為錯、空對空為對），sandbox 通過；後端 build 通過。分支 `refactor/dedupe-quiz-correctness`，已 merge 回 master。
  - 計數：自上次「---- 計數重設 ----」(2026-06-26) 起算，本項為第 43 個完成項目（43/100，未達上限）。

- [x] 前後端 isCorrectAnswer 跨套件一致性 drift-guard：承上輪，`isCorrectAnswer` 在後端 `services/quizCorrectness.ts`（計分/報告）與前端 `lib/quizScoring.ts`（編輯預覽/作答）各有一份（跨套件無法共用），兩者必須一致。沿用本專案既有的跨套件 drift-guard 模式（subtitle-split／status-enum／llm-pricing 一致性測試），新增測試斷言兩份在代表性案例上結果相同。
  - 修改說明（2026-06-26）：新增 `backend/test/quizCorrectnessConsistency.test.ts`，import 後端與前端兩個 `isCorrectAnswer`（簽章不同——前端收 `QuizQuestion`、後端收索引陣列，故以最小 question 物件包裝），對 11 個案例（單選、多選忽略順序/重複、子集/超集/相異、空對空/空對非空）斷言兩者一致。sandbox 執行通過；後端 build 通過。分支 `test/quiz-correctness-consistency`，已 merge 回 master。
  - 計數：自上次「---- 計數重設 ----」(2026-06-26) 起算，本項為第 44 個完成項目（44/100，未達上限）。

- [x] 後端測驗計分抽離為純可測且有守門的模組：`calcQuestionScore`／`normalizeQuestionScores`（伺服器端權威計分，單選 all-or-nothing、多選逐選項部分給分、未填分數均分 100 分池）原為 import db 的 `quizzes.ts` 內 module-local 函式，註解明言鏡像前端 `lib/quizScoring.ts` 卻無後端測試、無跨套件守門。抽到純 `services/quizScoring.ts`（最小 `ScorableQuestion` 結構型別、複用 `isCorrectAnswer`），`quizzes.ts` 改 import。
  - 修改說明（2026-06-26）：新增 `backend/src/services/quizScoring.ts`（`QUIZ_TOTAL_SCORE`/`ScorableQuestion`/兩函式）；`quizzes.ts` 移除本地定義、改 `import { calcQuestionScore, normalizeQuestionScores }`、移除已不需的 `isCorrectAnswer` import（z.infer 型別結構相容傳入）。新增 `quizScoring.test.ts` +5（單選 all-or-nothing、多選部分給分 6/4 邊界、0 選項、均分、全填/空陣列）與跨套件 `quizScoringConsistency.test.ts` +2（前後端 calc／normalize 在多案例一致）。後端 build 通過、相關測試全通過。分支 `refactor/extract-backend-quiz-scoring`，已 merge 回 master。
  - 計數：自上次「---- 計數重設 ----」(2026-06-26) 起算，本項為第 45 個完成項目（45/100，未達上限）。

- [x] 遙控器投影片預覽隱藏破圖：教師手機遙控頁 `RemoteControllerPage` 的目前投影片預覽 `<img>` 缺 `onError`，縮圖載入失敗時會顯示破圖示，與側邊欄/卡片縮圖的優雅降級不一致。加上 `onError` 在失敗時隱藏該圖。
  - 修改說明（2026-06-26）：`RemoteControllerPage.tsx` 投影片預覽 `<img>` 加 `onError={(e) => { e.currentTarget.style.display = 'none'; }}`。此為小型 DOM 事件處理、無可抽出純邏輯，依前端 384 測試 + typecheck 全通過驗證不破壞。分支 `fix/remote-controller-img-onerror`，已 merge 回 master。
  - 計數：自上次「---- 計數重設 ----」(2026-06-26) 起算，本項為第 46 個完成項目（46/100，未達上限）。

- [x] 圖表資產縮圖隱藏破圖：`FigureAssetsTab`（圖表瀏覽/選取）的縮圖 `<img>` 缺 `onError`，圖表圖片缺失（未產生/刪除/路徑問題）時會顯示破圖示。加上 `onError` 失敗時隱藏，與其他縮圖一致。
  - 修改說明（2026-06-26）：`FigureAssetsTab.tsx` 圖表縮圖 `<img>` 加 `onError={(e) => { e.currentTarget.style.display = 'none'; }}`。前端 384 測試 + typecheck 全通過。分支 `fix/figure-assets-img-onerror`，已 merge 回 master。
  - 計數：自上次「---- 計數重設 ----」(2026-06-26) 起算，本項為第 47 個完成項目（47/100，未達上限）。

- [x] 新增頁面對話框縮圖隱藏破圖：`AddPagesFromPromptModal`（從提示新增頁面的進度檢視）新生成頁面縮圖 `<img>`（`imageDone` 時顯示）缺 `onError`——縮圖未就緒時會閃破圖示。加上 `onError` 失敗時隱藏。至此前端所有列表/縮圖 `<img>` 的破圖降級已全面補齊。
  - 修改說明（2026-06-26）：`AddPagesFromPromptModal.tsx` 頁面縮圖 `<img>` 加 `onError={(e) => { e.currentTarget.style.display = 'none'; }}`。前端 384 測試 + typecheck 全通過。分支 `fix/add-pages-modal-img-onerror`，已 merge 回 master。
  - 計數：自上次「---- 計數重設 ----」(2026-06-26) 起算，本項為第 48 個完成項目（48/100，未達上限）。

- [x] 焦點在下拉選單時不觸發播放頁快捷鍵：`PlayPage` 的兩個鍵盤處理器原本只在焦點位於 INPUT／TEXTAREA／contentEditable 時跳過快捷鍵，未含原生 `<select>`——當焦點在下拉（分享有效期、TTS 語音等）時按方向鍵會同時改變選項**並**切換投影片（雙重動作）。兩處守門加入 `SELECT`。
  - 修改說明（2026-06-26）：`PlayPage.tsx` 兩處 keydown 守門的條件加 `target.tagName === 'SELECT'`（以 replace_all 一致處理）。前端 384 測試 + typecheck 全通過。分支 `fix/keyboard-ignore-select`，已 merge 回 master。
  - 計數：自上次「---- 計數重設 ----」(2026-06-26) 起算，本項為第 49 個完成項目（49/100，未達上限）。

## 工作記錄（第九十七輪）

| 日期 | 工作摘要 | 分支 |
| ---- | -------- | ---- |
| 2026-06-26 | 剩餘播放時間隨速度校正：新增 `adjustRemainingForSpeed(seconds, rate)` 純函式並於 `PlayPageSlidePanel` 剩餘時間顯示套用；非 1× 倍速 tooltip 改用 `play.header.timeRemainingAtSpeed`；formatters.test.ts +2 測試；i18n zh-TW/en 各 +1 key | feat/remaining-time-speed-adjusted（已 merge） |
| 2026-06-26 | 首頁新增「標題 Z-A」排序：`SortMode`/`SORT_MODES` 加 `title_desc`，新增 `compareByTitleDesc` 並 export `getComparatorForSortMode`；下拉加 option；i18n zh-TW/en 各 +1 key；HomePage.sort.test.ts +2 測試 | feat/home-sort-title-desc（已 merge） |
| 2026-06-26 | 播放時間顯示支援小時：`formatTime` 在 ≥1 小時時改回傳 `H:MM:SS`（未滿則維持 `MM:SS`）；formatters.test.ts +2 測試（先前無覆蓋） | feat/format-time-hours（已 merge） |
| 2026-06-26 | Token 數顯示百萬進位修正：`formatTokenCount` 對 999_950+ 改以 `1.00M` 顯示（原誤為 `1000.0K`），並守門非有限輸入回 `'0'`；formatters.test.ts +3 測試（先前無覆蓋）；前端 348 測試通過 | feat/token-count-rollover（已 merge） |
| 2026-06-26 | 成本顯示守門：`formatCostUsd` 對 `NaN`/`Infinity` 改回傳 unknown label（原為 `$NaN`），負成本以絕對值+負號格式化（`-$1.23`／`-<$0.01`，原誤為 `<$0.01`）；formatters.test.ts +2 測試；前端 350 測試通過 | fix/format-cost-guard（已 merge） |
| 2026-06-26 | 觀看進度百分比夾在 0-100：新增 `clampPercent`，`calculateWatchProgressPercent` 防 >100%，並抽出 `calculateAvgListenedPercent`（倒退重聽 ratio>1 時夾頂）取代 `PlayPageSidebar` 內聯計算；watchProgress.test.ts +3 測試；前端 353 測試通過 | fix/watch-progress-percent-clamp（已 merge） |
| 2026-06-26 | 複習清單只刪指定題目：`removeReviewItem` 加選用 `questionText` 參數（同頁多題時只刪該題，原會整頁誤刪），`PlayPageSidebar` handler 傳入題目並修正本地 state 過濾；reviewList.test.ts +1 測試；前端 354 測試通過 | fix/review-item-remove-by-question（已 merge） |
| 2026-06-26 | 首頁新增「頁數少到多」排序：補上 `page_count_asc`（與既有 `page_count_desc` 對稱、缺頁數排尾），`SortMode`/`SORT_MODES`/comparator/下拉/i18n 一併更新；HomePage.sort.test.ts +2 測試；前端 356 測試通過 | feat/home-sort-page-count-asc（已 merge） |
| 2026-06-26 | 後端字幕分句去重：`subtitleAlignment.ts` 改 re-export `textSentences.ts` 的 `splitScriptIntoSentences`，消除後端同套件內兩份相同副本（含 regex）；一致性測試改以函式 identity 斷言並保留前端↔後端 regex 守護；相關後端測試與 build 通過 | refactor/dedupe-backend-split-sentences（已 merge） |
| 2026-06-26 | 播放頁下拉選單支援 Esc／點外部關閉：`HeaderDropdown` 加 `useEffect`（Escape + 外部 pointer-down 關閉），決策邏輯抽成純函式 `headerDropdownDismiss.ts`；headerDropdownDismiss.test.ts +2 測試；前端 358 測試通過 | feat/header-dropdown-dismiss（已 merge） |
| 2026-06-26 | 全域搜尋忽略過時回應：`GlobalSearchBox` 以 `requestSeqRef` 守門，捨棄非最新的 async 搜尋回應（修 search-as-you-type race）；export `highlightText` 並 +5 測試；前端 363 測試通過 | fix/global-search-race（已 merge） |
| 2026-06-26 | CSV 匯出去重並強化：兩個 CSV 路由共用的 `csvEscape` 抽成 `routes/pdfs/csv.ts`，並加 CSV formula injection 防護（`=`/`+`/`-`/`@`/Tab/CR 開頭字串前綴 `'`、僅對 string）與單獨 CR 引用；csvEscape.test.ts +6 測試（sandbox 通過）、後端 build 通過；CSV 整合測試留待 CI | feat/csv-escape-shared-hardened（已 merge） |
| 2026-06-26 | 分享對話框支援 Esc／背景點擊關閉：`ShareDialog` 加 Escape keydown、背景點擊（target===currentTarget）關閉與 `role=dialog`/`aria-modal`/`aria-label`；`embedCode` 抽成純函式 `buildEmbedCode`；ShareDialog.test.ts +2 測試；前端 365 測試通過 | feat/share-dialog-dismiss（已 merge） |
| 2026-06-26 | 可重用 overlay 關閉 hook：新增 `useOverlayDismiss`（Escape+背景關閉，純函式 `isOverlayDismissKey`/`isBackdropClick`）；套用至 `ImagePreviewDialog`（補 Escape/背景/aria）並重構 `ShareDialog` 使用之；useOverlayDismiss.test.ts +2 測試；前端 367 測試通過 | feat/overlay-dismiss-hook（已 merge） |
| 2026-06-26 | students.csv 報表沿用共用 csvEscape：`report.ts` 移除第三份 `escapeCsvField`，改用共用強化版 `csvEscape`，使該匯出（含使用者可控 quiz_title）也防 formula injection 並補 CR 引用；後端 build 通過、整合測試留待 CI | refactor/report-csv-use-shared-escape（已 merge） |
| 2026-06-26 | 卡片封面載入失敗退回佔位圖：`PdfCard` 封面 `<img>` 加 `onError` 退回 PDF 佔位圖（純函式 `shouldShowCoverImage`，以失敗 URL 為鍵可在換新 URL 時重試）；pdfCardCover.test.ts +4 測試；前端 371 測試通過 | fix/pdf-card-cover-fallback（已 merge） |
| 2026-06-26 | 播放頁選單標籤 i18n：`PlayPageHeader` 行動選單切換鈕與 6 個 HeaderDropdown 群組標籤（資訊/播放/生成/下載/逐字稿/分享）改用 `t()`；zh-TW/en 各 +8 key；前端 371 測試通過 | fix/play-header-menu-i18n（已 merge） |
| 2026-06-26 | figure 圖片路徑越界防護：`figureImageAbsPath` 改用 `safeJoinPdfPath`，避免被竄改的 figures.json imagePath（含 `../`）逃逸 PDF 目錄被 stream 給 client；figureImageAbsPath.test.ts +2 測試、後端 build 通過 | fix/figure-path-traversal-guard（已 merge） |
| 2026-06-26 | 橡皮擦命中幾何抽離並補測試：`DrawingCanvas` 的 `distSq`/`distPointToSegment`/`strokeHitsPoint` 抽成純模組 `drawingGeometry.ts` 並補 6 個單元測試（點到線段距離、稀疏點線段命中等）；前端 377 測試通過 | refactor/drawing-geometry-tested（已 merge） |
| 2026-06-26 | 側邊欄導覽縮圖隱藏破圖：`PlayPageSidebar` 搜尋結果/書籤/重點三處 `<img>` 加 `onError` 載入失敗隱藏，與主縮圖網格一致；前端 377 測試通過 | fix/sidebar-secondary-thumb-onerror（已 merge） |
| 2026-06-26 | add-pages outline 純函式抽離並補測試：`parseOutlineText`/`buildInsertionContext`/`renderNewSlideTexts` 抽到無 db 依賴的 `addPagesOutline.ts`（從 `addPagesFromPrompt` re-export 維持相容）；addPagesOutline.test.ts +7 測試、後端 build 通過 | refactor/add-pages-outline-pure（已 merge） |
| 2026-06-26 | 預設投票選項 i18n：`usePagePolls` 新投票預設選項 `同意/不同意` 改用 `t('play.sidebar.poll.defaultOptions')`（zh/en）；前端 377 測試通過 | fix/poll-default-options-i18n（已 merge） |
| 2026-06-26 | 暫停播放/即時問答動畫預設文字 i18n：移除 `pause-playback`/`realtime-poll` preset 硬編中文 text（與 text-callout 一致），editor placeholder 與 `SlideRenderer` fallback 改 `t()`；zh/en 各 +2 key；前端 377 測試通過 | fix/animation-default-text-i18n（已 merge） |
| 2026-06-26 | custom-script 安全檢查補擋可呼叫 Function 建構式：`findUnsafeScriptPattern` 新增 `/\bFunction\s*\(/`（大寫 F，擋 `Function("…")()`、不誤擋 `function(`）；animation-custom-script.test.ts +3、後端 build 通過 | fix/unsafe-pattern-function-ctor（已 merge） |
| 2026-06-26 | API 錯誤提示 key drift-guard：export `ERROR_HINT_KEYS` 並新增測試，斷言所有 `apiError.<name>.{title,message,nextStep}` 在 zh-TW/en 皆存在（防 `as TranslationKey` 動態 key 漂移顯示原始 key）；前端 378 測試通過 | test/api-error-hint-keys-guard（已 merge） |
| 2026-06-26 | DrawingCanvas getNorm 防零面積除法：抽出 `normalizeCanvasPoint`（零/無效 rect 回 [0,0]，避免 NaN 座標存入筆劃），`getNorm` 改用之；drawingGeometry.test.ts +2 測試；前端 380 測試通過 | fix/drawing-getnorm-zero-guard（已 merge） |
| 2026-06-26 | 移除 routes/pdfs.ts 遺留死碼：450 行重構前 monolith（含重複的 extractYoutubeVideoId/streamFile）縮為僅委派 shim，行為不變；後端 build 通過、淨刪 450 行 | refactor/remove-dead-pdfs-monolith（已 merge） |
| 2026-06-26 | timingSafeStringEqual 收斂單一來源：常數時間比較三份重複抽到 `timingSafe.ts`，server/auth re-export、aiSettings import；timingSafe.test.ts +4、後端 build 通過 | refactor/dedupe-timing-safe-equal（已 merge） |
| 2026-06-26 | escapeXml 收斂單一來源：`renderTextPages` 與 `scorm` 兩份相同 escapeXml 抽到 `escapeXml.ts`（前者 re-export、後者 import）；相關測試 23 通過、後端 build 通過 | refactor/dedupe-escape-xml（已 merge） |
| 2026-06-26 | sanitiseUserPrompt 收斂單一來源：generateTitle/generateScript 兩份相同的 prompt 截斷函式抽到 `promptSanitize.ts`（含 2000 字上限常數）；promptSanitize.test.ts +4、後端 build 通過 | refactor/dedupe-sanitise-user-prompt（已 merge） |
| 2026-06-26 | sumAudioDurationSeconds 收斂單一來源：pipeline/regenerate 兩份相同的音訊長度加總抽到 `audioDurationSum.ts`；audioDurationSum.test.ts +3、後端 build 通過 | refactor/dedupe-sum-audio-duration（已 merge） |
| 2026-06-26 | WAV PCM 助手抽離可測模組：`parseWavPcmChunk`/`buildWavPcm16` 抽到 `services/wav.ts`（synthesizeAudio re-export、刪除 shared.ts 死碼）；wav.test.ts +4、後端 build 通過 | refactor/extract-wav-helpers（已 merge） |
| 2026-06-26 | 版本歷史對話框 Esc／背景關閉：`VersionHistoryDialog` 套用共用 `useOverlayDismiss`，補 Escape/背景關閉與 `role=dialog`/aria；前端 380 測試通過 | feat/version-history-dialog-dismiss（已 merge） |
| 2026-06-26 | 額度用盡對話框 Esc／背景關閉：`CreditExhaustedDialog` 套用共用 `useOverlayDismiss`（useCallback 穩定 close）；前端 380 測試通過 | feat/credit-exhausted-dialog-dismiss（已 merge） |
| 2026-06-26 | 課後報告面板 Esc／背景關閉：`PostClassReportPanel` 套用共用 `useOverlayDismiss`；前端 380 測試通過 | feat/post-class-report-dismiss（已 merge） |
| 2026-06-26 | 首頁搜尋納入描述：抽出純函式 `pdfMatchesSearch`（title/tags/description），首頁列表過濾改用之；HomePage.search.test.ts +4；前端 384 測試通過 | feat/home-search-description（已 merge） |
| 2026-06-26 | cosineSimilarity 抽離可測模組：語意搜尋排序的 `cosineSimilarity` 抽到純 `services/cosineSimilarity.ts`（embeddings re-export）；cosineSimilarity.test.ts +5、後端 build 通過 | refactor/extract-cosine-similarity（已 merge） |
| 2026-06-26 | 修正貼上圖片 object URL 卸載洩漏：`useChatAndImageEdit` 加 unmount cleanup 釋放未送出貼上圖片的 blob URL（修 SPA 反覆進出播放頁的 blob 累積）；前端 384 測試通過 | fix/chat-pasted-image-url-leak（已 merge） |
| 2026-06-26 | 搜尋片段函式抽離可測模組：`extractSnippet`(+`SNIPPET_CONTEXT`) 抽到純 `routes/pdfs/searchSnippet.ts`，search.ts 改 import；searchSnippet.test.ts +5、後端 build 通過 | refactor/extract-search-snippet（已 merge） |
| 2026-06-26 | formatDurationMs 負值守門：負時長改回 noRecordLabel（原會輸出 `-5ms`）；formatters.test.ts +1；前端 384 測試通過 | fix/format-duration-negative-guard（已 merge） |
| 2026-06-26 | 投票選項上限/索引上界以常數連結：引入 `MAX_POLL_OPTIONS`，`CreatePollBodySchema`/`VotePollBodySchema` 由它推導邊界（防調高選項上限卻漏改索引上界）；後端 build 通過 | refactor/poll-max-options-constant（已 merge） |
| 2026-06-26 | 前端投票選項上限驗證：`handleCreatePoll` 補 `> MAX_POLL_OPTIONS`(6) 檢查，送出前以 `play.sidebar.poll.maxOptions` 友善訊息攔下；zh/en 各 +1 key；前端 384 測試通過 | feat/poll-max-options-frontend-validation（已 merge） |
| 2026-06-26 | 測驗答對判定收斂單一來源：`isCorrectAnswer` 抽到 `services/quizCorrectness.ts`，`quizzes.ts` 與 `report.ts`(2處) 共用（防報告與計分判定漂移）；quizCorrectness.test.ts +4、後端 build 通過 | refactor/dedupe-quiz-correctness（已 merge） |
| 2026-06-26 | 前後端 isCorrectAnswer 一致性 drift-guard：新增跨套件測試斷言後端/前端 `isCorrectAnswer` 在 11 個案例一致；後端 build 通過 | test/quiz-correctness-consistency（已 merge） |
| 2026-06-26 | 後端測驗計分抽離可測+守門：`calcQuestionScore`/`normalizeQuestionScores` 抽到純 `services/quizScoring.ts`，quizzes.ts 改 import；quizScoring.test.ts +5、quizScoringConsistency.test.ts +2（前後端一致）；後端 build 通過 | refactor/extract-backend-quiz-scoring（已 merge） |
| 2026-06-26 | 遙控器投影片預覽隱藏破圖：`RemoteControllerPage` 預覽 `<img>` 加 `onError` 載入失敗隱藏；前端 384 測試通過 | fix/remote-controller-img-onerror（已 merge） |
| 2026-06-26 | 圖表資產縮圖隱藏破圖：`FigureAssetsTab` 縮圖 `<img>` 加 `onError` 載入失敗隱藏；前端 384 測試通過 | fix/figure-assets-img-onerror（已 merge） |
| 2026-06-26 | 新增頁面對話框縮圖隱藏破圖：`AddPagesFromPromptModal` 頁面縮圖 `<img>` 加 `onError`（前端 img 破圖降級全面補齊）；前端 384 測試通過 | fix/add-pages-modal-img-onerror（已 merge） |
| 2026-06-26 | 下拉焦點不觸發快捷鍵：`PlayPage` 兩處 keydown 守門加 `SELECT`（修方向鍵改下拉同時切頁的雙重動作）；前端 384 測試通過 | fix/keyboard-ignore-select（已 merge） |
| 2026-06-26 | 評論討論串（2.9）：新增 `page_comments` DB 資料表 + index；後端 GET/POST/PATCH/DELETE 四個端點；前端 `CommentsSection`（sky 色調，顯示/新增/標記已處理/刪除）；i18n 10 個 key；9 個 node:test | feat/page-comments（已 merge） |
| 2026-06-26 | interact tab badge 計入 reviewItems：`computeNotebookTabCounts` 加 `reviewItems?` 選用參數；`PlayPageSidebar` 主元件計算 pdfId 對應複習項目數並傳入；notebookTabs.test.ts +2 測試；前端 typecheck 通過 | feat/interact-tab-badge-review-items（已 merge） |

## 新增可執行項目（第九十八輪）

- [x] interact tab badge 計入 reviewItems：`computeNotebookTabCounts` 的 `interact` tab 目前計入 bookmarks + important + polls，但遺漏了複習清單項目數（`reviewItems`，存於 localStorage）。補充：① `notebookTabs.ts` 的 `computeNotebookTabCounts` 加入 `reviewItems` 參數並納入 `interact` 計數；② `PlayPageSidebar.tsx` 呼叫時透過 `getReviewItems().filter(x => x.pdfId === pdfId)` 傳入當前 PDF 的複習項目數；③ `notebookTabs.test.ts` 補含 reviewItems 的測試案例。
  - 修改說明（2026-06-26）：`notebookTabs.ts` 的 `computeNotebookTabCounts` 加入 `reviewItems?` 選用參數（預設 0），`interact` 計數改為 `bookmarks + important + polls + reviewItems`；`PlayPageSidebar.tsx` 主元件新增 `pdfId` 解構並計算 `reviewItemCount = getReviewItems().filter(x => x.pdfId === pdfId).length`，傳入 `computeNotebookTabCounts`；`notebookTabs.test.ts` +2 測試。前端 typecheck 通過。分支 `feat/interact-tab-badge-review-items`，已 merge 回 master。
  - 計數：自上次「---- 計數重設 ----」(2026-06-26) 起算，本項為第 49 個完成項目（49/100，未達上限）。

- [x] 評論相對時間顯示：`CommentsSection` 的評論時間目前以 `new Date(c.created_at).toLocaleString()` 顯示完整日期，閱讀不直覺。改以相對時間（如「剛剛」、「3 分鐘前」、「2 小時前」、「昨天」、超過 3 天改回絕對日期）顯示。新增純函式 `formatRelativeTime(isoString, now?)` 至 `frontend/src/lib/formatRelativeTime.ts`，`CommentsSection` 改用之；`formatRelativeTime.test.ts` 補測試（各區間邊界）；i18n 無需改動（直接中文或英文組字串即可）。
  - 修改說明（2026-06-26）：新增 `frontend/src/lib/formatRelativeTime.ts` 純函式（<60s→剛剛、<60m→N 分鐘前、<24h→N 小時前、1天→昨天、<3天→N 天前、≥3天→toLocaleDateString）；`CommentsSection` import 並將時間 span 改用 `formatRelativeTime`，同時加 `title` 屬性保留完整日期 tooltip；`formatRelativeTime.test.ts` +7 測試（各邊界+無效輸入）；前端 typecheck 通過。分支 `feat/comment-relative-time`，已 merge 回 master。
  - 計數：自上次「---- 計數重設 ----」(2026-06-26) 起算，本項為第 50 個完成項目（50/100，未達上限）。

- [x] 評論全覽端點：目前評論 API 只能依頁碼查詢（`GET /api/pdfs/:id/pages/:n/comments`），教師無法一次看到 PDF 所有評論。新增 `GET /api/pdfs/:id/comments`（不含 page_number）端點，以 `page_number ASC, created_at ASC` 排序回傳全部評論；`backend/test/page-comments-all.test.ts` 補 GET/403/404 測試；前端 `listAllPageComments(id)` API；在 `CommentsSection` 標題旁加入「全部」切換鈕以呈現跨頁評論清單。
  - 修改說明（2026-06-26）：`comments.ts` 新增 `GET /api/pdfs/:id/comments` 端點（IdParamSchema，回傳全 PDF 評論以 page ASC+time ASC 排序）；前端 `listAllComments(id)` API；`CommentsSection` 新增 `showAll` state，切換後 useEffect 呼叫不同 fetch；「全部/此頁」按鈕在標題列右側；全覽模式每則評論顯示可跳頁的頁碼；i18n zh-TW/en 各 +2 key；`page-comments-all.test.ts` +6 測試。前端+後端 typecheck 通過。分支 `feat/comments-list-all`，已 merge 回 master。
  - 計數：自上次「---- 計數重設 ----」(2026-06-26) 起算，本項為第 51 個完成項目（51/100，未達上限）。

- [x] 評論 CSV 匯出：新增 `GET /api/pdfs/:id/comments.csv` 後端端點，以 CSV 格式輸出所有評論（欄位：`page,author,text,resolved,created_at`），沿用共用 `csvEscape` 防 formula injection；需 edit 權限（沿用 `canEditPdf`）；播放頁 `CommentsSection` 區塊加入「匯出 CSV」按鈕（以 download link 觸發）；補後端 node:test（200/403/CSV 欄位格式）。
  - 修改說明（2026-06-26）：後端 `comments.ts` 新增 `GET /api/pdfs/:id/comments.csv`，以 `page_number ASC, created_at ASC` 排序輸出全 PDF 評論，欄位 `page,author,text,resolved,created_at`（resolved 以 `true`/`false` 字串呈現），沿用共用 `csvEscape`（formula injection 防護 + RFC4180 quoting），權限沿用 `canEditPdf`（需編輯權限，public 唯讀亦 403），回應帶 `text/csv` content-type、`attachment; filename="comments-<id>.csv"` 與 `cache-control: no-store`。前端 `CommentsSection`（`PlayPageSidebar.tsx`）標題列在有評論時顯示「匯出 CSV」download 連結（指向 `api/pdfs/:id/comments.csv`）；新增 zh-TW/en `play.sidebar.commentsExportCsv` i18n key。新增 `backend/test/comments-csv.test.ts`（7 測試：CSV 排序/欄位、escaping+formula injection、空清單僅 header、private 403、public 403、public_editable 200、404）。前端+後端 `tsc --noEmit` 皆通過；後端 handler 測試需 better-sqlite3 native module，於 sandbox 無法載入，留 CI 執行。分支 `feat/comments-csv-export`，已 merge 回 master。
  - 計數：自上次「---- 計數重設 ----」(2026-06-26) 起算，本項為第 53 個完成項目（53/100，未達上限）。

- [x] 投票結果橫條圖：播放頁 Realtime Poll 及 `RemoteControllerPage` 投票結果目前以純文字「選項 A：3 票（50%）」呈現。改為在每個選項右側加入 CSS 橫條圖（背景色條，寬度 = `ratio * 100%`，不需 chart library）；不調整現有資料型別，純 JSX+Tailwind 改動；i18n 無需改動。
  - 修改說明（2026-06-26）：①`PlayPageFullscreen.tsx` 全螢幕大型 Realtime Poll overlay 原本在 `syncPollShowResults` 時僅以「N 票 · X%」純文字呈現各選項結果，現於每個選項文字下方加入 CSS 橫條圖（`h-1.5` 圓角底條 + `bg-cyan-400` 寬度 `ratio%`，含 `transition-[width]`），ratio 改為每選項計算一次。②`RemoteControllerPage.tsx` Poll 控制區原本只顯示每個 poll 的總票數，無逐選項分布；現於 poll 標題列下方新增逐選項結果（選項文字 + 「N 票 · X%」+ 橫條圖），讓遙控端操作者也能看到即時票數分布；外層 div 由 `flex items-center` 改為直式容器、原本的標題/狀態/按鈕收進上方 row。其餘已有橫條圖的位置（`PlayPageSidebar`、`PlayPageFullscreen` 小型 overlay）維持不變。純 JSX+Tailwind 改動，不動資料型別，沿用既有 `remote.votesSuffix` i18n key、無新增 key。前端 typecheck 通過。分支 `feat/poll-result-bars`，已 merge 回 master。
  - 計數：自上次「---- 計數重設 ----」(2026-06-26) 起算，本項為第 52 個完成項目（52/100，未達上限）。

## Theme 功能規畫（使用者指定，2026-06-26）

- 目前觀察：前端 Tailwind 設定仍是空的 `extend`，全域 CSS 只設定高度與字型；SettingsPage 已有 UI/content language 與 playback speed 這類 localStorage + 設定頁偏好的模式，可沿用於 theme 偏好。Theme 應先以「不動後端資料模型」的前端 MVP 做起，避免牽涉帳號同步、資料 migration 與大量元件重寫。
- 設計目標：支援 `system`／`light`／`dark` 三種模式；預設 `system` 跟隨瀏覽器 `prefers-color-scheme`；使用者選擇寫入 localStorage；套用時在 `<html>` 加 `data-theme` 或 `class="dark"`，並透過 CSS variables 統一背景、文字、卡片、邊框、互動色。
- 實作原則：先建立主題基礎設施與少數高頻頁面/元件的 token 化，後續再逐步掃描替換散落的 Tailwind 灰階/白底/黑字 class；避免一次性大改所有 UI，降低回歸風險。

- [x] Theme 基礎設施 MVP：新增 `frontend/src/lib/theme.ts`，定義 `ThemePreference = 'system' | 'light' | 'dark'`、localStorage key、`getStoredThemePreference()`、`resolveThemePreference()`、`applyThemePreference()`；監聽 `prefers-color-scheme` 變化，在 `system` 模式自動更新實際 theme；補純函式測試（預設值、壞值 fallback、system/light/dark resolve、套用 class/data attribute）。
  - 修改說明（2026-06-26）：新增 `frontend/src/lib/theme.ts`，定義 `ThemePreference`/`ResolvedTheme` 型別、`THEME_STORAGE_KEY = 'makeslide.theme'`，以及 `normalizeThemePreference`（收斂壞值→`system`）、`getStoredThemePreference`/`setStoredThemePreference`（localStorage，含非瀏覽器防護）、`getSystemTheme`（讀 `matchMedia('(prefers-color-scheme: dark)')`，無 matchMedia 回 `light`）、`resolveThemePreference`（`system` 依 OS 解析成 light/dark，省略參數時讀已存偏好）、`applyThemePreference`（套用到 `<html>`：toggle `dark` class 供 Tailwind `dark:` variant、設 `data-theme` 供 CSS variables，回傳實際 ResolvedTheme）、`watchSystemThemeChange`（監聽 OS 變化，僅在偏好為 `system` 時重新套用並回報，回傳取消監聽函式）。全部存取皆做 SSR/測試環境防護，慣例沿用 `i18n.ts`、`viewerId.ts`。新增 `frontend/src/lib/theme.test.ts` 共 10 個純函式測試（normalize、預設/壞值 fallback、set/get、getSystemTheme、light/dark/system resolve、套用 class+data-theme、system 跟隨 OS、watch 僅在 system 模式作用、無 window/document 優雅降級），`node --test` 全通過、前端 `tsc --noEmit` 通過。此為 Theme 功能系列第 1 項（基礎設施），尚未接 UI；後續 CSS token 化、設定頁選項、防白閃、暗色適配為獨立項目。分支 `feat/theme-infrastructure`，已 merge 回 master。
  - 計數：自上次「---- 計數重設 ----」(2026-06-26) 起算，本項為第 54 個完成項目（54/100，未達上限）。

- [x] Tailwind/CSS token 化：在 `frontend/src/index.css` 新增 CSS variables（如 `--color-bg`、`--color-surface`、`--color-text`、`--color-muted`、`--color-border`、`--color-primary`、`--color-danger`），提供 light/dark 兩組值；更新 `frontend/tailwind.config.js` 的 `theme.extend.colors` 以 `rgb(var(--...)/<alpha-value>)` 暴露 `bg`, `surface`, `text`, `muted`, `border`, `primary` 等語意色，讓後續元件可用語意 class 取代硬編 `white/slate/gray`。
  - 修改說明（2026-06-26）：`index.css` 新增 `:root`（light）與 `.dark` 兩組 CSS 變數，值以空白分隔 RGB 三元組表示，涵蓋 `--color-bg/surface/text/muted/border/primary/danger`；dark 值刻意貼齊專案既有 slate/cyan 深色視覺（bg slate-950、surface slate-900、text slate-200、border slate-700、primary cyan-400 等）。`tailwind.config.js` 設 `darkMode: 'class'`（配合 `lib/theme.ts` 在 `<html>` 切換 `dark` class，使 OS 偏好可被使用者覆寫），並在 `theme.extend.colors` 以 `rgb(var(--color-*) / <alpha-value>)` 暴露 `bg/surface/text/muted/border/primary/danger` 語意色。以 tailwind CLI 編譯驗證：`:root`/`.dark` 變數區塊、`dark:` variant（`:is(.dark *)`）、語意 class 與透明度修飾（如 `bg-surface/80` → `rgb(var(--color-surface) / 0.8)`）皆正確產出；前端 `tsc --noEmit` 通過。此項只建立 token 基礎，未改動任何元件既有 class（屬 Theme 系列第 2 項）。分支 `feat/theme-css-tokens`，已 merge 回 master。
  - 計數：自上次「---- 計數重設 ----」(2026-06-26) 起算，本項為第 55 個完成項目（55/100，未達上限）。

- [x] 設定頁加入 Theme 選項：在 `SettingsPage` 的帳號/偏好區加入「外觀主題」select（跟隨系統／淺色／深色），沿用既有語言設定的 localStorage 模式；切換後立即呼叫 `applyThemePreference()`，不需按儲存；補 zh-TW/en i18n key；若目前尚未把 theme 納入後端 `SystemAiSettings`，先明確維持本機偏好，避免影響多帳號設定 API。
  - 修改說明（2026-06-26）：`SettingsPage.tsx` 帳號/偏好區（播放速度 select 之後）新增「外觀主題」select（跟隨系統 / 淺色 / 深色），初值由 `getStoredThemePreference()` 取得；新增 `handleThemeChange` 於 onChange 立即 `setStoredThemePreference()` + `applyThemePreference()`，不經 Save 按鈕（明確維持為純本機偏好，未納入後端 `SystemAiSettings` / 設定 API，避免影響多帳號）。新增 zh-TW/en i18n key `settings.theme`/`themeSystem`/`themeLight`/`themeDark`/`themeHint`。前端 `tsc --noEmit` 通過、`i18n.test.ts`（含 zh/en key 對等檢查）24 測試全通過。注意：此項只做設定頁切換與即時套用；「App 啟動前套用 stored theme 避免白閃」為 Theme 系列下一獨立項目（在那之前重新整理頁面需再進設定頁才會重新套用）。屬 Theme 系列第 3 項。分支 `feat/settings-theme-option`，已 merge 回 master。
  - 計數：自上次「---- 計數重設 ----」(2026-06-26) 起算，本項為第 56 個完成項目（56/100，未達上限）。

- [x] App 啟動前避免 theme flash：在 `frontend/src/main.tsx` 或 `frontend/index.html` 的最早可行位置套用 stored theme（優先避免 first paint 白閃）；確保 React hydration 後與 hook 狀態一致；若使用 inline script，需保持無外部依賴且不讀取敏感資料。
  - 修改說明（2026-06-26）：`index.html` 於 `<head>` 最前（charset 後、其他資源前）加入一段自包含 inline script，在首屏 paint 前讀 `localStorage['makeslide.theme']`，依 `system→matchMedia('(prefers-color-scheme: dark)')` 解析後 toggle `<html>` 的 `dark` class 並設 `data-theme`；邏輯刻意鏡像 `lib/theme.ts`，無 import / 無網路、只讀公開的 theme 偏好、以 try/catch 包覆（localStorage 不可用時保留原 `class="dark"` no-JS fallback）。`main.tsx` 在 render 前 `applyThemePreference()` 再套用一次確保與 bundle 邏輯一致，並 `watchSystemThemeChange()` 讓 `system` 模式在執行期跟隨 OS 變化。確認專案無 CSP，inline script 可執行。前端 `tsc --noEmit` 通過、`theme.test.ts` 10 測試全通過（inline script 為 HTML 內嵌、邏輯已由 theme.ts 單元測試覆蓋，不另加測試）。屬 Theme 系列第 4 項；元件實際淺色外觀適配為下一獨立項目。分支 `feat/theme-no-flash`，已 merge 回 master。
  - 計數：自上次「---- 計數重設 ----」(2026-06-26) 起算，本項為第 57 個完成項目（57/100，未達上限）。

- [x] 高頻畫面第一批暗色模式適配：將 HomePage、PlayPage 外層、SettingsPage 主要卡片/表單、PdfCard 的白底/灰底/黑字/邊框 class 改為語意 token class；保留現有品牌色與狀態色但確認 dark 下對比足夠；不在此項一次處理所有深層播放頁子元件。
  - 修改說明（2026-06-26）：採「dark token 值 == 現有 slate 值」的精確對應做機械式轉換，使 **dark 模式渲染保持一致、零回歸**，light 模式則部分生效（符合「第一批、漸進」定位）。在 `components/PdfCard.tsx`、`pages/HomePage.tsx`、`pages/SettingsPage.tsx`、`pages/PlayPage.tsx`（外層；深層播放頁子元件 `pages/play/*` 不動）四檔，將 `bg-slate-950→bg-bg`、`bg-slate-900→bg-surface`、`text-slate-200→text-text`、`text-slate-400→text-muted`、`border-slate-700→border-border`（含 `/opacity` 變體一併正確對應，如 `bg-slate-900/40→bg-surface/40`）；另把 `index.html` body 全域底色 `bg-slate-950 text-slate-100→bg-bg text-text`，避免 light 模式透出深色底。品牌色（cyan/emerald/violet…）與狀態色（rose/amber…）及其他中間 slate 階（100/300/500/800）刻意保留不動，避免壓平 dark 視覺層次。前端 `tsc --noEmit` 通過；tailwind CLI 確認語意 class 正常產出；HomePage/PdfCard/theme 相關 24 測試全通過。屬 Theme 系列第 5 項；其餘 slate 階與深層子元件的 light 微調為後續迭代（見系列第 6 項與 FUTURE）。分支 `feat/theme-dark-adapt-batch1`，已 merge 回 master。
  - 計數：自上次「---- 計數重設 ----」(2026-06-26) 起算，本項為第 58 個完成項目（58/100，未達上限）。

- [x] Theme 回歸測試與文件：新增/更新測試確認 theme preference helper 與 i18n key 對等；手動檢查 light/dark/system 三模式下首頁、播放頁、設定頁；在 README 或 BLOG 補一小段使用說明（若功能對使用者可見，依專案慣例記錄）。
  - 修改說明（2026-06-26）：① theme preference helper 已於系列第 1 項由 `lib/theme.test.ts`（10 測試）覆蓋；② i18n 對等：既有 `i18n.test.ts` 通用 parity 測試已涵蓋全部 key（含 theme），但該測試在「某 key 從 zh/en 同時消失」時仍會通過，故新增 `frontend/src/i18n.theme-keys.test.ts`（1 測試）明確斷言 `settings.theme`/`themeSystem`/`themeLight`/`themeDark`/`themeHint` 五個 key 於兩語系皆存在且非空，作為 Theme 功能的回歸守門；③ 文件：在 `README.md`「開發中 / Unreleased」新增雙語「外觀主題 / Appearance Theme」段落，說明選項位置、即時套用、本機偏好、防白閃、語意 token 基礎與第一批適配範圍（BLOG.md 已於系列各項逐篇記錄）。前端 `tsc --noEmit` 通過、新測試與既有 theme/i18n 測試全通過。關於「手動檢查 light/dark/system 三模式」：自動 loop 環境無法啟動瀏覽器逐頁視覺確認；惟系列第 5 項採「dark token 值 == 原 slate 值」對應，**深色（現行預設）為建構上零回歸**，淺色模式之細部色階屬漸進完善（見 FUTURE），建議由使用者於正式環境快速目視 light 模式。Theme 功能系列（第 1～6 項）至此完成。分支 `feat/theme-tests-docs`，已 merge 回 master。
  - 計數：自上次「---- 計數重設 ----」(2026-06-26) 起算，本項為第 59 個完成項目（59/100，未達上限）。

## 掃描摘要（第九十九輪，2026-06-26）

- 觸發原因：TODO.md 目前剩餘的未完成項目只有兩個明確標註「待使用者決定 / 待處理」者——①系統性採用 `mapApiErrorToHumanMessage`（範圍大、需產品判斷顯示風格）、②把前端測試納入 root `npm test`（涉 CI 行為變更 / 需 `npm install`，sandbox 無法驗證）——依其說明皆不宜在自動 loop 中逕行。故依 LOOP.md 第 2 條，分析現有程式並對照 `docs/FUTURE_ROADMAP.md` 補充新的可執行項目。
- 現況觀察：匯出能力已相當完整（`comments.csv`、`poll-results.csv`、`quiz-results.csv`、`report/students.csv`、`subtitles.srt`/`.vtt`）；課後報告（Phase 1）已具最難題、最分歧投票頁、最低完成率頁三榜單（`reportSummary.ts`）；遙控器、同步、投票橫條圖、Theme 等近期皆已完成。
- 取材方向：聚焦 Roadmap Phase 1（把互動資料變成教學洞察）與 Phase 4/5（教材資產與匯出）中「小顆粒、可單輪完成、可加單元/handler 測試、低視覺風險」的延伸，避免一次吃下大型功能。

## 新增可執行項目（第九十九輪，2026-06-26）

- [x] 評論區關鍵字過濾（Roadmap Phase 4 雛形 / 可用性）：在 `CommentsSection`（`frontend/src/pages/play/PlayPageSidebar.tsx`）標題列下方加入一個關鍵字輸入框，即時過濾目前清單；抽出純函式 `filterComments(comments, query)`（不分大小寫、同時比對 `text` 與 `author`，空字串回全部）置於 `frontend/src/lib/`（新檔，例如 `commentFilter.ts`）並補單元測試（空白/大小寫/比對欄位/無符合）；新增 zh-TW/en placeholder i18n key。純前端、不動後端與資料型別。
  - 修改說明（2026-06-26）：新增 `frontend/src/lib/commentFilter.ts` 之純函式 `filterComments<T extends {text,author}>(comments, query)`（trim + toLowerCase，命中內文或作者任一即保留，空查詢回原陣列不複製）；`CommentsSection` 新增 `filterQuery` state 與輸入框（僅在有評論時顯示，置於空狀態提示之後、清單之前），渲染改用 `visibleComments = filterComments(comments, filterQuery)`，並在「有評論但過濾後為空」時顯示 `commentsNoMatch` 提示。新增 zh-TW/en i18n key `play.sidebar.commentsFilterPlaceholder`/`commentsNoMatch`。新增 `commentFilter.test.ts` 6 測試（空白/大小寫/作者欄位/trim/非 ASCII/無符合）。前端 `tsc --noEmit` 通過、`commentFilter.test.ts` 與 `i18n.test.ts`（含 zh/en 對等）全通過。分支 `feat/comment-filter`，已 merge 回 master。
  - 計數：自上次「---- 計數重設 ----」(2026-06-26) 起算，本項為第 60 個完成項目（60/100，未達上限）。

- [x] 報告摘要「複製為 Markdown」（Roadmap Phase 1 可用性）：在 `PostClassReportPanel`（`frontend/src/pages/play/PostClassReportPanel.tsx`）的工具列加入「複製摘要」按鈕；於 `frontend/src/pages/play/reportSummary.ts` 新增純函式 `formatReportSummaryMarkdown(summary)`，輸出「最難測驗題 / 最分歧投票頁 / 最低完成率頁」三榜單與整體數字的 Markdown，沿用既有 `getHardestQuestions`/`getMostDivergentPollPages`/`getLowestCompletionPages` 與 `formatReportPercent`；以 `lib/clipboard.ts` 的 `copyTextToClipboard` 觸發複製並顯示短暫提示；補 `reportSummary` 純函式測試（含 summary 為 null / 各榜單為空的情況）；新增 zh-TW/en i18n key。
  - 修改說明（2026-06-26）：`reportSummary.ts` 新增 `ReportMarkdownLabels` 介面與純函式 `formatReportSummaryMarkdown(summary, labels, pdfTitle?)`——所有顯示文字由 labels 注入（保持函式純粹可測、i18n 留在元件層），輸出整體數字（參與人數 / 測驗平均 / 投票參與率）與三榜單（最難測驗題附答錯率與 wrong/attempt、最分歧投票頁附頁碼/題目/票數、最低完成率頁附完成率與 completed/total）；summary 為 null 回空字串、各榜單為空時輸出 `none` label；沿用既有三個 ranking helper 與 `formatReportPercent`/`formatReportNumber`。`PostClassReportPanel` 工具列加「複製摘要」按鈕（`summary` 為空時 disabled），`handleCopySummary` 以 `copyTextToClipboard` 複製並顯示 2 秒 `copyDone`/`copyFail` 提示；重用既有 `cardParticipants`/`cardQuizAvg`/`hardestTitle`/`divergentTitle`/`lowestTitle`/`pagePrefix` key，新增 `play.report.copySummary`/`copyHeading`/`copyPollParticipation`/`copyNone`/`copyDone`/`copyFail`（zh-TW/en）。`reportSummary.test.ts` 補 3 測試（null→空字串、空榜單→3 個 none、有資料→三榜單行格式）。前端 `tsc --noEmit` 通過、`reportSummary.test.ts` 與 `i18n.test.ts` 全通過。分支 `feat/report-copy-markdown`，已 merge 回 master。
  - 計數：自上次「---- 計數重設 ----」(2026-06-26) 起算，本項為第 62 個完成項目（62/100，未達上限）。

- [x] 每頁學習分析 CSV 匯出（Roadmap Phase 1）：新增後端 `GET /api/pdfs/:id/report/pages.csv`（欄位 `page_number,total_viewers,completed_viewers,completion_rate,poll_total_votes,poll_divergence_score`），資料沿用 `report/summary` 既有的 watch_progress 與 polls 聚合來源，以共用 `csvEscape`（`backend/src/routes/pdfs/csv.ts`）輸出、權限沿用 `canEditPdf`、回應帶 `text/csv` 與 `attachment; filename`；在 `PostClassReportPanel` 既有 CSV 下載按鈕群加入「每頁分析 CSV」連結；補後端 node:test（200 欄位/排序、403 無編輯權限、404 未知 PDF）。
  - 修改說明（2026-06-26）：`backend/src/routes/pdfs/report.ts` 在 `report/students.csv` 之後新增 `GET /api/pdfs/:id/report/pages.csv`。以 `pages` 為列集左連 `page_watch_progress` 聚合每頁 `total_viewers`/`completed_viewers`（`completion_rate = completed/total`，無觀看者為 0），並以 `page_polls JOIN page_poll_votes` 依 `page_number, option_index` 聚合，於 JS 端計每頁 `poll_total_votes` 與 `poll_divergence_score = 1 - 最大選項得票/總票`（0=共識，越高越分歧，無票為 0），rate/divergence 四捨五入到小數 4 位。沿用共用 `csvEscape`、權限 `canEditPdf`（owner 或 public_editable），回應 `text/csv; charset=utf-8` + `attachment; filename="report-pages-<id>.csv"`，依 `page_number ASC` 排序。前端 `PostClassReportPanel` 在投票 CSV 連結後加入「每頁分析 CSV」download 連結；新增 zh-TW/en `play.report.exportPagesCsv`。新增 `backend/test/report-pages-csv.test.ts`（3 測試：欄位/排序/divergence 計算、403 非擁有者、404 未知 PDF）。前端+後端 `tsc --noEmit` 皆通過、`i18n.test.ts` 對等通過；後端 handler 測試需 better-sqlite3 native module，sandbox 無法載入，留 CI 執行。分支 `feat/report-pages-csv`，已 merge 回 master。
  - 計數：自上次「---- 計數重設 ----」(2026-06-26) 起算，本項為第 63 個完成項目（63/100，未達上限）。

- [x] 評論未解決數徽章（可用性，小顆粒）：`CommentsSection`（`PlayPageSidebar.tsx`）標題徽章目前只顯示評論總數；改為同時呈現未解決數（如 `2 / 5`，未解決 / 總數），抽出純函式 `countUnresolvedComments(comments)`（回傳 `resolved === false` 的數量）置於 lib 並補單元測試；全解決或無評論時的顯示需處理（例如全解決顯示總數即可）。純前端、不動後端。
  - 修改說明（2026-06-26）：新增 `frontend/src/lib/commentStats.ts` 之純函式 `countUnresolvedComments<T extends {resolved}>(comments)`（reduce 計 `resolved === false` 數）；`CommentsSection` 徽章改為：有未解決且非全部未解決（`0 < unresolved < total`）時顯示 `未解決/總數`（如 `2/5`），否則（全解決或全未解決或空）顯示總數，並加 `title` tooltip（i18n `commentsUnresolvedTitle`，含 `{unresolved}`/`{total}` 佔位）。新增 zh-TW/en i18n key `play.sidebar.commentsUnresolvedTitle`。新增 `commentStats.test.ts` 4 測試（空/全解決/全未解決/混合）。前端 `tsc --noEmit` 通過、`commentStats.test.ts` 與 `i18n.test.ts`（含 zh/en 對等及佔位符集合檢查）全通過。分支 `feat/comment-unresolved-badge`，已 merge 回 master。
  - 計數：自上次「---- 計數重設 ----」(2026-06-26) 起算，本項為第 61 個完成項目（61/100，未達上限）。

## 工作記錄（第九十九輪，2026-06-26）

- 工作內容：可執行項目僅剩兩個「待使用者決定 / 待處理」項目，依 LOOP.md 第 2 條改為分析現有程式並對照 `docs/FUTURE_ROADMAP.md`，於 TODO.md 新增 4 個小顆粒、可單輪完成、可加測試、低風險的可執行項目（評論關鍵字過濾、報告摘要複製為 Markdown、每頁學習分析 CSV 匯出、評論未解決數徽章），並補掃描摘要。本輪未完成功能項目（屬規畫輪），不計入 100 完成計數（計數維持 59/100）。
- 時間：2026-06-26
- 分支：直接於 master 更新 TODO.md（規畫輪，無程式碼變更）

## 掃描摘要（第一〇一輪，2026-06-26）

- 觸發原因：上一批（第九十九輪）新增的 4 個可執行項目已全數完成，TODO.md 又只剩兩個「待使用者決定 / 待處理」項目（`mapApiErrorToHumanMessage` 全面套用、前端測試納入 root `npm test`），依其說明不宜於自動 loop 逕行。故依 LOOP.md 第 2 條再次分析程式並對照 `docs/FUTURE_ROADMAP.md` 補新項目。
- 現況觀察：匯出（comments/poll/quiz/students/pages CSV、subtitles srt/vtt）與課後報告三榜單、報告摘要複製、評論過濾/未解決徽章、Theme 系列等近期皆已完成；HomePage 排序已涵蓋 title/created/updated/page_count/audio/last_played，無需再加。
- 取材方向：Roadmap Phase 2（個人化複習清單）、Phase 1（逐頁分析細化）與通用可用性中「小顆粒、可單輪完成、可加單元/handler 測試、低風險」的延伸。

## 新增可執行項目（第一〇一輪，2026-06-26）

- [ ] 評論複製為 Markdown（Roadmap Phase 4 / 可用性）：在 `CommentsSection`（`frontend/src/pages/play/PlayPageSidebar.tsx`）標題列加入「複製」按鈕，把目前清單（沿用既有 `filterComments` 過濾後的 `visibleComments`，或全部 `comments`，擇一並於說明標明）輸出為 Markdown 清單；於 `frontend/src/lib/` 新增純函式 `formatCommentsMarkdown(comments, labels)`（每則一行，如 `- [第 N 頁] 作者（已解決）：內文`，labels 注入頁碼/已解決字樣以保持純粹可測），以 `lib/clipboard.ts` 的 `copyTextToClipboard` 複製並顯示短暫提示；補純函式測試（空清單、已解決標記、跨頁）；新增 zh-TW/en i18n key。純前端、不動後端。

- [x] 複習清單複製為 Markdown（Roadmap Phase 2 個人化複習清單）：複習清單區（`PlayPageSidebar.tsx` 的 ReviewList 區塊，資料來自 `lib/reviewList.ts` 的 `getReviewItems`）目前可加入/移除/清空但無法整批帶出。新增純函式 `formatReviewListMarkdown(items, labels)`（輸出 `- 第 N 頁：問題文字` 之類，依 pageNumber 排序）置於 `lib/reviewList.ts` 或新檔並補測試；複習清單標題列加「複製」按鈕，沿用 `copyTextToClipboard` 與短暫提示；新增 zh-TW/en i18n key。純前端。
  - 修改說明（2026-06-26）：`lib/reviewList.ts` 新增 `ReviewMarkdownLabels` 介面與純函式 `formatReviewListMarkdown(items, labels)`——依 `pageNumber` 遞增穩定排序，輸出 `# 標題` + 空行 + 每項 `- 第 N 頁：問題文字`（labels 注入標題與含 `{n}` 的頁碼標籤以保純粹可測），空清單回空字串。`PlayPageSidebar.tsx` 的 `ReviewListSection` 標題列改為左右排版，右側加「複製」按鈕與 `handleCopy`（以 `copyTextToClipboard` 複製、顯示 2 秒 `reviewListCopyDone`/`reviewListCopyFail` 提示），重用既有 `reviewListTitle`/`reviewListPage` 作 labels。新增 zh-TW/en `play.sidebar.reviewListCopy`/`reviewListCopyDone`/`reviewListCopyFail`。`reviewList.test.ts` 補 2 測試（空清單→空字串、依頁排序與 `{n}` 代入）。前端 `tsc --noEmit` 通過、`reviewList.test.ts` 與 `i18n.test.ts` 全通過。分支 `feat/review-list-copy-markdown`，已 merge 回 master。
  - 計數：自上次「---- 計數重設 ----」(2026-06-26) 起算，本項為第 64 個完成項目（64/100，未達上限）。

- [ ] 每頁分析 CSV 增列 avg_listened_ratio（Roadmap Phase 1）：`GET /api/pdfs/:id/report/pages.csv` 現有欄位再加一欄 `avg_listened_ratio`（每頁平均聆聽比例，沿用 `report/summary` 既有的 `AVG(MIN(listened_ms/duration_ms,1))` 計法，無資料以空字串輸出避免誤判為 0）；更新 `backend/test/report-pages-csv.test.ts` 既有斷言的欄位與數值。後端小改 + 測試。

- [ ] 評論「未解決優先」排序（可用性，小顆粒）：在 `CommentsSection` 加入一個切換鈕，開啟時把清單以「未解決在前、其次依現有順序（頁碼/時間）穩定排序」呈現；抽出純函式 `sortCommentsUnresolvedFirst(comments)`（穩定排序，不變動原陣列）置於 `lib/commentStats.ts` 並補測試（全已解決、混合、保持穩定相對序）；切換狀態為純前端 state，不需 i18n 以外的後端改動；新增 zh-TW/en 切換鈕 label key。

## 工作記錄（第一〇一輪，2026-06-26）

- 工作內容：第九十九輪新增的 4 個可執行項目已全部完成，可執行項目又僅剩兩個「待使用者決定 / 待處理」項目，依 LOOP.md 第 2 條分析現有程式並對照 `docs/FUTURE_ROADMAP.md`，於 TODO.md 新增 4 個小顆粒、可單輪完成、可加測試、低風險的可執行項目（評論複製為 Markdown、複習清單複製為 Markdown、每頁分析 CSV 增列 avg_listened_ratio、評論未解決優先排序），並補掃描摘要。本輪為規畫輪，不計入 100 完成計數（計數維持 63/100）。
- 時間：2026-06-26
- 分支：直接於 master 更新 TODO.md（規畫輪，無程式碼變更）
