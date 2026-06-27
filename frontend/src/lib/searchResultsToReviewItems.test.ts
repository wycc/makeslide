import test from 'node:test';
import assert from 'node:assert/strict';
import { searchResultsToReviewItems } from './searchResultsToReviewItems';

const ADDED_AT = '2026-06-27T00:00:00.000Z';

test('searchResultsToReviewItems maps page results to review items with the snippet as questionText', () => {
  const items = searchResultsToReviewItems(
    [
      { pdf_id: 'a', pdf_title: 'Deck A', page_number: 3, snippet: '  光合作用  ' },
      { pdf_id: 'b', pdf_title: 'Deck B', page_number: 7, snippet: '細胞分裂' },
    ],
    ADDED_AT,
  );
  assert.deepEqual(items, [
    { pdfId: 'a', pdfTitle: 'Deck A', pageNumber: 3, questionText: '光合作用', addedAt: ADDED_AT },
    { pdfId: 'b', pdfTitle: 'Deck B', pageNumber: 7, questionText: '細胞分裂', addedAt: ADDED_AT },
  ]);
});

test('searchResultsToReviewItems drops title-only matches that have no page_number', () => {
  const items = searchResultsToReviewItems(
    [
      { pdf_id: 'a', pdf_title: 'Deck A', page_number: null, snippet: 'title hit' },
      { pdf_id: 'a', pdf_title: 'Deck A', page_number: 2, snippet: 'page hit' },
    ],
    ADDED_AT,
  );
  assert.equal(items.length, 1);
  assert.equal(items[0]?.pageNumber, 2);
});

test('searchResultsToReviewItems tolerates a null title and a missing snippet', () => {
  const items = searchResultsToReviewItems(
    [{ pdf_id: 'a', pdf_title: null, page_number: 1 }],
    ADDED_AT,
  );
  assert.deepEqual(items, [
    { pdfId: 'a', pdfTitle: '', pageNumber: 1, questionText: '', addedAt: ADDED_AT },
  ]);
});
