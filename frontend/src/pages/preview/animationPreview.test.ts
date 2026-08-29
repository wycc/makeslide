import test from 'node:test';
import assert from 'node:assert/strict';

import { previewClockAt, previewDurationSeconds, specForSingleEffect } from './animationPreview';
import type { SlideAnimationSpec } from '../../types';

const spec: SlideAnimationSpec = {
  version: 1,
  enabled: true,
  effects: [
    { id: 'a', target: 'slide', type: 'highlight-box', start: 0, duration: 2, ease: 'none' },
    { id: 'b', target: 'slide', type: 'text-callout', start: 8, duration: 1.5, ease: 'none', exitDuration: 2 },
  ],
};

test('specForSingleEffect keeps only the named effect, at its original start', () => {
  const only = specForSingleEffect(spec, 'b');
  assert.equal(only!.effects.length, 1);
  assert.equal(only!.effects[0]!.id, 'b');
  // Moving it to 0 would hide the timing behaviour someone came to debug.
  assert.equal(only!.effects[0]!.start, 8);
});

test('specForSingleEffect enables the spec, so a disabled page can still be inspected', () => {
  const only = specForSingleEffect({ ...spec, enabled: false }, 'a');
  assert.equal(only!.enabled, true);
});

test('specForSingleEffect passes the spec through when no effect is named', () => {
  assert.equal(specForSingleEffect(spec, null), spec);
  assert.equal(specForSingleEffect(null, 'a'), null);
});

test('an unknown effect id is null, not an empty spec', () => {
  // An empty slide looks exactly like a broken animation; the caller says "no such effect" instead.
  assert.equal(specForSingleEffect(spec, 'nope'), null);
});

test('previewDurationSeconds spans to the last effect, exit included', () => {
  assert.equal(previewDurationSeconds(spec), 11.5);
  assert.equal(previewDurationSeconds(specForSingleEffect(spec, 'a')), 2);
  assert.equal(previewDurationSeconds(null), 0);
  assert.equal(previewDurationSeconds({ ...spec, enabled: false }), 0);
});

test('previewClockAt advances, then holds the final frame', () => {
  assert.deepEqual(previewClockAt(0, 10, false), { time: 0, finished: false });
  assert.deepEqual(previewClockAt(4.5, 10, false), { time: 4.5, finished: false });
  // Holding at the end, rather than resetting, is the frame a screenshot should capture.
  assert.deepEqual(previewClockAt(12, 10, false), { time: 10, finished: true });
});

test('previewClockAt wraps when looping', () => {
  assert.deepEqual(previewClockAt(12, 10, true), { time: 2, finished: false });
  assert.deepEqual(previewClockAt(30, 10, true), { time: 0, finished: false });
});

test('previewClockAt survives a page with nothing to play', () => {
  // duration 0 would otherwise divide by zero and hand GSAP a NaN, which renders as a blank stage.
  assert.deepEqual(previewClockAt(5, 0, true), { time: 0, finished: true });
  assert.deepEqual(previewClockAt(5, 0, false), { time: 0, finished: true });
});
