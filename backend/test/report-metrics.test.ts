import test from 'node:test';
import assert from 'node:assert/strict';
import { safeRatio, round4, pollDivergence } from '../src/routes/pdfs/reportMetrics';

test('safeRatio divides normally', () => {
  assert.equal(safeRatio(3, 4), 0.75);
  assert.equal(safeRatio(0, 5), 0);
  assert.equal(safeRatio(5, 5), 1);
});

test('safeRatio returns 0 for non-positive denominators', () => {
  assert.equal(safeRatio(3, 0), 0);
  assert.equal(safeRatio(3, -2), 0);
});

test('round4 rounds to four decimal places', () => {
  assert.equal(round4(0.123456), 0.1235);
  assert.equal(round4(1 / 3), 0.3333);
  assert.equal(round4(2), 2);
});

test('pollDivergence is 0 at full consensus and rises as votes split', () => {
  // all votes on the top option → consensus → 0
  assert.equal(pollDivergence(10, 10), 0);
  // top option got half → divergence 0.5
  assert.equal(pollDivergence(5, 10), 0.5);
  // no votes → 0 (no division by zero)
  assert.equal(pollDivergence(0, 0), 0);
});
