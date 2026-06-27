import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';

// These tests exercise auth-gated HTTP endpoints; disable Google auth so the
// requests reach the handlers instead of being rejected with 401.
setSystemAuthSettings({ googleAuthEnabled: false });

function nowIso(): string {
  return new Date().toISOString();
}

function seedReadyPdfFor(pdfId: string, pageCount: number): void {
  const t = nowIso();
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,progress_step,progress_current,progress_total,error_message,user_prompt,require_script_confirmation,tts_voice,tts_speed,script_max_chars_per_page,created_at,updated_at)
     VALUES (?,?,?,'ready',?,NULL,NULL,NULL,NULL,NULL,0,NULL,NULL,NULL,?,?)`,
  ).run(pdfId, 'regenerate-matrix', 'regenerate-matrix.pdf', pageCount, t, t);

  const pagesDir = path.join(config.storageRoot, pdfId, 'pages');
  fs.mkdirSync(pagesDir, { recursive: true });
  for (let i = 1; i <= pageCount; i++) {
    const p = String(i).padStart(3, '0');
    db.prepare(
      `INSERT INTO pages (pdf_id,page_number,image_path,text_path,script_path,audio_path,audio_duration_seconds,status,error_message,created_at,updated_at)
       VALUES (?,?,?,?,?,?,NULL,'audio_ready',NULL,?,?)`,
    ).run(pdfId, i, `pages/${p}.png`, `pages/${p}.text.txt`, `pages/${p}.script.txt`, `pages/${p}.mp3`, t, t);
    fs.writeFileSync(path.join(pagesDir, `${p}.png`), Buffer.from([137, 80, 78, 71]));
    fs.writeFileSync(path.join(pagesDir, `${p}.text.txt`), `text-${i}`, 'utf8');
    fs.writeFileSync(path.join(pagesDir, `${p}.script.txt`), `script-${i}`, 'utf8');
    fs.writeFileSync(path.join(pagesDir, `${p}.mp3`), Buffer.from([0x49, 0x44, 0x33]));
  }
}

test('regenerate: start -> status -> conflict, and cancel on non-active job should fail', async () => {
  const id = 'regen-matrix-job-01';
  seedReadyPdfFor(id, 2);
  const app = await buildApp();

  const startResp = await app.inject({
    method: 'POST',
    url: `/api/pdfs/${id}/regenerate`,
    payload: { scripts: { prompt: 'rewrite brief' } },
  });
  assert.equal(startResp.statusCode, 202);

  const statusResp = await app.inject({
    method: 'GET',
    url: `/api/pdfs/${id}/regenerate/status`,
  });
  assert.equal(statusResp.statusCode, 200);

  const persisted = db
    .prepare(`SELECT job_id, status, state_json FROM regenerate_jobs WHERE pdf_id = ?`)
    .get(id) as { job_id: string; status: string; state_json: string } | undefined;
  assert.ok(persisted);
  assert.equal(persisted.job_id, startResp.json().job_id);
  assert.ok(['pending', 'running', 'completed', 'failed', 'cancelling', 'cancelled'].includes(persisted.status));
  assert.equal(JSON.parse(persisted.state_json).pdf_id, id);

  const conflictResp = await app.inject({
    method: 'POST',
    url: `/api/pdfs/${id}/regenerate`,
    payload: { scripts: { prompt: 'rewrite again' } },
  });
  assert.equal(conflictResp.statusCode, 409);

  await new Promise((r) => setTimeout(r, 50));
  const cancelResp = await app.inject({ method: 'POST', url: `/api/pdfs/${id}/regenerate/cancel` });
  assert.ok([202, 409].includes(cancelResp.statusCode));

  await app.close();
});

test('rollback: snapshot not found should fail; rollback while running should conflict', async () => {
  const missingId = 'regen-matrix-rollback-01';
  seedReadyPdfFor(missingId, 2);
  const app = await buildApp();

  const noSnapshot = await app.inject({ method: 'POST', url: `/api/pdfs/${missingId}/regenerate/rollback` });
  assert.equal(noSnapshot.statusCode, 404);

  const runningId = 'regen-matrix-rollback-02';
  seedReadyPdfFor(runningId, 2);
  const started = await app.inject({
    method: 'POST',
    url: `/api/pdfs/${runningId}/regenerate`,
    payload: { scripts: { prompt: 'create snapshot' } },
  });
  assert.equal(started.statusCode, 202);

  const rollbackWhileRunning = await app.inject({ method: 'POST', url: `/api/pdfs/${runningId}/regenerate/rollback` });
  assert.equal(rollbackWhileRunning.statusCode, 409);

  const cancel = await app.inject({ method: 'POST', url: `/api/pdfs/${runningId}/regenerate/cancel` });
  assert.ok([202, 409].includes(cancel.statusCode));

  await app.close();
});

test('regenerate cancel: final state should not leave running or pending steps', async () => {
  const id = 'regen-matrix-cancel-01';
  seedReadyPdfFor(id, 3);
  const app = await buildApp();

  const started = await app.inject({
    method: 'POST',
    url: `/api/pdfs/${id}/regenerate`,
    payload: { scripts: { prompt: 'cancel semantics' }, audio: { voice: 'alloy' } },
  });
  assert.equal(started.statusCode, 202);

  const cancel = await app.inject({ method: 'POST', url: `/api/pdfs/${id}/regenerate/cancel` });
  assert.equal(cancel.statusCode, 202);
  assert.equal(cancel.json().status, 'cancelling');
  assert.equal(cancel.json().cancel_requested, true);

  let finalState = cancel.json();
  for (let i = 0; i < 30; i++) {
    const status = await app.inject({ method: 'GET', url: `/api/pdfs/${id}/regenerate/status` });
    assert.equal(status.statusCode, 200);
    finalState = status.json();
    if (finalState.status === 'cancelled') break;
    await new Promise((r) => setTimeout(r, 25));
  }

  assert.equal(finalState.status, 'cancelled');
  assert.equal(finalState.current_step, null);
  assert.ok(finalState.finished_at);
  assert.ok(finalState.steps.every((step: { status: string }) => step.status !== 'running' && step.status !== 'pending'));

  const persisted = db
    .prepare(`SELECT status, state_json FROM regenerate_jobs WHERE pdf_id = ?`)
    .get(id) as { status: string; state_json: string } | undefined;
  assert.ok(persisted);
  assert.equal(persisted.status, 'cancelled');
  assert.equal(JSON.parse(persisted.state_json).current_step, null);

  await app.close();
});

test('page operations boundaries: move invalid index, delete non-existing page, add with negative index', async () => {
  const id = 'regen-matrix-pageops-01';
  seedReadyPdfFor(id, 3);
  const app = await buildApp();

  const moveInvalidFrom = await app.inject({
    method: 'POST',
    url: `/api/pdfs/${id}/pages/move`,
    payload: { from_page_number: 0, to_page_number: 1 },
  });
  assert.equal(moveInvalidFrom.statusCode, 400);

  const moveInvalidTo = await app.inject({
    method: 'POST',
    url: `/api/pdfs/${id}/pages/move`,
    payload: { from_page_number: 1, to_page_number: 99 },
  });
  assert.equal(moveInvalidTo.statusCode, 400);

  const deleteMissing = await app.inject({ method: 'DELETE', url: `/api/pdfs/${id}/pages/99` });
  assert.equal(deleteMissing.statusCode, 404);

  const addNegative = await app.inject({
    method: 'POST',
    url: `/api/pdfs/${id}/pages`,
    payload: { after_page_number: -1 },
  });
  assert.equal(addNegative.statusCode, 400);

  await app.close();
});

