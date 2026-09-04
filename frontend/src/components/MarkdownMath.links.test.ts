import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MarkdownMath } from './MarkdownMath';

// 把 Markdown 真的渲染成 HTML 來驗連結——網址把關的純邏輯在 lib/markdownLink.test.ts，
// 這裡驗的是「渲染器有沒有照著把關結果做」：安全的網址進得了 href，不安全的不會。
const html = (content: string): string => renderToStaticMarkup(createElement(MarkdownMath, { content }));

test('外部連結渲染成 <a>，並在新分頁開啟', () => {
  const out = html('看 [說明文件](https://example.com/docs)。');
  assert.match(out, /<a[^>]+href="https:\/\/example\.com\/docs"/);
  assert.match(out, /target="_blank"/);
  assert.match(out, /rel="noopener noreferrer"/);
  assert.match(out, />說明文件<\/a>/);
});

test('站內路徑不開新分頁', () => {
  const out = html('[第 3 頁](/play/abc123)');
  assert.match(out, /<a[^>]+href="\/play\/abc123"/);
  assert.doesNotMatch(out, /target="_blank"/, '站內連結留在原分頁，授課時不會整頁被導走');
});

test('危險的 scheme 不會變成連結，而是原樣顯示', () => {
  for (const bad of ['[點我](javascript:alert1)', '[點我](data:text/html;base64,PHN2Zz4=)']) {
    const out = html(bad);
    assert.doesNotMatch(out, /<a[ >]/, `${bad} 不該產生 <a>`);
    assert.ok(out.includes('點我'), '原樣顯示，讓寫的人看得出來自己寫了什麼');
  }
});

test('連結文字裡的行內語法照樣生效', () => {
  const out = html('[**重點**說明](https://example.com)');
  assert.match(out, /<a[^>]*>.*<strong>重點<\/strong>.*<\/a>/);
});

test('沒有連結語法的內容不受影響', () => {
  const out = html('**粗體**與 `程式碼`');
  assert.match(out, /<strong>粗體<\/strong>/);
  assert.match(out, /<code[^>]*>程式碼<\/code>/);
  assert.doesNotMatch(out, /<a[ >]/);
});
