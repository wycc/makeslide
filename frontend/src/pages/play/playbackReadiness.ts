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
 * Whether the slide's own timeline is advancing: the audio is playing, or the audio has finished
 * and the extension timer is driving the rest of a longer animation. This is what the renderer
 * needs — it decides whether the GSAP timeline runs, and the timeline must not run itself forward
 * while `currentTime` is standing still.
 */
export function isSlidePlaybackActive(input: { isPlaying: boolean; isExtendingAnimation: boolean }): boolean {
  return input.isPlaying || input.isExtendingAnimation;
}

/**
 * Whether the viewer is still watching something move — which outlives the timeline above.
 *
 * Both of the page's clocks end at the animation's nominal `duration`: the extension timer for a
 * page with narration, `startAnimationOnlyTimer` for one without. An interactive animation runs on
 * its own clock for as long as the viewer takes, so it is still animating after both have stopped
 * and `isPlaying` is false. Reporting "paused" then contradicts the screen, which is exactly what
 * a user saw: the pause indicator appearing halfway through an animation.
 *
 * Kept separate from `isSlidePlaybackActive` on purpose — during an interaction the slide timeline
 * really is stopped, so only the *indicators* may treat this as playing.
 */
export function isPlaybackIndicatorActive(input: {
  isPlaying: boolean;
  isExtendingAnimation: boolean;
  interactiveAnimationHoldingInput: boolean;
}): boolean {
  return isSlidePlaybackActive(input) || input.interactiveAnimationHoldingInput;
}

