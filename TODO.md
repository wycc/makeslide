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
[x] 重新確認 master TODO.md 無未完成項目並更新工作記錄（完成於分支: feature/todo-no-pending-recheck-20260612-2049）
[x] 重新確認 master TODO.md 無未完成項目並更新工作記錄（完成於分支: feature/todo-no-pending-recheck-20260612-2054）
[x] 重新確認 master TODO.md 無未完成項目並更新工作記錄（完成於分支: feature/todo-no-pending-recheck-20260612-2058）
[x] 重新確認 master TODO.md 無未完成項目並更新工作記錄（完成於分支: feature/todo-no-pending-recheck-20260612-2103）
[x] 重新確認 master TODO.md 無未完成項目並更新工作記錄（完成於分支: feature/todo-no-pending-recheck-20260612-2108）
[x] 重新確認 master TODO.md 無未完成項目並更新工作記錄（完成於分支: feature/todo-no-pending-recheck-20260612-2112）
[x] 重新確認 master TODO.md 無未完成項目並更新工作記錄（完成於分支: feature/todo-no-pending-recheck-20260612-2118）
[x] 重新確認 master TODO.md 無未完成項目並更新工作記錄（完成於分支: feature/todo-no-pending-recheck-20260612-2122）
[x] 重新確認 master TODO.md 無未完成項目並更新工作記錄（完成於分支: feature/todo-no-pending-recheck-20260612-2127）
[x] 重新確認 master TODO.md 無未完成項目並更新工作記錄（完成於分支: feature/todo-no-pending-recheck-20260612-2132）
[x] 重新確認 master TODO.md 無未完成項目並更新工作記錄（完成於分支: feature/todo-no-pending-recheck-20260612-2137）
[x] 重新確認 master TODO.md 無未完成項目並更新工作記錄（完成於分支: feature/todo-no-pending-recheck-20260612-2141）
[x] 重新確認 master TODO.md 無未完成項目並更新工作記錄（完成於分支: feature/todo-no-pending-recheck-20260612-2146）
[x] 重新確認 master TODO.md 無未完成項目並更新工作記錄（完成於分支: feature/todo-no-pending-recheck-20260612-2151）
[x] 重新確認 master TODO.md 無未完成項目並更新工作記錄（完成於分支: feature/todo-no-pending-recheck-20260612-2155）
[x] 重新確認 master TODO.md 無未完成項目並更新工作記錄（完成於分支: feature/todo-no-pending-recheck-20260612-2201）
[x] 重新確認 master TODO.md 無未完成項目並更新工作記錄（完成於分支: feature/todo-no-pending-recheck-20260612-2202）
[x] 在AI自訂動畫編輯器中允許至多 24K 的輸出。並且改用 streaming 模式，在輸出時顯示結果。如果錯誤要在 UI 上顯示錯誤訊息。（完成於分支: feature/custom-script-streaming-24k-20260612，custom-script 的 `MAX_CUSTOM_SCRIPT_CODE_LENGTH` 由 8000 提升至 24000（前後端同步），LLM 改為 `stream: true`（新增 `MAX_CUSTOM_SCRIPT_OUTPUT_TOKENS = 24000`）並直接輸出原始 JavaScript（非 JSON 包裝）；後端新增 SSE 路由（`event: delta`/`done`/`error`），前端 `generateCustomScriptCode` 以 `ReadableStream` 即時解析並透過 `onDelta` 回呼逐段回報；編輯器程式碼框於產生中即時顯示串流內容（`customScriptStreamingCode`），完成後寫回 `effect.code`；任何錯誤（網路、`UNSAFE_SCRIPT`、`INVALID_SCRIPT_CONTRACT`、`SCRIPT_TOO_LONG`、空輸出、串流中斷無 `done`）皆顯示於 `animationError`，詳見 docs/animation-slide-v1-design.md §5.4/§7.5/§8。後續修正：LLM_PROVIDER=gemini 時的即時顯示問題已於分支 feature/gemini-custom-script-streaming-20260612 修復）
[x] 如果動畫的時間比語音還長，自動把頁面延長。（完成於分支: feature/animation-page-duration-extend-20260613，`frontend/src/lib/animationSpec.ts` 新增 `animationTimelineDurationSeconds(spec)`：計算 GSAP 動畫 timeline 的總長度（所有效果中 `start + duration + exitDuration` 的最大值，未啟用或無效果回傳 0）。`PlayPage.tsx` 新增 `animationDurationSeconds`（以 `useMemo` 由 `currentAnimationSpec` 算出，並透過 ref 同步給 `handleEnded` 使用，避免宣告順序的 TDZ 問題）；`handleEnded` 原本的切頁／結束邏輯抽成 `runPageEndedAdvance()`，語音 `ended` 時若 `animationDurationSeconds` 超出語音長度（差值 > 0.05 秒，依 `playbackRate` 換算成實際毫秒），改為先設定 `isExtendingAnimation = true` 並以 `setTimeout` 延後呼叫 `runPageEndedAdvance()`，期間透過新的 context 值 `slideAnimationPlaying`（= `isPlaying || isExtendingAnimation`，取代三處 `SlideRenderer` 的 `isPlaying` prop）讓 GSAP timeline 繼續播完整段動畫；換頁（`goPrev`/`goNext`）、拖動進度條（`handleSeek`）、或在延長期間按下播放/暫停（視為提前結束延長）皆會呼叫新增的 `clearPendingPageExtend()` 取消計時器。`PlayPageContext.tsx` 新增 `isExtendingAnimation`/`slideAnimationPlaying` 欄位。驗證：新增 4 項 `animationTimelineDurationSeconds` 單元測試於 `frontend/src/lib/animationSpec.test.ts`（`npx tsx --test src/lib/animationSpec.test.ts` 20/20 通過）；`npx tsc --noEmit` 通過。後續修正：使用者回報「只有淡入效果還有跑，但效果的動畫停了」——延長期間 GSAP timeline 的 `autoAlpha` 淡入/淡出仍持續播放，但 `custom-script` 效果內部（sandboxed iframe）的動畫卻凍結，原因是 `useGsapSlideTimeline.ts` 透過 `postMessage({type:'sync', t, playing})` 同步給 iframe 的 effect 依賴 `currentTime`，而語音結束後 `audio` 不再觸發 `timeupdate`，`currentTime` 凍結在 `duration` 不再更新。已於分支 feature/animation-extend-custom-script-sync-fix-20260613 修復）
[x] 自訂動畫（custom-script）位置與大小預設改為鋪滿整張投影片 (0,0) ~ (100,100)。（完成於分支: feature/custom-script-fullslide-default-20260613，`frontend/src/lib/animationSpec.ts` 的 `getFocusEffectParams(effect)` 新增 `DEFAULT_CUSTOM_SCRIPT_PARAMS = { xPct: 0, yPct: 0, widthPct: 100, heightPct: 100 }`，並依 `effect.type === 'custom-script'` 選用此預設值，取代原本與 `highlight-box`/`spotlight`/`text-callout` 共用的 `DEFAULT_FOCUS_PARAMS = { xPct: 30, yPct: 30, widthPct: 40, heightPct: 40 }`；若 `effect.params` 有明確設定值仍會優先採用。`AnimationEditorTab.tsx` 的效果列原本就不顯示 custom-script 的 X/Y/W/H 欄位（設計上由預設值決定，使用者無法調整），此變更使其預設鋪滿整張投影片，讓 `EffectOverlay`（`SlideRenderer.tsx`）渲染的 sandboxed iframe 可使用全部畫面；`MANIM_HELPER_SCRIPT` 內部的繪圖座標系統不受影響。並更新設計文件 `docs/animation-slide-v1-design.md` §5.4 說明 custom-script 預設值與其他焦點效果不同。驗證：`frontend/src/lib/animationSpec.test.ts` 新增 3 項測試（custom-script 預設值、其他效果預設值、custom-script 明確 params 優先），`npx tsx --test src/lib/animationSpec.test.ts` 23/23 通過；`npx tsc --noEmit` 通過）
[x] 自訂動畫（custom-script）不要有淡入的效果。（完成於分支: feature/custom-script-no-fade-in-20260613，`frontend/src/components/slide/buildGsapTimeline.ts` 的 `OVERLAY_EFFECT_TYPES` 處理區塊中，`custom-script` 不再套用 `tl.fromTo(overlay, {autoAlpha:0}, {autoAlpha:1, ...common}, effect.start)` 的 0→1 淡入過渡，改為 `tl.set(overlay, { autoAlpha: 1 }, effect.start)` 在 `effect.start` 時直接顯示；`highlight-box`/`spotlight`/`text-callout` 維持原本淡入行為不變，`exitDuration` 淡出機制（若設定）對 custom-script 仍照舊套用。`useGsapSlideTimeline.ts`/`animationSpec.ts` 中「自此效果淡入開始起算的秒數」相關註解改為「自 effect.start 起算的秒數」，避免誤導。並更新設計文件 `docs/animation-slide-v1-design.md`（§5 效果定義表格、§5.4 播放同步說明）。驗證：`frontend/src/lib/animationSpec.test.ts`（不受影響）`npx tsx --test src/lib/animationSpec.test.ts` 23/23 通過；`npx tsc --noEmit` 通過）
[x] 將自訂動畫編輯器改成一個多輪對話，讓動畫可以逐步修改。（完成於分支: feature/custom-script-conversation-20260613，`custom-script` 效果新增 `conversation?: ConversationMessage[]`（`{role:'user'|'assistant', content}`，上限 40 筆/每則 500 字 = `MAX_CUSTOM_SCRIPT_CONVERSATION_MESSAGES`/`MAX_CUSTOM_SCRIPT_CONVERSATION_MESSAGE_LENGTH`，前後端 `pageAnimation.ts`/`animationSpec.ts` 同步定義並納入 `EffectSchema`），同時作為對話框顯示內容與下一輪請求的 `history`；後端 `generateCustomScriptCodeStream()` 新增 `history` 參數，組成 `messages = [system, ...history, finalUserPrompt]` 送給 LLM（`toChatCompletionMessage` 轉換型別），`POST .../animation/custom-script` 的 `CustomScriptAiBodySchema` 新增對應 `history` 欄位驗證。前端 `AnimationEditorTab.tsx` 原本的提示詞輸入框＋產生/重新產生按鈕改為聊天介面（可捲動訊息清單＋輸入框＋送出鍵，Enter 送出/Shift+Enter 換行）；`usePageAnimation.ts` 的 `handleGenerateCustomScriptCode` 重新設計為 `handleSendCustomScriptMessage(effectId, message)`：以新增的 `appendConversationMessages`（`animationSpec.ts`，處理截斷/上限）樂觀加入使用者訊息，呼叫 API 時帶入 `previousCode`/`history`，成功時更新 `code` 並追加完成訊息、失敗時追加錯誤訊息。`cloneAnimationSpec` 同步深拷貝 `conversation`。新增中英文 i18n 鍵（`customScriptChatInputPlaceholder`/`customScriptChatEmpty`/`customScriptChatSend`，移除舊版 `customScriptPrompt*`/`customScriptGenerate`/`customScriptRegenerate`）。並更新設計文件 `docs/animation-slide-v1-design.md`（§5.4/§7.5/§13）。驗證：後端新增 7 項測試（`conversation` schema 驗證、`history` 驗證與轉發），`npx tsx --test test/page-animation.test.ts` 57/57 通過；前端新增 6 項測試（`cloneAnimationSpec`/`appendConversationMessages`），`npx tsx --test src/lib/animationSpec.test.ts` 28/28 通過；前後端 `npx tsc --noEmit` 與前端 `npx vite build` 皆通過）
[x] 將自訂動畫對話框移到右側並佔滿整個右側，預覽移到左側。（完成於分支: feature/custom-script-layout-swap-20260613，`frontend/src/pages/play/AnimationEditorTab.tsx` 的對話框內 `lg:grid-cols-2` 兩欄調整：左欄改為「預覽（`CustomScriptPreview`/空狀態提示）＋ JS 原始碼編輯器」（`flex flex-col`，編輯器以 `flex-1` 佔用剩餘高度），右欄改為「對話訊息清單＋輸入框與送出鍵」（訊息清單以 `flex-1` 佔滿右欄高度）；僅調整版面排列順序與容器 class，邏輯與資料流（`customScriptConversation`/`handleSendCustomScriptMessage`/`updateEffect` 等）不變。驗證：`npx tsc --noEmit` 通過；`npx vite build` 成功（605.38 kB，與既有 chunk-size 警告一致，無新增警告）
[x] 從 PDF 中產生大綱的過程中，除了 PDF 文字外，有時需要從其中取得圖片。規劃並實作一套方法從 PDF 中取得所有圖表（圖片本身，以及標題/說明等相關文字），讓後續產生圖片的過程中可以使用這些素材。（完成於分支: feature/pdf-figure-extraction-20260615，先撰寫設計文件 `docs/pdf-figure-extraction-design.md`，再依此實作：新增 `backend/src/worker/steps/extractPdfFigures.ts`，透過 `getOperatorList()` 追蹤 CTM 取得每個 `paintImageXObject` 的頁面 bbox（依 `FIGURE_MIN_AREA_PCT`/`FIGURE_MAX_AREA_PCT` 過濾 icon 與整頁背景），改用 `page.objs.get()` 直接取得已解碼的像素資料（繞過此環境中對含圖片頁面會丟出 "Image or Canvas expected" 的 `page.render()` 路徑），以 sharp 轉存為 PNG；並透過 `getTextContent()` 比對「Figure/Table/圖/表 N」字樣與鄰近文字段落，為每張圖配對標題與上下文摘要。輸出 `figures.json` manifest（`backend/src/services/storage.ts` 新增對應路徑函式，`backend/src/services/pdfFigures.ts` 提供 `loadFigureManifest`/`getPageFigures`/`figureImageAbsPath` 供後續取用）。Pipeline 新增非阻斷、可重入的 `extract_figures` 階段（`backend/src/types.ts`/`services/timing.ts`/`worker/pipeline.ts`，置於 `extract_text` 之後，僅適用於 PDF 來源且非文字匯入，失敗不中斷後續步驟）。新增 `backend/test/pdf-figures.test.ts`（以真實 PDF fixture 驗證圖片萃取、bbox、標題比對與冪等性），並同步更新 `backend/test/timing.test.ts`、`docs/pipeline-stage-and-page-timing.md`。驗證：`npx tsc --noEmit` 通過；全量測試 87/105 通過（18 項既有失敗與 master 基準一致，無新增失敗），新測試 2/2 通過。）
[x] 在AI自定義動畫編輯器中，改成二步驟進行。先將使用者的提示詞轉換成一個詳細步驟，顯示在對話框中。然後再根據這些步驟產生程式，並把每一個步驟寫在程式中做為註解。方便必要時手工調整。（完成於分支: feature/custom-script-two-step-plan-20260613，後端新增 `generateCustomScriptPlanStream()`（`backend/src/services/animationCustomScript.ts`，新增 `buildCustomScriptPlanSystemPrompt()`），`POST .../animation/custom-script` 路由改為兩階段 SSE：先以 `plan-delta`/`plan-done` 串流並回報「實作步驟」條列文字，再以該步驟清單呼叫既有 `generateCustomScriptCodeStream()`（新增 `plan?` 參數，系統提示詞新增「【實作步驟】」區段並要求 LLM 在程式碼對應位置以 `// 步驟 N：...` 單行註解標示），最後送出 `delta`/`done`/`error`。`MAX_CUSTOM_SCRIPT_CONVERSATION_MESSAGE_LENGTH` 由 500 提升至 2000（前後端 `pageAnimation.ts`/`animationSpec.ts` 同步），新增 `MAX_CUSTOM_SCRIPT_PLAN_OUTPUT_TOKENS = 1200`。前端 `lib/api/pdfs.ts` 的 `generateCustomScriptCode` 新增 `onPlanDelta`/`onPlanDone` callback 並回傳 `{ code, plan }`；`usePageAnimation.ts` 新增串流狀態 `customScriptStreamingPlan`（依 effect id 即時累積步驟文字，`plan-done` 後清除並以 `customScriptPlanLabel` 前綴併入 `conversation`，失敗時一併清除），`PlayPageContext.tsx`/`AnimationEditorTab.tsx` 同步串接，對話框於規劃階段顯示即時步驟泡泡（`customScriptPlanBusy`），產生程式碼階段顯示原有忙碌泡泡（`customScriptGenerateBusy`）。新增中英文 i18n 鍵 `customScriptPlanBusy`/`customScriptPlanLabel`。並更新設計文件 `docs/animation-slide-v1-design.md`（§5.4/§7.5/§8/§13）。驗證：後端新增 2 項測試（步驟串流、步驟階段錯誤），`npx tsx --test test/page-animation.test.ts` 59/59 通過；前端改寫 `api.regenerate-pageops.test.ts` 的 `generateCustomScriptCode` 測試以涵蓋兩階段事件，`npx tsx --test src/lib/animationSpec.test.ts src/lib/api.regenerate-pageops.test.ts src/lib/api.error-mapping.test.ts src/lib/manimHelperScript.test.ts` 46/46 通過；前後端 `npx tsc --noEmit` 皆通過。受限於此環境無瀏覽器自動化工具，未進行實機 UI 操作測試。）
[x] 完成在產生簡報圖形的整合，讓圖形可以使用這裡產生的圖片。（完成於分支: feature/figure-reference-image-generation-20260615，承接 `feature/pdf-figure-extraction-20260615` 萃取的 `figures.json`，依設計文件 `docs/pdf-figure-extraction-design.md` §9 規劃，整合進投影片圖片的「AI 重新生成」流程。`backend/src/services/pdfFigures.ts` 新增 `getFigureReferencesForPage(pdfId, pageNumber, max=2)`（取得該頁萃取圖表，依 bbox 面積由大到小排序並裁切至上限 `MAX_FIGURE_REFERENCES_PER_PAGE=2`）與 `buildFigureReferenceNotes(figures)`（依各圖的 `caption`/`context`（皆無則顯示「(無圖說文字)」）組成繁體中文提示文字，指示 LLM 在重繪投影片時盡量保留圖表的關鍵資訊/數據/趨勢、不需逐一複製外觀；`figures` 為空陣列時回傳 `null`）。`backend/src/services/imagePromptTemplates.ts` 的 `buildImagePrompt()` 新增選填參數 `figureNotes?: string | null`，置於 `pageScript` 區塊之後、`textBody` 之前，為 `null`/空白時不輸出該區段（向後相容）。兩個整合點：(1) `backend/src/routes/pdfs/page-operations.ts` 的 `POST /api/pdfs/:id/pages/:n/regenerate-image`；(2) `backend/src/worker/regenerate.ts` 的 `runRegenerateImages()`（對應 `POST /api/pdfs/:id/regenerate` 的 `images` 批次任務）。兩處皆改為：先以 `getFigureReferencesForPage()` 取得該頁（PDF 頁碼與 `figures.json` 頁碼為 1:1）對應的圖表，將其 PNG 與目前投影片圖片一併傳入 `client.images.edit({ image: [currentImage, ...figureRefFiles], ... })`（沿用 `page-operations.ts` inpaint 端點已使用的多圖陣列 pattern；無圖表時 `image` 維持單一圖片，行為不變），並將 `buildFigureReferenceNotes()` 的結果透過 `figureNotes` 注入 `buildImagePrompt()`；`regenerate.ts` 另於 `startArtifact` 的 `metadata` 記錄 `figureReferenceCount`。新增測試：`backend/test/image-prompt-templates.test.ts`（`figureNotes` 注入位置與空值省略行為，2 項）；`backend/test/pdf-figures.test.ts` 新增 `getFigureReferencesForPage`/`buildFigureReferenceNotes` 對真實 PDF（page 26）的驗證，並新增 2 項合成測試（裁切排序、caption/context 後援文案）；新增 `backend/test/figure-reference-image-generation.test.ts`（以 `setOpenAIClientForTest` 模擬 `images.edit`，驗證 `/regenerate-image` 與批次 `regenerate` job 皆會附帶圖表參考圖片陣列與對應提示文字）。並更新設計文件 `docs/pdf-figure-extraction-design.md`：§7 補上兩個新函式、新增 §10「整合至投影片圖片（重新）生成（已完成）」說明整合方式與限制，§9 移除已完成的對應未來工作項目。驗證：新增/修改測試 8/8 通過；`npx tsc --noEmit` 通過；全量測試與既有基準（18 項既有失敗，與本變更無關）一致，無新增失敗。）
[x] 一般文件模式（`pdf_import_mode === 'document'`）AI 分頁與首次生圖時，也需要使用 `extract_figures` 萃取的圖表素材（先前 `feature/figure-reference-image-generation-20260615` 僅整合「重新生成」流程，一般文件模式的 AI 分頁＋首次生圖完全未用到 `figures.json`）。（完成於分支: feature/document-mode-figure-reference-20260615，一般文件模式的 PDF 在 AI 分頁（`splitTextWithLlm` 將原始 PDF 頁面重新拆分／合併為投影片）與首次 LLM 生圖（`renderTextPagesWithLlm`）皆早於 `extract_figures`，且 AI 重新分頁後的投影片頁碼與原始 PDF 頁碼非 1:1，先前 `extract_figures` 對此匯入模式完全略過。本次補上完整串接：(1) 新增 `backend/src/services/pdfPageMarkers.ts`：`formatPdfPageMarker`/`buildTextWithPdfPageMarkers`/`containsPdfPageMarkers`/`stripPdfPageMarkers`，於 `source.txt` 中以 `[[PDF_PAGE_N]]`（1-indexed）標記每頁原文起點，最終內容輸出前一律剝除；`backend/src/worker/poppler.ts` 新增 `extractPdfTextPages()`（逐頁文字），`backend/src/routes/pdfs/upload.ts` 文件模式改用其建立帶標記的 `source.txt`（`pdf_sources.content_text` 仍為未標記純文字）。(2) `backend/src/worker/steps/splitTextWithLlm.ts`：`OutlineSchema` 各投影片新增選填 `source_pages`（int[1..10]），輸入含 `[[PDF_PAGE_N]]` 標記時於系統提示詞要求 LLM 回報；Strategy 2（大綱優先）將其 zip 至 `SplitTextWithLlmResult.pages[i].sourcePdfPages`，最終 `content` 一律經 `stripPdfPageMarkers` 處理。(3) `backend/src/worker/pipeline.ts` 新增 `runExtractFiguresStage()`（包裝既有 `extractPdfFigures`，`startStage`/`finishStage`，非阻斷），於文字匯入分支中提前到 AI 分頁／首次生圖之前執行（`extract_figures` 冪等，原第 2.1 步沿用同一函式不會重算）；新增 `backend/src/services/storage.ts` 的 `splitFigureMapPath()` 與 `backend/src/services/pdfFigures.ts` 的 `loadSplitPageFigureMap`/`saveSplitPageFigureMap`，將「AI 分頁後頁碼 → 原始 PDF 頁碼陣列」的對應持久化為 `split-figure-map.json`（供 pipeline 重入時還原 `sourcePdfPages`）。(4) `backend/src/services/pdfFigures.ts` 新增 `getFigureReferencesForPages(pdfId, pageNumbers, max)`（跨多個原始 PDF 頁面彙整圖表、依 `id` 去重、依面積裁切，抽出共用的 `capFiguresByArea`）；`backend/src/worker/steps/renderTextPagesWithLlm.ts` 的 `pages[]` 新增選填 `sourcePdfPages?: number[]`，每頁依此呼叫 `getFigureReferencesForPages` 取得圖表並以 `buildFigureReferenceNotes` 注入 `buildImagePrompt`，有對應圖表時改用 `client.images.edit({ image: figureRefFiles, ... })`（以 `toFile` 讀取 `figures/*.png`），否則維持原 `client.images.generate(...)`；成功時的 `onPage` metadata 新增 `figureReferenceCount`。新增測試共 12 項：`backend/test/pdf-page-markers.test.ts`（新檔 6 項，marker 格式化/偵測/剝除/還原）、`backend/test/split-text-with-llm.test.ts`（新檔 2 項，大綱策略回報 `source_pages` 並映射至 `sourcePdfPages`、無標記時維持 `undefined`）、`backend/test/pdf-figures.test.ts` 新增 2 項（`getFigureReferencesForPages` 跨頁去重裁切、`split-figure-map.json` 讀寫）、`backend/test/render-text-pages-figure-injection.test.ts`（新檔 2 項，有/無 `sourcePdfPages` 時分別走 `images.edit`/`images.generate`），全數通過。並更新設計文件 `docs/pdf-figure-extraction-design.md`：新增 §11「一般文件模式（`pdf_import_mode === 'document'`）整合（已完成）」，§2.2 對應未來工作項目改為已完成並指向 §11。驗證：`npx tsc --noEmit` 通過；全量測試與既有基準（18 項既有失敗，與本變更無關）一致，無新增失敗。）
[x] 修正一般文件模式 `source_pages` 對應失準的問題：實測 37 頁 PDF（`myGMS0ahnF`）發現大綱 LLM 因 `OUTLINE_MAX_INPUT_CHARS = 16,000` 截斷，只看得到全文前 ~4 頁，導致 11 張 AI 分頁投影片的 `sourcePdfPages` 全部落在第 1~4 頁，24 張萃取圖表中 23 張（含所有有圖說的 Figure 10/13/17/22/23）永遠無法被注入投影片生圖。（完成於分支: feature/outline-max-input-chars-128k-20260615，將 `backend/src/worker/steps/splitTextWithLlm.ts` 的 `OUTLINE_MAX_INPUT_CHARS` 由 `16_000` 提升至 `128_000`，使大綱 LLM 可看到絕大多數 PDF 全文（含 `[[PDF_PAGE_N]]` 標記），對 256K context window 模型仍留有充足的系統提示詞與輸出空間；單純調整常數值，無需改動其他邏輯或測試。驗證：`npx tsc --noEmit` 通過；`backend/test/split-text-with-llm.test.ts` 2/2 通過；全量測試 105/123 通過，18 項既有失敗與基準一致，無新增失敗。）
[x] 查看 `hRUVHXrNqW` 中抽取的圖片，有非常多圖片都沒有被正確的抽取。分析一下 Figure 1-9 看要如何改善（完成於分支: docs/pdf-figure-extraction-v2-vector-design-20260615，比對 `storage/hRUVHXrNqW/figures.json`、抽出的 PNG 與用 `pdftoppm` 重新渲染的 PDF 第 2-9 頁，定位出論文（`2605.29548v2.pdf`，與 `myGMS0ahnF` 同源）Figure 1-9 的抽取現況：Figure 1/3/4/8/9（page 2/5/6/9）完全沒有被抽出；Figure 2（page 4）抽到的 `p4-img_p3_1.png` 是個畫面上看不見、與內容無關的漸層三角形殘留 raster；Figure 5/6（page 7）與 Figure 7（page 8）各抓到 1～2 張子面板但 `caption` 皆為 `null`。根因：matplotlib 對折線/長條圖等資料點少的圖表預設輸出向量路徑，只有資料點極多的散佈圖才會被 rasterize 成 image XObject，而 `extractPdfFigures()` 只追蹤 `OPS.paintImageXObject`，完全不處理向量繪圖 operator；多面板圖的 caption 通常位於整組面板最下方，距離單個子面板 bbox 常超過 `CAPTION_MAX_DISTANCE_PT=40pt`，導致即使抓到 raster 子面板也配不到 caption。在 `docs/pdf-figure-extraction-design.md` 新增 §12「向量圖形萃取（V2 設計，待實作）」：向量區域偵測（追蹤 `OPS.constructPath` 的 bbox 並聚類）、多子圖群組化與 caption anchor 校正、改用 poppler 整頁 render（已驗證 `pdftoppm` 對 page 2/4-9 皆正常，不受 §3.1 pdf.js `page.render()` 的 "Image or Canvas expected" bug 影響）+ sharp 裁切輸出向量區域、過濾被後繪製向量內容完全遮蓋的 raster 殘留影像（如 `p4-img_p3_1.png`），並列出以 `hRUVHXrNqW` 為例的預期效果、待調參風險與建議實作順序；§9 未來工作項目更新為指向 §12。本次僅完成分析與設計文件，未變動程式碼；已於下方新增對應的待辦實作項目。）
[x] 依 `docs/pdf-figure-extraction-design.md` §12 的 V2 設計，實作向量圖形萃取：偵測純向量繪圖區域（追蹤 `OPS.constructPath` 並聚類）、多子圖群組化與 caption 比對、改用 poppler 整頁 render + sharp 裁切輸出向量圖表、過濾被向量內容完全遮蓋的 raster 殘留影像，讓 `hRUVHXrNqW`（`2605.29548v2.pdf`）的 Figure 1-9 等純向量/混合圖表能被正確抽取並配對到 caption。（完成於分支: feature/vector-figure-extraction-v2-20260615，於既有 CTM 追蹤迴圈中新增向量路徑偵測：對 `OPS.constructPath` 累積 bbox（排除文字 operator），以 union-find 聚類（`VECTOR_FIGURE_MIN_PATHS=20`、`VECTOR_CLUSTER_PAD_PT=5`），再依 bbox 列/相鄰關係（`GROUP_X_GAP_RATIO=0.2`）將多面板圖分組；放寬 `CAPTION_RE` 為 `/(Fig(?:ure)?\.?|Table|圖表?|表)\s*\.?\s*\d+\s*[:：]/i`（在整行任意位置搜尋並要求結尾冒號），使「(a) (b)Figure 2: ...」這類與子圖標記同行的 caption 也能比對成功。影像輸出改用 pdf.js（非原規劃的 poppler `pdftoppm`）：修正 `backend/src/worker/poppler.ts` 的 `NodeCanvasFactory`（`create`/`reset`/`destroy` 皆透過 `canvas` 套件的 `createCanvas()`，解決 pdf.js 內建 Node canvas factory 用 `@napi-rs/canvas` 與本專案 `canvas`（node-canvas）不相容造成的 "Image or Canvas expected" 錯誤），新增 `renderPageToPng()` 整頁渲染後以 `cropPagePng()` 依 bbox 裁切向量群組，輸出檔名 `p<pageNumber>-vec<index>.png`，新增 `FigureEntry.source?: 'raster'|'vector'`。新增 raster/vector 合併規則：IoU > `RASTER_VECTOR_IOU_MERGE_THRESHOLD=0.5` 或 containment > `RASTER_VECTOR_CONTAINMENT_MERGE_THRESHOLD=0.9` 時合併為單一 vector 輸出。被遮蓋 raster 殘留影像過濾改為兩階段：先以 opIndex+bbox overlap > `OCCLUDED_RASTER_OVERLAP_THRESHOLD=0.5` 篩出候選，再以 `computeOcclusionDiff()` 像素差異 > `OCCLUDED_RASTER_DIFF_THRESHOLD=60` 確認後排除（取代原規劃的純 bbox 覆蓋率判斷）。`FIGURE_RENDER_DPI=150`。驗證結果：`hRUVHXrNqW`（37 頁）總計正確抽取 23 張圖（Figure 1-23 全部配對到正確 caption），其中 Figure 1-9（page 2/4-9）皆為 `source: 'vector'`，page 7/9 的多面板圖各拆成 2 個獨立 `FigureEntry`（Figure 5+6、Figure 8+9），原本誤判為圖 2 的殘留 raster `p4-img_p3_1.png` 已被遮蓋過濾排除；37 頁整頁渲染僅耗時約 11 秒，遠低於 120 秒 SLA。擴充 `backend/test/pdf-figures.test.ts`（新增 Figure 1-9 共 7 項 vector 斷言＋figureCount=23 全文件斷言），`npx tsc --noEmit` 通過，全量測試結果與既有基準一致（18 項既有失敗皆與本變更無關，無新增失敗）。已知限制：page 7/9 的 `p7-vec1`/`p9-vec1` 因群組 bbox 被 4 個與整體 bbox 完全相同的「外框/背景」矩形路徑撐大，裁切結果有多餘留白（內容與 caption 仍正確），詳見設計文件 §12.10。同步更新設計文件 `docs/pdf-figure-extraction-design.md` §2.2/§3.1/§9/§12（含新增 §12.10「已知限制」），標記為「已完成」。已 commit 至分支 `feature/vector-figure-extraction-v2-20260615`（commit 74531d3）。）

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

- 時間: 2026-06-12 20:49:00 +0800
- 分支: feature/todo-no-pending-recheck-20260612-2049
- 內容: 重新確認 master 中 TODO.md，未發現行首未完成核取項目（`^[ ]`），working tree 亦無未提交變更。本次以獨立分支保存複查記錄（docs/todo-rechecks/2026-06-12-2049.md），並回到 master 更新工作記錄。

- 時間: 2026-06-12 20:54:00 +0800
- 分支: feature/todo-no-pending-recheck-20260612-2054
- 內容: 重新確認 master 中 TODO.md，未發現行首未完成核取項目（`^[ ]`），working tree 亦無未提交變更。本次以獨立分支保存複查記錄（docs/todo-rechecks/2026-06-12-2054.md），並回到 master 更新工作記錄。

- 時間: 2026-06-12 20:58:00 +0800
- 分支: feature/todo-no-pending-recheck-20260612-2058
- 內容: 重新確認 master 中 TODO.md，未發現行首未完成核取項目（`^[ ]`），working tree 亦無未提交變更。本次以獨立分支保存複查記錄（docs/todo-rechecks/2026-06-12-2058.md），並回到 master 更新工作記錄。

- 時間: 2026-06-12 21:03:00 +0800
- 分支: feature/todo-no-pending-recheck-20260612-2103
- 內容: 重新確認 master 中 TODO.md，未發現行首未完成核取項目（`^[ ]`），working tree 亦無未提交變更。本次以獨立分支保存複查記錄（docs/todo-rechecks/2026-06-12-2103.md），並回到 master 更新工作記錄。

- 時間: 2026-06-12 21:08:00 +0800
- 分支: feature/todo-no-pending-recheck-20260612-2108
- 內容: 重新確認 master 中 TODO.md，未發現行首未完成核取項目（`^[ ]`），working tree 亦無未提交變更。本次以獨立分支保存複查記錄（docs/todo-rechecks/2026-06-12-2108.md），並回到 master 更新工作記錄。

- 時間: 2026-06-12 21:12:00 +0800
- 分支: feature/todo-no-pending-recheck-20260612-2112
- 內容: 重新確認 master 中 TODO.md，未發現行首未完成核取項目（`^[ ]`），working tree 亦無未提交變更。本次以獨立分支保存複查記錄（docs/todo-rechecks/2026-06-12-2112.md），並回到 master 更新工作記錄。

- 時間: 2026-06-12 21:18:00 +0800
- 分支: feature/todo-no-pending-recheck-20260612-2118
- 內容: 重新確認 master 中 TODO.md，未發現行首未完成核取項目（`^[ ]`），working tree 亦無未提交變更。本次以獨立分支保存複查記錄（docs/todo-rechecks/2026-06-12-2118.md），並回到 master 更新工作記錄。

- 時間: 2026-06-12 21:22:00 +0800
- 分支: feature/todo-no-pending-recheck-20260612-2122
- 內容: 重新確認 master 中 TODO.md，未發現行首未完成核取項目（`^[ ]`），working tree 亦無未提交變更。本次以獨立分支保存複查記錄（docs/todo-rechecks/2026-06-12-2122.md），並回到 master 更新工作記錄。

- 時間: 2026-06-12 21:27:00 +0800
- 分支: feature/todo-no-pending-recheck-20260612-2127
- 內容: 重新確認 master 中 TODO.md，未發現行首未完成核取項目（`^[ ]`），working tree 亦無未提交變更。本次以獨立分支保存複查記錄（docs/todo-rechecks/2026-06-12-2127.md），並回到 master 更新工作記錄。

- 時間: 2026-06-12 21:32:00 +0800
- 分支: feature/todo-no-pending-recheck-20260612-2132
- 內容: 重新確認 master 中 TODO.md，未發現行首未完成核取項目（`^[ ]`），working tree 亦無未提交變更。本次以獨立分支保存複查記錄（docs/todo-rechecks/2026-06-12-2132.md），並回到 master 更新工作記錄。

- 時間: 2026-06-12 21:37:00 +0800
- 分支: feature/todo-no-pending-recheck-20260612-2137
- 內容: 重新確認 master 中 TODO.md，未發現行首未完成核取項目（`^[ ]`），working tree 亦無未提交變更。本次以獨立分支保存複查記錄（docs/todo-rechecks/2026-06-12-2137.md），並回到 master 更新工作記錄。

- 時間: 2026-06-12 21:41:00 +0800
- 分支: feature/todo-no-pending-recheck-20260612-2141
- 內容: 重新確認 master 中 TODO.md，未發現行首未完成核取項目（`^[ ]`），working tree 亦無未提交變更。本次以獨立分支保存複查記錄（docs/todo-rechecks/2026-06-12-2141.md），並回到 master 更新工作記錄。

- 時間: 2026-06-12 21:46:00 +0800
- 分支: feature/todo-no-pending-recheck-20260612-2146
- 內容: 重新確認 master 中 TODO.md，未發現行首未完成核取項目（`^[ ]`），working tree 亦無未提交變更。本次以獨立分支保存複查記錄（docs/todo-rechecks/2026-06-12-2146.md），並回到 master 更新工作記錄。

- 時間: 2026-06-12 21:51:00 +0800
- 分支: feature/todo-no-pending-recheck-20260612-2151
- 內容: 重新確認 master 中 TODO.md，未發現行首未完成核取項目（`^[ ]`），working tree 亦無未提交變更。本次以獨立分支保存複查記錄（docs/todo-rechecks/2026-06-12-2151.md），並回到 master 更新工作記錄。

- 時間: 2026-06-12 21:55:00 +0800
- 分支: feature/todo-no-pending-recheck-20260612-2155
- 內容: 重新確認 master 中 TODO.md，未發現行首未完成核取項目（`^[ ]`），working tree 亦無未提交變更。本次以獨立分支保存複查記錄（docs/todo-rechecks/2026-06-12-2155.md），並回到 master 更新工作記錄。

- 時間: 2026-06-12 22:01:00 +0800
- 分支: feature/todo-no-pending-recheck-20260612-2201
- 內容: 重新確認 master 中 TODO.md，未發現行首未完成核取項目（`^[ ]`），working tree 亦無未提交變更。本次以獨立分支保存複查記錄（docs/todo-rechecks/2026-06-12-2201.md），並回到 master 更新工作記錄。

