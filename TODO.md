[x] 首次流程導引應該只有在列表是空的時候才出現。（完成分支：feature/onboarding-empty-list-only）
[ ] 在PlayPage 中加入更新封面的按鍵，將封面更新為目前頁目的圖片
[ ] 產生的過程中也允許進入 PlayPage, 可以流覽內容，播放音檔。但所有更改和生成的功能都要禁用
[ ] 加上從提示詞生成的功能，使用者只提供一個提示詞說明要產生的內容，會先生成 TXT 需要的文字，再使用原 TXT 上傳的流程產生完整簡報

## 工作記錄
- 時間：2026-05-17 16:10（Asia/Taipei）
- 工作內容：完成「首次流程導引應該只有在列表是空的時候才出現」，在首頁列表載入完成、無錯誤且簡報列表為空時才顯示首次流程導引。
- 所在分支：feature/onboarding-empty-list-only
- 驗證：npm --prefix frontend run build

