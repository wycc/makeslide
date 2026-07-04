import type { FastifyRequest } from 'fastify';
import { db } from '../../db';
import type { PdfRow } from '../../types';
import { resolvePdfAccessLevel } from './pdfAccess';
import { sessionEmail } from '../auth';

/**
 * Identity context for consulting a presentation's per-user access control list (ACL).
 * When passed to canReadPdf/canEditPdf, the requester's effective access is resolved from
 * the ACL (falling back to visibility) instead of visibility alone. Omitting it keeps the
 * original visibility-only behavior, so existing call sites are unaffected until migrated.
 */
export interface PdfAclContext {
  /** The presentation id whose ACL to consult. */
  id: string;
  /** The requester's account email, or null when unauthenticated. */
  email: string | null;
}

/**
 * Build the ACL context for a request + presentation id, to pass as the third argument of
 * canReadPdf/canEditPdf so they consult the per-user access control list.
 */
export function aclCtx(request: FastifyRequest, id: string): PdfAclContext {
  return { id, email: sessionEmail(request) };
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
  if (acl) return resolvePdfAccessLevel(acl.id, sub, acl.email, row) !== 'none';
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
  if (acl) return resolvePdfAccessLevel(acl.id, sub, acl.email, row) === 'edit';
  if (!row.owner_sub) return true;
  if (sub && row.owner_sub === sub) return true;
  return row.visibility === 'public_editable';
}

/**
 * Edit-access rule for destructive / irreversible actions (deleting a whole
 * presentation, a page, a quiz set, a poll, a page's drawing, etc.). Same as
 * canEditPdf but additionally requires an authenticated session before honoring
 * a public_editable share: a fully anonymous request must never be able to
 * destroy content just because an editable share link is enabled. Previously
 * duplicated verbatim in 5 route files (4 as canDestructivelyEditPdf + delete.ts
 * as a local stricter canEditPdf).
 */
export function canDestructivelyEditPdf(
  sub: string | null,
  row: Pick<PdfRow, 'owner_sub' | 'visibility'>,
): boolean {
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
