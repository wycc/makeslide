import type { ReviewItem } from './reviewList';

/** The subset of a search result needed to build a review-list entry. */
export interface ReviewableSearchResult {
  pdf_id: string;
  pdf_title: string | null;
  page_number: number | null;
  snippet?: string;
}

/**
 * Maps selected search results into review-list items. Title-only matches (no page_number) are
 * dropped, since a review item points at a specific page. The matched snippet becomes the item's
 * `questionText` so the saved entry stays recognisable; `addReviewItems` later dedups by
 * pdfId + pageNumber + questionText. Pure function — no localStorage access — so it is easy to test.
 */
export function searchResultsToReviewItems(
  results: ReviewableSearchResult[],
  addedAt: string,
): ReviewItem[] {
  return results
    .filter((r): r is ReviewableSearchResult & { page_number: number } => r.page_number != null)
    .map((r) => ({
      pdfId: r.pdf_id,
      pdfTitle: r.pdf_title ?? '',
      pageNumber: r.page_number,
      questionText: (r.snippet ?? '').trim(),
      addedAt,
    }));
}
