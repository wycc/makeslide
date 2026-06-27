// 進度百分比的共用計算（純函式）。
// PdfCard、RegenerateProgress、PlayPageHeader 等元件原先各自內嵌
// `total > 0 ? Math.round(current/total*100) : 0`（部分另加 `Math.min(100, …)`），收斂於此。

import { clamp } from './clamp';

/**
 * 回傳進度（current/total）的整數百分比，夾在 0–100 之間。
 * - `total` ≤ 0 或 current/total 為非有限值時回 0（避免顯示出 `NaN%`）。
 * - 結果一律 clamp 到 [0, 100]，防止後端回報的 current 超出 total 時溢位成 >100%。
 */
export function progressPercent(current: number, total: number): number {
  if (!Number.isFinite(current) || !Number.isFinite(total) || total <= 0) return 0;
  const pct = Math.round((current / total) * 100);
  return clamp(pct, 0, 100);
}
