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
- [ ] 建立生成前成本預估 modal：在 PDF/文字/YouTube 開始生成前，以頁數、來源字數、預估 TTS 長度與目前 LLM/TTS provider 計算粗估成本，顯示省錢/平衡/高品質三種方案，並將預估邏輯抽成可測試 helper。
- [ ] 實作全域教材搜尋 MVP：先索引或即時查詢 pdf title、page text、page script，在首頁新增搜尋框與結果列表，結果可直接跳到對應播放頁頁碼；後端需限制 owner/public/share 可讀權限。
- [ ] 新增生成品質檢查摘要：在生成完成或使用者手動觸發時，檢查缺失圖片、空逐字稿、音檔不存在、腳本長度異常、動畫效果超出上限等規則，於播放頁顯示每頁品質警告並提供重生入口。
- [ ] 補上 SRT / VTT 字幕匯出：利用既有逐字稿與 timeline/subtitle alignment 資料新增匯出端點，前端在匯出區提供字幕檔下載，並補測試涵蓋無 timeline 時的 fallback。
- [ ] 將 skills 擴充為教學模板資料模型：先定義 template schema（script prompt、image style、quiz prompt、tts preference），在設定或首頁提供「從模板建立」入口，並保留既有 skills API 相容性。

## 工作記錄

| 日期 | 工作內容 | 分支 |
|------|---------|------|
| 2026-06-22 | 建立課後學習報告後端摘要 API（`GET /api/pdfs/:id/report/summary`） | feature/post-class-report-summary-api（已 merge） |
| 2026-06-22 | 在播放頁加入課後報告入口與 MVP 畫面（PostClassReportPanel） | feature/post-class-report-mvp（已 merge） |
| 2026-06-22 | 補強 AI 導師「問這一頁」MVP：新增 `POST /api/pdfs/:id/pages/:n/ask`、`is_authenticated` 欄位、`PageAskPanel` 元件 | feature/ai-tutor-ask-page（已 merge） |
