import test from 'node:test';
import assert from 'node:assert/strict';

import { parseOutlineText, buildInsertionContext, renderNewSlideTexts } from '../src/worker/addPagesOutline';

test('parseOutlineText keeps slides with >=2 bullets and strips the Slide N: prefix', () => {
  const text = [
    'Slide 1: Intro',
    '- first point',
    '- second point',
    '',
    'Conclusion',
    '* wrap up a',
    '• wrap up b',
  ].join('\n');
  const slides = parseOutlineText(text);
  assert.deepEqual(slides, [
    { title: 'Intro', bullets: ['first point', 'second point'] },
    { title: 'Conclusion', bullets: ['wrap up a', 'wrap up b'] },
  ]);
});

test('parseOutlineText drops slides with fewer than two bullets', () => {
  const text = ['Thin slide', '- only one bullet', 'Next', '- a', '- b'].join('\n');
  const slides = parseOutlineText(text);
  assert.deepEqual(slides, [{ title: 'Next', bullets: ['a', 'b'] }]);
});

test('parseOutlineText ignores bullets before any title', () => {
  const slides = parseOutlineText(['- orphan bullet', '- another'].join('\n'));
  assert.deepEqual(slides, []);
});

test('buildInsertionContext returns empty string for no pages', () => {
  assert.equal(buildInsertionContext([], 3), '');
});

test('buildInsertionContext focuses on pages around the insertion point and labels them', () => {
  const pages = Array.from({ length: 10 }, (_, i) => ({ page_number: i + 1, text: `text ${i + 1}` }));
  const ctx = buildInsertionContext(pages, 5);
  // Head pages (1,2) plus the 5 before (1-5) and 5 after (6-10) the insertion point.
  assert.ok(ctx.includes('[第 5 頁]'));
  assert.ok(ctx.includes('[第 6 頁]'));
  // De-duplicated and sorted ascending: page 1 appears once, before page 2.
  assert.equal(ctx.indexOf('[第 1 頁]'), ctx.lastIndexOf('[第 1 頁]'));
  assert.ok(ctx.indexOf('[第 1 頁]') < ctx.indexOf('[第 2 頁]'));
});

test('buildInsertionContext skips blank pages and honours maxChars', () => {
  const pages = [
    { page_number: 1, text: '   ' },
    { page_number: 2, text: 'kept' },
  ];
  const ctx = buildInsertionContext(pages, 1);
  assert.ok(!ctx.includes('[第 1 頁]'));
  assert.ok(ctx.includes('[第 2 頁]'));
  assert.equal(buildInsertionContext(pages, 1, 12, 5).length, 5);
});

test('renderNewSlideTexts renders sequential Slide N: headers with bullet lines', () => {
  const out = renderNewSlideTexts(
    [{ title: 'A', bullets: ['x', 'y'] }, { title: 'B', bullets: ['z'] }],
    7,
  );
  assert.deepEqual(out, [
    { pageNumber: 7, content: 'Slide 7: A\n- x\n- y' },
    { pageNumber: 8, content: 'Slide 8: B\n- z' },
  ]);
});
