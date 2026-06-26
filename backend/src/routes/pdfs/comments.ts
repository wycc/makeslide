import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { db } from '../../db';
import { decodeSession, parseCookies } from '../auth';
import type { PdfRow } from '../../types';
import { errorResponse, IdParamSchema, PageParamSchema, nowIso } from './shared';
import { csvEscape, withCsvBom } from './csv';

function sessionSub(request: FastifyRequest): string | null {
  const session = decodeSession(parseCookies(request).makeslide_session);
  return session?.sub ?? null;
}

function canReadPdf(sub: string | null, row: Pick<PdfRow, 'owner_sub' | 'visibility'>): boolean {
  if (!row.owner_sub) return true;
  if (sub && row.owner_sub === sub) return true;
  return row.visibility === 'public' || row.visibility === 'public_editable';
}

function canEditPdf(sub: string | null, row: Pick<PdfRow, 'owner_sub' | 'visibility'>): boolean {
  if (!row.owner_sub) return true;
  if (sub && row.owner_sub === sub) return true;
  return row.visibility === 'public_editable';
}

function getPdfRow(id: string): Pick<PdfRow, 'owner_sub' | 'visibility'> | undefined {
  return db.prepare(`SELECT owner_sub, visibility FROM pdfs WHERE id = ?`).get(id) as
    | Pick<PdfRow, 'owner_sub' | 'visibility'>
    | undefined;
}

const CommentParamSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{8,32}$/, 'Invalid pdf id'),
  commentId: z
    .string()
    .regex(/^[1-9]\d{0,9}$/, 'Invalid comment id')
    .transform((v) => Number(v))
    .pipe(z.number().int().positive()),
});

const CreateCommentBodySchema = z.object({
  author: z.string().trim().max(80).optional().default('anonymous'),
  text: z.string().trim().min(1, 'text 不可為空').max(2000, 'text 不可超過 2000 字'),
});

const PatchCommentBodySchema = z
  .object({
    resolved: z.boolean().optional(),
    text: z.string().trim().min(1, 'text 不可為空').max(2000, 'text 不可超過 2000 字').optional(),
  })
  .refine((b) => b.resolved !== undefined || b.text !== undefined, {
    message: '需提供 resolved 或 text 至少其一',
  });

interface PageCommentRow {
  id: number;
  pdf_id: string;
  page_number: number;
  author: string;
  text: string;
  resolved: number;
  created_at: string;
}

function rowToComment(row: PageCommentRow) {
  return {
    id: row.id,
    pdf_id: row.pdf_id,
    page_number: row.page_number,
    author: row.author,
    text: row.text,
    resolved: row.resolved === 1,
    created_at: row.created_at,
  };
}

