import test from 'node:test';
import assert from 'node:assert/strict';
import { filterComments } from './commentFilter';

const COMMENTS = [
  { id: 1, text: 'Great slide on Photosynthesis', author: 'Alice' },
  { id: 2, text: '這一頁不太懂', author: 'Bob' },
  { id: 3, text: 'Need more examples', author: 'alice2' },
];

test('filterComments returns the original array for an empty or whitespace query', () => {
  assert.equal(filterComments(COMMENTS, ''), COMMENTS);
  assert.equal(filterComments(COMMENTS, '   '), COMMENTS);
});

test('filterComments matches comment text case-insensitively', () => {
  const result = filterComments(COMMENTS, 'photosynthesis');
  assert.deepEqual(result.map((c) => c.id), [1]);
});

test('filterComments matches the author field', () => {
  const result = filterComments(COMMENTS, 'alice');
  assert.deepEqual(result.map((c) => c.id), [1, 3]);
});

test('filterComments trims the query before matching', () => {
  const result = filterComments(COMMENTS, '  Bob  ');
  assert.deepEqual(result.map((c) => c.id), [2]);
});

test('filterComments matches non-ASCII text', () => {
  const result = filterComments(COMMENTS, '不太懂');
  assert.deepEqual(result.map((c) => c.id), [2]);
});

test('filterComments returns an empty array when nothing matches', () => {
  assert.deepEqual(filterComments(COMMENTS, 'zzz'), []);
});
