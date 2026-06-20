# MakeSlide 功能說明

## 統一「無擁有者」簡報的讀取權限規則，修補 MCP 整合的可用性問題

### 功能目的

上一輪發現 MCP 整合有一個會讓使用者卡住的限制：透過 MCP 上傳的簡報因為沒有對應的登入身分，會變成「無擁有者」狀態，這種簡報可以被某些工具操作（啟動生成、修改逐字稿），卻完全無法被另一些工具查詢（列出清單、查看詳情、讀取逐字稿）。根本原因是系統內部判斷「誰能讀」跟「誰能編輯」這兩條規則對「無擁有者」簡報的處理方式不一致：編輯規則認為任何人都能編輯，但讀取規則卻認為沒有人能讀。深入檢查後發現,系統裡其實已經有兩個地方（簡報講義匯出、PDF 匯出）的讀取規則其實是「任何人都能讀」，跟另外十一個地方不一致——換句話說，這個不一致已經存在很久，只是這次因為 MCP 整合才被明確發現並決定處理。

### 修復內容

跟使用者確認後，決定把「讀取」規則統一改成跟「編輯」規則一致：無擁有者的簡報任何人都能讀取。這樣一來，MCP 上傳並生成完成的簡報，後續也能正常被查詢類工具讀取，不會再卡住。

### 技術重點

- 統一全部 13 個檔案裡 `canReadPdf()` 對無擁有者簡報的判斷邏輯。
- 修正過程中額外發現並修正一個既有測試裡的隱藏假設：某個測試斷言「撤銷分享連結後應該讀不到」，深入追查後發現這個斷言其實是兩個互不相關的行為意外互相遮蔽才「碰巧」成立的（分享簡報會把簡報設成公開可見，這個設定不會因為撤銷分享連結而改回去；而舊版的讀取規則因為短路判斷而剛好掩蓋了這個事實）。已修正測試並補上詳細註解說明原因。
- 已執行 backend typecheck 與完整測試套件（反覆執行確認既有失敗皆為環境性基準，無新增回歸）。

## MCP auth token 介面補上對應的多語系測試覆蓋

### 功能目的

專案裡每個設定頁的新功能（對話框、頁面區塊）都有自己對應的多語系（中文/英文）完整性測試，確保中英文字串都齊全不會漏掉某一邊。最近新增的「MCP auth token」介面雖然中英文字串都已經正確準備好，卻沒有補上這個對應的測試，跟其他功能的慣例不一致。

### 修復內容

補上對應的測試，讓這個功能也跟其他既有功能一樣有完整的多語系覆蓋驗證。

### 技術重點

- `frontend/src/i18n.test.ts` 新增涵蓋全部 11 個 MCP token 相關字串的測試。
- 過程中發現自己之前驗證前端測試時用的指令因為 shell 設定問題，沒有遞迴掃到所有測試檔案；改用更正確的方式重新驗證後，確認完整的前端測試套件（198 個測試）全數通過，沒有因此漏掉任何既有回歸。

## MCP 使用手冊補上一個重要的已知限制說明

### 功能目的

上一輪剛寫完 MCP 整合的使用手冊，這一輪回頭仔細追蹤每個工具實際呼叫的後端 API 之後，發現文件裡的範例流程有一個沒有先說清楚的限制：透過 MCP 上傳的簡報因為沒有對應的登入身分，系統內部會把它當成「沒有擁有者」的簡報。沒有擁有者的簡報雖然可以被任何 MCP 工具拿來啟動生成、修改逐字稿，但卻沒辦法被查詢類的工具（列出簡報清單、查看簡報詳情、讀取逐字稿）看到或讀取——即使是同一個 MCP 對話剛建立、剛生成完成的簡報也一樣。這代表如果照著手冊原本的範例一步步做，做到後面想查看結果時會卡住。

### 修復內容

在使用手冊裡誠實補上這個限制的詳細說明與實務上的解決辦法（把該簡報的可見度設成「任何人可編輯」即可讓所有工具正常運作），並在範例流程與疑難排解段落都加上對應提示，避免使用者照著做到一半卡住卻看不懂原因。

### 技術重點

- 更新 `docs/mcp-guide.md`，新增「已知限制」段落與對應的疑難排解項目。
- 已逐一核對 `upload_pdf`/`list_presentations`/`get_presentation`/`start_generation`/`get_page_script` 等工具底層 API 的實際權限檢查邏輯，確保文件內容與目前程式碼行為完全一致。

## 新增 MCP 整合使用手冊，並修正 token 複製按鈕的相容性

### 功能目的

makeslide 內建的 MCP 伺服器讓 Claude Code 等工具可以直接操作簡報生成流程，但這個功能（包含剛上線的「在設定頁產生 MCP auth token」介面）一直沒有對應的使用文件，使用者不容易知道什麼情況下需要設定、要怎麼設定 client、又有哪些工具可以用。順便檢視這個剛上線的功能時，也發現「複製 token」按鈕沒有用到專案裡其他複製按鈕都會用的共用機制，在某些瀏覽器情境下可能複製失敗卻沒有自動退路。

### 修復內容

新增完整的中英雙語使用手冊，說明何時需要 token、如何產生/輪替、如何設定 MCP client，以及目前所有可用工具的說明與範例。同時讓「複製 token」按鈕改用跟其他複製按鈕一致的共用邏輯，在瀏覽器不支援新版複製 API 時能自動退回舊版做法，提升相容性。

### 技術重點

- 新增 `docs/mcp-guide.md`。
- `frontend/src/pages/SettingsPage.tsx` 的複製按鈕改用 `copyTextToClipboard()` 共用 helper。
- 已執行 frontend typecheck 與完整前端測試套件（162 個測試全數通過）。

## CGU Air / OpenRouter 金鑰輪替後，立即生效而不需要重啟伺服器

### 功能目的

系統支援多家 LLM 供應商，管理員可以在設定頁隨時更新各家的 API 金鑰（例如金鑰外洩後需要輪替）。但其中 CGU Air 與 OpenRouter 這兩家有一個隱藏的問題：系統內部會把建立好的連線物件快取起來重複使用以提升效率，原本只有 OpenAI 自己的金鑰更新時會正確清掉這個快取，CGU Air 與 OpenRouter 卻沒有對應的清除動作。結果是只要曾經用某個帳號呼叫過這兩家其中一家，管理員之後在設定頁換了新金鑰，那個帳號實際上還是會繼續用「換掉前」的舊金鑰，一直要等到伺服器重新啟動才會真正套用新設定——介面上明明顯示已經改好了，但背地裡完全沒生效，而且沒有任何錯誤訊息提示這件事。

### 修復內容

讓 CGU Air 與 OpenRouter 的金鑰/連線網址設定更新時，也跟 OpenAI 一樣立即清掉快取的連線物件，下次呼叫就會用最新的設定重新建立連線，金鑰輪替後馬上生效，不需要重啟伺服器。

### 技術重點

- `backend/src/services/openai.ts` 新增 `invalidateOpenAIClientCache()`，`admin.ts` 在更新 CGU Air/OpenRouter 設定時呼叫。
- 新增 2 個測試，分別驗證快取機制本身與透過實際設定 API 更新後的端對端行為。
- 已執行 backend typecheck 與完整測試套件（641 個測試，18 個失敗皆為既有環境性基準，無新增回歸）。

## 畫板防抖動儲存修正：換頁時不再寫錯頁面的筆劃內容

### 功能目的

投影片的畫板手寫功能會在使用者畫完一筆後，延遲一點時間才把內容存到伺服器（避免每畫一筆就立刻送出請求）。但如果使用者畫完一筆後，在這個延遲時間內就切換到下一頁，原本的寫法會在延遲時間到的那一刻才去讀取「目前」的畫板內容——而這時候畫板內容已經被換頁邏輯換成新頁面的東西了。結果就是：剛在舊頁面畫好的筆劃從未真正存進伺服器，反而錯誤地把新頁面的內容（或還在載入中的空白內容）存到舊頁面的位置，等於使用者剛畫的東西不見了。

### 修復內容

把「要儲存的畫板內容」改成在「使用者畫完那一刻」就先記錄下來，而不是等到延遲時間到了才去讀取當下的內容。這樣即使使用者馬上切換頁面，原本排定要儲存的內容依然是正確的、屬於該頁面的筆劃，不會被換頁動作影響。

### 技術重點

- `frontend/src/components/DrawingCanvas.tsx` 的防抖動儲存邏輯改為在排程當下先快取陣列參照。
- 逐一確認畫板資料在各種情境（換頁、清空、橡皮擦、同步鏡射模式）下都是「整個換成新陣列」而非「就地修改」，確保這個修法在所有情境下都正確。
- 已執行 frontend typecheck 與完整前端測試套件（162 個測試全數通過）。

## 設定頁可以安全產生 MCP auth token

### 功能目的

MakeSlide 的 MCP server 需要搭配 bearer token 才能在啟用 Google 登入時讓自動化工具安全存取 API。過去 token 主要仰賴部署者手動編輯環境變數 `MCP_AUTH_TOKEN`，不熟悉部署檔案位置的使用者很難自行建立或輪替，而且若把既有 token 放進設定頁長期明文顯示，也會增加外洩風險。

這次新增管理員專用的一鍵產生功能，讓系統管理者可以直接在設定頁產生新的 MCP auth token，並立即保存到系統層級設定中。新 token 只會在產生後顯示一次，方便立即複製到 MCP client 的 `MAKESLIDE_MCP_TOKEN`，之後設定頁只顯示是否已設定，不會把既有 token 明文取回或長期展示。

### 使用方式

1. 以 admin 帳號登入 MakeSlide。
2. 進入「設定」→「管理員」。
3. 在「MCP auth token」區塊按下「產生 MCP auth token」。
4. 產生後立即複製畫面上的一次性 token，設定到 MCP client 的 `MAKESLIDE_MCP_TOKEN`。
5. 後端會把 token 寫入系統設定檔，既有 MCP bearer token 驗證行為維持不變；新的 token 會立刻用於後續 API 驗證。

### 技術重點

- 後端新增 `POST /api/system/mcp-auth-token` admin-only API，使用 Node `crypto.randomBytes(32).toString('base64url')` 產生 256-bit 隨機 token。
- MCP token 納入系統層級設定與 runtime cache，保存到 `accounts/default/settings.env` 的 `MCP_AUTH_TOKEN`，並讓 `server.ts` 的 bearer token 驗證讀取 runtime 設定，避免產生後必須重啟服務才生效。
- `GET /api/system/ai-settings` 對 admin 只回傳 `has_mcp_auth_token`，不回傳既有 token 明文。
- 前端設定頁新增一次性顯示與複製按鈕，並補齊中英文 locale。
- 分支：`feature/settings-generate-mcp-token`，完成後 merge 回 `master`。
- 驗證：`npm run typecheck --workspace backend`、`./scripts/with-node-env.sh npx tsx --test backend/test/mcp-token-auth.test.ts`、`npm run typecheck --workspace frontend`、`./scripts/with-node-env.sh npx tsx --test frontend/src/i18n.test.ts` 皆通過。

## 語音轉檔步驟補上逾時保護，這是主管線每一頁都會經過的關鍵路徑

### 功能目的

之前已經陸續修復過 YouTube 字幕下載、影片產生功能裡 ffmpeg 卡住沒有逾時保護的問題，但重新檢視後發現語音合成步驟裡的音訊格式轉檔也有一樣的問題，而且影響面其實比先前修過的都更大：先前修的幾個案例都是「特定功能才會用到」（例如只有匯入 YouTube 影片才會跑到），但這次發現的轉檔步驟是**每一份簡報、每一頁**在生成語音後都必須經過的標準流程，執行頻率遠高於其他案例。雖然單次卡住的機率不高（純粹是本機處理，不像下載字幕那樣依賴外部網路），但因為完全沒有任何逾時保護，一旦真的卡住，又因為系統預設只允許同時處理 2 份簡報，足以讓整條生成佇列完全卡死，影響所有正在排隊等待生成的簡報。

### 修復內容

幫這個轉檔步驟也加上跟之前幾次修復一致的逾時保護機制：超過時間還沒完成就會被主動終止並回報明確的逾時錯誤，讓系統能正常往下處理，而不是讓整條佇列被一筆卡住的任務拖垂。

### 技術重點

- `backend/src/worker/steps/synthesizeAudio.ts` 的本地轉檔函式補上逾時參數，套用 3 分鐘的安全逾時值。
- 新增 4 個測試，使用簡單的 Node 程式模擬各種情境驗證逾時終止邏輯正確。
- 已執行 backend typecheck 與完整測試套件（638 個測試，18 個失敗皆為既有環境性基準，無新增回歸）。

## 登入 session 的簽章驗證也改用常數時間比較，修補風險更高的同類問題

### 功能目的

延續上一輪修復 MCP 存取金鑰計時攻擊風險的方向，這次檢查登入機制本身的核心：每個使用者登入後拿到的 session cookie，裡面附帶一個用伺服器密鑰簽署的簽章，用來證明這個 cookie 沒有被竄改過。驗證這個簽章時，原本也是用最直接的字串比較方式，存在跟上一輪一樣的計時攻擊風險，而且這次的風險其實更高：因為 session cookie 的內容（裡面寫著「我是哪個帳號」）本來就是使用者自己可以控制的，如果簽章驗證真的能被計時攻擊破解，等於有心人士不需要知道伺服器的簽署密鑰，就能偽造出「我是任何一個帳號」的合法登入憑證。另外登入流程裡用來防止跨站偽造請求的一次性驗證碼比對，也有同樣的寫法，一併修正。

### 修復內容

把這兩處比較都換成業界建議的常數時間比較演算法，從根本上消除這個風險，純粹是比較方式的調整，不影響任何既有的登入邏輯或使用者體驗。

### 技術重點

- `backend/src/routes/auth.ts` 的 session 簽章驗證與 OAuth 一次性驗證碼比對都改用常數時間比較。
- 新增 8 個測試，涵蓋常數時間比較函式本身、session 簽章驗證的正常/竄改/偽造情境，以及完整的登入流程驗證。
- 已執行 backend typecheck 與完整測試套件（634 個測試，18 個失敗皆為既有環境性基準，無新增回歸）。

## MCP 自動化工具的存取金鑰比對改用更安全的常數時間演算法

### 功能目的

系統可以透過 MCP（一種讓 Claude Code 等工具操作系統的協定）搭配一個存取金鑰來自動化操作，這個金鑰一旦驗證通過，就能繞過 Google 登入限制取得完整的 API 存取權，是相當高價值的憑證。但原本驗證這個金鑰的方式是用程式語言最直接的字串比較，這種比較方式有個特性：只要前面幾個字元就不一樣，馬上就會判定失敗並結束比較；如果前面的字元都一樣，要花更多時間才會發現後面不一樣。理論上，有心人士可以透過送出大量請求、統計每次比對花費的時間差異，一個字元一個字元地把正確金鑰猜出來。這是資安界廣為人知的「計時攻擊」風險類型，業界標準做法是用「不管內容是否相符都花費同樣時間」的方式來比較機密資料。

### 修復內容

把金鑰比對方式換成業界建議的常數時間比較演算法，讓比對所需的時間不會因為「猜對了多少字元」而有差異，從根本上消除這個計時側信道的可能性。

### 技術重點

- `backend/src/server.ts` 新增 `timingSafeStringEqual()`，套用到 MCP bearer token 的驗證邏輯。
- 新增 4 個測試，包含常數時間比較函式本身的單元測試與完整的端對端驗證流程測試。
- 已執行 backend typecheck 與完整測試套件（626 個測試，18 個失敗皆為既有環境性基準，無新增回歸）。

## AI 自訂腳本動畫生成功能補上使用者中途離開時的防護

### 功能目的

「自訂腳本動畫」功能讓使用者用文字描述，由 AI 即時串流產生對應的 JavaScript 動畫程式碼，過程中會持續把生成進度推送到瀏覽器。但如果使用者在生成過程中關掉分頁或切換離開頁面，伺服器並沒有偵測到這件事，會繼續嘗試把後續的生成進度寫到一個已經沒人在聽的連線上——這在 Node.js 的串流機制下可能引發沒有被妥善處理的例外，也會讓伺服器白白浪費已經在背景持續進行的 AI 生成資源，直到整個流程跑完才結束。

### 修復內容

讓這個功能能偵測到使用者中途離開：一旦發現連線已經中斷，後續就不再嘗試寫入任何進度資料；同時補上一個保護機制，確保萬一仍有寫入失敗的情況，也只會記錄一筆警告紀錄，不會讓伺服器出現未處理的例外狀況。

### 技術重點

- `backend/src/routes/pdfs/page-animation.ts` 的 `custom-script` SSE 端點補上連線中斷偵測與寫入保護。
- 新增 2 個測試，分別驗證中斷後不再送出後續事件、以及寫入錯誤被正確攔截而不會往外拋出。
- 已執行 backend typecheck 與完整測試套件（622 個測試，18 個失敗皆為既有環境性基準，無新增回歸）。

## 正式環境下隱藏未預期錯誤的詳細內容，避免洩漏伺服器內部資訊

### 功能目的

系統裡大部分已知的錯誤情況都有專屬、設計過的錯誤訊息（例如「找不到這個頁面」「沒有權限」），但對於完全沒被預期到的例外——例如某個檔案剛好不存在、資料庫底層出了問題——系統會把這個例外的原始錯誤訊息直接回傳給呼叫端。問題是這些原始錯誤訊息有時候會包含伺服器內部的細節，例如完整的檔案系統路徑、資料庫的表格/欄位名稱，這些資訊本來就不該讓外部使用者看到，是常見的資安基本功項目之一。

### 修復內容

在正式環境執行時，遇到這種完全沒被預期到的錯誤就只回傳一個通用的「系統發生未預期的錯誤，請稍後再試」訊息，不再透露原始錯誤內容；伺服器內部仍然會完整記錄這個錯誤供日後排查問題。本機開發或測試環境維持顯示完整錯誤訊息，方便除錯。已知的、有專屬錯誤碼的錯誤訊息（例如表單驗證失敗）完全不受影響，兩種環境下都正常顯示。

### 技術重點

- `backend/src/server.ts` 的全域錯誤處理器依 `NODE_ENV` 決定要不要隱藏未預期例外的訊息。
- 新增 3 個測試驗證正式環境正確隱藏、開發環境維持顯示、已知錯誤不受影響。
- 已執行 backend typecheck 與完整測試套件（620 個測試，18 個失敗皆為既有環境性基準，無新增回歸）。

## 互動式修圖功能的逾時設定補上與其他圖片生成功能一致的標準

### 功能目的

系統呼叫 AI 修改投影片圖片的地方有好幾處：批次重新生成、依提示詞調整單頁圖片、用遮罩局部重繪圖片等。其中批次重新生成那條路徑特別設定了較短的逾時時間（60-120 秒，依圖片品質設定調整），搭配自動重試機制，讓背景任務遇到卡住的情況時能更快重試。但「依提示詞調整單頁圖片」與「用遮罩局部重繪」這兩個讓使用者在介面上即時操作、同步等待結果的功能，卻完全沒有套用這個逾時設定，而是落回更長的系統預設值（4 分鐘）。這代表使用者萬一遇到圖片生成卡住的情況，要等的時間比預期長了 2-4 倍才會看到錯誤訊息。

### 修復內容

讓這兩個互動式修圖功能也套用跟批次生成一樣的逾時邏輯（依圖片品質設定選擇 60 秒或 120 秒），讓所有圖片生成相關功能的逾時行為保持一致。沒有額外加上自動重試機制，因為使用者主動觸發的單次編輯如果自動重試，可能會造成非預期的重複生成或額外費用，這是需要另外評估的產品決策。

### 技術重點

- `backend/src/routes/pdfs/page-operations.ts` 新增 `imageEditTimeoutMs()`，套用到兩個 `images.edit()` 呼叫。
- 新增 3 個測試驗證逾時設定正確傳遞，以及依圖片品質設定切換逾時長度的邏輯正確。
- 已執行 backend typecheck 與完整測試套件（617 個測試，18 個失敗皆為既有環境性基準，無新增回歸）。

## 影片產生功能補上既有的逾時保護機制（原本已內建卻沒有被實際使用）

### 功能目的

延續檢查子行程逾時保護的方向，這次發現一個有趣的狀況：負責執行 ffmpeg 指令的共用函式其實老早就內建了逾時保護機制（逾時會強制終止行程並回報錯誤，不會讓呼叫端傻等），但「產生簡報影片」這個功能呼叫這個共用函式的兩個地方，都沒有把逾時設定傳進去——等於這個安全機制形同沒裝。如果某一頁的圖片格式異常導致 ffmpeg 內部卡住，整個產生影片的任務就會無限期卡住，而且頁數越多，遇到這種情況的機率也越高。

### 修復內容

幫這兩個呼叫補上合理的逾時設定，讓既有的保護機制真正發揮作用：超時就會被強制終止並回報明確錯誤，讓任務正常標記為失敗，而不是無限期卡住。

### 技術重點

- `backend/src/worker/steps/generateVideo.ts` 補上 `timeoutMs` 設定（單頁合成、最終影片串接皆為 5 分鐘）。
- 新增 `backend/test/poppler-run-command.test.ts`，這是該共用函式第一次有直接測試覆蓋，包含驗證逾時機制本身確實會正確終止卡住的行程。
- 已執行 backend typecheck 與完整測試套件（614 個測試，18 個失敗皆為既有環境性基準，無新增回歸）。

## YouTube 匯入的字幕/語音下載補上逾時保護，避免整條處理佇列被卡死

### 功能目的

延續最近幾輪修復外部呼叫缺乏逾時保護的方向，這次檢查的是 YouTube 影片匯入功能背後呼叫的 yt-dlp（下載字幕/音訊）與 ffmpeg（切割音檔）子行程。這兩個呼叫完全沒有任何逾時機制，如果 yt-dlp 卡住（網路不穩、YouTube 的反爬蟲驗證卡關等情況並非少見），呼叫就會無限期掛住。這個問題的嚴重性其實比之前修的幾個 API 逾時缺口更高：系統預設只允許同時處理 2 個任務，只要有 1-2 個 YouTube 匯入卡住，就足以讓整個處理佇列完全卡死——包括跟 YouTube 完全無關的一般 PDF 上傳也會被波及，無法繼續處理。

### 修復內容

幫這兩個子行程都加上逾時保護：超過設定時間還沒結束就會被主動終止，並回報失敗，讓上層邏輯可以正常往下走（換下一個語言重試、或回報匯入失敗），而不是讓整個任務卡住拖累其他人。

### 技術重點

- 新增共用的 `spawnWithTimeout()`，統一處理逾時終止與輸出擷取邏輯。
- 依用途分配不同的逾時預算：字幕下載 2 分鐘、完整音訊下載（影片可能較長）10 分鐘、ffmpeg 切割 2 分鐘。
- 新增 5 個測試，刻意不依賴真正的 yt-dlp/ffmpeg，改用簡單的 Node 程式驗證逾時終止邏輯本身正確。
- 已執行 backend typecheck 與完整測試套件（610 個測試，18 個失敗皆為既有環境性基準，無新增回歸）。

## Google 登入流程補上逾時保護，避免連線掛起時使用者卡在登入畫面

### 功能目的

上一輪修復了 Gemini API 呼叫沒有逾時保護的問題後，延續同一個檢查方向找到另一個同類缺口：使用者用 Google 帳號登入時，後端會依序呼叫 Google 的兩個 API（用授權碼換取存取權杖、再用權杖換取使用者資訊），這兩次呼叫同樣完全沒有設定逾時。如果 Google 那端連線掛起，使用者點擊登入後就會卡在瀏覽器的讀取畫面，沒有任何回應也沒有錯誤訊息，唯一的辦法是自己重新整理頁面。

### 修復內容

幫這兩個呼叫加上 15 秒的逾時保護（比起呼叫 AI 模型用的 4 分鐘短很多，因為登入是使用者當下在前台等待的操作，應該快速失敗讓使用者知道發生問題，而不是放著讓他乾等）。逾時或任何連線層級的錯誤，現在都會被既有的「Google 連線失敗」錯誤訊息涵蓋，使用者會在短時間內看到明確的錯誤提示，可以重新嘗試登入。

### 技術重點

- `backend/src/routes/auth.ts` 新增 `fetchGoogleOAuth()` 包裝函式，套用 15 秒逾時，失敗時統一回傳 `null` 交由既有錯誤處理路徑接手。
- 新增 3 個測試驗證逾時訊號確實有效套用，以及連線失敗情境下會回應明確錯誤而不是讓伺服器拋出未捕捉例外。
- 已執行 backend typecheck 與完整測試套件（605 個測試，18 個失敗皆為既有環境性基準，無新增回歸）。

## Gemini API 呼叫補上逾時保護，避免連線掛起時無限期卡住

### 功能目的

系統支援多家 LLM 供應商（OpenAI、Gemini、CGU Air、OpenRouter），其中呼叫 OpenAI 的路徑已經設定好請求逾時（預設 4 分鐘），但比對後發現呼叫 Gemini API 的三個地方（一般文字生成、串流文字生成、語音合成）都是直接用原生 `fetch()`，完全沒有設定任何逾時。Node 的原生 `fetch()` 本身沒有預設逾時機制，如果 Gemini 那端的連線卡住、出現異常但沒有明確回應或斷線（網路問題、服務異常等情境並非罕見），呼叫端的請求就會無限期掛在那裡，可能讓背景處理任務或網頁請求一直占用資源、永遠不會結束也不會報錯。

### 修復內容

讓三個 Gemini API 呼叫都套用與 OpenAI 路徑相同的逾時預算，逾時後會明確地以逾時錯誤結束，交由既有的錯誤處理流程接手（例如背景任務標記為失敗、網頁請求回傳明確錯誤），不會再無限期卡住。

### 技術重點

- `backend/src/services/gemini.ts` 新增 `geminiRequestTimeoutSignal()`，套用到三個 `fetch()` 呼叫的 `signal` 選項。
- 新增 `backend/test/gemini-fetch-timeout.test.ts` 3 個測試，驗證逾時設定確實生效且會在短時間內正確結束，不會真的卡住。
- 已執行 backend typecheck 與完整測試套件（602 個測試，18 個失敗皆為既有環境性基準，無新增回歸）。

## 「依提示詞新增頁面」任務在伺服器重啟後不再留下永久卡住的孤兒頁面

### 功能目的

「依提示詞新增頁面」功能讓使用者在既有簡報中插入新頁面（AI 依大綱生成圖片、逐字稿與語音）。這個任務的進度只存在伺服器記憶體中，且執行期間從未更新所屬簡報的整體狀態。如果伺服器在任務執行到一半時重新啟動（部署、當機重啟等），記憶體中的進度會直接消失，已經寫進資料庫的新頁面則會永遠卡在「處理中」的中間狀態——使用者看到的就是簡報裡多了幾張空白或讀取不出來的投影片，沒有任何錯誤訊息，也沒有明顯的修復入口。比對另一個結構類似的「重新生成」功能後發現，那個功能其實已經有完整的解法：把任務進度存進資料庫，下次讀取時若發現任務還停在進行中就直接標記失敗並給出清楚訊息，只是「新增頁面」這個較新的功能從未補上同樣的處理。

### 修復內容

在伺服器啟動流程中加入一次性的孤兒頁面偵測：只要某個頁面所屬的簡報整體狀態已經是「完成」，但這個頁面本身還停在生成圖片/逐字稿/語音的中間狀態，就代表它是被中斷的「新增頁面」任務留下的孤兒資料，會被自動標記為「失敗」並附上清楚的中文錯誤訊息，讓使用者可以直接用既有的「重新生成圖片／逐字稿／語音」功能手動修好這一頁，而不是面對一個永遠卡住、看不出原因的空白投影片。

### 技術重點

- 新增 `recoverOrphanedAddPagesPages()`（`backend/src/worker/addPagesFromPrompt.ts`），在 `server.ts` 啟動流程中與既有的主管線崩潰復原一起執行。
- 新增 5 個測試覆蓋各種中間狀態的孤兒頁面偵測，以及確認不會誤判正常處理中或已有自訂錯誤訊息的頁面。
- 已執行 backend typecheck 與完整測試套件（599 個測試，18 個失敗皆為既有環境性基準，無新增回歸）。

## 登入與 OAuth state cookie 在正式環境補上 Secure 屬性

### 功能目的

系統性檢查常見的前後端安全弱點類別（`dangerouslySetInnerHTML`、SQL injection、動態程式碼執行）時，前三項確認都已是安全用法或已知且有防護的既有功能，但檢查 cookie 安全屬性時發現登入用的 `makeslide_session`（30 天有效期）與 OAuth 流程用的 `makeslide_oauth_state` 這兩個 cookie 都只設定了 `HttpOnly`/`SameSite=Lax`，完全沒有 `Secure` 屬性。正式環境（`Dockerfile` 設定 `NODE_ENV=production`）一定跑在 HTTPS 之後，缺少 `Secure` 屬性代表這個帶有完整登入身分的 cookie，理論上仍可能在未來任何純 HTTP 連線情境下被送出，是一個可以低成本補上的縱深防禦缺口。

### 修復內容

在 `setCookie()`/`clearCookie()` 共用的 cookie 組裝邏輯裡，依據 `NODE_ENV` 是否為 `production` 決定要不要附加 `; Secure`；本機與測試環境通常跑在沒有 TLS 的 `http://localhost`，維持原樣不受影響，避免登入功能在開發環境失效。

### 技術重點

- `backend/src/routes/auth.ts` 新增 `secureCookieSuffix()`，`setCookie()`/`clearCookie()` 統一套用。
- 新增 `backend/test/auth-cookie-secure.test.ts` 4 個測試，驗證生產環境下 `Set-Cookie` 含 `Secure`、非生產環境不含，且既有 `HttpOnly`/`SameSite=Lax` 屬性不受影響。
- 已執行 backend typecheck 與完整測試套件（594 個測試，18 個失敗皆為既有環境性基準，無新增回歸）。

## 測驗作答分數改由伺服器端權威計算，並修復逐題配分無法持久化的問題

### 功能目的

課堂測驗功能讓老師可以幫每一題設定自訂配分（總分 100，未設定的題目均分剩餘額度），學生作答提交後會看到自己的分數，老師也能在「測驗作答紀錄」看到所有學生的分數總覽。深入檢查作答提交端點時發現兩個問題：(1) 提交分數時完全信任前端算好送來的 `score` 數字，伺服器端從未拿學生送出的答案對照測驗的正確答案重新驗算——任何能直接呼叫 API 或修改過前端程式的人都能回報任意分數；(2) 更根本的是，老師在介面上設定的「每題配分」這個欄位，後端的資料驗證規則裡完全沒有定義，每次儲存或讀取測驗時都會被悄悄丟掉，導致這個功能實際上從未真正生效過。

### 修復內容

把後端的測驗題目驗證規則補上 `score` 欄位，讓老師設定的逐題配分能真正被儲存與讀回。同時在後端實作一套與前端計分邏輯完全對應的計分函式（單選題全有全無、多選題依逐個選項比對給部分分、未設定配分的題目均分剩餘額度），學生提交作答時改為伺服器自行根據測驗的正確答案組與送出的作答內容重新算分，完全不採用前端送來的分數宣稱值。

### 技術重點

- `backend/src/routes/pdfs/quizzes.ts` 新增 `score` 欄位、`normalizeQuestionScores()`/`isCorrectAnswer()`/`calcQuestionScore()`/`computeAttemptScore()`，`POST /attempts` 改用伺服器算出的分數存入資料庫。
- 新增 4 個測試：正確答案但聲稱 0 分仍得滿分、錯誤答案但聲稱滿分仍得 0 分（並直接查資料庫驗證落地值）、多選題部分給分計算正確、自訂逐題配分儲存後讀回不變。
- 已執行 backend typecheck（通過）與完整測試套件（590 個測試，18 個失敗皆為既有環境性基準，無新增回歸）。

## 文字匯入轉投影片服務補上單元測試

### 功能目的

使用者用純文字貼上匯入投影片時，會經過 `renderTextPages.ts` 這個 worker 步驟把文字轉成投影片圖片。比對 `backend/src/worker/steps/` 與既有測試後發現，這個檔案完全沒有任何直接測試覆蓋；其中的 `escapeXml()`、`splitLines()`、`toPages()` 三個函式是純字串/陣列處理、零外部依賴，是低風險高價值的測試補強對象。

### 修復內容

把這三個模組內部函式改為具名匯出，讓它們可以直接被單元測試呼叫，不需要透過完整的 worker pipeline 或檔案系統互動。

### 技術重點

