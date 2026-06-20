import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db';
import { recoverOrphanedAddPagesPages } from '../src/worker/addPagesFromPrompt';

function nowIso(): string {
  return new Date().toISOString();
}

function seedPdf(pdfId: string, status: 'ready' | 'processing' | 'failed'): void {
  const t = nowIso();
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,progress_step,progress_current,progress_total,error_message,user_prompt,require_script_confirmation,owner_sub,visibility,tts_voice,tts_speed,script_max_chars_per_page,created_at,updated_at)
     VALUES (?,?,?,?,1,NULL,NULL,NULL,NULL,NULL,0,'account-1','private',NULL,NULL,NULL,?,?)`,
  ).run(pdfId, 't', `${pdfId}.pdf`, status, t, t);
}

function seedPage(pdfId: string, pageNumber: number, status: string, errorMessage: string | null = null): void {
  const t = nowIso();
  db.prepare(
    `INSERT INTO pages (pdf_id,page_number,image_path,text_path,script_path,audio_path,audio_duration_seconds,status,error_message,created_at,updated_at)
     VALUES (?,?,NULL,NULL,NULL,NULL,NULL,?,?,?,?)`,
  ).run(pdfId, pageNumber, status, errorMessage, t, t);
}

function pageRow(pdfId: string, pageNumber: number): { status: string; error_message: string | null } {
  return db.prepare(`SELECT status, error_message FROM pages WHERE pdf_id = ? AND page_number = ?`).get(pdfId, pageNumber) as {
    status: string;
    error_message: string | null;
  };
}

test('recoverOrphanedAddPagesPages marks a pending page under a ready PDF as failed', () => {
  seedPdf('orphan-recovery-pending-01', 'ready');
  seedPage('orphan-recovery-pending-01', 1, 'audio_ready');
  seedPage('orphan-recovery-pending-01', 2, 'pending');

  const recovered = recoverOrphanedAddPagesPages();
  assert.ok(recovered >= 1);

  const page1 = pageRow('orphan-recovery-pending-01', 1);
  assert.equal(page1.status, 'audio_ready');

  const page2 = pageRow('orphan-recovery-pending-01', 2);
  assert.equal(page2.status, 'failed');
  assert.match(page2.error_message ?? '', /伺服器重啟而中斷/);
});

test('recoverOrphanedAddPagesPages catches rendered, text_ready, and script_ready orphans too', () => {
  seedPdf('orphan-recovery-midstates-01', 'ready');
  seedPage('orphan-recovery-midstates-01', 1, 'rendered');
  seedPage('orphan-recovery-midstates-01', 2, 'text_ready');
  seedPage('orphan-recovery-midstates-01', 3, 'script_ready');

  recoverOrphanedAddPagesPages();

  for (const n of [1, 2, 3]) {
    assert.equal(pageRow('orphan-recovery-midstates-01', n).status, 'failed');
  }
});

test('recoverOrphanedAddPagesPages does not touch a PDF that is still legitimately processing', () => {
  seedPdf('orphan-recovery-processing-01', 'processing');
  seedPage('orphan-recovery-processing-01', 1, 'pending');

  recoverOrphanedAddPagesPages();

  assert.equal(pageRow('orphan-recovery-processing-01', 1).status, 'pending');
});

test('recoverOrphanedAddPagesPages does not touch pages that are already terminal', () => {
  seedPdf('orphan-recovery-terminal-01', 'ready');
  seedPage('orphan-recovery-terminal-01', 1, 'audio_ready');
  seedPage('orphan-recovery-terminal-01', 2, 'failed', '原本就失敗的錯誤訊息');

  recoverOrphanedAddPagesPages();

  assert.equal(pageRow('orphan-recovery-terminal-01', 1).status, 'audio_ready');
  const page2 = pageRow('orphan-recovery-terminal-01', 2);
  assert.equal(page2.status, 'failed');
  assert.equal(page2.error_message, '原本就失敗的錯誤訊息');
});

test('recoverOrphanedAddPagesPages is a no-op (returns 0) when there is nothing to recover', () => {
  seedPdf('orphan-recovery-clean-01', 'ready');
  seedPage('orphan-recovery-clean-01', 1, 'audio_ready');

  const before = pageRow('orphan-recovery-clean-01', 1);
  recoverOrphanedAddPagesPages();
  const after = pageRow('orphan-recovery-clean-01', 1);
  assert.deepEqual(after, before);
});
