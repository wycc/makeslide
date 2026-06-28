import fs from 'node:fs/promises';
import { ShareTokenParamSchema, getShareToken, hasShareAccess } from './share';
import { getPdfPermissionRow, canReadPdf, canEditPdf, canDestructivelyEditPdf } from './permissions';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../db';
import { logger } from '../../logger';
import { getAccountDisplayNames } from '../../services/accountProfiles';
import { calcQuestionScore, normalizeQuestionScores } from '../../services/quizScoring';
import { sessionSub } from '../auth';
import { callChatJSON } from '../../services/openai';
import { pageScriptPath, pageTextPath } from '../../services/storage';
import type { PdfRow } from '../../types';
import { errorResponse, IdParamSchema } from './shared';

// Stricter variant for this file's one destructive/irreversible route (deleting a quiz set
// outright, which also cascades to its attempts). Reuses canEditPdf()'s owner/public_editable
// logic but additionally requires an authenticated session before the public_editable fallback
// applies, so a fully anonymous request can never delete a quiz just because the presentation's
// visibility happens to be public_editable. The other (reversible) generate/create/update routes
// in this file keep using canEditPdf() unchanged. Mirrors delete.ts's canEditPdf() fix.
const QuizOptionSchema = z.object({ text: z.string().trim().min(1).max(300) });
const QuizQuestionSchema = z.object({
  id: z.string().trim().min(1).max(80),
  type: z.enum(['single', 'multiple']),
  question: z.string().trim().min(1).max(1000),
  options: z.array(QuizOptionSchema).min(2).max(8),
  answer_indices: z.array(z.number().int().min(0).max(7)).min(1).max(8),
  explanation: z.string().trim().max(1200).optional().default(''),
  score: z.number().min(0).max(1000).nullable().optional(),
  page_number: z.number().int().min(1).max(9999).nullable().optional(),
});
const GeneratedQuizQuestionSchema = QuizQuestionSchema.extend({
  id: z.string().trim().min(1).max(80).optional(),
  options: z
    .array(z.union([QuizOptionSchema, z.string().trim().min(1).max(300)]))
    .min(2)
    .max(8)
    .transform((options) => options.map((option) => (typeof option === 'string' ? { text: option } : option))),
});
const QuizQuestionsSchema = z.array(QuizQuestionSchema).min(1).max(50);
const ExistingQuizQuestionsSchema = z.array(QuizQuestionSchema).max(50);
const GeneratedQuizQuestionsSchema = z.array(GeneratedQuizQuestionSchema).min(1).max(50);

// Mirrors frontend/src/pages/QuizBuilderPage.tsx's explicit-score sum check: questions with an explicit
// score must not add up to more than the 100-point pool, otherwise computeAttemptScore() below could
// hand out a total score above the "X / 100" total the UI promises (e.g. two questions explicitly set
// to 80 points each would let a fully-correct attempt score 160/100).
const QUIZ_TOTAL_SCORE = 100;
const QUIZ_SCORE_SUM_EPSILON = 1e-6;
function explicitScoreSum(questions: Array<{ score?: number | null }>): number {
  return questions.reduce((acc, q) => acc + (typeof q.score === 'number' && Number.isFinite(q.score) && q.score >= 0 ? q.score : 0), 0);
}

const SaveQuizBodySchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    prompt: z.string().trim().max(4000).default(''),
    questions: QuizQuestionsSchema,
    time_limit_seconds: z.number().int().min(0).max(3600).default(0),
    shuffle_questions: z.boolean().default(false),
  })
  .superRefine((body, ctx) => {
    const sum = explicitScoreSum(body.questions);
    if (sum > QUIZ_TOTAL_SCORE + QUIZ_SCORE_SUM_EPSILON) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['questions'],
        message: `題目自訂分數加總為 ${sum}，超過測驗滿分 ${QUIZ_TOTAL_SCORE} 分，請調整各題分數`,
      });
    }
  });

const GenerateQuizBodySchema = z.object({
  prompt: z.string().trim().min(1).max(4000),
  existing_questions: ExistingQuizQuestionsSchema.optional().default([]),
});

const QuizParamSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{6,}$/),
  quizId: z.string().regex(/^[1-9]\d{0,9}$/).transform(Number),
});

const QuizAttemptAnswersSchema = z.record(z.string(), z.array(z.number().int().min(0).max(7)));

