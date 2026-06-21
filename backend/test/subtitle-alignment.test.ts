import test from 'node:test';
import assert from 'node:assert/strict';
import {
  alignSentencesToWordTimestamps,
  splitScriptIntoSentences,
  type WhisperWordTimestamp,
} from '../src/services/subtitleAlignment';

test('splitScriptIntoSentences splits on CJK/Latin sentence-ending punctuation', () => {
  assert.deepEqual(splitScriptIntoSentences('你好。今天天氣很好！對吧？'), ['你好。', '今天天氣很好！', '對吧？']);
});

test('splitScriptIntoSentences strips [[tone]] markers', () => {
  // ASCII "." is deliberately not a sentence terminator for this regex (only full-width
  // 。！？； and half-width !?; are), so use ! to actually exercise a split boundary here.
  assert.deepEqual(splitScriptIntoSentences('[[excitedly]]Hello there! [[calmly]]Goodbye.'), ['Hello there!', 'Goodbye.']);
});

test('splitScriptIntoSentences returns an empty array for blank input', () => {
  assert.deepEqual(splitScriptIntoSentences('   \n\n  '), []);
});

function words(spec: Array<[string, number, number]>): WhisperWordTimestamp[] {
  return spec.map(([word, start, end]) => ({ word, start, end }));
}

test('alignSentencesToWordTimestamps returns an empty array when either input is empty', () => {
  assert.deepEqual(alignSentencesToWordTimestamps([], words([['hi', 0, 1]])), []);
  assert.deepEqual(alignSentencesToWordTimestamps(['hi'], []), []);
});

test('alignSentencesToWordTimestamps assigns proportional, non-overlapping, monotonic times for evenly-weighted sentences and words', () => {
  // 4 words of equal length, evenly spaced at 1 second apart; two sentences of equal length
  // should each claim exactly half the total word timeline.
  const w = words([
    ['aaaa', 0, 1],
    ['bbbb', 1, 2],
    ['cccc', 2, 3],
    ['dddd', 3, 4],
  ]);
  const result = alignSentencesToWordTimestamps(['aaaabbbb', 'ccccdddd'], w);
  assert.equal(result.length, 2);
  assert.equal(result[0]!.start, 0);
  assert.equal(result[0]!.end, 2);
  assert.equal(result[1]!.start, 2);
  assert.equal(result[1]!.end, 4);
});

test('alignSentencesToWordTimestamps gives a longer sentence proportionally more time', () => {
  const w = words([
    ['a'.repeat(10), 0, 10],
    ['b'.repeat(30), 10, 40],
  ]);
  // First sentence is 1/4 of the total characters, second is 3/4.
  const result = alignSentencesToWordTimestamps(['x'.repeat(10), 'y'.repeat(30)], w);
  assert.equal(result[0]!.start, 0);
  assert.equal(result[0]!.end, 10);
  assert.equal(result[1]!.start, 10);
  assert.equal(result[1]!.end, 40);
});

test('alignSentencesToWordTimestamps interpolates within a word when a sentence boundary falls mid-word', () => {
  // One word spans the entire timeline; a sentence boundary at the halfway point through the
  // combined sentence text should land at the halfway point of that single word's time range.
  const w = words([['abcdefghij', 0, 10]]);
  const result = alignSentencesToWordTimestamps(['abcde', 'fghij'], w);
  assert.equal(result[0]!.start, 0);
  assert.equal(result[0]!.end, 5);
  assert.equal(result[1]!.start, 5);
  assert.equal(result[1]!.end, 10);
});

test('alignSentencesToWordTimestamps never produces overlapping or decreasing sentence times', () => {
  const w = words([
    ['short', 0, 0.5],
    ['amediumword', 0.5, 1.8],
    ['x', 1.8, 1.85],
    ['averylongwordindeed', 1.85, 4.2],
  ]);
  const sentences = ['一句話。', '另外一句長一點的話，內容更多一些。', '短。', '最後一句。'];
  const result = alignSentencesToWordTimestamps(sentences, w);
  assert.equal(result.length, sentences.length);
  for (let i = 0; i < result.length; i++) {
    assert.ok(result[i]!.end >= result[i]!.start, `sentence ${i} end must not precede its own start`);
    if (i > 0) {
      assert.ok(result[i]!.start >= result[i - 1]!.end, `sentence ${i} must not start before sentence ${i - 1} ends`);
    }
  }
  assert.equal(result[result.length - 1]!.end, w[w.length - 1]!.end);
});
