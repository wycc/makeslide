import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../db';
import { sessionSub } from '../auth';
import { getPdfPermissionRow, isPdfOwner } from './permissions';
import { IdParamSchema, EmailSchema, GROUP_ID_RE, errorResponse, nowIso } from './shared';
import type { PdfPermissionAccess } from './pdfAccess';

interface PermissionRow {
  principal_type: string;
  principal_id: string;
  access: PdfPermissionAccess;
  created_at: string;
  updated_at: string;
}

interface AccountRow {
  sub: string;
  email: string;
  name: string | null;
}

/** Escape LIKE wildcards so a user-typed query is matched literally (with an explicit ESCAPE). */
function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

export async function registerPdfPermissionRoutes(app: FastifyInstance): Promise<void> {
  const GroupIdSchema = z.string().regex(GROUP_ID_RE);
  const AccessSchema = z.enum(['read_only', 'read_write']);
  // A permission entry targets either an individual user (by email) or a group (by id).
  const UpsertBodySchema = z.union([
    z.object({ email: EmailSchema, access: AccessSchema }),
    z.object({ group_id: GroupIdSchema, access: AccessSchema }),
  ]);
  const DeleteBodySchema = z.union([
    z.object({ email: EmailSchema }),
    z.object({ group_id: GroupIdSchema }),
  ]);

  // GET /api/pdfs/:id/permissions — owner lists the presentation's per-user ACL.
  app.get('/api/pdfs/:id/permissions', async (request, reply) => {
    const parsed = IdParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id parameter'));
    const { id } = parsed.data;
    const row = getPdfPermissionRow(id);
    if (!row) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    if (!isPdfOwner(sessionSub(request), row)) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '只有簡報擁有者可以管理存取權限'));
    }
    const rows = db
      .prepare(
        `SELECT principal_type, principal_id, access, created_at, updated_at
           FROM pdf_permissions
          WHERE pdf_id = ?
          ORDER BY created_at ASC`,
      )
      .all(id) as PermissionRow[];
    const userRows = rows.filter((r) => r.principal_type === 'user');
    const groupRows = rows.filter((r) => r.principal_type === 'group');
    // Resolve a display name for each listed email from the accounts table (best-effort).
    const names = new Map<string, string>();
    if (userRows.length > 0) {
      const emails = userRows.map((r) => r.principal_id);
      const placeholders = emails.map(() => '?').join(', ');
      const accts = db
        .prepare(`SELECT email, name FROM accounts WHERE LOWER(email) IN (${placeholders})`)
        .all(...emails.map((e) => e.toLowerCase())) as Array<{ email: string; name: string | null }>;
      for (const a of accts) names.set(a.email.toLowerCase(), a.name?.trim() || a.email);
    }
    // Resolve group names + member counts (best-effort; a deleted group still lists but with no name).
    const groupInfo = new Map<string, { name: string; member_count: number }>();
    if (groupRows.length > 0) {
      const ids = groupRows.map((r) => r.principal_id);
      const placeholders = ids.map(() => '?').join(', ');
      const grps = db
        .prepare(
          `SELECT g.id, g.name, (SELECT COUNT(*) FROM group_members m WHERE m.group_id = g.id) AS member_count
             FROM groups g WHERE g.id IN (${placeholders})`,
        )
        .all(...ids) as Array<{ id: string; name: string; member_count: number }>;
      for (const g of grps) groupInfo.set(g.id, { name: g.name, member_count: g.member_count });
    }
    return reply.send({
      pdf_id: id,
      // The default access applied to everyone not listed here is the presentation's visibility.
      default_visibility: row.visibility ?? 'private',
      permissions: [
        ...userRows.map((r) => ({
          principal_type: 'user' as const,
          email: r.principal_id,
          group_id: null,
          access: r.access,
          display_name: names.get(r.principal_id.toLowerCase()) ?? null,
          member_count: null,
          created_at: r.created_at,
          updated_at: r.updated_at,
        })),
        ...groupRows.map((r) => ({
          principal_type: 'group' as const,
          email: null,
          group_id: r.principal_id,
          access: r.access,
          display_name: groupInfo.get(r.principal_id)?.name ?? null,
          member_count: groupInfo.get(r.principal_id)?.member_count ?? 0,
          created_at: r.created_at,
          updated_at: r.updated_at,
        })),
      ],
    });
  });

  // PUT /api/pdfs/:id/permissions — owner adds or updates one user's access.
  app.put('/api/pdfs/:id/permissions', async (request, reply) => {
    const parsed = IdParamSchema.safeParse(request.params);
    const body = UpsertBodySchema.safeParse(request.body);
    if (!parsed.success || !body.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', body.success ? 'Invalid id parameter' : body.error.issues[0]?.message ?? 'Invalid body'));
    }
    const { id } = parsed.data;
    const row = getPdfPermissionRow(id);
    if (!row) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    if (!isPdfOwner(sessionSub(request), row)) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '只有簡報擁有者可以管理存取權限'));
    }
    const now = nowIso();
    let principalType: 'user' | 'group';
    let principalId: string;
    if ('group_id' in body.data) {
      principalType = 'group';
      principalId = body.data.group_id;
    } else {
      principalType = 'user';
      principalId = body.data.email;
    }
    db.prepare(
      `INSERT INTO pdf_permissions (pdf_id, principal_type, principal_id, access, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(pdf_id, principal_type, principal_id)
       DO UPDATE SET access = excluded.access, updated_at = excluded.updated_at`,
    ).run(id, principalType, principalId, body.data.access, now, now);
    return reply.send({ pdf_id: id, principal_type: principalType, principal_id: principalId, access: body.data.access });
  });

  // DELETE /api/pdfs/:id/permissions — owner removes one user from the ACL.
  app.delete('/api/pdfs/:id/permissions', async (request, reply) => {
    const parsed = IdParamSchema.safeParse(request.params);
    const body = DeleteBodySchema.safeParse(request.body);
    if (!parsed.success || !body.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid delete request'));
    }
    const { id } = parsed.data;
    const row = getPdfPermissionRow(id);
    if (!row) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    if (!isPdfOwner(sessionSub(request), row)) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '只有簡報擁有者可以管理存取權限'));
    }
    if ('group_id' in body.data) {
      db.prepare(`DELETE FROM pdf_permissions WHERE pdf_id = ? AND principal_type = 'group' AND principal_id = ?`)
        .run(id, body.data.group_id);
      return reply.send({ ok: true, pdf_id: id, group_id: body.data.group_id });
    }
    db.prepare(`DELETE FROM pdf_permissions WHERE pdf_id = ? AND principal_type = 'user' AND LOWER(principal_id) = LOWER(?)`)
      .run(id, body.data.email);
    return reply.send({ ok: true, pdf_id: id, email: body.data.email });
  });

  // GET /api/accounts/search?q= — authenticated account picker for the sharing UI. Matches known
  // accounts by email or display name so the owner can grant access without typing exact emails.
  app.get('/api/accounts/search', async (request, reply) => {
    const sub = sessionSub(request);
    if (!sub) return reply.code(401).send(errorResponse('UNAUTHENTICATED', '請先登入'));
    const q = z.object({ q: z.string().trim().min(2).max(120) }).safeParse(request.query);
    if (!q.success) return reply.send({ accounts: [] });
    const like = `%${escapeLike(q.data.q)}%`;
    const rows = db
      .prepare(
        `SELECT sub, email, name FROM accounts
          WHERE email LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\'
          ORDER BY name IS NULL, name ASC, email ASC
          LIMIT 20`,
      )
      .all(like, like) as AccountRow[];
    return reply.send({
      accounts: rows.map((r) => ({ email: r.email, display_name: r.name?.trim() || r.email })),
    });
  });
}
