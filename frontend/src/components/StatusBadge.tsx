import type { PdfStatus, ProgressStep } from '../types';

interface StatusBadgeProps {
  status: PdfStatus;
  progressStep?: ProgressStep;
  progressCurrent?: number | null;
  progressTotal?: number | null;
}

const STATUS_STYLES: Record<PdfStatus, { label: string; className: string }> = {
  awaiting_prompt: {
    label: '待輸入提示詞',
    className:
      'bg-slate-900/90 text-sky-200 border border-sky-400/70 backdrop-blur-sm shadow-sm',
  },
  uploaded: {
    label: '排隊中',
    className:
      'bg-slate-900/90 text-slate-100 border border-slate-500/90 backdrop-blur-sm shadow-sm',
  },
  processing: {
    label: '處理中',
    className:
      'bg-slate-900/90 text-amber-200 border border-amber-400/70 backdrop-blur-sm shadow-sm',
  },
  awaiting_script_confirmation: {
    label: '待確認逐字稿',
    className:
      'bg-slate-900/90 text-orange-200 border border-orange-400/70 backdrop-blur-sm shadow-sm',
  },
  ready: {
    label: '已完成',
    className:
      'bg-slate-900/90 text-emerald-200 border border-emerald-400/70 backdrop-blur-sm shadow-sm',
  },
  failed: {
    label: '失敗',
    className:
      'bg-slate-900/90 text-rose-200 border border-rose-400/70 backdrop-blur-sm shadow-sm',
  },
};

const PROGRESS_LABELS: Record<Exclude<ProgressStep, null>, string> = {
  rendering: '產生投影片圖片',
  extracting_text: '抽取文字',
  text_extracted: '文字已抽取',
  scripting: '產生逐字稿',
  script_ready: '逐字稿完成',
  synthesizing: '合成語音',
};

export default function StatusBadge({
  status,
  progressStep,
  progressCurrent,
  progressTotal,
}: StatusBadgeProps) {
  const style = STATUS_STYLES[status];
  // When processing, surface the sub-step + per-page counter for clarity.
  let label = style.label;
  if (status === 'processing' && progressStep) {
    const stepLabel = PROGRESS_LABELS[progressStep] ?? style.label;
    label = stepLabel;
  }
  const titleExtra =
    progressTotal && progressTotal > 0
      ? ` (${progressCurrent ?? 0}/${progressTotal})`
      : '';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${style.className}`}
      title={
        progressStep
          ? `status=${status} / ${progressStep}${titleExtra}`
          : `status=${status}`
      }
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
      {label}
    </span>
  );
}
