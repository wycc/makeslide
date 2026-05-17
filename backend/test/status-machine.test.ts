import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db';
import {
  PAGE_STATUSES,
  PDF_STATUSES,
  PROGRESS_STEPS,
  assertPageStatusTransition,
  assertPdfStatusTransition,
  canTransitionPageStatus,
  canTransitionPdfStatus,
  isPageStatus,
  isPdfStatus,
  isProgressStep,
} from '../src/statusMachine';

test('PDF status single source exposes the complete lifecycle', () => {
  assert.deepEqual(PDF_STATUSES, [
    'awaiting_prompt',
    'uploaded',
    'processing',
    'awaiting_script_confirmation',
    'ready',
    'failed',
  ]);
  assert.equal(isPdfStatus('processing'), true);
  assert.equal(isPdfStatus('cancelled'), false);
});

test('page status and progress step single sources expose valid values', () => {
  assert.deepEqual(PAGE_STATUSES, [
    'pending',
    'rendered',
    'text_ready',
    'script_ready',
    'audio_ready',
    'failed',
  ]);
  assert.equal(isPageStatus('audio_ready'), true);
  assert.equal(isPageStatus('ready'), false);

  assert.deepEqual(PROGRESS_STEPS, [
    'rendering',
    'extracting_text',
    'text_extracted',
    'scripting',
    'script_ready',
    'synthesizing',
    'rendering_video',
  ]);
  assert.equal(isProgressStep(null), true);
  assert.equal(isProgressStep('rendering_video'), true);
  assert.equal(isProgressStep('audio_ready'), false);
});

test('PDF transition rules allow pipeline and retry paths but reject impossible jumps', () => {
  assert.equal(canTransitionPdfStatus('awaiting_prompt', 'uploaded'), true);
  assert.equal(canTransitionPdfStatus('uploaded', 'processing'), true);
  assert.equal(canTransitionPdfStatus('processing', 'awaiting_script_confirmation'), true);
  assert.equal(canTransitionPdfStatus('awaiting_script_confirmation', 'processing'), true);
  assert.equal(canTransitionPdfStatus('processing', 'ready'), true);
  assert.equal(canTransitionPdfStatus('failed', 'uploaded'), true);

  assert.equal(canTransitionPdfStatus('awaiting_prompt', 'ready'), false);
  assert.throws(
    () => assertPdfStatusTransition('awaiting_prompt', 'ready'),
    /Invalid PDF status transition: awaiting_prompt -> ready/,
  );
});

test('page transition rules allow artifact progression and regeneration paths', () => {
  assert.equal(canTransitionPageStatus('pending', 'rendered'), true);
  assert.equal(canTransitionPageStatus('rendered', 'text_ready'), true);
  assert.equal(canTransitionPageStatus('text_ready', 'script_ready'), true);
  assert.equal(canTransitionPageStatus('script_ready', 'audio_ready'), true);
  assert.equal(canTransitionPageStatus('audio_ready', 'script_ready'), true);
  assert.equal(canTransitionPageStatus('failed', 'pending'), true);

  assert.equal(canTransitionPageStatus('rendered', 'pending'), false);
  assert.throws(
    () => assertPageStatusTransition('rendered', 'pending'),
    /Invalid page status transition: rendered -> pending/,
  );
});

test('database migration normalizes statuses using the single source lists', () => {
  const now = new Date().toISOString();
  const pdfId = `status-machine-${Date.now()}`;
  db.prepare(
    `INSERT INTO pdfs (id, title, original_filename, status, page_count, error_message, created_at, updated_at)
     VALUES (?, NULL, ?, 'legacy_unknown', NULL, NULL, ?, ?)`,
  ).run(pdfId, 'legacy.pdf', now, now);
  db.prepare(
    `INSERT INTO pages (pdf_id, page_number, image_path, text_path, script_path, audio_path, status, error_message, created_at, updated_at)
     VALUES (?, 1, NULL, NULL, NULL, NULL, 'legacy_page_unknown', NULL, ?, ?)`,
  ).run(pdfId, now, now);

  const pdfPlaceholders = PDF_STATUSES.map(() => '?').join(', ');
  const pagePlaceholders = PAGE_STATUSES.map(() => '?').join(', ');
  db.prepare(
    `UPDATE pdfs
        SET status = 'failed',
            error_message = COALESCE(error_message, 'Invalid lifecycle status normalized during migration'),
            updated_at = ?
      WHERE status NOT IN (${pdfPlaceholders})`,
  ).run(now, ...PDF_STATUSES);
  db.prepare(
    `UPDATE pages
        SET status = 'failed',
            error_message = COALESCE(error_message, 'Invalid lifecycle status normalized during migration'),
            updated_at = ?
      WHERE status NOT IN (${pagePlaceholders})`,
  ).run(now, ...PAGE_STATUSES);

  const pdf = db.prepare(`SELECT status, error_message FROM pdfs WHERE id = ?`).get(pdfId) as {
    status: string;
    error_message: string | null;
  };
  const page = db.prepare(`SELECT status, error_message FROM pages WHERE pdf_id = ?`).get(pdfId) as {
    status: string;
    error_message: string | null;
  };

  assert.equal(pdf.status, 'failed');
  assert.equal(pdf.error_message, 'Invalid lifecycle status normalized during migration');
  assert.equal(page.status, 'failed');
  assert.equal(page.error_message, 'Invalid lifecycle status normalized during migration');

  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
});
