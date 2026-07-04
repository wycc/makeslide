import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  initialHeadDetectionState,
  updateHeadDetectionState,
  type HeadDetectionState,
} from './headDetectionPrompt';

// Feed a sequence of detection results (true = head detected) through the reducer.
function run(results: boolean[], missThreshold: number, start = initialHeadDetectionState): HeadDetectionState {
  return results.reduce((s, detected) => updateHeadDetectionState(s, detected, missThreshold), start);
}

test('does not prompt before missThreshold consecutive misses', () => {
  const s = run([false, false], 3);
  assert.equal(s.consecutiveMisses, 2);
  assert.equal(s.prompting, false);
});

test('prompts exactly when misses reach the threshold', () => {
  const s = run([false, false, false], 3);
  assert.equal(s.consecutiveMisses, 3);
  assert.equal(s.prompting, true);
});

test('a single detected frame does not trip the prompt (debounce against flicker)', () => {
  // miss, miss, DETECT, miss — counter resets on detect, so only 1 miss after.
  const s = run([false, false, true, false], 3);
  assert.equal(s.consecutiveMisses, 1);
  assert.equal(s.prompting, false);
});

test('detecting a head clears an active prompt immediately and resets misses', () => {
  const prompted = run([false, false, false], 2);
  assert.equal(prompted.prompting, true);
  const recovered = updateHeadDetectionState(prompted, true, 2);
  assert.deepEqual(recovered, { consecutiveMisses: 0, prompting: false });
});

test('prompt stays on across further misses until a head is detected', () => {
  const s = run([false, false, false, false, false], 2);
  assert.equal(s.prompting, true);
  assert.equal(s.consecutiveMisses, 5);
});

test('missThreshold is clamped to at least 1', () => {
  assert.equal(run([false], 0).prompting, true);
  assert.equal(run([false], -5).prompting, true);
});

test('non-integer thresholds floor down', () => {
  // threshold 2.9 -> 2; two misses should prompt.
  assert.equal(run([false, false], 2.9).prompting, true);
  assert.equal(run([false], 2.9).prompting, false);
});

test('returns the same object reference when a detect is a no-op', () => {
  const s = updateHeadDetectionState(initialHeadDetectionState, true, 3);
  assert.equal(s, initialHeadDetectionState);
});
