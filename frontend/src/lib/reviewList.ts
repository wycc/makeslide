const REVIEW_LIST_KEY = 'makeslide.reviewItems';

export interface ReviewItem {
  pdfId: string;
  pdfTitle: string;
  pageNumber: number;
  questionText: string;
  addedAt: string;
}

// Guard so these helpers are safe in non-browser environments (SSR, tests),
// consistent with the `typeof window` checks used in i18n.ts.
function hasLocalStorage(): boolean {
  return typeof localStorage !== 'undefined';
}

export function getReviewItems(): ReviewItem[] {
  if (!hasLocalStorage()) return [];
  try {
    const raw = localStorage.getItem(REVIEW_LIST_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as ReviewItem[]) : [];
  } catch {
    return [];
  }
}

export function addReviewItems(items: ReviewItem[]): void {
  const existing = getReviewItems();
  const newItems = items.filter(
    (item) =>
      !existing.some(
        (e) => e.pdfId === item.pdfId && e.pageNumber === item.pageNumber && e.questionText === item.questionText,
      ),
  );
  if (newItems.length === 0) return;
  if (!hasLocalStorage()) return;
  localStorage.setItem(REVIEW_LIST_KEY, JSON.stringify([...existing, ...newItems]));
}

/**
 * Removes a single review item. Since a page can hold several questions
 * (addReviewItems dedups by pdfId+pageNumber+questionText), pass `questionText`
 * to remove just that question; omitting it removes every question on the page.
 */
export function removeReviewItem(pdfId: string, pageNumber: number, questionText?: string): void {
  if (!hasLocalStorage()) return;
  const items = getReviewItems().filter((item) => {
    const samePage = item.pdfId === pdfId && item.pageNumber === pageNumber;
    if (!samePage) return true;
    // 指定 questionText 時只移除該題（保留同頁其他題目）；未指定則整頁移除。
    return questionText !== undefined && item.questionText !== questionText;
  });
  localStorage.setItem(REVIEW_LIST_KEY, JSON.stringify(items));
}

export function clearAllReviewItems(): void {
  if (!hasLocalStorage()) return;
  localStorage.removeItem(REVIEW_LIST_KEY);
}
