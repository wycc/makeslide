import test from 'node:test';
import assert from 'node:assert/strict';
import { explicitScoreSum } from '../src/routes/pdfs/quizzes';

// explicitScoreSum backs the server-authoritative "custom scores must not exceed
// the 100-point pool" validation in POST /quizzes. Only finite, non-negative
// scores count; anything else (null/undefined/negative/NaN/Infinity) is 0.

test('sums explicit non-negative finite scores', () => {
  assert.equal(explicitScoreSum([{ score: 30 }, { score: 20 }, { score: 50 }]), 100);
});

test('treats missing/null scores as 0', () => {
  assert.equal(explicitScoreSum([{ score: 40 }, {}, { score: null }]), 40);
});

test('treats negative, NaN and Infinity scores as 0', () => {
  assert.equal(explicitScoreSum([{ score: -10 }, { score: Number.NaN }, { score: Infinity }, { score: 25 }]), 25);
});

test('returns 0 for an empty question list', () => {
  assert.equal(explicitScoreSum([]), 0);
});

test('detects a sum above the 100-point pool', () => {
  assert.ok(explicitScoreSum([{ score: 80 }, { score: 80 }]) > 100);
});
