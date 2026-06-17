# MakeSlide 功能說明

## 本頁產生耗時總計與異常摘要

### 功能目的

播放頁的「本頁產生耗時」區塊原本只分別顯示圖片、文字、講稿與語音四個 artifact 的處理耗時。新版在標題列加入總耗時與異常摘要，讓使用者不必逐一查看 chip，就能快速知道本頁已完成產物累計花了多久，以及是否有任何失敗或超過 SLA 的項目需要優先檢查。這對排查單頁生成過慢、確認重產後是否恢復正常，以及快速瀏覽大量頁面的 pipeline 健康狀態都更直覺。

### 使用方式

1. 進入任一簡報播放頁並選取要檢查的頁面。
2. 在播放區附近查看「本頁產生耗時」區塊。
3. 標題列會顯示「總計 {duration}」（英文介面為 **Total {duration}**）：
   - 只累計狀態為 `succeeded` 且具有效 `duration_ms` 的 artifact。
   - 尚無任何完成耗時時會顯示既有的「尚無紀錄」。
4. 若圖片、文字、講稿或語音任一項目失敗，或 SLA 狀態為 `breached`，標題列會額外顯示「{count} 項需注意」（英文介面為 **{count} need attention**）。
5. 每個 artifact chip 仍維持原本互動方式；滑鼠停留在 chip 上可看到既有 tooltip 詳細資訊，包括狀態、耗時、原因、SLA、開始/結束時間、run id 與錯誤訊息。

### 技術細節

- `PageTimingChips.tsx` 先把 image/text/script/audio 四個 timing 取出為同一份 `timingItems`，標題列與 chip 列共用同一組資料，避免總計與個別 chip 使用不同來源。
- 新增 `sumCompletedDurationMs()` formatter：只接受 `status === 'succeeded'` 且 `duration_ms` 為有限數字的項目，並回傳總毫秒數；若沒有任何可累計的完成耗時則回傳 `null`，交由 `formatDurationMs()` 顯示「尚無紀錄」。
- 異常摘要以 `status === 'failed'` 或 `sla_status === 'breached'` 判斷，計算符合條件的 artifact 數量後才顯示 amber badge；一般 warning SLA 仍保留在個別 chip 顏色與 tooltip 中，不升級為標題列警示。
- Tooltip 仍使用既有 `timingTitle()`，不刪減任何細節；新版只在標題列增加摘要資訊。
- `zh-TW.ts` 與 `en.ts` 新增 `play.timing.title`、`play.timing.total`、`play.timing.attentionSummary` 與四個 artifact label，讓標題、總計、警示摘要與 chip 標籤都能依 UI 語言切換。
- 新增 `frontend/src/pages/play/formatters.test.ts`，覆蓋毫秒/秒格式化、缺漏/無效值，以及總計只累加已完成 artifact 的規則。

## 播放頁清除本簡報播放進度

### 功能目的

播放頁會自動把每份簡報的目前頁碼與播放秒數儲存在瀏覽器 localStorage，例如 `makeslide.playback.progress.{pdfId}`，下次開啟同一份簡報時可自動回到上次觀看位置。這對長簡報很方便，但在重新上課、示範給其他人、錄製影片或測試分享連結時，使用者常需要從第一頁開頭重新開始。新版在播放設定中新增「清除本簡報播放進度」按鈕，讓使用者不用開發者工具就能清除該份簡報的本機播放記錄。

### 使用方式

1. 進入任一簡報的播放頁。
2. 在播放區下方的「播放設定」卡片點選「⚙️ 設定」展開設定內容。
3. 找到「播放進度」區塊，點選「清除本簡報播放進度」。
4. 系統會立即：
   - 移除本機 localStorage 中該簡報的 `makeslide.playback.progress.{pdfId}` 記錄。
   - 停止目前播放並取消動畫延長播放計時。
   - 將頁面切回第一頁。
   - 將目前播放時間與音訊元素時間重設為 `0`。
   - 顯示「播放進度已清除，已回到第一頁開頭。」狀態訊息。
5. 重新整理或下次開啟同一簡報時，因為本機進度已清除，播放頁會從第一頁開頭開始。
6. 使用分享唯讀連結開啟簡報時也能使用此功能；它只清除目前瀏覽器的本機播放進度，不會修改簡報內容或伺服器資料。

### 技術細節

- `PlayPage.tsx` 原本已有 `playbackProgressStorageKey = makeslide.playback.progress.{pdfId}`，並用 effect 自動恢復 `page_number` 與 `current_time`；新版沿用同一個 key 進行精準刪除。
- 新增 `handleClearPlaybackProgress()`：會先取消 `persistProgressTimerRef` 中尚未寫回 localStorage 的延遲儲存，避免清除後又被舊 timer 寫回。
- 清除流程會同步重設 `resumePositionRef`、`currentIdx`、`currentTime`、`finished`、`classroomAwaitingNext` 與 audio element 的 `currentTime`，並暫停播放，讓畫面與實際音訊狀態一致。
- 若正在播放動畫長度超過語音長度的延長段落，會呼叫既有 `clearPendingPageExtend()`，避免清除後仍由延長計時器自動切頁。
- `PlayPageSlidePanel.tsx` 將控制放在播放設定區塊中，不使用 `isReadOnlyProcessing` 停用，因此分享唯讀模式仍可操作本機進度。
- `zh-TW.ts` 與 `en.ts` 新增 `play.playbackProgress.title`、`play.playbackProgress.description`、`play.playbackProgress.clear`、`play.playbackProgress.cleared`，確保中英文 UI 與狀態訊息一致。

## YouTube 匯入字幕語言快速選項

### 功能目的

YouTube 匯入面板現在在字幕語言輸入框旁新增常用語言快速選項，讓使用者不必每次手動輸入 `zh-TW`、`en` 或 `ja` 等語言代碼，也能用「自動」交由系統依影片可用字幕選擇。這對經常匯入中文、英文、日文教學影片，或不確定影片字幕語言代碼時特別有幫助，可降低輸入錯誤與重複操作成本。

### 使用方式

1. 在首頁點選「YouTube 匯入」展開匯入面板。
2. 貼上 YouTube URL 後，可直接手動輸入字幕語言，也可點選字幕欄位旁的快速按鈕：`zh-TW`、`en`、`ja` 或「自動」。
3. 點選任一快速按鈕後，字幕語言輸入框會立即填入對應值；目前選中的快速按鈕會以高亮狀態顯示。
4. 選擇 `zh-TW`、`en` 或 `ja` 時，建立 YouTube 任務會送出該語言代碼，後端會優先抓取對應字幕。
5. 選擇「自動」時，輸入框會顯示 `auto`，但送出任務時會轉成未指定語言，讓既有 YouTube 匯入流程自動選擇可用字幕。

### 技術細節

- `UploadButton.tsx` 保留既有 `youtubeLang` state 與文字輸入框，僅在旁邊新增快速按鈕列，避免改變原有手動輸入能力。
- 快速選項集中在 `YOUTUBE_SUBTITLE_LANGUAGE_OPTIONS`，目前順序為 `zh-TW`、`en`、`ja`、`auto`。
- 新增 `normalizeYoutubeSubtitleLanguageForSubmit()`，送出前會先 trim；空字串或大小寫不敏感的 `auto` 會回傳 `undefined`，其餘語言代碼維持原值送入既有 `createYoutubeTask()`。
- `zh-TW.ts` 與 `en.ts` 新增字幕語言 label、快速選項 aria label 與自動選擇文案，確保中英文介面與輔助工具都有清楚說明。
- 目前前端沒有 React 元件互動測試依賴，因此新增可由現有 Node/tsx 測試架構執行的純函式測試，覆蓋快速選項清單順序、明確語言代碼保留，以及 `auto`/空白轉為未指定語言的提交規則。

## ZIP 匯入成功後自動開啟提示詞視窗

### 功能目的

ZIP 匯入流程現在會在匯入成功後立即開啟提示詞視窗，讓使用者能像一般 PDF 上傳一樣，直接補充生成風格、語氣、重點方向或空白使用預設風格後開始處理。過去 ZIP 匯入完成後只會把簡報加入首頁清單並顯示 toast，使用者還需要再點一次卡片才會進入提示詞流程；新版移除這個額外步驟，特別適合匯入備份檔或從其他環境轉移簡報後立刻重新產生內容。

### 使用方式

1. 在首頁點選「匯入 ZIP」並選擇先前匯出的簡報 ZIP 檔。
2. 匯入進度完成後，首頁仍會顯示匯入成功 toast，並把新簡報加入清單最前方。
3. 系統會自動開啟提示詞視窗；可在文字框中輸入希望 AI 生成逐字稿時採用的風格或補充需求。
4. 若 ZIP 檔本身已包含 `user_prompt`，提示詞視窗會自動帶入該內容，使用者可直接沿用、微調或清空。
5. 送出提示詞後，既有處理流程會照常呼叫開始處理 API；此功能不改變後端匯入格式或處理 API。

### 技術細節

- `HomePage.tsx` 的 ZIP 匯入 handler 在 `importPdfZip(file)` 成功回傳 `imported` 後，除了原本的 `setItems((prev) => [imported, ...prev])` 與匯入成功 toast，現在也會呼叫既有 `openPromptFor(imported)`。
- `openPromptFor()` 已支援 `PdfListItem | UploadResponse`，並會在物件含有字串型 `user_prompt` 時將其作為 `PromptModal` 的 `initialValue`，因此 ZIP 匯入檔若保留提示詞資料可直接沿用。
- 為了讓 ZIP 匯入 handler 可呼叫 `openPromptFor()`，函式宣告位置提前到 `handleImportZipChange()` 前方；行為本身與 PDF 上傳、卡片點擊開啟提示詞視窗共用同一套狀態。
- 此更新只調整前端流程，不修改 `importPdfZip()` API、後端匯入端點或提示詞送出 API。

## PDF 卡片總語音長度顯示

### 功能目的

首頁 PDF 卡片現在會在資訊列顯示該簡報已產生音訊的總長度，讓使用者不必進入播放頁就能快速判斷一份簡報大約需要播放多久。這對整理多份課程、比較不同版本簡報長短，或在上課/錄影前挑選合適長度的素材特別有幫助。

### 使用方式

1. 回到首頁簡報清單後，卡片標題下方的資訊列會維持顯示建立時間與頁數。
2. 若後端清單資料提供 `total_audio_duration_seconds`，同一列會額外顯示「語音 {duration}」（英文介面為 **Audio {duration}**）。
3. 時間格式會依長度自動切換：
   - 一小時內使用 `M:SS`，例如 `12:34`。
   - 一小時以上使用 `H:MM:SS`，例如 `1:02:03`。
   - 低於一分鐘也會顯示分鐘欄位，例如 `0:07`。
4. 若簡報尚未產生音訊、資料為 `null` / `undefined`，或欄位不存在，卡片不會顯示語音長度，避免誤導使用者。

### 技術細節

- `PdfListItem` 既有 `total_audio_duration_seconds?: number | null` 欄位直接由 `PdfCard.tsx` 使用，不需調整 API 型別。
- 新增共用 `formatAudioDuration()` formatter，先排除 `null`、`undefined`、非有限數字與負數，再以 `Math.floor()` 轉成整秒，避免小數秒造成畫面跳動。
- `PdfCard.tsx` 將原本左右對齊的資訊列改成可換行的 flex layout，讓建立時間、頁數與語音長度在窄卡片上仍能自然排列。
- `zh-TW.ts` 與 `en.ts` 新增 `card.totalAudioDuration` 與 `card.totalAudioDurationLabel`，分別提供顯示文字與 title/輔助說明。
- 新增 formatter 測試覆蓋秒數、分鐘、小時、`null`、`undefined` 與無效輸入，確保顯示規則穩定。

## 首頁標題搜尋清除與結果摘要

### 功能目的

首頁標題搜尋現在支援快速清除按鈕與結果摘要，讓使用者在簡報數量增加後更容易掌握目前清單狀態。過去輸入標題關鍵字後必須手動刪除文字才能回到完整清單，也無法直接知道目前搜尋命中幾份簡報；新版會在搜尋框有文字時顯示「清除」按鈕，並在篩選區顯示目前實際顯示數量與同一分類範圍內的總數。