- 時間: 2026-06-12 22:02:00 +0800
- 分支: feature/todo-no-pending-recheck-20260612-2202
- 內容: 重新確認 master 中 TODO.md，未發現行首未完成核取項目（`^[ ]`），working tree 亦無未提交變更。本次以獨立分支保存複查記錄（docs/todo-rechecks/2026-06-12-2202.md）。原預計使用分支名稱 -2205（對應排程的 22:05 喚醒），但發現該名稱已存在且為較早批次複查紀錄的一部分（已是 master 祖先），故改用 -2202 避免分支名稱衝突。

- 時間: 2026-06-12 23:10:00 +0800
- 分支: feature/custom-script-streaming-24k-20260612
- 內容: 完成「在AI自訂動畫編輯器中允許至多 24K 的輸出。並且改用 streaming 模式，在輸出時顯示結果。如果錯誤要在 UI 上顯示錯誤訊息」。提高輸出上限：`MAX_CUSTOM_SCRIPT_CODE_LENGTH` 由 8000 提升至 24000（`backend/src/services/pageAnimation.ts` 與 `frontend/src/lib/animationSpec.ts` 同步），並新增 `MAX_CUSTOM_SCRIPT_OUTPUT_TOKENS = 24000` 作為 LLM `maxTokens`。改為 streaming：`backend/src/services/openai.ts` 新增 `streamChatText()`（OpenAI `stream: true` + `stream_options: { include_usage: true }`，逐 chunk 透過 `onDelta` 回呼並沿用既有 LLM request/response log），`backend/src/services/gemini.ts` 新增 `callGeminiText()` 作為 Gemini 的非串流 fallback（整段回應視為單一 delta，因現有 Gemini REST 整合不支援 token 級串流）。`backend/src/services/animationCustomScript.ts` 移除 JSON-mode（`CustomScriptAiResponseSchema`），改為要求 LLM 直接輸出原始 JavaScript（系統提示詞要求不加 ``` 等 markdown 圍欄，並新增 `stripCodeFences` 防禦性處理誤加的圍欄），`generateCustomScriptCodeStream()` 取代原 `generateCustomScriptCode()`。`backend/src/routes/pdfs/page-animation.ts` 的 `POST /api/pdfs/:id/pages/:n/animation/custom-script` 改為以 `reply.hijack()` + `text/event-stream` 串流回應，依序送出多個 `event: delta`（`{text}`，逐段輸出片段）後接一個 `event: done`（`{code}`，已通過 `findUnsafeScriptPattern`/`findCustomScriptContractIssue`/長度檢查的最終程式碼）或 `event: error`（`{code,message}`，對應 `UNSAFE_SCRIPT`/`INVALID_SCRIPT_CONTRACT`/`SCRIPT_TOO_LONG`/`INTERNAL_ERROR`）。前端 `generateCustomScriptCode()`（`frontend/src/lib/api/pdfs.ts`）改用 `fetch` + `resp.body.getReader()` 解析 SSE，新增 `onDelta` callback 參數，串流中的 `error` 事件轉為 `ApiError` 拋出。`usePageAnimation.ts` 新增狀態 `customScriptStreamingCode: Record<string, string>`（依 effect id 即時累積串流文字，產生成功後移除、改由 `effect.code` 提供內容，失敗則保留供使用者對照錯誤），`PlayPageContext.tsx` 的 `PlayPageContextValue` 同步擴充介面（透過既有 `...animationState` spread 自動串接）。`AnimationEditorTab.tsx` 的 JavaScript 原始碼編輯器於產生中即時顯示 `customScriptStreamingCode`（`customScriptSourceValue`），所有失敗情境（網路錯誤、`UNSAFE_SCRIPT`、`INVALID_SCRIPT_CONTRACT`、`SCRIPT_TOO_LONG`、空輸出、串流中斷無 `done`）皆顯示於既有 `animationError` UI。並更新設計文件 `docs/animation-slide-v1-design.md`（§5.4/§7.5/§8，記錄 24000 字上限、SSE 事件格式與串流顯示/錯誤處理行為）。驗證：後端改寫 5 項 custom-script 相關測試（含新增 `streamingChatClient`/`parseSseEvents` 測試輔助函式），`npx tsx --test test/page-animation.test.ts` 50/50 通過；前端改寫 `frontend/src/lib/api.regenerate-pageops.test.ts` 的 `generateCustomScriptCode` 測試（新增 `sseStream` 輔助函式）並新增 1 項 `error` 事件測試，`npx tsx --test src/lib/*.test.ts` 35/35 通過；前後端 `npx tsc --noEmit` 與前端 `npx vite build` 皆通過。

- 時間: 2026-06-13 00:05:00 +0800
- 分支: feature/gemini-custom-script-streaming-20260612
- 內容: 修復「請即時更新目前已收到的 script 到 UI 上」回報的「custom-script 串流顯示有問題」。透過 `backend/tmp-sse-check.ts`（一次性診斷腳本，已於完成後刪除）以真實 TCP 連線驗證 OpenAI provider 下 SSE `event: delta` 確實逐段（約 300ms 間隔）送達，排除後端緩衝/網路問題；再檢視 `streamChatText()`（`backend/src/services/openai.ts`）發現 `LLM_PROVIDER=gemini` 時舊版 `callGeminiText()` 採非串流 `generateContent`，整段文字在 LLM 回應全部完成後才一次性呼叫 `onDelta`，導致 Gemini provider 下自訂腳本編輯器在產生期間毫無變化、結束時才整段跳出。修正：`backend/src/services/gemini.ts` 將 `callGeminiText()` 改為 `callGeminiTextStream()`，改打 Gemini `streamGenerateContent?alt=sse` 端點，以 `resp.body.getReader()` 逐行解析 `data: {...}` SSE chunk、逐段呼叫 `onDelta`；`streamChatText()` 改呼叫此新函式並直接轉發 `onDelta`（移除原本「整段完成後單次呼叫」的處理）。新增後端測試：`backend/test/page-animation.test.ts` 新增 `geminiSseStream()` 輔助函式與測試「POST animation/custom-script streams Gemini-generated code incrementally when LLM_PROVIDER=gemini」，以 mock `globalThis.fetch` 模擬 Gemini SSE 回應，驗證 `delta` 事件數 > 1 且依序串接後等於完整程式碼、最終 `done` 事件帶正確 `code`。驗證：`npx tsx --test test/page-animation.test.ts` 51/51 通過（含新測試）；`npx tsc --noEmit` 通過；以 `--test "test/**/*.test.ts" "src/**/*.test.ts"` 執行全量測試確認剩餘 18 項失敗為既有（master 上同樣失敗，與本次變更無關）的 input-security/pdf-pages 等測試。 

- 時間: 2026-06-13 00:42:00 +0800
- 分支: feature/animation-page-duration-extend-20260613
- 內容: 完成「如果動畫的時間比語音還長，自動把頁面延長」。`frontend/src/lib/animationSpec.ts` 新增 `animationTimelineDurationSeconds(spec)` 計算整段動畫 timeline 的總長（各效果 `start + duration + (exitDuration ?? 0)` 的最大值，未啟用動畫或無效果回傳 0）。`PlayPage.tsx`：以 `useMemo` 由 `currentAnimationSpec` 算出 `animationDurationSeconds`，並透過 `animationDurationSecondsRef` 同步給較早宣告的 `handleEnded`（避免 TDZ）；原 `handleEnded` 的切頁／結束邏輯抽成 `runPageEndedAdvance()`，語音 `ended` 時若動畫總長超過語音長度（差值 > 0.05 秒，依目前 `playbackRate` 換算實際毫秒），先設定 `isExtendingAnimation = true` 並以 `setTimeout` 延後呼叫 `runPageEndedAdvance()`；延長期間透過新增的 context 值 `slideAnimationPlaying`（= `isPlaying || isExtendingAnimation`，取代 `PlayPageSlidePanel.tsx`/`PlayPageFullscreen.tsx` 三處 `SlideRenderer` 的 `isPlaying` prop）讓 GSAP timeline 繼續播完整段動畫；新增 `clearPendingPageExtend()`，於 `goPrev`/`goNext`/`handleSeek`/延長期間按下播放鍵時取消延長計時器。`PlayPageContext.tsx` 新增 `isExtendingAnimation`/`slideAnimationPlaying` 欄位。驗證：`frontend/src/lib/animationSpec.test.ts` 新增 4 項測試，`npx tsx --test src/lib/animationSpec.test.ts` 20/20 通過；`npx tsc --noEmit` 通過。

- 時間: 2026-06-13 01:05:00 +0800
- 分支: feature/animation-extend-custom-script-sync-fix-20260613
- 內容: 修復使用者回報「只有淡入效果還有跑，但效果的動畫停了」。這是上一筆「動畫延長頁面顯示」功能的後續 bug：延長期間 GSAP timeline 透過 `tl.play()` 持續播放，overlay 的 `autoAlpha` 淡入/淡出 tween 因此正常進行；但 `useGsapSlideTimeline.ts` 中負責把目前播放時間同步給 `custom-script` 效果 sandboxed iframe 的 `postMessage({type:'sync', t, playing})` effect 依賴 `currentTime`（prop，源自 `PlayPage.tsx` 的 `currentTime` state），而語音 `ended` 後 `audio` 不再觸發 `timeupdate`，`currentTime` 凍結在 `duration`，導致該 effect 不再以新的 `t` 重新觸發，custom-script 內部動畫因而停住。修正：`PlayPage.tsx` 的 `handleEnded` 在進入延長狀態時，改用 `window.setInterval`（新增常數 `PAGE_EXTEND_TICK_MS = 250`，對齊音訊 `timeupdate` ~4 次/秒的頻率）以 `performance.now()` 量測經過時間（依目前 `playbackRate` 換算）持續呼叫 `setCurrentTime`，從 `duration` 推進到 `animationDurationSecondsRef.current`；到達後才呼叫 `runPageEndedAdvance()`。`clearPendingPageExtend()` 對應改用 `window.clearInterval`。`PlayPageSlidePanel.tsx` 的時間顯示改為 `formatTime(Math.min(currentTime, duration))`，避免延長期間 `currentTime` 超過 `duration` 時顯示異常（進度條原本即用 `Math.min(1, currentTime/duration)` 已無此問題）。驗證：`npx tsc --noEmit` 通過；`frontend/src/lib/animationSpec.test.ts`（不受影響）`npx tsx --test src/lib/animationSpec.test.ts` 20/20 通過。

- 時間: 2026-06-13 01:30:00 +0800
- 分支: feature/custom-script-fullslide-default-20260613
- 內容: 完成「自訂動畫要放在 (0,0) 的地方開始到 (100,100)」。`frontend/src/lib/animationSpec.ts` 的 `getFocusEffectParams(effect)` 新增 `DEFAULT_CUSTOM_SCRIPT_PARAMS = { xPct: 0, yPct: 0, widthPct: 100, heightPct: 100 }`，當 `effect.type === 'custom-script'` 時改用此預設值，取代原本與 `highlight-box`/`spotlight`/`text-callout` 共用的 `DEFAULT_FOCUS_PARAMS = { xPct: 30, yPct: 30, widthPct: 40, heightPct: 40 }`；`effect.params` 中已明確設定的欄位仍優先採用，不受影響。由於 `AnimationEditorTab.tsx` 的效果列原本就不顯示 custom-script 的 X/Y/W/H 欄位（使用者無法調整，完全依賴此預設值），此變更讓 `EffectOverlay`（`SlideRenderer.tsx`）渲染的 sandboxed iframe 預設鋪滿整張投影片；`MANIM_HELPER_SCRIPT` 內部的繪圖座標系統（center origin、x∈[-7,7]、y∈[-4,4]）不受影響、不需修改。並更新設計文件 `docs/animation-slide-v1-design.md` §5.4 說明 custom-script 預設值與其他焦點效果的 30/30/40/40 不同。驗證：`frontend/src/lib/animationSpec.test.ts` 新增 3 項測試（custom-script 預設鋪滿整張投影片、其他效果維持 30/30/40/40、custom-script 明確 params 優先於預設值），`npx tsx --test src/lib/animationSpec.test.ts` 23/23 通過；`npx tsc --noEmit` 通過。

- 時間: 2026-06-13 02:00:00 +0800
- 分支: feature/custom-script-no-fade-in-20260613
- 內容: 完成「自訂動畫不要有淡入的效果」。`frontend/src/components/slide/buildGsapTimeline.ts` 的 `OVERLAY_EFFECT_TYPES` switch 區塊中，`custom-script` 不再套用 `tl.fromTo(overlay, {autoAlpha:0}, {autoAlpha:1, ...common}, effect.start)` 的 0→1 淡入過渡，改為 `tl.set(overlay, { autoAlpha: 1 }, effect.start)`，於 `effect.start` 時直接將 sandboxed iframe 設為完全可見，讓自訂動畫從一開始即可見、由其內部腳本自行控制畫面呈現；`highlight-box`/`spotlight`/`text-callout` 仍維持原本的淡入行為不變，`exitDuration` 淡出機制（若設定）對 custom-script 仍照舊在 `start + duration + exitDuration` 套用，不受影響。同步更新 `useGsapSlideTimeline.ts`/`animationSpec.ts` 中「自此效果淡入開始起算的秒數」相關註解為「自 effect.start 起算的秒數」，避免文件與實際行為不一致；並更新設計文件 `docs/animation-slide-v1-design.md`（§5 效果定義表格、§5.4 播放同步說明）。驗證：`frontend/src/lib/animationSpec.test.ts`（不受影響）`npx tsx --test src/lib/animationSpec.test.ts` 23/23 通過；`npx tsc --noEmit` 通過。

- 時間: 2026-06-13 03:40:00 +0800
- 分支: feature/custom-script-conversation-20260613
- 內容: 完成「將自訂動畫編輯器改成一個多輪對話，讓動畫可以逐步修改」。後端 `pageAnimation.ts` 新增 `ConversationMessage`/`ConversationMessageSchema` 與常數 `MAX_CUSTOM_SCRIPT_CONVERSATION_MESSAGES = 40`/`MAX_CUSTOM_SCRIPT_CONVERSATION_MESSAGE_LENGTH = 500`，`AnimationEffect`/`EffectSchema`/`validateAnimationSpec` 支援選填 `conversation: ConversationMessage[]`；`animationCustomScript.ts` 的 `generateCustomScriptCodeStream()` 新增 `history?: ConversationMessage[]` 參數，透過新增的 `toChatCompletionMessage()` 轉換型別後插入 `messages = [system, ...history, finalUserPrompt]`；`page-animation.ts` 路由的 `CustomScriptAiBodySchema` 新增對應 `history` 欄位並轉發。前端 `types.ts`/`animationSpec.ts` 同步新增 `ChatMessage`/`conversation` 欄位與上述常數，`cloneAnimationSpec` 深拷貝 `conversation`，新增 `appendConversationMessages()`（截斷單則訊息長度並捨棄超出上限的最舊訊息）；`lib/api/pdfs.ts` 的 `generateCustomScriptCode` 新增 `history` 參數。`usePageAnimation.ts` 將原本的 `handleGenerateCustomScriptCode` 重新設計為 `handleSendCustomScriptMessage(effectId, message)`：送出前以 `appendConversationMessages` 樂觀加入使用者訊息，呼叫 API 時帶入 `previousCode: effect.code`、`history: effect.conversation`，成功時更新 `code` 並於 `conversation` 追加完成訊息（`customScriptDone`），失敗時依錯誤碼（`UNSAFE_SCRIPT`/`INVALID_SCRIPT_CONTRACT`/其他）追加對應錯誤訊息。`AnimationEditorTab.tsx` 將原提示詞輸入框＋產生/重新產生按鈕改為聊天介面：可捲動訊息清單（使用者訊息靠右、AI 訊息靠左，含忙碌泡泡與自動捲動）＋多行輸入框（Enter 送出/Shift+Enter 換行）＋送出鍵；JS 原始碼編輯器與 `CustomScriptPreview` 維持不變。新增/更新中英文 i18n 鍵（`customScriptChatInputPlaceholder`/`customScriptChatEmpty`/`customScriptChatSend`，移除舊版 `customScriptPrompt*`/`customScriptGenerate`/`customScriptRegenerate`，更新 `customScriptEmpty` 文案）。並更新設計文件 `docs/animation-slide-v1-design.md`（§5.4 資料模型與 AI 產生/迭代說明、§7.5 編輯器 UI、§13 hardening checklist 與手動 QA 步驟）。驗證：後端新增 7 項測試（`conversation` schema 驗證/上限、`history` 驗證、`POST .../custom-script` 正確將 `history` 轉為 LLM 對話訊息），`npx tsx --test test/page-animation.test.ts` 57/57 通過；前端新增 6 項測試（`cloneAnimationSpec` 深拷貝 `conversation`、`appendConversationMessages` 截斷/上限行為），`npx tsx --test src/lib/animationSpec.test.ts` 28/28 通過；前後端 `npx tsc --noEmit` 與前端 `npx vite build` 皆通過。

- 時間: 2026-06-13 04:10:00 +0800
- 分支: feature/custom-script-layout-swap-20260613
- 內容: 完成「將自訂動畫對話框移到右側並佔滿整個右側，預覽移到左側」。`frontend/src/pages/play/AnimationEditorTab.tsx` 自訂動畫對話框內的 `lg:grid-cols-2` 兩欄重新排列：左欄改為「預覽（`CustomScriptPreview` 或 `customScriptEmpty` 空狀態）＋ JS 原始碼編輯器（`customScriptSource` textarea，以 `flex-1` 佔用左欄剩餘高度）」；右欄改為「對話訊息清單（`customScriptConversation`，`flex-1` 佔滿右欄高度並可捲動）＋輸入框與送出鍵」。僅調整 JSX 區塊順序與容器 class（`flex flex-col`/`flex-1`/`min-h-0` 等），未變更任何資料流、狀態或事件處理邏輯（`handleSendCustomScriptMessage`、`updateEffect`、自動捲動 effect 等皆不變）。驗證：`npx tsc --noEmit` 通過；`npx vite build` 成功（605.38 kB，與既有 chunk-size 警告一致，無新增警告或錯誤）。

- 時間: 2026-06-13 05:15:00 +0800
- 分支: feature/custom-script-two-step-plan-20260613
- 內容: 完成「在AI自定義動畫編輯器中，改成二步驟進行。先將使用者的提示詞轉換成一個詳細步驟，顯示在對話框中。然後再根據這些步驟產生程式，並把每一個步驟寫在程式中做為註解。方便必要時手工調整」。後端 `backend/src/services/animationCustomScript.ts` 新增 `buildCustomScriptPlanSystemPrompt()` 與 `generateCustomScriptPlanStream()`：先請 LLM 依使用者提示詞（與既有 OCR/`previousCode`/`history` 脈絡）產生一份條列「實作步驟」純文字；`buildCustomScriptSystemPrompt()`/`buildCustomScriptUserPrompt()` 新增 `plan?` 參數，於系統提示詞加入「【實作步驟】」區段並要求 `generateCustomScriptCodeStream()` 在程式碼對應位置加上 `// 步驟 N：...` 單行註解。`backend/src/routes/pdfs/page-animation.ts` 的 `POST /api/pdfs/:id/pages/:n/animation/custom-script` 改為兩階段 SSE：先送出 `plan-delta`*（步驟文字片段）與 `plan-done`（完整步驟），再送出既有的 `delta`*/`done`/`error`；任一階段失敗即送出 `error` 並結束。`backend/src/services/pageAnimation.ts` 新增 `MAX_CUSTOM_SCRIPT_PLAN_OUTPUT_TOKENS = 1200`，並將 `MAX_CUSTOM_SCRIPT_CONVERSATION_MESSAGE_LENGTH` 由 500 提升至 2000（容納完整步驟清單），`frontend/src/lib/animationSpec.ts` 同步更新。前端 `frontend/src/lib/api/pdfs.ts` 的 `generateCustomScriptCode` 改為 `GenerateCustomScriptCodeCallbacks`（`onPlanDelta`/`onPlanDone`/`onDelta`），回傳值改為 `{ code, plan }`。`frontend/src/pages/play/usePageAnimation.ts` 新增串流狀態 `customScriptStreamingPlan: Record<string, string>`：`onPlanDelta` 即時累積步驟文字；`onPlanDone` 清除該串流並（若非空白）以 `${t('play.animation.customScriptPlanLabel')}\n${plan}` 前綴併入 `effect.conversation`（透過既有 `appendConversationMessages`）；`onDelta` 沿用既有 `customScriptStreamingCode`；錯誤時透過新增的 `clearStreamingPlan()` 一併清除步驟串流。`PlayPageContext.tsx` 的 `PlayPageContextValue` 新增 `customScriptStreamingPlan` 欄位（透過既有 `...animationState` spread 自動串接）。`AnimationEditorTab.tsx` 新增 `customScriptPlanStreaming` 衍生變數，於規劃階段顯示即時步驟泡泡（空字串時顯示 `customScriptPlanBusy`「AI 規劃實作步驟中…」），完成後切換為原有的程式碼產生忙碌泡泡（`customScriptGenerateBusy`）。新增中英文 i18n 鍵 `play.animation.customScriptPlanBusy`/`play.animation.customScriptPlanLabel`（`zh-TW.ts`/`en.ts`）。並更新設計文件 `docs/animation-slide-v1-design.md`（§5.4 資料模型與兩階段 AI 流程說明、§7.5 編輯器 UI、§8 API 摘要的 SSE 事件順序、§13 hardening checklist）。驗證：後端新增 2 項測試（`twoPhaseStreamingChatClient` 輔助函式：步驟串流與 `plan-done`、步驟階段失敗時送出 `error` 並不進入程式碼產生），`npx tsx --test test/page-animation.test.ts` 59/59 通過；前端改寫 `frontend/src/lib/api.regenerate-pageops.test.ts` 的 `generateCustomScriptCode` 測試以涵蓋 `plan-delta`/`plan-done` 事件與 `result.plan`，`npx tsx --test src/lib/animationSpec.test.ts src/lib/api.regenerate-pageops.test.ts src/lib/api.error-mapping.test.ts src/lib/manimHelperScript.test.ts` 46/46 通過；前後端 `npx tsc --noEmit` 皆通過。受限於此環境無瀏覽器自動化工具，未進行實機 UI 操作測試（規劃階段對話泡泡、步驟併入對話紀錄、程式碼註解等視覺行為僅以型別檢查與單元測試驗證）。

- 時間: 2026-06-15 02:00:00 +0800
- 分支: feature/pdf-figure-extraction-20260615
- 內容: 完成「從 PDF 中產生大綱的過程中，除了 PDF 文字外，有時需要從其中取得圖片，規劃並實作一套方法從 PDF 中取得所有圖表（圖片本身與相關文字資訊，如標題或說明摘要），供後續產生圖片時使用」。本次採兩階段流程：先撰寫設計文件 `docs/pdf-figure-extraction-design.md`（背景與動機、目標與範圍、技術調查結果、資料模型、萃取演算法、pipeline 整合、API 摘要、測試計畫、未來工作），再依此實作。技術調查發現此環境中 pdf.js 的 `page.render()` 對任何含 `paintImageXObject`/`paintInlineImageXObject` 的頁面皆會丟出 "Image or Canvas expected"（已在真實 PDF `storage/jBaLIg8vMa/source.pdf` 上重現），因此放棄「整頁渲染後裁切」做法，改採 `getOperatorList()` 追蹤 CTM（自索引 1、單位矩陣開始，索引 0 為 pdf.js 內建的視窗翻轉變換）計算每個 `paintImageXObject` 在頁面座標系中的 bbox，並依 `page.view`（mediabox）換算為百分比座標（`yPct` 以頂部為原點）；以 `FIGURE_MIN_AREA_PCT=1`/`FIGURE_MAX_AREA_PCT=95` 過濾掉 icon/logo 與整頁背景圖。圖片資料改用 `page.objs.get(id, callback)` 直接取得 pdf.js 已解碼的像素緩衝區（`RGBA_32BPP`/`RGB_24BPP`/`GRAYSCALE_1BPP`，1bpp 需手動位元展開），完全繞過壞掉的 `page.render()` 路徑，再以 sharp 依 `kind` 對應的 channel 數轉存為 PNG（沿用 `poppler.ts` 既有的刪除 `globalThis.createImageBitmap`/`ImageDecoder` workaround）。標題/說明文字比對：以 `getTextContent()` 依 `item.transform[5]`（y 座標）與 `hasEOL` 將文字分行，用正規表示式 `/^(Fig(?:ure)?\.?|Table|圖表?|表)\s*\.?\s*\d+/i` 找出圖表標題行，並在圖片 bbox 上下 `CAPTION_MAX_DISTANCE_PT=40` 點範圍內（優先下方）比對，連同相鄰 `CAPTION_CONTEXT_LINES=2` 行組成 context 摘要。\n\n實作檔案：新增 `backend/src/worker/steps/extractPdfFigures.ts`（主要萃取邏輯，匯出 `extractPdfFigures(pdfId, pageCount)`，含 idempotency 檢查——`figures.json` 已存在則直接回傳快取結果，每張圖片的萃取個別包在 try/catch 中、失敗不影響其他圖片）；新增 `backend/src/services/pdfFigures.ts`（`loadFigureManifest`/`getPageFigures`/`figureImageAbsPath`，供後續產生圖片流程取用萃取結果）；`backend/src/services/storage.ts` 新增 `figuresDir`/`figureManifestPath`/`figureFilePath`。Pipeline 整合：`backend/src/types.ts` 的 `PipelineStage` 新增 `'extract_figures'`（置於 `extract_text` 之後）；`backend/src/services/timing.ts` 的 `TIMING_EVENT_VALUES.stages`/`SLA_TARGETS_MS.stages` 同步新增（SLA 120 秒）；`backend/src/worker/pipeline.ts` 在 `extract_text` 完成後新增「Step 2.1」，僅當 `source_type === 'pdf'` 且非文字匯入（無 `source.txt`）時執行 `extractPdfFigures()`，以 `startStage`/`finishStage` 記錄階段，失敗僅記錄警告與 `failed` 狀態、不拋出例外，不阻斷後續腳本/語音產生。文件更新：`docs/pipeline-stage-and-page-timing.md` 的 §5.2 stage 列表新增 `extract_figures` 一列、§7.1 SLA 範例新增對應項目；`backend/test/timing.test.ts` 的 schema stages 期望陣列同步新增 `extract_figures`。新增 `backend/test/pdf-figures.test.ts`：以真實 PDF fixture `storage/jBaLIg8vMa/source.pdf`（37 頁）驗證能萃取出第 26 頁的圖表（含與「Figure 10」標題/內文比對成功、PNG 檔案確實寫入、面積百分比 >5%）、第 1-3 頁無符合條件的圖（logo 被面積過濾、純文字頁無圖），以及二次呼叫的冪等性；另一測試驗證 `loadFigureManifest`/`getPageFigures` 對不存在的 pdfId 回傳 `null`/`[]`。驗證：`npx tsc --noEmit` 通過；以 `../scripts/with-node-env.sh npx tsx --test ./test/*.test.ts` 執行全量測試，87/105 通過（18 項失敗與 master 基準完全一致，皆為既有 auth/multipart/page-ops/regenerate 等與本功能無關的測試，無新增失敗），新增的 `pdf-figures.test.ts` 2/2 通過；測試產生的 `storage/jBaLIg8vMa/figures.json`、`storage/jBaLIg8vMa/figures/` 已在測試 `finally` 區塊中清理。已 commit 至分支 `feature/pdf-figure-extraction-20260615`（commit fd81e2c，10 files changed, 791 insertions）。

- 時間: 2026-06-15 03:37:20 +0800
- 分支: feature/figure-reference-image-generation-20260615
- 內容: 完成「完成在產生簡報圖形的整合，讓圖形可以使用這裡產生的圖片」。承接前一項 `feature/pdf-figure-extraction-20260615` 的 `figures.json` 萃取結果，依設計文件 `docs/pdf-figure-extraction-design.md` §9 的規劃，將其整合進投影片圖片的「AI 重新生成」流程，讓 LLM 重繪投影片時可參考原始 PDF 圖表與圖說。架構盤點：簡報初次匯入的投影片圖片是 `renderPages()`（pdftoppm）對 PDF 頁面的直接截圖，已包含圖表畫面，不需注入；唯一會以 LLM（重新）產生 PDF 來源投影片圖片的路徑是「重新生成」流程，且其 `page_number` 與 `figures.json` 的頁碼為 1:1 對應，因此選定兩處整合點。\n\n新增共用函式（`backend/src/services/pdfFigures.ts`）：`getFigureReferencesForPage(pdfId, pageNumber, max=2)` 取得該頁萃取圖表，依 bbox 面積（`widthPct * heightPct`）由大到小排序並裁切至上限 `MAX_FIGURE_REFERENCES_PER_PAGE=2`；`buildFigureReferenceNotes(figures)` 依各圖的 `caption`/`context`（皆無則顯示「(無圖說文字)」）組成繁體中文提示文字，指示 LLM 在重繪投影片時盡量保留圖表的關鍵資訊/數據/趨勢、不需逐一複製外觀，`figures` 為空陣列時回傳 `null`。`backend/src/services/imagePromptTemplates.ts` 的 `buildImagePrompt()` 新增選填參數 `figureNotes?: string | null`，置於 `pageScript` 區塊之後、`textBody` 之前，為 `null`/空白時不輸出該區段，向後相容。\n\n兩個整合點皆改為：先以 `getFigureReferencesForPage()` 取得對應圖表，將其 PNG 與目前投影片圖片一併以陣列傳入 `client.images.edit({ image: [currentImage, ...figureRefFiles], ... })`（沿用 `page-operations.ts` inpaint 端點已使用的多圖陣列 pattern；無圖表時 `image` 維持單一圖片，行為不變），並將 `buildFigureReferenceNotes()` 的結果透過 `figureNotes` 注入 `buildImagePrompt()`：(1) `backend/src/routes/pdfs/page-operations.ts` 的 `POST /api/pdfs/:id/pages/:n/regenerate-image`（單頁、依提示詞重新生成）；(2) `backend/src/worker/regenerate.ts` 的 `runRegenerateImages()`（對應 `POST /api/pdfs/:id/regenerate` 的 `images` 批次任務，另於 `startArtifact` 的 `metadata` 記錄 `figureReferenceCount`）。\n\n新增測試：`backend/test/image-prompt-templates.test.ts`（新檔，2 項：`figureNotes` 注入位置在 `pageScript` 之後、為 `null`/空白時不輸出該區段）；`backend/test/pdf-figures.test.ts` 新增 `getFigureReferencesForPage`/`buildFigureReferenceNotes` 對真實 PDF（page 26，含「Figure 10」標題）的驗證，並新增 2 項合成測試（依面積裁切排序取最大兩張、caption/context 皆無時的「(無圖說文字)」後援文案）；新增 `backend/test/figure-reference-image-generation.test.ts`（新檔，2 項整合測試：以 `setOpenAIClientForTest` 模擬 `client.images.edit`，驗證 `/regenerate-image` 端點與批次 `regenerate` job 皆會將目前投影片圖片＋萃取圖表 PNG 以陣列形式傳入 `images.edit`，且 prompt 內含對應的「參考圖表 1：...」說明文字）。並更新設計文件 `docs/pdf-figure-extraction-design.md`：§7 補上 `getFigureReferencesForPage`/`buildFigureReferenceNotes` 兩個新函式說明，新增 §10「整合至投影片圖片（重新）生成（已完成）」說明整合動機、兩個整合點、程式碼模式、無圖表時的退回行為與 `figureReferenceCount` metadata，§9 移除已完成的對應未來工作項目（保留「偵測純向量繪圖區域」與「前端圖表素材瀏覽/挑選介面」）。驗證：新增/修改測試共 8 項全數通過（`pdf-figures.test.ts`、`image-prompt-templates.test.ts`、`figure-reference-image-generation.test.ts`）；`npx tsc --noEmit` 通過；以 `../scripts/with-node-env.sh npx tsx --test ./test/*.test.ts` 執行全量測試，失敗數與既有基準一致（皆為與本功能無關的既有 auth/multipart/page-ops/regenerate 測試失敗，無新增失敗，已以 `git stash`/`git stash pop` 確認變更前後失敗集合相同）。已 commit 至分支 `feature/figure-reference-image-generation-20260615`（commit 88458ff）。

- 時間: 2026-06-15 10:28:26 +0800
- 分支: feature/document-mode-figure-reference-20260615
- 內容: 完成「一般文件模式（`pdf_import_mode === 'document'`）AI 分頁與首次生圖時，也使用 `extract_figures` 萃取的圖表素材」。承接 `feature/figure-reference-image-generation-20260615` 僅整合「重新生成」流程的限制——一般文件模式的 PDF 在 AI 分頁（`splitTextWithLlm` 將原始 PDF 頁面重新拆分／合併為投影片）與首次 LLM 生圖（`renderTextPagesWithLlm`）皆早於 `extract_figures`，且 AI 重新分頁後的投影片頁碼與原始 PDF 頁碼非 1:1，先前 `extract_figures` 對此匯入模式完全略過、`figures.json` 完全未被使用。\n\n新增 `backend/src/services/pdfPageMarkers.ts`：`formatPdfPageMarker`/`buildTextWithPdfPageMarkers`/`containsPdfPageMarkers`/`stripPdfPageMarkers`，於 `source.txt` 中以 `[[PDF_PAGE_N]]`（1-indexed）標記每頁原文起點，最終內容輸出前一律剝除；`backend/src/worker/poppler.ts` 新增 `extractPdfTextPages()`（逐頁文字），`backend/src/routes/pdfs/upload.ts` 文件模式改用其建立帶標記的 `source.txt`（`pdf_sources.content_text` 仍為未標記純文字）。\n\n`backend/src/worker/steps/splitTextWithLlm.ts`：`OutlineSchema` 各投影片新增選填 `source_pages`（int[1..10]），輸入含 `[[PDF_PAGE_N]]` 標記時於系統提示詞要求 LLM 回報；Strategy 2（大綱優先，文件模式主要路徑）將其 zip 至 `SplitTextWithLlmResult.pages[i].sourcePdfPages`，最終 `content` 一律經 `stripPdfPageMarkers` 處理，標記不會外洩至使用者可見內容。\n\n`backend/src/worker/pipeline.ts` 新增 `runExtractFiguresStage(run, pdfId, pageCount)`（包裝既有 `extractPdfFigures`，以 `startStage`/`finishStage` 記錄，非阻斷），於文字匯入分支（`isTextImport`）中提前到 AI 分頁／首次生圖之前執行（`extractPdfFigures` 本身依 `figures.json` 是否存在判斷冪等，原 Step 2.1 沿用同一函式不會重算）。新增 `backend/src/services/storage.ts` 的 `splitFigureMapPath(pdfId)` 與 `backend/src/services/pdfFigures.ts` 的 `SplitPageFigureMap`/`loadSplitPageFigureMap`/`saveSplitPageFigureMap`，將「AI 分頁後頁碼 → 原始 PDF 頁碼陣列」的對應持久化為 `split-figure-map.json`；新拆頁時於寫入迴圈中建立並儲存此映射，pipeline 重入（resume）時則讀回映射以還原各頁的 `sourcePdfPages`。\n\n`backend/src/services/pdfFigures.ts` 新增 `getFigureReferencesForPages(pdfId, pageNumbers, max)`（跨多個原始 PDF 頁面彙整圖表、依 `id` 去重、依 bbox 面積裁切，並抽出與既有 `getFigureReferencesForPage` 共用的 `capFiguresByArea` helper）。`backend/src/worker/steps/renderTextPagesWithLlm.ts`：`RenderTextPagesWithLlmOptions.pages[]` 新增選填 `sourcePdfPages?: number[]`；每頁若有此欄位則呼叫 `getFigureReferencesForPages` 取得對應圖表，以 `buildFigureReferenceNotes` 組成 `figureNotes` 注入 `buildImagePrompt`；若有對應圖表，改用 `client.images.edit({ model, image: figureRefFiles, prompt, size, quality })`（以 `toFile` 讀取 `figures/*.png` 作為參考圖，單張時傳入單一檔案、多張時傳入陣列），否則維持原 `client.images.generate(...)` 路徑；成功時的 `onPage` metadata 新增 `figureReferenceCount: figureRefs.length`。\n\n新增/修改測試共 12 項：`backend/test/pdf-page-markers.test.ts`（新檔 6 項，涵蓋 marker 格式化、偵測、剝除與往返還原）；`backend/test/split-text-with-llm.test.ts`（新檔 2 項，驗證大綱策略在輸入含 `[[PDF_PAGE_N]]` 標記時回報 `source_pages` 並正確映射至各頁 `sourcePdfPages`、且最終內容不含殘留標記；無標記輸入時 `sourcePdfPages` 維持 `undefined`）；`backend/test/pdf-figures.test.ts` 新增 2 項（`getFigureReferencesForPages` 跨頁去重＋依面積裁切、`split-figure-map.json` 讀寫往返）；`backend/test/render-text-pages-figure-injection.test.ts`（新檔 2 項，分別驗證有 `sourcePdfPages` 且對應 `figures.json` 存在時走 `images.edit` 並於 prompt 注入「本頁對應的原始 PDF 內含以下圖表」說明，無 `sourcePdfPages`/無對應圖表時維持走 `images.generate`），共 12 項全數通過。並更新設計文件 `docs/pdf-figure-extraction-design.md`：新增 §11「一般文件模式（`pdf_import_mode === 'document'`）整合（已完成）」（含問題背景、頁碼標記設計、大綱 `source_pages` 回報、`extract_figures` 提前執行與 `split-figure-map.json`、`renderTextPagesWithLlm` 圖表注入、測試清單六個子節），§2.2 對應的未來工作項目改為已完成並指向 §11。驗證：`npx tsc --noEmit`（backend）通過；以 `../scripts/with-node-env.sh npx tsx --test ./test/*.test.ts` 執行全量測試，105/123 通過，18 項失敗與既有基準一致（以 `git stash`/`git stash pop` 確認變更前後失敗集合相同），無新增失敗。已 commit 至分支 `feature/document-mode-figure-reference-20260615`（commit b153d3b）。

