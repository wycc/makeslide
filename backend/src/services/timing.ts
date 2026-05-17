import { nanoid } from 'nanoid';
import { db } from '../db';
import { logger } from '../logger';
import type {
  PageArtifact,
  PageArtifactReason,
  PipelineRunStatus,
  PipelineRunType,
  PipelineStage,
  TimingEventStatus,
  TimingSlaStatus,
} from '../types';

export const TIMING_EVENT_SCHEMA_VERSION = 1;

export const TIMING_EVENT_VALUES = {
  runTypes: [
    'initial',
    'retry',
    'resume',
    'regenerate_batch',
    'regenerate_page',
    'regenerate_artifact',
    'generate_video',
  ] as const satisfies readonly PipelineRunType[],
  runStatuses: [
    'running',
    'succeeded',
    'failed',
    'canceled',
    'partial',
  ] as const satisfies readonly PipelineRunStatus[],
  stages: [
    'queue_wait',
    'source_prepare',
    'render_pages',
    'extract_text',
    'split_text',
    'generate_scripts',
    'synthesize_audio',
    'generate_title',
    'generate_video',
    'finalize',
  ] as const satisfies readonly PipelineStage[],
  artifacts: ['image', 'text', 'script', 'audio'] as const satisfies readonly PageArtifact[],
  artifactReasons: [
    'initial',
    'regenerate',
    'resume',
    'retry',
    'dependency_changed',
    'manual_edit',
  ] as const satisfies readonly PageArtifactReason[],
  eventStatuses: [
    'running',
    'succeeded',
    'failed',
    'skipped',
    'canceled',
    'unknown',
  ] as const satisfies readonly TimingEventStatus[],
  slaStatuses: ['met', 'warning', 'breached', 'unknown'] as const satisfies readonly TimingSlaStatus[],
};

export const SLA_TARGETS_MS = {
  stages: {
    queue_wait: 30_000,
    source_prepare: 60_000,
    render_pages: 120_000,
    extract_text: 120_000,
    split_text: 120_000,
    generate_scripts: 300_000,
    synthesize_audio: 300_000,
    generate_title: 60_000,
    generate_video: 600_000,
    finalize: 30_000,
  } satisfies Record<PipelineStage, number>,
  artifacts: {
    image: 30_000,
    text: 10_000,
    script: 60_000,
    audio: 60_000,
  } satisfies Record<PageArtifact, number>,
};

function nowIso(): string {
  return new Date().toISOString();
}

function safeJson(value: unknown): string | null {
  if (value == null) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ unserializable: true });
  }
}

export function getTimingEventSchema() {
  return {
    version: TIMING_EVENT_SCHEMA_VERSION,
    values: TIMING_EVENT_VALUES,
    slaTargetsMs: SLA_TARGETS_MS,
  } as const;
}

function assertAllowedValue<T extends string>(kind: string, value: T, allowed: readonly T[]): void {
  if (!allowed.includes(value)) {
    throw new Error(`Invalid timing ${kind}: ${value}`);
  }
}

function withTimingMetadata(metadata: unknown): string {
  const base =
    metadata != null && typeof metadata === 'object' && !Array.isArray(metadata)
      ? metadata
      : metadata == null
        ? {}
        : { value: metadata };
  return safeJson({
    schema_version: TIMING_EVENT_SCHEMA_VERSION,
    ...base,
  }) ?? JSON.stringify({ schema_version: TIMING_EVENT_SCHEMA_VERSION });
}

function durationFrom(startedAt: string, endedAt: string): number {
  const ms = Date.parse(endedAt) - Date.parse(startedAt);
  return Number.isFinite(ms) && ms >= 0 ? ms : 0;
}

export function evaluateSla(durationMs: number | null | undefined, targetMs: number | null | undefined): TimingSlaStatus {
  if (durationMs == null || targetMs == null || targetMs <= 0) return 'unknown';
  if (durationMs <= targetMs) return 'met';
  if (durationMs <= targetMs * 1.5) return 'warning';
  return 'breached';
}

function nextRunAttempt(pdfId: string, runType: PipelineRunType): number {
  const row = db
    .prepare(`SELECT COALESCE(MAX(attempt), 0) + 1 AS attempt FROM pipeline_runs WHERE pdf_id = ? AND run_type = ?`)
    .get(pdfId, runType) as { attempt: number } | undefined;
  return row?.attempt ?? 1;
}

