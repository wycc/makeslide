import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupItemsByCategory } from './groupItemsByCategory';

interface Item {
  id: string;
  category?: string | null;
}

// sort items within a group by id ascending, as a deterministic stub.
const byId = (list: Item[]) => [...list].sort((a, b) => a.id.localeCompare(b.id));

test('groups items by category and orders groups by category name', () => {
  const items: Item[] = [
    { id: 'b', category: 'teaching' },
    { id: 'a', category: 'art' },
    { id: 'c', category: 'teaching' },
  ];
  const groups = groupItemsByCategory(items, 'general', byId);
  assert.deepEqual(groups.map((g) => g.category), ['art', 'teaching']);
  assert.deepEqual(groups[1]!.items.map((i) => i.id), ['b', 'c']); // sorted within group
});

test('blank or missing category falls back to defaultCategory', () => {
  const items: Item[] = [
    { id: 'x', category: '   ' },
    { id: 'y', category: null },
    { id: 'z' },
  ];
  const groups = groupItemsByCategory(items, 'general', byId);
  assert.equal(groups.length, 1);
  assert.equal(groups[0]!.category, 'general');
  assert.deepEqual(groups[0]!.items.map((i) => i.id), ['x', 'y', 'z']);
});

test('applies the provided within-group sorter', () => {
  const items: Item[] = [{ id: 'b', category: 'c' }, { id: 'a', category: 'c' }];
  // reverse sorter → b before a
  const groups = groupItemsByCategory(items, 'general', (list) => [...list].sort((a, b) => b.id.localeCompare(a.id)));
  assert.deepEqual(groups[0]!.items.map((i) => i.id), ['b', 'a']);
});

test('does not mutate the input array', () => {
  const items: Item[] = [{ id: 'b', category: 'z' }, { id: 'a', category: 'a' }];
  groupItemsByCategory(items, 'general', byId);
  assert.deepEqual(items.map((i) => i.id), ['b', 'a']);
});

test('returns an empty array for no items', () => {
  assert.deepEqual(groupItemsByCategory([], 'general', byId), []);
});
