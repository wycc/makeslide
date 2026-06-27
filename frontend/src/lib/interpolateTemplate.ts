/**
 * 將模板字串中的 `{key}` 佔位符以對應的值取代。
 *
 * 先前 `ImportTextPage`（`formatTemplate`）、`AddPagesFromPromptModal` 與
 * `PlayPageSidebar`（皆為 `formatMessage`）各自內嵌幾乎相同的
 * `Object.entries(values).reduce((acc, [k, v]) => acc.replaceAll('{k}', String(v)), template)`，
 * 邏輯重複且無測試。收斂為共用純函式。
 *
 * - 每個 key 的所有出現處皆會被取代（`replaceAll`）。
 * - 值會以 `String()` 轉字串，故同時支援字串與數字。
 * - 模板中沒有對應 key 的佔位符會原樣保留。
 */
export function interpolateTemplate(
  template: string,
  values: Record<string, string | number>,
): string {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
    template,
  );
}