- 新增 `backend/test/render-text-pages.test.ts` 15 個測試：`escapeXml()` 覆蓋五個 XML 保留字元的跳脫與重複出現情境；`splitLines()` 覆蓋 CRLF/CR 換行正規化、空白行各自保留為獨立空字串（不會被合併）、超過 34 字元自動換行（含剛好 34 字元的邊界情況）；`toPages()` 覆蓋每 12 行分頁（含剛好 12 行的邊界情況）與空輸入情境；另有一個串接測試驗證 `splitLines`+`toPages` 不會在分頁過程中遺漏任何一行。
- 已執行 backend typecheck（通過）與完整測試套件（587 個測試，18 個失敗皆為既有環境性基準，無新增回歸）。

## 舊版圖片遷移服務補上單元測試

### 功能目的

伺服器啟動時會自動把舊版上傳的 PNG 封面圖與頁面圖片轉換成 JPG（節省儲存空間、統一格式），但這個 `imageMigration.ts` 服務原本完全沒有任何測試覆蓋——比對 `backend/src/services/` 與既有測試後發現，這是目前唯一一個完全沒有直接測試的服務檔案。

### 修復內容

把模組內部「決定是否需要轉換」的核心邏輯（來源檔案不存在或目的檔案已經存在時都跳過，否則才呼叫 `sharp` 進行轉檔）改為具名匯出，讓它可以用真實的暫存 PNG 檔案獨立測試，不需要碰共用的儲存根目錄。

### 技術重點

- 新增 `backend/test/image-migration.test.ts`：3 個單元測試驗證核心轉換邏輯（成功轉出合法 JPEG、來源不存在時跳過、目的檔已存在時跳過且不覆寫內容），2 個整合測試驗證完整的啟動遷移流程（封面與頁面 PNG 都正確轉換、資料庫的 `image_path` 欄位正確更新成 `.jpg`；遇到損毀的假 PNG 檔案時不會拋出例外或擋住其他檔案繼續遷移）。
- 已執行 backend typecheck（通過）與完整測試套件（572 個測試，18 個失敗皆為既有環境性基準，無新增回歸）。

## 修補「複製簡報」與管線控制端點的權限缺口（本系列最嚴重的一個）

### 功能目的

系統性檢查 `backend/src/routes/pdfs/upload.ts` 時，發現這個檔案完全沒有定義過任何權限檢查輔助函式——目前為止這個系列裡權限缺口最嚴重的一個檔案。其中 `POST /api/pdfs/:id/duplicate`（複製簡報）是目前發現的所有缺口裡最嚴重的：完全沒有權限檢查，而且複製時會把新副本的擁有者設成「呼叫者自己」。這代表任何人只要知道一份私有簡報的 PDF id，就能把整份簡報——所有投影片圖片、逐字稿、語音檔案——完整複製成自己帳號下的私人簡報，等同直接竊取他人的私有內容，已經不只是「讀取外洩」這個層級的問題。

另外三個管線控制端點——確認逐字稿繼續處理、失敗後重試、產生影片——同樣完全沒有權限檢查，任何人都能對任意 PDF id 觸發這些動作；產生影片還會實際呼叫 ffmpeg 運算，可被當作資源濫用手段。

### 修復內容

在這個檔案新增 `canReadPdf()`/`canEditPdf()` 輔助函式，套用到這 4 個端點：「複製簡報」用 `canReadPdf()`（語意上「能看到這份簡報就能複製一份」），其餘三個管線控制端點用 `canEditPdf()`。

### 技術重點

- 新增 `backend/test/upload-pipeline-control-permission.test.ts` 11 個測試，特別驗證了被拒絕的複製請求確實沒有在資料庫多留下一筆副本（不只檢查回應狀態碼，也直接確認沒有發生資料外流的實際後果）。
- 已執行 backend typecheck（通過）與完整測試套件（567 個測試，18 個失敗皆為既有環境性基準，無新增回歸）。

## 課堂同步直接加入端點補上權限檢查

### 功能目的

課堂同步（讓觀眾跟著講者的播放進度自動翻頁）有兩種加入方式：用分享連結加入（`/sync/share-join`，本來就有驗證分享 token），與直接加入（`/sync/join`，給簡報擁有者自己開啟同步模式時用）。後者完全沒有任何權限檢查，只檢查 PDF 是否存在。而「加入同步」在目前沒有人擔任 master（主控）角色時，會直接讓呼叫者取得 master 角色——可以控制這份簡報直播同步的播放狀態，也能看到觀眾提出的問題與 AI 給的回答。

這代表任何人只要知道一份私有簡報的 PDF id，就能在擁有者還沒開啟同步模式（或閒置太久導致 master 逾時）的空窗期，搶先呼叫這個端點，奪取本該屬於擁有者的主控權限。

### 修復內容

補上 `canEditPdf()` 權限檢查——刻意不是用 `canReadPdf()`：取得 master 角色等同取得控制權，比照其他「編輯類」端點的門檻會更合理，這樣一般唯讀的公開瀏覽者也不能搶到主控權，只有擁有者或協作者可以。分享連結的訪客則維持原樣，走另一條已驗證 token 的路徑加入為 follower。

### 技術重點

- 用 `canEditPdf()` 而非 `canReadPdf()` 還有一個額外好處：保留了既有測試裡「沒有 `owner_sub` 的舊版/測試用簡報視為任何人可編輯」這個既有慣例，不會破壞舊版相容性。
- 新增 `backend/test/sync-join-permission.test.ts` 6 個測試，並重跑既有的「shared sync join」測試確認沒有破壞舊版相容性。
- 已執行 backend typecheck（通過）與完整測試套件（556 個測試，18 個失敗皆為既有環境性基準，並用 `git stash` 比對確認改動前後完全一致）。

## 封面／影片／大綱／來源音訊／投票端點補上讀取權限檢查（detail.ts 系統性修復完成）

### 功能目的

接續上一輪在 `detail.ts` 處理的 5 個核心內容端點，這次完成剩下的 6 個：封面圖、封面縮圖、生成的影片、YouTube 大綱、原始 YouTube 來源音訊、頁面投票清單。這些端點原本都只檢查資源是否存在，完全沒有檢查請求者是否有權限看這份簡報；`source-audio` 甚至連 PDF id 是否存在都沒檢查。

### 修復內容

補上與其他端點一致的 `canReadPdf()`/`shareAccessForPdf()` 檢查。

### 技術重點

- 以參數化方式新增 60 個測試（6 個端點 × 10 種情境，封面/影片/大綱/來源音訊為 PDF 層級、投票為頁面層級），覆蓋非擁有者/未登入對 private 簡報應得 403、不存在的 PDF id 應得 404、擁有者/`public`/分享 token 讀取應能通過權限檢查。
- 已執行 backend typecheck（通過）與完整測試套件（550 個測試，19 個失敗皆為既有環境性基準，無新增回歸）。
- 連同上一輪的 5 個端點，`detail.ts` 這次系統性檢查發現的全部 11 個讀取權限缺口至此修復完成。

## 投影片圖片／逐字稿／語音核心內容端點補上讀取權限檢查

### 功能目的

延續上一輪在 `detail.ts` 發現的大範圍讀取權限缺口，這次處理其中最核心、最常被存取的 5 個端點：投影片圖片（`/pages/:n/image`）、縮圖（`/thumbnail`）、逐字稿全文（`/text`）、逐字稿（`/script`）、語音檔案（`/audio`）。這些端點原本只檢查檔案是否存在，完全沒檢查請求者是否有權限看這份簡報——而且因為它們是各自獨立的端點，即使主要的 `GET /api/pdfs/:id` 有正確的權限檢查，也完全擋不住直接呼叫這些子資源端點。

### 修復內容

補上與 `GET /api/pdfs/:id` 完全一致的 `canReadPdf()`/`shareAccessForPdf()` 檢查：擁有者一律可讀；`public`/`public_editable` 簡報任何人可讀；私有簡報則需要帶有效的分享 token。

### 技術重點

- 以參數化方式新增 30 個測試（5 個端點 × 6 種情境），覆蓋非擁有者/未登入對 private 簡報應得 403、不存在的 PDF id 應得 404、擁有者/`public`/分享 token 讀取應能通過權限檢查。
- 已執行 backend typecheck（通過）與完整測試套件（514 個測試，18 個失敗皆為既有環境性基準，無新增回歸）。
- 還有 6 個端點（封面圖、封面縮圖、影片、YouTube 大綱、YouTube 來源音訊、頁面投票清單）留給下一輪處理，修法完全相同。

## 頁面提示詞／逐字稿端點補上權限檢查（並發現更大範圍的缺口）

### 功能目的

系統性檢查 `backend/src/routes/pdfs/detail.ts`（負責簡報主要內容讀寫的核心檔案）的所有讀取端點時，發現一個影響範圍很大的問題：除了主要的 `GET /api/pdfs/:id` 之外，這個檔案裡將近 15 個其他端點完全沒有檢查請求者是否有權限看（或改）這份簡報，只檢查資源本身是否存在。其中兩個還是**寫入**端點——`PATCH /pages/:n/prompt`（更新頁面提示詞）與 `PUT /pages/:n/script`（更新逐字稿）——代表任何人只要知道 PDF id 與頁碼，就能直接覆寫別人簡報的內容，不只是讀取外洩。

### 本次修復內容

優先處理風險最高、牽涉「提示詞」文字內容的三個端點：

- `GET`/`PATCH /api/pdfs/:id/pages/:n/prompt`（頁面提示詞）
- `PUT /api/pdfs/:id/pages/:n/script`（逐字稿，寫入端點）
- `GET /api/pdfs/:id/pages/:n/generation-prompts`（AI 生成時實際送出的完整提示詞紀錄）

補上與這個檔案 `GET /api/pdfs/:id` 完全一致的 `canReadPdf()`/`canEditPdf()`/`shareAccessForPdf()` 檢查。

### 還沒處理的部分

另外還有 11 個讀取端點同樣完全沒有權限檢查，涵蓋投影片圖片、縮圖、逐字稿全文、語音檔案、封面圖、影片、YouTube 大綱與來源音訊、頁面投票清單——也就是簡報最核心的實際內容。因為數量多、影響範圍大，這次只先記錄成 TODO.md 待辦項目（建議拆成 2-3 個較小的 PR 處理），沒有在同一輪一次改完。

### 技術重點

- 新增 `backend/test/detail-permission.test.ts` 11 個測試，覆蓋非擁有者對 private/唯讀分享簡報應得 403（特別驗證了 `PUT /script` 被拒絕時，檔案內容確實完全沒被改動）、擁有者與分享 token 讀取應正常回應、不存在的 PDF id 應得 404。
- 已執行 backend typecheck（通過）與完整測試套件（484 個測試，18 個失敗皆為既有環境性基準，無新增回歸）。

## 全螢幕動畫編輯：直接在實際投影片上拖曳效果位置

### 功能目的

使用者回報：有些頁面的重點框（紅框）位置不準，全螢幕編輯動畫時，希望能直接在全螢幕投影片上拖曳調整，而不是用編輯面板裡那張縮小的縮圖。縮圖跟使用者實際看到的全螢幕畫面是兩份不同大小的複本，拖曳時很難精確對到想要的位置。

### 修復內容

新增一個「🎯 在投影片上拖曳」切換按鈕（只在全螢幕動畫編輯版面顯示），點下去之後，該效果的框會直接顯示在左半邊的實際投影片上，變成可拖曳——放開後位置會即時套用，跟在縮圖上拖曳的效果完全一樣，只是現在是對著「使用者真正看到的畫面」操作，不用再猜縮圖跟全螢幕之間的比例差異。再按一次按鈕、刪除該效果，或換頁時會自動收起。

這次刻意把全螢幕拖曳的範圍縮小為「只能移動位置，不能縮放大小」——編輯面板裡的縮圖仍保留完整的移動＋八個方向縮放，需要調整大小時切回縮圖操作即可；這個取捨是為了在沒有瀏覽器可以實際操作測試的情況下，避免把縮放這種互動更複雜的功能也一併導入卻沒驗證過。

### 技術重點

- 新增共用狀態 `positioningEffectId`（`PlayPageContext`），記錄目前要在全螢幕投影片上顯示拖曳框的效果 id。
- 拖曳框以 `SlideRenderer` 的 children 形式渲染，因此自動套用跟其他 overlay 效果完全相同的百分比座標系統，不需要額外做座標轉換對齊。
- 拖曳時的像素轉百分比運算，沿用既有「即時游標廣播」功能已經在用的同一招：用 `fullscreenImageRef` 指向的實際 `<img>` 元素的 `getBoundingClientRect()`。
- 已執行 frontend typecheck（通過）與完整前端測試（197 個全數通過）。**這是純 UI 互動功能，沒有新增可獨立測試的純函式，也沒有在瀏覽器中實際操作驗證過**，建議實際操作一次確認拖曳手感與座標是否準確對齊。

## 動畫效果顯示時間配合逐字稿實際長度，不再提早消失

### 功能目的

使用者回報：文字說明動畫（重點框、文字 callout、條列重點等）顯示的時間經常太短，旁白還在解釋這個重點，畫面上的效果卻已經先淡出消失了。

### 根因

每個動畫效果可以綁定某一句逐字稿（`startTrigger`），讓效果跟著那句話開始播放出現。AI 自動產生效果時，會請 LLM 決定效果要停留多久才淡出（`exitDuration`），但 LLM 只能看到那句話的「文字」，不知道這句話實際上要唸幾秒——提示詞只給了「短暫提示可設 1-3 秒，整句都在說明可以設長一點」這種粗略指引，遇到長句子常常猜得太短。

### 修復內容

播放頁本來就會用「依實際音檔長度估算的逐句時間表」，把每個效果的開始時間換算成正確秒數（`resolveAnimationSpec()`）。現在這個換算同時也會檢查：「效果停留到淡出完成」是否至少蓋到「這句旁白實際唸完」的時間點，不夠的話就把 `exitDuration` 往上補，確保效果不會在旁白還在講這句話時就先消失。這個調整只會「延長」、不會「縮短」——如果原本設定的時間已經夠長，維持不變。

### 技術重點

- 修改集中在 `frontend/src/lib/animationSpec.ts` 的 `resolveAnimationSpec()`，不需要改動 AI 生成提示詞或後端邏輯。
- 新增 3 個測試覆蓋延長太短的 `exitDuration`、保留已經足夠長的 `exitDuration`、沒有設定 `exitDuration` 的效果不受影響三種情境。
- 已執行 frontend typecheck（通過）與完整前端測試（197 個全數通過）。

## 全螢幕動畫編輯器新增「暫停播放」快速按鈕

### 功能目的

一般的動畫編輯頁有「套用範本」下拉選單，可以一鍵套用「暫停播放提示」等預先設好的效果範本；但全螢幕動畫編輯器（`compact` 模式）這個下拉選單完全不會顯示，只剩下會新增「空白預設效果」的「新增效果」按鈕——使用者得先新增、再手動把效果型別改成 `pause-playback`、再填入提示文字，現場想插入一個暫停提醒非常不方便。

### 修復內容

在「新增效果」按鈕旁加上一個只在全螢幕（`compact`）模式才顯示的「暫停播放提示」按鈕，直接呼叫既有的 `handleApplyPreset('pause-playback')`，效果與一般模式下拉選單選擇「暫停播放提示」完全相同（一鍵套用預設的文字、位置與大小）。

### 技術重點

- 純粹重用既有的 `EFFECT_PRESETS`/`handleApplyPreset` 機制，沒有新增任何效果型別或邏輯。
- 已執行 frontend typecheck（通過）與完整前端測試（194 個全數通過）。

## 全螢幕動畫編輯器改為左右分割版面，效果清單自動捲動

### 功能目的

使用者回報：全螢幕的動畫編輯器應該跟圖片/字幕/編輯一樣，把畫面分成左右兩半顯示，而不是用一個浮動面板蓋在投影片上。另外效果清單在播放時應該自動捲動到目前播放中的效果，不用手動往下找。

### 修復內容

原本全螢幕動畫編輯器是用右上角獨立按鈕切換的浮動面板（蓋在畫面右側），跟「圖片」「字幕」「編輯」三種版面用左右分割顯示的方式不一致。現在「動畫」變成跟它們同一組版面切換分頁裡的第四個選項：選中後左半邊顯示投影片（與字幕/編輯版面共用同一套畫面與手寫畫板），右半邊顯示動畫效果編輯器。鎖定全螢幕（分享連結唯讀模式）時「動畫」分頁會跟「編輯」分頁一樣被隱藏，避免唯讀訪客誤觸編輯功能。

效果清單則新增自動捲動：播放進度進入某個效果的顯示時間範圍時，該效果在清單中的項目會自動捲動到可見範圍，不需要手動在長長的效果清單裡往下找。「新增效果」按鈕本來就會把新效果插入在目前播放效果之後（先前已實作），這次確認過不需要額外修改。

### 技術重點

- `PlayPageContext.tsx`/`PlayPage.tsx` 的 `FullscreenLayout` 型別新增 `'animation'`；原生全螢幕 API 判斷（避免編輯時誤觸 ESC 跳出全螢幕）與 `getActiveDrawingCanvas()` 的畫板 ref 選擇也一併納入這個新模式。
- `PlayPageFullscreen.tsx` 移除舊的浮動 `<aside>` 面板與其開關按鈕、`animationEditorOpen` state，改在既有的左右分割版面結構裡加入 `'animation'` 分支渲染 `<AnimationEditorTab mode="fullscreen">`。
- `AnimationEditorTab.tsx` 新增 `effectRowRefs`（每個效果列表項目的 DOM ref）與 `activeEffectId`（依目前播放時間找出正在播放的效果），效果改變時呼叫 `scrollIntoView({ behavior: 'smooth', block: 'nearest' })`。
- 已執行 frontend typecheck（通過）與完整前端測試（194 個全數通過）。**本次屬於純 UI 版面調整，沒有新增可獨立測試的純函式，也沒有在瀏覽器中實際操作驗證**，僅以 typecheck 與既有測試套件確認未破壞既有行為。

## 「依提示詞新增頁面」進度查詢補上讀取權限檢查

### 功能目的

「依提示詞新增頁面」功能讓使用者用一句話描述要新增的內容，AI 會自動規劃大綱並逐頁生成。前端會持續輪詢 `GET /api/pdfs/:id/add-pages-from-prompt/status` 來顯示進度，回應內容包含每一頁生成出來的逐字稿預覽文字（`scriptPreview`）。這個端點原本完全沒有檢查請求者是否有權限看這份簡報，只是用記憶體中的任務狀態 map 直接查詢回傳。

### 一個重複出現的修正模式

這是這幾天第三次遇到同樣的情況：先前有一輪工作記錄明確寫過「`GET .../status`（讀取任務進度）維持公開讀取」，是刻意的設計決定。但這個理由跟先前 `chat-history` 端點被誤判排除時一樣站不住腳：專案裡其他讀取端點慣用的 `canReadPdf()` 判斷規則本來就會放行真正有權限的讀者（擁有者、`public`/`public_editable` 簡報、或持有效分享連結的人），完全不檢查權限並不是「支援唯讀瀏覽者」的必要條件。

### 修復內容

補上與專案其他讀取端點一致的本地 `canReadPdf()`/`getShareToken()`/`hasShareAccess()` helper，套用到 `GET /api/pdfs/:id/add-pages-from-prompt/status`。唯讀瀏覽者的存取行為不受影響，只有真正沒有任何讀取權限的請求會被擋下。

### 技術重點

- 新增 6 個測試覆蓋非擁有者/未登入對 private 簡報應得 403、不存在的 PDF id 應得 404、擁有者/`public`/分享 token 讀取應能通過權限檢查（測試中沒有實際啟動任務，請求會確定性地落在既有的 `ADD_PAGES_JOB_NOT_FOUND` 分支）。
- 已執行 backend typecheck（通過）；完整測試套件確認失敗清單皆為既有測試順序相關 flaky，與本次改動無關。
- 連同前兩篇「圖片/逐字稿版本歷史」「AI 修圖對話紀錄」「inpaint 候選圖片」的讀取權限修復，本輪系統性檢查所有 `backend/src/routes/pdfs/*.ts` GET 端點的工作至此告一段落。

## inpaint 候選圖片補上讀取權限檢查

### 功能目的

播放頁的「修圖」功能會用 AI inpaint 產生候選圖片供使用者挑選，這些候選圖存成 `pages/NNN.candidate.<candidateId>.jpg` 檔案，透過 `GET /api/pdfs/:id/pages/:n/image-candidates/:candidateId` 讀取。這個端點原本只檢查頁碼是否在簡報範圍內，完全沒有檢查請求者是否有權限看這份簡報。雖然需要知道隨機產生的 `candidateId` 才能猜到正確網址，但這只是降低被亂猜中的機率，不是真正的存取控制——只要 `candidateId` 從其他地方外流（例如瀏覽器紀錄、分享截圖網址等），任何人都能直接讀到別人簡報正在編輯中的候選圖片內容。

### 修復內容

補上與這個檔案其他讀取端點一致的 `canReadPdf()`/`getShareToken()`/`hasShareAccess()` 檢查，放在頁碼範圍檢查之前。判斷規則不變：擁有者一律可讀；`public`/`public_editable` 簡報任何人可讀；私有簡報則需要帶有效的分享 token。不符合條件回傳 `403 FORBIDDEN`，PDF 不存在回傳 `404 PDF_NOT_FOUND`。

### 技術重點

- 新增 6 個測試覆蓋非擁有者/未登入對 private 簡報應得 403、不存在的 PDF id 應得 404、擁有者/`public`/分享 token 讀取應能通過權限檢查；測試中候選圖片檔案刻意不實際產生，讓請求確定性地落在既有的 `PAGE_NOT_FOUND` 分支，驗證權限層本身的行為。
- 已執行 backend typecheck（通過）；完整測試套件確認失敗清單皆為既有測試順序相關 flaky，與本次改動無關。

## 修正逐字稿語氣標籤 `[slowly]` 被過度套用到整段文字

### 功能目的

使用者回報：逐字稿朗讀時，常常一大段文字都被用緩慢的語速念出來，效果不好；`[slowly]` 這個語氣標籤應該只用在強調少數幾個關鍵字詞時，而不是整段話。

### 根因

負責把逐字稿切成不同語氣片段的 `backend/src/worker/steps/synthesizeAudio.ts` 的 `splitByToneMarkers()`，邏輯是「每個語氣標籤套用到下一個標籤出現之前的所有文字」。這個機制本身是合理的設計，但 LLM 在生成逐字稿時，如果把 `[slowly]` 放在一段話的開頭、之後很久才用下一個標籤接手，那麼這整段（甚至整頁）逐字稿都會被當成「慢速」處理，朗讀起來自然不自然。

### 修復內容

不更動 `splitByToneMarkers()` 的程式邏輯，而是在負責生成/改寫逐字稿的四份提示詞檔案——`backend/prompts/generate-script-gemini.md`、`generate-script-gemini-solo.md`、`rewrite-script-gemini.md`、`rewrite-script-gemini-solo.md`（涵蓋單人/雙主持人、初次生成/逐字稿改寫四種組合）——的「語氣標籤規則」區塊，新增一條明確規則：告知 LLM `[slowly]` 會套用到下一個標籤出現前的所有文字，因此只能用在少數幾個關鍵字詞前後，加上後要盡快用下一個標籤（換回 `[seriously]` 或其他語氣）收尾，不可以讓它涵蓋一整段或大量句子。

### 技術重點

- 純提示詞文字調整，未變更任何程式邏輯、schema 或型別。
- 目前 OpenAI TTS 的提示詞（`generate-script-openai*.md`/`rewrite-script-openai.md`）並未使用這套語氣標籤機制，不受影響，只有 Gemini 的四份提示詞需要修正。
- 已執行 backend typecheck 確認無影響。

## AI 修圖／改逐字稿對話紀錄補上讀取權限檢查

### 功能目的

播放頁的「修圖/修逐字稿」AI 對話功能會把每一頁的問答歷史存在 `pages.chat_history_json`，讓使用者離開後再回來還能看到先前跟 AI 的對話過程。負責讀取這份歷史的 `GET /api/pdfs/:id/pages/:n/chat-history` 原本完全沒有檢查請求者是否有權限看這份簡報，只檢查頁面是否存在；同檔案緊接著的清除歷史端點（`DELETE`）卻已經正確檢查了編輯權限，證明這是讀取端點單獨被遺漏。任何人只要知道 PDF id 與頁碼，就能讀到別人簡報裡完整的 AI 對話內容，不需要任何額外的 token 或猜測值。

### 一個值得記錄的修正過程

這個檔案先前有一輪工作記錄明確寫過：「`GET /pages/:n/chat-history` 維持公開讀取，因為唯讀瀏覽者仍需要看到既有對話記錄」——這是刻意的設計決定，不是單純疏漏。但這個理由其實站不住腳：專案裡其他讀取端點慣用的 `canReadPdf()` 判斷規則（擁有者、`public`/`public_editable` 簡報、或持有效分享 token）本來就會放行「真正的唯讀瀏覽者」，「需要支援唯讀瀏覽者存取」並不等於「完全不檢查任何權限」——這兩件事被誤判成等價，才會讓端點整個對外公開。

### 修復內容

補上與專案其他讀取端點一致的本地 `canReadPdf()`/`getShareToken()`/`hasShareAccess()` helper，套用到 `GET /api/pdfs/:id/pages/:n/chat-history`。唯讀瀏覽者（`public`/`public_editable` 簡報的訪客、持有效分享連結的人）的存取行為完全不受影響，只有真正沒有任何讀取權限的請求會被擋下（`403 FORBIDDEN`）。

### 技術重點

- 新增 6 個測試覆蓋非擁有者/未登入對 private 簡報應得 403、不存在的 PDF id 應得 404、擁有者/`public`/分享 token 讀取應得 200。
- 已執行 backend typecheck（通過）；完整測試套件連跑兩次確認失敗清單皆為既有測試順序相關 flaky，與本次改動無關。

## 圖片／逐字稿版本歷史補上讀取權限檢查

### 功能目的

簡報每一頁的圖片與逐字稿都有版本歷史（透過底層 git 倉儲），讓使用者可以回顧並還原到先前的版本。負責這個功能的 `backend/src/routes/pdfs/versioning.ts` 裡，「還原到指定版本」的 POST 端點都正確檢查了編輯權限，但「列出歷史」與「讀取指定版本內容」的 4 個 GET 端點原本完全沒有檢查請求者是否有權限看這份簡報——只檢查頁面與版本是否存在。這代表任何人只要知道私有簡報的 id 與頁碼，就能直接讀到別人簡報每一頁逐字稿的完整修改歷史，以及歷史版本的投影片圖片內容。

### 修復內容

在 `versioning.ts` 補上與 `figures.ts`/`drawings.ts`/`page-animation.ts`/`quizzes.ts` 一致的本地 `canReadPdf()`、`getShareToken()`、`hasShareAccess()` helper，套用到四個讀取端點：

- `GET /api/pdfs/:id/pages/:n/image/history`（圖片版本歷史清單）
- `GET /api/pdfs/:id/pages/:n/script/history`（逐字稿版本歷史清單）
- `GET /api/pdfs/:id/pages/:n/script/versions/:hash`（指定版本的逐字稿內容）
- `GET /api/pdfs/:id/pages/:n/image/versions/:hash`（指定版本的投影片圖片）

判斷規則與既有的 `detail.ts`/`runs.ts` 相同：擁有者一律可讀；`public`/`public_editable` 簡報任何人可讀；私有簡報則需要帶有效的分享 token。不符合條件回傳 `403 FORBIDDEN`，PDF 不存在回傳 `404 PDF_NOT_FOUND`。

### 技術重點

- 擴充既有 `backend/test/versioning-permission.test.ts`，以參數化方式對四個路由各新增非擁有者/未登入應得 403、不存在的 PDF id 應得 404、擁有者/`public`/分享 token 讀取應能通過權限檢查共 29 個測試；成功路徑測試刻意清空 `image_path`/`script_path`，讓請求確定性地落在既有的 `PAGE_NOT_FOUND` 分支，避免需要真實的 git 版本歷史 fixture。
- 已執行 backend typecheck（通過）；完整測試套件連跑三次確認失敗清單皆為既有測試順序相關 flaky（與 uploads/page-operations/regenerate 有關），與本次改動無關。

## 修正提交提示詞時偶發的「已經被加進」錯誤

### 功能目的

使用者回報：在 PDF 匯入後按下「開始生成」（提交風格提示詞）時，偶爾會跳出錯誤，但實際上簡報已經開始處理或已經完成了。

### 根因

`POST /api/pdfs/:id/start` 在 PDF 狀態已經不是 `awaiting_prompt`/`uploaded`/`failed`（代表已經在處理中或已完成）時，會回傳 `409 INVALID_STATE`，訊息是「PDF {id} 已經在處理或已完成 (status=...)，無法重新提交提示詞」。當第一次提交因為網路不穩、逾時等原因，前端沒有收到成功回應（但伺服器其實已經受理並開始處理），使用者或瀏覽器重試送出同一份提示詞時，就會打到這個檢查，跳出這個令人困惑的錯誤——而簡報其實已經在處理或已完成，不需要也不應該被當作失敗處理。

### 修復內容

在 `frontend/src/lib/api/common.ts` 新增 `isAlreadyProcessingConflict(err)`（與既有的 `isCreditExhaustedError()` 同風格），辨識「409 + `INVALID_STATE`」這個特定衝突。`frontend/src/pages/HomePage.tsx` 的 `handlePromptSubmit()` 改為對 `startProcessing()` 包一層 `try/catch`：遇到此衝突時視為良性的無操作——關閉提示詞視窗、重新整理列表、顯示新的「此簡報已經在處理或已完成，不需要再次提交」提示，而不是讓使用者卡在一個其實已經成功過的提交上、反覆重試。

### 技術重點

- 新增中英文 `home.alreadyProcessing` 翻譯鍵。
- 新增 `frontend/src/lib/api/common.test.ts`，覆蓋 `isAlreadyProcessingConflict()` 對「正確的 409+INVALID_STATE」「同錯誤碼但狀態碼不同」「同狀態碼但錯誤碼不同」「非 `ApiError` 輸入」四種情境的判斷。
- 已執行 frontend typecheck（通過）與完整前端測試（194 個全數通過）。

## 舊 PNG 轉 JPG 啟動遷移訊息改用 logger

### 功能目的

後端啟動時會嘗試把舊版儲存格式中的 PNG 封面與頁面圖轉成 JPG，降低檔案大小並配合目前圖片路徑格式。完成轉換後的摘要訊息屬於一般服務資訊 log，應與其他後端訊息一樣走統一 logger，而不是直接使用 `console.info`。

### 使用方式

此變更不影響使用者操作。系統啟動時若有舊 PNG 被轉換，後端日誌會以標準 logger 格式記錄轉換的 cover/page 數量；沒有轉換時仍不輸出額外訊息。

### 技術重點

- `imageMigration.ts` 匯入既有 `logger`，將完成訊息改為 structured `logger.info({ convertedCover, convertedPages }, ...)`。
- 保留逐檔轉換錯誤忽略、資料庫 `image_path` 更新與啟動遷移流程不變。
- 移除 no-console 註解，並以 backend typecheck 與 grep 驗證沒有殘留直接 `console.info`。

## GSAP 動畫 timeline 建立失敗改為 gated debug

### 功能目的

投影片動畫使用 GSAP 建立播放 timeline。若某個動畫設定造成 timeline 建立失敗，播放頁會自動清理並 fallback 成靜態圖片，避免投影片無法顯示。這類錯誤已有 fallback 與上層錯誤處理，對一般使用者不需要無條件輸出到 console；現在改為 gated debug warning，保留開發者除錯能力並讓一般播放 console 更乾淨。

### 使用方式

一般使用者不需任何操作。動畫 timeline 建立失敗時，投影片仍會 fallback 成靜態圖片。開發者若要追蹤詳細錯誤，可在瀏覽器設定 `localStorage.setItem('makeslide.debug', '1')` 後重現問題，即可看到 debug warning。

### 技術重點

- `useGsapSlideTimeline.ts` 使用既有 `debugWarn()` 取代直接 `console.error`。
- 保留既有 timeline 清理、`animationFailed` 狀態、`onError` callback 與靜態圖片 fallback 流程。
- 移除不再需要的 no-console eslint 註解，並以 typecheck 與 grep 驗證沒有殘留直接 `console.error`。

## 重生任務背景恢復警告改為 gated debug

### 功能目的

播放頁載入時會嘗試恢復既有的批次重生任務狀態。若沒有任務，後端回傳 404 會被忽略；若遇到其他背景恢復錯誤，使用者仍可繼續操作頁面並手動啟動或查看重生流程。這類背景診斷不應在一般使用者 console 中無條件輸出，因此改為 gated debug warning。

### 使用方式