### 使用方式

1. 進入首頁後，只要已有簡報，篩選區會顯示「標題篩選」輸入框。
2. 輸入關鍵字後，清單會依目前分類或「最近的簡報」範圍套用標題搜尋。
3. 搜尋框右側會在有文字時顯示「清除」（英文介面為 **Clear**）按鈕；點擊後會立即清空搜尋文字並恢復該分類範圍內的完整清單。
4. 篩選區下方會顯示「顯示 {shown} / {total} 份簡報」（英文介面為 **Showing {shown} / {total} presentations**）：
   - `shown` 代表目前套用標題搜尋後實際顯示的簡報數量。
   - `total` 代表在目前類別或「最近的簡報」視圖下、尚未套用標題搜尋前的簡報總數。
5. 既有標題搜尋持久化行為維持不變；搜尋文字與清除後的空字串都會同步寫入 localStorage。

### 技術細節

- `HomePage.tsx` 沿用既有 `titleFilter` 與 `updateTitleFilter()`，清除按鈕直接呼叫 `updateTitleFilter('')`，因此畫面狀態與 `makeslide.home.titleFilter` localStorage 會一致更新。
- 結果摘要以 `filteredItems.length` 作為 `shown`，以 `categoryFilteredItems.length` 作為 `total`。這表示摘要會尊重既有分類選擇：單一分類時只計算該分類；「全部類別」與「最近的簡報」則以目前頁面原本語意使用所有簡報作為 title filter 前基準。
- 搜尋框改為相對定位容器，輸入欄保留右側 padding 給清除按鈕，避免按鈕覆蓋輸入文字。
- 摘要使用 `aria-live="polite"`，讓輔助工具可在搜尋結果數量變化時以非干擾方式更新。
- `zh-TW.ts` 與 `en.ts` 新增 `home.clearTitleFilter`、`home.resultSummary`，確保中英文介面都有完整文案。

## 首頁簡報清單排序選項

### 功能目的

首頁簡報清單現在新增「排序方式」下拉選單，讓使用者可以依照目前整理簡報的情境切換排序，而不再只能在一般分類中使用標題排序、在「最近的簡報」中固定使用建立時間倒序。這對簡報數量變多後特別有幫助：想快速找最新匯入內容時可依建立時間排序；想回到最近編輯的工作可依更新時間排序；想找大型課程或長份簡報時可依頁數排序；需要穩定瀏覽時則可維持預設標題 A-Z。

### 使用方式

1. 進入首頁後，只要已有簡報，篩選區會顯示「排序方式」（英文介面為 **Sort by**）下拉選單。
2. 可選擇以下模式：
   - 「標題 A-Z」／**Title A-Z**：依標題由小到大排列，也是既有預設行為。
   - 「建立時間新到舊」／**Newest created**：新建立或新匯入的簡報排在前面。
   - 「更新時間新到舊」／**Recently updated**：最近被更新的簡報排在前面。
   - 「頁數多到少」／**Most pages**：頁數較多的簡報排在前面。
3. 排序偏好會自動儲存在瀏覽器 localStorage 的 `makeslide.home.sortMode`，重新整理或下次開啟首頁時會延續上次選擇。
4. 無論目前選擇「全部類別」、單一分類或「最近的簡報」，清單內的簡報都會套用同一個排序方式；「最近的簡報」不再強制固定為建立時間倒序。

### 技術細節

- `HomePage.tsx` 新增 `SortMode` union type，支援 `title_asc`、`created_desc`、`updated_desc`、`page_count_desc` 四種模式。
- 新增 `SORT_MODE_STORAGE_KEY = 'makeslide.home.sortMode'`，以 `readStoredSortMode()` 讀取並驗證 localStorage 內容；未知值會回退到 `title_asc`，避免舊資料或手動修改造成錯誤狀態。
- 排序邏輯集中在 `getComparatorForSortMode()` 與 `sortItems()`，並在主要比較結果相同時以標題排序作為 tie-breaker，讓列表更穩定。
- 一般分類群組與「最近的簡報」群組都改用 `sortItems(filteredItems)` 或 `sortItems(group.items)`，確保標題搜尋與分類篩選後仍一致套用目前排序模式。
- `zh-TW.ts` 與 `en.ts` 新增 `home.sortBy`、`home.sort.titleAsc`、`home.sort.createdDesc`、`home.sort.updatedDesc`、`home.sort.pageCountDesc`，讓中英文介面都有完整文案。

## 系統設定分類導覽頁

### 功能目的

系統設定頁現在改成左側分類 navigation bar、右側顯示目前分類設定內容的版面。過去所有設定集中在同一個長頁面中，API Key、語言、GitHub、AI 技能與管理員設定混在一起；新版將設定依用途拆成不同分類，降低尋找成本，也避免使用者在調整單一類型設定時被不相關欄位干擾。

### 使用方式

1. 進入「設定」頁後，左側會顯示設定分類導覽；小螢幕時導覽列會以橫向可捲動方式呈現。
2. 點選「帳號與偏好」可調整 Google 登入/登出、使用者代碼、介面語言、產生結果語言與播放速度。
3. 點選「AI 與語音」可設定 LLM/TTS 供應商、OpenAI/Gemini API Key、模型名稱、CGU Air API、自動產生焦點動畫，以及 Gemini/OpenAI 雙 speaker 人設與 voice。
4. 點選「同步」可設定 GitHub repository URL 與 token，用於簡報同步。
5. 點選「AI 技能」可啟用/停用內建技能、編輯或刪除自訂技能，並新增要注入 AI 呼叫的自訂指令。
6. 若目前帳號具備 admin 權限，會額外看到「管理員」分類，可設定 Google Auth、移交 admin 權限，以及調整 Pipeline SLA stage/artifact 目標時間。
7. 各分類右側只顯示該分類內容；儲存按鈕保留原本行為，仍會一次保存對應的系統 AI/使用者/同步/admin 設定，不影響既有設定功能。

### 技術細節

- `SettingsPage.tsx` 新增 `SettingsCategory` 與 `activeCategory` 狀態，以 `settingsCategories` 描述所有分類的 id、顯示名稱、描述與 admin-only 條件。
- 左側 navigation bar 只列出目前使用者可見分類；非 admin 使用者不會看到 admin 分類，若權限狀態改變且目前停在 admin 分類，會自動切回「帳號與偏好」。
- 原本設定項完整保留並重新分組：帳號/語言/播放速度、AI provider/API/model/TTS、自動動畫、GitHub 同步、AI 技能、Google Auth/admin transfer/SLA。
- `zh-TW.ts` 與 `en.ts` 同步新增分類導覽與登入狀態 i18n key，確保中英文介面都有一致文案。
- 已執行 frontend TypeScript typecheck，確認重構後型別正確。

## Pointer 透明度選項

### 功能目的

`pointer` 動畫效果現在支援 `pointerOpacity` 可見狀態透明度設定，讓指標不再只能以完全不透明的方式顯示。當投影片中有密集文字、圖表數據或需要指向但不想遮住內容的區域時，可以將指標調成半透明，例如 `0.5` 或 `0.7`，在保留視覺引導效果的同時降低遮擋感。

### 使用方式

1. 在播放頁的動畫編輯器中新增或選擇一個 `pointer` 效果。
2. 在指標形狀、角度、顏色與大小設定附近找到「**透明度**」（英文介面為 **Opacity**）。
3. 使用滑桿或數字輸入調整透明度，介面建議範圍為 `0.1` 到 `1`，步進為 `0.1`。
4. 設為 `1` 時維持既有完全不透明外觀；設為較低數值時，指標淡入後會停留在對應透明度，直到消失動畫開始。
5. 舊有動畫規格沒有 `pointerOpacity` 時會自動使用預設 `1`，不需要手動遷移。

### 技術細節

- 後端 `AnimationEffect` 新增 `pointerOpacity?: number`，並在 `EffectSchema` 使用 `z.number().min(0).max(1).optional()` 驗證。
- `validateAnimationSpec()` 序列化時會保留合法的 `pointerOpacity`，並以 `Math.max(0, Math.min(1, value))` 做 min/max clamp。
- 前端 `SlideAnimationEffect` 同步新增 `pointerOpacity` 欄位。
- `buildGsapTimeline.ts` 的 pointer 淡入動畫由固定 `autoAlpha: 1` 改為 `autoAlpha: effect.pointerOpacity ?? 1`，因此可見狀態會使用使用者指定的不透明度。
- `AnimationEditorTab.tsx` 在 pointer 設定區加入 range slider 與 number input，讓使用者可直接調整透明度；中英文 i18n 新增 `play.animation.pointerOpacity`。

## Manim animate.colorCycle 顏色循環效果

### 功能目的

Manim helper 現在新增 `animate.colorCycle(m, progress, opts)`，讓 custom-script 動畫可以在多個 hex 顏色之間連續插值，適合製作 ROYGBIV 彩虹描邊、流程狀態色變化、重點圖形循環上色，或讓某個 SVG 元素在播放期間以更柔和的方式吸引注意。

### 使用方式

在 `custom-script` 中建立 Manim mobject 後，於 `api.onFrame()` 依目前動畫進度呼叫 `Manim.animate.colorCycle()`：

```javascript
var svg = Manim.createSvg(root);
var ring = Manim.shapes.circle(svg, {
  x: 0,
  y: 0,
  radius: 1.2,
  color: '#ff0000',
  strokeWidth: 0.08,
});

api.onFrame(function(frame) {
  Manim.animate.colorCycle(ring, frame.t, {
    colors: ['#ff0000', '#ff7f00', '#ffff00', '#00ff00', '#0000ff', '#4b0082', '#9400d3'],
    attr: 'stroke',
  });
});
```

- `colors`：必填 hex 色碼陣列，至少需要 2 色；若未提供或少於 2 色，函式會安全 no-op，不改動元素顏色。
- `attr`：指定要套用的 SVG 屬性，可為 `stroke`、`fill` 或 `both`，預設為 `stroke`。若指定 `both`，描邊與填色會同步更新；文字元素在更新 stroke 時也會同步更新 fill，維持文字可見。
- `progress` 會先限制在 `0..1`，再以 `progress * (colors.length - 1)` 計算位於哪兩個相鄰顏色之間，並使用 `lerpColor()` 做 RGB 線性插值。
- `progress = 1` 時會直接落在最後一個色碼，確保動畫結束時不會因浮點或索引邊界停在倒數第二段。

### 技術細節

- `animate.colorCycle()` 加入既有 Manim helper 的 `animate` 物件，沿用同檔案的 `clamp01()`、`lerpColor()` 與 SVG 屬性更新風格。
- 當 `opts.colors` 不存在或長度小於 2 時直接 `return`，避免錯誤輸入造成 sandbox 腳本中斷。
- `attr` 若不是合法值會回退到預設 `stroke`，降低 AI 或使用者產生腳本時的輸入風險。
- 新增 VM 測試驗證 `progress=0.25` 且三色陣列時會落在第一、第二色中間，以及 `progress=1` 搭配 `attr: 'both'` 時 stroke/fill 都等於最後一色。

## Manim animate.blink 閃爍效果

### 功能目的

Manim helper 現在新增 `animate.blink(m, progress, opts)`，讓 custom-script 動畫可以用週期性的亮暗切換快速吸引觀眾注意。相較於一般淡入淡出，blink 更適合用在短暫提示、警示狀態、目前步驟標記、互動操作重點，或需要在複雜圖形中讓某個元素「閃一下」的場景。

### 使用方式

在 `custom-script` 中建立 Manim mobject 後，於 `api.onFrame()` 以目前動畫進度呼叫 `Manim.animate.blink()`：

```javascript
var svg = Manim.createSvg(root);
var marker = Manim.shapes.circle(svg, {
  x: 0,
  y: 0,
  radius: 0.35,
  color: Manim.colors.YELLOW,
  fill: Manim.colors.YELLOW,
  fillOpacity: 1,
});

api.onFrame(function(frame) {
  Manim.animate.blink(marker, frame.t, {
    cycles: 3,
    minOpacity: 0.15,
  });
});
```

