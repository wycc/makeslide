import { clamp } from './clamp';

/**
 * 逐字稿「每頁字數上限」的允許範圍與正規化純函式。
 *
 * 先前 `PlayPageSidebar`、`RegenAllDialog`、`TtsDialog` 三處各自內嵌
 * `Math.max(80, Math.min(2000, Math.round(x)))`，magic number 80/2000 散落、
 * 易漂移且無測試。收斂為共用常數與函式。
 */
export const SCRIPT_MAX_CHARS_MIN = 80;
export const SCRIPT_MAX_CHARS_MAX = 2000;

/**
 * 將使用者輸入的每頁字數上限四捨五入為整數，並夾在
 * [SCRIPT_MAX_CHARS_MIN, SCRIPT_MAX_CHARS_MAX] 範圍內。
 *
 * 與原內聯寫法行為完全一致：`NaN` 仍傳遞為 `NaN`（呼叫端負責先以
 * `Number.isFinite` 防呆），不額外淨化。
 */
export function normalizeScriptMaxChars(value: number): number {
  return clamp(Math.round(value), SCRIPT_MAX_CHARS_MIN, SCRIPT_MAX_CHARS_MAX);
}
