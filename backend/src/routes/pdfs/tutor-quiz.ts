import type { FastifyInstance, FastifyRequest } from 'fastify';
import fs from 'node:fs';
import { z } from 'zod';
import { canReadPdf, aclCtx } from './permissions';
import { db } from '../../db';
import type { PdfRow } from '../../types';
import { sessionSub } from '../auth';
import { callChatJSON } from '../../services/openai';
import { safeJoinPdfPath, pageScriptPath, pageTextPath } from '../../services/storage';
import { logger } from '../../logger';
import { errorResponse, IdParamSchema } from './shared';
import {
  TUTOR_ASSESSMENT_INTERVAL,
  TUTOR_ASSESSMENT_SYSTEM_PROMPT,
  TUTOR_DEFAULT_LEVEL,
  TUTOR_MAX_QUESTIONS,
  TUTOR_QUESTION_SYSTEM_PROMPT,
  abilityTrend,
  buildAssessmentPrompt,
  buildDeckContext,
  buildQuestionPrompt,
  clampLevel,
  estimateAbility,
  nextLevel,
  segmentRecords,
  shouldAssess,
} from '../../services/tutorQuiz';

interface TutorSessionRow {
  id: number;
  pdf_id: string;
  sub: string | null;
  client_id: string;
  topic: string;
  current_level: number;
  asked_count: number;
  correct_count: number;
  status: string;
  created_at: string;
  updated_at: string;
}

interface TutorQuestionRow {
  seq: number;
  level: number;
  question: string;
  options_json: string;
  correct_index: number;
  explanation: string;
  page_number: number | null;
  answered_index: number | null;
  is_correct: number | null;
}

interface PageScriptRow {
  page_number: number;
  page_uid: string;
  script_path: string | null;
  text_path: string | null;
}

const SessionParamSchema = IdParamSchema.extend({
  sid: z.coerce.number().int().min(1),
});

const ClientIdSchema = z.string().trim().min(1).max(120);

const CreateSessionBodySchema = z.object({
  client_id: ClientIdSchema,
  topic: z.string().trim().max(200).optional().default(''),
});

const NextQuestionBodySchema = z.object({ client_id: ClientIdSchema });

const AnswerBodySchema = z.object({
  client_id: ClientIdSchema,
  seq: z.number().int().min(1).max(TUTOR_MAX_QUESTIONS),
  answer_index: z.number().int().min(0).max(3),
});

const GeneratedQuestionSchema = z.object({
  question: z.string().trim().min(1).max(400),
  options: z.array(z.string().trim().min(1).max(200)).length(4),
  correct_index: z.number().int().min(0).max(3),
  explanation: z.string().trim().max(600).optional().default(''),
  page_number: z.number().int().min(1).max(9999).nullable().optional(),
});

const GeneratedAssessmentSchema = z.object({
  summary: z.string().trim().max(600),
  weak_topics: z.array(z.string().trim().min(1).max(60)).max(3).optional().default([]),
});

function nowIso(): string {
  return new Date().toISOString();
}

function readScript(pdfId: string, row: PageScriptRow): string {
  const scriptAbs = row.script_path ? safeJoinPdfPath(pdfId, row.script_path) : pageScriptPath(pdfId, row.page_uid);
  const textAbs = row.text_path ? safeJoinPdfPath(pdfId, row.text_path) : pageTextPath(pdfId, row.page_uid);
  try { return fs.readFileSync(scriptAbs, 'utf8').trim(); } catch { /* fall through */ }
  try { return fs.readFileSync(textAbs, 'utf8').trim(); } catch { return ''; }
}

/**
 * 整份簡報的逐字稿，逐頁標上頁碼後串接。出題要跨頁（L4/L5 本來就需要整合多頁），
 * 標頁碼則是為了讓模型能回報 page_number，答錯時可直接跳回該頁複習。
 * 長度配額的處理見 buildDeckContext。
 */
