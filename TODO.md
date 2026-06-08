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

[ ] 下載 youtube 時，下載字幕檔的動作不應該叫產生字幕檔，應該叫下載字幕檔。
[ ] 下載 youtube 時，下載的字幕檔應該被存下來當成是來源，可以在來源被檢視。
[ ] 下載 youtube 時，下載的語音檔應該被存下來當成是來源，可以在來源被檢視。STT 轉出的字幕檔也應被存下來可以在來源被檢視。
[x] 當收到 LLM provider 傳回的錯誤時，應該要顯示給使用者看。（完成於分支: feature/show-llm-provider-error-to-user-20260607）
[ ] 在上傳 PDF 時,　要提供選項單入或雙人的選項
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
