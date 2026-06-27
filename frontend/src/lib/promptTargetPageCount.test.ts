import test from 'node:test';
import assert from 'node:assert/strict';
import { promptTargetPageCount } from './promptTargetPageCount';

test('promptTargetPageCount prefers a generated presentation page_count', () => {
  assert.equal(promptTargetPageCount({ page_count: 12 }), 12);
  // page_count wins even when source_page_count is also present
  assert.equal(promptTargetPageCount({ page_count: 12, source_page_count: 5 }), 12);
});

test('promptTargetPageCount falls back to an uploaded PDF source_page_count', () => {
  // freshly uploaded PDF: no real page_count yet, use the physical PDF page count
  assert.equal(promptTargetPageCount({ page_count: null, source_page_count: 8 }), 8);
  assert.equal(promptTargetPageCount({ source_page_count: 8 }), 8);
});

test('promptTargetPageCount returns null when neither count is a positive number', () => {
  // TXT / YouTube uploads: slide count unknown until generation -> no estimate
  assert.equal(promptTargetPageCount({}), null);
  assert.equal(promptTargetPageCount({ page_count: null, source_page_count: null }), null);
  assert.equal(promptTargetPageCount({ page_count: 0, source_page_count: 0 }), null);
  assert.equal(promptTargetPageCount({ page_count: undefined, source_page_count: undefined }), null);
});
