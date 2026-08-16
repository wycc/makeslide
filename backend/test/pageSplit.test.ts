import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSplitMessages, keepEffectsBeforeSplit } from '../src/services/pageSplit';

/** Splitting an over-full page in two — services/pageSplit.ts. */

test('the prompt numbers the sentences, because the answer is an index into them', () => {
  const messages = buildSplitMessages(['第一句。', '第二句。', '第三句。'], '要點 A\n要點 B', 'zh-TW');
  const user = messages.find((m) => m.role === 'user')?.content ?? '';
  assert.match(user, /1\. 第一句。/);
  assert.match(user, /3\. 第三句。/);
  assert.match(user, /要點 A/);
  const system = messages.find((m) => m.role === 'system')?.content ?? '';
  // Both halves must be non-empty, or the split produces a page the user has to delete.
  assert.match(system, /總句數 - 1/);
  // Splitting is not rewriting: the transcript is cut, never regenerated.
  assert.match(system, /不要改寫逐字稿/);
});

test('the prompt states the deck output language, so the divided text is not translated', () => {
  assert.match(buildSplitMessages(['a.'], '', 'en').find((m) => m.role === 'system')!.content, /英文/);
  assert.match(buildSplitMessages(['a.'], '', 'zh-TW').find((m) => m.role === 'system')!.content, /繁體中文/);
});

test('effects anchored to sentences that moved are dropped, the rest are kept', () => {
  // A transcript-line effect whose sentence is now on the *other* page would fire on whatever
  // sentence happens to sit at that index — the wrong words, rather than nothing.
  const effects = [
    { id: 'a', startTrigger: { type: 'transcript-line', line: 0 } },
    { id: 'b', startTrigger: { type: 'transcript-line', line: 2 } },
    { id: 'c', startTrigger: { type: 'transcript-line', line: 3 } },
    { id: 'd' },
  ];
  const kept = keepEffectsBeforeSplit(effects, 3);
  assert.deepEqual(kept.map((e) => e.id), ['a', 'b', 'd']);
});

test('time-based effects survive a split untouched', () => {
  const effects = [{ id: 'x' }, { id: 'y' }];
  assert.equal(keepEffectsBeforeSplit(effects, 1).length, 2);
});
