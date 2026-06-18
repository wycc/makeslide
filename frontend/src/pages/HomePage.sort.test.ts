import test from 'node:test';
import assert from 'node:assert/strict';

import { getDefaultSortModeForCategory } from './HomePage';

test('getDefaultSortModeForCategory defaults the recent view to newest created', () => {
  assert.equal(getDefaultSortModeForCategory('__recent__'), 'created_desc');
});

test('getDefaultSortModeForCategory keeps title A-Z as default for other views', () => {
  assert.equal(getDefaultSortModeForCategory('__all__'), 'title_asc');
  assert.equal(getDefaultSortModeForCategory('general'), 'title_asc');
  assert.equal(getDefaultSortModeForCategory('my-custom-category'), 'title_asc');
});
