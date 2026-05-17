import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { evaluateSla, finishArtifact, finishRun, finishStage, getTimingEventSchema, startArtifact, startRun, startStage, TIMING_EVENT_SCHEMA_VERSION } from '../src/services/timing';
import { setOpenAIClientForTest } from '../src/services/openai';
import { renderTextPagesWithLlm } from '../src/worker/steps/renderTextPagesWithLlm';

const PDF_ID = 'test-timing-01';

function nowIso(): string {
  return new Date().toISOString();
}

function seedPdf(): void {
  const t = nowIso();
  db.prepare(`DELETE FROM page_artifact_events WHERE pdf_id = ?`).run(PDF_ID);
  db.prepare(`DELETE FROM page_artifact_timings WHERE pdf_id = ?`).run(PDF_ID);
  db.prepare(`DELETE FROM pipeline_stage_events WHERE pdf_id = ?`).run(PDF_ID);
  db.prepare(`DELETE FROM pipeline_stage_summaries WHERE pdf_id = ?`).run(PDF_ID);
  db.prepare(`DELETE FROM pipeline_runs WHERE pdf_id = ?`).run(PDF_ID);
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(PDF_ID);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(PDF_ID);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,progress_step,progress_current,progress_total,error_message,user_prompt,require_script_confirmation,tts_voice,tts_speed,script_max_chars_per_page,created_at,updated_at)
     VALUES (?,?,?,'ready',1,NULL,NULL,NULL,NULL,NULL,0,NULL,NULL,NULL,?,?)`,
  ).run(PDF_ID, 'Timing test', 'timing.pdf', t, t);
  db.prepare(
    `INSERT INTO pages (pdf_id,page_number,image_path,text_path,script_path,audio_path,audio_duration_seconds,status,error_message,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,'audio_ready',NULL,?,?)`,
  ).run(PDF_ID, 1, 'pages/001.png', 'pages/001.text.txt', 'pages/001.script.txt', 'pages/001.mp3', 12.3, t, t);
}

test('timing migration creates run/stage/artifact tables', () => {
  const names = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('pipeline_runs','pipeline_stage_events','pipeline_stage_summaries','page_artifact_events','page_artifact_timings') ORDER BY name`)
    .all() as Array<{ name: string }>;
  assert.deepEqual(names.map((n) => n.name), [
    'page_artifact_events',
    'page_artifact_timings',
    'pipeline_runs',
    'pipeline_stage_events',
    'pipeline_stage_summaries',
  ]);
});

test('timing service writes events and updates summaries', () => {
  seedPdf();
  const run = startRun({ pdfId: PDF_ID, runType: 'initial', triggeredBy: 'system' });
  assert.ok(run?.runId);
  const stage = startStage(run, 'render_pages');
  finishStage(stage, 'succeeded');
  const artifact = startArtifact({ run, pageNumber: 1, artifact: 'image', reason: 'initial' });
  finishArtifact(artifact, 'succeeded', { outputPath: 'pages/001.png', durationMs: 42 });
  finishRun(run, 'succeeded');

  const runRow = db.prepare(`SELECT status, duration_ms FROM pipeline_runs WHERE id = ?`).get(run!.runId) as { status: string; duration_ms: number | null };
  assert.equal(runRow.status, 'succeeded');
  assert.equal(typeof runRow.duration_ms, 'number');

  const stageRow = db.prepare(`SELECT status, sla_status FROM pipeline_stage_summaries WHERE run_id = ? AND stage = 'render_pages'`).get(run!.runId) as { status: string; sla_status: string };
  assert.equal(stageRow.status, 'succeeded');
  assert.match(stageRow.sla_status, /^(met|warning|breached|unknown)$/);

  const timing = db.prepare(`SELECT status, duration_ms, reason FROM page_artifact_timings WHERE pdf_id = ? AND page_number = 1 AND artifact = 'image'`).get(PDF_ID) as { status: string; duration_ms: number; reason: string };
  assert.equal(timing.status, 'succeeded');
  assert.equal(timing.duration_ms, 42);
  assert.equal(timing.reason, 'initial');
});

test('timing event schema exposes standardized values and SLA targets', () => {
  const schema = getTimingEventSchema();
  assert.equal(schema.version, TIMING_EVENT_SCHEMA_VERSION);
  assert.deepEqual(schema.values.stages, [
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
  ]);
  assert.deepEqual(schema.values.artifacts, ['image', 'text', 'script', 'audio']);
  assert.equal(schema.slaTargetsMs.stages.render_pages, 120_000);
  assert.equal(schema.slaTargetsMs.artifacts.image, 30_000);
});

