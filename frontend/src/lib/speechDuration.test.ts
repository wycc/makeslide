import test from 'node:test';
import assert from 'node:assert/strict';

import { estimateSpeechSeconds, DEFAULT_CHARS_PER_SECOND } from './speechDuration';

test('estimates at default 4 chars/sec with rounding', () => {
  assert.equal(estimateSpeechSeconds(0), 0);
  assert.equal(estimateSpeechSeconds(1), 0);   // 0.25 → round 0
  assert.equal(estimateSpeechSeconds(2), 1);   // 0.5 → round 1
  assert.equal(estimateSpeechSeconds(4), 1);
  assert.equal(estimateSpeechSeconds(360), 90); // 360/4 = 90 → 1:30
});

test('DEFAULT_CHARS_PER_SECOND is 4', () => {
  assert.equal(DEFAULT_CHARS_PER_SECOND, 4);
});

test('custom rate is honoured', () => {
  assert.equal(estimateSpeechSeconds(300, 5), 60);
  assert.equal(estimateSpeechSeconds(300, 10), 30);
});

test('non-positive or non-finite rate falls back to default', () => {
  assert.equal(estimateSpeechSeconds(360, 0), 90);
  assert.equal(estimateSpeechSeconds(360, -5), 90);
  assert.equal(estimateSpeechSeconds(360, Number.NaN), 90);
});

test('negative, fractional and non-finite char counts are sanitised', () => {
  assert.equal(estimateSpeechSeconds(-100), 0);
  assert.equal(estimateSpeechSeconds(Number.NaN), 0);
  assert.equal(estimateSpeechSeconds(Number.POSITIVE_INFINITY), 0);
  assert.equal(estimateSpeechSeconds(9.9), 2); // floor 9 → 9/4 = 2.25 → round 2
});
