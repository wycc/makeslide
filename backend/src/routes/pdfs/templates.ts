import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { db } from '../../db';
import { sessionSub } from '../auth';
import { errorResponse } from './shared';

function nowIso(): string {
  return new Date().toISOString();
}

const SkillDataSchema = z.object({
  prompt: z.string().trim().min(1).max(2000),
  applyTo: z.enum(['script', 'all']).default('script'),
  imageStylePrompt: z.string().trim().max(1000).optional(),
  quizPrompt: z.string().trim().max(1000).optional(),
  ttsProvider: z.string().trim().max(32).optional(),
  ttsVoice: z.string().trim().max(64).optional(),
});

const CreateTemplateBodySchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(400).default(''),
  category: z.string().trim().max(40).default('general'),
  skill_data: SkillDataSchema,
  is_public: z.boolean().default(true),
});

const TemplateIdParamSchema = z.object({
  templateId: z.string().trim().min(1).max(32),
});

interface TemplateRow {
  id: string;
  name: string;
  description: string;
  category: string;
  skill_data: string;
  is_public: number;
  author: string;
  created_at: string;
  apply_count: number;
}

function rowToTemplate(row: TemplateRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    category: row.category,
    skill_data: JSON.parse(row.skill_data) as Record<string, unknown>,
    is_public: row.is_public === 1,
    author: row.author,
    created_at: row.created_at,
    apply_count: row.apply_count ?? 0,
  };
}

export async function registerTemplateRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/templates — list public templates (no auth required)
  app.get('/api/templates', async (_request, reply) => {
    const rows = db
      .prepare(`SELECT * FROM templates WHERE is_public = 1 ORDER BY created_at DESC`)
      .all() as TemplateRow[];
    return reply.send({ templates: rows.map(rowToTemplate) });
  });

  // POST /api/templates — create a new template (auth required)
  app.post('/api/templates', async (request, reply) => {
    const sub = sessionSub(request);
    if (!sub) return reply.code(401).send(errorResponse('UNAUTHORIZED', 'Login required'));
    const parsed = CreateTemplateBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_BODY', parsed.error.message));
    const { name, description, category, skill_data, is_public } = parsed.data;
    const id = `tmpl-${nanoid(10)}`;
    const now = nowIso();
    const row = db
      .prepare(
        `INSERT INTO templates (id, name, description, category, skill_data, is_public, author, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      )
      .get(id, name, description, category, JSON.stringify(skill_data), is_public ? 1 : 0, sub, now) as TemplateRow;
    return reply.code(201).send({ template: rowToTemplate(row) });
  });

  // DELETE /api/templates/:templateId — delete own template
  app.delete<{ Params: z.infer<typeof TemplateIdParamSchema> }>(
    '/api/templates/:templateId',
    async (request, reply) => {
      const parsed = TemplateIdParamSchema.safeParse(request.params);
      if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_PARAMS', parsed.error.message));
      const { templateId } = parsed.data;
      const sub = sessionSub(request);
      if (!sub) return reply.code(401).send(errorResponse('UNAUTHORIZED', 'Login required'));
      const existing = db.prepare(`SELECT id, author FROM templates WHERE id = ?`).get(templateId) as
        | Pick<TemplateRow, 'id' | 'author'>
        | undefined;
      if (!existing) return reply.code(404).send(errorResponse('NOT_FOUND', 'Template not found'));
      if (existing.author !== sub) return reply.code(403).send(errorResponse('FORBIDDEN', 'Access denied'));
      db.prepare(`DELETE FROM templates WHERE id = ?`).run(templateId);
      return reply.code(204).send();
    },
  );

  // POST /api/templates/:templateId/apply — increment usage counter (no auth).
  app.post<{ Params: z.infer<typeof TemplateIdParamSchema> }>(
    '/api/templates/:templateId/apply',
    async (request, reply) => {
      const parsed = TemplateIdParamSchema.safeParse(request.params);
      if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_PARAMS', parsed.error.message));
      const { templateId } = parsed.data;
      const result = db
        .prepare(`UPDATE templates SET apply_count = apply_count + 1 WHERE id = ?`)
        .run(templateId);
      if (result.changes === 0) return reply.code(404).send(errorResponse('NOT_FOUND', 'Template not found'));
      return reply.code(204).send();
    },
  );
}
