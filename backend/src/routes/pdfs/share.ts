import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { db } from '../../db';
import type { PdfAccessLevel } from './pdfAccess';

// Share-link access helpers shared by the PDF routes (previously duplicated
// verbatim across ~10 route files).
//
// A share token is a *capability*: anyone who holds a valid, unexpired token
// gets the access level embedded in it (read_only → read, editable → edit),
// regardless of the presentation's identity-based access (visibility + ACL).
// This is one of the two systems every gate consults; the other is the
// identity-based access resolved in pdfAccess.ts. The effective access for any
// action is the higher of the two (see canReadPdf/canEditPdf in permissions.ts).

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

/**
 * Capability level a valid, unexpired share token grants to ANYONE holding it,
 * independent of the presentation's identity-based access (visibility + ACL):
 * - `editable` token → `edit`,
 * - `read_only` token → `read`,
 * - no token / malformed / wrong presentation / expired → `none`.
 * This is the token half of the two-system access model; callers combine it
 * with the identity-based level via maxAccessLevel.
 */
export function resolveTokenAccessLevel(request: FastifyRequest, pdfId: string): PdfAccessLevel {
  const token = getShareToken(request);
  if (!token || !ShareTokenParamSchema.safeParse({ token }).success) return 'none';
  const row = db
    .prepare(`SELECT access, expires_at FROM pdf_shares WHERE token = ? AND pdf_id = ?`)
    .get(token, pdfId) as { access: 'read_only' | 'editable'; expires_at: string | null } | undefined;
  if (!row) return 'none';
  if (row.expires_at && row.expires_at < new Date().toISOString()) return 'none';
  return row.access === 'editable' ? 'edit' : 'read';
}

/**
 * True when the request carries a valid, unexpired share token for the given PDF
 * (of any access level). Now honors expiry (previously it did not), so an expired
 * token no longer passes a gate. Prefer resolveTokenAccessLevel when the level matters.
 */
export function hasShareAccess(request: FastifyRequest, pdfId: string): boolean {
  return resolveTokenAccessLevel(request, pdfId) !== 'none';
}
