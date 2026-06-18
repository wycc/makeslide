
- [x] 播放頁頁首與課堂同步區補齊 i18n：`PlayPageHeader.tsx` 目前仍有大量硬編碼中文，例如「返回」、「更新標題」、「重新生成標題」、「同步模式」、「輸入要問 master 的問題」、「AI 總結回答」、「全螢幕」、「下載講義 PDF」、「同步到 GitHub」、「建立分享連結」等；應改用 `useI18n()` 與 `zh-TW.ts` / `en.ts` 翻譯鍵，保留既有分享、同步模式、影片產生與全螢幕行為，並新增或調整輕量測試/型別檢查確認新增翻譯鍵完整。

- [x] 播放頁側欄投影片管理與來源管理補齊 i18n：`PlayPageSidebar.tsx` 中「投影片管理」、「重生」、「新增多頁」、「已選 N 頁將重生」、「來源管理」、「新增 TXT/PDF 來源」、「目前來源清單」、「生成記錄」與系統資料 label 仍多為硬編碼中文；應分批改成翻譯鍵，避免英文介面在播放頁混用中文，並保留目前 Ctrl/Shift 多選、來源展開、生成 prompt 展開與 audio source 播放行為。

- [x] `RegenAllDialog` 批次重生對話框補齊 i18n 與選取頁摘要 formatter：目前「選擇重生項目」、「僅重生已選取的 N 張投影片」、「圖檔重生提示詞」、「逐字稿重生提示詞」、「提醒：若僅重生逐字稿…」、「再次重生／確認」等文字寫死中文；應抽出選取頁摘要 formatter（含空集合、單頁、多頁排序）並補中英文翻譯，讓重生流程在英文介面可完整操作與測試。

- [x] 動畫 Raw JSON 複製加入 Clipboard fallback 與錯誤狀態：`AnimationEditorTab.tsx` 的「複製 JSON」目前直接呼叫 `navigator.clipboard.writeText()` 且只處理成功，若瀏覽器不支援 Clipboard API、非安全來源或權限被拒，使用者不會知道失敗；應新增 `copyTextToClipboard()` helper，支援 `navigator.clipboard` 失敗時 fallback 到 textarea selection / `document.execCommand('copy')`（可用時），並在 UI 顯示成功/失敗狀態與 i18n 文案，補純函式或 mock 測試。

- [x] 移除播放頁貼上與拖曳重排的前端偵錯 `console.*`：`PlayPageSidebar.tsx` 與 `PlayPageSlidePanel.tsx` 仍有 `console.info/warn` 直接記錄貼上事件、clipboard item 型別、拖曳頁碼等；應改為移除或集中到 gated debug helper（例如只在開發模式且明確開啟時輸出），避免一般使用者操作投影片、貼圖或重排時污染 console，並保留錯誤情境的使用者可見提示。

- [x] 來源管理清單新增「複製內容」與「清除展開」小操作：`PlayPageSlidePanel.tsx` 的來源管理目前可展開 TXT/PDF/YouTube 來源內容，但長文字只能手動選取複製，且展開多筆後整理不便；應在每個有 `content_text` 的來源列加入「複製內容」按鈕（使用共用 clipboard helper 與成功/失敗 toast/狀態），並在來源清單標題加入「全部收合」按鈕清空 `expandedSourceId`，不改 API 或資料庫，補 i18n 與可驗證的 helper 測試。

- [x] 重生進度元件補齊 i18n 與英文介面：`RegenerateProgress.tsx` 目前將「重生進度」、「逐字稿／語音／圖檔／動畫」、「等待中／執行中／已完成／失敗」、「預估剩餘」等文案寫死為中文；應改用 `useI18n()` 與 `zh-TW.ts` / `en.ts` 翻譯鍵，保留目前 ETA、完成時間與步驟進度顯示邏輯，並新增輕量 formatter 或元件測試覆蓋 running/completed/failed 狀態文字。

- [x] 圖表素材分頁新增「全部使用／全部排除」批次操作：`FigureAssetsTab.tsx` 目前只能逐張切換 extracted figure 是否作為重生圖片參考，頁面圖表多時很耗時；應在圖表清單上方新增兩個小按鈕，分別將本頁所有 `PageFigure.excluded` 設為 `false` 或 `true`，沿用既有 `savePageFigureSelection(pdfId, pageNumber, excludedIds)` 一次儲存，read-only 模式停用，並在失敗時復原 UI 與顯示既有錯誤文案。

- [x] 課堂測驗編輯器新增「重設作答」按鈕：`QuizBuilderPage.tsx` 的 follower 作答狀態存在 `studentAnswers`，切換測驗或重新練習時目前需逐題取消選項；應在學生作答區或同步測驗控制區新增重設本次作答按鈕，清空 `studentAnswers`、重置提交防重複 ref（避免後續重新提交被擋），並重新回報 `answered_count=0`；此項不需改資料庫，只調整前端狀態與既有進度 API 呼叫。

- [x] 首頁自訂分類管理加入重新命名功能：`HomePage.tsx` 目前可新增與刪除自訂分類，也能把簡報移到分類，但分類名稱打錯時只能新增新分類再逐份搬移；應在分類篩選區或分類管理區新增「重新命名分類」，更新 `customCategories` localStorage，並對目前清單中同分類簡報逐份呼叫既有 `updatePdfCategory()`；完成後同步更新目前篩選值、顯示 toast，並處理部分失敗時重新載入清單。

- [x] 後端移除或降級高噪音 `console.log` 偵錯輸出：掃描 `backend/src/worker/steps/generateScript.ts`、`renderTextPagesWithLlm.ts`、`synthesizeAudio.ts`、`pipeline.ts` 與 `services/openai.ts` 可見多處直接輸出 prompt、payload、raw response 或音訊 segment；應改用既有 `logger.debug/info/warn` 且遮罩 API key、prompt 原文與大型 binary/hex 內容，保留必要 request id / stage / latency，並新增一個小型測試或 lint-friendly helper 確認敏感欄位遮罩規則。

- [x] 上傳 PDF/匯入流程新增取消上傳控制：`uploadPdf()` 已支援 `AbortSignal`，但 `UploadButton.tsx` 的使用者流程尚未提供「取消」按鈕；應在 PDF 上傳進度顯示時建立 `AbortController`，提供取消按鈕中止 XHR、清空進度與 file input，並將 `ABORTED` 顯示為友善訊息而非一般錯誤；此項可只影響前端，不改 API。

- [x] 首頁簡報清單新增排序選項：目前 `HomePage.tsx` 固定以分類分組且分類內用標題排序，近期分類才使用建立時間倒序；應新增「排序方式」select，支援 `title_asc`（現有預設）、`created_desc`、`updated_desc`、`page_count_desc`，將排序偏好存入 localStorage（例如 `makeslide.home.sortMode`），並在一般分類與「最近」分類中一致套用；中英文 i18n 新增 `home.sortBy`、`home.sort.titleAsc/createdDesc/updatedDesc/pageCountDesc`。

- [x] 首頁標題搜尋支援清除按鈕與結果摘要：目前 `HomePage.tsx` 已有 `titleFilter` 並持久化，但輸入後需手動刪除文字且沒有顯示符合筆數；應在搜尋框右側新增「清除」按鈕（有文字時顯示），並在篩選區顯示 `顯示 {shown} / {total} 份簡報`，同時補齊中英文 i18n；此項僅調整前端狀態與 UI，不改 API。

- [x] `PdfCard` 新增總語音長度顯示：`PdfListItem` 已包含 `total_audio_duration_seconds`，但卡片目前只顯示建立時間與頁數；應在卡片資訊列加入格式化後的總語音長度（如 `12:34` 或 `1:02:03`），無資料時不顯示；新增共用或本地 formatter 測試可覆蓋秒數、分鐘、小時與 null/undefined 情境。

