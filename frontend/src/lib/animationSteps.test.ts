import test from 'node:test';
import assert from 'node:assert/strict';
import { animationStepPosition, animationStepTimes, nextAnimationStep, presenterStepAction, prevAnimationStep } from './animationSteps';
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
