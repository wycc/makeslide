import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRewriteContext } from './ScriptRewriteDialog';
import type { PdfDetailPage } from '../../types';

function page(n: number): PdfDetailPage {
  return { page_number: n } as PdfDetailPage;
}

test('buildRewriteContext picks neighbouring saved scripts and trims', () => {
  const deck = [page(1), page(2), page(3)];
  const scripts: Record<number, string> = { 1: '  第一頁  ', 2: '第二頁', 3: ' 第三頁 ' };
  const ctx = buildRewriteContext(1, deck, scripts, '  目前草稿  ');
  assert.equal(ctx.previousScript, '第一頁');
  assert.equal(ctx.currentScript, '目前草稿');
  assert.equal(ctx.nextScript, '第三頁');
});

test('buildRewriteContext returns empty neighbours at deck boundaries', () => {
  const deck = [page(1), page(2)];
  const scripts: Record<number, string> = { 1: 'A', 2: 'B' };
  const first = buildRewriteContext(0, deck, scripts, 'draft');
  assert.equal(first.previousScript, '');
  assert.equal(first.nextScript, 'B');
  const last = buildRewriteContext(1, deck, scripts, 'draft');
  assert.equal(last.previousScript, 'A');
  assert.equal(last.nextScript, '');
});

test('buildRewriteContext tolerates missing saved scripts', () => {
  const deck = [page(1), page(2), page(3)];
  const ctx = buildRewriteContext(1, deck, {}, 'draft');
  assert.equal(ctx.previousScript, '');
  assert.equal(ctx.nextScript, '');
  assert.equal(ctx.currentScript, 'draft');
});
