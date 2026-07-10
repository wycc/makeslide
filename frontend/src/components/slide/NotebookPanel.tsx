// Single-cell notebook view for a `render_type = 'notebook'` slide page (Jupyter phase 1c).
//
// Shows exactly one cell at a time inside a fixed-height, vertically scrolling container
// (plan constraint 3). Command-mode `↑`/`↓` switch cells and are stopPropagation'd so the
// global PlayPage keyboard handler still gets `Space`/`←`/`→` for slide navigation.
// `Ctrl/⌘+Enter` runs the current code cell on a real Jupyter kernel and `Shift+Enter` runs it
// and advances; iopub output streams in live (plan §1.2, §1.3, MVP).
//
// Write-back vs. trial mode: when the deck is editable, execution results and cell edits are
// persisted to the shared `.ipynb` via PUT. Read-only viewers can still run cells and edit
// sources, but everything stays in this browser's component state only (ephemeral trial mode) —
// nothing is written back, and a reload restores the stored notebook. Structural authoring
// (add/delete/move/convert cells, upload) remains editable-only.

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
import { useJupyterKernel, listKernelSpecs, type KernelSpecInfo } from './useJupyterKernel';
import { kernelStatusLabelKey } from '../../lib/jupyterConnection';
import { collapseText } from '../../lib/collapseText';

/** How long a cell may run before the footer hints it is taking a while (phase 5e). */
const NOTEBOOK_RUN_TIMEOUT_MS = 30_000;

/** Text/error outputs longer than this collapse to a "show more" toggle (phase 6e). */
const MAX_OUTPUT_LINES = 16;

/** Adjustable cell font size (px) for the code/output area, persisted in localStorage. */
const FONT_MIN = 9;
const FONT_MAX = 28;
const FONT_DEFAULT = 13;
const FONT_STORAGE_KEY = 'makeslide.nbFontSize';
/** Fullscreen markdown is this multiple of the cell font size, for a presentation feel. */
const MARKDOWN_FULLSCREEN_SCALE = 1.8;

/** Remembered kernelspec name (Conda/Anaconda environment) across notebook pages. */
const KERNEL_STORAGE_KEY = 'makeslide.nbKernel';

/** Remembered cell layout: 'stack' (code above output) or 'split' (code left, output right). */
type CellLayout = 'stack' | 'split';
const LAYOUT_STORAGE_KEY = 'makeslide.nbCellLayout';

/** In split layout, the output pane's width share (0 = only input, 100 = only output). */
const RATIO_STORAGE_KEY = 'makeslide.nbOutputShare';
const OUTPUT_SHARE_DEFAULT = 50;

