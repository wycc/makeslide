import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MarkdownMath } from './MarkdownMath';

const html = (content: string): string => renderToStaticMarkup(createElement(MarkdownMath, { content }));

// 使用者截圖的內容：``` 圍起來的 Python，裡面的 `# 註解` 原本被當成標題放大。
const SAMPLE = [
  '```python',
  '    def forward(self, x):',
  '        # BUG: .item() turns the tensor into a plain Python float, so the',
  '        # autograd graph is cut. The new tensor has no link back to self.w.',
  '```',
].join('\n');

test('圍欄程式碼區塊渲染成 <pre><code>，縮排與 # 原樣保留', () => {
  const out = html(SAMPLE);
  assert.match(out, /<pre[^>]*data-lang="python"[^>]*><code[^>]*>    def forward\(self, x\):\n        # BUG:/);
  assert.doesNotMatch(out, /<h3|<h4/, '程式碼裡的 # 不是標題');
  assert.doesNotMatch(out, /```/, '圍欄本身不顯示');
});

test('區塊內不解析 Markdown 與數學，HTML 也不會被當成標籤', () => {
  const out = html('```\n**x** $a$ <b>hi</b>\n```');
  assert.ok(out.includes('**x** $a$ &lt;b&gt;hi&lt;/b&gt;'));
  assert.doesNotMatch(out, /<strong>|katex/);
});

test('區塊前後的文字照常解析；~~~ 也可以；沒結束的圍欄延伸到文末', () => {
  const out = html('# 標題\n~~~\ncode\n~~~\n**後面**');
  assert.match(out, /<h3[^>]*>標題<\/h3><pre[^>]*><code[^>]*>code<\/code><\/pre><p[^>]*><strong>後面<\/strong><\/p>/);
  const open = html('前\n```\na\n# b');
  assert.match(open, /<code[^>]*>a\n# b<\/code>/);
});

test('同一行的 ```x``` 仍是行內碼，不是圍欄', () => {
  const out = html('用 ```x``` 表示');
  assert.doesNotMatch(out, /<pre/);
});
