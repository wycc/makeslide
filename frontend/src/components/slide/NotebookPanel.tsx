// Single-cell notebook view for a `render_type = 'notebook'` slide page (Jupyter phase 1c).
//
// Shows exactly one cell at a time inside a fixed-height, vertically scrolling container
// (plan constraint 3). Command-mode `↑`/`↓` switch cells and are stopPropagation'd so the
// global PlayPage keyboard handler still gets `Space`/`←`/`→` for slide navigation. When the
// deck is editable, `Ctrl/⌘+Enter` runs the current code cell on a real Jupyter kernel and
// `Shift+Enter` runs it and advances; iopub output streams in live and the result is written
// back to the `.ipynb` (plan §1.2, §1.3, MVP). Read-only viewers only see stored outputs.

import { useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
import type { ChangeEvent, KeyboardEvent, ReactNode } from 'react';
import { MarkdownMath } from '../MarkdownMath';
import { useI18n } from '../../i18n';
import { parseAnsi, type AnsiColor } from '../../lib/ansi';
import { fetchPageNotebook, savePageNotebook } from '../../lib/api/pdfs';
import { buildNotebookHtmlSrcDoc, NOTEBOOK_HTML_HEIGHT_MESSAGE } from '../../lib/notebookHtmlSandbox';
import {
  applyIopub,
  cellText,
  clampCellIndex,
  clearAllOutputs,
  clearCellOutputs,
  insertCell,
  deleteCell,
  moveCell as moveCellPosition,
  changeCellType,
  codeCellIndices,
  executionCountLabel,
  formatCellTiming,
  displayOutputs,
  outputsToPlainText,
  defaultNbNotebook,
  parseNbNotebook,
  withCellExecution,
  withCellSource,
  type NbCell,
  type NbCellType,
  type NbDisplayOutput,
  type NbNotebook,
  type NbOutput,
} from '../../lib/nbformatModel';
import { useJupyterKernel } from './useJupyterKernel';
import { kernelStatusLabelKey } from '../../lib/jupyterConnection';
import { collapseText } from '../../lib/collapseText';

/** How long a cell may run before the footer hints it is taking a while (phase 5e). */
const NOTEBOOK_RUN_TIMEOUT_MS = 30_000;

/** Text/error outputs longer than this collapse to a "show more" toggle (phase 6e). */
const MAX_OUTPUT_LINES = 16;

// Lazy so CodeMirror + Python mode are code-split out of the main bundle (phase 3b).
const CodeMirrorEditor = lazy(() => import('./codeMirrorEditor'));

const ANSI_COLOR_CLASS: Record<AnsiColor, string> = {
  black: 'text-slate-500',
  red: 'text-rose-400',
  green: 'text-emerald-400',
  yellow: 'text-amber-400',
  blue: 'text-sky-400',
  magenta: 'text-fuchsia-400',
  cyan: 'text-cyan-400',
  white: 'text-slate-200',
};

/** Render text that may contain ANSI SGR colour codes (Jupyter tracebacks) as styled spans. */
function AnsiText({ text }: { text: string }) {
  const segments = parseAnsi(text);
  return (
    <>
      {segments.map((seg, i) => {
        const cls = [seg.color ? ANSI_COLOR_CLASS[seg.color] : '', seg.bold ? 'font-semibold' : ''].filter(Boolean).join(' ');
        return cls ? (
          <span key={i} className={cls}>
            {seg.text}
          </span>
        ) : (
          <span key={i}>{seg.text}</span>
        );
      })}
    </>
  );
}

// Render a notebook `text/html` output inside a sandboxed, auto-sized iframe (phase 2b-ii).
// The frame runs with `allow-scripts` but NO `allow-same-origin`, so pandas/plotly/repr HTML
// (which may embed arbitrary scripts) executes in an opaque origin that cannot reach the parent
// page, its cookies, or storage. The embedded script postMessage's its content height so the
// iframe grows to fit without an inner scrollbar; we match `event.source` to the frame's window
// to ignore messages from anywhere else.
function NotebookHtmlOutput({ html }: { html: string }) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [height, setHeight] = useState(40);
  const srcDoc = useMemo(() => buildNotebookHtmlSrcDoc(html), [html]);
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const frame = iframeRef.current;
      if (!frame || e.source !== frame.contentWindow) return;
      const data = e.data as { type?: unknown; height?: unknown } | null;
      if (data && typeof data === 'object' && data.type === NOTEBOOK_HTML_HEIGHT_MESSAGE && typeof data.height === 'number') {
        // +4px 緩衝避免內部捲軸；夾在合理範圍避免異常回報值把版面撐爆。
        setHeight(Math.min(Math.max(Math.ceil(data.height) + 4, 24), 4000));
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);
  return (
    <iframe
      ref={iframeRef}
      title="notebook-html-output"
      sandbox="allow-scripts"
      srcDoc={srcDoc}
      className="w-full rounded border border-border bg-surface-muted"
      style={{ height }}
    />
  );
}

