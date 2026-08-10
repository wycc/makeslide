import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getComparatorForSortMode,
  getDefaultSortModeForCategory,
  selectRecentlyCreated,
  RECENT_VIEW_LIMIT,
} from './HomePage';
import type { PdfListItem } from '../types';

const item = (id: string, title: string | null): PdfListItem => ({ id, title } as PdfListItem);

test('getDefaultSortModeForCategory defaults the recent view to newest created', () => {
  assert.equal(getDefaultSortModeForCategory('__recent__'), 'created_desc');
});

test('getDefaultSortModeForCategory keeps title A-Z as default for other views', () => {
  assert.equal(getDefaultSortModeForCategory('__all__'), 'title_asc');
  assert.equal(getDefaultSortModeForCategory('general'), 'title_asc');
  assert.equal(getDefaultSortModeForCategory('my-custom-category'), 'title_asc');
});

test('title_desc comparator sorts titles in reverse (Z-A) of title_asc', () => {
  const items = [item('1', 'Banana'), item('2', 'apple'), item('3', 'Cherry')];
  const asc = [...items].sort(getComparatorForSortMode('title_asc')).map((p) => p.id);
  const desc = [...items].sort(getComparatorForSortMode('title_desc')).map((p) => p.id);
  assert.deepEqual(asc, ['2', '1', '3']);
  assert.deepEqual(desc, ['3', '1', '2']);
});

test('title_desc falls back to id when title is empty', () => {
  const items = [item('beta', '  '), item('alpha', null)];
  const desc = [...items].sort(getComparatorForSortMode('title_desc')).map((p) => p.id);
  assert.deepEqual(desc, ['beta', 'alpha']);
});

const itemWithPages = (id: string, pageCount: number | null): PdfListItem =>
  ({ id, title: id, page_count: pageCount } as PdfListItem);

test('page_count_asc sorts fewest pages first, missing counts last', () => {
  const items = [itemWithPages('a', 12), itemWithPages('b', 3), itemWithPages('c', null), itemWithPages('d', 7)];
  const asc = [...items].sort(getComparatorForSortMode('page_count_asc')).map((p) => p.id);
  assert.deepEqual(asc, ['b', 'd', 'a', 'c']);
});

test('page_count_asc is the reverse direction of page_count_desc for present counts', () => {
  const items = [itemWithPages('a', 12), itemWithPages('b', 3), itemWithPages('d', 7)];
  const asc = [...items].sort(getComparatorForSortMode('page_count_asc')).map((p) => p.id);
  const desc = [...items].sort(getComparatorForSortMode('page_count_desc')).map((p) => p.id);
  assert.deepEqual(asc, ['b', 'd', 'a']);
  assert.deepEqual(desc, ['a', 'd', 'b']);
});

const createdItem = (id: string, createdAt: string | undefined, lastPlayedAt?: string): PdfListItem =>
  ({ id, title: id, created_at: createdAt, last_played_at: lastPlayedAt } as unknown as PdfListItem);

test('selectRecentlyCreated returns newest created first', () => {
  const items = [
    createdItem('old', '2026-01-01T00:00:00Z'),
    createdItem('newest', '2026-08-01T00:00:00Z'),
    createdItem('middle', '2026-05-01T00:00:00Z'),
  ];
  assert.deepEqual(selectRecentlyCreated(items).map((p) => p.id), ['newest', 'middle', 'old']);
});

test('selectRecentlyCreated caps the list at the view limit', () => {
  const items = Array.from({ length: RECENT_VIEW_LIMIT + 12 }, (_, i) =>
    // 索引越大建立時間越新，所以前 RECENT_VIEW_LIMIT 名應為索引最大的那批。
    createdItem(`p${i}`, new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString()));
  const selected = selectRecentlyCreated(items);
  assert.equal(selected.length, RECENT_VIEW_LIMIT);
  assert.equal(selected.at(0)?.id, `p${items.length - 1}`);
  assert.equal(selected.at(-1)?.id, `p${items.length - RECENT_VIEW_LIMIT}`);
});

test('selectRecentlyCreated ignores last_played_at — never-played new decks still make the list', () => {
  const items = [
    createdItem('played-long-ago-but-old', '2026-01-01T00:00:00Z', '2026-08-09T00:00:00Z'),
    createdItem('brand-new-never-played', '2026-08-08T00:00:00Z'),
  ];
  assert.deepEqual(
    selectRecentlyCreated(items).map((p) => p.id),
    ['brand-new-never-played', 'played-long-ago-but-old'],
  );
});

test('selectRecentlyCreated sorts decks with a missing/invalid created_at last', () => {
  const items = [
    createdItem('missing', undefined),
    createdItem('invalid', 'not-a-date'),
    createdItem('dated', '2026-03-01T00:00:00Z'),
  ];
  assert.equal(selectRecentlyCreated(items).at(0)?.id, 'dated');
  assert.equal(selectRecentlyCreated(items).length, 3);
});

test('selectRecentlyCreated does not mutate the input array', () => {
  const items = [createdItem('a', '2026-01-01T00:00:00Z'), createdItem('b', '2026-08-01T00:00:00Z')];
  selectRecentlyCreated(items);
  assert.deepEqual(items.map((p) => p.id), ['a', 'b']);
});
