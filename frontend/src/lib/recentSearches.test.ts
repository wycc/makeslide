import test from 'node:test';
import assert from 'node:assert/strict';

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null { return this.store.has(key) ? this.store.get(key)! : null; }
  setItem(key: string, value: string): void { this.store.set(key, String(value)); }
  removeItem(key: string): void { this.store.delete(key); }
  clear(): void { this.store.clear(); }
}
const localStorage = new MemoryStorage();
(globalThis as { window?: unknown }).window = { localStorage };

const { getRecentSearches, addRecentSearch, clearRecentSearches } = await import('./recentSearches');

test('getRecentSearches returns [] when nothing is stored', () => {
  clearRecentSearches();
  assert.deepEqual(getRecentSearches(), []);
});

test('addRecentSearch prepends newest and persists', () => {
  clearRecentSearches();
  addRecentSearch('alpha');
  addRecentSearch('beta');
  assert.deepEqual(getRecentSearches(), ['beta', 'alpha']);
});

test('addRecentSearch ignores blank/whitespace queries', () => {
  clearRecentSearches();
  assert.deepEqual(addRecentSearch('   '), []);
  assert.deepEqual(getRecentSearches(), []);
});

test('addRecentSearch trims and de-duplicates case-insensitively, moving the hit to front', () => {
  clearRecentSearches();
  addRecentSearch('Photo');
  addRecentSearch('cells');
  addRecentSearch('  photo  ');
  assert.deepEqual(getRecentSearches(), ['photo', 'cells']);
});

test('addRecentSearch caps the list at 8 entries (newest kept)', () => {
  clearRecentSearches();
  for (let i = 1; i <= 10; i++) addRecentSearch(`q${i}`);
  const recents = getRecentSearches();
  assert.equal(recents.length, 8);
  assert.equal(recents[0], 'q10');
  assert.equal(recents[7], 'q3');
});

test('getRecentSearches tolerates corrupted storage', () => {
  localStorage.setItem('makeslide.recentSearches', '{not json');
  assert.deepEqual(getRecentSearches(), []);
  localStorage.setItem('makeslide.recentSearches', '"a string not array"');
  assert.deepEqual(getRecentSearches(), []);
});