一般使用者不需要任何設定；載入播放頁時若背景恢復重生任務狀態失敗，console 不會再出現 warning，頁面操作維持不變。開發者若需要追蹤此流程，可設定 `localStorage.setItem('makeslide.debug', '1')` 後重新載入頁面查看 debug warning。

### 技術重點

- `useRegeneration.ts` 匯入既有 `debugWarn()` helper，取代直接 `console.warn`。
- 404 無任務情境仍維持忽略；非 404 錯誤只在 debug 開啟時輸出。
- 移除該處 `eslint-disable-next-line no-console`，並以 typecheck 與 grep 驗證沒有殘留直接 console warning。

## 播放頁同步與 TTS 偵錯輸出改為 gated debug

### 功能目的

播放頁在同步輪詢、同步狀態推送、TTS 重生與音訊載入重試期間會產生大量內部診斷訊息。這些訊息對開發除錯有幫助，但一般使用者播放、上課或重生語音時不應在瀏覽器 console 看到大量 `[sync]` / `[tts]` log。現在這些診斷訊息統一改走既有 gated debug helper，只有開發者明確開啟 `localStorage.makeslide.debug = '1'` 時才輸出。

### 使用方式

一般使用者不需要做任何設定，播放頁同步、投票同步、TTS 重生與音訊載入重試仍維持原本行為，但 console 會保持乾淨。若開發者需要追蹤同步或 TTS 流程，可在瀏覽器 console 執行 `localStorage.setItem('makeslide.debug', '1')` 後重新操作，即可看到相關診斷訊息；除錯完成後移除此設定即可關閉。

### 技術重點

- `PlayPage.tsx` 中 `[sync][master->state]`、`[sync][poll]`、`[sync][follower]` 診斷輸出改用 `debugLog()`。
- TTS 重生、音訊驗證與 audio element 自動重試/載入失敗診斷改用 `debugLog()` / `debugWarn()`。
- TTS 驗證失敗、重生失敗與音訊載入失敗原本已有 UI 錯誤提示或自動重試流程，因此不再無條件呼叫 `console.error`。
- frontend typecheck 通過，並以 grep 確認 `PlayPage.tsx` 不再有直接 `console.info/warn/error`。

## 系統設定 SLA override 前端範圍驗證

### 功能目的

管理員可在系統設定中調整 pipeline 各階段的 SLA override 秒數。後端本來已限制可接受範圍，但前端過去只檢查輸入是否為數字，超出範圍時必須等送出後由後端回傳錯誤，訊息也較偏技術性。現在前端會使用後端回傳的 bounds 先行驗證，讓管理員在送出前就看到清楚的可接受秒數範圍。

### 使用方式

在系統設定的 Pipeline SLA 設定中輸入 override 秒數時，若數值低於最小值或高於最大值，畫面會直接顯示範圍錯誤並阻止送出；輸入空白仍代表清除該 override。合法範圍內的數值會照常送出並由後端保存。

### 技術重點

- `SettingsPage.tsx` 在 `onSlaOverrideApply()` 中使用 `slaSettings.bounds.min_ms/max_ms` 對秒數輸入換算後的毫秒值做前端驗證。
- 新增 `slaOverrideValidation.ts` 純函式，集中處理空白、有限數字、bounds 範圍與錯誤訊息格式，方便測試與重用。
- 新增 `settings.slaOutOfRange` 中英文 i18n，錯誤訊息會顯示可接受秒數範圍。
- 新增 helper 測試並執行 frontend typecheck 與 i18n/API SLA 相關測試，確認沒有新增回歸。

## 移除全螢幕 `a` 鍵新增效果快捷鍵

### 功能目的

全螢幕播放已新增右側動畫編輯器，可直接用明確的「動畫」按鈕新增與調整效果；原本按下 `a` 鍵自動插入 `pause-playback` 效果的隱藏快捷鍵容易和課堂同步模式的 `a` 鍵 AI 回答功能混淆，也不利於使用者理解目前操作。移除此快捷鍵後，新增動畫效果統一改由可見的動畫編輯器操作，降低誤觸風險。

### 使用方式

全螢幕播放時不再使用 `a` 鍵新增 pause-playback 效果。若要新增暫停播放或其他動畫效果，請點擊右上角「動畫」按鈕開啟全螢幕動畫編輯器，再用新增效果按鈕加入。非全螢幕同步 master 模式下，`a` 鍵仍保留原本的 AI 回答追隨者問題功能；空白鍵播放/下一頁、方向鍵翻頁、`p` 投票控制、`w` 手寫與 Escape 離開/關閉等既有快捷鍵維持不變。

### 技術重點

- `PlayPage.tsx` 移除 `insertPausePlaybackEffectRef`、`generateInsertedPauseEffectId()` 與全螢幕 `a` 鍵插入 `pause-playback` 的鍵盤事件分支。
- 移除不再需要的 `DEFAULT_PAUSE_PLAYBACK_TEXT`、`defaultAnimationSpec()`、`insertEffectAfterFirstStartingEffect()` import，避免殘留死碼。
- grep 驗證已無 `insertPausePlaybackEffectRef` / `generateInsertedPauseEffectId`；frontend typecheck 與動畫 spec 測試皆通過。

## 全螢幕動畫編輯器與目前播放效果後插入

### 功能目的

播放全螢幕簡報時，講者若想在現場補上暫停、指標、標註或其他動畫效果，過去需要離開全螢幕回到播放頁側欄操作，容易打斷簡報流程。現在全螢幕右上方新增「動畫」按鈕，可直接在全螢幕右側開啟動畫編輯面板；同時新增效果不再一律加到清單末端，而是插入目前播放效果之後，讓現場補上的效果更貼近正在講解的時間點。

### 使用方式

進入播放頁全螢幕後，點擊右上角「動畫」按鈕即可展開右側動畫編輯面板。面板提供新增效果按鈕與目前頁面的效果列表/設定區，可直接新增並調整效果；再次按下按鈕可收合面板。一般播放頁的動畫編輯頁仍保留原本完整工具列、預覽與儲存操作，全螢幕模式則聚焦於快速新增與調整效果。

### 技術重點

- `AnimationEditorTab.tsx` 新增一般模式與全螢幕模式，將新增效果按鈕區與效果列表/設定區拆成可共用結構，避免未來新增效果時需要維護兩套 UI。
- `PlayPageFullscreen.tsx` 接入全螢幕動畫面板，並沿用既有動畫儲存與目前播放時間狀態。
- `animationSpec.ts` 新增 `insertEffectAfterPlaybackEffect()`，依目前播放時間找出播放中的效果並插入其後；若沒有命中效果則維持追加到最後的 fallback 行為。
- 新增 helper 測試覆蓋命中播放效果、無命中 fallback 與解析後起始時間等情境；frontend typecheck 與動畫 spec 測試皆通過。

## 分離 OpenAI、CGU Air 與 OpenRouter AI 供應商設定

### 功能目的

過去系統以 OpenAI-compatible endpoint 共用同一組 OpenAI 設定來連接 OpenAI 或 CGU Air，管理者需要用同一個 API key/base URL 欄位切換不同供應商。這種做法容易讓 OpenAI 與校內 CGU Air 的金鑰互相覆蓋，也無法在模型選擇時清楚指定 OpenRouter。現在 AI 設定頁可直接選擇 OpenAI、CGU Air、OpenRouter 或 Gemini，並針對每個 OpenAI-compatible 供應商保存各自的 key、base URL 與 LLM model。

### 使用方式

管理者進入系統設定的 AI 設定區後，可在 LLM provider 下拉選單選擇 OpenAI、CGU Air、OpenRouter 或 Gemini。選擇 OpenAI、CGU Air 或 OpenRouter 時，頁面會顯示該供應商自己的 API key、base URL 與模型欄位；輸入後按下儲存即可。之後產生大綱、逐字稿、圖片提示詞或其他 LLM 流程會依目前 provider 自動使用對應金鑰與 endpoint，不需要再手動覆寫 OpenAI base URL 來切換 CGU Air。

### 技術重點

- `backend/src/services/aiSettings.ts` 新增 `llm_provider` 與 CGU Air/OpenRouter 專屬設定欄位，並保留舊設定相容邏輯：若既有 `OPENAI_BASE_URL` 是 CGU Air 預設網址，會自動遷移成 CGU Air provider 設定。
- `backend/src/services/openai.ts` 依目前 provider 建立 OpenAI-compatible client；OpenAI、CGU Air、OpenRouter 各自讀取自己的 API key/base URL/model，Gemini 維持原路徑。
- `frontend/src/pages/SettingsPage.tsx` 與 `frontend/src/lib/api/system.ts` 同步新增 provider 型別與設定欄位，AI 設定頁會依 provider 顯示對應表單。
- 新增後端測試覆蓋 OpenAI/CGU Air/OpenRouter 設定分離保存、has-key 狀態與不合法 provider 驗證；backend/frontend typecheck 與指定測試皆通過。

## 自訂腳本動畫安全防護補上單元測試

### 功能目的

播放頁的「自訂腳本動畫」效果允許使用者用自然語言描述，由 LLM 產生一段 JavaScript 程式碼，注入到 sandboxed `<iframe>` 中執行。瀏覽器層級的 sandbox（沒有 `allow-same-origin`）已經能擋掉大部分跨來源風險，但 `backend/src/services/animationCustomScript.ts` 另外做了一層「縱深防禦」：在程式碼被儲存或渲染前，先用 `findUnsafeScriptPattern()` 掃描是否出現 `fetch`/`eval`/`localStorage`/`document.cookie`/`window.parent` 等危險 API，並用 `findCustomScriptContractIssue()` 確認程式碼有定義 `window.renderAnimation` 並呼叫 `api.onFrame()`，否則直接拒絕。這兩個函式是整個自訂腳本動畫功能最後一道防線，過去完全沒有測試覆蓋。

### 修復內容

新增 `backend/test/animation-custom-script.test.ts`，把 `UNSAFE_PATTERNS` 陣列中每一種模式都個別驗證一次，包含同一個 API 的多種變形寫法（例如 `window.parent`/`window["parent"]`/`globalThis['parent']`、`document.cookie`/`document["cookie"]`）與大小寫不敏感；也驗證多個危險模式同時出現時，回傳的是第一個命中的標籤，以及完全合法的程式碼會回傳 `null`。合約檢查則覆蓋合法程式碼、`window["renderAnimation"]` 的 bracket 寫法、缺少 `renderAnimation` 定義、缺少 `api.onFrame()` 呼叫，以及兩者都缺時優先回報哪一個錯誤訊息。

### 技術重點

- 未修改 `animationCustomScript.ts` 任何邏輯，純粹補測試，降低未來修改 `UNSAFE_PATTERNS` 或合約檢查時不小心破壞既有防護的風險。
- 已執行 backend typecheck（通過）與完整 `npm --workspace backend test`（429 個測試，18 個失敗皆為既有環境性基準，無新增回歸；新增 8 個測試全數通過）。

## 全螢幕暫停播放效果快捷鍵修正

### 功能目的

播放頁的 `pause-playback` 效果可讓講者在指定時間點顯示提示並自動暫停播放。先前為了避免誤觸，設計成全螢幕先按 `a` 再按 `p` 才插入效果；但 `p` 同時也是 master 全螢幕投票控制快捷鍵，導致投票與暫停效果操作互相干擾，也讓使用者在全螢幕按下 `a` 時看起來沒有任何反應。

新版將全螢幕 `a` 鍵改為直接新增目前播放時間的暫停播放效果，不再需要後續 `p`。`p` 在 master 全螢幕模式則專心負責投票控制開關，避免兩個功能共用同一段按鍵序列。

### 使用方式與影響

1. 全螢幕播放時，按下 `a` 會立即在目前播放時間插入「暫停：請按播放鍵繼續」效果。
2. 不需要再按 `a` + `p`；舊序列已移除，避免與投票控制衝突。
3. 非全螢幕且 master 同步模式下，`a` 仍維持原本的 AI 回答 follower 問題快捷鍵。
4. 全螢幕 master 模式下，`p` 仍用來開啟或關閉投票控制，不會再插入暫停播放效果。

### 技術細節

- `frontend/src/pages/PlayPage.tsx` 的鍵盤快捷鍵邏輯在偵測到全螢幕 `a` 時，直接呼叫 `insertPausePlaybackEffectRef.current()`。
- 移除 `fullscreenEffectSequenceActiveRef` 與 2.5 秒序列等待邏輯，讓插入暫停效果不再依賴第二個按鍵。
- `p` 鍵分支簡化為只在全螢幕 master 模式切換投票控制，保留投票快捷鍵既有行為。
- `insertPausePlaybackEffectRef` 本身仍使用目前 `currentTime` 建立 `pause-playback` effect，並沿用既有的讀寫狀態、動畫 busy、頁面存在與最多 20 個效果上限檢查。
- 驗證結果：`npm --workspace frontend run typecheck` 通過。



## 私有簡報圖表、畫板與動畫讀取權限修復

### 功能目的

MakeSlide 的播放頁會讀取多種衍生素材：圖表素材清單與圖檔、手寫畫板 JSON、以及每頁動畫設定。這些素材雖然不是原始 PDF 本身，仍可能包含簡報內容、講者註記、教學重點與自訂動畫腳本。過去部分 GET 端點只確認 PDF/page/figure 是否存在，沒有套用簡報讀取權限，知道 PDF id 與頁碼的人可能讀到 private 簡報的衍生素材。

新版補齊 `figures.ts`、`drawings.ts`、`page-animation.ts` 的讀取權限檢查，讓這些素材與簡報詳情、執行歷程、慢素材排行採用相同規則：擁有者可讀、public/public_editable 可讀、有效分享 token 可讀，其他讀取 private 簡報的請求會回傳 403。

### 使用方式與影響

1. 使用者不需要改變操作方式；播放頁、圖表素材瀏覽、畫板與動畫編輯在有權限時維持原有行為。
2. private 簡報的圖表清單、圖表圖片、畫板資料、動畫摘要、動畫 spec 與 custom-script GET 診斷端點都不再對非擁有者開放。
3. 分享連結仍可正常讀取上述素材；端點接受既有的 `?share=<token>` 或 `x-makeslide-share-token` header。
4. 寫入路由沒有放寬：圖表選取、畫板儲存/刪除、動畫儲存與 AI 產生相關 POST/PUT/DELETE 仍沿用既有 `canEditPdf()`，read-only 分享不會因此取得編輯權。

### 技術細節

- `backend/src/routes/pdfs/figures.ts` 新增本地 `canReadPdf()`、`getShareToken()`、`hasShareAccess()`，並讓 `GET /api/pdfs/:id/pages/:n/figures` 先檢查 PDF 與 page 存在後再做讀取授權；`GET /api/pdfs/:id/figures/:figureId/image` 也會先確認 PDF 與 figure manifest entry 存在，再檢查權限與檔案是否存在。
- `backend/src/routes/pdfs/drawings.ts` 的 `GET /api/pdfs/:id/pages/:n/drawing` 現在會先確認 PDF 與 page 存在；有讀取權但尚未建立畫板時仍回 `{ drawing_json: null }`，維持前端既有空畫板體驗。
- `backend/src/routes/pdfs/page-animation.ts` 的 `GET /animation`、`GET /animation/spec` 與 `GET /animation/custom-script` 均補上 PDF/page 存在檢查與讀取授權；custom-script GET 在授權成功後仍回 405 diagnostic，提醒實際產生必須使用 POST。
- 新增/調整後端測試覆蓋 figures、drawings、page-animation 三組路由的 private 非擁有者 403、擁有者可讀與分享 token 可讀情境。
- 驗證結果：`npm run typecheck --workspace backend` 通過；直接執行 `./scripts/with-node-env.sh ./node_modules/.bin/tsx --test backend/test/figure-assets.test.ts backend/test/drawings.test.ts backend/test/page-animation.test.ts` 時本次新增/相關權限測試通過，但同檔既有 `validateAnimationSpec rejects a shape effect with an invalid shape kind` 目前失敗（實際接受 invalid shape kind），與本次讀取權限修復無關。



## 播放頁暫停播放效果

### 功能目的

簡報播放時，講者常需要在某個時間點停下來補充說明、回答問題，或讓觀眾消化重點。過去播放頁的動畫效果多半是視覺提示：淡入、縮放、重點框、文字 callout、公式或自訂動畫；它們不會改變播放流程。新版新增 `pause-playback` 效果，讓效果本身成為「流程控制提示」：畫面顯示一段文字，同時自動暫停目前影片/音訊播放，直到使用者按播放鍵才繼續。

### 使用方式

1. 在播放頁動畫分頁可從「套用範本」選擇「暫停播放提示」，效果會顯示預設文字「暫停：請按播放鍵繼續」，可再編輯提示文字、開始時間與位置大小。
2. 播放到該效果的開始時間時，系統會顯示提示 overlay 並暫停目前播放；再次按播放鍵後，播放會從暫停位置繼續。
3. 全螢幕播放時可用快捷鍵插入：先按 `a` 進入插入效果序列，再按 `p` 插入暫停播放效果。
4. 快捷鍵插入的效果會放在動畫效果清單中「第一個開始的效果」後方，讓它符合既有動畫清單的疊層與編輯模型；若沒有開始效果，則插入到清單最前面。
5. `p` 原本在全螢幕 master 模式可開啟投票控制；只有在剛按過 `a` 的插入序列中，`p` 才會改為插入暫停效果。

### 技術重點

- 前端型別與常數新增 `pause-playback`：`frontend/src/types.ts` 的 `SlideAnimationEffectType`、`frontend/src/lib/animationSpec.ts` 的 `SLIDE_ANIMATION_EFFECT_TYPES` / `OVERLAY_EFFECT_TYPES` 都納入新效果。
- 後端 schema 同步更新：`backend/src/services/pageAnimation.ts` 的 `ANIMATION_EFFECT_TYPES`、`EffectSchema` 與 `ALLOWED_PARAM_KEYS` 接受 `pause-playback`，並沿用 `text` 與 overlay position params 驗證。
- `frontend/src/components/slide/SlideRenderer.tsx` 新增暫停提示 overlay，使用深色半透明卡片、cyan 邊框與可換行文字；`frontend/src/components/slide/buildGsapTimeline.ts` 讓它以淡入/縮放方式出現。
- `frontend/src/pages/PlayPage.tsx` 以 `getDuePausePlaybackEffect()` 偵測播放時間是否跨過尚未消費的暫停效果起點，命中時呼叫 `audio.pause()`；每頁會重設已消費效果集合，避免同一效果在同頁重複觸發。
- `frontend/src/pages/play/AnimationEditorTab.tsx` 新增範本與文字編輯欄位，插入邏輯使用 `insertEffectAfterFirstStartingEffect()` 將暫停效果放在第一個開始效果之後。
- 已補前端純函式測試：確認 `pause-playback` 屬於 overlay effect、播放時間跨過起點時會找出待觸發效果、以及插入位置符合第一個開始效果後方。
- 已補後端 schema 測試：確認 `pause-playback` 可保存提示文字與 overlay params，未知 params 會被濾除。
- 驗證結果：`node --test --import tsx frontend/src/lib/animationSpec.test.ts` 通過（43 tests），`npm run typecheck` 通過。後端單檔測試在目前環境因 `better-sqlite3` native module 與 Node.js v26 ABI 不相容而無法啟動，錯誤為 `NODE_MODULE_VERSION 127` vs `147`。

## 播放頁動畫與圖片改為同頁就緒後才顯示

### 功能目的

播放頁的動畫效果可以透過 `startTrigger` 綁定逐字稿句子，讓提示框、重點清單、圖形或自訂動畫跟著旁白句子出現。換頁時，`PlayPage.tsx` 會先切到新頁資料，但音檔 metadata 與圖片載入是非同步完成；在這個短暫空窗中，頁面可能同時存在「新頁逐字稿」、「上一頁 duration」或「上一頁圖片」。

先前已阻擋 `sentenceTimeline` 空陣列時建立逐字稿動畫，但使用者仍回報在不同頁來回切換、特別是全螢幕時偶發黑框。根因是第一個 render 仍可能用「新頁逐字稿 + 上一頁 duration」算出非空時間軸，或用上一頁 `displayedImageSrc` 搭配新頁動畫 overlay。全螢幕偏向載入高解析原圖，比一般播放面板的縮圖更慢，因此錯配視窗更容易被看見。

新版把播放頁圖片、音訊 duration 與動畫 spec 都綁定到目前頁：新頁圖片尚未準備好時，不再保留上一頁圖片給 renderer 使用；含 `startTrigger` 的動畫也必須等目前頁 audio metadata 載入、duration 確認屬於目前頁，並建立目前頁逐字稿時間軸後才解析。

### 使用方式與效果

1. 使用者不需要調整操作方式；正常進入播放頁、快速切換頁面或進入全螢幕即可套用新防護。
2. 新頁圖片尚未載入完成時，播放面板與全螢幕不再把上一頁圖片拿來搭配新頁動畫 overlay，避免短暫黑框或錯頁疊層。
3. 依逐字稿句子觸發的動畫會等待目前頁音檔 metadata 與目前頁 sentence timeline 就緒後才建立，避免使用上一頁 duration 產生錯誤時序。
4. 沒有使用 `startTrigger`、只使用固定秒數 `start` 的動畫不需要等待音檔 metadata，但仍會等目前頁圖片就緒，確保動畫與底圖同頁。
5. 此修復只調整播放頁資產就緒與 spec 解析條件，不改 GSAP 渲染邏輯，也未修改 `buildGsapTimeline.ts`。

### 技術細節

- `frontend/src/pages/PlayPage.tsx` 新增 `LoadedSlideImageState`，以 `{ pageNumber, src }` 記錄已載入圖片；`displayedImageSrc` 改為 derived value，只有 `pageNumber` 與 `src` 同時符合目前頁的 `targetImageSrc` 時才回傳，否則為 `null`。
- `PlayPage.tsx` 新增 `durationPageNumber`，`onLoadedMetadata` 只在 metadata 事件抵達時把 duration 與當下頁碼一起記錄；換頁時會將 `duration` 重設為 0 並清空 `durationPageNumber`。
- `sentenceTimeline` 改用 `sentenceTimelineDuration` 建立：只有 `durationPageNumber === currentPage.page_number` 且 duration 有效時才使用真實 duration，避免新頁逐字稿與上一頁 duration 組合出錯頁時間軸。
- `frontend/src/pages/play/playbackReadiness.ts` 新增可測 helper `shouldResolvePageAnimationSpec()`，統一判斷：圖片必須屬於目前頁；含 `startTrigger` 的動畫還必須等目前頁 audio metadata 與非空 sentence timeline 就緒。
- `currentAnimationSpec` 只有在 `shouldResolvePageAnimationSpec()` 回傳 true 時才呼叫 `resolveAnimationSpec()`；等待期間維持 `null`，讓 `SlideRenderer` / `useGsapSlideTimeline` 不建立錯頁動畫 timeline。
- `frontend/src/pages/play/playbackReadiness.test.ts` 覆蓋 transcript-triggered animation 等待目前頁 audio metadata、圖片未就緒時阻擋所有動畫、以及無 `startTrigger` 動畫不需等待音檔 metadata 的情境。
- 已執行 `npm --workspace frontend run typecheck`，以及 `node --import tsx --test frontend/src/pages/play/playbackReadiness.test.ts frontend/src/lib/animationSpec.test.ts frontend/src/lib/subtitles.test.ts`，共 59 個測試通過。

## 大綱對話訊息支援 128K 長內容

### 功能目的

「新增多頁」與提示詞大綱流程中的 AI 對話端點 `POST /api/prompt-chat` 會接收多輪 `messages[].content`，讓使用者把既有大綱、長篇素材或前一輪整理結果交給助理延續。雖然單次提示詞轉大綱 `POST /api/prompt-text` 已放寬到 128K（131072 字），但對話訊息 schema 仍保留舊的 4000 字上限，造成多輪大綱對話在貼上長素材時仍被 400 擋下。

新版把 `POST /api/prompt-chat` 的每則對話內容上限對齊同一個 128K 契約。使用者可在 AI 大綱對話中貼上超過 4000 字但未超過 131072 字的長篇需求；若單則訊息超過 128K，後端仍會回傳清楚的 400 驗證錯誤，避免過大請求進入 LLM 流程。

### 使用方式與影響

1. 在支援 AI 大綱對話的流程中輸入或貼上長篇課程素材、會議紀錄、研究摘要或既有大綱。
2. 單則對話訊息現在可超過 4000 字，最多接受 131072 字，與 `POST /api/prompt-text` 的提示詞上限一致。
3. 若單則 `messages[].content` 超過 131072 字，後端會回傳 400 `INVALID_REQUEST`，訊息包含 `message content 不可超過 131072 字`。
4. 此修改只放寬大綱對話輸入驗證，不改 `assistant_message`、`outline_text` 的 LLM 回應 schema，也不改其他頁面聊天或圖片重生 prompt 的限制。

### 技術細節

- `backend/src/routes/pdfs/upload.ts` 的 `PromptChatBodySchema.messages[].content` 改用既有 `MAX_PROMPT_TO_OUTLINE_CHARS = 128 * 1024`，移除殘留的 `.max(4000)`。
- `messages[].content` 的 `.max()` 補上明確錯誤訊息 `message content 不可超過 131072 字`，`.min()` 也補上 `message content 至少需要 1 個字`，讓 API 驗證錯誤更可讀。
- `backend/test/prompt-text-limit.test.ts` 新增 `POST /api/prompt-chat` 測試：5000+ 字訊息會通過並呼叫 OpenAI stub 回傳大綱；128K+1 字訊息會在 schema 驗證階段回 400 `INVALID_REQUEST`。
- 後端測試沿用 `MAX_PROMPT_TO_OUTLINE_CHARS` 匯出常數，避免測試與實作各自寫死 131072。

## 分享複製狀態訊息 i18n 補齊

### 功能目的

播放頁的分享對話框已能透過 `ShareDialog.tsx` 顯示中英文標題、說明、複製按鈕與 fallback 失敗提示，但外層 `PlayPageDialogs.tsx` 在處理複製 callback 時仍直接寫死兩段繁體中文狀態訊息：成功時的「已複製分享連結」與瀏覽器阻擋自動複製時的「瀏覽器不允許自動複製，請手動複製。」。這會讓英文介面在分享連結複製完成或失敗時仍混入中文 toast/message。

新版將這兩段 callback 狀態訊息改成 `play.shareDialog.copySuccessMessage` 與 `play.shareDialog.copyErrorMessage` 翻譯鍵，讓分享對話框內部 UI 與外層狀態訊息都跟隨使用者目前的介面語言。此修改只替換文字來源，不改變分享對話框開關、Clipboard fallback、複製成功/失敗 callback、訊息顯示或錯誤清除行為。

### 使用方式與影響

1. 使用者建立分享連結並按「複製連結」後，若複製成功，播放頁狀態訊息會依目前介面語言顯示「已複製分享連結」或 `Share link copied`。
2. 若瀏覽器權限、安全來源或 Clipboard API 限制造成自動複製失敗，原本的手動複製流程維持不變；錯誤訊息會依語言顯示對應文案。
3. `ShareDialog.tsx` 內的複製按鈕狀態、`copyTextToClipboard()` fallback 與可手動選取的 URL textarea 都維持既有行為。
4. 成功 callback 仍會清除分享錯誤，失敗 callback 仍只設定分享錯誤，不額外改動對話框開關或分享 URL 狀態。

### 技術細節

- `frontend/src/pages/play/PlayPageDialogs.tsx` 引入 `useI18n()`，在 `onCopySuccess` / `onCopyError` callback 中以 `t('play.shareDialog.copySuccessMessage')` 與 `t('play.shareDialog.copyErrorMessage')` 取代硬編碼中文。
- `frontend/src/locales/zh-TW.ts` 與 `frontend/src/locales/en.ts` 新增兩個專用翻譯鍵，避免沿用 `ShareDialog.tsx` 內部按鈕狀態 `copied` 或內嵌錯誤提示 `copyFailed` 時語意不精準。
- `frontend/src/i18n.test.ts` 的 `ShareDialog locale keys are complete` 測試納入新增鍵，確保繁體中文與英文文案都存在且非空。
- 本輪聚焦 `PlayPageDialogs.tsx` 的分享複製成功/失敗訊息，未擴大修改 `PlayPage.tsx` 或其他播放頁大型檔案。

## 播放頁側欄投票與 QA 面板 i18n 補齊

### 功能目的

播放頁右側欄包含 Realtime Poll 與本頁問答兩個高度互動區塊：老師可建立本頁投票、開始/結束投票、控制全螢幕顯示題目與結果；使用者也可在本頁問答區輸入問題、貼上參考圖、圈選圖片區域並要求修改圖片或逐字稿。過去 `PlayPageSidebar.tsx` 雖然已使用 `useI18n()`，但這兩個區塊仍有大量使用者可見中文硬編碼，英文介面在操作投票與 QA 時會混用中文。

新版將投票控制與 QA 面板文案改為 `play.sidebar.poll.*` 與 `play.sidebar.qa.*` 翻譯鍵，讓繁體中文與英文介面都能完整顯示對應語言。此修改只替換文字來源，不改投票、同步顯示、問答、貼圖、選區、圖片修改或逐字稿修改的既有行為。

### 使用方式與影響

1. 在「設定」頁切換界面文字語言後，播放頁側欄的 Realtime Poll 狀態、設定按鈕、開始/結束、顯示/隱藏結果、投票建立表單與投票題操作會跟隨語言切換。
2. 本頁問答區的標題、放大/還原、清除全部訊息、空對話提示、角色 label、圖片預覽與參考圖文字，以及修改圖片/逐字稿/詢問按鈕也會跟隨語言切換。
3. 動態文字使用 `{page}` / `{count}` 佔位符，例如「第 N 頁投票中」與「N 票」，避免在元件內用字串拼接固定中文語序。
4. QA textarea 在處理中唯讀模式與一般模式使用不同 placeholder，仍維持原本唯讀停用與送出行為。

### 技術細節

- `frontend/src/pages/play/PlayPageSidebar.tsx` 新增本地 `formatMessage()`，統一處理簡單 placeholder 替換。
- Realtime Poll 區塊新增並使用 `play.sidebar.poll.*` 翻譯鍵，涵蓋狀態列、控制按鈕、表單 placeholder、空狀態、票數與題目操作按鈕。
- QA 區塊新增並使用 `play.sidebar.qa.*` 翻譯鍵，涵蓋標題、面板展開、清除、空對話、角色、圖片 alt/title、參考圖、選區狀態、textarea placeholder 與動作按鈕。
- `frontend/src/locales/zh-TW.ts` 與 `frontend/src/locales/en.ts` 新增 45 個中英文翻譯鍵，並維持兩份 locale 字典 key 完全對齊。
- `frontend/src/i18n.test.ts` 新增 `PlayPageSidebar poll and QA locale keys are complete` 測試，確認新增中英文鍵皆存在且非空。
- 已執行 frontend typecheck 與 i18n 測試，並用 grep 確認 `PlayPageSidebar.tsx` 剩餘中文僅為程式註解。

## 圖片預覽對話框 i18n 補齊

### 功能目的

播放頁在重新生成單頁圖片後，會開啟圖片預覽對話框讓使用者確認結果，再決定關閉或套用並取代原圖。過去這個對話框的標題、圖片替代文字與兩個操作按鈕仍直接寫死繁體中文，導致介面語言切到英文時，圖片預覽流程仍混用中文。

新版將 `ImagePreviewDialog.tsx` 改為使用 `useI18n()` 取得翻譯文字，並新增 `play.imagePreviewDialog.*` 中英文鍵。這次只替換使用者可見文字來源，不改變預覽圖片、關閉對話框、唯讀/處理中停用套用按鈕，或套用取代原圖的既有行為。

### 使用方式與影響

1. 使用者操作方式維持不變：重新生成圖片後仍會看到預覽對話框，可按「關閉預覽」放棄，或按「套用取代原圖」套用結果。
2. 當界面文字語言為繁體中文時，對話框顯示原本的中文文案。
3. 當界面文字語言為英文時，標題、圖片 alt、關閉與套用按鈕會改顯示英文。
4. 圖片預覽與按鈕事件仍沿用原 props：`imagePreviewUrl` 控制預覽來源、`onClose` 關閉、`onApply` 套用，`isReadOnlyProcessing` 仍只影響套用按鈕停用狀態。

### 技術細節

