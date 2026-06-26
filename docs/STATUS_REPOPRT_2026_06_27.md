# MakeSlide 狀態報告（2026-06-27）

> 本報告整理截至 2026-06-27（Asia/Taipei）的程式盤點、產品現況、競品功能觀察、差距分析與下一階段建議。檔名依需求保留為 [`docs/STATUS_REPOPRT_2026_06_27.md`](docs/STATUS_REPOPRT_2026_06_27.md:1)。

## 1. 摘要

MakeSlide 目前已從「PDF 語音簡報生成工具」演進為「AI 教學內容生成、播放、互動、報告與匯出平台」。專案描述仍以 PDF 語音簡報為核心：[`package.json`](package.json:5)，但實際功能已涵蓋 PDF、文字與 YouTube 匯入：[`docs/design.md`](docs/design.md:8)，並且在播放、互動、測驗、課後報告、搜尋、模板、匯出與系統治理上都有可用基礎。

最重要的產品判斷：MakeSlide 不應直接走泛用 AI 簡報設計工具路線，因為該市場已由 Canva、Beautiful.ai、Pitch、Gamma、Google Slides、PowerPoint Copilot 等大型產品主導。MakeSlide 較適合聚焦在「把既有教材轉成可播放、可互動、可追蹤、可再利用的 AI 教學內容系統」。

建議下一階段優先投入：

1. 課後學習報告與 AI 教學洞察。
2. AI 導師與學生自學模式。
3. 教材知識庫與跨簡報頁面重用。
4. 生成品質檢查與一鍵修復。
5. 教學模板、課程包與平台整合。

## 2. 程式現況盤點

### 2.1 專案與架構

專案採用前後端 workspace 架構，根目錄定義前端與後端 workspace：[`package.json`](package.json:8)。後端為 Fastify 與 TypeScript 服務，主要依賴包含 Fastify、SQLite、OpenAI SDK、PDF、音訊、PPTX 與 YouTube 字幕處理相關套件：[`backend/package.json`](backend/package.json:17)。前端為 React、Vite、Tailwind 與 GSAP 架構：[`frontend/package.json`](frontend/package.json:13)。

主要前端路由包含首頁、文字匯入、播放、測驗、遠端控制、設定、模板與系統頁：[`App()`](frontend/src/App.tsx:24)。後端主要 API 路由透過 [`pdfRoutes()`](backend/src/routes/pdfs/index.ts:49) 註冊，已涵蓋上傳、播放詳情、頁面操作、重生、同步、測驗、報告、搜尋、品質檢查、月成本、PPTX、課程包、CSV、SCORM、H5P、模板、embedding 統計與相似頁。

### 2.2 生成管線

核心生成流程在 [`runPipeline()`](backend/src/worker/pipeline.ts:447)。目前支援：

- YouTube 字幕擷取與大綱生成：[`buildYoutubeOutlineAsSlideText()`](backend/src/worker/pipeline.ts:135)。
- PDF 或文字來源渲染與切頁：[`runPipeline()`](backend/src/worker/pipeline.ts:562)。
- PDF 圖表抽取：[`runExtractFiguresStage()`](backend/src/worker/pipeline.ts:109)。
- 文字抽取：[`extractText()`](backend/src/worker/steps/extractText.ts:1)。
- 標題生成：[`generateTitle()`](backend/src/worker/steps/generateTitle.ts:1)。
- 逐頁講稿生成：[`generateScript()`](backend/src/worker/steps/generateScript.ts:1)。
- 逐頁 TTS 語音生成：[`synthesizeAudio()`](backend/src/worker/steps/synthesizeAudio.ts:1)。
- 自動動畫生成：[`maybeAutoGenerateAnimations()`](backend/src/worker/pipeline.ts:79)。

任務佇列目前透過 in-process queue 與 in-flight set 管理：[`enqueuePdfProcessing()`](backend/src/worker/pipeline.ts:1353)。此設計適合單機或小規模部署；若要支援大量班級、多使用者與長時間生成任務，建議後續升級為外部 queue 與獨立 worker。

### 2.3 資料模型與產品能力

資料庫 migration 顯示 MakeSlide 已具備完整平台雛形：

