// Interactive nbformat model for notebook slide pages (Jupyter integration phase 1c).
//
// Unlike the readonly display parser in notebook.ts, this model preserves the full
// nbformat document *losslessly* — every unknown cell/notebook field survives — so a
// cell that is edited or executed can be written back verbatim via PUT .../notebook.
// It also reduces the live `iopub` kernel messages streamed during execution into
// nbformat output objects, and picks the richest displayable MIME per output for the
// single-cell renderer. All functions are pure and immutable (no kernel/DOM deps).

import { stripAnsi } from './ansi';

export type NbCellType = 'code' | 'markdown' | 'raw';

/** nbformat stores multi-line text as either one string or an array of line strings. */
export type NbMultiline = string | string[];

export interface NbOutput {
  output_type: 'stream' | 'execute_result' | 'display_data' | 'error';
  [key: string]: unknown;
}

export interface NbCell {
  cell_type: NbCellType;
  source: NbMultiline;
  metadata?: Record<string, unknown>;
  outputs?: NbOutput[];
  execution_count?: number | null;
  [key: string]: unknown;
}

export interface NbNotebook {
  cells: NbCell[];
  metadata: Record<string, unknown>;
  nbformat: number;
  nbformat_minor: number;
  [key: string]: unknown;
}

/** A minimal valid notebook (single empty code cell); mirrors the backend defaultNotebook(). */
export function defaultNbNotebook(): NbNotebook {
  return {
    cells: [{ cell_type: 'code', source: '', metadata: {}, outputs: [], execution_count: null }],
    metadata: {},
    nbformat: 4,
    nbformat_minor: 5,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeCellType(raw: unknown): NbCellType {
  return raw === 'markdown' || raw === 'code' || raw === 'raw' ? raw : 'raw';
}

function normalizeOutputs(raw: unknown): NbOutput[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isObject).filter((o): o is NbOutput => typeof o.output_type === 'string');
}

function normalizeCell(raw: unknown): NbCell | null {
  if (!isObject(raw)) return null;
  const cell_type = normalizeCellType(raw.cell_type);
  const sourceRaw = raw.source;
  const source: NbMultiline =
    typeof sourceRaw === 'string' || Array.isArray(sourceRaw) ? (sourceRaw as NbMultiline) : '';
  // Preserve every other field (id, attachments, metadata, widget state, …) verbatim.
  const cell: NbCell = { ...raw, cell_type, source };
  if (cell_type === 'code') {
    cell.outputs = normalizeOutputs(raw.outputs);
    cell.execution_count = typeof raw.execution_count === 'number' ? raw.execution_count : null;
  } else {
    // Non-code cells carry no outputs/execution_count in nbformat.
    delete cell.outputs;
    delete cell.execution_count;
  }
  return cell;
}

/**
 * Normalize an untrusted value (e.g. the `notebook` field of the API response) into a
 * valid nbformat document, preserving all passthrough fields. Any malformed input
 * degrades to defaultNbNotebook() rather than throwing.
 */
export function parseNbNotebook(value: unknown): NbNotebook {
  if (!isObject(value) || !Array.isArray(value.cells)) return defaultNbNotebook();
  const cells = value.cells.map(normalizeCell).filter((c): c is NbCell => c !== null);
  if (cells.length === 0) return defaultNbNotebook();
  return {
    ...value,
    cells,
    metadata: isObject(value.metadata) ? value.metadata : {},
    nbformat: typeof value.nbformat === 'number' ? value.nbformat : 4,
    nbformat_minor: typeof value.nbformat_minor === 'number' ? value.nbformat_minor : 5,
  };
}

/** Join an nbformat multi-line value (string | string[]) into a single string. */
export function joinMultiline(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.filter((v) => typeof v === 'string').join('');
  return '';
}

/** The full source text of a cell. */
export function cellText(cell: NbCell): string {
  return joinMultiline(cell.source);
}

/**
 * Clamp a candidate cell index into `[0, count - 1]` (or 0 when there are no cells).
 * Used by the `↑`/`↓` command-mode cell navigation in NotebookPanel.
 */
export function clampCellIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  if (!Number.isFinite(index)) return 0;
  return Math.max(0, Math.min(Math.floor(index), count - 1));
}

// ---- live execution: reduce iopub messages into nbformat outputs ----

/** The minimal shape of an iopub kernel message this model reduces over. */
export interface IopubMessage {
  msg_type: string;
  content: Record<string, unknown>;
}

/** Convert a single iopub message's content into an nbformat output (null = not an output message). */
export function iopubToOutput(msg: IopubMessage): NbOutput | null {
  const c = msg.content ?? {};
  switch (msg.msg_type) {
    case 'stream':
      return { output_type: 'stream', name: typeof c.name === 'string' ? c.name : 'stdout', text: c.text ?? '' };
    case 'execute_result':
      return {
        output_type: 'execute_result',
        data: isObject(c.data) ? c.data : {},
        metadata: isObject(c.metadata) ? c.metadata : {},
        execution_count: typeof c.execution_count === 'number' ? c.execution_count : null,
      };
    case 'display_data':
      return { output_type: 'display_data', data: isObject(c.data) ? c.data : {}, metadata: isObject(c.metadata) ? c.metadata : {} };
    case 'error':
      return {
        output_type: 'error',
        ename: typeof c.ename === 'string' ? c.ename : '',
        evalue: typeof c.evalue === 'string' ? c.evalue : '',
        traceback: Array.isArray(c.traceback) ? c.traceback : [],
      };
    default:
      return null;
  }
}