- `frontend/src/pages/play/ImagePreviewDialog.tsx` 新增 `useI18n()`，用 `t('play.imagePreviewDialog.title')`、`t('play.imagePreviewDialog.imageAlt')`、`t('play.imagePreviewDialog.close')`、`t('play.imagePreviewDialog.applyReplace')` 取代原本四處硬編碼中文。
- `frontend/src/locales/zh-TW.ts` 與 `frontend/src/locales/en.ts` 新增相同翻譯鍵，維持 `TranslationKey` 由繁中 locale 推導的型別檢查模式。
- `frontend/src/i18n.test.ts` 新增 `ImagePreviewDialog locale keys are complete` 測試，確認四個鍵在中英文 locale 中皆存在且非空字串。
- 已執行 frontend typecheck 與 i18n 測試，確保新增鍵不破壞既有字典 key 對齊與 TypeScript 型別。

## 講義 PDF 純函式單元測試補強

### 功能目的

講義 PDF 產生流程會把每頁截圖與逐字稿組成可下載的 PDF，其中有一組純文字處理 helper 負責 PDF 字串轉義、逐字稿清理、逐行換行，以及把中英文文字轉成 PDF 內嵌 CJK 字型可使用的 UTF-16BE hex。這些 helper 雖然不依賴圖片或外部服務，卻直接影響講義中的標題、逐字稿內容與中文顯示；若日後調整時不小心改壞，可能導致括號/反斜線破壞 PDF 語法、控制字元殘留、長逐字稿換行異常，或中文文字無法正確編碼。

新版補上 `handoutPdf.ts` 的純函式單元測試，將文字處理契約固定下來。此次只把既有 helper 改為具名匯出供測試引用，並新增測試；不呼叫 `buildHandoutPdf()`，也不改變講義 PDF 的頁面尺寸、版面、圖片處理、字型設定或實際輸出格式。

### 使用方式與影響

1. 一般使用者不需要改變操作方式：講義 PDF 下載與既有逐字稿排版流程維持不變。
2. 開發者調整講義 PDF 文字處理時，可先執行 `npm run typecheck` 與 `node --test --import tsx ./test/handout-pdf.test.ts` 確認純函式契約沒有回歸。
3. 測試不需要真實投影片圖片 fixture，因此能快速驗證文字處理邏輯，而不引入 `sharp` 讀圖或 PDF 位元組快照的脆弱依賴。
4. `buildHandoutPdf()` 仍沿用既有 `wrapText()` 與 `toUtf16BeHex()` 輸出流程，測試只提高回歸保障，不改講義視覺結果。

### 技術細節

- `backend/src/services/handoutPdf.ts` 將 `escapePdfText()`、`sanitizePdfText()`、`wrapText()`、`toUtf16BeHex()` 改為具名匯出，函式內容維持原樣。
- 新增 `backend/test/handout-pdf.test.ts`，直接引用上述 helper；測試範圍刻意停在純函式層，不建立圖片、不呼叫 PDF 建構流程。
- `escapePdfText()` 測試覆蓋一般文字、反斜線路徑與左右括號，確保 PDF literal string 需要的字元會被 escape。
- `sanitizePdfText()` 測試覆蓋 CRLF 轉 LF、控制字元替換成空白，並確認 tab、中文、英文與數字等可列印內容保留。
- `wrapText()` 測試覆蓋短字串單行、優先在空白處截斷、無空白長字串依最大字元數切分，以及中英文混合內容以 code point 計數。
- `toUtf16BeHex()` 測試固定 ASCII `AB` 應輸出 `FEFF00410042`、CJK `中文` 應輸出 `FEFF4E2D6587`，同時確認 BOM 與 UTF-16BE byte order 正確。

## 縮圖服務單元測試補強

### 功能目的

播放頁、首頁卡片與封面預覽都依賴後端縮圖服務把頁面圖與封面圖轉成較小的 JPEG。這段邏輯雖然不呼叫網路或子行程，但同時負責尺寸上限、JPEG 輸出、縮圖快取命中時跳過重產，以及來源圖遺失時安全回傳 `null`。若未來調整儲存路徑或縮圖參數時不小心破壞 lazy 產生行為，可能造成頁面載入變慢、既有縮圖被覆寫，或缺圖情境變成未預期例外。

新版補上 `thumbnails.ts` 的服務層單元測試，讓頁面縮圖與封面縮圖的主要契約都有回歸保障。這次只新增測試，並確認目標函式與尺寸常數已具名匯出；不改變既有縮圖輸出品質、尺寸設定或快取命中時直接回傳的行為。

### 使用方式與影響

1. 一般使用者不需要改變操作方式：首頁卡片、播放頁縮圖與封面縮圖仍會在需要時 lazy 產生。
2. 若縮圖檔案已存在，`ensurePageThumbnail()` / `ensureCoverThumbnail()` 仍會直接回傳既有路徑，不重新讀取來源圖或覆寫縮圖。
3. 若來源圖片不存在，ensure 系列函式仍會回傳 `null`，讓呼叫端能使用既有 fallback，而不是讓請求因例外中斷。
4. 開發者可執行 `npm run typecheck` 與 `node --test --import tsx ./test/thumbnails.test.ts` 驗證縮圖服務契約。

### 技術細節

- 新增 `backend/test/thumbnails.test.ts`，使用 Node 內建 test runner 與 `sharp` 在測試暫存目錄建立小型 PNG/JPEG 來源圖，不依賴外部圖片素材。
- `generatePageThumbnail()` 測試會產生大於上限的 PNG 來源圖，確認輸出檔存在，且寬高不超過 `PAGE_THUMBNAIL_WIDTH_PX` / `PAGE_THUMBNAIL_HEIGHT_PX`。
- `generateCoverThumbnail()` 測試會產生 JPEG 來源圖，確認輸出檔存在，且寬度不超過 `COVER_THUMBNAIL_WIDTH_PX`。
- ensure 系列測試先在目標縮圖路徑寫入 sentinel 文字檔，再呼叫 `ensurePageThumbnail()` / `ensureCoverThumbnail()`；透過回傳路徑、檔案內容與 `mtimeMs` 確認快取命中時沒有重產或覆寫。
- 缺來源測試覆蓋頁面與封面兩種路徑，確認來源圖不存在時回傳 `null` 且不建立縮圖檔。

## 前端提示詞生成上限提高到 128K

### 功能目的

「從提示詞產生大綱」後端已支援 `POST /api/prompt-text` 接收 128K（131072 字）提示詞，但首頁上傳後開啟的提示詞對話框仍保留較短的前端字數限制。這會造成使用者在瀏覽器端就被擋下，無法把完整課程素材、長篇摘要或會議紀錄送到已放寬的後端 API。

新版把前端提示詞輸入、送出前檢查與字數提示全部對齊後端 128K 契約。使用者可以在同一個提示詞欄位貼上超過舊 4000 字限制的長素材；若輸入超過 131072 字，前端仍會顯示明確錯誤，後端也會維持相同上限再次驗證，避免過大請求消耗資源。

### 使用方式

1. 上傳 PDF、TXT、ZIP 匯入或其他會開啟提示詞對話框的流程後，在「提示詞」欄位輸入或貼上需求描述。
2. 現在提示詞欄位可接受最多 131072 字，適合貼上較完整的課程規劃、逐段需求、研究摘要或會議紀錄。
3. 欄位右下角的字數計數會以 `目前字數 / 131072` 顯示目前用量。
4. 若超過 131072 字，送出前會顯示「提示詞不可超過 131072 字」；後端 `POST /api/prompt-text` 也會用相同上限回傳 400，形成雙層防護。

### 技術細節

- 新增 `frontend/src/lib/promptLimits.ts`，集中定義 `MAX_PROMPT_TO_OUTLINE_CHARS = 128 * 1024` 與 `PROMPT_TO_OUTLINE_TEXTAREA_MAX_CHARS`，避免元件各自寫死短上限。
- `frontend/src/components/PromptModal.tsx` 改用共用常數，讓 `prompt.length` 驗證、錯誤訊息 `{max}`、字數提示與 textarea `maxLength` 全部對齊 131072。
- textarea `maxLength` 不再使用舊的「上限 + 50」緩衝值，避免瀏覽器層允許超過後端契約的輸入；超限防線仍由前端驗證與後端 Zod schema 共同維持。
- 掃描 `frontend/src` 的 `4000`、`4,000` 與提示詞上限相關字串，確認沒有其他前端提示詞生成入口殘留舊 4000 字限制；技能設定、逐字稿每頁上限與動畫 custom-script prompt 等其他限制屬不同功能，未放寬。
- 新增 `frontend/src/lib/promptLimits.test.ts`，用 node test 固定前端常數必須等於 131072，避免日後回歸成 4000 或其他短上限。

## 技能服務單元測試補強

### 功能目的

使用者可在設定中建立自訂「技能」，讓逐字稿生成時套用特定講述風格；後端 `skills.ts` 同時負責內建技能、使用者技能 CRUD、內建技能啟用狀態與依用途篩選 prompt。這些邏輯會把資料寫入每個帳號各自的 `skills.json`，因此最重要的風險是 enabled 狀態、刪除/修改回傳值或帳號隔離行為在後續調整中被破壞。

新版補上後端服務層單元測試，讓技能清單合併、CRUD、內建切換與 prompt 過濾規則都有明確回歸保障，並使用測試專用帳號清理資料，避免測試污染開發者真實技能設定。

### 測試覆蓋

1. `listSkills()` 會回傳所有內建技能加上使用者技能，且內建技能 `enabled` 依帳號的 `enabledBuiltIns` 正確標示。
2. `createUserSkill()` / `updateUserSkill()` / `deleteUserSkill()` 覆蓋新增、trim 後保存、保留 `id`/`createdAt`、修改 enabled/applyTo、刪除後持久化為空清單。
3. 修改不存在 id 回傳 `null`，刪除不存在 id 回傳 `false`，且不會額外建立 `skills.json`。
4. `toggleBuiltInSkill()` 可在同一帳號中切換內建技能啟用/停用，切換不存在 id 回傳 `null`。
5. `getEnabledSkillPrompts()` 依 `applyTo` 正確篩選：查詢 `script` 時包含 `script` 與 `all`，查詢 `all` 時只包含 `all`，並排除 disabled 技能。

### 技術細節

- 新增 `backend/test/skills.test.ts`，直接測試 `backend/src/services/skills.ts` 匯出的服務函式，不需啟動 Fastify 或呼叫外部服務。
- 測試使用帳號 id `skills-service-test-20260619`，資料位置沿用 `getAccountSettingsLocation()` 的 `accounts/<accountId>/skills.json`；每個測試 `beforeEach` / `afterEach` 都遞迴刪除該帳號目錄，確保互相隔離且不碰真實帳號。
- 針對持久化行為直接讀取測試帳號的 `skills.json`，確認 CRUD 與內建啟用清單確實寫入預期 JSON 結構。
- 已執行 backend typecheck 與 `backend/test/skills.test.ts`，5 個測試全部通過。

## OpenAI API Key 設定請求驗證

### 功能目的

系統設定頁可透過 `PATCH /api/system/openai-api-key` 更新目前帳號的 OpenAI API Key。過去這個端點直接把 request body 斷言為 `{ api_key?: string }` 後呼叫 `.trim()`，若用戶端或第三方整合誤送 `{"api_key": 123}` 這類非字串值，後端會在 trim 時拋出未預期例外並回傳 500。

新版在進入設定更新前先用 Zod 驗證請求體，`api_key` 必須是字串或省略。格式錯誤會回傳 400 `INVALID_REQUEST`，讓用戶端能明確修正輸入，也避免把可預期的輸入錯誤記成伺服器內部錯誤。

### 使用方式

1. 一般使用者仍可在「設定」頁輸入 OpenAI API Key 並儲存。
2. 輸入合法字串時，後端會 trim 前後空白並保存；回應會包含 `has_key` 表示目前是否有有效 key。
3. 送出空字串、純空白字串或省略 `api_key` 時，語意維持為清除既有 OpenAI API Key。
4. 若 API client 送出非字串 `api_key` 或非物件 body，後端會回傳 400 `INVALID_REQUEST`，不再產生 500。

### 技術細節

- `backend/src/routes/pdfs/admin.ts` 新增 `UpdateOpenAiApiKeyBodySchema = z.object({ api_key: z.string().optional() })`，並在 `PATCH /api/system/openai-api-key` 使用 `safeParse(request.body ?? {})`。
- 驗證失敗時沿用既有 `errorResponse('INVALID_REQUEST', ...)` 格式回傳 400，與相鄰的 `PATCH /api/system/ai-settings` 行為保持一致。
- 通過驗證後才對 `parsed.data.api_key` 做 `.trim()`，避免非字串值觸發 `TypeError`。
- 新增 `backend/test/admin-openai-api-key.test.ts`，覆蓋合法字串保存、缺省清除、空白字串清除、非字串 `api_key` 400，以及非物件 body 400。

## 從提示詞產生大綱支援 128K 長提示詞

### 功能目的

「匯入文字 → AI 幫我產生大綱」流程可讓使用者用自然語言描述主題、素材、章節需求，再由 LLM 產生可匯入的投影片大綱。過去後端 `POST /api/prompt-text` 對提示詞套用 4000 字上限，使用者若貼上較完整的課程規劃、會議記錄、研究摘要或長篇素材，會在進入生成前就被拒絕。

新版將此流程的提示詞上限提高到 128K（131072 字），讓超過 4000 字但仍在合理範圍內的長素材可以直接送入大綱生成，同時保留最小長度檢查與超限防呆。超過 128K 的輸入仍會得到明確的驗證錯誤，避免過大的請求造成服務資源壓力或使用者等待不確定結果。

### 使用方式

1. 進入「匯入文字」。
2. 選擇「AI 幫我產生大綱」並輸入提示詞；現在可貼上超過 4000 字的長篇需求或素材。
3. 送出後，後端會依提示詞產生投影片大綱並建立可後續生成的簡報。
4. 若提示詞超過 131072 字，系統會回傳 `prompt 不可超過 131072 字`，請先縮短素材或分批生成。

### 技術細節

- `backend/src/routes/pdfs/upload.ts` 新增 `MAX_PROMPT_TO_OUTLINE_CHARS = 128 * 1024`，並將 `PromptTextBodySchema.prompt` 的 `.max()` 從 4000 改為此常數。
- 驗證錯誤訊息同步改為 `prompt 不可超過 131072 字`，保留既有 `prompt 至少需要 10 個字` 最小長度檢查。
- 新增 `backend/test/prompt-text-limit.test.ts`，用 OpenAI client stub 覆蓋 5000+ 字提示詞可通過並建立 `awaiting_prompt` 簡報，以及 128K+1 字提示詞仍回傳 400 `INVALID_REQUEST`。
- 此次只放寬「從提示詞產生大綱」的 `POST /api/prompt-text` 輸入限制，不改聊天室訊息、頁面聊天、圖片重生 prompt 或其他較短互動輸入的上限。

## 從大綱新增多頁對話框 i18n 補齊

### 功能目的

「新增多頁」對話框讓使用者可用手動大綱或 AI 對話產生大綱，再把多個新頁面插入既有簡報。過去 `AddPagesFromPromptModal.tsx` 的標題、模式選擇、手動輸入說明、AI 對話 placeholder、生成進度、取消/完成狀態與錯誤 fallback 都直接寫成中文；英文介面使用者開啟這個重要的增頁流程時，仍會看到大量中文文案。

新版將對話框主要使用者可見文字改為 `play.addPages.*` 翻譯鍵，讓手動大綱、AI 生成大綱、預覽、生成中頁面預覽、成功/取消/失敗狀態都能跟隨 UI 語言切換。此修改只替換文字來源與 fallback 錯誤訊息，不改既有 AI 大綱對話、插入頁碼、輪詢進度、取消任務或完成後回呼行為。

### 使用方式

1. 進入「設定」頁，將「界面文字語言」切換為「繁體中文」或「English」。
2. 回到任一簡報播放頁，在投影片管理區按「新增多頁 / Add multiple pages」。
3. 選擇「手動輸入大綱 / Enter outline manually」時，格式說明、範例大綱與 textarea placeholder 會使用目前語言顯示。
4. 選擇「AI 生成大綱 / Generate outline with AI」時，對話提示、角色 label、AI 思考狀態與目前大綱預覽會使用目前語言顯示。
5. 預覽並開始生成後，步驟進度、頁面預覽 label、逐字稿生成中、取消、完成與失敗訊息也會跟隨語言切換。

### 技術細節

- `AddPagesFromPromptModal.tsx` 引入 `useI18n()`，將硬編碼中文替換成 `play.addPages.*` 翻譯鍵。
- 生成步驟 label 由原本的 `STEP_LABELS` 字串表改為 `STEP_LABEL_KEYS`，以後端 step id 對應翻譯鍵；未知 step id 仍保留原字串 fallback，避免新後端 step 造成空白顯示。
- 新增本地 `formatMessage()` 處理 `{page}`、`{count}`、`{total}`、`{error}` 等簡單 placeholder，避免動態頁碼與錯誤訊息硬編碼在 JSX 中。
- `zh-TW.ts` 與 `en.ts` 新增 52 個 `play.addPages.*` 翻譯鍵，涵蓋模式選擇、說明、範例、對話、預覽、進度、狀態與錯誤 fallback。
- `i18n.test.ts` 新增 `AddPagesFromPromptModal locale keys are complete` 測試，確保中英文鍵同步存在且非空。

## 課堂測驗頁 i18n 補齊

### 功能目的

課堂測驗頁整合了 AI 產生題目、手動編輯題目、儲存測驗、同步啟動測驗、follower 作答、顯示答案、作答進度與歷史紀錄，是課堂互動流程中重要的一頁。過去 `QuizBuilderPage.tsx` 雖然已經引入 `useI18n()`，但頁面主要文字仍多數硬編碼為中文，例如「自動測驗生成」、「已儲存測驗」、「開始測驗」、「顯示答案」、「測驗中的學員」、「測驗歷史紀錄」、「測驗名稱」、「給 AI 的指令」、「請 AI 產生/修改問題列表」、「單選 / 多選」等。英文介面使用者進入測驗頁時會看到大量中文，無法完整操作課堂測驗功能。

新版將測驗頁主要使用者可見文字抽成 `quiz.*` 翻譯鍵，讓測驗建立、編輯、同步測驗、學生作答與歷史紀錄都能跟隨 UI 語言切換。此修改只替換文字來源與預設文字，不改測驗 CRUD、AI 生成、同步狀態、重設作答或作答紀錄資料流。

### 使用方式

1. 進入「設定」頁，將「界面文字語言」切換為「繁體中文」或「English」。
2. 回到任一簡報播放頁，進入自動測驗生成頁。
3. master 端可用目前語言操作：新增測驗、輸入測驗名稱、撰寫給 AI 的指令、請 AI 產生/修改題目、儲存測驗、開始測驗、顯示答案、結束測驗與查看歷史紀錄。
4. follower 端進入同步測驗時，作答提示、總分、題目分數、正確答案、解析與重設作答按鈕會使用目前 UI 語言顯示。
5. 測驗歷史紀錄中，匿名學員、分數、未計分、查看作答、收合、正確答案與已選但錯誤等狀態文字也會跟隨語言切換。

### 技術細節

- `QuizBuilderPage.tsx` 新增共用 `formatMessage()`，用 `{title}`、`{index}`、`{score}`、`{count}`、`{time}` 等 placeholder 處理動態文字。
- 頁面初始化的預設測驗標題與預設 AI prompt 改由 `quiz.defaultTitle` / `quiz.defaultPrompt` 取得，避免英文 UI 一開始就出現中文預設值。
- 同步測驗錯誤與成功訊息改用 `quiz.masterOnly*`、`quiz.*Done`、`quiz.*Failed` 等翻譯鍵，保留既有 `ApiError` 原文優先顯示邏輯。
- 學生作答區、教師端學員進度、測驗歷史紀錄與編輯表單的 label、placeholder、button、tooltip 都改用 `quiz.*` 翻譯鍵。
- `zh-TW.ts` 與 `en.ts` 新增 78 個測驗頁翻譯鍵，`frontend/src/i18n.test.ts` 新增 `QuizBuilderPage locale keys are complete` 測試，確保中英文鍵同步存在且非空。
- 已用 grep 確認 `QuizBuilderPage.tsx` 不再含硬編碼中文，並執行 frontend typecheck 與 `i18n.test.ts` 通過。

## Google OAuth callback 回應格式錯誤處理

### 功能目的

Google 登入 callback 需要先向 Google 交換 token，再用 access token 讀取使用者資訊。過去後端在 `tokenResp.ok` / `userResp.ok` 為成功後，直接把回傳 JSON 丟給 Zod schema `.parse()`。若 Google 或中間代理回傳格式異常，例如 token JSON 缺少 `access_token`、userinfo JSON 缺少有效 email，錯誤會變成未捕捉的 ZodError，最後由全域錯誤處理器回傳通用 `500 INTERNAL_ERROR`。雖然伺服器不會因此當掉，但使用者只會看到不明確的內部錯誤，維運時也不容易判斷是 token 交換格式錯誤還是 userinfo 格式錯誤。

新版在 callback 內明確捕捉 Google token 與 userinfo 的 JSON/schema 解析錯誤，並回傳可追查的 `502` 錯誤碼：`GOOGLE_TOKEN_PARSE_FAILED` 或 `GOOGLE_USERINFO_PARSE_FAILED`。這讓登入故障能被更快定位，也避免把第三方回應格式問題誤歸類為 MakeSlide 內部錯誤。

### 使用方式

此功能不改變一般使用者的 Google 登入流程：

1. 使用者仍從設定頁或登入入口點選 Google 登入。
2. Google 授權成功且回應格式正常時，流程照常建立 session 並回到設定頁。
3. 若 Google token 回應格式異常，後端會回傳 `502 GOOGLE_TOKEN_PARSE_FAILED`。
4. 若 Google 帳號資訊回應格式異常，後端會回傳 `502 GOOGLE_USERINFO_PARSE_FAILED`。
5. 管理者可從後端 log 的 Zod issue path/code/message 判斷缺少或格式錯誤的欄位，而不會在 log 中看到 token 或完整個資 payload。

### 技術細節

- `backend/src/routes/auth.ts` 新增 `parseJsonResponse()`、`parseGoogleTokenResponse()` 與 `parseGoogleUserInfoResponse()`，把第三方 JSON 解析與 schema 驗證集中處理。
- schema 驗證失敗時使用 `logger.warn()` 記錄精簡後的 Zod issues：欄位 path、Zod code 與 message；不記錄 `access_token`、完整 Google userinfo body 或其他敏感原文。
- token schema 解析失敗會回傳 `502` 與 `GOOGLE_TOKEN_PARSE_FAILED`；userinfo schema 解析失敗會回傳 `502` 與 `GOOGLE_USERINFO_PARSE_FAILED`。
- 既有 `GOOGLE_TOKEN_EXCHANGE_FAILED` 與 `GOOGLE_USERINFO_FAILED` 仍分別處理 HTTP status 非 2xx 的情境；本次只補強 2xx 但 body 格式不符合預期的分支。
- 新增 `backend/test/auth-google-callback.test.ts`，用 mock `globalThis.fetch` 覆蓋 token 缺少 `access_token` 與 userinfo 缺少 `email` 的情境，確認不再落入通用 `500 INTERNAL_ERROR`。
- 已執行 backend typecheck 與新增測試，確認錯誤碼與型別皆通過。

## 全螢幕播放模式 i18n 補齊

### 功能目的

全螢幕播放模式是課堂展示與現場講解時最常使用的畫面，包含圖片/字幕/逐字稿編輯三種 layout、上一頁/下一頁/播放/暫停控制、內建逐字稿編輯、手寫繪圖工具、學生端提問與 Realtime Poll 控制。過去這些文字仍有不少直接寫在 `PlayPageFullscreen.tsx` 中，例如「上一頁」、「下一頁」、「（本頁尚無字幕）」、「📝 編輯逐字稿（第 N 頁）」、繪圖顏色與筆寬標籤，以及同步提問/投票面板文字。英文介面進入全螢幕後仍會混入中文，影響非中文使用者在上課或分享情境下操作。

新版將全螢幕模式主要使用者可見文字改為 `play.fullscreen.*` 翻譯鍵，並重用已完成的 `play.slidePanel.*` 播放控制與逐字稿翻譯鍵。使用者切換 UI 語言後，全螢幕控制、字幕空狀態、逐字稿編輯提示、手寫工具與課堂互動面板都會跟隨語言切換。

### 使用方式

1. 進入「設定」頁，在「界面文字語言」選擇「繁體中文」或「English」。
2. 回到任一簡報播放頁，按「全螢幕 / Fullscreen」。
3. 在全螢幕右上角切換「圖片 / Image」、「字幕 / Subtitles」、「編輯 / Edit」layout，按鈕與 tooltip 會依目前 UI 語言顯示。
4. 在編輯 layout 中可用本地化的上一頁、下一頁、播放/暫停按鈕操作，也可直接編輯本頁逐字稿並儲存重生語音。
5. 開啟手寫模式時，筆、游標、橡皮擦、清除、關閉、顏色與筆寬 label 會以目前語言顯示；原本的手勢換頁、點擊播放切換與繪圖行為維持不變。
6. 若使用課堂同步模式，follower 的全螢幕提問面板與 master 的 Realtime Poll 控制面板也會顯示對應語言。

### 技術細節

- `PlayPageFullscreen.tsx` 將原本硬編碼的全螢幕播放控制、字幕空狀態、逐字稿編輯、繪圖工具列、layout 切換、離開全螢幕、同步提問與投票控制文字改為 `useI18n()`。
- 新增 `FULLSCREEN_LAYOUTS`、`DRAWING_COLORS` 與 `DRAWING_WIDTHS` 的翻譯 key 對應，避免在常數中保留中文 label。
- 動態文字使用簡單 `{page}` / `{count}` / `{layout}` placeholder 置換，讓頁碼、字數與票數摘要能用同一組中英文翻譯鍵產生。
- 頁面生成狀態、圖片 alt、上一頁/下一頁/播放/暫停與逐字稿儲存文案重用 `play.slidePanel.*`，維持一般播放面板與全螢幕模式的一致用語。
- `zh-TW.ts` 與 `en.ts` 新增 45 個 `play.fullscreen.*` 翻譯鍵，`frontend/src/i18n.test.ts` 新增完整性測試，確保中英文鍵同步存在且非空。
- 已執行 frontend typecheck 與 `i18n.test.ts`，確認型別與翻譯鍵完整性皆通過。

## 動畫 Raw JSON 複製 fallback 與錯誤狀態

### 功能目的

播放頁的動畫編輯器提供「原始 JSON」分頁，方便進階使用者備份、除錯或將單頁動畫設定貼到 issue / 文件中討論。過去「複製 JSON」按鈕直接呼叫瀏覽器的 Clipboard API，只在 `navigator.clipboard.writeText()` 成功時把按鈕文字改成「已複製」。若使用者在非 HTTPS / 非 localhost 的非安全來源、瀏覽器不支援 Clipboard API、權限被拒，或嵌入環境限制剪貼簿權限時，複製會靜默失敗，畫面也不會告知下一步該怎麼做。

新版新增共用 `copyTextToClipboard()` helper，讓 Raw JSON 複製流程先嘗試標準 Clipboard API；若失敗或不可用，會自動建立隱藏 textarea、選取文字並透過 `document.execCommand('copy')` 嘗試舊式 fallback。若兩種方式都失敗，UI 會顯示本地化錯誤狀態，提醒使用者可直接選取下方唯讀 JSON textarea 手動複製。

### 使用方式

1. 進入任一簡報播放頁，切到動畫編輯區。
2. 在動畫 notebook 中切換到「原始 JSON / Raw JSON」分頁。
3. 按「複製 JSON / Copy JSON」：
   - 支援 Clipboard API 且權限允許時，會直接複製完整動畫 JSON。
   - Clipboard API 不可用或被拒時，系統會自動嘗試 textarea selection / `execCommand('copy')` fallback。
   - 成功時會顯示「已複製 / Copied」。
   - 若瀏覽器也阻擋 fallback，會顯示「複製失敗，請手動選取下方 JSON 後複製。」或英文等效提示。
4. 下方 Raw JSON textarea 維持唯讀，取得焦點時仍會自動全選，方便在所有自動複製路徑失敗時手動按系統複製快捷鍵。

### 技術細節

- `frontend/src/lib/clipboard.ts` 新增 `copyTextToClipboard()`，回傳 `{ ok, method, error }` 結果，讓呼叫端能明確區分成功、fallback 成功與失敗。
- helper 優先使用 `navigator.clipboard.writeText()`；catch 後不直接失敗，而是繼續走 textarea fallback。
- `copyTextWithExecCommand()` 會在文件中暫時插入隱藏且唯讀的 textarea，設定 `value`、呼叫 `focus()` / `select()` / `setSelectionRange()`，再執行 `document.execCommand('copy')`，最後一定移除暫存節點。
- `AnimationEditorTab.tsx` 將原本的 `jsonCopied` boolean 改為 `jsonCopyStatus`，支援 `idle`、`success`、`error` 三態，並用 timer 自動復原狀態；元件卸載時會清除 timer，避免 setState 殘留。
- `zh-TW.ts` 與 `en.ts` 新增 `play.animation.copyJsonError`，讓失敗提示跟隨 UI 語言顯示。
- `frontend/src/lib/clipboard.test.ts` 使用 Node 內建 test runner 與 mock document/navigator 覆蓋 Clipboard API 成功、Clipboard API 拒絕後 fallback 成功、兩路徑都失敗，以及 fallback 不可用的純函式情境。

## 批次重生對話框 i18n 與選取頁摘要

### 功能目的

批次重生是播放頁調整簡報時的重要入口，使用者可一次選擇重生圖片、逐字稿、語音或動畫，也可先在側欄挑選特定頁面後只重生這些頁。過去 `RegenAllDialog.tsx` 內的「選擇重生項目」、「僅重生已選取的 N 張投影片」、「圖檔重生提示詞」、「逐字稿重生提示詞」、「提醒：若僅重生逐字稿…」、「再次重生／確認」等文字直接寫成中文，英文介面會在最關鍵的重生流程中混入中文，讓非中文使用者難以判斷按鈕與提示意義。

新版將批次重生對話框主要使用者可見文字改為 `play.regenDialog.*` 翻譯鍵，並把選取頁摘要抽成共用 formatter。這讓對話框會跟隨設定頁的界面語言切換為繁體中文或英文，同時保留既有重生選項、主持模式、提示詞輸入、進度顯示與背景繼續執行行為。

### 使用方式

1. 進入「設定」頁，將「界面文字語言」切換為「繁體中文」或「English」。
2. 回到任一簡報播放頁，在右側投影片管理區可直接按「重生 / Regenerate」重生全部頁面，或先用 Ctrl/Shift 點選縮圖後只重生選取頁面。
3. 開啟批次重生對話框後，頁面摘要會依選取狀態顯示：
   - 未選取頁面：顯示重生全部投影片。
   - 單頁選取：顯示只重生該頁。
   - 多頁選取：自動去重並依頁碼由小到大排序顯示。
4. 勾選要重生的項目，例如圖片、逐字稿、語音或動畫；若選擇逐字稿或語音，可選擇單人旁白或雙人對談主持模式。
5. 需要時填寫圖片重生提示詞或逐字稿重生提示詞，再按「確認 / Confirm」。重生完成後同一按鈕會顯示「再次重生 / Regenerate again」。

### 技術細節

- `RegenAllDialog.tsx` 引入 `useI18n()`，將對話框標題、說明、重生選項、主持模式、提示詞欄位、警告提示與按鈕文字改為 `play.regenDialog.*` 翻譯鍵。
- `formatters.ts` 新增 `formatRegenSelectedPagesSummary()`，輸入 deck 總頁數、選取頁集合與翻譯函式後，統一回傳本地化摘要。
- formatter 會將選取頁轉為 `Set` 去重、過濾非有限數字並排序，避免側欄選取順序影響摘要文字。
- `zh-TW.ts` 與 `en.ts` 新增完整中英文翻譯；中文多頁頁碼使用「、」，英文使用 comma separator。
- `formatters.test.ts` 新增空集合、單頁、多頁排序與去重測試，確保摘要規則可在不啟動 React UI 的情況下驗證。
- 這次未改 `onConfirm`、`onRegenOptionsChange`、`onHostModeChange` 或 `RegenerateProgress` 的資料流，只替換文字來源並抽出可測 formatter。

## 播放頁側欄、來源管理與系統資料 i18n 補齊

### 功能目的

播放頁除了頁首以外，右側投影片管理與下方來源/系統資料分頁也是製作簡報時最常使用的控制區。過去「投影片管理」、「重生」、「新增多頁」、「已選 N 頁將重生」、「來源管理」、「新增 TXT/PDF 來源」、「目前來源清單」、「生成記錄」與系統資料中的狀態、耗時、執行歷程等 label 多數直接寫在元件內。當使用者把界面語言切到 English 時，播放頁仍會在同一畫面混用大量中文，尤其是來源管理和系統資料表格，容易讓英文使用者誤以為功能尚未完整支援。

