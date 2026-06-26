// 由逐字稿字數估算朗讀秒數（純函式）。
//
// 原本內聯在 PlayPageSlidePanel 的 `Math.round(chars / 4)` 啟發式：以每秒約 4 個
// 字元的語速估算朗讀時間。抽成純函式以便補測試與重用，並對壞值（負數、NaN、
// 小數字數）做淨化。實際顯示交由既有的 formatAudioDuration（m:ss / h:mm:ss）。

/** 預設語速：每秒朗讀的字元數（與原內聯估算一致）。 */
export const DEFAULT_CHARS_PER_SECOND = 4;

/**
 * 由字元數估算朗讀秒數。
 *
 * @param charCount       逐字稿字元數（負值 / NaN 視為 0；小數無條件捨去）。
 * @param charsPerSecond  語速；非正數或非有限值時回退為 DEFAULT_CHARS_PER_SECOND。
 * @returns 估算秒數（非負整數，四捨五入）。
 */
export function estimateSpeechSeconds(charCount: number, charsPerSecond: number = DEFAULT_CHARS_PER_SECOND): number {
  const chars = Number.isFinite(charCount) && charCount > 0 ? Math.floor(charCount) : 0;
  const rate = Number.isFinite(charsPerSecond) && charsPerSecond > 0 ? charsPerSecond : DEFAULT_CHARS_PER_SECOND;
  return Math.round(chars / rate);
}