- 簡報資料：[`pdfs`](backend/src/db.ts:46)。
- 頁面素材與生成狀態：[`pages`](backend/src/db.ts:187)。
- 投票與票數：[`page_polls`](backend/src/db.ts:218)、[`page_poll_votes`](backend/src/db.ts:233)。
- 分享連結：[`pdf_shares`](backend/src/db.ts:245)。
- 同步播放狀態：[`pdf_sync_sessions`](backend/src/db.ts:256)。
- 測驗與作答紀錄：[`quiz_sets`](backend/src/db.ts:275)、[`quiz_attempts`](backend/src/db.ts:288)。
- 來源內容：[`pdf_sources`](backend/src/db.ts:307)。
- 觀看進度：[`page_watch_progress`](backend/src/db.ts:320)。
- pipeline 執行紀錄：[`pipeline_runs`](backend/src/db.ts:390)。
- artifact timing：[`page_artifact_timings`](backend/src/db.ts:489)。
- 手寫標註：[`page_drawings`](backend/src/db.ts:511)。
- 課堂參與者：[`sync_attendees`](backend/src/db.ts:541)。
- 評論：[`page_comments`](backend/src/db.ts:591)。
- 模板：[`templates`](backend/src/db.ts:608)。
- 頁面 embedding：[`page_embeddings`](backend/src/db.ts:632)。

### 2.4 前端工作流

首頁已支援上傳、ZIP 匯入、批次匯出、分類、標籤、搜尋、排序、收藏、批次移動與批次標籤：[`HomePage()`](frontend/src/pages/HomePage.tsx:222)。播放頁整合播放、字幕、同步、問答、AI 回答、投票、手寫、重生、版本、報告、動畫、來源、圖像編輯與下載：[`PlayPage()`](frontend/src/pages/PlayPage.tsx:163)。

播放頁 header 已依功能分組，包含資訊、播放、生成、下載、腳本與分享：[`PlayPageHeader()`](frontend/src/pages/play/PlayPageHeader.tsx:216)。下載能力已包含 handout PDF、SRT、VTT、TXT、PPTX、講稿、筆記、SCORM 與 H5P：[`PlayPageHeader()`](frontend/src/pages/play/PlayPageHeader.tsx:873)。側欄已包含評論、複習清單、大綱、筆記、投票、書籤、重點頁、相似頁、AI 問答與品質檢查：[`PlayPageSidebar()`](frontend/src/pages/play/PlayPageSidebar.tsx:693)。

設定頁已支援帳號、AI provider、TTS、語言、主題、Google Auth、GitHub 同步、MCP token、自動動畫、字幕同步、月預算、SLA、技能與模板入口：[`SettingsPage()`](frontend/src/pages/SettingsPage.tsx:57)。

## 3. 目前產品優勢

### 3.1 教學閉環基礎已存在

MakeSlide 已能把教材生成為可播放內容，並進一步蒐集互動資料。課後報告 API 已可彙整測驗、投票、觀看進度與學生問題：[`registerReportRoutes()`](backend/src/routes/pdfs/report.ts:408)。這是和一般 AI 簡報生成器最大的差異。

### 3.2 教材資產化基礎已存在

系統已具備關鍵字搜尋與語意搜尋：[`registerSearchRoutes()`](backend/src/routes/pdfs/search.ts:60)，也能找出相似頁：[`registerSimilarPagesRoutes()`](backend/src/routes/pdfs/similar-pages.ts:22)，並能從多份簡報頁面組成新簡報：[`registerFromPagesRoutes()`](backend/src/routes/pdfs/from-pages.ts:51)。這代表 MakeSlide 有機會變成長期教材知識庫，而不只是單次生成工具。

### 3.3 匯出與平台整合雛形完整

目前已支援影片、handout PDF、字幕、PPTX、SCORM、H5P、課程包與 ZIP 匯入匯出。課程包下載入口已在播放頁 header：[`handleDownloadCoursePackage()`](frontend/src/pages/play/PlayPageHeader.tsx:336)。

### 3.4 內容迭代能力完整

MakeSlide 已有逐頁重生、批次重生、取消、rollback、版本、評論、筆記、腳本編輯與動畫編輯。這讓它更像教材工作台，而不是一次性輸出工具。

