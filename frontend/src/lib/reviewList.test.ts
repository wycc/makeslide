import test from 'node:test';
import assert from 'node:assert/strict';

// Minimal in-memory localStorage stub (node:test has no DOM). Installed before
// importing reviewList, which reads `localStorage` lazily inside its functions.
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null { return this.store.has(key) ? this.store.get(key)! : null; }
  setItem(key: string, value: string): void { this.store.set(key, String(value)); }
  removeItem(key: string): void { this.store.delete(key); }
  clear(): void { this.store.clear(); }
}
(globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage();

const {
  getReviewItems,
  addReviewItems,
  removeReviewItem,
  clearAllReviewItems,
} = await import('./reviewList');
type ReviewItem = import('./reviewList').ReviewItem;

function item(over: Partial<ReviewItem> = {}): ReviewItem {
  return {
    pdfId: 'pdf1',
    pdfTitle: 'PDF 1',
    pageNumber: 1,
    questionText: 'Q?',
    addedAt: '2026-06-25T00:00:00.000Z',
    ...over,
  };
}

test('getReviewItems returns [] when empty', () => {
  clearAllReviewItems();
  assert.deepEqual(getReviewItems(), []);
});

test('addReviewItems stores items and dedups by pdfId+pageNumber+questionText', () => {
  clearAllReviewItems();
  addReviewItems([item({ pageNumber: 1 }), item({ pageNumber: 2 })]);
  assert.equal(getReviewItems().length, 2);
  // Same key → not added again; a different questionText on same page → added.
  addReviewItems([item({ pageNumber: 1 }), item({ pageNumber: 1, questionText: 'Q2?' })]);
  const items = getReviewItems();
  assert.equal(items.length, 3);
  assert.equal(items.filter((i) => i.pageNumber === 1).length, 2);
});

test('removeReviewItem removes by pdfId + pageNumber', () => {
  clearAllReviewItems();
  addReviewItems([item({ pdfId: 'a', pageNumber: 1 }), item({ pdfId: 'a', pageNumber: 2 }), item({ pdfId: 'b', pageNumber: 1 })]);
  removeReviewItem('a', 1);
  const items = getReviewItems();
  assert.equal(items.length, 2);
  assert.ok(!items.some((i) => i.pdfId === 'a' && i.pageNumber === 1));
  assert.ok(items.some((i) => i.pdfId === 'a' && i.pageNumber === 2));
  assert.ok(items.some((i) => i.pdfId === 'b' && i.pageNumber === 1));
});

test('getReviewItems falls back to [] on corrupt or non-array data', () => {
  localStorage.setItem('makeslide.reviewItems', 'not json{');
  assert.deepEqual(getReviewItems(), []);
  localStorage.setItem('makeslide.reviewItems', JSON.stringify({ not: 'an array' }));
  assert.deepEqual(getReviewItems(), []);
});

test('clearAllReviewItems empties the list', () => {
  addReviewItems([item()]);
  assert.ok(getReviewItems().length >= 1);
  clearAllReviewItems();
  assert.deepEqual(getReviewItems(), []);
});
