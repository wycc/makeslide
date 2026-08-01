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

/** `parseScriptMaxCharsInput` 的結果：能用的值，以及這串文字是否不可用。 */
export interface ScriptMaxCharsInputState {
  /** 可直接採用的值；空白或不合法時為 null。 */
  value: number | null;
  /** true 表示文字不可用（該以紅色提示使用者自行更正）。空白不算不合法。 */
  invalid: boolean;
}

/**
 * 解讀使用者在「每頁字數上限」輸入框打的文字，但**不改動**它。
 *
 * 輸入框先前是邊打邊 `normalizeScriptMaxChars`（夾範圍＋四捨五入），使用者要輸入
 * 「800」時打到「8」就被改成 80，等於無法從頭輸入。改為只做判定：呼叫端保留原文、
 * 不合法時以紅色提示並停用送出，由使用者自己更正。
 *
 * 空字串代表「沒填」（TtsDialog 用來表示系統預設），由呼叫端決定是否接受。
 * 只接受純十進位整數：小數、負號、`1e3`、千分位逗號等一律視為不合法，避免默默取整。
 */
export function parseScriptMaxCharsInput(raw: string): ScriptMaxCharsInputState {
  const text = raw.trim();
  if (!text) return { value: null, invalid: false };
  if (!/^\d+$/.test(text)) return { value: null, invalid: true };
  const value = Number(text);
  if (!Number.isFinite(value) || value < SCRIPT_MAX_CHARS_MIN || value > SCRIPT_MAX_CHARS_MAX) {
    return { value: null, invalid: true };
  }
  return { value, invalid: false };
}
