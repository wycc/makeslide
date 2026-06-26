import test from 'node:test';
import assert from 'node:assert/strict';
import { countUnresolvedComments, sortCommentsUnresolvedFirst } from './commentStats';

test('countUnresolvedComments returns 0 for an empty list', () => {
  assert.equal(countUnresolvedComments([]), 0);
});

test('countUnresolvedComments returns 0 when every comment is resolved', () => {
  assert.equal(countUnresolvedComments([{ resolved: true }, { resolved: true }]), 0);
});

test('countUnresolvedComments counts all when none are resolved', () => {
  assert.equal(countUnresolvedComments([{ resolved: false }, { resolved: false }, { resolved: false }]), 3);
});

test('countUnresolvedComments counts only unresolved in a mixed list', () => {
  const comments = [
    { resolved: false },
    { resolved: true },
    { resolved: false },
    { resolved: true },
  ];
  assert.equal(countUnresolvedComments(comments), 2);
});

test('sortCommentsUnresolvedFirst puts unresolved first while keeping stable order', () => {
  const comments = [
    { id: 1, resolved: true },
    { id: 2, resolved: false },
    { id: 3, resolved: true },
    { id: 4, resolved: false },
  ];
  const sorted = sortCommentsUnresolvedFirst(comments);
  // unresolved (2, 4) first in original relative order, then resolved (1, 3)
  assert.deepEqual(sorted.map((c) => c.id), [2, 4, 1, 3]);
  // original array is not mutated
  assert.deepEqual(comments.map((c) => c.id), [1, 2, 3, 4]);
});

test('sortCommentsUnresolvedFirst is a no-op ordering when all comments share a state', () => {
  const allResolved = [{ id: 1, resolved: true }, { id: 2, resolved: true }];
  assert.deepEqual(sortCommentsUnresolvedFirst(allResolved).map((c) => c.id), [1, 2]);
  const allOpen = [{ id: 1, resolved: false }, { id: 2, resolved: false }];
  assert.deepEqual(sortCommentsUnresolvedFirst(allOpen).map((c) => c.id), [1, 2]);
});
