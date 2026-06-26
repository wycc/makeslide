import test from 'node:test';
import assert from 'node:assert/strict';
import { pollOptionPercent } from './pollPercent';

test('pollOptionPercent returns 0 when there are no votes', () => {
  assert.equal(pollOptionPercent(0, 0), 0);
  assert.equal(pollOptionPercent(3, 0), 0);
});

test('pollOptionPercent computes exact divisions', () => {
  assert.equal(pollOptionPercent(3, 4), 75);
  assert.equal(pollOptionPercent(1, 1), 100);
  assert.equal(pollOptionPercent(0, 5), 0);
});

test('pollOptionPercent rounds to the nearest integer', () => {
  assert.equal(pollOptionPercent(1, 3), 33); // 33.33 -> 33
  assert.equal(pollOptionPercent(2, 3), 67); // 66.67 -> 67
  assert.equal(pollOptionPercent(1, 8), 13); // 12.5 -> 13
});

test('pollOptionPercent treats negative totals as no votes', () => {
  assert.equal(pollOptionPercent(2, -1), 0);
});
