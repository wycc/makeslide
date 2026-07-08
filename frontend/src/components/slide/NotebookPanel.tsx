// Single-cell notebook view for a `render_type = 'notebook'` slide page (Jupyter phase 1c).
//
// Shows exactly one cell at a time inside a fixed-height, vertically scrolling container
// (plan constraint 3). Command mode `↑`/`↓` switch cells and are stopPropagation'd so the
// global PlayPage keyboard handler still gets `Space`/`←`/`→` for slide navigation. This
// slice renders the stored `.ipynb` (source + any saved outputs); live kernel execution
// (`useJupyterKernel`, `Ctrl/Shift+Enter`) lands in a following slice.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { MarkdownMath } from '../MarkdownMath';
import { useI18n } from '../../i18n';
import { fetchPageNotebook } from '../../lib/api/pdfs';
import {
  cellText,
  clampCellIndex,
  displayOutputs,
  defaultNbNotebook,
  parseNbNotebook,
  type NbCell,
  type NbDisplayOutput,
  type NbNotebook,
} from '../../lib/nbformatModel';

function OutputBlock({ output }: { output: NbDisplayOutput }) {
  switch (output.kind) {
    case 'image':
      return <img src={`data:${output.mimeType};base64,${output.dataBase64}`} alt="" className="max-w-full rounded border border-border" />;
    case 'html':
      // Stored HTML output; rendered inside the sandboxed slide surface. Rich HTML/JS
      // sandboxing (iframe) is a phase-2 refinement — here we show it as escaped text
      // to stay safe until the sandbox lands.
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

function CellBody({ cell }: { cell: NbCell }) {
  const source = cellText(cell);
  if (cell.cell_type === 'markdown') {
    return <MarkdownMath content={source} />;
  }
  const outputs = cell.cell_type === 'code' ? displayOutputs(cell.outputs) : [];
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
  className?: string;
  style?: React.CSSProperties;
}

export function NotebookPanel({ pdfId, pageNumber, shareToken, className, style }: NotebookPanelProps) {
  const { t } = useI18n();
  const [notebook, setNotebook] = useState<NbNotebook | null>(null);
  const [error, setError] = useState(false);
  const [cellIndex, setCellIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setNotebook(null);
    setError(false);
    setCellIndex(0);
    fetchPageNotebook(pdfId, pageNumber, shareToken)
      .then((resp) => {
        if (!cancelled) setNotebook(parseNbNotebook(resp.notebook));
      })
      .catch(() => {
        if (!cancelled) {
          setNotebook(defaultNbNotebook());
          setError(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [pdfId, pageNumber, shareToken]);

  const cells = notebook?.cells ?? [];
  const currentIndex = clampCellIndex(cellIndex, cells.length);
  const currentCell = cells[currentIndex];

  // Command-mode ↑/↓ switch cells; stopPropagation keeps them from bubbling to the
  // global PlayPage handler (which leaves Space/←/→ for slide navigation untouched).
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.stopPropagation();
        e.preventDefault();
        setCellIndex((idx) => clampCellIndex(idx + (e.key === 'ArrowDown' ? 1 : -1), cells.length));
      }
    },
    [cells.length],
  );

  // Reset scroll to the top whenever the visible cell changes.
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

  return (
    <div className={`flex flex-col overflow-hidden rounded-lg border border-slate-800 bg-surface ${className ?? ''}`} style={style}>
      <div
        ref={containerRef}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-3 outline-none focus:ring-1 focus:ring-sky-500/40"
        aria-label={t('play.notebook.ariaLabel')}
      >
        {notebook === null ? (
          <p className="text-xs text-text-muted">{t('play.notebook.loading')}</p>
        ) : cells.length === 0 ? (
          <p className="text-xs text-text-muted">{t('play.notebook.empty')}</p>
        ) : currentCell ? (
          <CellBody cell={currentCell} />
        ) : null}
      </div>
      <div className="flex items-center justify-between border-t border-slate-800 px-3 py-1.5 text-[11px] text-text-muted">
        <span>{error ? t('play.notebook.loadError') : footer}</span>
        <span className="flex items-center gap-2">
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