function nextStageAttempt(runId: string, stage: PipelineStage): number {
  const row = db
    .prepare(`SELECT COALESCE(MAX(attempt), 0) + 1 AS attempt FROM pipeline_stage_events WHERE run_id = ? AND stage = ? AND event_type = 'started'`)
    .get(runId, stage) as { attempt: number } | undefined;
  return row?.attempt ?? 1;
}

function nextArtifactAttempt(runId: string, pageNumber: number, artifact: PageArtifact): number {
  const row = db
    .prepare(`SELECT COALESCE(MAX(attempt), 0) + 1 AS attempt FROM page_artifact_events WHERE run_id = ? AND page_number = ? AND artifact = ? AND event_type = 'started'`)
    .get(runId, pageNumber, artifact) as { attempt: number } | undefined;
  return row?.attempt ?? 1;
}

export interface TimingRunContext {
  runId: string;
  pdfId: string;
  startedAt: string;
}

export interface TimingStageHandle {
  runId: string;
  pdfId: string;
  stage: PipelineStage;
  attempt: number;
  startedAt: string;
}

export interface TimingArtifactHandle {
  runId: string;
  pdfId: string;
  pageNumber: number;
  artifact: PageArtifact;
  attempt: number;
  reason: PageArtifactReason;
  startedAt: string;
}

export function startRun(params: {
  pdfId: string;
  runType: PipelineRunType;
  triggeredBy: string;
  parentRunId?: string | null;
  metadata?: unknown;
}): TimingRunContext | null {
  try {
    assertAllowedValue('run_type', params.runType, TIMING_EVENT_VALUES.runTypes);
    const startedAt = nowIso();
    const runId = `run_${nanoid(12)}`;
    const attempt = nextRunAttempt(params.pdfId, params.runType);
    db.prepare(
      `INSERT INTO pipeline_runs
        (id, pdf_id, run_type, parent_run_id, triggered_by, status, attempt, started_at, ended_at, duration_ms, sla_status, error_code, error_message, metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'running', ?, ?, NULL, NULL, 'unknown', NULL, NULL, ?, ?, ?)`,
    ).run(runId, params.pdfId, params.runType, params.parentRunId ?? null, params.triggeredBy, attempt, startedAt, withTimingMetadata(params.metadata), startedAt, startedAt);
    return { runId, pdfId: params.pdfId, startedAt };
  } catch (err) {
    logger.warn({ err, pdfId: params.pdfId }, 'timing: startRun failed');
    return null;
  }
}

export function finishRun(ctx: TimingRunContext | null, status: PipelineRunStatus, error?: { code?: string | null; message?: string | null }): void {
  if (!ctx) return;
  try {
    assertAllowedValue('run_status', status, TIMING_EVENT_VALUES.runStatuses);
    const endedAt = nowIso();
    const durationMs = durationFrom(ctx.startedAt, endedAt);
    const stageStatuses = db
      .prepare(`SELECT sla_status FROM pipeline_stage_summaries WHERE run_id = ?`)
      .all(ctx.runId) as Array<{ sla_status: TimingSlaStatus }>;
    const slaStatus: TimingSlaStatus = status === 'running'
      ? 'unknown'
      : stageStatuses.some((s) => s.sla_status === 'breached')
        ? 'breached'
        : stageStatuses.some((s) => s.sla_status === 'warning')
          ? 'warning'
          : stageStatuses.length > 0 && status === 'succeeded'
            ? 'met'
            : 'unknown';
    db.prepare(
      `UPDATE pipeline_runs
          SET status = ?, ended_at = ?, duration_ms = ?, sla_status = ?, error_code = ?, error_message = ?, updated_at = ?
        WHERE id = ?`,
    ).run(status, endedAt, durationMs, slaStatus, error?.code ?? null, error?.message ?? null, endedAt, ctx.runId);
  } catch (err) {
    logger.warn({ err, runId: ctx.runId }, 'timing: finishRun failed');
  }
}

