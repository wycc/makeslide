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
  assert.deepEqual(animationStepTimes(spec([[0], [5, 'pause-playback']])), [0]);
  assert.deepEqual(animationStepTimes(spec([[2]], false)), []);
  assert.deepEqual(animationStepTimes(null), []);
});

test('the bare page is a step of its own unless the first effect starts at 0 or with the first sentence', () => {
  // Four effects, none at the start → five steps: the initial state, then one per effect.
  assert.deepEqual(animationStepTimes(spec([[3], [7], [12], [18]])), [0, 3, 7, 12, 18]);
  assert.deepEqual(animationStepTimes(spec([[2], [5, 'pause-playback']])), [0, 2]);
  // An effect already there at second 0 is the initial state itself.
  assert.deepEqual(animationStepTimes(spec([[0], [3], [7], [12]])), [0, 3, 7, 12]);
  assert.deepEqual(animationStepTimes(spec([[0.1], [3]])), [0, 3], 'within the merge window of 0 counts as the start, and the step is the page entry');
  // Whisper timelines often start the first sentence after a short lead-in; an effect anchored to
  // that sentence begins with the narration and is likewise the initial state (step 1 on entry).
  assert.deepEqual(animationStepTimes(spec([[0.6], [3], [7], [12]]), { firstSentenceStart: 0.6 }), [0, 3, 7, 12]);
  assert.deepEqual(animationStepTimes(spec([[0.6], [3]]), { firstSentenceStart: 0 }), [0, 0.6, 3], 'without that anchor 0.6 is a later moment');
  assert.deepEqual(animationStepTimes(spec([[2], [3]]), { firstSentenceStart: 0.6 }), [0, 2, 3]);
  assert.deepEqual(animationStepTimes(spec([[3]], false), { firstSentenceStart: 0.6 }), [], 'a disabled spec still has no steps');
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
  // Four mid-page effects: the badge reads 1/5 on the bare page, 5/5 once the last one has appeared.
  const fiveSteps = animationStepTimes(spec([[3], [7], [12], [18]]));
  assert.deepEqual(animationStepPosition(fiveSteps, 0), { current: 1, total: 5 });
  assert.deepEqual(animationStepPosition(fiveSteps, 18), { current: 5, total: 5 });
  assert.deepEqual(presenterStepAction(fiveSteps, 0, 1), { kind: 'seek', seconds: 3 }, 'Next from the bare page reveals the first effect');
  assert.deepEqual(presenterStepAction(fiveSteps, 3, -1), { kind: 'seek', seconds: 0 }, 'Previous from the first effect returns to the bare page');
  assert.deepEqual(presenterStepAction(fiveSteps, 0, -1), { kind: 'page', delta: -1 }, 'Previous on the bare page turns the page back');
});

test('presenterStepAction seeks while steps remain and turns the page at the ends', () => {
  const steps = [0, 4, 9.5];
  assert.deepEqual(presenterStepAction(steps, 0, 1), { kind: 'seek', seconds: 4 });
  assert.deepEqual(presenterStepAction(steps, 9.5, 1), { kind: 'page', delta: 1 });
  assert.deepEqual(presenterStepAction(steps, 4, -1), { kind: 'seek', seconds: 0 });
  assert.deepEqual(presenterStepAction(steps, 0, -1), { kind: 'page', delta: -1 });
  assert.deepEqual(presenterStepAction([], 3, 1), { kind: 'page', delta: 1 }, 'no animation → plain page navigation');
});
