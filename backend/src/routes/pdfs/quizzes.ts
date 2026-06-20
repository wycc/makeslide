import fs from 'node:fs/promises';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { db } from '../../db';
import { logger } from '../../logger';
import { decodeSession, parseCookies } from '../auth';
import { callChatJSON } from '../../services/openai';
import { pageScriptPath, pageTextPath } from '../../services/storage';
import type { PdfRow } from '../../types';
import { errorResponse, IdParamSchema } from './shared';

function sessionSub(request: FastifyRequest): string | null {
  const session = decodeSession(parseCookies(request).makeslide_session);
  return session?.sub ?? null;
}

function canEditPdf(sub: string | null, row: Pick<PdfRow, 'owner_sub' | 'visibility'>): boolean {
  if (!row.owner_sub) return true;
  if (sub && row.owner_sub === sub) return true;
  return row.visibility === 'public_editable';
}

function canReadPdf(sub: string | null, row: Pick<PdfRow, 'owner_sub' | 'visibility'>): boolean {
  if (!row.owner_sub) return true;
  if (sub && row.owner_sub === sub) return true;
  return row.visibility === 'public' || row.visibility === 'public_editable';
}

const ShareTokenParamSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{12,128}$/, 'Invalid share token'),
});

function getShareToken(request: FastifyRequest): string | null {
  const rawHeader = request.headers['x-makeslide-share-token'];
  const headerValue = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
  if (typeof headerValue === 'string' && headerValue.trim()) return headerValue.trim();
  const query = request.query as Record<string, unknown> | undefined;
  const rawQuery = query?.share;
  const queryValue = Array.isArray(rawQuery) ? rawQuery[0] : rawQuery;
  return typeof queryValue === 'string' && queryValue.trim() ? queryValue.trim() : null;
}

function hasShareAccess(request: FastifyRequest, pdfId: string): boolean {
  const token = getShareToken(request);
  if (!token || !ShareTokenParamSchema.safeParse({ token }).success) return false;
  const row = db.prepare(`SELECT access FROM pdf_shares WHERE token = ? AND pdf_id = ?`).get(token, pdfId) as
    | { access: 'read_only' | 'editable' }
    | undefined;
  return Boolean(row);
}

function getPdfPermissionRow(id: string): Pick<PdfRow, 'owner_sub' | 'visibility'> | undefined {
  return db.prepare(`SELECT owner_sub, visibility FROM pdfs WHERE id = ?`).get(id) as
    | Pick<PdfRow, 'owner_sub' | 'visibility'>
    | undefined;
}

