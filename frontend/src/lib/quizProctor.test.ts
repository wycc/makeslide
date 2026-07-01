import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateViolation,
  shouldCountViolation,
  isQuizLockedOut,
  markQuizLockedOut,
  isQuizStarted,
  markQuizStarted,
  isQuizFinished,
  markQuizFinished,
  DEFAULT_MAX_VIOLATIONS,
} from './quizProctor';

test('evaluateViolation warns within the allowance and locks once exceeded', () => {
  // 預設允許一次：第一次違規 → warn，第二次 → lock。
  assert.deepEqual(evaluateViolation(0), { nextCount: 1, action: 'warn' });
  assert.deepEqual(evaluateViolation(1), { nextCount: 2, action: 'lock' });
  assert.equal(DEFAULT_MAX_VIOLATIONS, 1);
});

test('evaluateViolation respects a custom allowance', () => {
  assert.equal(evaluateViolation(2, 2).action, 'lock');
  assert.equal(evaluateViolation(1, 2).action, 'warn');
});

test('shouldCountViolation debounces events within the window', () => {
  assert.equal(shouldCountViolation(null, 1000), true);
  assert.equal(shouldCountViolation(1000, 1500, 1200), false);
  assert.equal(shouldCountViolation(1000, 2200, 1200), true);
});

test('lockout state round-trips through a storage-like object', () => {
  const map = new Map<string, string>();
  const storage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); },
  };
  const key = 'quiz-7:session-abc';
  assert.equal(isQuizLockedOut(key, storage), false);
  markQuizLockedOut(key, storage);
  assert.equal(isQuizLockedOut(key, storage), true);
  // 不同 session 不受影響。
  assert.equal(isQuizLockedOut('quiz-7:session-xyz', storage), false);
});

test('started flag round-trips and is independent from lockout', () => {
  const map = new Map<string, string>();
  const storage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); },
  };
  const key = 'quiz-9:session-1';
  assert.equal(isQuizStarted(key, storage), false);
  markQuizStarted(key, storage);
  assert.equal(isQuizStarted(key, storage), true);
  // started 與 lockout 使用不同前綴、互不影響。
  assert.equal(isQuizLockedOut(key, storage), false);
});

test('finished flag round-trips and is independent from started/lockout', () => {
  const map = new Map<string, string>();
  const storage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); },
  };
  const key = 'quiz-3:session-9';
  assert.equal(isQuizFinished(key, storage), false);
  markQuizFinished(key, storage);
  assert.equal(isQuizFinished(key, storage), true);
  // finished 使用獨立前綴，不影響 started / lockout 判斷。
  assert.equal(isQuizStarted(key, storage), false);
  assert.equal(isQuizLockedOut(key, storage), false);
  // 不同 session 不受影響。
  assert.equal(isQuizFinished('quiz-3:session-other', storage), false);
});

test('lockout helpers no-op safely with an empty session key', () => {
  const map = new Map<string, string>();
  const storage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); },
  };
  markQuizLockedOut('', storage);
  assert.equal(map.size, 0);
  assert.equal(isQuizLockedOut('', storage), false);
});