## 4. 主要風險與缺口

### 4.1 功能很多，但產品工作流需要重新包裝

播放頁功能密度很高。雖然 [`PlayPageHeader()`](frontend/src/pages/play/PlayPageHeader.tsx:216) 已做分組，但使用者仍可能不知道要先做「製作」、「授課」、「自學」、「報告」或「匯出」。建議把功能重新包裝成任務流程。

### 4.2 品質檢查可能漏掉主要完成頁面

品質檢查目前查詢條件是頁面狀態等於 ready：[`registerQualityCheckRoutes()`](backend/src/routes/pdfs/quality-check.ts:69)。但 pipeline 生成完成後多數頁面狀態會被設為 audio_ready：[`runPipeline()`](backend/src/worker/pipeline.ts:1257)。這可能導致品質檢查沒有覆蓋主要生成頁面，建議列為短期修正。

### 4.3 大型前端元件仍需繼續拆分

播放頁集中大量播放、同步、問答、投票、手寫、動畫、重生與報告狀態：[`PlayPage()`](frontend/src/pages/PlayPage.tsx:163)。短期可維持，但中長期要持續拆出 domain hooks 與頁面區塊，降低修改風險。

### 4.4 語意搜尋仍屬 MVP 階段

語意搜尋目前限制最多搜尋 20 份簡報：[`MAX_SEMANTIC_PDFS`](backend/src/routes/pdfs/search.ts:14)，且主要從頁面 script 產生 embedding：[`registerSearchRoutes()`](backend/src/routes/pdfs/search.ts:88)。若要成為教材知識庫，需要更完整的索引策略、增量更新、重建機制與可視化管理。

### 4.5 設計與品牌能力弱於泛用簡報競品

MakeSlide 的生成重點偏教材內容與播放流程；與 Beautiful.ai、Canva、Pitch 相比，品牌一致性、自動排版、智慧版型與美術控制仍較弱。

## 5. 競品功能觀察

### 5.1 泛用 AI 簡報與設計工具

Beautiful.ai 強調 AI、專業模板、Smart Slides、自動對齊、品牌色、字體、logo 與共享主題。Pitch 強調 AI presentation workspace、團隊協作、品牌庫、影片動畫、自訂字體、訪客 engagement analytics 與 deal rooms。Google Slides 強調 PowerPoint / Canva 匯入、即時協作、註解、共用控制與 AI 圖像生成。Prezi 強調 AI 生成、開放畫布、動態縮放、非線性導覽與 Prezi Video。

這類競品的共同趨勢：

- 從 prompt 生成完整 deck。
- 以品牌、版型與設計一致性降低修版成本。
- 強調協作、共享、訪客追蹤與企業工作區。
- 強調 PPTX、Google Slides、影片與外部平台互通。

### 5.2 教學互動與學習平台

Mentimeter 強調投票、Quiz、Survey、Word Cloud、自學節奏、結果匯出、趨勢洞察與 AI 產生互動簡報。Kahoot 強調遊戲化學習、AI study、study groups、class presentations 與互動 learning games。Genially 強調互動與動畫內容、PDF 轉互動教材、測驗、branching scenarios、AI Builder、即時共編與品牌套用。

這類競品的共同趨勢：

- 不只產生內容，也設計課堂互動。
- 互動結果會變成報告、趨勢與學習洞察。
- 強調學生端自學、遊戲化與非同步學習。
- 支援老師、學生與機構的不同視角。

### 5.3 AI 文字轉簡報工具

SlidesAI 類產品強調從主題或文字生成簡報、選擇 tone、套模板、預覽 outline、重寫、翻譯與 PPTX 匯出。此方向與 MakeSlide 的文字匯入和 YouTube 大綱化相近，但 MakeSlide 目前更強在語音、播放、互動與報告。

## 6. 差距分析

### 6.1 MakeSlide 已強於一般 AI 簡報生成器的能力

- 能從 PDF、文字與 YouTube 生成可播放教材。
- 有逐頁講稿、TTS、字幕、影片與課程包。
- 有同步播放、投票、測驗、問答、AI 回答與手寫。
- 有觀看進度、課後報告、CSV 匯出與學生層級資料。
- 有語意搜尋、相似頁與從頁面組新簡報。
- 有自架設、多 provider、預算、SLA 與 MCP。

