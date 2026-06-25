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

export function removeReviewItem(pdfId: string, pageNumber: number): void {
  if (!hasLocalStorage()) return;
  const items = getReviewItems().filter((item) => !(item.pdfId === pdfId && item.pageNumber === pageNumber));
  localStorage.setItem(REVIEW_LIST_KEY, JSON.stringify(items));
}

export function clearAllReviewItems(): void {
  if (!hasLocalStorage()) return;
  localStorage.removeItem(REVIEW_LIST_KEY);
}