/**
 * Fold an iopub message into the running outputs array (immutably), matching Jupyter
 * semantics: consecutive `stream` messages with the same name concatenate; `clear_output`
 * empties the list; non-output messages (status, execute_input, …) leave it unchanged.
 * `clear_output(wait=true)` is treated as an immediate clear (the deferred-clear refinement
 * used by progress bars can cause a brief flicker but never loses data).
 */
export function applyIopub(outputs: NbOutput[], msg: IopubMessage): NbOutput[] {
  if (msg.msg_type === 'clear_output') return [];
  const output = iopubToOutput(msg);
  if (!output) return outputs;
  if (output.output_type === 'stream') {
    const last = outputs[outputs.length - 1];
    if (last && last.output_type === 'stream' && last.name === output.name) {
      const merged: NbOutput = { ...last, text: joinMultiline(last.text) + joinMultiline(output.text) };
      return [...outputs.slice(0, -1), merged];
    }
  }
  return [...outputs, output];
}

// ---- immutable writeback helpers ----

/** Replace a code cell's outputs + execution_count (used to persist execution results). */
export function withCellExecution(
  nb: NbNotebook,
  cellIndex: number,
  outputs: NbOutput[],
  executionCount: number | null,
): NbNotebook {
  const cells = nb.cells.map((cell, i) =>
    i === cellIndex && cell.cell_type === 'code' ? { ...cell, outputs, execution_count: executionCount } : cell,
  );
  return { ...nb, cells };
}

/** Clear one code cell's outputs (and reset its execution_count). */
export function clearCellOutputs(nb: NbNotebook, cellIndex: number): NbNotebook {
  return withCellExecution(nb, cellIndex, [], null);
}

/**
 * Replace a cell's source text (used by the cell editor). Source is stored as a single
 * string; nbformat readers accept string or string[] so this stays valid. A no-op when the
 * index is out of range.
 */
export function withCellSource(nb: NbNotebook, cellIndex: number, source: string): NbNotebook {
  if (cellIndex < 0 || cellIndex >= nb.cells.length) return nb;
  const cells = nb.cells.map((cell, i) => (i === cellIndex ? { ...cell, source } : cell));
  return { ...nb, cells };
}

/** A fresh empty cell of the given type (code cells carry the runnable-cell defaults). */
export function newCell(cellType: NbCellType): NbCell {
  return cellType === 'code'
    ? { cell_type: 'code', source: '', metadata: {}, outputs: [], execution_count: null }
    : { cell_type: cellType, source: '', metadata: {} };
}

/**
 * Insert a new empty cell at `index` (clamped to 0…length, so `length` appends) and return the
 * new notebook plus the inserted cell's index — the caller uses it to move the selection there.
 */
export function insertCell(nb: NbNotebook, index: number, cellType: NbCellType): { notebook: NbNotebook; index: number } {
  const at = Math.max(0, Math.min(index, nb.cells.length));
  const cells = [...nb.cells.slice(0, at), newCell(cellType), ...nb.cells.slice(at)];
  return { notebook: { ...nb, cells }, index: at };
}

/**
 * Delete the cell at `cellIndex`, returning the new notebook and the index to select next
 * (clamped into the shortened list). A no-op — returning the same notebook and a clamped index —
 * when the index is out of range or it is the last remaining cell (a notebook keeps ≥1 cell).
 */
export function deleteCell(nb: NbNotebook, cellIndex: number): { notebook: NbNotebook; index: number } {
  if (cellIndex < 0 || cellIndex >= nb.cells.length || nb.cells.length <= 1) {
    return { notebook: nb, index: clampCellIndex(cellIndex, nb.cells.length) };
  }
  const cells = nb.cells.filter((_, i) => i !== cellIndex);
  return { notebook: { ...nb, cells }, index: clampCellIndex(cellIndex, cells.length) };
}

/**
 * Move the cell at `cellIndex` by `delta` (-1 up, +1 down), returning the new notebook and the
 * moved cell's new index so the caller can keep the selection on it. A no-op — same notebook,
 * clamped index — when the source is out of range or the move would fall outside the list.
 */
export function moveCell(nb: NbNotebook, cellIndex: number, delta: number): { notebook: NbNotebook; index: number } {
  const target = cellIndex + delta;
  if (cellIndex < 0 || cellIndex >= nb.cells.length || target < 0 || target >= nb.cells.length) {
    return { notebook: nb, index: clampCellIndex(cellIndex, nb.cells.length) };
  }
  const cells = [...nb.cells];
  const [moved] = cells.splice(cellIndex, 1);
  cells.splice(target, 0, moved!);
  return { notebook: { ...nb, cells }, index: target };
}

