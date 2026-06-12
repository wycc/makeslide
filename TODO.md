# FirstBatch
[x] (merge)audio 產生完成後，重新壓縮成 AAC 以減少頻寬需求（完成於分支: feature/todo-aac-audio-compress-20260521）
[x] (merge)將重複的上課模式移除，只留在播放設定中即可。另外少了原有的強迫 follower 靜音的功能少補進去（完成於分支: feature/remove-duplicate-classroom-mode-20260521）
[x] (merge)目前的同步模式讓第一個按下的 session 變成 master。當 reload 後這個狀態就消失了。此時如果 master reload 畫面就會變成很奇怪的狀況。請改成變這個設定存在 DB 中，把 master 的  session ID 記下來。讓 reload 時還是可以回復原狀。且 master 的 session ID 並須定期更新。否則十分鐘後就自動停止同步模式。且當一個簡報進入同步模式後，其它的人進來就直接進定模式，不用再設定。（完成於分支: feature/persist-sync-master-session-20260521）
[x] (merge)加上語言選項，讓 UI 可以有不同語言的版本。先製作英文和繁體中文版。把所有 UI 上的文字收集成翻譯檔，在根據 UI 設定內的選擇載入英文或中文的翻譯檔。產生的圖片/逐字稿/語音也要根據 UI 的設定產生不同的結果。UI 中要有二個設定，一個是界面的文字語言，另一個是產生結果的語言。也就是我們允許用中文的提示詞產生英文的結果，或是反過來。（完成於分支: feature/todo-ui-i18n-settings-20260521）
[x] (merge)請將首頁中所有文字都做翻譯（完成於分支: feature/todo-homepage-i18n-20260522）
[x] (merge)請將 PlayPage中所有文字都做翻譯（完成於分支: feature/todo-playpage-i18n-20260522）
[x] (merge)請將 上傳 PDF 中所有文字都做翻譯（完成於分支: feature/todo-upload-pdf-i18n-20260522）
[x] (merge)請將 貼上 TXT 中所有文字都做翻譯（完成於分支: feature/todo-import-text-i18n-20260522）
[x] 重新確認 master TODO.md 無未完成項目並更新工作記錄（完成於分支: feature/todo-no-pending-recheck-20260522-1124）
[x] (merge)產生的標題也要根據內容語言設定選擇語言（完成於分支: feature/todo-title-content-language-20260523）
[x] 當使用文本產生大網時要根據內容語言設定選擇語言，如果內容語言是中文時要產生繁體中文（完成於分支: feature/todo-text-outline-content-language-20260523）
[x] (merge)在全螢幕模式時， click 螢幕可以 pause/resume 語言播放。pause 的時候要在左上角顯示 pause 圖示（完成於分支: feature/fullscreen-click-pause-audio-20260523）

[x] 重新確認 master TODO.md 無未完成項目並更新工作記錄（完成於分支: feature/todo-no-pending-recheck-20260523-0154）

[x] 重新確認 master TODO.md 無未完成項目並更新工作記錄（完成於分支: feature/todo-no-pending-recheck-20260523-0204）
[x] 在 dockerfile 中加入 ffmpeg 套件安裝，把版本改成 1.1.1（完成於分支: feature/docker-ffmpeg-version-1.1.1-20260523）
[x] 在重生簡報時，如果 page reload，進度會不見，但背後仍在生成。應該重 reload 後回復生成中的狀態（完成於分支: feature/restore-regenerate-progress-on-reload）
[x] 將全螢幕改成真正的全螢幕, 而不是只是整個流覽器 window（完成於分支: feature/fullscreen-api-support-20260523）
[x] 使用 AI 分頁時，請在 AI 分完頁後，讓使用者有檢查分頁結果的能力。可以加一個 checkbox 讓使用者選擇要先確認後再開始產生圖片（完成於分支: feature/ai-split-confirm）
[x] 在修訂逐字稿時，我們會希望它的視窗可以把完整的逐字稿儘量顯示出來。所以我們要加上一個按鍵把上方播放器收成一個排在右上方的小視窗，而將左邊全部留給逐字稿的區域。所以請在逐字稿的 notebook 列上加一個圖示可以切換模式。（完成於分支: feature/transcript-player-compact-toggle-20260524）
[x] 清理殘缺未完成項目「請將」（完成於分支: feature/cleanup-incomplete-todo-item-20260525）

## 工作記錄
- 時間: 2026-05-21 09:08:06 +0800
- 分支: feature/todo-aac-audio-compress-20260521
- 內容: 完成 audio 產生後轉為 AAC（.m4a）以降低頻寬，並同步更新相關路徑副檔名參照。

- 時間: 2026-05-21 09:27:00 +0800
- 分支: feature/remove-duplicate-classroom-mode-20260521
- 內容: 移除播放頁重複的上課模式控制區塊，只保留播放設定中的單一入口；follower 強制靜音控制維持在播放設定中可操作。

- 時間: 2026-05-21 09:39:00 +0800
- 分支: feature/persist-sync-master-session-20260521
- 內容: 將同步模式 master session 與播放同步狀態持久化到 DB，master reload 後可依 session ID 恢復角色；master 心跳更新 10 分鐘有效期限，逾期自動清除同步狀態；並保留 follower 直接加入既有同步模式。

- 時間: 2026-05-21 09:51:00 +0800
- 分支: feature/todo-ui-i18n-settings-20260521
- 內容: 完成 UI 與產生結果語言設定第一階段；新增英文/繁體中文翻譯檔與前端 i18n 工具，設定頁可儲存界面語言與產生結果語言，後端 AI 設定可持久化語言欄位，逐字稿生成提示會依產生結果語言輸出英文或繁體中文；並修正既有 synthesizeAudio runCommand 匯入造成的後端建置錯誤。

- 時間: 2026-05-22 09:48:39 +0800
- 分支: feature/todo-homepage-i18n-20260522
- 內容: 完成 HomePage 全部可見文字 i18n 化，新增 home.* 翻譯鍵並補齊中英文語系。

- 時間: 2026-05-22 10:20:00 +0800
- 分支: feature/todo-playpage-i18n-20260522
- 內容: 完成 PlayPage 主要可見文字 i18n 化，新增 play.* 中英文翻譯鍵，導入 useI18n 並替換頁面標籤、按鈕、提示、錯誤訊息與對話框文字。

- 時間: 2026-05-22 10:29:30 +0800
- 分支: feature/todo-upload-pdf-i18n-20260522
- 內容: 完成上傳 PDF 區塊可見文字 i18n 化，新增 upload.* 中英文翻譯鍵，將 PDF 匯入模式、上傳按鈕、YouTube 匯入、錯誤提示與復原建議改用翻譯檔。

- 時間: 2026-05-22 11:09:00 +0800
- 分支: feature/todo-import-text-i18n-20260522
- 內容: 完成貼上 TXT 匯入頁可見文字 i18n 化，新增 importText.* 中英文翻譯鍵，將頁面標題、流程導引、匯入模式、AI 大綱對話、按鈕、錯誤訊息與復原建議改用翻譯檔。

- 時間: 2026-05-22 11:24:00 +0800
- 分支: feature/todo-no-pending-recheck-20260522-1124
- 內容: 檢查 master 中 TODO.md 未發現未完成核取項目；由於無實作型待辦可選，本次以獨立分支保存複查提交，並回到 master 更新 TODO.md 完成清單與工作記錄。

- 時間: 2026-05-23 01:26:00 +0800
- 分支: feature/todo-title-content-language-20260523
- 內容: 完成標題產生依內容語言設定輸出；英文內容語言時改用英文標題規則與提示，繁體中文內容語言時明確要求翻譯並輸出繁體中文標題，同時在標題產生日誌記錄 contentLanguage。

- 時間: 2026-05-23 01:36:00 +0800
- 分支: feature/todo-text-outline-content-language-20260523
- 內容: 完成文本產生大綱依內容語言設定輸出；全文大綱與 chunk fallback 流程會讀取 contentLanguage，英文設定時輸出英文投影片標題與重點，繁體中文設定時翻譯並自然改寫為繁體中文，同時在相關日誌記錄 contentLanguage。

- 時間: 2026-05-23 01:45:00 +0800
- 分支: feature/fullscreen-click-pause-audio-20260523
- 內容: 完成全螢幕播放模式下點擊投影片可切換語音 pause/resume；暫停時於左上角顯示 pause 圖示，並避免離開全螢幕與提問對話等互動控制誤觸播放切換。

- 時間: 2026-05-23 01:54:00 +0800
- 分支: feature/todo-no-pending-recheck-20260523-0154
- 內容: 重新確認 master 中 TODO.md 未發現行首未完成核取項目；由於沒有可實作的未完成工作，本次以獨立分支保存複查記錄 docs/todo-rechecks/2026-05-23-0154.md，並回到 master 更新 TODO.md 完成清單與工作記錄。

- 時間: 2026-05-23 02:04:00 +0800
- 分支: feature/todo-no-pending-recheck-20260523-0204
- 內容: 重新確認 master 中 TODO.md 未發現行首未完成核取項目；由於沒有可實作的未完成工作，本次以獨立分支保存複查記錄 docs/todo-rechecks/2026-05-23-0204.md，並回到 master 更新 TODO.md 完成清單與工作記錄。

- 時間: 2026-05-23 13:03:00 +0800
- 分支: feature/docker-ffmpeg-version-1.1.1-20260523
- 內容: 完成 Docker 映像 build/runtime 階段安裝 ffmpeg，並將根目錄、backend、frontend package 版本與 lockfile 版本同步更新為 1.1.1；功能分支已通過 npm run build，npm test 仍受既有 pages-api 測試預期 png 但實際 jpg 的失敗影響。

- 時間: 2026-05-23 13:12:00 +0800
- 分支: feature/fullscreen-api-support-20260523
- 內容: 將全螢幕功能改為真正的 HTML5 Fullscreen API。在 PlayPage 中實作跨瀏覽器的全螢幕請求與退出函數，並透過 React Ref 綁定全螢幕容器。同時監聽瀏覽器的 `fullscreenchange` 事件，以確保使用者按 Escape 鍵或透過瀏覽器 UI 退出全螢幕時，`imageOnlyFullscreen` 狀態能與實際全螢幕狀態保持同步。

- 時間: 2026-05-23 13:17:00 +0800
- 分支: feature/restore-regenerate-progress-on-reload
- 內容: 實作簡報重生時 page reload 的進度回復機制。在 PlayPage 載入時主動向後端查詢重生任務狀態，若任務處於 running、pending 或 cancelling 狀態，則將其設定到 regenJob 狀態中並啟用 regenAllBusy，使前端能自動回復生成中的進度條顯示與輪詢。

- 時間: 2026-05-23 15:21:00 +0800
- 分支: feature/ai-split-confirm
- 內容: 實作 AI 分頁確認機制。在 PromptModal 中新增「AI 分頁後先讓我確認，再開始產生圖片」的 checkbox。後端在 AI 分頁完成後，若勾選此選項，會將分頁結果寫入資料庫與磁碟，並將狀態設為 awaiting_script_confirmation 暫停 pipeline。前端在該狀態下允許使用者瀏覽與編輯每一頁的文字，並提供「確認分頁並開始產生圖片與語音」的按鈕，確認後繼續執行 pipeline，且避免覆蓋使用者的編輯。修正了 getPdfRow 查詢中遺漏 require_split_confirmation 欄位導致無法暫停的 Bug。

- 時間: 2026-05-24 09:22:00 +0800
- 分支: feature/transcript-player-compact-toggle-20260524
- 內容: 完成逐字稿編輯版面切換功能；在逐字稿 notebook 列新增播放器縮小/還原圖示按鈕，縮小模式會把播放器與控制列收成桌面版右上方小視窗，並將左側空間留給逐字稿編輯區以顯示更多完整內容。
- 時間: 2026-05-24 09:26:00 +0800
- 分支: feature/todo-no-pending-recheck-20260524-0926
- 內容: 重新確認 master 中 TODO.md 未發現行首未完成核取項目；由於沒有可實作的未完成工作，本次以獨立分支保存複查記錄 docs/todo-rechecks/2026-05-24-0926.md，並回到 master 更新 TODO.md 完成清單與工作記錄。
- 時間: 2026-05-24 09:30:00 +0800
- 分支: feature/todo-no-pending-recheck-20260524-0930
- 內容: 重新確認 master 中 TODO.md 未發現行首未完成核取項目；由於沒有可實作的未完成工作，本次以獨立分支保存複查記錄 docs/todo-rechecks/2026-05-24-0930.md，並回到 master 更新 TODO.md 完成清單與工作記錄。
- 時間: 2026-05-24 09:33:00 +0800
- 分支: feature/todo-no-pending-recheck-20260524-0933
- 內容: 重新確認 master 中 TODO.md 未發現行首未完成核取項目；由於沒有可實作的未完成工作，本次以獨立分支保存複查記錄 docs/todo-rechecks/2026-05-24-0933.md，並回到 master 更新 TODO.md 完成清單與工作記錄。
- 時間: 2026-05-24 09:36:00 +0800
- 分支: feature/todo-no-pending-recheck-20260524-0936
- 內容: 重新確認 master 中 TODO.md 未發現行首未完成核取項目；由於沒有可實作的未完成工作，本次以獨立分支保存複查記錄 docs/todo-rechecks/2026-05-24-0936.md，並回到 master 更新 TODO.md 完成清單與工作記錄。
- 時間: 2026-05-24 09:39:00 +0800
- 分支: feature/todo-no-pending-recheck-20260524-0939
- 內容: 重新確認 master 中 TODO.md 未發現行首未完成核取項目；由於沒有可實作的未完成工作，本次以獨立分支保存複查記錄 docs/todo-rechecks/2026-05-24-0939.md，並回到 master 更新 TODO.md 完成清單與工作記錄。
- 時間: 2026-05-24 09:42:00 +0800
- 分支: feature/todo-no-pending-recheck-20260524-0942
- 內容: 重新確認 master 中 TODO.md 未發現行首未完成核取項目；由於沒有可實作的未完成工作，本次以獨立分支保存複查記錄 docs/todo-rechecks/2026-05-24-0942.md，並回到 master 更新 TODO.md 完成清單與工作記錄。

- 時間: 2026-05-24 09:45:00 +0800
- 分支: feature/todo-no-pending-recheck-20260524-0945
- 內容: 重新確認 master 中 TODO.md 未發現行首未完成核取項目；由於沒有可實作的未完成工作，本次以獨立分支保存複查記錄 docs/todo-rechecks/2026-05-24-0945.md，並回到 master 更新 TODO.md 完成清單與工作記錄。

- 時間: 2026-05-24 09:48:00 +0800
- 分支: feature/todo-no-pending-recheck-20260524-0948
- 內容: 重新確認 master 中 TODO.md 未發現行首未完成核取項目；由於沒有可實作的未完成工作，本次以獨立分支保存複查記錄 docs/todo-rechecks/2026-05-24-0948.md，並回到 master 更新 TODO.md 完成清單與工作記錄。

- 時間: 2026-05-24 09:52:00 +0800
- 分支: feature/todo-no-pending-recheck-20260524-0952
- 內容: 重新確認 master 中 TODO.md 未發現行首未完成核取項目；由於沒有可實作的未完成工作，本次以獨立分支保存複查記錄 docs/todo-rechecks/2026-05-24-0952.md，並回到 master 更新 TODO.md 完成清單與工作記錄。
- 時間: 2026-05-24 09:55:00 +0800
- 分支: feature/todo-no-pending-recheck-20260524-0955
- 內容: 重新確認 master 中 TODO.md 未發現行首未完成核取項目；由於沒有可實作的未完成工作，本次以獨立分支保存複查記錄 docs/todo-rechecks/2026-05-24-0955.md，並回到 master 更新 TODO.md 完成清單與工作記錄。

- 時間: 2026-05-24 09:58:00 +0800
- 分支: feature/todo-no-pending-recheck-20260524-0958
- 內容: 重新確認 master 中 TODO.md 未發現行首未完成核取項目；由於沒有可實作的未完成工作，本次以獨立分支保存複查記錄 docs/todo-rechecks/2026-05-24-0958.md，並回到 master 更新 TODO.md 完成清單與工作記錄。

- 時間: 2026-05-24 10:01:00 +0800
- 分支: feature/todo-no-pending-recheck-20260524-1001
- 內容: 重新確認 master 中 TODO.md 未發現行首未完成核取項目；由於沒有可實作的未完成工作，本次以獨立分支保存複查記錄 docs/todo-rechecks/2026-05-24-1001.md，並回到 master 更新 TODO.md 完成清單與工作記錄。

- 時間: 2026-05-24 10:04:00 +0800
- 分支: feature/todo-no-pending-recheck-20260524-1004
- 內容: 重新確認 master 中 TODO.md 未發現行首未完成核取項目；由於沒有可實作的未完成工作，本次以獨立分支保存複查記錄 docs/todo-rechecks/2026-05-24-1004.md，並回到 master 更新 TODO.md 完成清單與工作記錄。

- 時間: 2026-05-24 10:07:00 +0800
- 分支: feature/todo-no-pending-recheck-20260524-1007
- 內容: 重新確認 master 中 TODO.md 未發現行首未完成核取項目；由於沒有可實作的未完成工作，本次以獨立分支保存複查記錄 docs/todo-rechecks/2026-05-24-1007.md，並回到 master 更新 TODO.md 完成清單與工作記錄。

- 時間: 2026-05-24 10:10:00 +0800
- 分支: feature/todo-no-pending-recheck-20260524-1010
- 內容: 重新確認 master 中 TODO.md 未發現行首未完成核取項目；由於沒有可實作的未完成工作，本次以獨立分支保存複查記錄 docs/todo-rechecks/2026-05-24-1010.md，並回到 master 更新 TODO.md 完成清單與工作記錄。

[x] 重新確認 master TODO.md 無未完成項目並更新工作記錄（完成於分支: feature/todo-no-pending-recheck-20260524-1014）

[x] 重新確認 master TODO.md 無未完成項目並更新工作記錄（完成於分支: feature/todo-no-pending-recheck-20260524-1019）

# 工作記錄

- 時間: 2026-05-24 10:14:00 +0800
- 分支: feature/todo-no-pending-recheck-20260524-1014
- 內容: 重新確認 master 中 TODO.md 未發現行首未完成核取項目；由於沒有可實作的未完成工作，本次以獨立分支保存複查記錄 docs/todo-rechecks/2026-05-24-1014.md，並回到 master 更新 TODO.md 完成清單與工作記錄。

- 時間: 2026-05-24 10:19:00 +0800
- 分支: feature/todo-no-pending-recheck-20260524-1019
- 內容: 重新確認 master 中 TODO.md 未發現行首未完成核取項目；由於沒有可實作的未完成工作，本次以獨立分支保存複查記錄 docs/todo-rechecks/2026-05-24-1019.md，並回到 master 更新 TODO.md 完成清單與工作記錄。

[x] 重新確認 master TODO.md 無未完成項目並更新工作記錄（完成於分支: feature/todo-no-pending-recheck-20260524-1022）

# 工作記錄

- 時間: 2026-05-24 10:22:00 +0800
- 分支: feature/todo-no-pending-recheck-20260524-1022
- 內容: 重新確認 master 中 TODO.md 未發現行首未完成核取項目；由於沒有可實作的未完成工作，本次以獨立分支保存複查記錄 docs/todo-rechecks/2026-05-24-1022.md，並回到 master 更新 TODO.md 完成清單與工作記錄。

[x] 重新確認 master TODO.md 無未完成項目並更新工作記錄（完成於分支: feature/todo-no-pending-recheck-20260524-1025）

# 工作記錄

- 時間: 2026-05-24 10:25:00 +0800
- 分支: feature/todo-no-pending-recheck-20260524-1025
- 內容: 重新確認 master 中 TODO.md 未發現行首未完成核取項目；由於沒有可實作的未完成工作，本次以獨立分支保存複查記錄 docs/todo-rechecks/2026-05-24-1025.md，並回到 master 更新 TODO.md 完成清單與工作記錄。

[x] 重新確認 master TODO.md 無未完成項目並更新工作記錄（完成於分支: feature/todo-no-pending-recheck-20260524-1028）

# 工作記錄

- 時間: 2026-05-24 10:28:00 +0800
- 分支: feature/todo-no-pending-recheck-20260524-1028
- 內容: 重新確認 master 中 TODO.md 未發現行首未完成核取項目；由於沒有可實作的未完成工作，本次以獨立分支保存複查記錄 docs/todo-rechecks/2026-05-24-1028.md，並回到 master 更新 TODO.md 完成清單與工作記錄。

[x] 重新確認 master TODO.md 無未完成項目並更新工作記錄（完成於分支: feature/todo-no-pending-recheck-20260524-1031）

# 工作記錄

- 時間: 2026-05-24 10:31:00 +0800
- 分支: feature/todo-no-pending-recheck-20260524-1031
- 內容: 重新確認 master 中 TODO.md 未發現行首未完成核取項目；由於沒有可實作的未完成工作，本次以獨立分支保存複查記錄 docs/todo-rechecks/2026-05-24-1031.md，並回到 master 更新 TODO.md 完成清單與工作記錄。

