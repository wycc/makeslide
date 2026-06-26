// 把頁碼清單（書籤、重點頁）複製為純文字（純函式）。

/** formatPageListText 所需的可翻譯字串；由元件以 i18n 注入，使本函式維持純粹可測。 */
export interface PageListTextLabels {
  /** 頁碼前綴，例如「第 」。 */
  prefix: string;
  /** 頁碼後綴，例如「 頁」。 */
  suffix: string;
  /** 各項之間的分隔字串，例如「、」。 */
  separator: string;
}

/**
 * 將頁碼清單排序去重後串成文字：`{prefix}{n}{suffix}` 以 `separator` 串接。
 * 清單為空時回空字串。純函式：顯示文字由 labels 注入。
 */
export function formatPageListText(pages: number[], labels: PageListTextLabels): string {
  return Array.from(new Set(pages))
    .sort((a, b) => a - b)
    .map((n) => `${labels.prefix}${n}${labels.suffix}`)
    .join(labels.separator);
}