export async function registerCommentsRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/pdfs/:id/comments — list all comments across all pages, ordered by page then time
  app.get<{ Params: z.infer<typeof IdParamSchema> }>('/api/pdfs/:id/comments', async (request, reply) => {
    const parsed = IdParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_PARAMS', parsed.error.message));
    const { id } = parsed.data;
    const sub = sessionSub(request);
    const pdfRow = getPdfRow(id);
    if (!pdfRow) return reply.code(404).send(errorResponse('NOT_FOUND', 'PDF not found'));
    if (!canReadPdf(sub, pdfRow)) return reply.code(403).send(errorResponse('FORBIDDEN', 'Access denied'));
    const rows = db
      .prepare(`SELECT * FROM page_comments WHERE pdf_id = ? ORDER BY page_number ASC, created_at ASC`)
      .all(id) as PageCommentRow[];
    return reply.send({ comments: rows.map(rowToComment) });
  });

  // GET /api/pdfs/:id/comments.csv — export all comments as CSV (requires edit permission)
  app.get<{ Params: z.infer<typeof IdParamSchema> }>('/api/pdfs/:id/comments.csv', async (request, reply) => {
    const parsed = IdParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_PARAMS', parsed.error.message));
    const { id } = parsed.data;
    const sub = sessionSub(request);
    const pdfRow = getPdfRow(id);
    if (!pdfRow) return reply.code(404).send(errorResponse('NOT_FOUND', 'PDF not found'));
    if (!canEditPdf(sub, pdfRow)) return reply.code(403).send(errorResponse('FORBIDDEN', '無權限下載評論'));
    const rows = db
      .prepare(`SELECT * FROM page_comments WHERE pdf_id = ? ORDER BY page_number ASC, created_at ASC`)
      .all(id) as PageCommentRow[];
    const lines: string[] = [['page', 'author', 'text', 'resolved', 'created_at'].join(',')];
    for (const row of rows) {
      lines.push(
        [
          csvEscape(row.page_number),
          csvEscape(row.author),
          csvEscape(row.text),
          csvEscape(row.resolved === 1 ? 'true' : 'false'),
          csvEscape(row.created_at),
        ].join(','),
      );
    }
    const csv = lines.join('\n') + '\n';
    reply.header('content-type', 'text/csv; charset=utf-8');
    reply.header('content-disposition', `attachment; filename="comments-${id}.csv"`);
    reply.header('cache-control', 'no-store');
    return reply.send(withCsvBom(csv));
  });

  // GET /api/pdfs/:id/pages/:n/comments
  app.get<{ Params: z.infer<typeof PageParamSchema> }>('/api/pdfs/:id/pages/:n/comments', async (request, reply) => {
    const parsed = PageParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_PARAMS', parsed.error.message));
    const { id, n } = parsed.data;
    const sub = sessionSub(request);
    const pdfRow = getPdfRow(id);
    if (!pdfRow) return reply.code(404).send(errorResponse('NOT_FOUND', 'PDF not found'));
    if (!canReadPdf(sub, pdfRow)) return reply.code(403).send(errorResponse('FORBIDDEN', 'Access denied'));
    const rows = db
      .prepare(`SELECT * FROM page_comments WHERE pdf_id = ? AND page_number = ? ORDER BY created_at ASC`)
      .all(id, n) as PageCommentRow[];
    return reply.send({ comments: rows.map(rowToComment) });
  });

  // POST /api/pdfs/:id/pages/:n/comments
  app.post<{ Params: z.infer<typeof PageParamSchema>; Body: z.infer<typeof CreateCommentBodySchema> }>(
    '/api/pdfs/:id/pages/:n/comments',
    async (request, reply) => {
      const parsed = PageParamSchema.safeParse(request.params);
      if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_PARAMS', parsed.error.message));
      const { id, n } = parsed.data;
      const bodyParsed = CreateCommentBodySchema.safeParse(request.body);
      if (!bodyParsed.success) return reply.code(400).send(errorResponse('INVALID_BODY', bodyParsed.error.message));
      const { author, text } = bodyParsed.data;
      const sub = sessionSub(request);
      const pdfRow = getPdfRow(id);
      if (!pdfRow) return reply.code(404).send(errorResponse('NOT_FOUND', 'PDF not found'));
      if (!canReadPdf(sub, pdfRow)) return reply.code(403).send(errorResponse('FORBIDDEN', 'Access denied'));
      const now = nowIso();
      const result = db
        .prepare(
          `INSERT INTO page_comments (pdf_id, page_number, author, text, resolved, created_at) VALUES (?, ?, ?, ?, 0, ?) RETURNING *`,
        )
        .get(id, n, author, text, now) as PageCommentRow;
      return reply.code(201).send({ comment: rowToComment(result) });
    },
  );

  // PATCH /api/pdfs/:id/comments/:commentId — update resolved and/or text
  app.patch<{ Params: z.infer<typeof CommentParamSchema>; Body: z.infer<typeof PatchCommentBodySchema> }>(
    '/api/pdfs/:id/comments/:commentId',
    async (request, reply) => {
      const parsed = CommentParamSchema.safeParse(request.params);
      if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_PARAMS', parsed.error.message));
      const { id, commentId } = parsed.data;
      const bodyParsed = PatchCommentBodySchema.safeParse(request.body);
      if (!bodyParsed.success) return reply.code(400).send(errorResponse('INVALID_BODY', bodyParsed.error.message));
      const { resolved, text } = bodyParsed.data;
      const sub = sessionSub(request);
      const pdfRow = getPdfRow(id);
      if (!pdfRow) return reply.code(404).send(errorResponse('NOT_FOUND', 'PDF not found'));
      if (!canEditPdf(sub, pdfRow)) return reply.code(403).send(errorResponse('FORBIDDEN', 'Access denied'));
      const existing = db.prepare(`SELECT id FROM page_comments WHERE id = ? AND pdf_id = ?`).get(commentId, id);
      if (!existing) return reply.code(404).send(errorResponse('NOT_FOUND', 'Comment not found'));
      const sets: string[] = [];
      const values: unknown[] = [];
      if (text !== undefined) { sets.push('text = ?'); values.push(text); }
      if (resolved !== undefined) { sets.push('resolved = ?'); values.push(resolved ? 1 : 0); }
      const updated = db
        .prepare(`UPDATE page_comments SET ${sets.join(', ')} WHERE id = ? AND pdf_id = ? RETURNING *`)
        .get(...values, commentId, id) as PageCommentRow;
      return reply.send({ comment: rowToComment(updated) });
    },
  );

  // DELETE /api/pdfs/:id/comments/:commentId
  app.delete<{ Params: z.infer<typeof CommentParamSchema> }>(
    '/api/pdfs/:id/comments/:commentId',
    async (request, reply) => {
      const parsed = CommentParamSchema.safeParse(request.params);
      if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_PARAMS', parsed.error.message));
      const { id, commentId } = parsed.data;
      const sub = sessionSub(request);
      const pdfRow = getPdfRow(id);
      if (!pdfRow) return reply.code(404).send(errorResponse('NOT_FOUND', 'PDF not found'));
      if (!canEditPdf(sub, pdfRow)) return reply.code(403).send(errorResponse('FORBIDDEN', 'Access denied'));
      const existing = db.prepare(`SELECT id FROM page_comments WHERE id = ? AND pdf_id = ?`).get(commentId, id);
      if (!existing) return reply.code(404).send(errorResponse('NOT_FOUND', 'Comment not found'));
      db.prepare(`DELETE FROM page_comments WHERE id = ? AND pdf_id = ?`).run(commentId, id);
      return reply.code(204).send();
    },
  );
}