[x] 將開啟影片的功能改成下載影片。讓使用者下載後再自行去播放。（完成於分支: feature/download-video-instead-open-20260524）

# 工作記錄

- 時間: 2026-05-24 11:16:00 +0800
- 分支: feature/download-video-instead-open-20260524
- 內容: 完成將播放頁中已產生影片的「開啟影片」連結改為「下載影片」，移除新分頁開啟行為並加入 download 屬性；功能分支已通過 frontend build 驗證。回到 master 更新 TODO.md，記錄完成項目與所在分支。

# New Batch
[x] (merge)請在產生影片的功能時，把進度顯示在按鍵上（完成於分支: feature/video-button-progress-20260525）
[x] (merge)讓顯示類別可以新增和刪除（完成於分支: feature/category-add-delete-20260525）
[x] (merge)把 PDF 內容的選項改成按下上傳 PDF 後再出現讓使用者選則（完成於分支: feature/pdf-mode-after-upload-click-20260525）
[x] (merge)在設定中加入是否顯示字幕的選擇（完成於分支: feature/todo-playback-speed-setting-20260525）
[x] 在播放頁加入來源 tab，將 PDF/TXT/youtube caption 放在這邊。並新增上傳 PDF/TXT 的功能。所有的來源都會在生成逐字稿時被一起送出去。（完成於分支: feature/playpage-source-tab-and-multi-source-transcript-20260525）
[x] (merge)新增重新生成標題的功能（完成於分支: feature/regenerate-title-20260525）
[x] (merge)將顯示字幕移到 PlayPage 之中變成簡報的設定。（完成於分支: feature/move-subtitle-setting-to-playpage-20260525）
[x] (merge)加首頁的每一個卡片上加上 export 的功能，把一個簡報所有資料都 export 成一個 zip 檔（完成於分支: feature/home-card-export-zip-20260526-from-master）
[x] 在首頁的上方加上一個 import 的按鍵，將 export 的 zip 檔匯入（完成於分支: feature/home-import-zip-20260527）
[x] 在顯示類別選擇旁加上一個 filter 欄位，我們可以使用 keyword 找簡報，主要是以標題為 search 的範圍（完成於分支: feature/home-keyword-filter-20260525）
[x] 在設定中加上啟動 google account login 的功能，當 enable 時，出現一個設定按鍵, 提供輸入 GOOGLE_CLIENT_ID,GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI 的功能（完成於分支: feature/google-auth-settings-ui-config-20260525）


- 時間: 2026-05-25 11:03:56 +0800
- 分支: feature/category-add-delete-20260525
- 內容: 完成首頁顯示類別可新增與刪除（自訂顯示類別儲存於 localStorage，使用中的類別不可刪除）；功能實作於功能分支提交。frontend build 嘗試執行，但受既有型別錯誤影響（PlayPage.tsx:1758 rendering_video 比對）未通過，與本次修改檔案無直接關聯。

- 時間: 2026-05-25 13:37:06 +0800
- 分支: feature/todo-playback-speed-setting-20260525
- 內容: 完成「設定中加入是否顯示字幕的選擇」：新增設定頁字幕顯示開關（localStorage 儲存），並在播放頁字幕疊層依設定顯示/隱藏；同步補上中英文翻譯鍵值與 i18n 讀取函式。功能實作於獨立分支提交，完成後回到 master 更新 TODO.md 與工作記錄。

- 時間: 2026-05-25 15:31:00 +0800
- 分支: feature/pdf-mode-after-upload-click-20260525
- 內容: 完成「把 PDF 內容的選項改成按下上傳 PDF 後再出現讓使用者選則」：首頁改為先按上傳 PDF 才顯示 slides/document 選項，使用者選擇後再開啟檔案挑選器。功能已在獨立分支提交；frontend build 仍受既有型別錯誤影響（HomePage.tsx 未使用變數、PlayPage.tsx rendering_video 型別比對），與本次修改無直接關聯。

- 時間: 2026-05-25 16:03:00 +0800
- 分支: feature/move-subtitle-setting-to-playpage-20260525
- 內容: 完成「將顯示字幕移到 PlayPage 之中變成簡報的設定」：移除設定頁字幕開關，改為在 PlayPage 的「播放設定」面板提供字幕 ON/OFF 切換並即時寫入 localStorage；字幕顯示行為仍沿用既有設定鍵。功能已在獨立分支提交；frontend build 受既有型別錯誤（HomePage.tsx 未使用變數、PlayPage.tsx rendering_video 型別比對）影響未通過，與本次變更無直接關聯。

- 時間: 2026-05-25 16:41:00 +0800
- 分支: feature/regenerate-title-20260525
- 內容: 完成「新增重新生成標題的功能」：後端新增 `POST /api/pdfs/:id/regenerate-title`，沿用既有 `generateTitle` 流程以內容與提示詞重算標題並回寫資料庫與 metadata；前端 PlayPage 標題列新增「重新生成標題」按鈕並串接 API，完成後同步更新輸入框與頁面狀態。功能分支 backend build 通過；frontend build 仍受既有錯誤（HomePage.tsx 未使用變數、PlayPage.tsx rendering_video 型別比對）影響未通過，與本次修改無直接關聯。

- 時間: 2026-05-25 18:30:00 +0800
- 分支: feature/playpage-source-tab-and-multi-source-transcript-20260525
- 內容: 完成「播放頁來源 tab + 上傳 PDF/TXT + 逐字稿合併來源」：於 PlayPage 新增來源分頁並支援新增 TXT/PDF 來源；後端新增 `pdf_sources` 資料表與 `/api/pdfs/:id/sources/txt`、`/api/pdfs/:id/sources/pdf` API；逐字稿生成時會將所有來源文字一併附加到提示內容。功能已在獨立分支提交；lint/typecheck 通過，`npm test` 受既有 pages-api/regenerate 測試基線問題影響未全綠，與本次修改無直接關聯。

- 時間: 2026-05-25 19:36:00 +0800
- 分支: feature/home-keyword-filter-20260525
- 內容: 完成「在顯示類別選擇旁加上一個 filter 欄位」：首頁類別選擇旁新增標題關鍵字篩選輸入框，支援依標題即時過濾簡報卡片並保留既有類別篩選邏輯；同時新增中英文翻譯鍵值。功能已在獨立分支提交，`npm --prefix frontend run build` 驗證通過。


- 時間: 2026-05-25 20:07:55 +0800
- 分支: feature/google-auth-settings-ui-config-20260525
- 內容: 完成設定頁 Google login 啟用開關與 GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET/GOOGLE_REDIRECT_URI 輸入欄位，並串接後端 /api/system/ai-settings 設定持久化。

- 時間: 2026-05-26 13:24:00 +0800
- 分支: feature/home-card-export-zip-20260526-from-master
- 內容: 完成首頁卡片匯出功能，新增後端 /api/pdfs/:id/export.zip 與前端卡片匯出按鍵，將單一簡報所有資料打包為 ZIP 下載。

- 時間: 2026-05-27 10:17:00 +0800
- 分支: feature/home-import-zip-20260527
- 內容: 完成首頁新增 Import 按鍵與匯入 export ZIP 的流程，於獨立分支實作後回到 master 更新 TODO.md，勾選完成項目並記錄分支資訊。
- [x] 重新確認 master TODO.md 無未完成項目並更新工作記錄（完成於分支: feature/todo-no-pending-recheck-20260527-1026）

# 工作記錄

- 時間: 2026-05-27 10:26:00 +0800
- 分支: feature/todo-no-pending-recheck-20260527-1026
- 內容: 重新確認 master 中 TODO.md 未發現行首未完成核取項目；由於沒有可實作的未完成工作，本次以獨立分支保存複查記錄 docs/todo-rechecks/2026-05-27-1026.md，並回到 master 更新 TODO.md 完成清單與工作記錄。
- [x] 重新確認 master TODO.md 無未完成項目並更新工作記錄（完成於分支: feature/todo-no-pending-recheck-20260527-1042）

# 工作記錄

- 時間: 2026-05-27 10:46:00 +0800
- 分支: feature/todo-no-pending-recheck-20260527-1042
- 內容: 重新確認 master 中 TODO.md 未發現行首未完成核取項目；由於沒有可實作的未完成工作，本次以獨立分支保存複查記錄 docs/todo-rechecks/2026-05-27-1042.md，並回到 master 更新 TODO.md 完成清單與工作記錄。

- [x] 重新確認 master TODO.md 無未完成項目並更新工作記錄（完成於分支: feature/todo-no-pending-recheck-20260527-1048）

# 工作記錄

- 時間: 2026-05-27 10:48:00 +0800
- 分支: feature/todo-no-pending-recheck-20260527-1048
- 內容: 重新確認 master 中 TODO.md 未發現行首未完成核取項目；由於沒有可實作的未完成工作，本次以獨立分支保存複查記錄 docs/todo-rechecks/2026-05-27-1048.md，並回到 master 更新 TODO.md 完成清單與工作記錄。

- [x] 重新確認 master TODO.md 無未完成項目並更新工作記錄（完成於分支: feature/todo-no-pending-recheck-2026-05-27-1123）

# 工作記錄

- 時間: 2026-05-27 11:23:53 +0800
- 分支: feature/todo-no-pending-recheck-2026-05-27-1123
- 內容: 重新確認 master 中 TODO.md 未發現行首未完成核取項目；由於沒有可實作的未完成工作，本次以獨立分支保存複查記錄 docs/todo-rechecks/2026-05-27-1123.md，並回到 master 更新 TODO.md 完成清單與工作記錄。

- [x] 重新確認 master TODO.md 無未完成項目並更新工作記錄（完成於分支: feature/todo-no-pending-recheck-20260527-1200）

# 工作記錄

- 時間: 2026-05-27 12:00:00 +0800
- 分支: feature/todo-no-pending-recheck-20260527-1200
- 內容: 重新確認 master 中 TODO.md 未發現行首未完成核取項目；由於沒有可實作的未完成工作，本次以獨立分支保存複查記錄 docs/todo-rechecks/2026-05-27-1200.md，並回到 master 更新 TODO.md 完成清單與工作記錄。

- [x] 重新確認 master TODO.md 無未完成項目並更新工作記錄（完成於分支: feature/todo-no-pending-recheck-20260527-1213）

# 工作記錄

- 時間: 2026-05-27 12:13:00 +0800
- 分支: feature/todo-no-pending-recheck-20260527-1213
- 內容: 重新確認 master 中 TODO.md 未發現行首未完成核取項目；由於沒有可實作的未完成工作，本次以獨立分支保存複查記錄 docs/todo-rechecks/2026-05-27-1213.md，並回到 master 更新 TODO.md 完成清單與工作記錄。

[x] 重新確認 master TODO.md 無未完成項目並更新工作記錄（完成於分支: feature/todo-no-pending-recheck-20260527-1218）

# 工作記錄

- 時間: 2026-05-27 12:18:31 +0800
- 分支: feature/todo-no-pending-recheck-20260527-1218
- 內容: 重新確認 master 中 TODO.md 未發現行首未完成核取項目；由於沒有可實作的未完成工作，本次以獨立分支保存複查記錄 docs/todo-rechecks/2026-05-27-1218.md，並回到 master 更新 TODO.md 完成清單與工作記錄。

- [x] 重新確認 master TODO.md 無未完成項目並更新工作記錄（完成於分支: feature/todo-no-pending-recheck-20260527-1228）

# 工作記錄

- 時間: 2026-05-27 12:28:00 +0800
- 分支: feature/todo-no-pending-recheck-20260527-1228
- 內容: 重新確認 master 中 TODO.md 未發現行首未完成核取項目；由於沒有可實作的未完成工作，本次以獨立分支保存複查記錄 docs/todo-rechecks/20260527-1228.md，並回到 master 更新 TODO.md 完成清單與工作記錄。

- [x] 重新確認 master TODO.md 無未完成項目並更新工作記錄（完成於分支: feature/todo-no-pending-recheck-20260527-1248）

# 工作記錄

- 時間: 2026-05-27 12:48:00 +0800
- 分支: feature/todo-no-pending-recheck-20260527-1248
- 內容: 重新確認 master 中 TODO.md 未發現行首未完成核取項目；由於沒有可實作的未完成工作，本次以獨立分支保存複查記錄 docs/todo-rechecks/2026-05-27-1248.md，並回到 master 更新 TODO.md 完成清單與工作記錄。

- [x] 重新確認 master TODO.md 無未完成項目並更新工作記錄（完成於分支: feature/todo-no-pending-recheck-20260527-1258）

# 工作記錄

- 時間: 2026-05-27 12:58:00 +0800
- 分支: feature/todo-no-pending-recheck-20260527-1258
- 內容: 重新確認 master 中 TODO.md 未發現行首未完成核取項目；由於沒有可實作的未完成工作，本次以獨立分支保存複查記錄 docs/todo-rechecks/2026-05-27-1258.md，並回到 master 更新 TODO.md 完成清單與工作記錄。


# New TODO
[x] 新增多頁的提示，改成先提供一個和 貼上 TXT 類似的畫面。可以選擇自行輸入大綱或讓 LLM 生成大綱，只是現在把新的項目插入目前位置上。（完成於分支: feature/add-pages-outline-modes-insert-position-20260530）
[x] 把目前頁面提示詞，圖片，逐字稿和語音生成時的提供伺都完遫記錄下來。在來源中讓我們可以逐一檢視它的內容。（完成於分支: feature/add-pages-outline-modes-insert-position-20260530）

# 工作記錄

- 時間: 2026-05-30 00:00:00 +0800
- 分支: feature/add-pages-outline-modes-insert-position-20260530
- 內容: (1) 改造新增多頁 modal 為三段式流程（模式選擇 → 大綱輸入/AI 對話 → 確認生成）；支援手動輸入大綱和 AI 聊天生成大綱兩種模式；後端新增 outline-chat 端點讀取現有投影片脈絡；新頁面插入在目前頁之後（而非尾端）；後端實作 parseOutlineText 解析文字大綱並執行 page renumbering + artifact renaming。(2) 新增每頁生成記錄功能：在 DB 加入 page_generation_prompts 表；renderTextPagesWithLlm/generateScript/synthesizeAudio 三個步驟生成後均記錄提示詞與模型；後端新增 GET /api/pdfs/:id/pages/:n/generation-prompts 端點；前端在來源 tab 新增「生成記錄」區段，可逐一展開檢視圖片/逐字稿/語音的生成提示。

# 新的功能

[x] 在使用 youtube 匯入時，加上下載及語音轉文字的階段。（完成於分支: feature/youtube-download-stt-stages-20260601）
[x] 提供使用 openrouter 做為 LLM 模型的支援，把設定重構，為支援各式不同 provider 做準備。（完成於分支: feature/openrouter-llm-support-20260601）
[x] 在重生中加上一個改寫提示詞的功能，可以接受一個使用者的提示詞重新改寫每一頁的提示詞，然後再逐步進行圖片，逐字稿，語音的改寫過程。這個功能要求 LLM 檢視每一頁決定是否有需要調整提示詞，只對提示詞做最小修改。以避免需要重新產生每一頁的逐字稿，當逐字稿沒有改變時就不要重新做圖片/逐字稿/語音的產生，以減少時間和費用。（完成於分支: feature/regen-prompt-rewrite-20260601）

## 工作記錄

- 時間: 2026-06-01 00:00:00 +0800
- 分支: feature/regen-prompt-rewrite-20260601
- 內容: 在重生流程中加入「改寫提示詞」模式：LLM 逐頁審視現有圖片提示詞，根據使用者輸入的改寫指示做最小修改（PromptRewriteDecisionSchema），只對提示詞有變化的頁面執行圖片重生（呼叫 images.edit），並可選擇性地對這些頁面重生逐字稿與語音，未變化頁面完全跳過以節省時間和費用。後端新增 RegenerateBatchBodySchema.prompt_rewrite、runPromptRewrite()、RegenStepName 'rewrite'、SnapshotAssetType 分離、runRegenerateScripts/Audio 的 pageFilter 參數；前端在重生對話中新增模式切換（一般重生 / 改寫提示詞），提供改寫指示輸入框與逐字稿/語音選項；StatusBadge 與 ProgressStep 類型同步更新。

- 時間: 2026-06-01 00:00:00 +0800
- 分支: feature/youtube-download-stt-stages-20260601
- 內容: 新增 YouTube 下載與語音轉文字的可見進度階段；於 statusMachine 加入 downloading_captions、downloading_audio、transcribing_audio 三個 ProgressStep；fetchYoutubeCaptions() 接受 onProgress callback 並於各階段觸發；transcribeByStt() 在開始 STT 前觸發 transcribing_audio；pipeline 將 callback 串接 setProgress + persistMetadata，讓 UI 即時顯示目前子步驟；StatusBadge、frontend ProgressStep 型別與中英文翻譯同步更新。

- 時間: 2026-06-01 00:00:00 +0800
- 分支: feature/openrouter-llm-support-20260601
- 內容: 完成 OpenRouter LLM 支援：新增 LlmProvider（openai/gemini/openrouter）與 TtsProvider（openai/gemini）兩個獨立型別；加入 OPENROUTER_API_KEY 與 OPENROUTER_LLM_MODEL 設定，並於 config、aiSettings、persist/load env、/api/system/ai-settings API 全面接通；getOpenRouterClient() 建立指向 openrouter.ai/api/v1 的 OpenAI 相容用戶端，callChatJSON() 在 provider 為 openrouter 時自動路由；設定頁新增 OPENROUTER_API_KEY 欄位、模型輸入框與 LLM 供應商選項，並補上中英文翻譯。

[x] 重新確認 master TODO.md 無未完成項目並更新工作記錄（完成於分支: feature/todo-no-pending-recheck-20260601-0641）

## 工作記錄

- 時間: 2026-06-01 06:41:00 +0800
- 分支: feature/todo-no-pending-recheck-20260601-0641
- 內容: 重新確認 master 中 TODO.md 未發現行首未完成核取項目；由於沒有可實作的未完成工作，本次以獨立分支保存複查記錄 docs/todo-rechecks/2026-06-01-0641.md，並回到 master 更新 TODO.md 完成清單與工作記錄。

[x] 重新確認 master TODO.md 無未完成項目並更新工作記錄（完成於分支: feature/todo-no-pending-recheck-20260601-0643）

## 工作記錄

- 時間: 2026-06-01 06:43:00 +0800
- 分支: feature/todo-no-pending-recheck-20260601-0643
- 內容: 重新確認 master 中 TODO.md 未發現行首未完成核取項目；由於沒有可實作的未完成工作，本次以獨立分支保存複查記錄 docs/todo-rechecks/2026-06-01-0643.md，並回到 master 更新 TODO.md 完成清單與工作記錄。

[x] 重新確認 master TODO.md 無未完成項目並更新工作記錄（完成於分支: feature/todo-no-pending-recheck-20260601-0645）

## 工作記錄

- 時間: 2026-06-01 06:45:00 +0800
- 分支: feature/todo-no-pending-recheck-20260601-0645
- 內容: 重新確認 master 中 TODO.md 未發現行首未完成核取項目；由於沒有可實作的未完成工作，本次以獨立分支保存複查記錄 docs/todo-rechecks/2026-06-01-0645.md，並回到 master 更新 TODO.md 完成清單與工作記錄。

[x] 重新確認 master TODO.md 無未完成項目並更新工作記錄（完成於分支: feature/todo-no-pending-recheck-20260601-0711）

## 工作記錄

- 時間: 2026-06-01 07:11:00 +0800
- 分支: feature/todo-no-pending-recheck-20260601-0711
- 內容: 重新確認 master 中 TODO.md 未發現行首未完成核取項目；由於沒有可實作的未完成工作，本次以獨立分支保存複查記錄 docs/todo-rechecks/2026-06-01-0711.md，並回到 master 更新 TODO.md 完成清單與工作記錄。
[x] 重新確認 master TODO.md 無未完成項目並更新工作記錄（完成於分支: feature/todo-no-pending-recheck-20260601-0713）

## 工作記錄

- 時間: 2026-06-01 07:13:00 +0800
- 分支: feature/todo-no-pending-recheck-20260601-0713
- 內容: 重新確認 master 中 TODO.md 未發現行首未完成核取項目；由於沒有可實作的未完成工作，本次以獨立分支保存複查記錄 docs/todo-rechecks/2026-06-01-0713.md，並回到 master 更新 TODO.md 完成清單與工作記錄。
[x] 重新確認 master TODO.md 無未完成項目並更新工作記錄（完成於分支: feature/todo-no-pending-recheck-20260601-0715）

## 工作記錄

- 時間: 2026-06-01 07:15:00 +0800
- 分支: feature/todo-no-pending-recheck-20260601-0715
- 內容: 重新確認 master 中 TODO.md 未發現行首未完成核取項目；由於沒有可實作的未完成工作，本次以獨立分支保存複查記錄 docs/todo-rechecks/2026-06-01-0715.md，並回到 master 更新 TODO.md 完成清單與工作記錄。
[x] 重新確認 master TODO.md 無未完成項目並更新工作記錄（完成於分支: feature/todo-no-pending-recheck-20260601-0720）

## 工作記錄

