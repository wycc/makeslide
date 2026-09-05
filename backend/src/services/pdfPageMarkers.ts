/**
 * Helpers for embedding "this text came from original PDF page N" markers
 * into the plain-text content written to `source.txt` for document-mode
 * PDF imports. The markers let `splitTextWithLlm`'s outline step report
 * which original PDF page(s) each AI-generated slide is derived from, so the
 * pipeline can later attach matching `figures.json` entries when generating
 * that slide's image.
 *
 * Markers are stripped from all final page content before it is persisted /
 * sent to image generation, so they never leak into user-visible text.
 */

const MARKER_RE = /\[\[PDF_PAGE_(\d+)\]\]/g;
const MARKER_RE_TEST = /\[\[PDF_PAGE_\d+\]\]/;

export function formatPdfPageMarker(pageNumber: number): string {
  return `[[PDF_PAGE_${pageNumber}]]`;
}

/** Whether `text` contains at least one `[[PDF_PAGE_N]]` marker. */
export function containsPdfPageMarkers(text: string): boolean {
  return MARKER_RE_TEST.test(text);
}

/** Removes all `[[PDF_PAGE_N]]` markers and collapses the resulting blank lines. */
export function stripPdfPageMarkers(text: string): string {
  return text.replace(MARKER_RE, '').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Joins per-page text into a single string with a `[[PDF_PAGE_N]]` marker
 * (1-indexed) placed before each page's content.
 */
export function buildTextWithPdfPageMarkers(pageTexts: string[]): string {
  return pageTexts
    .map((text, idx) => `${formatPdfPageMarker(idx + 1)}\n${text}`)
    .join('\n\n')
    .trim();
}

/**
 * Splits `text` at its `[[PDF_PAGE_N]]` markers into one entry per original
 * page, with the marker kept at the head of each block. Any text preceding the
 * first marker is folded into the first page rather than dropped. Returns an
 * empty array when the text carries no markers (e.g. a plain `.txt` import or
 * YouTube captions), which callers use as "the source page count is unknown".
 */
export function splitByPdfPageMarkers(text: string): Array<{ pageNumber: number; content: string }> {
  const matches = [...text.matchAll(MARKER_RE)];
  if (matches.length === 0) return [];
  return matches.map((m, i) => ({
    pageNumber: Number(m[1]),
    content: text.slice(i === 0 ? 0 : m.index!, matches[i + 1]?.index ?? text.length).trim(),
  }));
}
