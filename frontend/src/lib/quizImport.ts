// 測驗 JSON 匯入的解析與正規化（純函式，供 QuizBuilderPage 使用）。
// 接受先前「匯出 JSON」的 `{ title?, questions: [...] }` 結構，做寬鬆驗證與正規化，
// 產出可直接套用的 QuizQuestion[]。任何結構錯誤都回傳 { ok:false, error }，不丟例外。

import type { QuizQuestion, QuizQuestionType } from '../types';

export type QuizImportError = 'invalid_json' | 'no_questions' | 'no_valid_questions';

export interface QuizImportResult {
  title: string;
  questions: QuizQuestion[];
}

export type ParseQuizImportOutcome =
  | { ok: true; value: QuizImportResult }
  | { ok: false; error: QuizImportError };

function normalizeQuestion(raw: unknown, index: number): QuizQuestion | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const question = typeof r.question === 'string' ? r.question.trim() : '';
  if (!question) return null;

  const rawOptions = Array.isArray(r.options) ? r.options : [];
  const options = rawOptions.map((o) => {
    if (typeof o === 'string') return { text: o };
    if (o && typeof o === 'object' && typeof (o as { text?: unknown }).text === 'string') {
      return { text: (o as { text: string }).text };
    }
    return { text: '' };
  });
  if (options.length === 0) return null;

  const rawIndices = Array.isArray(r.answer_indices) ? r.answer_indices : [];
  const answer_indices = Array.from(
    new Set(
      rawIndices.filter(
        (n): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < options.length,
      ),
    ),
  ).sort((a, b) => a - b);

  const type: QuizQuestionType =
    r.type === 'single' || r.type === 'multiple' ? r.type : answer_indices.length > 1 ? 'multiple' : 'single';

  const explanation = typeof r.explanation === 'string' ? r.explanation : '';
  const score = typeof r.score === 'number' && Number.isFinite(r.score) ? r.score : null;

  return {
    id: `q${index + 1}`,
    type,
    question,
    options,
    answer_indices,
    explanation,
    score,
  };
}

/**
 * 解析並正規化測驗匯入 JSON。回傳 discriminated union：
 * - 解析失敗 → { ok:false, error:'invalid_json' }
 * - 根物件無 questions 陣列 → 'no_questions'
 * - 有 questions 但無任何合法題目 → 'no_valid_questions'
 * - 成功 → { ok:true, value:{ title, questions } }（id 重新編號為 q1、q2…）
 */
export function parseQuizImportJson(text: string): ParseQuizImportOutcome {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: 'invalid_json' };
  }
  if (typeof parsed !== 'object' || parsed === null || !Array.isArray((parsed as { questions?: unknown }).questions)) {
    return { ok: false, error: 'no_questions' };
  }
  const root = parsed as { title?: unknown; questions: unknown[] };
  const title = typeof root.title === 'string' ? root.title : '';
  const questions = root.questions
    .map((q, i) => normalizeQuestion(q, i))
    .filter((q): q is QuizQuestion => q !== null)
    // re-number after filtering so ids stay sequential
    .map((q, i) => ({ ...q, id: `q${i + 1}` }));

  if (questions.length === 0) {
    return { ok: false, error: 'no_valid_questions' };
  }
  return { ok: true, value: { title, questions } };
}
