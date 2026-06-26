import test from 'node:test';
import assert from 'node:assert/strict';

import { sumAudioDurationSeconds } from '../src/worker/audioDurationSum';

test('sumAudioDurationSeconds returns null when no usable durations are present', () => {
  assert.equal(sumAudioDurationSeconds([]), null);
  assert.equal(sumAudioDurationSeconds([null, undefined]), null);
  assert.equal(sumAudioDurationSeconds([0, -3, Number.NaN, Number.POSITIVE_INFINITY]), null);
});

test('sumAudioDurationSeconds adds only finite positive values', () => {
  assert.equal(sumAudioDurationSeconds([1.5, null, 2.5, undefined, -1, 0]), 4);
});

test('sumAudioDurationSeconds rounds the total to millisecond precision', () => {
  // 0.1 + 0.2 = 0.30000000000000004 in floating point → rounded to 0.3
  assert.equal(sumAudioDurationSeconds([0.1, 0.2]), 0.3);
});
