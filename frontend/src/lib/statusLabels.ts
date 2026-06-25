import type { TranslationKey } from '../i18n';
import type { PdfStatus, ProgressStep } from '../types';

// Single source of truth for translating PDF status / progress-step enum values
// into UI labels. Used by StatusBadge and the PlayPage "generating…" banners so
// both follow the UI language instead of leaking the raw backend enum value
// (e.g. "processing / rendering_video"). Declared as exhaustive Records so adding
// a status/step to the type is a compile error until a label key is provided.

export const PDF_STATUS_LABEL_KEYS: Record<PdfStatus, TranslationKey> = {
  awaiting_prompt: 'status.awaitingPrompt',
  uploaded: 'status.uploaded',
  processing: 'status.processing',
  awaiting_script_confirmation: 'status.awaitingScriptConfirmation',
  ready: 'status.ready',
  failed: 'status.failed',
};

export const PROGRESS_LABEL_KEYS: Record<Exclude<ProgressStep, null>, TranslationKey> = {
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

/**
 * Human-readable "<status> / <step>" label for the generating banners, e.g.
 * "處理中 / 產生影片中". When there is no progress step, just the status label.
 */
export function formatGeneratingStatusLabel(
  status: PdfStatus,
  progressStep: ProgressStep,
  t: (key: TranslationKey) => string,
): string {
  const statusLabel = t(PDF_STATUS_LABEL_KEYS[status]);
  if (!progressStep) return statusLabel;
  return `${statusLabel} / ${t(PROGRESS_LABEL_KEYS[progressStep])}`;
}
