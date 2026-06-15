import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { setSystemAuthSettings } from '../src/services/aiSettings';
import type { SlowArtifactsResponse } from '../src/types';

const PDF_ID = 'test-slow-artifacts-01';
const SESSION_COOKIE =
  'eyJwcm92aWRlciI6Imdvb2dsZSIsInN1YiI6ImFjY291bnQtMSIsImVtYWlsIjoiYWNjb3VudC0xQGV4YW1wbGUuY29tIn0.mDkylBa8ZqLOib7FEOYl6YtwwODNJwieo4kUfAIIimw';
const AUTH_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(SESSION_COOKIE)}` };

setSystemAuthSettings({ googleAuthEnabled: false });

function nowIso(): string {
  return new Date().toISOString();
}

function seedPdf(pdfId: string): void {
  const t = nowIso();
  db.prepare(`DELETE FROM page_artifact_timings WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pipeline_runs WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,progress_step,progress_current,progress_total,error_message,user_prompt,require_script_confirmation,owner_sub,visibility,tts_voice,tts_speed,script_max_chars_per_page,created_at,updated_at)
     VALUES (?,?,?,'ready',3,NULL,NULL,NULL,NULL,NULL,0,'account-1','public',NULL,NULL,NULL,?,?)`,
  ).run(pdfId, 't', 't.pdf', t, t);
}

function seedArtifactTimings(pdfId: string): void {
  const t = nowIso();
  const runId = 'run_slow0001';
  db.prepare(
    `INSERT INTO pipeline_runs (id, pdf_id, run_type, parent_run_id, triggered_by, status, attempt, started_at, ended_at, duration_ms, sla_status, error_code, error_message, metadata_json, created_at, updated_at)
     VALUES (?, ?, 'initial', NULL, 'user', 'succeeded', 1, ?, ?, 100000, 'met', NULL, NULL, NULL, ?, ?)`,
  ).run(runId, pdfId, t, t, t, t);

  const rows: Array<[number, string, string, number | null, number | null, string]> = [
    [1, 'audio', 'succeeded', 75_000, 60_000, 'breached'],
    [1, 'image', 'succeeded', 1_800, 10_000, 'met'],
    [2, 'script', 'succeeded', 8_500, 8_000, 'warning'],
    [2, 'audio', 'running', null, 60_000, 'unknown'],
    [3, 'text', 'succeeded', 400, 5_000, 'met'],
  ];
  for (const [pageNumber, artifact, status, durationMs, slaTargetMs, slaStatus] of rows) {
    db.prepare(
      `INSERT INTO page_artifact_timings (pdf_id, page_number, artifact, run_id, attempt, reason, status, started_at, ended_at, duration_ms, sla_target_ms, sla_status, output_path, error_code, error_message, updated_at)
       VALUES (?, ?, ?, ?, 1, 'initial', ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?)`,
    ).run(pdfId, pageNumber, artifact, runId, status, t, durationMs == null ? null : t, durationMs, slaTargetMs, slaStatus, t);
  }
}

test('GET /api/pdfs/:id/slow-artifacts ranks artifacts by duration_ms descending', async () => {
  seedPdf(PDF_ID);
  seedArtifactTimings(PDF_ID);
  const app = await buildApp();
  try {
    const resp = await app.inject({
      method: 'GET',
      url: `/api/pdfs/${PDF_ID}/slow-artifacts`,
      headers: AUTH_HEADERS,
    });
    assert.equal(resp.statusCode, 200);
    const body = resp.json() as SlowArtifactsResponse;
    // Running artifact (duration_ms IS NULL) is excluded; 4 remain.
    assert.equal(body.artifacts.length, 4);
    assert.deepEqual(
      body.artifacts.map((a) => `${a.page_number}:${a.artifact}`),
      ['1:audio', '2:script', '1:image', '3:text'],
    );
    const slowest = body.artifacts[0];
    assert.equal(slowest?.duration_ms, 75_000);
    assert.equal(slowest?.sla_status, 'breached');
    assert.equal(slowest?.sla_target_ms, 60_000);
    assert.equal(slowest?.status, 'succeeded');
  } finally {
    await app.close();
  }
});

test('GET /api/pdfs/:id/slow-artifacts respects the limit query parameter', async () => {
  seedPdf(PDF_ID);
  seedArtifactTimings(PDF_ID);
  const app = await buildApp();
  try {
    const resp = await app.inject({
      method: 'GET',
      url: `/api/pdfs/${PDF_ID}/slow-artifacts?limit=2`,
      headers: AUTH_HEADERS,
    });
    assert.equal(resp.statusCode, 200);
    const body = resp.json() as SlowArtifactsResponse;
    assert.equal(body.artifacts.length, 2);
    assert.deepEqual(
      body.artifacts.map((a) => `${a.page_number}:${a.artifact}`),
      ['1:audio', '2:script'],
    );
  } finally {
    await app.close();
  }
});

test('GET /api/pdfs/:id/slow-artifacts returns 404 for an unknown PDF', async () => {
  const app = await buildApp();
  try {
    const resp = await app.inject({
      method: 'GET',
      url: `/api/pdfs/test-slow-artifacts-missing/slow-artifacts`,
      headers: AUTH_HEADERS,
    });
    assert.equal(resp.statusCode, 404);
    const body = resp.json() as { error: { code: string } };
    assert.equal(body.error.code, 'PDF_NOT_FOUND');
  } finally {
    await app.close();
  }
});
