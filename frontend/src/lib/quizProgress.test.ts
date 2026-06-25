import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeQuizProgress } from './quizProgress';
import type { SyncQuizProgress } from '../types';

function p(over: Partial<SyncQuizProgress> = {}): SyncQuizProgress {
  return {
    client_id: 'c1',
    code: null,
    quiz_id: 1,
    answered_count: 0,
    total_questions: 3,
    submitted: false,
    updated_at: '2026-06-25T00:00:00.000Z',
    ...over,
  };
}

test('summarizeQuizProgress counts empty as all zero', () => {
  assert.deepEqual(summarizeQuizProgress([]), { total: 0, submitted: 0, inProgress: 0 });
});

test('summarizeQuizProgress splits submitted vs in-progress', () => {
  const out = summarizeQuizProgress([
    p({ submitted: true }),
    p({ submitted: true }),
    p({ submitted: false }),
  ]);
  assert.deepEqual(out, { total: 3, submitted: 2, inProgress: 1 });
});

test('summarizeQuizProgress handles all submitted and all in-progress', () => {
  assert.deepEqual(summarizeQuizProgress([p({ submitted: true })]), { total: 1, submitted: 1, inProgress: 0 });
  assert.deepEqual(summarizeQuizProgress([p(), p()]), { total: 2, submitted: 0, inProgress: 2 });
});
