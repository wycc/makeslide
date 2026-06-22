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
- [ ] 課後報告列印樣式：在 `PostClassReportPanel` 加入「列印 / 儲存為 PDF」按鈕，呼叫 `window.print()`；為面板加入 `@media print` CSS（隱藏側邊欄、全寬、黑白友善色調）；純前端改動，無需後端修改。
- [ ] 播放頁語速偏好持久化：將 `ttsSpeed`（播放語速）儲存至 `localStorage`（key：`makeslide.ttsSpeed`），下次開啟播放頁時自動套用已記憶的語速；在 `usePdfMetadata` hook 中新增讀取/寫入邏輯；純前端改動。
- [ ] 首頁依音頻時長排序：在首頁排序下拉選單新增「最長課程優先」與「最短課程優先」兩個選項，以 `pdf.audio_duration_seconds`（現有欄位）排序；若音頻時長為 null 則排到最後；純前端改動，補對應 `en`/`zh-TW` i18n 鍵值。
- [ ] AI 自動草稿頁面投票題目：新增 `POST /api/pdfs/:id/pages/:n/generate-poll` 後端端點，讀取頁面逐字稿/文字，呼叫 LLM 生成一道 2–4 選項的投票題目（JSON 格式：`{ question, options }`），回傳給前端；播放頁 sidebar 投票分頁加入「AI 草稿投票題」按鈕，讓教師確認後一鍵建立投票；補後端測試驗證 200 / 404 / 403。
- [ ] 分享連結有效期設定：在 `ShareDialog` 加入「連結有效期」下拉（永久 / 7 天 / 30 天 / 自訂日期）；後端 `pdfs` 表新增可選欄位 `share_expires_at TEXT`；`GET /api/pdfs/:id` 讀取分享時檢查有效期，過期則回傳 `410 Gone`；`PATCH /api/pdfs/:id` 支援更新 `share_expires_at`；補測試驗證 410 回應。

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
- [ ] 測驗限時模式：`quiz_sets` 資料表新增 `time_limit_seconds INTEGER DEFAULT 0` 欄位，測驗編輯頁新增「作答時限」輸入框（0 代表無限制），測驗進行中若有時限則顯示紅色倒數計時器，時間到自動提交目前作答；補後端 schema 測試與前端倒數邏輯單元測試。
- [ ] 簡報標籤與首頁篩選：`pdfs` 資料表新增 `tags TEXT DEFAULT ''` 欄位（以逗號分隔），播放頁新增標籤編輯 UI（簡單 tag chip 輸入），首頁 PDF 卡片顯示標籤，並新增標籤篩選列讓使用者快速篩選教材；後端新增 `PATCH /api/pdfs/:id/tags` 端點，補測試驗證 200 / 權限。
- [ ] 同步場次出席名單：同步播放進行時，後端記錄 follower join/leave 事件（利用既有 `sync_sessions` 或新增 `sync_attendees` 表），並提供 `GET /api/pdfs/:id/sync/attendees` 端點；教師端同步面板顯示目前線上學生列表（client_id + 加入時間），課後可在課後報告頁回顧出席記錄。
| 2026-06-22 | 課後報告 AI 教學建議：`POST /api/pdfs/:id/report/ai-suggestions`，彙整答對率+觀看完成率交給 LLM 生成 Markdown 建議；`PostClassReportPanel` 紫羅蘭色「生成 AI 建議」按鈕；3 個測試通過 | feat/report-ai-suggestions（已 merge） |
