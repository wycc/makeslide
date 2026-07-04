import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filenameFromContentDisposition } from './contentDisposition';

test('extracts the quoted filename', () => {
  assert.equal(filenameFromContentDisposition('attachment; filename="course-abc.zip"', 'fallback.zip'), 'course-abc.zip');
});

test('returns the fallback when the header is missing or empty', () => {
  assert.equal(filenameFromContentDisposition(null, 'fb.zip'), 'fb.zip');
  assert.equal(filenameFromContentDisposition(undefined, 'fb.zip'), 'fb.zip');
  assert.equal(filenameFromContentDisposition('', 'fb.zip'), 'fb.zip');
});

test('returns the fallback when there is no quoted filename', () => {
  assert.equal(filenameFromContentDisposition('attachment', 'fb.zip'), 'fb.zip');
  assert.equal(filenameFromContentDisposition('inline; filename=noquotes.zip', 'fb.zip'), 'fb.zip');
});

test('handles CJK / unicode filenames inside the quotes', () => {
  assert.equal(filenameFromContentDisposition('attachment; filename="課程包.zip"', 'fb.zip'), '課程包.zip');
});