/** Remembered current-cell index per notebook page, so re-opening resumes where you left off. */
const CELL_INDEX_STORAGE_PREFIX = 'makeslide.nbCell.';
function readStoredCellIndex(pdfId: string, pageNumber: number): number {
  if (typeof localStorage === 'undefined') return 0;
  const n = Number(localStorage.getItem(`${CELL_INDEX_STORAGE_PREFIX}${pdfId}:${pageNumber}`));
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

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
// Track html.dark so the sandboxed HTML output (pandas tables, repr HTML) uses matching colours.
function useHtmlDark(): boolean {
  const [dark, setDark] = useState(
    () => typeof document !== 'undefined' && document.documentElement.classList.contains('dark'),
  );
  useEffect(() => {
    const el = document.documentElement;
    const update = () => setDark(el.classList.contains('dark'));
    update();
    const obs = new MutationObserver(update);
    obs.observe(el, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

function NotebookHtmlOutput({ html }: { html: string }) {
  const dark = useHtmlDark();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [height, setHeight] = useState(40);
  const srcDoc = useMemo(() => buildNotebookHtmlSrcDoc(html, dark), [html, dark]);
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
          className="overflow-x-auto rounded bg-rose-50 px-3 py-2 text-rose-800 dark:bg-rose-950/30 dark:text-rose-200"
        />
      ) : (
        <pre className="overflow-x-auto rounded bg-rose-50 px-3 py-2 text-rose-800 dark:bg-rose-950/30 dark:text-rose-200">
          <span className="font-semibold">{[output.ename, output.evalue].filter(Boolean).join(': ')}</span>
        </pre>
      );
    default:
      return (
        <CollapsibleOutput
          text={output.text}
          render={(tt) => tt}
          className="overflow-x-auto rounded bg-surface-muted px-3 py-2 text-text"
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
  fontSize: number;
  layout: 'stack' | 'split';
  outputShare: number;
  fullscreen: boolean;
}

function CellBody({ cell, outputs, editing, draft, onDraftChange, onBeginEdit, textareaRef, editPlaceholder, fontSize, layout, outputShare, fullscreen }: CellBodyProps) {
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
      className="min-h-[6rem] w-full resize-y rounded-md border border-sky-500/50 bg-surface px-3 py-2 font-mono text-text outline-none focus:ring-1 focus:ring-sky-500/50"
      rows={Math.min(20, Math.max(4, draft.split('\n').length + 1))}
    />
  );

  if (cell.cell_type === 'markdown') {
    // Markdown scales with the cell font-size setting (linked to the code font); in fullscreen it is
    // multiplied for a slide/presentation feel. MarkdownMath's headings/paragraphs/inline-code
    // inherit or use em units, so setting the base size scales the whole block proportionally.
    return editing ? textareaEditor : (
      <div
        onDoubleClick={onBeginEdit}
        className={fullscreen ? 'leading-relaxed' : undefined}
        style={{ fontSize: `${Math.round(fontSize * (fullscreen ? MARKDOWN_FULLSCREEN_SCALE : 1))}px` }}
      >
        <MarkdownMath content={source} />
      </div>
    );
  }
  // Code cells get syntax-highlighted CodeMirror while editing (lazy-loaded, phase 3b).
  const editor = editing ? (
    <Suspense fallback={textareaEditor}>
      <CodeMirrorEditor value={draft} onChange={onDraftChange} autoFocus fontSize={fontSize} />
    </Suspense>
  ) : null;
  const codeSide =
    editor ??
    (source.trim() !== '' ? (
      <div className="flex flex-col gap-0.5">
        {/* Jupyter-style execution count (phase 7a). */}
        <span className="font-mono text-[10px] leading-none text-sky-500/70">In {executionCountLabel(cell.execution_count)}:</span>
        <pre
          onDoubleClick={onBeginEdit}
          className="overflow-x-auto rounded-md border border-border bg-surface px-3 py-2 text-text"
        >
          <code>{source}</code>
        </pre>
      </div>
    ) : null);
  const outputSide =
    outputs.length > 0 ? (
      <div className="flex flex-col gap-1.5">
        {outputs.map((output, j) => (
          <OutputBlock key={j} output={output} />
        ))}
      </div>
    ) : null;
  // Split layout: source on the left, outputs on the right, with an adjustable width ratio
  // (outputShare 0 → only input, 100 → only output). Otherwise they stack top-to-bottom.
  const split = layout === 'split' && codeSide != null && outputSide != null;
  return (
    <div className={split ? 'flex flex-row items-start gap-3' : 'flex flex-col gap-1.5'}>
      {codeSide ? (
        <div className={split ? 'min-w-0' : undefined} style={split ? { flexBasis: 0, flexGrow: 100 - outputShare } : undefined}>
          {codeSide}
        </div>
      ) : null}
      {outputSide ? (
        <div className={split ? 'min-w-0' : undefined} style={split ? { flexBasis: 0, flexGrow: outputShare } : undefined}>
          {outputSide}
        </div>
      ) : null}
    </div>
  );
}

export interface NotebookPanelProps {
  pdfId: string;
  pageNumber: number;
  shareToken?: string;
  /** When true (deck access_level === 'edit'), changes are written back to the shared `.ipynb`;
   *  when false, runs/edits still work but stay browser-local (ephemeral trial mode). */
  editable?: boolean;
  /** When true (shown in fullscreen), markdown cells render larger for a presentation feel. */
  fullscreen?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export function NotebookPanel({ pdfId, pageNumber, shareToken, editable = false, fullscreen = false, className, style }: NotebookPanelProps) {
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
  const [fontSize, setFontSize] = useState<number>(() => {
    if (typeof localStorage === 'undefined') return FONT_DEFAULT;
    const n = Number(localStorage.getItem(FONT_STORAGE_KEY));
    return Number.isFinite(n) && n > 0 ? Math.min(FONT_MAX, Math.max(FONT_MIN, n)) : FONT_DEFAULT;
  });
  const changeFontSize = useCallback((delta: number) => {
    setFontSize((prev) => {
      const next = Math.min(FONT_MAX, Math.max(FONT_MIN, prev + delta));
      try {
        localStorage.setItem(FONT_STORAGE_KEY, String(next));
      } catch {
        /* ignore storage failures (private mode, etc.) */
      }
      return next;
    });
  }, []);

  const [kernelSpecs, setKernelSpecs] = useState<KernelSpecInfo[]>([]);
  const [kernelName, setKernelName] = useState<string>(() =>
    (typeof localStorage !== 'undefined' && localStorage.getItem(KERNEL_STORAGE_KEY)) || 'python3',
  );
  // Trial mode (read-only viewer): set once anything was run/edited locally, so the toolbar can
  // hint that changes live only in this browser and are never written back.
  const [trialDirty, setTrialDirty] = useState(false);
  // Read-only viewers get kernel plumbing lazily — only after they actually use it — so passive
  // viewers never pull the heavy @jupyterlab/services chunk or hit the connection endpoint.
  const [kernelUsed, setKernelUsed] = useState(false);
  const notebookKey = `${pdfId}:${pageNumber}`;
  const kernel = useJupyterKernel(notebookKey, kernelName);

  // Load the available kernelspecs (Conda/Anaconda environments) so the toolbar can offer a picker.
  useEffect(() => {
    if (!editable && !kernelUsed) return;
    let cancelled = false;
    listKernelSpecs()
      .then((specs) => { if (!cancelled) setKernelSpecs(specs); })
      .catch(() => { if (!cancelled) setKernelSpecs([]); });
    return () => { cancelled = true; };
  }, [editable, kernelUsed]);

  // If the remembered env is no longer available, fall back to python3 or the first spec.
  useEffect(() => {
    if (kernelSpecs.length === 0 || kernelSpecs.some((s) => s.name === kernelName)) return;
    const fallback = kernelSpecs.find((s) => s.name === 'python3') ?? kernelSpecs[0];
    if (fallback) setKernelName(fallback.name);
  }, [kernelSpecs, kernelName]);

  const changeKernel = useCallback((name: string) => {
    setKernelName(name);
    try {
      localStorage.setItem(KERNEL_STORAGE_KEY, name);
    } catch {
      /* ignore storage failures */
    }
  }, []);

  const [cellLayout, setCellLayout] = useState<CellLayout>(() =>
    (typeof localStorage !== 'undefined' && localStorage.getItem(LAYOUT_STORAGE_KEY)) === 'split' ? 'split' : 'stack',
  );
  const toggleCellLayout = useCallback(() => {
    setCellLayout((prev) => {
      const next: CellLayout = prev === 'split' ? 'stack' : 'split';
      try {
        localStorage.setItem(LAYOUT_STORAGE_KEY, next);
      } catch {
        /* ignore storage failures */
      }
      return next;
    });
  }, []);

  const [outputShare, setOutputShare] = useState<number>(() => {
    if (typeof localStorage === 'undefined') return OUTPUT_SHARE_DEFAULT;
    const n = Number(localStorage.getItem(RATIO_STORAGE_KEY));
    return Number.isFinite(n) && n >= 0 && n <= 100 ? n : OUTPUT_SHARE_DEFAULT;
  });
  const changeOutputShare = useCallback((value: number) => {
    const clamped = Math.min(100, Math.max(0, Math.round(value)));
    setOutputShare(clamped);
    try {
      localStorage.setItem(RATIO_STORAGE_KEY, String(clamped));
    } catch {
      /* ignore storage failures */
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    setNotebook(null);
    setLoadError(false);
    setCellIndex(readStoredCellIndex(pdfId, pageNumber));
    setRunningIndex(null);
    setLiveOutputs([]);
    setCellTimings({});
    setEditing(false);
    setTrialDirty(false);
    fetchPageNotebook(pdfId, pageNumber, shareToken)
      .then((resp) => {
        if (cancelled) return;
        const model = parseNbNotebook(resp.notebook);
        setNotebook(model);
        // Clamp the restored cell index into the loaded notebook's range.
        setCellIndex((idx) => clampCellIndex(idx, model.cells.length));
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

  // Remember the current cell per page (only once this page's notebook has loaded, so a page
  // transition — where notebook is briefly null — can't write a stale index to the new page).
  useEffect(() => {
    if (notebook === null || typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(`${CELL_INDEX_STORAGE_PREFIX}${pdfId}:${pageNumber}`, String(currentIndex));
    } catch {
      /* ignore storage failures */
    }
  }, [notebook, currentIndex, pdfId, pageNumber]);

  // Apply a notebook update: editable decks write back to the shared `.ipynb`; read-only trial
  // mode keeps the change in component state only (gone on reload — that's the contract).
  const persistNotebook = useCallback(
    (next: NbNotebook) => {
      setNotebook(next);
      if (editable) {
        void savePageNotebook(pdfId, pageNumber, next).catch(() => undefined);
      } else {
        setTrialDirty(true);
      }
    },
    [editable, pdfId, pageNumber],
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
    if (!currentCell) return;
    const text = cellText(currentCell);
    draftRef.current = text;
    setDraft(text);
    setEditing(true);
  }, [currentCell]);

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
      if (!notebook) return;
      setKernelUsed(true);
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
        // Persist outputs + execution_count back into the .ipynb (plan §1.3) — editable decks
        // only; trial mode keeps the executed result in this browser's state.
        setNotebook((prev) => {
          const b = prev ?? base;
          const next = withCellExecution(b, idx, acc, executionCount);
          if (editable) void savePageNotebook(pdfId, pageNumber, next).catch(() => undefined);
          return next;
        });
        if (!editable) setTrialDirty(true);
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
    if (!notebook) return;
    setKernelUsed(true);
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
    if (editable) {
      void savePageNotebook(pdfId, pageNumber, working).catch(() => undefined);
    } else {
      setTrialDirty(true);
    }
  }, [editable, notebook, cellIndex, editing, kernel, pdfId, pageNumber]);

  const clearOutputs = useCallback(
    (scope: 'cell' | 'all') => {
      if (!notebook) return;
      const idx = clampCellIndex(cellIndex, notebook.cells.length);
      persistNotebook(scope === 'all' ? clearAllOutputs(notebook) : clearCellOutputs(notebook, idx));
      if (runningIndex === idx || scope === 'all') {
        setRunningIndex(null);
        setLiveOutputs([]);
      }
    },
    [notebook, cellIndex, runningIndex, persistNotebook],
  );

  const restartKernel = useCallback(() => {
    setKernelUsed(true);
    setRunError(false);
    kernel.connect();
    void kernel.restart().catch(() => setRunError(true));
  }, [kernel]);

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
        void runCell(false);
        return;
      }
      if (e.key === 'Enter' && e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        void runCell(true);
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
        beginEdit();
        return;
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.stopPropagation();
        e.preventDefault();
        setCellIndex((idx) => clampCellIndex(idx + (e.key === 'ArrowDown' ? 1 : -1), cells.length));
      }
    },
    [cells.length, editing, runCell, beginEdit, commitEdit],
  );

  // In fullscreen the notebook container isn't focused, so PlayPage's global ↑/↓ handler dispatches
  // this event to switch cells here. Ignored while editing (arrows move the cursor instead).
  useEffect(() => {
    const onNav = (e: Event) => {
      const delta = (e as CustomEvent<{ delta?: number }>).detail?.delta;
      if ((delta !== 1 && delta !== -1) || editing) return;
      setCellIndex((idx) => clampCellIndex(idx + delta, cells.length));
    };
    window.addEventListener('makeslide:notebook-cell-nav', onNav);
    return () => window.removeEventListener('makeslide:notebook-cell-nav', onNav);
  }, [editing, cells.length]);

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
    runError,
    phase: kernel.phase,
    running: runningIndex != null,
    timedOut: runTimedOut,
  });
  const kernelLabel = kernelLabelKey ? t(kernelLabelKey) : '';

  return (
    <div className={`flex flex-col overflow-hidden rounded-lg border border-slate-800 bg-surface text-text leading-normal ${className ?? ''}`} style={style}>
      {/* Toolbar always renders. Run controls (kernel picker, run, run all, restart, clear
          outputs) are available to everyone — read-only viewers run in ephemeral trial mode
          (browser-local, never written back; the badge below says so once anything changed).
          Only structural authoring (add/move/convert/delete cells, upload) is gated on `editable`. */}
      <div className="flex flex-wrap items-center justify-between gap-y-1 gap-x-1.5 border-b border-slate-800 px-3 py-1 text-[11px]">
          {editable ? (
          <div className="flex flex-wrap items-center gap-1.5">
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
          ) : trialDirty ? (
          <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-500" title={t('play.notebook.trialModeHint')}>
            {t('play.notebook.trialMode')}
          </span>
          ) : null}
          <div className="flex flex-wrap items-center gap-1.5">
            {kernelSpecs.length > 1 ? (
              <select
                value={kernelName}
                onChange={(e) => changeKernel(e.target.value)}
                className="max-w-[11rem] rounded border border-slate-700 bg-surface px-1 py-0.5 text-text hover:bg-surface-muted focus:outline-none focus:ring-1 focus:ring-sky-500/50"
                title={t('play.notebook.kernelEnv')}
                aria-label={t('play.notebook.kernelEnv')}
              >
                {kernelSpecs.map((s) => (
                  <option key={s.name} value={s.name}>
                    {s.displayName}
                  </option>
                ))}
              </select>
            ) : null}
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
            {editable ? (
            <>
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
            </>
            ) : null}
            <button
              type="button"
              onClick={downloadNotebook}
              disabled={!notebook}
              className="rounded px-1.5 py-0.5 text-text hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40"
              title={t('play.notebook.downloadHint')}
            >
              📥 {t('play.notebook.download')}
            </button>
            <span className="mx-0.5 h-4 w-px bg-slate-700" aria-hidden="true" />
            <button
              type="button"
              onClick={() => changeFontSize(-1)}
              disabled={fontSize <= FONT_MIN}
              className="rounded px-1.5 py-0.5 text-text hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40"
              title={t('play.notebook.fontSmaller')}
            >
              A－
            </button>
            <span className="tabular-nums text-text-muted" title={t('play.notebook.fontSize')}>{fontSize}</span>
            <button
              type="button"
              onClick={() => changeFontSize(1)}
              disabled={fontSize >= FONT_MAX}
              className="rounded px-1.5 py-0.5 text-text hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40"
              title={t('play.notebook.fontLarger')}
            >
              A＋
            </button>
            <span className="mx-0.5 h-4 w-px bg-slate-700" aria-hidden="true" />
            <button
              type="button"
              onClick={toggleCellLayout}
              className="rounded px-1.5 py-0.5 text-text hover:bg-surface-muted"
              title={cellLayout === 'split' ? t('play.notebook.layoutStack') : t('play.notebook.layoutSplit')}
            >
              {cellLayout === 'split' ? `⬍ ${t('play.notebook.layoutStack')}` : `⬌ ${t('play.notebook.layoutSplit')}`}
            </button>
            {cellLayout === 'split' ? (
              <span className="flex items-center gap-1" title={t('play.notebook.outputRatio')}>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={outputShare}
                  onChange={(e) => changeOutputShare(Number(e.target.value))}
                  className="h-1 w-20 cursor-pointer accent-sky-500"
                  aria-label={t('play.notebook.outputRatio')}
                />
                <span className="tabular-nums text-text-muted">{t('play.notebook.outputRatio')} {outputShare}%</span>
              </span>
            ) : null}
          </div>
        </div>
      <div
        ref={containerRef}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-3 outline-none focus:ring-1 focus:ring-sky-500/40"
        style={{ fontSize: `${fontSize}px` }}
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
            onBeginEdit={beginEdit}
            textareaRef={textareaRef}
            editPlaceholder={t('play.notebook.editPlaceholder')}
            fontSize={fontSize}
            layout={cellLayout}
            outputShare={outputShare}
            fullscreen={fullscreen}
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
          {currentCell ? (
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
          {currentCell?.cell_type === 'code' ? (
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
