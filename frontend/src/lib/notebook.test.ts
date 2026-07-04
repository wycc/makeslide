import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNotebook } from './notebook';

test('parseNotebook parses markdown and code cells with array sources', () => {
  const nb = JSON.stringify({
    cells: [
      { cell_type: 'markdown', source: ['# Title\n', 'para'] },
      { cell_type: 'code', source: 'print(1)', outputs: [] },
    ],
  });
  assert.deepEqual(parseNotebook(nb).cells, [
    { type: 'markdown', source: '# Title\npara', outputs: [] },
    { type: 'code', source: 'print(1)', outputs: [] },
  ]);
});

test('parseNotebook normalizes stream output to text', () => {
  const nb = JSON.stringify({
    cells: [{ cell_type: 'code', source: 'x', outputs: [{ output_type: 'stream', name: 'stdout', text: ['a\n', 'b'] }] }],
  });
  assert.deepEqual(parseNotebook(nb).cells, [{ type: 'code', source: 'x', outputs: [{ kind: 'text', text: 'a\nb' }] }]);
});

test('parseNotebook prefers image over text/plain in execute_result data', () => {
  const nb = JSON.stringify({
    cells: [
      {
        cell_type: 'code',
        source: 'plot()',
        outputs: [{ output_type: 'display_data', data: { 'text/plain': '<Figure>', 'image/png': 'BASE64DATA' } }],
      },
    ],
  });
  assert.deepEqual(parseNotebook(nb).cells, [
    { type: 'code', source: 'plot()', outputs: [{ kind: 'image', mimeType: 'image/png', dataBase64: 'BASE64DATA' }] },
  ]);
});

test('parseNotebook falls back to text/plain when no image is present', () => {
  const nb = JSON.stringify({
    cells: [{ cell_type: 'code', source: '1+1', outputs: [{ output_type: 'execute_result', data: { 'text/plain': '2' } }] }],
  });
  assert.deepEqual(parseNotebook(nb).cells, [{ type: 'code', source: '1+1', outputs: [{ kind: 'text', text: '2' }] }]);
});

test('parseNotebook normalizes error outputs with joined traceback', () => {
  const nb = JSON.stringify({
    cells: [
      {
        cell_type: 'code',
        source: 'boom',
        outputs: [{ output_type: 'error', ename: 'ValueError', evalue: 'bad', traceback: ['line1\n', 'line2'] }],
      },
    ],
  });
  assert.deepEqual(parseNotebook(nb).cells, [
    { type: 'code', source: 'boom', outputs: [{ kind: 'error', ename: 'ValueError', evalue: 'bad', traceback: 'line1\nline2' }] },
  ]);
});

test('parseNotebook treats unknown cell types as raw and ignores their outputs', () => {
  const nb = JSON.stringify({ cells: [{ cell_type: 'heading', source: 'H', outputs: [{ output_type: 'stream', text: 'x' }] }] });
  assert.deepEqual(parseNotebook(nb).cells, [{ type: 'raw', source: 'H', outputs: [] }]);
});

test('parseNotebook drops unrenderable outputs but keeps the cell', () => {
  const nb = JSON.stringify({
    cells: [{ cell_type: 'code', source: 'x', outputs: [{ output_type: 'execute_result', data: { 'application/json': {} } }, null, 42] }],
  });
  assert.deepEqual(parseNotebook(nb).cells[0], { type: 'code', source: 'x', outputs: [] });
});

test('parseNotebook returns empty for malformed JSON or missing cells', () => {
  assert.deepEqual(parseNotebook('not json'), { cells: [] });
  assert.deepEqual(parseNotebook(''), { cells: [] });
  assert.deepEqual(parseNotebook('null'), { cells: [] });
  assert.deepEqual(parseNotebook('{"nbformat":4}'), { cells: [] });
  assert.deepEqual(parseNotebook('{"cells":"nope"}'), { cells: [] });
});

test('parseNotebook skips non-object cells', () => {
  const nb = JSON.stringify({ cells: [null, 'x', { cell_type: 'markdown', source: 'ok' }] });
  assert.deepEqual(parseNotebook(nb).cells, [{ type: 'markdown', source: 'ok', outputs: [] }]);
});
