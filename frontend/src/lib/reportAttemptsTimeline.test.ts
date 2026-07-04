import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flattenAttemptsChronologically } from './reportAttemptsTimeline';

const attempt = (attempt_id: number, submitted_at: string) => ({ attempt_id, submitted_at });

test('flattens attempts across students and sorts by submitted_at ascending', () => {
  const students = [
    { client_id: 'a', attempts: [attempt(1, '2026-07-04T10:00:00Z'), attempt(2, '2026-07-04T12:00:00Z')] },
    { client_id: 'b', attempts: [attempt(3, '2026-07-04T11:00:00Z')] },
  ];
  const result = flattenAttemptsChronologically(students);
  assert.deepEqual(result.map((a) => a.attempt_id), [1, 3, 2]);
});

test('attaches the owning student client_id to each attempt', () => {
  const students = [
    { client_id: 'alice', attempts: [attempt(1, '2026-07-04T10:00:00Z')] },
    { client_id: 'bob', attempts: [attempt(2, '2026-07-04T09:00:00Z')] },
  ];
  const result = flattenAttemptsChronologically(students);
  assert.deepEqual(result.map((a) => [a.client_id, a.attempt_id]), [['bob', 2], ['alice', 1]]);
});

test('returns an empty array when there are no students or no attempts', () => {
  assert.deepEqual(flattenAttemptsChronologically([]), []);
  assert.deepEqual(flattenAttemptsChronologically([{ client_id: 'x', attempts: [] }]), []);
});

test('does not mutate the input students or their attempts arrays', () => {
  const attempts = [attempt(2, '2026-07-04T12:00:00Z'), attempt(1, '2026-07-04T10:00:00Z')];
  const students = [{ client_id: 'a', attempts }];
  flattenAttemptsChronologically(students);
  assert.deepEqual(attempts.map((a) => a.attempt_id), [2, 1]);
});
