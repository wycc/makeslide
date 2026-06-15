import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../db';
import { currentAccountId } from '../../services/accountContext';
import { isAdminAccount } from '../../services/aiSettings';
import {
  SLA_TARGET_BOUNDS_MS,
  SLA_TARGETS_MS,
  TIMING_EVENT_VALUES,
  setSlaTargetOverride,
} from '../../services/timing';
import type { SlaSettingsResponse, SlaTargetKind, SlaTargetSetting } from '../../types';
import { errorResponse } from './shared';

const UpdateSlaSettingBodySchema = z.object({
  kind: z.enum(['stage', 'artifact']),
  name: z.string().min(1),
  target_ms: z.number().int().min(SLA_TARGET_BOUNDS_MS.min).max(SLA_TARGET_BOUNDS_MS.max).nullable(),
});

interface SlaOverrideRow {
  kind: SlaTargetKind;
  name: string;
  target_ms: number;
  updated_at: string;
}

function loadOverrides(): Map<string, SlaOverrideRow> {
  const rows = db.prepare(`SELECT kind, name, target_ms, updated_at FROM pipeline_sla_overrides`).all() as SlaOverrideRow[];
  const map = new Map<string, SlaOverrideRow>();
  for (const row of rows) map.set(`${row.kind}:${row.name}`, row);
  return map;
}

function buildSlaSettingsResponse(): SlaSettingsResponse {
  const overrides = loadOverrides();

  const stages: SlaTargetSetting[] = TIMING_EVENT_VALUES.stages.map((name) => {
    const override = overrides.get(`stage:${name}`);
    const defaultMs = SLA_TARGETS_MS.stages[name];
    return {
      kind: 'stage',
      name,
      default_ms: defaultMs,
      override_ms: override?.target_ms ?? null,
      effective_ms: override?.target_ms ?? defaultMs,
      updated_at: override?.updated_at ?? null,
    };
  });

  const artifacts: SlaTargetSetting[] = TIMING_EVENT_VALUES.artifacts.map((name) => {
    const override = overrides.get(`artifact:${name}`);
    const defaultMs = SLA_TARGETS_MS.artifacts[name];
    return {
      kind: 'artifact',
      name,
      default_ms: defaultMs,
      override_ms: override?.target_ms ?? null,
      effective_ms: override?.target_ms ?? defaultMs,
      updated_at: override?.updated_at ?? null,
    };
  });

  return {
    bounds: { min_ms: SLA_TARGET_BOUNDS_MS.min, max_ms: SLA_TARGET_BOUNDS_MS.max },
    stages,
    artifacts,
  };
}

export async function registerSlaSettingsRoutes(app: FastifyInstance): Promise<void> {
  // GET/PUT /api/system/sla-settings — admin-only 全域 SLA target override
  // （v1 範圍：依 stage/artifact 全域調整，provider/model/source_type 維度留待後續）。
  app.get('/api/system/sla-settings', async (_request, reply) => {
    if (!isAdminAccount(currentAccountId())) {
      return reply.code(403).send(errorResponse('ADMIN_REQUIRED', '只有 admin 可以查看 SLA target 設定'));
    }
    return reply.code(200).send(buildSlaSettingsResponse());
  });

  app.put('/api/system/sla-settings', async (request, reply) => {
    if (!isAdminAccount(currentAccountId())) {
      return reply.code(403).send(errorResponse('ADMIN_REQUIRED', '只有 admin 可以調整 SLA target 設定'));
    }
    const parsed = UpdateSlaSettingBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', parsed.error.issues[0]?.message ?? 'Invalid body'));
    }
    const { kind, name, target_ms } = parsed.data;
    try {
      setSlaTargetOverride(kind, name, target_ms);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(400).send(errorResponse('INVALID_REQUEST', message));
    }
    return reply.code(200).send(buildSlaSettingsResponse());
  });
}
