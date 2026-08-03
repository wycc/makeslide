import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { ShareTokenParamSchema, getShareToken } from './share';
import { getPdfPermissionRow, canReadPdf, canEditPdf, canDestructivelyEditPdf, isPdfOwner , aclCtx } from './permissions';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../db';
import { logger } from '../../logger';
import { getAccountDisplayNames } from '../../services/accountProfiles';
import { calcQuestionScore, normalizeQuestionScores } from '../../services/quizScoring';
import { shuffleChoices } from '../../services/quizShuffle';
import { sessionSub } from '../auth';
import { callChatJSON } from '../../services/openai';
import { pageScriptPath, pageTextPath, quizRecordingsDir, quizRecordingPath, quizEssayDir, quizEssayPath } from '../../services/storage';
import { quizRecordingFilename } from '../../services/quizRecording';
import { essayPhotoFilename, clampEssayScore, gradeEssayAnswer, processEssayPhoto } from '../../services/quizEssayGrading';
import type { PdfRow } from '../../types';
import { errorResponse, IdParamSchema } from './shared';

// Stricter variant for this file's one destructive/irreversible route (deleting a quiz set
// outright, which also cascades to its attempts). Reuses canEditPdf()'s owner/public_editable
// logic but additionally requires an authenticated session before the public_editable fallback
// applies, so a fully anonymous request can never delete a quiz just because the presentation's
// visibility happens to be public_editable. The other (reversible) generate/create/update routes
// in this file keep using canEditPdf() unchanged. Mirrors delete.ts's canEditPdf() fix.
const QuizOptionSchema = z.object({ text: z.string().trim().min(1).max(300) });
// options/answer_indices are relaxed here (may be empty for essay questions); the strict
// "single/multiple need >=2 options and >=1 answer" check happens in SaveQuizBodySchema so
// that reads stay lenient and GeneratedQuizQuestionSchema can still `.extend` this object.
const QuizQuestionSchema = z.object({
  id: z.string().trim().min(1).max(80),
  type: z.enum(['single', 'multiple', 'essay']),
  question: z.string().trim().min(1).max(1000),
  options: z.array(QuizOptionSchema).max(8).default([]),
  answer_indices: z.array(z.number().int().min(0).max(7)).max(8).default([]),
  // Essay questions: optional model answer / rubric used by the AI grader (never shown to students).
  reference_answer: z.string().trim().max(4000).optional().default(''),
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
// Variant for the "edit an existing quiz" patch (QuizEditResponseSchema.changed_questions). Two
// deliberate relaxations over GeneratedQuizQuestionSchema: (1) `id` allows an empty/blank string,
// not just omission — the model, told to "leave id blank" for a new question, tends to emit
// `"id": ""`, which `.min(1).optional()` rejects and would 500 the whole generate call; an empty id
// simply means "new question". (2) options may be empty so the model can also return/keep an essay
// question (which has none). Choice-question option-count is re-checked later at save time.
const EditedQuizQuestionSchema = QuizQuestionSchema.extend({
  id: z.string().trim().max(80).optional(),
  options: z
    .array(z.union([QuizOptionSchema, z.string().trim().min(1).max(300)]))
    .max(8)
    .default([])
    .transform((options) => options.map((option) => (typeof option === 'string' ? { text: option } : option))),
});

// Mirrors frontend/src/pages/QuizBuilderPage.tsx's explicit-score sum check: questions with an explicit
// score must not add up to more than the 100-point pool, otherwise computeAttemptScore() below could
// hand out a total score above the "X / 100" total the UI promises (e.g. two questions explicitly set
// to 80 points each would let a fully-correct attempt score 160/100).
const QUIZ_TOTAL_SCORE = 100;
const QUIZ_SCORE_SUM_EPSILON = 1e-6;
// Max photos a student may upload for one essay (written) answer in a single request. The global
// multipart limit is 1; this route raises it so a paper answer spanning several shots can be sent.
const MAX_ESSAY_PHOTOS = 10;
export function explicitScoreSum(questions: Array<{ score?: number | null }>): number {
  return questions.reduce((acc, q) => acc + (typeof q.score === 'number' && Number.isFinite(q.score) && q.score >= 0 ? q.score : 0), 0);
}

// Essay (photo-answer) questions carry no options or answer key. The quiz editor reuses one
// question shape for every type, so switching a freshly-added question to "essay" can leave its
// blank placeholder options (`{ text: '' }`) attached. Those empty strings would otherwise trip
// QuizOptionSchema's `text.min(1)` at parse time ("String must contain at least 1 character(s)")
// and block the save. Strip options/answer_indices from essay questions before validation so a
// stray option from any client (manual switch, imported JSON, AI-generated) can never break it.
function stripEssayOptionFields(input: unknown): unknown {
  if (!Array.isArray(input)) return input;
  return input.map((q) =>
    q && typeof q === 'object' && (q as { type?: unknown }).type === 'essay'
      ? { ...(q as Record<string, unknown>), options: [], answer_indices: [] }
      : q,
  );
}

const SaveQuizBodySchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    prompt: z.string().trim().max(4000).default(''),
    questions: z.preprocess(stripEssayOptionFields, QuizQuestionsSchema),
    time_limit_seconds: z.number().int().min(0).max(3600).default(0),
    shuffle_questions: z.boolean().default(false),
    is_public: z.boolean().default(false),
    record_camera: z.boolean().default(true),
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
    // 選擇題（single/multiple）需至少 2 個選項與 1 個正解；問答題（essay）不需選項。
    body.questions.forEach((q, idx) => {
      if (q.type === 'essay') return;
      if (q.options.length < 2) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['questions', idx, 'options'], message: '選擇題至少需要 2 個選項' });
      }
      if (q.answer_indices.length < 1) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['questions', idx, 'answer_indices'], message: '選擇題至少需要 1 個正解' });
      }
      if (q.answer_indices.some((i) => i >= q.options.length)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['questions', idx, 'answer_indices'], message: '正解索引超出選項範圍' });
      }
    });
  });

