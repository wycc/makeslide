import test from 'node:test';
import assert from 'node:assert/strict';

import { shouldShowCoverImage } from './pdfCardCover';

test('shouldShowCoverImage is false when there is no cover URL', () => {
  assert.equal(shouldShowCoverImage(null, null), false);
  assert.equal(shouldShowCoverImage(undefined, null), false);
  assert.equal(shouldShowCoverImage('', null), false);
});

test('shouldShowCoverImage is true for a cover URL that has not failed', () => {
  assert.equal(shouldShowCoverImage('/a/cover.jpg', null), true);
  assert.equal(shouldShowCoverImage('/a/cover.jpg', '/some/other.jpg'), true);
});

test('shouldShowCoverImage falls back to the placeholder for the exact URL that failed', () => {
  assert.equal(shouldShowCoverImage('/a/cover.jpg', '/a/cover.jpg'), false);
});

test('shouldShowCoverImage retries when coverSrc changes to a new URL after a failure', () => {
  // e.g. the next live page-preview frame while a deck is still rendering
  assert.equal(shouldShowCoverImage('/p/2/thumbnail', '/p/1/thumbnail'), true);
});