### 6.2 MakeSlide 目前弱於競品的能力

- 視覺設計、品牌一致性與自動版型弱於 Beautiful.ai、Canva、Pitch。
- 即時協作與共編體驗弱於 Google Slides、Pitch、Canva。
- 互動題型、遊戲化與學生黏著弱於 Mentimeter、Kahoot、Nearpod、Genially。
- 班級管理、成績冊、學生 roster 與 LMS 同步仍未完整產品化。
- 大綱預覽、生成前控制與新手引導仍可更直覺。

## 7. 建議發展方向

### 7.1 P0：課後學習報告與 AI 教學洞察

這是最建議優先投入的方向。MakeSlide 已有測驗、投票、觀看進度與問答資料，下一步應把這些資料變成老師能理解與採取行動的報告。

建議功能：

- 班級摘要：參與人數、測驗平均、投票參與率、觀看完成率、提問數。
- 頁面困難度：停留久、完成率低、提問多、投票分歧高的頁面。
- 題目分析：答錯率最高題目、常見錯誤選項、題目品質警告。
- 學生報告：個人答題紀錄、答錯概念、建議回看頁面。
- AI 建議：下一堂課補強重點、可新增例題、補充教材建議。

可延伸現有基礎：[`registerReportRoutes()`](backend/src/routes/pdfs/report.ts:408)、[`PostClassReportPanel`](frontend/src/pages/play/PostClassReportPanel.tsx:1)。

### 7.2 P0：生成品質檢查與一鍵修復

短期先修正品質檢查查詢狀態問題，再擴成 AI QA。

建議功能：

- 覆蓋 audio_ready、ready、script_ready 等合理狀態。
- 檢查圖片、語音、講稿、字幕、動畫與測驗題品質。
- 每個警告提供一鍵重生或修復。
- 生成完成後自動跑品質檢查並在播放頁顯示摘要。

可延伸現有基礎：[`registerQualityCheckRoutes()`](backend/src/routes/pdfs/quality-check.ts:56)、[`QualityCheckPanel`](frontend/src/pages/play/QualityCheckPanel.tsx:1)。

### 7.3 P1：AI 導師與學生自學模式

目前播放頁已有單頁問答與同步問答能力，建議正式包裝成學生端自學入口。

建議功能：

- 每頁「問這一頁」AI 導師。
- 回答引用目前頁講稿、來源文字與圖表資訊。
- 測驗後產生個人化複習清單。
- 答錯題自動推薦回看頁面。
- 產生補充例題、重點摘要與延伸閱讀。

可延伸現有基礎：[`PageAskPanel`](frontend/src/pages/play/PageAskPanel.tsx:1)、[`usePageAsk`](frontend/src/pages/play/usePageAsk.ts:1)、[`page_watch_progress`](backend/src/db.ts:320)。

### 7.4 P1：教材知識庫與跨簡報重用

MakeSlide 應把搜尋、相似頁與 from-pages 整合成教材知識庫工作流。

建議功能：

- 首頁全域搜尋升級為教材知識庫搜尋。
- 搜尋結果可加入收藏頁或組成新簡報。
- 顯示相似概念、重複內容與可重用頁面。
- 建立課程、單元、主題與標籤體系。
- 從多份簡報挑頁生成複習課或補救教學課。

可延伸現有基礎：[`registerSearchRoutes()`](backend/src/routes/pdfs/search.ts:60)、[`registerSimilarPagesRoutes()`](backend/src/routes/pdfs/similar-pages.ts:22)、[`registerFromPagesRoutes()`](backend/src/routes/pdfs/from-pages.ts:51)。

### 7.5 P1：成本預估與預算治理

MakeSlide 已有每月預算與成本警告基礎，應把成本控制前移到生成前。

建議功能：

- 上傳後先估算頁數、文字量、TTS 長度與圖片成本。
- 顯示省錢、平衡、高品質模式。
- 生成前顯示預估成本與時間。
- 超過預算時警告或限制。
- 管理員儀表顯示各帳號與各簡報成本。

