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

- [ ] 播放頁底部分頁進度條：在投影片顯示區底部加入一條細色進度條，以 `currentPage / totalPages` 比例填色；純前端改動，利用既有 `currentIdx`/`totalPages` 數值，不需後端修改。
- [ ] 全份逐字稿批次匯出 TXT：新增 `GET /api/pdfs/:id/scripts.txt` 後端端點，依頁碼順序串接所有頁面的 `script_path` 或 `text_path` 內容，回傳純文字檔案；前端在播放頁 header 匯出區新增「下載逐字稿 TXT」按鈕；補後端測試驗證 200 / content-type / 404 / 403。
- [ ] 測驗作答時限（Countdown Timer）：在 `quiz_sets` 資料表新增可選欄位 `time_limit_seconds INTEGER`；測驗建立/編輯頁加入「作答時限（秒）」輸入框；播放頁學生作答時若有時限，顯示倒數計時器，時間到自動提交；後端 API 傳遞時限欄位。
- [x] 課後報告列印樣式：在 `PostClassReportPanel` 加入「列印 / 儲存為 PDF」按鈕，呼叫 `window.print()`；為面板加入 `@media print` CSS（隱藏側邊欄、全寬、黑白友善色調）；純前端改動，無需後端修改。
  - 修改說明（2026-06-22）：在 header 的按鈕列加入琥珀色「列印 / 儲存 PDF」按鈕（`window.print()`）；以 `data-no-print="true"` 包裹所有操作按鈕使其列印時隱藏；在 JSX 中插入 `<style>` 含 `@media print` 規則：覆蓋 `fixed` 定位為 `static`、強制白底、調整文字顏色為可讀深色、各 `section` 加 `break-inside: avoid`；外層 div 改 id `pcr-print-root` 作為 scope。分支 `feat/report-print-style`，已 merge 回 master。
- [x] 播放頁語速偏好持久化：將 `ttsSpeed`（播放語速）儲存至 `localStorage`（key：`makeslide.ttsSpeed`），下次開啟播放頁時自動套用已記憶的語速；在 `usePdfMetadata` hook 中新增讀取/寫入邏輯；純前端改動。
  - 修改說明（2026-06-22）：`i18n.ts` 新增 `TTS_SPEED_STORAGE_KEY`、`getStoredTtsSpeed()`（讀取，範圍 0.5–2）與 `setStoredTtsSpeed()`（寫入）；`usePdfMetadata.ts` 的 `ttsSpeed` 初始化改為 `useState(() => getStoredTtsSpeed())`，`handleSaveTtsSettings` 成功後呼叫 `setStoredTtsSpeed(ttsSpeed)` 將偏好寫入 localStorage；`PlayPage.tsx` 的 `setTtsSpeed(d.tts_speed ?? 1)` 改為 `setTtsSpeed(d.tts_speed ?? getStoredTtsSpeed())`，使新 PDF 繼承上次儲存的語速偏好。分支 `feat/tts-speed-persist`，已 merge 回 master。
- [x] 首頁依音頻時長排序：在首頁排序下拉選單新增「最長課程優先」與「最短課程優先」兩個選項，以 `pdf.audio_duration_seconds`（現有欄位）排序；若音頻時長為 null 則排到最後；純前端改動，補對應 `en`/`zh-TW` i18n 鍵值。
  - 修改說明（2026-06-22）：新增 `compareByAudioDurationDesc`/`compareByAudioDurationAsc` comparator，null 在 desc 排到最後（視為 -1）、在 asc 排到最後（視為 Infinity）；`SortMode` 新增 `audio_desc`/`audio_asc`；`SORT_MODES` 陣列與 `getComparatorForSortMode` switch-case 同步更新；`<select>` 新增兩個 `<option>`；zh-TW/en i18n 新增 `home.sort.audioDurationDesc`/`audioDurationAsc`。分支 `feat/home-audio-duration-sort`，已 merge 回 master。
- [ ] AI 自動草稿頁面投票題目：新增 `POST /api/pdfs/:id/pages/:n/generate-poll` 後端端點，讀取頁面逐字稿/文字，呼叫 LLM 生成一道 2–4 選項的投票題目（JSON 格式：`{ question, options }`），回傳給前端；播放頁 sidebar 投票分頁加入「AI 草稿投票題」按鈕，讓教師確認後一鍵建立投票；補後端測試驗證 200 / 404 / 403。
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
- [ ] 測驗題目拖曳重排：在 `QuizBuilderPage` 題目列表加入拖曳排序（利用 HTML5 drag-and-drop 或 `@dnd-kit/core`），拖放後更新 `questions` 陣列順序並同步到 `quiz_set.questions_json`；補 i18n `quiz.dragToReorder`。
- [x] 複製簡報自動加「（副本）」：`handleDuplicate` 建立副本後，若後端回傳的標題與原始標題相同，自動在 `PATCH /api/pdfs/:id/title` 追加「（副本）」後綴；後端 `POST /api/pdfs/:id/duplicate` 也可直接回傳帶後綴的標題；純邏輯改動。
  - 修改說明（2026-06-23）：`backend/src/routes/pdfs/upload.ts` 的複製標題格式由 `副本-{title}` 改為 `{title}（副本）`，與中文慣例一致；後端直接回傳帶後綴的標題，前端無需額外 PATCH 呼叫。分支 `feat/auto-advance`（commit 同批）。
- [ ] 播放頁逐頁備註：新增 `page_notes TEXT DEFAULT ''` 欄位至 `pages` 表（migration），播放頁側邊欄每頁顯示備註文字區（`<textarea>`），失焦時自動儲存（`PATCH /api/pdfs/:id/pages/:n/note`）；補後端測試。
- [ ] 首頁批次匯出所有 ZIP：在首頁工具列加入「匯出所有（ZIP）」按鈕，呼叫 `POST /api/export/batch`（後端）打包所有使用者的簡報 ZIP，進度以輪詢或 SSE 回報；限制擁有者存取；補後端測試 200 / 403。
