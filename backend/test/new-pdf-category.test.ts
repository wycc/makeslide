import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PDF_CATEGORY, MAX_PDF_CATEGORY_CHARS, normalizeNewPdfCategory } from '../src/routes/pdfs/shared';

// normalizeNewPdfCategory backs the `category` input of the creation endpoints
// (POST /api/pdfs, /api/prompt-text, /api/youtube, /api/pdfs/import.zip), which
// let the client file a new presentation into the category it is browsing.

test('a client-supplied category is kept (trimmed)', () => {
  assert.equal(normalizeNewPdfCategory('teaching'), 'teaching');
  assert.equal(normalizeNewPdfCategory('  數學  '), '數學');
});

test('missing / blank category falls back to the default bucket', () => {
  assert.equal(normalizeNewPdfCategory(undefined), DEFAULT_PDF_CATEGORY);
  assert.equal(normalizeNewPdfCategory(null), DEFAULT_PDF_CATEGORY);
  assert.equal(normalizeNewPdfCategory(''), DEFAULT_PDF_CATEGORY);
  assert.equal(normalizeNewPdfCategory('   '), DEFAULT_PDF_CATEGORY);
});

test('non-string input falls back to the default bucket', () => {
  assert.equal(normalizeNewPdfCategory(42), DEFAULT_PDF_CATEGORY);
  assert.equal(normalizeNewPdfCategory({ category: 'teaching' }), DEFAULT_PDF_CATEGORY);
  assert.equal(normalizeNewPdfCategory(['teaching']), DEFAULT_PDF_CATEGORY);
});

test('reserved home-page view filters are not stored as categories', () => {
  assert.equal(normalizeNewPdfCategory('__all__'), DEFAULT_PDF_CATEGORY);
  assert.equal(normalizeNewPdfCategory('__recent__'), DEFAULT_PDF_CATEGORY);
  assert.equal(normalizeNewPdfCategory('  __add_category__  '), DEFAULT_PDF_CATEGORY);
});

test('oversized categories degrade to the default instead of failing the upload', () => {
  const longest = 'a'.repeat(MAX_PDF_CATEGORY_CHARS);
  assert.equal(normalizeNewPdfCategory(longest), longest);
  assert.equal(normalizeNewPdfCategory(`${longest}a`), DEFAULT_PDF_CATEGORY);
});