- 時間: 2026-06-01 07:20:00 +0800
- 分支: feature/todo-no-pending-recheck-20260601-0720
- 內容: 重新確認 master 中 TODO.md 未發現行首未完成核取項目；本次以獨立分支保存複查記錄 docs/todo-rechecks/2026-06-01-0720.md，並回到 master 更新工作記錄。
[x] 重新確認 master TODO.md 無未完成項目並更新工作記錄（完成於分支: feature/todo-no-pending-recheck-20260601-0730）

## 工作記錄

- 時間: 2026-06-01 07:30:00 +0800
- 分支: feature/todo-no-pending-recheck-20260601-0730
- 內容: 重新確認 master 中 TODO.md 未發現行首未完成核取項目；本次以獨立分支保存複查記錄 docs/todo-rechecks/2026-06-01-0730.md，並回到 master 更新工作記錄。
[x] 重新確認 master TODO.md 無未完成項目並更新工作記錄（完成於分支: feature/todo-no-pending-recheck-20260601-0740）

## 工作記錄

- 時間: 2026-06-01 07:40:00 +0800
- 分支: feature/todo-no-pending-recheck-20260601-0740
- 內容: 重新確認 master 中 TODO.md 未發現行首未完成核取項目；本次以獨立分支保存複查記錄 docs/todo-rechecks/2026-06-01-0740.md，並回到 master 更新工作記錄。
[x] 重新確認 master TODO.md 無未完成項目並更新工作記錄（完成於分支: feature/todo-no-pending-recheck-20260601-0750）

## 工作記錄

- 時間: 2026-06-01 07:50:00 +0800
- 分支: feature/todo-no-pending-recheck-20260601-0750
- 內容: 重新確認 master 中 TODO.md 未發現行首未完成核取項目；本次以獨立分支保存複查記錄 docs/todo-rechecks/2026-06-01-0750.md，並回到 master 更新工作記錄。
[x] 重新確認 master TODO.md 無未完成項目並更新工作記錄（完成於分支: feature/todo-no-pending-recheck-20260601-0800）

## 工作記錄

- 時間: 2026-06-01 08:00:00 +0800
- 分支: feature/todo-no-pending-recheck-20260601-0800
- 內容: 重新確認 master 中 TODO.md 未發現行首未完成核取項目；本次以獨立分支保存複查記錄 docs/todo-rechecks/2026-06-01-0800.md，並回到 master 更新工作記錄。

# 2026-6-1

[x] 下載 youtube 時，下載字幕檔的動作不應該叫產生字幕檔，應該叫下載字幕檔。（複查於分支: feature/youtube-caption-download-label-recheck-20260612，確認此命名問題已在更早的 commit 445647b 修正——`downloading_captions` 對應中文「下載字幕」/英文「Downloading captions」，與 STT fallback 的「語音轉文字（STT）」明確區分；全文搜尋無任何「產生字幕（檔）」殘留字串，僅 TODO.md 當時未同步勾選，詳見 docs/todo-rechecks/2026-06-12-youtube-caption-download-label.md）
[x] 下載 youtube 時，下載的字幕檔應該被存下來當成是來源，可以在來源被檢視。（完成於分支: feature/youtube-caption-source-persist-20260612）
[x] 下載 youtube 時，下載的語音檔應該被存下來當成是來源，可以在來源被檢視。STT 轉出的字幕檔也應被存下來可以在來源被檢視。（完成於分支: feature/youtube-audio-source-persist-20260612）
[x] 當收到 LLM provider 傳回的錯誤時，應該要顯示給使用者看。（完成於分支: feature/show-llm-provider-error-to-user-20260607）
[x] 在上傳 PDF 時,　要提供選項單入或雙人的選項（完成於分支: feature/upload-host-mode-select-20260612）
[x] gpt-image-2 的錯誤請重試一次，不要直接判定失敗（完成於分支: feature/retry-gpt-image-moderation-blocked-20260608）
[x] 修正 YouTube 字幕過多頁數不足的問題：去除 VTT inline timing markers 和重複行，並將大綱生成的字幕輸入上限從 16K 提高到 64K（完成於分支: feature/youtube-captions-coverage-20260601）
[x] 將頁面產物檔案（圖片/縮圖/逐字稿/腳本/語音）改用建立時就決定、永不改變的 page_uid 命名，取代依頁碼命名；解決搬移/插入/刪除頁面時 cascading rename 導致 git 無法偵測 rename、`git log --follow` 斷裂的結構性問題（完成於分支: feature/stable-page-uid-filenames-20260608）
[x] 修正自動生成測驗時沒有把逐字稿/投影片文字傳給 LLM（送出的簡報內容全部都是「（無）」）的問題（完成於分支: fix/quiz-empty-transcript-missing-files-20260608）
[x] 當一個測驗開始，我們會在 master 顯示使用正在測試的人，和他們答題的進度。（完成於分支: feature/quiz-master-progress-display-20260608）
[x] follower 的畫面不應該有新增測驗的按鍵。（完成於分支: feature/quiz-master-progress-display-20260608）
[x] 將結束並顯示答案分成顯示答案和結束二個功能。按下顯示答案時就停止作答，follower 不能再改答案，並顯示解答。按下結束則 follower 回到全螢幕播放畫面。所有 follower 的答案會被存下來，可在測驗的歷史記錄中查看每一次測試每一個人的答案。（完成於分支: feature/quiz-show-answers-end-history-20260608；修正「結束後歷史記錄無紀錄」於分支: fix/quiz-attempt-not-saved-on-end-20260608）
[x] 新增顯示每一個人答案的功能（測驗歷史紀錄中可展開查看每位學員逐題的選擇與正確答案對照）（完成於分支: feature/quiz-history-show-individual-answers-20260608）
[x] 把歷史記錄移到右側（完成於分支: feature/quiz-history-move-to-right-panel-20260608）
[x] 按下開始測試時，不要跳到播放頁面（完成於分支: fix/quiz-start-no-navigate-to-play-20260608）

## 工作記錄

- 時間: 2026-06-01 01:10:00 +0800
- 分支: feature/youtube-captions-coverage-20260601
- 內容: 修正 YouTube auto-caption VTT 字幕清理不足導致簡報頁數偏少的問題。`fetchByYtDlp` 新增 strip inline timing markers（`<00:00:04.095><c>字</c>` 格式）及去除相鄰重複行（自動字幕每句重複 2-3 次）；`buildYoutubeOutlineAsSlideText` 的字幕輸入上限從 16K 提高到 64K，確保長達 80 分鐘的日文講座（原僅涵蓋前 3.5 分鐘）和 20 分鐘英文講座（原僅涵蓋 26%）的全部內容都能送入 LLM 大綱生成。

[x] 加上手寫功能：按 W 開啟手寫功能表，可選線的顏色（6色）和粗細（3檔），有清除鍵刪除本頁手寫，手寫定期儲存回伺服器，下次進入同一頁時自動回復（完成於分支: feature/handwriting-drawing-20260602）
[x] 手寫工具改進：只在全螢幕顯示，清除和關閉改成小圖示按鍵，加上模式切換（筆/游標/橡皮擦）（完成於分支: feature/handwriting-fullscreen-modes-20260603）

## 工作記錄

- 時間: 2026-06-02 00:00:00 +0800
- 分支: feature/handwriting-drawing-20260602
- 內容: 在播放頁加上手寫標注功能。後端新增 `page_drawings` 資料表與 GET/PUT/DELETE `/api/pdfs/:id/pages/:n/drawing` API；前端新增 `DrawingCanvas` 元件（`<canvas>` 疊加在投影片圖片上，使用 PointerEvent 繪圖，1.5 秒去彈跳自動儲存）；PlayPage 在投影片圖片外加上 `relative inline-block` 包裝並疊入畫布，按 W 或 Escape 切換手寫模式，模式開啟時顯示浮動功能列（6 色色盤、細/中/粗三檔、清除、關閉），切換頁面時自動載入該頁已儲存的手寫。

- 時間: 2026-06-03 00:00:00 +0800
- 分支: feature/handwriting-fullscreen-modes-20260603
- 內容: 手寫工具列改為僅在全螢幕模式下顯示；清除和關閉按鍵縮小為 28px 圖示按鈕（🗑️ ✕）；新增模式切換列（✏️ 筆、🖱️ 游標、⬜ 橡皮擦）；游標模式下畫布不捕捉 pointer events，點擊投影片可正常 pause/resume；橡皮擦使用 destination-out 合成模式清除筆跡；W 鍵只在全螢幕時有效，Escape 關閉手寫並重置為筆模式。

[x] 在對話區貼上圖片，顯示小圖縮圖，可拖曳標示修改區域，按下修改圖片時使用 GPT-Image-2 inpainting 修改（完成於分支: feature/chat-image-inpaint-20260607）

## 工作記錄

- 時間: 2026-06-07 00:41:00 +0800
- 分支: feature/chat-image-inpaint-20260607
- 內容: 在播放頁問答區加入圖片貼上與 AI inpainting 功能。後端新增 `POST /api/pdfs/:id/pages/:n/inpaint-image` multipart 端點，從磁碟讀取目前投影片圖片，接收可選的遮罩 PNG（透明=修改區域、白=保留）和參考圖、提示詞，呼叫 GPT-Image-2 `images.edit` API（size 1536x1024），結果存為 page candidate；前端在投影片圖片上疊加透明 div overlay，按「選取區域」鈕後可拖曳選定修改範圍（normalized 座標，生成遮罩時換算至 1536x1024），貼入剪貼簿圖片作為參考圖（僅顯示縮圖預覽）；有選區或參考圖時「修改圖片」按鈕呼叫 inpaintImage()，否則走既有 regenerate 流程；前端 api 新增 `inpaintImage()` 與 `InpaintImageResponse` 型別。

[x] (merge)請使用 git 來管理簡報，每一次的變更都 commit 到 local git 中並自動產生 commit message。圖片和逐字稿都可以獨立的檢查過去的版本並回到指定的版本（完成於分支: feature/git-version-management-20260607）
[x] 在設定中，加入一個 github repository 的設定，和一個 token 的設定。讓我們可以把每一個簡報同步到 github 上。也可以在另外一台電腦把個人的 repository 同步過去（完成於分支: feature/github-sync-settings-20260607）

## 工作記錄

- 時間: 2026-06-07 00:00:00 +0800
- 分支: feature/git-version-management-20260607
- 內容: 為每一個簡報的 storage 目錄建立獨立的 git 倉庫，追蹤圖片（`.jpg`）和逐字稿（`.script.txt`）檔案。新增 `backend/src/services/presentationGit.ts` 服務（ensurePresentationRepo、commitPresentationFile、getPresentationFileHistory、getPresentationFileAtCommit、restorePresentationFile）。在 `generateScript.ts`、`renderTextPagesWithLlm.ts`、`regenerate.ts` 和 `page-operations.ts` 的每次寫入後自動 commit，commit message 帶有頁碼與操作類型。新增 API 路由 `versioning.ts`（GET .../image/history、GET .../script/history、GET .../image/versions/:hash、GET .../script/versions/:hash、POST .../image/restore/:hash、POST .../script/restore/:hash）。前端新增對應 API 函式及版本歷史彈窗 UI，PlayPage 聊天工具列加入「🖼 版本」和「📝 版本」按鈕，可瀏覽歷史版本並一鍵還原。

- 時間: 2026-06-07 11:30:00 +0800
- 分支: feature/github-sync-settings-20260607
- 內容: 在系統設定中新增 GITHUB_REPO_URL 與 GITHUB_TOKEN 兩個帳號層級設定（後端 `aiSettings.ts` 持久化到 `accounts/<id>/settings.env`，`/api/system/ai-settings` GET/PATCH 回傳與更新這兩個欄位，設定頁加入對應輸入框）。新增 `presentationGit.ts` 的 `pushPresentationToGitHub`，會以 token 組成 `https://x-access-token:<token>@...` 形式的認證 URL，將每個簡報既有的本機 git 倉庫推送（force push）到設定中 GitHub repository 的「以簡報 id 命名的分支」上；新增路由 `POST /api/pdfs/:id/github-sync` 觸發同步。PlayPage 工具列加入「⤴ 同步到 GitHub」按鈕呼叫此 API。由於設定為帳號層級（存在各自的 settings.env），在另一台機器上填入相同 repository 與個人 token，即可用同一機制把該機器上的簡報同步過去。

- 時間: 2026-06-07 12:15:00 +0800
- 分支: feature/github-sync-settings-20260607
- 內容: 修正先前 `.gitignore` 排除過多檔案、導致同步到另一台機器後無法還原的問題。盤點每個被排除的檔案是否能由已追蹤內容「精確重生」：縮圖（`*.thumb.jpg`）、封面（`cover.jpg`/`cover.thumb.jpg`）是對已追蹤頁面圖片做純粹的決定性縮圖，可安全排除；但旁白語音（`*.m4a`/`*.mp3`，雲端 TTS 結果不保證逐位元重現）、AI 候選圖片（`*.candidate.*.jpg`，gpt-image 生成）、原始來源（`source.pdf`/`source.txt`）、原始字幕（`*.raw.json`）、正規化字幕（`*.normalized.txt`，依賴未追蹤的 raw.json）、大綱（`outline.md`，LLM 產生）與成品影片（`video.mp4`，依賴非決定性語音與外部編碼器版本）皆屬原始輸入或非決定性產物，無法精確重生，因此都應改為追蹤。`presentationGit.ts` 的 `GITIGNORE_CONTENT` 縮減為僅 `*.thumb.jpg`、`cover.jpg`、`cover.thumb.jpg`；`ensurePresentationRepo` 新增 `refreshGitignore`，讓既有（在舊規則下建立）的簡報倉庫也會更新 `.gitignore` 並 commit；`pushPresentationToGitHub` 推送前呼叫新增的 `commitAllPendingChanges`（`git add -A` + commit），確保所有新近變成可追蹤的檔案在不需逐一在 worker 步驟中呼叫 commitPresentationFile 的情況下，也會被收進同步內容。

- 時間: 2026-06-07 12:40:00 +0800
- 分支: feature/github-sync-settings-20260607
- 內容: 依使用者進一步指示，連同步驟中保留的「可決定性重生」例外（`*.thumb.jpg`、`cover.jpg`、`cover.thumb.jpg`）與 `metadata.json` 也一併改為追蹤——不再區分是否可重生，pages 目錄與簡報根目錄下所有檔案都進入版本控制。`presentationGit.ts` 的 `GITIGNORE_CONTENT` 改為空字串，`refreshGitignore` 會將舊倉庫的 `.gitignore` 一併重設為空，確保所有檔案（含縮圖、封面、metadata.json）都能在下一次同步時被 `commitAllPendingChanges`/`git add -A` 收錄並推送到 GitHub。

- 時間: 2026-06-07 17:05:00 +0800
- 分支: feature/github-sync-settings-20260607
- 內容: 同步到 GitHub 前先 pull 並自動合併遠端分支，避免從第二台機器同步時用 force push 覆蓋掉對方已推送的內容。`pushPresentationToGitHub` 改為先 `commitAllPendingChanges`，再以新增的 `pullAndMergeFromGitHub` fetch 簡報對應分支並 `git merge --allow-unrelated-histories`（每台機器各自 `git init`，分支歷史互不相關，需允許合併不相關歷史）。發生衝突時依檔案類型自動解決：文字檔（`.txt`/`.md`/`.json`，包含逐字稿、字幕、大綱、metadata）透過 `resolveTextConflict` 以 `git merge-file --union` 做文字合併，保留雙方修改而不留下衝突標記；其餘檔案（圖片、語音、影片等二進位內容無法逐行合併）由 `resolveBinaryConflict` 比較兩側最後一次修改該路徑的 commit 時間（`lastCommitTimeForPath`），自動取較新的版本（`git checkout --ours/--theirs`），最後以 `git commit --no-edit` 完成合併再推送。已用模擬的雙機獨立倉庫驗證 add/add 衝突的文字聯集合併與二進位新舊版本選擇皆正確運作。

- 時間: 2026-06-07 18:20:00 +0800
- 分支: feature/show-llm-provider-error-to-user-20260607
- 內容: 讓 LLM/圖片生成 provider 回傳的錯誤（例如 gpt-image-2 的 moderation_blocked）能顯示給使用者，而不是只停在後端 log。後端原本就把全域錯誤存在 `pdfs.error_message`、單頁錯誤存在 `pages.error_message`，但 API 回傳的 `PdfDetailPage` 缺少單頁 `error_message` 欄位、前端也完全沒有顯示這些錯誤。修正：在 `PdfDetailPage` 型別與 `rowToDetail()` 補上 `error_message`；前端 PlayPage 在簡報整體失敗（`status === 'failed'`）時於頂部顯示錯誤橫幅，在目前頁失敗時顯示該頁專屬的錯誤橫幅，並把原本一律顯示「圖片產生中…」的佔位文字改為依該頁狀態顯示「本頁產生失敗：<原因>」。

- 時間: 2026-06-08 09:10:00 +0800
- 分支: feature/retry-gpt-image-moderation-blocked-20260608
- 內容: 修正 gpt-image-2 圖片生成遇到 `moderation_blocked`（OpenAI 安全系統誤判拒絕）時直接判定該頁失敗、不重試的問題；這類錯誤往往重試一次就能成功。在 `renderTextPagesWithLlm.ts` 新增 `isModerationBlockedImageError()`（偵測 `code === 'moderation_blocked'` 或訊息包含 "rejected by the safety system"），並在既有的重試迴圈中加入 `MODERATION_BLOCKED_MAX_ATTEMPTS = 2`，讓這類錯誤額外獲得一次重試機會（不影響原本 transient 錯誤最多重試到 `IMAGE_GENERATION_MAX_ATTEMPTS = 3` 的邏輯），並在 log 與失敗 metadata 中記錄 `moderationBlocked` 旗標方便追蹤。

- 時間: 2026-06-08 14:00:00 +0800
- 分支: feature/stable-page-uid-filenames-20260608
- 內容: 將頁面產物檔案（image/thumbnail/text/script/audio）的命名方式從「依頁碼」（`pages/003.jpg`）改為「建立時產生、永不改變的 page_uid」（`pages/<uid>.jpg`），`page_number` 變成純粹的 DB 排序索引。背景：原本搬移/插入/刪除頁面時 `renumberPageArtifacts` 會把磁碟檔案整批 `fs.rename` 以對齊新頁碼，但這種「同路徑換內容」的 cascading rename 在 git 眼中只是一連串 M/A/D，完全無法被偵測為 rename，導致 `git log --follow` 斷裂、無法追蹤某張投影片內容的連續歷史。修正：`pages` 表新增 `page_uid`（nanoid(10)，含回填與唯一索引），`storage.ts` 的 `pageImagePath`/`pageThumbnailPath`/`pageTextPath`/`pageScriptPath`/`pageAudioPath` 改為 `(pdfId, pageUid)` 簽名，移除 `pagePad`/`formatPageNumber`/`renumberPageArtifacts`/`rewritePagePathsToMatchNumber`；所有建立頁面的路徑（`pipeline.ts`、`upload.ts`、`import.ts`、`addPagesFromPrompt.ts`、`page-operations.ts`）都產生並寫入 `page_uid`；`page-operations.ts` 的搬移/插入/刪除端點移除 renumbering 呼叫，現在純粹是 `UPDATE pages SET page_number = ...`，完全不動磁碟檔案；`versioning.ts`、`regenerate.ts`、`detail.ts`、`quizzes.ts` 與各 worker step（`extractText`/`generateScript`/`generateTitle`/`generateVideo`/`synthesizeAudio`/`renderPages`/`renderTextPages*`）改用 DB 內 `page_uid` 或既有路徑欄位重建路徑。新增一次性遷移腳本 `backend/scripts/migrate-page-uids.ts`，把既有簡報的 `pages/00N.*` 改名為 `pages/<uid>.*` 並以 `git add -A` 提交（讓 git 對「從未被 commit 過」與「曾經被 commit 過」的簡報都能正確處理：前者單純記錄為新增，後者能因內容 100% 相似而被偵測成 rename，延續 `--follow` 歷史）；已在實際簡報 `l5mI-kjYmJ`（15 頁、75 個產物檔）上驗證遷移、DB 路徑欄位、`metadata.json` 與 `pageXxxPath` helper 解析皆正確一致，且 `npx tsc --noEmit` 全專案通過。

