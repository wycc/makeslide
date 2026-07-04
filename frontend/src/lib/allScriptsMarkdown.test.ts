import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAllScriptsMarkdown } from './allScriptsMarkdown';

const labels = { pagePrefix: '第', pageSuffix: '頁' };

test('builds markdown headings with scripts, sorted by page number', () => {
  const pages = [{ page_number: 2 }, { page_number: 1 }];
  const scripts = { 1: 'first', 2: 'second' };
  assert.equal(
    buildAllScriptsMarkdown(pages, scripts, labels),
    '## 第1頁\nfirst\n\n## 第2頁\nsecond',
  );
});

test('emits an empty body for pages missing a script', () => {
  const pages = [{ page_number: 1 }, { page_number: 2 }];
  const scripts = { 1: 'only first' };
  assert.equal(
    buildAllScriptsMarkdown(pages, scripts, labels),
    '## 第1頁\nonly first\n\n## 第2頁\n',
  );
});

test('returns empty string for no pages', () => {
  assert.equal(buildAllScriptsMarkdown([], {}, labels), '');
});

test('does not mutate the input pages array', () => {
  const pages = [{ page_number: 3 }, { page_number: 1 }];
  buildAllScriptsMarkdown(pages, {}, labels);
  assert.deepEqual(pages.map((p) => p.page_number), [3, 1]);
});

test('honors custom prefix/suffix labels', () => {
  const pages = [{ page_number: 5 }];
  assert.equal(
    buildAllScriptsMarkdown(pages, { 5: 'x' }, { pagePrefix: 'Page ', pageSuffix: '' }),
    '## Page 5\nx',
  );
});
