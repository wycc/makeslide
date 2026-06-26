/** Characters of surrounding context to include on each side of a search match. */
export const SNIPPET_CONTEXT = 60;

/**
 * Builds a short preview snippet of `content` centered on the first
 * case-insensitive occurrence of `keyword`, with up to `SNIPPET_CONTEXT`
 * characters of context on each side and leading/trailing ellipses when the
 * snippet is clipped. Falls back to the start of `content` when the keyword
 * isn't found. Pure (no DB) so it can be unit tested.
 */
export function extractSnippet(content: string, keyword: string): string {
  const lowerContent = content.toLowerCase();
  const lowerKeyword = keyword.toLowerCase();
  const idx = lowerContent.indexOf(lowerKeyword);
  if (idx === -1) return content.slice(0, SNIPPET_CONTEXT * 2);

  const start = Math.max(0, idx - SNIPPET_CONTEXT);
  const end = Math.min(content.length, idx + lowerKeyword.length + SNIPPET_CONTEXT);

  let snippet = content.slice(start, end);
  if (start > 0) snippet = '...' + snippet;
  if (end < content.length) snippet = snippet + '...';
  return snippet;
}