新版將這些主要使用者可見文字改為中英文翻譯鍵，讓播放頁側欄、來源管理與系統資料能跟隨全站界面語言切換。這次只調整文字來源，不改資料流與互動事件，因此既有 Ctrl/Shift 投影片多選、縮圖拖曳、來源內容展開、生成 prompt 展開、YouTube audio source 播放、執行歷程展開與最慢素材排行顯示都維持原本操作方式。

### 使用方式

1. 進入「設定」頁，在「界面文字語言」選擇「繁體中文」或「English」。
2. 回到任一簡報播放頁，右側「問答」欄上方的投影片管理區會依語言顯示：
   - 投影片管理標題。
   - 重生、啟動中、重生中、新增、刪除、新增多頁。
   - Ctrl/Shift 多選提示、已選頁數摘要、清除選取。
   - 縮圖 title/alt、拖曳重排提示、設定目前頁為封面。
3. 在播放頁下方切到「來源 / Sources」分頁，可以用目前 UI 語言操作：
   - 新增 TXT 來源與上傳 PDF 來源。
   - 填寫來源名稱、貼上來源文字內容。
   - 查看目前來源清單、未命名來源、無內容狀態。
   - 展開/收合來源內容；YouTube audio source 仍會顯示可播放的 audio controls。
   - 查看本頁生成記錄，展開圖片生成提示、逐字稿生成提示或語音合成參數。
4. 切到「系統資料 / System data」分頁，可以用目前 UI 語言查看：
   - PDF ID、狀態、原始檔名、頁數、TTS、目前頁狀態、建立時間與更新時間。
   - 圖片、文字、講稿、語音的狀態、耗時與 SLA。
   - 執行歷程的 run type、attempt、狀態、階段、耗時與 LLM 用量。
   - 最慢素材排行的頁碼、素材、狀態、耗時與 SLA。

### 技術細節

- `PlayPageSidebar.tsx` 既有 `useI18n()` 現在用於 `play.sidebar.*` 翻譯鍵，涵蓋投影片管理標題、按鈕、縮圖 title/alt、載入/無圖片、選取摘要、多選提示與封面設定。
- `PlayPageSlidePanel.tsx` 將來源管理相關文案抽到 `play.source.*`，包含來源 tab、管理標題、TXT/PDF 新增說明、placeholder、來源清單、空狀態、生成記錄與 prompt stage label。
- `PlayPageSlidePanel.tsx` 將系統資料相關 label 抽到 `play.system.*`，並把 run type、run status、pipeline stage、stage status 改成 `TranslationKey` 對應表，再透過 `t()` 顯示。
- 素材名稱重用既有 `play.timing.artifact.*` 翻譯鍵，避免 image/text/script/audio 在不同區塊出現不一致文案。
- 這次未改 `setRegenSelectedPages()`、`setExpandedSourceId()`、`setExpandedGenPrompt()`、`withShareToken()` 或 `<audio controls>` 的行為，只替換文字與 label 來源。
- `zh-TW.ts` 與 `en.ts` 新增相同 key，讓 `TranslationKey` 型別在 typecheck 時確認中英文 locale 都有對應文案。
- 已執行 frontend typecheck，並用 grep 掃描 `PlayPageSidebar.tsx` 與 `PlayPageSlidePanel.tsx` 中本次目標的主要硬編碼中文；結果只剩註解與非本次 TODO 目標的逐字稿重生文案。

## 播放頁頁首與課堂同步區 i18n 補齊

### 功能目的

播放頁頁首是使用者進入簡報後最常操作的區域，包含返回首頁、更新或重新生成標題、切換同步模式、follower 向 master 提問、master 顯示問題與觸發 AI 總結回答、全螢幕播放、影片產生、講義 PDF 下載、GitHub 同步與分享連結管理。過去這些文字多數直接寫在 `PlayPageHeader.tsx` 中，即使使用者把界面語言切到 English，頁首和同步區仍會混用中文，導致英文介面不完整，也讓後續維護翻譯時不容易確認是否漏鍵。

新版將頁首和課堂同步區的主要使用者可見文字改為 `useI18n()` 讀取 `zh-TW.ts` / `en.ts` 翻譯鍵。這讓播放頁的核心控制列能跟隨全站 UI 語言切換，同時保留既有分享、同步模式、影片產生、全螢幕與重生任務 banner 行為。

### 使用方式

1. 進入「設定」頁，在「界面文字語言」選擇「繁體中文」或「English」。
2. 回到任一簡報播放頁，頁首會依目前 UI 語言顯示：
   - 返回、頁碼、標題更新與重新生成按鈕。
   - 同步模式切換、follower 問題輸入框、送出問題按鈕。
   - master 端的 follower 問題數、顯示最新問題、AI 總結回答按鈕。
   - 全螢幕圖片/字幕/編輯模式、語音設定、圖片風格、影片產生與下載。
   - 講義 PDF、GitHub 同步、分享連結權限與 private 控制。
3. 切換語言後不需重新產生簡報；既有播放資料、分享權限、同步角色、影片 URL 與全螢幕 layout 狀態都維持原本流程。
4. 若課堂中使用同步模式，英文介面的 follower 會看到英文問題 placeholder 與送出按鈕，master 會看到英文的問題摘要與 AI 回答控制；中文介面則維持原本繁體中文語意。

### 技術細節

- `PlayPageHeader.tsx` 引入 `useI18n()`，把原本硬編碼中文替換為 `play.header.*`、`play.sync.*`、`play.share.*`、`play.regenBanner.*` 翻譯鍵。
- 動態文字仍保留原本資料來源與行為：頁碼以 `{current}` / `{total}` 置換，follower 問題數以 `{count}` 置換，頁面失敗與重生目前頁使用 `{page}` 置換。
- 分享權限 select 仍使用既有 `ShareAccessMode` 值 `read_only` / `editable`，只替換 option label；建立分享連結、設為 private、同步 GitHub、影片產生、全螢幕 layout 切換等 handler 未改變。
- 同步模式區塊仍沿用既有 `syncRole`、`syncFollowerQuestions`、`handleSubmitFollowerQuestion()`、`handleToggleDisplayedQuestion()` 與 `handleAiAnswerFollowerQuestions()`；只將 placeholder、按鈕與狀態文字改為翻譯鍵。
- `zh-TW.ts` 與 `en.ts` 新增完整中英文文案，讓 `TranslationKey` 型別可在編譯期檢查新增 key 是否存在。
- 新增 `frontend/src/i18n.test.ts`，檢查英文與繁體中文 locale dictionary key 完全一致，並確認播放頁頁首與同步區的關鍵翻譯鍵在兩種語言中都存在且非空。

## 2026-06-18 TODO 再次重新檢視與新增方向

### 檢視目的

本次依照 `LOOP.md` 的規則，在 `TODO.md` 已沒有未完成項目時，再次檢查目前主要前端、後端與既有 `BLOG.md` 功能紀錄，補上一批偏小型、可分次完成、容易驗證，且對使用者有直接價值的改進。檢查時特別避開近期已完成的首頁排序/搜尋、卡片語音長度、ZIP 匯入提示詞、YouTube 字幕快速選項、播放進度清除、耗時摘要、分享權限、縮圖模式、高橋流提示詞、重生進度 i18n、圖表素材批次、測驗重設、分類重新命名、後端 log 遮罩與上傳取消控制，避免重複既有 TODO 或 BLOG 項目。

### 新增待辦方向

- **播放頁英文介面完整度**：`PlayPageHeader.tsx`、`PlayPageSidebar.tsx` 與 `RegenAllDialog.tsx` 仍有許多硬編碼中文，新增三個可分批完成的 i18n 待辦，優先處理頁首/同步區、側欄/來源管理、批次重生對話框。
- **複製操作可靠性**：`AnimationEditorTab.tsx` 的 Raw JSON 複製只處理 Clipboard API 成功路徑，新增 clipboard fallback 與失敗狀態待辦，讓非安全來源或權限受限環境也有可理解的回饋。
- **前端 console 降噪**：播放頁貼上圖片與拖曳重排仍有 `console.info/warn` 偵錯輸出，新增待辦要求移除或改成明確 gated debug helper，降低一般操作時的 console 噪音。
- **來源管理小型效率改進**：來源清單可展開內容但缺少快速複製與收合控制，新增「複製內容」與「全部收合」待辦，不需改 API 或資料庫即可提升整理與引用來源文字的效率。

### 檢查依據

- 文件：`LOOP.md`、`TODO.md`、`BLOG.md`。
- 主要前端：`PlayPageHeader.tsx`、`PlayPageSidebar.tsx`、`PlayPageSlidePanel.tsx`、`RegenAllDialog.tsx`、`AnimationEditorTab.tsx`、`ShareDialog.tsx`、`SettingsPage.tsx`。
- 主要後端：`backend/src/routes/pdfs/sync.ts`、`backend/src/routes/pdfs/handout.ts`，以及 `backend/src` 內 `console.*` 掃描結果。

## PDF 上傳取消控制

### 功能目的

大型 PDF 或網路較慢時，使用者開始上傳後過去只能等待 XHR 結束，若選錯檔案、發現匯入模式選錯，或只是想暫停操作，缺少明確的中止入口。雖然底層 `uploadPdf()` 已支援 `AbortSignal` 並會在 XHR abort 時回傳 `ABORTED`，但上層 `UploadButton.tsx` 尚未建立 `AbortController`，因此使用者流程無法真正取消上傳。

新版在 PDF 上傳進度顯示期間新增「取消上傳 / Cancel upload」按鈕。每次選擇 PDF 並開始上傳時，前端會建立新的 `AbortController` 並把 `signal` 傳給既有 `uploadPdf()`；點擊取消會中止目前 XHR、清空進度條與 file input。當錯誤碼是 `ABORTED` 時，畫面會顯示「已取消上傳。你可以重新選擇 PDF 再試一次。」這類友善訊息，而不是一般的「上傳失敗」錯誤與疑難排解清單。

### 使用方式

1. 在首頁點擊「上傳 PDF」，選擇「簡報逐頁處理」或「一般文件 AI 分頁」，再選取 PDF 檔案。
2. 上傳開始後，按鈕文字會顯示目前百分比，旁邊會出現進度條與「取消上傳」按鈕。
3. 如果選錯檔案、想改匯入模式，或不想繼續等待，點擊「取消上傳」。
4. 系統會立即要求瀏覽器中止 XHR，上傳進度會歸零，隱藏檔案輸入欄位也會重設，因此可以再次選擇同一個 PDF 或改選其他 PDF。
5. 取消後若要重新上傳，直接再次點擊「上傳 PDF」並重新選檔即可；取消動作不會新增簡報，也不會呼叫額外 API。

### 技術細節

- `UploadButton.tsx` 新增 `uploadAbortControllerRef`，每次 `handleChange()` 開始 PDF 上傳時建立 `new AbortController()`，並將 `abortController.signal` 傳給 `uploadPdf(file, opts)`。
- 進度列旁新增取消按鈕，`handleCancelUpload()` 會呼叫目前 controller 的 `abort()`，並同步 `setProgress(0)` 與清空 `fileInputRef.current.value`。
- `finally` 區塊只在 ref 仍指向本次 controller 時清除 ref，避免未來若流程擴充為可重入時誤清掉新上傳控制器；同時維持既有上傳完成/失敗後重設 `isUploading` 與進度的行為。
- `ApiError` code 為 `ABORTED` 時改走專用分支，使用 `upload.uploadCanceled` i18n 文字並清空 `recoveryGuide`，避免將使用者主動取消誤判為網路或後端錯誤。
- `zh-TW.ts` 與 `en.ts` 新增 `upload.uploadProgress`、`upload.cancelUpload`、`upload.uploadCanceled`，補齊中文與英文介面文字。

## 後端 LLM / TTS 偵錯記錄遮罩與降噪

### 功能目的

後端在產生逐字稿、文字匯入生圖、YouTube 大綱、OpenAI Chat JSON 與 TTS 語音合成時，過去有多處直接使用 `console.log` 印出 system prompt、image payload、raw response、rawContent、hex/binary 內容或音訊 segment 文字。這些資訊在除錯時有幫助，但也可能包含 API key、Bearer token、使用者 prompt、投影片原文、逐字稿、字幕、base64 圖片或音訊 buffer；在正式環境中會造成 log 過大、難以搜尋，也增加敏感資料外洩風險。

新版改為集中使用 `logger.debug/info/warn` 並透過後端遮罩 helper 產生可診斷但不洩漏內容的摘要。預設保留 `pdfId`、`pageNumber`、`stage`、`model`、`latencyMs`、`usage`、`promptLength`、`bytes`、`chars`、`requestId` 等欄位，讓維運仍能追蹤哪個階段慢、哪次請求失敗、token 用量與 response shape；但 prompt 原文、script/text/input、API key、raw response、大型 binary/base64/hex 只會以 `[redacted]`、`[redacted-large-content]` 或 `{ redacted: true, chars/bytes }` 摘要呈現。

### 使用方式

1. 一般使用者不需要調整任何設定；後端產生簡報、YouTube 匯入、TTS 與 OpenAI/Gemini LLM 流程會自動使用遮罩後的 logger 輸出。
2. 開發者若需要追查 LLM 或 TTS 問題，請查看後端 logger 的 `debug` / `info` / `warn` 訊息：
   - `generateScript: system prompt prepared` 只顯示 system prompt 字數摘要，不顯示完整 prompt。
   - `Text image generation: OpenAI image request prepared` 顯示模型、尺寸、品質、timeout 與 promptLength，不輸出 image prompt 原文。
   - `synthesizeAudio: tts segment request` 顯示 segment 字數、voice、provider 與語氣標記，不輸出逐字稿段落全文。
   - `OpenAI raw response received` 顯示 status、headers、bytes 與短 body preview，且會遮罩 API key、Bearer token、data URL、hex/base64 大內容。
3. 若新增任何後端 LLM、TTS、圖片或外部 API 偵錯記錄，應優先使用 `redactLogObject()` 包裝整個 log metadata，或使用 `redactPromptForLog()` / `redactTextForLog()` 處理 prompt、script、caption、rawContent 等文字欄位。
4. 若真的需要完整 prompt 或 response 進行離線分析，請使用既有資料庫/檔案中的專用 prompt 保存與 LLM usage log 流程，避免把原文直接寫到一般應用 log。

### 技術細節

- 新增 `backend/src/services/logSanitizer.ts`，集中定義敏感 key 規則與內容規則：`apiKey`、`authorization`、`token`、`secret`、`prompt`、`input`、`text`、`script`、`payload`、`rawContent`、`b64_json`、`base64`、`hex`、`audio`、`buffer`、`dataUrl`、`url` 等欄位會遮罩或摘要化。
- `redactLogObject()` 會遞迴處理物件與陣列，對 Buffer / Uint8Array / ArrayBuffer 只保留 bytes 與型別；對大型 base64、data URL、長 hex 字串改為 `[redacted-large-content]`；對 API key 與 Bearer token 改為 `[redacted]`。
- `redactPromptForLog()` 與 `redactTextForLog()` 會回傳 `{ redacted: true, chars, preview? }`。短文字可保留極短 preview 供分辨 segment，較長 prompt/script 則只保留字數，避免原文進入 log。
- `generateScript.ts`、`renderTextPagesWithLlm.ts`、`synthesizeAudio.ts`、`pipeline.ts` 與 `backend/src/services/openai.ts` 已移除目標高噪音 `console.log`，改為 `logger.debug/info/warn` 且套用遮罩摘要。
- `backend/test/log-sanitizer.test.ts` 覆蓋 API key、prompt 原文、raw response、大型 base64/hex 內容不出現在序列化 log 中，同時確認 `latencyMs` 與 `requestId` 等必要診斷欄位仍保留。

## 首頁自訂分類重新命名

### 功能目的

首頁原本已能新增自訂分類、刪除分類，也能在每張簡報卡片上把簡報移到不同分類；但如果分類名稱打錯，使用者只能新增一個正確名稱的新分類，再逐份把簡報搬過去，最後刪除舊分類。簡報數量一多時，這個流程耗時且容易漏搬。

新版在首頁每個自訂分類標題旁加入「重新命名類別 / Rename category」按鈕。重新命名會同時更新本機 `customCategories` localStorage 與目前清單中屬於該分類的簡報資料，讓分類名稱修正變成一次操作即可完成。

### 使用方式

1. 在首頁以「顯示類別」選擇特定分類，或在全部類別視圖中找到要更名的自訂分類區塊。
2. 在分類標題旁點擊「重新命名類別」。`general` 與「最近的簡報」不是自訂分類，不會顯示重新命名按鈕。
3. 在彈出的輸入框中填入新的分類名稱並確認。
4. 若新名稱空白、和原名稱相同，系統不會做任何變更；若新名稱已存在，會顯示分類已存在的 toast。
5. 成功後，首頁會把目前清單中所有原分類簡報更新到新分類，並顯示「已將 A 重新命名為 B，並更新 N 份簡報」的 toast。
6. 如果使用者目前正在篩選被重新命名的分類，篩選值會自動切到新分類名稱，不需要手動重新選擇。
7. 若只有部分簡報更新失敗，系統會顯示部分失敗 toast，並重新載入首頁清單，避免畫面和後端資料不一致。

### 技術細節

- `HomePage.tsx` 新增 `renamingCategory` 狀態與 `handleRenameCategory()`，重新命名期間停用該分類按鈕並顯示「重新命名中…」。
- 新分類名稱會先檢查空白、未變更與 `allCategories` 重複，避免建立同名分類。
- `persistCustomCategories()` 會將舊分類替換成新分類，並確保新名稱被寫入 `makeslide.home.customCategories`；若舊分類原本只來自簡報資料而不在 localStorage，也會把新名稱加入自訂分類清單。
- 目前清單中同分類簡報會逐一呼叫既有 `updatePdfCategory(pdf.id, nextCategory)`，不新增後端 API，也不改資料庫 schema。
- 重新命名成功時會樂觀更新 `items` 內已成功回傳的簡報分類；如果目前 `categoryFilter` 是舊分類，會同步更新 `makeslide.home.categoryFilter` 為新分類。
- 批次更新使用 `Promise.allSettled()` 辨識部分失敗；只要有任一簡報更新失敗，就顯示部分失敗訊息並呼叫 `load({ silent: true })` 重新載入清單。
- `zh-TW.ts` 與 `en.ts` 新增 `home.renameCategory`、`home.renamingCategory`、`home.renameCategoryPrompt`、`home.categoryRenamed`、`home.categoryRenamePartialFailed`、`home.renameCategoryFailed`，補齊中英文介面與 toast 文案。

## 課堂測驗重設作答

### 功能目的

課堂同步測驗的 follower 作答狀態保存在前端 `QuizBuilderPage.tsx` 的 `studentAnswers`。過去學生如果想重新練習同一份測驗，或老師在課堂示範時切換測驗後又回到同一份測驗，已選過的選項需要逐題手動取消；若測驗已經提交過，前端的提交防重複 ref 也可能讓同一個同步 session 的後續重新提交被擋下。

新版在學生作答區加入「重設作答 / Reset answers」按鈕，讓 follower 可以一鍵清空本次作答、重置提交防重複狀態，並立即向既有同步進度 API 回報 `answered_count=0`。此功能只調整前端狀態與既有進度回報流程，不修改資料庫 schema，也不新增後端 API。

### 使用方式

1. 老師以 master 身分在測驗列表按下「開始測驗」，follower 會進入學生作答區。
2. follower 作答時，如果想重新練習或清除本次所有選項，點擊作答區右上角的「重設作答」按鈕。
3. 系統會立即清空目前所有題目的選項，畫面上 radio / checkbox 會回到未選狀態。
4. master 端「測驗中的學員」進度會透過既有同步進度 API 更新為 `0 / 題數`，不需要重新整理頁面。
5. 若之後老師顯示答案或結束測驗，因為提交防重複 ref 已重置，follower 重新作答後仍可再次提交本次答案，不會被舊的 session 提交記錄擋住。
6. 若回報重設進度失敗，學生作答畫面會顯示同步錯誤訊息；下一次答案狀態變動仍可重新觸發既有進度回報。

### 技術細節

- `QuizBuilderPage.tsx` 新增 `resetStudentAnswersBusy` 狀態與 `handleResetStudentAnswers()`，避免重設進度回報期間重複點擊。
- `handleResetStudentAnswers()` 會執行三個前端狀態重置：`setStudentAnswers({})` 清空作答、`submittedAttemptRef.current = null` 解除同一 session 防重複提交、更新 `latestAttemptSnapshotRef.current.answers = {}` 避免後續提交仍帶到舊答案快照。
- 重設後立即呼叫既有 `submitSyncQuizProgress(pdfId, clientId, payload)`，payload 使用目前 active quiz id、`answered_count: 0`、`total_questions: activeQuiz.questions.length`、`submitted: false`。
- 成功回報時同步更新 `lastReportedProgressRef.current` 為 0 題，避免 debounce 進度 effect 立刻送出重複請求；失敗時將該 ref 清為 `null`，讓後續狀態變動可以重新回報。
- `zh-TW.ts` 與 `en.ts` 新增 `quiz.resetAnswers`、`quiz.resetAnswersBusy`、`quiz.resetAnswersHint`、`quiz.resetAnswersDone`、`quiz.resetAnswersFailed`，讓中英文介面都有一致的按鈕、提示與錯誤文案。

## 圖表素材全部使用／全部排除批次操作

### 功能目的

播放頁的「圖表素材」分頁會列出目前投影片對應 PDF 頁面中偵測到的 extracted figures，並以 `PageFigure.excluded` 控制每張圖是否要作為「重新生成圖片」時的參考素材。原本使用者只能逐張勾選或取消勾選；當一頁含有大量小圖、公式、截圖或圖表時，若想先全部納入再排除少數項目，或先全部排除再挑少數關鍵圖，會需要大量重複點擊。

新版在圖表清單上方加入「全部使用」與「全部排除」兩個小按鈕，讓使用者可以一鍵套用本頁所有圖表的參考狀態。這項功能不改變後端資料模型，也不新增 API，而是沿用既有的整頁選擇儲存流程一次寫回，降低操作時間並維持和逐張切換相同的儲存語意。

### 使用方式

1. 進入播放頁，切換到「圖表素材」分頁。
2. 若目前頁面有偵測到圖表，清單上方會出現兩個批次按鈕：
   - `全部使用` / `Use all`：將本頁所有圖表設為可作為圖片重生參考，也就是把所有 `PageFigure.excluded` 設為 `false`。
   - `全部排除` / `Exclude all`：將本頁所有圖表排除在圖片重生參考之外，也就是把所有 `PageFigure.excluded` 設為 `true`。
3. 點擊任一批次按鈕後，畫面會立即反映新的勾選狀態，並透過既有 `savePageFigureSelection(pdfId, pageNumber, excludedIds)` 一次儲存整頁 excluded ids。
4. 批次儲存期間，批次按鈕與單張圖表 checkbox 會暫時停用，避免同時送出多個互相覆蓋的選擇。
5. 若儲存失敗，畫面會復原到按下批次按鈕前的狀態，並顯示既有「儲存圖表選擇失敗，請稍後再試」/ `Failed to save figure selection, please try again` 文案。
6. 在 read-only 分享或唯讀處理模式下，批次按鈕會停用，避免唯讀使用者修改圖表參考設定。

### 技術細節

- `FigureAssetsTab.tsx` 新增 `savingBatch` 狀態，批次儲存期間停用批次按鈕與每張圖表的 checkbox。
- `saveAllFigures(excluded)` 會先保留前一份 `figures`，再樂觀更新整頁圖表狀態；成功時沿用更新後狀態，失敗時 `setFigures(previous)` 復原 UI。
- 批次儲存仍使用 `savePageFigureSelection(pdfId, pageNumber, excludedIds)`，其中 `excludedIds` 由更新後所有 `excluded === true` 的圖表 id 組成，因此「全部使用」會送出空陣列，「全部排除」會送出本頁所有圖表 id。
- `zh-TW.ts` 與 `en.ts` 新增 `play.figures.useAll`、`play.figures.excludeAll`，沿用元件既有 `useI18n()`，讓中英文介面都顯示本地化按鈕文字。
- 錯誤處理沿用既有 `play.figures.saveError` 文案；當已有圖表資料時錯誤會顯示在清單上方，同時保留復原後的圖表清單供使用者確認。

## 重生進度元件 i18n 與英文介面

### 功能目的

播放頁的批次重生進度元件原本把「重生進度」、「逐字稿／語音／圖檔／動畫」、「等待中／執行中／已完成／失敗」、「預估剩餘」等文案直接寫在 `RegenerateProgress.tsx` 中。當使用者把界面語言切換成英文時，其他播放頁功能會跟著翻譯，但重生進度仍顯示中文，讓英文介面使用者不容易理解目前正在重產哪個步驟、是否完成或失敗，以及 ETA 代表什麼。

新版將重生進度所有 UI 文案接入既有 i18n 系統，讓播放頁在 `zh-TW` 與 `en` 之間切換時，重生進度卡片也會同步顯示對應語言，同時保留原本的進度百分比、步驟順序、預估剩餘時間與預計完成時間。

### 使用方式

1. 在設定頁將「界面文字語言」切換為繁體中文或 English。
2. 回到播放頁，使用「重生全部」或相關重產操作啟動批次重生任務。
3. 重生進度卡片會依目前界面語言顯示：
   - 中文：`重生進度`、`逐字稿`、`語音`、`圖檔`、`動畫`、`等待中`、`執行中`、`已完成`、`失敗`、`預估剩餘`。
   - 英文：`Regeneration progress`、`Transcript`、`Audio`、`Images`、`Animations`、`Pending`、`Running`、`Completed`、`Failed`、`Estimated remaining`。
4. 每個步驟仍維持原本顯示邏輯：待處理顯示等待中、失敗顯示錯誤訊息、執行或完成顯示 `{completed}/{total} ({ratio}%)`，目前步驟會額外顯示 ETA。
5. 若後端回傳 `estimated_completion_at`，卡片會在 ETA 後方顯示預計完成時間；若仍無 ETA，會顯示本地化的「計算中 / calculating」。

### 技術細節

- `RegenerateProgress.tsx` 改用 `useI18n()` 取得 `t()`，並以 `STEP_LABEL_KEYS` 將 `script`、`audio`、`image`、`animation` 對應到 `play.regenerate.step.*` 翻譯鍵。
- `zh-TW.ts` 與 `en.ts` 新增 `play.regenerate.*` 翻譯鍵，涵蓋任務狀態、步驟狀態、步驟計數、ETA、完成時間、錯誤 fallback 與進行中 suffix。
- `formatters.ts` 新增 `formatRegenerateJobStatus()`、`formatRegenerateStepStatus()`、`formatRegenerateEtaSummary()` 與 `formatRegenerateEta()`，讓狀態字串與 ETA 文案可用純函式測試，並避免元件內堆疊多層條件字串。
- `formatRegenerateEta()` 保留原本秒、分秒、小時分鐘的計算規則，只把單位與「約 / about」交給翻譯鍵處理。
- `formatters.test.ts` 新增 running/completed/failed 狀態文字與 ETA 格式測試，確保後續調整翻譯或狀態支援時不會回歸成硬編碼中文。

## 2026-06-18 TODO 重新檢視與新增方向

### 檢視目的

本次依照 `LOOP.md` 的規則，在 `TODO.md` 已沒有未完成項目時，重新檢查目前主要前端、後端與既有功能紀錄，補上一批可分次完成、範圍偏小、容易驗證且對使用者有直接價值的改進項目。檢查時特別避開近期已完成的首頁排序/搜尋、卡片語音長度、ZIP 匯入提示詞、YouTube 字幕快速選項、播放進度清除、耗時摘要、縮圖模式、分享權限與高橋流提示詞支援等項目，避免重複排程。

### 新增待辦方向

- **介面國際化與一致性**：`RegenerateProgress.tsx` 仍有中文硬編碼，新增待辦要求補齊中英文 i18n，讓英文介面使用者在重生頁面時也能理解狀態。
- **批次操作減少重複點擊**：`FigureAssetsTab.tsx` 目前逐張切換圖表參考素材，新增「全部使用／全部排除」待辦，讓圖表很多的頁面可快速整理。
- **課堂互動可重練**：`QuizBuilderPage.tsx` 的學生作答狀態可在前端清空，新增「重設作答」待辦，方便同一份測驗重練或課堂示範。
- **首頁整理能力補強**：首頁已有分類新增/刪除與簡報搬移，但缺少重新命名分類，新增待辦讓分類名稱修正不必手動搬移每份簡報。
- **後端可觀測與隱私風險降低**：後端 worker 與 OpenAI service 仍有多處 `console.log` 直接輸出 prompt/payload/raw response，新增待辦要求改為遮罩後的 logger 輸出。
- **長時間上傳可中止**：`uploadPdf()` 已有 `AbortSignal` 能力，新增待辦把取消上傳按鈕補到 `UploadButton.tsx`，改善大型 PDF 上傳或選錯檔案時的體驗。

### 檢查依據

- 文件：`TODO.md`、`BLOG.md`、`LOOP.md`。
- 主要前端：`HomePage.tsx`、`RegenerateProgress.tsx`、`FigureAssetsTab.tsx`、`QuizBuilderPage.tsx`、`UploadButton.tsx`、`frontend/src/lib/api/uploads.ts`。
- 主要後端：`backend/src/routes/pdfs/sync.ts`，以及後端 worker / OpenAI 呼叫流程中仍存在直接 `console.log` 的檔案。

## 高橋流 / 極簡大字投影片提示詞支援

### 功能目的

MakeSlide 的講稿生成預設會盡量讀懂投影片圖像、銜接前後頁、把內容講清楚，並在內容不足時適度補足語氣與轉場。這對一般教學簡報很有幫助，但若使用者想製作高橋流（Takahashi method/style）或類似「每頁只放一兩個重點、極簡大字、少字強節奏」的投影片，原本的一般規則可能會把太多條列、圖表細節或背景補充重新塞回逐字稿，造成每頁資訊量過高。

新版在提示詞組裝時加入明確的極簡風格偵測與優先規則：只要使用者 prompt 明確提到高橋流、Takahashi method/style、每頁只放一兩個重點、極簡大字投影片、少字等類似需求，系統會優先降低每頁重點數與文字量，避免一般模式的「完整講解」規則覆蓋掉使用者指定風格。沒有這類明確要求時，仍維持原本一般模式品質。

### 使用方式

1. 匯入 PDF、文字、YouTube 或新增簡報後，在開始處理前的提示詞欄位輸入風格需求。
2. 若要啟用高橋流 / 極簡模式，可使用例如：
   - `請用高橋流，每一頁只放一兩個重點，字要大。`
   - `Use Takahashi style. One or two key points per slide.`
   - `做成極簡大字投影片，文字越少越好。`
   - `每頁最多兩個重點，不要逐條解釋所有細節。`
3. 產生逐字稿時，系統會只挑每頁 1～2 個最核心重點，省略次要條列、案例、背景補充與逐項解釋。
4. 若原始投影片或文字內容很多，模型仍會讀取內容以判斷核心訊息，但不會把所有細節都講出來。
5. 若想回到一般教學模式，只要不要在使用者 prompt 中要求高橋流、極簡大字、每頁一兩個重點或少字風格即可；一般模式仍會完整濃縮並清楚講解投影片。

### 技術細節

- `generateScript.ts` 新增 `isMinimalSlideStyleRequested()`，以正規表示式偵測 `高橋流`、`Takahashi method/style`、`每頁只放一兩個重點`、`極簡大字`、`少字`、`one or two key points per slide`、`big type slides` 等中英文提示。
- 初稿 prompt 組裝新增高橋流 / 極簡大字模式優先規則；當偵測命中時，明確要求模型在與「充分利用圖像」、「適度展開」、「補足轉場」等一般規則衝突時，優先遵守低資訊密度風格。
- 字數限制提示在極簡模式下改為「建議更短、最多仍不可超過一般上限」，並明確要求不要為了達到原本目標字數而補細節或灌水。
- 整份逐字稿重寫 pass 也同步加入極簡規則，避免初稿已變短後，又被重寫流程補回次要細節或強制補到原本字數下限。
- OpenAI 與 Gemini 的單人 / 雙人 prompt 模板，以及 user style partial 都補上相同語意，確保不同 TTS provider 與 host mode 都能遵守使用者指定的極簡風格。
- 新增 `minimal-slide-style.test.ts`，覆蓋高橋流、Takahashi style、極簡大字、每頁最多兩個重點等命中案例，以及一般教學詳細提示不誤判的案例。

## 每份簡報獨立分享狀態與跨帳號列表可見性

### 功能目的

