import test from 'node:test';
import assert from 'node:assert/strict';
import { nextPageInList, prevPageInList } from './pageListNav';

test('next/prevPageInList return null for an empty list', () => {
  assert.equal(nextPageInList([], 3), null);
  assert.equal(prevPageInList([], 3), null);
});

test('nextPageInList finds the next page and wraps around', () => {
  const pages = [2, 5, 9];
  assert.equal(nextPageInList(pages, 1), 2);
  assert.equal(nextPageInList(pages, 2), 5);
  assert.equal(nextPageInList(pages, 6), 9);
  assert.equal(nextPageInList(pages, 9), 2); // wraps to first
  assert.equal(nextPageInList(pages, 100), 2);
});

test('prevPageInList finds the previous page and wraps around', () => {
  const pages = [2, 5, 9];
  assert.equal(prevPageInList(pages, 9), 5);
  assert.equal(prevPageInList(pages, 6), 5);
  assert.equal(prevPageInList(pages, 5), 2);
  assert.equal(prevPageInList(pages, 2), 9); // wraps to last
  assert.equal(prevPageInList(pages, 1), 9);
});

test('next/prevPageInList sort and de-duplicate the list', () => {
  const messy = [9, 2, 5, 2, 9];
  assert.equal(nextPageInList(messy, 3), 5);
  assert.equal(prevPageInList(messy, 3), 2);
});
