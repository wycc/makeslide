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

/**
 * Whether the slide is still playing *as the viewer sees it*, which is not the same question as
 * whether the audio is playing.
 *
 * A page lasts `max(narration, animation timeline)`. When the animation is the longer of the two,
 * `handleEnded` sets `isPlaying` to false the moment the audio ends and hands the rest of the page
 * to the extension timer — the slide keeps animating. Anything the viewer reads as playback state
 * (the play/pause button, the "paused" badge) has to use this, or it announces a pause while the
 * slide is visibly still moving.
 */
export function isSlidePlaybackActive(input: { isPlaying: boolean; isExtendingAnimation: boolean }): boolean {
  return input.isPlaying || input.isExtendingAnimation;
}