分享功能現在以「每一份簡報」為單位管理公開狀態，而不是只產生一條可存取連結。每份簡報都可維持 `private`，或在建立分享連結時切換為 `read-only` / `read-write`。當簡報被設為 `read-only` 或 `read-write` 後，除了既有分享連結仍可使用之外，其他已登入帳號也會在首頁列表看到這份簡報，方便團隊、課堂助教或共用工作站直接從清單開啟，不必每次重新貼連結。

### 使用方式

1. 進入要分享的簡報播放頁。
2. 在頁首分享控制選擇：
   - `read-only（列表可見）`：其他帳號會在首頁列表看到簡報，可瀏覽與播放，但不能修改標題、分類、投影片、逐字稿、動畫或重新產生內容。
   - `read-write（列表可見）`：其他帳號會在首頁列表看到簡報，且可依現有編輯 API 修改內容；AI 相關處理仍會使用該簡報擁有者帳號的設定與金鑰。
3. 點選「建立分享連結」後，系統會建立或重用同一模式的分享 token，複製分享 URL，並同步把簡報狀態更新為 `public`（read-only）或 `public_editable`（read-write）。
4. 若要停止跨帳號列表曝光，點選「設為 private」即可把該簡報改回 private；其他帳號之後不會在首頁列表看到它，也無法直接用一般列表入口開啟。
5. 透過分享連結開啟時仍保留連結本身的權限語意；透過首頁列表開啟 read-only 簡報時，播放頁會自動進入唯讀狀態，避免誤觸修改流程。

### 技術細節

- 後端沿用 `pdfs.visibility` 作為每份簡報分享狀態來源：`private` 對應私有、`public` 對應 read-only、`public_editable` 對應 read-write。
- `POST /api/pdfs/:id/share` 現在只允許簡報擁有者（或舊資料無擁有者情境）建立分享連結；建立 read-only 連結時會同步設定 `visibility = 'public'`，建立 editable 連結時會同步設定 `visibility = 'public_editable'`，並回傳目前 visibility 供前端更新狀態。
- `PATCH /api/pdfs/:id/visibility` 改成只有擁有者可變更分享狀態，避免 read-write 協作者把擁有者的簡報改回 private 或改變公開範圍。
- `GET /api/pdfs` 既有 `canReadPdf()` 過濾會把 `public` 與 `public_editable` 納入其他帳號可讀清單，因此建立分享連結後會自動出現在其他帳號首頁，不需要新增額外關聯表。
- `canEditPdf()` 仍將 `public` 視為不可編輯、`public_editable` 視為可編輯；標題、分類、頁面、新增來源、重產與動畫等既有寫入 API 會沿用此限制。
- 前端 `PdfListItem` / `PdfDetail` 型別補上 `owner_sub` 與 `visibility`，首頁點擊 read-only 共享且仍處於 awaiting prompt 的簡報時不會開啟提示詞編輯流程，而是直接進播放頁。
- 播放頁在沒有 share token 但 `detail.visibility === 'public'` 時，會套用與唯讀分享連結相同的 `shareIsReadOnly`/`isReadOnlyProcessing` 限制，確保列表入口與分享連結入口的修改權限一致。

## 播放頁縮圖模式與全螢幕高解析切換

### 功能目的

過去播放頁在一般播放、預覽與全螢幕都直接載入每頁完整 JPEG；當 PDF 頁面解析度較高時，單頁可能約 1.3MB，導致一般播放頁初次載入、切頁預抓與側欄預覽都佔用較多頻寬與記憶體。新版改為產生較適合播放區尺寸的 749x500 縮圖，並降低 PDF 頁面 JPEG 輸出品質；一般播放與預載優先使用縮圖，只有進入全螢幕時才切換回原全圖，讓日常瀏覽更快，同時保留投影或全螢幕授課時需要的清晰度。

### 使用方式

1. 新匯入或重新產生的 PDF 頁面會自動建立 `pages/<page_uid>.thumb.jpg`，尺寸限制為 749x500 以內並維持原比例。
2. 在播放頁的一般模式下，主要投影片區會優先載入 `thumbnail_url`，切頁預載也會先抓縮圖，降低初次播放與連續切頁的流量。
3. 點選播放頁的全螢幕或投影模式後，畫面會改用原本的 `image_url` 全圖，以保留大螢幕顯示品質。
4. 若開啟的是舊資料、同步資料或匯入資料而尚未存在縮圖，後端 `/api/pdfs/:id/pages/:n/thumbnail` 會在第一次請求時嘗試補產生；前端也會在 `thumbnail_url` 不存在時自動 fallback 到 `image_url`，因此既有簡報仍可正常播放。
5. 重新替換圖片、重新生成圖片、還原圖片版本或文字/LLM 圖片生成流程都會同步重建縮圖，確保一般播放看到最新內容。

### 技術細節

- 後端 `thumbnails.ts` 將頁面縮圖尺寸從原本小型側欄縮圖調整為 `PAGE_THUMBNAIL_WIDTH_PX = 749`、`PAGE_THUMBNAIL_HEIGHT_PX = 500`，以 `fit: 'inside'` 維持比例並避免放大來源圖。
- 頁面縮圖 JPEG 品質改為 `62` 並啟用 `mozjpeg`，目標是讓一般播放使用的圖片明顯小於完整頁面 JPEG。
- PDF 頁面渲染流程 `renderPages.ts` 的完整頁面 JPEG 品質從 `82` 降為 `72`，降低新匯入 PDF 的全圖大小；全螢幕仍使用這份全圖。
- `PlayPage.tsx` 新增 `playbackImageSrc` 與 `fullscreenImageSrc`：一般播放優先 `thumbnail_url ?? image_url`，全螢幕優先 `image_url ?? thumbnail_url`。
- `PlayPageSlidePanel.tsx` 改用 `playbackImageSrc` 顯示一般播放投影片；`PlayPageFullscreen.tsx` 改用 `fullscreenImageSrc`，確保全螢幕才載入全圖。
- `PlayPageContext.tsx` 將兩種圖片來源提供給子元件，避免各元件自行重複判斷，並保留 `targetImageSrc` 作為目前模式的預載目標。

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

## 播放頁貼上與拖曳重排偵錯訊息靜音

### 功能目的

播放頁的縮圖管理同時支援貼上圖片（取代目前頁或目標頁圖片）與用滑鼠拖曳縮圖重新排序頁面。開發階段為了確認瀏覽器貼上事件、clipboard item 型別與拖曳起止頁碼是否正確觸發，`PlayPageSidebar.tsx`、`PlayPageSlidePanel.tsx` 與 `PlayPage.tsx` 都直接呼叫 `console.info` / `console.warn` 印出這些細節。這些訊息對一般使用者沒有意義，卻會在每次貼圖、拖曳排序時固定出現在瀏覽器主控台，干擾正常除錯與一般操作體感。

新版把這些偵錯輸出集中到一個預設靜音、可明確開啟的 helper，讓一般使用者操作時 console 保持乾淨，開發者仍可在需要時手動開啟相同的訊息。

### 使用方式

1. 一般使用者不需要做任何事：操作播放頁的貼上圖片、拖曳重排投影片時，瀏覽器主控台不會再出現 `[paste][...]` 或 `[reorder][...]` 偵錯訊息。
2. 開發者若需要重新查看這些訊息，於瀏覽器主控台執行 `localStorage.setItem('makeslide.debug', '1')` 後重新整理頁面即可恢復輸出；要關閉時執行 `localStorage.removeItem('makeslide.debug')`。
3. 貼上找不到圖片檔案、或拖曳排序資料不完整等情境仍會在程式內被忽略處理（例如不觸發替換/搬移），不影響既有使用者可見的錯誤提示與互動行為。

### 技術細節

- 新增 `frontend/src/lib/debugLog.ts`，提供 `debugLog()` / `debugWarn()`：兩者都先檢查 `localStorage.getItem('makeslide.debug') === '1'`，未開啟時直接是 no-op，讀取 `localStorage` 失敗時也安全降級為不輸出。
- `PlayPageSidebar.tsx` 的縮圖拖曳 `onDropCapture`、貼上 `onPaste`、拖曳按鈕 `onDragStart` / `onDragEnd` 共 5 處 `console.info/warn` 全部改用 `debugLog` / `debugWarn`。
- `PlayPageSlidePanel.tsx` 的投影片區 `onPaste`（事件詳情與無檔案警告）改用同一組 helper。
- `PlayPage.tsx` 的全域 `window.addEventListener('paste', ...)` 偵錯輸出（事件觸發、clipboard items、無圖片警告、接受圖片摘要）一併改用 helper，維持與側欄/投影片區一致的靜音行為。
- 所有改動處原本的 `// eslint-disable-next-line no-console` 註解一併移除，因為呼叫已不再直接使用 `console.*`。
- 與貼上/拖曳無關的既有偵錯輸出（例如 `PlayPage.tsx` 中的 `[sync][poll]`、`[tts][regenerate-audio]` 等同步與語音除錯訊息）不在本次調整範圍內，維持原狀。
- 已執行 frontend `tsc --noEmit` typecheck 確認型別正確。

## 來源管理「複製內容」與「全部收合」

### 功能目的

播放頁的來源管理可以展開查看 TXT、PDF 與 YouTube 來源的完整文字內容，方便確認生成逐字稿時實際送出了哪些補充資料。過去只能用滑鼠在展開的內容區手動選取再複製，內容較長或想貼到其他地方核對時很不方便；展開多筆來源後，畫面也只能逐筆點擊收合，沒有一次清空所有展開狀態的方式。

新版在每個有內容的來源列加入「複製內容」按鈕，並在來源清單標題旁加入「全部收合」按鈕，讓整理與複製來源內容更快速。

### 使用方式

1. 進入播放頁，切到「來源 / Sources」分頁，在「來源管理」區塊查看目前來源清單。
2. 任何已有內容的來源列（TXT、PDF 擷取文字，或有逐字稿的 YouTube 來源）右側會出現「複製內容 / Copy content」按鈕，點擊會把該筆來源完整文字複製到剪貼簿；複製成功時按鈕文字會短暫變成「已複製 / Copied」，2 秒後自動還原。
3. 若瀏覽器拒絕或不支援剪貼簿存取，畫面會在該筆來源下方顯示「複製失敗，請手動選取內容後複製。」/ 對應英文提示，使用者仍可照舊手動選取文字複製。
4. 當任一筆來源處於展開狀態時，清單標題旁會出現「全部收合 / Collapse all」按鈕，點擊後會一次把所有展開內容收合回摘要列，沒有展開項目時此按鈕不會顯示。

### 技術細節

- `PlayPageSlidePanel.tsx` 重用既有 `frontend/src/lib/clipboard.ts` 的 `copyTextToClipboard()`，不新增剪貼簿邏輯；新增本地狀態 `sourceCopyStatus: Record<number, 'success' | 'error'>` 記錄每筆來源目前的複製結果，並用 `setTimeout` 在 2 秒後自動清除該筆狀態。
- 複製按鈕在一般 TXT/PDF 來源列與 YouTube audio 來源列都會渲染（只要 `content_text` 非空字串），並以 `e.stopPropagation()` 避免點擊複製按鈕時誤觸發展開/收合來源內容的點擊事件。
- 「全部收合」只呼叫既有 `setExpandedSourceId(null)`，沒有新增展開狀態的資料結構；按鈕本身只在 `expandedSourceId !== null` 時渲染。
- `zh-TW.ts` / `en.ts` 新增 `play.source.copyContent`、`play.source.copyContentSuccess`、`play.source.copyContentFailed`、`play.source.collapseAll`，並在 `frontend/src/i18n.test.ts` 新增測試確認中英文都有對應非空字串。
- 此功能未新增或修改任何後端 API 或資料庫欄位，純前端 UI 與狀態調整。

## 「最近的簡報」預設改回建立時間新到舊

### 功能目的

首頁的「排序方式」選單上線後，所有類別（包含「最近的簡報」）共用同一個排序偏好，這讓排序行為在切換類別時保持一致，但也讓「最近的簡報」這個原本用來快速查看新內容的視圖，在使用者從未手動調整過排序時，預設顯示成標題 A-Z，反而要多一個步驟才能看到最新匯入的簡報。

新版讓「排序方式」在使用者尚未手動選擇過時，依目前所在的類別給出更貼近使用情境的預設值：一般分類與「全部類別」維持標題 A-Z，而「最近的簡報」預設改為建立時間新到舊；使用者一旦手動選擇任何排序方式，該選擇仍會照舊套用到所有類別並記住，行為與既有「排序選項」功能一致。

### 使用方式

1. 第一次（或尚未手動調整排序方式）進入首頁時，「全部類別」與一般分類預設仍是「標題 A-Z」。
2. 切換到「最近的簡報」時，若還沒有手動選過排序方式，「排序方式」下拉選單會自動顯示並套用「建立時間新到舊」，最新匯入或建立的簡報會排在前面。
3. 若使用者在任何類別手動改選排序方式（例如選擇「更新時間新到舊」），這個選擇會被記住並套用到包括「最近的簡報」在內的所有類別，直到使用者再次手動調整。

### 技術細節

- `HomePage.tsx` 新增 `getDefaultSortModeForCategory(categoryFilter)`：`categoryFilter === '__recent__'` 時回傳 `'created_desc'`，其餘情況回傳 `'title_asc'`。
- `readStoredSortMode()` 改為回傳 `SortMode | null`，本機沒有有效儲存值時回傳 `null`，藉此和「使用者尚未手動選擇」的狀態區分開來。
- 元件內部用 `explicitSortMode`（持久化的使用者明確選擇，可能是 `null`）取代先前直接持久化的 `sortMode`；實際套用的 `sortMode = explicitSortMode ?? getDefaultSortModeForCategory(categoryFilter)`，因此沒有明確選擇時會隨目前類別動態變化，一旦使用者透過下拉選單選擇過，就會固定套用該選擇並寫入 `makeslide.home.sortMode`。
- 新增 `frontend/src/pages/HomePage.sort.test.ts`，以 Node 內建 test runner（透過 `tsx --test` 執行）驗證 `getDefaultSortModeForCategory()` 在「最近的簡報」與一般/全部/自訂分類下的預設值正確。

## read-only 模式禁止同步到 GitHub

### 功能目的

播放頁的「同步到 GitHub」會把目前簡報內容推送到設定中的 GitHub repository，屬於會改變外部狀態的寫入動作。過去這個按鈕只受「同步中」狀態鎖定，唯讀分享連結或公開只讀（`visibility: 'public'`）的瀏覽者也能點擊並觸發推送；後端 `POST /api/pdfs/:id/github-sync` 同樣完全沒有檢查請求者是否擁有編輯權限，只檢查簡報是否存在與 GitHub 是否設定。

新版讓「同步到 GitHub」遵循與其他寫入動作一致的權限規則：唯讀使用者（無論是處理中的暫時唯讀，還是分享/公開的唯讀模式）在前端會看到按鈕被停用，後端也會在權限不足時直接拒絕請求，不依賴前端 UI 作為唯一防線。

### 使用方式

1. 一般擁有者或取得 read-write 分享連結／`public_editable` 簡報的使用者操作不受影響，仍可正常點擊「同步到 GitHub」。
2. 透過 read-only 分享連結開啟，或簡報目前仍在處理中（尚未 ready）時，「同步到 GitHub」按鈕會顯示為停用狀態，滑鼠停留會看到「唯讀模式下無法同步到 GitHub」提示，不會發出請求。
3. 若有人略過前端限制直接呼叫 API（例如用其他工具直接打 `POST /api/pdfs/:id/github-sync`），後端會依簡報的 `owner_sub` 與 `visibility` 判斷：非擁有者對 `private` 或 `public`（read-only）簡報的請求一律回傳 `403 FORBIDDEN`；擁有者本人或 `public_editable` 簡報的任何登入使用者仍可通過權限檢查繼續走原本的同步流程。

### 技術細節

- `backend/src/routes/pdfs/admin.ts` 新增與 `detail.ts` 一致的本地 `sessionSub()` / `canEditPdf()`：`owner_sub` 為空（舊資料）視為允許、請求者 sub 等於 `owner_sub` 允許、`visibility === 'public_editable'` 允許，其餘（包含 `private` 非擁有者與 `public` 唯讀）一律拒絕。
- `github-sync` 路由查詢 PDF 時補上 `owner_sub`、`visibility` 欄位，並在「GitHub 是否已設定 repo」檢查之前先做權限檢查，沒有編輯權限時回傳 `403 FORBIDDEN`，不會洩漏是否已設定 GitHub repo 的資訊給無權限的請求者。
- 前端 `PlayPageHeader.tsx` 的「同步到 GitHub」按鈕 `disabled` 改為 `githubSyncBusy || isReadOnlyProcessing`，並在唯讀時把按鈕 `title` 換成新增的 `play.header.githubSyncReadOnly`（中英文皆已新增翻譯）。
- `usePdfMetadata.ts` 的 `handleSyncToGithub()` 同步加上 `isReadOnlyProcessing` 的早期 return，確保即便繞過按鈕本身的 disabled 屬性呼叫這個 handler，也不會送出請求。
- 新增 `backend/test/github-sync.test.ts`，覆蓋非擁有者對 `public`/`private` 簡報請求應得 403、擁有者與 `public_editable` 協作者應通過權限檢查（測試環境未設定 GitHub repo，因此驗證它們會落在 `GITHUB_NOT_CONFIGURED` 400 而非 403，藉此證明沒有被權限擋下）。

## read-only 模式統一停用設定/風格/分享按鍵

### 功能目的

播放頁的「⚙️ 設定」（語音/TTS 設定）與「🖼️ 風格」（圖片風格設定）按鈕已經會在唯讀模式下停用，但分享區塊的三個控制項——分享存取模式（唯讀/可編輯）下拉選單、「建立分享連結」按鈕、「設為 private」按鈕——只檢查是否正在送出請求（`shareBusy`），沒有檢查唯讀狀態。這代表透過唯讀分享連結或瀏覽公開唯讀簡報的人，理論上仍能在 UI 上嘗試切換分享模式或建立新的分享連結，即使背後的 handler 部分已經有防呆，畫面上看不出按鍵其實不該被觸發。

新版讓播放頁所有設定/風格/分享相關的按鍵在唯讀模式下都呈現一致的停用樣式，避免使用者誤以為可以操作。

### 使用方式

1. 一般擁有者或取得可編輯權限的使用者操作不受影響，仍可正常開啟語音設定、圖片風格設定，以及切換分享模式、建立分享連結或設為 private。
2. 透過唯讀分享連結開啟，或簡報仍在處理中尚未 ready 時，頁首的「設定」「風格」按鈕（先前已是如此）以及分享存取模式下拉選單、「建立分享連結」「設為 private」按鈕都會顯示為停用樣式，無法點擊或選擇。

### 技術細節

- `PlayPageHeader.tsx` 的分享存取模式 `<select>` 新增 `disabled={isReadOnlyProcessing}`；「建立分享連結」與「設為 private」按鈕的 `disabled` 從只看 `shareBusy` 改為 `shareBusy || isReadOnlyProcessing`，三者皆補上 `disabled:cursor-not-allowed disabled:opacity-40` 樣式，與其他唯讀停用按鈕一致。
- `usePdfMetadata.ts` 的 `handleCreateShareLink()` 補上 `isReadOnlyProcessing` 早期 return（`handleMakeSharePrivate()` 先前已有此防呆，這次只是讓 UI 跟著反映），避免即使繞過按鈕點擊直接呼叫 handler 也會送出請求。
- 確認後端 `POST /api/pdfs/:id/share`（`hasOwnerOrLegacyAccess`）與 `PATCH /api/pdfs/:id/visibility`（`canEditPdf`）已有擁有權限檢查，這次調整純粹是讓前端 UI 狀態與既有後端限制一致，不需修改後端。

## 動畫與畫板 API 補上編輯權限檢查

### 功能目的

播放頁的動畫編輯（每頁特效設定、AI 自動產生焦點動畫、AI 自訂腳本動畫）與畫板（手寫標註）功能，後端 API 過去完全沒有檢查請求者是否擁有編輯這份簡報的權限——只要知道 PDF id，任何已登入帳號都能修改別人唯讀分享或公開簡報的動畫設定與畫板內容，這與 `detail.ts` 中大多數寫入路由都有的 `canEditPdf()` 檢查不一致，也與前一輪修復的 GitHub 同步權限缺口屬於同一類問題。

新版讓動畫與畫板的寫入 API 都遵循與其他簡報寫入動作一致的權限規則：唯讀使用者無法透過直接呼叫 API 修改這些內容。

### 使用方式

1. 一般擁有者或取得 read-write 分享/`public_editable` 簡報的使用者操作不受影響，仍可正常編輯動畫效果、使用 AI 產生焦點動畫或自訂腳本動畫，以及繪製/清除畫板標註。
2. 透過唯讀分享連結或瀏覽公開唯讀簡報的使用者，前端本來就已經停用動畫編輯與畫板工具，現在即使有人略過前端直接呼叫 API（例如 `PUT /api/pdfs/:id/pages/:n/animation`、`POST /api/pdfs/:id/pages/:n/animation/auto-focus-ai`、`POST /api/pdfs/:id/pages/:n/animation/custom-script`、`PUT`/`DELETE /api/pdfs/:id/pages/:n/drawing`），後端也會回傳 `403 FORBIDDEN`，不會真的寫入或產生內容。
3. 讀取目前動畫設定（`GET /animation`、`GET /animation/spec`）與畫板內容（`GET /drawing`）維持公開讀取，因為播放頁仍需要在唯讀模式下正常顯示既有動畫與畫板內容。

### 技術細節

- `backend/src/routes/pdfs/page-animation.ts` 與 `backend/src/routes/pdfs/drawings.ts` 都新增與 `detail.ts`/`admin.ts` 一致的本地 `sessionSub()` + `canEditPdf(owner_sub, visibility)`，沿用「`owner_sub` 為空視為允許、請求者等於擁有者允許、`visibility === 'public_editable'` 允許，其餘拒絕」的規則。
- 動畫路由的 `custom-script` 端點會用 `reply.hijack()` 切換成 SSE 串流回應；權限檢查特別放在 `hijack()` 之前執行，確保權限不足時收到的是一般 JSON `403` 而不是進入串流後才報錯。
- 畫板路由的 `PUT`/`DELETE` 過去完全沒有檢查 PDF 是否存在，這次順帶補上 `404 PDF_NOT_FOUND`，避免對不存在的簡報寫入孤兒 `page_drawings` 列。
- 修復過程中發現 `backend/test/page-animation.test.ts` 既有的硬編碼 session cookie 簽章是用舊版 `AUTH_SESSION_SECRET` 產生的，與目前環境的密鑰不符；先前因為這些路由完全不驗證 session 而沒被測試發現，加上權限檢查後該測試檔案大量失敗。改用與 `pages-api.test.ts`/`github-sync.test.ts` 一致、即時用目前 `config.authSessionSecret` 簽章的 `testSessionCookie()` 動態產生 cookie 解決，避免測試環境密鑰漂移造成的脆弱性。
- 新增 3 個權限測試到 `page-animation.test.ts`，並新增 `backend/test/drawings.test.ts` 6 個測試，覆蓋公開讀取、非擁有者在 `public`/`private` 簡報應得 403、擁有者與 `public_editable` 協作者應可寫入、未知簡報應得 404。

## 測驗寫入路由補上編輯權限檢查

### 功能目的

課堂測驗的產生、新增與更新 API 過去完全沒有檢查請求者是否擁有編輯這份簡報的權限，任何已登入帳號只要知道 PDF id，就能在別人唯讀分享或公開的簡報上產生新測驗、新增測驗或修改既有測驗題目，與動畫/畫板、GitHub 同步等已修復的權限缺口屬於同一類問題。

新版讓測驗的寫入 API 遵循與其他簡報寫入動作一致的權限規則，同時保留測驗本身「給學生作答」的公開性質：列出測驗與提交作答仍維持公開，因為唯讀瀏覽者與課堂同步測驗的 follower 本來就需要能看到題目並送出答案。

### 使用方式

1. 一般擁有者或取得 read-write 分享/`public_editable` 簡報的使用者操作不受影響，仍可正常使用「測驗生成」頁面以 AI 產生測驗、新增測驗或編輯既有測驗題目。
2. 唯讀分享或公開唯讀簡報的瀏覽者，前端「測驗生成」連結本來就已停用，現在即使有人略過前端直接呼叫 `POST /api/pdfs/:id/quizzes/generate`、`POST /api/pdfs/:id/quizzes`、`PUT /api/pdfs/:id/quizzes/:quizId`，後端也會回傳 `403 FORBIDDEN`，不會真的產生或修改測驗內容。
3. 學生（follower）在課堂同步測驗中提交答案（`POST /api/pdfs/:id/quizzes/:quizId/attempts`）與一般瀏覽測驗清單（`GET /api/pdfs/:id/quizzes`）完全不受影響，不需要編輯權限即可正常使用。

### 技術細節

- `backend/src/routes/pdfs/quizzes.ts` 新增與其他寫入路由一致的本地 `sessionSub()` + `canEditPdf(owner_sub, visibility)`。
- `POST /quizzes/generate` 延伸既有的 PDF 查詢補上 `owner_sub`/`visibility` 欄位，在呼叫 LLM 產生題目之前先做權限檢查，避免無權限的請求白白消耗 LLM 額度。
- `POST /quizzes`（新增測驗）過去完全沒有檢查 PDF 是否存在，這次一併補上 `404 PDF_NOT_FOUND`，並在寫入前檢查編輯權限。
- `PUT /quizzes/:quizId`（更新測驗）同樣在更新前檢查編輯權限，避免唯讀使用者覆寫既有測驗題目。
- 新增 `backend/test/quizzes.test.ts` 6 個測試，覆蓋 generate/create/update 對非擁有者的唯讀分享簡報應得 403、create 對未知簡報應得 404、擁有者與 `public_editable` 協作者應可正常操作、attempts 提交不受權限限制仍可成功送出。

## 頁面操作 API 全面補上編輯權限檢查

### 功能目的

播放頁的投影片編輯功能——新增頁、移動頁、刪除頁、替換圖片、AI 重生圖片（含 inpaint 局部重繪）、改寫逐字稿、重生語音、頁面內容對話與清空對話記錄——這些寫入 API 過去全部沒有檢查請求者是否擁有編輯這份簡報的權限，是目前後端權限缺口中影響範圍最大的一批路由，與先前已修復的 GitHub 同步、動畫/畫板、測驗權限缺口屬於同一類問題，但涉及的路由數量明顯更多。

新版讓這 10 個寫入路由全部遵循與其他簡報寫入動作一致的權限規則，同時保留讀取候選圖與對話記錄的公開性，因為唯讀瀏覽者仍需要正常瀏覽既有內容。

### 使用方式

1. 一般擁有者或取得 read-write 分享/`public_editable` 簡報的使用者操作不受影響，仍可正常新增/移動/刪除投影片、替換或重生圖片、改寫逐字稿、重生語音，以及使用頁面內容對話功能。
2. 唯讀分享或公開唯讀簡報的瀏覽者，前端本來就已經停用這些編輯動作；現在即使有人略過前端直接呼叫對應 API，後端也會回傳 `403 FORBIDDEN`，不會真的修改投影片內容、消耗 AI 額度或寫入對話記錄。
3. 讀取既有候選圖（`GET /pages/:n/image-candidates/:candidateId`）與頁面對話記錄（`GET /pages/:n/chat-history`）維持公開讀取，不受影響。

### 技術細節

- `backend/src/routes/pdfs/page-operations.ts` 新增與其他寫入路由一致的本地 `sessionSub()` + `canEditPdf(owner_sub, visibility)` + `getPdfPermissionRow()`。
- 補上權限檢查的 10 個路由：`POST /pages`（新增頁）、`POST /pages/move`（移動頁）、`DELETE /pages/:n`（刪除頁）、`POST /pages/:n/replace-image`、`POST /pages/:n/regenerate-image`、`POST /pages/:n/inpaint-image`、`POST /pages/:n/rewrite-script`、`POST /pages/:n/regenerate-audio`、`DELETE /pages/:n/chat-history`、`POST /pages/:n/chat`。
- 多數路由本來就會查詢 pdf row 取得 `page_count`、`user_prompt` 等其他用途的欄位，這次盡量延伸既有 SELECT 補上 `owner_sub`/`visibility`，避免新增重複查詢；`chat-history` 的 DELETE 與 `chat` 的 POST 過去完全沒有查詢 pdf 權限，新增獨立的 `getPdfPermissionRow()` 查詢。
- 涉及 AI 呼叫的路由（`regenerate-image`、`inpaint-image`、`rewrite-script`、`regenerate-audio`、`chat`）權限檢查都放在呼叫 OpenAI/TTS 之前，避免無權限的請求白白消耗 LLM 或 TTS 額度。
- 新增 `backend/test/page-operations-permission.test.ts` 15 個測試：全部 10 個寫入路由對非擁有者的唯讀分享簡報應得 403（`replace-image`/`inpaint-image` 用最小 multipart payload 測試，因為權限檢查發生在解析檔案內容之前，不需要真正的圖片資料）；新增頁/移動頁/刪除頁/清空對話記錄對擁有者應正常成功；`public_editable` 協作者應能通過權限檢查。

## TtsDialog 語音/生成設定對話框補齊 i18n

### 功能目的

播放頁頁首「⚙️ 設定」按鈕開啟的語音與生成設定對話框（`TtsDialog.tsx`）負責調整 TTS 聲音、主持模式（單人旁白／雙人對談）、語速與逐字稿每頁上限字數，是調整簡報生成參數的主要入口之一。過去這個對話框完全沒有接上 i18n 系統，標題、各欄位標籤、提示文字與按鈕文字都直接寫成中文；即使使用者已把界面語言切換成 English，這個對話框仍會顯示中文，和已完成 i18n 的其他播放頁元件不一致。

新版讓 `TtsDialog.tsx` 跟隨全站界面語言設定顯示對應語言文字。

### 使用方式

1. 進入「設定」頁，將「界面文字語言」切換為「繁體中文」或「English」。
2. 回到任一簡報播放頁，點擊頁首「設定 / Settings」按鈕開啟語音設定對話框，所有文字（標題、聲音、主持模式、單人旁白／雙人對談、雙人對談說明、速度、逐字稿每頁上限字數、留空使用系統預設提示、placeholder、關閉、儲存中／儲存設定）都會依目前界面語言顯示。
3. 唯讀模式下對話框仍會依既有 `isReadOnlyProcessing` 邏輯停用各項控制，行為不受本次調整影響。

### 技術細節

- `TtsDialog.tsx` 新增 `useI18n()`，將所有先前硬編碼中文文字改為 `t('play.ttsDialog.*')` 翻譯鍵呼叫。
- `zh-TW.ts` 與 `en.ts` 新增 13 個 `play.ttsDialog.*` 翻譯鍵：`title`、`voice`、`hostMode`、`hostModeSolo`、`hostModeDual`、`hostModeHint`、`speed`、`scriptMaxChars`、`scriptMaxCharsHint`、`scriptMaxCharsPlaceholder`、`close`、`saving`、`save`。
- 既有的 `isReadOnlyProcessing`/`ttsBusy` 停用邏輯、聲音清單渲染（`geminiVoiceLabel`/`openaiVoiceLabel`）、速度滑桿與逐字稿字數輸入驗證皆未變更，純粹替換文字來源。
- `frontend/src/i18n.test.ts` 新增測試驗證上述 13 個翻譯鍵在中英文 locale 中都存在且為非空字串。

## ImageStyleDialog 圖片風格設定對話框補齊 i18n

### 功能目的

播放頁頁首「🖼️ 風格」按鈕開啟的圖片風格設定對話框（`ImageStyleDialog.tsx`）讓使用者套用風格模板或自行填寫整份簡報重生圖片時要使用的風格提示詞。這個對話框過去完全沒有接上 i18n 系統，標題、說明、按鈕與輸入框 placeholder 都直接寫成中文，和已完成 i18n 的「設定」對話框等其他播放頁元件不一致。

新版讓 `ImageStyleDialog.tsx` 跟隨全站界面語言設定顯示對應語言文字。

### 使用方式

1. 進入「設定」頁，將「界面文字語言」切換為「繁體中文」或「English」。
2. 回到任一簡報播放頁，點擊頁首「風格 / Style」按鈕開啟圖片風格設定對話框，標題、說明段落、「套用模板」按鈕、提示詞輸入框 placeholder、「關閉」與「儲存設定」按鈕都會依目前界面語言顯示。
3. 唯讀模式下對話框仍會依既有 `isReadOnlyProcessing` 邏輯停用模板套用與儲存，行為不受本次調整影響。

### 技術細節