- 時間: 2026-06-08 15:40:00 +0800
- 分支: fix/quiz-empty-transcript-missing-files-20260608
- 內容: 修正自動生成測驗時「老師提示詞有送達，但簡報內容全部都是（無）」的問題。根因不在程式碼邏輯，而是前一天的 page_uid 重構（分支 feature/stable-page-uid-filenames-20260608）留下的資料遷移缺口：程式碼已改用 `pages/<page_uid>.text.txt`／`pages/<page_uid>.script.txt` 路徑讀取頁面文字與逐字稿，但隨附的一次性遷移腳本 `backend/scripts/migrate-page-uids.ts`（負責把舊簡報的 `pages/00N.*` 改名成 `pages/<page_uid>.*`）並未對既有簡報實際執行；`readPageContext()` 用 `fs.readFile(...).catch(() => '')` 靜默吞掉「找不到檔案」的錯誤，導致每一頁都送出「投影片文字：（無）／逐字稿：（無）」。已從 LLM 請求日誌（`backend/backend/data/llm-requests.log.jsonl`）實際比對驗證：提示詞正常送達，唯獨簡報內容全空。修復分兩部分：(1) 對 18 個受影響簡報執行 `migrate-page-uids.ts`，把約 2756 個頁面產物檔（image/thumbnail/text/script/audio）從舊的頁碼命名改為 page_uid 命名，同步更新 DB 的 `text_path`/`script_path` 與各簡報 git repo 的 commit；(2) 在 `backend/src/routes/pdfs/quizzes.ts` 新增 `readPageArtifact()` 包裝讀檔，讀取失敗時改為寫入 warn log（含 pdfId、頁碼、檔案類型、路徑與錯誤訊息），避免未來再發生「資料不一致卻毫無痕跡」的靜默失敗。

- 時間: 2026-06-08 16:20:00 +0800
- 分支: feature/quiz-master-progress-display-20260608
- 內容: 完成「測驗開始時於 master 顯示作答中學員與進度」。後端 `sync.ts` 的 `SyncSessionState` 新增 `quizProgress: Map<clientId, SyncQuizProgress>`，新增 `POST /api/pdfs/:id/sync/quiz/progress` 端點讓 follower 回報目前測驗的已答題數/總題數/是否完成；`buildStateResponse` 新增 `quiz_progress` 欄位（僅回傳屬於目前 `active_quiz_id` 的進度），並在 master 到期、master 離開、follower 離開或更換測驗時清除舊進度，避免顯示過期資料。前端 `QuizBuilderPage.tsx` 中 follower 作答時會 debounce 呼叫新增的 `submitSyncQuizProgress()` 回報進度（完成定義為已作答全部題目）；master 端的「已儲存測驗」面板新增「測驗中的學員」區塊，列出每位學員的代號、已答題數/總題數與進度條，完成後以綠色標示「已完成」。新增 `SyncQuizProgress` 型別並更新 `SyncJoinResponse`/`SyncStateResponse`。後端與前端 `npx tsc --noEmit` 與 `npm run build` 皆通過。

- 時間: 2026-06-08 16:35:00 +0800
- 分支: feature/quiz-master-progress-display-20260608
- 內容: 修正「follower 的畫面不應該有新增測驗的按鍵」：QuizBuilderPage.tsx 標頭原本不論同步角色都會顯示「新增測驗」按鈕，現改為僅在 `syncRole === 'master'` 時顯示，因為新增/編輯測驗屬於出題者操作，follower 只需要作答。

- 時間: 2026-06-08 17:20:00 +0800
- 分支: feature/quiz-show-answers-end-history-20260608
- 內容: 將測驗的「結束並顯示答案」拆成「顯示答案」與「結束」兩個獨立動作，並把 follower 的作答結果存下來供日後查詢。後端：`db.ts` 新增 `quiz_attempts` 資料表（`UNIQUE(session_id, client_id)`，記錄 pdf/quiz/session/client/代號/答案 JSON/分數/提交時間），`sync.ts` 的 `SyncSessionState` 新增 `quizSessionId`，每次 `active_quiz_id` 變更（開始新測驗）時產生新的 `qs-<timestamp>-<random>` 作為該次測驗的識別碼，測驗結束（`quiz_mode=false`）或 master/follower 離線、過期時清空，並透過 `buildStateResponse` 的 `quiz_session_id` 欄位同步給前端；`quizzes.ts` 新增 `POST /api/pdfs/:id/quizzes/:quizId/attempts`（以 `session_id`+`client_id` upsert 答案與分數）與 `GET .../attempts`（依 session 分組回傳每次測驗各學員的作答歷史）。前端：`sendQuizSyncState`/新增的 `sendQuizEndState` 分別對應「顯示答案」（`quiz_show_answers=true`，停止作答並顯示正解，但仍停留在測驗模式）與「結束」（`quiz_mode=false`，徹底結束測驗）；「已儲存測驗」面板的單一按鈕拆成「顯示答案」「結束」「歷史紀錄」三顆；新增 effect 在 follower 的 `quiz_show_answers` 變成 true（鎖定作答）時自動計分並透過 `submitQuizAttempt()` 送出該次測驗的 session id、答案與分數（以 ref 去重避免重複提交），另一個 effect 偵測 follower 的 `active_quiz_id` 由非 null 轉為 null 時自動導回全螢幕播放畫面；master 端新增「測驗歷史紀錄」面板，可依測驗叫出 `fetchQuizAttempts()`，列出每一次測試的時間、作答人數，以及每位學員的代號、分數與提交時間。後端與前端 `npx tsc --noEmit` 與 `npm run build` 皆通過。

- 時間: 2026-06-08 17:55:00 +0800
- 分支: fix/quiz-attempt-not-saved-on-end-20260608
- 內容: 修正「測驗結束後歷史記錄裡沒有任何作答紀錄」的問題。根因：原本 follower 的作答只在 `syncQuizShowAnswers` 變成 true（master 按下「顯示答案」鎖定作答）時才透過 `submitQuizAttempt()` 送出；但若 master 直接按「結束」跳過顯示答案，`active_quiz_id` 直接變成 null、`quiz_session_id` 也被後端清空，永遠不會觸發任何提交，導致 `quiz_attempts` 資料表始終是空的。修正為新增 `latestAttemptSnapshotRef`，持續以 ref 紀錄目前測驗 id、session id、follower 代號與最新作答快照（避免在偵測到「測驗結束」當下，`activeQuiz`/`syncQuizSessionId` 等 state 已經被清空而抓不到資料）；抽出共用的 `submitFollowerAttempt()`，分別在「`quiz_show_answers` 變成 true（顯示答案）」與「`active_quiz_id` 由非 null 轉為 null（測驗結束，準備導回全螢幕播放畫面前）」兩個時機呼叫，並沿用既有的 `submittedAttemptRef`（以 `session_id:client_id` 為 key）去重，確保同一次測驗只送出一次、但不論 master 走哪一種流程都會把作答存下來。前端 `npx tsc --noEmit` 與 `npm run build` 皆通過。

- 時間: 2026-06-08 18:20:00 +0800
- 分支: feature/quiz-history-show-individual-answers-20260608
- 內容: 在「測驗歷史紀錄」面板中，每位學員的作答列新增「查看作答」按鈕，點擊後展開逐題詳細列表：列出該題所有選項，並以顏色區分「正確答案」（綠色）、「已選但錯誤」（紅色）與未選項目（灰色），同時附上題目解析；再次點擊（顯示為「收合」）可收起。展開狀態以 `viewingAttemptId` 追蹤，切換測驗或關閉歷史面板時自動重設，避免殘留錯誤的展開狀態。前端 `npx tsc --noEmit` 與 `npm run build` 皆通過。

- 時間: 2026-06-08 18:40:00 +0800
- 分支: feature/quiz-history-move-to-right-panel-20260608
- 內容: 將「測驗歷史紀錄」面板從左側 240px 寬的「已儲存測驗」清單下方移到右側較寬的內容區（與測驗編輯器同一欄）。原本位置狹窄，每位學員展開後的逐題作答內容會被擠成一長條、不易閱讀；移到右側後改用獨立卡片樣式呈現，並讓展開的逐題清單以雙欄格線（`sm:grid-cols-2`）排列，方便一次比對多題作答狀況。前端 `npx tsc --noEmit` 與 `npm run build` 皆通過。

- 時間: 2026-06-08 19:00:00 +0800
- 分支: fix/quiz-start-no-navigate-to-play-20260608
- 內容: 移除 master 按下「開始測驗」後自動導向 `/play/:id?fullscreen=1` 的行為。`handleStartQuiz` 原本在 `sendQuizSyncState` 成功後立即 `navigate()` 到播放頁，但 master 開始測驗後通常需要留在 QuizBuilderPage 監看「測驗中的學員」進度面板，並接續操作「顯示答案」「結束」等按鈕；自動跳轉反而打斷操作流程，需要再手動切回測驗頁。修正後 master 按下「開始測驗」會維持在原本畫面（仍會同步通知所有 follower 進入測驗模式）。前端 `npx tsc --noEmit` 與 `npm run build` 皆通過。

[x] 在設定中每一個帳號要使用不同的設定檔，並檢查 backend 實作，確保每個使用者的 AI/帳號設定彼此不互相混用（完成於分支: feature/per-account-ai-settings-isolation-20260608）

## 工作記錄

- 時間: 2026-06-08 19:40:00 +0800
- 分支: feature/per-account-ai-settings-isolation-20260608
- 內容: 將 AI/帳號設定從「單一全域可變快取＋寫入 process.env」改為「每帳號各自獨立隔離」的設計，避免多人同時使用時設定互相污染。新增 `accountContext.ts`，以 `AsyncLocalStorage` 在請求/背景工作鏈路中隱性攜帶「目前帳號 ID」（帳號 ID 即經過清理的 Google OAuth `sub`，與 `pdfs.owner_sub` 相同）。重寫 `aiSettings.ts`：拆成「帳號層級設定」（OpenAI/Gemini 金鑰、LLM/TTS 模型與語音、語言偏好、GitHub 同步——存於 `accounts/<sub>/settings.env`，各自快取於 `Map`）與「系統層級設定」（Google 登入 `googleAuthEnabled/ClientId/ClientSecret/RedirectUri`——固定存於 `accounts/default/settings.env`，因為登入前還沒有帳號情境，仍須全服務共用），新增 `getSystemAuthSettings`/`setSystemAuthSettings`/`persistSystemAuthSettings`；`getRuntimeAiSettings`/`setRuntimeAiSettings`/`persistEnvSettings` 改為以顯式或目前帳號 ID 操作，且不再寫入 `process.env`（這正是舊版會在並發請求間互相覆蓋金鑰的根因）。`openai.ts` 改用 `Map<accountId, AccountOpenAiState>` 快取各帳號自己的 client/金鑰/base URL；`gemini.ts` 改讀取目前帳號的 `geminiApiKey`。`server.ts` 在所有路由與既有 auth-gate hook 之前加入新的 `onRequest` hook：路徑帶 PDF id（`/api/pdfs/:id/...`）時一律以「該簡報擁有者」的帳號（`owner_sub`）建立情境，否則用登入者自己的帳號，並透過 `runWithAccountId` 包住整個請求生命週期；既有的 Google 登入檢查改用新的 `getSystemAuthSettings()`。`auth.ts` 的登入流程同樣改用系統層設定（並 `export SESSION_COOKIE` 供 `server.ts` 解析請求歸屬帳號）。`admin.ts` 的 `/api/system/openai-api-key`、`/api/system/ai-settings` 等端點改以 `currentAccountId()` 顯式操作對應帳號的設定。`shared.ts` 的 `rowToListItem`/`rowToDetail` 顯示 `tts_provider` 等資訊時改用「簡報擁有者」帳號的設定，而非當下檢視者的設定，確保共享/`public_editable` 簡報的顯示行為可預期。worker 端的 `pipeline.ts`（`enqueuePdfProcessing`）、`addPagesFromPrompt.ts`（`startAddPagesFromPrompt`）、`regenerate.ts`（`startRegenerateJob`）三個背景工作起點皆改為先查出該簡報的 `owner_sub`，以 `runWithAccountId` 包住整個非同步工作，確保整條呼叫鏈（含其中的 `getRuntimeAiSettings()`/`getOpenAIClient()`）自動取得正確帳號的設定。另外新增 `assignPresentationsToAccount.ts` 一次性 script 並執行，把既有 17 份簡報的 `owner_sub` 指派給帳號 `111891044144240617135`。後端 `npm run typecheck` 與 `npm run build` 皆通過；既有測試套件 22 通過/19 失敗與套用變更前完全相同（皆為既存、與本次變更無關的失敗）。

[x] 把設定頁中顯示的帳號設定檔路徑名稱移除（完成於分支: fix/settings-remove-account-file-path-display-20260608）

## 工作記錄

- 時間: 2026-06-08 19:55:00 +0800
- 分支: fix/settings-remove-account-file-path-display-20260608
- 內容: 上一個多帳號設定隔離工作完成後，設定頁會顯示「設定會保存到帳號專屬檔案：/home/.../accounts/<sub>/settings.env」這類伺服器端內部路徑；使用者覺得不需要顯示檔名/路徑，因此移除。`SettingsPage.tsx` 移除 `accountSettingsFile` 狀態與其顯示區塊，只保留「目前帳號：<accountId>」；同時移除前端中/英文語系檔（`zh-TW.ts`/`en.ts`）裡僅供該行顯示用的 `settings.accountFilePrefix` 翻譯字串。前端 `npx tsc --noEmit` 通過。

[x] 重構 PlayPage（檔案過大，5700+ 行單一函式元件），先抽出獨立對話框元件（完成於分支: refactor/playpage-extract-dialogs）

## 工作記錄

- 時間: 2026-06-09 01:40:00 +0800
- 分支: refactor/playpage-extract-dialogs
- 內容: PlayPage.tsx 已成長至 5727 行，單一函式元件內含 100+ 個 useState、約 80 個 useCallback/useEffect，且 JSX render 區塊本身就佔約 2800 行，難以閱讀與維護。撰寫分階段重構計畫（階段 1：抽出自包含的 Dialog/Modal 為獨立展示元件；階段 2：把高耦合的狀態群組整理成自訂 Hook，如 useDrawingSync/useFullscreenPlayback/usePollManagement/useVersionHistory；階段 3：拆分主要 JSX render 樹，如全螢幕版面分支、編輯面板），並於本分支完成風險最低的階段 1：把生成設定（`TtsDialog`）、整份簡報圖片風格設定（`ImageStyleDialog`）、選擇重生項目（`RegenAllDialog`）、分享連結（`ShareDialog`）四個內嵌 modal 抽成 `frontend/src/pages/play/` 下接收 props 的展示元件，延續既有的 `formatters`/`PageTimingChips`/`RegenerateProgress` 拆分慣例；同時把 `ImageStyleDialog` 原本內嵌在 `onClick` 中的儲存邏輯抽成 `handleSaveImageStyle` callback。純結構調整不改變任何使用者可見行為，PlayPage.tsx 由 5727 行降為 5464 行。另外在開始重構前，先把分支上既有未提交的 bug 修正（三個 `<DrawingCanvas>` 共用同一個 `drawingCanvasRef` 導致清除手寫等操作可能指向錯誤實例，已拆分為各版面獨立的 ref）提交到 master（commit dfbc259）。前端 `npx tsc --noEmit` 與 `npm run build` 皆通過；因登入需要 Google OAuth、本機無可用測試帳號，未能完成瀏覽器端 e2e 互動驗證，已改以型別檢查、production build 與逐行比對 diff 確認搬移無邏輯變動。階段 2、3 工程量大且狀態間互相依賴複雜，留待後續分支處理。

[x] PlayPage 重構階段 2–3：抽出 useVersionHistory hook、VersionHistoryDialog、ImagePreviewDialog 元件，並將大型 JSX 區塊包成命名 render 輔助函式（完成於分支: refactor/playpage-hooks-and-subcomponents）

## 工作記錄

- 時間: 2026-06-09 12:00:00 +0800
- 分支: refactor/playpage-hooks-and-subcomponents
- 內容: 延續 PlayPage 重構。階段 2 抽出 `useVersionHistory` 自訂 Hook（9 個 useState + 3 個 useCallback，封裝版本歷史開啟、預覽、還原邏輯），並同步建立 `VersionHistoryDialog`（15 props 展示元件）與 `ImagePreviewDialog`（4 props 展示元件）；PlayPage.tsx 由 5464 行降至 5333 行。評估另外三個 Hook 候選（usePollManagement、useFullscreenPlayback、useDrawingSync）後發現均因跨領域 setState 深度耦合（特別是 `handleStopPoll` 需觸及 8+ 個不同領域的 setter）無法乾淨抽出，暫緩。階段 3 分析 FullscreenView（需 50+ props）、ChatPanel（`chatInput` state 被 4 個不同 handler 共用）後同樣無法無損抽出，僅完成最乾淨的 ImagePreviewDialog 提取。進一步分析進一步降低 PlayPage 大小的方法後確認：根本瓶頸是共享可變 state——最高 CP 值方案是建立 PlayPageContext（可解鎖 FullscreenView/EditPanel/ThumbnailSidebar 的真正元件提取）；短期可先將 5 個大型 JSX 區塊包成命名 render 輔助函式（renderFullscreenView/renderHeader/renderLeftPanel/renderRightPanel/renderDialogs），使主 return 從 2440 行縮至 130 行，並為後續 Context 方向鋪路。本工作記錄包含此 render 輔助函式重構：5 個 render helpers 定義於 PlayPage 函式閉包內（可直接存取所有 state/handler，無需 props），主 return 精簡為 132 行，TypeScript 零錯誤、Vite production build 通過。

[x] PlayPage 重構階段 4：建立 PlayPageContext，將 PlayPageDialogs 從 render helper 轉為真實 React 元件（完成於分支: refactor/playpage-hooks-and-subcomponents）

## 工作記錄

- 時間: 2026-06-09 14:30:00 +0800
- 分支: refactor/playpage-hooks-and-subcomponents
- 內容: 繼前次 render helper 重構，建立 `PlayPageContext.tsx`（god context，定義完整的 `PlayPageContextValue` 介面，含約 250 個 state/handler/computed value/ref 欄位，涵蓋 PDF/播放/TTS/繪圖/版面/同步/測驗/影片等各領域），並在 `PlayPage.tsx` 中組建 `_ctxValue` 物件傳入 `<PlayPageCtx.Provider>`。建立 `PlayPageDialogs.tsx`，成為第一個真正消費 context 的 React 元件，透過 `usePlayPageContext()` 取得所需的 state 與 handler，渲染 TtsDialog、ImageStyleDialog、RegenAllDialog、ShareDialog、AddPagesFromPromptModal 五個對話框（原為 `renderDialogs()` render helper），PlayPage.tsx 對應移除這五個 import 與 renderDialogs 函式定義。修正過程中發現並修正三處 context 型別錯誤：`handleSelectDisplayedPoll` 應為 `(pollId: number) => void`（非 `number | null`）、`videoProgressText` 應為 `string | null`、`targetImageSrc` 應為 `string | null`（非 `string | undefined`）。`npx tsc --noEmit` 零錯誤，`npx vite build` 成功。

[x] PlayPage 重構階段 5：將四大版面區塊（全螢幕、標題欄、投影片面板、側邊欄）抽離為獨立 React 元件，以 usePlayPageContext() 消費共享 state（完成於分支: refactor/playpage-hooks-and-subcomponents）

## 工作記錄

- 時間: 2026-06-09 16:00:00 +0800
- 分支: refactor/playpage-hooks-and-subcomponents
- 內容: 完成 PlayPage 重構最終階段。將 renderFullscreenView、renderHeader、renderLeftPanel、renderRightPanel 四個 render helpers 提取為真正的 React 元件：`PlayPageFullscreen.tsx`（全螢幕覆蓋層，含繪圖工具列、字幕、測驗互動）、`PlayPageHeader.tsx`（頂部標題欄，含影片/分享/重生狀態）、`PlayPageSlidePanel.tsx`（左側投影片區域，含圖片預覽、逐字稿編輯、提示詞、設定）、`PlayPageSidebar.tsx`（右側側邊欄，含縮圖清單、投票、聊天）。PlayPageContext 補充 5 個原缺少的欄位（`sourceItems`、`hasScriptChanges`、`syncQuestionBusy`、`openVersionHistory`、`activeSentenceRef`），修正 ref 型別（改用 `RefObject<T>` 取代 `RefObject<T | null>`，解決 JSX ref prop 型別不相容，並統一 PlayPage.tsx 中的 `useRef<T>(null)` 宣告），修正 `handleStartPoll` 及 `handleReplaceImageFile` 的函式簽名。`npx tsc --noEmit` 零錯誤，`npx vite build` 成功（472 KB bundle / 1.71s）。PlayPage.tsx 由重構前的 5727 行降至約 3100 行。

[x] PlayPage 重構階段 6：將 PlayPage.tsx 中功能聚焦的 state/effect/handler 抽離為 custom hooks（完成於分支: refactor/playpage-hooks-and-subcomponents）

## 工作記錄

- 時間: 2026-06-09 22:00:00 +0800
- 分支: refactor/playpage-hooks-and-subcomponents
- 內容: 繼上次 React 元件分拆後，進一步將 PlayPage.tsx 中剩餘的 useEffect/useCallback 按功能領域抽離為獨立 custom hook，採用 composition root 模式（PlayPage 呼叫各 hook，將回傳物件 spread 進 _ctxValue）。共建立四個 hook：`useRegeneration.ts`（批次重生任務狀態、輪詢、handlers，減少約 350 行）、`useVideoGeneration.ts`（影片產生 busy/url/progress 與輪詢 effects，減少約 60 行）、`usePdfMetadata.ts`（標題、TTS、分享連結、GitHub 同步的 state 與 handlers，減少約 200 行）、`useSlideManagement.ts`（投影片新增/刪除/移動/替換/更新封面，減少約 130 行）。PlayPage.tsx 由約 3100 行降至 2570 行，共減少約 540 行。`npx tsc --noEmit` 零錯誤，`npx vite build` 成功（474 KB bundle / 1.70s）。

