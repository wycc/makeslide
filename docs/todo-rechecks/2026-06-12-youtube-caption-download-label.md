# TODO 第 456 項複查記錄

- 時間: 2026-06-12 16:40:00 +0800
- 項目: 「下載 youtube 時，下載字幕檔的動作不應該叫產生字幕檔，應該叫下載字幕檔。」

## 複查結果

全文搜尋整個程式碼庫（`frontend/src`、`backend/src`、`docs/`、locale 檔等）後，
找不到任何將「下載 YouTube 字幕檔」這個動作標示為「產生字幕（檔）」的殘留字串。

目前 YouTube 匯入流程中，下載字幕這個步驟已經正確命名為「下載」：

- `backend/src/services/youtubeCaptions.ts` 的函式名稱為 `fetchYoutubeCaptions`
  （fetch = 下載既有字幕軌；若無字幕才會 fallback 到 STT 並回報為
  `transcribing_audio` / 「語音轉文字（STT）」，與「下載」明確區分)。
- `backend/src/worker/pipeline.ts` 在開始下載字幕時呼叫
  `setProgress(pdfId, 'downloading_captions', 0, 1)`。
- `frontend/src/components/StatusBadge.tsx` 將 `downloading_captions`
  對應到 i18n 鍵 `progress.downloadingCaptions`。
- `frontend/src/locales/zh-TW.ts` / `en.ts`：
  `'progress.downloadingCaptions': '下載字幕'` /
  `'progress.downloadingCaptions': 'Downloading captions'`。

## 根因

追溯歷史可知，這個命名問題已在本項目寫入 TODO.md 之前的
commit `445647b`（"feat(youtube): add visible download and STT progress
stages"，2026-06-01 05:00:40 +0800）中修正：該 commit 新增了
`downloading_captions` / `downloading_audio` / `transcribing_audio`
三個獨立的進度步驟，並提供對應的中英文「下載字幕」/「下載音訊」/
「語音轉文字（STT）」標籤，取代了原本單一、不透明的 `source_prepare` 階段。

TODO.md 第 456 項則是在同一天稍晚（commit `38431d1`，2026-06-01 09:03:00）才被
記錄下來，當時這個命名問題實質上已經被上述 commit 解決，僅 TODO.md 未同步勾選。

## 結論

不需要額外的程式碼變更；本次僅以複查記錄確認現況並回到 master 勾選該項目。