test('timing events include schema version in metadata', () => {
  seedPdf();
  const run = startRun({ pdfId: PDF_ID, runType: 'initial', triggeredBy: 'system', metadata: { resumeFrom: 'start' } });
  const stage = startStage(run, 'render_pages', { pageCount: 1 });
  finishStage(stage, 'succeeded', { pageCount: 1 });
  const artifact = startArtifact({ run, pageNumber: 1, artifact: 'image', reason: 'initial', metadata: { precision: 'batch_average' } });
  finishArtifact(artifact, 'succeeded', { outputPath: 'pages/001.png', durationMs: 42, metadata: { precision: 'batch_average' } });

  const runRow = db.prepare(`SELECT metadata_json FROM pipeline_runs WHERE id = ?`).get(run!.runId) as { metadata_json: string };
  assert.equal(JSON.parse(runRow.metadata_json).schema_version, TIMING_EVENT_SCHEMA_VERSION);

  const stageEvents = db.prepare(`SELECT event_type, metadata_json FROM pipeline_stage_events WHERE run_id = ? ORDER BY id ASC`).all(run!.runId) as Array<{ event_type: string; metadata_json: string }>;
  assert.equal(stageEvents.length, 2);
  for (const event of stageEvents) {
    const metadata = JSON.parse(event.metadata_json) as { schema_version: number };
    assert.equal(metadata.schema_version, TIMING_EVENT_SCHEMA_VERSION);
  }

  const artifactEvents = db.prepare(`SELECT event_type, metadata_json FROM page_artifact_events WHERE run_id = ? ORDER BY id ASC`).all(run!.runId) as Array<{ event_type: string; metadata_json: string }>;
  assert.equal(artifactEvents.length, 2);
  for (const event of artifactEvents) {
    const metadata = JSON.parse(event.metadata_json) as { schema_version: number };
    assert.equal(metadata.schema_version, TIMING_EVENT_SCHEMA_VERSION);
  }
});

test('SLA evaluation returns met, warning, breached, and unknown thresholds', () => {
  assert.equal(evaluateSla(100, 100), 'met');
  assert.equal(evaluateSla(101, 100), 'warning');
  assert.equal(evaluateSla(150, 100), 'warning');
  assert.equal(evaluateSla(151, 100), 'breached');
  assert.equal(evaluateSla(null, 100), 'unknown');
  assert.equal(evaluateSla(100, 0), 'unknown');
});

test('TXT image timing can use render-step duration instead of callback duration', () => {
  seedPdf();
  const run = startRun({ pdfId: PDF_ID, runType: 'initial', triggeredBy: 'system' });
  const artifact = startArtifact({
    run,
    pageNumber: 1,
    artifact: 'image',
    reason: 'initial',
    metadata: { source_type: 'text', precision: 'step_timing' },
  });

  const startedAt = '2026-05-15T02:00:00.000Z';
  const endedAt = '2026-05-15T02:00:12.345Z';
  finishArtifact(artifact, 'succeeded', {
    startedAt,
    endedAt,
    durationMs: 12_345,
    outputPath: 'pages/001.png',
    metadata: { source_type: 'text', precision: 'step_timing', reused: false },
  });

  const timing = db
    .prepare(`SELECT started_at, ended_at, duration_ms FROM page_artifact_timings WHERE pdf_id = ? AND page_number = 1 AND artifact = 'image'`)
    .get(PDF_ID) as { started_at: string; ended_at: string; duration_ms: number };
  assert.equal(timing.started_at, startedAt);
  assert.equal(timing.ended_at, endedAt);
  assert.equal(timing.duration_ms, 12_345);
});