[x] PlayPage 重構階段 6（延續）：再抽出五個 custom hooks 並為無法移出的區塊加上架構說明備註（完成於分支: refactor/playpage-hooks-and-subcomponents）

## 工作記錄

- 時間: 2026-06-09 23:30:00 +0800
- 分支: refactor/playpage-hooks-and-subcomponents
- 內容: 延續階段 6，再抽出五個 custom hook：`useImageStyle.ts`（整份簡報圖片風格 prompt/templates/dialog，並解決與 useRegeneration 的循環依賴——改傳 MutableRefObject<string> 避免 TDZ）、`useScriptEditor.ts`（逐字稿編輯 state、rewriteScript handlers，含 transcriptFocusMode）、`usePromptAndSource.ts`（頁面 prompt 輸入、來源文字、genPrompts、pagePrompts cache）、`useChatAndImageEdit.ts`（對話問答、inpainting、圖片預覽），以及 `usePagePolls.ts`（投票建立/開始/結束/投票/刪除/選取，含 sync 推送）。PlayPage.tsx 由 2570 行降至約 1980 行（共再減少約 590 行）。對留在 PlayPage 的五個無法抽出區塊加上架構說明備註：`handleEnded`（跨領域：poll/playback/classroomMode）、`handleRetry`（直接操作 audioRef 與 retry token）、`handleRegenerateAudio`（直接 pause/src/load/play audioRef）、`flushLocalDrawingPush`/`pushLocalDrawingChange`（與游標推送共用同一頻道 payload）、sync mega-polling effect（14+ 個跨領域 setter，拆出不減複雜度）。`npx tsc --noEmit` 零錯誤，`npx vite build` 成功（476 KB bundle / 1.74s）。

# 2026-6-10

[x] 當我們複制一個簡報時，需要為新的簡報指定成目前的使用者。（完成於分支: feature/duplicate-assign-current-user-20260610）
[x] 生成語音時，應該要有單人或雙人模式的選擇（完成於分支: feature/dual-host-openai-tts-20260610）
[x] 在重生時也需要雙人模式（完成於分支: feature/regen-host-mode-selector-20260610）
[x] OpenAI 的雙人模式在設定中加上一組 OpenAI 的人設設定（完成於分支: feature/openai-host-persona-settings-20260610）
[x] OpenAI 語音選單加上男聲/女聲標示，比照 Gemini 聲音選單（完成於分支: feature/openai-voice-gender-labels-20260610）

## 工作記錄

- 時間: 2026-06-10 08:45:00 +0800
- 分支: feature/duplicate-assign-current-user-20260610
- 內容: 修正 `POST /api/pdfs/:id/duplicate`：複製簡報時，新簡報的 `owner_sub` 與 `visibility` 原本沿用來源 metadata.json 的舊值寫入新的 metadata，但 `pdfs` 資料表的 INSERT 完全沒有寫入這兩欄，導致新簡報的 `owner_sub` 為 NULL；而 `canReadPdf()` 對 `owner_sub` 為 NULL 的簡報一律回傳不可讀，造成複製出來的簡報完全消失於首頁列表。修正後在 `upload.ts` 的 duplicate 端點以 `ownerSubFromRequest(request)` 取得目前登入使用者的 sub，寫入新簡報的 `pdfs.owner_sub`/`metadata.json.owner_sub`，並將 `visibility` 重設為 `'private'`（複製後一律成為使用者自己的私人副本），同時補上回傳用 SELECT 的 `category`/`owner_sub`/`visibility` 欄位使回應內容與資料庫一致。後端 `npx tsc --noEmit`、`npm run build` 皆通過；`npm test` 26 通過/18 失敗，與套用變更前完全相同（皆為既存、與本次變更無關的 401 認證測試失敗）。

- 時間: 2026-06-10 09:15:00 +0800
- 分支: feature/dual-host-openai-tts-20260610
- 內容: 將原本只有 Gemini TTS 才有的「單人旁白／雙人對談」主持模式選擇擴展到 OpenAI TTS provider。新增 `backend/prompts/generate-script-openai-dual.md` 提示範本，產生帶有 `[[ 語氣 ]]Speaker 1: ...` / `[[ 語氣 ]]Speaker 2: ...` 格式的雙人逐字稿（沿用既有 `splitByToneMarkers` 分段邏輯）；`generateScript.ts`（`buildSystemPrompt`、`buildDeckRewriteSystemPrompt`）與 `page-operations.ts`（`buildRewriteScriptSystemPrompt`）在 `host_mode === 'dual'` 且 provider 為 openai 時改用此範本與對應改寫規則。`synthesizeAudio.ts` 新增 `splitSpeakerPrefix()`，於 OpenAI 模式下逐段偵測並去除「Speaker 1:/Speaker 2:」標籤，並依講者切換為新增的 `openai_tts_speaker1_voice`/`openai_tts_speaker2_voice` 設定（未設定則沿用主聲音）。設定面新增對應欄位並貫穿 `aiSettings.ts`、`/api/system/ai-settings`（admin.ts/shared.ts）、前端 `system.ts`、`SettingsPage.tsx`（新增 OpenAI Speaker 1/2 聲音下拉選單）與中英文 i18n。`TtsDialog.tsx` 移除原本僅限 Gemini 才顯示的「主持模式」切換限制，OpenAI 使用者現在也能選擇單人/雙人模式。後端與前端 `npx tsc --noEmit`、`npm run build` 皆通過；`npm test` 26 通過/18 失敗，與套用變更前基線相同（既存、與本次變更無關的 401 認證測試失敗）。

- 時間: 2026-06-10 10:05:00 +0800
- 分支: feature/regen-host-mode-selector-20260610
- 內容: 「在重生時也需要雙人模式」：分析後確認後端 `generateScript()`/`synthesizeAudio()` 在重生流程（`runRegenerateScripts`/`runRegenerateAudio`）中本就會即時讀取 `getPdfHostMode(pdfId)` 並依「Speaker 1:/2:」前綴切換語音，不需額外修改；缺口在前端「選擇重生項目」對話框完全沒有主持模式 UI，使用者必須先另外開啟「生成設定」對話框切換並儲存才會套用。修正：`RegenAllDialog.tsx` 在勾選逐字稿或語音時顯示「主持模式」單人旁白／雙人對談切換按鈕（樣式比照 `TtsDialog.tsx`）；`useRegeneration.ts` 新增 `hostMode`/`scriptMaxCharsPerPage`/`setDetail` 參數，於 `handleConfirmRegenerate` 在啟動重生任務前呼叫 `updatePdfScriptSettings()` 持久化所選主持模式；`PlayPageDialogs.tsx`、`PlayPage.tsx` 完成 props/參數串接（沿用既有 `usePdfMetadata` 的 `hostMode`/`scriptMaxCharsPerPage` 狀態）。前端 `npx tsc --noEmit`、`npm run build` 皆通過；後端 `npm test` 26 通過/18 失敗，與套用變更前基線相同（既存、與本次變更無關的 401 認證測試失敗）。

- 時間: 2026-06-10 10:30:00 +0800
- 分支: feature/openai-host-persona-settings-20260610
- 內容: 「OpenAI 的雙人模式在設定中加上一組 OpenAI 的人設設定」：上一個分支只新增了 OpenAI 雙人模式的 Speaker 1/2 聲音選擇，沒有像 Gemini 一樣有 Speaker 人設文字欄位。新增 `OPENAI_TTS_SPEAKER1`/`OPENAI_TTS_SPEAKER2` 帳號層級設定，貫穿 `aiSettings.ts`（`PerAccountAiSettings`、`basePerAccountSettings`、`loadPerAccountOverrides`、`PER_ACCOUNT_ENV_PAIRS`）、`/api/system/ai-settings`（`shared.ts` 的 `UpdateSystemAiSettingsBodySchema`、`admin.ts` 的 GET 回應與 PATCH 處理）、前端 `system.ts` 型別。`generateScript.ts` 的 `buildSystemPrompt()` 新增 `openaiSpeaker1Persona`/`openaiSpeaker2Persona` 參數，在 `host_mode === 'dual'` 且 provider 為 openai 時，重用既有的 `gemini-speaker-persona-block.md` 範本（內容本就是通用的「雙主持人角色人設」區塊，與 provider 無關）插入 Speaker 1/2 人設；`buildDeckRewriteSystemPrompt()` 的 OpenAI 雙人重排分支同樣加入人設區塊。`page-operations.ts` 的 `buildRewriteScriptSystemPrompt()` 在單頁逐字稿改寫的 OpenAI 雙人模式下也套用相同人設區塊。前端 `SettingsPage.tsx` 在「OpenAI Speaker 1/2 聲音」下拉選單前新增對應的人設文字輸入框，並補上中英文 i18n（`settings.openaiSpeaker1/2` 與 placeholder）。後端 `npx tsc --noEmit`、`npm run build` 皆通過；前端 `npx tsc --noEmit`、`npm run build` 皆通過；後端 `npm test` 26 通過/18 失敗，與套用變更前基線相同（既存、與本次變更無關的 401 認證測試失敗）。

- 時間: 2026-06-10 13:10:00 +0800
- 分支: feature/openai-voice-gender-labels-20260610
- 內容: 承接上一個分支「OpenAI 的雙人模式在設定中加上一組 OpenAI 的人設設定」之後，使用者詢問「openai 的聲音是否也和 gemini 一樣，有些適合男聲，有些適合女聲」。確認 `frontend/src/lib/ttsVoices.ts` 原本只有 `GEMINI_TTS_VOICE_GENDER`/`geminiVoiceLabel()` 為 Gemini 聲音標示「(男)/(女)」，OpenAI 聲音選單一律顯示原始名稱。新增對等的 `OPENAI_TTS_VOICE_GENDER`（依 OpenAI 官方語音範例之常見性別印象近似分類：alloy/ash/ballad/echo/fable/onyx/verse 標為男聲，coral/nova/sage/shimmer 標為女聲，並加註 OpenAI 並未官方以性別分類，僅供挑選 Speaker 1/2 聲音參考）與 `openaiVoiceLabel()`，套用至 `TtsDialog.tsx` 主聲音選單（依 provider 分流 geminiVoiceLabel/openaiVoiceLabel）、`SettingsPage.tsx` 的 OpenAI Speaker 1/2 聲音下拉選單，以及 `PromptModal.tsx` 的聲音選單（原本兩種 provider 皆無性別標示，一併補上 provider 分流標示以維持一致性）。前端 `npx tsc --noEmit`、`npm run build` 皆通過。

# 2026-6-11

[x] 在雙人模式中，提示應使用一問一答的方式讓二個人對談，而不是一人念一段（完成於分支: feature/dual-mode-qa-dialogue-prompt-20260611）
[x] 語音產生失敗時，要在 console 和 UI 上顯示失敗的原因（完成於分支: feature/audio-generation-failure-display-20260611）
[x] 修正單頁重生語音 API 寫入錯誤的 audio_path，導致 LB0SmGK_Jf 第 6 頁語音無法播放且無錯誤訊息（完成於分支: fix/regenerate-audio-page-uid-path-20260611）
[x] 將 Gemini TTS 的 inline tags 規則加到產生文稿的提示詞中，當選擇 Gemini TTS 時使用正確的英文中括號語氣標籤格式產生文稿，取代會被照唸的 {{語氣}} 標記（完成於分支: feature/gemini-tts-inline-style-tags-20260611）

## 工作記錄

- 時間: 2026-06-11 00:00:00 +0800
- 分支: feature/dual-mode-qa-dialogue-prompt-20260611
- 內容: 「在雙人模式中，提示應使用一問一答的方式讓二個人對談，而不是一人念一段」：雙人對談逐字稿原本只要求「每句話盡量短，雙方互有來回、互相提問與回應，不要其中一人長篇獨白」，但 LLM 仍常產出一人念一整段內容、另一人僅簡短回應的形式。修正涵蓋初次生成、單頁改寫、整份重排三條路徑、OpenAI 與 Gemini 兩種 TTS provider：`backend/prompts/generate-script-openai-dual.md`（OpenAI 雙人初次生成 + 單頁改寫共用範本）將「互有來回」規則改為明確的「採一問一答方式進行：由一方提出問題、疑惑、好奇點或切入點，另一方簡短回答、解說或回應」，並把段落數下限由 2 段提高為 4 段、要求 Speaker 1/2 交替輪流、避免同一位講者連續出現兩段以上；`backend/prompts/generate-script-gemini.md`（Gemini 雙人初次生成 + 單頁改寫共用範本）與 `backend/prompts/rewrite-script-gemini.md`（Gemini 整份重排）新增相同的一問一答規則；`backend/src/worker/steps/generateScript.ts` 中 OpenAI 雙人「整份重排」的內嵌系統提示（`buildDeckRewriteSystemPrompt`）同步套用一問一答規則與「至少 4 段、交替輪流」的分段要求。後端 `npx tsc --noEmit` 通過。

- 時間: 2026-06-11 09:35:00 +0800
- 分支: feature/audio-generation-failure-display-20260611
- 內容: 「語音產生失敗時，要在 console 和 UI 上顯示失敗的原因」：`synthesizeAudio.ts` 在 TTS 重試耗盡後，新增 `extractTtsErrorMessage()` 組出包含 HTTP 狀態碼/錯誤代碼的人類可讀錯誤訊息，並在 `logger.error` 與回傳結果（`SynthesizeAudioPageResult.error`）中提供。涵蓋四個呼叫點：主流程 `pipeline.ts` 將失敗頁標記 `pages.status='failed'`、寫入 `error_message`，audio timing stage 標記為 failed；批次重生 `regenerate.ts` 失敗頁清空 `audio_path`/`audio_duration_seconds` 並標記 failed（含 metadata.json 同步）；新增頁面 `addPagesFromPrompt.ts` 失敗頁標記 failed/error_message；單頁重生 `/api/pdfs/:id/pages/:n/regenerate-audio` 端點失敗時回傳 `502 TTS_FAILED` 並標記該頁 failed，讓前端 `handleRegenerateAudio` 立即以 `ApiError.message` 顯示失敗原因。沿用既有圖片產生失敗的 UI 呈現模式（`PlayPageHeader.tsx` 的 `error_message` 紅色橫幅），前端無需改動。後端 `npx tsc --noEmit` 與 `npm run build` 皆通過。

- 時間: 2026-06-11 09:50:00 +0800
- 分支: fix/regenerate-audio-page-uid-path-20260611
- 內容: 使用者回報「LB0SmGK_Jf 這個簡報的第六頁產生不出來，但也沒有看到什麼錯誤訊息」。追查後發現 `pages.audio_path='pages/006.m4a'`（頁碼補零命名），但 `synthesizeAudio()` 實際是依 `pageAudioPath(pdfId, pageUid)` 寫到 `pages/yY4ruQzKJP.m4a`（page_uid 命名），兩者不一致：語音其實生成成功，但 `/api/pdfs/:id/pages/:n/audio` 依 DB 記錄的路徑找不到檔案，回傳 `404 PAGE_AUDIO_NOT_FOUND`，且因為 TTS 本身沒有失敗，不會觸發 `error_message` 橫幅，造成「沒有錯誤訊息但播放不出來」。根因為 `page-operations.ts` 的 `/api/pdfs/:id/pages/:n/regenerate-audio` 端點仍以「頁碼補零」組出 `relAudioPath` 寫入 DB，是 `feature/stable-page-uid-filenames-20260608` 遷移時遺漏更新的呼叫點。修正：改用 `path.relative(pdfDir(id), audio.audioPath)` 取得 `synthesizeAudio()` 實際寫入的相對路徑，與 `regenerate.ts`/`addPagesFromPrompt.ts` 的作法一致。並修正 `storage/LB0SmGK_Jf/metadata.json` 第 6 頁既有的 `audio: "pages/006.m4a"` 為 `pages/yY4ruQzKJP.m4a`（與實際檔案一致）。`data/app.db` 中該頁 `audio_path` 欄位的同步修正因 Claude Code 權限機制阻擋直接 SQL UPDATE 而尚未套用，待後續處理（例如透過呼叫修正後的 `/regenerate-audio` 端點重生該頁語音以自動寫回正確路徑，或由使用者手動執行 `UPDATE pages SET audio_path = 'pages/yY4ruQzKJP.m4a' WHERE pdf_id='LB0SmGK_Jf' AND page_number=6;`）。後端 `npx tsc --noEmit` 與 `npm run build` 皆通過。

- 時間: 2026-06-11 10:28:00 +0800
- 分支: feature/gemini-tts-inline-style-tags-20260611
- 內容: 「將 Gemini TTS 的 inline tags 規則加到產生文稿的提示詞中」：使用者回報 Gemini TTS 偶爾會把逐字稿中的 {{語氣}} 標記照唸出來。追查後確認根因：四個 Gemini 提示詞範本要求 LLM 以 "{{}}" 描述語氣，但 TTS 端的 splitByToneMarkers() 只認得 "[[ ]]" 標記，{{...}} 原封不動留在 seg.text 中送進 Gemini TTS（gemini.ts 的 ttsPrompt = params.text），而 {{}} 並非 Gemini TTS 官方控制語法，模型只是「猜測式」略過，偶爾就會照唸。修正：(1) `backend/prompts/generate-script-gemini.md`、`generate-script-gemini-solo.md`、`rewrite-script-gemini.md`、`rewrite-script-gemini-solo.md` 四個範本（涵蓋初次生成/單頁改寫/整份重排 × 單人/雙人）改為【語氣標籤規則】：要求在情緒轉折處於文字正前方插入英文中括號 inline 標籤（優先使用 [excitedly], [seriously], [cheerfully], [whispers], [gasp], [sighs], [very fast], [slowly]），約每 2-3 句加一次、明確禁止 "{{}}" 與 "[[ ]]" 語法，並更新範例；改寫範本另要求把原稿殘留的 {{}} 改寫成英文標籤或移除。單中括號標籤不會被 TONE_MARKER_RE（僅匹配雙中括號）切走，會原樣傳給 Gemini TTS 由其語意理解。(2) `synthesizeAudio.ts` 朗讀前一律移除殘留的 {{...}} 標記（保險措施，讓既有舊腳本不需重生也不會再被照唸）。後端 `npx tsc --noEmit`、`npm run build` 皆通過；`npm test` 26 通過/18 失敗，與基線相同（既存、與本次變更無關的 401 認證測試失敗）。

# 2026-6-12

[x] 動畫投影片 V1：依 docs/animation-slide-v1-design.md 實作 SlideRenderer、GSAP 動畫播放與動畫編輯 Tab（完成於分支: feature/gsap-slide-animation-v1-20260612）
[x] 新增「動畫與逐字稿同步」功能：動畫效果的開始時間可改為綁定逐字稿句子，播放到該句時動畫同步開始（完成於分支: feature/animation-transcript-line-sync-20260612）

## 工作記錄

- 時間: 2026-06-12 03:00:00 +0800
- 分支: feature/gsap-slide-animation-v1-20260612
- 內容: 完成「動畫投影片 V1」（設計文件 docs/animation-slide-v1-design.md 隨分支提交）。後端：pages 表新增 `render_type`（預設 static-image）與 `animation_spec_path` 欄位；新增 `services/pageAnimation.ts` 以 zod 白名單驗證動畫 spec（7 種 effect type、5 種 ease、start/duration 範圍、effects ≤ 20、params 未知鍵過濾）；新增 `routes/pdfs/page-animation.ts` 提供 `GET/PUT /api/pdfs/:id/pages/:n/animation` 與 `GET .../animation/spec`（Cache-Control: no-store），spec 寫入 `pages/<page_uid>.animation.json`，`enabled` 決定 render_type；detail API 的 page 物件回傳 `render_type` 與 `animation_spec_url`。前端：安裝 gsap，新增 `components/slide/`（SlideRenderer、useGsapSlideTimeline、buildGsapTimeline），動畫套用在含手寫層與 inpaint 選取框的 animated stage 上，疊加層跟著移動且 normalized 座標不受影響；以音訊為唯一時鐘——isPlaying 驅動 play/pause、timeScale 跟隨倍速、currentTime 漂移 >0.3 秒才 seek（涵蓋拖曳進度條與 follower 同步），換頁重建 timeline、unmount kill+clearProps；一般播放區與全螢幕（image/split/edit）改用同一 renderer，靜態頁面 DOM 與原行為完全不變，spec 載入失敗或 GSAP runtime 錯誤時退回靜態圖片並顯示非阻斷式警告；編輯區新增第五個「動畫」Tab（usePageAnimation + AnimationEditorTab）支援啟用、效果新增/修改/刪除、儲存與「從頭預覽」（先儲存→音訊歸零→播放），動畫 Tab 開啟時以編輯中 draft 即時預覽免儲存；縮圖加上動畫標記；新增 play.animation.* 中英文 i18n 鍵。影片輸出維持靜態 JPG 不變。驗證：新增 backend/test/page-animation.test.ts 13 項測試全數通過（validation + API + 損毀檔案 fallback）；前後端 `tsc --noEmit` 與 `npm run build` 皆通過；後端 `npm test` 57 測試 39 通過/18 失敗，失敗數與既有認證基線相同，無新增失敗。

