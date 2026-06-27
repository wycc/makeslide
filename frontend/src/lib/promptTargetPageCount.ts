/**
 * Picks the page count the prompt modal should feed into its pre-generation cost estimate.
 *
 * The modal only shows a cost estimate when this is a positive number. Two sources can supply it:
 *   - `page_count`: an already-generated presentation's real slide count (PdfListItem).
 *   - `source_page_count`: the physical page count of a freshly uploaded PDF (UploadResponse),
 *     a good-enough estimate basis before the pipeline paginates. Null for TXT/YouTube uploads,
 *     where the slide count is genuinely unknown until generation — those show no estimate.
 *
 * Pure function (no side effects) so it is easy to unit test in isolation.
 */
export function promptTargetPageCount(
  pdf: { page_count?: number | null; source_page_count?: number | null },
): number | null {
  if (typeof pdf.page_count === 'number' && pdf.page_count > 0) return pdf.page_count;
  if (typeof pdf.source_page_count === 'number' && pdf.source_page_count > 0) return pdf.source_page_count;
  return null;
}