- `cycles`：閃爍次數，預設為 `3`。每個 cycle 分成亮、暗兩個半週期。
- `minOpacity`：暗相位的不透明度，預設為 `0`。若希望暗相位仍保留淡淡可見，可設定如 `0.15` 或 `0.25`。
- `progress` 到達 `1` 時，元素會自動恢復 `opacity = '1'`，避免動畫結束後停留在透明狀態。

### 技術細節

- `animate.blink()` 使用 `clamp01(progress)` 將進度限制在 `0..1`。
- 亮暗切換遵循 `Math.floor(progress * cycles * 2) % 2 === 0 ? 1 : 0`：偶數半週期為亮相位，奇數半週期為暗相位。
- 暗相位不直接固定為 `0`，而是套用 `opts.minOpacity ?? 0`，讓腳本可選擇完全消失或半透明閃爍。
- 當 `progress >= 1` 時直接設定 `m.el.style.opacity = '1'` 並結束，確保沒有殘留透明度。
- 新增 VM 測試覆蓋 `progress=0.5` 的半週期規律，以及 `progress=1` 的 opacity 還原行為。

## Text-callout 內距選項

### 功能目的

`text-callout` 動畫效果現在可以在小、中、大三種內距之間切換，讓同一段提示文字能依投影片版面調整視覺密度。較小內距適合狹窄標籤或角落註記；預設中等內距維持既有外觀；較大內距則適合用於重點提示、結論摘要或需要更高視覺份量的 callout。

### 使用方式

1. 在播放頁的動畫編輯器中新增或選擇一個 `text-callout` 效果。
2. 在文字、顏色、字型大小與對齊設定附近找到「**內距**」（英文介面為 **Padding**）下拉選單。
3. 選擇 `Small` / `小` 時使用 `0.25em 0.5em`，適合精簡標籤；選擇 `Medium` / `中（預設）` 時使用既有 `0.5em 0.75em`；選擇 `Large` / `大` 時使用 `0.75em 1.25em`，適合醒目提示框。
4. 未設定舊資料會自動以 `md` 行為顯示，因此既有動畫規格不需要手動遷移。

### 技術細節

- 後端 `AnimationEffect` 新增 `textCalloutPadding?: 'sm' | 'md' | 'lg'`，並在 `EffectSchema` 以 `z.enum(['sm', 'md', 'lg']).optional()` 驗證。
- `validateAnimationSpec()` 序列化時保留合法的 `textCalloutPadding` 值，未設定時仍維持省略並由前端使用預設 `md`。
- 前端 `SlideAnimationEffect` 同步新增 `textCalloutPadding` 欄位。
- `SlideRenderer.tsx` 新增 padding map，將 `sm`、`md`、`lg` 映射到對應 CSS padding，取代原本硬編碼的 `0.5em 0.75em`。
- `AnimationEditorTab.tsx` 在 `text-callout` 設定區加入 select 選擇器，並補上中英文 i18n 翻譯鍵。

## Step-list 指定步驟高亮

### 功能目的

`step-list` 動畫效果現在可以指定一個 0-based 的步驟索引作為高亮項目，讓簡報播放時在多個條列重點中清楚標示目前要強調的步驟。此功能適合用於流程教學、操作步驟、解題推導或逐步說明，讓觀眾更容易聚焦在當下討論的項目。

### 使用方式

1. 在播放頁的動畫編輯器中新增或選擇一個 `step-list` 效果。
2. 於「條列項目」中輸入每行一個步驟或重點。
3. 在「**高亮步驟（從0起算）**」（英文介面為 **Highlight step (0-based)**）輸入要高亮的項目索引，例如輸入 `0` 代表第一個項目、輸入 `2` 代表第三個項目。
4. 清空輸入框即可取消高亮；若沒有條列項目，輸入框會停用。
5. 播放投影片時，被指定的 `<li>` 會加粗、使用 `stepListTextColor` 作為文字色，並在左側顯示同色的 3px 高亮色條。

### 技術細節

- 後端 `AnimationEffect` 新增 `stepListHighlightIndex?: number`，並在 `EffectSchema` 以 `z.number().int().min(0).optional()` 驗證。
- `validateAnimationSpec()` 序列化時以 `Math.max(0, Math.round(...))` 正規化高亮索引。
- 前端 `SlideAnimationEffect` 同步新增 `stepListHighlightIndex?: number`。
- `SlideRenderer.tsx` 在渲染 `step-list` 的 `<li>` 時，比對 `index === stepListHighlightIndex` 並套用 `fontWeight: 800`、`color: stepListTextColor`、`borderLeft: 3px solid stepListTextColor`。
- `AnimationEditorTab.tsx` 在 `step-list` 設定區新增可清空的 number input，範圍為 `0` 到目前有效項目數量減一。
- 新增中英文翻譯鍵 `play.animation.stepListHighlightIndex`。

## Shape 發光效果

### 功能目的

`shape` 動畫效果現在可以開啟發光輪廓，讓圓形、矩形、線段、箭頭、三角形、五角星與六角形等 SVG 圖元在投影片背景上更醒目。這個功能適合用於強調關鍵區域、標示流程重點，或在深色背景上建立霓虹式視覺提示。

### 使用方式

1. 在播放頁的動畫編輯器中新增或選擇一個 `shape` 效果。
2. 在 shape 設定區調整「描邊顏色」與「線寬」。
3. 勾選「**發光效果**」（英文介面為 **Glow effect**）。
4. 播放投影片時，shape 外層 SVG 會使用描邊顏色產生 `drop-shadow` 發光輪廓；若修改描邊顏色，發光顏色也會同步改變。

### 技術細節

- 後端 `AnimationEffect` 新增 `shapeGlow?: boolean`，並在 `EffectSchema` 以 `z.boolean().optional()` 驗證。
- `validateAnimationSpec()` 序列化時保留 `shapeGlow`，確保儲存在 animation spec JSON 後仍可正確還原。
- 前端 `SlideAnimationEffect` 同步新增 `shapeGlow?: boolean`。
- `SlideRenderer.tsx` 在 `shape` SVG 的 style 中條件加入 `filter: drop-shadow(0 0 8px ${stroke})`，以目前描邊色作為光暈顏色。
- `AnimationEditorTab.tsx` 在 shape 設定區加入勾選框，並新增中英文翻譯鍵 `play.animation.shapeGlow`。

## Pointer 效果方向自訂

### 功能目的

動畫編輯器中的 `pointer`（指標）效果，原本只能顯示一個固定的發光圓點作為視覺引導。這個更新將其改造為可旋轉的 SVG 箭頭游標，讓使用者能明確指向投影片上的任意方向。

### 使用方式

1. 在動畫編輯器中，新增一個類型為 `pointer` 的效果。
2. 在指標位置（`X%`、`Y%`）的控制區段下方，會出現「**指標旋轉角度（°）**」輸入框。
3. 輸入旋轉角度（-180 至 180 度，步進 15 度）：
   - `0°`（預設）：箭頭指向右下方
   - `90°`：箭頭旋轉 90 度（指向右下方旋轉至右下偏下）
   - `-90°`：反方向旋轉
4. 播放時，箭頭游標會依設定角度旋轉，明確指引觀眾注意投影片特定區域。

### 技術細節

- `AnimationEffect` 型別新增 `angle?: number` 欄位（前後端同步）
- `SlideRenderer` 將 pointer 渲染從 CSS 漸層圓點改為 SVG `<path>` 箭頭，並以 CSS `transform: rotate(Xdeg)` 套用旋轉
- 後端 `EffectSchema` 以 `z.number().finite()` 驗證 angle 值，通透傳遞至儲存的 animation spec JSON
- 編輯器使用 `<input type="number" step={15}>` 讓使用者快速以 15 度為單位調整方向

## 動畫效果播放預覽跳轉

### 功能目的

在動畫編輯器中，每個效果卡片上新增 ⏮「跳至效果起點」按鈕，讓使用者可以立即將音訊播放器定位到該效果的開始時間，快速預覽效果從頭播放的視覺呈現，大幅縮短反覆調整效果位置與時間點的來回操作。

### 使用方式

1. 在動畫編輯器中，展開任一效果卡片。
2. 卡片頂端操作列新增了 **⏮** 按鈕（「跳至效果起點」）。
3. 點擊 ⏮ 後，音訊播放器的 `currentTime` 會立即跳至該效果的 `start` 秒數，讓使用者可以直接觀看效果的出現過程。
4. 原有的 **⏱**（跳至效果中點）按鈕仍保留，可用於在效果完全顯示後才開始觀察的場景。

### 技術細節

- `AnimationEditorTab.tsx` 在各效果卡片的 ⏱ 按鈕旁新增 ⏮ 按鈕，點擊時呼叫已有的 `handleSeekToTime(effectStart)` 函式
- 使用 `effectStart`（已由 `startTrigger` 解析後的實際秒數），確保 `transcript-line` 觸發器的效果也能正確定位
- 新增翻譯鍵 `play.animation.jumpToEffectStart`（中文：「跳至效果起點」；英文：「Jump to effect start」）

## Custom-Script 對話框範例提示詞

### 功能目的

自訂腳本（custom-script）動畫編輯器的聊天輸入區上方，新增了「範例提示詞」下拉選單，提供 5 種預設提示讓使用者快速開始，包括 `Manim.tex` 數學公式顯示範例。選擇後即自動填入輸入框，使用者可直接修改後送出。

### 使用方式

1. 在動畫編輯器中，新增或開啟一個 `custom-script` 效果，點擊「AI 自訂動畫」按鈕。
2. 對話框右側的聊天區上方，有一個「**範例提示詞…**」下拉選單。
3. 選擇其中一個範例：
   - **Manim.tex：顯示愛因斯坦公式 E=mc²** — 展示如何使用 `Manim.tex()` 渲染 LaTeX 公式並動畫化
   - **Manim：座標平面上的拋物線動畫** — 使用 `Manim.coordinateSystems.axes()` 建立座標系並繪製點軌跡
   - **Manim：圓形變形為正方形** — 使用 `Manim.animate.transform()` 做形狀變形
   - **Canvas：0 到 100 計數器** — 使用原生 Canvas API 顯示大型數字計數動畫
   - **SVG：箭頭延伸並標記文字** — 使用 SVG 做延伸箭頭動畫
4. 選擇後，提示詞會自動填入下方輸入框，可直接送出或修改後再送出。

### 技術細節

- `AnimationEditorTab.tsx` 新增 `CUSTOM_SCRIPT_EXAMPLE_PROMPTS` 常數陣列，儲存標籤鍵與提示詞文字
- 下拉選單使用 `<select value="">` 觸發 `onChange` 後重設回空值，下次可再次選同一項
- 後端新增測試 `findUnsafeScriptPattern allows Manim.tex call patterns without flagging them`，確認：(1) `await Manim.tex(...)` 呼叫不含 `window.parent` 不被拒絕；(2) `Manim.tex(...).then(...)` 鏈也是安全的；(3) 一般識別字 `parentEl`/`.postMessage` 不被誤判為 `window.parent` 存取

## Overlay-Image 縮放比例鎖定

### 功能目的

在動畫編輯器的 `overlay-image`（插入圖片）效果卡片中，新增 🔒/🔓 比例鎖定按鈕。啟用後，當使用者調整圖片寬度（透過數字輸入框或拖曳 resize handle）時，高度會自動依照圖片的原始長寬比計算，避免圖片被拉伸或壓扁。

### 使用方式

1. 在動畫編輯器中，新增或選擇一個 `overlay-image` 效果。
2. 在「插入圖片」下拉選單選擇圖片後，旁邊會出現圖片縮圖，以及一個 **🔓**（解鎖）按鈕。
3. 點擊 🔓 按鈕切換為 **🔒**（鎖定，紫色高亮），此時比例鎖定生效。
4. 在下方的「焦點位置與大小（%）」區段：
   - 修改 **W（寬度）** 輸入框，高度會自動依原始圖片比例更新
   - 拖曳 resize handle 調整寬度時，高度也同步計算
   - 直接修改高度不受影響（只有寬度觸發比例計算）
