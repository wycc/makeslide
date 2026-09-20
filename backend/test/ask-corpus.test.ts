/**
 * Which pages reach the AI tutor.
 *
 * Reported from the deck this was found on: the student was on page 31 of 36 and asked about it,
 * and the tutor answered that it had no text for page 31 and asked them to paste it in. The corpus
 * was every page joined in order and cut at 14,000 characters — that deck is over 100,000, so the
 * prompt held pages 1–5 and nothing else. The page being asked about is the one page that cannot
 * be missing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAskCorpus,
  describeCorpusCoverage,
  formatPageRanges,
  type AskCorpusPage,
} from '../src/services/askCorpus';

const page = (n: number, chars = 1400): AskCorpusPage => ({
  pageNumber: n,
  text: '',
  script: `第 ${n} 頁的逐字稿。`.padEnd(chars, '字'),
});
const deck = (count: number, chars = 1400): AskCorpusPage[] =>
  Array.from({ length: count }, (_, i) => page(i + 1, chars));

test('the page the student is on is always in the prompt', () => {
  // The regression, at the size it was reported: 36 pages against a budget that fits about nine.
  const result = buildAskCorpus(deck(36), 31, 14000);
  assert.ok(result.includedPages.includes(31), '學生所在頁一定要在提示詞裡');
  assert.match(result.corpus, /# 第 31 頁（學生目前所在頁）/);
  assert.match(result.corpus, /第 31 頁的逐字稿/);
});

test('even a page far bigger than the whole budget still goes in', () => {
  const pages = [page(1, 500), { ...page(2, 40000) }, page(3, 500)];
  const result = buildAskCorpus(pages, 2, 14000);
  assert.deepEqual(result.includedPages, [2], '只放得下所在頁時，放的就是它');
  assert.match(result.corpus, /# 第 2 頁（學生目前所在頁）/);
  assert.deepEqual(result.omittedPages, [1, 3]);
});

test('the budget is spent around the student, not from the front of the deck', () => {
  const result = buildAskCorpus(deck(36), 31, 14000);
  // Nine-ish pages fit; they should be the ones next to page 31.
  assert.ok(result.includedPages.every((p) => Math.abs(p - 31) <= 6), `選到的頁面應該集中在第 31 頁附近，實際為 ${result.includedPages}`);
  assert.ok(result.includedPages.includes(30) && result.includedPages.includes(32), '前後頁最該留下');
  assert.ok(!result.includedPages.includes(1), '不該再把預算花在離題的第 1 頁');
  // Still in reading order, so "跨頁說明" reads as a lesson rather than a shuffled pile.
  assert.deepEqual([...result.includedPages].sort((a, b) => a - b), result.includedPages);
});

test('a deck that fits keeps every page, and says so', () => {
  const result = buildAskCorpus(deck(5, 200), 3, 14000);
  assert.deepEqual(result.includedPages, [1, 2, 3, 4, 5]);
  assert.deepEqual(result.omittedPages, []);
  assert.match(describeCorpusCoverage(result, 5), /已包含這份簡報全部 5 頁/);
});

test('what was left out is named, with the tools that can fetch it', () => {
  const result = buildAskCorpus(deck(36), 31, 14000);
  const coverage = describeCorpusCoverage(result, 36);
  assert.match(coverage, /未附上的頁面/);
  assert.match(coverage, /get_page_script/, '要告訴模型可以自己去讀');
  // The whole point: it must not go back to the student for material the deck already has.
  assert.match(coverage, /不要向學生索取/);
  // Expanded back out, the printed ranges have to be exactly the pages that were left out —
  // a list that quietly drops one is a page the tutor will never know to fetch.
  const printed = /未附上的頁面：第 (.+) 頁。/.exec(coverage)![1]!;
  const listed = printed.split('、').flatMap((part) => {
    const range = /^(\d+)–(\d+)$/.exec(part);
    if (!range) return [Number(part)];
    const [from, to] = [Number(range[1]), Number(range[2])];
    return Array.from({ length: to - from + 1 }, (_, i) => from + i);
  });
  assert.deepEqual(listed, result.omittedPages);
});

test('a page with nothing on it is not something a tool can fix', () => {
  const pages = [page(1, 200), { pageNumber: 2, text: '   ', script: '' }, page(3, 200)];
  const result = buildAskCorpus(pages, 1, 14000);
  assert.deepEqual(result.emptyPages, [2]);
  assert.deepEqual(result.omittedPages, [], '空白頁不是「沒附上」，去讀也讀不到東西');
});

test('page lists read as ranges', () => {
  assert.equal(formatPageRanges([3, 7, 12, 13, 14, 15]), '3、7、12–15');
  assert.equal(formatPageRanges([1, 2]), '1、2');
  assert.equal(formatPageRanges([9]), '9');
  assert.equal(formatPageRanges([]), '');
});

/**
 * The endpoint has to use the selection *and* stop claiming it has everything: the old system
 * prompt told the model it was being given every page of the deck, so a model missing a page
 * concluded the page did not exist and asked the student for it, rather than reaching for the
 * `get_page_*` tools it was holding all along.
 */
test('the ask endpoint builds its corpus this way and describes what it got', async () => {
  const fs = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const route = fs.readFileSync(fileURLToPath(new URL('../src/routes/pdfs/page-operations.ts', import.meta.url)), 'utf8');
  assert.match(route, /buildAskCorpus\(corpusPages, n, ASK_DECK_CORPUS_MAX_CHARS\)/);
  assert.match(route, /describeCorpusCoverage\(corpusResult, allPages\.length\)/, '提示詞要附上涵蓋範圍說明');
  // The blunt tail-cut must be gone, or it would truncate the careful selection all over again.
  assert.doesNotMatch(route, /corpus\.slice\(0, ASK_DECK_CORPUS_MAX_CHARS\)/);
  assert.doesNotMatch(route, /你會獲得整份簡報所有頁面的頁面文字與逐字稿/, '不可以再宣稱「所有頁面都給你了」');
  assert.match(route, /不可以要求學生貼上頁面內容或截圖/);
});
