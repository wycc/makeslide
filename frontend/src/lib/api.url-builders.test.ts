import test from 'node:test';
import assert from 'node:assert/strict';
import { figureImageUrl, imageVersionUrl, batchExportDownloadUrl } from './api';

test('figureImageUrl builds the figure image path', () => {
  assert.equal(figureImageUrl('abc', 'p1-img2'), 'api/pdfs/abc/figures/p1-img2/image');
});

test('figureImageUrl percent-encodes ids with unsafe characters', () => {
  assert.equal(figureImageUrl('a/b', 'x y'), 'api/pdfs/a%2Fb/figures/x%20y/image');
});

test('imageVersionUrl builds the page image version path with a stringified page number', () => {
  assert.equal(
    imageVersionUrl('id1', 3, 'deadbeef'),
    'api/pdfs/id1/pages/3/image/versions/deadbeef',
  );
});

test('imageVersionUrl percent-encodes each segment', () => {
  assert.equal(
    imageVersionUrl('a b', 1, 'h/h'),
    'api/pdfs/a%20b/pages/1/image/versions/h%2Fh',
  );
});

test('batchExportDownloadUrl builds the export download path', () => {
  assert.equal(batchExportDownloadUrl('job-1'), 'api/export/batch/job-1/download');
  assert.equal(batchExportDownloadUrl('a/b#c'), 'api/export/batch/a%2Fb%23c/download');
});