export function startStage(ctx: TimingRunContext | null, stage: PipelineStage, metadata?: unknown): TimingStageHandle | null {
  if (!ctx) return null;
  try {
    assertAllowedValue('stage', stage, TIMING_EVENT_VALUES.stages);
    const startedAt = nowIso();
    const attempt = nextStageAttempt(ctx.runId, stage);
    db.prepare(
      `INSERT INTO pipeline_stage_events (run_id, pdf_id, stage, event_type, attempt, occurred_at, duration_ms, sla_status, error_code, error_message, metadata_json)
       VALUES (?, ?, ?, 'started', ?, ?, NULL, NULL, NULL, NULL, ?)`,
    ).run(ctx.runId, ctx.pdfId, stage, attempt, startedAt, withTimingMetadata(metadata));
    db.prepare(
      `INSERT INTO pipeline_stage_summaries (run_id, pdf_id, stage, attempt, status, started_at, ended_at, duration_ms, sla_target_ms, sla_status, error_code, error_message, updated_at)
       VALUES (?, ?, ?, ?, 'running', ?, NULL, NULL, ?, 'unknown', NULL, NULL, ?)
       ON CONFLICT(run_id, stage) DO UPDATE SET attempt = excluded.attempt, status = 'running', started_at = excluded.started_at, ended_at = NULL, duration_ms = NULL, sla_target_ms = excluded.sla_target_ms, sla_status = 'unknown', error_code = NULL, error_message = NULL, updated_at = excluded.updated_at`,
    ).run(ctx.runId, ctx.pdfId, stage, attempt, startedAt, SLA_TARGETS_MS.stages[stage] ?? null, startedAt);
    return { runId: ctx.runId, pdfId: ctx.pdfId, stage, attempt, startedAt };
  } catch (err) {
    logger.warn({ err, runId: ctx.runId, stage }, 'timing: startStage failed');
    return null;
  }
}

