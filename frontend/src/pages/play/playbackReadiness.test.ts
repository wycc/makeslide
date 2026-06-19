import test from 'node:test';
import assert from 'node:assert/strict';

import { shouldResolvePageAnimationSpec } from './playbackReadiness';

test('shouldResolvePageAnimationSpec blocks transcript-triggered animation until current page audio metadata is ready', () => {
  assert.equal(
    shouldResolvePageAnimationSpec({
      hasTranscriptStartTrigger: true,
      imageReadyForCurrentPage: true,
      audioMetadataReadyForCurrentPage: false,
      sentenceTimelineLength: 3,
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
    }),
    true,
  );
});

