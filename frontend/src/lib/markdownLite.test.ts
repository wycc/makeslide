import test from 'node:test';
import assert from 'node:assert/strict';
import { parseInline, parseMarkdownLite } from './markdownLite';

test('parseInline splits bold segments in order', () => {
  assert.deepEqual(parseInline('a **b** c'), [
    { text: 'a ', bold: false },
    { text: 'b', bold: true },
    { text: ' c', bold: false },
  ]);
});

test('parseInline returns a single empty segment for empty input', () => {
  assert.deepEqual(parseInline(''), [{ text: '', bold: false }]);
});

test('parseMarkdownLite parses headings with level capped at 3', () => {
  const blocks = parseMarkdownLite('# A\n## B\n### C');
  assert.deepEqual(blocks.map((b) => (b.type === 'heading' ? b.level : null)), [1, 2, 3]);
});

test('parseMarkdownLite groups consecutive list items of the same kind', () => {
  const blocks = parseMarkdownLite('- one\n- two\n\n1. a\n2. b');
  assert.equal(blocks.length, 2);
  const [first, second] = blocks;
  assert.ok(first && first.type === 'list');
  assert.ok(second && second.type === 'list');
  if (first.type === 'list') {
    assert.equal(first.ordered, false);
    assert.equal(first.items.length, 2);
  }
  if (second.type === 'list') {
    assert.equal(second.ordered, true);
    assert.equal(second.items.length, 2);
  }
});

test('parseMarkdownLite merges consecutive text lines into one paragraph', () => {
  const blocks = parseMarkdownLite('line one\nline two\n\nnext');
  const paragraphs = blocks.filter((b) => b.type === 'paragraph');
  assert.equal(paragraphs.length, 2);
});

test('parseMarkdownLite ignores blank lines without emitting empty blocks', () => {
  const blocks = parseMarkdownLite('\n\n# Title\n\n\n');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]?.type, 'heading');
});
