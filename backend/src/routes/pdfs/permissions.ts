import type { FastifyRequest } from 'fastify';
import { db } from '../../db';
import type { PdfRow } from '../../types';
import { resolvePdfAccessLevel, maxAccessLevel, type PdfAccessLevel } from './pdfAccess';
import { resolveTokenAccessLevel } from './share';
import { sessionEmail } from '../auth';

/**
 * Access context passed to canReadPdf/canEditPdf so they resolve the requester's *effective*
 * access from BOTH systems that gate a presentation:
 * - identity-based access (the presentation's `visibility` default + per-user/group ACL), and
 * - the capability carried by any valid share token on the request.
 * The effective level is the higher of the two. Omitting the context keeps the original
 * visibility-only behavior, so any not-yet-migrated call site is unaffected.
 */
export interface PdfAclContext {
  /** The presentation id whose ACL to consult. */
  id: string;
  /** The requester's account email, or null when unauthenticated. */
  email: string | null;
  /** Capability granted by a valid share token on the request (`none` when there is none). */
  tokenAccess: PdfAccessLevel;
}

/**
 * Build the access context for a request + presentation id, to pass as the third argument of
 * canReadPdf/canEditPdf/canDestructivelyEditPdf so they consult both the identity-based ACL and
 * the request's share-token capability.
 */
export function aclCtx(request: FastifyRequest, id: string): PdfAclContext {
  return { id, email: sessionEmail(request), tokenAccess: resolveTokenAccessLevel(request, id) };
}

/**
 * Effective access from both systems: the higher of the identity-based level
 * (visibility default + ACL) and the share-token capability.
 */
function effectiveAccess(
  sub: string | null,
  row: Pick<PdfRow, 'owner_sub' | 'visibility'>,
  acl: PdfAclContext,
): PdfAccessLevel {
  return maxAccessLevel(resolvePdfAccessLevel(acl.id, sub, acl.email, row), acl.tokenAccess);
}

/**
 * Read-access rule shared by the PDF routes (previously duplicated verbatim in
 * ~27 route files):
 * - PDFs with no owner are public (legacy / anonymous uploads).
 * - The owner can always read their own PDF.
 * - Otherwise readable only when the visibility is public or public_editable.
 */
export function canReadPdf(
  sub: string | null,
  row: Pick<PdfRow, 'owner_sub' | 'visibility'>,
  acl?: PdfAclContext,
): boolean {
  if (acl) return effectiveAccess(sub, row, acl) !== 'none';
  if (!row.owner_sub) return true;
  if (sub && row.owner_sub === sub) return true;
  return row.visibility === 'public' || row.visibility === 'public_editable';
}

/**
 * Edit-access rule shared by the PDF content-editing routes (previously
 * duplicated verbatim in 21 route files):
 * - ownerless PDFs are editable (legacy / anonymous uploads).
 * - the owner can always edit their own PDF.
 * - otherwise editable only when visibility is public_editable.
 *
 * Note: destructive routes (e.g. deleting a whole presentation) intentionally
 * use a stricter local check that also requires an authenticated session — see
 * delete.ts — so they do NOT use this helper.
 */
export function canEditPdf(
  sub: string | null,
  row: Pick<PdfRow, 'owner_sub' | 'visibility'>,
  acl?: PdfAclContext,
): boolean {
  if (acl) return effectiveAccess(sub, row, acl) === 'edit';
  if (!row.owner_sub) return true;
  if (sub && row.owner_sub === sub) return true;
  return row.visibility === 'public_editable';
}

/**
 * Edit-access rule for destructive / irreversible actions on parts of a presentation
 * (deleting a page, a quiz set, a poll, a page's drawing, etc.). Requires edit-level
 * effective access from EITHER system (identity ACL or an editable share token) AND an
 * authenticated session: a fully anonymous request must never be able to destroy content
 * just because an editable share/token is in play.
 *
 * Note: deleting a WHOLE presentation is stricter still — owner-only — and is enforced
 * locally in delete.ts via isPdfOwner, not through this helper.
 *
 * When called without an `acl` context it keeps the original visibility-only behavior.
 */
export function canDestructivelyEditPdf(
  sub: string | null,
  row: Pick<PdfRow, 'owner_sub' | 'visibility'>,
  acl?: PdfAclContext,
): boolean {
  if (acl) {
    if (!row.owner_sub) return true; // legacy / anonymous uploads stay open
    return effectiveAccess(sub, row, acl) === 'edit' && Boolean(sub);
  }
  if (!row.owner_sub) return true;
  if (sub && row.owner_sub === sub) return true;
  return Boolean(sub) && row.visibility === 'public_editable';
}

/**
 * Owner-only rule for sensitive resources that even public_editable collaborators
 * must not access (e.g. students' proctoring camera recordings):
 * - ownerless PDFs (legacy / anonymous uploads) have no owner to restrict to, so
 *   they stay open — consistent with the other helpers' `!owner_sub` branch.
 * - otherwise only the authenticated owner qualifies; share-based editors and
 *   public visibility do NOT grant access.
 */
export function isPdfOwner(
  sub: string | null,
  row: Pick<PdfRow, 'owner_sub'>,
): boolean {
  if (!row.owner_sub) return true;
  return Boolean(sub) && row.owner_sub === sub;
}

/**
 * Fetch just the owner/visibility columns used for permission checks, or
 * undefined when the PDF does not exist. Previously duplicated verbatim in 10
 * route files. (report.ts keeps its own variant that also selects `title`.)
 */
export function getPdfPermissionRow(
  id: string,
): Pick<PdfRow, 'owner_sub' | 'visibility'> | undefined {
  return db.prepare(`SELECT owner_sub, visibility FROM pdfs WHERE id = ?`).get(id) as
    | Pick<PdfRow, 'owner_sub' | 'visibility'>
    | undefined;
}
