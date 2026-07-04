import test from 'node:test';
import assert from 'node:assert/strict';
import { splitWordsByPage } from '../src/routes/pdfs/narrationTranscript';

const timeline = [
  { page: 1, startMs: 0, endMs: 10000 },
  { page: 2, startMs: 10000, endMs: 20000 },
];

test('splitWordsByPage groups words into pages by their timestamp', () => {
  const words = [
    { word: 'hello', start: 1 }, // 1000ms -> page 1
    { word: 'world', start: 5 }, // 5000ms -> page 1
    { word: 'second', start: 12 }, // 12000ms -> page 2
    { word: 'page', start: 18 }, // 18000ms -> page 2
  ];
  assert.deepEqual(splitWordsByPage(words, timeline), { 1: 'hello world', 2: 'second page' });
});

test('splitWordsByPage assigns boundary word to the next page (half-open)', () => {
  assert.deepEqual(splitWordsByPage([{ word: 'x', start: 10 }], timeline), { 2: 'x' });
});

test('splitWordsByPage assigns words past the end to the last page', () => {
  assert.deepEqual(splitWordsByPage([{ word: 'tail', start: 25 }], timeline), { 2: 'tail' });
});

test('splitWordsByPage ignores blank/invalid words and empty timeline', () => {
  assert.deepEqual(splitWordsByPage([{ word: '  ', start: 1 }, { word: 'a', start: Number.NaN }], timeline), {});
  assert.deepEqual(splitWordsByPage([{ word: 'a', start: 1 }], []), {});
});
