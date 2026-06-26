import test from 'node:test';
import assert from 'node:assert/strict';
import { progressPercent } from './progressPercent';

test('progressPercent returns 0 when total is not positive', () => {
  assert.equal(progressPercent(0, 0), 0);
  assert.equal(progressPercent(3, 0), 0);
  assert.equal(progressPercent(1, -2), 0);
});

test('progressPercent computes and rounds the percentage', () => {
  assert.equal(progressPercent(1, 4), 25);
  assert.equal(progressPercent(1, 3), 33); // 33.33 -> 33
  assert.equal(progressPercent(2, 3), 67); // 66.67 -> 67
  assert.equal(progressPercent(1, 8), 13); // 12.5 -> 13
});

test('progressPercent clamps the result into 0..100', () => {
  assert.equal(progressPercent(5, 4), 100); // overflow -> 100
  assert.equal(progressPercent(4, 4), 100);
  assert.equal(progressPercent(-1, 4), 0); // underflow -> 0
});

test('progressPercent sanitizes non-finite input to 0', () => {
  assert.equal(progressPercent(Number.NaN, 4), 0);
  assert.equal(progressPercent(2, Number.NaN), 0);
  assert.equal(progressPercent(2, Number.POSITIVE_INFINITY), 0);
});
