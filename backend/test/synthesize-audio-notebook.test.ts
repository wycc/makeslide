import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { synthesizeAudio } from '../src/worker/steps/synthesizeAudio';
import { db } from '../src/db';
import { config } from '../src/config';

// Notebook pages are silent (plan §2.3): synthesizeAudio must never call TTS for a
// render_type='notebook' page. This test seeds only a notebook page, so if the skip
// regressed it would attempt a real TTS request (and fail/hang) instead of returning a
// benign skip — no OpenAI key or network is exercised on the happy path.

const PDF_ID = 'test-synth-notebook-01';

function nowIso(): string {
  return new Date().toISOString();
}

function seedNotebookPage(pdfId: string): void {
  const t = nowIso();
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,progress_step,progress_current,progress_total,error_message,user_prompt,require_script_confirmation,owner_sub,visibility,tts_voice,tts_speed,script_max_chars_per_page,created_at,updated_at)
     VALUES (?,?,?,'ready',1,NULL,NULL,NULL,NULL,NULL,0,'account-1','private',NULL,NULL,NULL,?,?)`,
  ).run(pdfId, 't', 't.pdf', t, t);
  fs.mkdirSync(path.join(config.storageRoot, pdfId, 'pages'), { recursive: true });
  db.prepare(
    `INSERT INTO pages (pdf_id,page_number,page_uid,image_path,text_path,script_path,audio_path,audio_duration_seconds,status,error_message,render_type,notebook_path,created_at,updated_at)
     VALUES (?,?,?,?,?,?,NULL,NULL,'audio_ready',NULL,'notebook',?,?,?)`,
  ).run(pdfId, 1, 'nbsynth1', 'pages/nbsynth1.jpg', 'pages/nbsynth1.text.txt', null, 'pages/nbsynth1.ipynb', t, t);
}

test('synthesizeAudio skips a notebook page without calling TTS or writing audio', async () => {
  seedNotebookPage(PDF_ID);
  const progress: Array<{ page: number; skipped: boolean; error: string | null }> = [];
  const result = await synthesizeAudio({
    pdfId: PDF_ID,
    pageCount: 1,
    pages: [{ pageNumber: 1, script: 'this script must be ignored for a notebook page' }],
    onPage: (page, _done, info) => {
      if (info) progress.push({ page, skipped: info.skipped, error: info.error });
    },
  });

  const page = result.pages[0];
  assert.ok(page);
  assert.equal(page!.skipped, true);
  assert.equal(page!.error, null); // benign skip, not a failure
  assert.equal(page!.audioPath, '');
  assert.equal(page!.durationSeconds, null);

  // progress callback reported the skip
  assert.deepEqual(progress, [{ page: 1, skipped: true, error: null }]);

  // no audio file was written for the notebook page
  assert.equal(fs.existsSync(path.join(config.storageRoot, PDF_ID, 'pages', 'nbsynth1.m4a')), false);
});
