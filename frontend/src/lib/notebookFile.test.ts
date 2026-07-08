import test from 'node:test';
import assert from 'node:assert/strict';
import { notebookDownloadFilename, serializeNotebookFile, parseNotebookFile } from './notebookFile';

test('notebookDownloadFilename slugifies the deck title and appends the page number', () => {
  assert.equal(notebookDownloadFilename('My Deck!', 3), 'My-Deck-p3.ipynb');
  assert.equal(notebookDownloadFilename('排序 演算法', 1), '排序-演算法-p1.ipynb');
  assert.equal(notebookDownloadFilename('  ///  ', 2), 'notebook-p2.ipynb'); // nothing usable → fallback
  assert.equal(notebookDownloadFilename(null, 5), 'notebook-p5.ipynb');
});

test('serializeNotebookFile matches the backend indent-1 + trailing-newline format', () => {
  const text = serializeNotebookFile({ cells: [], nbformat: 4 });
  assert.equal(text, `${JSON.stringify({ cells: [], nbformat: 4 }, null, 1)}\n`);
  assert.ok(text.endsWith('\n'));
});

test('parseNotebookFile accepts a valid notebook object', () => {
  const res = parseNotebookFile('{"cells":[{"cell_type":"code","source":""}],"nbformat":4}');
  assert.equal(res.ok, true);
  if (res.ok) assert.deepEqual((res.notebook as { cells: unknown[] }).cells.length, 1);
});

test('parseNotebookFile rejects malformed JSON and non-notebook JSON', () => {
  assert.deepEqual(parseNotebookFile('{ not json'), { ok: false, reason: 'invalid-json' });
  assert.deepEqual(parseNotebookFile('{"foo":1}'), { ok: false, reason: 'not-a-notebook' });
  assert.deepEqual(parseNotebookFile('[1,2,3]'), { ok: false, reason: 'not-a-notebook' });
  assert.deepEqual(parseNotebookFile('"a string"'), { ok: false, reason: 'not-a-notebook' });
});