/**
 * Change a cell's type, preserving its source. Switching to `markdown`/`raw` drops the
 * code-only fields (`outputs`, `execution_count`); switching to `code` adds the runnable-cell
 * defaults (empty outputs, null execution_count). A no-op when the index is out of range or the
 * cell is already that type.
 */
export function changeCellType(nb: NbNotebook, cellIndex: number, cellType: NbCellType): NbNotebook {
  if (cellIndex < 0 || cellIndex >= nb.cells.length) return nb;
  const cell = nb.cells[cellIndex];
  if (!cell || cell.cell_type === cellType) return nb;
  const cells = nb.cells.map((c, i) => {
    if (i !== cellIndex) return c;
    if (cellType === 'code') {
      return { ...c, cell_type: 'code' as const, outputs: [], execution_count: null };
    }
    // to markdown/raw: strip code-only fields
    const { outputs: _outputs, execution_count: _execCount, ...rest } = c;
    return { ...rest, cell_type: cellType };
  });
  return { ...nb, cells };
}

/** Indices of every code cell, in order — the execution order for "Run all" (phase 6c). */
export function codeCellIndices(nb: NbNotebook): number[] {
  const out: number[] = [];
  nb.cells.forEach((cell, i) => {
    if (cell.cell_type === 'code') out.push(i);
  });
  return out;
}

/** Clear every code cell's outputs (used by the "clear all outputs" action). */
export function clearAllOutputs(nb: NbNotebook): NbNotebook {
  const cells = nb.cells.map((cell) =>
    cell.cell_type === 'code' ? { ...cell, outputs: [], execution_count: null } : cell,
  );
  return { ...nb, cells };
}

// ---- rendering: pick the richest displayable MIME per output ----

export type NbDisplayOutput =
  | { kind: 'text'; text: string }
  | { kind: 'image'; mimeType: string; dataBase64: string }
  | { kind: 'html'; html: string }
  | { kind: 'latex'; latex: string }
  | { kind: 'error'; ename: string; evalue: string; traceback: string };

// Richest-first MIME preference for a display_data / execute_result data bundle.
function selectRichMime(data: Record<string, unknown>): NbDisplayOutput | null {
  for (const mimeType of Object.keys(data)) {
    if (mimeType.startsWith('image/')) {
      const dataBase64 = joinMultiline(data[mimeType]);
      if (dataBase64) return { kind: 'image', mimeType, dataBase64 };
    }
  }
  const html = joinMultiline(data['text/html']);
  if (html) return { kind: 'html', html };
  const latex = joinMultiline(data['text/latex']);
  if (latex) return { kind: 'latex', latex };
  const plain = joinMultiline(data['text/plain']);
  if (plain) return { kind: 'text', text: plain };
  return null;
}

/** Map an nbformat output to a single displayable item (null when nothing is renderable). */
export function displayOutput(output: NbOutput): NbDisplayOutput | null {
  switch (output.output_type) {
    case 'stream': {
      const text = joinMultiline(output.text);
      return text ? { kind: 'text', text } : null;
    }
    case 'execute_result':
    case 'display_data':
      return isObject(output.data) ? selectRichMime(output.data) : null;
    case 'error':
      return {
        kind: 'error',
        ename: typeof output.ename === 'string' ? output.ename : '',
        evalue: typeof output.evalue === 'string' ? output.evalue : '',
        traceback: joinMultiline(output.traceback),
      };
    default:
      return null;
  }
}

/** Map a cell's outputs to renderable items, dropping any that yield nothing. */
export function displayOutputs(outputs: NbOutput[] | undefined): NbDisplayOutput[] {
  if (!Array.isArray(outputs)) return [];
  return outputs.map(displayOutput).filter((o): o is NbDisplayOutput => o !== null);
}

/**
 * Flatten a cell's outputs to plain text for copying to the clipboard: stream text, the
 * `text/plain` of results/display data, and error tracebacks with ANSI colour codes stripped
 * (falling back to `ename: evalue`). Image-only outputs contribute nothing. Segments are joined
 * with newlines.
 */
export function outputsToPlainText(outputs: NbOutput[] | undefined): string {
  if (!Array.isArray(outputs)) return '';
  const parts: string[] = [];
  for (const output of outputs) {
    switch (output.output_type) {
      case 'stream':
        parts.push(joinMultiline(output.text));
        break;
      case 'execute_result':
      case 'display_data': {
        const data = isObject(output.data) ? output.data : {};
        parts.push(joinMultiline(data['text/plain']));
        break;
      }
      case 'error': {
        const tb = stripAnsi(joinMultiline(output.traceback));
        if (tb) {
          parts.push(tb);
        } else {
          const ename = typeof output.ename === 'string' ? output.ename : '';
          const evalue = typeof output.evalue === 'string' ? output.evalue : '';
          parts.push([ename, evalue].filter(Boolean).join(': '));
        }
        break;
      }
    }
  }
  return parts.filter((p) => p !== '').join('\n');
}
