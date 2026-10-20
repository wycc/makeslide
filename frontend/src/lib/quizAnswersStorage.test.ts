import test from 'node:test';
import assert from 'node:assert/strict';
import { clearStoredQuizAnswers, quizAnswersKey, readStoredQuizAnswers, writeStoredQuizAnswers } from './quizAnswersStorage';

// 使用者回報（2026-10-20）：分頁被回收或重開連結後作答全部重做。作答改成暫存到 localStorage 並還原。
function fakeStorage(): { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void; removeItem: (k: string) => void; map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => { map.set(k, v); }, removeItem: (k) => { map.delete(k); } };
}

test('the key is per quiz and per session; no session means no storage', () => {
  assert.equal(quizAnswersKey(34, 'qs-1'), 'makeslide.quiz_answers.34:qs-1');
  assert.equal(quizAnswersKey(34, null), null);
  assert.equal(quizAnswersKey(34, ''), null);
});

test('answers round-trip and can be cleared', () => {
  const store = fakeStorage();
  const key = quizAnswersKey(34, 'qs-1')!;
  writeStoredQuizAnswers(key, { q1: [2], q2: [0, 3] }, store);
  assert.deepEqual(readStoredQuizAnswers(key, store), { q1: [2], q2: [0, 3] });
  clearStoredQuizAnswers(key, store);
  assert.equal(readStoredQuizAnswers(key, store), null);
});

test('garbage or a wrong shape reads back as null, and bad entries are dropped', () => {
  const store = fakeStorage();
  store.setItem('k', 'not json');
  assert.equal(readStoredQuizAnswers('k', store), null);
  store.setItem('k', JSON.stringify([1, 2]));
  assert.equal(readStoredQuizAnswers('k', store), null);
  store.setItem('k', JSON.stringify({ q1: [1, 'x', -1, 2.5], q2: 'nope' }));
  assert.deepEqual(readStoredQuizAnswers('k', store), { q1: [1] });
});

test('a storage that throws never breaks answering', () => {
  const bad = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); }, removeItem: () => { throw new Error('denied'); } };
  assert.doesNotThrow(() => writeStoredQuizAnswers('k', { q1: [0] }, bad));
  assert.equal(readStoredQuizAnswers('k', bad), null);
  assert.doesNotThrow(() => clearStoredQuizAnswers('k', bad));
});
