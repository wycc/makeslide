import type { AudioProgressItem } from './api/pdfs';

export interface AudioProgressView {
  /** 0–100. Held below 100 while running: an estimate that runs out is not a finished voice. */
  percent: number;
  elapsedSeconds: number;
  /** Seconds left by the estimate; null once the estimate has run out. */
  remainingSeconds: number | null;
  overdue: boolean;
}

const RUNNING_CEILING = 95;

/**
 * Where one synthesis is, by time. The server cannot see inside a TTS call, so this is elapsed time
 * against its estimate — which starts from the rate learned on earlier syntheses and, on a page
 * split into segments, is re-measured from this page's own pace as segments finish (so the
 * remaining time and the bar agree; see backend/src/services/audioProgress.ts). The finished
 * segments also put a floor under the percentage.
 */
export function describeAudioProgress(item: AudioProgressItem, nowMs: number): AudioProgressView {
  const started = Date.parse(item.started_at);
  const elapsedSeconds = Number.isFinite(started) ? Math.max(0, (nowMs - started) / 1000) : 0;
  const estimate = item.estimated_seconds > 0 ? item.estimated_seconds : 1;
  const byTime = (elapsedSeconds / estimate) * 100;
  const bySegments = item.segments_total > 1 ? (item.segments_done / item.segments_total) * 100 : 0;
  const percent = Math.min(RUNNING_CEILING, Math.max(byTime, bySegments));
  const overdue = elapsedSeconds > estimate;
  return {
    percent: Math.round(percent),
    elapsedSeconds: Math.round(elapsedSeconds),
    remainingSeconds: overdue ? null : Math.max(1, Math.round(estimate - elapsedSeconds)),
    overdue,
  };
}

/** The entries one place cares about: a page (optionally one step of it), or the whole deck. */
export function filterAudioProgress(
  items: AudioProgressItem[],
  scope: { page?: number | null; step?: number | null } = {},
): AudioProgressItem[] {
  return items.filter((item) => {
    if (scope.page != null && item.page !== scope.page) return false;
    if (scope.step !== undefined && item.step !== scope.step) return false;
    return true;
  });
}
