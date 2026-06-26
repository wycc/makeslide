// 快取清除結果「釋放空間」的 KB 換算（純函式）。
// SettingsPage 的清除縮圖快取 / 清除產物快取兩處原先各自內嵌
// `Math.round(data.bytes_freed / 1024)`，收斂於此並補上非有限值/負值淨化。

/**
 * 將位元組數換算為四捨五入後的整數 KB。
 * - 非有限值（NaN / Infinity）或負值一律視為 0，避免顯示出 `NaN KB` 或負數。
 * - 注意：不足約 512 bytes 會四捨五入成 0 KB（與原本內嵌行為一致）。
 */
export function bytesToRoundedKb(bytes: number): number {
  if (!Number.isFinite(bytes) || bytes <= 0) return 0;
  return Math.round(bytes / 1024);
}
