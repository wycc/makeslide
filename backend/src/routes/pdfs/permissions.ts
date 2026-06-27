import { db } from '../../db';
import type { PdfRow } from '../../types';

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
): boolean {
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
): boolean {
  if (!row.owner_sub) return true;
  if (sub && row.owner_sub === sub) return true;
  return row.visibility === 'public_editable';
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
