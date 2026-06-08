import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { db } from '../../db';
import { errorResponse, IdParamSchema, nowIso } from './shared';
import { callChatJSON } from '../../services/openai';

type SyncRole = 'master' | 'follower';

type SyncJoinAccess = 'direct' | 'share';

interface SyncSessionState {
  pdfId: string;
  masterClientId: string | null;
  masterExpiresAt: number;
  userCodes: Map<string, string>;
  followerAccess: Map<string, SyncJoinAccess>;
  clients: Map<string, number>;
  pageNumber: number;
  isPlaying: boolean;
  currentTime: number;
  followerAudioUnlocked: boolean;
  realtimePollStarted: boolean;
  quizMode: boolean;
  activeQuizId: number | null;
  quizSessionId: string | null;
  quizShowAnswers: boolean;
  followerQuestions: SyncFollowerQuestion[];
  displayedQuestionId: string | null;
  aiAnswer: SyncAiAnswer | null;
  quizProgress: Map<string, SyncQuizProgress>;
  updatedAt: string;
  cursorX: number | null;
  cursorY: number | null;
}

const ShareTokenParamSchema = z.string().regex(/^[A-Za-z0-9_-]{12,128}$/, 'Invalid share token');

function shareTokenFromRequest(request: FastifyRequest): string | null {
  const raw = request.headers['x-makeslide-share-token'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const token = typeof value === 'string' ? value.trim() : '';
  return token ? token : null;
}

function hasValidShareTokenForPdf(pdfId: string, token: string | null): boolean {
  if (!token || !ShareTokenParamSchema.safeParse(token).success) return false;
  const row = db
    .prepare(
      `SELECT s.token
         FROM pdf_shares s
         JOIN pdfs p ON p.id = s.pdf_id
        WHERE s.token = ? AND s.pdf_id = ?`,
    )
    .get(token, pdfId) as { token: string } | undefined;
  return Boolean(row);
}

interface SyncQuizProgress {
  clientId: string;
  code: string | null;
  quizId: number;
  answeredCount: number;
  totalQuestions: number;
  submitted: boolean;
  updatedAt: string;
}

interface SyncFollowerQuestion {
  id: string;
  clientId: string;
  code: string | null;
  question: string;
  createdAt: string;
}

interface SyncAiAnswer {
  id: string;
  answer: string;
  questionIds: string[];
  createdAt: string;
}

const sessions = new Map<string, SyncSessionState>();
const MASTER_TTL_MS = 10 * 60 * 1000;
const CLIENT_TTL_MS = 30_000;

interface SyncSessionRow {
  pdf_id: string;
  master_client_id: string | null;
  master_expires_at: string | null;
  page_number: number;
  is_playing: 0 | 1;
  current_time: number;
  follower_audio_unlocked: 0 | 1;
  realtime_poll_started: 0 | 1;
  quiz_mode: 0 | 1;
  active_quiz_id: number | null;
  quiz_show_answers: 0 | 1;
  updated_at: string;
}

function ensurePdfExists(id: string): boolean {
  const row = db.prepare(`SELECT id FROM pdfs WHERE id = ?`).get(id) as { id: string } | undefined;
  return Boolean(row);
}

function nowMs(): number {
  return Date.now();
}

function rowToExpiresAt(row: SyncSessionRow): number {
  return row.master_expires_at ? Date.parse(row.master_expires_at) : 0;
}

function clearPersistedMasterIfExpired(row: SyncSessionRow): SyncSessionRow {
  const expiresAt = rowToExpiresAt(row);
  if (row.master_client_id && expiresAt <= nowMs()) {
    const updatedAt = nowIso();
    db.prepare(
      `UPDATE pdf_sync_sessions
          SET master_client_id = NULL,
              master_expires_at = NULL,
              is_playing = 0,
              current_time = 0,
              follower_audio_unlocked = 0,
              realtime_poll_started = 0,
              quiz_mode = 0,
              active_quiz_id = NULL,
              quiz_show_answers = 0,
              updated_at = ?
        WHERE pdf_id = ?`,
    ).run(updatedAt, row.pdf_id);
    return {
      ...row,
      master_client_id: null,
      master_expires_at: null,
      is_playing: 0,
      current_time: 0,
      follower_audio_unlocked: 0,
      realtime_poll_started: 0,
      quiz_mode: 0,
      active_quiz_id: null,
      quiz_show_answers: 0,
      updated_at: updatedAt,
    };
  }
  return row;
}

function resetSyncMode(session: SyncSessionState): void {
  session.masterClientId = null;
  session.masterExpiresAt = 0;
  session.isPlaying = false;
  session.currentTime = 0;
  session.followerAudioUnlocked = false;
  session.realtimePollStarted = false;
  session.quizMode = false;
  session.activeQuizId = null;
  session.quizShowAnswers = false;
  session.displayedQuestionId = null;
  session.aiAnswer = null;
  session.quizProgress.clear();
  session.quizSessionId = null;
  session.followerAccess.clear();
  session.updatedAt = nowIso();
}

function revokePdfShares(pdfId: string): void {
  db.prepare(`DELETE FROM pdf_shares WHERE pdf_id = ?`).run(pdfId);
}

function getPersistedSession(pdfId: string): SyncSessionRow | null {
  const row = db.prepare(`SELECT * FROM pdf_sync_sessions WHERE pdf_id = ?`).get(pdfId) as SyncSessionRow | undefined;
  return row ? clearPersistedMasterIfExpired(row) : null;
}

function upsertPersistedSession(session: SyncSessionState): void {
  const now = nowIso();
  const masterExpiresAt = session.masterClientId ? new Date(session.masterExpiresAt).toISOString() : null;
  db.prepare(
    `INSERT INTO pdf_sync_sessions (
       pdf_id, master_client_id, master_expires_at, page_number, is_playing, current_time,
       follower_audio_unlocked, realtime_poll_started, quiz_mode, active_quiz_id, quiz_show_answers,
       created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(pdf_id) DO UPDATE SET
       master_client_id = excluded.master_client_id,
       master_expires_at = excluded.master_expires_at,
       page_number = excluded.page_number,
       is_playing = excluded.is_playing,
       current_time = excluded.current_time,
       follower_audio_unlocked = excluded.follower_audio_unlocked,
       realtime_poll_started = excluded.realtime_poll_started,
       quiz_mode = excluded.quiz_mode,
       active_quiz_id = excluded.active_quiz_id,
       quiz_show_answers = excluded.quiz_show_answers,
       updated_at = excluded.updated_at`,
  ).run(
    session.pdfId,
    session.masterClientId,
    masterExpiresAt,
    session.pageNumber,
    session.isPlaying ? 1 : 0,
    session.currentTime,
    session.followerAudioUnlocked ? 1 : 0,
    session.realtimePollStarted ? 1 : 0,
    session.quizMode ? 1 : 0,
    session.activeQuizId,
    session.quizShowAnswers ? 1 : 0,
    now,
    session.updatedAt,
  );
}

function toQuestionResponse(question: SyncFollowerQuestion): SyncFollowerQuestion & {
  client_id: string;
  created_at: string;
  show_on_screen: boolean;
} {
  return {
    ...question,
    client_id: question.clientId,
    created_at: question.createdAt,
    show_on_screen: false,
  };
}

function toQuizProgressResponse(progress: SyncQuizProgress): {
  client_id: string;
  code: string | null;
  quiz_id: number;
  answered_count: number;
  total_questions: number;
  submitted: boolean;
  updated_at: string;
} {
  return {
    client_id: progress.clientId,
    code: progress.code,
    quiz_id: progress.quizId,
    answered_count: progress.answeredCount,
    total_questions: progress.totalQuestions,
    submitted: progress.submitted,
    updated_at: progress.updatedAt,
  };
}

function toAiAnswerResponse(answer: SyncAiAnswer | null): (SyncAiAnswer & { question_ids: string[]; created_at: string }) | null {
  if (!answer) return null;
  return {
    ...answer,
    question_ids: answer.questionIds,
    created_at: answer.createdAt,
  };
}

function buildStateResponse(session: SyncSessionState, pdfId: string, role: SyncRole, clientId?: string) {
  const followerQuestions = session.followerQuestions.map(toQuestionResponse);
  return {
    pdf_id: pdfId,
    role,
    user_code: clientId ? (session.userCodes.get(clientId) ?? null) : null,
    master_client_id: session.masterClientId,
    page_number: session.pageNumber,
    is_playing: session.isPlaying,
    current_time: session.currentTime,
    follower_audio_unlocked: session.followerAudioUnlocked,
    realtime_poll_started: session.realtimePollStarted,
    quiz_mode: session.quizMode,
    active_quiz_id: session.activeQuizId,
    quiz_session_id: session.quizSessionId,
    quiz_show_answers: session.quizShowAnswers,
    follower_questions: followerQuestions,
    questions: followerQuestions,
    displayed_question_id: session.displayedQuestionId,
    quiz_progress: Array.from(session.quizProgress.values())
      .filter((p) => p.quizId === session.activeQuizId)
      .map(toQuizProgressResponse),
    ai_answer: toAiAnswerResponse(session.aiAnswer),
    updated_at: session.updatedAt,
    master_expires_at: session.masterClientId ? new Date(session.masterExpiresAt).toISOString() : null,
    online_count: onlineClientCount(session),
    cursor_x: session.cursorX,
    cursor_y: session.cursorY,
  };
}

function getSession(pdfId: string): SyncSessionState {
  const hit = sessions.get(pdfId);
  if (hit) {
    pruneExpiredClients(hit);
    const now = nowMs();
    if (hit.masterClientId && hit.masterExpiresAt <= now) {
      resetSyncMode(hit);
      upsertPersistedSession(hit);
    }
    return hit;
  }
  const persisted = getPersistedSession(pdfId);
  const created: SyncSessionState = {
    pdfId,
    masterClientId: persisted?.master_client_id ?? null,
    masterExpiresAt: persisted ? rowToExpiresAt(persisted) : 0,
    userCodes: new Map<string, string>(),
    followerAccess: new Map<string, SyncJoinAccess>(),
    clients: new Map(),
    pageNumber: persisted?.page_number ?? 1,
    isPlaying: Boolean(persisted?.is_playing),
    currentTime: persisted?.current_time ?? 0,
    followerAudioUnlocked: Boolean(persisted?.follower_audio_unlocked),
    realtimePollStarted: Boolean(persisted?.realtime_poll_started),
    quizMode: Boolean(persisted?.quiz_mode),
    activeQuizId: persisted?.active_quiz_id ?? null,
    quizSessionId: null,
    quizShowAnswers: Boolean(persisted?.quiz_show_answers),
    followerQuestions: [],
    displayedQuestionId: null,
    aiAnswer: null,
    quizProgress: new Map<string, SyncQuizProgress>(),
    updatedAt: persisted?.updated_at ?? nowIso(),
    cursorX: null,
    cursorY: null,
  };
  sessions.set(pdfId, created);
  return created;
}

function roleFor(session: SyncSessionState, clientId: string): SyncRole {
  return session.masterClientId === clientId ? 'master' : 'follower';
}

function pruneExpiredClients(session: SyncSessionState): void {
  const now = nowMs();
  for (const [clientId, expiresAt] of session.clients.entries()) {
    if (expiresAt <= now) {
      session.clients.delete(clientId);
      session.quizProgress.delete(clientId);
    }
  }
}

function touchClient(session: SyncSessionState, clientId: string): void {
  pruneExpiredClients(session);
  session.clients.set(clientId, nowMs() + CLIENT_TTL_MS);
}

function onlineClientCount(session: SyncSessionState): number {
  pruneExpiredClients(session);
  return session.clients.size;
}

export async function registerSyncRoutes(app: FastifyInstance): Promise<void> {
  const ClientBodySchema = z.object({
    client_id: z.string().trim().min(1).max(128),
    user_code: z.string().trim().min(1).max(128).optional(),
  });
  const ShareJoinBodySchema = z.object({
    client_id: z.string().trim().min(1).max(128),
  });
  const FollowerQuestionBodySchema = z.object({
    client_id: z.string().trim().min(1).max(128),
    user_code: z.string().trim().max(128).optional(),
    question: z.string().trim().min(1).max(500),
  });
  const MasterQuestionActionBodySchema = z.object({ client_id: z.string().trim().min(1).max(128) });
  const QuizProgressBodySchema = z.object({
    client_id: z.string().trim().min(1).max(128),
    quiz_id: z.number().int().positive(),
    answered_count: z.number().int().min(0),
    total_questions: z.number().int().min(0),
    submitted: z.boolean().optional(),
  });
  const AiAnswerSchema = z.object({ answer: z.string().min(1).max(2000) });
  const UpdateBodySchema = z.object({
    client_id: z.string().trim().min(1).max(128),
    page_number: z.number().int().min(1),
    is_playing: z.boolean(),
    current_time: z.number().min(0),
    follower_audio_unlocked: z.boolean().optional(),
    realtime_poll_started: z.boolean().optional(),
    quiz_mode: z.boolean().optional(),
    active_quiz_id: z.number().int().positive().nullable().optional(),
    quiz_show_answers: z.boolean().optional(),
    cursor_x: z.number().min(0).max(1).nullable().optional(),
    cursor_y: z.number().min(0).max(1).nullable().optional(),
  });
  const StateQuerySchema = z.object({ client_id: z.string().trim().min(1).max(128).optional() });

  app.post('/api/pdfs/:id/sync/join', async (request, reply) => {
    const parsedParams = IdParamSchema.safeParse(request.params);
    const parsedBody = ClientBodySchema.safeParse(request.body);
    if (!parsedParams.success || !parsedBody.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid sync join request'));
    }
    const { id } = parsedParams.data;
    if (!ensurePdfExists(id)) {
      return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    }
    const { client_id: clientId, user_code: userCode } = parsedBody.data;
    const session = getSession(id);
    touchClient(session, clientId);
    if (userCode) session.userCodes.set(clientId, userCode);
    if (!session.masterClientId || session.masterExpiresAt <= nowMs()) {
      session.masterClientId = clientId;
      session.masterExpiresAt = nowMs() + MASTER_TTL_MS;
      session.updatedAt = nowIso();
      upsertPersistedSession(session);
    } else if (session.masterClientId !== clientId) {
      session.updatedAt = nowIso();
    }
    return reply.send(buildStateResponse(session, id, roleFor(session, clientId), clientId));
  });

  app.post('/api/pdfs/:id/sync/share-join', async (request, reply) => {
    const parsedParams = IdParamSchema.safeParse(request.params);
    const parsedBody = ShareJoinBodySchema.safeParse(request.body);
    if (!parsedParams.success || !parsedBody.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid shared sync join request'));
    }
    const { id } = parsedParams.data;
    if (!ensurePdfExists(id)) {
      return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    }
    const shareToken = shareTokenFromRequest(request);
    if (!hasValidShareTokenForPdf(id, shareToken)) {
      return reply.code(403).send(errorResponse('INVALID_SHARE_TOKEN', '分享連結不存在、已失效，或不屬於此簡報'));
    }
    const { client_id: clientId } = parsedBody.data;
    const session = getSession(id);
    touchClient(session, clientId);
    if (!session.masterClientId || session.masterExpiresAt <= nowMs()) {
      return reply.code(409).send(errorResponse('SYNC_NOT_ACTIVE', '原使用者尚未開啟定步模式'));
    }
    if (session.masterClientId === clientId) {
      return reply.send(buildStateResponse(session, id, 'master', clientId));
    }
    session.followerAccess.set(clientId, 'share');
    session.updatedAt = nowIso();
    return reply.send(buildStateResponse(session, id, 'follower', clientId));
  });

  app.post('/api/pdfs/:id/sync/state', async (request, reply) => {
    const parsedParams = IdParamSchema.safeParse(request.params);
    const parsedBody = UpdateBodySchema.safeParse(request.body);
    if (!parsedParams.success || !parsedBody.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid sync state request'));
    }
    const { id } = parsedParams.data;
    if (!ensurePdfExists(id)) {
      return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    }
    const {
      client_id: clientId,
      page_number: pageNumber,
      is_playing: isPlaying,
      current_time: currentTime,
      follower_audio_unlocked: followerAudioUnlocked,
      realtime_poll_started: realtimePollStarted,
      quiz_mode: quizMode,
      active_quiz_id: activeQuizId,
      quiz_show_answers: quizShowAnswers,
      cursor_x: cursorX,
      cursor_y: cursorY,
    } = parsedBody.data;
    const session = getSession(id);
    touchClient(session, clientId);
    if (!session.masterClientId || session.masterExpiresAt <= nowMs()) {
      session.masterClientId = clientId;
    }
    if (session.masterClientId !== clientId) {
      return reply.code(403).send(errorResponse('SYNC_NOT_MASTER', 'Only master can update sync state'));
    }
    session.masterExpiresAt = nowMs() + MASTER_TTL_MS;
    session.pageNumber = pageNumber;
    session.isPlaying = isPlaying;
    session.currentTime = currentTime;
    if (typeof followerAudioUnlocked === 'boolean') session.followerAudioUnlocked = followerAudioUnlocked;
    if (typeof realtimePollStarted === 'boolean') session.realtimePollStarted = realtimePollStarted;
    const previousActiveQuizId = session.activeQuizId;
    if (typeof activeQuizId !== 'undefined') session.activeQuizId = activeQuizId;
    if (typeof quizShowAnswers === 'boolean') session.quizShowAnswers = quizShowAnswers;
    if (typeof quizMode === 'boolean') {
      session.quizMode = quizMode;
      if (!quizMode) {
        session.activeQuizId = null;
        session.quizShowAnswers = false;
      }
    }
    if (session.activeQuizId !== previousActiveQuizId) {
      session.quizProgress.clear();
      session.quizSessionId = session.activeQuizId
        ? `qs-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
        : null;
    }
    if (typeof cursorX !== 'undefined') session.cursorX = cursorX;
    if (typeof cursorY !== 'undefined') session.cursorY = cursorY;
    session.updatedAt = nowIso();
    upsertPersistedSession(session);
    return reply.send({ ok: true, role: 'master', updated_at: session.updatedAt });
  });

  app.get('/api/pdfs/:id/sync/state', async (request, reply) => {
    const parsedParams = IdParamSchema.safeParse(request.params);
    const parsedQuery = StateQuerySchema.safeParse(request.query);
    if (!parsedParams.success || !parsedQuery.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid sync query request'));
    }
    const { id } = parsedParams.data;
    if (!ensurePdfExists(id)) {
      return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    }
    const clientId = parsedQuery.data.client_id;
    const session = getSession(id);
    if (clientId) touchClient(session, clientId);
    const role = clientId ? roleFor(session, clientId) : 'follower';
    return reply.send(buildStateResponse(session, id, role, clientId));
  });

  app.post('/api/pdfs/:id/sync/leave', async (request, reply) => {
    const parsedParams = IdParamSchema.safeParse(request.params);
    const parsedBody = ClientBodySchema.safeParse(request.body);
    if (!parsedParams.success || !parsedBody.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid sync leave request'));
    }
    const { id } = parsedParams.data;
    const { client_id: clientId } = parsedBody.data;
    const session = getSession(id);
    session.clients.delete(clientId);
    session.quizProgress.delete(clientId);
    if (session.masterClientId === clientId) {
      resetSyncMode(session);
      revokePdfShares(id);
      upsertPersistedSession(session);
    }
    session.userCodes.delete(clientId);
    session.followerAccess.delete(clientId);
    return reply.send({ ok: true });
  });

  app.post('/api/pdfs/:id/sync/quiz/progress', async (request, reply) => {
    const parsedParams = IdParamSchema.safeParse(request.params);
    const parsedBody = QuizProgressBodySchema.safeParse(request.body);
    if (!parsedParams.success || !parsedBody.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid sync quiz progress request'));
    }
    const { id } = parsedParams.data;
    if (!ensurePdfExists(id)) {
      return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    }
    const { client_id: clientId, quiz_id: quizId, answered_count: answeredCount, total_questions: totalQuestions, submitted } = parsedBody.data;
    const session = getSession(id);
    if (roleFor(session, clientId) !== 'follower') {
      return reply.code(403).send(errorResponse('SYNC_NOT_FOLLOWER', 'Only followers can report quiz progress'));
    }
    if (!session.quizMode || session.activeQuizId !== quizId) {
      return reply.code(409).send(errorResponse('SYNC_QUIZ_NOT_ACTIVE', 'No matching active quiz to report progress for'));
    }
    touchClient(session, clientId);
    const now = nowIso();
    session.quizProgress.set(clientId, {
      clientId,
      code: session.userCodes.get(clientId) ?? null,
      quizId,
      answeredCount,
      totalQuestions,
      submitted: submitted ?? false,
      updatedAt: now,
    });
    session.updatedAt = now;
    return reply.send({ ok: true });
  });

  app.post('/api/pdfs/:id/sync/questions', async (request, reply) => {
    const parsedParams = IdParamSchema.safeParse(request.params);
    const parsedBody = FollowerQuestionBodySchema.safeParse(request.body);
    if (!parsedParams.success || !parsedBody.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid sync question request'));
    }
    const { id } = parsedParams.data;
    if (!ensurePdfExists(id)) {
      return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    }
    const { client_id: clientId, user_code: userCode, question } = parsedBody.data;
    const session = getSession(id);
    if (userCode) session.userCodes.set(clientId, userCode);
    if (roleFor(session, clientId) !== 'follower') {
      return reply.code(403).send(errorResponse('SYNC_NOT_FOLLOWER', 'Only followers can submit questions'));
    }
    const now = nowIso();
    const item: SyncFollowerQuestion = {
      id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      clientId,
      code: userCode?.trim() || session.userCodes.get(clientId) || null,
      question,
      createdAt: now,
    };
    session.followerQuestions = [item, ...session.followerQuestions].slice(0, 100);
    session.updatedAt = now;
    return reply.code(201).send(toQuestionResponse(item));
  });

  app.post('/api/pdfs/:id/sync/questions/toggle-display', async (request, reply) => {
    const parsedParams = IdParamSchema.safeParse(request.params);
    const parsedBody = MasterQuestionActionBodySchema.safeParse(request.body);
    if (!parsedParams.success || !parsedBody.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid sync question display request'));
    }
    const { id } = parsedParams.data;
    const { client_id: clientId } = parsedBody.data;
    const session = getSession(id);
    if (roleFor(session, clientId) !== 'master') {
      return reply.code(403).send(errorResponse('SYNC_NOT_MASTER', 'Only master can display follower questions'));
    }
    session.displayedQuestionId = session.displayedQuestionId ? null : session.followerQuestions[0]?.id ?? null;
    session.updatedAt = nowIso();
    return reply.send({ ok: true, displayed_question_id: session.displayedQuestionId });
  });

  app.post('/api/pdfs/:id/sync/questions/ai-answer', async (request, reply) => {
    const parsedParams = IdParamSchema.safeParse(request.params);
    const parsedBody = MasterQuestionActionBodySchema.safeParse(request.body);
    if (!parsedParams.success || !parsedBody.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid sync AI answer request'));
    }
    const { id } = parsedParams.data;
    const { client_id: clientId } = parsedBody.data;
    if (!ensurePdfExists(id)) {
      return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    }
    const session = getSession(id);
    if (roleFor(session, clientId) !== 'master') {
      return reply.code(403).send(errorResponse('SYNC_NOT_MASTER', 'Only master can ask AI to answer follower questions'));
    }
    const questions = session.followerQuestions.slice(0, 20).reverse();
    if (questions.length === 0) {
      return reply.code(400).send(errorResponse('NO_FOLLOWER_QUESTIONS', 'No follower questions to answer'));
    }
    const pageRow = db
      .prepare(`SELECT text_path, script_path FROM pages WHERE pdf_id = ? AND page_number = ?`)
      .get(id, session.pageNumber) as { text_path?: string | null; script_path?: string | null } | undefined;
    const pdfRow = db.prepare(`SELECT title FROM pdfs WHERE id = ?`).get(id) as { title?: string | null } | undefined;
    try {
      const fs = await import('node:fs');
      const { safeJoinPdfPath } = await import('../../services/storage');
      const pageText = pageRow?.text_path ? await fs.promises.readFile(safeJoinPdfPath(id, pageRow.text_path), 'utf8').catch(() => '') : '';
      const pageScript = pageRow?.script_path ? await fs.promises.readFile(safeJoinPdfPath(id, pageRow.script_path), 'utf8').catch(() => '') : '';
      const result = await callChatJSON({
        label: `sync-follower-questions-ai-answer ${id}`,
        schema: AiAnswerSchema,
        maxTokens: 1200,
        temperature: 0.3,
        messages: [
          {
            role: 'system',
            content: '你是繁體中文課堂助教。請只輸出 JSON：{"answer":"..."}。請總結學生問題並直接回答，適合投影給全班看。',
          },
          {
            role: 'user',
            content: [
              `簡報標題：${pdfRow?.title?.trim() || '（未命名）'}`,
              `目前頁碼：${session.pageNumber}`,
              `頁面文字：${pageText.trim() || '（無）'}`,
              `頁面逐字稿：${pageScript.trim() || '（無）'}`,
              `學生問題：\n${questions.map((q, idx) => `${idx + 1}. ${q.code ? `[${q.code}] ` : ''}${q.question}`).join('\n')}`,
              '請先用一句話歸納問題主題，再用條列提供清楚回答。',
            ].join('\n\n'),
          },
        ],
      });
      const now = nowIso();
      session.aiAnswer = {
        id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        answer: result.data.answer.trim(),
        questionIds: questions.map((q) => q.id),
        createdAt: now,
      };
      session.displayedQuestionId = null;
      session.updatedAt = now;
      return reply.send(toAiAnswerResponse(session.aiAnswer));
    } catch (err) {
      request.log.error({ err, pdfId: id }, 'Failed to answer follower questions with AI');
      return reply.code(500).send(errorResponse('INTERNAL_ERROR', 'Failed to answer follower questions with AI'));
    }
  });
}
