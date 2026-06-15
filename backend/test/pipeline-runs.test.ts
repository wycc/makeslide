import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { setSystemAuthSettings } from '../src/services/aiSettings';
import type { PipelineRunsResponse } from '../src/types';

const PDF_ID = 'test-pipeline-runs-01';
const SESSION_COOKIE =
  'eyJwcm92aWRlciI6Imdvb2dsZSIsInN1YiI6ImFjY291bnQtMSIsImVtYWlsIjoiYWNjb3VudC0xQGV4YW1wbGUuY29tIn0.mDkylBa8ZqLOib7FEOYl6YtwwODNJwieo4kUfAIIimw';
const AUTH_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(SESSION_COOKIE)}` };

setSystemAuthSettings({ googleAuthEnabled: false });

function nowIso(): string {
  return new Date().toISOString();
}

function isoMinutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function seedPdf(pdfId: string): void {
  const t = nowIso();
  db.prepare(`DELETE FROM pipeline_stage_summaries WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pipeline_runs WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,progress_step,progress_current,progress_total,error_message,user_prompt,require_script_confirmation,owner_sub,visibility,tts_voice,tts_speed,script_max_chars_per_page,created_at,updated_at)
     VALUES (?,?,?,'ready',1,NULL,NULL,NULL,NULL,NULL,0,'account-1','public',NULL,NULL,NULL,?,?)`,
  ).run(pdfId, 't', 't.pdf', t, t);
}

function seedRuns(pdfId: string): { olderRunId: string; newerRunId: string } {
  const olderRunId = 'run_older0001';
  const newerRunId = 'run_newer0001';
  const olderStart = isoMinutesAgo(10);
  const olderEnd = isoMinutesAgo(9);
  const newerStart = isoMinutesAgo(1);

  db.prepare(
    `INSERT INTO pipeline_runs (id, pdf_id, run_type, parent_run_id, triggered_by, status, attempt, started_at, ended_at, duration_ms, sla_status, error_code, error_message, metadata_json, created_at, updated_at)
     VALUES (?, ?, 'initial', NULL, 'user', 'succeeded', 1, ?, ?, ?, 'met', NULL, NULL, ?, ?, ?)`,
  ).run(olderRunId, pdfId, olderStart, olderEnd, 60_000, JSON.stringify({ schema_version: 1, note: 'first run' }), olderStart, olderEnd);

  db.prepare(
    `INSERT INTO pipeline_runs (id, pdf_id, run_type, parent_run_id, triggered_by, status, attempt, started_at, ended_at, duration_ms, sla_status, error_code, error_message, metadata_json, created_at, updated_at)
     VALUES (?, ?, 'regenerate_page', ?, 'user', 'running', 1, ?, NULL, NULL, 'unknown', NULL, NULL, NULL, ?, ?)`,
  ).run(newerRunId, pdfId, olderRunId, newerStart, newerStart, newerStart);

  // Insert stage summaries out of pipeline order to verify response sorts by canonical stage order.
  db.prepare(
    `INSERT INTO pipeline_stage_summaries (run_id, pdf_id, stage, attempt, status, started_at, ended_at, duration_ms, sla_target_ms, sla_status, error_code, error_message, updated_at)
     VALUES (?, ?, 'generate_animations', 1, 'succeeded', ?, ?, 5000, 60000, 'met', NULL, NULL, ?)`,
  ).run(olderRunId, pdfId, olderStart, olderEnd, olderEnd);
  db.prepare(
    `INSERT INTO pipeline_stage_summaries (run_id, pdf_id, stage, attempt, status, started_at, ended_at, duration_ms, sla_target_ms, sla_status, error_code, error_message, updated_at)
     VALUES (?, ?, 'render_pages', 1, 'succeeded', ?, ?, 30000, 120000, 'met', NULL, NULL, ?)`,
  ).run(olderRunId, pdfId, olderStart, olderEnd, olderEnd);

  db.prepare(
    `INSERT INTO pipeline_stage_summaries (run_id, pdf_id, stage, attempt, status, started_at, ended_at, duration_ms, sla_target_ms, sla_status, error_code, error_message, updated_at)
     VALUES (?, ?, 'queue_wait', 1, 'running', ?, NULL, NULL, 30000, 'unknown', NULL, NULL, ?)`,
  ).run(newerRunId, pdfId, newerStart, newerStart);

  return { olderRunId, newerRunId };
}

test('GET /api/pdfs/:id/runs returns run history ordered newest-first with stage breakdown', async () => {
  seedPdf(PDF_ID);
  const { olderRunId, newerRunId } = seedRuns(PDF_ID);
  const app = await buildApp();
  try {
    const resp = await app.inject({
      method: 'GET',
      url: `/api/pdfs/${PDF_ID}/runs`,
      headers: AUTH_HEADERS,
    });
    assert.equal(resp.statusCode, 200);
    const body = resp.json() as PipelineRunsResponse;
    assert.equal(body.runs.length, 2);

    const [newer, older] = body.runs;
    assert.equal(newer.id, newerRunId);
    assert.equal(newer.run_type, 'regenerate_page');
    assert.equal(newer.parent_run_id, olderRunId);
    assert.equal(newer.status, 'running');
    assert.equal(newer.ended_at, null);
    assert.equal(newer.duration_ms, null);
    assert.equal(newer.metadata, null);
    assert.equal(newer.stages.length, 1);
    assert.equal(newer.stages[0]?.stage, 'queue_wait');
    assert.equal(newer.stages[0]?.status, 'running');

    assert.equal(older.id, olderRunId);
    assert.equal(older.run_type, 'initial');
    assert.equal(older.status, 'succeeded');
    assert.equal(older.duration_ms, 60_000);
    assert.deepEqual(older.metadata, { schema_version: 1, note: 'first run' });
    // Canonical pipeline order: render_pages (index 2) before generate_animations (index 8),
    // even though generate_animations was inserted first.
    assert.deepEqual(older.stages.map((s) => s.stage), ['render_pages', 'generate_animations']);
  } finally {
    await app.close();
  }
});

test('GET /api/pdfs/:id/runs respects the limit query parameter', async () => {
  seedPdf(PDF_ID);
  const { newerRunId } = seedRuns(PDF_ID);
  const app = await buildApp();
  try {
    const resp = await app.inject({
      method: 'GET',
      url: `/api/pdfs/${PDF_ID}/runs?limit=1`,
      headers: AUTH_HEADERS,
    });
    assert.equal(resp.statusCode, 200);
    const body = resp.json() as PipelineRunsResponse;
    assert.equal(body.runs.length, 1);
    assert.equal(body.runs[0]?.id, newerRunId);
  } finally {
    await app.close();
  }
});

test('GET /api/pdfs/:id/runs returns 404 for an unknown PDF', async () => {
  const app = await buildApp();
  try {
    const resp = await app.inject({
      method: 'GET',
      url: `/api/pdfs/test-pipeline-runs-missing/runs`,
      headers: AUTH_HEADERS,
    });
    assert.equal(resp.statusCode, 404);
    const body = resp.json() as { error: { code: string } };
    assert.equal(body.error.code, 'PDF_NOT_FOUND');
  } finally {
    await app.close();
  }
});
