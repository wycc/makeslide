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

/** 一輪練習最多能選的主題數，與後端 TUTOR_MAX_TOPICS 一致。 */
export const TUTOR_MAX_SELECTED_TOPICS = 12;

/**
 * 切換一個主題的選取狀態（複選）。保持原有順序，重複選取視為取消。
 * 比對前先 trim，免得「選單裡的主題」和「自己打的同一個主題」變成兩個。
 */
export function toggleTopic(selected: readonly string[], topic: string): string[] {
  const value = topic.trim();
  if (!value) return [...selected];
  const idx = selected.findIndex((t) => t.trim() === value);
  if (idx >= 0) return selected.filter((_, i) => i !== idx);
  if (selected.length >= TUTOR_MAX_SELECTED_TOPICS) return [...selected];
  return [...selected, value];
}

export function isTopicSelected(selected: readonly string[], topic: string): boolean {
  const value = topic.trim();
  return selected.some((t) => t.trim() === value);
}

export interface TopicScore {
  answered: number;
  correct: number;
}

/** 主題的掌握程度分級。`untested` 是「還沒練過」，與「練過但零分」必須分開。 */
export type TopicMastery = 'untested' | 'weak' | 'fair' | 'strong';

/** 低於此正確率算待加強、達到 strong 門檻算已掌握。 */
export const TOPIC_WEAK_THRESHOLD = 0.5;
export const TOPIC_STRONG_THRESHOLD = 0.8;

/**
 * 依作答成績判斷主題的掌握程度。
 * 沒作答過回 'untested'——那和「答了但全錯」是完全不同的兩件事，不能都塗成紅色。
 */
export function topicMastery(score: TopicScore | undefined): TopicMastery {
  if (!score || score.answered <= 0) return 'untested';
  const accuracy = score.correct / score.answered;
  if (accuracy < TOPIC_WEAK_THRESHOLD) return 'weak';
  if (accuracy < TOPIC_STRONG_THRESHOLD) return 'fair';
  return 'strong';
}

/** 主題 chip 上成績標示的配色：待加強紅、普通琥珀、已掌握綠；未測驗過則不特別著色。 */
export function topicMasteryToneClass(mastery: TopicMastery): string {
  switch (mastery) {
    case 'weak': return 'text-rose-600 dark:text-rose-400';
    case 'fair': return 'text-amber-600 dark:text-amber-400';
    case 'strong': return 'text-emerald-600 dark:text-emerald-400';
    default: return 'text-muted';
  }
}

/** 主題 chip 未被選取時的邊框顏色，讓成績一眼可辨（選取時另由 primary 樣式覆蓋）。 */
export function topicMasteryBorderClass(mastery: TopicMastery): string {
  switch (mastery) {
    case 'weak': return 'border-rose-500/50 bg-rose-500/5';
    case 'fair': return 'border-amber-500/50 bg-amber-500/5';
    case 'strong': return 'border-emerald-500/50 bg-emerald-500/5';
    default: return 'border-border bg-surface';
  }
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
