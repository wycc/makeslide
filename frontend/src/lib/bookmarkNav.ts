// 書籤導覽的共用計算（純函式）。
// 書籤為 1-based 頁碼陣列；導覽為環狀（到尾端再回到頭、反之亦然）。

function sortedUnique(bookmarks: number[]): number[] {
  return Array.from(new Set(bookmarks)).sort((a, b) => a - b);
}

/**
 * 回傳 currentPage 之後的下一個書籤頁（1-based）；若無更後者則環繞回最小書籤。
 * 書籤為空時回 null。
 */
export function nextBookmarkPage(bookmarks: number[], currentPage: number): number | null {
  const sorted = sortedUnique(bookmarks);
  if (sorted.length === 0) return null;
  return sorted.find((n) => n > currentPage) ?? sorted[0]!;
}

/**
 * 回傳 currentPage 之前的上一個書籤頁（1-based）；若無更前者則環繞回最大書籤。
 * 書籤為空時回 null。
 */
export function prevBookmarkPage(bookmarks: number[], currentPage: number): number | null {
  const sorted = sortedUnique(bookmarks);
  if (sorted.length === 0) return null;
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i]! < currentPage) return sorted[i]!;
  }
  return sorted[sorted.length - 1]!;
}
