import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeQuestion, analyzeQuiz, attemptsForAnalysis, correctPercent } from './quizAnalysis';
import type { QuizAttempt, QuizAttemptSession, QuizQuestion } from '../types';

/**
 * 小考分析（使用者要求，2026-09-23）：每題的作答狀態統計，重點是「每個錯誤選項有幾個人選」，
 * 老師講評時才知道大家錯到哪裡去。
 */
function question(over: Partial<QuizQuestion> = {}): QuizQuestion {
  return {
    id: 'q1',
    type: 'single',
    question: 'Q?',
    options: [{ text: 'A' }, { text: 'B' }, { text: 'C' }],
    answer_indices: [0],
    explanation: '',
    ...over,
  };
}

function attempt(answers: Record<string, number[]>): Pick<QuizAttempt, 'answers'> {
  return { answers };
}

/** 場次統計只看 answers，其餘欄位補成合法的 QuizAttempt 形狀。 */
function sessionAttempt(answers: Record<string, number[]>): QuizAttempt {
  return {
    id: 1,
    quiz_id: 1,
    session_id: 's',
    client_id: 'c',
    code: null,
    answers,
    score: null,
    submitted_at: '2026-09-23T01:00:00.000Z',
    created_at: '2026-09-23T01:00:00.000Z',
    updated_at: '2026-09-23T01:00:00.000Z',
  };
}

test('counts how many picked each option, and how many got the question right', () => {
  const stat = analyzeQuestion(question(), [
    attempt({ q1: [0] }),
    attempt({ q1: [1] }),
    attempt({ q1: [1] }),
    attempt({ q1: [2] }),
  ]);
  assert.equal(stat.answered, 4);
  assert.equal(stat.correct, 1);
  assert.equal(stat.wrong, 3, 'everyone who answered but missed it');
  assert.deepEqual(stat.options.map((o) => o.count), [1, 2, 1]);
  assert.deepEqual(stat.options.map((o) => o.isAnswer), [true, false, false]);
  assert.equal(stat.options[1]?.ratio, 0.5, 'half of the answers went to the popular wrong option');
  assert.equal(correctPercent(stat), 25);
});

test('a multiple-choice question is only correct when the whole set matches', () => {
  const q = question({ type: 'multiple', answer_indices: [0, 2] });
  const stat = analyzeQuestion(q, [
    attempt({ q1: [0, 2] }),
    attempt({ q1: [0] }),        // 少選
    attempt({ q1: [0, 1, 2] }),  // 多選
  ]);
  assert.equal(stat.correct, 1);
  assert.equal(stat.wrong, 2);
  assert.deepEqual(stat.options.map((o) => o.count), [3, 1, 2], 'every picked option is counted, even on wrong attempts');
});

test('blank answers are not part of the correct rate, but are reported separately', () => {
  const stat = analyzeQuestion(question(), [attempt({ q1: [0] }), attempt({}), attempt({ q1: [] })]);
  assert.equal(stat.answered, 1);
  assert.equal(stat.unanswered, 2);
  assert.equal(correctPercent(stat), 100, 'the two blanks must not drag the rate to 33%');
  const none = analyzeQuestion(question(), [attempt({})]);
  assert.equal(correctPercent(none), null, 'nobody answered → no rate, not 0%');
});

test('a duplicated pick and an out-of-range option index cannot inflate the counts', () => {
  const stat = analyzeQuestion(question({ type: 'multiple', answer_indices: [0] }), [attempt({ q1: [1, 1, 9] })]);
  assert.equal(stat.answered, 1);
  assert.deepEqual(stat.options.map((o) => o.count), [0, 1, 0]);
});

test('essay questions get an empty stat (no options to count)', () => {
  const stat = analyzeQuestion(question({ type: 'essay', options: [], answer_indices: [] }), [attempt({ q1: [0] })]);
  assert.deepEqual(stat, { questionId: 'q1', answered: 0, correct: 0, wrong: 0, unanswered: 0, options: [] });
});

test('analyzeQuiz keeps the question order', () => {
  const stats = analyzeQuiz([question({ id: 'a' }), question({ id: 'b' })], [attempt({ a: [0], b: [1] })]);
  assert.deepEqual(stats.map((s) => s.questionId), ['a', 'b']);
  assert.equal(stats[0]?.correct, 1);
  assert.equal(stats[1]?.correct, 0);
});

test('attemptsForAnalysis picks one session, or every session when asked for the total', () => {
  const sessions: QuizAttemptSession[] = [
    { session_id: 's2', submitted_at: '2026-09-23T02:00:00.000Z', attempts: [sessionAttempt({ q1: [0] })] },
    { session_id: 's1', submitted_at: '2026-09-23T01:00:00.000Z', attempts: [sessionAttempt({ q1: [1] }), sessionAttempt({ q1: [2] })] },
  ];
  assert.equal(attemptsForAnalysis(sessions, 's1').length, 2);
  assert.equal(attemptsForAnalysis(sessions, null).length, 3, 'null = all sessions combined');
  assert.deepEqual(attemptsForAnalysis(sessions, 'gone'), [], 'a session that no longer exists analyses nothing');
});