5. 點擊 🔒 可切回 🔓 解除鎖定，恢復自由調整。

### 技術細節

- 使用圖片縮圖的 `onLoad` 事件取得 `naturalWidth`/`naturalHeight`，計算比例後存入 `figureNaturalRatios` state
- 比例鎖定狀態存於 `lockedAspectEffectIds` (Set)，不儲存至 animation spec JSON（只在 UI 狀態中）
- 寬度變化攔截在：(1) 數字輸入框的 `onChange` handler；(2) `EffectPositionEditor` 的 `onParamsChange` callback wrapper

## 動畫效果批次套用至多頁

### 功能目的

在動畫編輯器中，新增「套用至全部頁面」按鈕，讓使用者可以將目前頁面的完整動畫設定一鍵複製到簡報的所有其他頁面。相較於既有的「複製本頁效果」（複製後需手動逐頁切換貼上），批次套用可直接對所有頁面同時生效，適合製作風格一致的動畫模板。

### 使用方式

1. 在動畫編輯器中設定好某一頁的動畫效果（例如開場 shape 效果、收場 pointer 等）。
2. 在編輯器頂部操作列找到藍色「**套用至全部頁面**」按鈕（僅在投影片有 2 頁以上時顯示）。
3. 點擊後會出現確認對話框，顯示將套用至幾頁。
4. 確認後，系統依序將目前頁面的動畫設定寫入其他所有頁面；按鈕在套用期間切換為「套用中…」並停用，完成後恢復。

> 注意：此操作會覆蓋其他頁面原有的動畫設定，建議在套用前確認當前頁面的動畫設定正確。

### 技術細節

- `AnimationEditorTab.tsx` 新增 `handleApplyToAllPages` 非同步函式，透過 `for` 迴圈逐頁呼叫 `savePageAnimation(pdfId, n, spec)`（略過當前頁）
- 從 `usePlayPageContext()` 解構 `totalPages`，控制按鈕顯示條件與確認對話框的頁數描述
- 新增 `applyingToAll` boolean state 作為 loading indicator，套用期間停用按鈕並替換文字
- 確認訊息使用翻譯鍵 `play.animation.applyToAllConfirm`，含 `{n}` 佔位符動態插入受影響的頁數

## Formula 效果 AI 自動生成品質提升

### 功能目的

`auto-focus-ai` 功能已能讓 AI 選擇 `formula` 類型並生成 LaTeX 公式，但原始提示詞對「哪些情況算公式」及「如何處理口語公式描述」說明不夠明確。本次更新優化系統提示詞，提升 AI 在正確識別並轉換公式方面的準確率，同時補充兩個整合測試確保公式自動生成的流程正確。

### 主要改善

**提示詞優化**：
- 明確說明「以文字描述的公式」也算公式（例如「E 等於 mc 的平方」→ `E = mc^2`）
- 新增負面範例：單純百分比（如「成長 35%」）、日期或簡單計數不應選 formula，應選 text-callout
- `formulaLatex` 欄位說明加入轉換指引：AI 應將口語描述轉為 LaTeX，無法轉換時回退 highlight-box

**新增整合測試**：
1. `POST auto-focus-ai returns a formula effect with formulaLatex` — 驗證 AI 回傳 `type: 'formula'` + `formulaLatex` 時，效果正確映射為 `formula` 型別並帶有 `formula` 欄位，且通過 `validateAnimationSpec`
2. `POST auto-focus-ai falls back formula without formulaLatex to highlight-box` — 驗證 AI 回傳 `type: 'formula'` 但沒有提供 `formulaLatex` 時，效果正確退回 `highlight-box`

### 技術細節

- 只修改 `animationAutoFocus.ts` 的 `buildAutoFocusSystemPrompt()` 提示詞，不影響型別定義或資料流
- 兩個新測試均使用 mock LLM client，不依賴真實 OpenAI 呼叫

## Manim.animate.transform 路徑變形（Path Morphing）

### 功能目的

原本的 `Manim.animate.transform(from, to, progress)` 只對相同類型的形狀（例如 circle→circle）做屬性線性插值（半徑、位置等），對不同類型（例如 circle→square）則只做不自然的交叉淡化。這次更新實作了真正的 SVG 路徑變形：兩個形狀都被轉換為 4 段 cubic Bézier 路徑，然後對控制點進行逐點插值，讓圓形平滑地變形為正方形。

### 使用方式

```javascript
// 在 custom-script 中使用，進度從 0 到 1
var circle = Manim.shapes.circle(svg, { x: 0, y: 0, radius: 1.5, color: Manim.colors.BLUE });
var square = Manim.shapes.square(svg, { x: 0, y: 0, size: 3, color: Manim.colors.RED });

window.renderAnimation = function(root, api) {
  // 播放時 api.onFrame 每幀呼叫，frame.t 為 0→1 進度
  api.onFrame(function(frame) {
    Manim.animate.transform(circle, square, frame.t);
  });
};
```

**支援的跨型態變形**：
- `circle` ↔ `square`
- `circle` ↔ `rectangle`

**自動退回交叉淡化**（不支援 path morphing 的組合）：
- `line`、`arrow`、`text`、`dot`、`polygon` 等仍使用原本的交叉淡化 + 屬性插值

### 技術細節

- **圓形**以 κ=0.5523 分解為 4 段 cubic Bézier（KAPPA 近似法），從正上方（top）順時鐘排列錨點（top → right → bottom → left → top）
- **矩形**以相同的 4 個 cardinal 錨點（各邊中點）+ 角落位置的控制點分解為 4 段 Bézier，使每個錨點的切線方向與對應的圓形切線方向相同（水平或垂直），插值時不產生旋轉感
- 第一次呼叫 `transform` 時，在 `from.svg` 新增共用 `<path>` 元素（`from._morphEl`）並隱藏原始 `from.el` 和 `to.el`；後續呼叫更新 `d` 屬性和顏色插值
- 不依賴任何外部函式庫（無需 flubber.js），完全以 ES5 純 JavaScript 實作，符合 sandboxed iframe 的限制

## MCP Server — Agent 整合

### 功能目的

新增 MCP（Model Context Protocol）Server，讓 Claude Code 或任何其他 MCP 相容的 AI agent 可以直接透過程式呼叫 makeslide 的 API，不需要打開瀏覽器，即可上傳 PDF、啟動簡報生成流程，並取得最終影片 URL。

### 使用方式

**Step 1：設定 MCP_AUTH_TOKEN**

在 makeslide 的 `.env` 檔中設定一個密鑰：
```
MCP_AUTH_TOKEN=your-secret-token-here
```

**Step 2：在 Claude Code 設定 MCP server**

編輯 `~/.claude/mcp_servers.json`（Claude Code 的 MCP 設定）：
```json
{
  "makeslide": {
    "command": "npx",
    "args": ["--prefix", "/path/to/makeslide/backend", "tsx", "src/mcp-server.ts"],
    "env": {
      "MAKESLIDE_URL": "http://localhost:3000",
      "MAKESLIDE_MCP_TOKEN": "your-secret-token-here"
    }
  }
}
```

**Step 3：在 Claude Code 中使用**

重啟 Claude Code 後，可以這樣要求 Claude 操作 makeslide：
- 「列出所有簡報」→ `list_presentations`
- 「上傳 /tmp/slides.pdf 並生成簡報影片」→ `upload_pdf` + `start_generation`
- 「查詢最新生成進度」→ `get_generation_status`

### 可用工具

| 工具名稱 | 說明 |
|---------|------|
| `list_presentations` | 列出所有簡報（ID、標題、狀態） |
| `get_presentation` | 取得指定簡報的詳細資訊與影片 URL |
| `upload_pdf` | 從本機路徑上傳 PDF |
| `start_generation` | 啟動 AI 生成流程（可選指定 stages） |
| `get_generation_status` | 查詢最新任務狀態與各階段進度 |

### 技術細節

- MCP 傳輸：stdio over newline-delimited JSON（JSON-RPC 2.0），相容 Claude Code 和 Claude Desktop
- 認證：後端新增 `MCP_AUTH_TOKEN` 設定；server.ts 在 OAuth auth hook 中新增 Bearer token 驗證分支
- 啟動方式：`npm --prefix backend run mcp-server`（開發用）或 `node backend/dist/mcp-server.js`（生產用）
- 不依賴 `@modelcontextprotocol/sdk`，以純 TypeScript 手動實作 JSON-RPC 協議

## MCP Server 腳本讀寫工具（2026-06-17）

### 功能目的

原有 MCP server 的 5 個工具只能管理簡報整體（上傳、啟動生成、查詢狀態），無法讀取或修改個別頁面的 AI 腳本。本次新增 `get_page_script` 和 `set_page_script` 兩個工具，讓 agent（如 Claude Code）可在啟動 AI 生成前先自訂各頁的逐字稿文案，再只重新生成語音部分，省去重跑 LLM 腳本生成的時間與費用。

### 新增的 REST API

`PUT /api/pdfs/:id/pages/:page/script`
- 接受 `{ script: string }` body（最長 4096 字元）
- 將腳本寫入對應的 `.script.txt` 檔案；若該頁尚無 `script_path` 記錄，會從 `page_uid` 自動派生路徑並存入 DB
- 回傳 `{ id, page_number, script }`

搭配既有的 `GET /api/pdfs/:id/pages/:page/script`，完整支援腳本的讀取與覆寫。

### 新增的 MCP 工具

| 工具名 | 說明 |
|--------|------|
| `get_page_script` | 讀取指定頁的逐字稿腳本，回傳純文字內容 |
| `set_page_script` | 覆寫指定頁的腳本（最長 4096 字元），成功後回傳確認訊息 |

### 典型使用流程

```
1. list_presentations          → 取得簡報 ID
2. get_presentation            → 確認頁數與各頁狀態
3. get_page_script id=X page=1 → 讀取第 1 頁現有腳本
4. set_page_script id=X page=1 script="..." → 自訂第 1 頁文案
5. start_generation id=X stages=["audio"]  → 只重新合成語音
6. get_generation_status id=X              → 輪詢進度
```

### 技術細節

- `detail.ts` 新增 `PUT /api/pdfs/:id/pages/:n/script` route，與 GET route 相鄰
- `mcp-server.ts` 新增 `apiGetText()`（回傳純文字）和 `apiPut()`（PUT JSON）兩個輔助函式
- 兩個新工具的 handler 驗證 `id`、`page`（正整數）與 `script` 長度後呼叫對應 API

## Formula 效果字型大小控制（2026-06-17）

### 功能目的

`formula` 效果使用 KaTeX 在投影片上顯示數學公式，但原本固定以約 1×em 的大小渲染，不同大小的投影片或不同複雜度的公式看起來可能太小或太大。本次新增 `formulaFontSize` 欄位，讓使用者可在動畫編輯器中即時調整公式的顯示大小。

### 使用方式

在動畫編輯器中，選擇一個 `formula` 效果後：
1. 在「公式內容（LaTeX）」欄位下方，新增了「字型大小（em）」輸入框
2. 預設值為 **1.5em**，可調整範圍為 **0.5 ~ 4em**，步進 0.1
3. 編輯器中的公式預覽會即時反映字型大小的變化
4. 儲存後，投影片播放時公式會以指定大小顯示

### 技術細節

- `pageAnimation.ts`：新增 `DEFAULT_FORMULA_FONT_SIZE_EM = 1.5`、`MIN_FORMULA_FONT_SIZE_EM = 0.5`、`MAX_FORMULA_FONT_SIZE_EM = 4` 三個常數；`AnimationEffect` interface 新增 `formulaFontSize?: number` 欄位；`EffectSchema`（Zod）新增 `formulaFontSize: z.number().min(0.5).max(4).optional()`；`validateAnimationSpec` 序列化時納入此欄位
- `types.ts`（前端）：同步新增 `formulaFontSize?: number` 欄位
- `SlideRenderer.tsx`：formula 容器 div 加入 `fontSize: \`${formulaFontSize ?? 1.5}em\`` 樣式
- `AnimationEditorTab.tsx`：在 LaTeX input 下方加入 `<input type="number" min=0.5 max=4 step=0.1>`；預覽 div 也套用 `fontSize` 樣式
- i18n：中英文 locale 各新增一個翻譯鍵 `play.animation.formulaFontSize`

