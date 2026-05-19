import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../db';
import { errorResponse, IdParamSchema, nowIso } from './shared';
import { callChatJSON } from '../../services/openai';

type SyncRole = 'master' | 'follower';

interface SyncSessionState {
  pdfId: string;
  masterClientId: string | null;
  masterExpiresAt: number;
  pageNumber: number;
  isPlaying: boolean;
  currentTime: number;
  followerQuestions: SyncFollowerQuestion[];
  displayedQuestionId: string | null;
  aiAnswer: SyncAiAnswer | null;
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
const MASTER_TTL_MS = 20_000;

function ensurePdfExists(id: string): boolean {
  const row = db.prepare(`SELECT id FROM pdfs WHERE id = ?`).get(id) as { id: string } | undefined;
  return Boolean(row);
}

function nowMs(): number {
  return Date.now();
}

function getSession(pdfId: string): SyncSessionState {
  const hit = sessions.get(pdfId);
  if (hit) {
    if (hit.masterClientId && hit.masterExpiresAt <= nowMs()) {
      hit.masterClientId = null;
    }
    return hit;
  }
  const created: SyncSessionState = {
    pdfId,
    masterClientId: null,
    masterExpiresAt: 0,
      pageNumber: 1,
      isPlaying: false,
      currentTime: 0,
      followerQuestions: [],
      displayedQuestionId: null,
      aiAnswer: null,
      updatedAt: nowIso(),
    };
  sessions.set(pdfId, created);
  return created;
}

function roleFor(session: SyncSessionState, clientId: string): SyncRole {
  return session.masterClientId === clientId ? 'master' : 'follower';
}

export async function registerSyncRoutes(app: FastifyInstance): Promise<void> {
  const ClientBodySchema = z.object({ client_id: z.string().trim().min(1).max(128) });
  const FollowerQuestionBodySchema = z.object({
    client_id: z.string().trim().min(1).max(128),
    code: z.string().trim().max(80).optional(),
    question: z.string().trim().min(1).max(500),
  });
  const MasterQuestionActionBodySchema = z.object({ client_id: z.string().trim().min(1).max(128) });
  const AiAnswerSchema = z.object({ answer: z.string().min(1).max(2000) });
  const UpdateBodySchema = z.object({
    client_id: z.string().trim().min(1).max(128),
    page_number: z.number().int().min(1),
    is_playing: z.boolean(),
    current_time: z.number().min(0),
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
    const { client_id: clientId } = parsedBody.data;
    const session = getSession(id);
    if (!session.masterClientId || session.masterExpiresAt <= nowMs()) {
      session.masterClientId = clientId;
      session.masterExpiresAt = nowMs() + MASTER_TTL_MS;
      session.updatedAt = nowIso();
    }
    return reply.send({
      pdf_id: id,
      role: roleFor(session, clientId),
      master_client_id: session.masterClientId,
      page_number: session.pageNumber,
      is_playing: session.isPlaying,
      current_time: session.currentTime,
      follower_questions: session.followerQuestions,
      displayed_question_id: session.displayedQuestionId,
      ai_answer: session.aiAnswer,
      updated_at: session.updatedAt,
      master_expires_at: new Date(session.masterExpiresAt).toISOString(),
    });
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
    const { client_id: clientId, page_number: pageNumber, is_playing: isPlaying, current_time: currentTime } =
      parsedBody.data;
    const session = getSession(id);
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
    session.updatedAt = nowIso();
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
    const role = clientId ? roleFor(session, clientId) : 'follower';
    return reply.send({
      pdf_id: id,
      role,
      master_client_id: session.masterClientId,
      page_number: session.pageNumber,
      is_playing: session.isPlaying,
      current_time: session.currentTime,
      follower_questions: session.followerQuestions,
      displayed_question_id: session.displayedQuestionId,
      ai_answer: session.aiAnswer,
      updated_at: session.updatedAt,
      master_expires_at: session.masterClientId
        ? new Date(session.masterExpiresAt).toISOString()
        : null,
    });
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
    if (session.masterClientId === clientId) {
      session.masterClientId = null;
      session.masterExpiresAt = 0;
      session.isPlaying = false;
      session.currentTime = 0;
      session.updatedAt = nowIso();
    }
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
    const { client_id: clientId, code, question } = parsedBody.data;
    const session = getSession(id);
    if (roleFor(session, clientId) !== 'follower') {
      return reply.code(403).send(errorResponse('SYNC_NOT_FOLLOWER', 'Only followers can submit questions'));
    }
    const now = nowIso();
    const item: SyncFollowerQuestion = {
      id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      clientId,
      code: code?.trim() || null,
      question,
      createdAt: now,
    };
    session.followerQuestions = [item, ...session.followerQuestions].slice(0, 100);
    session.updatedAt = now;
    return reply.code(201).send(item);
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
      return reply.send(session.aiAnswer);
    } catch (err) {
      request.log.error({ err, pdfId: id }, 'Failed to answer follower questions with AI');
      return reply.code(500).send(errorResponse('INTERNAL_ERROR', 'Failed to answer follower questions with AI'));
    }
  });
}
