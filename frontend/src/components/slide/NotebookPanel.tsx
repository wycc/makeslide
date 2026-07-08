// Single-cell notebook view for a `render_type = 'notebook'` slide page (Jupyter phase 1c).
//
// Shows exactly one cell at a time inside a fixed-height, vertically scrolling container
// (plan constraint 3). Command-mode `↑`/`↓` switch cells and are stopPropagation'd so the
// global PlayPage keyboard handler still gets `Space`/`←`/`→` for slide navigation. When the
// deck is editable, `Ctrl/⌘+Enter` runs the current code cell on a real Jupyter kernel and
// `Shift+Enter` runs it and advances; iopub output streams in live and the result is written
// back to the `.ipynb` (plan §1.2, §1.3, MVP). Read-only viewers only see stored outputs.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { MarkdownMath } from '../MarkdownMath';
import { useI18n } from '../../i18n';
import { fetchPageNotebook, savePageNotebook } from '../../lib/api/pdfs';
import {
  applyIopub,
  cellText,
  clampCellIndex,
  clearAllOutputs,
  clearCellOutputs,
  displayOutputs,
  defaultNbNotebook,
  parseNbNotebook,
  withCellExecution,
  type NbCell,
  type NbDisplayOutput,
  type NbNotebook,
  type NbOutput,
} from '../../lib/nbformatModel';
import { useJupyterKernel } from './useJupyterKernel';

function OutputBlock({ output }: { output: NbDisplayOutput }) {
  switch (output.kind) {
    case 'image':
      return <img src={`data:${output.mimeType};base64,${output.dataBase64}`} alt="" className="max-w-full rounded border border-border" />;
    case 'html':
      // Stored HTML output; shown as escaped text until the sandboxed iframe renderer lands (phase 2).
      return <pre className="overflow-x-auto rounded bg-surface-muted px-3 py-2 text-xs text-text">{output.html}</pre>;
    case 'latex':
      return <MarkdownMath content={output.latex} />;
    case 'error':
      return (
        <pre className="overflow-x-auto rounded bg-rose-50 px-3 py-2 text-xs text-rose-800 dark:bg-rose-950/30 dark:text-rose-200">
          <span className="font-semibold">{[output.ename, output.evalue].filter(Boolean).join(': ')}</span>
          {output.traceback ? `\n${output.traceback}` : ''}
        </pre>
      );
    default:
      return <pre className="overflow-x-auto rounded bg-surface-muted px-3 py-2 text-xs text-text">{output.text}</pre>;
  }
}

