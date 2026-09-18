import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../src/db';
import { config } from '../src/config';
import { PPTX_IMPORT_STALE_MS, rescanPendingOnStartup } from '../src/worker/pipeline';

/**
 * A pptx import is not a pipeline job. It has no source.pdf, no prompt, and its progress lives in
 * memory (routes/pdfs/pptx-import.ts) — so the startup rescan, which re-enqueues everything left
 * `processing` by a restart, must not hand it to the PDF pipeline. It did: the first real import
 * on the dev host came back with "Source PDF missing" on the deck.
 */
function seedDeck(pdfId: string, status: string, sourceKind: string, updatedAgoMs = 0): void {
  const t = new Date(Date.now() - updatedAgoMs).toISOString();
  db.prepare(`DELETE FROM pdf_sources WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,owner_sub,visibility,user_prompt,created_at,updated_at)
     VALUES (?,?,?,?,0,NULL,'private','a style',?,?)`,
  ).run(pdfId, 'deck', `deck.${sourceKind}`, status, t, t);
  db.prepare(
    `INSERT INTO pdf_sources (pdf_id, source_kind, source_name, content_text, created_at, updated_at)
     VALUES (?,?,?,'',?,?)`,
  ).run(pdfId, sourceKind, `deck.${sourceKind}`, t, t);
  fs.mkdirSync(path.join(config.storageRoot, pdfId), { recursive: true });
}

function cleanup(pdfId: string): void {
  db.prepare(`DELETE FROM pdf_sources WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  fs.rmSync(path.join(config.storageRoot, pdfId), { recursive: true, force: true });
}

function statusOf(pdfId: string): { status: string; error_message: string | null } {
  return db.prepare(`SELECT status, error_message FROM pdfs WHERE id = ?`).get(pdfId) as {
    status: string;
    error_message: string | null;
  };
}

test('an import interrupted by a restart fails with what happened, not with "source PDF missing"', () => {
  const pdfId = 'pptx-restart-interrupted-01';
  // Interrupted means its heartbeat stopped. A row updated just now is a running import — failing
  // that one is the bug pptx-import-stale-sweep.test.ts pins.
  seedDeck(pdfId, 'processing', 'pptx', PPTX_IMPORT_STALE_MS + 60_000);
  try {
    rescanPendingOnStartup();
    const row = statusOf(pdfId);
    assert.equal(row.status, 'failed', 'it is not left running forever, since its job is gone');
    assert.match(row.error_message ?? '', /PPTX/, 'and the message says what actually happened');
    assert.doesNotMatch(row.error_message ?? '', /Source PDF/i);
  } finally {
    cleanup(pdfId);
  }
});

test('a finished import is untouched by the rescan', () => {
  const pdfId = 'pptx-restart-ready-01';
  seedDeck(pdfId, 'ready', 'pptx');
  try {
    rescanPendingOnStartup();
    assert.deepEqual(statusOf(pdfId), { status: 'ready', error_message: null });
  } finally {
    cleanup(pdfId);
  }
});

test('an ordinary PDF left mid-pipeline is still re-enqueued', () => {
  const pdfId = 'pptx-restart-pdf-01';
  seedDeck(pdfId, 'processing', 'pdf');
  try {
    rescanPendingOnStartup();
    const row = statusOf(pdfId);
    // The pipeline owns this one: the rescan must leave it alone to be picked up and resumed,
    // not fail it.
    assert.equal(row.status, 'processing');
    assert.equal(row.error_message, null);
  } finally {
    cleanup(pdfId);
  }
});
