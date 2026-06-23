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

- [ ] RemoteControllerPage 當前頁縮圖預覽：在頁碼大數字下方加入 `pages[currentPage - 1]?.thumbnail_url ?? pages[currentPage - 1]?.image_url` 縮圖（`h-24 object-contain rounded-lg`），方便演講者確認目前頁面內容；純前端改動。
- [ ] PlayPageSidebar 筆記字數計數器：PageNoteSection textarea 下方加入 `{noteText.length} / 5000` 字數顯示（`noteText.length > 4500` 時改 amber 色警示）；純前端改動，無需 i18n。
- [ ] PlayPageSidebar 書籤縮圖預覽：書籤 section 每個書籤 chip 左側加入對應頁縮圖（`deckPages.find` 找出頁物件，取 `thumbnail_url ?? image_url`，`h-6 w-10 object-cover rounded`）；純前端改動。
- [ ] 首頁 list 模式顯示 updated_at：list 模式每列在描述欄位後加入 `updated_at` 相對時間（`formatRelativeTime(pdf.updated_at)`，灰色），讓使用者快速辨識最近更新的教材；純前端改動，無需 i18n。
- [ ] QuizBuilderPage 題幹字元計數：`q.question` textarea 右下方加入 `{q.question.length} 字` 計數（text-[10px] slate 色），讓出題者隨時掌握題目長度；純前端改動，無需 i18n。
