import test from 'node:test';
import assert from 'node:assert/strict';
import { clearQuizAnswerDraft, isBlankAnswerSheet, readQuizAnswerDraft, writeQuizAnswerDraft } from './quizAnswerDraft';

/**
 * 作答草稿（使用者回報「離開後回不到測驗中」，2026-11-02）：重整／切 App 回來後答案原本全部歸零，
 * 學生得從第一題重答，老師那邊 answered_count 也掉回 0。草稿以 sessionKey 為鍵存在本機。
 */
function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { data.set(k, v); },
    removeItem: (k: string) => { data.delete(k); },
  };
}

test('a draft survives a round trip and is scoped to the session key', () => {
  const store = fakeStorage();
  writeQuizAnswerDraft('7:qs-a', { q1: [0], q2: [1, 2] }, store);
  assert.deepEqual(readQuizAnswerDraft('7:qs-a', store), { q1: [0], q2: [1, 2] });
  assert.deepEqual(readQuizAnswerDraft('7:qs-b', store), {}, 'a new session must not inherit the previous answers');
  clearQuizAnswerDraft('7:qs-a', store);
  assert.deepEqual(readQuizAnswerDraft('7:qs-a', store), {});
});

test('corrupt, foreign or empty stored data reads as no draft instead of throwing', () => {
  assert.deepEqual(readQuizAnswerDraft('7:qs-a', fakeStorage({ 'makeslide.quiz_answer_draft.7:qs-a': '{oops' })), {});
  assert.deepEqual(readQuizAnswerDraft('7:qs-a', fakeStorage({ 'makeslide.quiz_answer_draft.7:qs-a': '[1,2]' })), {});
  assert.deepEqual(
    readQuizAnswerDraft('7:qs-a', fakeStorage({ 'makeslide.quiz_answer_draft.7:qs-a': '{"q1":["x",1,1,-2],"q2":[]}' })),
    { q1: [1] },
    'only whole non-negative indices survive, deduplicated; an empty pick is dropped',
  );
  assert.deepEqual(readQuizAnswerDraft('', fakeStorage()), {}, 'no session key → no draft');
});

test('a storage that throws (private mode, quota) does not break answering', () => {
  const throwing = {
    getItem: () => { throw new Error('denied'); },
    setItem: () => { throw new Error('quota'); },
    removeItem: () => { throw new Error('denied'); },
  };
  assert.deepEqual(readQuizAnswerDraft('7:qs-a', throwing), {});
  assert.doesNotThrow(() => writeQuizAnswerDraft('7:qs-a', { q1: [0] }, throwing));
  assert.doesNotThrow(() => clearQuizAnswerDraft('7:qs-a', throwing));
});

test('isBlankAnswerSheet spots the sheets that must never be recorded', () => {
  assert.equal(isBlankAnswerSheet({}), true, 'nothing answered at all');
  assert.equal(isBlankAnswerSheet({ q1: [], q2: [] }), true, 'touched but every pick cleared');
  assert.equal(isBlankAnswerSheet({ q1: [], q2: [3] }), false, 'one real answer is a real attempt');
});