const GenerateQuizBodySchema = z.object({
  prompt: z.string().trim().min(1).max(4000),
  existing_questions: ExistingQuizQuestionsSchema.optional().default([]),
});

// LLM output when editing an existing quiz: only the questions to add/change plus the ids to delete,
// never the untouched ones. `changed_questions` carrying an existing id updates that question; a new
// or blank id appends a new one. See mergeEditedQuestions() for how this folds into the saved list.
const QuizEditResponseSchema = z.object({
  title: z.string().trim().min(1).max(200),
  changed_questions: z.array(EditedQuizQuestionSchema).max(50).default([]),
  removed_question_ids: z.array(z.string().trim().min(1).max(80)).max(50).default([]),
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
  is_public: number;
  record_camera: number;
  created_at: string;
  updated_at: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Reads a text value from a @fastify/multipart field (mirrors upload.ts's helper). */
function multipartFieldValue(field: unknown): string | undefined {
  const first = Array.isArray(field) ? field[0] : field;
  if (!first || typeof first !== 'object') return undefined;
  const value = (first as { value?: unknown }).value;
  return typeof value === 'string' ? value : undefined;
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
    is_public: Boolean(row.is_public),
    record_camera: Boolean(row.record_camera),
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

/**
 * Build the quiz-generation context for a presentation. For a normal presentation this is just
 * its own pages. For a "collection" presentation (source_type='collection') the collection's own
 * pages are only summaries + links, so instead aggregate the full content of every source
 * presentation it links to — this is what lets a quiz built on a collection draw questions from
 * all the underlying decks at once. The overall context is capped so a large collection can't
 * blow past the model's context window.
 */
async function readQuizContext(
  pdfId: string,
  sourceType: string | null | undefined,
  pageCount: number | null,
): Promise<string> {
  if (sourceType !== 'collection') return readPageContext(pdfId, pageCount);

  const linkRows = db
    .prepare(`SELECT DISTINCT link_pdf_id FROM pages WHERE pdf_id = ? AND link_pdf_id IS NOT NULL ORDER BY page_number ASC`)
    .all(pdfId) as Array<{ link_pdf_id: string }>;
  if (linkRows.length === 0) return readPageContext(pdfId, pageCount);

  const PER_SOURCE_LIMIT = Math.floor(60000 / linkRows.length);
  const sections: string[] = [];
  for (const { link_pdf_id: sourceId } of linkRows) {
    const source = db.prepare(`SELECT title, page_count FROM pdfs WHERE id = ?`).get(sourceId) as
      | { title: string | null; page_count: number | null }
      | undefined;
    if (!source) continue; // source deleted since the collection was built — skip it
    const context = (await readPageContext(sourceId, source.page_count)).slice(0, PER_SOURCE_LIMIT);
    sections.push(`【簡報：${source.title ?? sourceId}】\n${context}`);
  }
  return sections.join('\n\n========\n\n').slice(0, 60000);
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

type GeneratedQuizQuestion = z.infer<typeof GeneratedQuizQuestionSchema>;
type EditedQuizQuestion = z.infer<typeof EditedQuizQuestionSchema>;
type ExistingQuizQuestion = z.infer<typeof QuizQuestionSchema>;

/** Clean one LLM-produced question: assign an id and sanitise its answer indices against its options. */
function normalizeGeneratedQuestion(q: GeneratedQuizQuestion | EditedQuizQuestion, id: string) {
  // Essay questions carry no options or answer key; never fabricate a default answer index for them.
  if (q.type === 'essay') return { ...q, id, options: [], answer_indices: [] };
  const maxIndex = q.options.length - 1;
  const answers = Array.from(new Set(q.answer_indices.filter((answer) => answer >= 0 && answer <= maxIndex)));
  return {
    ...q,
    id,
    answer_indices: q.type === 'single' ? [answers[0] ?? 0] : answers.length > 0 ? answers : [0],
  };
}

/**
 * Shuffle a freshly generated choice question's options.
 *
 * Models put the correct answer in the first slot far more often than chance, which shows up as
 * "the answer is almost always A" across a whole generated quiz. Prompting for random order is not
 * reliable, so we reorder here instead. Only applied to newly generated questions — questions being
 * saved or edited keep their order, so a teacher's options don't jump around between edits.
 */
function shuffleGeneratedQuestion<T extends { type: string; options: unknown[]; answer_indices: number[] }>(q: T): T {
  if (q.type === 'essay') return q;
  const shuffled = shuffleChoices(q.options, q.answer_indices);
  return { ...q, options: shuffled.options, answer_indices: shuffled.answerIndices };
}

function normalizeQuestions(input: unknown) {
  const parsed = GeneratedQuizQuestionsSchema.parse(input);
  return parsed.map((q, idx) => shuffleGeneratedQuestion(normalizeGeneratedQuestion(q, q.id?.trim() || `q${idx + 1}`)));
}

/**
 * Normalize questions coming from a save (POST/PUT), which are already validated as QuizQuestionSchema.
 * Unlike normalizeQuestions(), this does NOT re-parse through GeneratedQuizQuestionsSchema — that schema
 * requires >=2 options and would throw on an essay question (which legitimately has none). Essay questions
 * are forced to carry no options/answer key; choice questions get their answer indices sanitised the same
 * way normalizeGeneratedQuestion() does.
 */
function normalizeSavedQuestions(questions: ExistingQuizQuestion[]) {
  return questions.map((q, idx) => {
    const id = q.id?.trim() || `q${idx + 1}`;
    if (q.type === 'essay') return { ...q, id, options: [], answer_indices: [] };
    const maxIndex = q.options.length - 1;
    const answers = Array.from(new Set(q.answer_indices.filter((answer) => answer >= 0 && answer <= maxIndex)));
    return {
      ...q,
      id,
      answer_indices: q.type === 'single' ? [answers[0] ?? 0] : answers.length > 0 ? answers : [0],
    };
  });
}

/** Pick the next free `q<n>` id not already used, so appended new questions never collide. */
function nextFreeId(used: Set<string>): string {
  let n = used.size + 1;
  let id = `q${n}`;
  while (used.has(id)) id = `q${++n}`;
  return id;
}

/**
 * Apply an AI "edit" of an existing quiz: instead of the model rewriting the whole question list
 * (which used to wipe questions the teacher never asked to touch), it returns only the questions to
 * add/change plus the ids to delete. We merge those into the existing list — untouched questions
 * (including essays the generate schema can't even express) are preserved verbatim and in place.
 */
function mergeEditedQuestions(
  existing: ExistingQuizQuestion[],
  changed: EditedQuizQuestion[],
  removedIds: string[],
) {
  const removed = new Set(removedIds);
  const existingIds = new Set(existing.map((q) => q.id));
  const updatesById = new Map<string, GeneratedQuizQuestion>();
  const additions: GeneratedQuizQuestion[] = [];
  for (const q of changed) {
    const id = q.id?.trim();
    // A change that names an existing (and not-removed) id updates that question in place; anything
    // else — a new/blank/unknown id — is treated as a brand-new question appended at the end.
    if (id && existingIds.has(id) && !removed.has(id)) updatesById.set(id, q);
    else additions.push(q);
  }
  const merged = existing
    .filter((q) => !removed.has(q.id))
    .map((q) => {
      const upd = updatesById.get(q.id);
      return upd ? normalizeGeneratedQuestion(upd, q.id) : q;
    });
  const used = new Set(merged.map((q) => q.id));
  for (const q of additions) {
    const id = nextFreeId(used);
    used.add(id);
    merged.push(normalizeGeneratedQuestion(q, id));
  }
  return merged;
}

/** Reads one essay answer's stored photos (already-processed JPEGs) as base64 data URLs for re-grading. */
async function loadEssayPhotoDataUrls(pdfId: string, fileNamesJson: string): Promise<string[]> {
  let files: string[] = [];
  try {
    const arr = JSON.parse(fileNamesJson);
    if (Array.isArray(arr)) files = arr.filter((x): x is string => typeof x === 'string');
  } catch {
    /* ignore malformed file_names */
  }
  const urls: string[] = [];
  for (const name of files) {
    try {
      const buf = await fs.readFile(quizEssayPath(pdfId, name));
      urls.push(`data:image/jpeg;base64,${buf.toString('base64')}`);
    } catch {
      /* photo missing on disk — skip it */
    }
  }
  return urls;
}

/** Builds the teacher-facing essay-answer list for a quiz (shared by the GET and re-grade routes). */
function listEssayAnswersForQuiz(pdfId: string, quizId: number) {
  const rows = db
    .prepare(
      `SELECT id, question_id, session_id, client_id, code, sub, file_names, max_score, ai_score, ai_feedback, teacher_score, created_at, updated_at
       FROM quiz_essay_answers WHERE quiz_id = ? AND pdf_id = ? ORDER BY updated_at DESC`,
    )
    .all(quizId, pdfId) as Array<{
      id: number; question_id: string; session_id: string; client_id: string; code: string | null; sub: string | null;
      file_names: string; max_score: number; ai_score: number | null; ai_feedback: string | null; teacher_score: number | null;
      created_at: string; updated_at: string;
    }>;
  const names = getAccountDisplayNames(rows.map((r) => r.sub).filter((s): s is string => Boolean(s)));
  return rows.map((r) => {
    let photoCount = 0;
    try { const arr = JSON.parse(r.file_names); if (Array.isArray(arr)) photoCount = arr.length; } catch { /* ignore */ }
    return {
      id: r.id,
      question_id: r.question_id,
      code: r.code,
      display_name: r.sub ? names.get(r.sub) ?? null : null,
      photo_count: photoCount,
      max_score: r.max_score,
      ai_score: r.ai_score,
      ai_feedback: r.ai_feedback,
      teacher_score: r.teacher_score,
      effective_score: r.teacher_score ?? r.ai_score ?? null,
      updated_at: r.updated_at,
    };
  });
}

export async function registerQuizRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/pdfs/:id/quizzes', async (request, reply) => {
    const parsed = IdParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid pdf id'));
    const pdfRow = getPdfPermissionRow(parsed.data.id);
    if (!pdfRow) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${parsed.data.id} not found`));
    if (!canReadPdf(sessionSub(request), pdfRow, aclCtx(request, parsed.data.id))) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限檢視此簡報的測驗'));
    }
    const rows = db
      .prepare(`SELECT id, pdf_id, title, prompt, questions_json, time_limit_seconds, shuffle_questions, is_public, record_camera, created_at, updated_at FROM quiz_sets WHERE pdf_id = ? ORDER BY updated_at DESC`)
      .all(parsed.data.id) as QuizSetRow[];
    // 有編輯權限（老師/協作者）看得到全部測驗；唯讀學生只看得到 public 的，加上「正在進行」
    // 的那一份（master 在線且設了 active_quiz_id）——讓老師能預先備題、開始後學生才看得到。
    const canEdit = canEditPdf(sessionSub(request), pdfRow, aclCtx(request, parsed.data.id));
    let visible = rows;
    if (!canEdit) {
      let activeQuizId: number | null = null;
      const sess = db
        .prepare(`SELECT active_quiz_id, master_expires_at FROM pdf_sync_sessions WHERE pdf_id = ?`)
        .get(parsed.data.id) as { active_quiz_id: number | null; master_expires_at: string | null } | undefined;
      if (sess?.master_expires_at && new Date(sess.master_expires_at).getTime() > Date.now()) {
        activeQuizId = sess.active_quiz_id ?? null;
      }
      visible = rows.filter((r) => r.is_public === 1 || r.id === activeQuizId);
    }
    return reply.send({ quizzes: visible.map(rowToQuiz) });
  });

  app.post('/api/pdfs/:id/quizzes/generate', async (request, reply) => {
    const parsed = IdParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid pdf id'));
    const body = GenerateQuizBodySchema.safeParse(request.body ?? {});
    if (!body.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', body.error.issues[0]?.message ?? 'Invalid body'));
    const pdf = db.prepare(`SELECT id, title, page_count, source_type, owner_sub, visibility FROM pdfs WHERE id = ?`).get(parsed.data.id) as
      | { id: string; title: string | null; page_count: number | null; source_type: string | null; owner_sub: string | null; visibility: PdfRow['visibility'] }
      | undefined;
    if (!pdf) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${parsed.data.id} not found`));
    if (!canEditPdf(sessionSub(request), pdf, aclCtx(request, parsed.data.id))) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限為此簡報產生測驗'));
    }
    const existingQuestions = body.data.existing_questions;
    try {
      const context = await readQuizContext(parsed.data.id, pdf.source_type, pdf.page_count);

      // Editing an existing quiz: ask the model for a *patch* (only the questions to add/change plus
      // the ids to delete) and merge it into the current list. This is what stops an edit prompt from
      // silently wiping questions the teacher never asked to touch.
      if (existingQuestions.length > 0) {
        const result = await callChatJSON({
          label: `quiz-edit ${parsed.data.id}`,
          messages: [
            {
              role: 'system',
              content:
                '你是繁體中文教學測驗設計助理。老師會給你「既有題目列表」（每題都有 id）與修改指示。' +
                '請「只」輸出需要新增或修改的題目，未受影響的題目一律不要輸出。' +
                '請只輸出 JSON，格式為 {"title":"...","changed_questions":[...],"removed_question_ids":[...]}。' +
                'changed_questions 內：要修改某既有題目時，該題的 id 必須沿用原題目的 id；要新增題目時，請「省略」id 這個欄位（不要填空字串）。' +
                '選擇題 type 為 single 或 multiple，options 是 {text} 陣列（至少 2 個），answer_indices 是 0-based 正確選項索引；' +
                '問答題 type 為 essay（學生於紙上作答後拍照上傳），沒有 options 與 answer_indices。每題請提供 explanation。' +
                'removed_question_ids 放要刪除的既有題目 id。若不需刪除任何題目，就回傳空陣列。',
            },
            {
              role: 'user',
              content: [
                `簡報標題：${pdf.title ?? '未命名簡報'}`,
                `老師修改指示：${body.data.prompt}`,
                `既有題目列表（含 id，未被你輸出者將原樣保留）：${JSON.stringify(existingQuestions)}`,
                `簡報內容：\n${context}`,
              ].join('\n\n'),
            },
          ],
          schema: QuizEditResponseSchema,
          maxTokens: 5000,
          temperature: 0.4,
        });
        const questions = mergeEditedQuestions(existingQuestions, result.data.changed_questions, result.data.removed_question_ids);
        return reply.send({ title: result.data.title, questions });
      }

      const result = await callChatJSON({
        label: `quiz-generate ${parsed.data.id}`,
        messages: [
          { role: 'system', content: '你是繁體中文教學測驗設計助理。請只輸出 JSON，格式為 {"title":"...","questions":[...]}。每題 type 為 single 或 multiple，options 是 {text} 陣列，answer_indices 是 0-based 正確選項索引，並提供 explanation。' },
          { role: 'user', content: [`簡報標題：${pdf.title ?? '未命名簡報'}`, `老師提示詞：${body.data.prompt}`, `簡報內容：\n${context}`].join('\n\n') },
        ],
        schema: z.object({ title: z.string().trim().min(1).max(200), questions: GeneratedQuizQuestionsSchema }),
        maxTokens: 5000,
        temperature: 0.4,
      });
      return reply.send({ title: result.data.title, questions: normalizeQuestions(result.data.questions) });
    } catch (err) {
      // The LLM call can throw on a transient API error, a timeout, or output that fails schema
      // validation after retries. Return a clean 502 the editor can surface ("AI 產生失敗") instead
      // of leaking an opaque 500.
      logger.error(
        { pdfId: parsed.data.id, editMode: existingQuestions.length > 0, error: err instanceof Error ? err.message : String(err) },
        'quiz-generate: AI generation failed',
      );
      return reply.code(502).send(errorResponse('AI_GENERATION_FAILED', 'AI 產生／修改測驗失敗，請稍後再試'));
    }
  });

  app.post('/api/pdfs/:id/quizzes', async (request, reply) => {
    const parsed = IdParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid pdf id'));
    const body = SaveQuizBodySchema.safeParse(request.body ?? {});
    if (!body.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', body.error.issues[0]?.message ?? 'Invalid body'));
    const pdfRow = getPdfPermissionRow(parsed.data.id);
    if (!pdfRow) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${parsed.data.id} not found`));
    if (!canEditPdf(sessionSub(request), pdfRow, aclCtx(request, parsed.data.id))) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限為此簡報新增測驗'));
    }
    const now = nowIso();
    const result = db.prepare(`INSERT INTO quiz_sets (pdf_id, title, prompt, questions_json, time_limit_seconds, shuffle_questions, is_public, record_camera, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(parsed.data.id, body.data.title, body.data.prompt, JSON.stringify(normalizeSavedQuestions(body.data.questions)), body.data.time_limit_seconds, body.data.shuffle_questions ? 1 : 0, body.data.is_public ? 1 : 0, body.data.record_camera ? 1 : 0, now, now);
    const row = db.prepare(`SELECT id, pdf_id, title, prompt, questions_json, time_limit_seconds, shuffle_questions, is_public, record_camera, created_at, updated_at FROM quiz_sets WHERE id = ?`).get(result.lastInsertRowid) as QuizSetRow;
    return reply.code(201).send(rowToQuiz(row));
  });

  app.put('/api/pdfs/:id/quizzes/:quizId', async (request, reply) => {
    const parsed = QuizParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid quiz parameters'));
    const body = SaveQuizBodySchema.safeParse(request.body ?? {});
    if (!body.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', body.error.issues[0]?.message ?? 'Invalid body'));
    const pdfRow = getPdfPermissionRow(parsed.data.id);
    if (!pdfRow) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${parsed.data.id} not found`));
    if (!canEditPdf(sessionSub(request), pdfRow, aclCtx(request, parsed.data.id))) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限編輯此簡報的測驗'));
    }
    const now = nowIso();
    const result = db.prepare(`UPDATE quiz_sets SET title = ?, prompt = ?, questions_json = ?, time_limit_seconds = ?, shuffle_questions = ?, is_public = ?, record_camera = ?, updated_at = ? WHERE id = ? AND pdf_id = ?`).run(body.data.title, body.data.prompt, JSON.stringify(normalizeSavedQuestions(body.data.questions)), body.data.time_limit_seconds, body.data.shuffle_questions ? 1 : 0, body.data.is_public ? 1 : 0, body.data.record_camera ? 1 : 0, now, parsed.data.quizId, parsed.data.id);
    if (result.changes === 0) return reply.code(404).send(errorResponse('QUIZ_NOT_FOUND', `Quiz ${parsed.data.quizId} not found`));
    const row = db.prepare(`SELECT id, pdf_id, title, prompt, questions_json, time_limit_seconds, shuffle_questions, is_public, record_camera, created_at, updated_at FROM quiz_sets WHERE id = ?`).get(parsed.data.quizId) as QuizSetRow;
    return reply.send(rowToQuiz(row));
  });

  app.delete('/api/pdfs/:id/quizzes/:quizId', async (request, reply) => {
    const parsed = QuizParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid quiz parameters'));
    const pdfRow = getPdfPermissionRow(parsed.data.id);
    if (!pdfRow) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${parsed.data.id} not found`));
    if (!canDestructivelyEditPdf(sessionSub(request), pdfRow, aclCtx(request, parsed.data.id))) {
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
    if (!canReadPdf(sessionSub(request), pdfRow, aclCtx(request, parsed.data.id))) {
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
    if (!canReadPdf(sessionSub(request), pdfRow, aclCtx(request, parsed.data.id))) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限檢視此簡報的測驗作答紀錄'));
    }
    const quiz = db.prepare(`SELECT id FROM quiz_sets WHERE id = ? AND pdf_id = ?`).get(parsed.data.quizId, parsed.data.id) as { id: number } | undefined;
    if (!quiz) return reply.code(404).send(errorResponse('QUIZ_NOT_FOUND', `Quiz ${parsed.data.quizId} not found`));
    let rows = db
      .prepare(
        `SELECT id, pdf_id, quiz_id, session_id, client_id, code, sub, answers_json, score, submitted_at, created_at, updated_at
         FROM quiz_attempts WHERE quiz_id = ? ORDER BY submitted_at DESC`,
      )
      .all(parsed.data.quizId) as QuizAttemptRow[];
    // 老師（可編輯）看得到全部作答；唯讀學生只能看自己的紀錄（依登入帳號 sub 比對）。
    // 未登入者無法辨識「自己的」紀錄，回空陣列以免看到其他人的作答。
    if (!canEditPdf(sessionSub(request), pdfRow, aclCtx(request, parsed.data.id))) {
      const sub = sessionSub(request);
      rows = sub ? rows.filter((r) => r.sub === sub) : [];
    }
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
    if (!canReadPdf(sub, srcRow, aclCtx(request, id))) return reply.code(403).send(errorResponse('FORBIDDEN', '無權限讀取來源簡報'));

    const dstRow = getPdfPermissionRow(targetId);
    if (!dstRow) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `Target PDF ${targetId} not found`));
    if (!canEditPdf(sub, dstRow, aclCtx(request, targetId))) return reply.code(403).send(errorResponse('FORBIDDEN', '無權限修改目標簡報'));

    const quiz = db
      .prepare(`SELECT title, questions_json, prompt, time_limit_seconds, shuffle_questions, record_camera FROM quiz_sets WHERE id = ? AND pdf_id = ?`)
      .get(quizId, id) as Pick<QuizSetRow, 'title' | 'questions_json' | 'prompt' | 'time_limit_seconds' | 'shuffle_questions' | 'record_camera'> | undefined;
    if (!quiz) return reply.code(404).send(errorResponse('QUIZ_NOT_FOUND', `Quiz ${quizId} not found`));

    const now = nowIso();
    const result = db
      .prepare(`INSERT INTO quiz_sets (pdf_id, title, prompt, questions_json, time_limit_seconds, shuffle_questions, record_camera, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(targetId, quiz.title, quiz.prompt, quiz.questions_json, quiz.time_limit_seconds, quiz.shuffle_questions, quiz.record_camera, now, now);
    const newRow = db
      .prepare(`SELECT id, pdf_id, title, prompt, questions_json, time_limit_seconds, shuffle_questions, record_camera, created_at, updated_at FROM quiz_sets WHERE id = ?`)
      .get(result.lastInsertRowid) as QuizSetRow;
    return reply.code(201).send(rowToQuiz(newRow));
  });

  // 學生作答期間的監考錄影上傳（multipart）。與作答提交同樣的存取守門。
  app.post('/api/pdfs/:id/quizzes/:quizId/recordings', async (request, reply) => {
    const parsed = QuizParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid quiz parameters'));
    if (!request.isMultipart()) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Expected multipart/form-data'));
    const pdfRow = getPdfPermissionRow(parsed.data.id);
    if (!pdfRow) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${parsed.data.id} not found`));
    if (!canReadPdf(sessionSub(request), pdfRow, aclCtx(request, parsed.data.id))) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限上傳此測驗的錄影'));
    }
    const quiz = db.prepare(`SELECT id FROM quiz_sets WHERE id = ? AND pdf_id = ?`).get(parsed.data.quizId, parsed.data.id) as { id: number } | undefined;
    if (!quiz) return reply.code(404).send(errorResponse('QUIZ_NOT_FOUND', `Quiz ${parsed.data.quizId} not found`));

    let file;
    try {
      file = await request.file();
    } catch {
      return reply.code(413).send(errorResponse('FILE_TOO_LARGE', '錄影檔超過大小上限'));
    }
    if (!file) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Missing recording file'));
    const sessionId = multipartFieldValue(file.fields.session_id);
    const clientId = multipartFieldValue(file.fields.client_id);
    const code = multipartFieldValue(file.fields.code)?.trim() || null;
    if (!sessionId || !clientId) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Missing session_id or client_id'));

    let buffer: Buffer;
    try {
      buffer = await file.toBuffer();
    } catch {
      return reply.code(413).send(errorResponse('FILE_TOO_LARGE', '錄影檔超過大小上限'));
    }
    if (buffer.length === 0) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Empty recording'));

    const fileName = quizRecordingFilename(parsed.data.quizId, sessionId, clientId);
    await fs.mkdir(quizRecordingsDir(parsed.data.id), { recursive: true });
    await fs.writeFile(quizRecordingPath(parsed.data.id, fileName), buffer);

    const now = nowIso();
    const mime = file.mimetype ?? null;
    const sub = sessionSub(request);
    db.prepare(
      `INSERT INTO quiz_recordings (pdf_id, quiz_id, session_id, client_id, code, sub, file_name, size_bytes, mime_type, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (session_id, client_id) DO UPDATE SET
         code = excluded.code,
         sub = excluded.sub,
         file_name = excluded.file_name,
         size_bytes = excluded.size_bytes,
         mime_type = excluded.mime_type,
         updated_at = excluded.updated_at`,
    ).run(parsed.data.id, parsed.data.quizId, sessionId, clientId, code, sub, fileName, buffer.length, mime, now, now);
    return reply.code(201).send({ ok: true, size_bytes: buffer.length });
  });

  // 老師檢視某測驗的所有監考錄影清單。
  app.get('/api/pdfs/:id/quizzes/:quizId/recordings', async (request, reply) => {
    const parsed = QuizParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid quiz parameters'));
    const pdfRow = getPdfPermissionRow(parsed.data.id);
    if (!pdfRow) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${parsed.data.id} not found`));
    if (!isPdfOwner(sessionSub(request), pdfRow)) return reply.code(403).send(errorResponse('FORBIDDEN', '無權限檢視測驗錄影'));
    const rows = db
      .prepare(
        `SELECT id, session_id, client_id, code, sub, size_bytes, mime_type, created_at, updated_at
         FROM quiz_recordings WHERE quiz_id = ? AND pdf_id = ? ORDER BY updated_at DESC`,
      )
      .all(parsed.data.quizId, parsed.data.id) as Array<{
        id: number; session_id: string; client_id: string; code: string | null; sub: string | null;
        size_bytes: number; mime_type: string | null; created_at: string; updated_at: string;
      }>;
    const names = getAccountDisplayNames(rows.map((r) => r.sub).filter((s): s is string => Boolean(s)));
    return reply.send({
      recordings: rows.map((r) => ({
        id: r.id,
        session_id: r.session_id,
        client_id: r.client_id,
        code: r.code,
        display_name: r.sub ? names.get(r.sub) ?? null : null,
        size_bytes: r.size_bytes,
        mime_type: r.mime_type,
        created_at: r.created_at,
        updated_at: r.updated_at,
      })),
    });
  });

  // 老師下載/串流單一錄影檔。
  app.get('/api/pdfs/:id/quizzes/:quizId/recordings/:recordingId/file', async (request, reply) => {
    const parsed = QuizParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid quiz parameters'));
    const recordingId = Number((request.params as { recordingId?: string }).recordingId);
    if (!Number.isInteger(recordingId) || recordingId <= 0) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid recording id'));
    const pdfRow = getPdfPermissionRow(parsed.data.id);
    if (!pdfRow) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${parsed.data.id} not found`));
    if (!isPdfOwner(sessionSub(request), pdfRow)) return reply.code(403).send(errorResponse('FORBIDDEN', '無權限下載測驗錄影'));
    const row = db
      .prepare(`SELECT file_name, mime_type FROM quiz_recordings WHERE id = ? AND quiz_id = ? AND pdf_id = ?`)
      .get(recordingId, parsed.data.quizId, parsed.data.id) as { file_name: string; mime_type: string | null } | undefined;
    if (!row) return reply.code(404).send(errorResponse('RECORDING_NOT_FOUND', `Recording ${recordingId} not found`));
    const filePath = quizRecordingPath(parsed.data.id, row.file_name);
    try {
      await fs.access(filePath);
    } catch {
      return reply.code(404).send(errorResponse('RECORDING_NOT_FOUND', 'Recording file missing on disk'));
    }
    reply.header('Content-Type', row.mime_type || 'video/webm');
    reply.header('Content-Disposition', `inline; filename="${row.file_name}"`);
    return reply.send(createReadStream(filePath));
  });

  // 學生上傳一題問答題（essay）的紙本作答照片（multipart，可多張），伺服器 AI 閱卷後儲存。
  app.post('/api/pdfs/:id/quizzes/:quizId/essay-answers', async (request, reply) => {
    const parsed = QuizParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid quiz parameters'));
    if (!request.isMultipart()) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Expected multipart/form-data'));
    const pdfRow = getPdfPermissionRow(parsed.data.id);
    if (!pdfRow) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${parsed.data.id} not found`));
    if (!canReadPdf(sessionSub(request), pdfRow, aclCtx(request, parsed.data.id))) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限上傳此測驗的作答'));
    }
    const quizRow = db.prepare(`SELECT id, questions_json, grading_instruction FROM quiz_sets WHERE id = ? AND pdf_id = ?`).get(parsed.data.quizId, parsed.data.id) as
      | { id: number; questions_json: string; grading_instruction: string | null }
      | undefined;
    if (!quizRow) return reply.code(404).send(errorResponse('QUIZ_NOT_FOUND', `Quiz ${parsed.data.quizId} not found`));

    const fields: Record<string, string> = {};
    const photoBuffers: Buffer[] = [];
    try {
      // The global multipart registration caps files at 1; an essay answer is explicitly multi-photo
      // (a page written across several shots), so raise the per-request files limit here. The 2nd file
      // otherwise trips FilesLimitError, which the catch below turns into a 413 — i.e. multi-photo
      // uploads used to always fail. fileSize stays inherited from the global limits (deep-merged).
      for await (const part of request.parts({ limits: { files: MAX_ESSAY_PHOTOS } })) {
        if (part.type === 'file') {
          photoBuffers.push(await part.toBuffer());
        } else if (typeof part.value === 'string') {
          fields[part.fieldname] = part.value;
        }
      }
    } catch {
      return reply.code(413).send(errorResponse('FILE_TOO_LARGE', '上傳照片超過大小上限或張數上限'));
    }
    const sessionId = fields.session_id?.trim();
    const clientId = fields.client_id?.trim();
    const questionId = fields.question_id?.trim();
    const code = fields.code?.trim() || null;
    if (!sessionId || !clientId || !questionId) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Missing session_id, client_id or question_id'));
    if (photoBuffers.length === 0) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'No photos uploaded'));

    const questionsResult = QuizQuestionsSchema.safeParse((() => { try { return JSON.parse(quizRow.questions_json); } catch { return []; } })());
    const questions = questionsResult.success ? questionsResult.data : [];
    const qIdx = questions.findIndex((q) => q.id === questionId);
    const question = qIdx >= 0 ? questions[qIdx] : undefined;
    if (!question || question.type !== 'essay') return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Not an essay question'));
    const maxScore = normalizeQuestionScores(questions)[qIdx] ?? 0;

    await fs.mkdir(quizEssayDir(parsed.data.id), { recursive: true });
    const fileNames: string[] = [];
    const dataUrls: string[] = [];
    for (let i = 0; i < photoBuffers.length; i++) {
      const processed = await processEssayPhoto(photoBuffers[i]!);
      if (!processed) continue;
      const fileName = essayPhotoFilename(parsed.data.quizId, sessionId, clientId, questionId, i);
      await fs.writeFile(quizEssayPath(parsed.data.id, fileName), processed.jpeg);
      fileNames.push(fileName);
      dataUrls.push(processed.dataUrl);
    }
    if (fileNames.length === 0) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Could not process any photo'));

    const graded = await gradeEssayAnswer({
      question: question.question,
      referenceAnswer: question.reference_answer ?? '',
      maxScore,
      imageDataUrls: dataUrls,
      gradingInstruction: quizRow.grading_instruction ?? '',
      label: `quiz-essay-grade:${parsed.data.quizId}:${questionId}`,
    });
    const now = nowIso();
    const sub = sessionSub(request);
    // On re-upload the answer changed, so any prior teacher override is cleared (teacher_score → NULL).
    db.prepare(
      `INSERT INTO quiz_essay_answers (pdf_id, quiz_id, question_id, session_id, client_id, code, sub, file_names, max_score, ai_score, ai_feedback, teacher_score, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
       ON CONFLICT (session_id, client_id, question_id) DO UPDATE SET
         code = excluded.code,
         sub = excluded.sub,
         file_names = excluded.file_names,
         max_score = excluded.max_score,
         ai_score = excluded.ai_score,
         ai_feedback = excluded.ai_feedback,
         teacher_score = NULL,
         updated_at = excluded.updated_at`,
    ).run(parsed.data.id, parsed.data.quizId, questionId, sessionId, clientId, code, sub, JSON.stringify(fileNames), maxScore, graded?.score ?? null, graded?.feedback ?? null, now, now);
    // Score/feedback are intentionally not returned to the student — those are for the teacher's review.
    return reply.code(201).send({ ok: true, photo_count: fileNames.length, graded: graded != null });
  });

  // 老師檢視某測驗所有問答題的作答與 AI 評分。
  app.get('/api/pdfs/:id/quizzes/:quizId/essay-answers', async (request, reply) => {
    const parsed = QuizParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid quiz parameters'));
    const pdfRow = getPdfPermissionRow(parsed.data.id);
    if (!pdfRow) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${parsed.data.id} not found`));
    if (!canEditPdf(sessionSub(request), pdfRow, aclCtx(request, parsed.data.id))) return reply.code(403).send(errorResponse('FORBIDDEN', '無權限檢視作答'));
    const quizRow = db.prepare(`SELECT grading_instruction FROM quiz_sets WHERE id = ? AND pdf_id = ?`).get(parsed.data.quizId, parsed.data.id) as
      | { grading_instruction: string | null }
      | undefined;
    if (!quizRow) return reply.code(404).send(errorResponse('QUIZ_NOT_FOUND', `Quiz ${parsed.data.quizId} not found`));
    return reply.send({
      grading_instruction: quizRow.grading_instruction ?? '',
      answers: listEssayAnswersForQuiz(parsed.data.id, parsed.data.quizId),
    });
  });

  // 老師下載/檢視單張作答照片。
  app.get('/api/pdfs/:id/quizzes/:quizId/essay-answers/:answerId/photo/:index', async (request, reply) => {
    const parsed = QuizParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid quiz parameters'));
    const answerId = Number((request.params as { answerId?: string }).answerId);
    const index = Number((request.params as { index?: string }).index);
    if (!Number.isInteger(answerId) || answerId <= 0 || !Number.isInteger(index) || index < 0) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid answer id or index'));
    }
    const pdfRow = getPdfPermissionRow(parsed.data.id);
    if (!pdfRow) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${parsed.data.id} not found`));
    if (!canEditPdf(sessionSub(request), pdfRow, aclCtx(request, parsed.data.id))) return reply.code(403).send(errorResponse('FORBIDDEN', '無權限檢視作答照片'));
    const row = db
      .prepare(`SELECT file_names FROM quiz_essay_answers WHERE id = ? AND quiz_id = ? AND pdf_id = ?`)
      .get(answerId, parsed.data.quizId, parsed.data.id) as { file_names: string } | undefined;
    if (!row) return reply.code(404).send(errorResponse('ESSAY_ANSWER_NOT_FOUND', `Answer ${answerId} not found`));
    let files: string[] = [];
    try { const arr = JSON.parse(row.file_names); if (Array.isArray(arr)) files = arr.filter((x): x is string => typeof x === 'string'); } catch { /* ignore */ }
    const fileName = files[index];
    if (!fileName) return reply.code(404).send(errorResponse('ESSAY_ANSWER_NOT_FOUND', 'Photo index out of range'));
    const filePath = quizEssayPath(parsed.data.id, fileName);
    try {
      await fs.access(filePath);
    } catch {
      return reply.code(404).send(errorResponse('ESSAY_ANSWER_NOT_FOUND', 'Photo file missing on disk'));
    }
    reply.header('Content-Type', 'image/jpeg');
    reply.header('Content-Disposition', `inline; filename="${fileName}"`);
    return reply.send(createReadStream(filePath));
  });

  // 老師覆核／修改 AI 給的分數。
  app.patch('/api/pdfs/:id/quizzes/:quizId/essay-answers/:answerId', async (request, reply) => {
    const parsed = QuizParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid quiz parameters'));
    const answerId = Number((request.params as { answerId?: string }).answerId);
    if (!Number.isInteger(answerId) || answerId <= 0) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid answer id'));
    const body = z.object({ teacher_score: z.number().nullable() }).safeParse(request.body ?? {});
    if (!body.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid body'));
    const pdfRow = getPdfPermissionRow(parsed.data.id);
    if (!pdfRow) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${parsed.data.id} not found`));
    if (!canEditPdf(sessionSub(request), pdfRow, aclCtx(request, parsed.data.id))) return reply.code(403).send(errorResponse('FORBIDDEN', '無權限修改分數'));
    const row = db
      .prepare(`SELECT max_score FROM quiz_essay_answers WHERE id = ? AND quiz_id = ? AND pdf_id = ?`)
      .get(answerId, parsed.data.quizId, parsed.data.id) as { max_score: number } | undefined;
    if (!row) return reply.code(404).send(errorResponse('ESSAY_ANSWER_NOT_FOUND', `Answer ${answerId} not found`));
    const teacherScore = body.data.teacher_score == null ? null : clampEssayScore(body.data.teacher_score, row.max_score);
    db.prepare(`UPDATE quiz_essay_answers SET teacher_score = ?, updated_at = ? WHERE id = ?`).run(teacherScore, nowIso(), answerId);
    return reply.send({ ok: true, teacher_score: teacherScore });
  });

  // 老師設定「修正評分標準」（給 AI 的評分指示），並以此標準對本測驗所有問答題作答重新閱卷。
  // 指示會存到 quiz_sets.grading_instruction，之後學生新上傳的作答也會沿用同一標準。
  app.post('/api/pdfs/:id/quizzes/:quizId/essay-regrade', async (request, reply) => {
    const parsed = QuizParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid quiz parameters'));
    const body = z.object({ instruction: z.string().trim().max(2000).default('') }).safeParse(request.body ?? {});
    if (!body.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid body'));
    const pdfRow = getPdfPermissionRow(parsed.data.id);
    if (!pdfRow) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${parsed.data.id} not found`));
    if (!canEditPdf(sessionSub(request), pdfRow, aclCtx(request, parsed.data.id))) return reply.code(403).send(errorResponse('FORBIDDEN', '無權限重新閱卷'));
    const quizRow = db.prepare(`SELECT questions_json FROM quiz_sets WHERE id = ? AND pdf_id = ?`).get(parsed.data.quizId, parsed.data.id) as
      | { questions_json: string }
      | undefined;
    if (!quizRow) return reply.code(404).send(errorResponse('QUIZ_NOT_FOUND', `Quiz ${parsed.data.quizId} not found`));

    const instruction = body.data.instruction;
    // Persist the instruction first — even with no answers yet, so future uploads use it.
    db.prepare(`UPDATE quiz_sets SET grading_instruction = ?, updated_at = ? WHERE id = ? AND pdf_id = ?`).run(instruction, nowIso(), parsed.data.quizId, parsed.data.id);

    const questionsResult = QuizQuestionsSchema.safeParse((() => { try { return JSON.parse(quizRow.questions_json); } catch { return []; } })());
    const questions = questionsResult.success ? questionsResult.data : [];
    const scoreTable = normalizeQuestionScores(questions);
    const questionById = new Map(questions.map((q, i) => [q.id, { question: q, maxScore: scoreTable[i] ?? 0 }]));

    const answerRows = db
      .prepare(`SELECT id, question_id, file_names FROM quiz_essay_answers WHERE quiz_id = ? AND pdf_id = ?`)
      .all(parsed.data.quizId, parsed.data.id) as Array<{ id: number; question_id: string; file_names: string }>;

    let regraded = 0;
    for (const r of answerRows) {
      const entry = questionById.get(r.question_id);
      if (!entry || entry.question.type !== 'essay') continue;
      const dataUrls = await loadEssayPhotoDataUrls(parsed.data.id, r.file_names);
      if (dataUrls.length === 0) continue;
      const graded = await gradeEssayAnswer({
        question: entry.question.question,
        referenceAnswer: entry.question.reference_answer ?? '',
        maxScore: entry.maxScore,
        imageDataUrls: dataUrls,
        gradingInstruction: instruction,
        label: `quiz-essay-regrade:${parsed.data.quizId}:${r.question_id}`,
      });
      // Re-grading only refreshes the AI score/feedback; a teacher's manual override is left untouched.
      if (graded) {
        db.prepare(`UPDATE quiz_essay_answers SET ai_score = ?, ai_feedback = ?, updated_at = ? WHERE id = ?`).run(graded.score, graded.feedback, nowIso(), r.id);
        regraded++;
      }
    }
    return reply.send({
      ok: true,
      regraded,
      grading_instruction: instruction,
      answers: listEssayAnswersForQuiz(parsed.data.id, parsed.data.quizId),
    });
  });
}
