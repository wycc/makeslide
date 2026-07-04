// 由逐字稿字數估算朗讀時間，並格式化為 m:ss 標籤（共用純函式）。
//
// 抽自 `PlayPageSlidePanel` 逐字稿編輯區的即時預估內聯邏輯（`Math.round(chars/4)` 再手動組
// `mm:ss`）。粗估每秒約 4 個字，四捨五入到秒；分鐘不補零、秒補兩位（沿用原顯示格式）。

export function estimateSpeakingSeconds(charCount: number): number {
  if (!Number.isFinite(charCount) || charCount <= 0) return 0;
  return Math.round(charCount / 4);
}

export function estimateSpeakingTimeLabel(charCount: number): string {
  const secs = estimateSpeakingSeconds(charCount);
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
}
