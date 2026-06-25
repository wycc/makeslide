import test from 'node:test';
import assert from 'node:assert/strict';

// viewerId reads `window.localStorage`, so stub a minimal window before import.
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null { return this.store.has(key) ? this.store.get(key)! : null; }
  setItem(key: string, value: string): void { this.store.set(key, String(value)); }
  removeItem(key: string): void { this.store.delete(key); }
  clear(): void { this.store.clear(); }
}
(globalThis as { window?: unknown }).window = { localStorage: new MemoryStorage() };

const { getOrCreateViewerId } = await import('./viewerId');

test('getOrCreateViewerId creates a viewer- prefixed id and persists it', () => {
  window.localStorage.removeItem('makeslide.viewer.id');
  const id = getOrCreateViewerId();
  assert.match(id, /^viewer-/);
  assert.equal(window.localStorage.getItem('makeslide.viewer.id'), id);
});

test('getOrCreateViewerId returns the same id on subsequent calls', () => {
  window.localStorage.removeItem('makeslide.viewer.id');
  const first = getOrCreateViewerId();
  const second = getOrCreateViewerId();
  assert.equal(second, first);
});

test('getOrCreateViewerId reuses an existing stored id', () => {
  window.localStorage.setItem('makeslide.viewer.id', 'viewer-preexisting');
  assert.equal(getOrCreateViewerId(), 'viewer-preexisting');
});

test('getOrCreateViewerId returns a fresh id without window/localStorage', () => {
  const saved = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = undefined;
  try {
    const id = getOrCreateViewerId();
    assert.match(id, /^viewer-/);
  } finally {
    (globalThis as { window?: unknown }).window = saved;
  }
});