可延伸現有基礎：[`SettingsPage()`](frontend/src/pages/SettingsPage.tsx:840)、[`useBudgetWarning`](frontend/src/hooks/useBudgetWarning.ts:1)。

### 7.6 P1：教學模板與風格系統

競品普遍強調模板，但 MakeSlide 可以做更貼近教育的模板，而不只是視覺模板。

建議功能：

- 教學模板：國中自然、醫學教學、企業內訓、程式課、研究報告。
- 講稿模板：正式、口語、兒童友善、考前複習、雙人對話。
- 互動模板：課前暖身、形成性評量、課後檢核。
- 視覺模板：白板、黑板、手繪、科技風、學術簡報。
- 模板包含 prompt、image style、quiz prompt、tts preference 與互動策略。

可延伸現有基礎：[`templates`](backend/src/db.ts:608)、[`TemplatesPage`](frontend/src/pages/TemplatesPage.tsx:1)、[`SettingsPage()`](frontend/src/pages/SettingsPage.tsx:1023)。

## 8. 建議階段性路線圖

### 8.1 0 到 4 週

1. 修正品質檢查狀態覆蓋問題。
2. 強化課後報告頁，補上頁面困難度、題目答錯率與 CSV 下載入口。
3. 增加生成前成本估算 modal。
4. 首頁搜尋結果加入「加入新簡報」或「收藏頁」。
5. 播放頁入口重新整理成製作、授課、自學、報告、匯出五大區。

### 8.2 1 到 3 個月

1. AI 導師與自學模式正式化。
2. 個人化複習清單與答錯題回看。
3. 教學模板系統與模板建立精靈。
4. 手機老師控制器穩定化。
5. 課程包升級為簡報、講義、測驗、投票、作業與 LMS 匯出組合。

### 8.3 3 到 6 個月

1. 班級、課程與學生 roster。
2. 成績冊與長期學習分析。
3. Google Slides、Moodle、Canvas、Google Classroom 整合。
4. 共備與審閱流程。
5. 分散式 queue、worker 與任務監控。
6. 模板市集與共享教材庫。

## 9. 立即建議處理清單

| 優先級 | 項目 | 目標 | 參考位置 |
|---|---|---|---|
| P0 | 修正品質檢查漏頁 | 讓品質檢查涵蓋主要完成頁面 | [`registerQualityCheckRoutes()`](backend/src/routes/pdfs/quality-check.ts:56) |
| P0 | 課後報告產品化 | 把互動資料變成老師可用洞察 | [`registerReportRoutes()`](backend/src/routes/pdfs/report.ts:408) |
| P0 | 播放頁資訊架構整理 | 降低功能密度造成的新手阻力 | [`PlayPageHeader()`](frontend/src/pages/play/PlayPageHeader.tsx:216) |
| P1 | AI 導師自學模式 | 提升學生端非同步價值 | [`PageAskPanel`](frontend/src/pages/play/PageAskPanel.tsx:1) |
| P1 | 教材知識庫 | 累積長期教材資產與重用價值 | [`registerSearchRoutes()`](backend/src/routes/pdfs/search.ts:60) |
| P1 | 生成前成本估算 | 降低 AI 成本不透明風險 | [`useBudgetWarning`](frontend/src/hooks/useBudgetWarning.ts:1) |
| P1 | 教學模板系統 | 降低 prompt 門檻並提升產出一致性 | [`TemplatesPage`](frontend/src/pages/TemplatesPage.tsx:1) |

## 10. 結論

MakeSlide 的下一階段應以「AI 教學內容平台」為核心，而不是只追求「更漂亮的 AI 簡報」。目前程式已具備生成、播放、互動、測驗、同步、報告、搜尋、版本、模板與匯出的基礎。最值得投入的方向，是把這些功能整合成清楚的教學閉環：課前生成、課中互動、課後分析、學生自學、教材重用。

短期最有效的策略是修正品質檢查、強化課後報告、推出 AI 導師與教材知識庫 MVP。中期再擴展模板、課程包、手機控制器與 LMS 整合。長期則發展班級管理、成績冊、共備審閱與共享教材庫，形成教育場景下的長期護城河。
