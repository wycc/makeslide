/**
 * Whether the PdfCard should render the cover <img> rather than the placeholder.
 * Show it only when there is a cover URL and that exact URL has not just failed
 * to load. Keying the decision on the failed URL (rather than a boolean flag)
 * means a later, different coverSrc — e.g. the next live page-preview frame
 * while a deck is still rendering — is retried instead of staying on the
 * placeholder forever.
 */
export function shouldShowCoverImage(
  coverSrc: string | null | undefined,
  failedSrc: string | null,
): coverSrc is string {
  return !!coverSrc && coverSrc !== failedSrc;
}
