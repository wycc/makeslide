// 評論清單的關鍵字過濾（純函式，供播放頁 CommentsSection 使用）。
// 不分大小寫，同時比對評論內文與作者；空白查詢回傳原清單。

/** filterComments 只需要 text/author 兩個欄位，故以最小結構約束泛型。 */
export interface FilterableComment {
  text: string;
  author: string;
}

/**
 * 依關鍵字過濾評論。比對忽略大小寫與前後空白，命中內文或作者任一即保留。
 * 查詢為空（或只含空白）時回傳原陣列（不複製），避免不必要的重繪。
 */
export function filterComments<T extends FilterableComment>(comments: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return comments;
  return comments.filter(
    (c) => c.text.toLowerCase().includes(q) || c.author.toLowerCase().includes(q),
  );
}