- 時間: 2026-06-15 10:57:12 +0800
- 分支: feature/outline-max-input-chars-128k-20260615
- 內容: 完成「修正一般文件模式 source_pages 對應失準的問題」。延續上一項 `feature/document-mode-figure-reference-20260615` 完成後，使用者要求實測真實匯入的 PDF `myGMS0ahnF`（37 頁、`source.txt` 全文 122,020 字元）以驗證圖表注入功能是否正常運作。檢查結果：`extract_figures` 本身運作正常——`figures.json` 正確列出 24 張圖（分布於第 4、7、8、26、30、32、33、34、37 頁），PNG 皆為有效圖檔，且第 26 頁的 `p26-img_p25_1.png` 確為論文中的 matplotlib 長條圖「Figure 10」並正確配對圖說。但 `split-figure-map.json` 顯示 11 張 AI 分頁投影片的 `sourcePdfPages` 全部落在 PDF 第 1~4 頁（`{\"1\":[1,2],...,\"11\":[1,2,3,4]}`），完全未涵蓋第 7、8、26、30、32、33、34、37 頁——即 24 張圖中 23 張（含所有附圖說的 Figure 10/13/17/22/23）永遠不會被任何投影片引用。根本原因：`backend/src/worker/steps/splitTextWithLlm.ts` 中既有（pre-existing）的 `buildOutlineFromFullText()` 會將送往大綱 LLM 的全文以 `OUTLINE_MAX_INPUT_CHARS = 16_000` 截斷；對這份 122,020 字元的全文而言，截斷點剛好落在 `[[PDF_PAGE_4]]` 內，導致大綱 LLM 完全看不到第 5 頁之後的標記，回報的 `source_pages` 自然只能落在 1~4。\n\n修正方式：依使用者指示，將 `OUTLINE_MAX_INPUT_CHARS` 由 `16_000` 提升至 `128_000`，使大綱 LLM 可看到絕大多數 PDF 全文（含全部 `[[PDF_PAGE_N]]` 標記），對 256K context window 模型仍留有充足空間（提示詞模板＋輸出 token）。僅修改此一常數及其註解（說明改為「128 000 字可涵蓋絕大多數 PDF 全文...對 256K context window 的模型仍留有充足的系統提示詞與輸出空間」），確認 `backend/test/split-text-with-llm.test.ts`（不依賴此常數的具體數值，僅驗證行為）無需調整。驗證：`npx tsc --noEmit`（backend）通過；`npx tsx --test test/split-text-with-llm.test.ts` 2/2 通過；以 `../scripts/with-node-env.sh npx tsx --test ./test/*.test.ts` 執行全量測試，105/123 通過，18 項失敗與既有基準一致，無新增失敗。已 commit 至分支 `feature/outline-max-input-chars-128k-20260615`（commit d2c0aa6）。

- 時間: 2026-06-15 11:30:00 +0800
- 分支: docs/pdf-figure-extraction-v2-vector-design-20260615
- 內容: 完成「查看 `hRUVHXrNqW` 中抽取的圖片，有非常多圖片都沒有被正確的抽取，分析一下 Figure 1-9 看要如何改善」。逐一比對 `storage/hRUVHXrNqW/figures.json`、抽出的 PNG，以及用 `pdftoppm -png -r 100 -f 2 -l 9` 重新渲染的 `source.pdf`（論文 `2605.29548v2.pdf`，與 `myGMS0ahnF` 同源）第 2-9 頁，並透過 `source.txt` 的 `[[PDF_PAGE_N]]` 標記與 caption 文字定位 Figure 1-9 對應頁碼（Fig1→p2、Fig2→p4、Fig3→p5、Fig4→p6、Fig5/6→p7、Fig7→p8、Fig8/9→p9）。結果：Figure 1/3/4/8/9 完全不在 `figures.json` 中（純向量繪圖，無 raster image）；Figure 2 抽到的 `p4-img_p3_1.png`（806×713 漸層三角形，`caption: null`）在頁面渲染結果中完全不可見，與圖 2 內容無關，是被後續向量內容遮蓋的殘留 raster 碎片；Figure 5/6（`p7-img_p6_1.png`）與 Figure 7（page 8 的兩張 PCA 散佈圖）各抓到子面板，但 `caption` 皆為 `null`。\n\n根因：`backend/src/worker/steps/extractPdfFigures.ts` 只追蹤 `OPS.paintImageXObject`（內嵌 raster image），但 matplotlib 對折線圖/長條圖等資料點較少的圖表預設輸出向量路徑，只有資料點極多的散佈圖（PCA/embedding）子面板才會被 rasterize 成 image XObject，因此純向量圖完全偵測不到；`CAPTION_MAX_DISTANCE_PT = 40pt` 對多面板圖而言遠小於單一子面板 bbox 到整組共用 caption 的距離，即使抓到 raster 子面板也配不到 caption。\n\n依此分析在 `docs/pdf-figure-extraction-design.md` 新增 §12「向量圖形萃取（V2 設計，待實作）」，含 9 個子節：12.1 以表格列出 Figure 1-9 現況、頁碼與根因；12.2 V2 的 4 項目標；12.3 向量區域偵測演算法（在既有 CTM 追蹤迴圈中累積 `OPS.constructPath` 的 bbox，排除文字 operator，以 union-find 聚類並套用 `VECTOR_FIGURE_MIN_PATHS>=20` 與既有面積過濾，與既有 raster 候選 IoU>0.5 時合併）；12.4 多面板群組化與 caption 比對（依 bbox 列/相鄰關係分組、以群組聯集 bbox 套用既有 `findCaption()`，並以 caption 文字中的 `Figure N` 編號與群組 x 範圍重疊做 anchor 校正）；12.5 改用 poppler 整頁 render（已驗證 `pdftoppm` 對 `hRUVHXrNqW` 第 2、4-9 頁皆成功，不受 §3.1 記載的 pdf.js `page.render()` "Image or Canvas expected" bug 影響）+ `sharp().extract()` 依 bbox 裁切向量區域，新增 `FigureEntry.source?: 'raster'|'vector'`；12.6 過濾被後繪製、面積更大的向量群組覆蓋率 >0.9 的 raster 殘留影像（即可移除 `p4-img_p3_1.png`）；12.7 以 `hRUVHXrNqW` 為例列出 Figure 1-9 各自的預期改善效果；12.8 風險與待確認事項（`OPS.constructPath` 的 argsArray 結構需實測驗證、聚類/面積門檻需在多份真實 PDF 上調參、37 頁皆額外整頁 render 對 120 秒 SLA 的影響，建議僅對含未配對 caption 的頁面延遲渲染）；12.9 建議實作順序（先寫獨立腳本在 `hRUVHXrNqW/source.pdf` 上調參，整合進 `extractPdfFigures()`，擴充 `pdf-figures.test.ts`，將本節標記為「已完成」並回頭更新 §2.2/§9）；並將 §9 未來工作「偵測純向量繪圖區域」一項改為指向本節。\n\n本次依使用者選擇（「先寫 V2 設計文件並加入 TODO.md」）僅完成分析與設計文件，未變動任何程式碼或測試。已在 master `TODO.md` 本節清單新增一筆 `[x]` 完成項記錄本次分析結論，並新增一筆 `[ ]` 待辦項目（依 §12 V2 設計實作向量圖形萃取，讓 `hRUVHXrNqW` 的 Figure 1-9 能被正確抽取並配對到 caption），留待未來工作週期挑選執行。已 commit 至分支 `docs/pdf-figure-extraction-v2-vector-design-20260615`。

- 時間: 2026-06-15 15:20:00 +0800
- 分支: feature/vector-figure-extraction-v2-20260615
- 內容: 完成 TODO 第 901 項「依 `docs/pdf-figure-extraction-design.md` §12 的 V2 設計，實作向量圖形萃取，讓 `hRUVHXrNqW`（`2605.29548v2.pdf`）的 Figure 1-9 等純向量/混合圖表能被正確抽取並配對到 caption」。於既有 CTM 追蹤迴圈中新增向量路徑偵測：對 `OPS.constructPath` 累積 bbox（排除文字 operator），以 union-find 聚類（`VECTOR_FIGURE_MIN_PATHS=20`、`VECTOR_CLUSTER_PAD_PT=5`），再依 bbox 列/相鄰關係（`GROUP_X_GAP_RATIO=0.2`）將多面板圖分組；放寬 `CAPTION_RE` 為 `/(Fig(?:ure)?\.?|Table|圖表?|表)\s*\.?\s*\d+\s*[:：]/i`，使「(a) (b)Figure 2: ...」這類與子圖標記同行的 caption 也能比對成功。影像輸出改用 pdf.js（非原規劃的 poppler `pdftoppm`）：修正 `backend/src/worker/poppler.ts` 的 `NodeCanvasFactory`（`create`/`reset`/`destroy` 皆透過 `canvas` 套件的 `createCanvas()`，解決 pdf.js 內建 Node canvas factory 用 `@napi-rs/canvas` 與本專案 `canvas`（node-canvas）不相容造成的 "Image or Canvas expected" 錯誤），新增 `renderPageToPng()` 整頁渲染後以 `cropPagePng()` 依 bbox 裁切向量群組並輸出 `p<pageNumber>-vec<index>.png`，新增 `FigureEntry.source?: 'raster'|'vector'`。新增 raster/vector 合併規則（IoU>0.5 或 containment>0.9）與兩階段被遮蓋 raster 過濾（bbox overlap>0.5 篩選候選，再以 `computeOcclusionDiff()` 像素差異>60 確認）。驗證結果：`hRUVHXrNqW`（37 頁）總計正確抽取 23 張圖（Figure 1-23 全部配對到正確 caption），其中 Figure 1-9（page 2/4-9）皆為 `source: 'vector'`，原本誤判為圖 2 的殘留 raster `p4-img_p3_1.png` 已被遮蓋過濾排除；37 頁整頁渲染僅耗時約 11 秒，遠低於 120 秒 SLA。已知限制：page 7/9 的群組裁切因 4 個與整體 bbox 完全相同的外框/背景矩形路徑而有多餘留白（內容與 caption 仍正確），詳見設計文件 §12.10。擴充 `backend/test/pdf-figures.test.ts`（新增 Figure 1-9 共 7 項 vector 斷言＋figureCount=23 全文件斷言），`npx tsc --noEmit` 通過，全量測試結果與既有基準一致（18 項既有失敗皆與本變更無關，無新增失敗）。同步更新設計文件 `docs/pdf-figure-extraction-design.md` §2.2/§3.1/§9/§12（含新增 §12.10「已知限制」）為「已完成」。已 commit 至分支 `feature/vector-figure-extraction-v2-20260615`（commit 74531d3）。

# 2026-6-15
[x] 在 PlayPage 中，把目前播放中的動畫，根據時現時間將目前播放中的效果背景用高亮度。（完成於分支: feature/animation-active-effect-highlight-20260615）
[x] 點擊動畫效果時，把時間軸移到效果有效時間一半的地方。（完成於分支: feature/animation-effect-seek-midpoint-20260615）
[x] 使用 CTRL click 時，把效果改成己選擇的狀態，被選擇的效果都加上一個『合併』的按鍵，按下按鍵就把所有的效果都合併成一個單一效果。起始時間是就早的效果，而長度則調整成所有效果最晚的時間。（完成於分支: feature/animation-effect-multi-select-merge-20260615）
[x] 加上一個設定指標效果，只是把指標移到指定的位置。（完成於分支: feature/animation-pointer-effect-20260615）
[x] 在重生中加上一個動畫的項目，把每一頁都加上動畫效果。（完成於分支: feature/regenerate-add-animations-20260615）
[x] 把效果清單和逐字稿效果指引放在一個 notebook 界面中，並加上捲動軸（完成於分支: feature/animation-effects-hints-notebook-20260615）
[x] 效果 merge 時，原來是依逐字稿就還是用逐字稿，不要轉成秒數（完成於分支: feature/animation-merge-keep-transcript-trigger-20260615）
[x] 重新確認 master TODO.md 無未完成項目並更新工作記錄（完成於分支: feature/todo-no-pending-recheck-20260615-2030）
[x] 依 `docs/pdf-figure-extraction-design.md` §9「未來工作」項目，為投影片編輯介面新增「前端圖表素材瀏覽 / 挑選介面」（完成於分支: feature/figure-asset-browser-20260615）
[x] 依 `docs/animation-slide-v1-design.md` §12「後續擴充方向」V1.1 項目，為動畫編輯器新增「效果排序」功能（完成於分支: feature/animation-effects-reorder-20260615）
[x] 依 `docs/animation-slide-v1-design.md` §12「後續擴充方向」V1.1 項目，實作「drawing mode 自動暫停」（完成於分支: feature/drawing-mode-auto-pause-20260615）
[x] 依 `docs/animation-slide-v1-design.md` §12「後續擴充方向」V1.1 項目，為動畫編輯器新增「raw JSON 檢視」分頁（完成於分支: feature/animation-effects-raw-json-view-20260615）
[x] 依 `docs/animation-slide-v1-design.md` §12「後續擴充方向」V1.1 項目，為動畫編輯器新增「跨頁複製」效果功能（完成於分支: feature/animation-effects-cross-page-copy-20260615）
[x] 依 `docs/animation-slide-v1-design.md` §12「後續擴充方向」V1.1 項目，為動畫編輯器新增「preset 快速套用」功能（完成於分支: feature/animation-effect-presets-20260615）
[x] 依 `docs/animation-slide-v1-design.md` §12「後續擴充方向」V1.1 項目，為 `fade-in`/`zoom-*`/`pan-*` 等整頁 transform 效果提供對稱的「消失（恢復原狀）」可選機制（完成於分支: feature/animation-transform-exit-revert-20260615）
[x] 依 `docs/animation-slide-v1-design.md` §12「後續擴充方向」V2 項目，為 AI 自動產生焦點動畫（`auto-focus-ai`）新增可生成 `text-callout`（含 AI 生成文案）效果的能力（完成於分支: feature/animation-auto-focus-ai-text-callout-20260615）
[x] 依 `docs/animation-slide-v1-design.md` §12「後續擴充方向」V2 項目，新增 SVG 圖元（`shape`）動畫效果類型，提供 circle/rect/ellipse/arrow 四種基本圖形 overlay（完成於分支: feature/animation-svg-shape-effect-20260616）
[x] 依 `docs/animation-slide-v1-design.md` §12「後續擴充方向」V2 項目，新增逐步條列（`step-list`）動畫效果類型，提供條列文字 overlay、項目逐一交錯淡入（完成於分支: feature/animation-step-list-effect-20260616）
[x] 依 `docs/animation-slide-v1-design.md` §12「後續擴充方向」V2 項目，將 AI 自動產生焦點動畫（`auto-focus-ai`）的可生成效果類型擴充為包含 `shape` 與 `step-list`（完成於分支: feature/animation-auto-focus-ai-shape-step-list-20260616）
[x] 修正批量「重生」流程中「動畫」步驟改為逐頁呼叫 AI 自動產生焦點動畫（與「🤖 AI 自動產生焦點動畫」相同邏輯），取代純規則式產生（完成於分支: feature/regenerate-animation-ai-focus-20260616）
[x] 依 `docs/animation-slide-v1-design.md` §12「後續擴充方向」V2 項目，新增「overlay image」（圖片插入）動畫效果類型 `overlay-image`，可從該頁已擷取的圖表素材中選取單張圖片疊加顯示（完成於分支: feature/animation-overlay-image-effect-20260616）
[x] 依 `docs/animation-slide-v1-design.md` §12「後續擴充方向」V2 項目，新增「公式」（formula）動畫效果類型，於指定區域以 KaTeX 渲染 LaTeX 數學公式（完成於分支: feature/animation-formula-effect-20260616）
[x] 依 `docs/pipeline-stage-and-page-timing.md` §13「後續可擴充方向」項目，新增 run history API 與「系統資料」分頁的「執行歷程」區塊，讓使用者查看每次 regenerate/resume 的完整歷程（完成於分支: feature/pipeline-run-history-20260616）
[x] 依 `docs/pipeline-stage-and-page-timing.md` §13「後續可擴充方向」項目，將 SLA target 移到 DB（v1 範圍：全域 override，admin 可調整每個 stage/artifact 的目標毫秒數，套用於所有 PDF/provider/model/source_type；依 provider/model/source_type 區分目標值留待後續擴充）（完成於分支: feature/pipeline-sla-settings-20260616）
[x] 依 `docs/pipeline-stage-and-page-timing.md` §13「後續可擴充方向」項目，將 timing event 與 token/成本統計關聯，支援成本儀表（v1 範圍：run 層級關聯，`GET /api/pdfs/:id/runs` 每個 run 新增 `llm_usage`（requests/tokens/預估費用）；stage/artifact 細分、Gemini 用量記錄、更多模型計價留待後續擴充）（完成於分支: feature/pipeline-llm-cost-tracking-20260616）
[x] 依 `docs/animation-slide-v1-design.md` §12「後續擴充方向」V2 項目，讓 AI 自動產生焦點動畫（`auto-focus-ai`）可為每頁最多一句選擇 `custom-script` 並提供 `scriptPrompt`/`scriptDurationSeconds`，由後端呼叫既有的 `generateCustomScriptCodeStream` 安全/契約檢查管線產生程式碼，產生失敗時退回 `highlight-box`（v1 範圍：不含互動式「實作步驟」規劃與多輪迭代，物件 target 留待後續）（完成於分支: feature/animation-auto-focus-ai-custom-script-20260616）
[x] 依 `docs/animation-slide-v1-design.md` §12「後續擴充方向」V2 項目，讓 AI 自動產生焦點動畫（`auto-focus-ai`）可為每頁最多一句選擇 `overlay-image`，並從該頁已擷取且使用者未排除的圖表素材中選取一張，設定 `figureId`；無效 `figureId` 時退回 `highlight-box`（完成於分支: feature/animation-auto-focus-ai-overlay-image-20260616）
[x] 依 `docs/animation-slide-v1-design.md` §12「後續擴充方向」V2.x 項目，為 `custom-script` sandbox 的 `window.Manim` 輔助函式庫新增 `coordinateSystems.axes`/`coordinateSystems.numberPlane`（座標軸、刻度、`numberPlane` 額外格線、`coordsToPoint` 將資料座標映射到場景座標）（v1 範圍：不含 `MathTex`/`Tex`、`transform` 真正路徑變形、3D，留待後續）（完成於分支: feature/animation-manim-axes-numberplane-20260616）
[x] 實作 `docs/animation-slide-v1-design.md` §7.2「TODO 第 720 項」所述「打開功能後，產生語音時自動產生」的常駐設定與後端管線整合：新增帳號層級設定 `autoGenerateAnimation`（`AUTO_GENERATE_ANIMATION` 環境變數，預設關閉），啟用後每次主管線完成語音合成時自動呼叫 `generateAnimationForPage` 為每頁產生焦點動畫並覆寫原有效果；前端「AI 設定」頁面新增對應開關；v1 範圍：整頁覆寫、單頁失敗非致命、不提供選頁設定（完成於分支: feature/animation-auto-generate-on-audio-20260616）

# 工作記錄

- 時間: 2026-06-15 16:05:00 +0800
- 分支: feature/animation-active-effect-highlight-20260615
- 內容: 完成「在 PlayPage 中，把目前播放中的動畫，根據時現時間將目前播放中的效果背景用高亮度」。於 `frontend/src/pages/play/AnimationEditorTab.tsx` 的效果列表中，對每個 `SlideAnimationEffect` 計算其有效時間範圍：若有 `startTrigger` 則以 `resolveStartTriggerSeconds()` 解析出的秒數作為起點（無法解析時退回 `effect.start`），結束時間為「起點 + duration + (exitDuration ?? 0)」（涵蓋 overlay 效果的自動淡出時間）；當 `currentTime`（取自 `PlayPageContext`，由 `<audio onTimeUpdate>` 即時更新）落在此範圍內時，該效果項目的容器改用 `border-fuchsia-400 bg-fuchsia-500/15` 高亮樣式取代預設的 `border-slate-800 bg-slate-900/50`，並加上 `transition-colors` 讓切換更平滑；其餘欄位（效果類型、起始模式、時長、ease 等）行為不變。驗證：`npx tsc --noEmit`（frontend）與 `npm run build`（frontend, vite build）皆通過。已 commit 至分支 `feature/animation-active-effect-highlight-20260615`（commit 3a2c97a）。

- 時間: 2026-06-15 17:10:00 +0800
- 分支: feature/animation-effect-seek-midpoint-20260615
- 內容: 完成「點擊動畫效果時，把時間軸移到效果有效時間一半的地方」。於 `frontend/src/pages/PlayPage.tsx` 新增 `handleSeekToTime(seconds)`：與既有 `handleSeek` 共用 sync master 守衛與 `duration` 有效性檢查，將 `audioRef.current.currentTime` 設為 `Math.max(0, Math.min(seconds, duration))` 並清除延長播放計時器，並透過 `PlayPageContextValue` 匯出（`frontend/src/pages/play/PlayPageContext.tsx` 新增對應型別）。`frontend/src/pages/play/AnimationEditorTab.tsx` 每個效果列前新增「⏱」按鈕（`play.animation.seekToMidpoint`，已補上 `en.ts`/`zh-TW.ts` 翻譯鍵），點擊時呼叫 `handleSeekToTime(effectStart + effect.duration / 2)`，其中 `effectStart` 沿用上一項目（高亮顯示）已計算的「依 startTrigger 解析後的起始秒數」，因此對「依逐字稿句子」起始的效果也能正確跳轉。驗證：`npx tsc --noEmit`（frontend）與 `npm run build`（frontend, vite build）皆通過。已 commit 至分支 `feature/animation-effect-seek-midpoint-20260615`（commit d02fc65）。

- 時間: 2026-06-15 18:05:00 +0800
- 分支: feature/animation-effect-multi-select-merge-20260615
- 內容: 完成「使用 CTRL click 時，把效果改成己選擇的狀態，被選擇的效果都加上一個『合併』的按鍵，按下按鍵就把所有的效果都合併成一個單一效果。起始時間是就早的效果，而長度則調整成所有效果最晚的時間」。於 `frontend/src/pages/play/AnimationEditorTab.tsx` 新增 `selectedEffectIds`（`Set<string>`）狀態：在每個效果列的容器 `<div>` 上加上 `onClick`，當 `e.ctrlKey || e.metaKey` 時切換該效果 ID 的選取狀態，並以 `ring-2 ring-cyan-400` 疊加在既有的「目前播放中」(`isActive`，fuchsia) 高亮樣式上，兩者可同時顯示；效果清單上方新增提示文字 `play.animation.multiSelectHint` 說明 Ctrl/⌘+click 多選與合併操作。選取數 ≥2 時，於新增效果按鈕旁顯示「合併已選效果 (N)」按鈕（`play.animation.mergeSelected`），點擊後執行 `handleMergeSelectedEffects()`：對所有選中效果，依 `effect.startTrigger`（透過 `resolveStartTriggerSeconds()` 解析，失敗時退回 `effect.start`）計算各自的有效 `start`/`end`（`end = start + duration`），取 `minStart = Math.min(...starts)` 與 `maxEnd = Math.max(...ends)`；以「起始時間最早」的效果為基準，將其 `start` 設為 `minStart`、`duration` 設為 `maxEnd - minStart`、並清除 `startTrigger`（改為絕對秒數），其餘設定（效果類型、ease、text、params、exitDuration、code 等）保留基準效果原值不變；其餘被選中的效果從 `draft.effects` 中移除，合併完成後清空 `selectedEffectIds`。刪除效果按鈕同步將該效果 ID 從 `selectedEffectIds` 移除；切換頁面（`currentPage?.page_number` 改變）時以 `useEffect` 清空選取狀態，避免跨頁合併。新增 i18n 翻譯鍵 `play.animation.multiSelectHint`、`play.animation.mergeSelected`（`en.ts`/`zh-TW.ts`）。驗證：`npx tsc --noEmit`（frontend）與 `npm run build`（frontend, vite build）皆通過。已 commit 至分支 `feature/animation-effect-multi-select-merge-20260615`（commit 524aba0）。

- 時間: 2026-06-15 19:00:00 +0800
- 分支: feature/animation-pointer-effect-20260615
- 內容: 完成「加上一個設定指標效果，只是把指標移到指定的位置」。新增 `pointer` 動畫效果類型：`frontend/src/types.ts` 的 `SlideAnimationEffectType` 與 `backend/src/services/pageAnimation.ts` 的 `ANIMATION_EFFECT_TYPES`/`ALLOWED_PARAM_KEYS`（`['xPct', 'yPct']`）新增對應項目；`frontend/src/lib/animationSpec.ts` 的 `SLIDE_ANIMATION_EFFECT_TYPES`/`OVERLAY_EFFECT_TYPES` 加入 `pointer`，並新增 `DEFAULT_POINTER_PARAMS = { xPct: 50, yPct: 50, widthPct: 0, heightPct: 0 }`，`getFocusEffectParams()` 對 `pointer` 套用此預設（未設定時指標置於畫面正中央）。`frontend/src/components/slide/buildGsapTimeline.ts` 的 overlay 共用 `switch-case` 加入 `pointer`，沿用既有 `tl.fromTo(overlay, {autoAlpha:0}, {autoAlpha:1, ...common}, effect.start)` 淡入與 `exitDuration` 淡出機制，無需新增 GSAP 邏輯。`frontend/src/components/slide/SlideRenderer.tsx` 的 `EffectOverlay` 新增 `pointer` 渲染：以 `(xPct, yPct)` 為中心顯示一個帶光暈的紅色圓點（`translate(-50%, -50%)` 置中，`radial-gradient` + `boxShadow` 呈現指標光點）。`frontend/src/pages/play/AnimationEditorTab.tsx` 的效果焦點位置 UI 區塊新增 `pointer` 專屬分支：僅顯示 X/Y 位置（百分比）兩個輸入欄位（不顯示寬高），標籤改用新增的 `play.animation.pointerPosition`；效果類型下拉選單沿用既有清單自動納入 `pointer`（顯示文字 `play.animation.type.pointer`）。新增 i18n 翻譯鍵 `play.animation.type.pointer`、`play.animation.pointerPosition`（`en.ts`/`zh-TW.ts`）。設計上，依序排列多個不同位置的 `pointer` 效果，可在投影片播放過程中呈現指標隨講解內容「移動」的視覺效果。驗證：`npx tsc --noEmit` 與 `npm run build`（frontend）皆通過；`npx tsc --noEmit`（backend）通過；`frontend/src/lib/animationSpec.test.ts` 28/28 通過；`backend/test/page-animation.test.ts` 在此環境因 `better-sqlite3` 與目前 Node 版本的 NODE_MODULE_VERSION 不符（`ERR_DLOPEN_FAILED`）而無法執行，已確認此為既有環境問題（移除本次變更後同樣失敗），與本次修改無關。已 commit 至分支 `feature/animation-pointer-effect-20260615`（commit 0fcc887）。

- 時間: 2026-06-15 19:53:00 +0800
- 分支: feature/regenerate-add-animations-20260615
- 內容: 完成「在重生中加上一個動畫的項目，把每一頁都加上動畫效果」。後端：`backend/src/types.ts`、`frontend/src/types.ts` 的 `RegenStepName` 新增 `'animation'`；`backend/src/routes/pdfs/shared.ts` 的 `RegenerateBatchBodySchema` 新增 `animations: z.object({}).optional()`，`backend/src/routes/pdfs/regenerate.ts` 將其轉交給 `startRegenerateJob`；`backend/src/services/timing.ts`（與 `backend/test/timing.test.ts`）新增 `generate_animations` pipeline stage 與 SLA target（60s）。新增 `backend/src/services/textSentences.ts`，將 `splitScriptIntoSentences()` 抽出（與 `frontend/src/lib/subtitles.ts` 完全一致的切句規則，確保句子索引能對應 `startTrigger: { type: 'transcript-line', line }`），並於 `backend/src/services/animationAutoFocus.ts` 新增 `generateRuleBasedFocusEffects()`（輸出 `highlight-box`、`duration: 1.2`、`ease: 'power1.out'`，依句子數產生並以 `MAX_SLIDE_ANIMATION_EFFECTS`（自 `pageAnimation.ts` 匯出）為上限），邏輯與前端「動畫編輯」分頁的 `generateFocusEffectsFromTranscript()`/「一次性產生」按鈕一致。`backend/src/worker/regenerate.ts` 新增 `runRegenerateAnimations()`：當勾選「動畫」時加入 `stepNames`，依（選定的）`page_numbers` 逐頁讀取逐字稿、切句、產生規則式焦點動畫並整份覆寫該頁 `pages/<uid>.animation.json`，再以 `renderTypeForSpec()` 更新 `pages.render_type`/`animation_spec_path`，最後同步 `pdfs.updated_at` 與 `metadata.json`；並擴充 snapshot/rollback（`SnapshotPageEntry` 新增 `db_render_type`/`db_animation_spec_path`/`animation`，`snapshotBackupFilePath`/`targetFilePath` 新增 `'animation'` 分支對應 `.animation.json`），使「動畫」步驟與既有圖檔/逐字稿/語音步驟一樣可被快照與還原。前端：`frontend/src/pages/play/RegenAllDialog.tsx` 新增「動畫」勾選框與說明文字（產生規則同上，並提示會覆寫該頁原有動畫設定），執行順序提示改為「圖檔 → 逐字稿 → 語音 → 動畫」；`frontend/src/pages/play/useRegeneration.ts`、`PlayPageContext.tsx`、`frontend/src/lib/api/pdfs.ts` 的 `RegenOptions`/`StartRegenerateOptions` 新增 `animation`/`animations` 欄位並串接至 `startRegenerateJob`；`RegenerateProgress.tsx` 的 `STEP_LABELS` 新增 `animation: '動畫'`。測試：新增 `backend/test/textSentences.test.ts`（4 項全過，涵蓋切句規則、tone marker 過濾、`generateRuleBasedFocusEffects` 的 transcript-line 對應與上限/負數裁切）。驗證：`npm run typecheck`（backend + frontend）皆通過；`npm test`（backend）127 項中 18 項失敗，皆為既有環境問題（401 認證、`spawn git ENOENT` 等），以 `git stash` 比對確認移除本次變更後同樣失敗 18 項，與本次修改無關。已 commit 至分支 `feature/regenerate-add-animations-20260615`（commit 4b3edb1）。

- 時間: 2026-06-15 20:05:00 +0800
- 分支: feature/animation-merge-keep-transcript-trigger-20260615
- 內容: 完成「效果 merge 時，原來是依逐字稿就還是用逐字稿，不要轉成秒數」。`frontend/src/pages/play/AnimationEditorTab.tsx` 的 `handleMergeSelectedEffects()` 原本合併後一律將 `startTrigger` 設為 `undefined`（改用絕對秒數 `start: minStart`），導致原本依逐字稿句子觸發（`startTrigger: { type: 'transcript-line', line, offsetSeconds? }`）的效果合併後失去與逐字稿的同步。修正為：合併結果以 `{ ...earliest, start: minStart, duration: maxEnd - minStart }` 建立，移除原本覆寫 `startTrigger: undefined` 的那一行，讓「起始時間最早」的效果（`earliest`）原有的 `startTrigger`（若有）透過 `...earliest` 自然保留；`start` 仍更新為目前解析出的秒數（`minStart`），作為轉錄被編輯導致 `resolveStartTriggerSeconds()` 解析失敗時的備援值。若 `earliest` 本來就是絕對秒數（無 `startTrigger`），行為不變。同步更新函式上方的說明註解。驗證：`npx tsc --noEmit`（frontend）通過；`npm run build`（frontend, vite build）通過；`frontend/src/lib/animationSpec.test.ts` 28/28 通過。已 commit 至分支 `feature/animation-merge-keep-transcript-trigger-20260615`（commit 2bdcbaa）。

- 時間: 2026-06-15 20:20:00 +0800
- 分支: feature/animation-effects-hints-notebook-20260615
- 內容: 完成「把效果清單和逐字稿效果指引放在一個 notebook 界面中，並加上捲動軸」。重構 `frontend/src/pages/play/AnimationEditorTab.tsx`：新增 `notebookTab` 狀態（`'effects' | 'hints'`，預設 `'effects'`），在「啟用動畫」勾選框下方新增一個分頁列（樣式沿用 `PlayPageSlidePanel.tsx` 既有的 編輯分頁 tab-bar 樣式：`flex overflow-hidden rounded-md border ...`，啟用時 `bg-slate-800 text-fuchsia-200`），左側分頁為「{效果清單}（{effects.length}）」、右側為「{逐字稿動畫指引}」並在有逐字稿時附上「{已填寫提示數}/{句數}」。原本「效果清單」（含多選合併提示 `multiSelectHint`、`noEffects` 空狀態、`draft.effects.map(...)` 的逐項編輯卡片）與「逐字稿動畫指引」（`hintsDescription` 說明＋`pageSentences.map(...)` 的逐句提示輸入框，原本只在 `pageSentences.length > 0` 時整段顯示）兩段內容，合併進同一個 `max-h-[60vh] overflow-y-auto` 的捲動容器中，依 `notebookTab` 顯示對應內容；逐字稿提示分頁在無逐字稿時改顯示既有的 `noTranscript` 訊息（取代原本整段隱藏）。原本夾在兩段中間的「新增效果／合併已選效果／自動產生逐字稿焦點動畫／AI 自動產生焦點動畫」工具列移至分頁列上方、捲動容器外，維持兩個分頁切換時都能操作；`customScriptDialogEffect` 的彈出對話框（fixed overlay）位置與行為不變。內部各效果卡片與提示輸入框的 JSX 與互動邏輯（`updateEffect`、`updateHint`、`handleMergeSelectedEffects`、`handleSeekToTime`、`selectedEffectIds` 多選等）皆未改動，僅調整外層容器結構與顯示條件。驗證：`npx tsc --noEmit`（frontend）通過；`npm run build`（frontend, vite build）通過；`frontend/src/lib/animationSpec.test.ts` 28/28 通過。已 commit 至分支 `feature/animation-effects-hints-notebook-20260615`（commit fda4d82）。

- 時間: 2026-06-15 20:30:00 +0800
- 分支: feature/todo-no-pending-recheck-20260615-2030
- 內容: 重新確認 master 中 TODO.md 未發現行首未完成核取項目（`^[ ]`），working tree 亦無未提交變更；本輪實際待辦清單（FirstBatch、New Batch、New TODO、新的功能、2026-6-1、2026-6-10、2026-6-11、2026-6-12、新功能(每一個功能使用一個 branch)、2026-6-15 等所有區段）皆已全數標記為 `[x]` 完成。本次以獨立分支保存複查記錄 `docs/todo-rechecks/2026-06-15-2030.md`，並回到 master 更新工作記錄。

- 時間: 2026-06-15 21:00:00 +0800
- 分支: feature/figure-asset-browser-20260615
- 內容: 由於 master 中 TODO.md 當下無未完成的 `[ ]` 項目，依 CLAUDE.md 指示改挑選一項「未追蹤但已規劃」的工作：`docs/pdf-figure-extraction-design.md` §9「未來工作」中的「前端提供圖表素材瀏覽 / 挑選介面」。實作讓使用者在投影片編輯面板看到每頁（document 模式下透過 split-figure-map 對應的多個原始 PDF 頁面）所偵測到的圖表素材，並可逐一將某張圖表排除在「AI 重新生成圖片」的參考圖之外。\n\n後端：新增 `backend/src/routes/pdfs/figures.ts`（於 `routes/pdfs/index.ts` 註冊 `registerFigureRoutes`），提供 `GET /api/pdfs/:id/pages/:n/figures`（回傳 `page_number`、`source_pdf_pages`（經 `loadSplitPageFigureMap` 解析）、`figures[]`，每項含 `id`/`caption`/`context`/`bbox`/`source`（`raster`|`vector`）/`image_url`/`excluded`，並以 `collectFigures()` 跨頁依 id 去重）、`PUT /api/pdfs/:id/pages/:n/figures/selection`（body `{ excluded: string[] }`，最多 50 筆、自動去重，寫入 `pages/<page_uid>.figure-selection.json`）、`GET /api/pdfs/:id/figures/:figureId/image`（以 `findFigureById` 找出 PNG 並 `streamFile`，找不到回 404 `FIGURE_NOT_FOUND`；頁碼不存在回 404 `PAGE_NOT_FOUND`）。`backend/src/services/pdfFigures.ts` 新增 `findFigureById`、`FigureSelection`/`loadFigureSelection`/`saveFigureSelection`（檔案不存在或內容損毀時回傳 `{ excluded: [] }`，不丟例外），並為 `getFigureReferencesForPage`/`getFigureReferencesForPages` 新增第三參數 `excludeIds?: ReadonlySet<string>`，在 `capFiguresByArea` 裁切前先過濾被排除的 figure id；`backend/src/routes/pdfs/page-operations.ts`（`POST /pages/:n/regenerate-image`）與 `backend/src/worker/regenerate.ts`（`runRegenerateImages`）的兩個既有整合點皆改為先讀取 `loadFigureSelection(pdfId, page_uid).excluded` 再傳入 `excludeIds`，使用者排除的圖表不再被當作參考圖。`backend/src/services/storage.ts` 新增 `figureSelectionPath(pdfId, pageUid)` → `pages/<page_uid>.figure-selection.json`。\n\n前端：新增 `frontend/src/pages/play/FigureAssetsTab.tsx`，在 `PlayPageSlidePanel.tsx` 的編輯分頁列新增「📊 圖表素材」分頁（`figures`，sky 色，位於 animation 與 system 之間），進入分頁時呼叫新增的 `fetchPageFigures(pdfId, pageNumber, shareToken)`（`frontend/src/lib/api/pdfs.ts`）載入圖表清單，以縮圖網格顯示每張圖表的圖說/上下文、來源標籤（`vector`→「向量圖」、否則「內嵌圖片」），並提供核取方塊（勾選=作為圖片參考）即時呼叫新增的 `savePageFigureSelection(pdfId, pageNumber, excludedIds)`，失敗時還原 UI 並顯示錯誤訊息。`frontend/src/types.ts` 新增 `PageFigure`/`PageFiguresResponse` 型別；`useScriptEditor.ts` 的 `editTab`/`EditTab` union 與 `PlayPageContext.tsx` 的 `EditTab` 型別皆新增 `'figures'`；`zh-TW.ts`/`en.ts` 新增 `play.figures.*` 系列 i18n 字串（標題、說明、載入中/錯誤/空清單、來源標籤等）。\n\n測試：`backend/test/pdf-figures.test.ts` 新增 3 項（`findFigureById` 跨頁查找、`getFigureReferencesForPage`/`getFigureReferencesForPages` 排除指定 id 後再依面積裁切、`loadFigureSelection`/`saveFigureSelection` 讀寫往返與損毀檔案 fallback）；新增 `backend/test/figure-assets.test.ts`（5 項，端對端驗證新路由的列表/選擇持久化/split-figure-map 跨頁彙整/404/PNG streaming）；`backend/test/figure-reference-image-generation.test.ts` 新增 1 項，驗證使用者排除唯一圖表後 `POST /pages/:n/regenerate-image` 不再附帶任何參考圖、prompt 不含圖表參考段落。並更新 `docs/pdf-figure-extraction-design.md`：§2.2、§9 對應未來工作項目改為已完成並指向新增的 §13「前端圖表素材瀏覽 / 挑選介面（已完成）」（含後端 API、前端元件、測試清單四個子節）。驗證：`npx tsc --noEmit`（backend、frontend）皆通過；`npm run build`（frontend）通過；以 `../scripts/with-node-env.sh npm test` 執行全量測試，136 項中 18 項失敗（與既有基準一致，皆為與本功能無關的既有 auth/multipart/page-ops/regenerate/timing 測試失敗，單獨執行 `timing.test.ts` 亦會出現其中 1 項失敗，確認非本次變更所致），新增與修改的 17 項圖表相關測試全數通過。已 commit 至分支 `feature/figure-asset-browser-20260615`（commit c1508c3），並已 `git merge --no-edit` 回 master。

