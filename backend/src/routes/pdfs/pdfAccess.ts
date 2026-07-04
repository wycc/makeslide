import { db } from '../../db';
import type { PdfRow } from '../../types';

/**
 * Effective access a requester has to a presentation.
 * - `none`: cannot even read.
 * - `read`: read-only.
 * - `edit`: read + write.
 */
export type PdfAccessLevel = 'none' | 'read' | 'edit';

/** Access level a single ACL entry grants. */
export type PdfPermissionAccess = 'read_only' | 'read_write';

/** Principal kinds an ACL entry can target. Groups are resolved to member emails by the caller. */
export type PdfPermissionPrincipalType = 'user' | 'group';

/**
 * Map the presentation's default (its `visibility`) to an access level for a requester who is
 * NOT explicitly listed in the ACL. This is the "預設權限" fallback:
 * - `public_editable` → everyone may edit,
 * - `public` → everyone may read,
 * - `private` (or anything else) → no access.
 */
export function defaultAccessLevel(visibility: PdfRow['visibility']): PdfAccessLevel {
  if (visibility === 'public_editable') return 'edit';
  if (visibility === 'public') return 'read';
  return 'none';
}

function levelFromGrant(access: PdfPermissionAccess): PdfAccessLevel {
  return access === 'read_write' ? 'edit' : 'read';
}

const LEVEL_RANK: Record<PdfAccessLevel, number> = { none: 0, read: 1, edit: 2 };

/** Highest of two access levels. */
export function maxAccessLevel(a: PdfAccessLevel, b: PdfAccessLevel): PdfAccessLevel {
  return LEVEL_RANK[a] >= LEVEL_RANK[b] ? a : b;
}

export interface DecidePdfAccessInput {
  ownerSub: string | null;
  visibility: PdfRow['visibility'];
  /** The requester's account id (Google sub), or null when unauthenticated. */
  userSub: string | null;
  /** Access levels granted to this requester by any matching ACL entry (direct user or via a group). */
  matchedGrants: PdfPermissionAccess[];
}

/**
 * Pure access decision, independent of the database:
 * - Ownerless (legacy/anonymous) presentations stay fully open — consistent with the existing
 *   `canReadPdf`/`canEditPdf` `!owner_sub` branch.
 * - The owner always has edit access.
 * - If the requester matches one or more ACL entries, the highest of those grants applies and
 *   OVERRIDES the default (so being listed read-only caps access even when the default is higher).
 * - Otherwise the presentation's default (visibility) applies.
 */
export function decidePdfAccessLevel(input: DecidePdfAccessInput): PdfAccessLevel {
  const { ownerSub, visibility, userSub, matchedGrants } = input;
  if (!ownerSub) return 'edit';
  if (userSub && ownerSub === userSub) return 'edit';
  if (matchedGrants.length > 0) {
    return matchedGrants.reduce<PdfAccessLevel>((acc, g) => maxAccessLevel(acc, levelFromGrant(g)), 'none');
  }
  return defaultAccessLevel(visibility);
}

/**
 * Fetch the ACL grants that apply to `userEmail` for this presentation, matched
 * case-insensitively by email against both:
 * - individual `user` principals (principal_id is the email), and
 * - `group` principals (principal_id is a group id) whose membership includes the email.
 * A user may match several grants (listed directly and via one or more groups); the caller
 * takes the highest.
 */
function fetchMatchedGrants(pdfId: string, userEmail: string | null): PdfPermissionAccess[] {
  if (!userEmail) return [];
  const rows = db
    .prepare(
      `SELECT access FROM pdf_permissions
        WHERE pdf_id = ? AND principal_type = 'user' AND LOWER(principal_id) = LOWER(?)
       UNION ALL
       SELECT p.access FROM pdf_permissions p
         JOIN group_members m ON m.group_id = p.principal_id
        WHERE p.pdf_id = ? AND p.principal_type = 'group' AND LOWER(m.email) = LOWER(?)`,
    )
    .all(pdfId, userEmail, pdfId, userEmail) as Array<{ access: PdfPermissionAccess }>;
  return rows.map((r) => r.access);
}

/**
 * Resolve a requester's effective access to a presentation, consulting the per-presentation ACL
 * and falling back to the default (visibility). The owner always resolves to `edit`.
 */
export function resolvePdfAccessLevel(
  pdfId: string,
  userSub: string | null,
  userEmail: string | null,
  row: Pick<PdfRow, 'owner_sub' | 'visibility'>,
): PdfAccessLevel {
  // Owner / legacy shortcuts don't need an ACL lookup.
  if (!row.owner_sub) return 'edit';
  if (userSub && row.owner_sub === userSub) return 'edit';
  return decidePdfAccessLevel({
    ownerSub: row.owner_sub,
    visibility: row.visibility,
    userSub,
    matchedGrants: fetchMatchedGrants(pdfId, userEmail),
  });
}
