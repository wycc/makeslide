import type { PdfDetailPage, PdfDetailPageTimingItem } from '../../types';
import { formatDurationMs } from './formatters';

function timingChipClass(timing: PdfDetailPageTimingItem | null): string {
  if (!timing) return 'border-slate-700 bg-slate-800/50 text-slate-400';
  if (timing.status === 'running') return 'border-cyan-500/40 bg-cyan-500/10 text-cyan-200';
  if (timing.status === 'failed') return 'border-rose-500/40 bg-rose-500/10 text-rose-200';
  if (timing.sla_status === 'breached') return 'border-rose-500/40 bg-rose-500/10 text-rose-200';
  if (timing.sla_status === 'warning') return 'border-amber-500/40 bg-amber-500/10 text-amber-200';
  if (timing.sla_status === 'met') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200';
  return 'border-slate-700 bg-slate-800/50 text-slate-300';
}

function timingTitle(label: string, timing: PdfDetailPageTimingItem | null): string {
  if (!timing) return `${label}：尚無紀錄`;
  return [
    `${label}：${timing.status}`,
    `耗時：${formatDurationMs(timing.duration_ms)}`,
    timing.reason ? `原因：${timing.reason}` : null,
    timing.sla_target_ms != null ? `SLA：${formatDurationMs(timing.sla_target_ms)} / ${timing.sla_status}` : `SLA：${timing.sla_status}`,
    timing.started_at ? `開始：${timing.started_at}` : null,
    timing.ended_at ? `結束：${timing.ended_at}` : null,
    timing.run_id ? `run：${timing.run_id}${timing.attempt ? ` #${timing.attempt}` : ''}` : null,
    timing.error_message ? `錯誤：${timing.error_message}` : null,
  ].filter(Boolean).join('\n');
}

export function PageTimingChips({ page }: { page: PdfDetailPage | null | undefined }) {
  const timings = page?.timings ?? null;
  const items: Array<[keyof NonNullable<PdfDetailPage['timings']>, string]> = [
    ['image', '圖片'],
    ['text', '文字'],
    ['script', '講稿'],
    ['audio', '語音'],
  ];
  return (
    <div className="mb-3 rounded-md border border-slate-800 bg-slate-900/40 px-3 py-2">
      <div className="mb-1 text-xs font-medium text-slate-400">本頁產生耗時</div>
      <div className="flex flex-wrap gap-2">
        {items.map(([key, label]) => {
          const timing = timings?.[key] ?? null;
          const value = timing?.status === 'running' ? '產生中' : formatDurationMs(timing?.duration_ms);
          return (
            <span
              key={key}
              className={`rounded-full border px-2 py-1 text-xs ${timingChipClass(timing)}`}
              title={timingTitle(label, timing)}
            >
              {label} {value}
            </span>
          );
        })}
      </div>
    </div>
  );
}
