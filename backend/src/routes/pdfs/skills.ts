import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { currentAccountId } from '../../services/accountContext';
import {
  createUserSkill,
  deleteUserSkill,
  listSkills,
  toggleBuiltInSkill,
  updateUserSkill,
} from '../../services/skills';
import { errorResponse } from './shared';

const MAX_SKILL_NAME_LENGTH = 80;
const MAX_SKILL_PROMPT_LENGTH = 2000;

const SkillIdParamSchema = z.object({ skillId: z.string().trim().min(1).max(64) });

const CreateSkillBodySchema = z.object({
  name: z.string().trim().min(1).max(MAX_SKILL_NAME_LENGTH),
  prompt: z.string().trim().min(1).max(MAX_SKILL_PROMPT_LENGTH),
  applyTo: z.enum(['script', 'all']).default('script'),
});

const UpdateSkillBodySchema = z.object({
  name: z.string().trim().min(1).max(MAX_SKILL_NAME_LENGTH).optional(),
  prompt: z.string().trim().min(1).max(MAX_SKILL_PROMPT_LENGTH).optional(),
  applyTo: z.enum(['script', 'all']).optional(),
  enabled: z.boolean().optional(),
});

export async function registerSkillRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/skills', async (_request, reply) => {
    const accountId = currentAccountId();
    const skills = listSkills(accountId);
    return reply.send({ skills });
  });

  app.post('/api/skills', async (request, reply) => {
    const parsed = CreateSkillBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid skill data'));
    }
    const accountId = currentAccountId();
    const skill = await createUserSkill(accountId, parsed.data);
    return reply.code(201).send({ skill });
  });

  app.patch('/api/skills/:skillId', async (request, reply) => {
    const parsedParams = SkillIdParamSchema.safeParse(request.params);
    const parsedBody = UpdateSkillBodySchema.safeParse(request.body);
    if (!parsedParams.success || !parsedBody.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid request'));
    }
    const accountId = currentAccountId();
    const updated = await updateUserSkill(accountId, parsedParams.data.skillId, parsedBody.data);
    if (!updated) {
      return reply.code(404).send(errorResponse('SKILL_NOT_FOUND', 'Skill not found'));
    }
    return reply.send({ skill: updated });
  });

  app.delete('/api/skills/:skillId', async (request, reply) => {
    const parsedParams = SkillIdParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid skill id'));
    }
    const accountId = currentAccountId();
    const deleted = await deleteUserSkill(accountId, parsedParams.data.skillId);
    if (!deleted) {
      return reply.code(404).send(errorResponse('SKILL_NOT_FOUND', 'Skill not found'));
    }
    return reply.send({ ok: true });
  });

  app.post('/api/skills/:skillId/toggle', async (request, reply) => {
    const parsedParams = SkillIdParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid skill id'));
    }
    const accountId = currentAccountId();
    const skillId = parsedParams.data.skillId;
    const result = await toggleBuiltInSkill(accountId, skillId);
    if (result === null) {
      return reply.code(404).send(errorResponse('SKILL_NOT_FOUND', 'Built-in skill not found'));
    }
    return reply.send({ ok: true, enabled: result });
  });
}
