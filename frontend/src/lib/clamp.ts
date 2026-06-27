/**
 * 將數值夾在 [min, max] 範圍內的共用純函式。
 *
 * 採與專案各處內聯寫法一致的順序 `Math.min(max, Math.max(min, value))`：
 * - 當 `min <= max` 時即標準 clamp，回傳落在 [min, max] 的值。
 * - 為與原內聯行為完全一致，不額外淨化 `NaN`：若 `value` 為 `NaN`，
 *   結果仍為 `NaN`（與原 `Math.max(min, Math.min(max, NaN))` 相同）。
 * - 呼叫端應自行保證 `min <= max`；若傳入 `min > max`，回傳 `max`
 *   （與原 `Math.min(max, Math.max(min, value))` 一致）。
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
