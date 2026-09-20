import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MarkdownMath } from './MarkdownMath';

const html = (content: string): string => renderToStaticMarkup(createElement(MarkdownMath, { content }));
// 只留結構：去掉 class 屬性，方便比對巢狀。
const structure = (content: string): string => html(content).replace(/ class="[^"]*"/g, '').replace(/^<div>|<\/div>$/g, '');

test('縮排的項目成為上一個項目的子清單，退回縮排就回到上層', () => {
  const out = structure('- 甲\n  - 甲一\n  - 甲二\n    - 甲二 a\n- 乙');
  assert.equal(out, '<ul><li>甲<ul><li>甲一</li><li>甲二<ul><li>甲二 a</li></ul></li></ul></li><li>乙</li></ul>');
});

test('四個空格與 Tab 也算一層；退回到中間的縮排歸到最近的上層', () => {
  assert.equal(structure('- 甲\n    - 子\n- 乙'), '<ul><li>甲<ul><li>子</li></ul></li><li>乙</li></ul>');
  assert.equal(structure('- 甲\n\t- 子\n- 乙'), '<ul><li>甲<ul><li>子</li></ul></li><li>乙</li></ul>');
  assert.equal(structure('- 甲\n    - 子\n  - 丙'), '<ul><li>甲<ul><li>子</li><li>丙</li></ul></li></ul>');
});

test('有序清單可以巢狀在無序清單裡，反之亦然', () => {
  assert.equal(structure('1. 第一\n   - 細節\n   - 細節二\n2. 第二'), '<ol><li>第一<ul><li>細節</li><li>細節二</li></ul></li><li>第二</li></ol>');
  assert.equal(structure('- 項目\n  1. 步驟一\n  2. 步驟二'), '<ul><li>項目<ol><li>步驟一</li><li>步驟二</li></ol></li></ul>');
});

test('子項的行內語法照樣生效；平的清單與以前一樣', () => {
  assert.match(html('- 甲\n  - **重點** $x$'), /<li>甲<ul[^>]*><li><strong>重點<\/strong> <span>/);
  assert.equal(structure('- 甲\n- 乙\n\n1. 一\n2. 二'), '<ul><li>甲</li><li>乙</li></ul><ol><li>一</li><li>二</li></ol>');
  assert.equal(structure('- 甲\n1. 一'), '<ul><li>甲</li></ul><ol><li>一</li></ol>', '最外層換種類仍另起區塊');
});