- [x] ZIP 匯入成功後自動開啟提示詞視窗：目前 `HomePage.tsx` 的 `handleImportZipChange()` 匯入成功後只 `setItems()` 與 toast，PDF 上傳則會自動開啟 `PromptModal`；應讓 ZIP 匯入成功也呼叫既有 `openPromptFor(imported)`，讓使用者能立即補提示詞並開始處理；若匯入檔案已含 `user_prompt`，應沿用初始值。

- [x] YouTube 匯入面板新增常用字幕語言快速選項：目前 `UploadButton.tsx` 需手輸 `youtubeLang`；應在輸入框旁加入快速按鈕或 select，支援 `zh-TW`、`en`、`ja`、`auto`，點選後填入語言欄位；`auto` 送出時以空字串或 undefined 表示自動選擇；補齊中英文 i18n 與基本互動測試。

- [x] 播放頁新增「清除本簡報播放進度」控制：`PlayPage.tsx` 已以 `makeslide.playback.progress.{pdfId}` 儲存頁碼與時間並自動恢復，但使用者無法手動重置；應在播放設定或頁首新增按鈕，清除該 localStorage key、將 `currentIdx` 與 `currentTime` 重設為 0，並顯示 toast/狀態訊息；分享唯讀模式仍可清除本機進度。

- [x] 本頁產生耗時區塊新增總耗時與異常摘要：`PageTimingChips.tsx` 已顯示 image/text/script/audio 四個 chip；應計算已完成 artifact 的總 `duration_ms`，在標題列顯示「總計 {duration}」，若任一 artifact 為 failed 或 SLA breached，額外顯示小型警示摘要（例如 `2 項需注意`），tooltip 保留既有細節；補齊格式化測試與 i18n。

[x] `text-callout` 效果新增內距選項 `textCalloutPadding`：目前固定使用 `'0.5em 0.75em'`；應新增 `textCalloutPadding?: 'sm' | 'md' | 'lg'`（預設 `'md'`），對應 `sm='0.25em 0.5em'`、`md='0.5em 0.75em'`（現有預設）、`lg='0.75em 1.25em'`；後端同步更新 `AnimationEffect`/`EffectSchema`（`z.enum(['sm','md','lg']).optional()`）/序列化；前端 `types.ts` 新增欄位；`SlideRenderer.tsx` 以 padding map 取代硬編碼字串；`AnimationEditorTab.tsx` 在 text-callout 設定區加入 select 選擇器；中英文 i18n 新增翻譯鍵（`play.animation.textCalloutPadding`、`play.animation.textCalloutPadding.sm/md/lg`）。

[x] Manim `animate.blink(m, progress, opts)` 閃爍效果：新增 `animate.blink(m, progress, opts)` 函式，讓元素 opacity 以週期性 on/off 閃爍；以 `Math.floor(progress * cycles * 2) % 2 === 0 ? 1 : 0` 計算每個時間點的 opacity（偶數半週期亮、奇數半週期暗）；opts 支援 `cycles`（閃爍次數，預設 3）和 `minOpacity`（暗相位最小 opacity，預設 0）；progress=1 時恢復 opacity=1 並清除殘留；新增至少 2 個 vm 測試（驗證 progress=0.5 時 opacity 符合閃爍規律，驗證 progress=1 時 opacity='1'）。

[x] Manim `animate.colorCycle(m, progress, opts)` 顏色循環效果：新增 `animate.colorCycle(m, progress, opts)` 函式，讓元素的 stroke 在多個顏色之間循環變化（如 ROYGBIV 彩虹效果）；opts 支援 `colors`（hex 色碼陣列，必填，至少 2 色）和 `attr`（`'stroke'`|`'fill'`|`'both'`，預設 `'stroke'`）；以 `progress * (colors.length - 1)` 計算當前位置，用 `lerpColor` 在相鄰兩色插值；progress=1 時設為最後一色；新增至少 2 個 vm 測試（驗證中間 progress 顏色在兩色之間、驗證 progress=1 等於最後一色）。

[x] `pointer` 效果新增可見時透明度選項 `pointerOpacity`：目前 pointer 在可見時固定 opacity=1；應新增 `pointerOpacity?: number`（0–1，預設 1）讓指針在可見狀態的不透明度可調整（半透明指針適合不遮擋內容的場景）；後端同步更新 `AnimationEffect`/`EffectSchema`（`z.number().min(0).max(1).optional()`）/序列化（帶 min/max clamp）；前端 `types.ts` 新增欄位；`buildGsapTimeline.ts` 中 pointer 效果的 gsap to() 目標 opacity 改為 `effect.pointerOpacity ?? 1`（目前可能硬編碼為 1）；`AnimationEditorTab.tsx` 加入 range slider 或 number input（min=0.1, max=1, step=0.1）；中英文 i18n 新增 `play.animation.pointerOpacity`（'Opacity'／'透明度'）。

[x] 將系統設定項重改成左邊是 navigation bar，右邊是同一類別的設定的形式。把所有設定分類放到不同頁中。
[x] 降低 jpeg 的畫質，目前每個檔1.3MB 太大了，請準備一個 749x500 的縮圖。只有在全螢幕才用全圖。
[x] 建立分享功能連結時，每一個簡報可以獨立的設定分享成 private, read-only or read-write。當設定成分 read-only/read-write 時，除了使用分享連接外，簡報會自動出現在其它帳號的列表中。
[x] 高橋流要求每一頁只能有一二個重點，和目前一般的提示詞有沖突。請修改提示詞讓使用者明確要求高橋流或類似的減少每一頁重點時可以被使用。
[x] 在產生大網時完全沒有使用者的提示在其中，當使用者使用高橋流時也沒有調整每頁重點的效果。
[x] 類別是最近的簡報時，預設使用建立時間新到舊的排序方式
[x] read-only 模式時，不能做同步到 github 的動作
[x] read-only 模式時，設定/風格/分享等按鍵應該 disable

- [x] 後端動畫與畫板路由補上編輯權限檢查：`backend/src/routes/pdfs/page-animation.ts` 的 `PUT /api/pdfs/:id/pages/:n/animation`、`POST .../animation/auto-focus-ai`、`POST .../animation/custom-script`，以及 `backend/src/routes/pdfs/drawings.ts` 的 `PUT`/`DELETE /api/pdfs/:id/pages/:n/drawing`，目前完全沒有檢查請求者是否有編輯權限（不像 `detail.ts` 多數寫入路由都有 `canEditPdf()`），任何已登入帳號只要知道 PDF id 就能修改唯讀分享簡報的動畫或畫板內容；應在每個寫入路由補上與 `detail.ts`/`admin.ts` 一致的 `sessionSub()` + `canEditPdf(owner_sub, visibility)` 檢查，沒有編輯權限時回傳 `403 FORBIDDEN`，並補上對應後端測試（可參考剛完成的 `backend/test/github-sync.test.ts`）。

- [x] 後端測驗寫入路由補上編輯權限檢查：`backend/src/routes/pdfs/quizzes.ts` 的 `POST /api/pdfs/:id/quizzes/generate`、`POST /api/pdfs/:id/quizzes`、`PUT /api/pdfs/:id/quizzes/:quizId` 目前沒有檢查請求者是否有編輯權限，任何登入帳號可在唯讀分享簡報上產生或修改測驗題目；應補上 `canEditPdf()` 檢查並回傳 `403`。`POST /api/pdfs/:id/quizzes/:quizId/attempts`（學生作答提交）維持現狀不需此限制，因為課堂測驗的 follower 本來就需要在沒有編輯權限的情況下提交答案。

