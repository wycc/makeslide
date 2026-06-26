import test from 'node:test';
import assert from 'node:assert/strict';

import { cosineSimilarity } from '../src/services/cosineSimilarity';

test('cosineSimilarity returns 1 for identical direction and 0 for orthogonal vectors', () => {
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  // Same direction, different magnitude → still 1.
  assert.equal(cosineSimilarity([2, 0], [5, 0]), 1);
});

test('cosineSimilarity returns -1 for opposite vectors', () => {
  assert.ok(Math.abs(cosineSimilarity([1, 1], [-1, -1]) - -1) < 1e-12);
});

test('cosineSimilarity returns 0 when either vector is all zeros (no direction)', () => {
  assert.equal(cosineSimilarity([0, 0, 0], [1, 2, 3]), 0);
  assert.equal(cosineSimilarity([1, 2, 3], [0, 0, 0]), 0);
});

test('cosineSimilarity computes a known intermediate value', () => {
  // [1,1] vs [1,0]: dot=1, |a|=√2, |b|=1 → 1/√2
  assert.ok(Math.abs(cosineSimilarity([1, 1], [1, 0]) - 1 / Math.SQRT2) < 1e-12);
});

test('cosineSimilarity treats missing tail elements of the shorter vector as 0', () => {
  // iterates over a.length; b shorter → missing b entries count as 0.
  assert.equal(cosineSimilarity([1, 0, 0], [1]), 1);
});