const QuizOptionSchema = z.object({ text: z.string().trim().min(1).max(300) });
const QuizQuestionSchema = z.object({
  id: z.string().trim().min(1).max(80),
  type: z.enum(['single', 'multiple']),
  question: z.string().trim().min(1).max(1000),
  options: z.array(QuizOptionSchema).min(2).max(8),
  answer_indices: z.array(z.number().int().min(0).max(7)).min(1).max(8),
  explanation: z.string().trim().max(1200).optional().default(''),
  score: z.number().min(0).max(1000).nullable().optional(),
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

const SaveQuizBodySchema = z.object({
  title: z.string().trim().min(1).max(200),
  prompt: z.string().trim().max(4000).default(''),
  questions: QuizQuestionsSchema,
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
  answers_json: string;
  score: number | null;
  submitted_at: string;
  created_at: string;
  updated_at: string;
}

function rowToQuizAttempt(row: QuizAttemptRow) {
  let answers: unknown = {};
  try {
    answers = JSON.parse(row.answers_json);
  } catch {
    answers = {};
  }
  const parsed = QuizAttemptAnswersSchema.safeParse(answers);
  return {
    id: row.id,
    quiz_id: row.quiz_id,
    session_id: row.session_id,
    client_id: row.client_id,
    code: row.code,
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

/** Mirrors frontend/src/pages/QuizBuilderPage.tsx normalizeQuestionScores(): unscored questions split the remaining points of a 100-point pool evenly. */
function normalizeQuestionScores(questions: ScorableQuestion[]): number[] {
  if (questions.length === 0) return [];
  const TOTAL = 100;
  const explicit = questions.map((q) => (typeof q.score === 'number' && Number.isFinite(q.score) && q.score >= 0 ? q.score : null));
  const assigned = explicit.reduce<number>((acc, v) => acc + (v ?? 0), 0);
  const emptyIndices = explicit.map((v, i) => (v == null ? i : -1)).filter((i) => i >= 0);
  const remaining = Math.max(0, TOTAL - assigned);
  const even = emptyIndices.length > 0 ? remaining / emptyIndices.length : 0;
  return explicit.map((v) => (v == null ? (emptyIndices.length > 0 ? even : 0) : v));
}

function isCorrectAnswer(answerIndices: number[], selected: number[]): boolean {
  const a = Array.from(new Set(answerIndices)).sort((x, y) => x - y);
  const b = Array.from(new Set(selected)).sort((x, y) => x - y);
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

/** Mirrors frontend/src/pages/QuizBuilderPage.tsx calcQuestionScore(): single = all-or-nothing, multiple = per-option partial credit. */
function calcQuestionScore(question: ScorableQuestion, selected: number[], questionScore: number): number {
  if (question.type === 'single') {
    return isCorrectAnswer(question.answer_indices, selected) ? questionScore : 0;
  }
  const optionCount = question.options.length;
  if (optionCount <= 0) return 0;
  const perOption = questionScore / optionCount;
  const selectedSet = new Set(selected);
  let earned = 0;
  for (let idx = 0; idx < optionCount; idx += 1) {
    const shouldSelect = question.answer_indices.includes(idx);
    const didSelect = selectedSet.has(idx);
    if (shouldSelect === didSelect) earned += perOption;
  }
  return earned;
}

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
  return Math.round(total * 100) / 100;
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
      .prepare(`SELECT id, pdf_id, title, prompt, questions_json, created_at, updated_at FROM quiz_sets WHERE pdf_id = ? ORDER BY updated_at DESC`)
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
    const result = db.prepare(`INSERT INTO quiz_sets (pdf_id, title, prompt, questions_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`).run(parsed.data.id, body.data.title, body.data.prompt, JSON.stringify(normalizeQuestions(body.data.questions)), now, now);
    const row = db.prepare(`SELECT id, pdf_id, title, prompt, questions_json, created_at, updated_at FROM quiz_sets WHERE id = ?`).get(result.lastInsertRowid) as QuizSetRow;
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
    const result = db.prepare(`UPDATE quiz_sets SET title = ?, prompt = ?, questions_json = ?, updated_at = ? WHERE id = ? AND pdf_id = ?`).run(body.data.title, body.data.prompt, JSON.stringify(normalizeQuestions(body.data.questions)), now, parsed.data.quizId, parsed.data.id);
    if (result.changes === 0) return reply.code(404).send(errorResponse('QUIZ_NOT_FOUND', `Quiz ${parsed.data.quizId} not found`));
    const row = db.prepare(`SELECT id, pdf_id, title, prompt, questions_json, created_at, updated_at FROM quiz_sets WHERE id = ?`).get(parsed.data.quizId) as QuizSetRow;
    return reply.send(rowToQuiz(row));
  });

  app.delete('/api/pdfs/:id/quizzes/:quizId', async (request, reply) => {
    const parsed = QuizParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid quiz parameters'));
    const pdfRow = getPdfPermissionRow(parsed.data.id);
    if (!pdfRow) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${parsed.data.id} not found`));
    if (!canEditPdf(sessionSub(request), pdfRow)) {
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
    const quiz = db.prepare(`SELECT id, questions_json FROM quiz_sets WHERE id = ? AND pdf_id = ?`).get(parsed.data.quizId, parsed.data.id) as
      | { id: number; questions_json: string }
      | undefined;
    if (!quiz) return reply.code(404).send(errorResponse('QUIZ_NOT_FOUND', `Quiz ${parsed.data.quizId} not found`));
    const now = nowIso();
    const code = body.data.code?.trim() || null;
    // Score is always recomputed server-side from the quiz's answer key; a client-submitted score is never trusted.
    const score = computeAttemptScore(quiz.questions_json, body.data.answers);
    const answersJson = JSON.stringify(body.data.answers);
    db.prepare(
      `INSERT INTO quiz_attempts (pdf_id, quiz_id, session_id, client_id, code, answers_json, score, submitted_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (session_id, client_id) DO UPDATE SET
         code = excluded.code,
         answers_json = excluded.answers_json,
         score = excluded.score,
         submitted_at = excluded.submitted_at,
         updated_at = excluded.updated_at`,
    ).run(parsed.data.id, parsed.data.quizId, body.data.session_id, body.data.client_id, code, answersJson, score, now, now, now);
    const row = db
      .prepare(
        `SELECT id, pdf_id, quiz_id, session_id, client_id, code, answers_json, score, submitted_at, created_at, updated_at
         FROM quiz_attempts WHERE session_id = ? AND client_id = ?`,
      )
      .get(body.data.session_id, body.data.client_id) as QuizAttemptRow;
    return reply.code(201).send(rowToQuizAttempt(row));
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
        `SELECT id, pdf_id, quiz_id, session_id, client_id, code, answers_json, score, submitted_at, created_at, updated_at
         FROM quiz_attempts WHERE quiz_id = ? ORDER BY submitted_at DESC`,
      )
      .all(parsed.data.quizId) as QuizAttemptRow[];
    const attempts = rows.map(rowToQuizAttempt);
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
}
