// 在一份「頁碼清單」（書籤、重點頁等）中環狀導覽的共用計算（純函式）。
// 清單為 1-based 頁碼；到尾端再回到頭、反之亦然。

function sortedUnique(pages: number[]): number[] {
  return Array.from(new Set(pages)).sort((a, b) => a - b);
}

/**
 * 回傳 currentPage 之後清單中的下一個頁碼（1-based）；若無更後者則環繞回最小。
 * 清單為空時回 null。
 */
export function nextPageInList(pages: number[], currentPage: number): number | null {
  const sorted = sortedUnique(pages);
  if (sorted.length === 0) return null;
  return sorted.find((n) => n > currentPage) ?? sorted[0]!;
}

/**
 * 回傳 currentPage 之前清單中的上一個頁碼（1-based）；若無更前者則環繞回最大。
 * 清單為空時回 null。
 */
export function prevPageInList(pages: number[], currentPage: number): number | null {
  const sorted = sortedUnique(pages);
  if (sorted.length === 0) return null;
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i]! < currentPage) return sorted[i]!;
  }
  return sorted[sorted.length - 1]!;
}
