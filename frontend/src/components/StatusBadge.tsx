import type { PdfStatus, ProgressStep } from '../types';
import { useI18n } from '../i18n';
import { PDF_STATUS_LABEL_KEYS, PROGRESS_LABEL_KEYS } from '../lib/statusLabels';

interface StatusBadgeProps {
  status: PdfStatus;
  progressStep?: ProgressStep;
  progressCurrent?: number | null;
  progressTotal?: number | null;
}

const STATUS_CLASS_NAMES: Record<PdfStatus, string> = {
  awaiting_prompt: 'bg-slate-900/90 text-sky-200 border border-sky-400/70 backdrop-blur-sm shadow-sm',
  uploaded: 'bg-slate-900/90 text-slate-100 border border-slate-500/90 backdrop-blur-sm shadow-sm',
  processing: 'bg-slate-900/90 text-amber-200 border border-amber-400/70 backdrop-blur-sm shadow-sm',
  awaiting_script_confirmation: 'bg-slate-900/90 text-orange-200 border border-orange-400/70 backdrop-blur-sm shadow-sm',
  ready: 'bg-slate-900/90 text-emerald-200 border border-emerald-400/70 backdrop-blur-sm shadow-sm',
  failed: 'bg-slate-900/90 text-rose-200 border border-rose-400/70 backdrop-blur-sm shadow-sm',
};

export default function StatusBadge({
  status,
  progressStep,
  progressCurrent,
  progressTotal,
}: StatusBadgeProps) {
  const { t } = useI18n();
  const className = STATUS_CLASS_NAMES[status];
  // When processing, surface the sub-step + per-page counter for clarity.
  let label = t(PDF_STATUS_LABEL_KEYS[status]);
  if (status === 'processing' && progressStep) {
    label = t(PROGRESS_LABEL_KEYS[progressStep] ?? PDF_STATUS_LABEL_KEYS[status]);
  }
  const titleExtra =
    progressTotal && progressTotal > 0
      ? ` (${progressCurrent ?? 0}/${progressTotal})`
      : '';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${className}`}
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
