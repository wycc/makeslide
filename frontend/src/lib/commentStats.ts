// 評論清單的統計（純函式，供播放頁 CommentsSection 徽章使用）。

/** countUnresolvedComments 只需要 resolved 欄位，故以最小結構約束泛型。 */
export interface ResolvableComment {
  resolved: boolean;
}

/** 回傳尚未解決（`resolved === false`）的評論數量。 */
export function countUnresolvedComments<T extends ResolvableComment>(comments: T[]): number {
  return comments.reduce((n, c) => (c.resolved ? n : n + 1), 0);
}

/**
 * 回傳「未解決在前」的新陣列：未解決者排在已解決者之前，兩組內部維持原本相對順序
 * （穩定排序）。不變動傳入的陣列。
 */
export function sortCommentsUnresolvedFirst<T extends ResolvableComment>(comments: T[]): T[] {
  return [...comments].sort((a, b) => (a.resolved ? 1 : 0) - (b.resolved ? 1 : 0));
}