- `ImageStyleDialog.tsx` 新增 `useI18n()`，將所有先前硬編碼中文文字改為 `t('play.imageStyleDialog.*')` 翻譯鍵呼叫。
- `zh-TW.ts` 與 `en.ts` 新增 6 個 `play.imageStyleDialog.*` 翻譯鍵：`title`、`description`、`applyTemplate`、`promptPlaceholder`、`close`、`save`。
- 模板下拉選單的 `.map()` 參數從 `t` 改名為 `template`，避免與 `useI18n()` 取出的 `t()` 翻譯函式同名造成閱讀混淆；純粹改名，不影響行為。
- 既有 `isReadOnlyProcessing` 停用邏輯、模板套用（`onApplyTemplate`）與儲存（`onSave`）行為皆未變更。
- `frontend/src/i18n.test.ts` 新增測試驗證上述 6 個翻譯鍵在中英文 locale 中都存在且為非空字串。

## VersionHistoryDialog 版本歷史對話框補齊 i18n

### 功能目的

播放頁的圖片與逐字稿版本歷史對話框（`VersionHistoryDialog.tsx`）讓使用者瀏覽每次重生留下的歷史版本、預覽並還原到指定版本。這個對話框過去完全沒有接上 i18n 系統，標題、清單狀態文字、預覽提示與按鈕都直接寫成中文。

新版讓 `VersionHistoryDialog.tsx` 跟隨全站界面語言設定顯示對應語言文字。

### 使用方式

1. 進入「設定」頁，將「界面文字語言」切換為「繁體中文」或「English」。
2. 回到任一簡報播放頁開啟圖片或逐字稿版本歷史，標題（圖片/逐字稿版本歷史＋頁碼）、左側清單的「載入中…」/「尚無版本記錄」、右側預覽區的「點選左側版本以預覽」、圖片替代文字、底部「關閉」與「還原中…」/「還原至此版本」都會依目前界面語言顯示。
3. 版本清單每筆記錄旁顯示的日期時間維持原有格式（固定以 `zh-TW` locale 顯示），不隨界面語言切換，與 TODO 待辦明確要求一致。

### 技術細節

- `VersionHistoryDialog.tsx` 新增 `useI18n()`；標題不再用字串拼接「{圖片|逐字稿}版本歷史」，改為依 `versionHistoryType` 選擇 `play.versionHistory.titleImage` 或 `titleScript` 完整句子，避免不同語言詞序問題；頁碼後綴改用 `play.versionHistory.pageSuffix` 搭配 `.replace('{page}', ...)`。
- `zh-TW.ts` 與 `en.ts` 新增 10 個 `play.versionHistory.*` 翻譯鍵：`titleImage`、`titleScript`、`pageSuffix`、`loading`、`empty`、`selectPrompt`、`imageAlt`、`close`、`restoring`、`restore`。
- 版本清單的 `new Date(entry.date).toLocaleString('zh-TW', { dateStyle: 'short', timeStyle: 'short' })` 維持不變，刻意不隨界面語言切換。
- `frontend/src/i18n.test.ts` 新增測試驗證上述 10 個翻譯鍵在中英文 locale 中都存在且為非空字串。

## ShareDialog 補上 Clipboard fallback 與 i18n

### 功能目的

播放頁建立分享連結後彈出的對話框（`ShareDialog.tsx`）讓使用者複製分享 URL。過去「複製連結」按鈕直接呼叫 `navigator.clipboard.writeText()`，若瀏覽器不支援 Clipboard API、處於非安全來源，或使用者拒絕剪貼簿權限，複製會靜默失敗，而原本的失敗訊息（`onCopyError` 觸發的 `shareError` 狀態）顯示在頁首，被這個對話框的全螢幕背景遮住，使用者很可能完全看不到失敗提示。這個對話框過去也完全沒有接上 i18n，標題、說明與按鈕都是硬編碼中文。

新版讓「複製連結」改用既有共用 Clipboard helper，並把成功/失敗狀態直接顯示在對話框內，同時補齊 i18n。

### 使用方式

1. 在播放頁建立分享連結後，對話框會顯示分享 URL 與「複製連結」按鈕。
2. 點擊「複製連結」：
   - 支援 Clipboard API 且權限允許時會直接複製，按鈕文字短暫變成「已複製 / Copied」。
   - Clipboard API 不可用或被拒時，會自動嘗試 textarea selection + `execCommand('copy')` fallback。
   - 兩種方式都失敗時，對話框內會直接顯示「複製失敗，請手動選取上方連結後複製。」/ 對應英文提示，不再需要關閉對話框才能看到。
3. 上方唯讀 textarea 取得焦點時仍會自動全選，方便在自動複製失敗時手動選取複製。
4. 進入「設定」頁切換「界面文字語言」後，這個對話框的標題、說明與按鈕文字會跟著切換為繁體中文或 English。

### 技術細節

- `ShareDialog.tsx` 的「複製連結」改用 `frontend/src/lib/clipboard.ts` 的 `copyTextToClipboard()`，取代直接呼叫 `navigator.clipboard.writeText()`。
- 新增本地 `copyStatus: 'idle' | 'success' | 'error'` 狀態：成功時按鈕文字短暫顯示「已複製」，失敗時在 textarea 下方顯示 i18n 錯誤訊息。
- 仍維持呼叫既有 `onCopySuccess`/`onCopyError` props（不變更元件介面），因此 `PlayPageDialogs.tsx` 呼叫端不需修改；父層 `shareMessage`/`shareError` 狀態繼續用於對話框關閉後的訊息延續。
- 新增 `useI18n()` 與 6 個 `play.shareDialog.*` 翻譯鍵：`title`、`description`、`copyLink`、`copied`、`copyFailed`、`close`，`zh-TW.ts`/`en.ts` 同步補上。
- `frontend/src/i18n.test.ts` 新增測試驗證上述 6 個翻譯鍵在中英文 locale 中都存在且為非空字串。

## 修復簡報刪除 API 完全缺少權限檢查的安全缺口

### 功能目的

`DELETE /api/pdfs/:id`（首頁刪除簡報所呼叫的 API）過去只檢查簡報是否存在，完全沒有檢查請求者是否擁有這份簡報的編輯權限——任何已登入帳號只要知道簡報 id，就能刪除別人的簡報，包含資料庫紀錄與儲存目錄中的所有檔案，且這個動作無法復原。這是目前已知後端權限缺口中影響最嚴重的一項，與先前已修復的 GitHub 同步、動畫/畫板、測驗、頁面操作等權限缺口屬於同一類問題，但這次是完整刪除而非部分修改。

新版讓刪除 API 遵循與其他簡報寫入動作一致的權限規則。

### 使用方式

1. 一般擁有者或取得 read-write 分享/`public_editable` 簡報的使用者操作不受影響，仍可在首頁正常刪除自己的簡報（前端 `PdfCard.tsx` 原本就有 `window.confirm()` 二次確認，這次調整不影響該流程）。
2. 非擁有者對唯讀分享（`public`）或私有（`private`）簡報的刪除請求，後端會回傳 `403 FORBIDDEN`，簡報資料與檔案完全不會被觸碰。

### 技術細節

- `backend/src/routes/pdfs/delete.ts` 新增與其他寫入路由一致的本地 `sessionSub()` + `canEditPdf(owner_sub, visibility)`。
- 查詢 PDF 是否存在的 SELECT 補上 `owner_sub`、`visibility` 欄位，在執行 `DELETE FROM pdfs` 與 `removePdfDir()`（清除儲存目錄）之前先做權限檢查，確保權限不足時完全不會執行任何刪除動作。
- 新增 `backend/test/delete-permission.test.ts` 4 個測試，覆蓋非擁有者對 `public`/`private` 簡報應得 403（且簡報確實未被刪除）、擁有者與 `public_editable` 協作者應能正常刪除。

## 重生（regenerate）API 補上編輯權限檢查

### 功能目的

播放頁「重生全部」會啟動整份簡報的批次重新生成（逐字稿/語音/圖片/動畫），背後是 `POST /api/pdfs/:id/regenerate`、取消用的 `POST /api/pdfs/:id/regenerate/cancel`，以及回滾到重生前快照的 `POST /api/pdfs/:id/regenerate/rollback`。這三個 API 過去完全沒有檢查請求者是否擁有編輯權限，任何已登入帳號都能在唯讀分享或別人的私有簡報上觸發整份重新生成（消耗大量 LLM/TTS 額度）、取消別人正在執行的重生工作，或把簡報內容回滾到舊版本，屬於與先前已修復的 GitHub 同步、動畫/畫板、測驗、頁面操作、簡報刪除等同一類權限缺口。

新版讓這三個重生相關 API 遵循與其他簡報寫入動作一致的權限規則。

### 使用方式

1. 一般擁有者或取得 read-write 分享/`public_editable` 簡報的使用者操作不受影響，仍可正常啟動整份重生、取消進行中的重生工作，或回滾到重生前的快照。
2. 唯讀分享或公開唯讀簡報的瀏覽者，前端本來就已經停用這些動作；即使有人略過前端直接呼叫對應 API，後端也會回傳 `403 FORBIDDEN`，不會真的啟動重生任務、取消他人工作或回滾內容。
3. 查詢重生進度（`GET /api/pdfs/:id/regenerate/status`）維持公開讀取，不受影響。

### 技術細節

- `backend/src/routes/pdfs/regenerate.ts` 新增與其他寫入路由一致的本地 `sessionSub()` + `canEditPdf(owner_sub, visibility)` + `getPdfPermissionRow()`。
- 三個寫入路由（`regenerate`、`regenerate/cancel`、`regenerate/rollback`）先前完全沒有查詢 pdf 權限資訊，這次新增獨立查詢；權限檢查都放在呼叫 `startRegenerateJob()`/`requestCancelRegenerateJob()`/`rollbackRegenerate()` 之前執行，確保無權限請求不會觸發任何 worker 端動作或消耗 LLM/TTS 額度。
- 新增 `backend/test/regenerate-permission.test.ts` 6 個測試，覆蓋三個路由對非擁有者的唯讀分享簡報應得 403（且確實未建立重生任務）、擁有者與 `public_editable` 協作者應能成功啟動重生、`cancel`/`rollback` 對未知簡報應得 `404 PDF_NOT_FOUND` 而非 403。

## 「依提示詞新增頁面」API 補上編輯權限檢查

### 功能目的

播放頁可用 AI 依使用者提示詞或大綱對話自動新增投影片，背後是 `POST /api/pdfs/:id/add-pages-from-prompt`（啟動新增頁面任務）、`POST /api/pdfs/:id/add-pages-from-prompt/cancel`（取消任務）與 `POST /api/pdfs/:id/add-pages-outline-chat`（大綱討論對話）。這三個 API 過去完全沒有檢查請求者是否擁有編輯權限，任何已登入帳號都能在唯讀分享或別人的私有簡報上觸發 AI 新增頁面（消耗 LLM 額度）、取消別人的任務，或進行大綱對話，與先前已修復的 GitHub 同步、動畫/畫板、測驗、頁面操作、簡報刪除、重生等同一類權限缺口。

新版讓這三個 API 遵循與其他簡報寫入動作一致的權限規則。

### 使用方式

1. 一般擁有者或取得 read-write 分享/`public_editable` 簡報的使用者操作不受影響，仍可正常使用 AI 新增頁面、取消進行中的任務，或進行大綱對話。
2. 唯讀分享或公開唯讀簡報的瀏覽者，前端本來就已經停用這些動作；即使有人略過前端直接呼叫對應 API，後端也會回傳 `403 FORBIDDEN`，不會真的啟動任務、取消他人工作或消耗 LLM 額度。
3. 查詢新增頁面進度（`GET /api/pdfs/:id/add-pages-from-prompt/status`）維持公開讀取，不受影響。

### 技術細節

- `backend/src/routes/pdfs/add-pages.ts` 新增與其他寫入路由一致的本地 `sessionSub()` + `canEditPdf(owner_sub, visibility)` + `getPdfPermissionRow()`。
- `add-pages-from-prompt` 與 `add-pages-from-prompt/cancel` 先前完全沒有查詢任何 pdf 權限資訊，這次新增獨立查詢；`add-pages-outline-chat` 延伸既有的 `page_count` 查詢補上 `owner_sub`/`visibility`。
- 三個路由的權限檢查都放在呼叫實際 worker 邏輯（`startAddPagesFromPrompt()`、`abortAddPagesJob()`、`continueAddPagesOutlineChat()`）之前，避免無權限請求消耗 LLM 額度。
- 新增 `backend/test/add-pages-permission.test.ts` 6 個測試，覆蓋三個路由對非擁有者的唯讀分享簡報應得 403、擁有者與 `public_editable` 協作者應能成功啟動任務、`cancel` 對未知簡報應得 `404 PDF_NOT_FOUND` 而非 403。過程中也發現後端 `PDF_ID_RE` 限制簡報 id 長度為 8–32 字元，調整了測試中過長的 id 以符合參數驗證。

## 版本還原 API 補上編輯權限檢查

### 功能目的

播放頁的版本歷史對話框可以把某一頁的圖片或逐字稿還原成任意歷史版本，背後是 `POST /api/pdfs/:id/pages/:n/image/restore/:hash` 與 `POST /api/pdfs/:id/pages/:n/script/restore/:hash`。這兩個 API 過去完全沒有檢查請求者是否擁有編輯權限，任何已登入帳號都能在唯讀分享或別人的私有簡報上把圖片、逐字稿覆寫回任意舊版本，與先前已修復的 GitHub 同步、動畫/畫板、測驗、頁面操作、簡報刪除、重生、AI 新增頁面等同一類權限缺口。

新版讓兩個還原 API 遵循與其他簡報寫入動作一致的權限規則，讀取版本歷史與預覽舊版本內容則維持公開。

### 使用方式

1. 一般擁有者或取得 read-write 分享/`public_editable` 簡報的使用者操作不受影響，仍可在版本歷史對話框正常還原圖片或逐字稿到指定版本。
2. 唯讀分享或公開唯讀簡報的瀏覽者，前端本來就已經停用還原按鈕；即使有人略過前端直接呼叫對應 API，後端也會回傳 `403 FORBIDDEN`，不會真的覆寫任何內容。
3. 查看版本清單（`GET .../image/history`、`.../script/history`）與預覽指定版本內容（`GET .../image/versions/:hash`、`.../script/versions/:hash`）維持公開讀取，不受影響。

### 技術細節

- `backend/src/routes/pdfs/versioning.ts` 新增與其他寫入路由一致的本地 `sessionSub()` + `canEditPdf(owner_sub, visibility)` + `getPdfPermissionRow()`。
- 兩個還原路由的權限檢查都放在呼叫 `restorePresentationFile()` 之前執行，確保權限不足時完全不會修改任何檔案或 git 紀錄。
- 新增 `backend/test/versioning-permission.test.ts` 5 個測試：非擁有者對唯讀分享/私有簡報的還原請求應得 403、對未知簡報應得 `404 PDF_NOT_FOUND`；擁有者與 `public_editable` 協作者通過權限檢查的驗證方式是讓對應頁面的 `image_path`/`script_path` 為 `NULL`，使請求在通過權限檢查後落到 `404 PAGE_NOT_FOUND` 分支（與權限檢查的 403 明顯不同），藉此確認沒有被權限擋下，同時避免需要建置真實 git 歷史 fixture 才能驗證還原服務本身的行為。

## 圖表參考選取與課堂投票路由補上編輯權限檢查

### 功能目的

播放頁可調整每頁要作為圖片重生參考的圖表（`PUT /api/pdfs/:id/pages/:n/figures/selection`），以及課堂同步測驗/投票功能可建立投票（`POST /api/pdfs/:id/pages/:n/polls`）、刪除投票（`DELETE /api/pdfs/:id/polls/:pollId`）、清空投票結果（`POST /api/pdfs/:id/polls/:pollId/reset-votes`）。這幾個寫入 API 過去完全沒有檢查請求者是否擁有編輯權限，與本輪已修復的 GitHub 同步、動畫/畫板、測驗、頁面操作、簡報刪除、重生、AI 新增頁面、版本還原等同一類權限缺口。這是本輪發現的最後一批同類缺口。

新版讓這幾個 API 遵循與其他簡報寫入動作一致的權限規則，學生投票提交本身維持公開（與測驗作答提交同理）。

### 使用方式

1. 一般擁有者或取得 read-write 分享/`public_editable` 簡報的使用者操作不受影響，仍可正常調整圖表參考選取、建立/刪除投票或清空投票結果。
2. 唯讀分享或公開唯讀簡報的瀏覽者，即使略過前端直接呼叫對應 API，後端也會回傳 `403 FORBIDDEN`，不會真的修改圖表選取或投票內容。
3. 學生（follower）在課堂同步投票中提交答案（`POST /api/pdfs/:id/polls/:pollId/votes`）完全不受影響，不需要編輯權限即可正常投票；查看圖表清單與圖表圖片也維持公開讀取。

### 技術細節

- `backend/src/routes/pdfs/figures.ts` 新增與其他寫入路由一致的本地 `sessionSub()` + `canEditPdf(owner_sub, visibility)` + `getPdfPermissionRow()`，套用在 `PUT /figures/selection`。
- `backend/src/routes/pdfs/detail.ts` 沿用既有的本地 `canEditPdf()`/`sessionSub()`（該檔案其他寫入路由已使用），套用在投票建立/刪除/清空三個路由。
- 修復過程中發現既有 `backend/test/figure-assets.test.ts` 的硬編碼 session cookie 簽章使用舊版 `AUTH_SESSION_SECRET` 產生、與目前環境密鑰不符，先前因為這個路由完全不驗證 session 而未被發現；改用與其他測試檔案一致、即時用目前 `config.authSessionSecret` 簽章的 `testSessionCookie()` 動態產生方式修正。
- 新增 `backend/test/figures-polls-permission.test.ts` 7 個測試，覆蓋圖表選取與投票建立/刪除/清空對非擁有者唯讀分享簡報應得 403（且資料確實未被修改）、擁有者與 `public_editable` 協作者應可正常操作、投票提交不受權限限制仍可成功送出。

## 播放頁播放控制列與播放設定面板補齊 i18n

### 功能目的

播放頁中央的播放區（上一頁/下一頁/播放/暫停按鈕、分享 QR Code、進度條）與下方可展開的「播放設定」面板（本機靜音狀態、播放速度、字幕開關、播放進度、課堂模式、互動模式、學生端音訊控制）是播放簡報時最常互動的區域。這個檔案雖然已透過先前的工作大量使用 `useI18n()`，但這兩塊區域仍殘留相當多硬編碼中文，包含按鈕的 `aria-label`/`title`（影響螢幕報讀器在英文模式下的可用性）與面板內所有狀態說明文字。

新版讓這兩塊區域的所有文字、`aria-label`、`title` 都跟隨全站界面語言設定顯示對應語言。

### 使用方式

1. 進入「設定」頁，將「界面文字語言」切換為「繁體中文」或「English」。
2. 回到任一簡報播放頁，播放區的上一頁/下一頁/播放/暫停按鈕、語音載入失敗重試提示、無語音提示、分享 QR Code 按鈕與進度條，連同滑鼠停留顯示的提示文字（`title`）與螢幕報讀器使用的 `aria-label`，都會依目前界面語言顯示。
3. 展開「播放設定」（⚙️）面板後，本機靜音狀態、播放速度、字幕開關、播放進度清除、學生端音訊控制（含老師端強制靜音/解鎖說明）、上課模式與互動模式的標籤、說明文字與切換按鈕，都會依目前界面語言顯示，行為與原本完全相同。

### 技術細節

- `PlayPageSlidePanel.tsx` 新增 49 個 `play.slidePanel.*` 翻譯鍵，涵蓋播放區圖片 alt 文字（含動態頁碼）、各按鈕的 `aria-label`/`title`、頁面生成狀態提示、播放完成/課堂模式等待提示，以及播放設定面板內全部文字。
- 標題「播放設定」特別新增獨立的 `play.slidePanel.playbackSettingsTitle` 鍵，而非沿用既有的 `play.header.settings`（值為「設定」），因為兩者中文原文不同（「播放設定」vs「設定」），沿用會造成譯文錯誤。
- 純文字替換，未調整任何播放、換頁、靜音、課堂模式、互動模式相關的狀態管理或互動邏輯。
- `frontend/src/i18n.test.ts` 新增測試驗證全部 49 個新翻譯鍵在中英文 locale 中都存在且為非空字串。

## 播放頁逐字稿編輯與提示詞編輯區塊補齊 i18n

### 功能目的

播放頁下方分頁面板的「逐字稿」與「提示詞」分頁，是編輯單頁逐字稿、重生語音，以及調整整份簡報風格提示詞的主要入口。延續前一項補齊播放控制列與播放設定面板 i18n 的工作，這次處理同一檔案中緊鄰的逐字稿/提示詞編輯區，包含分頁標題、聚焦模式切換按鈕、textarea placeholder 與儲存按鈕等仍殘留的硬編碼中文。

新版讓這個區塊的所有文字都跟隨全站界面語言設定顯示對應語言。

### 使用方式

1. 進入「設定」頁，將「界面文字語言」切換為「繁體中文」或「English」。
2. 回到任一簡報播放頁，下方分頁列的「📝 逐字稿」「🪄 提示詞」分頁標題、右上角放大/還原播放器版面按鈕的提示文字，都會依目前界面語言顯示。
3. 切到「逐字稿」分頁：標題（含頁碼）、查看版本歷史按鈕、textarea placeholder、「儲存後會僅重生此頁語音」提示與「儲存並重生語音」/「重生中…」按鈕皆依語言顯示。
4. 切到「提示詞」分頁：標題（含頁碼）、textarea placeholder、「更新後將影響後續以提示詞為基礎的生成」提示與「儲存提示詞」/「儲存中…」按鈕皆依語言顯示。

### 技術細節

- `PlayPageSlidePanel.tsx` 新增 16 個翻譯鍵：`play.slidePanel.transcriptTab`、`promptTab`、`focusModeRestore`、`focusModeEnlarge`，以及 `play.slidePanel.transcript.*`（`heading`、`viewHistory`、`versionButton`、`placeholder`、`saveHint`、`regenerating`、`saveAndRegenerate`）與 `play.slidePanel.prompt.*`（`heading`、`placeholder`、`updateHint`、`saving`、`save`）。
- 標題鍵（`transcript.heading`、`prompt.heading`）使用 `{page}` 佔位符搭配 `.replace()` 帶入目前頁碼，沿用本檔案其他動態文字慣例。
- 純文字替換，未調整逐字稿編輯、提示詞編輯、儲存並重生語音、聚焦模式切換等任何行為或狀態管理。
- `frontend/src/i18n.test.ts` 新增測試驗證上述 16 個翻譯鍵在中英文 locale 中都存在且為非空字串。

## 修復「系統資料」執行歷程與素材耗時排行完全沒有讀取權限檢查的安全缺口

### 功能目的

播放頁「系統資料」分頁顯示的 pipeline 執行歷程（`GET /api/pdfs/:id/runs`）與最慢素材排行（`GET /api/pdfs/:id/slow-artifacts`）過去只檢查 PDF 是否存在，完全沒有檢查請求者是否有權限讀取這份簡報——任何已登入、甚至未登入的人只要知道簡報 id，就能看到別人私有簡報的完整執行歷程（含錯誤訊息、LLM 用量）與每頁素材的耗時細節。這與主要的 `GET /api/pdfs/:id` 詳細資料 API（已有 `shareAccess OR canReadPdf()` 讀取權限檢查）明顯不一致，是另一類權限缺口。

新版讓這兩個 API 遵循與 `detail.ts` 主要讀取 API 一致的權限規則。

### 使用方式

1. 簡報擁有者、取得有效分享連結（唯讀或可編輯）的使用者，以及 `public`/`public_editable` 簡報的任何登入使用者，瀏覽「系統資料」分頁時不受影響，仍可正常看到執行歷程與素材耗時排行。
2. 非擁有者對私有簡報直接呼叫這兩個 API（無分享 token、無編輯權限）時，後端會回傳 `403 FORBIDDEN`，不會洩漏任何執行歷程或耗時資料。

### 技術細節

- `backend/src/routes/pdfs/runs.ts` 與 `backend/src/routes/pdfs/slow-artifacts.ts` 各自新增與 `detail.ts` 一致的本地 `sessionSub()`、`canReadPdf()`、`getShareToken()`、`hasShareAccess()`。
- 查詢 PDF 是否存在的 SELECT 補上 `owner_sub`、`visibility` 欄位，在回傳資料前先檢查 `hasShareAccess(request, id) || canReadPdf(sessionSub(request), pdf)`。
- `canReadPdf()` 沿用既有規則：`owner_sub` 為空（孤兒資料）一律拒絕、請求者為擁有者本人允許、`visibility` 為 `public` 或 `public_editable` 允許。
- `hasShareAccess()` 從 request header 或 query string 取出分享 token，查詢 `pdf_shares` 表確認 token 對應此簡報的有效分享紀錄。
- 新增 `backend/test/runs-slowartifacts-permission.test.ts` 8 個測試，覆蓋兩個路由對非擁有者私有簡報應得 403、擁有者可正常讀取、`public_editable` 任何人可讀取、攜帶有效分享 token（無 session）也可正常讀取。

## 修復系統觀測 API 完全沒有管理員權限檢查的安全缺口

### 功能目的

`GET /api/system/observability` 回傳整個系統的彙總統計：總簡報數、pipeline 成功/失敗率、各階段與素材狀態分布，以及跨所有使用者的 LLM 用量與平均延遲。這個 API 過去完全沒有任何權限檢查，任何已登入帳號（甚至包含一般非管理員使用者）都能看到其他使用者的彙總用量與系統負載狀況。這與功能相近的 `GET`/`PUT /api/system/sla-settings`（同樣是系統級設定，已有 `isAdminAccount()` 檢查）明顯不一致。

新版讓這個系統觀測 API 與 SLA 設定 API 一樣限制為管理員才能存取。

### 使用方式

1. 管理員帳號登入後，仍可正常在系統儀表板看到完整的彙總統計。
2. 非管理員帳號（包含未登入的請求）呼叫這個 API 會收到 `403 ADMIN_REQUIRED`，不會再看到任何跨使用者的彙總資料。

### 技術細節

- `backend/src/routes/pdfs/observability.ts` 在組裝任何統計資料之前，新增與 `sla-settings.ts` 一致的 `isAdminAccount(currentAccountId())` 檢查，沒有權限時回傳 `403 ADMIN_REQUIRED`。
- `currentAccountId()` 透過既有的 AsyncLocalStorage 帳號情境取得目前請求者帳號，不需要額外傳入 `request` 物件，與 `sla-settings.ts` 的寫法完全一致。
- 新增 `backend/test/observability.test.ts` 3 個測試，覆蓋非管理員應得 403、未登入應得 403、管理員應能正常取得包含 `pdfs`/`pipeline_runs`/`stages`/`artifacts`/`llm_usage` 的完整統計資料。

## 零星硬編碼中文收尾：PromptModal 套用模板按鈕與首頁 ZIP 匯入進度

### 功能目的

`PromptModal.tsx`（上傳/匯入後的生成風格提示詞對話框）與 `HomePage.tsx` 兩個檔案先前已經大量接上 i18n，但各還殘留一兩處遺漏：`PromptModal.tsx` 的「套用模板」按鈕，以及 `HomePage.tsx` 在 ZIP 匯入時顯示的進度文字與螢幕報讀器 `aria-label`。這次把這些殘留的硬編碼中文一次清掉，讓兩個檔案完全跟隨界面語言設定。

### 使用方式

1. 進入「設定」頁，將「界面文字語言」切換為「繁體中文」或「English」。
2. 上傳 PDF 或匯入文字後開啟生成風格提示詞對話框，套用常用範本旁的「套用模板 / Apply template」按鈕會依目前語言顯示。
3. 在首頁匯入 ZIP 簡報時，匯入中顯示的「ZIP 匯入中… / Importing ZIP…」進度文字與進度條的 `aria-label` 都會依目前語言顯示。

### 技術細節

- `PromptModal.tsx` 新增 `promptModal.applyTemplate` 翻譯鍵，沿用檔案既有 `promptModal.*` 命名慣例。
- `HomePage.tsx` 新增 `home.importingZip`、`home.importZipProgressAriaLabel` 翻譯鍵，沿用既有 `home.*` 命名慣例。
- `zh-TW.ts`/`en.ts` 同步新增 3 個翻譯鍵，`frontend/src/i18n.test.ts` 新增測試驗證皆存在且非空字串。
- 純文字替換，未調整套用模板或 ZIP 匯入進度顯示的任何行為。

## `generateTitle.ts` 補上單元測試

### 功能目的

`backend/src/worker/steps/generateTitle.ts` 負責在 pipeline 完成後依逐字稿或頁面文字，請 LLM 為整份簡報命名，是少數會直接影響使用者最先看到的內容（簡報標題）的步驟，但過去完全沒有對應的測試檔案。這個檔案內含多個容易獨立測試的純函式：裁切過長語料的 `clipCorpus()`、清理使用者風格提示詞的 `sanitiseUserPrompt()`，以及依內容語言組裝 system/user prompt 的 `buildSystem()`/`buildUser()`，加上測試覆蓋可大幅降低未來調整命名規則或語料長度限制時的回歸風險。

### 使用方式

此變更純粹是補上測試，不影響任何使用者可見行為或 API：

1. 標題生成的規則、語料裁切邏輯與中英文系統提示詞維持原樣。
2. 開發者修改命名規則、字數限制或語言提示詞時，可透過新增的測試立即看到是否破壞既有行為。

### 技術細節

- `clipCorpus()`、`sanitiseUserPrompt()`、`buildSystem()`、`buildUser()` 由模組私有函式改為具名匯出，方便測試直接呼叫；對外仍只透過 `generateTitle()`/`GenerateTitleResult`/`GenerateTitleOptions` 呼叫，行為未變。
- 新增 `backend/test/generate-title.test.ts` 15 個測試：
  - `clipCorpus`：短語料原樣保留（僅 trim）、超過 6000 字裁切並保留頭尾插入「中段略」標記、剛好等於上限不裁切。
  - `sanitiseUserPrompt`：`null`/`undefined`/純空白回傳空字串、短提示詞僅 trim、超過 2000 字截斷並附加「已截斷」標記。
  - `buildSystem`：英文/繁中規則互斥（英文版不含中文規則文字，反之亦然）、提供使用者提示詞時才附加對應風格區塊。
  - `buildUser`：語料原文確實嵌入，且依語言使用對應的指示文字。
  - `generateTitle()` 整合測試（用既有 `setOpenAIClientForTest()` mock）：優先使用逐字稿並回傳 `source: 'script'`、無逐字稿時 fallback 到頁面文字並回傳 `source: 'text'`、完全沒有內容時拋出錯誤、模型回傳的標題經過標點清理後過短時拋出錯誤。

## `extractPdfFigures.ts` 讀取既有 manifest 補上例外處理

### 功能目的

PDF 圖表抽取步驟（`extractPdfFigures()`）是一個冪等（idempotent）操作：若 `storage/<pdfId>/figures.json` 已存在，會直接讀取並回傳，避免重複跑一次昂貴的 pdf.js 解析與圖片裁切。但原本的讀取邏輯直接呼叫 `JSON.parse()` 而沒有任何例外處理——若該檔案因 pipeline 中途被中斷（例如伺服器重啟、磁碟空間不足）而寫入到一半，或內容被意外清空，`JSON.parse()` 會丟出未分類的 `SyntaxError`，讓整個圖表抽取步驟直接失敗，而使用者唯一能看到的只是一個語法錯誤訊息，無法理解真正原因。這次修正讓系統在這種情況下能自我修復：偵測到 manifest 損毀時改為記錄一筆 warning 並重新產生，而不是讓整份簡報的圖表抽取流程卡死。

### 使用方式

此變更對一般使用者完全透明，不影響任何 API 或前端行為：

1. manifest 正常存在且內容合法時，行為與過去完全相同——直接讀取回傳，不重新計算。
2. manifest 不存在、或內容無法解析為合法 JSON 時，系統會記錄一筆 `extractPdfFigures: failed to parse existing manifest, regenerating` 的 warning 日誌，並自動重新執行完整的圖表抽取流程，產生新的 `figures.json`。

### 技術細節

- 新增具名匯出函式 `readExistingManifest(pdfId: string, manifestPath: string): Promise<FigureManifest | null>`，封裝原本內嵌在 `extractPdfFigures()` 裡的讀取/解析邏輯：
  - 用 `fs.existsSync(manifestPath)` 檢查檔案是否存在，不存在時直接回傳 `null`。
  - 存在時用 try/catch 包覆 `JSON.parse(await fs.promises.readFile(manifestPath, 'utf8'))`，解析失敗時呼叫 `logger.warn({ pdfId, manifestPath, err }, ...)` 並回傳 `null`，讓呼叫端自然落入既有「manifest 不存在」分支重新產生。
