import test from 'node:test';
import assert from 'node:assert/strict';
import { safeMarkdownLinkHref, opensInNewTab } from './markdownLink';

test('接受 http / https / mailto', () => {
  assert.equal(safeMarkdownLinkHref('https://example.com/a?b=1#c'), 'https://example.com/a?b=1#c');
  assert.equal(safeMarkdownLinkHref('http://example.com'), 'http://example.com');
  assert.equal(safeMarkdownLinkHref('mailto:someone@example.com'), 'mailto:someone@example.com');
  // scheme 大小寫不該影響判斷
  assert.equal(safeMarkdownLinkHref('HTTPS://example.com'), 'HTTPS://example.com');
  // 前後空白是打字的產物，不是網址的一部分
  assert.equal(safeMarkdownLinkHref('  https://example.com  '), 'https://example.com');
});

test('接受站內絕對路徑，但不接受 protocol-relative', () => {
  assert.equal(safeMarkdownLinkHref('/play/abc123'), '/play/abc123');
  // 看起來像站內路徑，其實會連到外站
  assert.equal(safeMarkdownLinkHref('//evil.example.com'), null);
});

test('擋掉會執行或偽造內容的 scheme', () => {
  for (const bad of [
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'data:text/html;base64,PHNjcmlwdD4=',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
  ]) {
    assert.equal(safeMarkdownLinkHref(bad), null, `${bad} 不該通過`);
  }
});

test('沒有 scheme 的相對寫法不接受', () => {
  // 瀏覽器會把它當成相對路徑，連出去的地方多半不是作者想的那個——原樣顯示比默默連錯好。
  assert.equal(safeMarkdownLinkHref('www.example.com'), null);
  assert.equal(safeMarkdownLinkHref('docs/readme.md'), null);
  assert.equal(safeMarkdownLinkHref(''), null);
  assert.equal(safeMarkdownLinkHref('   '), null);
});

test('換行拆開的 scheme 不算 scheme', () => {
  assert.equal(safeMarkdownLinkHref('java\nscript:alert(1)'), null);
});

test('只有外部連結開新分頁', () => {
  assert.equal(opensInNewTab('https://example.com'), true);
  assert.equal(opensInNewTab('mailto:a@b.c'), true);
  assert.equal(opensInNewTab('/play/abc'), false);
});
