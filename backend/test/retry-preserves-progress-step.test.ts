import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';
import {
  setProcessingQueueAdapter,
  resetProcessingQueueForTests,
  type ProcessingQueue,
  type ProcessingQueueAdapter,
  type ProcessingQueueStats,
  type QueueTask,
} from '../src/worker/queue';
import crypto from 'node:crypto';

// A queue adapter that records enqueued tasks WITHOUT ever running them, so
// `POST /retry` can be exercised end-to-end (including `enqueuePdfProcessing`)
// without a real `runPipeline()` background run racing with the assertions
// below or requiring a real source.pdf / LLM / TTS stack.
class NoopRecordingQueue implements ProcessingQueue {
  readonly name: string;
  readonly concurrency: number;
  readonly tasks: Array<QueueTask<unknown>> = [];

  constructor(options: { name: string; concurrency: number }) {
    this.name = options.name;
    this.concurrency = options.concurrency;
  }

  async add<T>(task: QueueTask<T>): Promise<T> {
    this.tasks.push(task as QueueTask<unknown>);
    // Intentionally never invoke `task()` — we only care whether/what was
    // enqueued, not the pipeline's own execution.
    return undefined as unknown as T;
  }

  getStats(): ProcessingQueueStats {
    return { name: this.name, concurrency: this.concurrency, pending: 0, size: this.tasks.length };
  }
}

class NoopRecordingAdapter implements ProcessingQueueAdapter {
  createProcessingQueue(options: { name: string; concurrency: number }): ProcessingQueue {
    return new NoopRecordingQueue(options);
  }
}

function testSessionCookie(sub = 'retry-progress-owner'): string {
  const payload = Buffer.from(JSON.stringify({ provider: 'google', sub, email: `${sub}@example.com` }), 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

const OWNER_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie())}` };

setSystemAuthSettings({ googleAuthEnabled: false });

function nowIso(): string {
  return new Date().toISOString();
}

function seedFailedPdf(pdfId: string, progressStep: string | null): void {
  const t = nowIso();
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,progress_step,progress_current,progress_total,error_message,user_prompt,require_script_confirmation,owner_sub,visibility,tts_voice,tts_speed,script_max_chars_per_page,created_at,updated_at)
     VALUES (?,?,?,'failed',3,?,2,3,'語音生成失敗：暫時性網路錯誤',NULL,0,'retry-progress-owner','private',NULL,NULL,NULL,?,?)`,
  ).run(pdfId, 't', `${pdfId}.pdf`, progressStep, t, t);

  // Seed 3 pages that already have script_path populated (script stage
  // already completed successfully before the TTS-stage failure).
  const pagesDir = path.join(config.storageRoot, pdfId, 'pages');
  fs.mkdirSync(pagesDir, { recursive: true });
  for (let i = 1; i <= 3; i++) {
    const uid = `rtprg${pdfId.replace(/-/g, '')}p${i}`;
    db.prepare(
      `INSERT INTO pages (pdf_id,page_number,page_uid,image_path,text_path,script_path,audio_path,audio_duration_seconds,status,error_message,created_at,updated_at)
       VALUES (?,?,?,?,?,?,NULL,NULL,'script_ready',NULL,?,?)`,
    ).run(pdfId, i, uid, `pages/${uid}.jpg`, `pages/${uid}.text.txt`, `pages/${uid}.script.txt`, t, t);
    fs.writeFileSync(path.join(pagesDir, `${uid}.script.txt`), `第 ${i} 頁已生成的逐字稿。`, 'utf8');
  }

  fs.writeFileSync(
    path.join(config.storageRoot, pdfId, 'metadata.json'),
    JSON.stringify({
      id: pdfId, title: 't', original_filename: `${pdfId}.pdf`, status: 'failed', page_count: 3,
      progress_step: progressStep, progress_current: 2, progress_total: 3,
      error_message: '語音生成失敗：暫時性網路錯誤', pages: [], created_at: t, updated_at: t,
    }),
    'utf8',
  );
}

test.afterEach(() => {
  resetProcessingQueueForTests();
});

test('POST /retry preserves progress_step so the pipeline resumes instead of re-rendering pages from scratch', async () => {
  setProcessingQueueAdapter(new NoopRecordingAdapter());
  const id = 'retry-keeps-script-ready-01';
  // Simulate the realistic failure: render_pages + extract_text + generate_scripts
  // all succeeded (progress_step advanced to 'script_ready'); the pipeline then
  // failed during TTS synthesis and the PDF was marked 'failed'.
  seedFailedPdf(id, 'script_ready');

  const app = await buildApp();
  try {
    const resp = await app.inject({ method: 'POST', url: `/api/pdfs/${id}/retry`, headers: OWNER_HEADERS });
    assert.equal(resp.statusCode, 202);

    const row = db.prepare(`SELECT status, progress_step, progress_current, progress_total, error_message FROM pdfs WHERE id = ?`).get(id) as {
      status: string;
      progress_step: string | null;
      progress_current: number | null;
      progress_total: number | null;
      error_message: string | null;
    };
    assert.equal(row.status, 'uploaded');
    assert.equal(row.error_message, null);
    // The critical assertion: progress_step must survive the retry so the
    // pipeline's `alreadyRendered` / `alreadyTextDone` resume checks see
    // that rendering + text extraction + script generation already
    // completed, and skip straight to TTS instead of re-rendering every
    // page (which would mint brand-new page_uids via nanoid() and orphan
    // the already-generated script files, forcing a full, costly LLM
    // re-generation of every page's script).
    assert.equal(row.progress_step, 'script_ready');
    // Displayed progress counters are still reset — they get repopulated as
    // soon as the resumed pipeline run calls setProgress() again.
    assert.equal(row.progress_current, null);
    assert.equal(row.progress_total, null);

    const meta = JSON.parse(fs.readFileSync(path.join(config.storageRoot, id, 'metadata.json'), 'utf8')) as {
      progress_step: string | null;
    };
    assert.equal(meta.progress_step, 'script_ready');

    // The page-level script files must still be intact and untouched (the
    // bug, if present, doesn't delete them directly — but a real pipeline
    // resume run would overwrite them with fresh LLM output because the
    // re-rendered pages would carry new page_uids that don't match these
    // file names).
    for (let i = 1; i <= 3; i++) {
      const uid = `rtprg${id.replace(/-/g, '')}p${i}`;
      const scriptPath = path.join(config.storageRoot, id, 'pages', `${uid}.script.txt`);
      assert.ok(fs.existsSync(scriptPath), `script file for page ${i} should still exist untouched`);
    }
  } finally {
    await app.close();
  }
});

test('POST /retry leaves progress_step at null when the pipeline never completed any stage', async () => {
  setProcessingQueueAdapter(new NoopRecordingAdapter());
  const id = 'retry-keeps-null-progress-01';
  // A PDF that failed before reaching any "stage complete" checkpoint
  // (progress_step was never set) should retry exactly as before: starting
  // again from render_pages, since there is nothing to resume.
  seedFailedPdf(id, null);

  const app = await buildApp();
  try {
    const resp = await app.inject({ method: 'POST', url: `/api/pdfs/${id}/retry`, headers: OWNER_HEADERS });
    assert.equal(resp.statusCode, 202);

    const row = db.prepare(`SELECT status, progress_step FROM pdfs WHERE id = ?`).get(id) as {
      status: string;
      progress_step: string | null;
    };
    assert.equal(row.status, 'uploaded');
    assert.equal(row.progress_step, null);
  } finally {
    await app.close();
  }
});