- [x] 後端頁面操作路由補上編輯權限檢查：`backend/src/routes/pdfs/page-operations.ts` 的 `POST /api/pdfs/:id/pages`（新增頁）、`POST .../pages/move`（移動頁）、`DELETE .../pages/:n`（刪除頁）、`POST .../pages/:n/replace-image`、`POST .../pages/:n/regenerate-image`、`POST .../pages/:n/inpaint-image`、`POST .../pages/:n/rewrite-script`、`POST .../pages/:n/regenerate-audio`、`POST .../pages/:n/chat`、`DELETE .../pages/:n/chat-history` 等寫入路由目前都沒有檢查編輯權限；應逐一補上 `canEditPdf()` 檢查，這是目前後端權限缺口中影響範圍最大的一批路由，建議拆成獨立 PR 並補上至少 2-3 個關鍵路由（新增頁、刪除頁、重生圖片）的權限測試。

- [ ] `TtsDialog.tsx` 補齊 i18n：目前完全沒有使用 `useI18n()`，標題「生成設定」、「聲音」、「主持模式」、「單人旁白」/「雙人對談」、「速度」、「逐字稿每頁上限字數」、「系統預設」、「儲存中…」、「儲存設定」與雙人對談說明文字皆為硬編碼中文；應改用 `useI18n()` 與新增 `play.ttsDialog.*` 翻譯鍵，讓英文介面使用者也能完整操作語音設定對話框。

- [ ] `ImageStyleDialog.tsx` 補齊 i18n：目前完全沒有使用 `useI18n()`，標題「整份簡報圖片風格設定」、說明段落、「套用模板」、「關閉」、「儲存設定」按鈕與 textarea placeholder 皆為硬編碼中文；應改用 `useI18n()` 與新增 `play.imageStyleDialog.*` 翻譯鍵。

- [ ] `VersionHistoryDialog.tsx` 補齊 i18n：目前完全沒有使用 `useI18n()`，「圖片」/「逐字稿」版本歷史標題、「（第 N 頁）」、「載入中…」、「尚無版本記錄」、「點選左側版本以預覽」、「關閉」、「還原中…」、「還原至此版本」皆為硬編碼中文；應改用 `useI18n()` 與新增 `play.versionHistory.*` 翻譯鍵，日期格式維持現有 locale-aware 邏輯。

- [ ] `ShareDialog.tsx` 複製連結按鈕加上 Clipboard fallback：目前直接呼叫 `navigator.clipboard.writeText()`，若瀏覽器不支援 Clipboard API、非安全來源或權限被拒，使用者不會知道複製失敗；應改用既有 `frontend/src/lib/clipboard.ts` 的 `copyTextToClipboard()` helper（先試 Clipboard API、失敗再 fallback 到 textarea/`execCommand`），並在 UI 顯示成功/失敗狀態與 i18n 錯誤提示，失敗時保留可手動選取複製的連結文字。

---

- 時間: 2026-06-18 06:05:00 +0800
- 分支: workspace-current
- 內容: 完成 `RegenAllDialog` 批次重生對話框 i18n 與選取頁摘要 formatter。`RegenAllDialog.tsx` 改用 `useI18n()` 與 `play.regenDialog.*` 翻譯鍵顯示標題、執行順序、圖檔/逐字稿/語音/動畫選項、主持模式、提示詞 label/placeholder、逐字稿提醒、關閉/取消/確認/再次重生等主要文字；`formatters.ts` 新增 `formatRegenSelectedPagesSummary()`，統一處理未選取時重生全部、單頁選取與多頁去重排序摘要，中英文分別使用「、」與 comma separator。同步補齊 `zh-TW.ts` / `en.ts` 文案並在 `formatters.test.ts` 加入空集合、單頁、多頁排序測試，讓英文介面可完整操作批次重生流程。

- 時間: 2026-06-18 06:10:00 +0800
- 分支: workspace-current
- 內容: 完成動畫 Raw JSON 複製 fallback 與錯誤狀態。新增 `frontend/src/lib/clipboard.ts` 的 `copyTextToClipboard()` 共用 helper，優先使用 `navigator.clipboard.writeText()`，失敗或不可用時改用隱藏 textarea selection 搭配 `document.execCommand('copy')`；兩條路徑都失敗時回傳可判斷的錯誤結果。`AnimationEditorTab.tsx` 的「複製 JSON」改用 helper，成功時顯示已複製狀態，失敗時顯示中英文 i18n 錯誤提示並保留下方唯讀 textarea 供手動選取複製。同步新增 `clipboard.test.ts` mock 測試覆蓋 Clipboard API 成功、API 失敗後 fallback、全部失敗與 fallback 可用性檢查。

- 時間: 2026-06-17 22:30:00 +0800
- 分支: workspace-current
- 內容: 依照 LOOP.md 在 TODO.md 已無未完成項目時重新檢視主要程式區塊。快速檢查首頁清單/分類與搜尋、卡片資訊、PDF/ZIP/YouTube 匯入流程、播放頁進度恢復、本頁產生耗時顯示，以及後端管線進度與設定頁現況後，新增 7 個偏小型且可分次完成的功能改進：(1) 首頁排序選項；(2) 搜尋清除與結果摘要；(3) 卡片總語音長度；(4) ZIP 匯入後開啟提示詞；(5) YouTube 字幕語言快速選項；(6) 清除本簡報播放進度；(7) 本頁耗時總計與異常摘要。

- 時間: 2026-06-18 05:58:00 +0800
- 分支: workspace-current
- 內容: 完成播放頁側欄投影片管理、來源管理與系統資料主要 label i18n。`PlayPageSidebar.tsx` 的投影片管理標題、重生/新增/刪除/新增多頁按鈕、縮圖 title/alt、Ctrl/Shift 多選提示、已選頁數摘要與封面設定按鈕改用 `play.sidebar.*` 翻譯鍵；`PlayPageSlidePanel.tsx` 的來源 tab、來源管理、TXT/PDF 來源新增說明、來源清單、未命名/無內容狀態、生成記錄與 prompt stage label 改用 `play.source.*`，系統資料 tab、基本資料 label、素材耗時表、執行歷程、run/stage/status/artifact label 與最慢素材排行改用 `play.system.*` / 既有 artifact 翻譯鍵。同步在 `zh-TW.ts` 與 `en.ts` 補齊中英文文案，保留 Ctrl/Shift 多選、來源展開、生成 prompt 展開與 YouTube audio source 播放行為；已執行 frontend typecheck，並用 grep 掃描目標主要硬編碼中文只剩註解與非本次目標的逐字稿重生文案。

- 時間: 2026-06-18 03:45:00 +0800
- 分支: workspace-current
- 內容: 完成每份簡報獨立分享狀態 private/read-only/read-write。後端沿用 `pdfs.visibility` 對應 `private`、`public`（read-only）與 `public_editable`（read-write）；`POST /api/pdfs/:id/share` 建立分享連結時會依選擇同步更新簡報 visibility 並回傳狀態，且只有簡報擁有者可建立分享或改變 visibility；`PATCH /api/pdfs/:id/visibility` 也限制為擁有者操作，避免協作者變更公開範圍。首頁列表既有 `canReadPdf()` 會讓 `public/public_editable` 自動出現在其他帳號清單；寫入 API 沿用 `canEditPdf()`，read-only 不可修改、read-write 可修改。前端分享控制新增 read-only/read-write（列表可見）文案與「設為 private」按鈕，型別補齊 `visibility`，並讓列表入口開啟 read-only 共享簡報時套用唯讀限制。新增後端 API 測試覆蓋分享建立時 visibility 轉換、跨帳號列表可見與 read-only/read-write 編輯權限。

