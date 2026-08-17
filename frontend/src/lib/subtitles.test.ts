import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSentenceTimeline, estimateNarrationSeconds, splitScriptIntoSentences } from './subtitles';

// ── splitScriptIntoSentences ──────────────────────────────────────────────

test('splitScriptIntoSentences returns an empty array for blank input', () => {
  assert.deepEqual(splitScriptIntoSentences(''), []);
  assert.deepEqual(splitScriptIntoSentences('   \n\t  '), []);
});

test('splitScriptIntoSentences returns an empty array for input that is only tone markers', () => {
  assert.deepEqual(splitScriptIntoSentences('[[興奮地]]'), []);
  assert.deepEqual(splitScriptIntoSentences('[[excitedly]]  [[calmly]]'), []);
});

test('splitScriptIntoSentences strips tone markers and splits a single Chinese sentence', () => {
  assert.deepEqual(splitScriptIntoSentences('[[興奮地]]今天是大日子！'), ['今天是大日子！']);
});

test('splitScriptIntoSentences strips single-bracket English tone tags from subtitles', () => {
  assert.deepEqual(
    splitScriptIntoSentences('[cheerfully] 大家好，[seriously] 我們先看重點。'),
    ['大家好， 我們先看重點。'],
  );
  assert.deepEqual(splitScriptIntoSentences('[very fast] 快速帶過這句。'), ['快速帶過這句。']);
});

test('splitScriptIntoSentences keeps numeric citations like [1] intact', () => {
  assert.deepEqual(splitScriptIntoSentences('根據研究[1]的結論。'), ['根據研究[1]的結論。']);
});

test('splitScriptIntoSentences splits multiple Chinese sentences on terminal punctuation', () => {
  const result = splitScriptIntoSentences('今天天氣很好。我們出去走走吧！你覺得呢？');
  assert.deepEqual(result, ['今天天氣很好。', '我們出去走走吧！', '你覺得呢？']);
});

test('splitScriptIntoSentences splits multiple English sentences on terminal punctuation', () => {
  const result = splitScriptIntoSentences('Hello there! How are you? I am fine.');
  assert.deepEqual(result, ['Hello there!', 'How are you?', 'I am fine.']);
});

test('splitScriptIntoSentences keeps a trailing fragment with no terminal punctuation as its own sentence', () => {
  const result = splitScriptIntoSentences('完結句子！trailing fragment without punctuation');
  assert.deepEqual(result, ['完結句子！', 'trailing fragment without punctuation']);
});

test('splitScriptIntoSentences treats an ASCII period as plain text, not a sentence terminator', () => {
  // Only full-width "。" (and "！？!?；;") are treated as terminators — a lone
  // ASCII "." (e.g. inside "Mr." or a decimal number) must not split the
  // sentence, so a whole period-only sentence stays intact.
  const result = splitScriptIntoSentences('First sentence. still no real terminator here');
  assert.deepEqual(result, ['First sentence. still no real terminator here']);
});

test('splitScriptIntoSentences strips multiple tone markers interspersed with text', () => {
  const result = splitScriptIntoSentences('[[平靜地]]第一句。[[興奮地]]第二句！');
  assert.deepEqual(result, ['第一句。', '第二句！']);
});

// ── buildSentenceTimeline ────────────────────────────────────────────────

test('buildSentenceTimeline returns an empty array when duration is zero or negative', () => {
  assert.deepEqual(buildSentenceTimeline(['hello'], 0), []);
  assert.deepEqual(buildSentenceTimeline(['hello'], -5), []);
});

test('buildSentenceTimeline returns an empty array when duration is not finite', () => {
  assert.deepEqual(buildSentenceTimeline(['hello'], Number.NaN), []);
  assert.deepEqual(buildSentenceTimeline(['hello'], Number.POSITIVE_INFINITY), []);
});

test('buildSentenceTimeline returns an empty array when there are no sentences', () => {
  assert.deepEqual(buildSentenceTimeline([], 10), []);
});

test('buildSentenceTimeline assigns the full duration to a single sentence', () => {
  const result = buildSentenceTimeline(['Hello world.'], 5);
  assert.equal(result.length, 1);
  assert.equal(result[0]!.start, 0);
  assert.equal(result[0]!.end, 5);
  assert.equal(result[0]!.text, 'Hello world.');
});

test('buildSentenceTimeline produces contiguous, increasing segments that exactly cover the duration', () => {
  const sentences = ['第一句話。', 'Second sentence!', '第三句包含數字123。'];
  const duration = 12;
  const result = buildSentenceTimeline(sentences, duration);
  assert.equal(result.length, 3);
  for (let i = 0; i < result.length; i++) {
    assert.ok(result[i]!.end >= result[i]!.start, `segment ${i} should not have negative length`);
    if (i > 0) {
      assert.equal(result[i]!.start, result[i - 1]!.end, `segment ${i} should start where the previous one ended`);
    }
  }
  assert.equal(result[result.length - 1]!.end, duration);
});

test('buildSentenceTimeline gives a longer CJK sentence a larger share of the duration than a short one', () => {
  const sentences = ['短。', '這是一句包含很多中文字元的長句子，用來測試估時模型。'];
  const result = buildSentenceTimeline(sentences, 10);
  const shortLen = result[0]!.end - result[0]!.start;
  const longLen = result[1]!.end - result[1]!.start;
  assert.ok(longLen > shortLen);
});

test('buildSentenceTimeline treats mixed CJK/digit/Latin characters without throwing and keeps segments within [0, duration]', () => {
  const sentences = ['Mix中文123abc。', '另一句xyz456！'];
  const result = buildSentenceTimeline(sentences, 8);
  for (const seg of result) {
    assert.ok(seg.start >= 0);
    assert.ok(seg.end <= 8);
  }
});

test('estimateNarrationSeconds gives a page with no audio a usable length', () => {
  // Without this a no-audio page has no timeline: transcript-anchored effects fall back to their
  // literal start (0 for every effect the AI produces) and all fire at once.
  const sentences = ['這是第一句話。', '這是比較長的第二句話，內容多了一些。'];
  const total = estimateNarrationSeconds(sentences);
  assert.ok(total > 0);
  // Longer text takes longer to read, which is what makes the sentences land in sequence.
  assert.ok(estimateNarrationSeconds([sentences[1]!]) > estimateNarrationSeconds([sentences[0]!]));
  assert.equal(estimateNarrationSeconds([]), 0);
});

test('the estimated length drives a sequential timeline for a page with no audio', () => {
  const sentences = ['第一句。', '第二句。', '第三句。'];
  const timeline = buildSentenceTimeline(sentences, estimateNarrationSeconds(sentences));
  assert.equal(timeline.length, 3);
  assert.equal(timeline[0]!.start, 0);
  // Strictly increasing: each effect anchored to a sentence starts after the previous one.
  assert.ok(timeline[0]!.end > 0 && timeline[1]!.start >= timeline[0]!.end);
  assert.ok(timeline[2]!.start >= timeline[1]!.end);
});