test('TXT LLM image generation retries transient errors then succeeds with image timeout', async () => {
  const pdfId = `test-timing-render-retry-${Date.now()}`;
  const calls: Array<{ body: unknown; options: { timeout?: number } | undefined }> = [];
  const transient = Object.assign(new Error('rate limited'), { status: 429, code: 'rate_limit_exceeded', type: 'rate_limit_error' });
  const onePixelPngBase64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';
  setOpenAIClientForTest({
    images: {
      generate: async (body: unknown, options?: { timeout?: number }) => {
        calls.push({ body, options });
        if (calls.length === 1) throw transient;
        return { data: [{ b64_json: onePixelPngBase64 }] };
      },
    },
  } as never);

  const events: Array<{ pageNumber: number; info: { status?: string; attempt?: number; timeoutMs?: number } }> = [];
  const result = await renderTextPagesWithLlm({
    pdfId,
    pages: [{ pageNumber: 1, content: '第一頁內容' }],
    onPage: (pageNumber, _imagePath, info) => events.push({ pageNumber, info }),
  });

  assert.equal(result.pageCount, 1);
  assert.equal(calls.length, 2);
  assert.equal((calls[0]?.body as { quality?: string } | undefined)?.quality, 'low');
  assert.equal(calls[0]?.options?.timeout, events[0]?.info.timeoutMs);
  assert.equal(events[0]?.pageNumber, 1);
  assert.equal(events[0]?.info.status, 'succeeded');
  assert.equal(events[0]?.info.attempt, 2);
  setOpenAIClientForTest(null);
});

test('TXT LLM image generation final failure can be recorded as failed image artifact timing', async () => {
  seedPdf();
  const run = startRun({ pdfId: PDF_ID, runType: 'initial', triggeredBy: 'system' });
  const h = startArtifact({
    run,
    pageNumber: 1,
    artifact: 'image',
    reason: 'initial',
    metadata: { source_type: 'text', precision: 'step_timing' },
  });
  const startedAt = '2026-05-15T02:10:00.000Z';
  const endedAt = '2026-05-15T02:10:30.000Z';
  finishArtifact(h, 'failed', {
    startedAt,
    endedAt,
    durationMs: 30_000,
    outputPath: null,
    error: { code: 'ETIMEDOUT', message: 'image request timed out' },
    metadata: {
      source_type: 'text',
      precision: 'step_timing',
      attempt: 3,
      model: 'gpt-image-2',
      promptLength: 1234,
      timeoutMs: 60000,
      errorStatus: null,
      errorType: 'APIConnectionTimeoutError',
    },
  });

  const timing = db
    .prepare(`SELECT status, duration_ms, output_path, error_code, error_message FROM page_artifact_timings WHERE pdf_id = ? AND page_number = 1 AND artifact = 'image'`)
    .get(PDF_ID) as { status: string; duration_ms: number; output_path: string | null; error_code: string; error_message: string };
  assert.equal(timing.status, 'failed');
  assert.equal(timing.duration_ms, 30_000);
  assert.equal(timing.output_path, null);
  assert.equal(timing.error_code, 'ETIMEDOUT');
  assert.equal(timing.error_message, 'image request timed out');

  const event = db
    .prepare(`SELECT event_type, metadata_json FROM page_artifact_events WHERE pdf_id = ? AND page_number = 1 AND artifact = 'image' AND event_type = 'failed'`)
    .get(PDF_ID) as { event_type: string; metadata_json: string };
  assert.equal(event.event_type, 'failed');
  const metadata = JSON.parse(event.metadata_json) as { attempt: number; promptLength: number; timeoutMs: number };
  assert.equal(metadata.attempt, 3);
  assert.equal(metadata.promptLength, 1234);
  assert.equal(metadata.timeoutMs, 60000);
});

test('GET /api/pdfs/:id includes page timings with null fallback for missing artifacts', async () => {
  seedPdf();
  const run = startRun({ pdfId: PDF_ID, runType: 'regenerate_artifact', triggeredBy: 'user' });
  const audio = startArtifact({ run, pageNumber: 1, artifact: 'audio', reason: 'regenerate' });
  finishArtifact(audio, 'succeeded', { outputPath: 'pages/001.mp3', durationMs: 1234 });
  finishRun(run, 'succeeded');

  const app = await buildApp();
  const resp = await app.inject({ method: 'GET', url: `/api/pdfs/${PDF_ID}` });
  assert.equal(resp.statusCode, 200);
  const body = resp.json() as { pages: Array<{ timings: { image: unknown; text: unknown; script: unknown; audio: { duration_ms: number; reason: string } | null } }> };
  assert.equal(body.pages[0]?.timings.image, null);
  assert.equal(body.pages[0]?.timings.audio?.duration_ms, 1234);
  assert.equal(body.pages[0]?.timings.audio?.reason, 'regenerate');
  await app.close();
});