- 時間: 2026-06-17 22:35:00 +0800
- 分支: workspace-current
- 內容: 完成首頁簡報清單排序選項。`HomePage.tsx` 新增 `SortMode`、`makeslide.home.sortMode` localStorage 持久化、排序 comparator 與「排序方式」select；支援標題 A-Z、建立時間新到舊、更新時間新到舊、頁數多到少，並讓一般分類與「最近的簡報」分類都使用相同排序邏輯，不再讓最近分類固定建立時間倒序。同步新增中英文 `home.sortBy` 與 `home.sort.*` i18n，並於 BLOG.md 補充功能目的、使用方式與技術細節。

- 時間: 2026-06-17 22:45:00 +0800
- 分支: workspace-current
- 內容: 完成首頁標題搜尋清除與結果摘要。`HomePage.tsx` 在標題篩選輸入框內新增只於有文字時顯示的「清除」按鈕，點擊會重用既有 `updateTitleFilter('')` 清空畫面狀態與 localStorage；篩選區新增 `顯示 {shown} / {total} 份簡報` 摘要，其中 `shown` 是套用目前分類/最近視圖與 title filter 後的可見數量，`total` 是同一分類/最近視圖下未套用 title filter 的總數。同步新增中英文 `home.clearTitleFilter` 與 `home.resultSummary` i18n，僅調整前端 UI/狀態，不改 API。

- 時間: 2026-06-17 22:55:00 +0800
- 分支: workspace-current
- 內容: 完成 `PdfCard` 總語音長度顯示。新增共用 `formatAudioDuration()`，將 `total_audio_duration_seconds` 格式化為 `M:SS` 或 `H:MM:SS`，並在缺少、null、undefined 或無效資料時回傳 null 讓卡片不顯示；`PdfCard.tsx` 的資訊列現在會在建立時間與頁數旁顯示「語音 {duration}」／「Audio {duration}」，同步補齊中英文 i18n 與 formatter 測試，覆蓋秒數、分鐘、小時、null/undefined 與無效值情境。

- 時間: 2026-06-17 23:00:00 +0800
- 分支: workspace-current
- 內容: 完成 ZIP 匯入成功後自動開啟提示詞視窗。`HomePage.tsx` 將既有 `openPromptFor()` 移到 ZIP 匯入 handler 前方供其使用，並在 `handleImportZipChange()` 的 `importPdfZip()` 成功回傳後先 `setItems()` 再呼叫 `openPromptFor(imported)`，讓匯入完成的簡報立即開啟 `PromptModal` 供使用者補提示詞並開始處理。既有 `openPromptFor()` 已會讀取 `user_prompt` 作為 `initialValue`，因此 ZIP 內若已有提示詞會自動沿用；此修改僅調整前端流程，不改 API。

- 時間: 2026-06-17 23:05:00 +0800
- 分支: workspace-current
- 內容: 完成 YouTube 匯入面板常用字幕語言快速選項。`UploadButton.tsx` 在字幕語言輸入框旁新增 `zh-TW`、`en`、`ja`、`auto` 快速按鈕，點選會直接填入既有 `youtubeLang` 欄位並以 `aria-pressed` 顯示目前選擇；送出時改用 `normalizeYoutubeSubtitleLanguageForSubmit()`，保留明確語言代碼並將空白或 `auto` 轉為 `undefined`，沿用既有 `createYoutubeTask()` payload 的最小改動語意讓後端自動選擇字幕。同步補齊中英文 i18n，並新增 `youtubeLanguage.test.ts` 純函式測試；目前專案沒有元件互動測試依賴，因此先以可測 helper 覆蓋快速選項清單與 `auto` 提交轉換規則。

- 時間: 2026-06-18 03:15:00 +0800
- 分支: workspace-current
- 內容: 完成播放頁「清除本簡報播放進度」控制。`PlayPage.tsx` 新增播放狀態訊息與 `handleClearPlaybackProgress()`，會清除 `makeslide.playback.progress.{pdfId}`、取消尚未寫回的進度 timer、重設恢復位置、停止播放與動畫延長計時、將 `currentIdx`/`currentTime` 與 audio element 回到 0，並顯示短暫狀態訊息；此操作不依賴編輯權限，因此分享唯讀模式也能清除本機進度。`PlayPageSlidePanel.tsx` 在播放設定中加入「播放進度」區塊與清除按鈕，並補齊中英文 `play.playbackProgress.*` i18n；BLOG.md 新增目的、使用方式與技術細節。

- 時間: 2026-06-18 03:20:00 +0800
- 分支: workspace-current
- 內容: 完成本頁產生耗時區塊總耗時與異常摘要。`PageTimingChips.tsx` 標題列現在會彙總 image/text/script/audio 中狀態為 `succeeded` 且具有限 `duration_ms` 的 artifact，顯示「總計 {duration}」；若任一 artifact 為 `failed` 或 `sla_status === 'breached'`，會額外顯示「{count} 項需注意」小型警示 badge。既有每個 chip 的 tooltip 細節保留不變。`formatters.ts` 新增 `sumCompletedDurationMs()` 並補上 `formatters.test.ts` 覆蓋耗時格式化、無效值與只累計完成項目的規則；同步新增中英文 `play.timing.*` i18n，BLOG.md 補充目的、使用方式與技術細節。

- 時間: 2026-06-18 05:38:00 +0800
- 分支: workspace-current
- 內容: 完成後端高噪音偵錯輸出降級與遮罩。新增 `backend/src/services/logSanitizer.ts`，提供 `redactLogObject()`、`redactPromptForLog()`、`redactTextForLog()`，統一遮罩 API key/Bearer token、prompt/input/script/rawContent、data URL/base64/hex/binary Buffer 等敏感或大型內容，只保留 chars/bytes、model、stage、latencyMs、usage、requestId 等可診斷欄位。移除 `generateScript.ts` 的 system prompt `console.log`、`renderTextPagesWithLlm.ts` 的 image payload `console.log`、`synthesizeAudio.ts` 的 segment 明文輸出、`pipeline.ts` 的 YouTube outline 明文輸出，以及 `services/openai.ts` 的 raw response hex/utf8、completion/rawContent/parse error `console.log`，改以 `logger.debug/info/warn` 搭配遮罩摘要。新增 `backend/test/log-sanitizer.test.ts` 驗證 API key、prompt、raw response、大型 base64/hex 不會原文出現在 log 物件中，且保留 latency/requestId 等必要中繼資料。

- 時間: 2026-06-18 05:45:00 +0800
- 分支: workspace-current
- 內容: 完成上傳 PDF/匯入流程取消上傳控制。`UploadButton.tsx` 在每次選擇 PDF 並開始上傳時建立新的 `AbortController`，將 `signal` 傳入既有 `uploadPdf()` XHR 流程；上傳進度列旁新增「取消上傳」按鈕，點擊會呼叫 `abort()` 中止 XHR，立即清空進度並重設 file input。`ApiError` code 為 `ABORTED` 時改顯示友善的「已取消上傳」訊息，不再套用一般上傳失敗與 recovery guide。同步補齊中英文 `upload.uploadProgress`、`upload.cancelUpload`、`upload.uploadCanceled` i18n，僅調整前端，不改 API。

