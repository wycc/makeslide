import test from 'node:test';
import assert from 'node:assert/strict';
import { computeLineDiff } from './computeLineDiff';

test('identical texts produce only eq ops', () => {
  const ops = computeLineDiff('a\nb\nc', 'a\nb\nc');
  assert.ok(ops.every((op) => op.type === 'eq'));
  assert.deepEqual(
    ops.map((o) => o.line),
    ['a', 'b', 'c'],
  );
});

test("empty old text: del the empty line, then add new lines", () => {
  // ''.split('\n') === [''] — one empty line
  const ops = computeLineDiff('', 'x\ny');
  assert.deepEqual(ops, [
    { type: 'del', line: '' },
    { type: 'add', line: 'x' },
    { type: 'add', line: 'y' },
  ]);
});

test("empty new text: del old lines, then add the empty line", () => {
  const ops = computeLineDiff('x\ny', '');
  assert.deepEqual(ops, [
    { type: 'del', line: 'x' },
    { type: 'del', line: 'y' },
    { type: 'add', line: '' },
  ]);
});

test('added line in new text', () => {
  const ops = computeLineDiff('a\nb', 'a\nnew\nb');
  const types = ops.map((o) => o.type);
  assert.deepEqual(types, ['eq', 'add', 'eq']);
  assert.equal(ops[1]?.line, 'new');
});

test('removed line in new text', () => {
  const ops = computeLineDiff('a\nremoved\nb', 'a\nb');
  const types = ops.map((o) => o.type);
  assert.deepEqual(types, ['eq', 'del', 'eq']);
  assert.equal(ops[1]?.line, 'removed');
});

test('both additions and deletions', () => {
  const ops = computeLineDiff('line1\nold\nline3', 'line1\nnew\nline3');
  assert.equal(ops.length, 4);
  const delOps = ops.filter((o) => o.type === 'del');
  const addOps = ops.filter((o) => o.type === 'add');
  assert.equal(delOps[0]?.line, 'old');
  assert.equal(addOps[0]?.line, 'new');
});

test('reconstructing old text from del+eq ops', () => {
  const old = 'alpha\nbeta\ngamma';
  const cur = 'alpha\ndelta\ngamma';
  const ops = computeLineDiff(old, cur);
  const reconstructed = ops
    .filter((o) => o.type !== 'add')
    .map((o) => o.line)
    .join('\n');
  assert.equal(reconstructed, old);
});

test('reconstructing new text from add+eq ops', () => {
  const old = 'alpha\nbeta\ngamma';
  const cur = 'alpha\ndelta\ngamma';
  const ops = computeLineDiff(old, cur);
  const reconstructed = ops
    .filter((o) => o.type !== 'del')
    .map((o) => o.line)
    .join('\n');
  assert.equal(reconstructed, cur);
});
