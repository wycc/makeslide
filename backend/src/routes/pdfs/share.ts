import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { db } from '../../db';

// Share-link access helpers shared by the PDF routes (previously duplicated
// verbatim across ~10 route files).

/** Validates a share token's shape (12–128 url-safe chars). */
export const ShareTokenParamSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{12,128}$/, 'Invalid share token'),
});

/**
 * Extract the share token from a request: the `x-makeslide-share-token` header
 * takes precedence, falling back to the `?share=` query parameter. Returns null
 * when neither is a non-empty string.
 */
export function getShareToken(request: FastifyRequest): string | null {
  const rawHeader = request.headers['x-makeslide-share-token'];
  const headerValue = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
  if (typeof headerValue === 'string' && headerValue.trim()) return headerValue.trim();
  const query = request.query as Record<string, unknown> | undefined;
  const rawQuery = query?.share;
  const queryValue = Array.isArray(rawQuery) ? rawQuery[0] : rawQuery;
  return typeof queryValue === 'string' && queryValue.trim() ? queryValue.trim() : null;
}

/** True when the request carries a valid share token for the given PDF. */
export function hasShareAccess(request: FastifyRequest, pdfId: string): boolean {
  const token = getShareToken(request);
  if (!token || !ShareTokenParamSchema.safeParse({ token }).success) return false;
  const row = db.prepare(`SELECT access FROM pdf_shares WHERE token = ? AND pdf_id = ?`).get(token, pdfId) as
    | { access: 'read_only' | 'editable' }
    | undefined;
  return Boolean(row);
}
