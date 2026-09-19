import { useEffect, useState } from 'react';
import { fetchAudioProgress, type AudioProgressItem } from '../lib/api/pdfs';
import { describeAudioProgress, filterAudioProgress } from '../lib/audioProgress';
import { useI18n } from '../i18n';

const POLL_MS = 1000;

/**
 * Polls the speech being synthesized for a deck while `active`. The server's clock comes with each
 * answer, so elapsed time is measured on the clock that stamped `started_at`.
 */
export function useAudioProgress(pdfId: string | null | undefined, active: boolean) {
  const [state, setState] = useState<{ items: AudioProgressItem[]; offsetMs: number } | null>(null);
  useEffect(() => {
    if (!pdfId || !active) {
      setState(null);
      return;
    }
    let stopped = false;
    const tick = async () => {
      try {
        const res = await fetchAudioProgress(pdfId);
        if (!stopped) setState({ items: res.items, offsetMs: Date.parse(res.now) - Date.now() });
      } catch {
        // A failed poll is not a failed synthesis; the next tick tries again.
      }
    };
    void tick();
    const handle = window.setInterval(() => void tick(), POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(handle);
    };
  }, [pdfId, active]);
  return state;
}

/**
 * Progress of the voices being made for one place: a page, one step of it, or (no page) the deck.
 * Renders nothing while nothing matching is being synthesized — the caller's own busy label covers
 * the moments before the server starts and after it finishes.
 */
export function AudioProgress({
  pdfId,
  active,
  page,
  step,
  className,
}: {
  pdfId: string | null | undefined;
  active: boolean;
  page?: number | null;
  step?: number | null;
  className?: string;
}) {
  const { t } = useI18n();
  const state = useAudioProgress(pdfId, active);
  if (!active || !state) return null;
  const items = filterAudioProgress(state.items, { page, step });
  if (items.length === 0) return null;
  const nowMs = Date.now() + state.offsetMs;
  return (
    <div className={`space-y-1.5 text-xs ${className ?? ''}`} role="status" aria-live="polite">
      {items.map((item) => {
        const view = describeAudioProgress(item, nowMs);
        const label = item.step != null
          ? t('audioProgress.labelStep').replace('{page}', String(item.page)).replace('{step}', String(item.step + 1))
          : t('audioProgress.labelPage').replace('{page}', String(item.page));
        const segments = item.segments_total > 1
          ? t('audioProgress.segments')
            .replace('{done}', String(Math.min(item.segments_done + 1, item.segments_total)))
            .replace('{total}', String(item.segments_total))
          : null;
        const timing = view.overdue
          ? t('audioProgress.overdue').replace('{elapsed}', String(view.elapsedSeconds))
          : t('audioProgress.remaining')
            .replace('{elapsed}', String(view.elapsedSeconds))
            .replace('{remaining}', String(view.remainingSeconds ?? 0));
        return (
          <div key={`${item.page}-${item.step ?? 'p'}-${item.started_at}`}>
            <div className="flex items-center justify-between gap-2 opacity-90">
              <span>
                {label}
                {segments ? ` · ${segments}` : ''}
              </span>
              <span className="tabular-nums opacity-80">{timing}</span>
            </div>
            <div
              className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-500/25"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={view.percent}
            >
              <div
                className={`h-full rounded-full transition-all duration-700 ${view.overdue ? 'animate-pulse bg-amber-500' : 'bg-cyan-500'}`}
                style={{ width: `${view.percent}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
