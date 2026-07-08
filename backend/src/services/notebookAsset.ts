import { z } from 'zod';

/**
 * Validation + defaults for per-page Jupyter `.ipynb` assets (render_type = 'notebook').
 *
 * The `.ipynb` is the source of truth for a notebook page, so validation is
 * deliberately *permissive and lossless*: we assert the document is a plausible
 * nbformat container (an object with a `cells` array, valid cell types, and a
 * numeric `nbformat`) but preserve every other field verbatim via `.passthrough()`
 * — `outputs`, `execution_count`, `metadata.kernelspec`, widget state, etc. must
 * survive a GET→edit→PUT round-trip untouched. Only structural sanity and size
 * limits are enforced; we never rewrite cell contents.
 */

/** Max serialized size of a stored notebook (guards against runaway output blobs). */
export const MAX_NOTEBOOK_BYTES = 10 * 1024 * 1024; // 10 MB
/** Max number of cells in a single notebook page. */
export const MAX_NOTEBOOK_CELLS = 1000;

const CellSchema = z
  .object({
    cell_type: z.enum(['code', 'markdown', 'raw']),
    // nbformat allows source as a single string or an array of line strings.
    source: z.union([z.string(), z.array(z.string())]),
  })
  .passthrough();

const NotebookSchema = z
  .object({
    cells: z.array(CellSchema).max(MAX_NOTEBOOK_CELLS),
    metadata: z.record(z.unknown()).default({}),
    nbformat: z.number().int().min(1).default(4),
    nbformat_minor: z.number().int().min(0).default(5),
  })
  .passthrough();

export type NotebookDocument = z.infer<typeof NotebookSchema>;

export type ValidateNotebookResult =
  | { ok: true; notebook: NotebookDocument }
  | { ok: false; message: string };

/** A minimal, valid empty notebook (one empty code cell), used when none is stored yet. */
export function defaultNotebook(): NotebookDocument {
  return {
    cells: [{ cell_type: 'code', source: '', metadata: {}, outputs: [], execution_count: null }],
    metadata: {},
    nbformat: 4,
    nbformat_minor: 5,
  };
}

/**
 * Validate an untrusted value as an nbformat document. On success the returned
 * `notebook` preserves all passthrough fields and only fills defaults for the
 * four required top-level keys.
 */
export function validateNotebook(raw: unknown): ValidateNotebookResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, message: 'Notebook must be a JSON object' };
  }
  const parsed = NotebookSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? ` at ${issue.path.join('.')}` : '';
    return { ok: false, message: `Invalid notebook${where}: ${issue?.message ?? 'unknown error'}` };
  }
  const serializedBytes = Buffer.byteLength(JSON.stringify(parsed.data), 'utf8');
  if (serializedBytes > MAX_NOTEBOOK_BYTES) {
    return { ok: false, message: `Notebook exceeds ${MAX_NOTEBOOK_BYTES} bytes` };
  }
  return { ok: true, notebook: parsed.data };
}

/** Parse a stored `.ipynb` file's contents, returning a default notebook on any failure. */
export function parseStoredNotebook(raw: string): NotebookDocument {
  try {
    const result = validateNotebook(JSON.parse(raw));
    return result.ok ? result.notebook : defaultNotebook();
  } catch {
    return defaultNotebook();
  }
}