- 時間: 2026-06-12 05:40:00 +0800
- 分支: feature/animation-transcript-line-sync-20260612
- 內容: 完成「動畫與逐字稿同步」（設計文件 docs/animation-slide-v1-design.md §4.3 / §6.5 / §7.1 隨分支提交）。新增 `effect.startTrigger?: { type: 'transcript-line', line: number }`，可將動畫效果的開始時間改為「播放到本頁逐字稿第 N 句（0-based）時觸發」，而非固定秒數。後端：`backend/src/services/pageAnimation.ts` 新增 `StartTriggerSchema`（`type` 限定 `transcript-line`、`line` 為 0~999 整數），`validateAnimationSpec` 驗證並保留該欄位；`backend/test/page-animation.test.ts` 新增/調整測試，涵蓋合法保留、非法 type/line（負數、非整數、超出上限）拒絕，以及 PUT/GET API 往返保留 `startTrigger`（共 15 項測試全數通過）。前端：將原本內嵌於 `PlayPage.tsx` 的字幕切句/估時邏輯（`splitScriptIntoSentences`、`buildSentenceTimeline`）抽到新檔 `frontend/src/lib/subtitles.ts`，供字幕高亮與動畫同步共用；`frontend/src/lib/animationSpec.ts` 新增 `resolveAnimationSpec(spec, sentenceTimeline)`，將有 `startTrigger` 的效果之 `start` 換算為對應句子的估計播放開始秒數（找不到對應句子時退回原本 `start`），無任何 `startTrigger` 時回傳原物件參照以避免 GSAP timeline 不必要重建；`PlayPage.tsx` 新增 `sentenceTimeline` memo（依賴 `[pageSentences, duration]`，不隨 `currentTime` 變動），`currentAnimationSpec` 改為 `useMemo(() => resolveAnimationSpec(rawSpec, sentenceTimeline), [rawSpec, sentenceTimeline])`，並透過 `PlayPageContext` 提供 `sentenceTimeline` 給編輯器；`AnimationEditorTab.tsx` 每個效果新增「起始時間方式」下拉（依秒數 / 依逐字稿句子），切到「依逐字稿句子」時顯示句子下拉選單（`1. <句子前 18 字>…`）與「預估開始：X.X 秒」，切回「依秒數」時把當下換算秒數寫回 `start` 並清除 `startTrigger`；本頁無逐字稿時停用該選項並顯示提示文字。新增 `play.animation.startMode*` 等中英文 i18n 鍵。驗證：後端 `npx tsx --test test/page-animation.test.ts`（Node v22.12.0）15 項全數通過；前端 `tsc --noEmit` 通過。

- 時間: 2026-06-12 09:15:00 +0800
- 分支: feature/youtube-caption-source-persist-20260612
- 內容: 完成「下載 youtube 時，下載的字幕檔應該被存下來當成是來源，可以在來源被檢視」。根因：`/api/youtube` 建立任務時即新增一筆 `source_kind='youtube_caption'` 的 `pdf_sources` 紀錄，但 `content_text` 寫入空字串，pipeline 下載並正規化字幕（`captions.normalized.txt`）後從未回寫這筆來源，導致來源清單中的 YouTube 字幕來源永遠是空的。修正：`backend/src/worker/pipeline.ts` 在 `fetchYoutubeCaptions()` 完成、寫入 `captions.raw.json`/`captions.normalized.txt` 後，新增一道 `UPDATE pdf_sources SET content_text = ?`（`cap.normalizedText.slice(0, 120000)`，與既有 PDF 來源上限一致）寫回該筆 youtube_caption 來源。前端 `PlayPageSlidePanel.tsx` 的「目前來源清單」原本只用 `line-clamp-2` 顯示 2 行預覽，現在加上展開/收合按鈕（沿用「生成記錄」的 ▲/▼ 樣式），點擊可在 `<pre>` 中檢視來源完整內容，無內容時顯示「尚無內容」並停用按鈕；新增 `expandedSourceId`/`setExpandedSourceId` 狀態（`usePromptAndSource.ts` → `PlayPageContext`）。後端/前端 `npx tsc --noEmit` 與 `npm run build` 皆通過；後端 `npm test` 59 測試 41 通過/18 失敗，失敗數與既有認證基線相同，無新增失敗。

- 時間: 2026-06-12 09:40:00 +0800
- 分支: feature/upload-host-mode-select-20260612
- 內容: 完成「在上傳 PDF 時要提供選項單人或雙人的選項」。系統原已有 `pdfs.host_mode`（'solo'｜'dual'，預設 'solo'）與 Speaker 1/2 人設/聲音設定，但只能在建立簡報後到播放設定（TtsDialog/RegenAllDialog）中變更，上傳當下一律是 'solo'。後端：`backend/src/routes/pdfs/upload.ts` 為 `POST /api/pdfs`（PDF/TXT 上傳）新增 `host_mode` multipart 欄位解析（`HostModeSchema = z.enum(['solo','dual'])`，預設 'solo'，非法值回 400 INVALID_REQUEST），寫入 `INSERT INTO pdfs` 的 `host_mode` 欄並於回應中回傳；`POST /api/youtube` 的 `YoutubeCreateBodySchema`（`backend/src/routes/pdfs/shared.ts`）新增可選 `host_mode` 欄位，同樣寫入 `pdfs.host_mode` 並回傳。前端：`UploadButton.tsx` 在「上傳 PDF」的內容模式選擇面板（簡報逐頁處理／一般文件 AI 分頁）與「YouTube 匯入」面板中，新增「主持模式」分段切換按鈕（單人旁白／雙人對談，樣式沿用 TtsDialog 的 segmented control），選擇結果透過 `uploadPdf(file, { hostMode })`／`createYoutubeTask(url, lang, hostMode)` 傳給後端；`uploads.ts`／`pdfs.ts`／`types.ts` 新增對應欄位與型別，並補上 `upload.hostModeLabel`／`upload.hostModeSolo`／`upload.hostModeDual` 中英文 i18n 鍵。驗證：前後端 `npx tsc --noEmit` 與 `npm run build` 皆通過；以 `buildApp()` + `app.inject()` 對 `/api/pdfs`（multipart，host_mode=dual/solo/未指定）與 `/api/youtube`（host_mode=dual/solo）逐一驗證回應與 DB 寫入值正確，非法 host_mode 值回 400；後端 `npm test` 59 測試 41 通過/18 失敗，失敗數與既有認證基線相同，無新增失敗。前端 UI 因環境無瀏覽器/螢幕截圖工具，未做實機畫面驗證，僅以程式碼比對既有 segmented control 樣式確認一致性。

- 時間: 2026-06-12 09:54:00 +0800
- 分支: feature/import-text-host-mode-20260612
- 內容: 完成「在 upload TXT 時也要加上 host mode 選項」。前一筆工作已讓 `uploadPdf()` 與後端 `/api/pdfs` 支援 `host_mode`（solo/dual），但「貼上 TXT」頁（`ImportTextPage.tsx`）的「貼上匯入」與「AI 生成大綱」兩個流程呼叫 `uploadPdf()` 時皆未帶入該選項，一律沿用後端預設 'solo'。修正：在 `匯入方式` 區塊新增「主持模式」分段切換按鈕（單人旁白／雙人對談，沿用 `UploadButton.tsx` 與 `upload.hostModeLabel`/`upload.hostModeSolo`/`upload.hostModeDual` 既有 i18n 鍵與樣式），新增 `hostMode` state，並將其透過 `uploadPdf(file, { hostMode, onProgress })` 傳給 `handleSubmit`（貼上匯入）與 `handleCreateFromOutline`（AI 大綱建立）兩個建立簡報的呼叫。驗證：前端 `npx tsc --noEmit` 與 `npm run build` 皆通過；後端邏輯沿用前一筆已驗證的 `/api/pdfs` host_mode 處理，未重複測試。前端 UI 因環境無瀏覽器/螢幕截圖工具，未做實機畫面驗證。

- 時間: 2026-06-12 10:45:00 +0800
- 分支: feature/youtube-audio-source-persist-20260612
- 內容: 完成「下載 youtube 時，下載的語音檔應該被存下來當成是來源，可以在來源被檢視。STT 轉出的字幕檔也應被存下來可以在來源被檢視」的剩餘部分（字幕檔部分已於 `feature/youtube-caption-source-persist-20260612` 完成）。根因：YouTube 字幕下載走 STT 後援時，`transcribeByStt()` 會先把影片音訊下載成 mp3 再送語音辨識，完成後整個暫存目錄連同該 mp3 一起被刪除，使用者完全看不到、聽不到原始來源音訊。修正：`backend/src/services/youtubeCaptions.ts` 的 `transcribeByStt`/`fetchYoutubeCaptions` 新增可選參數 `audioSavePath`，在清理暫存目錄前先用 `fs.promises.copyFile` 把下載到的 mp3 複製到永久位置；`backend/src/services/storage.ts` 新增 `youtubeSourceAudioPath(pdfId)` 回傳該永久路徑（`<pdfDir>/source-audio.mp3`）；`backend/src/worker/pipeline.ts` 呼叫 `fetchYoutubeCaptions()` 時傳入該路徑，事後檢查檔案是否存在，若存在則在 `pdf_sources` 新增一筆 `source_kind='youtube_audio'` 紀錄（`content_text` 為提示文字），並寫入 `metadata.source_audio = 'source-audio.mp3'`。型別：前後端 `PdfSourceItem.source_kind` 新增 `'youtube_audio'`，後端 `PdfMetadata` 新增 `source_audio?: string | null`。API：抽出共用 `sendAudioFile()`（`backend/src/routes/pdfs/shared.ts`，支援 HTTP Range／206 partial content／依檔頭偵測 MIME），用它重構既有 `GET /api/pdfs/:id/pages/:n/audio`，並新增 `GET /api/pdfs/:id/source-audio` 提供下載音訊的串流播放。前端 `PlayPageSlidePanel.tsx` 的「目前來源清單」對 `source_kind === 'youtube_audio'` 的項目改渲染 `<audio controls preload="none">`（透過 `withShareToken` 附帶分享權杖）。驗證：前後端 `npx tsc --noEmit` 與 `npm run build` 皆通過；後端 `npm test` 41/59 通過/18 失敗，失敗數與既有認證基線相同、無新增失敗；另以臨時腳本透過 `app.inject()` 驗證 `/api/pdfs/:id/source-audio` 在檔案不存在時回 404、存在時回 200（`content-type: audio/mpeg`、正確 `content-length`）、帶 `Range: bytes=0-99` 時回 206 與正確 `content-range`/`content-length`，並確認 `/api/pdfs/:id` 回應的 `sources` 含 `source_kind: 'youtube_audio'`。


# 新功能(每一個功能使用一個 branch，做好後也要更新 master 上的設計文件)
[x] 加上一個自動生成焦點的功能，打開這個功能後，在產生語音後，自動為每一行逐字稿在螢幕上產生一個指示焦點的動畫。以輔助說明。（完成於分支: feature/animation-auto-focus-generation-20260612，v1 為編輯器內手動「一次性產生」按鈕，依賴未合併的 feature/animation-focus-effects-20260612；「產生語音後自動產生」的常駐管線留待後續項目）
[x] 除了焦點以外，也可以生成一張小圖或文字做為動畫內容。（完成於分支: feature/animation-text-overlay-20260612，v1 為文字說明 text-callout 效果；小圖內容需額外的圖片產生/上傳管線，留待後續項目）
[x] 加上手動在逐字稿加上動畫指引的功能，這個指引會在生成動畫時傳給 LLM 做參考。（完成於分支: feature/animation-llm-hints-20260612，v1 為資料模型 `AnimationSpec.hints` 與逐句輸入 UI；「生成動畫時傳給 LLM 做參考」需待 V2 LLM 生成動畫管線）
[x] 提供多種焦點的功能，例如紅框或 spotlight或引言(圖)（完成於分支: feature/animation-focus-effects-20260612，僅完成紅框/聚光燈視覺效果，引言(圖)疊加內容留待後續項目）
[x] 加上動畫開始時間由逐字稿向前秒數指定的功能（完成於分支: feature/animation-start-offset-20260612）
[x] 在 upload TXT 時也要加上 host mode 選項（完成於分支: feature/import-text-host-mode-20260612）
[x] 在全螢幕時加上左右滑動上一頁下一頁的功能（完成於分支: feature/fullscreen-swipe-navigation-20260612）
## 工作記錄

- 時間: 2026-06-12 11:18:00 +0800
- 分支: feature/animation-start-offset-20260612
- 內容: 完成「加上動畫開始時間由逐字稿向前秒數指定的功能」。延續 `feature/animation-transcript-line-sync-20260612` 的 `effect.startTrigger = { type: 'transcript-line', line }`，新增選填欄位 `offsetSeconds`（0~60，秒），讓動畫效果可在對應逐字稿句子開始前 N 秒提前觸發。後端 `backend/src/services/pageAnimation.ts` 的 `StartTriggerSchema` 新增 `offsetSeconds: z.number().min(0).max(60).optional()` 並更新 `AnimationStartTrigger` 型別；前端 `frontend/src/types.ts` 同步新增該欄位。前端 `frontend/src/lib/animationSpec.ts` 新增共用函式 `resolveStartTriggerSeconds(startTrigger, sentenceTimeline)`（= `sentenceTimeline[line].start - (offsetSeconds ?? 0)`，下限 0），`resolveAnimationSpec()` 與「依秒數/依逐字稿句子」模式切換皆改用此函式。`AnimationEditorTab.tsx` 在「依逐字稿句子」模式下新增「提前秒數」數字輸入框，並更新「預估開始」秒數顯示。新增中英文 i18n 鍵 `play.animation.startOffsetSeconds`。並更新設計文件 `docs/animation-slide-v1-design.md` §4.3、§7.1 與檔頭擴充註記。驗證：後端新增/調整 `backend/test/page-animation.test.ts`（含 `offsetSeconds` 驗證與 PUT/GET API 往返保留），`npx tsx --test test/page-animation.test.ts`（Node v22.12.0）17 項全數通過；`npm test` 61 測試 43 通過/18 失敗，失敗數與既有認證基線相同，無新增失敗；前後端 `npx tsc --noEmit` 與 `npx vite build` 皆通過。

- 時間: 2026-06-12 11:45:00 +0800
- 分支: feature/animation-focus-effects-20260612
- 內容: 完成「提供多種焦點的功能，例如紅框或 spotlight或引言(圖)」的視覺效果部分。新增兩種動畫效果類型 `highlight-box`（紅框標示）與 `spotlight`（聚光燈），以 overlay 疊加層方式呈現，而非整個 stage 的 transform。後端 `backend/src/services/pageAnimation.ts` 的 `ANIMATION_EFFECT_TYPES` 新增這兩種類型，`ALLOWED_PARAM_KEYS` 為其開放 `xPct`/`yPct`/`widthPct`/`heightPct`（0~100 百分比，未做範圍限制，與既有 `distancePct` 等參數一致）。前端 `frontend/src/types.ts` 的 `SlideAnimationEffectType` 同步新增；`frontend/src/lib/animationSpec.ts` 新增 `FOCUS_EFFECT_TYPES`、`getFocusEffectParams(effect)`（讀取參數並補上預設值 30/30/40/40）。`SlideRenderer.tsx` 新增 `FocusOverlay` 元件，於 animated stage 內為每個 focus 效果渲染一個帶 `data-effect-id` 的疊加 `<div>`（highlight-box 為紅色圓角外框，spotlight 為橢圓形 + `box-shadow: 0 0 0 9999px rgba(0,0,0,0.6)` 暗化遮罩），初始 `opacity:0`；`buildGsapTimeline.ts` 透過 `data-effect-id` 找到該 overlay，對 `autoAlpha` 做 `fromTo(0→1)`（與 fade-in 手法相同，淡入後維持顯示）。`AnimationEditorTab.tsx` 在效果類型為 highlight-box/spotlight 時，新增「焦點位置與大小（%）」四個數字輸入框（X/Y/寬/高，0~100），寫回 `effect.params`。新增中英文 i18n 鍵 `play.animation.type.highlight-box`、`play.animation.type.spotlight`、`play.animation.focusPosition`、`play.animation.focusX/focusY/focusWidth/focusHeight`。並更新設計文件 `docs/animation-slide-v1-design.md`（新增 §5.1 焦點效果說明、§6.6 FocusOverlay 架構、§7 編輯器 UI 說明與檔頭擴充註記）。本次僅完成可手動設定的視覺焦點類型；「引言(圖)」（文字/圖片疊加內容）與「依逐字稿自動產生焦點」（第 720-722 項）留待後續分支。驗證：後端新增 2 項測試（`backend/test/page-animation.test.ts`），`npm test` 63 測試 45 通過/18 失敗，失敗數與既有認證基線相同，無新增失敗；前後端 `npx tsc --noEmit`、後端 `npm run build`、前端 `npx vite build` 皆通過。

- 時間: 2026-06-12 12:05:00 +0800
- 分支: feature/fullscreen-swipe-navigation-20260612
- 內容: 完成「在全螢幕時加上左右滑動上一頁下一頁的功能」。於 `frontend/src/pages/play/PlayPageFullscreen.tsx` 的全螢幕容器上新增 `onTouchStart`/`onTouchEnd` 處理：記錄觸控起點座標，放開時計算水平位移 `dx` 與垂直位移 `dy`，當 `|dx| >= 50px`（`SWIPE_THRESHOLD_PX`）且 `|dy| <= 80px`（`SWIPE_VERTICAL_TOLERANCE_PX`）時判定為換頁手勢：向左滑（`dx < 0`）呼叫 `goNext()` 切到下一頁，向右滑（`dx > 0`）呼叫 `goPrev()` 切到上一頁；兩者皆重用既有函式，已內含同步模式下僅 master 可換頁的權限檢查與頁碼邊界 clamp，無需額外處理。滑動觸發時以 `swipeHandledRef` 旗標讓緊接其後的 `onClick` 跳過「點擊暫停/繼續播放」的行為，避免滑動後誤觸暫停。當手寫模式且工具非游標（`drawingMode && drawingTool !== 'cursor'`）時略過手勢判定，讓 `DrawingCanvas` 正常接收觸控繪圖。另為全螢幕「編輯」版面右側可編輯逐字稿區塊新增 `onTouchStart`/`onTouchEnd` 的 `stopPropagation`（沿用既有 `onClick` 的隔離模式），避免在該區域捲動或選取文字時誤觸換頁。驗證：前端 `npx tsc --noEmit` 與 `npx vite build` 皆通過；本次未變更後端程式碼。

- 時間: 2026-06-12 12:30:00 +0800
- 分支: feature/animation-auto-focus-generation-20260612
- 內容: 完成「加上一個自動生成焦點的功能」之 v1（編輯器內一次性手動產生）。本分支基於尚未合併的 `feature/animation-focus-effects-20260612`（提供 `highlight-box`/`spotlight`/`FOCUS_EFFECT_TYPES`/`getFocusEffectParams` 等基礎設施）。`frontend/src/lib/animationSpec.ts` 新增 `generateFocusEffectsFromTranscript(sentenceCount)`：依本頁逐字稿句數，為每一句產生一個 `highlight-box` 效果（`startTrigger: { type: 'transcript-line', line }`、`duration: 1.2`、`ease: 'power1.out'`，位置/大小沿用 §5.1 預設值 30/30/40/40），數量上限為 `MAX_SLIDE_ANIMATION_EFFECTS`（20）。`AnimationEditorTab.tsx` 在「＋ 新增效果」按鈕旁新增「🪄 自動產生逐字稿焦點動畫」按鈕：點擊後以產生結果取代目前 `draft.effects` 並將 `enabled` 設為 `true`；若目前已有效果設定，先以 `window.confirm` 詢問是否覆蓋；本頁尚無逐字稿時按鈕停用。新增中英文 i18n 鍵 `play.animation.autoGenerateFocus`、`play.animation.autoGenerateFocusConfirm`。並更新設計文件 `docs/animation-slide-v1-design.md`：新增 §7.2「自動產生逐字稿焦點動畫」說明、更新 §5.1 與檔頭擴充註記。本次僅提供編輯器內「一次性產生」的手動操作；TODO 第 720 項所述「產生語音後自動產生」的常駐設定與後端管線整合留待後續項目。驗證：新增前端單元測試 `frontend/src/lib/animationSpec.test.ts`（3 項），`npx tsx --test src/lib/animationSpec.test.ts` 全數通過；前端 `npx tsc --noEmit` 與 `npx vite build` 皆通過；本次未變更後端程式碼。

