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
[x] 重新確認 master TODO.md 無未完成項目並更新工作記錄（完成於分支: feature/todo-no-pending-recheck-20260524-0926）
[x] 重新確認 master TODO.md 無未完成項目並更新工作記錄（完成於分支: feature/todo-no-pending-recheck-20260524-0930）
[x] 重新確認 master TODO.md 無未完成項目並更新工作記錄（完成於分支: feature/todo-no-pending-recheck-20260524-0933）
[x] 重新確認 master TODO.md 無未完成項目並更新工作記錄（完成於分支: feature/todo-no-pending-recheck-20260524-0936）
[x] 重新確認 master TODO.md 無未完成項目並更新工作記錄（完成於分支: feature/todo-no-pending-recheck-20260524-0939）
[x] 重新確認 master TODO.md 無未完成項目並更新工作記錄（完成於分支: feature/todo-no-pending-recheck-20260524-0942）
[x] 重新確認 master TODO.md 無未完成項目並更新工作記錄（完成於分支: feature/todo-no-pending-recheck-20260524-0945）
[x] 重新確認 master TODO.md 無未完成項目並更新工作記錄（完成於分支: feature/todo-no-pending-recheck-20260524-0948）
[x] 重新確認 master TODO.md 無未完成項目並更新工作記錄（完成於分支: feature/todo-no-pending-recheck-20260524-0952）
[x] 重新確認 master TODO.md 無未完成項目並更新工作記錄（完成於分支: feature/todo-no-pending-recheck-20260524-0955）
[x] 重新確認 master TODO.md 無未完成項目並更新工作記錄（完成於分支: feature/todo-no-pending-recheck-20260524-0958）
---
[x] 重新確認 master TODO.md 無未完成項目並更新工作記錄（完成於分支: feature/todo-no-pending-recheck-20260524-1001）
[x] 重新確認 master TODO.md 無未完成項目並更新工作記錄（完成於分支: feature/todo-no-pending-recheck-20260524-1004）
[x] 重新確認 master TODO.md 無未完成項目並更新工作記錄（完成於分支: feature/todo-no-pending-recheck-20260524-1007）
[x] 重新確認 master TODO.md 無未完成項目並更新工作記錄（完成於分支: feature/todo-no-pending-recheck-20260524-1010）

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
