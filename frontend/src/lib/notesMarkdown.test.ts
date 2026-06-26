import test from 'node:test';
import assert from 'node:assert/strict';
import { formatNotesMarkdown } from './notesMarkdown';

const LABELS = { pagePrefix: 'Page' };

test('formatNotesMarkdown returns empty string when no page has notes', () => {
  assert.equal(formatNotesMarkdown([], LABELS), '');
  assert.equal(
    formatNotesMarkdown([{ page_number: 1, page_notes: '' }, { page_number: 2, page_notes: null }], LABELS),
    '',
  );
  assert.equal(formatNotesMarkdown([{ page_number: 1, page_notes: '   ' }], LABELS), '');
});

test('formatNotesMarkdown renders one block per page with a note', () => {
  const md = formatNotesMarkdown(
    [
      { page_number: 1, page_notes: 'first note' },
      { page_number: 2, page_notes: '  ' },
      { page_number: 3, page_notes: 'third note' },
    ],
    LABELS,
  );
  assert.equal(md, '## Page 1\nfirst note\n\n## Page 3\nthird note');
});

test('formatNotesMarkdown trims surrounding whitespace of each note', () => {
  const md = formatNotesMarkdown([{ page_number: 5, page_notes: '  spaced  ' }], LABELS);
  assert.equal(md, '## Page 5\nspaced');
});
