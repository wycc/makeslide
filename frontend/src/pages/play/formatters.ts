import type { RegenJobStatus, RegenStepStatus } from '../../types';
import type { TranslationKey } from '../../i18n';

export function formatDurationMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '尚無紀錄';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
}

export type RegenerateProgressTranslator = (key: TranslationKey) => string;

export interface RegenSelectedPagesSummaryOptions {
  deckPagesCount: number;
  selectedPages: Iterable<number>;
  t: RegenerateProgressTranslator;
}

export function formatRegenSelectedPagesSummary({
  deckPagesCount,
  selectedPages,
  t,
}: RegenSelectedPagesSummaryOptions): string {
  const pages = Array.from(new Set(selectedPages))
    .filter((page) => Number.isFinite(page))
    .sort((a, b) => a - b);

  if (pages.length === 0) {
    return t('play.regenDialog.summaryAll').replace('{count}', String(deckPagesCount));
  }

  if (pages.length === 1) {
    return t('play.regenDialog.summarySingle').replace('{page}', String(pages[0]));
  }

  return t('play.regenDialog.summarySelected')
    .replace('{count}', String(pages.length))
    .replace('{pages}', pages.join(t('play.regenDialog.pageSeparator')));
}

export function formatRegenerateJobStatus(status: RegenJobStatus, t: RegenerateProgressTranslator): string {
  const statusKey: Record<RegenJobStatus, TranslationKey> = {
    pending: 'play.regenerate.status.pending',
    running: 'play.regenerate.status.running',
    completed: 'play.regenerate.status.completed',
    failed: 'play.regenerate.status.failed',
    cancelling: 'play.regenerate.status.cancelling',
    cancelled: 'play.regenerate.status.cancelled',
  };
  return t(statusKey[status]);
}

export function formatRegenerateStepStatus(
  status: RegenStepStatus,
  t: RegenerateProgressTranslator,
  options: { completed: number; total: number; ratio: number; eta: string | null; error?: string | null },
): string {
  if (status === 'pending') return t('play.regenerate.status.pending');
  if (status === 'failed') {
    return t('play.regenerate.stepFailed').replace('{error}', options.error || t('play.regenerate.unknownError'));
  }
  if (status === 'skipped') return t('play.regenerate.status.skipped');
  if (status === 'cancelled') return t('play.regenerate.status.cancelled');

  const base = t('play.regenerate.stepProgress')
    .replace('{completed}', String(options.completed))
    .replace('{total}', String(options.total))
    .replace('{ratio}', String(options.ratio));
  return options.eta ? `${base} · ${t('play.regenerate.stepEta').replace('{eta}', options.eta)}` : base;
}

export function formatRegenerateEtaSummary(
  t: RegenerateProgressTranslator,
  eta: string | null,
  finishAt: string | null,
): string {
  const remaining = t('play.regenerate.etaRemaining').replace('{eta}', eta ?? t('play.regenerate.calculating'));
  return finishAt ? `${remaining} · ${t('play.regenerate.finishAt').replace('{time}', finishAt)}` : remaining;
}

export function formatRegenerateEta(seconds: number | null | undefined, t: RegenerateProgressTranslator): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return null;
  if (seconds < 60) {
    return t('play.regenerate.eta.seconds').replace('{seconds}', String(Math.ceil(seconds)));
  }
  const minutes = Math.floor(seconds / 60);
  const remainSeconds = Math.ceil(seconds % 60);
  if (minutes < 60) {
    return remainSeconds > 0
      ? t('play.regenerate.eta.minutesSeconds')
          .replace('{minutes}', String(minutes))
          .replace('{seconds}', String(remainSeconds))
      : t('play.regenerate.eta.minutes').replace('{minutes}', String(minutes));
  }
  const hours = Math.floor(minutes / 60);
  const remainMinutes = minutes % 60;
  return remainMinutes > 0
    ? t('play.regenerate.eta.hoursMinutes')
        .replace('{hours}', String(hours))
        .replace('{minutes}', String(remainMinutes))
    : t('play.regenerate.eta.hours').replace('{hours}', String(hours));
}

export function sumCompletedDurationMs(items: Array<{ status: string; duration_ms: number | null | undefined } | null | undefined>): number | null {
  const total = items.reduce((sum, item) => {
    if (item?.status !== 'succeeded') return sum;
    const duration = item.duration_ms;
    if (duration == null || !Number.isFinite(duration)) return sum;
    return sum + duration;
  }, 0);
  return total > 0 ? total : null;
}

export function formatEta(seconds: number | null | undefined): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return null;
  if (seconds < 60) return `約 ${Math.ceil(seconds)} 秒`;
  const minutes = Math.floor(seconds / 60);
  const remainSeconds = Math.ceil(seconds % 60);
  if (minutes < 60) return remainSeconds > 0 ? `約 ${minutes} 分 ${remainSeconds} 秒` : `約 ${minutes} 分`;
  const hours = Math.floor(minutes / 60);
  const remainMinutes = minutes % 60;
  return remainMinutes > 0 ? `約 ${hours} 小時 ${remainMinutes} 分` : `約 ${hours} 小時`;
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(2)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return `${tokens}`;
}

export function formatCostUsd(cost: number | null): string {
  if (cost == null) return '未知';
  if (cost === 0) return '$0';
  if (cost < 0.01) return '<$0.01';
  return `$${cost.toFixed(2)}`;
}