// A <pre> output that collapses to the first MAX_OUTPUT_LINES lines with a show-more toggle when
// long, so a huge stream/traceback doesn't blow out the fixed-height single-cell view (phase 6e).
function CollapsibleOutput({ text, render, className }: { text: string; render: (t: string) => ReactNode; className: string }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const { text: collapsed, hiddenLines } = collapseText(text, MAX_OUTPUT_LINES);
  if (hiddenLines === 0) return <pre className={className}>{render(text)}</pre>;
  return (
    <div className="flex flex-col gap-0.5">
      <pre className={className}>{render(expanded ? text : collapsed)}</pre>
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="self-start rounded px-1 text-[11px] text-sky-500 hover:underline"
      >
        {expanded ? t('play.notebook.collapseOutput') : t('play.notebook.showMoreLines').replace('{n}', String(hiddenLines))}
      </button>
    </div>
  );
}

function OutputBlock({ output }: { output: NbDisplayOutput }) {
  switch (output.kind) {
    case 'image':
      return <img src={`data:${output.mimeType};base64,${output.dataBase64}`} alt="" className="max-w-full rounded border border-border" />;
    case 'html':
      // Arbitrary notebook HTML (tables, plotly, repr) rendered in a sandboxed iframe (phase 2b-ii).
      return <NotebookHtmlOutput html={output.html} />;
    case 'latex':
      return <MarkdownMath content={output.latex} />;
    case 'error':
      // Tracebacks already include the "EName: evalue" line, ANSI-coloured; collapse when long.
      return output.traceback ? (
        <CollapsibleOutput
          text={output.traceback}
          render={(tt) => <AnsiText text={tt} />}
          className="overflow-x-auto rounded bg-rose-50 px-3 py-2 text-xs text-rose-800 dark:bg-rose-950/30 dark:text-rose-200"
        />
      ) : (
        <pre className="overflow-x-auto rounded bg-rose-50 px-3 py-2 text-xs text-rose-800 dark:bg-rose-950/30 dark:text-rose-200">
          <span className="font-semibold">{[output.ename, output.evalue].filter(Boolean).join(': ')}</span>
        </pre>
      );
    default:
      return (
        <CollapsibleOutput
          text={output.text}
          render={(tt) => tt}
          className="overflow-x-auto rounded bg-surface-muted px-3 py-2 text-xs text-text"
        />
      );
  }
}

interface CellBodyProps {
  cell: NbCell;
  outputs: NbDisplayOutput[];
  editing: boolean;
  draft: string;
  onDraftChange: (value: string) => void;
  onBeginEdit?: () => void;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  editPlaceholder: string;
}

