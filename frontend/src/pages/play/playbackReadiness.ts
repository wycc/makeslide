export interface PageAnimationReadinessInput {
  hasTranscriptStartTrigger: boolean;
  imageReadyForCurrentPage: boolean;
  audioMetadataReadyForCurrentPage: boolean;
  sentenceTimelineLength: number;
}

/**
 * Decide whether the currently rendered page has enough page-bound assets to build its animation spec.
 *
 * Transcript-triggered effects must wait for audio metadata that is known to belong to the current page;
 * otherwise a freshly selected page can combine its transcript with the previous page's duration for one
 * render and produce a non-empty but wrong sentence timeline.
 */
export function shouldResolvePageAnimationSpec(input: PageAnimationReadinessInput): boolean {
  if (!input.imageReadyForCurrentPage) return false;
  if (!input.hasTranscriptStartTrigger) return true;
  return input.audioMetadataReadyForCurrentPage && input.sentenceTimelineLength > 0;
}