- 時間: 2026-06-18 05:55:00 +0800
- 分支: workspace-current
- 內容: 完成播放頁頁首與課堂同步區 i18n 補齊。`PlayPageHeader.tsx` 新增 `useI18n()` 並將返回、標題更新/重新生成、頁碼、同步模式、follower 提問、master 問題列表與 AI 總結回答、產生失敗提示、逐字稿確認提示、全螢幕/字幕/編輯模式、圖片比例、語音/風格設定、影片產生/下載、講義 PDF、測驗生成、GitHub 同步、分享權限/建立連結/private，以及重生任務 banner 等硬編碼中文改為翻譯鍵。`zh-TW.ts` 與 `en.ts` 新增對應 `play.header.*`、`play.sync.*`、`play.share.*`、`play.regenBanner.*` 文案，保留既有點擊 handler 與狀態判斷；新增 `frontend/src/i18n.test.ts` 驗證中英文 locale key 完整且頁首/同步關鍵翻譯非空。已執行 frontend typecheck 與 i18n/formatters 輕量測試通過。

- 時間: 2026-06-17 17:15:00 +0800
- 分支: feature/todo-add-items-20260617d
- 內容: 分析現有系統後，新增 7 個待辦項目：(1) shape 效果新增 hexagon 六角形；(2) shape 效果新增 shapeGlow 發光選項；(3) step-list 高亮指定步驟；(4) text-callout 內距選項；(5) Manim animate.blink 閃爍效果；(6) Manim animate.colorCycle 顏色循環效果；(7) pointer 效果可見時透明度選項。

- 時間: 2026-06-17 17:30:00 +0800
- 分支: feature/shape-hexagon-20260617
- 內容: 新增 `hexagon` 六角形到 `shape` 效果。以 SVG `<polygon>` 繪製正六角形，6 個頂點（半徑 46、中心 50,50、頂點從正上方起順時針），points 字串：`50,4 89.84,27 89.84,73 50,96 10.16,73 10.16,27`。strokeLinejoin="round" 讓角點圓滑，支援 fill/stroke/strokeWidth/strokeDasharray。前後端 TypeScript 均通過。

- 時間: 2026-06-17 21:50:00 +0800
- 分支: feature/shape-glow-20260617b
- 內容: 新增 `shapeGlow?: boolean` 到 shape 動畫效果。後端 `AnimationEffect`、`EffectSchema` 與序列化流程均保留此布林欄位；前端 `SlideAnimationEffect` 同步新增欄位，`SlideRenderer.tsx` 在 shape SVG 啟用時套用 `filter: drop-shadow(0 0 8px ${stroke})`，讓形狀以描邊色產生發光輪廓；`AnimationEditorTab.tsx` 在 shape 線寬設定後新增「發光效果」勾選框；中英文 i18n 新增 `play.animation.shapeGlow`。前後端 TypeScript 均通過。


- 時間: 2026-06-17 22:05:00 +0800
- 分支: feature/text-callout-padding-20260617
- 內容: 新增 `textCalloutPadding?: 'sm' | 'md' | 'lg'` 到 `text-callout` 效果。後端 `AnimationEffect`、`EffectSchema` 與 `validateAnimationSpec()` 序列化均支援此欄位；前端 `SlideAnimationEffect` 同步新增欄位，`SlideRenderer.tsx` 以 padding map 套用 `sm=0.25em 0.5em`、`md=0.5em 0.75em`、`lg=0.75em 1.25em`，未設定時維持既有 `md` 外觀；`AnimationEditorTab.tsx` 新增內距 select；中英文 i18n 與 BLOG.md 功能說明同步更新。前後端 TypeScript 均通過。

- 時間: 2026-06-17 22:10:00 +0800
- 分支: feature/manim-blink-20260617
- 內容: 新增 Manim helper `animate.blink(m, progress, opts)` 閃爍動畫。此函式以 `Math.floor(progress * cycles * 2) % 2 === 0 ? 1 : 0` 判斷亮暗半週期，支援 `cycles`（預設 3）與 `minOpacity`（預設 0），暗相位使用 `minOpacity`，完成時強制恢復 `style.opacity = '1'` 避免殘留透明狀態。同步新增 VM 測試驗證 `progress=0.5` 的閃爍規律與 `progress=1` 的 opacity 還原。

- 時間: 2026-06-17 22:20:00 +0800
- 分支: feature/manim-color-cycle-20260617
- 內容: 新增 Manim helper `animate.colorCycle(m, progress, opts)` 顏色循環動畫。此函式要求 `opts.colors` 至少包含 2 個 hex 色碼，不符合時安全 no-op；支援 `attr: 'stroke' | 'fill' | 'both'`（預設 `stroke`），以 `progress * (colors.length - 1)` 找出相鄰色段並用既有 `lerpColor()` 插值，`progress=1` 時固定輸出最後一色。同步新增 VM 測試覆蓋中間進度顏色插值與完成時等於最後一色，並於 BLOG.md 補充目的與使用方式。

- 時間: 2026-06-17 22:18:00 +0800
- 分支: feature/pointer-opacity-20260617
- 內容: 新增 `pointerOpacity?: number` 到 `pointer` 動畫效果，讓指標可見狀態透明度可調整且預設維持 1。後端 `AnimationEffect`、`EffectSchema` 與 `validateAnimationSpec()` 序列化均支援此欄位，並以 0–1 範圍驗證與 clamp；前端 `SlideAnimationEffect` 同步新增欄位，`buildGsapTimeline.ts` 將 pointer 淡入目標改為 `effect.pointerOpacity ?? 1`；`AnimationEditorTab.tsx` 新增透明度 range slider 與 number input（0.1–1、step 0.1）；中英文 i18n 新增 `play.animation.pointerOpacity`。前後端 TypeScript 均通過。

- 時間: 2026-06-17 22:26:00 +0800
- 分支: workspace-current
- 內容: 重構系統設定頁為左側分類 navigation bar、右側單一分類內容的版面。分類包含「帳號與偏好」、「AI 與語音」、「同步」、「AI 技能」與 admin 才顯示的「管理員」；保留原有 Google 登入/登出、使用者代碼、語言、播放速度、API Key、模型、TTS speaker/voice、CGU Air、自動產生動畫、GitHub 同步、AI 技能 CRUD/啟停、Google Auth 管理、admin 移交與 Pipeline SLA 設定。新增中英文 i18n 分類名稱/描述與登入狀態文字。frontend TypeScript typecheck 通過。

- 時間: 2026-06-18 03:35:00 +0800
- 分支: workspace-current
- 內容: 完成播放頁縮圖模式與全螢幕高解析切換。後端 `thumbnails.ts` 將頁面縮圖改為 749x500 以內、JPEG quality 62、mozjpeg，並保留缺圖時由 `/api/pdfs/:id/pages/:n/thumbnail` 依全圖 lazy fallback 產生；`renderPages.ts` 將 PDF 全圖 JPEG quality 從 82 降到 72 以降低新匯入檔案大小。前端 `PlayPage.tsx` 新增一般播放用 `playbackImageSrc = thumbnail_url ?? image_url` 與全螢幕用 `fullscreenImageSrc = image_url ?? thumbnail_url`，並讓一般模式預載縮圖、全螢幕才載入全圖；`PlayPageSlidePanel.tsx` 與 `PlayPageFullscreen.tsx` 分別使用對應來源，兼容舊資料缺縮圖時 fallback 到全圖。同步更新 BLOG.md 說明目的、使用方式與技術細節；frontend typecheck 通過。

- 時間: 2026-06-18 03:50:00 +0800
- 分支: workspace-current
- 內容: 完成高橋流 / 極簡大字投影片提示詞支援。檢查 `backend/prompts` 與 `generateScript.ts` 後，確認一般提示詞中的「充分利用投影片圖像」、「適度展開」、「補足語氣與轉場」與硬性字數下限，可能和每頁只放一兩個重點的高橋流需求衝突；新增 `isMinimalSlideStyleRequested()` 偵測高橋流、Takahashi method/style、每頁一兩個重點、極簡大字、少字等明確使用者提示，並在 OpenAI/Gemini 初稿與整份重寫 prompt 中插入優先規則：每頁只保留 1～2 個核心重點、降低字數、不要為了原目標字數補細節，同時保留 JSON、語氣標記與講者格式。同步更新 OpenAI/Gemini prompt 模板與 user style partial，並新增後端測試覆蓋偵測規則與一般模式不誤判。