## Step-List 效果顏色自訂（2026-06-17）

### 功能目的

`step-list` 效果原本固定使用深色半透明背景（`#0f172a` 約 85% 不透明度）與淺色文字，無法搭配不同風格的投影片。本次新增 `stepListBgColor` 和 `stepListTextColor` 兩個欄位，讓使用者可在動畫編輯器中用顏色選擇器自訂背景色與文字色。

### 使用方式

在動畫編輯器中，選擇一個 `step-list` 效果後，條列項目輸入框下方新增了兩個顏色選擇器：
- **背景顏色**：預設 `#1e293b`（深藍灰），可改為任何 CSS hex 色碼
- **文字顏色**：預設 `#f1f5f9`（亮白），可搭配背景自訂對比色

顏色選擇器為 `<input type="color">`，支援所有現代瀏覽器的原生顏色選色盤。

### 技術細節

- `pageAnimation.ts`：新增 `DEFAULT_STEP_LIST_BG_COLOR = '#1e293b'` 與 `DEFAULT_STEP_LIST_TEXT_COLOR = '#f1f5f9'` 常數；`AnimationEffect` interface 新增兩個 optional 欄位；`EffectSchema` 重用 hex color regex（`/^#[0-9a-fA-F]{3,8}$/`，最長 20 字元）驗證；`validateAnimationSpec` 序列化時一併輸出
- `types.ts`（前端）：同步新增兩個欄位
- `SlideRenderer.tsx`：step-list 容器 div 改用 `effect.stepListBgColor ?? '#1e293b'` 和 `effect.stepListTextColor ?? '#f1f5f9'` 作為 CSS 樣式
- `AnimationEditorTab.tsx`：items textarea 後面加入兩個並排的 `<input type="color">` 選色器
- i18n：中英文 locale 各新增 `play.animation.stepListBgColor` 和 `play.animation.stepListTextColor` 翻譯鍵

## Manim Polygon 路徑變形（2026-06-17）

### 功能目的

`Manim.animate.transform` 原本只能對 `circle`、`square`、`rectangle` 進行平滑路徑變形（SVG cubic Bézier 插值），`polygon` 形狀（三角形、菱形、五邊形等）遇到跨類型 transform 時只能退回到交叉淡化（cross-fade）效果，視覺上較不連貫。本次讓 polygon 也能和 circle/rect 做到逐格插值路徑的平滑 morphing。

### 技術原理

`polygonMorphSegs(el)` 函式將 SVG `<polygon>` 分解為 4 段 cubic Bézier：
1. 找出多邊形的 4 個 **cardinal 最遠點**：topmost（min SVG-y）、rightmost（max x）、bottommost（max SVG-y）、leftmost（min x）
2. 以 4 個極值點為錨點，產生 4 段 Bézier `top→right→bottom→left→top`
3. 控制點使用 **axis-aligned 切線**，水平方向控制量 `kh = KAPPA × (right.x − left.x) / 2`，垂直方向 `kv = KAPPA × (bottom.y − top.y) / 2`，與 `circleMorphSegs` 和 `rectMorphSegs` 的切線慣例一致，使三種形狀之間的 morphing 都能銜接流暢

這樣，一個正三角形 morphing 成圓形時，三角形會先「膨脹」成橢圓形狀再圓化，而不是直接淡出又淡入。

### 注意事項：template literal 中的正規表示式逸出

在 TypeScript template literal（`` ` `` ）中，`\s` 是無效的逸出序列，會被 JS 引擎靜默忽略反斜線，導致字串中出現字面字元 `s`。因此 `parsePolygonPoints` 解析 `points` 屬性時，正則必須寫成 `/[\\s,]+/`（兩個反斜線）才能讓產生的 JS 字串含有 `/[\s,]+/` 並正確匹配空白字元。

### 測試覆蓋

新增 3 個測試至 `manimHelperScript.test.ts`：
- `polygon→circle`：三角形變形成圓形，確認 `el.style.display = 'none'`、morphEl 已建立、路徑在 t=0 與 t=1 不同
- `polygon→polygon`：三角形變形成五邊形（同類型），確認同樣走路徑插值而非交叉淡化
- `polygon→rect`：菱形（diamond）變形成矩形，確認路徑封閉且兩端不同

全部 18 項測試通過。

## Highlight-Box 效果邊框顏色自訂（2026-06-17）

### 功能目的

`highlight-box` 效果原本固定使用紅色邊框（`#ef4444`），無法搭配不同風格的投影片（例如藍色主題、公司品牌色）。本次新增 `highlightColor` 欄位，讓使用者可在動畫編輯器中自訂邊框顏色。

### 使用方式

在動畫編輯器中，選擇一個 `highlight-box` 效果後，位置/大小欄位旁邊新增了「邊框顏色」顏色選擇器。點擊即可選擇任何顏色；預設值為紅色（`#ef4444`）。顏色選定後，醒目方框的邊框與外發光（box-shadow）都會更新為對應顏色。

### 技術細節

- `pageAnimation.ts`：新增 `DEFAULT_HIGHLIGHT_BOX_COLOR = '#ef4444'` 常數；`AnimationEffect` interface 新增 `highlightColor?: string` 欄位；`EffectSchema` 重用現有 hex color regex（`/^#[0-9a-fA-F]{3,8}$/`，最長 20 字元）；`validateAnimationSpec` 序列化時一併輸出
- `types.ts`（前端）：同步新增 `highlightColor?: string` 欄位
- `SlideRenderer.tsx`：`highlight-box` 渲染改用 `effect.highlightColor ?? '#ef4444'`；box-shadow 也使用相同顏色（附加 `b3` 後綴 = ~70% 不透明度的 hex alpha）
- `AnimationEditorTab.tsx`：`effect.type === 'highlight-box'` 條件下新增 `<input type="color">` 選色器
- i18n：中英文 locale 各新增 `play.animation.highlightColor` 翻譯鍵

## Text-Callout 效果顏色自訂（2026-06-17）

### 功能目的

`text-callout` 效果原本固定使用深色背景（`#0f172a`）和白色文字（`#f8fafc`），若投影片是淺色主題或品牌色系，文字框的顏色就會顯得格格不入。本次新增 `textCalloutBgColor` 和 `textCalloutTextColor` 欄位，讓使用者可自由搭配。

### 使用方式

在動畫編輯器中，選擇一個 `text-callout` 效果後，文字內容輸入框下方新增了兩個顏色選擇器：
- **背景顏色**：預設 `#0f172a`（深藍黑），適合在深色投影片上使用
- **文字顏色**：預設 `#f8fafc`（接近白色），對比鮮明

兩個顏色選擇器並排顯示，支援瀏覽器原生顏色盤，選完後立即在投影片上預覽。

### 技術細節

- `pageAnimation.ts`：新增兩個預設色常數；`AnimationEffect` interface 新增兩個 optional 欄位；`EffectSchema` 重用既有 hex color regex；序列化時一併輸出
- `types.ts`（前端）：同步新增兩個欄位
- `SlideRenderer.tsx`：text-callout 容器改用 `effect.textCalloutBgColor ?? '#0f172a'` 和 `effect.textCalloutTextColor ?? '#f8fafc'` 作為 inline style
- `AnimationEditorTab.tsx`：text-callout 分支改包 `<>...</>` 並加入兩個 `<input type="color">` 選色器
- i18n：中英文 locale 各新增 `play.animation.textCalloutBgColor` 和 `play.animation.textCalloutTextColor`

## Spotlight 效果遮罩顏色與透明度自訂（2026-06-17）

### 功能目的

`spotlight` 效果原本固定使用黑色遮罩（`rgba(0,0,0,0.6)`）來暗化聚光燈以外的區域，無法搭配不同風格的投影片（例如淺色背景需要較淡的遮罩，或品牌色系需要有色遮罩）。本次新增 `spotlightColor` 和 `spotlightOpacity` 兩個欄位，讓使用者可自由調整。

### 使用方式

在動畫編輯器中，選擇一個 `spotlight` 效果後，位置/大小欄位旁邊新增了：
- **遮罩顏色**：顏色選擇器，預設黑色（`#000000`）
- **透明度**：數字輸入框，範圍 0–1，步進 0.05，預設 0.6（代表遮罩蓋住 60% 光線）

兩個控制項並排顯示。調整後立即在投影片上預覽遮罩效果。

### 技術細節

- `pageAnimation.ts`：新增 `DEFAULT_SPOTLIGHT_COLOR = '#000000'` 和 `DEFAULT_SPOTLIGHT_OPACITY = 0.6` 常數；`AnimationEffect` 新增 `spotlightColor?: string` 和 `spotlightOpacity?: number`；`EffectSchema` 分別用 hex color regex 和 `z.number().min(0).max(1)` 驗證；序列化時輸出
- `types.ts`（前端）：同步新增兩個欄位
- `SlideRenderer.tsx`：spotlight 渲染從 `spotlightColor` 解析 r/g/b channel（`parseInt(hex.slice(1,3), 16)` 等），組合成 `rgba(r, g, b, opacity)` 字串套用至 box-shadow
- `AnimationEditorTab.tsx`：spotlight 分支新增 `<input type="color">` 和 `<input type="number" min=0 max=1 step=0.05>`，並排在 `flex gap-2 items-end` 容器中
- i18n：中英文 locale 各新增 `play.animation.spotlightColor` 和 `play.animation.spotlightOpacity`

## Manim `indicateAround` 強調動畫（2026-06-17）

### 功能目的

Manim 的 `Indicate` 動畫是最具識別性的效果之一：讓一個圖形瞬間放大並閃爍對比色，然後縮回原本大小，讓觀眾的注意力一眼集中到該物件上。本次在 `window.Manim.animate` 中新增 `indicateAround(m, progress, opts)` 實現這個動畫。

### 使用方式

```javascript
// 在 custom-script 效果中使用：
function onFrame(progress, duration) {
  Manim.animate.indicateAround(myCircle, progress, { scale: 1.4, color: '#f59e0b' });
}
```

**opts 參數**（皆為選填）：
- `scale`：放大倍率，預設 `1.3`（放大 30%）
- `color`：閃爍顏色，預設 `'#f59e0b'`（琥珀橘）

動畫節奏：
- progress 0→0.5：物件縮放至 `scale` 倍，stroke/fill 漸變為 flash color
- progress 0.5→1：縮放縮回 1，顏色漸回原本顏色
- progress=1：完全還原 transform 和顏色，清除暫存狀態

### 技術細節

- 使用對稱 `phase` 計算（0→0.5 時 `phase=p*2`，0.5→1 時 `phase=1-(p-0.5)*2`），對 phase 套用 `smooth()` 做 eased 插值
- `transform="scale(s)"` 直接覆寫 transform attribute（不考慮與其他 transform 組合）
- 用 `m._indicateOrigStroke` / `m._indicateOrigFill` 在首次呼叫時保存原始顏色，progress=1 時恢復並刪除
- 新增 2 個 vm 測試確認峰值縮放正確、progress=1 完全復原

## AI 自動聚焦 Pointer 箭頭角度建議（2026-06-17）

### 功能目的

`pointer` 效果會在投影片上顯示一支從畫面外側射入的指示箭頭，引導觀眾目光到 AI 認為重要的位置。過去所有 AI 建議的 pointer 效果都使用預設方向（從左上角向右下刺入，angle=0），不論目標在畫面的哪個位置，這常導致箭頭從奇怪的角度指向目標，甚至和其他效果重疊。

本次讓 AI 在建議 `pointer` 效果時，同時選擇最合適的進入角度。

### 角度說明

`angle` 欄位是箭頭「從畫面外側切入的方向」，以整數度數表示（0-359）：

