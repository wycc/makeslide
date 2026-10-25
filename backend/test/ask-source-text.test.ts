import test from 'node:test';
import assert from 'node:assert/strict';
import { chunkSourceText, queryTerms, selectSourceExcerpts, searchSourceText } from '../src/services/askSourceText';

// 回報（2026-10-25）：AI 導師只拿到原始來源全文的前 12,000 字，論文後半段的內容導師完全看不到。
const filler = (tag: string, n: number) =>
  Array.from({ length: n }, (_, i) => `${tag} paragraph ${i}: general background text that says nothing specific.`).join('\n\n');
const LONG = [
  'Abstract: we study causal intervention for whole slide image classification.',
  filler('intro', 200),
  '我們以後門調整（backdoor adjustment）消除混淆因子，混淆字典大小設為 64。',
  filler('results', 200),
].join('\n\n');

test('chunks keep exact positions in the original text', () => {
  const chunks = chunkSourceText(LONG);
  assert.ok(chunks.length > 5);
  for (const c of chunks) assert.equal(LONG.slice(c.start, c.start + c.text.length), c.text);
  const oneLongParagraph = 'x'.repeat(5000);
  const hard = chunkSourceText(oneLongParagraph);
  assert.equal(hard.map((c) => c.text).join(''), oneLongParagraph);
});

test('a short source is sent whole', () => {
  const r = selectSourceExcerpts('  短短的原文  ', 'q', '', 12000);
  assert.deepEqual(r, { text: '短短的原文', partial: false, totalChars: 5, includedChars: 5 });
});

test('a long source keeps the beginning plus the passage the question is about, even deep in the text', () => {
  assert.ok(LONG.length > 12000 * 1.3);
  const deepAt = LONG.indexOf('後門調整');
  assert.ok(deepAt > 12000, 'the answer sits beyond the old head-only cut');
  const r = selectSourceExcerpts(LONG, '後門調整的混淆字典大小是多少？', '', 12000);
  assert.equal(r.partial, true);
  assert.ok(r.includedChars <= 12000);
  assert.match(r.text, /^【原文第 1–/, 'starts with the beginning');
  assert.match(r.text, /Abstract/);
  assert.match(r.text, /混淆字典大小設為 64/, 'the relevant deep passage is included');
  assert.match(r.text, /……（略去第 \d+–\d+ 字）……/, 'gaps are marked with positions');
  assert.ok(r.text.indexOf('Abstract') < r.text.indexOf('混淆字典'), 'kept in original order');
});

test('the current page also steers the selection', () => {
  const r = selectSourceExcerpts(LONG, '這一頁在說什麼？', '投影片：後門調整 backdoor adjustment', 12000);
  assert.match(r.text, /混淆字典大小設為 64/);
});

test('query terms: latin words without stopwords, CJK bigrams', () => {
  assert.deepEqual(queryTerms('What is the Backdoor adjustment'), ['backdoor', 'adjustment']);
  assert.deepEqual(queryTerms('後門調整'), ['後門', '門調', '調整']);
});

test('search returns the matching chunk with its position', () => {
  const hits = searchSourceText(LONG, 'backdoor 混淆');
  assert.ok(hits.length >= 1);
  const hit = hits.find((h) => h.text.includes('混淆字典'));
  assert.ok(hit);
  assert.equal(LONG.slice(hit.start, hit.start + hit.text.length), hit.text);
});
