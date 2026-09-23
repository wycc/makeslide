import test from 'node:test';
import assert from 'node:assert/strict';
import { latestTutorMerge } from './quizTutorMerge';
import type { QuizAttemptSession } from '../types';

const attempt = (tutor_merged_at: string | null) => ({ tutor_merged_at }) as unknown as QuizAttemptSession['attempts'][number];

test('latestTutorMerge is the newest merge stamp across every session, null when never merged', () => {
  assert.equal(latestTutorMerge([]), null);
  assert.equal(latestTutorMerge([{ attempts: [attempt(null)] } as unknown as QuizAttemptSession]), null);
  const sessions = [
    { attempts: [attempt('2026-09-20T01:00:00.000Z'), attempt(null)] },
    { attempts: [attempt('2026-09-22T03:00:00.000Z')] },
  ] as unknown as QuizAttemptSession[];
  assert.equal(latestTutorMerge(sessions), '2026-09-22T03:00:00.000Z');
});
