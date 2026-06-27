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
