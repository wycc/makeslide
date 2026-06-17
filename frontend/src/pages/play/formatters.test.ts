import test from 'node:test';
import assert from 'node:assert/strict';

import { formatDurationMs, sumCompletedDurationMs } from './formatters';

test('formatDurationMs formats milliseconds and seconds', () => {
  assert.equal(formatDurationMs(123), '123ms');
  assert.equal(formatDurationMs(1500), '1.5s');
  assert.equal(formatDurationMs(12_345), '12s');
});

test('formatDurationMs returns placeholder for missing or invalid values', () => {
  assert.equal(formatDurationMs(null), '尚無紀錄');
  assert.equal(formatDurationMs(undefined), '尚無紀錄');
  assert.equal(formatDurationMs(Number.NaN), '尚無紀錄');
});

test('sumCompletedDurationMs sums only succeeded finite artifact durations', () => {
  assert.equal(
    sumCompletedDurationMs([
      { status: 'succeeded', duration_ms: 500 },
      { status: 'running', duration_ms: 1000 },
      { status: 'succeeded', duration_ms: 1500 },
      { status: 'failed', duration_ms: 700 },
      { status: 'succeeded', duration_ms: Number.NaN },
    ]),
    2000,
  );
});

test('sumCompletedDurationMs returns null when no completed duration exists', () => {
  assert.equal(
    sumCompletedDurationMs([
      { status: 'running', duration_ms: 500 },
      { status: 'failed', duration_ms: 1000 },
      { status: 'succeeded', duration_ms: null },
      null,
      undefined,
    ]),
    null,
  );
});
