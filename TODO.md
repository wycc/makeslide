[x] 首次流程導引應該只有在列表是空的時候才出現。（完成分支：feature/onboarding-empty-list-only）
[x] 在PlayPage 中加入更新封面的按鍵，將封面更新為目前頁目的圖片（完成分支：feature/update-cover-from-current-page）
[x] 產生的過程中也允許進入 PlayPage, 可以流覽內容，播放音檔。但所有更改和生成的功能都要禁用（完成分支：feature/playpage-readonly-while-processing）
[ ] 加上從提示詞生成的功能，使用者只提供一個提示詞說明要產生的內容，會先生成 TXT 需要的文字，再使用原 TXT 上傳的流程產生完整簡報
[ ] 加上教學互動功能
    [ ] 可以在特定畫面加上 realtime poll 的功能，可以加上一個問題，在螢幕上顯示問題和幾個可能的答案。讓所有在同一個頁面的使用者都可以選擇答案。

## 工作記錄
- 時間：2026-05-17 16:10（Asia/Taipei）
- 工作內容：完成「首次流程導引應該只有在列表是空的時候才出現」，在首頁列表載入完成、無錯誤且簡報列表為空時才顯示首次流程導引。
- 所在分支：feature/onboarding-empty-list-only
- 驗證：npm --prefix frontend run build

- 時間：2026-05-17 16:22（Asia/Taipei）
- 工作內容：完成「在 PlayPage 中加入更新封面的按鍵，將封面更新為目前頁目的圖片」，新增後端以指定頁面圖片重建封面與縮圖的 API，並在播放頁投影片管理區加入「將目前頁設為封面」按鈕。
- 所在分支：feature/update-cover-from-current-page
- 驗證：npm --prefix backend test -- --runInBand（失敗：既有 pages-api 測試仍預期 pages/*.png，但目前實際為 pages/*.jpg）；npm --prefix backend run build；npm --prefix frontend run build

- 時間：2026-05-17 16:32（Asia/Taipei）
- 工作內容：完成「產生的過程中也允許進入 PlayPage, 可以流覽內容，播放音檔。但所有更改和生成的功能都要禁用」，首頁處理中項目可進入播放頁，播放頁在非 ready 狀態保留瀏覽與播放能力並以唯讀提示停用標題、提示詞、語音設定、圖片替換、投影片管理、問答修改、逐字稿重生、圖片重生、影片產生與整份重生等會寫入或生成的操作。
- 所在分支：feature/playpage-readonly-while-processing
- 驗證：npm --prefix frontend run build
