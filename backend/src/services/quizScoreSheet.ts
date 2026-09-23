import { calcQuestionScore, normalizeQuestionScores, QUIZ_TOTAL_SCORE, type ScorableQuestion } from './quizScoring';

/**
 * Per-student, per-question score sheet for one quiz — the rows behind the teacher's
 * "download scores" CSV.
 *
 * Kept pure (no DB) so the numbers can be tested directly. The important property is that the
 * total agrees with what the history panel shows: the choice-question part is computed exactly as
 * `computeAttemptScore()` does (sum, round to 2 decimals, clamp to the 100-point pool), so for a
 * quiz without essays the sheet's total equals the stored `quiz_attempts.score`. Essay questions
 * are the one place the sheet knows more than that stored score — it never included them — so they
 * are added on top from the essay-grading table.
 */

export interface ScoreSheetQuestion extends ScorableQuestion {
  id: string;
}

export interface ScoreSheetAttempt {
  session_id: string;
  client_id: string;
  code: string | null;
  display_name: string | null;
  submitted_at: string;
  answers: Record<string, number[]>;
  /** `quiz_attempts.score` — what the history panel shows, computed when the attempt was submitted. */
  recorded_score?: number | null;
  /** After-class practice snapshot taken by "merge tutor practice"; null when never merged. */
  tutor_answered?: number | null;
  tutor_level_estimate?: number | null;
}

export interface ScoreSheetEssay {
  session_id: string;
  client_id: string;
  question_id: string;
  ai_score: number | null;
  teacher_score: number | null;
}

export interface ScoreSheetRow {
  name: string;
  code: string;
  submitted_at: string;
  /** One entry per question, in quiz order. `null` = an essay nobody has graded yet. */
  scores: Array<number | null>;
  total: number;
  /** True when at least one essay on this row is still ungraded, so `total` is provisional. */
  has_ungraded: boolean;
  /**
   * The score stored when the attempt was submitted, set only when it disagrees with the choice
   * part recomputed here. That happens when the quiz was edited afterwards (answer key fixed,
   * questions added or removed): the per-question columns can only be scored against the quiz as
   * it is now, so the total follows them — but the history panel still shows the old number, and
   * a teacher comparing the two needs to see why they differ.
   */
  recorded_score: number | null;
  /** After-class practice questions answered, as of the last merge; null = not merged / anonymous. */
  tutor_answered: number | null;
  /** Ability estimate (1–5) as of the last merge; null = not merged, or no practice answered. */
  tutor_level_estimate: number | null;
}

export interface ScoreSheet {
  /** Points each question is worth, in quiz order. */
  max_scores: number[];
  rows: ScoreSheetRow[];
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function essayKey(sessionId: string, clientId: string, questionId: string): string {
  // JSON keeps the three parts unambiguous whatever characters the ids contain.
  return JSON.stringify([sessionId, clientId, questionId]);
}

export function buildQuizScoreSheet(input: {
  questions: ScoreSheetQuestion[];
  attempts: ScoreSheetAttempt[];
  essays: ScoreSheetEssay[];
}): ScoreSheet {
  const maxScores = normalizeQuestionScores(input.questions);
  const essayByKey = new Map<string, ScoreSheetEssay>();
  for (const essay of input.essays) {
    essayByKey.set(essayKey(essay.session_id, essay.client_id, essay.question_id), essay);
  }

  const rows = input.attempts.map((attempt): ScoreSheetRow => {
    let choiceRaw = 0;
    let essayTotal = 0;
    let hasUngraded = false;
    const scores = input.questions.map((question, idx): number | null => {
      if (question.type === 'essay') {
        const essay = essayByKey.get(essayKey(attempt.session_id, attempt.client_id, question.id));
        // Teacher's override wins, exactly as the grading panel's "effective score" does.
        const effective = essay ? (essay.teacher_score ?? essay.ai_score) : null;
        if (effective == null) {
          hasUngraded = true;
          return null;
        }
        essayTotal += effective;
        return round2(effective);
      }
      const earned = calcQuestionScore(question, attempt.answers[question.id] ?? [], maxScores[idx] ?? 0);
      choiceRaw += earned;
      return round2(earned);
    });
    const choiceTotal = Math.min(QUIZ_TOTAL_SCORE, round2(choiceRaw));
    const recorded = attempt.recorded_score;
    // The stored score never included essays, so it is compared with the choice part only.
    const recordedDiffers = typeof recorded === 'number' && Math.abs(recorded - choiceTotal) > 0.005;
    return {
      name: attempt.display_name ?? '',
      code: attempt.code ?? '',
      submitted_at: attempt.submitted_at,
      scores,
      total: round2(choiceTotal + essayTotal),
      has_ungraded: hasUngraded,
      recorded_score: recordedDiffers ? recorded : null,
      tutor_answered: attempt.tutor_answered ?? null,
      tutor_level_estimate: attempt.tutor_level_estimate ?? null,
    };
  });

  return { max_scores: maxScores.map(round2), rows };
}
