import { test } from 'node:test';
import assert from 'node:assert/strict';
import { categoryForNewItem } from './activeCategory';

test('a real category filter becomes the category of the new item', () => {
  assert.equal(categoryForNewItem('teaching'), 'teaching');
  assert.equal(categoryForNewItem('數學'), '數學');
});

test('view filters are not categories', () => {
  assert.equal(categoryForNewItem('__all__'), null);
  assert.equal(categoryForNewItem('__recent__'), null);
  assert.equal(categoryForNewItem('__add_category__'), null);
});

test('blank / missing filters fall back to no category', () => {
  assert.equal(categoryForNewItem(''), null);
  assert.equal(categoryForNewItem('   '), null);
  assert.equal(categoryForNewItem(null), null);
  assert.equal(categoryForNewItem(undefined), null);
});

test('surrounding whitespace is trimmed', () => {
  assert.equal(categoryForNewItem('  teaching  '), 'teaching');
  // trimming happens before the view-filter check
  assert.equal(categoryForNewItem('  __all__  '), null);
});