- 時間: 2026-06-15 21:50:00 +0800
- 分支: feature/animation-effects-reorder-20260615
- 內容: 由於 master 中 TODO.md 當下仍無未完成的 `[ ]` 項目，依 CLAUDE.md 指示再次改挑選一項「未追蹤但已規劃」的工作：`docs/animation-slide-v1-design.md` §12「後續擴充方向」V1.1 項目中的「效果排序」。動畫效果陣列 `AnimationSpec.effects` 的順序不僅決定編輯器內效果清單的顯示順序，也決定 `SlideRenderer.tsx` 中 `EffectOverlay` 對重疊的 overlay 類效果（`highlight-box`/`spotlight`/`pointer`/`text-callout`/`custom-script`）的 DOM 疊加順序（陣列越後面、DOM 越晚渲染、視覺上越在上層），但先前版本並未提供任何方式調整此順序，使用者只能依新增順序排列。\n\n實作：於 `frontend/src/pages/play/AnimationEditorTab.tsx` 新增 `moveEffect(id, direction)` 輔助函式，透過 `setAnimationDraft` 以 `effects.findIndex()` 找出目標效果索引，計算 `direction === 'up' ? index - 1 : index + 1` 作為交換對象索引，若超出陣列範圍（已在最上/最下）則不動作，否則以暫存變數搬移交換兩元素（因 `noUncheckedIndexedAccess` 啟用，陣列索引存取型別為 `T | undefined`，改用 `effects[index]!`/`effects[targetIndex]!` 搭配 non-null assertion 取代原本嘗試的解構交換寫法，避免 TS2322）。`draft.effects.map((effect) => {...})` 改為帶 `index` 的版本，在每張效果卡片按鈕列最前方（原本的「⏱ 跳至效果中點」按鈕之前）新增一組垂直排列的「▲ 上移／▼ 下移」按鈕：僅在 `draft.effects.length > 1` 時顯示；`index === 0` 時停用「▲」、`index === draft.effects.length - 1` 時停用「▼」，並沿用既有 `disabled`（編輯鎖定）狀態。新增 i18n 翻譯鍵 `play.animation.moveUp`／`play.animation.moveDown`（`zh-TW.ts`：「上移效果（提高疊加順序）」／「下移效果（降低疊加順序）」；`en.ts`：「Move up (raise stacking order)」／「Move down (lower stacking order)」），套用於按鈕的 `title`/`aria-label`。\n\n並同步更新 `docs/animation-slide-v1-design.md` §12 V1.1 項目，將「效果排序」加上刪除線並註記已於本分支完成。驗證：`npx tsc --noEmit`（frontend）通過；`npm run build`（frontend, vite build）通過。受限於環境中既有的背景 dev server 處於其他分支/checkout 的過期狀態（埠 5173/37332 皆連線但回應 "Empty reply from server"，非本分支可用的開發伺服器），未能另行啟動全新 dev server 於瀏覽器中互動驗證；本變更僅新增按鈕與一個透過既有、已受測試覆蓋的 `setAnimationDraft` 狀態更新模式實作的純陣列搬移函式，風險低，且與本 session 中多項同類「動畫編輯器 UI 微調」項目（如 `feature/animation-effect-seek-midpoint-20260615`、`feature/animation-effect-multi-select-merge-20260615`）採用相同的 `tsc --noEmit` + `npm run build` 驗證水準一致。已 commit 至分支 `feature/animation-effects-reorder-20260615`（commit 8857c60）。

- 時間: 2026-06-15 22:20:00 +0800
- 分支: feature/drawing-mode-auto-pause-20260615
- 內容: 由於 master 中 TODO.md 當下仍無未完成的 `[ ]` 項目，依 CLAUDE.md 指示再次改挑選一項「未追蹤但已規劃」的工作：`docs/animation-slide-v1-design.md` §12「後續擴充方向」V1.1 項目中的「drawing mode 自動暫停」。播放頁的手寫標註功能（`PlayPage.tsx` 的 `drawingMode`/`setDrawingMode`，可透過 `w` 快捷鍵切換、`canUseDrawingTools` 限定 `!syncEnabled || syncRole === 'master'`）原本與播放/暫停狀態（`isPlaying`、`<audio>` 元素）完全獨立：講者進入手寫模式繪圖時，若音檔仍在播放，投影片會依逐字稿/動畫排程繼續播放、甚至自動切到下一頁，導致畫面在繪圖途中被打斷或切換。\n\n實作：於 `frontend/src/pages/PlayPage.tsx` 既有「同步模式下手寫工具僅 master 可用，否則強制關閉手寫模式」的 `useEffect` 之後，新增一個對稱的 `useEffect（依賴陣列 [drawingMode]）`：當 `drawingMode` 變為 `true` 時呼叫 `audioRef.current?.pause()`。`<audio>` 元素既有的 `onPause={() => setIsPlaying(false)}` 會同步更新 `isPlaying` 狀態，使播放鍵 UI、`slideAnimationPlaying`（驅動 `SlideRenderer` 的 GSAP timeline）等所有依賴 `isPlaying` 的邏輯一致進入暫停狀態，不需額外處理。此 effect 只在 `drawingMode` 變為 `true` 時觸發 `pause()`；若音檔本來就是暫停狀態，`audio.pause()` 為無副作用的重複呼叫。涵蓋兩條既有的開關路徑：鍵盤 `w` 快捷鍵（`setDrawingMode((prev) => !prev)`）與（若未來新增）任何透過 context 的 `setDrawingMode(true)` UI 操作，皆會觸發自動暫停；離開手寫模式（`drawingMode` 變為 `false`，例如按 `Escape` 或 `PlayPageFullscreen.tsx` 的 ✕ 按鈕）則不會自動恢復播放，由使用者自行決定是否繼續播放。\n\n並同步更新 `docs/animation-slide-v1-design.md` §12 V1.1 項目，將「drawing mode 自動暫停」加上刪除線並註記已於本分支完成。驗證：`npx tsc --noEmit`（frontend）通過；`npm run build`（frontend, vite build）通過。本變更為單一 `useEffect`（7 行），重用既有的 `audioRef`/`drawingMode`/`onPause` 狀態管線，不影響其他功能；專案中無 `PlayPage.tsx` 的既有單元測試可供擴充，且環境中既有背景 dev server 為其他分支的過期殘留程序而無法另行啟動互動瀏覽器驗證，驗證水準與本 session 先前同類「PlayPage 互動行為微調」項目（如 `feature/animation-effect-seek-midpoint-20260615`）一致。已 commit 至分支 `feature/drawing-mode-auto-pause-20260615`（commit 088a00c）。

- 時間: 2026-06-15 22:50:00 +0800
- 分支: feature/animation-effects-raw-json-view-20260615
- 內容: 由於 master 中 TODO.md 當下仍無未完成的 `[ ]` 項目，依 CLAUDE.md 指示再次改挑選一項「未追蹤但已規劃」的工作：`docs/animation-slide-v1-design.md` §12「後續擴充方向」V1.1 項目中的「raw JSON 檢視」。動畫編輯器（`AnimationEditorTab.tsx`）先前已有「效果清單」/「逐字稿動畫指引」兩個 notebook 分頁（`notebookTab: 'effects' | 'hints'`），但使用者若想檢視目前頁面 `AnimationSpec` 完整的原始 JSON（例如用於除錯、回報問題時附上設定內容，或在多頁之間手動比對效果設定），並無任何途徑，只能透過瀏覽器開發工具自行從 React state 中查找。\n\n實作：於 `frontend/src/pages/play/AnimationEditorTab.tsx` 將 `notebookTab` 型別擴充為 `'effects' | 'hints' | 'json'`，並在既有分頁列（`effects`/`hints`）後新增第三個分頁按鈕「原始 JSON」（`play.animation.rawJson`），樣式與既有分頁按鈕一致（啟用時 `bg-slate-800 text-fuchsia-200`）。原本 `notebookTab === 'effects' ? (...) : (...)` 的二選一條件式改為 `notebookTab === 'effects' ? (...) : notebookTab === 'hints' ? (...) : (...)` 三分支，其中「效果清單」與「逐字稿動畫指引」兩段內容完全不變，新增的第三分支顯示：(1) 一行說明文字（`play.animation.rawJsonDescription`，註明此處唯讀，編輯請至效果清單）與一個「複製 JSON」按鈕（`play.animation.copyJson`/`play.animation.copyJsonDone`）；(2) 一個 `readOnly`、`spellCheck={false}`、`rows={20}`、`font-mono text-xs` 的 `<textarea>`，內容為 `JSON.stringify(draft, null, 2)`（`draft = animationDraft ?? defaultAnimationSpec()`，與「效果清單」分頁讀取的是同一份 state，因此編輯效果後立即反映在 JSON 檢視中）。複製按鈕呼叫 `navigator.clipboard.writeText(JSON.stringify(draft, null, 2))`，成功後將 `jsonCopied`（新增的 `useState(false)`）設為 `true`，按鈕文字暫時改為「已複製」，1.5 秒後（`setTimeout`）還原為「複製 JSON」；此複製/還原互動與 `ShareDialog.tsx` 既有「複製連結」按鈕的 `navigator.clipboard.writeText()` 用法一致。新增 i18n 翻譯鍵 `play.animation.rawJson`／`rawJsonDescription`／`copyJson`／`copyJsonDone`（`zh-TW.ts`/`en.ts`，插入於 `hintsPlaceholder` 之後）。\n\n並同步更新 `docs/animation-slide-v1-design.md` §12 V1.1 項目，將「raw JSON 檢視」加上刪除線並註記已於本分支完成。驗證：`npx tsc --noEmit`（frontend）通過；`npm run build`（frontend, vite build）通過；`npx tsx --test src/lib/animationSpec.test.ts` 28/28 通過（本變更未修改 `animationSpec.ts`，僅新增唯讀檢視 UI，跑此測試確認既有行為未受影響）。本變更僅新增一個唯讀分頁與一個沿用既有 `navigator.clipboard` 模式的複製按鈕，不影響 `AnimationSpec` 的讀寫邏輯，風險低；環境中既有背景 dev server 為其他分支的過期殘留程序而無法另行啟動互動瀏覽器驗證，驗證水準與本 session 先前同類「動畫編輯器 notebook 分頁」項目（`feature/animation-effects-hints-notebook-20260615`、`feature/animation-effects-reorder-20260615`）一致。已 commit 至分支 `feature/animation-effects-raw-json-view-20260615`（commit f77f876）。

- 時間: 2026-06-15 23:15:00 +0800
- 分支: feature/animation-effects-cross-page-copy-20260615
- 內容: 由於 master 中 TODO.md 當下仍無未完成的 `[ ]` 項目，依 CLAUDE.md 指示再次改挑選一項「未追蹤但已規劃」的工作：`docs/animation-slide-v1-design.md` §12「後續擴充方向」V1.1 項目中的「跨頁複製」。動畫編輯器（`AnimationEditorTab.tsx`）中，每個效果都僅綁定於目前頁面的 `AnimationSpec.effects`，若多個頁面需要相同或相似的動畫效果組合（例如多張標題頁共用同一組進場動畫），使用者必須逐頁手動重新新增與調整效果設定，沒有任何跨頁覆用的捷徑。\n\n實作：於 `frontend/src/pages/play/AnimationEditorTab.tsx` 新增 `generateEffectId()` 輔助函式（自原本 `newEffect()` 中抽出，優先使用 `crypto.randomUUID()`，不支援時退回 `effect-${Date.now()}-${Math.random()...}` 格式），`newEffect()` 改為呼叫此函式產生 `id`，供新增效果與貼上複製效果共用同一套產生新 `id` 的邏輯，避免 `id` 碰撞。新增元件層級狀態 `copiedEffects: SlideAnimationEffect[] | null`（初始為 `null`），此狀態刻意未納入既有依 `currentPage?.page_number` 變化而重置 `selectedEffectIds` 的 `useEffect` 中——由於 `AnimationEditorTab` 元件實例會在切換頁面時持續存在（既有的 `selectedEffectIds` 重置邏輯即證明了這點），因此 `copiedEffects` 會在使用者切換到其他頁面後仍保留，讓「複製本頁效果」與「貼上效果」可以跨頁操作。\n\n新增兩個處理函式：`handleCopyPageEffects()` 在 `draft.effects.length === 0` 時不做任何事，否則以 `structuredClone(draft.effects)` 深拷貝目前頁面的效果陣列存入 `copiedEffects`；`handlePastePageEffects()` 在 `copiedEffects` 為空（`null` 或長度為 0）時不做任何事，否則透過 `setAnimationDraft((prev) => ...)` 計算目前頁面效果清單的剩餘容量 `room = MAX_SLIDE_ANIMATION_EFFECTS - base.effects.length`，若 `room <= 0` 則不變更，否則取 `copiedEffects.slice(0, room)`，對每個效果以 `{ ...effect, id: generateEffectId() }` 產生全新 `id`（避免與目前頁面既有效果或來源頁面效果的 `id` 衝突），並附加到 `base.effects` 陣列末端。\n\n在效果清單分頁的工具列（既有「合併已選效果」按鈕區塊之後）新增兩個按鈕：「複製本頁效果」（`play.animation.copyPageEffects`，`title` 為 `play.animation.copyPageEffectsHint`），在 `draft.effects.length === 0` 時停用；以及「貼上效果 (n)」（`play.animation.pastePageEffects`，`title` 為 `play.animation.pastePageEffectsHint`），僅在 `copiedEffects && copiedEffects.length > 0` 時顯示，按鈕文字附加目前暫存的效果數量，並在 `draft.effects.length >= MAX_SLIDE_ANIMATION_EFFECTS` 時停用。新增 i18n 翻譯鍵 `play.animation.copyPageEffects`／`copyPageEffectsHint`／`pastePageEffects`／`pastePageEffectsHint`（`zh-TW.ts`/`en.ts`，插入於 `mergeSelected` 之後）。\n\n並同步更新 `docs/animation-slide-v1-design.md` §12 V1.1 項目，將「跨頁複製」加上刪除線並註記已於本分支完成（複製結果存於不隨頁面切換清空的本地狀態，貼上時為每個效果產生新的 `id` 並附加到目前頁面的效果清單，上限為 `MAX_SLIDE_ANIMATION_EFFECTS`）。驗證：`npx tsc --noEmit`（frontend）通過；`npm run build`（frontend, vite build）通過；`npx tsx --test src/lib/animationSpec.test.ts` 28/28 通過（本變更未修改 `animationSpec.ts`，僅新增複製/貼上的 UI 與 state 操作，跑此測試確認既有行為未受影響）。本變更僅新增一組複製/貼上按鈕與一份不影響既有 state 結構的暫存陣列，新增的效果一律走既有 `setAnimationDraft` 更新路徑並受 `MAX_SLIDE_ANIMATION_EFFECTS` 上限保護，風險低；環境中既有背景 dev server 為其他分支的過期殘留程序而無法另行啟動互動瀏覽器驗證，驗證水準與本 session 先前同類「動畫編輯器」項目（`feature/animation-effects-raw-json-view-20260615`、`feature/animation-effects-reorder-20260615`）一致。已 commit 至分支 `feature/animation-effects-cross-page-copy-20260615`（commit fab07ac）。

- 時間: 2026-06-15 23:40:00 +0800
- 分支: feature/animation-effect-presets-20260615
- 內容: 由於 master 中 TODO.md 當下仍無未完成的 `[ ]` 項目，依 CLAUDE.md 指示再次改挑選一項「未追蹤但已規劃」的工作：`docs/animation-slide-v1-design.md` §12「後續擴充方向」V1.1 項目中的最後一項——為 `fade-in`/`zoom-*`/`pan-*` 等整頁 transform 效果提供對稱的「消失（恢復原狀）」可選機制。`SlideAnimationEffect.exitDuration` 欄位先前（§5.3）僅對 `OVERLAY_EFFECT_TYPES`（`highlight-box`/`spotlight`/`pointer`/`text-callout`/`custom-script`）有效，語意為「淡入完成後維持顯示 `exitDuration` 秒，再自動淡出（`autoAlpha: 1 → 0`）」；對 `fade-in`/`zoom-in`/`zoom-out`/`pan-left`/`pan-right`/`pan-up`/`pan-down` 這 7 種整頁 transform 效果，後端 `EffectSchema.exitDuration` 雖然已允許任意效果類型填入此欄位，但前端 `buildGsapTimeline.ts` 完全忽略它，使用者勾選後不會有任何效果，UI 上也未顯示該控制項。\n\n實作：(1) `frontend/src/lib/animationSpec.ts` 新增匯出常數 `TRANSFORM_EFFECT_TYPES`（`['fade-in','zoom-in','zoom-out','pan-left','pan-right','pan-up','pan-down']`），並更新 `DEFAULT_EXIT_DURATION_SECONDS` 的文件註解說明其同時適用於 overlay「自動消失」與 transform「自動恢復原狀」兩種語意。(2) `frontend/src/types.ts` 更新 `SlideAnimationEffect.exitDuration` 的文件註解，移除原先「transform 效果忽略此欄位」的說明，改為描述依效果類型而異的雙重語意。(3) `frontend/src/components/slide/buildGsapTimeline.ts` 重構：抽出新函式 `transformFromTo(effect)`，回傳 7 種 transform 效果各自的進場 `from`/`to` GSAP vars（例如 `fade-in` 為 `{autoAlpha:0}`→`{autoAlpha:1}`、`zoom-in` 為 `{scale: fromScale}`→`{scale: toScale}`、`pan-left` 為 `{xPercent:d}`→`{xPercent:-d}`，`d=panDistance(effect)`），非 transform 效果回傳 `null`。主迴圈中若 `transformFromTo(effect)` 非 `null`，先以 `tl.fromTo(stage, from, {...to, ...common}, effect.start)` 建立進場 tween；若 `effect.exitDuration !== undefined`，再加一個 `tl.to(stage, {...from, ...common}, effect.start + effect.duration + effect.exitDuration)` 將整頁 `stage` 動畫回進場前的狀態（進場 tween 的反向，相同 `duration`/`ease`），時間點公式與既有 overlay「自動消失」完全一致（`start+duration+exitDuration`），以維持與 `animationTimelineDurationSeconds()` 既有公式（及其測試）的一致性，未變動該函式。overlay 效果（`highlight-box`/`spotlight`/`pointer`/`text-callout`/`custom-script`）的處理邏輯完全不變。(4) `frontend/src/pages/play/AnimationEditorTab.tsx`：將 `TRANSFORM_EFFECT_TYPES` 加入 import；既有「顯示後自動消失」checkbox+數字輸入框 UI 區塊的顯示條件由 `OVERLAY_EFFECT_TYPES.includes(effect.type)` 改為 `(OVERLAY_EFFECT_TYPES.includes(effect.type) || TRANSFORM_EFFECT_TYPES.includes(effect.type))`，並依類型切換標籤文字：overlay 效果沿用 `play.animation.exitDuration`（顯示後自動消失），transform 效果改用新鍵 `play.animation.exitDuration.transform`（完成後自動恢復原狀）；勾選框/數字輸入/秒數單位元件本身共用不變。(5) 新增 i18n 鍵 `play.animation.exitDuration.transform`（`zh-TW.ts`: 「完成後自動恢復原狀」、`en.ts`: "Auto-revert after"），插入於既有 `play.animation.exitDuration` 之後。\n\n並同步更新 `docs/animation-slide-v1-design.md`：§5.3 標題改為「效果自動消失／恢復原狀（exitDuration）」，說明 `exitDuration` 現適用於所有效果類型，並依 `OVERLAY_EFFECT_TYPES`／`TRANSFORM_EFFECT_TYPES` 分述「自動消失」（overlay 淡出）與「自動恢復原狀」（transform 反向 tween）兩種第二段動畫語意及各自的渲染方式；§12 V1.1 項目將此項加上刪除線並註記已於本分支完成，使 V1.1 清單全部項目皆已完成。驗證：`npx tsc --noEmit`（frontend）通過；`npm run build`（frontend, vite build）通過；`npx tsx --test src/lib/animationSpec.test.ts` 28/28 通過（確認 `animationTimelineDurationSeconds` 等既有公式未受影響）。`buildGsapTimeline.ts` 無既有單元測試可供擴充；本變更為既有 `fromTo`/`to` tween 模式的延伸（重用 overlay exit 的時間點公式與 UI 控制項），未變動 overlay 效果路徑，風險低；環境中既有背景 dev server 為其他分支的過期殘留程序而無法另行啟動互動瀏覽器驗證，驗證水準與本 session 先前同類「動畫編輯器/動畫渲染」項目（`feature/animation-effect-presets-20260615`、`feature/animation-merge-keep-transcript-trigger-20260615`）一致。本項為 `docs/animation-slide-v1-design.md` §12 V1.1 清單的最後一項，完成後該清單已無未完成項目；後續週期若 master TODO.md 仍無 `[ ]` 項目，需另尋工作來源（例如 §12 V2/V2.x 清單，或其他設計文件的「未來工作」章節）。已 commit 至分支 `feature/animation-transform-exit-revert-20260615`（commit 4860002）。

- 時間: 2026-06-16 00:30:00 +0800
- 分支: feature/animation-auto-focus-ai-text-callout-20260615
- 內容: 由於 master 中 TODO.md 當下仍無未完成的 `[ ]` 項目，且 §12 V1.1 清單已於前一週期全部完成，依 CLAUDE.md 指示改從設計文件「後續擴充方向」尋找下一項可獨立完成的工作：`docs/animation-slide-v1-design.md` §12 V2 項目中提到「焦點方框（`highlight-box`/`spotlight`）的時機與位置已於 §7.4 落地，`text-callout`（含 AI 生成文案）與其他效果類型的 AI 生成仍待後續」。V2 整體（overlay image、SVG 圖元、物件 target、公式、逐步條列、LLM 生成完整動畫 JSON 等）範圍過大，因此僅選定其中範圍明確、可在既有 `auto-focus-ai` 端點上自然擴充的子項：讓 AI 自動產生焦點動畫（`POST /api/pdfs/:id/pages/:n/animation/auto-focus-ai`）除了 `highlight-box`/`spotlight` 之外，也能依逐字稿內容判斷是否適合生成一段 `text-callout`（AI 自行撰寫的精簡文案）。\n\n實作：於 `backend/src/services/animationAutoFocus.ts`：(1) 將 `AUTO_FOCUS_AI_EFFECT_TYPES` 由 `['highlight-box','spotlight']` 擴充為 `['highlight-box','spotlight','text-callout']`；(2) `AutoFocusItemSchema` 新增選填欄位 `text`（`z.string().min(1).max(MAX_TEXT_CALLOUT_LENGTH)`，重用 `pageAnimation.ts` 既有匯出常數 `MAX_TEXT_CALLOUT_LENGTH = 80`）；(3) 重寫 `buildAutoFocusSystemPrompt()`：原有「show / type / 位置大小 / exitDuration」4 點判斷中，`type` 選項新增 `text-callout`（淡入一段精簡文字摘要，適合用於強化關鍵數據或結論），新增第 4 點說明 `text` 欄位（僅當 `type` 為 `text-callout` 時提供，需精簡扼要、不超過 80 字、與逐字稿同語言，建議放在畫面空白處避免遮住重點），`exitDuration` 移為第 5 點；範例 JSON 同步加入一個 `text-callout` 範例；(4) 重寫 `mapAutoFocusResponseToEffects()`：當 `type === 'text-callout'` 時，取 `item.text?.trim()`，若非空則截斷至 `MAX_TEXT_CALLOUT_LENGTH` 並設為 `effect.text`；若為空或缺漏，則整個項目退回 `type: 'highlight-box'`（且不設定 `effect.text`），避免產生空白文字框；其餘位置/大小/`exitDuration` 的 clamp 邏輯不變。\n\n由於 `POST .../auto-focus-ai`（`backend/src/routes/pdfs/page-animation.ts`）路由本身對效果類型無感知、原樣轉傳 `generateAiFocusEffects` 的輸出，且 `AnimationEffect.text`／`ALLOWED_PARAM_KEYS['text-callout']` 在 V1 階段（§5.2）已支援，本次變更不需修改路由、zod schema 或前端型別定義。\n\n新增測試（`backend/test/page-animation.test.ts`）：(a) `mapAutoFocusResponseToEffects` 對 `type: 'text-callout'` 項目正確映射 `text`（含超長文字截斷至 80 字）與既有 params/exitDuration；(b) 缺少/僅空白 `text` 的 `text-callout` 項目正確退回 `highlight-box` 且不帶 `text` 欄位；(c) `text-callout` 輸出可通過 `validateAnimationSpec`；(d) 新增一個 `POST animation/auto-focus-ai` 整合測試，mock LLM 回傳含 `text` 的 `type: 'text-callout'` 項目，驗證回應內容與 `validateAnimationSpec` 皆正確。實作過程中由 (b) 測試發現初版 `mapAutoFocusResponseToEffects` 在退回 `highlight-box` 時仍會將 `effect.text` 設為空字串 `''`（而非省略不設定），修正為：先以區域變數 `trimmed` 判斷是否有有效文字，僅在非空時才賦值給 `text` 並設定 `effect.text`，否則 `text` 維持 `undefined`。\n\n並同步更新 `docs/animation-slide-v1-design.md`：於文件頂部「擴充註記」新增 2026-06-15 條目說明本次擴充內容；§7.4 更新 AI 回應欄位列表（`type` 新增 `text-callout`、新增 `text` 欄位說明與退回邏輯），並將原「v1 範圍：僅產生 `highlight-box`/`spotlight` 焦點效果；`text-callout`...留待後續版本」改為「v1 範圍：產生 `highlight-box`/`spotlight`/`text-callout` 三種效果；overlay image/SVG/物件 target/公式/逐步條列/`custom-script` 等其他效果類型的 AI 生成留待後續版本」；§12 V2 項目將「`text-callout`（含 AI 生成文案）的 AI 生成」子句加上刪除線並註記已於本分支完成，保留 V2 其餘子項為待辦。同步調整 i18n：`play.animation.autoGenerateFocusAiConfirm`（`zh-TW.ts`/`en.ts`）的確認文案由「決定每句是否顯示焦點方框」改為「決定每句是否顯示焦點方框或文字摘要」，使其反映新增的 `text-callout` 選項。\n\n驗證：`npx tsc --noEmit`（backend 與 frontend）皆通過；`npx tsx --test backend/test/page-animation.test.ts` 全數 63 項測試通過（含本次新增的 4 項）。本變更未修改任何既有 schema 結構或路由邏輯，僅擴充 `auto-focus-ai` 既有提示詞與映射函式可選擇的效果類型集合，並有 fallback 機制保證輸出永遠是合法的 `AnimationEffect`，風險低。已 commit 至分支 `feature/animation-auto-focus-ai-text-callout-20260615`（commit d265476）。
- 內容: 由於 master 中 TODO.md 當下仍無未完成的 `[ ]` 項目，依 CLAUDE.md 指示再次改挑選一項「未追蹤但已規劃」的工作：`docs/animation-slide-v1-design.md` §12「後續擴充方向」V1.1 項目中的「preset 快速套用」。動畫編輯器（`AnimationEditorTab.tsx`）中的「＋ 新增效果」按鈕只會以 `newEffect()` 的最小預設值（`type: 'fade-in'`、`duration: 1`、`ease: 'power1.out'`，無 `params`/`exitDuration`）新增一個效果，使用者若想要常見的「重點圈選並自動消失」、「聚光燈聚焦」、「左下角文字說明」等組合，必須手動切換效果類型、調整長度/速度變化、勾選「顯示後自動消失」並輸入秒數、再調整位置/大小四個欄位，每次都要重複同樣的設定流程。\n\n實作：於 `frontend/src/pages/play/AnimationEditorTab.tsx` 在 `newEffect()` 之後新增 `EffectPreset` 介面與常數陣列 `EFFECT_PRESETS`，每個範本包含 `id`、`labelKey`（顯示名稱的 i18n 鍵）與 `apply(): Partial<SlideAnimationEffect>`（要覆寫到新效果上的欄位）。共定義 7 個範本：「標題淡入」（`fade-in`，`duration: 1.2`，`ease: power1.out`）、「鏡頭推進強調」（`zoom-in`，`duration: 2`，`ease: power1.inOut`）、「向左移動鏡頭」（`pan-left`，`duration: 2.5`，`ease: power1.inOut`）、「紅框圈選重點」（`highlight-box`，`duration: 0.8`，`exitDuration: DEFAULT_EXIT_DURATION_SECONDS`）、「聚光燈聚焦」（`spotlight`，`duration: 0.8`，`exitDuration: DEFAULT_EXIT_DURATION_SECONDS`，`params` 設為較大範圍 `{xPct:20, yPct:20, widthPct:60, heightPct:60}`）、「左下角文字說明」（`text-callout`，`duration: 1.5`，`exitDuration: DEFAULT_EXIT_DURATION_SECONDS`，`params` 置於畫面左下 `{xPct:8, yPct:78, widthPct:40, heightPct:14}`）、「指標標示」（`pointer`，`duration: 1`，`exitDuration: DEFAULT_EXIT_DURATION_SECONDS`）。新增處理函式 `handleApplyPreset(presetId)`：找出對應範本後，透過 `setAnimationDraft((prev) => ...)` 在 `base.effects.length >= MAX_SLIDE_ANIMATION_EFFECTS` 時不做任何事，否則將 `{ ...newEffect(), ...preset.apply() }`（沿用 `newEffect()` 產生的 `id`/`target`/`start` 等基本欄位，再以範本指定的欄位覆寫）附加到效果清單末端。\n\n在「＋ 新增效果」按鈕之後新增一個 `<select>` 下拉選單（`play.animation.presetApply`，`title` 為 `play.animation.presetApplyHint`），第一個選項為空字串的提示文字，其餘選項依 `EFFECT_PRESETS` 產生並顯示各自的 `labelKey`；`onChange` 時若選到的值非空則呼叫 `handleApplyPreset(presetId)`，並立即將 `e.target.value` 重設為 `''`（此 `<select>` 採用 `defaultValue=\"\"` 的非受控模式，重設後選單會顯示回提示文字，讓使用者可重複選擇同一個範本），在 `draft.effects.length >= MAX_SLIDE_ANIMATION_EFFECTS` 時停用。新增 i18n 翻譯鍵 `play.animation.presetApply`／`presetApplyHint`／`preset.titleFadeIn`／`preset.zoomInEmphasis`／`preset.panLeftReveal`／`preset.highlightCallout`／`preset.spotlightFocus`／`preset.textCalloutNote`／`preset.pointerMark`（`zh-TW.ts`/`en.ts`，插入於 `pastePageEffectsHint` 之後）。\n\n並同步更新 `docs/animation-slide-v1-design.md` §12 V1.1 項目，將「preset 快速套用」加上刪除線並註記已於本分支完成，列出全部 7 個範本名稱。驗證：`npx tsc --noEmit`（frontend）通過；`npm run build`（frontend, vite build）通過；`npx tsx --test src/lib/animationSpec.test.ts` 28/28 通過（本變更未修改 `animationSpec.ts`，僅新增一個下拉選單與一個透過既有 `setAnimationDraft` 路徑附加效果的處理函式，跑此測試確認既有行為未受影響）。每個範本套用後新增的效果與「＋ 新增效果」產生的效果結構完全相同（僅欄位初始值不同），使用者仍可在效果卡片中自由調整任何欄位，風險低；環境中既有背景 dev server 為其他分支的過期殘留程序而無法另行啟動互動瀏覽器驗證，驗證水準與本 session 先前同類「動畫編輯器」項目（`feature/animation-effects-cross-page-copy-20260615`、`feature/animation-effects-raw-json-view-20260615`）一致。已 commit 至分支 `feature/animation-effect-presets-20260615`（commit cb352dd）。

- 時間: 2026-06-16 01:30:00 +0800
- 分支: feature/animation-svg-shape-effect-20260616
- 內容: 由於 master 中 TODO.md 當下仍無未完成的 `[ ]` 項目，依 CLAUDE.md 指示再次從設計文件「後續擴充方向」尋找下一項可獨立完成的工作：`docs/animation-slide-v1-design.md` §12 V2 項目中的「SVG 圖元」子項。先前週期已將 V2 中「焦點方框時機與位置」（§7.4）與「`text-callout` 的 AI 生成」（分支 `feature/animation-auto-focus-ai-text-callout-20260615`）完成，本次選定範圍明確、與既有 `highlight-box`/`text-callout` overlay 機制高度相似、可獨立落地的「SVG 圖元」子項：新增一個 `shape` 效果類型，提供 circle/rect/ellipse/arrow 四種基本 SVG 圖元 overlay。\n\n實作：(1) `backend/src/services/pageAnimation.ts`：新增匯出常數 `ANIMATION_SHAPE_KINDS = ['circle','rect','ellipse','arrow'] as const`；`AnimationEffectType` enum 與 `EffectSchema` 新增 `'shape'` 類型與選填欄位 `shape: z.enum(ANIMATION_SHAPE_KINDS).optional()`；`ALLOWED_PARAM_KEYS` 為 `shape` 設定與 `highlight-box`/`text-callout` 相同的 `['xPct','yPct','widthPct','heightPct']`，`validateAnimationSpec` 沿用既有數值型 `params` 過濾與 `shape` enum 驗證邏輯。(2) `frontend/src/types.ts`：新增 `SlideAnimationShapeKind` 型別與 `SlideAnimationEffect.shape?: SlideAnimationShapeKind` 欄位，`SlideAnimationEffectType` 新增 `'shape'`。(3) `frontend/src/lib/animationSpec.ts`：新增 `ANIMATION_SHAPE_KINDS`、`DEFAULT_SHAPE_KIND = 'circle'`、`getShapeKind(effect)`（回傳 `effect.shape ?? DEFAULT_SHAPE_KIND`）；`SLIDE_ANIMATION_EFFECT_TYPES` 與 `OVERLAY_EFFECT_TYPES` 加入 `'shape'`；`getFocusEffectParams()` 對 `shape` 沿用既有 else 分支的 30/30/40/40 預設值，未額外修改。(4) `frontend/src/components/slide/buildGsapTimeline.ts`：overlay 效果共用的 `switch` case 中加入 `case 'shape':`，與 `highlight-box`/`spotlight`/`pointer`/`text-callout` 共用同一套 `tl.fromTo(overlay, {autoAlpha:0}, {autoAlpha:1, ...common}, effect.start)` 淡入與可選 `exitDuration` 淡出邏輯。(5) `frontend/src/components/slide/SlideRenderer.tsx`：`EffectOverlay` 新增 `effect.type === 'shape'` 分支，依 `getShapeKind(effect)` 渲染一個 `viewBox=\"0 0 100 100\"` 的 inline `<svg data-effect-id={effect.id}>`：`circle` 為置中圓形（`preserveAspectRatio=\"xMidYMid meet\"` 維持正圓）、`ellipse`/`rect` 為填滿外框的橢圓／圓角方框（`preserveAspectRatio=\"none\"`）、`arrow` 為左下指向右上的箭頭線段（含 `<marker>` 箭頭標記），四種圖元固定使用玫瑰色（`#f43f5e`）`stroke`、`fill=\"none\"`。(6) `frontend/src/pages/play/AnimationEditorTab.tsx`：effect type `<select>` 新增 `shape` 選項；新增「圖形種類」`<select>`（僅當 `effect.type === 'shape'` 時顯示），選項依 `ANIMATION_SHAPE_KINDS` 產生並對應 `play.animation.shapeKind.*` i18n 鍵；`EFFECT_PRESETS` 新增「圓圈圈選重點」範本（`shape`/`circle`/`duration: 0.8`/`exitDuration: DEFAULT_EXIT_DURATION_SECONDS`）。(7) 新增 i18n 鍵 `play.animation.type.shape`、`play.animation.shapeKind`、`play.animation.shapeKind.circle/rect/ellipse/arrow`、`play.animation.preset.shapeCircle`（`zh-TW.ts`/`en.ts`）。\n\n並同步更新 `docs/animation-slide-v1-design.md`：於文件頂部「擴充註記」新增 2026-06-16 條目說明本次擴充內容；effect type 表格新增 `shape` 一列；§5.3 OVERLAY_EFFECT_TYPES 列表與 §6.6 EffectOverlay 說明加入 `shape`；新增 §5.5「SVG 圖元效果（shape）」子章節，說明 `effect.params`/`effect.shape` 結構、四種圖元的渲染規則（含 `preserveAspectRatio` 差異）、淡入淡出機制與驗證規則，並標註 v1 範圍（固定描邊顏色與線寬、僅四種基本幾何圖元，不含自由繪製/樣式自訂）；§12 V2 項目將「SVG 圖元」子句加上刪除線並註記已於本分支完成，列出四種圖元種類。\n\n新增測試：`frontend/src/lib/animationSpec.test.ts` 新增 3 項——確認 `SLIDE_ANIMATION_EFFECT_TYPES`/`OVERLAY_EFFECT_TYPES` 含 `'shape'`、`getFocusEffectParams` 對 `shape` 套用 30/30/40/40 預設值、`getShapeKind` 在未設定時回退為 `'circle'` 且能正確讀出四種圖元種類；`backend/test/page-animation.test.ts` 新增 4 項——`validateAnimationSpec` 接受四種圖元種類與 overlay `params`、拒絕非法圖元種類、接受未指定 `shape`（前端套用預設值）、過濾 `shape` 效果中不在白名單的 `params` 欄位。\n\n驗證：`npx tsc --noEmit`（backend 與 frontend）皆通過；`npx tsx --test backend/test/page-animation.test.ts` 67/67 通過（原 63/63 + 新增 4 項）；`npx tsx --test frontend/src/lib/animationSpec.test.ts` 31/31 通過（原 28/28 + 新增 3 項）；`npm run build`（frontend, vite build）通過（既有 >500kB chunk 警告為既有問題，與本次變更無關）。本變更完全重用既有 `highlight-box`/`text-callout` overlay 的定位、淡入淡出與驗證機制，僅新增一個型別 enum 與對應渲染分支，未變動既有效果類型的行為，風險低；環境中既有背景 dev server 為其他分支的過期殘留程序而無法另行啟動互動瀏覽器驗證，驗證水準與本 session 先前同類「動畫效果類型」項目（`feature/animation-pointer-effect-20260615`、`feature/animation-auto-focus-ai-text-callout-20260615`）一致。已 commit 至分支 `feature/animation-svg-shape-effect-20260616`（commit aaf579b）。

