import test from 'node:test';
import assert from 'node:assert/strict';
import { bytesToRoundedKb } from './bytesFreed';

test('bytesToRoundedKb converts exact kilobytes', () => {
  assert.equal(bytesToRoundedKb(0), 0);
  assert.equal(bytesToRoundedKb(1024), 1);
  assert.equal(bytesToRoundedKb(2048), 2);
  assert.equal(bytesToRoundedKb(1024 * 1500), 1500);
});

test('bytesToRoundedKb rounds to the nearest kilobyte', () => {
  assert.equal(bytesToRoundedKb(1536), 2); // 1.5 -> 2
  assert.equal(bytesToRoundedKb(1500), 1); // 1.46 -> 1
  assert.equal(bytesToRoundedKb(512), 1); // 0.5 -> 1
  assert.equal(bytesToRoundedKb(400), 0); // 0.39 -> 0 (與原內嵌行為一致)
});

test('bytesToRoundedKb sanitizes non-finite and negative input to 0', () => {
  assert.equal(bytesToRoundedKb(Number.NaN), 0);
  assert.equal(bytesToRoundedKb(Number.POSITIVE_INFINITY), 0);
  assert.equal(bytesToRoundedKb(Number.NEGATIVE_INFINITY), 0);
  assert.equal(bytesToRoundedKb(-1024), 0);
});
