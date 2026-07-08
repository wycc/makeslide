// Helpers for importing/exporting a single page's `.ipynb` file (standard Jupyter interchange).
// Pure and string-only so they can be unit-tested; the DOM download / file read live in the
// slide-management handlers that call these.

/** Max size we accept for an uploaded `.ipynb` (mirrors backend MAX_NOTEBOOK_BYTES = 10 MB). */
export const MAX_IPYNB_UPLOAD_BYTES = 10 * 1024 * 1024;

/**
 * A download filename for a page's notebook: `<slug>-p<N>.ipynb`. The deck title is slugified to
 * a filesystem-safe ASCII-ish stem (non-word runs → '-', trimmed), falling back to `notebook`
 * when nothing usable remains.
 */
export function notebookDownloadFilename(deckTitle: string | null | undefined, pageNumber: number): string {
  const slug = (deckTitle ?? '')
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  const stem = slug.length > 0 ? slug : 'notebook';
  return `${stem}-p${pageNumber}.ipynb`;
}

/** Serialize a notebook document to `.ipynb` text (indent 1, trailing newline — matches backend). */
export function serializeNotebookFile(notebook: unknown): string {
  return `${JSON.stringify(notebook, null, 1)}\n`;
}

export type ParsedNotebookFile =
  | { ok: true; notebook: unknown }
  | { ok: false; reason: 'invalid-json' | 'not-a-notebook' };

/**
 * Parse uploaded `.ipynb` text into a notebook document. Validates only enough to catch obvious
 * non-notebook uploads (must be a JSON object with a `cells` array) — the backend PUT endpoint
 * runs the authoritative, lossless `validateNotebook` before persisting.
 */
export function parseNotebookFile(text: string): ParsedNotebookFile {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'invalid-json' };
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value) || !Array.isArray((value as { cells?: unknown }).cells)) {
    return { ok: false, reason: 'not-a-notebook' };
  }
  return { ok: true, notebook: value };
}