- 時間: 2026-06-16 02:30:00 +0800
- 分支: feature/animation-step-list-effect-20260616
- 內容: 由於 master 中 TODO.md 當下仍無未完成的 `[ ]` 項目，依 CLAUDE.md 指示再次從設計文件「後續擴充方向」尋找下一項可獨立完成的工作：`docs/animation-slide-v1-design.md` §12 V2 項目中的「逐步條列」子項。先前週期已完成「焦點方框時機與位置」（§7.4）、「`text-callout` 的 AI 生成」（`feature/animation-auto-focus-ai-text-callout-20260615`）與「SVG 圖元」（`feature/animation-svg-shape-effect-20260616`），本次選定範圍明確、與既有 `text-callout`/`shape` overlay 機制高度相似、可獨立落地的「逐步條列」子項：新增一個 `step-list` 效果類型，於指定區域顯示一個條列方框，內含最多 6 條文字項目並逐一交錯淡入。\n\n實作：(1) `backend/src/services/pageAnimation.ts`：`ANIMATION_EFFECT_TYPES` 新增 `'step-list'`；新增匯出常數 `MAX_STEP_LIST_ITEMS = 6`、`MAX_STEP_LIST_ITEM_LENGTH = 60`；`AnimationEffect` 新增選填欄位 `items?: string[]`（並更新 `exitDuration` 文件註解，列入 `step-list`）；`ALLOWED_PARAM_KEYS['step-list']` 設為與 `highlight-box`/`text-callout`/`shape` 相同的 `['xPct','yPct','widthPct','heightPct']`；`EffectSchema` 新增 `items: z.array(z.string().max(MAX_STEP_LIST_ITEM_LENGTH)).max(MAX_STEP_LIST_ITEMS).optional()`（刻意不設 `.min(1)` 下限，避免編輯器多行輸入框中間編輯狀態觸發驗證錯誤）；`validateAnimationSpec` 於輸出 effect 物件中加入 `...(effect.items !== undefined ? { items: effect.items } : {})`。(2) `frontend/src/types.ts`：`SlideAnimationEffectType` 新增 `'step-list'`，`SlideAnimationEffect` 新增 `items?: string[]` 並同步更新 `exitDuration` 文件註解。(3) `frontend/src/lib/animationSpec.ts`：`SLIDE_ANIMATION_EFFECT_TYPES`/`OVERLAY_EFFECT_TYPES` 加入 `'step-list'`；新增匯出常數 `MAX_STEP_LIST_ITEMS`/`MAX_STEP_LIST_ITEM_LENGTH`（與後端同值）；`getFocusEffectParams()` 對 `step-list` 沿用既有 else 分支的 30/30/40/40 預設值，未額外修改。(4) `frontend/src/components/slide/buildGsapTimeline.ts`：因進場動畫機制與其他 overlay 不同，新增獨立的 `case 'step-list':`（不在共用的 `highlight-box`/`spotlight`/`pointer`/`text-callout`/`shape`/`custom-script` switch case 中）：容器先以 `tl.set(overlay, {autoAlpha:1}, effect.start)` 立即可見，再以 `tl.fromTo(overlay.querySelectorAll('li'), {autoAlpha:0, x:-8}, {autoAlpha:1, x:0, duration: stagger, ease: effect.ease, stagger}, effect.start)` 讓各 `<li>` 交錯淡入，其中 `stagger = effect.duration / items.length`，使全部項目播放完畢的總時長恰為 `effect.duration`；若設定 `exitDuration`，仍以整個 overlay 的 `autoAlpha: 1 → 0`（`tl.to(overlay, {autoAlpha:0, ...common}, start+duration+exitDuration)`）淡出，與其他 `OVERLAY_EFFECT_TYPES` 一致。(5) `frontend/src/components/slide/SlideRenderer.tsx`：`EffectOverlay` 新增 `effect.type === 'step-list'` 分支，渲染為一個深色半透明圓角矩形（與 `text-callout` 同色），內含 `<ul>`/`<li>` 條列清單，項目來自 `(effect.items ?? []).map(item => item.trim()).filter(item => item.length > 0)`（過濾空白項目）。(6) `frontend/src/pages/play/AnimationEditorTab.tsx`：effect type `<select>` 新增 `step-list` 選項；在 `shape` 的「圖形種類」下拉選單區塊之後、`OVERLAY_EFFECT_TYPES` 位置/大小區塊之前，新增僅當 `effect.type === 'step-list'` 時顯示的 `items` 編輯器——一個 `rows={3}` 的多行 `<textarea>`（`play.animation.stepListItems`/`stepListItemsPlaceholder`），每行對應一個條列項目，`onChange` 時依 `\n` 切分並截斷至 `MAX_STEP_LIST_ITEMS` 行、每行最多 `MAX_STEP_LIST_ITEM_LENGTH` 字，若所有行皆為空白則將 `items` 設為 `undefined`；`EFFECT_PRESETS` 新增「條列要點」範本 `step-list-points`（`duration: 2`、`exitDuration: DEFAULT_EXIT_DURATION_SECONDS`、`params` 置於畫面左上 `{xPct:8, yPct:18, widthPct:44, heightPct:40}`，`items` 留空由使用者填寫）。(7) 新增 i18n 鍵 `play.animation.type.step-list`、`play.animation.preset.stepList`、`play.animation.stepListItems`、`play.animation.stepListItemsPlaceholder`（`zh-TW.ts`/`en.ts`）。\n\n並同步更新 `docs/animation-slide-v1-design.md`：於文件頂部「擴充註記」新增 2026-06-16 條目說明本次擴充內容；effect type 表格新增 `step-list` 一列；§5.3 OVERLAY_EFFECT_TYPES 列表加入 `step-list`（並註明其 `exitDuration` 淡出仍套用整體 `autoAlpha` 機制，進場動畫機制不同見 §5.6）；新增 §5.6「逐步條列效果（step-list）」子章節，說明 `effect.items` 結構、`<ul>`/`<li>` 渲染與容器淡入後逐項交錯淡入的時間公式（`stagger = duration / items.length`）、`exitDuration` 淡出機制與驗證規則，並標註 v1 範圍（純文字、固定樣式，AI 生成留待後續）；§6.6 EffectOverlay 說明加入 `step-list` 的 `<ul>`/`<li>` 渲染描述；§12 V2 項目將「逐步條列」子句加上刪除線並註記已於本分支完成。\n\n新增測試：`backend/test/page-animation.test.ts` 新增 5 項——`validateAnimationSpec` 接受 `step-list` 連同 `items`（1~6 條，每條 ≤60 字）與 overlay `params`、接受未提供 `items`（前端套用空陣列預設）、拒絕超過 `MAX_STEP_LIST_ITEMS`（6）條的 `items`、拒絕單條超過 `MAX_STEP_LIST_ITEM_LENGTH`（60）字的項目、過濾 `step-list` 效果中不在白名單的 `params` 欄位；`frontend/src/lib/animationSpec.test.ts` 新增 3 項——確認 `SLIDE_ANIMATION_EFFECT_TYPES`/`OVERLAY_EFFECT_TYPES` 含 `'step-list'`、`getFocusEffectParams` 對 `step-list` 套用 30/30/40/40 預設值、`MAX_STEP_LIST_ITEMS`/`MAX_STEP_LIST_ITEM_LENGTH` 與後端限制一致（6/60）。\n\n驗證：`npx tsc --noEmit`（backend 與 frontend）皆通過；`npx tsx --test backend/test/page-animation.test.ts` 72/72 通過（原 67/67 + 新增 5 項）；`npx tsx --test src/lib/animationSpec.test.ts` 34/34 通過（原 31/31 + 新增 3 項）；`npm run build`（frontend, vite build）通過（既有 >500kB chunk 警告為既有問題，與本次變更無關）。本變更完全重用既有 `text-callout`/`shape` overlay 的定位、容器層級的整體淡出與驗證機制，新增的進場動畫（逐項交錯淡入）為獨立的 `buildGsapTimeline.ts` switch case，未變動既有效果類型的行為，風險低；環境中既有背景 dev server 為其他分支的過期殘留程序而無法另行啟動互動瀏覽器驗證，驗證水準與本 session 先前同類「動畫效果類型」項目（`feature/animation-svg-shape-effect-20260616`、`feature/animation-auto-focus-ai-text-callout-20260615`）一致。已 commit 至分支 `feature/animation-step-list-effect-20260616`（commit 6b53d14），並已 `git merge --no-edit` 回 master。

- 時間: 2026-06-16 03:15:00 +0800
- 分支: feature/animation-auto-focus-ai-shape-step-list-20260616
- 內容: 由於 master 中 TODO.md 當下仍無未完成的 `[ ]` 項目，依 CLAUDE.md 指示再次從設計文件「後續擴充方向」尋找下一項可獨立完成的工作：`docs/animation-slide-v1-design.md` §12 V2 項目中「`custom-script` 等其他效果類型的 AI 生成、overlay image、物件 target、公式仍待後續」一句。V2 整體範圍過大，因此選定其中與既有 `auto-focus-ai`（§7.4）端點高度相似、可獨立落地的子項：將 `auto-focus-ai` 的可生成效果類型擴充為包含先前週期新增的 `shape`（分支 `feature/animation-svg-shape-effect-20260616`）與 `step-list`（分支 `feature/animation-step-list-effect-20260616`），讓 AI 除了 `highlight-box`/`spotlight`/`text-callout` 之外，也能依逐字稿內容選擇以 SVG 圖元標示位置，或將多個步驟/要點整理成條列清單。\n\n實作：於 `backend/src/services/animationAutoFocus.ts`：(1) 由 `pageAnimation.ts` 新增 import `ANIMATION_SHAPE_KINDS`/`MAX_STEP_LIST_ITEMS`/`MAX_STEP_LIST_ITEM_LENGTH`；(2) 將 `AUTO_FOCUS_AI_EFFECT_TYPES` 由 `['highlight-box','spotlight','text-callout']` 擴充為再加上 `'shape'`/`'step-list'`；(3) `AutoFocusItemSchema` 新增選填欄位 `shape: z.enum(ANIMATION_SHAPE_KINDS).optional()` 與 `items: z.array(z.string().min(1).max(MAX_STEP_LIST_ITEM_LENGTH)).max(MAX_STEP_LIST_ITEMS).optional()`；(4) 重寫 `buildAutoFocusSystemPrompt()`：`type` 選項新增 `shape`（淡入一個 SVG 圖元，用於標示位置）與 `step-list`（淡入一個條列步驟/要點清單方框），新增第 5 點說明 `shape` 欄位（僅當 `type` 為 `shape` 時提供，從 `circle`/`rect`/`ellipse`/`arrow` 選擇）、第 6 點說明 `items` 欄位（僅當 `type` 為 `step-list` 時提供，最多 6 項、每項最長 60 字），`exitDuration` 移為第 7 點；範例 JSON 同步加入 `shape`（`arrow`）與 `step-list`（三項步驟）兩個範例；(5) 重寫 `mapAutoFocusResponseToEffects()`：當 `type === 'shape'` 時，若 AI 提供 `shape` 欄位則設為 `effect.shape`，否則保留 `undefined`（前端渲染時依 `getShapeKind()` 預設為 `circle`）；當 `type === 'step-list'` 時，將 `item.items` 逐項 `trim()`、過濾空字串、截斷至 `MAX_STEP_LIST_ITEMS` 項與每項 `MAX_STEP_LIST_ITEM_LENGTH` 字後設為 `effect.items`，若處理後無任何有效項目，則整個項目退回 `type: 'highlight-box'`（與 `text-callout` 缺少文字時相同的退回邏輯）。\n\n新增測試（`backend/test/page-animation.test.ts`，新增 import `ANIMATION_SHAPE_KINDS`）：(a) `mapAutoFocusResponseToEffects` 對 `type: 'shape'` 項目正確映射 `shape` 欄位（含未提供時維持 `undefined`）；(b) 四種圖元種類的 `shape` 輸出皆可通過 `validateAnimationSpec`；(c) `mapAutoFocusResponseToEffects` 對 `type: 'step-list'` 項目正確映射 `items`（去除空白/空字串、截斷至 6 項與每項 60 字）；(d) 缺少有效 `items` 的 `step-list` 項目正確退回 `highlight-box`；(e) `step-list` 輸出可通過 `validateAnimationSpec`；(f) 新增一個 `POST animation/auto-focus-ai` 整合測試，mock LLM 同時回傳 `shape`（`arrow`）與 `step-list`（三項步驟）效果，驗證回應內容與 `validateAnimationSpec` 皆正確。\n\n並同步更新 `docs/animation-slide-v1-design.md`：於文件頂部「擴充註記」新增 2026-06-16 條目說明本次擴充內容；§7.4 更新 AI 回應欄位列表（`type` 新增 `shape`/`step-list`，新增 `shape`/`items` 欄位說明與 `step-list` 的退回邏輯），並將原「v1 範圍：產生 `highlight-box`/`spotlight`/`text-callout` 三種效果；overlay image、SVG 圖元、物件 target、公式、逐步條列、`custom-script` 等其他效果類型的 AI 生成留待後續版本」改為「v1 範圍：產生 `highlight-box`/`spotlight`/`text-callout`/`shape`/`step-list` 五種效果；overlay image、物件 target、公式、`custom-script` 等其他效果類型的 AI 生成留待後續版本」；§12 V2 項目將「`auto-focus-ai` 的 `shape`/`step-list` AI 生成」子句加上刪除線並註記已於本分支完成，保留 `custom-script` 的 AI 生成、overlay image、物件 target、公式為待辦。同步調整 i18n：`play.animation.autoGenerateFocusAiConfirm`（`zh-TW.ts`/`en.ts`）的確認文案由「決定每句是否顯示焦點方框或文字摘要」改為「決定每句是否顯示焦點方框、圖形、條列清單或文字摘要」，使其反映新增的 `shape`/`step-list` 選項。\n\n驗證：`npx tsc --noEmit`（backend 與 frontend）皆通過；`npx tsx --test backend/test/page-animation.test.ts` 78/78 通過（原 72/72 + 新增 6 項）；`npm run build`（frontend, vite build）通過（既有 >500kB chunk 警告為既有問題，與本次變更無關）；以 `npx tsx --test test/*.test.ts` 執行全量 backend 測試，155 項中 18 項失敗，與 master 基準（149 項中 18 項失敗）比對確認為同一批既有環境問題（與本次變更無關）。本變更完全重用既有 `text-callout` 的退回模式（缺少有效內容時退回 `highlight-box`），未變動現有效果類型的提示詞或映射邏輯，風險低。已 commit 至分支 `feature/animation-auto-focus-ai-shape-step-list-20260616`（commit 8f32146）。

- 時間: 2026-06-16 04:00:00 +0800
- 分支: feature/regenerate-animation-ai-focus-20260616
- 內容: 處理使用者回報的 bug：「重生動畫似乎沒有正確執行，它只產生了一堆一樣的效果。而且速度很快，是否沒有真的呼叫 AI 或失敗了。」。診斷確認 `backend/src/worker/regenerate.ts` 的 `runRegenerateAnimations`（批量「重生」對話框的「動畫」步驟）原先呼叫純規則式的 `generateRuleBasedFocusEffects`，依逐字稿句數對每句產生完全相同的 `highlight-box` 效果，從未呼叫 AI，因此速度極快且結果單一。透過 `AskUserQuestion` 向使用者呈現此發現與替代方案（沿用現有「🤖 AI 自動產生焦點動畫」按鈕所用的 `generateAiFocusEffects`），使用者選擇「改成呼叫 AI（逐句、逐頁）」。實作：(1) `backend/src/services/animationAutoFocus.ts` 新增匯出 helper `loadFocusAiPageImageDataUrl(absImagePath, logContext)`，將原本僅供 `page-animation.ts` 使用的頁面截圖載入/縮放/JPEG 編碼邏輯抽成共用函式（失敗時 `logger.warn` 並回退為 `null`，走純文字模式），並移除已不再使用的 `generateRuleBasedFocusEffects` 及其相關常數。(2) `backend/src/routes/pdfs/page-animation.ts` 的 `loadAnimationPageImageDataUrl` 改為呼叫上述共用 helper，移除不再需要的 `sharp`/`config`/`logger` import。(3) `backend/src/worker/regenerate.ts` 新增 helper `readExistingAnimationSpec(pdfId, pageUid)`（讀取既有 `.animation.json`，經 `parseStoredAnimationSpec` 解析，失敗則回退 `defaultAnimationSpec()`），並重寫 `runRegenerateAnimations`：對每頁讀取 `script_path`/`text_path`/`image_path`，以 `splitScriptIntoSentences` 切分逐字稿句子，讀取既有 spec 取得 `hints`，透過 `loadFocusAiPageImageDataUrl` 載入頁面截圖，呼叫 `generateAiFocusEffects()` 並帶入 `pageText`/`sentences`/`hints`/`imageDataUrl`，產生 `spec = { version: 1, enabled: effects.length > 0, effects, hints? }` 並整份覆寫寫入 `.animation.json`，同步更新 DB 的 `render_type`/`animation_spec_path`/`updated_at`。(4) 移除 `backend/test/textSentences.test.ts` 中針對已刪除 `generateRuleBasedFocusEffects` 的兩項測試與相關 import，該檔僅保留 `splitScriptIntoSentences` 測試。(5) 更新 `frontend/src/pages/play/RegenAllDialog.tsx`「動畫」勾選項下方的說明文字，由原本描述「依句子數量產生相同醒目方框」改為說明將逐頁呼叫 AI（與「🤖 AI 自動產生焦點動畫」相同邏輯）並提醒費用/時間隨頁數增加。(6) 新增 `backend/test/regenerate-animations.test.ts`，含 2 項測試：第一項以 2 頁 PDF 驗證每頁各呼叫一次 AI（`calls === 2`），AI 回傳的效果正確映射為 `highlight-box`（`startTrigger`/`params`/`exitDuration`），且第一頁既有的 `hints`（`{'0':'強調營收數字'}`）會被讀出並保留在新 spec 中、第二頁無 `hints` 時維持 `undefined`，第一頁原有的舊規則式效果（`id: 'old-effect'`）被整份覆寫取代；第二項驗證當 AI 對唯一句子回傳 `show: false` 時，寫入 `enabled: false`、`effects: []` 的空 spec，且 `render_type` 變為 `static-image`。驗證：`npx tsc --noEmit`（backend）通過；`backend/test/page-animation.test.ts` 78/78 通過（未受影響，確認共用 helper 抽取未破壞既有「🤖 AI 自動產生焦點動畫」端點）；以 `../scripts/with-node-env.sh npx tsx --test test/regenerate-animations.test.ts test/textSentences.test.ts` 執行，4 項全數通過。已 commit 至分支 `feature/regenerate-animation-ai-focus-20260616`（commit 9b7ed56），並已 `git merge --no-edit` 回 master。

- 時間: 2026-06-16 05:00:00 +0800
- 分支: feature/animation-overlay-image-effect-20260616
- 內容: 由於 master 中 TODO.md 當下仍無未完成的 `[ ]` 項目，依 CLAUDE.md 指示再次從設計文件「後續擴充方向」尋找下一項可獨立完成的工作：`docs/animation-slide-v1-design.md` §12 V2 項目中的「overlay image（小圖疊加內容）」子項。先前某個週期（「Cycle K」）已針對此項留下一份範圍完整但尚未整合的 WIP（`git stash`，11 個檔案、165 行），本次接續該 WIP，將「overlay image」落地為新增一個 `overlay-image` 效果類型：可從該頁 PDF 已擷取的圖表素材（`feature/figure-asset-browser-20260615` 新增的 `GET /api/pdfs/:id/pages/:n/figures` 與 `GET /api/pdfs/:id/figures/:figureId/image`）中選取單張圖片，以與 `highlight-box`/`text-callout`/`shape`/`step-list` 相同的定位/淡入/`exitDuration` 機制疊加顯示於投影片上。\n\n實作：先建立分支 `feature/animation-overlay-image-effect-20260616`（因該分支名已存在但無獨立 commit，先 `git merge --ff-only master` 快轉至最新 master 再 `git stash pop` 還原 WIP），並補齊測試與文件。(1) `backend/src/services/pageAnimation.ts`：`ANIMATION_EFFECT_TYPES` 新增 `'overlay-image'`；新增匯出常數 `MAX_OVERLAY_IMAGE_FIGURE_ID_LENGTH = 200`（對應 `figures.ts` 的 `FigureImageParamSchema.figureId` 上限）；`AnimationEffect` 新增選填欄位 `figureId?: string`；`ALLOWED_PARAM_KEYS['overlay-image']` 設為與其他 overlay 類型相同的 `['xPct','yPct','widthPct','heightPct']`；`EffectSchema` 新增 `figureId: z.string().min(1).max(MAX_OVERLAY_IMAGE_FIGURE_ID_LENGTH).optional()`；`validateAnimationSpec` 輸出 effect 物件中加入 `...(effect.figureId !== undefined ? { figureId: effect.figureId } : {})`；`exitDuration` 文件註解列入 `overlay-image`。(2) `frontend/src/lib/animationSpec.ts`：`SLIDE_ANIMATION_EFFECT_TYPES`/`OVERLAY_EFFECT_TYPES` 加入 `'overlay-image'`；新增匯出常數 `MAX_OVERLAY_IMAGE_FIGURE_ID_LENGTH = 200`（與後端同值）；`getFocusEffectParams()` 對 `overlay-image` 沿用既有 else 分支的 30/30/40/40 預設值。(3) `frontend/src/types.ts`：`SlideAnimationEffectType` 新增 `'overlay-image'`，`SlideAnimationEffect` 新增 `figureId?: string` 並更新 `exitDuration` 文件註解。(4) `frontend/src/components/slide/buildGsapTimeline.ts`：overlay 共用 `autoAlpha` fromTo/exit 的 `switch` 中加入 `case 'overlay-image':`，與 `highlight-box`/`spotlight`/`pointer`/`text-callout`/`shape`/`custom-script` 共用同一套淡入/可選淡出邏輯。(5) `frontend/src/components/slide/SlideRenderer.tsx`：`EffectOverlay` 新增 prop `resolveFigureImageUrl?: (figureId: string) => string`，並新增 `effect.type === 'overlay-image'` 分支：若 `effect.figureId` 或 `resolveFigureImageUrl` 未設定則不渲染任何內容，否則渲染一個 `<img>`（`objectFit: 'contain'`，套用既有 overlay 定位樣式）；`SlideRendererProps` 新增對應 prop 並轉傳。(6) `frontend/src/lib/api/pdfs.ts`：新增匯出函式 `figureImageUrl(pdfId, figureId)`，回傳 `api/pdfs/${pdfId}/figures/${figureId}/image`（對應既有後端路由）。(7) `frontend/src/pages/play/AnimationEditorTab.tsx`：effect type `<select>` 新增 `overlay-image` 選項；新增狀態 `pageFigures`，於頁面變更時呼叫 `fetchPageFigures(pdfId, pageNumber, currentShareToken)`；當 `effect.type === 'overlay-image'` 時顯示載入中/無圖表/`<select>`（依 caption 或 id 列出本頁圖表）+ 縮圖預覽（`figureImageUrl`）三種狀態；`EFFECT_PRESETS` 新增「插入頁面圖片」範本 `overlay-image-figure`（`duration: 0.8`、`ease: power1.out`、`exitDuration: DEFAULT_EXIT_DURATION_SECONDS`、`params: {xPct:55, yPct:55, widthPct:35, heightPct:35}`）。(8) `frontend/src/pages/play/PlayPageFullscreen.tsx`/`PlayPageSlidePanel.tsx`：傳入 `resolveFigureImageUrl={pdfId ? (figureId) => withShareToken(figureImageUrl(pdfId, figureId)) ?? figureImageUrl(pdfId, figureId) : undefined}` 給 `<SlideRenderer>`。(9) 新增 i18n 鍵 `play.animation.preset.overlayImage`、`play.animation.type.overlay-image`、`play.animation.overlayImageFigure`、`play.animation.overlayImageSelectFigure`、`play.animation.overlayImageNoFigures`、`play.animation.overlayImageLoading`（`zh-TW.ts`/`en.ts`）。\n\n新增測試：`backend/test/page-animation.test.ts` 新增 5 項——`validateAnimationSpec` 接受帶 `figureId`+overlay `params` 的 `overlay-image` 效果、接受未提供 `figureId`（尚未設定圖片）、拒絕空字串 `figureId`、`figureId` 長度上限 `MAX_OVERLAY_IMAGE_FIGURE_ID_LENGTH`（200 字元，超過則拒絕）、過濾 `overlay-image` 效果中不在白名單的 `params` 欄位；`frontend/src/lib/animationSpec.test.ts` 新增 3 項——確認 `SLIDE_ANIMATION_EFFECT_TYPES`/`OVERLAY_EFFECT_TYPES` 含 `'overlay-image'`、`getFocusEffectParams` 對 `overlay-image` 套用 30/30/40/40 預設值、`MAX_OVERLAY_IMAGE_FIGURE_ID_LENGTH` 與後端限制一致（200）。\n\n並同步更新 `docs/animation-slide-v1-design.md`：於文件頂部「擴充註記」新增 2026-06-16 條目說明本次擴充內容；effect type 表格新增 `overlay-image` 一列；新增 §5.7「圖片插入效果（overlay-image）」子章節，說明 `effect.params`/`effect.figureId` 結構、圖表素材來源 API、`<img>` 渲染方式（透過 `resolveFigureImageUrl`）、驗證規則，並標註 v1 範圍（僅可手動從既有圖表中選取，AI 自動選圖/產生新圖留待後續）；§6.6 EffectOverlay 說明加入 `overlay-image` 與 `<img>`；§12 V2 項目將「overlay image」子句加上刪除線並註記已於本分支完成。\n\n驗證：`npx tsc --noEmit`（backend 與 frontend）皆通過；`npx tsx --test src/lib/animationSpec.test.ts` 37/37 通過（原 34/34 + 新增 3 項）；以 `../scripts/with-node-env.sh npx tsx --test test/*.test.ts` 執行全量 backend 測試，160 項中 142 項通過、18 項失敗，逐一比對確認 18 項失敗皆為既有已知環境問題（檔名清理、YouTube 來源驗證、頁面 CRUD/重生/回滾的 401 AUTH_REQUIRED 等），與本次新增的 5 項 `overlay-image` 測試無關，亦與既有基準一致；`npm run build`（frontend, vite build）通過（既有 >500kB chunk 警告為既有問題，與本次變更無關）。本變更完全重用既有 `highlight-box`/`text-callout`/`shape`/`step-list` overlay 的定位、淡入淡出與驗證機制，僅新增一個圖片來源欄位與對應渲染分支，未變動既有效果類型的行為，風險低；環境中既有背景 dev server 為其他分支的過期殘留程序而無法另行啟動互動瀏覽器驗證，驗證水準與本 session 先前同類「動畫效果類型」項目（`feature/animation-step-list-effect-20260616`、`feature/animation-svg-shape-effect-20260616`）一致。\n\n另外，本次作業開始時發現 master 工作樹尚有一份未提交的文件變更（`docs/animation-slide-v1-design.md` 的 4 行新增，為前一週期 `feature/regenerate-animation-ai-focus-20260616`（commit 9b7ed56）功能補上的設計文件說明），已先行以 commit `994ae1a`（docs(animation): document regenerate-all reuse of AI focus-effect generation）提交至 master，完成該功能的文件補登。\n\n已 commit 至分支 `feature/animation-overlay-image-effect-20260616`（commit 085be38），並已 `git merge --no-edit` 回 master。

