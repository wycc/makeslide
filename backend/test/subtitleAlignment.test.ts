import test from 'node:test';
import assert from 'node:assert/strict';
import {
  splitScriptIntoSentences,
  alignSentencesToWordTimestamps,
  type WhisperWordTimestamp,
} from '../src/services/subtitleAlignment';

test('splitScriptIntoSentences returns [] for empty or whitespace-only input', () => {
  assert.deepEqual(splitScriptIntoSentences(''), []);
  assert.deepEqual(splitScriptIntoSentences('   \n  \t '), []);
});

test('splitScriptIntoSentences splits on CJK and ASCII sentence punctuation, keeping the mark', () => {
  assert.deepEqual(splitScriptIntoSentences('第一句。第二句！第三句？'), [
    '第一句。',
    '第二句！',
    '第三句？',
  ]);
  assert.deepEqual(splitScriptIntoSentences('Hello! World?'), ['Hello!', 'World?']);
});

test('splitScriptIntoSentences splits on semicolons and keeps a trailing fragment', () => {
  assert.deepEqual(splitScriptIntoSentences('a；b'), ['a；', 'b']);
  assert.deepEqual(splitScriptIntoSentences('no punctuation'), ['no punctuation']);
});

test('splitScriptIntoSentences normalizes CRLF and drops blank lines', () => {
  assert.deepEqual(splitScriptIntoSentences('a\r\n\r\nb'), ['a', 'b']);
});

test('splitScriptIntoSentences strips [[tone]] markers before splitting', () => {
  assert.deepEqual(splitScriptIntoSentences('你好[[ happy ]]世界。'), ['你好 世界。']);
});

test('alignSentencesToWordTimestamps returns [] when either input is empty', () => {
  assert.deepEqual(alignSentencesToWordTimestamps([], [{ word: 'a', start: 0, end: 1 }]), []);
  assert.deepEqual(alignSentencesToWordTimestamps(['a'], []), []);
});

test('alignSentencesToWordTimestamps maps evenly-weighted sentences onto matching words', () => {
  const words: WhisperWordTimestamp[] = [
    { word: 'ab', start: 0, end: 2 },
    { word: 'cd', start: 2, end: 4 },
  ];
  assert.deepEqual(alignSentencesToWordTimestamps(['ab', 'cd'], words), [
    { text: 'ab', start: 0, end: 2 },
    { text: 'cd', start: 2, end: 4 },
  ]);
});

test('alignSentencesToWordTimestamps allocates time proportionally to sentence character weight', () => {
  // sentence weights 4 and 2 over a single 6-char word spanning 0..6s -> split at 4s
  const words: WhisperWordTimestamp[] = [{ word: 'aaaaaa', start: 0, end: 6 }];
  assert.deepEqual(alignSentencesToWordTimestamps(['aaaa', 'bb'], words), [
    { text: 'aaaa', start: 0, end: 4 },
    { text: 'bb', start: 4, end: 6 },
  ]);
});

test('alignSentencesToWordTimestamps ends the last sentence at the total duration', () => {
  const words: WhisperWordTimestamp[] = [{ word: 'x', start: 0, end: 3 }];
  assert.deepEqual(alignSentencesToWordTimestamps(['hello'], words), [
    { text: 'hello', start: 0, end: 3 },
  ]);
});

test('alignSentencesToWordTimestamps ignores whitespace when weighting words', () => {
  // both words have one non-space char, so the two sentences split the timeline in half
  const words: WhisperWordTimestamp[] = [
    { word: ' a ', start: 0, end: 4 },
    { word: ' b ', start: 4, end: 8 },
  ];
  const result = alignSentencesToWordTimestamps(['one', 'two'], words);
  assert.equal(result.length, 2);
  assert.equal(result[0]!.start, 0);
  assert.equal(result[1]!.end, 8);
  // midpoint lands on the boundary between the two equally-weighted words
  assert.equal(result[0]!.end, 4);
  assert.equal(result[1]!.start, 4);
});

test('alignSentencesToWordTimestamps keeps times within bounds and non-decreasing', () => {
  const words: WhisperWordTimestamp[] = [
    { word: 'alpha', start: 0, end: 5 },
    { word: 'beta', start: 5, end: 9 },
  ];
  const result = alignSentencesToWordTimestamps(['s1', 's2', 's3'], words);
  const totalDuration = 9;
  for (const item of result) {
    assert.ok(item.start >= 0, `start ${item.start} >= 0`);
    assert.ok(item.start <= item.end, `start ${item.start} <= end ${item.end}`);
    assert.ok(item.end <= totalDuration, `end ${item.end} <= ${totalDuration}`);
  }
  assert.equal(result[result.length - 1]!.end, totalDuration);
});
