import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';
import { getRegenerateJob } from '../src/worker/regenerate';
import { getAddPagesJob } from '../src/worker/addPagesFromPrompt';

function testSessionCookie(sub = 'account-1'): string {
  const payload = Buffer.from(JSON.stringify({ provider: 'google', sub, email: `${sub}@example.com` }), 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

const OWNER_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie('account-1'))}`, 'content-type': 'application/json' };

setSystemAuthSettings({ googleAuthEnabled: false });

function nowIso(): string {
  return new Date().toISOString();
}

function seedReadyPdf(pdfId: string, pageCount = 2): void {
  const t = nowIso();
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,progress_step,progress_current,progress_total,error_message,user_prompt,require_script_confirmation,owner_sub,visibility,tts_voice,tts_speed,script_max_chars_per_page,created_at,updated_at)
     VALUES (?,?,?,'ready',?,NULL,NULL,NULL,NULL,NULL,0,'account-1','private',NULL,NULL,NULL,?,?)`,
  ).run(pdfId, 't', `${pdfId}.pdf`, pageCount, t, t);

  const pagesDir = path.join(config.storageRoot, pdfId, 'pages');
  fs.mkdirSync(pagesDir, { recursive: true });
  for (let i = 1; i <= pageCount; i++) {
    const p = String(i).padStart(3, '0');
    db.prepare(
      `INSERT INTO pages (pdf_id,page_number,image_path,text_path,script_path,audio_path,audio_duration_seconds,status,error_message,created_at,updated_at)
       VALUES (?,?,?,?,?,?,NULL,'audio_ready',NULL,?,?)`,
    ).run(pdfId, i, `pages/${p}.png`, `pages/${p}.text.txt`, `pages/${p}.script.txt`, `pages/${p}.mp3`, t, t);
    fs.writeFileSync(path.join(pagesDir, `${p}.png`), Buffer.from([137, 80, 78, 71]));
  }
}

test('DELETE /api/pdfs/:id clears the in-memory regenerate job state for that PDF', async () => {
  const pdfId = 'delete-cleanup-regen-01';
  seedReadyPdf(pdfId);
  // Seed a finished job straight into regenerate_jobs (instead of starting a real job through
  // the route) so the test doesn't race the background runner's own filesystem writes against
  // the DELETE call's removePdfDir() — a separate, pre-existing concern from the leak this test
  // is targeting.
  const t = nowIso();
  const state = {
    job_id: 'test-job-01',
    pdf_id: pdfId,
    steps: [],
    current_step: null,
    step_index: 0,
    status: 'completed',
    started_at: t,
    updated_at: t,
    finished_at: t,
    error: null,
    message: null,
    cancel_requested: false,
    last_processed_page: null,
    last_generated_page: null,
    eta_seconds: null,
    estimated_completion_at: null,
    snapshot_id: null,
    rollback_available: false,
  };
  db.prepare(
    `INSERT INTO regenerate_jobs (pdf_id, job_id, state_json, status, started_at, updated_at, finished_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(pdfId, state.job_id, JSON.stringify(state), state.status, t, t, t);

  const app = await buildApp();
  try {
    assert.ok(getRegenerateJob(pdfId), 'expected the persisted job to be loaded and cached in memory');

    const delResp = await app.inject({ method: 'DELETE', url: `/api/pdfs/${pdfId}`, headers: OWNER_HEADERS });
    assert.equal(delResp.statusCode, 204);

    assert.equal(getRegenerateJob(pdfId), null, 'job state must not leak after the PDF is deleted');
  } finally {
    await app.close();
  }
});

test('DELETE /api/pdfs/:id clears the in-memory add-pages-from-prompt job state for that PDF', async () => {
  const pdfId = 'delete-cleanup-addpages-01';
  seedReadyPdf(pdfId);
  const app = await buildApp();
  try {
    const startResp = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${pdfId}/add-pages-from-prompt`,
      headers: OWNER_HEADERS,
      payload: { prompt: 'add a summary slide' },
    });
    assert.equal(startResp.statusCode, 202);
    assert.ok(getAddPagesJob(pdfId), 'expected a job to be tracked right after starting it');

    const delResp = await app.inject({ method: 'DELETE', url: `/api/pdfs/${pdfId}`, headers: OWNER_HEADERS });
    assert.equal(delResp.statusCode, 204);

    assert.equal(getAddPagesJob(pdfId), undefined, 'job state must not leak after the PDF is deleted');
  } finally {
    await app.close();
  }
});
