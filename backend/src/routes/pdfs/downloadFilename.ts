/**
 * Helpers for building download filenames from user-supplied titles.
 * Kept dependency-free (no DB import) so they are unit-testable in isolation.
 */

/**
 * Derive a safe download base name from a presentation title: strip
 * filesystem-illegal and ASCII control characters, collapse whitespace, cap
 * length, and fall back to `fallback` when the result is empty. Unicode (e.g.
 * CJK) is preserved; header ASCII-safety is handled by buildContentDisposition.
 */
export function safeDownloadBaseName(title: string | null | undefined, fallback: string): string {
  const cleaned = (title ?? '')
    // illegal filesystem characters and ASCII control chars -> space (hyphens kept)
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
    .trim();
  return cleaned.length > 0 ? cleaned : fallback;
}

/**
 * Build a CSV download filename from a presentation title with an id-based
 * fallback. When the title yields a usable base name the file is named
 * `<title>-<titleSuffix>.csv`; otherwise it falls back to
 * `<fallbackPrefix>-<id>.csv`. Consolidates the title-or-id filename pattern
 * repeated across the CSV/report export routes. Pure and unit-testable.
 */
export function csvDownloadFilename(
  title: string | null | undefined,
  id: string,
  opts: { titleSuffix: string; fallbackPrefix: string },
): string {
  const base = safeDownloadBaseName(title, '');
  return base ? `${base}-${opts.titleSuffix}.csv` : `${opts.fallbackPrefix}-${id}.csv`;
}

/**
 * Build a `Content-Disposition` value with an ASCII `filename` fallback and a
 * RFC 5987 `filename*` so non-ASCII (e.g. CJK) titles download with a readable
 * name in modern browsers.
 */
export function buildContentDisposition(filename: string): string {
  // eslint-disable-next-line no-control-regex
  const asciiFallback = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
