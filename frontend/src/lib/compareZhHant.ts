// 繁體中文 locale-aware 字串比較器（共用純函式）。
//
// `HomePage` 多處分類/標籤排序重複
// `a.localeCompare(b, 'zh-Hant', { numeric: true, sensitivity: 'base' })`，字串字面易打錯、
// 也難針對排序規則測試。收斂於此：`sensitivity: 'base'`（大小寫/腔調不敏感），`numeric`
// 預設 `true`（讓「項目2」排在「項目10」前，符合自然數排序），可關閉。

export function compareZhHant(a: string, b: string, options: { numeric?: boolean } = {}): number {
  return a.localeCompare(b, 'zh-Hant', { numeric: options.numeric ?? true, sensitivity: 'base' });
}
