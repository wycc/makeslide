import test from 'node:test';
import assert from 'node:assert/strict';
import { animationStepPosition, animationStepTimes, nextAnimationStep, presenterStepAction, prevAnimationStep, slideStepBadgePosition } from './animationSteps';
import type { SlideAnimationSpec } from '../types';

const spec = (starts: Array<[number, string?]>, enabled = true): SlideAnimationSpec =>
  ({
    version: 1,
    enabled,
    effects: starts.map(([start, type], i) => ({
      id: `e${i}`,
      target: 'slide',
      type: (type ?? 'overlay-image') as SlideAnimationSpec['effects'][number]['type'],
      start,
      duration: 0.8,
      ease: 'power1.out',
    })),
  }) as SlideAnimationSpec;

test('animationStepTimes sorts, merges near-simultaneous starts, and ignores pause markers and disabled specs', () => {
  assert.deepEqual(animationStepTimes(spec([[4], [0], [4.1], [9.5]])), [0, 4, 9.5]);
  assert.deepEqual(animationStepTimes(spec([[2], [5, 'pause-playback']])), [2]);
  assert.deepEqual(animationStepTimes(spec([[2]], false)), []);
  assert.deepEqual(animationStepTimes(null), []);
});

test('next / prev step move between neighbouring starts with a small tolerance', () => {
  const steps = [0, 4, 9.5];
  assert.equal(nextAnimationStep(steps, 0), 4);
  assert.equal(nextAnimationStep(steps, 4.02), 9.5, 'sitting on a step (within tolerance) counts as reached');
  assert.equal(nextAnimationStep(steps, 9.5), null, 'past the last step → nothing');
  assert.equal(prevAnimationStep(steps, 9.5), 4);
  assert.equal(prevAnimationStep(steps, 6), 4, 'from between steps, back to the one before');
  assert.equal(prevAnimationStep(steps, 4), 0);
  assert.equal(prevAnimationStep(steps, 0), null, 'at the first step → nothing earlier');
});

test('animationStepPosition counts reached steps', () => {
  const steps = [0, 4, 9.5];
  assert.deepEqual(animationStepPosition(steps, 0), { current: 1, total: 3 });
  assert.deepEqual(animationStepPosition(steps, 5), { current: 2, total: 3 });
  assert.deepEqual(animationStepPosition([], 5), { current: 0, total: 0 });
});

test('presenterStepAction seeks while steps remain and turns the page at the ends', () => {
  const steps = [0, 4, 9.5];
  assert.deepEqual(presenterStepAction(steps, 0, 1), { kind: 'seek', seconds: 4 });
  assert.deepEqual(presenterStepAction(steps, 9.5, 1), { kind: 'page', delta: 1 });
  assert.deepEqual(presenterStepAction(steps, 4, -1), { kind: 'seek', seconds: 0 });
  assert.deepEqual(presenterStepAction(steps, 0, -1), { kind: 'page', delta: -1 });
  assert.deepEqual(presenterStepAction([], 3, 1), { kind: 'page', delta: 1 }, 'no animation → plain page navigation');
});

test('slideStepBadgePosition counts a spec-driven page from its timeline', () => {
  const spec = {
    version: 1,
    enabled: true,
    effects: [
      { id: 'a', target: 'slide', type: 'fade-in', start: 0, duration: 1, ease: 'none' },
      { id: 'b', target: 'slide', type: 'fade-in', start: 4, duration: 1, ease: 'none' },
    ],
  } as unknown as SlideAnimationSpec;
  assert.deepEqual(
    slideStepBadgePosition({ spec, currentTime: 0, stepCount: 0, currentPageStep: undefined }),
    { current: 1, total: 2, kind: 'animation' },
  );
  assert.deepEqual(
    slideStepBadgePosition({ spec, currentTime: 5, stepCount: 0, currentPageStep: undefined }),
    { current: 2, total: 2, kind: 'animation' },
  );
});

test('slideStepBadgePosition counts a pptx-built page from its steps, not its (absent) spec', () => {
  // The case the spec-only badge missed entirely: these pages carry no animation spec at all, so
  // they were reported as having no animation while being revealed in five parts.
  assert.deepEqual(
    slideStepBadgePosition({ spec: null, currentTime: 0, stepCount: 5, currentPageStep: 0 }),
    { current: 1, total: 5, kind: 'build' },
  );
  assert.deepEqual(
    slideStepBadgePosition({ spec: null, currentTime: 0, stepCount: 5, currentPageStep: 4 }),
    { current: 5, total: 5, kind: 'build' },
  );
  // Playback state can arrive before the page's steps do; the badge must not read "0/5" or "6/5".
  assert.deepEqual(
    slideStepBadgePosition({ spec: null, currentTime: 0, stepCount: 5, currentPageStep: undefined }),
    { current: 1, total: 5, kind: 'build' },
  );
  assert.deepEqual(
    slideStepBadgePosition({ spec: null, currentTime: 0, stepCount: 3, currentPageStep: 99 }),
    { current: 3, total: 3, kind: 'build' },
  );
});

test('slideStepBadgePosition prefers page steps over a spec, and stays silent with neither', () => {
  const spec = {
    version: 1,
    enabled: true,
    effects: [{ id: 'a', target: 'slide', type: 'fade-in', start: 0, duration: 1, ease: 'none' }],
  } as unknown as SlideAnimationSpec;
  // Steps decide which layers are on screen at all; a spec would be animating inside one of them.
  assert.deepEqual(
    slideStepBadgePosition({ spec, currentTime: 0, stepCount: 4, currentPageStep: 1 }),
    { current: 2, total: 4, kind: 'build' },
  );
  assert.equal(slideStepBadgePosition({ spec: null, currentTime: 0, stepCount: 0, currentPageStep: undefined }), null);
});
