import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateSpeakingSeconds, estimateSpeakingTimeLabel } from './speakingTimeEstimate';

test('estimateSpeakingSeconds uses ~4 chars/second, rounded', () => {
  assert.equal(estimateSpeakingSeconds(240), 60);
  assert.equal(estimateSpeakingSeconds(20), 5);
  assert.equal(estimateSpeakingSeconds(10), 3); // 2.5 -> 3
});

test('estimateSpeakingSeconds returns 0 for non-positive or non-finite input', () => {
  assert.equal(estimateSpeakingSeconds(0), 0);
  assert.equal(estimateSpeakingSeconds(-40), 0);
  assert.equal(estimateSpeakingSeconds(Number.NaN), 0);
});

test('estimateSpeakingTimeLabel formats as m:ss with unpadded minutes', () => {
  assert.equal(estimateSpeakingTimeLabel(240), '1:00'); // 60s
  assert.equal(estimateSpeakingTimeLabel(20), '0:05'); // 5s
  assert.equal(estimateSpeakingTimeLabel(500), '2:05'); // 125s
});

test('estimateSpeakingTimeLabel handles empty input as 0:00', () => {
  assert.equal(estimateSpeakingTimeLabel(0), '0:00');
});
