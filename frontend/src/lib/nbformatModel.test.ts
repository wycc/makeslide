import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyIopub,
  cellText,
  clampCellIndex,
  clearAllOutputs,
  clearCellOutputs,
  withCellSource,
  defaultNbNotebook,
  displayOutput,
  displayOutputs,
  iopubToOutput,
  joinMultiline,
  parseNbNotebook,
  withCellExecution,
  type NbNotebook,
  type NbOutput,
} from './nbformatModel';

// ---- parse / defaults ----

test('parseNbNotebook preserves passthrough fields losslessly', () => {
  const raw = {
    cells: [
      { cell_type: 'code', source: 'print(1)', execution_count: 7, outputs: [], id: 'abc', metadata: { tags: ['x'] } },
      { cell_type: 'markdown', source: ['# H\n', 'body'] },
    ],
    metadata: { kernelspec: { name: 'python3' } },
    nbformat: 4,
    nbformat_minor: 5,
    extra_top_level: 42,
  };
  const nb = parseNbNotebook(raw);
  assert.equal(nb.cells.length, 2);
  assert.equal(nb.cells[0]!.id, 'abc');
  assert.deepEqual(nb.cells[0]!.metadata, { tags: ['x'] });
  assert.equal(nb.cells[0]!.execution_count, 7);
  assert.deepEqual(nb.metadata, { kernelspec: { name: 'python3' } });
  assert.equal((nb as Record<string, unknown>).extra_top_level, 42);
  // markdown cell carries no outputs/execution_count
  assert.equal('outputs' in nb.cells[1]!, false);
  assert.equal('execution_count' in nb.cells[1]!, false);
});

test('parseNbNotebook degrades malformed input to a default notebook', () => {
  assert.deepEqual(parseNbNotebook(null), defaultNbNotebook());
  assert.deepEqual(parseNbNotebook('nb'), defaultNbNotebook());
  assert.deepEqual(parseNbNotebook({ cells: 'nope' }), defaultNbNotebook());
  assert.deepEqual(parseNbNotebook({ cells: [] }), defaultNbNotebook());
});

test('parseNbNotebook normalizes bad cell_type to raw and fills top-level defaults', () => {
  const nb = parseNbNotebook({ cells: [{ cell_type: 'sql', source: 'x' }] });
  assert.equal(nb.cells[0]!.cell_type, 'raw');
  assert.equal(nb.nbformat, 4);
  assert.equal(nb.nbformat_minor, 5);
  assert.deepEqual(nb.metadata, {});
});

test('cellText and joinMultiline join array sources', () => {
  assert.equal(joinMultiline(['a\n', 'b']), 'a\nb');
  assert.equal(joinMultiline('plain'), 'plain');
  assert.equal(joinMultiline(42), '');
  assert.equal(cellText({ cell_type: 'code', source: ['x=', '1'] }), 'x=1');
});

// ---- cell navigation ----

test('clampCellIndex clamps to [0, count-1] and handles edge cases', () => {
  assert.equal(clampCellIndex(-1, 3), 0);
  assert.equal(clampCellIndex(5, 3), 2);
  assert.equal(clampCellIndex(1, 3), 1);
  assert.equal(clampCellIndex(0, 0), 0);
  assert.equal(clampCellIndex(NaN, 3), 0);
  assert.equal(clampCellIndex(1.9, 3), 1);
});

// ---- iopub reduce ----

test('iopubToOutput maps each message type', () => {
  assert.deepEqual(iopubToOutput({ msg_type: 'stream', content: { name: 'stderr', text: 'oops' } }), {
    output_type: 'stream',
    name: 'stderr',
    text: 'oops',
  });
  assert.deepEqual(iopubToOutput({ msg_type: 'error', content: { ename: 'ValueError', evalue: 'bad', traceback: ['t1', 't2'] } }), {
    output_type: 'error',
    ename: 'ValueError',
    evalue: 'bad',
    traceback: ['t1', 't2'],
  });
  assert.equal(iopubToOutput({ msg_type: 'status', content: { execution_state: 'idle' } }), null);
});

test('applyIopub concatenates consecutive same-name stream output', () => {
  let outputs: NbOutput[] = [];
  outputs = applyIopub(outputs, { msg_type: 'stream', content: { name: 'stdout', text: 'a\n' } });
  outputs = applyIopub(outputs, { msg_type: 'stream', content: { name: 'stdout', text: 'b\n' } });
  assert.equal(outputs.length, 1);
  assert.equal(outputs[0]!.text, 'a\nb\n');
  // a different stream name starts a new output
  outputs = applyIopub(outputs, { msg_type: 'stream', content: { name: 'stderr', text: 'e' } });
  assert.equal(outputs.length, 2);
});

