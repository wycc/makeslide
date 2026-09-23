import type { QuizAttempt, QuizAttemptSession, QuizQuestion } from '../types';
import { isCorrectAnswer } from './quizScoring';

/** 單一選項的作答統計。`wrong` 為真時 `count` 就是「選了這個錯誤選項的人數」。 */
export interface QuizOptionStat {
  index: number;
  /** 選了這個選項的人數。 */
  count: number;
  /** 這個選項是不是正解之一。 */
  isAnswer: boolean;
  /** 佔有作答人數的比例（0–1）；沒人作答時為 0。 */
  ratio: number;
}

/** 單一題目的作答統計。 */
export interface QuizQuestionStat {
  questionId: string;
  /** 有選任何選項的人數（分母；未作答者不計入正確率）。 */
  answered: number;
  /** 完全答對（選項集合與正解相同）的人數。 */
  correct: number;
  /** 有作答但沒有完全答對的人數。 */
  wrong: number;
  /** 交了卷但這題沒選任何選項的人數。 */
  unanswered: number;
  options: QuizOptionStat[];
}

/** 一題的作答統計。問答題沒有選項，只會有 answered/unanswered 皆為 0 的空統計。 */
export function analyzeQuestion(question: QuizQuestion, attempts: ReadonlyArray<Pick<QuizAttempt, 'answers'>>): QuizQuestionStat {
  const counts = question.options.map(() => 0);
  let answered = 0;
  let correct = 0;
  let unanswered = 0;
  if (question.type !== 'essay') {
    for (const attempt of attempts) {
      // 同一人重複選到同一個選項（資料異常）只算一次，否則人數會比作答人數還多。
      const selected = [...new Set(attempt.answers?.[question.id] ?? [])];
      if (selected.length === 0) {
        unanswered += 1;
        continue;
      }
      answered += 1;
      for (const idx of selected) {
        if (idx >= 0 && idx < counts.length) counts[idx] = (counts[idx] ?? 0) + 1;
      }
      if (isCorrectAnswer(question, selected)) correct += 1;
    }
  }
  return {
    questionId: question.id,
    answered,
    correct,
    wrong: answered - correct,
    unanswered,
    options: counts.map((count, index) => ({
      index,
      count,
      isAnswer: question.answer_indices.includes(index),
      ratio: answered > 0 ? count / answered : 0,
    })),
  };
}

/** 整份測驗的作答統計，依題目順序。 */
export function analyzeQuiz(questions: QuizQuestion[], attempts: ReadonlyArray<Pick<QuizAttempt, 'answers'>>): QuizQuestionStat[] {
  return questions.map((q) => analyzeQuestion(q, attempts));
}

/** 要分析的作答：指定場次就只取該場次，sessionId 為 null 代表全部場次合計。 */
export function attemptsForAnalysis(sessions: QuizAttemptSession[], sessionId: string | null): QuizAttempt[] {
  if (sessionId === null) return sessions.flatMap((s) => s.attempts);
  return sessions.find((s) => s.session_id === sessionId)?.attempts ?? [];
}

/** 答對率百分比（四捨五入到整數）；沒人作答時為 null，呼叫端顯示「—」而不是 0%。 */
export function correctPercent(stat: QuizQuestionStat): number | null {
  if (stat.answered === 0) return null;
  return Math.round((stat.correct / stat.answered) * 100);
}