function readDeckContext(pdfId: string): string {
  const pages = db
    .prepare(`SELECT page_number, page_uid, script_path, text_path FROM pages WHERE pdf_id = ? ORDER BY page_number ASC`)
    .all(pdfId) as PageScriptRow[];
  return buildDeckContext(pages.map((p) => ({ page_number: p.page_number, text: readScript(pdfId, p) })));
}

/** 讀簡報並檢查讀取權限；練習是給學生用的，所以用 canReadPdf 而不是 canEditPdf。 */
function loadReadablePdf(request: FastifyRequest, id: string): { ok: true } | { ok: false; code: number; body: ReturnType<typeof errorResponse> } {
  const pdf = db.prepare(`SELECT owner_sub, visibility FROM pdfs WHERE id = ?`).get(id) as
    | Pick<PdfRow, 'owner_sub' | 'visibility'>
    | undefined;
  if (!pdf) return { ok: false, code: 404, body: errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`) };
  if (!canReadPdf(sessionSub(request), pdf, aclCtx(request, id))) {
    return { ok: false, code: 403, body: errorResponse('FORBIDDEN', 'Access denied') };
  }
  return { ok: true };
}

/**
 * 取出 session 並確認它屬於這位請求者。只靠 sid（自增整數）就能讀寫，等於任何人都能
 * 猜號碼翻別人的練習紀錄與正解，所以一律比對 client_id；登入者另外接受 sub 相符
 * （同一人換了瀏覽器分頁時 client_id 會不同）。
 */
function loadOwnedSession(sid: number, pdfId: string, clientId: string, sub: string | null): TutorSessionRow | null {
  const row = db.prepare(`SELECT * FROM tutor_quiz_sessions WHERE id = ? AND pdf_id = ?`).get(sid, pdfId) as
    | TutorSessionRow
    | undefined;
  if (!row) return null;
  if (row.client_id === clientId) return row;
  if (sub && row.sub === sub) return row;
  return null;
}

function publicSession(row: TutorSessionRow): Record<string, unknown> {
  return {
    id: row.id,
    topic: row.topic,
    current_level: row.current_level,
    asked_count: row.asked_count,
    correct_count: row.correct_count,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** 對外的題目形狀——刻意不含 correct_index / explanation，未作答前正解只留在後端。 */
function publicQuestion(row: TutorQuestionRow): Record<string, unknown> {
  return {
    seq: row.seq,
    level: row.level,
    question: row.question,
    options: JSON.parse(row.options_json) as string[],
    page_number: row.page_number,
  };
}

/** 已作答的題目可以連正解與解說一起回（用於重整後還原歷史）。 */
function answeredQuestion(row: TutorQuestionRow): Record<string, unknown> {
  return {
    ...publicQuestion(row),
    answered_index: row.answered_index,
    is_correct: row.is_correct === 1,
    correct_index: row.correct_index,
    explanation: row.explanation,
  };
}

function listQuestions(sessionId: number): TutorQuestionRow[] {
  return db
    .prepare(
      `SELECT seq, level, question, options_json, correct_index, explanation, page_number, answered_index, is_correct
         FROM tutor_quiz_questions WHERE session_id = ? ORDER BY seq ASC`,
    )
    .all(sessionId) as TutorQuestionRow[];
}

interface AssessmentRow {
  through_seq: number;
  level_estimate: number;
  correct_count: number;
  summary: string;
  weak_topics: string;
  created_at: string;
}

function listAssessments(sessionId: number): Array<Record<string, unknown>> {
  const rows = db
    .prepare(
      `SELECT through_seq, level_estimate, correct_count, summary, weak_topics, created_at
         FROM tutor_quiz_assessments WHERE session_id = ? ORDER BY through_seq ASC`,
    )
    .all(sessionId) as AssessmentRow[];
  return rows.map((r) => ({
    through_seq: r.through_seq,
    level_estimate: r.level_estimate,
    correct_count: r.correct_count,
    summary: r.summary,
    weak_topics: safeParseTopics(r.weak_topics),
    created_at: r.created_at,
  }));
}

function safeParseTopics(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * 產生一次難度評估。落點與正確率由純函式算出（一定有值），AI 只負責那段文字回饋——
 * 所以 LLM 失敗時仍寫入評估、只是 summary 留空，不讓一次 API 抖動吃掉學習者的作答進度。
 */
async function createAssessment(session: TutorSessionRow, throughSeq: number): Promise<Record<string, unknown>> {
  const answered = listQuestions(session.id).filter((q) => q.answered_index !== null);
  const segment = segmentRecords(answered, throughSeq);
  const estimate = estimateAbility(segment.map((q) => ({ level: q.level, is_correct: q.is_correct === 1 })));

  const previous = db
    .prepare(`SELECT level_estimate FROM tutor_quiz_assessments WHERE session_id = ? ORDER BY through_seq DESC LIMIT 1`)
    .get(session.id) as { level_estimate: number } | undefined;
  const trend = abilityTrend(estimate.level_estimate, previous ? previous.level_estimate : null);

  let summary = '';
  let weakTopics: string[] = [];
  try {
    const result = await callChatJSON({
      label: 'tutor_quiz_assessment',
      schema: GeneratedAssessmentSchema,
      maxTokens: 500,
      temperature: 0.4,
      messages: [
        { role: 'system', content: TUTOR_ASSESSMENT_SYSTEM_PROMPT },
        {
          role: 'user',
          content: buildAssessmentPrompt({
            estimate,
            trend,
            topic: session.topic,
            segment: segment.map((q) => ({ question: q.question, level: q.level, is_correct: q.is_correct === 1 })),
          }),
        },
      ],
    });
    summary = result.data.summary;
    weakTopics = result.data.weak_topics ?? [];
  } catch (err) {
    logger.warn({ err, sessionId: session.id, throughSeq }, 'tutor quiz assessment summary failed; storing stats only');
  }

  const t = nowIso();
  db.prepare(
    `INSERT OR REPLACE INTO tutor_quiz_assessments
       (session_id, through_seq, level_estimate, correct_count, summary, weak_topics, created_at)
     VALUES (?,?,?,?,?,?,?)`,
  ).run(session.id, throughSeq, estimate.level_estimate, estimate.correct_count, summary, JSON.stringify(weakTopics), t);

  return {
    through_seq: throughSeq,
    level_estimate: estimate.level_estimate,
    correct_count: estimate.correct_count,
    total: estimate.total,
    accuracy: estimate.accuracy,
    trend,
    summary,
    weak_topics: weakTopics,
    created_at: t,
  };
}

export async function registerTutorQuizRoutes(app: FastifyInstance): Promise<void> {
  // 取回目前進行中的練習（含已答題目與歷次評估），供側欄顯示「繼續練習」與重整後還原。
  app.get('/api/pdfs/:id/tutor-quiz/session', async (request, reply) => {
    const parsed = IdParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid pdf id'));
    const query = z.object({ client_id: ClientIdSchema }).safeParse(request.query);
    if (!query.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'client_id is required'));
    const { id } = parsed.data;

    const access = loadReadablePdf(request, id);
    if (!access.ok) return reply.code(access.code).send(access.body);

    const sub = sessionSub(request);
    const row = db
      .prepare(
        `SELECT * FROM tutor_quiz_sessions
          WHERE pdf_id = ? AND status = 'active' AND (client_id = ? OR (sub IS NOT NULL AND sub = ?))
          ORDER BY updated_at DESC LIMIT 1`,
      )
      .get(id, query.data.client_id, sub) as TutorSessionRow | undefined;
    if (!row) return reply.send({ session: null, questions: [], assessments: [] });

    const questions = listQuestions(row.id);
    return reply.send({
      session: publicSession(row),
      // 未作答的那題不能帶正解出去，所以兩種形狀分開。
      questions: questions.map((q) => (q.answered_index === null ? publicQuestion(q) : answeredQuestion(q))),
      assessments: listAssessments(row.id),
    });
  });

  // 開始一輪新的練習（同時把這位使用者先前未結束的練習收掉，避免同時存在兩個 active）。
  app.post('/api/pdfs/:id/tutor-quiz/session', async (request, reply) => {
    const parsed = IdParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid pdf id'));
    const body = CreateSessionBodySchema.safeParse(request.body ?? {});
    if (!body.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', body.error.issues[0]?.message ?? 'Invalid body'));
    const { id } = parsed.data;

    const access = loadReadablePdf(request, id);
    if (!access.ok) return reply.code(access.code).send(access.body);

    const sub = sessionSub(request);
    const t = nowIso();
    db.prepare(
      `UPDATE tutor_quiz_sessions SET status = 'ended', updated_at = ?
        WHERE pdf_id = ? AND status = 'active' AND (client_id = ? OR (sub IS NOT NULL AND sub = ?))`,
    ).run(t, id, body.data.client_id, sub);

    const info = db
      .prepare(
        `INSERT INTO tutor_quiz_sessions (pdf_id, sub, client_id, topic, current_level, asked_count, correct_count, status, created_at, updated_at)
         VALUES (?,?,?,?,?,0,0,'active',?,?)`,
      )
      .run(id, sub, body.data.client_id, body.data.topic, TUTOR_DEFAULT_LEVEL, t, t);

    const row = db.prepare(`SELECT * FROM tutor_quiz_sessions WHERE id = ?`).get(info.lastInsertRowid) as TutorSessionRow;
    return reply.send({ session: publicSession(row), questions: [], assessments: [] });
  });

  // 出下一題。若上一題還沒作答就回同一題（重整／連點不會重複燒 AI 額度，也不會跳題）。
  app.post('/api/pdfs/:id/tutor-quiz/session/:sid/next', async (request, reply) => {
    const parsed = SessionParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id or session id'));
    const body = NextQuestionBodySchema.safeParse(request.body ?? {});
    if (!body.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'client_id is required'));
    const { id, sid } = parsed.data;

    const access = loadReadablePdf(request, id);
    if (!access.ok) return reply.code(access.code).send(access.body);

    const sub = sessionSub(request);
    const session = loadOwnedSession(sid, id, body.data.client_id, sub);
    if (!session) return reply.code(404).send(errorResponse('SESSION_NOT_FOUND', 'Tutor quiz session not found'));
    if (session.status !== 'active') return reply.code(409).send(errorResponse('SESSION_ENDED', 'This practice session has ended'));

    const existing = listQuestions(session.id);
    const pending = existing.find((q) => q.answered_index === null);
    if (pending) return reply.send({ question: publicQuestion(pending) });

    if (existing.length >= TUTOR_MAX_QUESTIONS) {
      return reply.code(409).send(errorResponse('SESSION_LIMIT_REACHED', `A practice session is limited to ${TUTOR_MAX_QUESTIONS} questions`));
    }

    const context = readDeckContext(id);
    if (!context) return reply.code(409).send(errorResponse('NO_CONTENT', 'This presentation has no transcript to draw questions from'));

    const level = clampLevel(session.current_level);
    const result = await callChatJSON({
      label: 'tutor_quiz_question',
      schema: GeneratedQuestionSchema,
      maxTokens: 700,
      temperature: 0.7,
      messages: [
        { role: 'system', content: TUTOR_QUESTION_SYSTEM_PROMPT },
        {
          role: 'user',
          content: buildQuestionPrompt({
            level,
            context,
            topic: session.topic,
            askedQuestions: existing.map((q) => q.question),
            recentWrongQuestions: existing.filter((q) => q.is_correct === 0).map((q) => q.question),
          }),
        },
      ],
    });

    const seq = existing.length + 1;
    const t = nowIso();
    db.prepare(
      `INSERT INTO tutor_quiz_questions (session_id, seq, level, question, options_json, correct_index, explanation, page_number, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    ).run(
      session.id,
      seq,
      level,
      result.data.question,
      JSON.stringify(result.data.options),
      result.data.correct_index,
      result.data.explanation ?? '',
      result.data.page_number ?? null,
      t,
    );
    db.prepare(`UPDATE tutor_quiz_sessions SET asked_count = ?, updated_at = ? WHERE id = ?`).run(seq, t, session.id);

    return reply.send({
      question: {
        seq,
        level,
        question: result.data.question,
        options: result.data.options,
        page_number: result.data.page_number ?? null,
      },
    });
  });

  // 作答。判分在後端做，順帶調整難度；滿 10 題時一併回傳這一輪的難度評估。
  app.post('/api/pdfs/:id/tutor-quiz/session/:sid/answer', async (request, reply) => {
    const parsed = SessionParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id or session id'));
    const body = AnswerBodySchema.safeParse(request.body ?? {});
    if (!body.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', body.error.issues[0]?.message ?? 'Invalid body'));
    const { id, sid } = parsed.data;

    const access = loadReadablePdf(request, id);
    if (!access.ok) return reply.code(access.code).send(access.body);

    const sub = sessionSub(request);
    const session = loadOwnedSession(sid, id, body.data.client_id, sub);
    if (!session) return reply.code(404).send(errorResponse('SESSION_NOT_FOUND', 'Tutor quiz session not found'));
    if (session.status !== 'active') return reply.code(409).send(errorResponse('SESSION_ENDED', 'This practice session has ended'));

    const question = db
      .prepare(
        `SELECT seq, level, question, options_json, correct_index, explanation, page_number, answered_index, is_correct
           FROM tutor_quiz_questions WHERE session_id = ? AND seq = ?`,
      )
      .get(session.id, body.data.seq) as TutorQuestionRow | undefined;
    if (!question) return reply.code(404).send(errorResponse('QUESTION_NOT_FOUND', `Question ${body.data.seq} not found`));
    if (question.answered_index !== null) {
      return reply.code(409).send(errorResponse('ALREADY_ANSWERED', 'This question has already been answered'));
    }

    const correct = body.data.answer_index === question.correct_index;
    const t = nowIso();
    db.prepare(
      `UPDATE tutor_quiz_questions SET answered_index = ?, is_correct = ?, answered_at = ? WHERE session_id = ? AND seq = ?`,
    ).run(body.data.answer_index, correct ? 1 : 0, t, session.id, body.data.seq);

    const level = clampLevel(question.level);
    const newLevel = nextLevel(level, correct);
    const correctCount = session.correct_count + (correct ? 1 : 0);
    db.prepare(`UPDATE tutor_quiz_sessions SET current_level = ?, correct_count = ?, updated_at = ? WHERE id = ?`)
      .run(newLevel, correctCount, t, session.id);

    const answeredCount = (
      db.prepare(`SELECT COUNT(*) AS c FROM tutor_quiz_questions WHERE session_id = ? AND answered_index IS NOT NULL`)
        .get(session.id) as { c: number }
    ).c;

    const updated = { ...session, current_level: newLevel, correct_count: correctCount };
    const assessment = shouldAssess(answeredCount) ? await createAssessment(updated, answeredCount) : null;

    return reply.send({
      correct,
      correct_index: question.correct_index,
      explanation: question.explanation,
      page_number: question.page_number,
      level,
      next_level: newLevel,
      answered_count: answeredCount,
      correct_count: correctCount,
      // 距離下一次難度評估還差幾題，讓 UI 能顯示「再 3 題就有評估」。
      until_assessment: TUTOR_ASSESSMENT_INTERVAL - (answeredCount % TUTOR_ASSESSMENT_INTERVAL),
      assessment,
    });
  });

  // 結束練習。
  app.post('/api/pdfs/:id/tutor-quiz/session/:sid/end', async (request, reply) => {
    const parsed = SessionParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id or session id'));
    const body = NextQuestionBodySchema.safeParse(request.body ?? {});
    if (!body.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'client_id is required'));
    const { id, sid } = parsed.data;

    const access = loadReadablePdf(request, id);
    if (!access.ok) return reply.code(access.code).send(access.body);

    const session = loadOwnedSession(sid, id, body.data.client_id, sessionSub(request));
    if (!session) return reply.code(404).send(errorResponse('SESSION_NOT_FOUND', 'Tutor quiz session not found'));

    db.prepare(`UPDATE tutor_quiz_sessions SET status = 'ended', updated_at = ? WHERE id = ?`).run(nowIso(), session.id);
    return reply.send({ ok: true });
  });
}
