import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RETAINED_DECODED_IMAGES,
  pendingPreloadUrls,
  preloadOrderFromIndex,
  retainWithinCap,
} from './deckImagePreload';

// ── preloadOrderFromIndex ────────────────────────────────────────────────

test('preloadOrderFromIndex starts at the current page and spreads outward, forward first', () => {
  assert.deepEqual(preloadOrderFromIndex(7, 3), [3, 4, 2, 5, 1, 6, 0]);
});

test('preloadOrderFromIndex from the first page is just forward order', () => {
  assert.deepEqual(preloadOrderFromIndex(5, 0), [0, 1, 2, 3, 4]);
});

test('preloadOrderFromIndex from the last page walks backwards', () => {
  assert.deepEqual(preloadOrderFromIndex(4, 3), [3, 2, 1, 0]);
});

test('preloadOrderFromIndex covers every page exactly once', () => {
  const order = preloadOrderFromIndex(50, 17);
  assert.equal(order.length, 50);
  assert.equal(new Set(order).size, 50);
});

test('preloadOrderFromIndex clamps an out-of-range index instead of dropping pages', () => {
  assert.deepEqual(preloadOrderFromIndex(3, 99), [2, 1, 0]);
  assert.deepEqual(preloadOrderFromIndex(3, -5), [0, 1, 2]);
});

test('preloadOrderFromIndex returns nothing for an empty deck', () => {
  assert.deepEqual(preloadOrderFromIndex(0, 0), []);
});

// ── retainWithinCap ──────────────────────────────────────────────────────

test('retainWithinCap keeps the pages nearest the start, not the last ones loaded', () => {
  // 載入順序是由近而遠，所以「先到先留」留下的就是目前頁附近那幾張。若改成滿了丟最舊的，
  // 留下來的會是整批離最遠的頁——正好是最不需要立刻可用的那些。
  const map = new Map<string, number>();
  const kept = ['near', 'mid', 'far'].map((key, i) => retainWithinCap(map, key, i, 2));
  assert.deepEqual(kept, [true, true, false]);
  assert.deepEqual([...map.keys()], ['near', 'mid']);
});

test('retainWithinCap treats an already-retained url as kept without growing the map', () => {
  const map = new Map([['a', 1]]);
  assert.equal(retainWithinCap(map, 'a', 99, 1), true);
  assert.equal(map.size, 1);
  assert.equal(map.get('a'), 1);
});

test('retainWithinCap with a cap of zero retains nothing', () => {
  const map = new Map<string, number>();
  assert.equal(retainWithinCap(map, 'a', 1, 0), false);
  assert.equal(map.size, 0);
});

// ── pendingPreloadUrls ───────────────────────────────────────────────────

const srcs = ['p0.jpg', 'p1.jpg', 'p2.jpg', 'p3.jpg'];

test('pendingPreloadUrls returns every url in preload order', () => {
  assert.deepEqual(pendingPreloadUrls(srcs, 1, new Set()), ['p1.jpg', 'p2.jpg', 'p0.jpg', 'p3.jpg']);
});

test('pendingPreloadUrls skips urls already fetched', () => {
  assert.deepEqual(
    pendingPreloadUrls(srcs, 0, new Set(['p0.jpg', 'p2.jpg'])),
    ['p1.jpg', 'p3.jpg'],
  );
});

test('pendingPreloadUrls skips pages with no image (notebook pages)', () => {
  assert.deepEqual(
    pendingPreloadUrls(['a.jpg', null, 'c.jpg'], 0, new Set()),
    ['a.jpg', 'c.jpg'],
  );
});

test('pendingPreloadUrls de-duplicates pages that share one url', () => {
  assert.deepEqual(pendingPreloadUrls(['same.jpg', 'same.jpg'], 0, new Set()), ['same.jpg']);
});

test('pendingPreloadUrls returns nothing once everything is done', () => {
  assert.deepEqual(pendingPreloadUrls(srcs, 2, new Set(srcs)), []);
});

test('the retained-decode cap stays well under a deck that would exhaust memory', () => {
  // 這個上限是刻意的取捨（見 deckImagePreload.ts）：全部保留會讓大簡報吃掉近 1 GB。
  assert.ok(RETAINED_DECODED_IMAGES > 0);
  assert.ok(RETAINED_DECODED_IMAGES <= 64);
});
