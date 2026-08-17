import test from 'node:test';
import assert from 'node:assert/strict';

import { isPlaybackIndicatorActive, isSlidePlaybackActive, shouldResolvePageAnimationSpec } from './playbackReadiness';

test('shouldResolvePageAnimationSpec blocks transcript-triggered animation until current page audio metadata is ready', () => {
  assert.equal(
    shouldResolvePageAnimationSpec({
      hasTranscriptStartTrigger: true,
      imageReadyForCurrentPage: true,
      audioMetadataReadyForCurrentPage: false,
      sentenceTimelineLength: 3,
      hasPlayableAudio: true,
    }),
    false,
  );
});

test('shouldResolvePageAnimationSpec allows transcript-triggered animation only after image and current audio timeline are ready', () => {
  assert.equal(
    shouldResolvePageAnimationSpec({
      hasTranscriptStartTrigger: true,
      imageReadyForCurrentPage: true,
      audioMetadataReadyForCurrentPage: true,
      sentenceTimelineLength: 2,
      hasPlayableAudio: true,
    }),
    true,
  );
});

test('shouldResolvePageAnimationSpec blocks all animation while the current page image is not ready', () => {
  assert.equal(
    shouldResolvePageAnimationSpec({
      hasTranscriptStartTrigger: false,
      imageReadyForCurrentPage: false,
      audioMetadataReadyForCurrentPage: true,
      sentenceTimelineLength: 0,
      hasPlayableAudio: true,
    }),
    false,
  );
});

test('shouldResolvePageAnimationSpec does not require audio metadata when spec has no transcript trigger', () => {
  assert.equal(
    shouldResolvePageAnimationSpec({
      hasTranscriptStartTrigger: false,
      imageReadyForCurrentPage: true,
      audioMetadataReadyForCurrentPage: false,
      sentenceTimelineLength: 0,
      hasPlayableAudio: true,
    }),
    true,
  );
});


test("isSlidePlaybackActive stays true while the animation outlives the narration", () => {
  // The reported symptom: the audio ends, `handleEnded` sets isPlaying=false and hands the rest of
  // the page to the extension timer — and a "paused" badge appeared over a slide that was still
  // animating. Playback state as the viewer sees it is the union of the two.
  assert.equal(isSlidePlaybackActive({ isPlaying: true, isExtendingAnimation: false }), true);
  assert.equal(isSlidePlaybackActive({ isPlaying: false, isExtendingAnimation: true }), true);
  assert.equal(isSlidePlaybackActive({ isPlaying: false, isExtendingAnimation: false }), false);
});

test("isPlaybackIndicatorActive keeps reporting playback while an interactive animation runs on", () => {
  // Both of the page's clocks stop at the animation's nominal duration — the extension timer with
  // narration, startAnimationOnlyTimer without it. An interactive animation runs past that on its
  // own clock, and the reported symptom was the pause indicator appearing while it was still going.
  const holding = { isPlaying: false, isExtendingAnimation: false, interactiveAnimationHoldingInput: true };
  assert.equal(isPlaybackIndicatorActive(holding), true);
  // The slide timeline itself really is stopped then: only the indicators may say "playing".
  assert.equal(isSlidePlaybackActive(holding), false);
  assert.equal(
    isPlaybackIndicatorActive({ isPlaying: false, isExtendingAnimation: false, interactiveAnimationHoldingInput: false }),
    false,
  );
});

test('a page with no narration resolves its animation instead of waiting forever', () => {
  // The deadlock this guards: no audio means no audio metadata, so `duration` is derived from the
  // animation's length — which comes from the resolved spec, which is what this gate decides to
  // resolve. Transcript-anchored effects (everything the AI generator makes) never appeared at all.
  assert.equal(
    shouldResolvePageAnimationSpec({
      hasTranscriptStartTrigger: true,
      imageReadyForCurrentPage: true,
      audioMetadataReadyForCurrentPage: false,
      sentenceTimelineLength: 0,
      hasPlayableAudio: false,
    }),
    true,
  );
});

test('a page that does have narration still waits for its own audio metadata', () => {
  // The original reason for the gate: mid-page-change the previous page's duration is still in
  // hand, and resolving against it anchors every effect to the wrong sentence.
  assert.equal(
    shouldResolvePageAnimationSpec({
      hasTranscriptStartTrigger: true,
      imageReadyForCurrentPage: true,
      audioMetadataReadyForCurrentPage: false,
      sentenceTimelineLength: 3,
      hasPlayableAudio: true,
    }),
    false,
  );
});

test('the image still gates resolution even without narration', () => {
  assert.equal(
    shouldResolvePageAnimationSpec({
      hasTranscriptStartTrigger: true,
      imageReadyForCurrentPage: false,
      audioMetadataReadyForCurrentPage: false,
      sentenceTimelineLength: 0,
      hasPlayableAudio: false,
    }),
    false,
  );
});