export function finishStage(handle: TimingStageHandle | null, status: Exclude<TimingEventStatus, 'running'>, metadata?: unknown, error?: { code?: string | null; message?: string | null }): void {
  if (!handle) return;
  try {
    assertAllowedValue('event_status', status, TIMING_EVENT_VALUES.eventStatuses);
    const endedAt = nowIso();
    const durationMs = durationFrom(handle.startedAt, endedAt);
    const target = SLA_TARGETS_MS.stages[handle.stage] ?? null;
    const slaStatus = status === 'succeeded' || status === 'failed' ? evaluateSla(durationMs, target) : 'unknown';
    db.prepare(
      `INSERT INTO pipeline_stage_events (run_id, pdf_id, stage, event_type, attempt, occurred_at, duration_ms, sla_status, error_code, error_message, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(handle.runId, handle.pdfId, handle.stage, status, handle.attempt, endedAt, durationMs, slaStatus, error?.code ?? null, error?.message ?? null, withTimingMetadata(metadata));
    db.prepare(
      `UPDATE pipeline_stage_summaries
          SET status = ?, ended_at = ?, duration_ms = ?, sla_target_ms = ?, sla_status = ?, error_code = ?, error_message = ?, updated_at = ?
        WHERE run_id = ? AND stage = ?`,
    ).run(status, endedAt, durationMs, target, slaStatus, error?.code ?? null, error?.message ?? null, endedAt, handle.runId, handle.stage);
  } catch (err) {
    logger.warn({ err, runId: handle.runId, stage: handle.stage }, 'timing: finishStage failed');
  }
}

export function startArtifact(params: {
  run: TimingRunContext | null;
  pageNumber: number;
  artifact: PageArtifact;
  reason: PageArtifactReason;
  metadata?: unknown;
}): TimingArtifactHandle | null {
  if (!params.run) return null;
  try {
    assertAllowedValue('artifact', params.artifact, TIMING_EVENT_VALUES.artifacts);
    assertAllowedValue('artifact_reason', params.reason, TIMING_EVENT_VALUES.artifactReasons);
    const startedAt = nowIso();
    const attempt = nextArtifactAttempt(params.run.runId, params.pageNumber, params.artifact);
    db.prepare(
      `INSERT INTO page_artifact_events (run_id, pdf_id, page_number, artifact, event_type, attempt, reason, occurred_at, duration_ms, sla_status, output_path, error_code, error_message, metadata_json)
       VALUES (?, ?, ?, ?, 'started', ?, ?, ?, NULL, NULL, NULL, NULL, NULL, ?)`,
    ).run(params.run.runId, params.run.pdfId, params.pageNumber, params.artifact, attempt, params.reason, startedAt, withTimingMetadata(params.metadata));
    db.prepare(
      `INSERT INTO page_artifact_timings (pdf_id, page_number, artifact, run_id, attempt, reason, status, started_at, ended_at, duration_ms, sla_target_ms, sla_status, output_path, error_code, error_message, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'running', ?, NULL, NULL, ?, 'unknown', NULL, NULL, NULL, ?)
       ON CONFLICT(pdf_id, page_number, artifact) DO UPDATE SET run_id = excluded.run_id, attempt = excluded.attempt, reason = excluded.reason, status = 'running', started_at = excluded.started_at, ended_at = NULL, duration_ms = NULL, sla_target_ms = excluded.sla_target_ms, sla_status = 'unknown', output_path = NULL, error_code = NULL, error_message = NULL, updated_at = excluded.updated_at`,
    ).run(params.run.pdfId, params.pageNumber, params.artifact, params.run.runId, attempt, params.reason, startedAt, SLA_TARGETS_MS.artifacts[params.artifact] ?? null, startedAt);
    return { runId: params.run.runId, pdfId: params.run.pdfId, pageNumber: params.pageNumber, artifact: params.artifact, attempt, reason: params.reason, startedAt };
  } catch (err) {
    logger.warn({ err, runId: params.run.runId, artifact: params.artifact, pageNumber: params.pageNumber }, 'timing: startArtifact failed');
    return null;
  }
}

export function finishArtifact(handle: TimingArtifactHandle | null, status: Exclude<TimingEventStatus, 'running'>, opts: { outputPath?: string | null; metadata?: unknown; error?: { code?: string | null; message?: string | null }; startedAt?: string; endedAt?: string; durationMs?: number | null } = {}): void {
  if (!handle) return;
  try {
    assertAllowedValue('event_status', status, TIMING_EVENT_VALUES.eventStatuses);
    const endedAt = opts.endedAt ?? nowIso();
    const startedAt = opts.startedAt ?? handle.startedAt;
    const durationMs = opts.durationMs ?? durationFrom(startedAt, endedAt);
    const target = SLA_TARGETS_MS.artifacts[handle.artifact] ?? null;
    const slaStatus = status === 'succeeded' || status === 'failed' ? evaluateSla(durationMs, target) : 'unknown';
    db.prepare(
      `INSERT INTO page_artifact_events (run_id, pdf_id, page_number, artifact, event_type, attempt, reason, occurred_at, duration_ms, sla_status, output_path, error_code, error_message, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(handle.runId, handle.pdfId, handle.pageNumber, handle.artifact, status, handle.attempt, handle.reason, endedAt, durationMs, slaStatus, opts.outputPath ?? null, opts.error?.code ?? null, opts.error?.message ?? null, withTimingMetadata(opts.metadata));
    db.prepare(
      `UPDATE page_artifact_timings
          SET status = ?, started_at = ?, ended_at = ?, duration_ms = ?, sla_target_ms = ?, sla_status = ?, output_path = ?, error_code = ?, error_message = ?, updated_at = ?
        WHERE pdf_id = ? AND page_number = ? AND artifact = ?`,
    ).run(status, startedAt, endedAt, durationMs, target, slaStatus, opts.outputPath ?? null, opts.error?.code ?? null, opts.error?.message ?? null, endedAt, handle.pdfId, handle.pageNumber, handle.artifact);
  } catch (err) {
    logger.warn({ err, runId: handle.runId, artifact: handle.artifact, pageNumber: handle.pageNumber }, 'timing: finishArtifact failed');
  }
}

export function recordApproxArtifact(params: {
  run: TimingRunContext | null;
  pageNumber: number;
  artifact: PageArtifact;
  reason: PageArtifactReason;
  outputPath?: string | null;
  durationMs: number;
  metadata?: unknown;
}): void {
  const h = startArtifact({ run: params.run, pageNumber: params.pageNumber, artifact: params.artifact, reason: params.reason, metadata: params.metadata });
  finishArtifact(h, 'succeeded', { outputPath: params.outputPath ?? null, durationMs: Math.max(0, Math.round(params.durationMs)), metadata: params.metadata });
}
