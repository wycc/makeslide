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

const { getStoredCommentAuthor, setStoredCommentAuthor } = await import('./commentAuthor');

test('getStoredCommentAuthor returns empty string when nothing is stored', () => {
  localStorage.clear();
  assert.equal(getStoredCommentAuthor(), '');
});

test('setStoredCommentAuthor persists and getStoredCommentAuthor reads it', () => {
  localStorage.clear();
  setStoredCommentAuthor('Alice');
  assert.equal(getStoredCommentAuthor(), 'Alice');
  assert.equal(localStorage.getItem('makeslide.comment.author'), 'Alice');
});

test('setStoredCommentAuthor trims and caps at 80 chars', () => {
  localStorage.clear();
  setStoredCommentAuthor('  Bob  ');
  assert.equal(getStoredCommentAuthor(), 'Bob');
  const long = 'x'.repeat(100);
  setStoredCommentAuthor(long);
  assert.equal(getStoredCommentAuthor().length, 80);
});

test('setStoredCommentAuthor removes the entry when given a blank name', () => {
  localStorage.clear();
  setStoredCommentAuthor('Carol');
  setStoredCommentAuthor('   ');
  assert.equal(getStoredCommentAuthor(), '');
  assert.equal(localStorage.getItem('makeslide.comment.author'), null);
});

test('helpers degrade gracefully without window/localStorage', () => {
  const saved = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = undefined;
  try {
    assert.equal(getStoredCommentAuthor(), '');
    setStoredCommentAuthor('Dave'); // must not throw
  } finally {
    (globalThis as { window?: unknown }).window = saved;
  }
});
