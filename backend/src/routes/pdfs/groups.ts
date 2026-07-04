import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'node:crypto';
import { z } from 'zod';
import { db } from '../../db';
import { sessionSub } from '../auth';
import { errorResponse, nowIso, EmailSchema, GROUP_ID_RE } from './shared';

interface GroupRow {
  id: string;
  owner_sub: string;
  name: string;
  created_at: string;
  updated_at: string;
}

function generateGroupId(): string {
  return `grp-${crypto.randomBytes(12).toString('base64url')}`;
}

/** Fetch a group owned by `sub`, or undefined when missing / not owned by the caller. */
function getOwnedGroup(groupId: string, sub: string): GroupRow | undefined {
  const row = db.prepare(`SELECT * FROM groups WHERE id = ?`).get(groupId) as GroupRow | undefined;
  if (!row || row.owner_sub !== sub) return undefined;
  return row;
}

function memberEmails(groupId: string): string[] {
  const rows = db
    .prepare(`SELECT email FROM group_members WHERE group_id = ? ORDER BY email ASC`)
    .all(groupId) as Array<{ email: string }>;
  return rows.map((r) => r.email);
}

export async function registerGroupRoutes(app: FastifyInstance): Promise<void> {
  const NameSchema = z.string().trim().min(1).max(120);
  const GroupIdSchema = z.object({ groupId: z.string().regex(GROUP_ID_RE, 'Invalid group id') });
  const CreateBodySchema = z.object({ name: NameSchema, emails: z.array(EmailSchema).max(1000).optional() });
  const RenameBodySchema = z.object({ name: NameSchema });
  const MemberBodySchema = z.object({ email: EmailSchema });

  function requireSub(request: FastifyRequest, reply: FastifyReply): string | null {
    const sub = sessionSub(request);
    if (!sub) {
      reply.code(401).send(errorResponse('UNAUTHENTICATED', '請先登入'));
      return null;
    }
    return sub;
  }

  // GET /api/groups — list the caller's groups with member counts.
  app.get('/api/groups', async (request, reply) => {
    const sub = requireSub(request, reply);
    if (!sub) return reply;
    const rows = db
      .prepare(
        `SELECT g.id, g.name, g.created_at, g.updated_at,
                (SELECT COUNT(*) FROM group_members m WHERE m.group_id = g.id) AS member_count
           FROM groups g
          WHERE g.owner_sub = ?
          ORDER BY g.name ASC`,
      )
      .all(sub) as Array<{ id: string; name: string; created_at: string; updated_at: string; member_count: number }>;
    return reply.send({ groups: rows });
  });

  // POST /api/groups — create a group, optionally seeding it with member emails
  // ("save the current share list as a group").
  app.post('/api/groups', async (request, reply) => {
    const sub = requireSub(request, reply);
    if (!sub) return reply;
    const body = CreateBodySchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', body.error.issues[0]?.message ?? 'Invalid body'));
    const now = nowIso();
    const id = generateGroupId();
    const emails = Array.from(new Set(body.data.emails ?? []));
    const insertMember = db.prepare(
      `INSERT OR IGNORE INTO group_members (group_id, email, created_at) VALUES (?, ?, ?)`,
    );
    const tx = db.transaction(() => {
      db.prepare(`INSERT INTO groups (id, owner_sub, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
        .run(id, sub, body.data.name, now, now);
      for (const email of emails) insertMember.run(id, email, now);
    });
    tx();
    return reply.code(201).send({ id, name: body.data.name, members: memberEmails(id), created_at: now, updated_at: now });
  });

  // GET /api/groups/:groupId — group detail with members.
  app.get('/api/groups/:groupId', async (request, reply) => {
    const sub = requireSub(request, reply);
    if (!sub) return reply;
    const parsed = GroupIdSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid group id'));
    const group = getOwnedGroup(parsed.data.groupId, sub);
    if (!group) return reply.code(404).send(errorResponse('GROUP_NOT_FOUND', 'Group not found'));
    return reply.send({ id: group.id, name: group.name, members: memberEmails(group.id), created_at: group.created_at, updated_at: group.updated_at });
  });

  // PATCH /api/groups/:groupId — rename.
  app.patch('/api/groups/:groupId', async (request, reply) => {
    const sub = requireSub(request, reply);
    if (!sub) return reply;
    const parsed = GroupIdSchema.safeParse(request.params);
    const body = RenameBodySchema.safeParse(request.body);
    if (!parsed.success || !body.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid rename request'));
    const group = getOwnedGroup(parsed.data.groupId, sub);
    if (!group) return reply.code(404).send(errorResponse('GROUP_NOT_FOUND', 'Group not found'));
    const now = nowIso();
    db.prepare(`UPDATE groups SET name = ?, updated_at = ? WHERE id = ?`).run(body.data.name, now, group.id);
    return reply.send({ id: group.id, name: body.data.name, updated_at: now });
  });

  // DELETE /api/groups/:groupId — delete the group (members cascade; ACL entries referencing it
  // simply stop matching anyone).
  app.delete('/api/groups/:groupId', async (request, reply) => {
    const sub = requireSub(request, reply);
    if (!sub) return reply;
    const parsed = GroupIdSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid group id'));
    const group = getOwnedGroup(parsed.data.groupId, sub);
    if (!group) return reply.code(404).send(errorResponse('GROUP_NOT_FOUND', 'Group not found'));
    db.prepare(`DELETE FROM groups WHERE id = ?`).run(group.id);
    return reply.send({ ok: true, id: group.id });
  });

  // PUT /api/groups/:groupId/members — add a member email.
  app.put('/api/groups/:groupId/members', async (request, reply) => {
    const sub = requireSub(request, reply);
    if (!sub) return reply;
    const parsed = GroupIdSchema.safeParse(request.params);
    const body = MemberBodySchema.safeParse(request.body);
    if (!parsed.success || !body.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid member request'));
    const group = getOwnedGroup(parsed.data.groupId, sub);
    if (!group) return reply.code(404).send(errorResponse('GROUP_NOT_FOUND', 'Group not found'));
    const now = nowIso();
    db.prepare(`INSERT OR IGNORE INTO group_members (group_id, email, created_at) VALUES (?, ?, ?)`)
      .run(group.id, body.data.email, now);
    db.prepare(`UPDATE groups SET updated_at = ? WHERE id = ?`).run(now, group.id);
    return reply.send({ id: group.id, members: memberEmails(group.id) });
  });

  // DELETE /api/groups/:groupId/members — remove a member email.
  app.delete('/api/groups/:groupId/members', async (request, reply) => {
    const sub = requireSub(request, reply);
    if (!sub) return reply;
    const parsed = GroupIdSchema.safeParse(request.params);
    const body = MemberBodySchema.safeParse(request.body);
    if (!parsed.success || !body.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid member request'));
    const group = getOwnedGroup(parsed.data.groupId, sub);
    if (!group) return reply.code(404).send(errorResponse('GROUP_NOT_FOUND', 'Group not found'));
    const now = nowIso();
    db.prepare(`DELETE FROM group_members WHERE group_id = ? AND LOWER(email) = LOWER(?)`).run(group.id, body.data.email);
    db.prepare(`UPDATE groups SET updated_at = ? WHERE id = ?`).run(now, group.id);
    return reply.send({ id: group.id, members: memberEmails(group.id) });
  });
}