function CellBody({ cell, outputs, editing, draft, onDraftChange, onBeginEdit, textareaRef, editPlaceholder }: CellBodyProps) {
  const source = cellText(cell);
  // Plain textarea editor — used for markdown cells and as the Suspense fallback while the
  // CodeMirror chunk loads for code cells.
  const textareaEditor = (
    <textarea
      ref={textareaRef}
      value={draft}
      onChange={(e) => onDraftChange(e.target.value)}
      spellCheck={false}
      placeholder={editPlaceholder}
      className="min-h-[6rem] w-full resize-y rounded-md border border-sky-500/50 bg-surface px-3 py-2 font-mono text-xs text-text outline-none focus:ring-1 focus:ring-sky-500/50"
      rows={Math.min(20, Math.max(4, draft.split('\n').length + 1))}
    />
  );

  if (cell.cell_type === 'markdown') {
    return editing ? textareaEditor : (
      <div onDoubleClick={onBeginEdit}>
        <MarkdownMath content={source} />
      </div>
    );
  }
  // Code cells get syntax-highlighted CodeMirror while editing (lazy-loaded, phase 3b).
  const editor = editing ? (
    <Suspense fallback={textareaEditor}>
      <CodeMirrorEditor value={draft} onChange={onDraftChange} autoFocus />
    </Suspense>
  ) : null;
  return (
    <div className="flex flex-col gap-1.5">
      {editor
        ? editor
        : source.trim() !== '' && (
            <div className="flex flex-col gap-0.5">
              {/* Jupyter-style execution count (phase 7a). */}
              <span className="font-mono text-[10px] leading-none text-sky-500/70">In {executionCountLabel(cell.execution_count)}:</span>
              <pre
                onDoubleClick={onBeginEdit}
                className="overflow-x-auto rounded-md border border-border bg-surface px-3 py-2 text-xs text-text"
              >
                <code>{source}</code>
              </pre>
            </div>
          )}
      {outputs.map((output, j) => (
        <OutputBlock key={j} output={output} />
      ))}
    </div>
  );
}

