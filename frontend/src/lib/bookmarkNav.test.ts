import test from 'node:test';
import assert from 'node:assert/strict';
import { nextBookmarkPage, prevBookmarkPage } from './bookmarkNav';

test('next/prevBookmarkPage return null for an empty bookmark list', () => {
  assert.equal(nextBookmarkPage([], 3), null);
  assert.equal(prevBookmarkPage([], 3), null);
});

test('nextBookmarkPage finds the next bookmark and wraps around', () => {
  const bm = [2, 5, 9];
  assert.equal(nextBookmarkPage(bm, 1), 2);
  assert.equal(nextBookmarkPage(bm, 2), 5);
  assert.equal(nextBookmarkPage(bm, 6), 9);
  assert.equal(nextBookmarkPage(bm, 9), 2); // wraps to first
  assert.equal(nextBookmarkPage(bm, 100), 2);
});

test('prevBookmarkPage finds the previous bookmark and wraps around', () => {
  const bm = [2, 5, 9];
  assert.equal(prevBookmarkPage(bm, 9), 5);
  assert.equal(prevBookmarkPage(bm, 6), 5);
  assert.equal(prevBookmarkPage(bm, 5), 2);
  assert.equal(prevBookmarkPage(bm, 2), 9); // wraps to last
  assert.equal(prevBookmarkPage(bm, 1), 9);
});

test('next/prevBookmarkPage sort and de-duplicate the bookmark list', () => {
  const messy = [9, 2, 5, 2, 9];
  assert.equal(nextBookmarkPage(messy, 3), 5);
  assert.equal(prevBookmarkPage(messy, 3), 2);
});
