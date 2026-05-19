import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../db';
import { errorResponse, IdParamSchema, nowIso } from './shared';

type SyncRole = 'master' | 'follower';

interface SyncSessionState {
  pdfId: string;
  masterClientId: string | null;
  masterExpiresAt: number;
  clients: Map<string, number>;
  pageNumber: number;
  isPlaying: boolean;
  currentTime: number;
  updatedAt: string;
}

const sessions = new Map<string, SyncSessionState>();
const MASTER_TTL_MS = 20_000;
const CLIENT_TTL_MS = 30_000;

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
    pruneExpiredClients(hit);
    const now = nowMs();
    if (hit.masterClientId && hit.masterExpiresAt <= now) {
      hit.masterClientId = null;
    }
    return hit;
  }
  const created: SyncSessionState = {
    pdfId,
    masterClientId: null,
    masterExpiresAt: 0,
    clients: new Map(),
    pageNumber: 1,
    isPlaying: false,
    currentTime: 0,
    updatedAt: nowIso(),
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
  const ClientBodySchema = z.object({ client_id: z.string().trim().min(1).max(128) });
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
    touchClient(session, clientId);
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
      updated_at: session.updatedAt,
      master_expires_at: new Date(session.masterExpiresAt).toISOString(),
      online_count: onlineClientCount(session),
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
    if (clientId) touchClient(session, clientId);
    const role = clientId ? roleFor(session, clientId) : 'follower';
    return reply.send({
      pdf_id: id,
      role,
      master_client_id: session.masterClientId,
      page_number: session.pageNumber,
      is_playing: session.isPlaying,
      current_time: session.currentTime,
      updated_at: session.updatedAt,
      master_expires_at: session.masterClientId
        ? new Date(session.masterExpiresAt).toISOString()
        : null,
      online_count: onlineClientCount(session),
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
    session.clients.delete(clientId);
    if (session.masterClientId === clientId) {
      session.masterClientId = null;
      session.masterExpiresAt = 0;
      session.isPlaying = false;
      session.currentTime = 0;
      session.updatedAt = nowIso();
    }
    return reply.send({ ok: true });
  });
}