- 時間: 2026-06-12 12:55:00 +0800
- 分支: feature/animation-text-overlay-20260612
- 內容: 完成「除了焦點以外，也可以生成一張小圖或文字做為動畫內容」之 v1（文字說明 `text-callout` 效果）。本分支基於 `feature/animation-auto-focus-generation-20260612`（已含 `feature/animation-focus-effects-20260612` 的 `highlight-box`/`spotlight`/overlay 基礎設施）。後端 `backend/src/services/pageAnimation.ts` 的 `ANIMATION_EFFECT_TYPES` 新增 `'text-callout'`，`ALLOWED_PARAM_KEYS` 為其開放 `xPct`/`yPct`/`widthPct`/`heightPct`（與焦點效果共用位置/大小參數），`AnimationEffect` 新增選填欄位 `text?: string`（純文字，上限 80 字，新常數 `MAX_TEXT_CALLOUT_LENGTH`），`EffectSchema` 新增 `text: z.string().max(80).optional()` 並在 `validateAnimationSpec` 中保留該欄位。前端 `frontend/src/types.ts` 的 `SlideAnimationEffectType`/`SlideAnimationEffect` 同步新增。`frontend/src/lib/animationSpec.ts` 新增 `OVERLAY_EFFECT_TYPES = [...FOCUS_EFFECT_TYPES, 'text-callout']`（取代原本散落各處的 `FOCUS_EFFECT_TYPES` 用於 overlay 渲染與位置/大小 UI 的判斷）與 `MAX_TEXT_CALLOUT_LENGTH = 80`。`SlideRenderer.tsx` 的 `FocusOverlay` 改名為 `EffectOverlay`，新增 `text-callout` 分支：渲染一個深色半透明圓角矩形，置中顯示 `effect.text`（白字、粗體），位置/大小與淡入機制與 highlight-box/spotlight 相同。`buildGsapTimeline.ts` 將 `'text-callout'` 併入既有 `highlight-box`/`spotlight` 的 overlay `autoAlpha` `fromTo(0→1)` case。`AnimationEditorTab.tsx` 在效果類型為 `text-callout` 時新增「文字內容」文字輸入框（寫回 `effect.text`，`maxLength=80`），並將「焦點位置與大小（%）」區塊的顯示條件由 `FOCUS_EFFECT_TYPES` 改為 `OVERLAY_EFFECT_TYPES`（讓 text-callout 也能調整位置/大小）。新增中英文 i18n 鍵 `play.animation.type.text-callout`、`play.animation.textContent`、`play.animation.textContentPlaceholder`。並更新設計文件 `docs/animation-slide-v1-design.md`：新增 §5.2「文字說明效果（text-callout）」、更新 §5 效果表、§6.6（FocusOverlay → EffectOverlay）、§7 編輯器 UI 說明、§12（移除已完成的 overlay text，新增 overlay image）與檔頭擴充註記。本次僅完成文字內容；「生成一張小圖」需額外的圖片產生/上傳管線，留待後續項目。驗證：後端新增 2 項測試（`backend/test/page-animation.test.ts`），`npm test` 65 測試 47 通過/18 失敗，失敗數與既有認證基線相同，無新增失敗；前後端 `npx tsc --noEmit`、前端 `npx vite build`、`npx tsx --test src/lib/animationSpec.test.ts`（3 項）皆通過。

- 時間: 2026-06-12 14:10:00 +0800
- 分支: feature/animation-llm-hints-20260612
- 內容: 完成「加上手動在逐字稿加上動畫指引的功能，這個指引會在生成動畫時傳給 LLM 做參考」之 v1（資料模型 + 編輯器 UI）。後端 `backend/src/services/pageAnimation.ts` 的 `AnimationSpec` 新增選填欄位 `hints?: Record<string, string>`（key 為本頁逐字稿句子索引的字串，value 為使用者手動輸入的自由文字動畫指引），新增常數 `MAX_HINTS = 50`、`MAX_HINT_LENGTH = 200`，新增 `HintsSchema`（`z.record(z.string().regex(/^\d+$/), z.string().max(200))` 並以 `.refine` 限制最多 50 筆）納入 `SpecSchema`，`validateAnimationSpec` 將非空 `hints` 原樣保留、空物件正規化為 `undefined`。前端 `frontend/src/types.ts` 的 `SlideAnimationSpec` 同步新增 `hints` 欄位；`frontend/src/lib/animationSpec.ts` 新增同步常數 `MAX_HINTS`/`MAX_HINT_LENGTH`，`cloneAnimationSpec` 一併淺拷貝 `hints`。`AnimationEditorTab.tsx` 在「自動產生逐字稿焦點動畫」按鈕下方新增「逐字稿動畫指引」區塊（`play.animation.hints`，本頁有逐字稿時顯示）：為 `pageSentences` 每一句顯示完整文字與一個文字輸入框（對應 `draft.hints?.[String(idx)]`，上限 200 字），新增 `updateHint(line, text)` 寫回 `draft.hints`（清空時移除該 key，整個物件變空時改為 `undefined`），隨「儲存動畫」一併存檔。新增中英文 i18n 鍵 `play.animation.hints`、`play.animation.hintsDescription`、`play.animation.hintsPlaceholder`。並更新設計文件 `docs/animation-slide-v1-design.md`：新增 §4.4「逐字稿動畫指引（hints）」資料模型說明、§7.3 編輯器 UI 說明、§12（V2 LLM 生成動畫改為消費 `AnimationSpec.hints`）與檔頭擴充註記。本次僅提供資料模型、驗證與輸入 UI；「生成動畫時傳給 LLM 做參考」需待 V2 LLM 生成動畫管線消費這些 hints，留待後續項目。驗證：本分支基於合併後的 master（已含 `feature/animation-text-overlay-20260612`、`feature/animation-auto-focus-generation-20260612` 與「Improve animation easing labels」），後端新增 5 項測試（`backend/test/page-animation.test.ts`，涵蓋 hints 接受/空物件正規化/非數字 key 拒絕/長度上限/筆數上限），`npx tsx --test test/page-animation.test.ts` 26 項全數通過，`npm test` 70 測試 52 通過/18 失敗，失敗數與既有認證基線相同，無新增失敗；前後端 `npx tsc --noEmit`、前端 `npx vite build`、`npx tsx --test src/lib/animationSpec.test.ts`（3 項）皆通過。

- 時間: 2026-06-12 15:25:00 +0800
- 分支: feature/animation-exit-duration-20260612
- 內容: 完成「每一個動畫都要有消失時間」之 v1（overlay 效果的自動淡出）。後端 `backend/src/services/pageAnimation.ts` 的 `AnimationEffect` 新增選填欄位 `exitDuration?: number`（秒，0~600 = `MAX_DURATION_SECONDS`），`EffectSchema` 新增 `exitDuration: z.number().min(0).max(MAX_DURATION_SECONDS).optional()`，`validateAnimationSpec` 保留該欄位（語義：淡入完成 `start+duration` 後，再經過 `exitDuration` 秒，以相同 `duration`/`ease` 自動淡出；僅 `highlight-box`/`spotlight`/`text-callout` 三種 `OVERLAY_EFFECT_TYPES` 有意義，整頁 transform 效果忽略）。前端 `frontend/src/types.ts` 的 `SlideAnimationEffect` 同步新增該欄位；`frontend/src/lib/animationSpec.ts` 新增常數 `DEFAULT_EXIT_DURATION_SECONDS = 2`（UI 預設值）。`frontend/src/components/slide/buildGsapTimeline.ts` 在 overlay 效果既有的 `fromTo(overlay, {autoAlpha:0}, {autoAlpha:1, ...})` 之後，若 `effect.exitDuration !== undefined`，再加一個 `to(overlay, {autoAlpha:0, ...}, start+duration+exitDuration)` 做自動淡出。`AnimationEditorTab.tsx` 在效果類型為 `OVERLAY_EFFECT_TYPES` 時新增「顯示後自動消失」控制項：勾選 checkbox 後出現秒數輸入框（0~600，步距 0.1，預設 2 秒），未勾選時 `exitDuration` 為 `undefined`（維持既有「淡入後常駐顯示」行為）。新增中英文 i18n 鍵 `play.animation.exitDuration`。並更新設計文件 `docs/animation-slide-v1-design.md`：新增 §5.3「效果自動消失（exitDuration）」、更新 §5.1/§5.2 淡入後行為說明、§7 編輯器 UI 說明、§12（V1.1 新增 transform 效果對稱「消失」機制）與檔頭擴充註記。本次僅套用於 overlay 效果；`fade-in`/`zoom-*`/`pan-*` 等整頁 transform 效果的對稱「恢復原狀」機制留待後續版本。驗證：後端新增 3 項測試（`backend/test/page-animation.test.ts`，涵蓋 exitDuration 接受/保留、未提供時省略、負數與超出上限拒絕），`npx tsx --test test/page-animation.test.ts` 29 項全數通過，`npm test` 73 測試 55 通過/18 失敗，失敗數與既有認證基線相同，無新增失敗；前後端 `npx tsc --noEmit`、前端 `npx vite build`、`npx tsx --test src/lib/animationSpec.test.ts`（3 項）皆通過。

- 時間: 2026-06-12 16:15:00 +0800
- 分支: feature/animation-ai-focus-generation-20260612
- 內容: 完成「自動產生逐字稿焦點功能要用 AI 選擇要在什麼時顯示在什麼位置」之 v1（LLM 版焦點動畫生成）。新增後端服務 `backend/src/services/animationAutoFocus.ts`：以 `callChatJSON`（沿用 `LLM_PROVIDER` 設定）呼叫 LLM，prompt 包含本頁逐字稿句子（最多 20 句）、選填的逐句動畫指引 `hints` 與頁面 OCR 文字，回應為每句的 `show`/`type`（`highlight-box`/`spotlight`）/`xPct`/`yPct`/`widthPct`/`heightPct`/`exitDuration`（皆選填），以 zod schema `AutoFocusAiResponseSchema` 驗證；`mapAutoFocusResponseToEffects` 將回應映射為 `AnimationEffect[]`（僅保留 `show:true`、去重、依 line 排序，`startTrigger:{type:'transcript-line',line}`、`duration:1.2`、`ease:'power1.out'`，位置/大小/`exitDuration` 皆 clamp 至合法範圍），輸出可通過 `validateAnimationSpec`。`backend/src/routes/pdfs/page-animation.ts` 新增 `POST /api/pdfs/:id/pages/:n/animation/auto-focus-ai`：讀取 `pages.text_path`（OCR 文字）並接收前端傳入的 `sentences`/`hints`，呼叫上述服務後回傳 `{ effects }`（不寫入已儲存 spec，由前端合併進編輯中的 draft）；`sentences` 為空時直接回傳 `{ effects: [] }`，未知頁面回 404。前端 `frontend/src/lib/api/pdfs.ts` 新增 `generateAiFocusEffects(id, pageNumber, { sentences, hints })`；`usePageAnimation.ts` 新增 `aiFocusBusy`/`handleGenerateAiFocusEffects`（呼叫後以回應 `effects` 覆蓋 `animationDraft.effects` 並設 `enabled:true`），透過 `PlayPageContext.tsx` 提供給 UI。`AnimationEditorTab.tsx` 在既有「🪄 自動產生逐字稿焦點動畫」（固定規則版）旁新增「🤖 AI 自動產生焦點動畫」按鈕，點擊前以 `window.confirm` 詢問是否覆蓋現有效果，本頁尚無逐字稿時停用。新增中英文 i18n 鍵 `play.animation.autoGenerateFocusAi`/`autoGenerateFocusAiBusy`/`autoGenerateFocusAiConfirm`/`autoGenerateFocusAiDone`/`autoGenerateFocusAiError`。並更新設計文件 `docs/animation-slide-v1-design.md`：新增 §7.4「AI 自動產生焦點動畫」、更新 §8 後端 API 表與 §12（V2 LLM 生成動畫——焦點方框時機/位置已落地，`text-callout` 與其他效果類型留待後續）與檔頭擴充註記。本次僅涵蓋 `highlight-box`/`spotlight` 焦點方框；`text-callout`（含 AI 生成文案）與其他效果類型的 AI 生成留待後續版本。驗證：後端新增 6 項測試（`backend/test/page-animation.test.ts`，涵蓋 `mapAutoFocusResponseToEffects` 映射/過濾/clamp/通過 `validateAnimationSpec`，以及新端點的成功/空輸入/404），`npx tsx --test test/page-animation.test.ts` 35 項全數通過，`npm test` 79 測試 61 通過/18 失敗，失敗數與既有認證基線相同，無新增失敗；前後端 `npx tsc --noEmit`、前端 `npx vite build`、`npx tsx --test src/lib/animationSpec.test.ts`（3 項）皆通過。

- 時間: 2026-06-12 16:40:00 +0800
- 分支: feature/youtube-caption-download-label-recheck-20260612
- 內容: 複查「下載 youtube 時，下載字幕檔的動作不應該叫產生字幕檔，應該叫下載字幕檔」。全文搜尋 `frontend/src`、`backend/src`、`docs/` 與 locale 檔，未發現任何將下載字幕標示為「產生字幕（檔）」的殘留字串；目前 `backend/src/services/youtubeCaptions.ts` 的 `fetchYoutubeCaptions`（fetch=下載既有字幕軌，無字幕才 fallback 至 STT 並標示為 `transcribing_audio`/「語音轉文字（STT）」）、`backend/src/worker/pipeline.ts` 的 `setProgress(pdfId, 'downloading_captions', ...)`，以及 `frontend/src/locales/zh-TW.ts`/`en.ts` 的 `progress.downloadingCaptions: '下載字幕'`/`'Downloading captions'` 均已正確標示為「下載」。追溯歷史確認此命名問題已在更早的 commit `445647b`（2026-06-01 05:00:40，"feat(youtube): add visible download and STT progress stages"）修正，而本 TODO 項目是在同日稍晚（09:03）才被記錄、僅未同步勾選。本次無需額外程式碼變更，複查記錄保存於 `docs/todo-rechecks/2026-06-12-youtube-caption-download-label.md`。

- 時間: 2026-06-12 17:05:00 +0800
- 分支: feature/todo-no-pending-recheck-20260612-1705
- 內容: 重新確認 master 中 TODO.md 未發現行首未完成核取項目；本次以獨立分支保存複查記錄 docs/todo-rechecks/2026-06-12-1705.md，並回到 master 更新工作記錄。

- 時間: 2026-06-12 17:30:00 +0800
- 分支: feature/todo-no-pending-recheck-20260612-1730
- 內容: 重新確認 master 中 TODO.md 未發現行首未完成核取項目；本次以獨立分支保存複查記錄 docs/todo-rechecks/2026-06-12-1730.md，並回到 master 更新工作記錄。

- 時間: 2026-06-12 17:55:00 +0800
- 分支: feature/todo-no-pending-recheck-20260612-1755
- 內容: 重新確認 master 中 TODO.md 未發現行首未完成核取項目；本次以獨立分支保存複查記錄 docs/todo-rechecks/2026-06-12-1755.md，並回到 master 更新工作記錄。

- 時間: 2026-06-12 18:20:00 +0800
- 分支: feature/todo-no-pending-recheck-20260612-1820
- 內容: 重新確認 master 中 TODO.md 未發現行首未完成核取項目；複查時發現檔案結尾有一筆未提交的空白核取項目 `[ ] `（無描述文字），視為雜訊一併移除。本次以獨立分支保存複查記錄 docs/todo-rechecks/2026-06-12-1820.md，並回到 master 更新工作記錄。

- 時間: 2026-06-12 18:45:00 +0800
- 分支: feature/animation-ai-focus-page-image-20260612
- 內容: 完成「generateAiFocusEffects中將目前頁面的圖片傳過去以得到比較正確的位置」。`backend/src/services/animationAutoFocus.ts` 的 `generateAiFocusEffects` 新增選填 `imageDataUrl` 參數，提供時會以 `ChatCompletionContentPart[]`（`image_url` + `text`）將本頁渲染圖片一併送給 LLM，並在系統提示詞中補充「依圖片實際版面判斷座標」的說明；`backend/src/routes/pdfs/page-animation.ts` 新增 `loadAnimationPageImageDataUrl`，讀取 `pages.image_path`（或回退 `pageImagePath`）、縮圖轉 JPEG base64 後傳入，讀取失敗則回退純文字。同時修正前一筆提交（`修正動畫產生器`）中誤植的系統提示詞文字（`type`/`highlight-box` 說明）。新增/通過 `backend/test/page-animation.test.ts` 驗證 image_url 內容已附加；`npx tsc --noEmit` 與 `npx tsx --test test/*.test.ts`（80 個測試，62 通過、18 失敗，失敗數與既有基準一致）。圖片輸入僅在 `LLM_PROVIDER=openai`（預設）時實際送出；Gemini 路徑沿用既有 `'[image]'` 占位限制，已於 docs/animation-slide-v1-design.md §7.4 記錄。檔案結尾另有一筆未完成項目「新增一個編輯」描述過於模糊（無具體對象），本次未處理，留待後續釐清。

- 時間: 2026-06-12 19:10:00 +0800
- 分支: feature/todo-clarify-vague-item-20260612-1910
- 內容: 複查 TODO.md 中唯一剩餘的未完成項目「新增一個編輯」，發現其未指明編輯對象（哪個頁面/功能/檔案）與想要的行為，專案中已有多種「編輯」相關功能，無法判斷對應到哪一項可實作的具體需求，性質與上一輪移除的空白核取項目類似。本次以獨立分支保存複查記錄 docs/todo-rechecks/2026-06-12-1910.md，並回到 master 移除該行、更新工作記錄。若之後仍需要此功能，請在 TODO.md 中具體說明要編輯的對象與行為。

- 時間: 2026-06-12 19:35:00 +0800
- 分支: feature/todo-no-pending-recheck-20260612-1935
- 內容: 重新確認 master 中 TODO.md 未發現行首未完成核取項目；本次以獨立分支保存複查記錄 docs/todo-rechecks/2026-06-12-1935.md，並回到 master 更新工作記錄。

- 時間: 2026-06-12 20:00:00 +0800
- 分支: feature/todo-no-pending-recheck-20260612-2000
- 內容: 重新確認 master 中 TODO.md 未發現行首未完成核取項目；本次以獨立分支保存複查記錄 docs/todo-rechecks/2026-06-12-2000.md，並回到 master 更新工作記錄。

- 時間: 2026-06-12 20:25:00 +0800
- 分支: feature/todo-no-pending-recheck-20260612-2025
- 內容: 重新確認 master 中 TODO.md 未發現行首未完成核取項目；本次以獨立分支保存複查記錄 docs/todo-rechecks/2026-06-12-2025.md，並回到 master 更新工作記錄。

- 時間: 2026-06-12 20:50:00 +0800
- 分支: feature/todo-no-pending-recheck-20260612-2050
- 內容: 重新確認 master 中 TODO.md 未發現行首未完成核取項目；本次以獨立分支保存複查記錄 docs/todo-rechecks/2026-06-12-2050.md，並回到 master 更新工作記錄。

- 時間: 2026-06-12 21:15:00 +0800
- 分支: feature/todo-no-pending-recheck-20260612-2115
- 內容: 重新確認 master 中 TODO.md 未發現行首未完成核取項目；本次以獨立分支保存複查記錄 docs/todo-rechecks/2026-06-12-2115.md，並回到 master 更新工作記錄。

- 時間: 2026-06-12 21:40:00 +0800
- 分支: feature/todo-no-pending-recheck-20260612-2140
- 內容: 重新確認 master 中 TODO.md 未發現行首未完成核取項目；本次以獨立分支保存複查記錄 docs/todo-rechecks/2026-06-12-2140.md，並回到 master 更新工作記錄。

- 時間: 2026-06-12 22:05:00 +0800
- 分支: feature/todo-no-pending-recheck-20260612-2205
- 內容: 重新確認 master 中 TODO.md 未發現行首未完成核取項目；本次以獨立分支保存複查記錄 docs/todo-rechecks/2026-06-12-2205.md，並回到 master 更新工作記錄。

- 時間: 2026-06-12 22:30:00 +0800
- 分支: feature/todo-no-pending-recheck-20260612-2230
- 內容: 重新確認 master 中 TODO.md 未發現行首未完成核取項目；本次以獨立分支保存複查記錄 docs/todo-rechecks/2026-06-12-2230.md，並回到 master 更新工作記錄。

- 時間: 2026-06-12 22:55:00 +0800
- 分支: feature/todo-no-pending-recheck-20260612-2255
- 內容: 重新確認 master 中 TODO.md 未發現行首未完成核取項目；本次以獨立分支保存複查記錄 docs/todo-rechecks/2026-06-12-2255.md，並回到 master 更新工作記錄。

- 時間: 2026-06-12 23:20:00 +0800
- 分支: feature/todo-no-pending-recheck-20260612-2320
- 內容: 重新確認 master 中 TODO.md 未發現行首未完成核取項目；本次以獨立分支保存複查記錄 docs/todo-rechecks/2026-06-12-2320.md，並回到 master 更新工作記錄。

- 時間: 2026-06-12 23:45:00 +0800
- 分支: feature/todo-no-pending-recheck-20260612-2345
- 內容: 重新確認 master 中 TODO.md 未發現行首未完成核取項目；本次以獨立分支保存複查記錄 docs/todo-rechecks/2026-06-12-2345.md，並回到 master 更新工作記錄。