| angle 值 | 箭頭進入方向 | 適用情境 |
|----------|------------|---------|
| 0        | 從左上向右下 | 目標在畫面左上角 |
| 90       | 從右上向左下 | 目標在畫面右半部 |
| 180      | 從左下向右上 | 目標在畫面左下角 |
| 270      | 從右下向左上 | 目標在畫面左半部 |

AI 會根據目標點（xPct, yPct）的畫面位置自動選擇讓箭頭「從外側指入」的最佳角度——例如目標在右半部通常選 90（箭頭從右側進入），目標在左半部通常選 270（箭頭從左側進入）。

### 技術細節

- `AutoFocusItemSchema` 新增 `angle: z.number().int().min(0).max(359).optional()`
- system prompt 第 3 點補充 angle 說明及 4 個方向示例
- `mapAutoFocusResponseToEffects` 在 `type === 'pointer'` 時將 `item.angle` 傳遞至 `effect.angle`
- `page-animation.test.ts` 新增 2 個單元測試：有 angle 時正確傳遞並通過 schema 驗證；無 angle 時 effect.angle 保持 undefined

## Pointer 箭頭顏色自訂（2026-06-17）

### 功能目的

`pointer` 效果的指示箭頭原本固定使用玫瑰紅色（`#f43f5e`），在某些投影片配色下（如深色系、科技感藍色等）與背景對比不足，或與整體設計風格不搭。本次新增 `pointerColor` 欄位，讓使用者可以選擇任意顏色讓箭頭融入投影片主題。

### 使用方式

在動畫編輯器的 `pointer` 效果設定中，角度輸入框下方會出現「箭頭顏色」色彩選擇器，點擊即可選色。選擇的顏色會同時套用到 SVG 箭頭的 fill 和光暈（drop-shadow）效果，讓整體視覺一致。

預設仍為玫瑰紅 `#f43f5e`，若未設定則行為與先前相同。

### 技術細節

- `AnimationEffect`（後端）和 `SlideAnimationEffect`（前端）新增 `pointerColor?: string`
- `EffectSchema` 使用現有 hex color regex（`^#[0-9a-fA-F]{3,8}$`）驗證
- `SlideRenderer.tsx` 從 hex 字串解析 r/g/b channel，生成 `rgba(r,g,b,0.95)` 用於 SVG fill、`rgba(r,g,b,0.9)` 用於 drop-shadow filter
- 後端新增 `DEFAULT_POINTER_COLOR = '#f43f5e'` 常數

## Pointer 箭頭大小自訂（2026-06-17）

### 功能目的

`pointer` 效果的箭頭原本固定為 2.5rem × 2.5rem，在高解析度、全螢幕或小尺寸投影片中，箭頭可能顯得太大或太小，影響視覺比例。本次新增 `pointerSize` 欄位，讓使用者可彈性調整箭頭大小。

### 使用方式

在動畫編輯器的 `pointer` 效果設定中，顏色選擇器下方新增「**箭頭大小（rem）**」數字輸入框，範圍 1-6rem，步進 0.5。

- 預設 `2.5rem`（不填時行為不變）
- 較大值（如 4rem）在 4K 大型投影片或需要強調時更清晰
- 較小值（如 1.5rem）適合精細標示、不遮擋文字

### 技術細節

- `AnimationEffect` 和 `SlideAnimationEffect` 新增 `pointerSize?: number`
- `validateAnimationSpec` 以 `Math.max(MIN, Math.min(MAX, value))` 夾至合法範圍（1-6）
- `SlideRenderer.tsx` 用 `${pointerSize}rem` 設定 pointer div 的 width/height
- 後端新增 `DEFAULT_POINTER_SIZE_REM = 2.5`、`MIN_POINTER_SIZE_REM = 1`、`MAX_POINTER_SIZE_REM = 6` 常數

## Text-Callout 字型大小自訂（2026-06-17）

### 功能目的

`text-callout` 效果用於在投影片上疊加標注文字（如關鍵數字、結論摘要）。原本字型大小固定為 1.25rem，對於較長的文字可能顯得太大（造成 overflow）；對於需要強調的短文字則可能太小。本次新增 `textCalloutFontSize` 欄位，讓使用者彈性調整字型大小。

### 使用方式

在動畫編輯器的 `text-callout` 效果設定中，顏色選擇器（背景色、文字色）下方新增「**字型大小（rem）**」數字輸入框，範圍 0.5-3rem，步進 0.125。

- 預設 `1.25rem`（與先前行為相同）
- 較小值（如 0.75rem）適合在有限空間內顯示較長文字
- 較大值（如 2rem）適合強調短標題或單一關鍵數字

### 技術細節

- `AnimationEffect`（後端）和 `SlideAnimationEffect`（前端）新增 `textCalloutFontSize?: number`
- `validateAnimationSpec` 以 Math.max/min 夾至 [0.5, 3] 範圍
- `SlideRenderer.tsx` 以 `` `${textCalloutFontSize ?? 1.25}rem` `` 字串作為 `fontSize` CSS 屬性
- 後端新增 `DEFAULT_TEXT_CALLOUT_FONT_SIZE_REM = 1.25`、`MIN_TEXT_CALLOUT_FONT_SIZE_REM = 0.5`、`MAX_TEXT_CALLOUT_FONT_SIZE_REM = 3` 常數

## Shape 效果填充顏色（2026-06-17）

### 功能目的

`shape` 效果（圓形、矩形、橢圓）原本只能繪製空心輪廓（`fill="none"`），若需要實心標記（如圓點高亮、色塊背景）必須改用 `custom-script`。本次新增 `shapeFillColor` 選項，讓使用者直接在 shape 效果中啟用填充。

### 使用方式

在動畫編輯器的 `shape` 效果設定中，描邊顏色與線寬下方新增「**填充顏色**」核取方塊：

- 未勾選（預設）：圖形空心，行為與先前相同
- 勾選後：顯示填充顏色選擇器，可選任意 hex 顏色；初始值預設與描邊顏色相同

> 注意：`arrow`（箭頭）形狀為線段，填充顏色對其無效，不會顯示在渲染中。

### 技術細節

- `AnimationEffect`（後端）和 `SlideAnimationEffect`（前端）新增 `shapeFillColor?: string`
- `EffectSchema` 使用現有 hex color regex 驗證
- `SlideRenderer.tsx` 以 `effect.shapeFillColor ?? 'none'` 作為 SVG fill 屬性值
- AnimationEditorTab 使用「checkbox 勾選 + 條件顯示 color input」的 UI 模式，避免強迫使用者看顏色選擇器

## Manim `animate.flash` 閃爍效果（2026-06-17）

### 功能目的

`indicateAround` 強調動畫同時縮放 + 改色，視覺上比較「大動作」。有時只需要讓一個元素快速閃白光（類似閃光燈），不需要縮放，例如強調數值的瞬間變化、步驟完成的確認效果等。`Manim.animate.flash` 提供了這個更輕量的選項。

### 使用方式

```javascript
// 在 custom-script 效果中使用：
function onFrame(progress, duration) {
  Manim.animate.flash(myRect, progress, { color: '#ffff00', maxOpacity: 1 });
}
```

**opts 參數**（皆為選填）：
- `color`：閃光顏色，預設 `'#ffffff'`（白色）
- `maxOpacity`：閃光峰值時的 opacity，預設 `1`（完全不透明）

動畫節奏：
- progress 0→0.5：fill/stroke 漸變為 `color`，opacity 漸升至 `maxOpacity`
- progress 0.5→1：fill/stroke 漸回原色，opacity 漸回原始值
- progress=1：完全還原所有屬性，清除暫存狀態

### 技術細節

- `m._flashOrigStroke` / `m._flashOrigFill` / `m._flashOrigOpacity` 在首次呼叫時儲存原始值，progress=1 時刪除
- 與 `indicateAround` 使用相同的對稱 `phase` 模式，但不修改 `transform`（無縮放）
- 新增 2 個 vm 測試確認：(1) 自訂顏色+opacity 時中間閃爍、結尾完全還原；(2) 預設白色從 RED 偏移後還原

## Step-List 字型大小自訂（2026-06-18）

### 功能目的

`step-list` 效果（條列清單）的文字大小原本固定為 1.1rem。當項目數量較多時，較小的字型可以讓所有項目都在可視區域內；當項目較少或要強調時，較大字型效果更好。本次新增 `stepListFontSize` 欄位。

### 使用方式

在動畫編輯器的 `step-list` 效果設定中，顏色選擇器下方新增「**字型大小（rem）**」數字輸入框，範圍 0.5-2.5rem，步進 0.1。

- 預設 `1.1rem`（行為與先前相同）
- 較小值（如 0.8rem）適合 5-6 個項目的密集清單
- 較大值（如 1.5rem）適合 2-3 個重點項目

### 技術細節

- `AnimationEffect` 和 `SlideAnimationEffect` 新增 `stepListFontSize?: number`
- `validateAnimationSpec` 以 Math.max/min 夾至 [0.5, 2.5]
- `SlideRenderer.tsx` 以 `` `${stepListFontSize ?? 1.1}rem` `` 作為 `<ul>` 的 fontSize
- 後端新增 `DEFAULT_STEP_LIST_FONT_SIZE_REM = 1.1`、`MIN/MAX` 常數

## Highlight-Box 邊框寬度自訂（2026-06-18）

### 功能目的

`highlight-box` 效果的邊框粗細原本固定為 4px。在小型投影片或次要內容的提示時，4px 可能顯得過粗；在主要重點或大型投影片上，希望邊框更明顯時又太細。本次新增 `highlightBorderWidth` 欄位，讓使用者可自由調整邊框粗細。

### 使用方式

在動畫編輯器的 `highlight-box` 效果設定中，顏色選擇器旁新增「**邊框寬度（px）**」數字輸入框，範圍 1-12px，步進 1。

- 預設 4px（行為與先前相同）
- 光暈（box-shadow）的模糊半徑會隨邊框寬度等比縮放（`bw × 4 px`）

### 技術細節

- `AnimationEffect` 和 `SlideAnimationEffect` 新增 `highlightBorderWidth?: number`
- `EffectSchema` 以 `z.number().int().min(1).max(12)` 驗證
- `SlideRenderer.tsx` border 與 box-shadow 均依 `highlightBorderWidth ?? 4` 動態計算
- 後端新增 `DEFAULT_HIGHLIGHT_BORDER_WIDTH = 4`、`MAX_HIGHLIGHT_BORDER_WIDTH = 12` 常數

## highlight-box 圓角半徑控制（highlightBorderRadius）

`highlight-box` 效果現在支援自訂邊框圓角半徑。使用者可以在動畫編輯器中設定 `highlightBorderRadius`（px 整數，預設 `8`，範圍 0-50），讓高亮框在尖角矩形到圓潤圓角之間自由調整，配合投影片視覺風格。

**使用方式：**
在動畫編輯器的 `highlight-box` 效果設定中，調整「圓角半徑（px）」數字輸入框（步進 2px）。

**技術說明：**
- `AnimationEffect` 和 `SlideAnimationEffect` 新增 `highlightBorderRadius?: number`
- `EffectSchema` 以 `z.number().int().min(0).max(50)` 驗證
- `SlideRenderer.tsx` 以 `effect.highlightBorderRadius ?? 8` 作為 `borderRadius` 值
- 後端新增 `DEFAULT_HIGHLIGHT_BORDER_RADIUS = 8`、`MAX_HIGHLIGHT_BORDER_RADIUS = 50` 常數

## Manim animate.uncreate 路徑消除效果

`window.Manim.animate.uncreate(m, progress)` 現在可以讓 SVG 路徑從頭到尾逐漸消失，是 `animate.create` 的對稱反向效果。

**使用方式：**
```javascript
// 自訂腳本範例
const circ = Manim.shapes.circle(svg, { x: 0, y: 0, radius: 1.5, color: Manim.colors.BLUE });
// create 繪製 → uncreate 消除
Manim.animate.create(circ, t);       // 0→1: 從尾到頭繪製
Manim.animate.uncreate(circ, t);     // 0→1: 從頭到尾消除
```

