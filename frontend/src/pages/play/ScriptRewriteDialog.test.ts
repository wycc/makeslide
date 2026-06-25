import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRewriteContext, popRewriteUndo } from './ScriptRewriteDialog';
import type { ChatMessage, PdfDetailPage } from '../../types';

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

test('popRewriteUndo returns null when there is nothing to undo', () => {
  assert.equal(popRewriteUndo([], []), null);
  const msgs: ChatMessage[] = [{ role: 'user', content: 'hi' }];
  assert.equal(popRewriteUndo(msgs, []), null);
});

test('popRewriteUndo restores the snapshot and drops the latest assistant message', () => {
  const messages: ChatMessage[] = [
    { role: 'user', content: '更精簡' },
    { role: 'assistant', content: '改寫後的逐字稿' },
  ];
  const result = popRewriteUndo(messages, ['原始逐字稿']);
  assert.ok(result);
  assert.equal(result.script, '原始逐字稿');
  assert.equal(result.undoStack.length, 0);
  assert.deepEqual(result.messages, [{ role: 'user', content: '更精簡' }]);
});

test('popRewriteUndo undoes one rewrite at a time across multiple rounds', () => {
  const messages: ChatMessage[] = [
    { role: 'user', content: '指示一' },
    { role: 'assistant', content: '結果一' },
    { role: 'user', content: '指示二' },
    { role: 'assistant', content: '結果二' },
  ];
  const first = popRewriteUndo(messages, ['稿v0', '稿v1']);
  assert.ok(first);
  assert.equal(first.script, '稿v1');
  assert.deepEqual(first.undoStack, ['稿v0']);
  // The latest (second) assistant message is removed, the first round stays.
  assert.deepEqual(first.messages, [
    { role: 'user', content: '指示一' },
    { role: 'assistant', content: '結果一' },
    { role: 'user', content: '指示二' },
  ]);

  const second = popRewriteUndo(first.messages, first.undoStack);
  assert.ok(second);
  assert.equal(second.script, '稿v0');
  assert.deepEqual(second.undoStack, []);
  assert.deepEqual(second.messages, [
    { role: 'user', content: '指示一' },
    { role: 'user', content: '指示二' },
  ]);
});