export interface NotebookPanelProps {
  pdfId: string;
  pageNumber: number;
  shareToken?: string;
  /** When true (deck access_level === 'edit'), enable running cells on a Jupyter kernel. */
  editable?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export function NotebookPanel({ pdfId, pageNumber, shareToken, editable = false, className, style }: NotebookPanelProps) {
  const { t } = useI18n();
  const [notebook, setNotebook] = useState<NbNotebook | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [cellIndex, setCellIndex] = useState(0);
  const [runningIndex, setRunningIndex] = useState<number | null>(null);
  const [liveOutputs, setLiveOutputs] = useState<NbOutput[]>([]);
  const [runError, setRunError] = useState(false);
  const [runTimedOut, setRunTimedOut] = useState(false);
  const [cellTimings, setCellTimings] = useState<Record<number, number>>({});
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const draftRef = useRef('');
  const containerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const notebookKey = editable ? `${pdfId}:${pageNumber}` : null;
  const kernel = useJupyterKernel(notebookKey);

  useEffect(() => {
    let cancelled = false;
    setNotebook(null);
    setLoadError(false);
    setCellIndex(0);
    setRunningIndex(null);
    setLiveOutputs([]);
    setCellTimings({});
    setEditing(false);
    fetchPageNotebook(pdfId, pageNumber, shareToken)
      .then((resp) => {
        if (!cancelled) setNotebook(parseNbNotebook(resp.notebook));
      })
      .catch(() => {
        if (!cancelled) {
          setNotebook(defaultNbNotebook());
          setLoadError(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [pdfId, pageNumber, shareToken]);

  const cells = notebook?.cells ?? [];
  const currentIndex = clampCellIndex(cellIndex, cells.length);
  const currentCell = cells[currentIndex];

  const persistNotebook = useCallback(
    (next: NbNotebook) => {
      setNotebook(next);
      void savePageNotebook(pdfId, pageNumber, next).catch(() => undefined);
    },
    [pdfId, pageNumber],
  );

  // Download the current notebook verbatim as a standard .ipynb file (nbformat JSON).
  const downloadNotebook = useCallback(() => {
    if (!notebook) return;
    const blob = new Blob([JSON.stringify(notebook, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `page-${pageNumber}.ipynb`;
    a.click();
    URL.revokeObjectURL(url);
  }, [notebook, pageNumber]);

  // Import an .ipynb file, replacing this page's notebook after confirmation.
  const handleUploadFile = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = ''; // allow re-selecting the same file later
      if (!file || !editable) return;
      if (!window.confirm(t('play.notebook.uploadConfirm'))) return;
      let parsed: NbNotebook;
      try {
        parsed = parseNbNotebook(JSON.parse(await file.text()));
      } catch {
        setLoadError(true);
        return;
      }
      setEditing(false);
      setCellIndex(0);
      setLoadError(false);
      persistNotebook(parsed);
    },
    [editable, persistNotebook, t],
  );

  const beginEdit = useCallback(() => {
    if (!editable || !currentCell) return;
    const text = cellText(currentCell);
    draftRef.current = text;
    setDraft(text);
    setEditing(true);
  }, [editable, currentCell]);

  // Commit the in-progress edit into the notebook (persisting to the .ipynb) and return the
  // updated notebook, so callers like "run" can act on the just-committed source.
  const commitEdit = useCallback((): NbNotebook | null => {
    if (!editing || !notebook) return notebook;
    const idx = clampCellIndex(cellIndex, notebook.cells.length);
    const next = withCellSource(notebook, idx, draftRef.current);
    persistNotebook(next);
    setEditing(false);
    return next;
  }, [editing, notebook, cellIndex, persistNotebook]);

  const runCell = useCallback(
    async (advance: boolean) => {
      if (!editable || !notebook) return;
      const idx = clampCellIndex(cellIndex, notebook.cells.length);
      // Commit any in-progress edit first so we run the latest source.
      const base = editing ? withCellSource(notebook, idx, draftRef.current) : notebook;
      if (editing) {
        persistNotebook(base);
        setEditing(false);
      }
      const cell = base.cells[idx];
      if (!cell || cell.cell_type !== 'code') {
        if (advance) setCellIndex((i) => clampCellIndex(i + 1, base.cells.length));
        return;
      }
      const runStartMs = Date.now();
      kernel.connect();
      setRunError(false);
      setRunningIndex(idx);
      let acc: NbOutput[] = [];
      setLiveOutputs([]);
      try {
        const { executionCount } = await kernel.execute(cellText(cell), {
          onIopub: (msg) => {
            acc = applyIopub(acc, msg);
            setLiveOutputs(acc);
          },
        });
        // Persist outputs + execution_count back into the .ipynb (plan §1.3).
        setNotebook((prev) => {
          const b = prev ?? base;
          const next = withCellExecution(b, idx, acc, executionCount);
          void savePageNotebook(pdfId, pageNumber, next).catch(() => undefined);
          return next;
        });
        setCellTimings(prev => ({ ...prev, [idx]: Date.now() - runStartMs }));
      } catch {
        setCellTimings(prev => ({ ...prev, [idx]: Date.now() - runStartMs }));
        setRunError(true);
      } finally {
        setRunningIndex(null);
        if (advance) setCellIndex((i) => clampCellIndex(i + 1, base.cells.length));
      }
    },
    [editable, notebook, cellIndex, editing, kernel, persistNotebook, pdfId, pageNumber],
  );

  // Run all code cells in order (phase 6c). Threads the notebook through a local `working` copy
  // (not React state, which updates async) so each cell's write-back is visible to the next, and
  // stops on the first cell that errors (mirroring Jupyter's "Run all" stop-on-error). Outputs
  // stream live per cell; the final document is persisted once. End-to-end needs a live kernel.
  const runAll = useCallback(async () => {
    if (!editable || !notebook) return;
    const idx0 = clampCellIndex(cellIndex, notebook.cells.length);
    let working = editing ? withCellSource(notebook, idx0, draftRef.current) : notebook;
    if (editing) setEditing(false);
    const indices = codeCellIndices(working);
    if (indices.length === 0) return;
    kernel.connect();
    setRunError(false);
    for (const i of indices) {
      const cell = working.cells[i];
      if (!cell || cell.cell_type !== 'code') continue;
      setCellIndex(i);
      setRunningIndex(i);
      let acc: NbOutput[] = [];
      setLiveOutputs([]);
      const runStartMs = Date.now();
      try {
        const { executionCount } = await kernel.execute(cellText(cell), {
          onIopub: (msg) => {
            acc = applyIopub(acc, msg);
            setLiveOutputs(acc);
          },
        });
        working = withCellExecution(working, i, acc, executionCount);
        setNotebook(working);
        setCellTimings(prev => ({ ...prev, [i]: Date.now() - runStartMs }));
      } catch {
        setCellTimings(prev => ({ ...prev, [i]: Date.now() - runStartMs }));
        setRunError(true);
        setRunningIndex(null);
        break;
      }
      setRunningIndex(null);
      // Stop on the first cell that raised (Python error appears as an 'error' output).
      if (acc.some((o) => o.output_type === 'error')) break;
    }
    void savePageNotebook(pdfId, pageNumber, working).catch(() => undefined);
  }, [editable, notebook, cellIndex, editing, kernel, pdfId, pageNumber]);

  const clearOutputs = useCallback(
    (scope: 'cell' | 'all') => {
      if (!editable || !notebook) return;
      const idx = clampCellIndex(cellIndex, notebook.cells.length);
      persistNotebook(scope === 'all' ? clearAllOutputs(notebook) : clearCellOutputs(notebook, idx));
      if (runningIndex === idx || scope === 'all') {
        setRunningIndex(null);
        setLiveOutputs([]);
      }
    },
    [editable, notebook, cellIndex, runningIndex, persistNotebook],
  );

  const restartKernel = useCallback(() => {
    if (!editable) return;
    setRunError(false);
    kernel.connect();
    void kernel.restart().catch(() => setRunError(true));
  }, [editable, kernel]);

  // Insert a new empty cell above/below the current one and select it. Commits any in-progress
  // edit first (same base-from-draft pattern as runCell) so the draft isn't lost to the re-render.
  const addCell = useCallback(
    (cellType: NbCellType, position: 'above' | 'below') => {
      if (!editable || !notebook) return;
      const idx = clampCellIndex(cellIndex, notebook.cells.length);
      const base = editing ? withCellSource(notebook, idx, draftRef.current) : notebook;
      if (editing) setEditing(false);
      const { notebook: next, index } = insertCell(base, position === 'below' ? idx + 1 : idx, cellType);
      persistNotebook(next);
      setCellIndex(index);
    },
    [editable, notebook, cellIndex, editing, persistNotebook],
  );

  // Delete the current cell (never the last remaining one) and select the clamped neighbour.
  const removeCell = useCallback(() => {
    if (!editable || !notebook || notebook.cells.length <= 1) return;
    if (!window.confirm(t('play.notebook.deleteCellConfirm'))) return;
    const idx = clampCellIndex(cellIndex, notebook.cells.length);
    const base = editing ? withCellSource(notebook, idx, draftRef.current) : notebook;
    if (editing) setEditing(false);
    const { notebook: next, index } = deleteCell(base, idx);
    persistNotebook(next);
    setCellIndex(index);
    if (runningIndex === idx) {
      setRunningIndex(null);
      setLiveOutputs([]);
    }
  }, [editable, notebook, cellIndex, editing, runningIndex, persistNotebook, t]);

  const moveCell = useCallback(
    (delta: number) => {
      if (editing) commitEdit();
      setCellIndex((idx) => clampCellIndex(idx + delta, cells.length));
    },
    [editing, commitEdit, cells.length],
  );

  // Copy text to the clipboard (cell source or flattened outputs). Available to read-only viewers
  // too. Best-effort: silently ignore when the clipboard API is unavailable or denied.
  const copyText = useCallback((text: string) => {
    if (!text) return;
    void navigator.clipboard?.writeText(text).catch(() => undefined);
  }, []);

  // Reorder the current cell up/down within the notebook (distinct from moveCell, which only moves
  // the selection). Commits any edit first, keeps the selection on the moved cell, and drops any
  // running-cell highlight since indices shift.
  const reorderCurrentCell = useCallback(
    (delta: number) => {
      if (!editable || !notebook) return;
      const idx = clampCellIndex(cellIndex, notebook.cells.length);
      const base = editing ? withCellSource(notebook, idx, draftRef.current) : notebook;
      if (editing) setEditing(false);
      const { notebook: next, index } = moveCellPosition(base, idx, delta);
      if (next === base) return; // no-op at the edges
      persistNotebook(next);
      setCellIndex(index);
      if (runningIndex != null) {
        setRunningIndex(null);
        setLiveOutputs([]);
      }
    },
    [editable, notebook, cellIndex, editing, runningIndex, persistNotebook],
  );

  // Toggle the current cell between code and markdown, preserving its source. Commits any edit
  // first; converting away from code drops that cell's running highlight (its outputs go away).
  const toggleCellType = useCallback(() => {
    if (!editable || !notebook) return;
    const idx = clampCellIndex(cellIndex, notebook.cells.length);
    const base = editing ? withCellSource(notebook, idx, draftRef.current) : notebook;
    if (editing) setEditing(false);
    const nextType: NbCellType = base.cells[idx]?.cell_type === 'code' ? 'markdown' : 'code';
    const next = changeCellType(base, idx, nextType);
    if (next === base) return;
    persistNotebook(next);
    if (runningIndex === idx) {
      setRunningIndex(null);
      setLiveOutputs([]);
    }
  }, [editable, notebook, cellIndex, editing, runningIndex, persistNotebook]);

  // Keyboard model (plan §1.2 command/edit):
  //  - Run keys (Ctrl/⌘+Enter, Shift+Enter) work in both modes and commit any edit first.
  //  - command mode: Enter → edit; ↑/↓ → switch cell (stopPropagation so global Space/←/→ paging stays).
  //  - edit mode: Escape → commit & leave; all other keys go to the textarea (no cell switching).
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        e.stopPropagation();
        if (editable) void runCell(false);
        return;
      }
      if (e.key === 'Enter' && e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        if (editable) void runCell(true);
        return;
      }
      if (editing) {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          commitEdit();
          containerRef.current?.focus();
        }
        // Everything else (typing, arrows, Enter for newline) belongs to the textarea.
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        if (editable) beginEdit();
        return;
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.stopPropagation();
        e.preventDefault();
        setCellIndex((idx) => clampCellIndex(idx + (e.key === 'ArrowDown' ? 1 : -1), cells.length));
      }
    },
    [cells.length, editable, editing, runCell, beginEdit, commitEdit],
  );

  // Focus the editor when entering edit mode.
  useEffect(() => {
    if (editing) textareaRef.current?.focus();
  }, [editing]);

  useEffect(() => {
    containerRef.current?.scrollTo({ top: 0 });
  }, [currentIndex, notebook]);

  // Flag a run that has been going for a while so the footer can hint (still running, restart
  // possible) rather than sitting on a silent "busy" (phase 5e).
  useEffect(() => {
    if (runningIndex == null) {
      setRunTimedOut(false);
      return;
    }
    const timer = window.setTimeout(() => setRunTimedOut(true), NOTEBOOK_RUN_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [runningIndex]);

  const footer = useMemo(() => {
    if (cells.length === 0) return '';
    const type = currentCell?.cell_type ?? 'code';
    return t('play.notebook.cellPosition')
      .replace('{index}', String(currentIndex + 1))
      .replace('{total}', String(cells.length))
      .replace('{type}', type);
  }, [cells.length, currentCell, currentIndex, t]);

  const isRunningCurrent = runningIndex === currentIndex;
  const outputs = currentCell
    ? isRunningCurrent
      ? displayOutputs(liveOutputs)
      : displayOutputs(currentCell.outputs)
    : [];

  const kernelLabelKey = kernelStatusLabelKey({
    editable,
    runError,
    phase: kernel.phase,
    running: runningIndex != null,
    timedOut: runTimedOut,
  });
  const kernelLabel = kernelLabelKey ? t(kernelLabelKey) : '';

  return (
    <div className={`flex flex-col overflow-hidden rounded-lg border border-slate-800 bg-surface text-text leading-normal ${className ?? ''}`} style={style}>
      {editable ? (
        <div className="flex items-center justify-between gap-1.5 border-b border-slate-800 px-3 py-1 text-[11px]">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => addCell('code', 'below')}
              className="rounded px-1.5 py-0.5 text-text hover:bg-surface-muted"
              title={t('play.notebook.addCodeCell')}
            >
              ＋{t('play.notebook.addCodeCell')}
            </button>
            <button
              type="button"
              onClick={() => addCell('markdown', 'below')}
              className="rounded px-1.5 py-0.5 text-text hover:bg-surface-muted"
              title={t('play.notebook.addMarkdownCell')}
            >
              ＋{t('play.notebook.addMarkdownCell')}
            </button>
            <button
              type="button"
              onClick={() => reorderCurrentCell(-1)}
              disabled={currentIndex <= 0}
              className="rounded px-1.5 py-0.5 text-text hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40"
              title={t('play.notebook.moveCellUp')}
            >
              ⬆
            </button>
            <button
              type="button"
              onClick={() => reorderCurrentCell(1)}
              disabled={currentIndex >= cells.length - 1}
              className="rounded px-1.5 py-0.5 text-text hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40"
              title={t('play.notebook.moveCellDown')}
            >
              ⬇
            </button>
            <button
              type="button"
              onClick={toggleCellType}
              className="rounded px-1.5 py-0.5 text-text hover:bg-surface-muted"
              title={currentCell?.cell_type === 'code' ? t('play.notebook.toCellMarkdown') : t('play.notebook.toCellCode')}
            >
              {currentCell?.cell_type === 'code' ? t('play.notebook.toCellMarkdown') : t('play.notebook.toCellCode')}
            </button>
            <button
              type="button"
              onClick={removeCell}
              disabled={cells.length <= 1}
              className="rounded px-1.5 py-0.5 text-rose-400 hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40"
              title={t('play.notebook.deleteCell')}
            >
              🗑 {t('play.notebook.deleteCell')}
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => void runCell(false)}
              disabled={runningIndex != null || currentCell?.cell_type !== 'code'}
              className="rounded px-1.5 py-0.5 font-medium text-sky-400 hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40"
              title={t('play.notebook.runHint')}
            >
              {isRunningCurrent ? t('play.notebook.running') : `▶ ${t('play.notebook.run')}`}
            </button>
            <button
              type="button"
              onClick={() => void runAll()}
              disabled={runningIndex != null || !notebook || codeCellIndices(notebook).length === 0}
              className="rounded px-1.5 py-0.5 font-medium text-sky-400 hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40"
              title={t('play.notebook.runAll')}
            >
              ▶▶ {t('play.notebook.runAll')}
            </button>
            <button
              type="button"
              onClick={restartKernel}
              className="rounded px-1.5 py-0.5 text-text hover:bg-surface-muted"
              title={t('play.notebook.restart')}
            >
              ⟳ {t('play.notebook.restart')}
            </button>
            <button
              type="button"
              onClick={() => clearOutputs('cell')}
              className="rounded px-1.5 py-0.5 text-text hover:bg-surface-muted"
              title={t('play.notebook.clearOutputs')}
            >
              {t('play.notebook.clearOutputs')}
            </button>
            <button
              type="button"
              onClick={() => clearOutputs('all')}
              className="rounded px-1.5 py-0.5 text-text hover:bg-surface-muted"
              title={t('play.notebook.clearAllOutputs')}
            >
              {t('play.notebook.clearAllOutputs')}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".ipynb,application/json,application/x-ipynb+json"
              onChange={handleUploadFile}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="rounded px-1.5 py-0.5 text-text hover:bg-surface-muted"
              title={t('play.notebook.uploadHint')}
            >
              📤 {t('play.notebook.upload')}
            </button>
            <button
              type="button"
              onClick={downloadNotebook}
              disabled={!notebook}
              className="rounded px-1.5 py-0.5 text-text hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40"
              title={t('play.notebook.downloadHint')}
            >
              📥 {t('play.notebook.download')}
            </button>
          </div>
        </div>
      ) : null}
      <div
        ref={containerRef}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-3 outline-none focus:ring-1 focus:ring-sky-500/40"
        aria-label={t('play.notebook.ariaLabel')}
      >
        {notebook === null ? (
          <p className="text-xs text-text-muted">{t('play.notebook.loading')}</p>
        ) : loadError ? (
          <p className="text-xs text-text-muted">{t('play.notebook.loadError')}</p>
        ) : cells.length === 0 ? (
          <p className="text-xs text-text-muted">{t('play.notebook.empty')}</p>
        ) : currentCell ? (
          <>
          <CellBody
            cell={currentCell}
            outputs={outputs}
            editing={editing}
            draft={draft}
            onDraftChange={(v) => {
              draftRef.current = v;
              setDraft(v);
            }}
            onBeginEdit={editable ? beginEdit : undefined}
            textareaRef={textareaRef}
            editPlaceholder={t('play.notebook.editPlaceholder')}
          />
        {!editing && currentCell?.cell_type === 'code' && cellTimings[currentIndex] != null ? (
          <p className="mt-1 text-[10px] text-text-muted/60">
            {`耗時 ${formatCellTiming(cellTimings[currentIndex]!)}`}
          </p>
        ) : null}
          </>
        ) : null}
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-slate-800 px-3 py-1.5 text-[11px] text-text-muted">
        <span className="truncate">{footer}</span>
        <span className="flex items-center gap-2">
          {kernelLabel ? <span className="truncate text-text-muted/80">{kernelLabel}</span> : null}
          {editable && currentCell ? (
            editing ? (
              <button
                type="button"
                onClick={() => commitEdit()}
                className="rounded px-1.5 py-0.5 font-medium text-emerald-400 hover:bg-surface-muted"
                title={t('play.notebook.doneHint')}
              >
                ✓ {t('play.notebook.done')}
              </button>
            ) : (
              <button
                type="button"
                onClick={beginEdit}
                className="rounded px-1.5 py-0.5 text-text hover:bg-surface-muted"
                title={t('play.notebook.editHint')}
              >
                ✎ {t('play.notebook.edit')}
              </button>
            )
          ) : null}
          {editable && currentCell?.cell_type === 'code' ? (
            <button
              type="button"
              onClick={() => void runCell(false)}
              disabled={isRunningCurrent}
              className="rounded px-1.5 py-0.5 font-medium text-sky-400 hover:bg-surface-muted disabled:opacity-40"
              title={t('play.notebook.runHint')}
            >
              {isRunningCurrent ? t('play.notebook.running') : `▶ ${t('play.notebook.run')}`}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => copyText(cellText(currentCell ?? { cell_type: 'code', source: '' }))}
            className="rounded px-1.5 py-0.5 text-text hover:bg-surface-muted"
            title={t('play.notebook.copySource')}
          >
            ⧉ {t('play.notebook.copySource')}
          </button>
          {currentCell?.cell_type === 'code' && outputsToPlainText(currentCell.outputs) ? (
            <button
              type="button"
              onClick={() => copyText(outputsToPlainText(currentCell.outputs))}
              className="rounded px-1.5 py-0.5 text-text hover:bg-surface-muted"
              title={t('play.notebook.copyOutput')}
            >
              ⧉ {t('play.notebook.copyOutput')}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => moveCell(-1)}
            disabled={currentIndex <= 0}
            className="rounded px-1.5 py-0.5 text-text hover:bg-surface-muted disabled:opacity-40"
            aria-label={t('play.notebook.prevCell')}
          >
            ↑
          </button>
          <button
            type="button"
            onClick={() => moveCell(1)}
            disabled={currentIndex >= cells.length - 1}
            className="rounded px-1.5 py-0.5 text-text hover:bg-surface-muted disabled:opacity-40"
            aria-label={t('play.notebook.nextCell')}
          >
            ↓
          </button>
        </span>
      </div>
    </div>
  );
}
