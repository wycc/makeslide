import type { TutorQuizAssessment, TutorQuizQuestion } from './api/tutorQuiz';

/**
 * 課後輔導測試的顯示側純函式：進度、正確率、難度配色。
 * 難度升降與能力估計本身由後端決定（見 backend/src/services/tutorQuiz.ts），
 * 這裡只負責把後端回傳的數字轉成畫面上要顯示的東西。
 */

/** 與後端 TUTOR_ASSESSMENT_INTERVAL 一致：每 10 題一次難度評估。 */
export const TUTOR_ASSESSMENT_INTERVAL = 10;
export const TUTOR_MIN_LEVEL = 1;
export const TUTOR_MAX_LEVEL = 5;

/** 還要再答幾題才有下一次難度評估（剛好答滿時回 10，代表下一輪重新開始數）。 */
export function untilNextAssessment(answeredCount: number): number {
  const n = Math.max(0, Math.floor(answeredCount));
  return TUTOR_ASSESSMENT_INTERVAL - (n % TUTOR_ASSESSMENT_INTERVAL);
}

/** 已作答的題數（重整後由 GET session 的題目清單還原）。 */
export function countAnswered(questions: readonly TutorQuizQuestion[]): number {
  return questions.filter((q) => q.answered_index !== null && q.answered_index !== undefined).length;
}

/** 尚未作答的那一題（最多一題；沒有則回 null）。 */
export function findPendingQuestion(questions: readonly TutorQuizQuestion[]): TutorQuizQuestion | null {
  return questions.find((q) => q.answered_index === null || q.answered_index === undefined) ?? null;
}

/** 正確率百分比（整數）。沒有作答時回 0 而不是 NaN。 */
export function accuracyPercent(correct: number, total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  return Math.round((correct / total) * 100);
}

export function latestAssessment(assessments: readonly TutorQuizAssessment[]): TutorQuizAssessment | null {
  if (assessments.length === 0) return null;
  return assessments.reduce((best, a) => (a.through_seq > best.through_seq ? a : best));
}

/**
 * 難度落點在 1–5 軸上的位置（0–100%），供難度條顯示。
 * L1 在最左（0%）、L5 在最右（100%）。
 */
export function levelBarPercent(level: number): number {
  if (!Number.isFinite(level)) return 0;
  const bounded = Math.min(TUTOR_MAX_LEVEL, Math.max(TUTOR_MIN_LEVEL, level));
  return Math.round(((bounded - TUTOR_MIN_LEVEL) / (TUTOR_MAX_LEVEL - TUTOR_MIN_LEVEL)) * 100);
}

/** 難度徽章的配色：低難度偏綠、中間偏藍、高難度偏紫。 */
export function levelToneClass(level: number): string {
  const rounded = Math.round(Math.min(TUTOR_MAX_LEVEL, Math.max(TUTOR_MIN_LEVEL, Number.isFinite(level) ? level : TUTOR_MIN_LEVEL)));
  switch (rounded) {
    case 1: return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
    case 2: return 'border-teal-500/40 bg-teal-500/10 text-teal-700 dark:text-teal-300';
    case 3: return 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300';
    case 4: return 'border-indigo-500/40 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300';
    default: return 'border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300';
  }
}
