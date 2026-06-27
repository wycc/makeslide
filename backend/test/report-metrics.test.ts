import test from 'node:test';
import assert from 'node:assert/strict';
import { safeRatio, round4, pollDivergence, average, pageDifficultyScore } from '../src/routes/pdfs/reportMetrics';

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

test('average returns the mean, or null for an empty array', () => {
  assert.equal(average([10, 20, 30]), 20);
  assert.equal(average([5]), 5);
  assert.equal(average([]), null);
  assert.equal(average([1, 2]), 1.5);
});

test('pageDifficultyScore averages available signals (completion contributes its incompletion)', () => {
  // all three present: mean(1-0.5, 0.5, 1.0) = mean(0.5, 0.5, 1.0) = 0.6667
  assert.equal(
    round4(pageDifficultyScore({ completionRate: 0.5, pollDivergence: 0.5, questionRate: 1 })!),
    0.6667,
  );
  // a fully-completed page with consensus and no questions is the easiest -> 0
  assert.equal(pageDifficultyScore({ completionRate: 1, pollDivergence: 0, questionRate: 0 }), 0);
  // a never-finished, fully-split, heavily-questioned page is the hardest -> 1
  assert.equal(pageDifficultyScore({ completionRate: 0, pollDivergence: 1, questionRate: 1 }), 1);
});

test('pageDifficultyScore ignores null signals and returns null when none are present', () => {
  // only completion present: difficulty = 1 - 0.8 = 0.2 (round4 to absorb float noise)
  assert.equal(round4(pageDifficultyScore({ completionRate: 0.8, pollDivergence: null, questionRate: null })!), 0.2);
  // only divergence present
  assert.equal(pageDifficultyScore({ completionRate: null, pollDivergence: 0.4, questionRate: null }), 0.4);
  // nothing present (e.g. an unwatched page) -> null, so callers render a blank cell
  assert.equal(pageDifficultyScore({ completionRate: null, pollDivergence: null, questionRate: null }), null);
});

test('pageDifficultyScore clamps out-of-range signals into [0,1]', () => {
  // questionRate above 1 (more questions than viewers) is capped; completion below 0 clamps too
  assert.equal(pageDifficultyScore({ completionRate: 1, pollDivergence: 0, questionRate: 5 }), 1 / 3);
});