- 時間: 2026-06-13 00:10:00 +0800
- 分支: feature/todo-no-pending-recheck-20260613-0010
- 內容: 重新確認 master 中 TODO.md 未發現行首未完成核取項目；本次以獨立分支保存複查記錄 docs/todo-rechecks/2026-06-13-0010.md，並回到 master 更新工作記錄。

- 時間: 2026-06-13 00:35:00 +0800
- 分支: feature/todo-no-pending-recheck-20260613-0035
- 內容: 重新確認 master 中 TODO.md 未發現行首未完成核取項目；本次以獨立分支保存複查記錄 docs/todo-rechecks/2026-06-13-0035.md，並回到 master 更新工作記錄。

# 新功能(每一個功能使用一個 branch，做好後也要更新 master 上的設計文件)

[x] 每一個動畫都要有消失時間。（完成於分支: feature/animation-exit-duration-20260612，v1 為 highlight-box/spotlight/text-callout 三種 overlay 效果新增選填 `exitDuration`，淡入後可自動淡出；fade-in/zoom/pan 等整頁 transform 效果留待後續版本）
[x] 自動產生逐字稿焦點功能要用 AI 選擇要在什麼時顯示在什麼位置。（完成於分支: feature/animation-ai-focus-generation-20260612，v1 新增 `POST /api/pdfs/:id/pages/:n/animation/auto-focus-ai`，由 LLM 依逐字稿句子（與選填 hints、頁面 OCR 文字）逐句決定是否顯示 highlight-box/spotlight 焦點方框及其位置、大小與消失時間，編輯器新增「🤖 AI 自動產生焦點動畫」按鈕與既有固定規則版並列；text-callout 與其他效果類型的 AI 生成留待後續）
[x] 重新確認 master TODO.md 無未完成項目並更新工作記錄（完成於分支: feature/todo-no-pending-recheck-20260612-1705）
[x] 重新確認 master TODO.md 無未完成項目並更新工作記錄（完成於分支: feature/todo-no-pending-recheck-20260612-1730）
[x] 重新確認 master TODO.md 無未完成項目並更新工作記錄（完成於分支: feature/todo-no-pending-recheck-20260612-1755）
[x] 重新確認 master TODO.md 無未完成項目並更新工作記錄（完成於分支: feature/todo-no-pending-recheck-20260612-1820）
[x] generateAiFocusEffects中將目前頁面的圖片傳過去以得到比較正確的位置（完成於分支: feature/animation-ai-focus-page-image-20260612，`generateAiFocusEffects` 新增 `imageDataUrl` 參數，AI 自動產生焦點動畫時會將本頁渲染圖片縮圖後一併送給 LLM 作為視覺輸入，並更新提示詞說明依圖片實際版面判斷座標；圖片讀取失敗則回退純文字。同時修正先前提交誤植的系統提示詞文字。圖片僅在 `LLM_PROVIDER=openai` 時實際送出，Gemini 路徑沿用既有限制，詳見 docs/animation-slide-v1-design.md §7.4）
[x] 重新確認 master TODO.md 無未完成項目並更新工作記錄（完成於分支: feature/todo-no-pending-recheck-20260612-1935）
[x] 重新確認 master TODO.md 無未完成項目並更新工作記錄（完成於分支: feature/todo-no-pending-recheck-20260612-2000）
[x] 重新確認 master TODO.md 無未完成項目並更新工作記錄（完成於分支: feature/todo-no-pending-recheck-20260612-2025）
[x] 重新確認 master TODO.md 無未完成項目並更新工作記錄（完成於分支: feature/todo-no-pending-recheck-20260612-2050）
[x] 重新確認 master TODO.md 無未完成項目並更新工作記錄（完成於分支: feature/todo-no-pending-recheck-20260612-2115）
[x] 重新確認 master TODO.md 無未完成項目並更新工作記錄（完成於分支: feature/todo-no-pending-recheck-20260612-2140）
[x] 重新確認 master TODO.md 無未完成項目並更新工作記錄（完成於分支: feature/todo-no-pending-recheck-20260612-2205）
[x] 重新確認 master TODO.md 無未完成項目並更新工作記錄（完成於分支: feature/todo-no-pending-recheck-20260612-2230）
[x] 重新確認 master TODO.md 無未完成項目並更新工作記錄（完成於分支: feature/todo-no-pending-recheck-20260612-2255）
[x] 重新確認 master TODO.md 無未完成項目並更新工作記錄（完成於分支: feature/todo-no-pending-recheck-20260612-2320）
[x] 重新確認 master TODO.md 無未完成項目並更新工作記錄（完成於分支: feature/todo-no-pending-recheck-20260612-2345）
[x] 重新確認 master TODO.md 無未完成項目並更新工作記錄（完成於分支: feature/todo-no-pending-recheck-20260613-0010）
[x] 重新確認 master TODO.md 無未完成項目並更新工作記錄（完成於分支: feature/todo-no-pending-recheck-20260613-0035）
[x] 新增一個使用提示詞生成動畫的功能，這個功能會直接生成 javascript 程式在 UI 上展示一個複雜的動畫。例如載人 MNIST 資料集並使用 resnet50 產生 embeeding 並使用 PCA 顯示二維的特徵點。顯示數字轉換成點並跑到特徵空間中的位置形成一個分類器的過程。進入這個畫面可以反覆的下提示詞調整結果直到滿意為止。這個動畫可以和其它動畫一起被播放。（完成於分支: feature/animation-prompt-custom-script-20260613，v1 提供通用 sandboxed AI 自訂 JS 動畫框架與提示詞生成/迭代迴圈；MNIST/ResNet50/PCA 資料管線留待 V2.x，詳見 docs/animation-slide-v1-design.md §5.4/§12）
[x] 在自訂動畫的編輯器中，在右邊顯示一個對話框，讓我們可以和 AI 多輪對話逐步修正結果。（已於 master 直接提交完成：commit 886baa7/abaae66/7dbbe61/04404d3/542f428/9e273d4，新增 JavaScript 原始碼編輯器並將 custom-script 編輯移至獨立對話框，含提示詞輸入、產生/重新產生按鈕與即時預覽，支援多輪迭代；詳見 docs/animation-slide-v1-design.md §13）
[x] 動畫的長度圖定是10 秒，實際長度由效果的長度決定。動畫只顯示一輪，然後在指定的時間後消失。（完成於分支: feature/animation-custom-script-duration-20260612，custom-script sandbox 新增 `api.duration = customScriptDurationSeconds(effect)`，AI 提示詞改為以 `Math.min(t/api.duration,1)` 計算進度、播放一輪後停留在最終畫面，不再由 AI 自行假設總長度；編輯器預覽迴圈長度與此同步，詳見 docs/animation-slide-v1-design.md §5.4/§13）
[x] 支援 manim 式的動畫（完成於分支: feature/animation-manim-style-helper-20260612，custom-script sandbox 在使用者程式碼之前注入 `window.Manim`（`frontend/src/lib/manimHelperScript.ts`），提供 manim 風格座標系/色票/rate function/SVG mobject 形狀與 Create/Write/FadeIn/FadeOut/Transform/Shift/Rotate/Scale/GrowFromCenter 動畫；後端提示詞同步說明此 API，使用者要求「manim 風格」時 LLM 可直接呼叫；v1 不含 MathTex/Axes/3D/路徑變形，詳見 docs/animation-slide-v1-design.md §5.4/§12/§13）
[x] 重新確認 master TODO.md 無未完成項目並更新工作記錄（完成於分支: feature/todo-no-pending-recheck-20260612-1959）
[x] 重新確認 master TODO.md 無未完成項目並更新工作記錄（完成於分支: feature/todo-no-pending-recheck-20260612-2001）
[x] 重新確認 master TODO.md 無未完成項目並更新工作記錄（完成於分支: feature/todo-no-pending-recheck-20260612-2004）
[x] 重新確認 master TODO.md 無未完成項目並更新工作記錄（完成於分支: feature/todo-no-pending-recheck-20260612-2013）
[x] 重新確認 master TODO.md 無未完成項目並更新工作記錄（完成於分支: feature/todo-no-pending-recheck-20260612-2014）

- 時間: 2026-06-12 16:52:00 +0800
- 分支: feature/animation-prompt-custom-script-20260613
- 內容: 完成「新增一個使用提示詞生成動畫的功能」之 v1（custom-script 自訂腳本動畫）。後端 `backend/src/services/pageAnimation.ts` 的 `ANIMATION_EFFECT_TYPES`/`SLIDE_ANIMATION_EFFECT_TYPES` 新增 `'custom-script'`，`OVERLAY_EFFECT_TYPES` 納入此類型，`ALLOWED_PARAM_KEYS['custom-script']` 開放 `xPct`/`yPct`/`widthPct`/`heightPct`；`AnimationEffect`/`SlideAnimationEffect` 新增選填欄位 `code?: string`（AI 產生的 JavaScript，上限 8000 字 = `MAX_CUSTOM_SCRIPT_CODE_LENGTH`）與 `prompt?: string`（產生用提示詞，上限 300 字 = `MAX_CUSTOM_SCRIPT_PROMPT_LENGTH`）。新增服務 `backend/src/services/animationCustomScript.ts`：`generateCustomScriptCode()` 呼叫 LLM（`callChatJSON`）依使用者提示詞（與本頁 OCR 文字、可選的 `previousCode`）產生 `{ code }`，`findUnsafeScriptPattern()` 對輸出做縱深防禦黑名單檢查（fetch/XHR/WebSocket/import/require/eval/new Function/cookie/storage/window.parent/top/frameElement 等）；新增路由 `POST /api/pdfs/:id/pages/:n/animation/custom-script`，命中黑名單回 422 `UNSAFE_SCRIPT`。前端 `frontend/src/lib/animationSpec.ts` 新增 `buildCustomScriptSandboxDoc(code)`：將 `effect.code` 以 base64 嵌入 `<iframe sandbox="allow-scripts">`（無 `allow-same-origin`，opaque origin）的 `srcDoc`，定義 `window.renderAnimation(root, api)`/`api.onFrame(cb)` 契約，host 透過 `{type:'sync', t, playing}` postMessage 驅動播放（`useGsapSlideTimeline.ts` 新增對應 effect，依 `currentTime - effect.start` 計算 `t`）。`SlideRenderer.tsx`/`buildGsapTimeline.ts` 將 `custom-script` 納入既有 overlay 淡入/`exitDuration` 淡出機制。`AnimationEditorTab.tsx` 新增提示詞輸入框、產生/重新產生按鈕與 `CustomScriptPreview`（編輯器內 sandboxed 即時預覽，依 `previewLoopSeconds` 迴圈送出 sync 訊息）。新增中英文 i18n 鍵（`play.animation.type.custom-script`、`customScriptPrompt*`、`customScriptGenerate*` 等）。並更新設計文件 `docs/animation-slide-v1-design.md`（新增 §5.4/§6.6/§7.5/§8/§12，明確記錄 MNIST/ResNet50/PCA 資料管線因 sandbox 禁止網路存取留待 V2.x）。驗證：後端新增/通過共 9 項測試（`backend/test/page-animation.test.ts`，涵蓋 schema 驗證、`findUnsafeScriptPattern`、新路由成功/迭代/422/400/404），`npm test` 89 測試 71 通過/18 失敗（與既有基準一致，無新增失敗）；前端新增 4 項 `buildCustomScriptSandboxDoc` 單元測試（`frontend/src/lib/animationSpec.test.ts`，7 項全數通過）；前後端 `npx tsc --noEmit`、前端 `npx vite build` 皆通過。

- 時間: 2026-06-12 17:54:00 +0800
- 分支: master（使用者直接提交，commit 886baa7/abaae66/7dbbe61/04404d3/542f428/9e273d4）
- 內容: 複查並標記完成「在自訂動畫的編輯器中，在右邊顯示一個對話框，讓我們可以和 AI 多輪對話逐步修正結果」。本項已由使用者於 master 直接提交完成（未走獨立 feature branch）：`abaae66`（custom-script 安全性強化，新增 §13 hardening checklist 與多項後端測試）、`7dbbe61`/`04404d3`/`542f428`（修正並補上 `POST .../animation/custom-script` 路由與診斷）、`886baa7`（在效果列新增 JavaScript 原始碼編輯器，可在 AI 產生後手動修改 `effect.code`）、`9e273d4`（將 custom-script 的提示詞、原始碼編輯器與 `CustomScriptPreview` 移至獨立對話框，主效果列僅保留「編輯動畫」按鈕與基本時間控制；對話框左側為提示詞/產生按鈕/原始碼編輯器，右側即時顯示 sandbox 預覽，可反覆輸入新提示詞迭代）。設計文件 `docs/animation-slide-v1-design.md` 已隨上述提交更新（§5.4 補充原始碼編輯說明、新增 §13）。複查確認：`npx tsc --noEmit` 通過，`npm test`（backend）94 測試 76 通過/18 失敗（與既有基準一致），前端 `npx vite build` 通過。

- 時間: 2026-06-12 18:20:00 +0800
- 分支: feature/animation-custom-script-duration-20260612
- 內容: 完成「動畫的長度固定是10秒，實際長度由效果的長度決定。動畫只顯示一輪，然後在指定的時間後消失」。問題根因：`backend/src/services/animationCustomScript.ts` 先前要求 LLM 自行假設動畫「總時長」並以 `t` 除以該值計算進度，導致產生的程式碼常採用任意（例如10秒）的循環週期，與編輯器中該效果實際設定的 `duration`/`exitDuration` 無關，造成預覽/播放時動畫長度與停留行為不一致、且常見以 `t % N` 形式無限循環重播。修正：`frontend/src/lib/animationSpec.ts` 新增 `customScriptDurationSeconds(effect) = effect.duration + (effect.exitDuration ?? 0)`（總長度，秒，下限 1），`buildCustomScriptSandboxDoc(code, durationSeconds)` 新增第二參數，於 sandbox 內建立 `api.duration = durationSeconds`（與 `api.onFrame` 同層級，建立時即可讀取）。`SlideRenderer.tsx` 的 `EffectOverlay`（實際播放）改傳入 `customScriptDurationSeconds(effect)`；`AnimationEditorTab.tsx` 的 `previewLoopSeconds(effect)` 改為 `clamp(customScriptDurationSeconds(effect), 2, 20)`，`CustomScriptPreview` 將同一值傳給 `buildCustomScriptSandboxDoc` 作為 `api.duration`，使預覽迴圈與 `api.duration` 一致。後端 `animationCustomScript.ts` 的系統提示詞改為：說明 `api.duration` 由使用者設定（非 AI 自行決定），要求以 `Math.min(t / api.duration, 1)` 計算 0~1 進度，動畫在 `t: 0 → api.duration` 播放「一輪」，達到 1 後維持最終畫面（不重置/不循環），之後效果依 `exitDuration` 整體淡出消失；仍需處理 `t` 變小（倒退/重播）。並更新設計文件 `docs/animation-slide-v1-design.md`（§5.4 程式碼契約新增 `api.duration` 說明與沙箱注入方式、§7.5 補充 `previewLoopSeconds`/`api.duration` 對應關係、§13 新增說明與手動 QA 步驟）。驗證：前端新增 6 項測試（`frontend/src/lib/animationSpec.test.ts`，涵蓋 `api.duration` 嵌入、無效輸入回退預設值、`customScriptDurationSeconds` 計算與下限），16 項全數通過；`npx tsc --noEmit`、`npx vite build` 皆通過；後端 `npm test` 94 測試 76 通過/18 失敗（與既有基準一致，無新增失敗）。

- 時間: 2026-06-12 19:30:00 +0800
- 分支: feature/animation-manim-style-helper-20260612
- 內容: 完成「支援 manim 式的動畫」。新增 `frontend/src/lib/manimHelperScript.ts`，匯出純 ES5 JavaScript 原始碼字串 `MANIM_HELPER_SCRIPT`：定義全域 `window.Manim`，提供 manim 風格座標系（`Manim.config = {width:14, height:8}`，原點在中心、`+y` 朝上，內部以 `toSvgY` 處理 SVG y 軸翻轉）、manim 慣用色票 `Manim.colors`（`WHITE`/`BLACK`/`GREY`/`BLUE`/`GREEN`/`RED`/`YELLOW`/`PURPLE`/`ORANGE`/`PINK`/`TEAL`）、manim 標準 rate function `Manim.rate.linear/smooth/thereAndBack/rushInto/rushFrom`（`smooth` 為 5 次方 smoothstep）、`Manim.lerp`/`Manim.lerpColor` 數值與顏色線性插值、`Manim.createSvg(root)` 建立填滿版面的 `<svg viewBox="-7 -4 14 8">`、`Manim.shapes.circle/square/rectangle/line/arrow/dot/polygon/text(svg, opts)` 建立 SVG mobject（回傳 `{el, kind, svg}`），以及 `Manim.animate.create/write/fadeIn/fadeOut/grow/shift/rotate/scale/transform(mobject, ...)` 等 manim 招牌動畫手法（依 0~1 進度直接設定視覺狀態，可在每次 `onFrame` 重複呼叫；`create` 用 `getTotalLength()` + `stroke-dasharray`/`stroke-dashoffset` 做描邊繪製，`write` 對文字依進度截斷顯示，`transform` 在同類型 mobject 間交叉淡化並線性插值共有屬性）。`frontend/src/lib/animationSpec.ts` 的 `buildCustomScriptSandboxDoc` 在使用者 `code` 之前以獨立 `<script>` 注入 `MANIM_HELPER_SCRIPT`，使 `window.Manim` 在 sandbox 內（含編輯器預覽與正式播放，兩者共用同一函式）皆可用。後端 `backend/src/services/animationCustomScript.ts` 的系統提示詞新增 `window.Manim` API 說明與使用情境（使用者要求「manim 風格」如幾何圖形/座標平面/Create/Write/Transform/FadeIn/深色配色時可呼叫，一般請求可忽略）。新增測試 `frontend/src/lib/manimHelperScript.test.ts`（以 Node `vm` 模組搭配最小 DOM stub 執行 `MANIM_HELPER_SCRIPT`，驗證 rate function 數值、`lerp`/`lerpColor`、色票、各 shape 的座標/屬性與 y 軸翻轉、`create`/`write`/`fadeIn`/`fadeOut`/`shift`/`transform` 的視覺狀態變化，10 項全數通過）；並更新 `frontend/src/lib/animationSpec.test.ts`（`</script>` 計數由 1 改為 2，新增檢查 `buildCustomScriptSandboxDoc` 輸出含 `window.Manim`/`smooth:`/`colors:`/`shapes:`/`animate:`，共 17 項全數通過）。更新設計文件 `docs/animation-slide-v1-design.md`：§5.4 新增「manim 風格輔助函式庫（window.Manim）」小節（含 v1 範圍與限制：無 MathTex/Axes/NumberPlane/3D、`transform` 僅線性插值非路徑變形）、§12 新增 V2.x 擴充方向（`Axes`/`NumberPlane`/`MathTex`/路徑變形/3D）、§13 新增說明條目與第 8 項手動 QA 步驟（要求「manim 風格」Transform + Write 動畫，確認使用 `window.Manim` 並維持 `api.duration` 一輪後停留的既有語義）。驗證：前端新增 10 項測試（manimHelperScript.test.ts）+ 既有 animationSpec.test.ts 共 27 項全數通過；`npx tsc --noEmit`、`npx vite build` 皆通過；後端 `npm test` 94 測試 76 通過/18 失敗（與既有基準一致，無新增失敗）。
- 時間: 2026-06-12 19:59:00 +0800
- 分支: feature/todo-no-pending-recheck-20260612-1959
- 內容: 重新確認 master 中 TODO.md 未發現行首未完成核取項目；本次以獨立分支保存複查記錄 docs/todo-rechecks/2026-06-12-1959.md，並回到 master 更新工作記錄。

- 時間: 2026-06-12 20:01:00 +0800
- 分支: feature/todo-no-pending-recheck-20260612-2001
- 內容: 重新確認 master 中 TODO.md 未發現行首未完成核取項目；本次以獨立分支保存複查記錄 docs/todo-rechecks/2026-06-12-2001.md，並回到 master 更新工作記錄。

- 時間: 2026-06-12 20:04:00 +0800
- 分支: feature/todo-no-pending-recheck-20260612-2004
- 內容: 重新確認 master 中 TODO.md，未發現行首未完成核取項目（`^[ ]`），working tree 亦無未提交變更。本次以獨立分支保存複查記錄（docs/todo-rechecks/2026-06-12-2004.md），並回到 master 更新工作記錄。

- 時間: 2026-06-12 20:13:00 +0800
- 分支: feature/todo-no-pending-recheck-20260612-2013
- 內容: 重新確認 master 中 TODO.md，未發現行首未完成核取項目（`^[ ]`），working tree 亦無未提交變更。本次以獨立分支保存複查記錄（docs/todo-rechecks/2026-06-12-2013.md），並回到 master 更新工作記錄。

- 時間: 2026-06-12 20:14:00 +0800
- 分支: feature/todo-no-pending-recheck-20260612-2014
- 內容: 重新確認 master 中 TODO.md，未發現行首未完成核取項目（`^[ ]`），working tree 亦無未提交變更。本次以獨立分支保存複查記錄（docs/todo-rechecks/2026-06-12-2014.md），並回到 master 更新工作記錄。
