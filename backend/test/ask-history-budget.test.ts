import test from 'node:test';
import assert from 'node:assert/strict';
import { budgetChatHistory } from '../src/routes/pdfs/askHistoryBudget';

const msg = (role: 'user' | 'assistant', content: string) => ({ role, content });

test('budgetChatHistory keeps everything when the whole history fits the budget', () => {
  const history = [msg('user', 'aaa'), msg('assistant', 'bbb'), msg('user', 'ccc')];
  assert.deepEqual(budgetChatHistory(history, 100), history);
});

test('budgetChatHistory drops the oldest turns first, keeping the most recent suffix', () => {
  const history = [
    msg('user', 'aaaa'), // 4
    msg('assistant', 'bbbb'), // 4
    msg('user', 'cc'), // 2
    msg('assistant', 'dd'), // 2
  ];
  // budget 4 fits only the last two (2 + 2), the older two are dropped.
  assert.deepEqual(budgetChatHistory(history, 4), [msg('user', 'cc'), msg('assistant', 'dd')]);
});

test('budgetChatHistory preserves oldest-first order in the kept suffix', () => {
  const history = [msg('user', 'x'.repeat(10)), msg('assistant', 'aa'), msg('user', 'bb')];
  const kept = budgetChatHistory(history, 4);
  assert.deepEqual(kept, [msg('assistant', 'aa'), msg('user', 'bb')]);
});

test('budgetChatHistory truncates (not drops) a lone newest message that exceeds the budget', () => {
  const history = [msg('assistant', 'old'), msg('user', 'y'.repeat(100))];
  const kept = budgetChatHistory(history, 20);
  assert.equal(kept.length, 1, 'keeps only the newest message');
  assert.equal(kept[0].role, 'user');
  assert.equal(kept[0].content.length, 20, 'content trimmed to the budget length');
  assert.ok(kept[0].content.startsWith('……（前略）……'), 'marks the elided prefix');
  // The most recent tail of the content is retained.
  assert.ok(kept[0].content.endsWith('y'));
});

test('budgetChatHistory returns [] for a non-positive budget', () => {
  const history = [msg('user', 'aaa')];
  assert.deepEqual(budgetChatHistory(history, 0), []);
  assert.deepEqual(budgetChatHistory(history, -5), []);
});

test('budgetChatHistory returns [] for empty history', () => {
  assert.deepEqual(budgetChatHistory([], 100), []);
});

test('budgetChatHistory does not mutate the input array or its messages', () => {
  const history = [msg('user', 'z'.repeat(50)), msg('assistant', 'k')];
  const snapshot = JSON.parse(JSON.stringify(history));
  budgetChatHistory(history, 5);
  assert.deepEqual(history, snapshot);
});
