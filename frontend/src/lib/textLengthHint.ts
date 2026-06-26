// 計算文字輸入框的字數提示（`count/max` 標籤與「接近上限」警示）。
// 純函式，供留言、編輯留言等多個 textarea 共用，避免各處重複內聯邏輯。

export interface TextLengthHint {
  /** 目前字數（保證為非負整數）。 */
  count: number;
  /** 上限字數（保證為非負整數）。 */
  max: number;
  /** 剩餘可輸入字數（max - count，不會小於 0）。 */
  remaining: number;
  /** 是否接近或超過上限（剩餘字數小於 warnWithin 時為 true）。 */
  nearLimit: boolean;
  /** 顯示用標籤，如 `1900/2000`。 */
  label: string;
}

/**
 * 由目前字數與上限計算字數提示。
 *
 * @param count    目前字數（負值會被視為 0）。
 * @param max      上限字數（負值會被視為 0）。
 * @param warnWithin 當剩餘字數「嚴格小於」此值時標記為 nearLimit；預設 100，
 *                   與留言輸入框沿用的 `count > max - 100` 行為一致。
 */
export function getTextLengthHint(count: number, max: number, warnWithin = 100): TextLengthHint {
  const safeCount = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  const safeMax = Number.isFinite(max) ? Math.max(0, Math.floor(max)) : 0;
  const remaining = Math.max(0, safeMax - safeCount);
  const threshold = Number.isFinite(warnWithin) ? Math.max(0, warnWithin) : 0;
  return {
    count: safeCount,
    max: safeMax,
    remaining,
    nearLimit: safeMax - safeCount < threshold,
    label: `${safeCount}/${safeMax}`,
  };
}
