export const PDF_STATUSES = [
  'awaiting_prompt',
  'uploaded',
  'processing',
  'awaiting_script_confirmation',
  'ready',
  'failed',
] as const;

export type PdfStatus = (typeof PDF_STATUSES)[number];

export const PAGE_STATUSES = [
  'pending',
  'rendered',
  'text_ready',
  'script_ready',
  'audio_ready',
  'failed',
] as const;

export type PageStatus = (typeof PAGE_STATUSES)[number];

export const PROGRESS_STEPS = [
  'rendering',
  'extracting_text',
  'text_extracted',
  'scripting',
  'script_ready',
  'synthesizing',
  'rendering_video',
] as const;

export type ProgressStep = null | (typeof PROGRESS_STEPS)[number];

const PDF_TRANSITIONS = {
  awaiting_prompt: ['uploaded', 'failed'],
  uploaded: ['processing', 'failed'],
  processing: ['awaiting_script_confirmation', 'ready', 'failed'],
  awaiting_script_confirmation: ['processing', 'ready', 'failed'],
  ready: ['processing', 'failed'],
  failed: ['uploaded', 'processing'],
} as const satisfies Record<PdfStatus, readonly PdfStatus[]>;

const PAGE_TRANSITIONS = {
  pending: ['rendered', 'text_ready', 'script_ready', 'audio_ready', 'failed'],
  rendered: ['text_ready', 'script_ready', 'audio_ready', 'failed'],
  text_ready: ['script_ready', 'audio_ready', 'failed'],
  script_ready: ['audio_ready', 'failed'],
  audio_ready: ['script_ready', 'audio_ready', 'failed'],
  failed: ['pending', 'rendered', 'text_ready', 'script_ready', 'audio_ready'],
} as const satisfies Record<PageStatus, readonly PageStatus[]>;

export function isPdfStatus(value: unknown): value is PdfStatus {
  return typeof value === 'string' && (PDF_STATUSES as readonly string[]).includes(value);
}

export function isPageStatus(value: unknown): value is PageStatus {
  return typeof value === 'string' && (PAGE_STATUSES as readonly string[]).includes(value);
}

export function isProgressStep(value: unknown): value is ProgressStep {
  return value === null || (typeof value === 'string' && (PROGRESS_STEPS as readonly string[]).includes(value));
}

export function canTransitionPdfStatus(from: PdfStatus, to: PdfStatus): boolean {
  return from === to || PDF_TRANSITIONS[from].includes(to as never);
}

export function canTransitionPageStatus(from: PageStatus, to: PageStatus): boolean {
  return from === to || PAGE_TRANSITIONS[from].includes(to as never);
}

export function assertPdfStatusTransition(from: PdfStatus, to: PdfStatus): void {
  if (!canTransitionPdfStatus(from, to)) {
    throw new Error(`Invalid PDF status transition: ${from} -> ${to}`);
  }
}

export function assertPageStatusTransition(from: PageStatus, to: PageStatus): void {
  if (!canTransitionPageStatus(from, to)) {
    throw new Error(`Invalid page status transition: ${from} -> ${to}`);
  }
}
