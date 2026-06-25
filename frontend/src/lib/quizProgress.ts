import type { SyncQuizProgress } from '../types';

export interface QuizProgressSummary {
  /** Total students with any tracked progress for the active quiz. */
  total: number;
  /** How many have submitted. */
  submitted: number;
  /** How many are still answering (not yet submitted). */
  inProgress: number;
}

/**
 * Aggregates per-student sync quiz progress into class-level counts for the
 * master's overview. Pure so it can be unit-tested without rendering.
 */
export function summarizeQuizProgress(progress: SyncQuizProgress[]): QuizProgressSummary {
  const total = progress.length;
  const submitted = progress.filter((p) => p.submitted).length;
  return { total, submitted, inProgress: total - submitted };
}
