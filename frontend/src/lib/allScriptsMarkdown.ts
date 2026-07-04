// 把整份簡報的逐字稿組成「複製全部逐字稿」用的 Markdown（共用純函式）。
//
// 去重自 `PlayPageHeader` 的「複製全部逐字稿」按鈕 onClick 內聯邏輯：依頁碼排序、每頁輸出
// 一個 `## <前綴>N<後綴>` 標題再接該頁逐字稿（缺稿則空白），頁與頁之間空一行。抽出以便測試
// 排序/格式/缺稿處理。

export function buildAllScriptsMarkdown<T extends { page_number: number }>(
  pages: readonly T[],
  scripts: Record<number, string | undefined>,
  labels: { pagePrefix: string; pageSuffix: string },
): string {
  return pages
    .slice()
    .sort((a, b) => a.page_number - b.page_number)
    .map((p) => `## ${labels.pagePrefix}${p.page_number}${labels.pageSuffix}\n${scripts[p.page_number] ?? ''}`)
    .join('\n\n');
}
