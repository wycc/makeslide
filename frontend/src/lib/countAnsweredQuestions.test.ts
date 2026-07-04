import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countAnsweredQuestions } from './countAnsweredQuestions';

const qs = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

test('counts questions that have at least one selected answer', () => {
  assert.equal(countAnsweredQuestions(qs, { a: [0], c: [1, 2] }), 2);
});

test('treats missing and empty answer arrays as unanswered', () => {
  assert.equal(countAnsweredQuestions(qs, { a: [], b: undefined }), 0);
});

test('returns 0 when there are no questions', () => {
  assert.equal(countAnsweredQuestions([], { a: [0] }), 0);
});

test('returns the full count when every question is answered', () => {
  assert.equal(countAnsweredQuestions(qs, { a: [0], b: [1], c: [2] }), 3);
});

test('ignores answers whose id has no matching question', () => {
  assert.equal(countAnsweredQuestions(qs, { a: [0], zzz: [1] }), 1);
});