test('applyIopub appends result/display outputs and clears on clear_output', () => {
  let outputs: NbOutput[] = [];
  outputs = applyIopub(outputs, { msg_type: 'stream', content: { name: 'stdout', text: 'x' } });
  outputs = applyIopub(outputs, {
    msg_type: 'execute_result',
    content: { data: { 'text/plain': '2' }, metadata: {}, execution_count: 3 },
  });
  assert.equal(outputs.length, 2);
  // status messages leave outputs unchanged
  const same = applyIopub(outputs, { msg_type: 'status', content: { execution_state: 'busy' } });
  assert.equal(same, outputs);
  // clear_output empties
  assert.deepEqual(applyIopub(outputs, { msg_type: 'clear_output', content: { wait: false } }), []);
});

test('applyIopub is immutable (does not mutate the input array)', () => {
  const outputs: NbOutput[] = [];
  const next = applyIopub(outputs, { msg_type: 'stream', content: { name: 'stdout', text: 'a' } });
  assert.equal(outputs.length, 0);
  assert.equal(next.length, 1);
});

// ---- writeback helpers ----

function twoCellNb(): NbNotebook {
  return parseNbNotebook({
    cells: [
      { cell_type: 'code', source: 'a', outputs: [{ output_type: 'stream', name: 'stdout', text: 'old' }], execution_count: 1 },
      { cell_type: 'markdown', source: 'note' },
    ],
    metadata: {},
    nbformat: 4,
    nbformat_minor: 5,
  });
}

test('withCellExecution replaces outputs + execution_count immutably', () => {
  const nb = twoCellNb();
  const outputs: NbOutput[] = [{ output_type: 'stream', name: 'stdout', text: 'new' }];
  const next = withCellExecution(nb, 0, outputs, 5);
  assert.equal(next.cells[0]!.execution_count, 5);
  assert.deepEqual(next.cells[0]!.outputs, outputs);
  // original untouched
  assert.equal(nb.cells[0]!.execution_count, 1);
  // no-op on markdown cell index
  assert.equal(withCellExecution(nb, 1, outputs, 5).cells[1], nb.cells[1]);
});

test('clearCellOutputs and clearAllOutputs reset code cells', () => {
  const nb = twoCellNb();
  assert.deepEqual(clearCellOutputs(nb, 0).cells[0]!.outputs, []);
  assert.equal(clearCellOutputs(nb, 0).cells[0]!.execution_count, null);
  const cleared = clearAllOutputs(withCellExecution(nb, 0, [{ output_type: 'stream', name: 'stdout', text: 'z' }], 2));
  assert.deepEqual(cleared.cells[0]!.outputs, []);
  assert.equal(cleared.cells[0]!.execution_count, null);
});

test('withCellSource replaces a cell source immutably and no-ops out of range', () => {
  const nb = twoCellNb();
  const next = withCellSource(nb, 1, 'edited markdown');
  assert.equal(cellText(next.cells[1]!), 'edited markdown');
  assert.equal(cellText(nb.cells[1]!), 'note'); // original untouched
  // preserves the cell's other fields (type)
  assert.equal(next.cells[1]!.cell_type, 'markdown');
  // out-of-range index returns the same notebook reference
  assert.equal(withCellSource(nb, 9, 'x'), nb);
  assert.equal(withCellSource(nb, -1, 'x'), nb);
});

// ---- display MIME selection ----

test('displayOutput prefers image, then html, then latex, then plain text', () => {
  assert.deepEqual(
    displayOutput({ output_type: 'display_data', data: { 'text/plain': 'x', 'image/png': 'BASE64' } }),
    { kind: 'image', mimeType: 'image/png', dataBase64: 'BASE64' },
  );
  assert.deepEqual(displayOutput({ output_type: 'execute_result', data: { 'text/html': '<b>hi</b>', 'text/plain': 'hi' } }), {
    kind: 'html',
    html: '<b>hi</b>',
  });
  assert.deepEqual(displayOutput({ output_type: 'execute_result', data: { 'text/latex': '$x$', 'text/plain': 'x' } }), {
    kind: 'latex',
    latex: '$x$',
  });
  assert.deepEqual(displayOutput({ output_type: 'execute_result', data: { 'text/plain': ['a', 'b'] } }), {
    kind: 'text',
    text: 'ab',
  });
});

test('displayOutput maps stream and error, and displayOutputs drops empties', () => {
  assert.deepEqual(displayOutput({ output_type: 'stream', name: 'stdout', text: 'hi' }), { kind: 'text', text: 'hi' });
  assert.equal(displayOutput({ output_type: 'stream', name: 'stdout', text: '' }), null);
  assert.deepEqual(displayOutput({ output_type: 'error', ename: 'E', evalue: 'v', traceback: ['a\n', 'b'] }), {
    kind: 'error',
    ename: 'E',
    evalue: 'v',
    traceback: 'a\nb',
  });
  const outs: NbOutput[] = [
    { output_type: 'stream', name: 'stdout', text: 'hi' },
    { output_type: 'display_data', data: {} },
  ];
  assert.equal(displayOutputs(outs).length, 1);
  assert.deepEqual(displayOutputs(undefined), []);
});
