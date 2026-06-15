import test from 'node:test';
import assert from 'node:assert/strict';
import { splitScriptIntoSentences } from '../src/services/textSentences';

test('splitScriptIntoSentences splits on CJK/ASCII terminators and strips tone markers', () => {
  const script = '[[興奮]]這是第一句。這是第二句！第三句嗎？最後一句';
  assert.deepEqual(splitScriptIntoSentences(script), [
    '這是第一句。',
    '這是第二句！',
    '第三句嗎？',
    '最後一句',
  ]);
});

test('splitScriptIntoSentences returns [] for empty/whitespace-only input', () => {
  assert.deepEqual(splitScriptIntoSentences(''), []);
  assert.deepEqual(splitScriptIntoSentences('   \n\n  '), []);
});
