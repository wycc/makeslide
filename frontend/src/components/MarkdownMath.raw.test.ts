import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MarkdownMath } from './MarkdownMath';

// 「原始格式」選項：raw 時不解析 Markdown／LaTeX，原文照輸出，排版壞掉時才看得到模型實際寫了什麼。
const html = (content: string, raw: boolean): string => renderToStaticMarkup(createElement(MarkdownMath, { content, raw }));

test('raw 模式原樣輸出 Markdown 與 LaTeX，不經 katex 也不產生標記', () => {
  const src = '**粗體** 與 $x^2$\n- 條列\n```\ncode\n```';
  const out = html(src, true);
  assert.doesNotMatch(out, /<strong>|katex|<li>|<pre/);
  assert.match(out, /\*\*粗體\*\* 與 \$x\^2\$/);
  assert.match(out, /whitespace-pre-wrap/, '要保留換行');
  assert.match(out, /data-raw-markdown/);
});

test('raw 模式的文字仍是 text node：HTML 會被跳脫，不會被當成標記', () => {
  const out = html('<img src=x onerror=alert(1)>', true);
  assert.doesNotMatch(out, /<img/);
  assert.match(out, /&lt;img/);
});

test('預設（非 raw）照常排版', () => {
  assert.match(html('**粗體**', false), /<strong>粗體<\/strong>/);
});

test('TutorQuizDialog 的題目、選項、解說都接上原始格式開關', () => {
  const src = fs.readFileSync(path.join(import.meta.dirname, '../pages/play/TutorQuizDialog.tsx'), 'utf8');
  for (const field of ['question.question', 'option', 'result.explanation']) {
    assert.match(src, new RegExp(`<MarkdownMath content=\\{${field.replace('.', '\\.')}\\} raw=\\{rawMarkdown\\}`), field);
  }
  assert.match(src, /play\.tutorQuiz\.rawMarkdown'/);
});
