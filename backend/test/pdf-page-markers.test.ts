import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTextWithPdfPageMarkers,
  containsPdfPageMarkers,
  formatPdfPageMarker,
  stripPdfPageMarkers,
} from '../src/services/pdfPageMarkers';

test('formatPdfPageMarker formats a 1-indexed page marker', () => {
  assert.equal(formatPdfPageMarker(1), '[[PDF_PAGE_1]]');
  assert.equal(formatPdfPageMarker(12), '[[PDF_PAGE_12]]');
});

test('containsPdfPageMarkers detects presence of markers', () => {
  assert.equal(containsPdfPageMarkers('plain text'), false);
  assert.equal(containsPdfPageMarkers('[[PDF_PAGE_1]]\nhello'), true);
});

test('stripPdfPageMarkers removes markers and collapses extra blank lines', () => {
  const input = '[[PDF_PAGE_1]]\n第一頁內容\n\n[[PDF_PAGE_2]]\n第二頁內容';
  assert.equal(stripPdfPageMarkers(input), '第一頁內容\n\n第二頁內容');
});

test('stripPdfPageMarkers is a no-op for text without markers', () => {
  assert.equal(stripPdfPageMarkers('  純文字內容  '), '純文字內容');
});

test('buildTextWithPdfPageMarkers joins per-page text with 1-indexed markers', () => {
  const result = buildTextWithPdfPageMarkers(['第一頁', '第二頁', '第三頁']);
  assert.equal(
    result,
    '[[PDF_PAGE_1]]\n第一頁\n\n[[PDF_PAGE_2]]\n第二頁\n\n[[PDF_PAGE_3]]\n第三頁',
  );
});

test('buildTextWithPdfPageMarkers + stripPdfPageMarkers round-trips back to the original page texts joined by blank lines', () => {
  const pages = ['第一頁內容', '第二頁內容', '第三頁內容'];
  const marked = buildTextWithPdfPageMarkers(pages);
  assert.equal(stripPdfPageMarkers(marked), pages.join('\n\n'));
});
