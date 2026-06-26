// 頁面筆記輸出為 Markdown（純函式，供播放頁「複製全部筆記」使用）。

export interface MarkdownableNotePage {
  page_number: number;
  page_notes?: string | null;
}

/** formatNotesMarkdown 所需的可翻譯字串；由元件以 i18n 注入，使本函式維持純粹可測。 */
export interface NotesMarkdownLabels {
  /** 頁碼前綴標籤，例如「第」（輸出 `## {pagePrefix} {n}`）。 */
  pagePrefix: string;
}

/**
 * 將各頁筆記輸出為 Markdown：每頁有筆記者一段 `## {pagePrefix} {n}\n{note}`，
 * 段落間以空行分隔，依輸入順序。`page_notes` trim 後為空者略過；全無筆記回空字串。
 * 純函式：頁碼前綴由 labels 注入。
 */
export function formatNotesMarkdown<T extends MarkdownableNotePage>(pages: T[], labels: NotesMarkdownLabels): string {
  const blocks: string[] = [];
  for (const page of pages) {
    const note = page.page_notes?.trim();
    if (note) {
      blocks.push(`## ${labels.pagePrefix} ${page.page_number}\n${note}`);
    }
  }
  return blocks.join('\n\n');
}
