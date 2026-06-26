import test from 'node:test';
import assert from 'node:assert/strict';

import { getComparatorForSortMode, getDefaultSortModeForCategory } from './HomePage';
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
