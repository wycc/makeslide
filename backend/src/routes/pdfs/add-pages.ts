import type { FastifyInstance, FastifyRequest } from 'fastify';
import { canReadPdf, canEditPdf } from './permissions';
import { z } from 'zod';
import {
  getAddPagesJob,
  startAddPagesFromPrompt,
  continueAddPagesOutlineChat,
  buildInsertionContext,
  abortAddPagesJob,
} from '../../worker/addPagesFromPrompt';
import { IdParamSchema, errorResponse } from './shared';
import { db } from '../../db';
import path from 'node:path';
import fs from 'node:fs';
import { pdfDir } from '../../services/storage';
import { sessionSub } from '../auth';
import type { PdfRow } from '../../types';

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

const AddPagesFromPromptBodySchema = z.object({
  prompt: z.string().trim().max(2000).default(''),
  outline_text: z.string().trim().max(10000).optional(),
  insert_after_page: z.number().int().min(0).optional(),
});

const AddPagesOutlineChatBodySchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().min(1).max(2000),
      }),
    )
    .min(1)
    .max(20),
  insert_after_page: z.number().int().min(0).optional(),
});

export async function registerAddPagesRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/pdfs/:id/add-pages-from-prompt', async (request, reply) => {
    const parsedParams = IdParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id parameter'));
    }
    const parsedBody = AddPagesFromPromptBodySchema.safeParse(request.body ?? {});
    if (!parsedBody.success) {
      return reply
        .code(400)
        .send(
          errorResponse(
            'INVALID_REQUEST',
            parsedBody.error.issues[0]?.message ?? 'Invalid body',
          ),
        );
    }

    const { prompt, outline_text, insert_after_page } = parsedBody.data;

    if (!outline_text && prompt.length < 5) {
      return reply
        .code(400)
        .send(errorResponse('INVALID_REQUEST', 'prompt 至少需要 5 個字，或提供 outline_text'));
    }

    const pdfRow = getPdfPermissionRow(parsedParams.data.id);
    if (!pdfRow) {
      return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${parsedParams.data.id} not found`));
    }
    if (!canEditPdf(sessionSub(request), pdfRow)) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限為此簡報新增頁面'));
    }

    try {
      const state = await startAddPagesFromPrompt(parsedParams.data.id, {
        prompt,
        outlineText: outline_text,
        insertAfterPage: insert_after_page,
      });
      return reply.code(202).send(state);
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === 'PDF_NOT_FOUND') {
        return reply
          .code(404)
          .send(errorResponse('PDF_NOT_FOUND', `PDF ${parsedParams.data.id} not found`));
      }
      if (code === 'PDF_NOT_READY') {
        return reply
          .code(409)
          .send(errorResponse('INVALID_STATE', 'PDF is not ready — cannot add pages'));
      }
      if (code === 'ADD_PAGES_JOB_ALREADY_RUNNING') {
        return reply
          .code(409)
          .send(errorResponse('INVALID_STATE', 'An add-pages job is already running for this deck'));
      }
      request.log.error({ err, pdfId: parsedParams.data.id }, 'Failed to start add-pages job');
      return reply.code(500).send(errorResponse('INTERNAL_ERROR', 'Failed to start add-pages job'));
    }
  });

  app.get('/api/pdfs/:id/add-pages-from-prompt/status', async (request, reply) => {
    const parsedParams = IdParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id parameter'));
    }
    const pdfRow = getPdfPermissionRow(parsedParams.data.id);
    if (!pdfRow) {
      return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${parsedParams.data.id} not found`));
    }
    if (!hasShareAccess(request, parsedParams.data.id) && !canReadPdf(sessionSub(request), pdfRow)) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限檢視此簡報的新增頁面進度'));
    }
    const state = getAddPagesJob(parsedParams.data.id);
    if (!state) {
      return reply
        .code(404)
        .send(errorResponse('ADD_PAGES_JOB_NOT_FOUND', 'No add-pages job found for this deck'));
    }
    return reply.code(200).send(state);
  });

  app.post('/api/pdfs/:id/add-pages-from-prompt/cancel', async (request, reply) => {
    const parsedParams = IdParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id parameter'));
    }
    const pdfRow = getPdfPermissionRow(parsedParams.data.id);
    if (!pdfRow) {
      return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${parsedParams.data.id} not found`));
    }
    if (!canEditPdf(sessionSub(request), pdfRow)) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限取消此簡報的新增頁面任務'));
    }
    const cancelled = abortAddPagesJob(parsedParams.data.id);
    if (!cancelled) {
      return reply
        .code(409)
        .send(errorResponse('INVALID_STATE', 'No running add-pages job to cancel'));
    }
    return reply.code(200).send({ cancelled: true });
  });

  app.post('/api/pdfs/:id/add-pages-outline-chat', async (request, reply) => {
    const parsedParams = IdParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id parameter'));
    }
    const parsedBody = AddPagesOutlineChatBodySchema.safeParse(request.body ?? {});
    if (!parsedBody.success) {
      return reply
        .code(400)
        .send(errorResponse('INVALID_REQUEST', parsedBody.error.issues[0]?.message ?? 'Invalid body'));
    }

    const { id } = parsedParams.data;
    const pdfRow = db
      .prepare(`SELECT page_count, owner_sub, visibility FROM pdfs WHERE id = ?`)
      .get(id) as { page_count: number | null; owner_sub: string | null; visibility: PdfRow['visibility'] } | undefined;
    if (!pdfRow) {
      return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    }
    if (!canEditPdf(sessionSub(request), pdfRow)) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限為此簡報產生大綱'));
    }

    const pageCount = pdfRow.page_count ?? 0;
    const insertAfter = parsedBody.data.insert_after_page ?? pageCount;

    const pageRows = db
      .prepare(`SELECT page_number, text_path FROM pages WHERE pdf_id = ? ORDER BY page_number ASC`)
      .all(id) as Array<{ page_number: number; text_path: string | null }>;

    const pageTexts = await Promise.all(
      pageRows.map(async (p) => {
        if (!p.text_path) return { page_number: p.page_number, text: '' };
        try {
          const text = await fs.promises.readFile(path.join(pdfDir(id), p.text_path), 'utf8');
          return { page_number: p.page_number, text };
        } catch {
          return { page_number: p.page_number, text: '' };
        }
      }),
    );
    const existingContext = buildInsertionContext(pageTexts, insertAfter);

    try {
      const result = await continueAddPagesOutlineChat({
        messages: parsedBody.data.messages,
        existingContext,
        existingPageCount: pageCount,
      });
      return reply.code(200).send(result);
    } catch (err) {
      request.log.error({ err, pdfId: id }, 'Failed to run add-pages outline chat');
      return reply.code(500).send(errorResponse('INTERNAL_ERROR', 'Failed to generate outline'));
    }
  });
}
