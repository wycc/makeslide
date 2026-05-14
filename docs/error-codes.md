# Error Codes Dictionary (#7)

此文件定義前後端共用錯誤語意，回應格式至少為：

```json
{ "error": { "code": "...", "message": "..." } }
```

## 主要錯誤碼

- `INVALID_REQUEST`：請求格式不合法。
- `INVALID_UPLOAD_TYPE`：上傳檔案格式不支援（含舊碼 `INVALID_MIME`）。
- `FILE_REQUIRED`：缺少檔案欄位（含舊碼 `NO_FILE`）。
- `FILE_TOO_LARGE`：檔案超過限制。
- `INVALID_URL`：URL 驗證失敗（含舊碼 `INVALID_YOUTUBE_URL`）。
- `API_KEY_MISSING`：缺少必要 API key。
- `MODEL_QUOTA_EXCEEDED`：模型配額不足。
- `MODEL_UNAVAILABLE`：模型不可用。
- `PDF_NOT_FOUND` / `PAGE_NOT_FOUND`：資料不存在。
- `RESOURCE_NOT_FOUND`：附件資源未就緒（影像/音檔/影片/封面/outline）。
- `INVALID_STATE`：任務狀態不允許該操作。
- `JOB_CONFLICT`：任務狀態衝突（已有任務、不可取消等）。
- `INTERNAL_ERROR`：伺服器內部錯誤。

## 建議處理

- 4xx：提示使用者修正輸入或等待正確狀態。
- 5xx：提示重試，必要時附上 `code` 回報。
- 前端透過 `mapApiErrorToHumanMessage()` 顯示「可讀訊息 + 下一步建議」。