**技術說明：**
- text/dot/arrow/axes/numberPlane：opacity 從 1 線性降至 0
- 路徑/形狀：`strokeDashoffset` 從 0 增加至路徑總長度，fill-opacity 同步遞減，progress=1 時將 opacity 設為 0
- 新增 2 個 vm 測試（共 24 項全通過）

## shape 效果基礎透明度控制（shapeOpacity）

`shape` 效果現在支援自訂基礎透明度。使用者可以在動畫編輯器中設定 `shapeOpacity`（0-1 浮點數，預設 `1`，步進 0.05），讓圓形/橢圓/矩形/箭頭等 SVG 形狀以半透明方式疊加在投影片上，製造出玻璃質感或柔和提示效果，且透明度獨立於 GSAP 淡入淡出動畫之外。

**使用方式：**
在動畫編輯器的 `shape` 效果設定中，調整「透明度（0-1）」數字輸入框（步進 0.05）。

**技術說明：**
- `AnimationEffect` 和 `SlideAnimationEffect` 新增 `shapeOpacity?: number`
- `EffectSchema` 以 `z.number().min(0).max(1)` 驗證
- `SlideRenderer.tsx` 將 `effect.shapeOpacity ?? 1` 套用至 SVG 的 `opacity` style
- 此透明度疊加在 GSAP 的淡入淡出動畫效果之上（不衝突）

## formula 效果背景色與文字色自訂（formulaBgColor / formulaTextColor）

`formula` 效果（KaTeX 數學公式）現在支援自訂背景色和文字色。使用者可以在動畫編輯器中透過顏色選擇器調整公式方塊的背景顏色（預設深藍 `#0f172a`）和文字顏色（預設近白 `#f8fafc`），配合投影片的整體配色。

**使用方式：**
在動畫編輯器的 `formula` 效果設定中，字型大小輸入框下方有「背景顏色」和「文字顏色」兩個顏色選擇器。

**技術說明：**
- `AnimationEffect` 和 `SlideAnimationEffect` 新增 `formulaBgColor?: string` 和 `formulaTextColor?: string`
- `EffectSchema` 重用現有 hex color regex 驗證（`^#[0-9a-fA-F]{3,8}$`）
- `SlideRenderer.tsx` 以動態值取代硬編碼的 `rgba(15, 23, 42, 0.85)`/`#f8fafc`

## Manim animate.wiggle 抖動效果

`window.Manim.animate.wiggle(m, progress, opts)` 讓 SVG 元素左右小幅搖擺，用來吸引觀眾注意特定內容。

**使用方式：**
```javascript
const circ = Manim.shapes.circle(svg, { x: 0, y: 0, radius: 1.5, color: Manim.colors.YELLOW });
Manim.animate.wiggle(circ, t, { amplitude: 12, frequency: 4 });
// t: 0→1, amplitude: 位移像素(預設8), frequency: 振盪次數(預設3)
```

**技術說明：**
- 以 `sin(progress * frequency * 2π) * amplitude * (1 - progress)` 計算 translateX
- 振幅因子 `(1 - progress)` 讓動畫在結尾自然衰減至靜止
- progress=1 時清除 transform 屬性，確保無殘留偏移
- 新增 2 個 vm 測試（共 26 項全通過）

## text-callout 圓角半徑控制（textCalloutBorderRadius）

`text-callout` 效果現在支援自訂邊框圓角半徑。使用者可以在動畫編輯器中設定 `textCalloutBorderRadius`（px 整數，預設 `8`，範圍 0-32，步進 2px），讓文字說明框在尖角到圓潤之間調整，配合投影片的視覺設計語言。

**使用方式：**
在動畫編輯器的 `text-callout` 效果設定中，字型大小輸入框下方有「圓角半徑（px）」數字輸入框（步進 2px）。

**技術說明：**
- `AnimationEffect` 和 `SlideAnimationEffect` 新增 `textCalloutBorderRadius?: number`
- `EffectSchema` 以 `z.number().int().min(0).max(32)` 驗證
- `SlideRenderer.tsx` 以 `${effect.textCalloutBorderRadius ?? 8}px` 取代硬編碼 `'8px'`
- 後端新增 `DEFAULT_TEXT_CALLOUT_BORDER_RADIUS = 8`、`MAX_TEXT_CALLOUT_BORDER_RADIUS = 32` 常數

## Manim animate.spinAround 完整旋轉效果

`window.Manim.animate.spinAround(m, progress, opts)` 讓 SVG 元素完整自轉一圈或多圈，比 `rotate` 更適合展示旋轉動態或強調元素的圓形對稱性。

**使用方式：**
```javascript
const star = Manim.shapes.circle(svg, { x: 0, y: 0, radius: 1.5, color: Manim.colors.YELLOW });
// 旋轉 2 圈
Manim.animate.spinAround(star, t, { turns: 2 });
// 以自訂中心旋轉
Manim.animate.spinAround(star, t, { turns: 1, cx: 2, cy: 1 });
```

**技術說明：**
- opts 支援 `turns`（圈數，預設 `1`）和 `cx`/`cy`（旋轉中心，預設使用 `getBBox()` 計算包圍框中心）
- 以 `progress * turns * 360` 計算累積角度，映射至 SVG `rotate(angle cx cy)` transform
- progress=1 時清除 transform 屬性，確保無殘留旋轉
- 新增 2 個 vm 測試（共 28 項全通過）

## formula 效果圓角半徑控制（formulaBorderRadius）

`formula` 效果（KaTeX 公式）現在支援自訂邊框圓角半徑。使用者可以在動畫編輯器中設定 `formulaBorderRadius`（px 整數，預設 `8`，範圍 0-32，步進 2px），讓公式框在尖角到圓潤之間調整，配合投影片的視覺設計語言。

**技術說明：**
- `AnimationEffect` 和 `SlideAnimationEffect` 新增 `formulaBorderRadius?: number`
- `EffectSchema` 以 `z.number().int().min(0).max(32)` 驗證
- `SlideRenderer.tsx` 以 `${effect.formulaBorderRadius ?? 8}px` 取代硬編碼 `'8px'`
- 後端新增 `DEFAULT_FORMULA_BORDER_RADIUS = 8`、`MAX_FORMULA_BORDER_RADIUS = 32` 常數

## Manim animate.bounce 彈跳效果

`window.Manim.animate.bounce(m, progress, opts)` 讓 SVG 元素向上彈跳再回到原位，模擬拋物線物理運動，使元素在靜止前多次彈跳以吸引注意。

**使用方式：**
```javascript
const circ = Manim.shapes.circle(svg, { x: 0, y: 0, radius: 1.5, color: Manim.colors.ORANGE });
// 彈跳 3 次，最高 50 SVG 單位
Manim.animate.bounce(circ, t, { height: 50, bounces: 3 });
```

**技術說明：**
- opts 支援 `height`（最高點 SVG 單位，預設 `30`）和 `bounces`（彈跳次數，預設 `2`）
- 以 `|sin(phase * π)|` 產生拋物線弧度，`height * (1 - p * 0.5)` 讓高度隨進度自然衰減
- progress=1 時清除 transform，確保元素回到原位
- 新增 2 個 vm 測試（共 30 項全通過）

## highlight-box 雙色邊框（highlightOuterColor）

`highlight-box` 效果現在支援選配外框顏色，讓高亮框在任何投影片背景上都清晰可見。勾選「外框顏色」後，可在主邊框外圍加上一圈 2px 的對比色環（預設白色），形成雙色輪廓效果。

**使用方式：**
在動畫編輯器的 `highlight-box` 效果設定中，勾選「外框顏色」核取方塊並選擇顏色即可啟用；取消勾選則移除外框。

**技術說明：**
- `AnimationEffect` 和 `SlideAnimationEffect` 新增 `highlightOuterColor?: string`（選填，未設定時不顯示外框）
- `SlideRenderer.tsx` 以 `0 0 0 2px ${hOuter}, 0 0 ${hBw*4}px ${hColor}b3` 雙層 box-shadow 實現雙色邊框
- `AnimationEditorTab.tsx` 以 checkbox 控制開/關，checkbox 啟用後顯示顏色選擇器

## pointer 效果形狀選項（pointerShape）

`pointer` 效果現在除了預設的箭頭（cursor）之外，還支援「圓點」模式。使用者可以在動畫編輯器的指標區塊選擇形狀（箭頭/圓點），圓點模式適合在投影片上標記精確位置而不需要方向性指示。

**使用方式：**
在動畫編輯器的 `pointer` 效果設定中，最上方新增「指標形狀」下拉選單：
- **箭頭（arrow）**：游標形狀，可旋轉，搭配 `angle` 設定
- **圓點（dot）**：填滿圓形，不受 `angle` 影響

**技術說明：**
- `AnimationEffect` 和 `SlideAnimationEffect` 新增 `pointerShape?: 'arrow' | 'dot'`
- `EffectSchema` 以 `z.enum(['arrow', 'dot'])` 驗證
- `SlideRenderer.tsx`：`dot` 時渲染 `<circle cx="12" cy="12" r="10">`，並去除 transform 中的 rotate

## step-list 效果：AI 自動建議背景色與文字色

AI 自動焦點（auto-focus）現在可以根據投影片背景色系，自動為 `step-list` 效果建議適合的背景色和文字色。過去 AI 生成的 step-list 都使用固定的深色背景（`#1e293b`），在淺色投影片上可能對比不足；現在 AI 可以判斷投影片色調並選用對比較好的配色。

**使用方式：**
使用 AI 自動焦點功能時（需提供投影片圖片供 AI 視覺判斷），AI 會在為逐字稿句子選擇 `step-list` 效果的同時，依投影片背景色系給出配色建議：
- 淺色系投影片（白色、淡灰等）：AI 會建議深色背景（如深藍 `#1e3a5f`）搭配淺色文字（如近白 `#f0f4ff`）
- 深色系投影片：AI 沿用預設值，不額外提供顏色欄位
- 使用者在動畫編輯器中仍可手動覆蓋顏色設定

**技術說明：**
- `AutoFocusItemSchema`（Zod）新增 `stepListBgColor`/`stepListTextColor`（選填，hex color regex 驗證）
- `buildAutoFocusSystemPrompt()` 新增 step 6b 說明，指引 AI 依投影片背景色系決定是否提供配色
- `mapAutoFocusResponseToEffects()` 在 `step-list` 分支中提取並傳遞顏色欄位至 `AnimationEffect`

## highlight-box 效果：脈動光暈（Pulse）模式

`highlight-box` 效果現在支援「脈動光暈」模式，讓邊框光暈週期性放大縮小，形成視覺吸引效果，適合用於強調投影片中最重要的數據或結論。

**使用方式：**
在動畫編輯器的 `highlight-box` 效果設定中，勾選「脈動光暈」核取方塊即可啟用。啟用後：
- 邊框在淡入完成後開始週期性脈動（約 0.7 秒一個週期）
- 光暈在正常大小與約 2.5 倍放大之間來回切換
- 若同時啟用外框顏色（`highlightOuterColor`），外框也會隨之脈動
- 脈動動畫在效果淡出時自動停止

**技術說明：**
- `AnimationEffect` 和 `SlideAnimationEffect` 新增 `highlightPulse?: boolean`（選填，預設不脈動）
- `EffectSchema` 以 `z.boolean().optional()` 驗證
- `buildGsapTimeline.ts` 將 `highlight-box` 分離為獨立 case，當 `highlightPulse` 為 `true` 時，在淡入完成的時間點插入一個 `fromTo` 動畫，以 `yoyo: true, repeat: -1` 讓 `boxShadow` 在正常光暈與放大光暈間無限循環

## spotlight 效果：柔邊模糊（Soft Edge）

`spotlight` 效果現在支援「柔邊模糊」選項，讓聚光燈的邊界從硬邊（box-shadow 直接截斷）變成漸層淡出，產生更自然的舞台聚光燈視覺效果。

