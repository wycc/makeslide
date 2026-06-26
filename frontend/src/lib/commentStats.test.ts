import test from 'node:test';
import assert from 'node:assert/strict';
import { countUnresolvedComments } from './commentStats';

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
