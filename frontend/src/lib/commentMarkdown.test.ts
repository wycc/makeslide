import test from 'node:test';
import assert from 'node:assert/strict';
import { formatCommentsMarkdown } from './commentMarkdown';

const LABELS = { heading: 'Comments', page: 'Page {n}', resolved: 'resolved' };

test('formatCommentsMarkdown returns empty string for an empty list', () => {
  assert.equal(formatCommentsMarkdown([], LABELS), '');
});

test('formatCommentsMarkdown sorts by page and marks resolved comments', () => {
  const md = formatCommentsMarkdown(
    [
      { page_number: 3, author: 'Bob', text: 'C?', resolved: true },
      { page_number: 1, author: 'Alice', text: 'A?', resolved: false },
    ],
    LABELS,
  );
  assert.equal(md, '# Comments\n\n- [Page 1] Alice：A?\n- [Page 3] Bob（resolved）：C?');
});

test('formatCommentsMarkdown keeps a stable order for comments on the same page', () => {
  const md = formatCommentsMarkdown(
    [
      { page_number: 2, author: 'first', text: '1', resolved: false },
      { page_number: 2, author: 'second', text: '2', resolved: false },
    ],
    LABELS,
  );
  assert.equal(md, '# Comments\n\n- [Page 2] first：1\n- [Page 2] second：2');
});