function CellBody({ cell, outputs }: { cell: NbCell; outputs: NbDisplayOutput[] }) {
  const source = cellText(cell);
  if (cell.cell_type === 'markdown') {
    return <MarkdownMath content={source} />;
  }
  return (
    <div className="flex flex-col gap-1.5">
      {source.trim() !== '' && (
        <pre className="overflow-x-auto rounded-md border border-border bg-surface px-3 py-2 text-xs text-text">
          <code>{source}</code>
        </pre>
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
  const containerRef = useRef<HTMLDivElement>(null);

  const notebookKey = editable ? `${pdfId}:${pageNumber}` : null;
  const kernel = useJupyterKernel(notebookKey);

  useEffect(() => {
    let cancelled = false;
    setNotebook(null);
    setLoadError(false);
    setCellIndex(0);
    setRunningIndex(null);
    setLiveOutputs([]);
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

  const runCell = useCallback(
    async (advance: boolean) => {
      if (!editable || !notebook) return;
      const idx = clampCellIndex(cellIndex, notebook.cells.length);
      const cell = notebook.cells[idx];
      if (!cell || cell.cell_type !== 'code') {
        if (advance) setCellIndex((i) => clampCellIndex(i + 1, notebook.cells.length));
        return;
      }
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
          const base = prev ?? notebook;
          const next = withCellExecution(base, idx, acc, executionCount);
          void savePageNotebook(pdfId, pageNumber, next).catch(() => undefined);
          return next;
        });
      } catch {
        setRunError(true);
      } finally {
        setRunningIndex(null);
        if (advance) setCellIndex((i) => clampCellIndex(i + 1, notebook.cells.length));
      }
    },
    [editable, notebook, cellIndex, kernel, pdfId, pageNumber],
  );

  const persistNotebook = useCallback(
    (next: NbNotebook) => {
      setNotebook(next);
      void savePageNotebook(pdfId, pageNumber, next).catch(() => undefined);
    },
    [pdfId, pageNumber],
  );

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

  // Command-mode keys: ↑/↓ switch cells; Ctrl/⌘+Enter runs the cell; Shift+Enter runs & advances.
  // stopPropagation keeps them from the global PlayPage handler (which still gets Space/←/→).
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
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.stopPropagation();
        e.preventDefault();
        setCellIndex((idx) => clampCellIndex(idx + (e.key === 'ArrowDown' ? 1 : -1), cells.length));
      }
    },
    [cells.length, editable, runCell],
  );

  useEffect(() => {
    containerRef.current?.scrollTo({ top: 0 });
  }, [currentIndex, notebook]);

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

  const kernelLabel = (() => {
    if (!editable) return '';
    if (runError || kernel.phase === 'unavailable' || kernel.phase === 'error') return t('play.notebook.kernelUnavailable');
    if (kernel.phase === 'connecting') return t('play.notebook.kernelConnecting');
    if (runningIndex != null || kernel.phase === 'busy') return t('play.notebook.kernelBusy');
    if (kernel.phase === 'ready') return t('play.notebook.kernelReady');
    return '';
  })();

  return (
    <div className={`flex flex-col overflow-hidden rounded-lg border border-slate-800 bg-surface ${className ?? ''}`} style={style}>
      {editable ? (
        <div className="flex items-center justify-end gap-1.5 border-b border-slate-800 px-3 py-1 text-[11px]">
          <button
            type="button"
            onClick={restartKernel}
            className="rounded px-1.5 py-0.5 text-text-muted hover:bg-surface-muted"
            title={t('play.notebook.restart')}
          >
            ⟳ {t('play.notebook.restart')}
          </button>
          <button
            type="button"
            onClick={() => clearOutputs('cell')}
            className="rounded px-1.5 py-0.5 text-text-muted hover:bg-surface-muted"
            title={t('play.notebook.clearOutputs')}
          >
            {t('play.notebook.clearOutputs')}
          </button>
          <button
            type="button"
            onClick={() => clearOutputs('all')}
            className="rounded px-1.5 py-0.5 text-text-muted hover:bg-surface-muted"
            title={t('play.notebook.clearAllOutputs')}
          >
            {t('play.notebook.clearAllOutputs')}
          </button>
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
          <CellBody cell={currentCell} outputs={outputs} />
        ) : null}
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-slate-800 px-3 py-1.5 text-[11px] text-text-muted">
        <span className="truncate">{footer}</span>
        <span className="flex items-center gap-2">
          {kernelLabel ? <span className="truncate text-text-muted/80">{kernelLabel}</span> : null}
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
            onClick={() => setCellIndex((idx) => clampCellIndex(idx - 1, cells.length))}
            disabled={currentIndex <= 0}
            className="rounded px-1.5 py-0.5 hover:bg-surface-muted disabled:opacity-40"
            aria-label={t('play.notebook.prevCell')}
          >
            ↑
          </button>
          <button
            type="button"
            onClick={() => setCellIndex((idx) => clampCellIndex(idx + 1, cells.length))}
            disabled={currentIndex >= cells.length - 1}
            className="rounded px-1.5 py-0.5 hover:bg-surface-muted disabled:opacity-40"
            aria-label={t('play.notebook.nextCell')}
          >
            ↓
          </button>
        </span>
      </div>
    </div>
  );
}
