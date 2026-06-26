// 將過長字串截斷並加上省略號的共用純函式。
// AnimationEditorTab 的下拉句子（maxLen 18）與 PlayPageSidebar 的頁面摘要
// （maxLen 20）原先各自內嵌 `text.slice(0, n) + '…'` 的截斷寫法，收斂於此。

/**
 * 將過長字串截斷並在尾端加上單字元省略號（…）。
 * - 長度不超過 `maxLen` 時原樣回傳，不附加省略號。
 * - 長度超過 `maxLen` 時取前 `maxLen` 個字元再接上 `…`。
 * - `maxLen` 為非有限值（NaN／Infinity）或負數時視為不截斷，原樣回傳。
 * - 非字串輸入一律回傳空字串，避免顯示 `undefined`。
 */
export function truncateWithEllipsis(text: string, maxLen: number): string {
  if (typeof text !== 'string') return '';
  if (!Number.isFinite(maxLen) || maxLen < 0) return text;
  return text.length > maxLen ? `${text.slice(0, maxLen)}…` : text;
}