- `extractPdfFigures()` 主流程改用 `const existing = await readExistingManifest(pdfId, manifestPath); if (existing) { ... }`，取代原本直接內嵌的 `JSON.parse`，行為等價但多了一層防護。
- 新增 `backend/test/extract-pdf-figures.test.ts`，涵蓋四種情境：manifest 檔案不存在、合法 manifest 正常解析回傳、JSON 語法損毀、檔案內容為空白字串，皆驗證函式回傳 `null` 或正確物件而不向外拋出例外。

## `presentationGit.ts` git 子行程逾時保護

### 功能目的

每份簡報的儲存目錄都是一個獨立的本機 git repo，用來追蹤頁面圖片、逐字稿、音訊等內容的歷史版本，也是「同步到 GitHub」功能的基礎。所有對這個 repo 的操作（commit、push、pull/merge、查詢歷史、還原版本）最終都會呼叫系統的 `git` 執行檔。原本的設定完全沒有設定逾時：若某次 git 呼叫因為 lock 檔被其他行程占用、pre-commit/post-commit hook 卡住、或推送到 GitHub 時網路逾時／遠端無回應，子行程會無限期掛起，連帶讓呼叫端（例如「同步到 GitHub」的 API 請求、或背景的版本提交）一直卡住，使用者只會看到請求永遠轉圈圈，沒有任何錯誤訊息或恢復機會。這次修正讓所有 git 操作都有明確的逾時上限，卡住的子行程會被自動終止，讓既有的錯誤處理（大多數呼叫端本來就有 try/catch + `logger.warn` 或回傳明確錯誤碼）能正常接手，而不是讓整個流程永遠掛著。

### 使用方式

此變更對一般使用者完全透明：

1. 正常情況下（git 指令在合理時間內完成）行為與過去完全相同。
2. 若某次 git 操作異常卡住超過 30 秒，子行程會被強制終止，呼叫端會收到逾時錯誤，依各自既有的錯誤處理邏輯繼續（例如「同步到 GitHub」會回報同步失敗，版本提交失敗則記錄 warning 並讓主流程繼續），不再無限期卡住。

### 技術細節

- 新增模組層級常數 `GIT_COMMAND_TIMEOUT_MS = 30_000`（30 秒），並在 `gitOpts(dir)` 回傳的選項物件中加入 `timeout: GIT_COMMAND_TIMEOUT_MS`。
- `backend/src/services/presentationGit.ts` 內所有 `execFile('git', ...)` 呼叫（`git()` helper、`ensurePresentationRepo`、`refreshGitignore`、`commitAllPendingChanges`、`commitPresentationFile(s)`、`showStagedBlob`、`resolveTextConflict`、`resolveBinaryConflict`、`pullAndMergeFromGitHub`、`pushPresentationToGitHub`、`getPresentationFileAtCommit`、`restorePresentationFile`）都統一透過 `gitOpts(dir)` 取得選項，因此這一處修改即可讓全部呼叫點同時生效，不需要逐一修改每個呼叫點。
- 為了讓修改可被驗證，將 `gitOpts` 與 `GIT_COMMAND_TIMEOUT_MS` 改為具名匯出。新增 `backend/test/presentation-git-timeout.test.ts`：一個測試驗證 `gitOpts()` 的回傳形狀（`cwd`/`timeout`/git 作者與提交者環境變數）；另一個測試用會 `sleep 5` 的假 `git` 執行檔（暫時加進 `PATH`）搭配覆寫成 100ms 的短逾時，實際驗證子行程逾時後確實被終止（`err.killed === true`），證明逾時機制真的有效，而不只是設定了選項卻沒有實際效果。

## `generateVideo.ts` 合成影片前補上圖片/音訊檔案存在性檢查

### 功能目的

「下載影片」功能會把每一頁的圖片與語音合成出一段 mp4 片段，再串接成整份簡報的影片。原本的實作直接把每頁的圖片/音訊路徑交給 ffmpeg，完全沒有先確認檔案是否真的存在於磁碟上。如果某一頁的語音因為 TTS 步驟失敗、或資料庫狀態還沒即時反映實際檔案狀態，ffmpeg 就會直接因為找不到輸入檔而失敗，使用者只會看到一段難以理解的底層錯誤訊息，且整份影片的生成會直接中止，即使其他頁面的素材都齊全。這次修正讓系統在合成每一頁之前先確認素材存在，缺檔的頁面會被跳過並記錄清楚的警告，不影響其他頁面正常合成。

### 使用方式

此變更對一般使用者完全透明：

1. 所有頁面素材齊全時，行為與過去完全相同，產出包含全部頁面的完整影片。
2. 若某幾頁的圖片或音訊缺失，這些頁面會被跳過（不出現在最終影片中），其餘頁面仍正常合成；伺服器日誌會記錄是哪一頁、哪個檔案缺失。
3. 若所有頁面都缺少素材，系統會回報明確的「沒有可用的影片片段」錯誤，而不是讓使用者看到底層 ffmpeg 的錯誤輸出。

### 技術細節

- 在 `generateVideo()` 的主迴圈中，呼叫 ffmpeg 之前先用 `fs.existsSync(image) || !fs.existsSync(audio)` 檢查兩個輸入檔案是否存在；缺檔時呼叫 `logger.warn({ pdfId, pageNumber, image, audio }, 'generateVideo: skipping page with missing image or audio artifact')` 並 `continue`，不會加入 `segmentPaths`。
- 既有的 `if (segmentPaths.length === 0) throw new Error('No video segments generated')` 邏輯維持不變，當所有頁面都被跳過時會自然觸發這個明確的錯誤。
- 新增 `backend/test/generate-video.test.ts`，覆蓋「所有頁面素材皆缺失」與「沒有頁面可渲染」兩種情境；前者驗證新的存在性檢查確實會跳過缺檔頁面並最終丟出可讀的錯誤，且整個測試過程中完全不需要呼叫真正的 ffmpeg 執行檔。

## `gemini.ts` TTS 回應解析補上中間層診斷紀錄

### 功能目的

Gemini TTS 語音合成的回應結構是好幾層巢狀的（`candidates[0].content.parts[].inlineData.data`），原本的程式碼用一整串 optional chaining 直接取出最終的 base64 音訊資料，任何一層缺漏（例如 Gemini 因安全政策擋掉內容而回傳空 `candidates`、或回應格式日後變動）都只會在最後得到同一句「Gemini TTS returned empty audio」，無法從錯誤訊息本身判斷究竟是哪一層出了問題。這次修正在解析失敗時額外記錄一份「回應結構摘要」到日誌，讓未來排查 TTS 失敗時能直接從日誌看出是哪一層缺漏，而不必重現問題或臨時加 log 重新部署才能診斷。

### 使用方式

此變更對一般使用者完全透明，不影響任何 API 行為：

1. 正常情況下（Gemini 回傳合法的 `inlineData` 音訊）行為與過去完全相同。
2. 若 Gemini 回應缺少預期欄位導致語音合成失敗，伺服器日誌會多一筆 `Gemini TTS: failed to locate inlineData audio in response` 的 warning，內含 `hasCandidates`/`candidatesCount`/`hasContent`/`hasParts`/`partsCount`/`partKinds`/`finishReason` 等診斷欄位，幫助快速定位是哪一層出問題（例如 `candidatesCount: 0` 代表 Gemini 完全沒有回傳候選結果，`partKinds: ["text"]` 代表回應只有文字、沒有任何音訊片段）。原本拋出的 `Gemini TTS returned empty audio` 錯誤訊息保持不變。

### 技術細節

- 新增具名匯出函式 `summarizeTtsResponseForLog(json: unknown): Record<string, unknown>`：逐層判斷 `candidates` 是否為陣列及其長度、`content` 是否存在、`parts` 是否為陣列及其長度，並把每個 part 分類為 `'inlineData' | 'text' | 'unknown'`，連同第一個候選結果的 `finishReason` 一起組成摘要物件，再透過既有 `logSanitizer.ts` 的 `redactLogObject()` 包裝，確保不會把任何長字串（萬一未來欄位變動意外帶有 base64/敏感內容）原文寫進日誌。
- `synthesizeGeminiSpeech()` 在判定 `inlineData.data` 缺失（`!b64 || typeof b64 !== 'string'`）時，先呼叫 `logger.warn({ response: summarizeTtsResponseForLog(json) }, 'Gemini TTS: failed to locate inlineData audio in response')`，再拋出原有的錯誤，呼叫端的錯誤處理（重試、warning、fallback）完全不受影響。
- 新增 `backend/test/gemini-tts-diagnostics.test.ts`：4 個測試直接驗證 `summarizeTtsResponseForLog()` 對完整合法回應、空 `candidates`、只有 `text` 的 parts、完全缺少 `candidates` 四種情境的摘要內容是否正確；3 個測試沿用專案既有的 `globalThis.fetch` mock 慣例（`auth-google-callback.test.ts` 的同一套手法），對 `synthesizeGeminiSpeech()` 做端到端驗證，覆蓋兩種失敗情境與一種成功情境。

## `promptTemplates.ts` 補上單元測試

### 功能目的

`backend/src/services/promptTemplates.ts` 提供兩個小工具：`loadPromptTemplate()` 讀取外部提示詞範本檔案（檔案不存在或內容空白時回退到內建預設文字）與 `renderPromptTemplate()`（用 `{{變數名}}` 語法替換模板中的變數）。這兩個函式被多處 LLM 提示詞組裝邏輯使用，但過去完全沒有測試覆蓋，調整正規表示式或回退邏輯時若有疏漏不會被任何測試攔截。這次補上完整的單元測試，讓未來修改這兩個函式時能立即知道是否破壞既有行為。

### 使用方式

此變更純粹是補上測試，不影響任何程式邏輯或對外行為。

### 技術細節

- 新增 `backend/test/prompt-templates.test.ts`，共 10 個測試：
  - `loadPromptTemplate()`：檔案不存在時回退到 fallback、檔案內容為純空白字元時回退、檔案完全空白時回退、檔案有內容時回傳 trim 後的文字。測試用暫時建立在 `config.repoRoot` 下的 `.tmp-prompt-templates-test/` fixture 目錄寫入測試檔案，每個測試結束後在 `finally` 區塊用 `fs.rmSync(..., { recursive: true, force: true })` 清除，不留殘留檔案。
  - `renderPromptTemplate()`：單一變數替換、多個不同變數替換、同一變數重複出現時替換一致、找不到對應 key 時補空字串（而非保留原始 `{{key}}` 字串）、`{{ name }}`（含前後空白）仍能正確比對、完全沒有 placeholder 的文字保持原樣不變。

## `synthesizeAudio.ts` 補上純函式單元測試

### 功能目的

語音合成步驟（`synthesizeAudio.ts`）內含多個與外部 TTS API 呼叫無關的純函式：WAV 格式編解碼、TTS 錯誤是否可重試的判斷、可讀錯誤訊息組裝、語氣標記切分、雙人對談講者前綴解析。這些函式的邏輯各自獨立且容易出錯（例如 WAV 標頭欄位寫錯位移、重試判斷條件遺漏某個 HTTP 狀態碼），過去完全沒有測試覆蓋。這次補上完整單元測試，讓未來調整重試邏輯、錯誤訊息格式或語氣標記語法時能立即發現破壞性變更，且完全不需要呼叫真實的 TTS API 或建立暫存音訊檔案。

### 使用方式

此變更純粹是補上測試，不影響任何程式邏輯或對外行為（六個函式只新增 `export` 關鍵字，函式內容完全未變）。

### 技術細節

- 將 `parseWavPcmChunk()`、`buildWavPcm16()`、`isRetryableTtsError()`、`extractTtsErrorMessage()`、`splitByToneMarkers()`、`splitSpeakerPrefix()` 改為具名匯出，沿用本輪 LOOP 多次使用的「匯出既有純函式以便測試」慣例（與 `generateTitle.ts` 相同做法）。
- 新增 `backend/test/synthesize-audio.test.ts`，共 20 個測試：
  - `buildWavPcm16`/`parseWavPcmChunk`：互轉 round-trip、標頭欄位（RIFF/WAVE 魔數、channels、sample rate、bits per sample、data chunk size）正確性、緩衝區過短或缺少魔數時 `parseWavPcmChunk` 回傳 `null`。
  - `isRetryableTtsError`：HTTP 408/429/5xx 視為可重試，一般 4xx 不可重試；`name`/`type`/`message` 含 timeout 或 connection 關鍵字視為可重試；非物件、`null`、或無法識別的錯誤回傳 `false`。
  - `extractTtsErrorMessage`：依序嘗試 `status+code`、`status+type`、純 `message`、非物件輸入（直接字串化）四種組合的輸出格式。
  - `splitByToneMarkers`：無標記時整段歸入預設「平穩敘述」、多個 `[[語氣]]` 標記正確切分並各自追蹤目前語氣、空白輸入回傳空陣列、重複呼叫時不互相干擾（驗證模組層級共用 regex 的 `lastIndex` 重置邏輯正確）。
  - `splitSpeakerPrefix`：半形/全形冒號的 `Speaker 1:`/`Speaker 2：` 前綴解析、大小寫不敏感、沒有前綴時原文不變。

## 前端 `subtitles.ts` 補上單元測試

### 功能目的

播放頁的字幕高亮與「依逐字稿句子觸發動畫效果」功能都依賴 `frontend/src/lib/subtitles.ts` 裡的兩個純函式：`splitScriptIntoSentences()` 把整頁逐字稿切成一句一句（並去除 Gemini TTS 的語氣標記），`buildSentenceTimeline()` 再依每句的字元組成（中日韓文字、數字、英文字母）估算朗讀秒數與停頓秒數，依整頁實際音訊長度等比例縮放出每句的播放起訖時間。這兩個函式過去完全沒有測試，邏輯本身又涉及不少正規表示式與數值估算的細節（例如哪些符號才算句子結尾、不同字元的權重），這次補上完整測試後也順便確認了一個容易被誤解的實際行為：切句規則只把全形「。！？；」與半形「!?;」視為句子終止符，半形 ASCII 句號「.」並不會觸發切分。

### 使用方式

此變更純粹是補上測試，不影響任何程式邏輯或播放頁的實際顯示行為。

### 技術細節

- 新增 `frontend/src/lib/subtitles.test.ts`，共 15 個測試：
  - `splitScriptIntoSentences()`：空白輸入、純語氣標記輸入（`[[興奮地]]` 之類）回傳空陣列；中文/英文多句依終止符正確切分；語氣標記與正文交錯時標記被正確去除；額外驗證 ASCII 句號「.」不算終止符，因此一段只有句號、沒有其他終止符的文字會維持整段不被拆開。
  - `buildSentenceTimeline()`：`duration` 為 0、負數、`NaN`、`Infinity`，或 `sentences` 為空陣列時皆回傳空陣列；單句時整段時長分配給該句；多句切分後每個區段的 `start` 等於前一段的 `end`（區段首尾相接、無重疊無空隙），且最後一段的 `end` 精確等於 `duration`；較長的中文句子分配到的時長確實大於短句（驗證字元權重估算邏輯生效）；混合中英文與數字字元時所有區段仍落在 `[0, duration]` 範圍內。

## 後端測驗管理補上刪除端點與前端刪除按鈕

### 功能目的

教師可以為簡報建立多份課堂測驗（透過 AI 產生或手動編輯），但過去只能新增、編輯與練習，沒有任何方式可以刪除不再需要的舊測驗——對照投票功能（page polls）早已支援刪除，測驗管理的 CRUD 並不完整。隨著教師反覆嘗試不同版本的測驗題目，已儲存的測驗清單只會越來越長，無法清理。這次補上刪除功能，讓教師可以隨時整理測驗清單。

### 使用方式

1. 在課堂測驗編輯頁的「已儲存測驗」清單中，每一筆測驗除了原有的「開始」「顯示答案」「結束」「歷史記錄」按鈕外，新增「刪除」按鈕（僅同步教學模式下的 master 角色可見，與「新增測驗」按鈕的顯示條件一致）。
2. 點擊「刪除」會先彈出確認對話框，顯示該測驗的標題並提醒此操作無法復原、會連同所有學生的作答紀錄一併刪除。
3. 確認後測驗會立即從清單移除；若刪除的正是目前編輯表單中開啟的那份測驗，編輯表單會自動重置為一份新測驗的初始狀態。

### 技術細節

- 後端 `backend/src/routes/pdfs/quizzes.ts` 新增 `DELETE /api/pdfs/:id/quizzes/:quizId`，沿用與 `PUT /api/pdfs/:id/quizzes/:quizId` 相同的 `canEditPdf()` 編輯權限檢查（非擁有者且非 `public_editable` 協作者回傳 `403`），找不到對應 quiz 時回傳 `404 QUIZ_NOT_FOUND`，成功時回傳 `204 No Content`（與 `detail.ts` 的 `DELETE /api/pdfs/:id/polls/:pollId` 風格一致）。
- 資料庫的 `quiz_attempts` 表已對 `quiz_id` 設定 `FOREIGN KEY ... ON DELETE CASCADE`，且 `db.pragma('foreign_keys = ON')` 已啟用外鍵約束，因此刪除 `quiz_sets` 紀錄時，所有關聯的學生作答紀錄會由 SQLite 自動連帶刪除，路由邏輯不需要額外手動清理 `quiz_attempts`。
- 前端 `frontend/src/lib/api/pdfs.ts` 新增 `deleteQuizSet(id, quizId)`，沿用既有 `deletePagePoll()` 的 204/錯誤處理慣例。
- `QuizBuilderPage.tsx` 新增 `handleDeleteQuiz()`：呼叫 `window.confirm()`（沿用 `HomePage.tsx` 刪除分類時的確認對話框慣例）取得使用者確認後呼叫 API，成功後從 `savedQuizzes` 移除該筆並視情況重置編輯表單；新增 `deletingQuizId` 狀態在請求進行中暫時停用該按鈕，避免重複點擊。
- 新增中英文 `quiz.confirmDelete`（含 `{title}` 佔位符）、`quiz.deleteDone`、`quiz.deleteFailed`、`quiz.deleteQuizTitle` 翻譯鍵；按鈕文字沿用既有的 `quiz.delete` 鍵（原本用於編輯器內刪除單一題目，文案同樣是「刪除」/"Delete"，可直接複用）。
- `backend/test/quizzes.test.ts` 新增測試覆蓋：非擁有者刪除得到 403 且資料未被刪除、擁有者刪除成功後 `quiz_sets` 與其 `quiz_attempts` 皆消失、刪除不存在的 quiz id 或 pdf id 不匹配時得到 404。

## `SystemDataPage.tsx` 補齊 i18n

### 功能目的

`SystemDataPage.tsx` 是系統管理員專用的可觀測性儀表板（對應已加上 `isAdminAccount()` 權限檢查的 `/api/system/observability`），顯示全站簡報處理成功/失敗率、Pipeline 執行統計、LLM 用量與估算成本、Stage/Artifact 狀態分布等彙總資訊。這個頁面過去是 `frontend/src/pages/` 下唯一完全沒有走 `useI18n()` 的頁面，標題、按鈕、區塊標題與超過 15 個指標卡片的 label/hint 全是硬編碼中文，使用英文介面的管理員會在這個頁面突然看到整頁中文。

### 使用方式

此變更純粹是補齊翻譯，不影響任何資料邏輯或版面：

1. 切換到英文介面後，這個頁面的標題、導覽連結、三個統計區塊標題與所有指標卡片文字皆會顯示英文。
2. 依原始待辦範圍的決定，`formatInt`/`formatDuration`/`formatCost` 三個數字/時間格式化函式維持原樣（例如耗時的「秒」單位與成本未知時的「模型價格未知」仍為固定中文），Stage/Artifact 清單中的狀態值（如 `succeeded`/`failed`，後端回傳的原始狀態字串）也維持原樣顯示，這兩者刻意不在本次範圍內處理。

### 技術細節

- 新增 `useI18n()` 與本地 `formatMessage()` 佔位符替換 helper（沿用 `QuizBuilderPage.tsx`/`HomePage.tsx` 既有的 `{name}` 替換慣例），將原本的字串樣板（如 `` `${formatInt(metrics.pdfs.completed)} 份完成` ``）改為 `formatMessage('systemData.completedHint', { count: formatInt(metrics.pdfs.completed) })` 的形式。
- 新增 32 個 `systemData.*` 翻譯鍵，涵蓋頁首標題/副標/按鈕/連結、資料產生時間、三個統計區塊（簡報處理狀態／Pipeline 執行狀態／LLM 使用量與估算成本）下所有指標 label 與 hint、Stage/Artifact 狀態分布標題與無資料提示；「返回首頁」連結直接複用既有的 `settings.backHome` 鍵（與 `SettingsPage.tsx` 共用同一份翻譯），不重複建立。
- 新增 `frontend/src/i18n.test.ts` 的「SystemDataPage locale keys are complete」測試區塊，驗證所有新增的 32 個 key 在中英文字典中皆存在且非空字串。

## `CreditExhaustedDialog.tsx` 補齊 i18n

### 功能目的

當 LLM/TTS 額度耗盡導致 API 呼叫失敗時，前端會在全域層級監聽 `CREDIT_EXHAUSTED_EVENT` 事件並彈出 `CreditExhaustedDialog` 提示使用者。這個對話框過去完全沒有走 `useI18n()`，是 `frontend/src/components/` 下唯一還沒有國際化的對話框元件，「建議處理方式」「錯誤碼」「前往設定」「我知道了」四處文字都是硬編碼中文，英文介面使用者遇到額度耗盡時會突然看到一段中文提示。

### 使用方式

此變更純粹是補齊翻譯，不影響事件監聽、彈出/關閉狀態或導向設定頁的行為：切換到英文介面後，額度耗盡對話框的固定文字（標題旁的「建議處理方式」段落標籤、錯誤碼說明、「前往設定」連結與「我知道了」按鈕）會顯示英文；對話框標題與訊息本身（`detail.title`/`detail.message`/`detail.nextStep`）原本就是由後端錯誤訊息對應產生，不在此次調整範圍內。

### 技術細節

- 新增 `useI18n()`，將四處固定文字改為 `creditExhausted.suggestedNextStep`/`creditExhausted.errorCode`/`creditExhausted.goToSettings`/`creditExhausted.gotIt` 翻譯鍵。
- `creditExhausted.errorCode` 鍵的值含 `{code}`/`{status}` 兩個佔位符（如「錯誤碼：{code}（HTTP {status}）」），元件內直接用 `.replaceAll('{code}', detail.code).replaceAll('{status}', String(detail.status))` 代入；因為這個元件只有一處需要佔位符替換，沒有另外抽出像 `QuizBuilderPage.tsx`/`SystemDataPage.tsx` 那樣的共用 `formatMessage()` helper。
- 新增 `frontend/src/i18n.test.ts` 的「CreditExhaustedDialog locale keys are complete」測試區塊，驗證 4 個新 key 在中英文字典中皆存在且非空字串。

## `accountContext.ts` 補上單元測試

### 功能目的

`backend/src/services/accountContext.ts` 是多帳號隔離設計的核心：每個請求/背景工作都在「目前帳號」的 `AsyncLocalStorage` 情境中執行，AI 設定（API key、模型、語音…）依此情境讀寫，避免不同使用者的設定互相污染。這個檔案過去完全沒有測試，而它的正確性直接影響多帳號資料隔離是否可靠——如果 `sanitizeAccountId()` 的消毒邏輯有缺陷，或 `AsyncLocalStorage` 情境在並行請求下意外洩漏，後果會是使用者看到別人的 API 設定或用量資料，因此特別值得補上測試。

### 使用方式

此變更純粹是補上測試，不影響任何程式邏輯或對外行為。

### 技術細節

- 新增 `backend/test/account-context.test.ts`，共 14 個測試：
  - `sanitizeAccountId()`：`null`/`undefined`/空字串/純空白皆回退至 `DEFAULT_ACCOUNT_ID`；已是檔名安全字串時原樣保留；前後空白會被 trim；`@`/`/`/`\`/空格等特殊符號會被替換成底線；開頭連續點號會被移除（避免類似隱藏檔或路徑跳脫的命名）；整串只有點號時回退至 `DEFAULT_ACCOUNT_ID`。
  - `accountIdFromOwnerSub()`：驗證其行為與 `sanitizeAccountId()` 一致（直接委派）。
  - `runWithAccountId()`/`currentAccountId()`：情境外回傳 `DEFAULT_ACCOUNT_ID`；情境內回傳消毒後的帳號代碼；情境結束後正確還原為 `DEFAULT_ACCOUNT_ID`；巢狀呼叫時內層結束後外層情境正確還原；非同步函式內 `await` 之後情境依然正確傳遞（驗證 `AsyncLocalStorage` 跨微任務邊界的傳遞行為，這正是多個並行請求能各自拿到正確帳號設定的關鍵機制）；最後用 `Promise.all` 模擬兩個並行請求各自帶不同延遲呼叫 `runWithAccountId()`，驗證全程互不污染彼此的帳號情境。

## 前端 `ttsVoices.ts` 補上單元測試

### 功能目的

`frontend/src/lib/ttsVoices.ts` 維護 OpenAI 與 Gemini 兩套 TTS 聲音清單，以及把聲音名稱標註成「voice（男）」/「voice（女）」的 `geminiVoiceLabel()`/`openaiVoiceLabel()`，用於語音設定選單讓使用者更容易挑選對比聲線。這個檔案過去完全沒有測試，而檔案內的註解明確提到 `GEMINI_TTS_VOICES` 需要與後端 `services/gemini.ts` 的 `GEMINI_VOICES` 保持同步——這類「兩份清單需要手動同步」的設計特別容易在日後新增/移除聲音時出現遺漏（例如清單裡新增了一個聲音，卻忘記同時更新性別對照表），這次補上測試除了覆蓋標籤函式本身，也加入資料完整性檢查防止這類遺漏。

### 使用方式

此變更純粹是補上測試，不影響任何程式邏輯或對外行為。

### 技術細節

- 新增 `frontend/src/lib/ttsVoices.test.ts`，共 10 個測試：
  - `geminiVoiceLabel()`/`openaiVoiceLabel()`：各覆蓋已知男聲標註「（男）」、已知女聲標註「（女）」、找不到對照表項目時原樣回傳聲音名稱三種情境。
  - 資料完整性（雙向比對）：驗證 `GEMINI_TTS_VOICES`/`OPENAI_TTS_VOICES` 陣列中每個聲音都能在對應的 `GEMINI_TTS_VOICE_GENDER`/`OPENAI_TTS_VOICE_GENDER` 對照表中找到 M/F 項目；同時反向驗證對照表裡沒有清單之外的多餘項目。這兩個方向的檢查合在一起，能在日後修改聲音清單卻忘記同步更新對照表時被測試立即攔截，而不是等到使用者在介面上看到沒有性別標註（或標註了一個已經移除的聲音）才發現。

## 圖形參考檔案讀取補上對缺檔的容錯

### 功能目的

當簡報是從 PDF 匯入、且某頁內容對應到原始 PDF 中含有圖表的頁面時，系統會把抽取出來的圖表圖片作為額外的「參考圖片」附加到 AI 生成投影片圖片的請求中，幫助 AI 在重新繪製投影片時保留圖表的關鍵資訊。這個「圖表參考」機制原本只是錦上添花的加分功能，但原始實作用 `Promise.all()` 並行讀取所有圖表圖片檔案，只要其中任何一個檔案在 `figures.json` manifest 仍記錄著、但實際磁碟上已經遺失或無法讀取（例如被某次清理流程誤刪），整批讀取就會直接拋出例外，導致原本該頁的圖片生成或編輯整個失敗——即使其他圖表都正常、即使沒有圖表參考也完全可以生成圖片。這次修正讓系統改為盡力而為：缺檔的圖表會被跳過並記錄警告，其餘圖表正常附加，不再讓一個壞掉的參考檔案擋下整頁的圖片生成。

### 使用方式

此變更對一般使用者完全透明：

1. 所有圖表檔案都存在時，行為與過去完全相同。
2. 若某個圖表的圖片檔案缺失，系統會跳過該圖表（不附加為參考圖片、也不在文字說明中提到它），其餘圖表正常運作，整頁圖片仍能正常生成或編輯；伺服器日誌會記錄是哪個簡報、哪個圖表 id、哪個檔案路徑缺失。

### 技術細節

- 在 `backend/src/services/pdfFigures.ts` 新增 `loadFigureReferenceFiles(pdfId, figures)`：對每個圖表並行嘗試讀取圖片檔案並透過 OpenAI SDK 的 `toFile()` 包裝成可上傳的檔案物件；單個讀取失敗時記錄 `logger.warn({ pdfId, figureId, imagePath, err }, ...)` 並回傳 `null`，最終過濾掉失敗項目。回傳值是 `{ figures, files }` 這一對陣列（順序對齊、長度相同），讓呼叫端可以直接用過濾後的 `figures` 子集去產生圖說文字（`buildFigureReferenceNotes()`），確保文字說明與實際附加的圖片永遠一致。
- `backend/src/worker/steps/renderTextPagesWithLlm.ts` 與 `backend/src/routes/pdfs/page-operations.ts`（`inpaint-image` 路由）兩處原本完全重複的 `Promise.all()` 讀取邏輯，都改成呼叫這個共用 helper；同時調整了呼叫順序，讓 `buildFigureReferenceNotes()` 在圖表實際載入完成（並過濾掉失敗項目）之後才執行，而不是在讀取之前就用未過濾的清單產生文字。
- 新增 `backend/test/pdf-figures.test.ts` 的 3 個測試，覆蓋「部分圖表檔案缺失仍能完成並跳過該圖表」「空輸入直接回傳空結果」「全部檔案存在時應全數成功載入」三種情境；並針對性重跑既有的 `figure-reference-image-generation.test.ts`/`render-text-pages-figure-injection.test.ts` 整合測試，確認這次重構沒有改變既有正常路徑的行為。

## 修復課堂測驗讀取端點完全沒有權限檢查的安全缺口

### 功能目的

課堂測驗功能（`backend/src/routes/pdfs/quizzes.ts`）讓教師可以為簡報建立測驗題目，並在課堂中讓學生作答。先前的權限修復系列已經針對測驗的「新增」「修改」「刪除」端點補上編輯權限檢查，但這次重新檢視發現「讀取」端點完全被遺漏：`GET /api/pdfs/:id/quizzes`（取得測驗題目與正確答案）與 `GET /api/pdfs/:id/quizzes/:quizId/attempts`（取得學生作答紀錄，包含 session/client id、作答內容與分數）都只檢查資源是否存在，沒有檢查請求者是否有權限讀取——任何已登入帳號只要知道 PDF id，就能看到別人簡報的測驗正確答案，以及該堂課所有學生的作答記錄與分數。後者涉及學生個人資料外洩，風險明顯高於一般內容外洩，這次優先修復。

### 使用方式

此變更對一般使用者完全透明：

1. 簡報擁有者、簡報設為 `public`/`public_editable` 的讀者、以及持有有效分享連結（share token）的人，仍可正常讀取測驗題目與作答記錄。
2. 非擁有者對 `private` 簡報的讀取請求會收到 `403 FORBIDDEN`，不再能看到別人的測驗內容與學生個資。
3. 學生提交作答（`POST .../attempts`）的行為不受影響，維持原本不需要編輯權限即可送出答案的設計（與課堂投票提交同理）。

### 技術細節

- 在 `backend/src/routes/pdfs/quizzes.ts` 新增與 `runs.ts`/`slow-artifacts.ts` 一致的本地 `canReadPdf()`（擁有者或 `public`/`public_editable` 才能讀）、`ShareTokenParamSchema`/`getShareToken()`（從 `x-makeslide-share-token` header 或 `?share=` query 取得分享 token）、`hasShareAccess()`（查 `pdf_shares` 表驗證 token）。
- `GET /api/pdfs/:id/quizzes`：PDF 不存在回 `404 PDF_NOT_FOUND`；沒有分享存取且 `canReadPdf()` 為否則回 `403 FORBIDDEN`。
- `GET /api/pdfs/:id/quizzes/:quizId/attempts`：在原本「quiz 是否存在」的檢查之前，先補上同樣的 PDF 層級讀取權限檢查。
- 新增 6 個測試覆蓋兩個端點對私有簡報非擁有者的 403、未知 PDF id 的 404、`GET /quizzes` 對擁有者／公開讀者／分享 token 持有者皆正常回應、`GET /quizzes/:quizId/attempts` 擁有者能正確讀到學生作答記錄。過程中也修正了一個測試本身的瑕疵：新測試一開始重複使用了其他測試已用過的 `session_id`/`client_id` 字面值，因資料表對這兩欄設有全域唯一約束，導致提交被誤判為更新舊紀錄而非新建，改用測試專屬的唯一值後修正。
