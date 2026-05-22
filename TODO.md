# FirstBatch
[x] (merge)audio 產生完成後，重新壓縮成 AAC 以減少頻寬需求（完成於分支: feature/todo-aac-audio-compress-20260521）
[x] (merge)將重複的上課模式移除，只留在播放設定中即可。另外少了原有的強迫 follower 靜音的功能少補進去（完成於分支: feature/remove-duplicate-classroom-mode-20260521）
[x] (merge)目前的同步模式讓第一個按下的 session 變成 master。當 reload 後這個狀態就消失了。此時如果 master reload 畫面就會變成很奇怪的狀況。請改成變這個設定存在 DB 中，把 master 的  session ID 記下來。讓 reload 時還是可以回復原狀。且 master 的 session ID 並須定期更新。否則十分鐘後就自動停止同步模式。且當一個簡報進入同步模式後，其它的人進來就直接進定模式，不用再設定。（完成於分支: feature/persist-sync-master-session-20260521）
[x] 加上語言選項，讓 UI 可以有不同語言的版本。先製作英文和繁體中文版。把所有 UI 上的文字收集成翻譯檔，在根據 UI 設定內的選擇載入英文或中文的翻譯檔。產生的圖片/逐字稿/語音也要根據 UI 的設定產生不同的結果。UI 中要有二個設定，一個是界面的文字語言，另一個是產生結果的語言。也就是我們允許用中文的提示詞產生英文的結果，或是反過來。（完成於分支: feature/todo-ui-i18n-settings-20260521）
[x] 請將首頁中所有文字都做翻譯（完成於分支: feature/todo-homepage-i18n-20260522）
[x] 請將 PlayPage中所有文字都做翻譯（完成於分支: feature/todo-playpage-i18n-20260522）
[ ] 請將 PlayPage 中所有文字都做翻譯
[x] 請將 上傳 PDF 中所有文字都做翻譯（完成於分支: feature/todo-upload-pdf-i18n-20260522）
[x] 請將 貼上 TXT 中所有文字都做翻譯（完成於分支: feature/todo-import-text-i18n-20260522）

---
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