- 時間: 2026-06-16 06:00:00 +0800
- 分支: feature/animation-formula-effect-20260616
- 內容: 由於 master 中 TODO.md 當下仍無未完成的 `[ ]` 項目，依 CLAUDE.md 指示再次從設計文件「後續擴充方向」尋找下一項可獨立完成的工作：`docs/animation-slide-v1-design.md` §12 V2 項目中「`custom-script` 的 AI 生成、物件 target、公式仍待後續」一句的「公式」子項。先前週期已完成 `shape`（`feature/animation-svg-shape-effect-20260616`）、`step-list`（`feature/animation-step-list-effect-20260616`）、`overlay-image`（`feature/animation-overlay-image-effect-20260616`）三個與 `text-callout` 高度相似的 overlay 效果類型；「物件 target」架構尚未定義、「`custom-script` 的 AI 生成」風險與範圍偏大，因此本次選定範圍明確、可沿用相同 overlay 機制落地的「公式」子項：新增一個 `formula` 效果類型，於指定區域以 [KaTeX](https://katex.org/) 渲染一段使用者輸入的 LaTeX 數學公式。\n\n實作：(1) `backend/src/services/pageAnimation.ts`：`ANIMATION_EFFECT_TYPES` 新增 `'formula'`（置於 `'overlay-image'` 與 `'custom-script'` 之間）；新增匯出常數 `export const MAX_FORMULA_LENGTH = 200`（文件註解：「Max length (chars) for a `formula` effect's LaTeX source.」）；`AnimationEffect` 新增選填欄位 `formula?: string`（文件註解說明為 `formula` 效果的 LaTeX 來源，其他效果類型忽略，上限 `MAX_FORMULA_LENGTH` 字元，透過 KaTeX 渲染），並更新 `exitDuration` 文件註解將 `formula` 列入 overlay 效果類型清單；`ALLOWED_PARAM_KEYS['formula']` 設為與 `highlight-box`/`text-callout`/`shape`/`step-list`/`overlay-image` 相同的 `['xPct','yPct','widthPct','heightPct']`；`EffectSchema` 新增 `formula: z.string().min(1).max(MAX_FORMULA_LENGTH).optional()`；`validateAnimationSpec` 輸出 effect 物件中加入 `...(effect.formula !== undefined ? { formula: effect.formula } : {})`。(2) `frontend/src/types.ts`：`SlideAnimationEffectType` 新增 `'formula'`（同樣置於 `'overlay-image'` 與 `'custom-script'` 之間），`SlideAnimationEffect` 新增 `formula?: string`（文件註解與後端一致），並同步更新 `exitDuration` 文件註解列入 `formula`。(3) `frontend/src/lib/animationSpec.ts`：`SLIDE_ANIMATION_EFFECT_TYPES`/`OVERLAY_EFFECT_TYPES` 加入 `'formula'`；新增匯出常數 `export const MAX_FORMULA_LENGTH = 200`（文件註解註明對應後端同名常數）；`getFocusEffectParams()` 對 `formula` 沿用既有 else 分支的 30/30/40/40 預設值，未額外修改。(4) `frontend/src/components/slide/buildGsapTimeline.ts`：overlay 共用 `autoAlpha` fromTo/exit 的 `switch` 中加入 `case 'formula':`，與 `highlight-box`/`spotlight`/`pointer`/`text-callout`/`shape`/`overlay-image`/`custom-script` 共用同一套淡入與可選 `exitDuration` 淡出邏輯，無需新增 GSAP 邏輯。(5) `frontend/src/components/slide/SlideRenderer.tsx`：新增 `import katex from 'katex'`，`EffectOverlay` 在 `custom-script` 分支之前新增 `effect.type === 'formula'` 分支：以 `katex.renderToString(effect.formula ?? '', { throwOnError: false, displayMode: true })` 將 LaTeX 轉換為 HTML，並以 `dangerouslySetInnerHTML` 渲染於一個套用既有 overlay 定位樣式（`position`）、`display: flex` 置中、深色半透明圓角方框（`background: rgba(15, 23, 42, 0.85)`、`color: #f8fafc`，與 `text-callout`/`step-list` 同色系）的 `<div data-effect-id={effect.id}>` 中；`throwOnError: false` 確保即使輸入非合法 LaTeX 語法，KaTeX 仍會輸出帶錯誤標示的 HTML 而不丟出例外。(6) 新增前端依賴：`frontend/package.json` 新增 `katex: ^0.17.0`（dependencies）與 `@types/katex: ^0.16.8`（devDependencies），並於根目錄 `package-lock.json`（npm workspace 共用鎖檔）執行 `npm install` 同步更新；`frontend/src/main.tsx` 新增全域樣式匯入 `import 'katex/dist/katex.min.css'`（置於 `import './index.css'` 之前）。(7) `frontend/src/pages/play/AnimationEditorTab.tsx`：新增 `import katex from 'katex'` 與自 `animationSpec.ts` 匯入 `MAX_FORMULA_LENGTH`；effect type `<select>` 新增 `formula` 選項（顯示文字 `play.animation.type.formula`）；`EFFECT_PRESETS` 在 `overlay-image-figure` 之後新增「插入公式」範本 `formula-insert`（`type: 'formula'`、`duration: 1`、`ease: 'power1.out'`、`exitDuration: DEFAULT_EXIT_DURATION_SECONDS`、`params: {xPct:30, yPct:40, widthPct:40, heightPct:20}`）；在 `OVERLAY_EFFECT_TYPES` 位置/大小區塊之前，新增僅當 `effect.type === 'formula'` 時顯示的編輯區塊：一個 `maxLength={MAX_FORMULA_LENGTH}` 的單行 `<input type=\"text\">`（`play.animation.formulaContent`/`formulaContentPlaceholder`，`onChange` 時呼叫 `updateEffect(effect.id, { formula: e.target.value })`），其下方當 `effect.formula` 非空時即時顯示一個以 `katex.renderToString(effect.formula, { throwOnError: false, displayMode: true })` 渲染、`dangerouslySetInnerHTML` 輸出的深色預覽方框，讓使用者輸入 LaTeX 時可立即看到渲染結果。(8) 新增 i18n 鍵（`zh-TW.ts`/`en.ts`）：`play.animation.type.formula`（「公式」/「Formula」）、`play.animation.preset.formula`（「插入公式」/「Insert formula」）、`play.animation.formulaContent`（「公式內容（LaTeX）」/「Formula (LaTeX)」）、`play.animation.formulaContentPlaceholder`（「例如：E = mc^2」/「e.g. E = mc^2」）。\n\n新增測試：`backend/test/page-animation.test.ts` 新增 5 項（並新增 `MAX_FORMULA_LENGTH` import）——`validateAnimationSpec` 接受帶 `formula`+overlay `params` 的 `formula` 效果、接受未提供 `formula`（尚未設定公式）、拒絕空字串 `formula`、拒絕超過 `MAX_FORMULA_LENGTH`（200 字元）的 `formula`、過濾 `formula` 效果中不在白名單的 `params` 欄位；`frontend/src/lib/animationSpec.test.ts` 新增 3 項（並新增 `MAX_FORMULA_LENGTH` import）——確認 `SLIDE_ANIMATION_EFFECT_TYPES`/`OVERLAY_EFFECT_TYPES` 含 `'formula'`、`getFocusEffectParams` 對 `formula` 套用 30/30/40/40 預設值、`MAX_FORMULA_LENGTH` 與後端限制一致（200）。\n\n並同步更新 `docs/animation-slide-v1-design.md`：於文件頂部「擴充註記」新增 2026-06-16 條目（公式效果 formula）說明本次擴充內容（含新依賴、渲染方式、定位/淡入淡出機制與 v1 範圍）；§5 effect type 表格新增 `formula` 一列；新增 §5.8「公式效果（formula）」子章節，說明 `effect.params`（沿用 §5.1）與 `effect.formula: string`（1~200 字元）結構、KaTeX 渲染呼叫方式、新增依賴與 CSS 匯入、`autoAlpha` 淡入/`exitDuration` 淡出機制（§5.3）、驗證規則（伺服器端不驗證 LaTeX 語法合法性），並標註 v1 範圍（僅純 LaTeX 字串輸入，不含公式編輯器/AI 生成；`custom-script` 沙箱因網路限制無法使用 KaTeX）；§6.6 EffectOverlay 說明加入 `formula` 的 `katex.renderToString(..., {displayMode:true})` + `dangerouslySetInnerHTML` 渲染描述；§12 V2 項目將「公式」子句加上刪除線並註記已於本分支完成，並將原句尾「`custom-script` 的 AI 生成、物件 target、公式仍待後續」改為「`custom-script` 的 AI 生成、物件 target 仍待後續」。\n\n驗證：`npx tsc --noEmit`（backend 與 frontend）皆通過；以 Node 22.12.0（`source ~/.nvm/nvm.sh && nvm use 22.12.0`，因系統預設 Node v26.2.0 與 `better-sqlite3` 的 NODE_MODULE_VERSION 不符）執行 `npx tsx --test ./test/page-animation.test.ts`，88/88 通過（原 83/83 + 新增 5 項）；`npx tsx --test src/lib/animationSpec.test.ts` 40/40 通過（原 37/37 + 新增 3 項）；`npm run build`（frontend, vite build）通過，並確認 KaTeX 字型資源（woff/woff2/ttf）正確打包進 `dist/assets/`（既有 >500kB chunk 警告為既有問題，與本次變更無關）。本變更完全重用既有 `text-callout`/`shape`/`step-list`/`overlay-image` overlay 的定位、淡入淡出與驗證機制，僅新增一個 LaTeX 字串欄位、一個第三方渲染函式庫呼叫與對應渲染分支，未變動既有效果類型的行為，風險低；環境中既有背景 dev server 為其他分支的過期殘留程序而無法另行啟動互動瀏覽器驗證，驗證水準與本 session 先前同類「動畫效果類型」項目（`feature/animation-overlay-image-effect-20260616`、`feature/animation-step-list-effect-20260616`）一致。已 commit 至分支 `feature/animation-formula-effect-20260616`（commit bb2562a）。

- 時間: 2026-06-16 06:45:00 +0800
- 分支: feature/pipeline-run-history-20260616
- 內容: 由於 master 中 TODO.md 當下仍無未完成的 `[ ]` 項目，依 CLAUDE.md 指示改從其他設計文件「後續可擴充方向」尋找下一項可獨立完成的工作：`docs/pipeline-stage-and-page-timing.md` §13「後續可擴充方向」第一項「新增 run history API，讓使用者查看每次 regenerate/resume 的完整歷程」。該文件 §4 已定義 `pipeline_runs`（每次 initial/retry/resume/regenerate_* 等 pipeline 執行的彙總紀錄，含 `run_type`/`parent_run_id`/`triggered_by`/`status`/`attempt`/`started_at`/`ended_at`/`duration_ms`/`sla_status`/`error_code`/`error_message`/`metadata_json`）與 `pipeline_stage_summaries`（每個 run 內各 stage 的彙總，PK 為 `(run_id, stage)`）兩個資料表並已有 timing service 持續寫入，但先前完全沒有任何 API 或 UI 可以查看這些歷史資料，使用者無法得知過去每次重新產生/接續處理的詳細時間軸與失敗原因。\n\n實作：(1) 後端新增 `backend/src/routes/pdfs/runs.ts`，提供 `GET /api/pdfs/:id/runs`：僅做輕量存在性檢查（`SELECT id FROM pdfs WHERE id = ?`，不存在回 404 `PDF_NOT_FOUND`），不做 `canReadPdf`/擁有權檢查，與 `figures.ts`/`page-animation.ts` 既有路由一致（`triggered_by` 等欄位非敏感資訊）；支援可選 query 參數 `limit`（`z.coerce.number().int().min(1).max(100)`，預設 20）；查詢 `pipeline_runs WHERE pdf_id = ? ORDER BY started_at DESC, id DESC LIMIT ?`，對每個 run 再查 `pipeline_stage_summaries WHERE run_id = ?`，並以 `TIMING_EVENT_VALUES.stages`（`backend/src/services/timing.ts` 匯出的 12 個 stage canonical 順序陣列）建立 `STAGE_ORDER` Map，在記憶體中依此順序排序各 stage 摘要（DB 查詢結果無固定順序保證）；`metadata_json` 以 `parseMetadata()` 嘗試解析為 `Record<string, unknown>`，非物件、陣列或解析失敗時回傳 `null`。並於 `backend/src/routes/pdfs/index.ts` 註冊 `registerRunHistoryRoutes(app)`。(2) `backend/src/types.ts` 新增對應回應型別 `PipelineRunStageSummary`/`PipelineRunSummary`/`PipelineRunsResponse`。(3) 前端 `frontend/src/types.ts` 鏡像新增 `PipelineRunType`/`PipelineRunStatus`/`PipelineStage`（前端先前缺少這些 enum 型別）與 `PipelineRunStageSummary`/`PipelineRunSummary`/`PipelineRunsResponse`；`frontend/src/lib/api/pdfs.ts` 新增 `fetchPdfRunHistory(id, shareToken?, limit?)`，呼叫 `api/pdfs/:id/runs`（沿用既有 shareToken 後綴 query 參數慣例，但因後端路由無擁有權檢查，UI 呼叫端實際未傳入 shareToken）。(4) 前端 UI：`frontend/src/pages/play/PlayPageSlidePanel.tsx` 在「系統資料」分頁新增「🗂 執行歷程」區塊——切換到該分頁時（`editTab === 'system'`）以 `useEffect` 呼叫 `fetchPdfRunHistory(pdfId)`，載入中/錯誤/空清單分別顯示對應文字；每個 run 顯示為一個可展開的列（執行類型中文標籤、第 N 次、開始時間 `toLocaleString('zh-TW', {dateStyle:'short', timeStyle:'medium'})`、狀態（執行中/成功/失敗/已取消/部分完成，以顏色區分）、總耗時，沿用既有 `formatDurationMs()`），展開後顯示一張表格列出該 run 每個 stage 的中文名稱、狀態、耗時與 SLA（`sla_status` + `sla_target_ms`），失敗時於展開區塊上方顯示 `error_code`/`error_message`。確認既有「系統資料」/「來源管理」分頁內容皆為硬編碼繁體中文（僅最上層分頁按鈕使用 i18n key），故本次「執行歷程」區塊沿用此慣例，未新增 i18n key。\n\n新增測試：`backend/test/pipeline-runs.test.ts`（3 項）——驗證回應依 `started_at` 由新到舊排序、每個 run 的 `stages` 依 canonical stage 順序排序（即使 DB 插入順序不同）、`metadata_json` 正確解析、執行中 run 的 `ended_at`/`duration_ms`/`metadata` 為 `null`；`limit=1` query 參數正確限制筆數；未知 PDF 回 404 `PDF_NOT_FOUND`。`frontend/src/lib/api.run-history.test.ts`（3 項）——驗證基本呼叫路徑 `api/pdfs/deck-1/runs`、`limit`+`share` query 參數組合、錯誤回應拋出 `ApiError`。\n\n並同步更新 `docs/pipeline-stage-and-page-timing.md`：§13 將「新增 run history API...」項目加上刪除線並註記已於本分支完成，說明端點排序規則與限制；新增 §8.5「Run history API（已實作）」子章節，列出完整回應型別定義、路由行為（存在性檢查、`limit` 範圍、排序規則）與前端呼叫/顯示方式。\n\n驗證：`npx tsc --noEmit`（backend 與 frontend）皆通過；以 Node 22.12.0（`source ~/.nvm/nvm.sh && nvm use 22.12.0`）執行 `npx tsx --test ./test/pipeline-runs.test.ts`，3/3 通過；以 `npx tsx --test ./test/*.ts` 執行全量 backend 測試，168 項中 148 項通過、20 項失敗，逐一比對確認此 20 項失敗（檔名清理、YouTube 來源驗證、頁面 CRUD/重生/回滾的 401 等）為既有環境問題，與本次新增的 3 項 `pipeline-runs` 測試無關（以 `git stash` 還原至 master 後單獨執行 `test/input-security.test.ts` 仍同樣失敗，確認非本次變更導致）；`npx tsx --test src/lib/*.test.ts src/pages/play/*.test.ts`（frontend）61/61 通過（含本次新增的 3 項 `api.run-history.test.ts`）；`npm run build`（frontend, vite build）通過（既有 >500kB chunk 警告為既有問題，與本次變更無關）。本變更僅新增一個唯讀查詢端點與一個唯讀 UI 區塊，未修改任何既有資料寫入路徑或既有路由行為，風險低；環境中既有背景 dev server 為其他分支的過期殘留程序而無法另行啟動互動瀏覽器驗證，驗證水準與本 session 先前同類「唯讀資訊展示」項目一致。已 commit 至分支 `feature/pipeline-run-history-20260616`（commit a6c2e0f），並已 `git merge --no-edit` 回 master。

- 時間: 2026-06-16 07:30:00 +0800
- 分支: feature/pipeline-slow-artifact-ranking-20260616
- 內容: 由於 master 中 TODO.md 當下仍無未完成的 `[ ]` 項目，依 CLAUDE.md 指示再次從 `docs/pipeline-stage-and-page-timing.md` §13「後續可擴充方向」尋找下一項可獨立完成的工作：「建立 slow artifact ranking，協助找出最慢頁面與最慢階段」。此項與 §9.3 提到的「PDF 整體顯示」設計中「最慢的前幾個 page artifact，例如『第 5 頁語音 75s』」需求相對應，且可直接沿用上一週期（`feature/pipeline-run-history-20260616`）剛建立的「切換到系統資料分頁時載入」API+UI 模式，是目前最明確、風險最低的剩餘項目。\n\n實作：(1) 後端新增 `backend/src/routes/pdfs/slow-artifacts.ts`，提供 `GET /api/pdfs/:id/slow-artifacts`：與 `runs.ts` 相同的輕量存在性檢查（`SELECT id FROM pdfs WHERE id = ?`，不存在回 404 `PDF_NOT_FOUND`），不做 `canReadPdf`/擁有權檢查；支援可選 query 參數 `limit`（`z.coerce.number().int().min(1).max(20)`，預設 5）；查詢 `page_artifact_timings WHERE pdf_id = ? AND duration_ms IS NOT NULL ORDER BY duration_ms DESC, page_number ASC LIMIT ?`（`page_artifact_timings` 的 PK 為 `(pdf_id, page_number, artifact)`，每組只保留最新一筆，故無需額外去重；`duration_ms IS NULL` 的執行中/未產生紀錄會被排除）。並於 `backend/src/routes/pdfs/index.ts` 註冊 `registerSlowArtifactRoutes(app)`。(2) `backend/src/types.ts` 新增對應回應型別 `SlowArtifactSummary`/`SlowArtifactsResponse`。(3) 前端 `frontend/src/types.ts` 鏡像新增相同型別；`frontend/src/lib/api/pdfs.ts` 新增 `fetchPdfSlowArtifacts(id, shareToken?, limit?)`，呼叫 `api/pdfs/:id/slow-artifacts`（與 `fetchPdfRunHistory` 相同的 query 參數慣例）。(4) 前端 UI：`frontend/src/pages/play/PlayPageSlidePanel.tsx` 在「系統資料」分頁的「🗂 執行歷程」區塊之後新增「🐢 最慢素材排行」區塊——切換到該分頁時（`editTab === 'system'`）以另一個 `useEffect` 呼叫 `fetchPdfSlowArtifacts(pdfId)`，載入中/錯誤/空清單分別顯示對應文字；以表格列出第 N 頁／素材類型（新增 `PAGE_ARTIFACT_LABELS` 對照表：圖片/文字/講稿/語音）／狀態（沿用既有 `STAGE_STATUS_LABELS`）／耗時（`formatDurationMs`）／SLA（`sla_status` + `sla_target_ms`），依後端傳回的耗時由大到小排序。確認既有「系統資料」分頁內容皆為硬編碼繁體中文，故沿用此慣例，未新增 i18n key。\n\n新增測試：`backend/test/slow-artifacts.test.ts`（3 項）——驗證回應依 `duration_ms` 由大到小排序（含 `page_number` 為 tie-break）且排除 `duration_ms IS NULL` 的執行中紀錄（5 筆種子資料中 1 筆為 `running`/`duration_ms: null`，回應僅含 4 筆，最慢為「第 1 頁語音 75000ms／sla_status: breached」）；`limit=2` query 參數正確限制筆數；未知 PDF 回 404 `PDF_NOT_FOUND`。測試 seed 函式因 `page_artifact_timings.run_id` 有 `FOREIGN KEY ... REFERENCES pipeline_runs(id) ON DELETE CASCADE` 且全域 `db.pragma('foreign_keys = ON')`，故先插入一筆 `pipeline_runs` 種子紀錄再插入 `page_artifact_timings`。`frontend/src/lib/api.slow-artifacts.test.ts`（3 項，鏡像 `api.run-history.test.ts`）——驗證基本呼叫路徑 `api/pdfs/deck-1/slow-artifacts`、`limit`+`share` query 參數組合、錯誤回應拋出 `ApiError`。\n\n並同步更新 `docs/pipeline-stage-and-page-timing.md`：§13 將「建立 slow artifact ranking...」項目加上刪除線並註記已於本分支完成；新增 §8.6「Slow artifact ranking API（已實作）」子章節，列出完整回應型別定義、路由行為（存在性檢查、`limit` 範圍、排序規則）與前端呼叫/顯示方式，並呼應 §9.3 的需求描述。\n\n驗證：`npx tsc --noEmit`（backend 與 frontend）皆通過；以 Node 22.12.0（`source ~/.nvm/nvm.sh && nvm use 22.12.0`）執行 `npx tsx --test ./test/slow-artifacts.test.ts`，3/3 通過；以 `npx tsx --test ./test/*.ts` 執行全量 backend 測試，171 項中 153 項通過、18 項失敗，逐一比對確認此 18 項失敗（檔名清理、YouTube 來源驗證、頁面 CRUD/重生/回滾的 401 等）為既有環境問題，與本次新增的 3 項 `slow-artifacts` 測試無關；`npx tsx --test src/lib/*.test.ts`（frontend）64/64 通過（含本次新增的 3 項 `api.slow-artifacts.test.ts`）；`npm run build`（frontend, vite build）通過（既有 >500kB chunk 警告為既有問題，與本次變更無關）。本變更僅新增一個唯讀查詢端點與一個唯讀 UI 區塊，未修改任何既有資料寫入路徑或既有路由行為，風險低；環境中既有背景 dev server 為其他分支的過期殘留程序而無法另行啟動互動瀏覽器驗證，驗證水準與本 session 先前同類「唯讀資訊展示」項目（`feature/pipeline-run-history-20260616`）一致。已 commit 至分支 `feature/pipeline-slow-artifact-ranking-20260616`（commit 1859699）。

- 時間: 2026-06-16 08:30:00 +0800
- 分支: feature/pipeline-sla-settings-20260616
- 內容: 由於 master 中 TODO.md 當下仍無未完成的 `[ ]` 項目，依 CLAUDE.md 指示再次從 `docs/pipeline-stage-and-page-timing.md` §13「後續可擴充方向」尋找下一項可獨立完成的工作：「將 SLA target 移到設定檔或 DB，支援不同 provider/model/source_type」。考量到「依 provider/model/source_type 區分目標值」是一個多維度矩陣設計，範圍較大，故依本 session 先前對動畫效果類型等項目採用的「v1 範圍」慣例，本次先實作「全域 SLA target override（admin 可調整每個 stage/artifact 的目標毫秒數，套用於所有 PDF/provider/model/source_type）」，並將多維度矩陣留待後續擴充。\n\n實作：(1) `backend/src/db.ts` 新增 `pipeline_sla_overrides` 表（`PRIMARY KEY (kind, name)`，`kind TEXT CHECK(kind IN ('stage','artifact'))`、`name`、`target_ms INTEGER`、`updated_at`）。(2) `backend/src/services/timing.ts` 新增 `SLA_TARGET_BOUNDS_MS = { min: 1_000, max: 3_600_000 }`（1 秒至 1 小時）、`getSlaTargetOverrides()`（讀取 DB 並過濾為合法的 `TIMING_EVENT_VALUES.stages`/`.artifacts` 名稱）、`getEffectiveSlaTargets()`（將 DB override 與 `SLA_TARGETS_MS` 預設值合併，override 優先）、`setSlaTargetOverride(kind, name, targetMs)`（`targetMs === null` 刪除 override 回復預設值；否則驗證 `name` 合法且 `targetMs` 為落在 bounds 內的整數，以 `INSERT ... ON CONFLICT DO UPDATE` upsert）；並將 `startStage`/`finishStage`/`startArtifact`/`finishArtifact` 寫入 `sla_target_ms` 時改用 `getEffectiveSlaTargets()`（原為直接讀取 `SLA_TARGETS_MS` 常數），使 override 套用後新建立的 timing event 立即採用新目標（既有 event 維持原記錄值）。(3) `backend/src/types.ts` 新增 `SlaTargetKind`/`SlaTargetSetting`/`SlaSettingsResponse` 型別。(4) 新增 `backend/src/routes/pdfs/sla-settings.ts`，提供 admin-only（`isAdminAccount(currentAccountId())`，否則 403 `ADMIN_REQUIRED`）的 `GET`/`PUT /api/system/sla-settings`：`GET` 回傳所有 stage/artifact 的 `default_ms`/`override_ms`/`effective_ms`/`updated_at` 與 `bounds`；`PUT` body 為 `{ kind, name, target_ms }`，`name` 不合法或 `target_ms` 超出 bounds 回 400，成功後回傳最新設定（`target_ms: null` 可清除 override）。並於 `backend/src/routes/pdfs/index.ts` 註冊 `registerSlaSettingsRoutes(app)`。(5) 前端 `frontend/src/types.ts` 鏡像新增相同型別；`frontend/src/lib/api/system.ts` 新增 `getSlaSettings()`/`updateSlaTargetOverride(kind, name, targetMs)`。(6) 前端 UI：`frontend/src/pages/SettingsPage.tsx` 新增 admin 專屬「Pipeline SLA 設定」區塊（沿用既有「GitHub 同步」區塊樣式），分別以表格列出所有 stage/artifact 的名稱、預設值（秒）、目前生效值（秒）、覆寫值輸入框（秒）、更新時間，並提供「套用」/「清除」按鈕逐項呼叫 `updateSlaTargetOverride`；新增對應 i18n key（`settings.sla*`，`zh-TW.ts`/`en.ts` 各 19 筆）。\n\n新增測試：`backend/test/timing.test.ts` 新增 4 項——`getEffectiveSlaTargets` 合併 DB override 與預設值、`setSlaTargetOverride` 拒絕未知名稱與超出範圍的值、`startStage`/`finishStage`/`startArtifact`/`finishArtifact` 使用 override 後的生效目標。`backend/test/sla-settings.test.ts`（新檔，4 項）——admin `GET` 回傳 defaults/overrides/effective；`PUT` 設定與清除 override 並反映於 `GET`；`PUT` 拒絕不合法 `kind`/`name`/`target_ms`；非 admin `GET`/`PUT` 回 403 `ADMIN_REQUIRED`（測試以 `crypto.createHmac('sha256', config.authSessionSecret)` 動態計算 `makeslide_session` cookie 簽章，避免硬編碼簽章在不同環境的 `AUTH_SESSION_SECRET` 下失效）。`frontend/src/lib/api.sla-settings.test.ts`（新檔，4 項）——`getSlaSettings`/`updateSlaTargetOverride` 呼叫路徑、`target_ms: null` 清除 override、錯誤回應拋出 `ApiError`。\n\n並同步更新 `docs/pipeline-stage-and-page-timing.md`：§13 將該項目加上刪除線並註記 v1 範圍已完成，多維度矩陣留待後續擴充；新增 §8.7「SLA target 設定 API（已實作，v1 範圍：全域 override）」子章節，列出完整型別定義、路由行為與前端呈現方式。\n\n驗證：`npx tsc --noEmit`（backend 與 frontend）皆通過；`npm run build`（frontend, vite build）通過（既有 >500kB chunk 警告為既有問題，與本次變更無關）；以 Node 22.12.0（`source ~/.nvm/nvm.sh && nvm use 22.12.0`）執行 `npx tsx --test ./test/*.ts`（backend），178 項中 160 項通過、18 項失敗，與本次變更前的既有失敗基線（18 項）一致，逐一比對確認與本次新增的 7 項測試（`timing.test.ts` 4 項 + `sla-settings.test.ts` 4 項，含原有測試）無關；`npx tsx --test src/lib/*.test.ts`（frontend）68/68 通過（含本次新增的 4 項 `api.sla-settings.test.ts`）。本次新增的 admin 設定區塊沿用既有「GitHub 同步」/「Google 登入」等已驗證可運作的 admin 區塊樣式與 `isAdmin` 條件渲染模式，且環境中無可用的互動瀏覽器可建立 admin session 進行端對端視覺驗證（僅有其他分支殘留的背景 dev server 行程），故本次驗證僅涵蓋 tsc/build/單元與整合測試，未進行瀏覽器端對端測試。已 commit 至分支 `feature/pipeline-sla-settings-20260616`（commit 32356c3），並已 `git merge --no-edit` 回 master。

- 時間: 2026-06-16 09:10:00 +0800
- 分支: feature/pipeline-llm-cost-tracking-20260616
- 內容: 由於 master 中 TODO.md 當下仍無未完成的 `[ ]` 項目，依 CLAUDE.md 指示再次從 `docs/pipeline-stage-and-page-timing.md` §13「後續可擴充方向」尋找下一項可獨立完成的工作：第三項「將 timing event 與 token/成本統計關聯，支援成本儀表」。考量到完整的成本儀表（含 stage/artifact 層級細分、各 provider/model 計價、Gemini 用量等）範圍過大，故沿用本 session 先前對動畫效果類型、SLA 設定等項目採用的「v1 範圍」慣例，本次先實作「run 層級的 LLM 用量／成本彙總」：`GET /api/pdfs/:id/runs` 的每個 run 新增 `llm_usage`（requests/prompt_tokens/completion_tokens/total_tokens/total_latency_ms/estimated_cost_usd），多維度細分留待後續擴充。\n\n實作過程中發現既有 `backend/src/routes/pdfs/observability.ts` 的 `summarizeLlmUsage()` 有一個既存 bug：`appendLlmResponseLog()` 寫入 JSONL 時頂層欄位是 `kind: 'response'`，但 `summarizeLlmUsage()` 卻檢查 `event.type !== 'response'`（`type` 只存在於 `messages[].content[].type` 巢狀欄位中，頂層從未設定），導致此檢查永遠為真，使 `/api/system/observability` 回傳的 `llm_usage` 永遠為全零統計。本次先修正此 bug，作為支援成本儀表的基礎。\n\n實作內容：(1) 新增 `backend/src/services/llmUsage.ts`，集中管理 LLM 用量 log 路徑（`LLM_REQUEST_LOG_FILE`）、模型計價表（`MODEL_PRICE_PER_1M_TOKENS`，含 `gpt-4o-mini`/`gpt-4o`）、`LlmUsageSummary`/`emptyLlmUsageSummary()`、單次掃描的 `summarizeLlmUsage(filter?)`（支援 `pdfId`/`runId` 過濾，並修正上述 `kind`/`type` bug）、以及 `summarizeLlmUsageByRunIds(runIds)`（單次掃描依 `run_id` 分組彙總，避免每個 run 各自讀檔）；並以 `AsyncLocalStorage`（`setLlmUsageContext`/`currentLlmUsageContext`，使用 `enterWith` 而非 `.run()` 包裝，避免重構 `pipeline.ts`/`regenerate.ts` 的呼叫結構）讓 `pdf_id`/`run_id` context 可從 `startRun()` 之後向下傳遞至任意巢狀的 LLM 呼叫。(2) `backend/src/services/openai.ts` 的 `appendLlmRequestLog`/`appendLlmResponseLog` 改為從 `llmUsage.ts` import `LLM_REQUEST_LOG_FILE`，並透過新增的 `llmLogContextFields()` 將目前 context 的 `pdf_id`/`run_id` 寫入每筆 log。(3) `backend/src/worker/pipeline.ts` 的 `runPipeline` 於 `startRun()` 後呼叫 `setLlmUsageContext({ pdfId, runId: run.runId })`；`backend/src/worker/regenerate.ts` 的 `runJob` 於設定 `state.timing_run_id` 後呼叫 `setLlmUsageContext({ pdfId: state.pdf_id, runId: timingRun.runId })`。(4) `backend/src/types.ts`／`frontend/src/types.ts` 新增 `LlmUsageSummary` 型別並在 `PipelineRunSummary` 加入 `llm_usage` 欄位。(5) `backend/src/routes/pdfs/runs.ts` 於組裝 `runs` 回應時，先以 `summarizeLlmUsageByRunIds()` 單次掃描取得所有 run 的彙總，逐一帶入 `llm_usage`（找不到則為 `emptyLlmUsageSummary()`）。(6) `backend/src/routes/pdfs/observability.ts` 移除重複的 ~70 行 `LLM_REQUEST_LOG_FILE`/`MODEL_PRICE_PER_1M_TOKENS`/`LlmUsageSummary`/`summarizeLlmUsage()` 定義，改為 import 共用模組（既修正了原有 bug，又消除重複程式碼）。(7) 前端 `frontend/src/pages/play/formatters.ts` 新增 `formatTokenCount()`（K/M 單位換算）與 `formatCostUsd()`（`null`→「未知」、`0`→`$0`、`<0.01`→`<$0.01`，其餘 2 位小數）；`frontend/src/pages/play/PlayPageSlidePanel.tsx` 於「執行歷程」展開列的 stage 表格下方，當 `run.llm_usage.requests > 0` 時顯示「💬 LLM：N 次請求 · X tokens · 預估費用 $Y」。\n\n新增測試：`backend/test/llmUsage.test.ts`（新檔，5 項）——`summarizeLlmUsage` 彙總 response 條目並忽略非 response/格式錯誤的行，僅對有計價的模型計算 `estimated_cost_usd`（驗證 gpt-4o-mini 的成本計算為 `0.00135`）；log 檔不存在時回傳 `emptyLlmUsageSummary()`；依 `pdfId`/`runId` 過濾（含組合過濾回傳 0 的情況）；`summarizeLlmUsageByRunIds` 單次掃描依 `run_id` 分組、忽略非請求集合內的 run、計算成本（驗證 gpt-4o 對 100 萬 prompt/completion tokens 分別為 `2.5`/`10`）；空陣列輸入回傳空 map。`backend/test/pipeline-runs.test.ts` 新增第 4 項測試——以暫存的 JSONL log（兩筆標記 `pdf_id`/`run_id` 的 `gpt-4o-mini` response，各 1000/500 tokens）驗證 `GET /api/pdfs/:id/runs` 回傳的 `llm_usage.requests === 2`、`total_tokens === 3000`、`estimated_cost_usd === 0.0009`，且未對應 log 的另一個 run 的 `llm_usage` 為全零的 `emptyLlmUsageSummary()` 形狀。`frontend/src/lib/api.run-history.test.ts` 因 `PipelineRunSummary` 新增必填的 `llm_usage` 欄位而需補上 mock fixture 的對應欄位（全零/null）以通過型別檢查。\n\n並同步更新 `docs/pipeline-stage-and-page-timing.md`：新增 §8.8「LLM 用量／成本與 timing event 關聯（已實作，v1 範圍：run 層級）」，說明新模組、bug 修正、`AsyncLocalStorage` context 傳遞機制、`llm_usage` API 欄位的 `LlmUsageSummary` 型別定義、前端呈現方式，並列出明確的「v1 範圍限制」：僅 run 層級（無 stage/artifact 細分）、僅 2 個有計價的模型、Gemini 路徑未記錄 log、`addPagesFromPrompt.ts` 因無 `run_id` 可關聯而未涵蓋；§13 第三項加上刪除線並以括號註記本次完成內容與分支。\n\n驗證：`npx tsc --noEmit`（backend 與 frontend）皆通過；以 Node 22.12.0（`source ~/.nvm/nvm.sh && nvm use 22.12.0`）執行 `npx tsx --test ./test/*.ts`（backend），184 項中 166 項通過、18 項失敗，與本次變更前的既有失敗基線（160/178，18 項失敗）一致，新增的 6 項測試（`llmUsage.test.ts` 5 項 + `pipeline-runs.test.ts` 新增 1 項）全數通過；`npm run build`（frontend, vite build）通過（既有 >500kB chunk 警告為既有問題，與本次變更無關）；`npx tsx --test src/lib/*.test.ts`（frontend）含 `api.run-history.test.ts` 等測試全數通過。環境中無可用的互動瀏覽器可進行端對端視覺驗證，故前端 UI 變更（執行歷程展開後顯示 LLM 用量）僅以 tsc/build/單元測試驗證，未進行瀏覽器端對端測試。已 commit 至分支 `feature/pipeline-llm-cost-tracking-20260616`（commit 5e17f1a）。

- 時間: 2026-06-16 09:50:00 +0800
- 分支: feature/animation-auto-focus-ai-custom-script-20260616
- 內容: 由於 master 中 TODO.md 當下仍無未完成的 `[ ]` 項目，依 CLAUDE.md 指示再次從 `docs/animation-slide-v1-design.md` §12「後續擴充方向」尋找下一項可獨立完成的工作：V2 條目最後一句「`custom-script` 的 AI 生成、物件 target 仍待後續」中的「`custom-script` 的 AI 生成」。考量到「物件 target」需要為投影片物件建立可定位/可定址的資料模型，屬於較大規模的設計變更，而 `custom-script` 的 AI 生成可直接重用既有的安全程式碼產生管線（手動「自訂腳本」對話框已實作完成），風險低、價值明確，故選擇此項。\n\n依本 session 先前慣例採用 v1 範圍：每頁最多產生 1 個 `custom-script` 效果、不含互動式「實作步驟」規劃、不含多輪迭代（使用者仍可在產生後透過既有對話框手動迭代），物件 target 留待後續。\n\n實作：(1) `backend/src/services/animationAutoFocus.ts`：將 `AUTO_FOCUS_AI_EFFECT_TYPES` 擴充為包含 `custom-script`；新增常數 `CUSTOM_SCRIPT_AI_DURATION_SECONDS = { default: 6, min: 2, max: 20 }`（一輪播放秒數，較一般 `AUTO_FOCUS_AI_DURATION_SECONDS = 1.2` 長，因自訂視覺化需要時間播放）與 `MAX_CUSTOM_SCRIPT_EFFECTS_PER_PAGE_AI = 1`；`AutoFocusItemSchema` 新增 `scriptPrompt`（上限 `MAX_CUSTOM_SCRIPT_PROMPT_LENGTH`）與 `scriptDurationSeconds`（限制於 `CUSTOM_SCRIPT_AI_DURATION_SECONDS.min/max`）欄位；`buildAutoFocusSystemPrompt()` 新增 `custom-script` 的類型說明、`scriptPrompt`/`scriptDurationSeconds` 欄位說明，並在範例 JSON 與限制條件中註明「整份回應最多只能有一個 type 為 custom-script 的項目」。`mapAutoFocusResponseToEffects` 新增 `customScriptCount` 計數器與 `else if (type === 'custom-script')` 分支：有效 `scriptPrompt` 且未超過每頁上限時，設定 `effect.prompt`（截斷）與依 `scriptDurationSeconds` 計算並夾在範圍內的 `duration`；否則退回 `highlight-box`（與既有 `text-callout`/`step-list` 的退回邏輯一致）。新增匯出的 async function `fillCustomScriptEffectsCode(effects, { pageText, label })`：對每個帶有 `prompt` 的 `custom-script` 效果呼叫既有的 `generateCustomScriptCodeStream`（與手動自訂腳本對話框相同），並以 `findUnsafeScriptPattern`/`findCustomScriptContractIssue` 驗證產生的程式碼；驗證失敗或呼叫拋出例外時，透過新增的 `revertCustomScriptEffectToHighlightBox` 退回 `highlight-box`（清除 `prompt`/`code`、`duration` 還原為 `AUTO_FOCUS_AI_DURATION_SECONDS`，並以 `logger.warn` 記錄原因）。`generateAiFocusEffects` 最後改為呼叫 `mapAutoFocusResponseToEffects` 後再串接 `fillCustomScriptEffectsCode`。後端路由（`/auto-focus-ai`）與批量「重生」→「動畫」步驟（`runRegenerateAnimations`）皆透過 `generateAiFocusEffects` 呼叫，無需修改即可套用；前端 `AnimationEditorTab.tsx`／`usePageAnimation.ts` 已能以既有的 `effect.code`/`effect.prompt`/`effect.conversation`（皆為選填）渲染與編輯任意 `custom-script` 效果，亦無需修改。(2) `docs/animation-slide-v1-design.md` §12：將 V2 條目中的「`custom-script` 的 AI 生成」加上刪除線並補充上述 v1 範圍說明與分支名稱，保留「物件 target 仍待後續」。\n\n新增測試：`backend/test/page-animation.test.ts` 新增 11 項——`mapAutoFocusResponseToEffects` 的 custom-script 對映（截斷 `scriptPrompt`、夾住 `scriptDurationSeconds`）、預設 6 秒、無 `scriptPrompt` 時退回 `highlight-box`、每頁上限 1 個（超出退回）、輸出通過 `validateAnimationSpec`；`fillCustomScriptEffectsCode` 成功填入 `code`、產生不安全程式碼時退回、產生不符契約程式碼時退回、對非 custom-script 效果不呼叫 LLM；`POST /auto-focus-ai` 端對端回傳含 AI 產生 `code` 的 `custom-script` 效果，以及產生不安全程式碼時端對端退回 `highlight-box`（後者使用新增的 `autoFocusCustomScriptClient` mock，依 request body 的 `stream` 旗標分別模擬 `callChatJSON`（非 stream，回傳含 `custom-script` 決策的 JSON）與 `streamChatText`（stream，回傳產生的程式碼）兩種呼叫）。\n\n驗證：`npx tsc --noEmit`（backend）通過；以 Node 22.12.0（`source ~/.nvm/nvm.sh && nvm use 22.12.0`）執行 `npx tsx --test ./test/page-animation.test.ts`，99/99 通過；執行全量 `npx tsx --test ./test/*.ts`，195 項中 177 項通過、18 項失敗，逐一比對確認此 18 項失敗與既有失敗基線（166/184，18 項失敗）相同項目，與本次新增的 11 項測試無關。前端未變更，未執行前端測試/build；環境中無可用的互動瀏覽器可進行端對端視覺驗證，故僅以 tsc/單元與整合測試驗證。已 commit 至分支 `feature/animation-auto-focus-ai-custom-script-20260616`。

- 時間: 2026-06-16 11:45:00 +0800
- 分支: feature/animation-manim-axes-numberplane-20260616
- 內容: 由於 master 中 TODO.md 當下已無未完成的 `[ ]` 項目，依 CLAUDE.md 指示再次檢視設計文件「後續擴充方向」找尋下一項可獨立完成的工作。檢視 `docs/pipeline-stage-and-page-timing.md` §13（4 項皆已完成，僅剩需分散式 queue 才能實作的條件式項目）與 `docs/animation-slide-v1-design.md` §12 V2 條目（僅剩需大規模資料模型重構的「物件 target」），以及 `docs/pdf-figure-extraction-design.md` §2.2/§9（剩餘的 OCR、跨頁圖表合併皆為先前 cycle 已評估為過大或因 §12.10 回歸風險而刻意延後的項目）。最終選擇 `docs/animation-slide-v1-design.md` §12 V2.x 條目「`window.Manim`（manim 風格輔助函式庫，§5.4）的擴充」中的 `Axes`/`NumberPlane`（座標軸、格線、`coordsToPoint`）部分：範圍明確、風險低（純前端 sandbox 輔助函式庫擴充，不影響既有效果/資料模型），且能直接提升 custom-script AI 生成「manim 風格」動畫時可繪製座標平面/函數圖的能力；同條目中 `MathTex`/`Tex`（需離線 vendored KaTeX 字型）、`transform` 真正路徑變形與 3D 場景仍維持留待後續。\n\n實作：(1) `frontend/src/lib/manimHelperScript.ts`：在 `shapes` 之後新增 `buildAxisRange(range, fallback)` 與 `coordinateSystem(svg, opts, withGrid)`，依 `opts.xRange`/`opts.yRange`（`[min, max, step?]`，預設 `[-7,7,1]`/`[-4,4,1]`）與 `opts.xLength`/`opts.yLength`（預設 14/8，即 `Manim.config` 全畫面）建立一個 `<g>`：先（若 `withGrid`）依 `step` 畫滿版面格線（`gridColor`，預設 `colors.GREY`），再畫 x/y 兩軸與依 `step` 產生的刻度（`color`，預設 `colors.WHITE`）；回傳 `{ el: g, kind: 'axes' | 'numberPlane', svg, coordsToPoint }`，`coordsToPoint(x, y)` 將資料座標線性映射到場景座標（原點對應 `(0,0)`，可直接作為 `Manim.shapes.*` 的 `x`/`y`）。新增 `Manim.coordinateSystems = { axes, numberPlane }`（`axes` 對應 `withGrid=false`，`numberPlane` 對應 `withGrid=true`）。並將 `animate.create`/`write` 的特例清單（原僅 `text`/`dot`/`arrow` 退化為 `fadeIn`）加入 `axes`/`numberPlane`，讓座標系統的 `create`/`write` 呼叫退化為依進度 `fadeIn`（`<g>` 元素沒有 `getTotalLength`，原邏輯會直接設為全不透明，不是漸進效果）。檔案頂部 doc comment 同步補充說明。(2) `backend/src/services/animationCustomScript.ts` 的 `buildCustomScriptSystemPrompt()`：在 `Manim.lerp`/`Manim.lerpColor` 說明後新增一行，介紹 `Manim.coordinateSystems.axes`/`numberPlane(svg, opts)` 的回傳值、`opts` 欄位（`xRange`/`yRange`/`xLength`/`yLength`/`color`/`gridColor`）與 `coordsToPoint` 用法，讓 AI 在產生「manim 風格」程式碼時可選擇使用座標平面。(3) `docs/animation-slide-v1-design.md`：§5.4「v1 範圍」將「不含 `Axes`/`NumberPlane` 座標軸繪製輔助」加上刪除線並註明已實作＋分支名稱；§12 V2.x 條目將「`Axes`/`NumberPlane`（座標軸、格線、`coordsToPoint`）」加上刪除線並補充上述實作細節與分支名稱，保留 `MathTex`/`Tex`、path morphing、3D 場景待後續。\n\n新增測試：`frontend/src/lib/manimHelperScript.test.ts` 新增 3 項——`Manim.coordinateSystems.axes` 依 `xRange`/`yRange`/`step` 畫出正確數量的軸線+刻度（2 軸線 + 11 個 x 刻度 + 7 個 y 刻度）且 `coordsToPoint` 正確映射原點/邊界座標；`Manim.coordinateSystems.numberPlane` 在 `axes` 之上額外畫出格線（11 條垂直 + 7 條水平）；`Manim.animate.create`/`fadeIn`/`fadeOut` 對 `axes` mobject 依進度淡入/淡出（驗證新加入的特例分支）。\n\n驗證：`npx tsc --noEmit`（frontend 與 backend）皆通過；`npx tsx --test src/lib/*.test.ts`（frontend），71 項全數通過（含新增 3 項）；以 Node 22.12.0（`source ~/.nvm/nvm.sh && nvm use 22.12.0`）執行 `npx tsx --test ./test/*.ts`（backend），195 項中 177 項通過、18 項失敗，與既有失敗基線一致，與本次變更無關（本次未變更後端邏輯，僅新增系統提示詞文字）。環境中無可用的互動瀏覽器可進行端對端視覺驗證（需在 custom-script 編輯器中請 AI 產生使用 `Manim.coordinateSystems` 的程式碼並預覽），故僅以 tsc/單元測試驗證。已 commit 至分支 `feature/animation-manim-axes-numberplane-20260616`（commit 9f268c3）。
- 時間: 2026-06-16 12:30:00 +0800
- 分支: feature/animation-auto-generate-on-audio-20260616
- 內容: 由於 master 中 TODO.md 當下已無未完成的 `[ ]` 項目，依 CLAUDE.md 指示再次檢視設計文件「後續擴充方向」找尋下一項可獨立完成的工作。在 `docs/animation-slide-v1-design.md` §7.2 第 563 行找到明確的待實作記號「TODO 第 720 項所述『打開功能後，產生語音時自動產生』的常駐設定與後端管線整合留待後續項目」，選擇此項實作。\n\n依 v1 範圍慣例：整頁覆寫（不增量合併既有效果）、單頁 LLM 失敗為非致命錯誤（記錄繼續）、不提供選頁或分組設定；進一步的細粒度控制留待後續。\n\n實作：(1) `backend/src/services/aiSettings.ts`：在 `PerAccountAiSettings` 介面新增 `autoGenerateAnimation: boolean`（預設 `false`），並於 `basePerAccountSettings()`（從環境變數 `AUTO_GENERATE_ANIMATION` 解析）、`loadPerAccountOverrides()`（從帳號 `settings.env` 解析 `AUTO_GENERATE_ANIMATION`）與 `PER_ACCOUNT_ENV_PAIRS`（`['AUTO_GENERATE_ANIMATION', 'autoGenerateAnimation']`）三處同步擴充，遵循既有 `asBoolean()`/`definedEntries()` 模式。(2) `backend/src/routes/pdfs/shared.ts`：`UpdateSystemAiSettingsBodySchema` 新增 `auto_generate_animation: z.boolean().optional()`。(3) `backend/src/routes/pdfs/admin.ts`：`aiSettingsResponse()` 新增 `auto_generate_animation: runtime.autoGenerateAnimation`（所有使用者均可讀取，屬帳號層級設定）；PATCH handler `next` 物件新增 `autoGenerateAnimation: data.auto_generate_animation`。(4) `backend/src/worker/regenerate.ts`：從 `runRegenerateAnimations` 的逐頁迴圈主體抽取為獨立的 `export async function generateAnimationForPage(pdfId, page: AnimationGenerationPageRow, label): Promise<void>`（讀取逐字稿/頁面文字、分句、載入截圖、呼叫 `generateAiFocusEffects`、寫入 `.animation.json`、更新 `pages` 資料表），並同步新增 `export interface AnimationGenerationPageRow`；`runRegenerateAnimations` 重構為呼叫 `generateAnimationForPage`（行為不變，僅消除重複程式碼）。(5) `backend/src/worker/pipeline.ts`：新增 `import { generateAnimationForPage, type AnimationGenerationPageRow } from './regenerate'`；新增 `export async function maybeAutoGenerateAnimations(run, pdfId, pageNumbers): Promise<void>`（先以 `getRuntimeAiSettings().autoGenerateAnimation` 判斷，false 時直接回傳；true 時以 `startStage(run, 'generate_animations', ...)` 開啟 timing stage，逐頁呼叫 `generateAnimationForPage`，單頁失敗以 `logger.error` 記錄但繼續其餘頁面，最後以 `finishStage(stage, failed > 0 ? 'failed' : 'succeeded', ...)` 結束 stage）；在 `synthesize_audio` stage `finishStage` 之後呼叫 `await maybeAutoGenerateAnimations(run, pdfId, ttsResult.pages.filter(p => !p.skipped).map(p => p.pageNumber))`。(6) 前端 `frontend/src/lib/api/system.ts`：`SystemAiSettings` 與 `UpdateSystemAiSettingsPayload` 各新增 `auto_generate_animation?: boolean`。(7) 前端 `frontend/src/pages/SettingsPage.tsx`：新增 state `autoGenerateAnimation`、`loadStatus` 設定（`setAutoGenerateAnimation(Boolean(s.auto_generate_animation))`）、`onSave` payload（`auto_generate_animation: autoGenerateAnimation`）、dependency array，以及 checkbox UI（TTS provider select 之後，isAdmin block 之前，`sm:col-span-2`，附說明文字），沿用既有 `cguAirEnabled` checkbox 樣式。(8) `frontend/src/locales/zh-TW.ts`/`en.ts`：新增 `settings.autoGenerateAnimation`（主標籤）與 `settings.autoGenerateAnimationHint`（說明文字）兩個 i18n key。(9) `docs/animation-slide-v1-design.md` §7.2 第 563 行：將原「留待後續項目（見 §12）」文字加上刪除線並補充已實作內容說明（`auto_generate_animation` 設定、`generateAnimationForPage` 共用、`generate_animations` stage 追蹤、v1 範圍限制）與分支名稱。\n\n新增測試：`backend/test/pipeline-auto-animations.test.ts`（新檔，4 項）——`maybeAutoGenerateAnimations` 設定啟用時為每頁寫入 `.animation.json` 並更新 `pages` 資料表的 `render_type`/`animation_spec_path`（mock OpenAI 回傳 `highlight-box`，seeded 頁面有 `.jpg`/`.text.txt`/`.script.txt`）；設定關閉時為 no-op（`.animation.json` 不建立、`animation_spec_path` 維持 null）；`GET /api/system/ai-settings` 預設回傳 `auto_generate_animation: false`；`PATCH /api/system/ai-settings` 設定 `auto_generate_animation: true` 後 `GET` 反映最新值（使用 `buildApp()` 透過 Fastify inject 端對端測試 HTTP 路由）。\n\n驗證：`npx tsc --noEmit`（backend 與 frontend）皆通過；以 Node 22.12.0（`source ~/.nvm/nvm.sh && nvm use 22.12.0`）執行 `npx tsx --test ./test/pipeline-auto-animations.test.ts`，4/4 通過；執行全量 `npx tsx --test ./test/*.ts`（backend），199 項中 181 項通過、18 項失敗，與既有失敗基線（177/195，18 項失敗）一致，新增的 4 項測試全數通過；`npx tsx --test`（frontend，在 `frontend/` 目錄），71/71 通過（含既有的 manimHelperScript 等測試，本次未新增前端測試）。已 commit 至分支 `feature/animation-auto-generate-on-audio-20260616`（commit 398c9f2）。

- 時間: 2026-06-16 13:30:00 +0800
- 分支: feature/gemini-image-support-20260616
- 內容: 由於 master 中 TODO.md 當下已無未完成的 `[ ]` 項目（末尾新增的「讓效果的位置可以使用 mouse 直接修改」為使用者新增待辦，另行實作），依 CLAUDE.md 指示再次檢視設計文件「後續擴充方向」找尋下一項可獨立完成的工作。在 `docs/animation-slide-v1-design.md` §7.3 第 594 行找到明確的待修正記號：「Gemini 路徑（`callGeminiJson`/`normalizeMessages`）目前會將非文字內容部分一律替換為 `'[image]'` 占位字串，留待後續一併處理」。此項範圍明確、影響全局（所有使用 `callGeminiJson`/`callGeminiTextStream` 的 LLM 呼叫均受益），故選擇此項實作。\n\n實作：`backend/src/services/gemini.ts`：以新的 `export function buildGeminiContents(messages)` 取代舊的 `normalizeMessages`（私有、只回傳扁平字串）。新函式回傳 `{ systemInstruction?, contents: GeminiContent[] }` 結構：(1) `role: 'system'` 的訊息收集到 `systemInstruction: { parts: [{text}] }`（由 Gemini API 的 `systemInstruction` 欄位支援，取代原本 `[system] ...` 前綴嵌入字串的方式）；(2) `role: 'user'`/`'assistant'` 分別映射到 Gemini 的 `'user'`/`'model'` role；(3) 陣列 content 的 `type: 'text'` 部分直接映射為 `{ text }` part；(4) `type: 'image_url'` 且 URL 為 `data:image/...;base64,...` 格式者，以 `parseDataUrl()` 提取 mimeType 與 base64 資料，轉為 `{ inlineData: { mimeType, data } }` part（Gemini 視覺模型可接收此格式的頁面截圖）；非 data URL 的外部圖片連結略過（Gemini 伺服器端無法存取外部 HTTP 資源）。`callGeminiJson` 與 `callGeminiTextStream` 改為呼叫 `buildGeminiContents`，並將 `systemInstruction`（若有）加入 request body 的頂層欄位，`contents` 直接傳入（不再包裝為單一 user 訊息）；body 型別改為 `Record<string, unknown>` 以支援條件性加入 `systemInstruction`。\n\n新增測試：`backend/test/gemini-contents.test.ts`（新檔，7 項）——文字 system+user 訊息正確分離為 `systemInstruction`/`contents`；`assistant` role 映射為 `model`；`data:image/jpeg;base64,...` URL 轉換為 `inlineData`（mimeType=image/jpeg，data=base64 部分）；非 data URL 的 `image_url` 被略過（僅剩 text part）；多個 system 訊息各自成為 `systemInstruction.parts` 中的獨立 text；無 system 訊息時 `systemInstruction` 為 undefined；PNG 格式 data URL 亦正確轉換。\n\n驗證：`npx tsc --noEmit`（backend）通過；以 Node 22.12.0（`source ~/.nvm/nvm.sh && nvm use 22.12.0`）執行全量 `npm test`（backend），206 項中 188 項通過、18 項失敗，與既有失敗基線一致，新增 7 項測試全數通過。已 commit 至分支 `feature/gemini-image-support-20260616`（commit 22fa41f）。

# 2026-6-16
[x] 讓效果的位置可以使用 mouse 直接修改（分支 `feature/animation-effect-drag-position-20260616`）

- 時間: 2026-06-16 16:00:00 +0800
- 分支: feature/gemini-llm-logging-20260616
- 內容: 由於 master 中 TODO.md 當下已無未完成的 `[ ]` 項目，依 CLAUDE.md 指示從 `docs/pipeline-stage-and-page-timing.md` §8.8 v1 範圍限制尋找下一項可獨立完成的工作：「Gemini 路徑（`callGeminiJson`/`callGeminiTextStream`）目前未寫入 `llm-requests.log.jsonl`，因此 Gemini 請求不會出現在此用量統計中」。此項範圍明確，可讓 Gemini LLM 呼叫納入既有的 run-history API 的 `llm_usage` 欄位統計與前端「執行歷程」費用顯示。實作：(1) `backend/src/services/llmUsage.ts`：新增 `import { logger } from '../logger'`；更新 `LLM_REQUEST_LOG_FILE` 說明文件；新增 `MODEL_PRICE_PER_1M_TOKENS` 的 Gemini 模型定價（`gemini-2.0-flash` $0.075/$0.30、`gemini-2.0-flash-lite` $0.0375/$0.15、`gemini-1.5-flash` $0.075/$0.30、`gemini-1.5-pro` $1.25/$5.00，單位為每百萬 tokens）；將 `llmLogContextFields`、`appendLlmRequestLog`、`appendLlmResponseLog` 從 `openai.ts` 移至 `llmUsage.ts` 並 export，讓 openai 與 gemini 共用同一套 log 寫入邏輯。(2) `backend/src/services/openai.ts`：移除本地 `llmLogContextFields`/`appendLlmRequestLog`/`appendLlmResponseLog` 定義及不再需要的 `fs`/`path`/`LLM_REQUEST_LOG_FILE`/`currentLlmUsageContext` 匯入；改為從 `llmUsage.ts` import `appendLlmRequestLog`/`appendLlmResponseLog`（呼叫點不變）。(3) `backend/src/services/gemini.ts`：新增 import `appendLlmRequestLog`/`appendLlmResponseLog` from `llmUsage.ts`；`callGeminiJson` 與 `callGeminiTextStream` 各新增選填的 `label` 參數；在發起 fetch 前寫入 request log（含 `ts`/`provider: 'gemini'`/`label`/`model`/`maxOutputTokens`/`temperature`），在解析回應後寫入 response log（含 `ts`/`provider: 'gemini'`/`label`/`model`/`latencyMs`/`usage`/`raw_content_length`），`callGeminiTextStream` 額外加上 `stream: true` 欄位。新增測試（`backend/test/llmUsage.test.ts`，2 項）：`MODEL_PRICE_PER_1M_TOKENS` 含 Gemini 模型定價（驗證 `gemini-2.0-flash` input/output 值）；`appendLlmResponseLog` 寫入的 Gemini response 條目可被 `summarizeLlmUsage` 正確彙總並計算費用（1M input + 1M output tokens 的 gemini-2.0-flash = $0.375）。驗證：`npx tsc --noEmit`（backend）通過；`npx tsx --test test/llmUsage.test.ts`，7/7 通過（含新增 2 項）；全量 `npm test`（backend），213 項中 195 項通過、18 項失敗，18 項失敗與既有失敗基線一致。已 commit 至分支 `feature/gemini-llm-logging-20260616`（commit 474bbd2）。

- 時間: 2026-06-16 15:00:00 +0800
- 分支: feature/animation-auto-focus-ai-formula-20260616
- 內容: 由於 master 中 TODO.md 當下已無未完成的 `[ ]` 項目，依 CLAUDE.md 指示從 `docs/animation-slide-v1-design.md` §12「後續擴充方向」V2 條目尋找下一項可獨立完成的工作。`custom-script` 的 AI 生成已於前一週期（`feature/animation-auto-focus-ai-custom-script-20260616`）完成，而 `formula` 效果類型（已於 `feature/animation-formula-effect-20260616` 完成前端渲染）在 `auto-focus-ai` 中仍未支援，故選定此項：讓 AI 自動產生焦點動畫（`POST /api/pdfs/:id/pages/:n/animation/auto-focus-ai`）也能根據逐字稿內容判斷是否適合插入一段 KaTeX 公式，並指定其 LaTeX 原始碼。實作：於 `backend/src/services/animationAutoFocus.ts` (1) 將 `AUTO_FOCUS_AI_EFFECT_TYPES` 擴充為包含 `'formula'`；(2) 新增 import `MAX_FORMULA_LENGTH`；(3) `AutoFocusItemSchema` 新增選填欄位 `formulaLatex: z.string().min(1).max(MAX_FORMULA_LENGTH).optional()`；(4) 更新 `buildAutoFocusSystemPrompt()`：新增 `formula` 類型說明與 `formulaLatex` 欄位說明，範例 JSON 加入公式範例；(5) 更新 `mapAutoFocusResponseToEffects()`：`formula` 分支取 `formulaLatex?.trim()`，非空則截斷至 200 字元設為 `effect.formula`，否則退回 `highlight-box`（與既有 `text-callout`/`step-list` 退回邏輯一致）。新增測試（`backend/test/page-animation.test.ts`，5 項）：正確映射 `formulaLatex`→`effect.formula`、超長截斷、缺少/空白時退回 `highlight-box`、輸出通過 `validateAnimationSpec`。驗證：以 Node 22.12.0 執行全量 `npm test`（backend），211 項中 193 項通過、18 項失敗，18 項失敗與既有失敗基線（188/206，18 項失敗）完全一致，新增 5 項測試全數通過。已 commit 至分支 `feature/animation-auto-focus-ai-formula-20260616`（commit 9633566）。

- 時間: 2026-06-16 11:35:00 +0800
- 分支: feature/animation-auto-focus-ai-overlay-image-20260616
- 內容: 由於 master 中 TODO.md 當下已無未完成的 `[ ]` 項目，依 CLAUDE.md 指示從設計文件「後續擴充方向」尋找下一項可獨立完成的工作：讓 AI 自動產生焦點動畫（`auto-focus-ai`）能選擇 `overlay-image` 效果類型，並從本頁已擷取的圖表素材中自動選取適合的一張（`figureId`）；`figureId` 無效或不在可用清單時退回 `highlight-box`，與既有 `text-callout`/`step-list`/`formula` 退回機制一致。實作：(1) `backend/src/services/animationAutoFocus.ts`：新增 `import type { FigureEntry }` 與 `MAX_OVERLAY_IMAGE_FIGURE_ID_LENGTH` import；新增常數 `MAX_FIGURES_FOR_AI_PROMPT = 5`；`AUTO_FOCUS_AI_EFFECT_TYPES` 加入 `'overlay-image'`；`AutoFocusItemSchema` 新增 `figureId?: z.string().min(1).max(MAX_OVERLAY_IMAGE_FIGURE_ID_LENGTH)`；`buildAutoFocusSystemPrompt()` 接受 `figures?: FigureEntry[]`，當有可用圖表時條件性加入 `overlay-image` 類型說明、`figureId` 欄位說明與範例 JSON；`buildAutoFocusUserPrompt()` 接受 `figures?: FigureEntry[]`，將圖表清單（ID、位置百分比、說明）加入 user message；`mapAutoFocusResponseToEffects()` 新增 `validFigureIds?: Set<string>` 參數與 `overlay-image` 分支（驗證 `figureId` 是否在白名單，無效退回 `highlight-box`，有效設為 `effect.figureId`）；`generateAiFocusEffects()` 接受 `figures?: FigureEntry[]`，建立 `validFigureIds` Set 並傳遞至 prompt builder 與 mapper。(2) `backend/src/routes/pdfs/page-animation.ts`：新增 import `getPageFigures`/`loadFigureSelection`，在 `auto-focus-ai` endpoint 取得本頁圖表、過濾使用者排除的項目後傳給 `generateAiFocusEffects`。(3) `backend/src/worker/regenerate.ts`：同樣新增 import `getPageFigures`，在 `generateAnimationForPage` 取得並過濾本頁圖表後傳給 `generateAiFocusEffects`。新增測試（`backend/test/page-animation.test.ts`，7 項）：`mapAutoFocusResponseToEffects` 正確映射有效 `figureId`（含 `exitDuration`）、缺少 `figureId` 退回 `highlight-box`、`figureId` 不在白名單退回 `highlight-box`、不提供 `validFigureIds` 時接受任意 `figureId`、輸出通過 `validateAnimationSpec`；POST `auto-focus-ai` API 有圖表時回傳 `overlay-image` 效果、`figureId` 不在頁面圖表中退回 `highlight-box`。驗證：`npx tsc --noEmit`（backend）通過；全量 `npm test`（backend，Node 22.12.0），220 項中 202 項通過、18 項失敗，18 項失敗與既有失敗基線一致，新增 7 項測試全數通過。已 commit 至分支 `feature/animation-auto-focus-ai-overlay-image-20260616`（commit 303c5b1）。

- 時間: 2026-06-16 12:00:00 +0800
- 分支: feature/llm-stage-tracking-20260616
- 內容: 由於 master 中 TODO.md 當下已無未完成的 `[ ]` 項目，依 CLAUDE.md 指示從 `docs/pipeline-stage-and-page-timing.md` §13 待辦清單尋找下一項可獨立完成的工作：「stage 層級細分 + 更多模型計價」。此項目要求將 LLM 成本追蹤從 run 層級（已有）細化至 pipeline stage 層級，並補充更多模型定價資料。實作：(1) `backend/src/services/llmUsage.ts`：新增 `stageName?: string` 至 `LlmCallContext`；更新 `llmLogContextFields()` 輸出 `stage_name` 欄位；更新 `LlmResponseLogEvent` interface 含 `stage_name?: string`；擴充 `MODEL_PRICE_PER_1M_TOKENS` 含 gpt-4.1/gpt-4.1-mini/gpt-4.1-nano 家族、版本化 gpt-4o（`-2024-11-20`/`-2024-08-06`/`-2024-05-13`）、Gemini 2.5 Flash/Pro 及其 preview 別名；新增 `summarizeLlmUsageByStageForRun(runId)` 單一 run 查詢版本，以及 `summarizeLlmUsageByStageForRuns(runIds[])` 單次掃描多個 run 的高效版本。(2) `backend/src/worker/regenerate.ts`：新增 `currentLlmUsageContext` import；在 step 迴圈（`for (let i = 0; i < state.steps.length; i++)`）的 `try` 區塊前呼叫 `setLlmUsageContext({ ...currentLlmUsageContext(), stageName: timingStageForStep(step.name) })`，讓各步驟（`generate_scripts`/`synthesize_audio`/`generate_animations`/`render_pages`）的 LLM 呼叫自動帶上 `stage_name`。(3) `backend/src/types.ts` 與 `frontend/src/types.ts`：`PipelineRunSummary` 新增 `llm_usage_by_stage: Record<string, LlmUsageSummary>` 欄位。(4) `backend/src/routes/pdfs/runs.ts`：改用 `summarizeLlmUsageByStageForRuns` 並與 `summarizeLlmUsageByRunIds` 並行執行（`Promise.all`），在各 run 回應中帶入 `llm_usage_by_stage`。(5) `frontend/src/pages/play/PlayPageSlidePanel.tsx`：當 `llm_usage_by_stage` 有 2 個以上 stage 時，於 LLM 用量總覽行下方顯示各 stage 的細分資訊（`stage`：次數、tokens、估計費用）。(6) `frontend/src/lib/api.run-history.test.ts`：補充 `llm_usage_by_stage: {}` 至測試 mock 資料（配合新的必要欄位）。新增測試（`backend/test/llmUsage.test.ts`，3 項）：`MODEL_PRICE_PER_1M_TOKENS` 含 GPT-4.1 與 Gemini 2.5 定價；`summarizeLlmUsageByStageForRun` 正確依 `stage_name` 分組並處理無 `stage_name` 舊記錄（歸入 `'(unknown)'`）；`summarizeLlmUsageByStageForRuns` 一次掃描多個 run 並正確過濾不在查詢集的 run。驗證：`npx tsc --noEmit`（backend 與 frontend）均通過；`npm test`（backend），216 項中 198 項通過、18 項失敗，18 項失敗與既有失敗基線一致，新增 4 項測試（含 1 項定價測試）全數通過。已 commit 至分支 `feature/llm-stage-tracking-20260616`（commit 5ab3c68）。

- 時間: 2026-06-16 12:20:00 +0800
- 分支: feature/animation-auto-focus-ai-pointer-20260616
- 內容: 由於 master 中 TODO.md 當下已無未完成的 `[ ]` 項目，依 CLAUDE.md 指示從設計文件 §12 後續擴充方向尋找下一項可獨立完成的工作：`pointer` 效果已納入 `OVERLAY_EFFECT_TYPES`（分支 `feature/animation-pointer-effect-20260615`），但 `auto-focus-ai` AI 自動產生焦點動畫尚未能選擇 `pointer` 類型，是最自然的補齊項目。實作：(1) `backend/src/services/animationAutoFocus.ts`：`AUTO_FOCUS_AI_EFFECT_TYPES` 加入 `'pointer'`（放在 `step-list` 和 `custom-script` 之間）；更新 JSDoc 提及 pointer；`buildAutoFocusSystemPrompt()` 更新項目 #2 的 type 說明，加入「pointer（顯示一個指標游標，精準指向投影片上的某一個點）」及使用時機（精準指向某個特定點，如圖表上的交叉點、數值或圖例，相對於 shape 是圈住一個區域）；更新項目 #3 說明 pointer 只需要 xPct/yPct（指標尖端位置），不需要 widthPct/heightPct；在 JSON 範例加入 pointer 範例（`{"line":4,"show":true,"type":"pointer","xPct":62,"yPct":38,"exitDuration":2}`）；`mapAutoFocusResponseToEffects()` 的 `params` 設定改為條件式：`type === 'pointer'` 時只設定 `{ xPct, yPct }`（預設 50/50，夾在 [0,100]），其他類型維持原本 `{ xPct, yPct, widthPct, heightPct }` 四欄位（pointer 不需要 widthPct/heightPct，`validateAnimationSpec` 雖會過濾多餘 params，但直接不產生更乾淨）；更新 `mapAutoFocusResponseToEffects` JSDoc 說明 pointer 只含 xPct/yPct 且無 fallback。(2) 新增測試（`backend/test/page-animation.test.ts`，4 項）：`mapAutoFocusResponseToEffects` 正確映射 pointer items（params 只有 xPct/yPct）、預設 xPct/yPct 為 50、超出範圍時夾在 [0,100]、輸出通過 `validateAnimationSpec`。驗證：`npx tsc --noEmit`（backend）通過；`npm test`（backend），4 項新增測試（ok 104-107）全數通過；整體 222 項中 4 項新增測試全部通過，19 項失敗中有 1 項為偶發性干擾（隔離執行 `renderTextPagesWithLlm` 測試通過），其餘 18 項與既有失敗基線一致。已 commit 至分支 `feature/animation-auto-focus-ai-pointer-20260616`（commit 0dae594）。

- 時間: 2026-06-16 14:00:00 +0800
- 分支: feature/animation-effect-drag-position-20260616
- 內容: 使用者在 TODO.md 新增項目「讓效果的位置可以使用 mouse 直接修改」。實作：在 `frontend/src/pages/play/AnimationEditorTab.tsx` 新增 `EffectPositionEditor` 元件，於動畫效果卡片的位置控制區（既有數字輸入框上方）以投影片縮圖為背景顯示可拖曳互動層：(1) 一般 overlay 效果（`highlight-box`/`spotlight`/`text-callout`/`shape`/`step-list`/`overlay-image`/`formula`，不含 `custom-script`）：顯示紫色半透明矩形，中央可拖曳移動，四邊與四角各有 8 個 resize handle，對應 `nw`/`n`/`ne`/`e`/`se`/`s`/`sw`/`w` 縮放方向，游標依方向切換為對應的 resize cursor；(2) `pointer` 效果：僅顯示可拖曳的圓點（僅 move，不含 resize）。拖曳機制使用 Pointer Events API 的 `setPointerCapture`，避免游標移出元素時失去事件。座標轉換：`(clientX - containerLeft) / containerWidth * 100`，結果以 0.1% 精度四捨五入並夾在合理範圍（`xPct`/`yPct` 0~100，`widthPct`/`heightPct` 最小 2）。縮圖容器為 `paddingTop: 56.25%` 的 16:9 aspect ratio box，與實際投影片比例一致；縮圖來源為 `currentPage.image_url`（已存在於 `usePlayPageContext()` 回傳值），故無需額外 API 呼叫。數字輸入框保留作為精確補充控制項，兩者同步。元件在 `disabled`（編輯器忙碌/唯讀）時不響應拖曳。`useCallback` 用於穩定化 `onPointerDown`/`onPointerMove`/`onPointerUp` 以避免不必要重繪。\n\n驗證：`npx tsc --noEmit`（frontend）通過；`npx tsx --test src/lib/*.test.ts`（frontend），71/71 通過；環境中無可用的互動瀏覽器可進行端對端視覺驗證，故僅以 tsc/單元測試驗證。已 commit 至分支 `feature/animation-effect-drag-position-20260616`（commit 2bf185a）。

- 時間: 2026-06-17 00:00:00 +0800
- 分支: feature/animation-manim-tex-mathtex-20260616
- 內容: 新增 `Manim.tex(latex, opts?)` 到 `window.Manim` helper script：在 sandboxed iframe 中透過 `window.parent.postMessage({ type: 'renderLatex', id, latex }, '*')` 向 host 頁面（PlayPage.tsx）請求 KaTeX MathML 渲染，host 頁面以 `katex.renderToString(latex, { output: 'mathml', throwOnError: false, displayMode: true })` 渲染後以 `{ type: 'latexResult', id, html }` 回覆，sandbox 接收後 resolve Promise 並回傳含 MathML 的 `<div>` 元素，支援 `opts.color`/`opts.fontSize` 樣式設定。此架構完全離線可用，sandbox 無需網路存取 KaTeX 字型。更新 `animationCustomScript.ts` 後端系統提示詞說明 `Manim.tex` API；更新 `docs/animation-slide-v1-design.md` §12 V2.x 擴充紀錄。驗證：`npm --prefix frontend run build` 與 `npm --prefix backend run build` 均通過。

# 2026-06-17 動畫 V2 新增項目

[x] 允許 `shape` 效果自訂顏色與線寬（完成於分支: feature/animation-shape-color-strokewidth-20260617）
[x] `step-list` 效果的 AI 自動生成：在 `auto-focus-ai` 中，讓 AI 除了依逐字稿選擇 `step-list` 類型外，也能依逐字稿語境自動產生 `items` 條列文案（與逐字稿同語言），類似 `text-callout` 的 AI 文案生成邏輯。（已確認實作完整：系統提示詞第 6 點要求 AI 生成 items 內容，mapAutoFocusResponseToEffects 正確映射，整合測試已存在）
[x] `formula` 效果的 AI 自動生成：在 `auto-focus-ai` 中，讓 AI 依逐字稿內容自動判斷是否適合插入公式，並生成對應的 LaTeX 字串（`formulaLatex`）；若逐字稿包含數學式、物理公式或統計式，AI 選擇 `formula` 類型並提供正確的 LaTeX。（目前僅支援 `formulaLatex` 欄位映射，但 AI 選擇 `formula` 類型的能力已在 `feature/animation-auto-focus-ai-formula-20260616` 實作；此項目為補齊 AI 自動判斷公式內容品質的測試與提示詞優化）（完成於分支: feature/animation-auto-focus-ai-formula-quality-20260617）
[x] 將 `AnimationSpec.hints` 傳入 LLM 動畫生成：目前 `hints`（逐字稿句子的動畫指引）僅儲存在 `AnimationSpec` 並顯示於編輯器，但 `auto-focus-ai` 的 LLM 提示詞還未讀取並傳入 `hints`；應在 `buildAutoFocusUserPrompt()` 中將本頁 `hints` 的內容加入 user prompt，讓 AI 在決定每一句的效果時能參考使用者提供的手動指引。（已確認實作存在於 buildAutoFocusUserPrompt() 與前端 AnimationEditorTab.tsx 的呼叫端）
[x] 動畫 `custom-script` 的 `Manim.tex` 範例提示詞與測試：新增 `Manim.tex` 到 `custom-script` 對話框的「範例提示詞」下拉選單（例如「用 Manim 在畫面中顯示愛因斯坦公式 E=mc²」），並補充後端測試確認 `Manim.tex` 相關關鍵字不會被 `findUnsafeScriptPattern` 誤判為不安全（`postMessage`/`parent` 由 `Manim.tex` 內部使用，不應被拒絕）。（完成於分支: feature/animation-custom-script-manim-tex-examples-20260617）
[x] `overlay-image` 效果的縮放比例鎖定選項：目前 `overlay-image` 效果的寬高可自由調整，但使用者無法鎖定圖片的原始長寬比；應新增「鎖定比例」checkbox，勾選後調整寬度時高度自動按原始圖片比例計算（需在前端取得圖片實際尺寸）。（完成於分支: feature/animation-overlay-image-lock-ratio-20260617）
[x] 動畫效果批次套用至多頁：新增「套用至全部頁面」或「套用至選取頁面」功能，讓使用者可以把某一頁的動畫設定（或特定效果）一鍵複製到其他頁面；與現有的「複製本頁效果」（只複製到剪貼簿，手動切換頁面後貼上）不同，批次套用可以選擇多頁同時套用。（完成於分支: feature/animation-batch-apply-to-pages-20260617）
[x] `pointer` 效果的方向自訂：目前 `pointer` 效果渲染為固定方向的游標圖示；應新增 `angle`（旋轉角度，度，預設 0）欄位，讓使用者可以在動畫編輯器中調整指標方向（例如向上、向右、斜角指向目標）；在 `SlideRenderer` 的 `pointer` 渲染元件中依 `effect.angle` 旋轉圖示。（完成於分支: feature/animation-pointer-angle-20260617）
[x] 動畫效果的播放預覽跳轉：在動畫編輯器的效果卡片上新增「跳至此效果」按鈕，按下後將音訊播放器的 `currentTime` seek 到 `effect.start` 秒，讓使用者可以快速預覽特定效果；需與 `PlayPage` 的音訊控制整合。（完成於分支: feature/animation-jump-to-effect-start-20260617）
[x] `Manim` 的 `transform` 路徑變形（path morphing）：目前 `Manim.animate.transform(from, to, progress)` 只做屬性線性插值（屬性相同才能 lerp），不支援真正的 SVG 路徑變形（`<path d>` 的形點插值）；應研究以 `flubber.js` 或自行實作的 cubic Bézier 插值達到 circle→square 等基本形狀路徑變形，並更新 `manimHelperScript.ts` 的 `Manim.animate.transform` 方法。（完成於分支: feature/animation-manim-path-morphing-20260617）
[x] 加入 MCP server 的功能，讓 claude code 或其它任何 agent 可以透過 makeslide 生成簡報影片（完成於分支: feature/mcp-server-20260617）

- 時間: 2026-06-17 00:30:00 +0800
- 分支: feature/animation-shape-color-strokewidth-20260617
- 內容: 新增 `shape` 效果的 `color`（CSS hex 描邊顏色，預設 `#f43f5e`）與 `strokeWidth`（SVG 線寬，範圍 1-20，預設 5）欄位：(1) `backend/src/services/pageAnimation.ts` 新增 `color: z.string().max(20).regex(/^#[0-9a-fA-F]{3,8}$/)` 與 `strokeWidth: z.number().min(1).max(20)` 至 `EffectSchema`，新增 `AnimationEffect.color`/`AnimationEffect.strokeWidth` 型別欄位，新增 `DEFAULT_SHAPE_STROKE_COLOR`/`DEFAULT_SHAPE_STROKE_WIDTH`/`MAX_SHAPE_COLOR_LENGTH`/`MAX_SHAPE_STROKE_WIDTH` 常數，`validateAnimationSpec` 通透傳遞這兩個欄位（`strokeWidth` 夾在 1-20 並取整）；(2) `frontend/src/types.ts` 鏡像 `color?`/`strokeWidth?` 欄位至 `SlideAnimationEffect`；(3) `frontend/src/components/slide/SlideRenderer.tsx` 改用 `effect.color ?? '#f43f5e'` 與 `effect.strokeWidth ?? 5` 取代硬編碼值，箭頭 strokeWidth 維持比基底多 1 的比例；(4) `frontend/src/pages/play/AnimationEditorTab.tsx` 在 `shape` 類型的圖形種類選單之後新增顏色選色器（`type="color"` input）與線寬數值輸入框（1-20，整數）；(5) `frontend/src/locales/zh-TW.ts` 與 `en.ts` 補充 `play.animation.shapeColor`/`play.animation.shapeStrokeWidth` 翻譯鍵。驗證：`npm --prefix frontend run build` 通過；`npm --prefix backend run build` 通過；`npx tsx --test backend/test/page-animation.test.ts`，104/104 通過。

- 時間: 2026-06-17 09:00:00 +0800
- 分支: feature/animation-pointer-angle-20260617
- 內容: 完成 `pointer` 效果的方向自訂功能：新增 `angle`（旋轉角度，度，預設 0）欄位至 `AnimationEffect` 類型（前後端皆同步）；將 `SlideRenderer` 的 pointer 渲染從發光圓點改為 SVG 游標箭頭圖示，並依 `effect.angle` 旋轉；在 `AnimationEditorTab` 的指標位置控制區段下方新增角度輸入框（-180 至 180，步進 15），顯示於 pointer 效果卡片中；補充中英文翻譯鍵 `play.animation.pointerAngle`。前後端 build 均通過。

- 時間: 2026-06-17 09:15:00 +0800
- 分支: feature/animation-jump-to-effect-start-20260617
- 內容: 完成動畫效果播放預覽跳轉：在每個效果卡片的操作列新增 ⏮ 按鈕（「跳至效果起點」），點擊後將音訊播放器 currentTime seek 到 effectStart 秒，讓使用者可快速預覽特定效果從頭播放的畫面；同時保留原有 ⏱ 跳至中點按鈕；補充中英文翻譯鍵 `play.animation.jumpToEffectStart`；另確認並標記 item 1251（AnimationSpec.hints 傳入 LLM）為已完成（程式碼確認該功能已存在於 buildAutoFocusUserPrompt()）。frontend build 通過。

- 時間: 2026-06-17 09:30:00 +0800
- 分支: feature/animation-custom-script-manim-tex-examples-20260617
- 內容: 完成 custom-script 對話框的範例提示詞下拉選單，新增 5 個範例（含 Manim.tex 顯示愛因斯坦公式、Manim 座標平面動畫、Manim 形狀變形、Canvas 計數器、SVG 箭頭等），選擇後自動填入聊天輸入框；新增後端測試 `findUnsafeScriptPattern allows Manim.tex call patterns without flagging them`，確認 Manim.tex() 呼叫方式（含 await/then 鏈）通過安全檢查，並確認 `parent`/`postMessage` 作為一般識別字不被誤判；補充中英文翻譯鍵（6 個新增鍵）。後端測試 #119 通過，frontend build 通過。

- 時間: 2026-06-17 09:45:00 +0800
- 分支: feature/animation-overlay-image-lock-ratio-20260617
- 內容: 完成 overlay-image 效果的縮放比例鎖定功能：(1) 新增 `figureNaturalRatios` 狀態（Record<figureId, ratio>），在圖片縮圖 onLoad 時捕捉 naturalWidth/naturalHeight 比例；(2) 新增 `lockedAspectEffectIds` 狀態（Set），追蹤已鎖定比例的效果；(3) 在圖片縮圖旁新增 🔒/🔓 按鈕切換鎖定狀態，鎖定時顯示紫色高亮；(4) 當鎖定且 widthPct 改變時（數字輸入框或拖曳 resize handle），自動計算並更新 heightPct = widthPct / ratio；補充中英文翻譯鍵 `lockAspectRatio`/`unlockAspectRatio`。frontend build 通過。

- 時間: 2026-06-17 10:00:00 +0800
- 分支: feature/animation-batch-apply-to-pages-20260617
- 內容: 完成動畫效果批次套用至多頁功能：在 `AnimationEditorTab.tsx` 新增 `handleApplyToAllPages` 函式，確認用戶後將目前頁面的完整 `AnimationSpec`（draft）依序呼叫 `savePageAnimation` API 套用至其他每一頁（跳過當前頁）；新增「套用至全部頁面」按鈕（sky/blue 顏色），顯示條件為 `totalPages > 1`，套用過程中切換為 Busy 文字並停用；從 `usePlayPageContext()` 新增解構 `totalPages`；新增 `applyingToAll` loading state；補充中英文翻譯鍵 `applyToAllPages`/`applyToAllPagesHint`/`applyToAllPagesBusy`/`applyToAllConfirm`（確認對話框含 `{n}` 頁數佔位符）。frontend build 通過。

- 時間: 2026-06-17 10:15:00 +0800
- 分支: feature/animation-auto-focus-ai-formula-quality-20260617
- 內容: 確認 item 1249（step-list AI 自動生成）已完整實作（系統提示詞第 6 點、mapAutoFocusResponseToEffects、整合測試均存在），標記為已完成。item 1250（formula AI 自動生成品質補強）：(1) 優化 buildAutoFocusSystemPrompt() 的 type 選擇說明，加入「包括以文字描述的公式（例如 E 等於 mc 平方）」、「單純百分比/日期/簡單計數不算公式應選 text-callout」；(2) 優化 formulaLatex 欄位說明，加入「若逐字稿以文字描述公式請將其轉為對應 LaTeX」及「缺少/空白/無法以標準 LaTeX 表示時請改選 highlight-box」；(3) 新增整合測試 `POST animation/auto-focus-ai returns a formula effect with formulaLatex`（ok 111）；(4) 新增整合測試 `POST animation/auto-focus-ai falls back formula without formulaLatex to highlight-box`（ok 112）。後端 tsc 通過，216 項測試中 2 項新測試（ok 111-112）通過，20 項失敗均為既有失敗基線。

- 時間: 2026-06-17 10:30:00 +0800
- 分支: feature/animation-manim-path-morphing-20260617
- 內容: 完成 Manim.animate.transform 的 SVG 路徑變形（path morphing）功能：(1) 新增 KAPPA=0.5523 常數（circle 以 4 段 cubic Bézier 近似用）；(2) `circleMorphSegs(el)` 將 `<circle>` 分解為 4 個 cubic Bézier 段（以 cardinal 方向的 top/right/bottom/left 作為錨點，順時鐘排列）；(3) `rectMorphSegs(el)` 將 `<rect>` 分解為對應的 4 個段（錨點為各邊中點，控制點放在角落以產生軸對齊切線，與 circle 的切線方向一致，讓插值視覺上流暢）；(4) `getMorphSegs(m)` 依 kind 分派，目前支援 circle 與 rect（含 square）；(5) `lerpSegs` 和 `segsToPathD` 完成控制點插值與 SVG `d` 屬性產生；(6) 修改 `animate.transform`：若兩個 mobject 都支援 morphing，第一次呼叫建立共用 `<path>` 元素（`from._morphEl`）並隱藏原始元素，後續呼叫更新 path d 與顏色插值；否則退回原本的交叉淡化+屬性插值。測試：更新 `loadManim()` 的 sandbox stub 新增 `window.addEventListener`/`removeEventListener`/`parent.postMessage`（讓既有測試在有 `tex()` 的新版 script 下不出錯）；更新既有 circle→circle transform 測試（改為驗證 path morphing 行為）；新增 circle→circle morphing 生成 `<path>` 元素的測試；新增 circle→square 跨型態 morphing 測試；新增 line→line 退回交叉淡化的測試。前端 tsc 通過，build 通過，15/15 單元測試通過。

- 時間: 2026-06-17 10:45:00 +0800
- 分支: feature/mcp-server-20260617
- 內容: 完成 MCP server 功能，讓 claude code 或其它 MCP 相容的 agent 可透過 makeslide 生成簡報影片。新增：(1) `backend/src/config.ts` 加入 `MCP_AUTH_TOKEN`（選填，設定後允許以 Bearer token 認證，不需 OAuth session cookie）；(2) `backend/src/server.ts` 在 OAuth auth hook 中新增 Bearer token 驗證分支（`Authorization: Bearer <token>` 比對 `config.mcpAuthToken`）；(3) `backend/src/mcp-server.ts` 實作完整的 MCP stdio server（JSON-RPC 2.0 over newline-delimited JSON）：支援 `initialize`/`initialized`/`ping`/`tools/list`/`tools/call` 方法，暴露 5 個工具：`list_presentations`（列出所有簡報）、`get_presentation`（取得詳細資訊含影片 URL）、`upload_pdf`（從本機路徑上傳 PDF）、`start_generation`（啟動生成流程，可選指定 stages）、`get_generation_status`（查詢任務狀態）；透過 `MAKESLIDE_URL`/`MAKESLIDE_MCP_TOKEN` 環境變數設定連接目標；doc comment 包含 Claude Code mcp_servers.json 設定範例；(4) `backend/package.json` 新增 `mcp-server` npm script（`tsx src/mcp-server.ts`）。後端 tsc 通過，build 通過，216 項測試 198 通過（18 項失敗為既有基線，無新增失敗）。

# 2026-06-17 系統分析後新增項目

[x] 將 `pointer` 效果加入 `auto-focus-ai` 可選類型：目前 `pointer` 效果已可在動畫編輯器中手動建立，但 `auto-focus-ai` 的 `AUTO_FOCUS_AI_EFFECT_TYPES` 尚未包含 `pointer`，導致 AI 無法自動選擇「精準指向某個點」的 pointer 效果；應將 `pointer` 加入可選類型列表，並更新系統提示詞說明 pointer 只需要 xPct/yPct（不需 widthPct/heightPct），同時在 `mapAutoFocusResponseToEffects` 中讓 pointer 只設定 xPct/yPct；補充對應測試。（完成於分支: feature/auto-focus-ai-pointer-20260617）
[x] MCP server 新增腳本讀寫工具：目前 MCP server 的 5 個工具只能管理簡報整體（上傳/生成/狀態），無法讀取或修改個別頁面的 AI 腳本；應新增 `get_page_script`（GET /api/pdfs/:id/pages/:n/script）和 `set_page_script`（PUT /api/pdfs/:id/pages/:n/script，若 API 不存在則需先新增）兩個 MCP 工具，讓 agent 可以在啟動生成前自訂各頁文案。（完成於分支: feature/mcp-page-script-tools-20260617）
[x] `formula` 效果的字型大小控制：目前 `formula` 效果在 `SlideRenderer` 中以固定字型大小渲染 KaTeX 公式；應新增 `fontSize`（CSS em 值，預設 1.5em，範圍 0.5-4em，步進 0.1）欄位，讓使用者可在動畫編輯器中調整公式大小，並在 `AnimationEffect` 型別與後端 `EffectSchema` 中同步更新。（完成於分支: feature/formula-font-size-20260617）
[x] `step-list` 效果的背景顏色自訂：目前 `step-list` 效果固定使用半透明深色背景（`bg-slate-900/90`）；應新增 `bgColor`（CSS hex 色碼，預設 `#1e293b`）與 `textColor`（預設 `#f1f5f9`）欄位，讓使用者可在動畫編輯器中自訂條列清單的背景色與文字色，並在 `SlideRenderer`/`AnimationEffect`/`EffectSchema` 中同步更新。（完成於分支: feature/step-list-colors-20260617）
[x] Manim path morphing 支援 polygon 形狀：目前 `Manim.animate.transform` 的路徑變形只支援 circle 和 rect/square（各自對應 `getMorphSegs`）；對於 `polygon` 形狀，應計算凸多邊形的 4 個 cardinal 最遠點（top/right/bottom/left），將其轉為 4 段 cubic Bézier，使 polygon↔circle、polygon↔rect 也能進行平滑路徑變形。（完成於分支: feature/manim-polygon-morphing-20260617）

# 2026-06-17 第二批新增項目

[x] `highlight-box` 效果邊框顏色自訂：目前 `highlight-box` 固定使用紅色邊框（`#ef4444`），無法根據投影片主題調整；應新增 `highlightColor` 欄位（CSS hex，預設 `#ef4444`），讓使用者可在動畫編輯器中自訂邊框顏色，並同步更新 `AnimationEffect` 介面（後端 `pageAnimation.ts`）、`EffectSchema`（Zod 驗證）、序列化、前端 `types.ts`、`SlideRenderer.tsx` 與 `AnimationEditorTab.tsx`（新增顏色選擇器）。（完成於分支: feature/highlight-box-color-20260617）

[x] `text-callout` 效果背景色與文字色自訂：目前 `text-callout` 固定使用暗色背景（`rgba(15,23,42,0.85)`）與亮白文字（`#f8fafc`），無法配合不同風格投影片；應新增 `textCalloutBgColor`（CSS hex，預設 `#0f172a`）和 `textCalloutTextColor`（CSS hex，預設 `#f8fafc`）欄位，使用者可在動畫編輯器中自訂，並同步更新後端 `AnimationEffect`/`EffectSchema`/序列化、前端 `types.ts`/`SlideRenderer`/`AnimationEditorTab`。（完成於分支: feature/text-callout-colors-20260617）

[x] `spotlight` 效果遮罩顏色與透明度自訂：目前 `spotlight` 固定使用黑色半透明遮罩（`rgba(0,0,0,0.6)`），無法調整；應新增 `spotlightColor`（CSS hex，預設 `#000000`）和 `spotlightOpacity`（0~1 數字，預設 `0.6`）兩個欄位，讓使用者在動畫編輯器中用顏色選擇器與滑桿自訂遮罩色與不透明度，並同步更新後端 `AnimationEffect`/`EffectSchema`/序列化、前端 `types.ts`/`SlideRenderer`/`AnimationEditorTab`。（完成於分支: feature/spotlight-color-opacity-20260617）

[x] Manim `indicateAround` 動畫效果：目前 `manimHelperScript.ts` 的 `animate` 提供 Create/Write/FadeIn/FadeOut/Transform 等動畫；應新增 `Manim.animate.indicateAround(m, progress, opts)` 函式，實作 manim 標誌性的「強調環繞」動畫（progress 0→0.5 縮放放大並改色，0.5→1 回縮並恢復原色），`opts` 可選 `scale`（預設 1.3）和 `color`（預設 `#f59e0b`）；新增對應測試。（完成於分支: feature/manim-indicate-around-20260617）

[x] auto-focus-ai 為 `pointer` 效果建議 `angle`：目前所有 AI 自動產生的 `pointer` 效果都使用預設角度（0 度，指向右下），未根據畫面內容選擇合適方向；應在 `AutoFocusItemSchema` 新增 `angle` 選填欄位（整數，0-359 度），在 system prompt 第 3 點補充 angle 說明（0=右下、90=左下、180=右上、270=左上，依指向目標在畫面中的位置選擇讓箭頭從外側指向目標的角度），在 `mapAutoFocusResponseToEffects` 中傳遞 angle 至 effect，並補充測試。 ✓ 完成於 branch: feature/auto-focus-ai-pointer-angle-20260617

[x] `pointer` 效果顏色自訂：目前 `pointer` 箭頭固定使用玫瑰紅色（`rgba(244,63,94,0.95)`），無法配合不同風格的投影片；應新增 `pointerColor` 欄位（CSS hex，預設 `#f43f5e`），讓使用者可在動畫編輯器中自訂箭頭顏色，並同步更新後端 `AnimationEffect` 介面、`EffectSchema`（Zod 驗證）、序列化、前端 `types.ts`、`SlideRenderer.tsx`（SVG fill 與 drop-shadow 顏色）、`AnimationEditorTab.tsx`（新增顏色選擇器）及中英文 i18n。 ✓ 完成於 branch: feature/pointer-color-20260617

[x] `pointer` 效果尺寸自訂：目前 pointer 箭頭固定為 `2.5rem × 2.5rem`，在不同解析度與投影片尺寸下可能顯得過大或過小；應新增 `pointerSize` 欄位（CSS rem 值，預設 `2.5`，範圍 1-6，步進 0.5），讓使用者可在動畫編輯器中調整箭頭尺寸，並同步更新後端 `AnimationEffect` 介面、`EffectSchema`、序列化及前端對應檔案。 ✓ 完成於 branch: feature/pointer-size-20260617

[x] `text-callout` 字型大小控制：目前 `text-callout` 效果固定使用 `1.25rem` 字型大小（`SlideRenderer.tsx`），無法配合不同長度的文字或投影片版面；應新增 `textCalloutFontSize` 欄位（CSS rem 值，預設 `1.25`，範圍 0.5-3，步進 0.125），讓使用者在動畫編輯器中自訂文字大小，並同步更新後端 `AnimationEffect`/`EffectSchema`/序列化、前端 `types.ts`/`SlideRenderer`/`AnimationEditorTab`（在 text-callout 編輯區新增數字輸入框）及中英文 i18n。 ✓ 完成於 branch: feature/text-callout-font-size-20260617

[x] `shape` 效果填充顏色自訂：目前 `shape` 效果只能設定 `stroke` 顏色與寬度，SVG 圖形的 `fill` 固定為 `'none'`（空心），若需要實心圖形（例如實心圓點、實心方塊當背景標記）只能靠自訂腳本達成；應新增 `shapeFillColor` 欄位（CSS hex，預設 `'none'` 表示無填充），讓使用者可在動畫編輯器中開啟 fill 並選擇顏色，並同步更新後端 `AnimationEffect`/`EffectSchema`/序列化、前端 `types.ts`/`SlideRenderer`（SVG fill 屬性）/`AnimationEditorTab`（在 shape 編輯區增加填充顏色選項）及 i18n。 ✓ 完成於 branch: feature/shape-fill-color-20260617

[x] Manim `animate.flash(m, progress, opts)` 效果：目前 `manimHelperScript.ts` 的 `animate` 提供 `indicateAround`（縮放+改色），但有時只需要「快速閃爍」而不縮放；應新增 `Manim.animate.flash(m, progress, opts)` 函式，讓元素的 fill/stroke 在 progress 0→0.5 漸變為 `opts.color`（預設 `'#ffffff'`），0.5→1 漸回原色，opacity 則在 0→0.5 升至 `opts.maxOpacity`（預設 `1`）、0.5→1 降回原始值，並新增至少 2 個對應 vm 測試。 ✓ 完成於 branch: feature/manim-flash-20260617

[x] `step-list` 字型大小控制：目前 `step-list` 效果的條列項目固定使用 `1.1rem` 字型大小（`SlideRenderer.tsx`），無法根據項目數量或投影片版面調整；應新增 `stepListFontSize` 欄位（CSS rem 值，預設 `1.1`，範圍 0.5-2.5，步進 0.1），讓使用者在動畫編輯器中自訂條列文字大小，並同步更新後端 `AnimationEffect`/`EffectSchema`/序列化、前端 `types.ts`/`SlideRenderer`/`AnimationEditorTab`（在 step-list 編輯區新增數字輸入框）及中英文 i18n。 ✓ 完成於 branch: feature/step-list-font-size-20260618

[x] `highlight-box` 邊框寬度控制：目前 `highlight-box` 效果的邊框寬度固定為 4px（`border: '4px solid ${hColor}'`），無法根據投影片重要程度或視覺風格調整粗細；應新增 `highlightBorderWidth` 欄位（px 整數，預設 `4`，範圍 1-12），讓使用者在動畫編輯器中自訂邊框粗細，並同步更新後端 `AnimationEffect`/`EffectSchema`/序列化、前端 `types.ts`/`SlideRenderer`（border 寬度與 box-shadow 寬度同步）/`AnimationEditorTab`（新增數字輸入框）及中英文 i18n。 ✓ 完成於 branch: feature/highlight-border-width-20260618

[x] `highlight-box` 圓角控制：目前 `highlight-box` 固定使用 `borderRadius: '8px'`，希望讓使用者能選擇更尖銳（0px）或更圓潤（如 24px）的邊框；應新增 `highlightBorderRadius` 欄位（px 整數，預設 `8`，範圍 0-50），讓使用者在動畫編輯器中自訂圓角半徑，並同步更新後端 `AnimationEffect`/`EffectSchema`/序列化、前端 `types.ts`/`SlideRenderer`/`AnimationEditorTab`（新增數字輸入框）及中英文 i18n。 ✓ 完成於 branch: feature/highlight-border-radius-20260618

[x] Manim `animate.uncreate(m, progress)` 效果：目前 `animate.create(m, progress)` 可以讓 SVG 路徑從頭到尾逐漸繪製出來，但沒有對應的反向動畫；應新增 `Manim.animate.uncreate(m, progress)` 函式，讓路徑從尾到頭逐漸消失（`strokeDashoffset` 從 0 增加至總長度，`opacity` 在 progress=1 時設為 `0`），並新增至少 2 個對應 vm 測試（一個驗證中間 dashoffset > 0，一個驗證 progress=1 時 opacity=0）。 ✓ 完成於 branch: feature/manim-uncreate-20260618

[x] `shape` 效果透明度控制：目前 `shape` 效果在動畫播放中始終以完全不透明方式顯示 SVG 圖形（opacity 由 GSAP fadeIn 控制，但靜態時固定為 1）；應新增 `shapeOpacity` 欄位（0-1 浮點數，預設 `1`，步進 0.05），讓使用者可在動畫編輯器中設定形狀本身的基礎透明度（疊加在 GSAP 淡入淡出之上），並同步更新後端 `AnimationEffect`/`EffectSchema`/序列化、前端 `types.ts`/`SlideRenderer`（SVG opacity 屬性）/`AnimationEditorTab`（新增數字輸入框）及中英文 i18n。 ✓ 完成於 branch: feature/shape-opacity-20260618

## 工作記錄

- 時間: 2026-06-17 11:00:00 +0800
- 分支: feature/auto-focus-ai-pointer-20260617
- 內容: 將 `pointer` 效果加入 `auto-focus-ai` 可選類型。在 `AUTO_FOCUS_AI_EFFECT_TYPES` 加入 `'pointer'`；更新 system prompt（第 2 點補充 pointer 的使用時機與 pointer vs shape 的差異說明，第 3 點說明 pointer 只需 xPct/yPct）；在 JSON 範例加入 pointer 示例；修改 `mapAutoFocusResponseToEffects` 使 pointer 的 params 只包含 xPct/yPct（不含 widthPct/heightPct），預設 50/50。新增 3 個整合測試（正常回傳 xPct/yPct、缺少座標時使用預設值、AI 提供 widthPct/heightPct 時 pointer 仍忽略）。

- 時間: 2026-06-17 12:00:00 +0800
- 分支: feature/mcp-page-script-tools-20260617
- 內容: MCP server 新增腳本讀寫工具。在 `detail.ts` 新增 `PUT /api/pdfs/:id/pages/:n/script` REST 端點（接受 `{ script: string }` body，最長 4096 字元，更新 DB 並寫入檔案，若頁面尚無 script_path 則從 page_uid 自動派生路徑）。在 `mcp-server.ts` 新增 `apiGetText`/`apiPut` 輔助函式及兩個 MCP 工具：`get_page_script`（讀取指定頁腳本）、`set_page_script`（覆寫指定頁腳本），讓 agent 可在啟動 AI 生成前自訂各頁文案，再搭配 `start_generation`（stages: ["audio"]）重新生成語音。

- 時間: 2026-06-17 13:00:00 +0800
- 分支: feature/formula-font-size-20260617
- 內容: 新增 `formula` 效果的字型大小控制。後端 `pageAnimation.ts` 新增 `DEFAULT_FORMULA_FONT_SIZE_EM`（1.5）、`MIN_FORMULA_FONT_SIZE_EM`（0.5）、`MAX_FORMULA_FONT_SIZE_EM`（4）常數，`AnimationEffect` interface 新增 `formulaFontSize?: number`，`EffectSchema` 新增對應 Zod 驗證，序列化時一併輸出。前端 `types.ts` 同步新增 `formulaFontSize` 欄位；`SlideRenderer.tsx` 將 `formulaFontSize`（預設 1.5em）套用至公式容器的 `fontSize` CSS 屬性；`AnimationEditorTab.tsx` 在 LaTeX 內容輸入下方加入字型大小數字輸入框（range 0.5-4, step 0.1），公式預覽也同步使用此值；中英文 i18n 新增 `play.animation.formulaFontSize` 翻譯鍵。

- 時間: 2026-06-17 14:00:00 +0800
- 分支: feature/step-list-colors-20260617
- 內容: 新增 `step-list` 效果的背景與文字顏色自訂。後端 `pageAnimation.ts` 新增 `DEFAULT_STEP_LIST_BG_COLOR`（`#1e293b`）與 `DEFAULT_STEP_LIST_TEXT_COLOR`（`#f1f5f9`）常數，`AnimationEffect` interface 新增 `stepListBgColor`/`stepListTextColor` 欄位，`EffectSchema` 新增 Zod hex color 驗證（最長 20 字元），序列化時一併輸出。前端 `types.ts` 同步新增兩個欄位；`SlideRenderer.tsx` 使用 `stepListBgColor`/`stepListTextColor`（帶預設值）作為容器 `background`/`color` 樣式；`AnimationEditorTab.tsx` 在條列項目 textarea 下方加入兩個 `<input type="color">` 選色器；中英文 i18n 新增 `play.animation.stepListBgColor`/`stepListTextColor` 翻譯鍵。

- 時間: 2026-06-17 15:00:00 +0800
- 分支: feature/manim-polygon-morphing-20260617
- 內容: 新增 Manim polygon 路徑變形支援。在 `manimHelperScript.ts` 新增 `parsePolygonPoints(pts)` 輔助函式（將 SVG polygon `points` 屬性字串解析為 `[[x,y],...]`，注意 template literal 內正則需用 `\\s` 而非 `\s` 以避免逸出錯誤）與 `polygonMorphSegs(el)` 函式（計算 4 個 cardinal 最遠點 top/right/bottom/left，並以 KAPPA × half-span 的 axis-aligned 控制點產生 4 段 cubic Bézier，與 `circleMorphSegs`/`rectMorphSegs` 的切線慣例一致）；更新 `getMorphSegs` 加入 `m.kind === 'polygon'` 分支。新增 3 個測試：polygon→circle 跨類型變形、polygon→polygon 同類型變形、polygon→rect 跨類型變形，全部 18 項測試通過。

- 時間: 2026-06-17 16:00:00 +0800
- 分支: feature/highlight-box-color-20260617
- 內容: 新增 `highlight-box` 效果邊框顏色自訂。後端 `pageAnimation.ts` 新增 `DEFAULT_HIGHLIGHT_BOX_COLOR = '#ef4444'` 常數與 `highlightColor?: string` 欄位，`EffectSchema` 新增 Zod hex color 驗證（重用現有 regex `^#[0-9a-fA-F]{3,8}$`，最長 20 字元），`validateAnimationSpec` 序列化時一併輸出。前端 `types.ts` 同步新增 `highlightColor` 欄位；`SlideRenderer.tsx` 使用 `effect.highlightColor ?? '#ef4444'` 作為邊框色並搭配對應的 box-shadow（`hColor + 'b3'` ≈ 70% 透明度）；`AnimationEditorTab.tsx` 在 `highlight-box` 分支新增顏色選擇器；中英文 i18n 新增 `play.animation.highlightColor` 翻譯鍵。

- 時間: 2026-06-17 17:00:00 +0800
- 分支: feature/text-callout-colors-20260617
- 內容: 新增 `text-callout` 效果的背景色與文字色自訂。後端 `pageAnimation.ts` 新增 `DEFAULT_TEXT_CALLOUT_BG_COLOR`（`#0f172a`）和 `DEFAULT_TEXT_CALLOUT_TEXT_COLOR`（`#f8fafc`）常數，`AnimationEffect` interface 新增 `textCalloutBgColor`/`textCalloutTextColor` 欄位，`EffectSchema` 重用現有 hex color 驗證，序列化時一併輸出。前端 `types.ts` 同步新增兩個欄位；`SlideRenderer.tsx` 使用 `textCalloutBgColor`/`textCalloutTextColor`（帶預設值）作為背景色與文字色；`AnimationEditorTab.tsx` 在 text-callout 編輯區塊將 textarea 包入 `<>...</>` 並加入兩個並排的顏色選擇器；中英文 i18n 新增 `play.animation.textCalloutBgColor`/`textCalloutTextColor` 翻譯鍵。

- 時間: 2026-06-17 18:00:00 +0800
- 分支: feature/spotlight-color-opacity-20260617
- 內容: 新增 `spotlight` 效果遮罩顏色與透明度自訂。後端 `pageAnimation.ts` 新增 `DEFAULT_SPOTLIGHT_COLOR`（`#000000`）和 `DEFAULT_SPOTLIGHT_OPACITY`（`0.6`）常數，`AnimationEffect` interface 新增 `spotlightColor?: string` 和 `spotlightOpacity?: number` 欄位，`EffectSchema` 對 spotlightColor 重用 hex color regex，spotlightOpacity 使用 `z.number().min(0).max(1)`，序列化時一併輸出。前端 `types.ts` 同步新增兩個欄位；`SlideRenderer.tsx` 將 `spotlightColor` + `spotlightOpacity` 轉換為 `rgba(r,g,b,opacity)` 字串，套用至 box-shadow（先從 hex 解析 r/g/b channel）；`AnimationEditorTab.tsx` 在 spotlight 分支新增顏色選擇器（color input）與透明度數字輸入（step 0.05，onChange 做 Math.min/max 限制）；中英文 i18n 新增 `play.animation.spotlightColor`/`spotlightOpacity` 翻譯鍵。

- 時間: 2026-06-17 19:00:00 +0800
- 分支: feature/manim-indicate-around-20260617
- 內容: 新增 Manim `indicateAround` 動畫效果。在 `manimHelperScript.ts` 的 `animate` 物件中新增 `indicateAround(m, progress, opts)` 函式：使用 0→0.5→1 的對稱 `phase`（phase = 在 0→0.5 是 `p*2`，在 0.5→1 是 `1-(p-0.5)*2`），對 phase 套用 `smooth()` 做插值，縮放從 1 到 `opts.scale`（預設 1.3），同時用 `lerpColor` 從原本的 stroke/fill 漸變至 `opts.color`（預設 `#f59e0b`，琥珀色）；progress=1 時清除 transform 並還原所有屬性，並刪除儲存的 `_indicateOrigStroke`/`_indicateOrigFill`。新增 2 個測試：(1) 自訂 scale/color 時 progress=0.5 縮放大於 1 且顏色偏移，progress=1 時完全還原；(2) 無 opts 時 scale 接近預設值 1.3（全部 20 項通過）。

- 時間: 2026-06-17 20:00:00 +0800
- 分支: feature/auto-focus-ai-pointer-angle-20260617
- 內容: 新增 auto-focus-ai `pointer` 效果的 `angle` 角度建議功能。在 `animationAutoFocus.ts` 的 `AutoFocusItemSchema` 新增 `angle: z.number().int().min(0).max(359).optional()` 選填欄位；system prompt 第 3 點補充 angle 說明（0=右下指入、90=左下指入、180=右上指入、270=左上指入，依目標位置在畫面中選擇讓箭頭從外側指向目標的角度）；範例 JSON 的 pointer 效果新增 `"angle":270`；`mapAutoFocusResponseToEffects` 函式在 `type === 'pointer'` 時將 `item.angle` 傳遞至 `effect.angle`。`page-animation.test.ts` 新增兩個單元測試：(1) 有 angle 時正確傳遞並通過 validateAnimationSpec；(2) 無 angle 時 effect.angle 維持 undefined。

- 時間: 2026-06-17 21:00:00 +0800
- 分支: feature/pointer-color-20260617
- 內容: 新增 `pointer` 效果箭頭顏色自訂。後端 `pageAnimation.ts` 新增 `DEFAULT_POINTER_COLOR = '#f43f5e'` 常數、`pointerColor?: string` 欄位（`AnimationEffect` 介面），`EffectSchema` 新增 Zod hex color 驗證（重用現有 regex `^#[0-9a-fA-F]{3,8}$`），序列化時一併輸出。前端 `types.ts` 同步新增 `pointerColor` 欄位；`SlideRenderer.tsx` 從 `effect.pointerColor ?? '#f43f5e'` 解析 r/g/b channel 並生成 `rgba()` 字串，套用至 SVG fill 與 drop-shadow filter；`AnimationEditorTab.tsx` 在 pointer 區塊的角度輸入後方（以 `<>...</>` 包覆）加入顏色選擇器；中英文 i18n 新增 `play.animation.pointerColor` 翻譯鍵。

- 時間: 2026-06-17 22:00:00 +0800
- 分支: feature/pointer-size-20260617
- 內容: 新增 `pointer` 效果箭頭尺寸自訂。後端 `pageAnimation.ts` 新增 `DEFAULT_POINTER_SIZE_REM = 2.5`、`MIN_POINTER_SIZE_REM = 1`、`MAX_POINTER_SIZE_REM = 6` 常數，`AnimationEffect` 介面新增 `pointerSize?: number`，`EffectSchema` 新增 `z.number().min(1).max(6)` 驗證，序列化時以 Math.max/min 夾至合法範圍再輸出。前端 `types.ts` 同步新增欄位；`SlideRenderer.tsx` 將 `effect.pointerSize ?? 2.5` 轉換為 `${rem}rem` 字串，套用至 pointer div 的 width/height；`AnimationEditorTab.tsx` 在顏色選擇器後加入數字輸入框（range 1-6, step 0.5）並顯示 rem 單位標籤；中英文 i18n 新增 `play.animation.pointerSize` 翻譯鍵。

- 時間: 2026-06-17 23:00:00 +0800
- 分支: feature/text-callout-font-size-20260617
- 內容: 新增 `text-callout` 效果字型大小控制。後端 `pageAnimation.ts` 新增 `DEFAULT_TEXT_CALLOUT_FONT_SIZE_REM = 1.25`、`MIN_TEXT_CALLOUT_FONT_SIZE_REM = 0.5`、`MAX_TEXT_CALLOUT_FONT_SIZE_REM = 3` 常數，`AnimationEffect` 介面新增 `textCalloutFontSize?: number` 欄位，`EffectSchema` 新增 `z.number().min(0.5).max(3)` 驗證，序列化時以 Math.max/min 夾至合法範圍。前端 `types.ts` 同步新增欄位；`SlideRenderer.tsx` 以 `${effect.textCalloutFontSize ?? 1.25}rem` 字串取代硬編碼的 `1.25rem`；`AnimationEditorTab.tsx` 在 text-callout 顏色選擇器下方加入數字輸入框（range 0.5-3, step 0.125），並在右側顯示 rem 單位標籤；中英文 i18n 新增 `play.animation.textCalloutFontSize` 翻譯鍵。

- 時間: 2026-06-18 00:00:00 +0800
- 分支: feature/shape-fill-color-20260617
- 內容: 新增 `shape` 效果填充顏色自訂。後端 `pageAnimation.ts` 新增 `shapeFillColor?: string` 欄位至 `AnimationEffect` 介面，`EffectSchema` 新增 Zod hex color 驗證（重用現有 regex `^#[0-9a-fA-F]{3,8}$`），序列化時一併輸出。前端 `types.ts` 同步新增欄位；`SlideRenderer.tsx` 新增 `const fill = effect.shapeFillColor ?? 'none'`，並將 circle/ellipse/rect 三種形狀的 SVG `fill` 屬性從硬編碼 `"none"` 改為此變數（arrow 形狀不受影響）；`AnimationEditorTab.tsx` 將原本的 `<div className="flex gap-2">` 改為 `<div className="flex flex-col gap-2">` 並新增第二行：一個核取方塊（checked = `shapeFillColor !== undefined`）加上「填充顏色」標籤，勾選後右側顯示顏色選擇器，取消勾選則清除欄位（送出 `undefined`）；中英文 i18n 新增 `play.animation.shapeFillColor` 翻譯鍵。

- 時間: 2026-06-18 01:00:00 +0800
- 分支: feature/manim-flash-20260617
- 內容: 新增 Manim `animate.flash` 閃爍效果。在 `manimHelperScript.ts` 的 `animate` 物件中新增 `flash(m, progress, opts)` 函式：使用 0→0.5→1 對稱 phase（與 `indicateAround` 相同策略），progress=0.5 時 fill/stroke 以 `lerpColor` 漸變至 `opts.color`（預設 `'#ffffff'`，白色），opacity 線性插值至 `opts.maxOpacity`（預設 `1`）；progress=1 時完全還原 stroke/fill 和 opacity，並刪除暫存的 `m._flashOrigStroke`、`m._flashOrigFill`、`m._flashOrigOpacity`。新增 2 個 vm 測試：(1) 自訂 color/maxOpacity 時 progress=0.5 顏色偏移、opacity 提升，progress=1 時完全還原；(2) 無 opts 時預設白色，progress=0.5 從 RED 偏移，progress=1 還原（全部 22 項通過）。

- 時間: 2026-06-18 02:00:00 +0800
- 分支: feature/step-list-font-size-20260618
- 內容: 新增 `step-list` 效果字型大小控制。後端 `pageAnimation.ts` 新增 `DEFAULT_STEP_LIST_FONT_SIZE_REM = 1.1`、`MIN_STEP_LIST_FONT_SIZE_REM = 0.5`、`MAX_STEP_LIST_FONT_SIZE_REM = 2.5` 常數，`AnimationEffect` 介面新增 `stepListFontSize?: number` 欄位，`EffectSchema` 新增 `z.number().min(0.5).max(2.5)` 驗證，序列化時以 Math.max/min 夾至合法範圍。前端 `types.ts` 同步新增欄位；`SlideRenderer.tsx` 以 `${effect.stepListFontSize ?? 1.1}rem` 字串取代 `<ul>` 的硬編碼 `1.1rem` fontSize；`AnimationEditorTab.tsx` 在 step-list 顏色選擇器下方加入數字輸入框（range 0.5-2.5, step 0.1）並顯示 rem 單位標籤；中英文 i18n 新增 `play.animation.stepListFontSize` 翻譯鍵。

- 時間: 2026-06-18 03:00:00 +0800
- 分支: feature/highlight-border-width-20260618
- 內容: 新增 `highlight-box` 效果邊框寬度控制。後端 `pageAnimation.ts` 新增 `DEFAULT_HIGHLIGHT_BORDER_WIDTH = 4`、`MAX_HIGHLIGHT_BORDER_WIDTH = 12` 常數，`AnimationEffect` 介面新增 `highlightBorderWidth?: number` 欄位，`EffectSchema` 新增 `z.number().int().min(1).max(12)` 驗證，序列化時以整數夾至合法範圍。前端 `types.ts` 同步新增欄位；`SlideRenderer.tsx` 以 `${hBw}px` 取代硬編碼 `4px`，並讓 box-shadow 光暈半徑等比縮放（`${hBw * 4}px`）；`AnimationEditorTab.tsx` 將原本的單顏色選擇器改為 `<div className="flex gap-3 items-end">` 並加入邊框寬度數字輸入框（range 1-12, step 1）及 px 單位標籤；中英文 i18n 新增 `play.animation.highlightBorderWidth` 翻譯鍵。

- 時間: 2026-06-18 04:00:00 +0800
- 分支: feature/highlight-border-radius-20260618
- 內容: 新增 `highlight-box` 效果圓角半徑控制。後端 `pageAnimation.ts` 新增 `DEFAULT_HIGHLIGHT_BORDER_RADIUS = 8`、`MAX_HIGHLIGHT_BORDER_RADIUS = 50` 常數，`AnimationEffect` 介面新增 `highlightBorderRadius?: number` 欄位，`EffectSchema` 新增 `z.number().int().min(0).max(50)` 驗證，序列化時以整數夾至合法範圍。前端 `types.ts` 同步新增欄位；`SlideRenderer.tsx` 以 `${hBr}px` 取代硬編碼 `8px` 的 borderRadius；`AnimationEditorTab.tsx` 在 highlight-box 的邊框顏色+寬度 flex 行中加入第三個數字輸入框（range 0-50, step 2）及 px 單位標籤；中英文 i18n 新增 `play.animation.highlightBorderRadius` 翻譯鍵。

- 時間: 2026-06-18 05:00:00 +0800
- 分支: feature/manim-uncreate-20260618
- 內容: 新增 Manim `animate.uncreate` 效果。在 `manimHelperScript.ts` 的 `animate` 物件中新增 `uncreate(m, progress)` 函式，與 `create` 對稱：text/dot/arrow/axes/numberPlane 類型直接將 `opacity` 設為 `1 - p`；路徑類型將 `strokeDashoffset` 設為 `len * p`（從 0 增加至完整長度），`fill-opacity` 從原始值線性遞減，progress=1 時將 opacity 設為 `'0'`。新增 2 個 vm 測試：(1) 路徑在 progress=0.5 時 dashoffset > 0，progress=1 時 opacity=0；(2) 同樣 progress 下，create 的 dashoffset 比 uncreate 大（create 從尾端開始顯示，uncreate 從頭端開始消除）。全部 24 項測試通過。

- 時間: 2026-06-18 06:00:00 +0800
- 分支: feature/shape-opacity-20260618
- 內容: 新增 `shape` 效果基礎透明度控制。後端 `pageAnimation.ts` 在 `AnimationEffect` 介面新增 `shapeOpacity?: number` 欄位，`EffectSchema` 新增 `z.number().min(0).max(1)` 驗證，序列化時以 Math.max/min 夾至合法範圍。前端 `types.ts` 同步新增欄位；`SlideRenderer.tsx` 以 `effect.shapeOpacity ?? 1` 作為 SVG 的 `opacity` style 屬性（疊加在 GSAP fadeIn/fadeOut 的動態 opacity 之上）；`AnimationEditorTab.tsx` 在 shape 填充顏色下方新增數字輸入框（range 0-1, step 0.05）；中英文 i18n 新增 `play.animation.shapeOpacity` 翻譯鍵。

## 2026-06-18 新增項目 Batch 4
[ ] `formula` 效果背景色與文字色自訂：目前 `formula` 效果的背景固定為 `rgba(15, 23, 42, 0.85)`（深藍色半透明），文字固定為 `#f8fafc`（近白色），無法根據投影片配色調整；應新增 `formulaBgColor?: string`（CSS hex，預設 `#0f172a`）和 `formulaTextColor?: string`（CSS hex，預設 `#f8fafc`）欄位，讓使用者在動畫編輯器的 formula 區塊中自訂背景色與文字色，並同步更新後端 `AnimationEffect`/`EffectSchema`/序列化、前端 `types.ts`/`SlideRenderer`/`AnimationEditorTab`（兩個顏色選擇器）及中英文 i18n。
[ ] Manim `animate.wiggle(m, progress, opts)` 抖動效果：目前 Manim helper 缺少讓元素左右小幅搖擺以吸引注意的動畫；應新增 `animate.wiggle(m, progress, opts)` 函式，opts 支援 `amplitude`（位移像素，預設 `8`）和 `frequency`（每回合振盪次數，預設 `3`），以 `sin(progress * frequency * 2π) * amplitude` 計算 translateX，並於 progress=1 時清除 transform；新增至少 2 個 vm 測試（一個驗證中間 progress 的 translateX ≠ 0，一個驗證 progress=1 時 transform 被清除）。
[ ] `highlight-box` 動畫效果—pulse 模式：目前 `highlight-box` 是靜態邊框；應新增 `highlightPulse?: boolean` 選項（預設 `false`），當啟用時，GSAP timeline 在效果顯示期間讓邊框 box-shadow 週期性放大/縮小，形成脈動視覺（可在 GSAP yoyo repeat 或自訂 progress 函式中實現），讓重要內容更加吸睛；在 `AnimationEditorTab` 新增 checkbox 控制，並更新後端驗證/序列化、前端 types.ts，及中英文 i18n。
[ ] `text-callout` 圓角半徑控制：目前 `text-callout` 效果固定使用 `borderRadius: '8px'`；應新增 `textCalloutBorderRadius` 欄位（px 整數，預設 `8`，範圍 0-32），讓使用者選擇更尖銳或更圓潤的文字框，並同步更新後端 `AnimationEffect`/`EffectSchema`/序列化、前端 `types.ts`/`SlideRenderer`/`AnimationEditorTab`（新增數字輸入框）及中英文 i18n。
[ ] Manim `animate.spinAround(m, progress, opts)` 旋轉效果：目前 Manim helper 的 `rotate` 是單向旋轉，缺少完整 360° 旋轉（自轉一圈）的效果；應新增 `animate.spinAround(m, progress, opts)` 函式，opts 支援 `turns`（旋轉圈數，預設 `1`）和 `cx`/`cy`（旋轉中心，預設元素中心），以 `progress * turns * 360` 計算旋轉角度，於 progress=1 時清除 transform；新增至少 2 個 vm 測試。