**使用方式：**
在動畫編輯器的 `spotlight` 效果設定中，新增「柔邊模糊」數字輸入框（預設 `0`，範圍 0–80px）：
- **0px**：保持原有硬邊效果
- **20–40px**：輕微柔邊，邊界自然漸淡
- **60–80px**：大幅模糊，邊界幾乎消失，適合背景暗化效果

**技術說明：**
- `AnimationEffect` 和 `SlideAnimationEffect` 新增 `spotlightSoftEdge?: number`（px，0-80）
- `EffectSchema` 以 `z.number().int().min(0).max(80)` 驗證
- `SlideRenderer.tsx` 在 `spotlightSoftEdge > 0` 時加入 `filter: blur(${spSoft}px)` style 到遮罩 div

## overlay-image 效果：透明度控制

`overlay-image` 效果現在支援透明度設定，讓插入的圖片可以半透明疊加在投影片上，適合浮水印或淡入底圖的視覺設計。

**使用方式：**
在動畫編輯器的 `overlay-image` 效果設定中，圖片選擇器下方新增「透明度」數字輸入框（預設 `1.0`，範圍 0–1，步進 0.05）：
- **1.0**：完全不透明（預設）
- **0.5**：半透明，可透過圖片看到底下的投影片內容
- **0.1-0.3**：極淡的浮水印效果

**技術說明：**
- `AnimationEffect` 和 `SlideAnimationEffect` 新增 `overlayImageOpacity?: number`（0-1）
- `EffectSchema` 以 `z.number().min(0).max(1)` 驗證
- `SlideRenderer.tsx` 在 `<img>` 元素的 style 中加入 `opacity: imgOpacity`

## text-callout 效果：文字對齊方式

`text-callout` 效果現在支援左/置中/右三種文字對齊方式，解決多行長文字標注的排版需求。

**使用方式：**
在動畫編輯器的 `text-callout` 效果設定中，圓角輸入框下方新增「文字對齊」下拉選單：
- **靠左（Left）**：文字靠左對齊，適合條列式說明
- **置中（Center）**：預設，適合簡短的標題式文字
- **靠右（Right）**：文字靠右對齊

**技術說明：**
- `AnimationEffect` 和 `SlideAnimationEffect` 新增 `textCalloutAlign?: 'left' | 'center' | 'right'`
- `EffectSchema` 以 `z.enum(['left', 'center', 'right'])` 驗證
- `SlideRenderer.tsx` 同步設定 CSS `textAlign` 和 flexbox `justifyContent`（left→flex-start、right→flex-end）

## step-list 效果：圓角半徑控制

`step-list` 效果現在支援自訂圓角半徑，讓條列清單方框可以從直角到完全圓角自由調整。

**使用方式：**
在動畫編輯器的 `step-list` 效果設定中，字型大小輸入框後方新增「圓角半徑」數字輸入框（預設 `8px`，範圍 0–32px，步進 2）。

**技術說明：**
- `AnimationEffect` 和 `SlideAnimationEffect` 新增 `stepListBorderRadius?: number`（px，0-32）
- `EffectSchema` 以 `z.number().int().min(0).max(32)` 驗證
- `SlideRenderer.tsx` 使用 `${effect.stepListBorderRadius ?? 8}px` 取代硬編碼 `'8px'`

## Manim animate.typewrite 打字機效果

`window.Manim.animate.typewrite(m, progress, opts)` 為自訂動畫腳本新增打字機效果，讓文字元素的字元逐一出現或消失。

**使用方式（自訂動畫腳本）：**
```javascript
// 正向：從左到右逐字顯示
Manim.animate.typewrite(label, progress);

// 反向：從右側開始，逐字顯示（適合「從尾端打字」效果）
Manim.animate.typewrite(label, progress, { reverse: true });
```

**行為說明：**
- `progress = 0`：不顯示任何字元
- `progress = 0.5`：顯示約一半的字元
- `progress = 1`：顯示完整文字
- `reverse: true`：顯示字串尾部的字元（從右向左累積）
- 非文字元素退回為透明度淡入

**技術說明：**
- 以 `data-full-text` 屬性快取原始 textContent，確保任何 progress 值下都能正確還原
- 共新增 2 個 vm 測試（正向與反向各一），全部 32 個 manimHelperScript 測試通過

## shape 效果描邊虛線樣式

`shape` 動畫效果（圓形、橢圓、矩形、箭頭）的描邊現在支援虛線樣式，可在動畫編輯器中輸入 SVG `stroke-dasharray` 值（例如 `8 4`）來設定虛線間距。

**使用方式：**
在動畫編輯器的 `shape` 效果設定中，透明度輸入框後方新增「描邊虛線樣式」文字輸入框。輸入格式為數字加空白（例如 `8 4` = 8px 實線 + 4px 空隙，`4 2 1 2` = 點線段）；留空則維持實線。

**技術說明：**
- `AnimationEffect` 和 `SlideAnimationEffect` 新增 `shapeDashArray?: string`（最長 20 字元，僅允許數字與空白）
- `EffectSchema` 以 `z.string().max(20).regex(/^[\d. ]*$/)` 驗證
- `SlideRenderer.tsx` 在 `<circle>`、`<ellipse>`、`<line>`、`<rect>` SVG 元素上加入 `strokeDasharray` 屬性
- 空字串或 undefined 時不套用 `strokeDasharray`（維持實線）

## AI 技能系統（Skills）

使用者現在可以在設定頁中管理「AI 技能」——預先定義的提示指令，在 AI 生成逐字稿時自動注入，讓生成結果符合特定的風格或語氣需求，無需每次手動輸入指示。

**使用方式：**
在設定頁底部的「AI 技能」區塊中：
1. **啟用內建技能**：勾選任一內建技能（教學風格、學術嚴謹、故事敘述、精簡摘要），下次生成逐字稿時就會自動套用對應指令。
2. **新增自訂技能**：填寫技能名稱與指令內容，選擇套用範圍（逐字稿生成 或 所有 AI 呼叫），按「新增技能」即可儲存。
3. **刪除自訂技能**：點擊技能列表中的「刪除」按鈕移除。

**內建技能清單：**
| 技能 | 用途 |
|------|------|
| 教學風格 | 使用親切比喻，適合一般聽眾 |
| 學術嚴謹 | 精確術語、結構性論述，適合學術場合 |
| 故事敘述 | 以情境故事帶入，增加投入感 |
| 精簡摘要 | 只講最核心重點，省略細節 |

**技術說明：**
- 技能資料存於 `accounts/<accountId>/skills.json`（每帳號獨立）
- 內建技能的啟用狀態存於 `enabledBuiltIns` 陣列，自訂技能存於 `userSkills` 陣列
- 生成逐字稿前，pipeline 讀取所有已啟用、`applyTo: 'script' | 'all'` 的技能，將其 prompt 合併至 `userPrompt`
- REST API：`GET /api/skills`、`POST /api/skills`、`PATCH /api/skills/:id`、`DELETE /api/skills/:id`、`POST /api/skills/:id/toggle`

## Manim 搖晃效果（shake）

自訂動畫腳本現在支援 `Manim.animate.shake(m, progress, opts)` 水平搖晃效果，適合用於強調重點、警示錯誤、或引導注意力。

**使用方式：**
```javascript
// 基本用法（幅度 8px，4 個週期）
Manim.animate.shake(myShape, progress);

// 自訂選項
Manim.animate.shake(myShape, progress, {
  amplitude: 15,  // 最大水平偏移量（px，預設 8）
  cycles: 2,      // 搖晃週期數（預設 4）
});
```

**動畫特性：**
- `progress=0`：元素靜止於原位（translateX = 0）
- 中間 progress：依正弦波左右搖晃，幅度最大可達 amplitude px
- `progress=1`：元素自動回到原位（整數 cycles 使 sin 值精確為 0）

**技術說明：**
- 位移公式：`Math.sin(progress * Math.PI * cycles) * amplitude`
- 整數 cycles 確保端點（progress=0 和 1）的 sin 值恰好為 0，無需額外 envelope
- 2 個 vm 單元測試覆蓋端點零偏移及中間非零偏移驗證

## text-callout 效果邊框顏色

`text-callout` 效果現在支援自訂外框顏色，讓標注方框能更清晰地從投影片背景中突出，或配合視覺設計主題。

**使用方式：**
在動畫編輯器的 text-callout 設定中，勾選「邊框顏色」後選擇顏色，即可為標注框加上 2px 實線外框。不勾選時維持原有無外框的外觀。

**技術說明：**
- `textCalloutBorderColor?: string` — CSS hex 格式，後端以 regex 驗證（3–8 位 hex）
- SlideRenderer 條件性加入 `border: 2px solid {color}` style，未設定時不影響既有樣式
- AnimationEditorTab 以勾選框控制啟用/停用，預設顏色為白色（`#ffffff`）

## shape 效果 rect 圓角半徑自訂

矩形（rect）shape 效果現在支援自訂圓角半徑，讓動畫中的方框更靈活地配合設計風格——可以設為完全直角，也可以設為更大的圓角。

**使用方式：**
在動畫編輯器選擇 shape 效果且 shape 類型為「矩形」時，可看到「圓角半徑」數字輸入框（範圍 0–24 SVG 單位，步進 2）。

**技術說明：**
- `shapeRectRadius?: number` — SVG rx 屬性值，整數，預設 6（與原有硬編碼值相同）
- 只在 shape kind 為 `rect` 時顯示輸入框
- 後端 EffectSchema 以 `z.number().int().min(0).max(24)` 驗證

## spotlight 效果矩形形狀選項

`spotlight` 聚光燈效果現在支援矩形模式，讓使用者能以矩形框（而非圓形）聚焦在投影片的特定區域，更適合框選表格、程式碼區塊或文字段落。

**使用方式：**
在動畫編輯器的 spotlight 設定中，選擇「形狀」為「矩形」後，聚光燈將改以矩形呈現。選擇矩形後可額外設定「圓角半徑」（0–32px），預設為 8px 的輕微圓角。

**技術說明：**
- `spotlightShape?: 'circle' | 'rect'` — 預設 `'circle'` 維持現有圓形行為
- `spotlightBorderRadius?: number` — 僅在 rect 模式下有效，控制 `border-radius` CSS 屬性
- SlideRenderer 依 spotlightShape 動態決定 borderRadius（circle = '50%'，rect = `{value}px`）

## 動畫效果新增邊框與圓角選項

多個動畫效果現在支援更細緻的外觀客製化：

**highlight-box 虛線邊框（`highlightBorderStyle`）**
可選擇 `solid`（實線，預設）、`dashed`（虛線）或 `dotted`（點線）邊框樣式，在設定中的「邊框寬度」旁新增下拉選單。

**step-list 邊框顏色（`stepListBorderColor`）**
勾選後為清單方框加上 2px 實線外框，配合背景色使方框更為突出。

**formula 邊框顏色（`formulaBorderColor`）**
同上，為數學公式方框加上外框，可與數學符號形成對比。

**overlay-image 圓角半徑（`overlayImageBorderRadius`，0–48px）**
讓圖片疊加層顯示為圓角甚至圓形（設為高值時），可創造頭像風格的裁切效果。

---

## Manim animate.pulse() 脈衝縮放

`animate.pulse(m, progress, opts)` 使元素以「放大→縮回」脈衝方式強調：

- progress 0 和 1 時回到原始尺寸（transform 清除）
- 中間 progress 放大至 `maxScale`（預設 1.2）
- 使用 `thereAndBack` rate 函數（內建平滑的往返曲線）
- opts 支援 `maxScale`（縮放倍數）和 `cx`/`cy`（縮放中心，SVG 座標）

## Manim animate.drawBorderThenFill() 描邊後填充

`animate.drawBorderThenFill(m, progress)` 以兩階段呈現元素：

1. **描邊階段**（progress 0–0.5）：以 stroke-dashoffset 動畫描繪輪廓，fill-opacity 固定為 0
2. **填充階段**（progress 0.5–1）：輪廓已完整，fill-opacity 從 0 線性增加到 1

適合用在「強調繪製過程」的場景，例如幾何圖形的逐步展示。
