import type { PdfStatus, ProgressStep } from '../types';
import { useI18n } from '../i18n';

interface StatusBadgeProps {
  status: PdfStatus;
  progressStep?: ProgressStep;
  progressCurrent?: number | null;
  progressTotal?: number | null;
}

const STATUS_STYLES: Record<PdfStatus, { labelKey: Parameters<ReturnType<typeof useI18n>['t']>[0]; className: string }> = {
  awaiting_prompt: {
    labelKey: 'status.awaitingPrompt',
    className:
      'bg-slate-900/90 text-sky-200 border border-sky-400/70 backdrop-blur-sm shadow-sm',
  },
  uploaded: {
    labelKey: 'status.uploaded',
    className:
      'bg-slate-900/90 text-slate-100 border border-slate-500/90 backdrop-blur-sm shadow-sm',
  },
  processing: {
    labelKey: 'status.processing',
    className:
      'bg-slate-900/90 text-amber-200 border border-amber-400/70 backdrop-blur-sm shadow-sm',
  },
  awaiting_script_confirmation: {
    labelKey: 'status.awaitingScriptConfirmation',
    className:
      'bg-slate-900/90 text-orange-200 border border-orange-400/70 backdrop-blur-sm shadow-sm',
  },
  ready: {
    labelKey: 'status.ready',
    className:
      'bg-slate-900/90 text-emerald-200 border border-emerald-400/70 backdrop-blur-sm shadow-sm',
  },
  failed: {
    labelKey: 'status.failed',
    className:
      'bg-slate-900/90 text-rose-200 border border-rose-400/70 backdrop-blur-sm shadow-sm',
  },
};

const PROGRESS_LABEL_KEYS: Record<Exclude<ProgressStep, null>, Parameters<ReturnType<typeof useI18n>['t']>[0]> = {
  rendering: 'progress.rendering',
  rendering_video: 'progress.renderingVideo',
  extracting_text: 'progress.extractingText',
  text_extracted: 'progress.textExtracted',
  scripting: 'progress.scripting',
  script_ready: 'progress.scriptReady',
  synthesizing: 'progress.synthesizing',
  downloading_captions: 'progress.downloadingCaptions',
  downloading_audio: 'progress.downloadingAudio',
  transcribing_audio: 'progress.transcribingAudio',
};

export default function StatusBadge({
  status,
  progressStep,
  progressCurrent,
  progressTotal,
}: StatusBadgeProps) {
  const { t } = useI18n();
  const style = STATUS_STYLES[status];
  // When processing, surface the sub-step + per-page counter for clarity.
  let label = t(style.labelKey);
  if (status === 'processing' && progressStep) {
    label = t(PROGRESS_LABEL_KEYS[progressStep] ?? style.labelKey);
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