- 時間: 2026-06-18 03:55:00 +0800
- 分支: workspace-current
- 內容: 完成重生進度元件 i18n 與英文介面。`RegenerateProgress.tsx` 改用 `useI18n()` 取得標題、步驟名稱、任務狀態、步驟狀態、預估剩餘、完成時間與錯誤 fallback 文案；`zh-TW.ts` / `en.ts` 新增 `play.regenerate.*` 翻譯鍵，英文介面可顯示 Regeneration progress、Transcript/Audio/Images/Animations、Pending/Running/Completed/Failed 與 Estimated remaining。`formatters.ts` 新增重生狀態、步驟狀態與本地化 ETA formatter，保留原本進度百分比、ETA 與預計完成時間邏輯；`formatters.test.ts` 補上 running/completed/failed 與 ETA 格式測試。

- 時間: 2026-06-18 04:05:00 +0800
- 分支: workspace-current
- 內容: 完成圖表素材分頁「全部使用／全部排除」批次操作。`FigureAssetsTab.tsx` 在圖表清單上方新增兩個小型批次按鈕，分別將目前頁面所有 `PageFigure.excluded` 設為 `false` 或 `true`，並沿用 `savePageFigureSelection(pdfId, pageNumber, excludedIds)` 以一次 PUT 儲存整頁 excluded ids；批次儲存期間會停用按鈕與單張 checkbox，read-only 模式同樣不可操作。若儲存失敗，會復原成操作前的 `figures` UI 狀態，並顯示既有 `play.figures.saveError` 錯誤文案。同步補齊中英文 `play.figures.useAll` / `play.figures.excludeAll` i18n，BLOG.md 新增功能目的與使用方式。

- 時間: 2026-06-18 05:30:00 +0800
- 分支: workspace-current
- 內容: 完成課堂測驗 follower「重設作答」功能。`QuizBuilderPage.tsx` 在學生作答區標題列新增重設按鈕，按下後會清空 `studentAnswers`、將 `submittedAttemptRef` 歸零以允許同一個同步測驗 session 後續再次提交，並同步更新 `latestAttemptSnapshotRef` 避免殘留舊答案。重設時沿用既有 `submitSyncQuizProgress()` 立即回報 `answered_count=0`、`submitted=false` 與目前題數，不改資料庫與 API；失敗時顯示同步錯誤並讓下一次進度 effect 可重新回報。同步補齊中英文 `quiz.resetAnswers*` i18n，BLOG.md 新增目的、使用方式與技術細節。

- 時間: 2026-06-18 05:35:00 +0800
- 分支: workspace-current
- 內容: 完成首頁自訂分類重新命名功能。`HomePage.tsx` 在每個自訂分類標題旁新增「重新命名類別」按鈕，使用 prompt 輸入新名稱並檢查空白、未變更與名稱重複；成功後更新 `makeslide.home.customCategories` localStorage，並對目前清單中原分類的每份簡報逐一呼叫既有 `updatePdfCategory()`。重新命名會同步更新目前分類篩選值與 localStorage，成功 toast 會顯示更新簡報數；若部分簡報更新失敗，會顯示部分失敗 toast 並重新載入清單以校正畫面狀態。同步補齊中英文 `home.renameCategory*` i18n，BLOG.md 新增目的、使用方式與技術細節。

- 時間: 2026-06-18 03:55:00 +0800
- 分支: workspace-current
- 內容: 依照 LOOP.md 在 TODO.md 已無未完成項目時重新檢視主要程式與文件，避免重複既有首頁排序/搜尋、卡片語音長度、ZIP/YouTube 匯入、播放進度、耗時摘要、分享、縮圖與高橋流等已完成項目。檢查 `HomePage.tsx`、`RegenerateProgress.tsx`、`FigureAssetsTab.tsx`、`QuizBuilderPage.tsx`、`UploadButton.tsx`、`frontend/src/lib/api/uploads.ts`、`backend/src/routes/pdfs/sync.ts` 與後端 worker/openai 相關檔案後，新增 6 個偏小型且可驗證的待辦：(1) 重生進度 i18n；(2) 圖表素材全部使用/排除；(3) 課堂測驗重設作答；(4) 首頁自訂分類重新命名；(5) 後端高噪音 console.log 降級與遮罩；(6) 上傳 PDF/匯入流程取消控制。

- 時間: 2026-06-18 05:45:00 +0800
- 分支: workspace-current
- 內容: 依照 LOOP.md 在 TODO.md 已無未完成項目時再次重新檢視主要前端/後端與 BLOG 既有功能紀錄，確認目前沒有 `- [ ]` 未完成項目，並避開已完成的首頁排序/搜尋、卡片語音長度、ZIP/YouTube 匯入、播放進度、耗時摘要、分享、縮圖、高橋流、重生進度、圖表批次、測驗重設、分類重新命名、後端 log 遮罩與上傳取消等項目。檢查 `PlayPageHeader.tsx`、`PlayPageSidebar.tsx`、`PlayPageSlidePanel.tsx`、`RegenAllDialog.tsx`、`AnimationEditorTab.tsx`、`ShareDialog.tsx`、`SettingsPage.tsx`、`backend/src/routes/pdfs/sync.ts` 與後端 console 掃描結果後，新增 6 個偏小型且可驗證的待辦：(1) 播放頁頁首與同步區 i18n；(2) 播放頁側欄與來源管理 i18n；(3) 批次重生對話框 i18n 與摘要 formatter；(4) 動畫 Raw JSON 複製 clipboard fallback；(5) 移除/管控播放頁貼上與拖曳偵錯 console；(6) 來源管理複製內容與全部收合小操作。

- 時間: 2026-06-18 07:50:00 +0800
- 分支: feature/outline-user-prompt-takahashi-20260618
- 內容: 完成「產生大綱時帶入使用者提示詞，並在高橋流時調整每頁重點數」。`backend/src/worker/steps/splitTextWithLlm.ts` 的 `buildOutlineFromFullText()`（兩階段全文大綱流程）與 `splitChunkWithLlm()`（chunk fallback 流程）皆新增 `userPrompt` 參數，並將使用者補充指示原文插入 system/user prompt 中，讓大綱規劃實際納入使用者提示（先前完全未傳入，等同被忽略）；同時重用既有 `isMinimalSlideStyleRequested()`（沿用上一項高橋流逐字稿規則的偵測函式）判斷是否為高橋流 / 極簡大字風格，偵測到時將大綱 bullets 由預設 2~6 點降為 1~2 點，`OutlineSchema` 的 `bullets` 下限同步由 `min(2)` 放寬為 `min(1)` 以允許單一重點通過驗證；`splitTextWithLlmCore()`、`splitChunkRobust()` 與匯出的 `splitTextWithLlm()` 皆轉發此參數。`backend/src/worker/pipeline.ts` 兩處呼叫端改傳入 `row.user_prompt`。新增 2 個後端測試覆蓋 userPrompt 文字確實送入 LLM user message，以及高橋流偵測時 system prompt 出現對應規則且單一重點 bullets 通過 schema 驗證；backend typecheck 與既有測試套件通過（既有 18 項失敗為環境相關的既存失敗，與本次變更無關，已確認 stash 前後失敗清單一致）。

