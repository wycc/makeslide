import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/** 本頁問答的回答要用 Markdown＋KaTeX 渲染，數學式才會正確顯示（使用者要求，2026-10-26）。 */
const SRC = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), 'PlayPageSidebar.tsx'), 'utf8');

test('page chat answers render through MarkdownMath; the user\'s own messages stay plain text', () => {
  const list = /chatHistory\.map\(\(m, idx\) => \(([\s\S]*?)\n          \)\)\}/.exec(SRC)?.[1] ?? '';
  assert.ok(list, 'chat list found');
  assert.match(list, /m\.role === 'assistant' \? \(\s*(\/\/[^\n]*\n\s*)?<MarkdownMath content=\{m\.content\}/);
  assert.match(list, /<span className="whitespace-pre-wrap">\{m\.content\}<\/span>/);
});
