import test from 'node:test';
import assert from 'node:assert/strict';
import { countChangedLines, diffLines } from './textDiff';

test('identical text is all context', () => {
  const lines = diffLines('第一句。\n第二句。', '第一句。\n第二句。');
  assert.deepEqual(lines.map((l) => l.op), ['same', 'same']);
  assert.equal(countChangedLines(lines), 0);
});

test('a changed line reads as removed-then-added, not two unrelated edits', () => {
  // Showing the removal next to its replacement is the whole point of the viewer; emitting them
  // rows apart makes a one-line rewrite look like a deletion somewhere and an insertion elsewhere.
  const lines = diffLines('開頭。\n中間舊。\n結尾。', '開頭。\n中間新。\n結尾。');
  assert.deepEqual(lines.map((l) => `${l.op}:${l.text}`), [
    'same:開頭。',
    'removed:中間舊。',
    'added:中間新。',
    'same:結尾。',
  ]);
  assert.equal(countChangedLines(lines), 2);
});

test('pure insertion and pure deletion keep the untouched lines as context', () => {
  assert.deepEqual(diffLines('A\nB', 'A\n新增\nB').map((l) => l.op), ['same', 'added', 'same']);
  assert.deepEqual(diffLines('A\n刪除\nB', 'A\nB').map((l) => l.op), ['same', 'removed', 'same']);
});

test('an empty side is handled without losing the other', () => {
  // Empty text is no lines, not one blank line: a script written from scratch should not open
  // with a removed empty row that was never there.
  assert.deepEqual(diffLines('', 'A\nB').map((l) => `${l.op}:${l.text}`), ['added:A', 'added:B']);
  assert.deepEqual(diffLines('A', '').filter((l) => l.op === 'removed').map((l) => l.text), ['A']);
});

test('a complete rewrite shows every old line removed and every new one added', () => {
  const lines = diffLines('舊一。\n舊二。', '新一。\n新二。');
  assert.deepEqual(lines.filter((l) => l.op === 'removed').map((l) => l.text), ['舊一。', '舊二。']);
  assert.deepEqual(lines.filter((l) => l.op === 'added').map((l) => l.text), ['新一。', '新二。']);
});

test('trailing whitespace alone is not a change', () => {
  // Otherwise the viewer shows a red/green pair for a line that looks identical on screen.
  assert.equal(countChangedLines(diffLines('句子。  ', '句子。')), 0);
});
