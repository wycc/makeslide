// 評論清單輸出為 Markdown（純函式，供播放頁 CommentsSection 的「複製」使用）。

export interface MarkdownableComment {
  page_number: number;
  author: string;
  text: string;
  resolved: boolean;
}

/** formatCommentsMarkdown 所需的可翻譯字串；由元件以 i18n 注入，使本函式維持純粹可測。 */
export interface CommentMarkdownLabels {
  heading: string;
  /** 頁碼標籤，含 `{n}` 佔位符，例如「第 {n} 頁」。 */
  page: string;
  /** 已解決標記文字，例如「已解決」。 */
  resolved: string;
}

/**
 * 將評論清單輸出為 Markdown（依頁碼遞增、穩定排序）。
 * 每則一行：`- [第 N 頁] 作者（已解決）：內文`；已解決標記僅在 resolved 時附加。
 * 純函式：顯示文字由 labels 注入。清單為空時回傳空字串。
 */
export function formatCommentsMarkdown<T extends MarkdownableComment>(comments: T[], labels: CommentMarkdownLabels): string {
  if (comments.length === 0) return '';
  const sorted = [...comments].sort((a, b) => a.page_number - b.page_number);
  const lines = [`# ${labels.heading}`, ''];
  for (const c of sorted) {
    const pageLabel = labels.page.replace('{n}', String(c.page_number));
    const resolvedTag = c.resolved ? `（${labels.resolved}）` : '';
    lines.push(`- [${pageLabel}] ${c.author}${resolvedTag}：${c.text}`);
  }
  return lines.join('\n');
}