- 時間: 2026-06-18 08:05:00 +0800
- 分支: feature/remove-playpage-debug-console-20260618
- 內容: 完成移除播放頁貼上與拖曳重排的前端偵錯 `console.*`。新增 `frontend/src/lib/debugLog.ts`，提供 `debugLog()` / `debugWarn()`，只有在瀏覽器 `localStorage` 明確設定 `makeslide.debug = '1'` 時才會輸出，預設一律靜音；`PlayPageSidebar.tsx`（拖曳重排 drop-capture/dragstart/dragend、縮圖區貼上事件與無檔案警告）、`PlayPageSlidePanel.tsx`（投影片區貼上事件與無檔案警告）與 `PlayPage.tsx`（全域貼上事件、clipboard item 型別、無圖片警告、接受圖片摘要）的直接 `console.info/warn` 呼叫全部改用這兩個 helper，並移除對應 `eslint-disable-next-line no-console` 註解；一般使用者操作投影片、貼圖或拖曳重排時 console 不再被污染，需要除錯時開發者可在瀏覽器主控台執行 `localStorage.setItem('makeslide.debug','1')` 重新啟用。frontend typecheck 通過；與貼上/拖曳無關的既有 sync/tts 偵錯 `console.*`（如 `[sync][poll]`、`[tts][regenerate-audio]`）不在本次範圍內，維持原狀。

- 時間: 2026-06-18 08:20:00 +0800
- 分支: feature/source-copy-collapse-20260618
- 內容: 完成來源管理清單「複製內容」與「清除展開」小操作。`PlayPageSlidePanel.tsx` 在每個有 `content_text` 的來源列（包含一般 TXT/PDF 來源與 YouTube audio 來源）加入「複製內容」按鈕，使用既有共用 `copyTextToClipboard()` helper（先試 Clipboard API、失敗再 fallback 到 textarea/`execCommand`），並用 `sourceCopyStatus` 狀態顯示「已複製」或失敗提示，2 秒後自動還原按鈕文字；來源清單標題旁新增「全部收合」按鈕，僅在 `expandedSourceId !== null` 時顯示，點擊會呼叫既有 `setExpandedSourceId(null)` 一次清空展開狀態。未新增或修改任何 API、資料庫欄位。新增 `play.source.copyContent`、`play.source.copyContentSuccess`、`play.source.copyContentFailed`、`play.source.collapseAll` 中英文翻譯鍵，並在 `i18n.test.ts` 新增測試驗證這些鍵在兩種語言中存在且非空字串；確認本機可用 `tsx --test` 執行前端 `*.test.ts`（`npm test` 目前只跑 backend），執行後全部 122 項既有與新增前端測試通過，frontend typecheck 亦通過。

- 時間: 2026-06-18 08:35:00 +0800
- 分支: feature/recent-category-default-sort-20260618
- 內容: 完成「『最近的簡報』類別預設使用建立時間新到舊排序」。`HomePage.tsx` 將原本單一固定 `'title_asc'` 的初始排序預設改為依目前類別動態決定：新增 `getDefaultSortModeForCategory(categoryFilter)`，當 `categoryFilter === '__recent__'` 時回傳 `'created_desc'`，其餘類別維持 `'title_asc'`；`readStoredSortMode()` 改回傳 `SortMode | null`（沒有有效本機儲存值時回傳 `null`），並新增 `explicitSortMode` state 取代先前的 `sortMode` state，實際套用的 `sortMode = explicitSortMode ?? getDefaultSortModeForCategory(categoryFilter)`。使用者一旦透過排序下拉選單明確選擇過排序方式（`updateSortMode()`），該選擇會持續寫入 `makeslide.home.sortMode` 並套用到所有類別，維持先前「排序選項」功能讓使用者選擇後在所有類別一致套用的設計；只有在使用者從未手動選擇過排序方式時，切到「最近的簡報」才會自動預設顯示建立時間新到舊，切回其他類別則回到標題 A-Z 預設。新增 `frontend/src/pages/HomePage.sort.test.ts` 以 `tsx --test` 驗證 `getDefaultSortModeForCategory()` 在 `__recent__` 回傳 `created_desc`、在 `__all__`/一般分類/自訂分類回傳 `title_asc`；frontend typecheck 與既有/新增前端測試（`tsx --test`）均通過。

- 時間: 2026-06-18 08:50:00 +0800
- 分支: feature/readonly-block-github-sync-20260618
- 內容: 完成「read-only 模式時不能做同步到 GitHub 的動作」。後端 `backend/src/routes/pdfs/admin.ts` 的 `POST /api/pdfs/:id/github-sync` 原本只檢查 PDF 是否存在與 GitHub 是否設定，沒有任何擁有權限檢查；新增與 `detail.ts` 一致的 `sessionSub()` / `canEditPdf()`（私有簡報需擁有者本人、`public`(read-only) 一律禁止、`public_editable` 允許任何登入帳號），查詢 row 時補上 `owner_sub`、`visibility`，沒有編輯權限時回傳 `403 FORBIDDEN`，權限檢查在「GitHub 是否設定」檢查之前執行。前端 `PlayPageHeader.tsx` 的「同步到 GitHub」按鈕加上 `disabled={... || isReadOnlyProcessing}`，並在唯讀時把 `title` 改成新增的 `play.header.githubSyncReadOnly` 提示；`usePdfMetadata.ts` 的 `handleSyncToGithub()` 也加上 `isReadOnlyProcessing` 早期 return，避免透過鍵盤/程式呼叫繞過 UI disable。新增 `backend/test/github-sync.test.ts` 4 個測試，覆蓋非擁有者對 `public`/`private` 簡報請求同步應得 403、擁有者與 `public_editable` 協作者應能通過權限檢查（測試環境未設定 GitHub repo，因此後續會落在 `GITHUB_NOT_CONFIGURED` 400，用以證明沒有被權限擋下）。backend/frontend typecheck 通過；backend 測試套件 234 項中 18 項失敗為既有環境相關既存失敗（與本次變更前一致，4 項新增測試與既有 github-sync 無關測試均通過）。

- 時間: 2026-06-18 09:05:00 +0800
- 分支: feature/readonly-disable-settings-style-share-20260618
- 內容: 完成「read-only 模式時，設定/風格/分享等按鍵應該 disable」。檢查 `PlayPageHeader.tsx` 後確認「⚙️ 設定」（語音/TTS 設定，`setTtsDialogOpen`）與「🖼️ 風格」（圖片風格設定，`openImageStyleDialog`）兩個按鈕本來就已經有 `disabled={isReadOnlyProcessing}`，不需修改；但分享區塊的三個控制項缺少這個檢查：分享存取模式 `<select>`（`shareAccess`，僅切換 UI 選擇但容易誤導使用者）、「建立分享連結」按鈕（呼叫 `handleCreateShareLink()` 會建立分享並把 `visibility` 改成 `public`/`public_editable`）、「設為 private」按鈕（呼叫 `handleMakeSharePrivate()`）都只檢查 `shareBusy`、沒有檢查 `isReadOnlyProcessing`。修正：三個控制項的 `disabled` 都加上 `|| isReadOnlyProcessing`（select 直接用 `disabled={isReadOnlyProcessing}`），並補上對應 `disabled:cursor-not-allowed disabled:opacity-40` 樣式；`usePdfMetadata.ts` 的 `handleCreateShareLink()` 補上 `isReadOnlyProcessing` 早期 return（`handleMakeSharePrivate()` 先前已有此防呆，僅 UI 未反映）。後端 `POST /api/pdfs/:id/share`（`hasOwnerOrLegacyAccess`）與 `PATCH /api/pdfs/:id/visibility`（`canEditPdf`）確認已有擁有權限檢查，不需額外修改。frontend typecheck 與既有/新增前端測試（`tsx --test`，125 項）均通過。

