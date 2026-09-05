import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatPdfPageMarker,
  containsPdfPageMarkers,
  stripPdfPageMarkers,
  buildTextWithPdfPageMarkers,
  splitByPdfPageMarkers,
} from '../src/services/pdfPageMarkers';

test('formatPdfPageMarker wraps a 1-indexed page number', () => {
  assert.equal(formatPdfPageMarker(1), '[[PDF_PAGE_1]]');
  assert.equal(formatPdfPageMarker(42), '[[PDF_PAGE_42]]');
});

test('containsPdfPageMarkers detects a well-formed marker only', () => {
  assert.equal(containsPdfPageMarkers('hello [[PDF_PAGE_3]] world'), true);
  assert.equal(containsPdfPageMarkers('no markers here'), false);
  assert.equal(containsPdfPageMarkers(''), false);
  // missing the numeric component is not a valid marker
  assert.equal(containsPdfPageMarkers('[[PDF_PAGE_]]'), false);
});

test('stripPdfPageMarkers removes markers and trims surrounding whitespace', () => {
  assert.equal(stripPdfPageMarkers('[[PDF_PAGE_1]]\nhello'), 'hello');
});

test('stripPdfPageMarkers collapses 3+ blank lines left behind into a single blank line', () => {
  assert.equal(
    stripPdfPageMarkers('[[PDF_PAGE_1]]\nfoo\n\n[[PDF_PAGE_2]]\nbar'),
    'foo\n\nbar',
  );
  // collapsing also applies to runs of newlines that were already in the text
  assert.equal(stripPdfPageMarkers('a\n\n\n\nb'), 'a\n\nb');
});

test('buildTextWithPdfPageMarkers prefixes each page with a 1-indexed marker', () => {
  assert.equal(
    buildTextWithPdfPageMarkers(['A', 'B']),
    '[[PDF_PAGE_1]]\nA\n\n[[PDF_PAGE_2]]\nB',
  );
  assert.equal(buildTextWithPdfPageMarkers(['only']), '[[PDF_PAGE_1]]\nonly');
  assert.equal(buildTextWithPdfPageMarkers([]), '');
});

test('build then strip round-trips back to the page contents', () => {
  const built = buildTextWithPdfPageMarkers(['A', 'B']);
  assert.equal(containsPdfPageMarkers(built), true);
  assert.equal(stripPdfPageMarkers(built), 'A\n\nB');
});

test('splitByPdfPageMarkers returns one entry per original page', () => {
  const text = buildTextWithPdfPageMarkers(['第一頁內容', '第二頁內容', '第三頁內容']);
  const pages = splitByPdfPageMarkers(text);

  assert.equal(pages.length, 3);
  assert.deepEqual(pages.map((p) => p.pageNumber), [1, 2, 3]);
  assert.match(pages[0]!.content, /第一頁內容/);
  assert.match(pages[2]!.content, /第三頁內容/);
  // The marker stays at the head of each block so the page number survives a
  // round-trip through chunking.
  assert.ok(pages[1]!.content.startsWith('[[PDF_PAGE_2]]'));
});

test('splitByPdfPageMarkers returns [] when the text carries no markers', () => {
  assert.deepEqual(splitByPdfPageMarkers('沒有任何標記的純文字'), []);
  assert.deepEqual(splitByPdfPageMarkers(''), []);
});

test('splitByPdfPageMarkers folds text before the first marker into page 1', () => {
  const pages = splitByPdfPageMarkers('前言文字\n[[PDF_PAGE_1]]\n第一頁\n[[PDF_PAGE_2]]\n第二頁');

  assert.equal(pages.length, 2);
  assert.match(pages[0]!.content, /前言文字/);
  assert.match(pages[0]!.content, /第一頁/);
});