const SubmitQuizAttemptBodySchema = z.object({
  client_id: z.string().trim().min(1).max(128),
  session_id: z.string().trim().min(1).max(80),
  code: z.string().trim().max(80).optional(),
  answers: QuizAttemptAnswersSchema,
  score: z.number().min(0).max(1000).optional(),
});

interface QuizAttemptRow {
  id: number;
  pdf_id: string;
  quiz_id: number;
  session_id: string;
  client_id: string;
  code: string | null;
  sub: string | null;
  answers_json: string;
  score: number | null;
  submitted_at: string;
  created_at: string;
  updated_at: string;
}

function rowToQuizAttempt(row: QuizAttemptRow, displayName?: string | null) {
  let answers: unknown = {};
  try {
    answers = JSON.parse(row.answers_json);
  } catch {
    answers = {};
  }
  const parsed = QuizAttemptAnswersSchema.safeParse(answers);
  // 不外送 row.sub（帳號 id），只送解析後的顯示名稱。
  return {
    id: row.id,
    quiz_id: row.quiz_id,
    session_id: row.session_id,
    client_id: row.client_id,
    code: row.code,
    display_name: displayName ?? null,
    answers: parsed.success ? parsed.data : {},
    score: row.score,
    submitted_at: row.submitted_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

interface QuizSetRow {
  id: number;
  pdf_id: string;
  title: string;
  prompt: string;
  questions_json: string;
  time_limit_seconds: number;
  shuffle_questions: number;
  created_at: string;
  updated_at: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function rowToQuiz(row: QuizSetRow) {
  let questions: unknown = [];
  try {
    questions = JSON.parse(row.questions_json);
  } catch {
    questions = [];
  }
  const parsed = QuizQuestionsSchema.safeParse(questions);
  return {
    id: row.id,
    pdf_id: row.pdf_id,
    title: row.title,
    prompt: row.prompt,
    questions: parsed.success ? parsed.data : [],
    time_limit_seconds: row.time_limit_seconds ?? 0,
    shuffle_questions: Boolean(row.shuffle_questions),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function readPageArtifact(pdfId: string, page: number, kind: '投影片文字' | '逐字稿', filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (err) {
    logger.warn(
      { pdfId, page, kind, filePath, error: err instanceof Error ? err.message : String(err) },
      'quiz-generate: page artifact file missing — sending empty content to LLM',
    );
    return '';
  }
}

async function readPageContext(pdfId: string, pageCount: number | null): Promise<string> {
  const count = Math.max(0, pageCount ?? 0);
  const pageRows = db
    .prepare(`SELECT page_number, page_uid FROM pages WHERE pdf_id = ? ORDER BY page_number ASC`)
    .all(pdfId) as Array<{ page_number: number; page_uid: string }>;
  const chunks: string[] = [];
  for (const { page_number: page, page_uid: uid } of pageRows.slice(0, count || pageRows.length)) {
    const [text, script] = await Promise.all([
      readPageArtifact(pdfId, page, '投影片文字', pageTextPath(pdfId, uid)),
      readPageArtifact(pdfId, page, '逐字稿', pageScriptPath(pdfId, uid)),
    ]);
    const body = [`投影片文字：${text.trim() || '（無）'}`, `逐字稿：${script.trim() || '（無）'}`].join('\n');
    chunks.push(`第 ${page} 頁\n${body}`);
  }
  return chunks.join('\n\n---\n\n').slice(0, 60000);
}

type ScorableQuestion = z.infer<typeof QuizQuestionSchema>;

/** Authoritative server-side scoring for a quiz attempt; never trust a client-submitted score. */
function computeAttemptScore(questionsJson: string, answers: Record<string, number[]>): number {
  let parsedQuestions: unknown = [];
  try {
    parsedQuestions = JSON.parse(questionsJson);
  } catch {
    parsedQuestions = [];
  }
  const result = QuizQuestionsSchema.safeParse(parsedQuestions);
  const questions = result.success ? result.data : [];
  const scoreTable = normalizeQuestionScores(questions);
  const total = questions.reduce((acc, q, idx) => acc + calcQuestionScore(q, answers[q.id] ?? [], scoreTable[idx] ?? 0), 0);
  // Defensive clamp: SaveQuizBodySchema now rejects explicit per-question scores summing above
  // QUIZ_TOTAL_SCORE at write time, but quiz_sets rows saved before that validation existed (or
  // edited directly) could still carry a stale questions_json whose scores add up to more than
  // 100. Clamp here too so a fully-correct attempt can never be awarded more than the 100-point
  // total the UI advertises ("X / 100"), regardless of how the underlying row was created.
  return Math.min(QUIZ_TOTAL_SCORE, Math.round(total * 100) / 100);
}

function normalizeQuestions(input: unknown) {
  const parsed = GeneratedQuizQuestionsSchema.parse(input);
  return parsed.map((q, idx) => {
    const maxIndex = q.options.length - 1;
    const answers = Array.from(new Set(q.answer_indices.filter((answer) => answer >= 0 && answer <= maxIndex)));
    return {
      ...q,
      id: q.id?.trim() || `q${idx + 1}`,
      answer_indices: q.type === 'single' ? [answers[0] ?? 0] : answers.length > 0 ? answers : [0],
    };
  });
}

export async function registerQuizRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/pdfs/:id/quizzes', async (request, reply) => {
    const parsed = IdParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid pdf id'));
    const pdfRow = getPdfPermissionRow(parsed.data.id);
    if (!pdfRow) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${parsed.data.id} not found`));
    if (!hasShareAccess(request, parsed.data.id) && !canReadPdf(sessionSub(request), pdfRow)) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限檢視此簡報的測驗'));
    }
    const rows = db
      .prepare(`SELECT id, pdf_id, title, prompt, questions_json, time_limit_seconds, shuffle_questions, created_at, updated_at FROM quiz_sets WHERE pdf_id = ? ORDER BY updated_at DESC`)
      .all(parsed.data.id) as QuizSetRow[];
    return reply.send({ quizzes: rows.map(rowToQuiz) });
  });

  app.post('/api/pdfs/:id/quizzes/generate', async (request, reply) => {
    const parsed = IdParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid pdf id'));
    const body = GenerateQuizBodySchema.safeParse(request.body ?? {});
    if (!body.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', body.error.issues[0]?.message ?? 'Invalid body'));
    const pdf = db.prepare(`SELECT id, title, page_count, owner_sub, visibility FROM pdfs WHERE id = ?`).get(parsed.data.id) as
      | { id: string; title: string | null; page_count: number | null; owner_sub: string | null; visibility: PdfRow['visibility'] }
      | undefined;
    if (!pdf) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${parsed.data.id} not found`));
    if (!canEditPdf(sessionSub(request), pdf)) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限為此簡報產生測驗'));
    }
    const context = await readPageContext(parsed.data.id, pdf.page_count);
    const result = await callChatJSON({
      label: `quiz-generate ${parsed.data.id}`,
      messages: [
        { role: 'system', content: '你是繁體中文教學測驗設計助理。請只輸出 JSON，格式為 {"title":"...","questions":[...]}。每題 type 為 single 或 multiple，options 是 {text} 陣列，answer_indices 是 0-based 正確選項索引，並提供 explanation。' },
        { role: 'user', content: [`簡報標題：${pdf.title ?? '未命名簡報'}`, `老師提示詞：${body.data.prompt}`, `既有問題列表（可依提示詞修改、增刪或重寫）：${JSON.stringify(body.data.existing_questions)}`, `簡報內容：\n${context}`].join('\n\n') },
      ],
      schema: z.object({ title: z.string().trim().min(1).max(200), questions: GeneratedQuizQuestionsSchema }),
      maxTokens: 5000,
      temperature: 0.4,
    });
    return reply.send({ title: result.data.title, questions: normalizeQuestions(result.data.questions) });
  });

  app.post('/api/pdfs/:id/quizzes', async (request, reply) => {
    const parsed = IdParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid pdf id'));
    const body = SaveQuizBodySchema.safeParse(request.body ?? {});
    if (!body.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', body.error.issues[0]?.message ?? 'Invalid body'));
    const pdfRow = getPdfPermissionRow(parsed.data.id);
    if (!pdfRow) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${parsed.data.id} not found`));
    if (!canEditPdf(sessionSub(request), pdfRow)) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限為此簡報新增測驗'));
    }
    const now = nowIso();
    const result = db.prepare(`INSERT INTO quiz_sets (pdf_id, title, prompt, questions_json, time_limit_seconds, shuffle_questions, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(parsed.data.id, body.data.title, body.data.prompt, JSON.stringify(normalizeQuestions(body.data.questions)), body.data.time_limit_seconds, body.data.shuffle_questions ? 1 : 0, now, now);
    const row = db.prepare(`SELECT id, pdf_id, title, prompt, questions_json, time_limit_seconds, shuffle_questions, created_at, updated_at FROM quiz_sets WHERE id = ?`).get(result.lastInsertRowid) as QuizSetRow;
    return reply.code(201).send(rowToQuiz(row));
  });

  app.put('/api/pdfs/:id/quizzes/:quizId', async (request, reply) => {
    const parsed = QuizParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid quiz parameters'));
    const body = SaveQuizBodySchema.safeParse(request.body ?? {});
    if (!body.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', body.error.issues[0]?.message ?? 'Invalid body'));
    const pdfRow = getPdfPermissionRow(parsed.data.id);
    if (!pdfRow) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${parsed.data.id} not found`));
    if (!canEditPdf(sessionSub(request), pdfRow)) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限編輯此簡報的測驗'));
    }
    const now = nowIso();
    const result = db.prepare(`UPDATE quiz_sets SET title = ?, prompt = ?, questions_json = ?, time_limit_seconds = ?, shuffle_questions = ?, updated_at = ? WHERE id = ? AND pdf_id = ?`).run(body.data.title, body.data.prompt, JSON.stringify(normalizeQuestions(body.data.questions)), body.data.time_limit_seconds, body.data.shuffle_questions ? 1 : 0, now, parsed.data.quizId, parsed.data.id);
    if (result.changes === 0) return reply.code(404).send(errorResponse('QUIZ_NOT_FOUND', `Quiz ${parsed.data.quizId} not found`));
    const row = db.prepare(`SELECT id, pdf_id, title, prompt, questions_json, time_limit_seconds, shuffle_questions, created_at, updated_at FROM quiz_sets WHERE id = ?`).get(parsed.data.quizId) as QuizSetRow;
    return reply.send(rowToQuiz(row));
  });

  app.delete('/api/pdfs/:id/quizzes/:quizId', async (request, reply) => {
    const parsed = QuizParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid quiz parameters'));
    const pdfRow = getPdfPermissionRow(parsed.data.id);
    if (!pdfRow) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${parsed.data.id} not found`));
    if (!canDestructivelyEditPdf(sessionSub(request), pdfRow)) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限刪除此簡報的測驗'));
    }
    const result = db.prepare(`DELETE FROM quiz_sets WHERE id = ? AND pdf_id = ?`).run(parsed.data.quizId, parsed.data.id);
    if (result.changes === 0) return reply.code(404).send(errorResponse('QUIZ_NOT_FOUND', `Quiz ${parsed.data.quizId} not found`));
    return reply.code(204).send();
  });

  app.post('/api/pdfs/:id/quizzes/:quizId/attempts', async (request, reply) => {
    const parsed = QuizParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid quiz parameters'));
    const body = SubmitQuizAttemptBodySchema.safeParse(request.body ?? {});
    if (!body.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', body.error.issues[0]?.message ?? 'Invalid body'));
    const pdfRow = getPdfPermissionRow(parsed.data.id);
    if (!pdfRow) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${parsed.data.id} not found`));
    if (!hasShareAccess(request, parsed.data.id) && !canReadPdf(sessionSub(request), pdfRow)) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限作答此簡報的測驗'));
    }
    const quiz = db.prepare(`SELECT id, questions_json FROM quiz_sets WHERE id = ? AND pdf_id = ?`).get(parsed.data.quizId, parsed.data.id) as
      | { id: number; questions_json: string }
      | undefined;
    if (!quiz) return reply.code(404).send(errorResponse('QUIZ_NOT_FOUND', `Quiz ${parsed.data.quizId} not found`));
    const now = nowIso();
    const code = body.data.code?.trim() || null;
    const sub = sessionSub(request);
    // Score is always recomputed server-side from the quiz's answer key; a client-submitted score is never trusted.
    const score = computeAttemptScore(quiz.questions_json, body.data.answers);
    const answersJson = JSON.stringify(body.data.answers);
    db.prepare(
      `INSERT INTO quiz_attempts (pdf_id, quiz_id, session_id, client_id, code, sub, answers_json, score, submitted_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (session_id, client_id) DO UPDATE SET
         code = excluded.code,
         sub = excluded.sub,
         answers_json = excluded.answers_json,
         score = excluded.score,
         submitted_at = excluded.submitted_at,
         updated_at = excluded.updated_at`,
    ).run(parsed.data.id, parsed.data.quizId, body.data.session_id, body.data.client_id, code, sub, answersJson, score, now, now, now);
    const row = db
      .prepare(
        `SELECT id, pdf_id, quiz_id, session_id, client_id, code, sub, answers_json, score, submitted_at, created_at, updated_at
         FROM quiz_attempts WHERE session_id = ? AND client_id = ?`,
      )
      .get(body.data.session_id, body.data.client_id) as QuizAttemptRow;
    const displayName = row.sub ? getAccountDisplayNames([row.sub]).get(row.sub) ?? null : null;
    return reply.code(201).send(rowToQuizAttempt(row, displayName));
  });

  app.get('/api/pdfs/:id/quizzes/:quizId/attempts', async (request, reply) => {
    const parsed = QuizParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid quiz parameters'));
    const pdfRow = getPdfPermissionRow(parsed.data.id);
    if (!pdfRow) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${parsed.data.id} not found`));
    if (!hasShareAccess(request, parsed.data.id) && !canReadPdf(sessionSub(request), pdfRow)) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限檢視此簡報的測驗作答紀錄'));
    }
    const quiz = db.prepare(`SELECT id FROM quiz_sets WHERE id = ? AND pdf_id = ?`).get(parsed.data.quizId, parsed.data.id) as { id: number } | undefined;
    if (!quiz) return reply.code(404).send(errorResponse('QUIZ_NOT_FOUND', `Quiz ${parsed.data.quizId} not found`));
    const rows = db
      .prepare(
        `SELECT id, pdf_id, quiz_id, session_id, client_id, code, sub, answers_json, score, submitted_at, created_at, updated_at
         FROM quiz_attempts WHERE quiz_id = ? ORDER BY submitted_at DESC`,
      )
      .all(parsed.data.quizId) as QuizAttemptRow[];
    const names = getAccountDisplayNames(rows.map((r) => r.sub));
    const attempts = rows.map((r) => rowToQuizAttempt(r, r.sub ? names.get(r.sub) ?? null : null));
    const sessionsMap = new Map<string, { session_id: string; submitted_at: string; attempts: ReturnType<typeof rowToQuizAttempt>[] }>();
    for (const attempt of attempts) {
      const existing = sessionsMap.get(attempt.session_id);
      if (existing) {
        existing.attempts.push(attempt);
        if (attempt.submitted_at > existing.submitted_at) existing.submitted_at = attempt.submitted_at;
      } else {
        sessionsMap.set(attempt.session_id, { session_id: attempt.session_id, submitted_at: attempt.submitted_at, attempts: [attempt] });
      }
    }
    const sessions = Array.from(sessionsMap.values()).sort((a, b) => (a.submitted_at < b.submitted_at ? 1 : -1));
    return reply.send({ sessions });
  });

  const CopyToParamSchema = z.object({
    id: z.string().min(1),
    quizId: z.string().regex(/^[1-9]\d{0,9}$/).transform(Number),
    targetId: z.string().min(1),
  });

  app.post('/api/pdfs/:id/quizzes/:quizId/copy-to/:targetId', async (request, reply) => {
    const parsed = CopyToParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid parameters'));
    const { id, quizId, targetId } = parsed.data;
    const sub = sessionSub(request);

    const srcRow = getPdfPermissionRow(id);
    if (!srcRow) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `Source PDF ${id} not found`));
    if (!canReadPdf(sub, srcRow)) return reply.code(403).send(errorResponse('FORBIDDEN', '無權限讀取來源簡報'));

    const dstRow = getPdfPermissionRow(targetId);
    if (!dstRow) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `Target PDF ${targetId} not found`));
    if (!canEditPdf(sub, dstRow)) return reply.code(403).send(errorResponse('FORBIDDEN', '無權限修改目標簡報'));

    const quiz = db
      .prepare(`SELECT title, questions_json, prompt, time_limit_seconds, shuffle_questions FROM quiz_sets WHERE id = ? AND pdf_id = ?`)
      .get(quizId, id) as Pick<QuizSetRow, 'title' | 'questions_json' | 'prompt' | 'time_limit_seconds' | 'shuffle_questions'> | undefined;
    if (!quiz) return reply.code(404).send(errorResponse('QUIZ_NOT_FOUND', `Quiz ${quizId} not found`));

    const now = nowIso();
    const result = db
      .prepare(`INSERT INTO quiz_sets (pdf_id, title, prompt, questions_json, time_limit_seconds, shuffle_questions, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(targetId, quiz.title, quiz.prompt, quiz.questions_json, quiz.time_limit_seconds, quiz.shuffle_questions, now, now);
    const newRow = db
      .prepare(`SELECT id, pdf_id, title, prompt, questions_json, time_limit_seconds, shuffle_questions, created_at, updated_at FROM quiz_sets WHERE id = ?`)
      .get(result.lastInsertRowid) as QuizSetRow;
    return reply.code(201).send(rowToQuiz(newRow));
  });
}