- 時間: 2026-06-18 09:20:00 +0800
- 分支: master
- 內容: 依照 LOOP.md 在 TODO.md 已無未完成項目時重新檢視主要程式區塊，避開近期已完成的 i18n 系列、console 清理、來源管理複製/收合、首頁排序預設與 GitHub 同步/分享權限等項目。重點檢查播放頁尚未補齊 i18n 的對話框元件（`TtsDialog.tsx`、`ImageStyleDialog.tsx`、`VersionHistoryDialog.tsx` 皆完全沒有 `useI18n()`）、`ShareDialog.tsx` 的剪貼簿複製邏輯（尚未使用既有 `copyTextToClipboard()` helper），以及修完 `github-sync` 權限漏洞後比對其他後端寫入路由是否有相同問題；發現 `page-animation.ts`、`drawings.ts`、`quizzes.ts`、`page-operations.ts` 的多個寫入路由完全沒有 `canEditPdf()` 編輯權限檢查，任何已登入帳號可在唯讀分享簡報上修改動畫、畫板、測驗或頁面內容，屬於範圍較大的既有安全缺口；新增 7 個待辦項目：(1) 動畫與畫板路由權限檢查；(2) 測驗寫入路由權限檢查；(3) 頁面操作路由權限檢查（影響範圍最大，建議獨立 PR）；(4) TtsDialog i18n；(5) ImageStyleDialog i18n；(6) VersionHistoryDialog i18n；(7) ShareDialog clipboard fallback。

- 時間: 2026-06-18 09:40:00 +0800
- 分支: feature/animation-drawing-edit-permission-20260618
- 內容: 完成「後端動畫與畫板路由補上編輯權限檢查」。`backend/src/routes/pdfs/page-animation.ts` 新增與 `detail.ts`/`admin.ts` 一致的本地 `sessionSub()`/`canEditPdf()`/`getPdfPermissionRow()`，在 `PUT /api/pdfs/:id/pages/:n/animation`、`POST .../animation/auto-focus-ai`、`POST .../animation/custom-script`（SSE 串流路由，在 `reply.hijack()` 之前先檢查，確保權限不足時仍是一般 JSON 403 而非串流）三個寫入路由補上權限檢查，沒有編輯權限時回傳 `403 FORBIDDEN`；GET 路由（讀取目前動畫/spec）維持公開讀取不變。`backend/src/routes/pdfs/drawings.ts` 同樣新增權限 helper，`PUT`/`DELETE /api/pdfs/:id/pages/:n/drawing` 補上 PDF 存在性檢查（先前完全沒有，缺少時會靜默寫入孤兒列）與 `canEditPdf()` 權限檢查；`GET` 維持公開讀取。過程中發現 `backend/test/page-animation.test.ts` 既有的硬編碼 `SESSION_COOKIE` 簽章使用舊的 `AUTH_SESSION_SECRET` 產生、與目前環境的密鑰不符，先前因為這些路由完全沒有驗證 session 而沒被發現；新增權限檢查後該測試檔案大量失敗，改用與 `pages-api.test.ts`/`github-sync.test.ts` 一致的 `testSessionCookie()` 動態產生 cookie 解決。新增 3 個權限測試（PUT animation / auto-focus-ai / custom-script 對非擁有者的唯讀分享簡報應得 403）至 `page-animation.test.ts`，並新增 `backend/test/drawings.test.ts` 6 個測試覆蓋 GET 公開讀取、PUT/DELETE 對非擁有者 `public`/`private` 簡報應得 403、擁有者與 `public_editable` 協作者應可寫入、未知簡報應得 404。backend typecheck 通過；完整測試套件 243 項中 18 項失敗為既有環境相關既存失敗（與本次變更前一致，新增的 9 項測試與既有 page-animation 116 項測試僅 1 項為既有失敗、與本次變更無關）。

- 時間: 2026-06-18 09:55:00 +0800
- 分支: feature/quizzes-edit-permission-20260618
- 內容: 完成「後端測驗寫入路由補上編輯權限檢查」。`backend/src/routes/pdfs/quizzes.ts` 新增與其他寫入路由一致的本地 `sessionSub()`/`canEditPdf()`/`getPdfPermissionRow()`，在 `POST /api/pdfs/:id/quizzes/generate`（延伸既有 pdf 查詢補上 `owner_sub`/`visibility`）、`POST /api/pdfs/:id/quizzes`（先前完全沒有檢查 PDF 是否存在，這次也補上 `404 PDF_NOT_FOUND`）、`PUT /api/pdfs/:id/quizzes/:quizId` 三個路由補上權限檢查，沒有編輯權限時回傳 `403 FORBIDDEN`。`GET /api/pdfs/:id/quizzes`（列出測驗）與 `POST /api/pdfs/:id/quizzes/:quizId/attempts`（學生作答提交）維持現狀不受限制，因為唯讀瀏覽者與課堂測驗的 follower 本來就需要能看到測驗內容並提交作答。新增 `backend/test/quizzes.test.ts` 6 個測試，覆蓋 generate/create/update 對非擁有者的唯讀分享簡報應得 403、create 對未知簡報應得 404、擁有者與 `public_editable` 協作者應可正常產生/新增/更新測驗、attempts 提交不受權限限制仍可成功。backend typecheck 通過，完整測試套件 249 項中 18 項失敗為既有環境相關既存失敗（與本次變更前一致）。

- 時間: 2026-06-19 00:15:00 +0800
- 分支: feature/page-operations-edit-permission-20260618
- 內容: 完成「後端頁面操作路由補上編輯權限檢查」。`backend/src/routes/pdfs/page-operations.ts` 新增與其他寫入路由一致的本地 `sessionSub()`/`canEditPdf()`/`getPdfPermissionRow()`，並在全部 10 個寫入路由補上權限檢查（沒有編輯權限時回傳 `403 FORBIDDEN`）：`POST /pages`（新增頁）、`POST /pages/move`（移動頁）、`DELETE /pages/:n`（刪除頁）、`POST /pages/:n/replace-image`、`POST /pages/:n/regenerate-image`、`POST /pages/:n/inpaint-image`、`POST /pages/:n/rewrite-script`、`POST /pages/:n/regenerate-audio`、`DELETE /pages/:n/chat-history`、`POST /pages/:n/chat`；多數路由已經有查詢 pdf row 供其他用途，因此盡量延伸既有 SELECT 補上 `owner_sub`/`visibility` 欄位以避免重複查詢，其餘兩個（`chat-history` DELETE、`chat` POST）原本完全沒有查詢 pdf 權限，新增 `getPdfPermissionRow()` 呼叫。`GET /pages/:n/image-candidates/:candidateId` 與 `GET /pages/:n/chat-history` 維持公開讀取，因為唯讀瀏覽者仍需要看到既有候選圖與對話記錄。新增 `backend/test/page-operations-permission.test.ts` 15 個測試，覆蓋全部 10 個寫入路由對非擁有者唯讀分享簡報應得 403（含 `replace-image`/`inpaint-image` 用最小 multipart payload 測試，因為權限檢查發生在解析檔案內容之前）、新增頁/移動頁/刪除頁/清空對話記錄對擁有者應正常成功、`public_editable` 協作者應能通過權限檢查。backend typecheck 通過，完整測試套件 264 項中 18 項失敗為既有環境相關既存失敗（與本次變更前一致，新增的 15 項測試與既有 page-operations 相關測試皆通過，包含確認既有失敗的具體錯誤內容皆為檔名/狀態碼斷言不符而非新增的 403，證實與本次權限變更無關）。本項完成後 TODO.md 中所有「後端寫入路由補上編輯權限檢查」相關待辦皆已處理完畢（github-sync、page-animation/drawings、quizzes、page-operations）。
