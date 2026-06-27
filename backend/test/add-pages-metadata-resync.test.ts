import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../src/db';
import { config } from '../src/config';
import { readMetadata, writeMetadata } from '../src/services/storage';
import { rebuildAddPagesMetadataFromDb } from '../src/worker/addPagesFromPrompt';

function nowIso(): string {
  return new Date().toISOString();
}

interface SeedPage {
  page_number: number;
  page_uid: string;
  image_path?: string | null;
  script_path?: string | null;
  audio_path?: string | null;
  audio_duration_seconds?: number | null;
  status: string;
}

function seed(pdfId: string, pageCount: number, pages: SeedPage[]): void {
  const t = nowIso();
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,owner_sub,visibility,created_at,updated_at)
     VALUES (?,?,?,'ready',?,'account-1','private',?,?)`,
  ).run(pdfId, 't', `${pdfId}.pdf`, pageCount, t, t);
  for (const p of pages) {
    db.prepare(
      `INSERT INTO pages (pdf_id,page_number,page_uid,image_path,text_path,script_path,audio_path,audio_duration_seconds,status,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      pdfId,
      p.page_number,
      p.page_uid,
      p.image_path ?? null,
      `pages/${p.page_uid}.text.txt`,
      p.script_path ?? null,
      p.audio_path ?? null,
      p.audio_duration_seconds ?? null,
      p.status,
      t,
      t,
    );
  }
}

function cleanup(pdfId: string): void {
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  fs.rmSync(path.join(config.storageRoot, pdfId), { recursive: true, force: true });
}

test('rebuildAddPagesMetadataFromDb resyncs a stale metadata to the shifted/expanded DB layout', async () => {
  const pdfId = 'add-pages-resync-01';
  // Simulate the post-failure DB state: an add-pages job inserted 1 new page after page 1,
  // shifting the old page 2 -> 3, but failed before rewriting metadata.json.
  seed(pdfId, 3, [
    { page_number: 1, page_uid: 'uid-a', image_path: 'pages/uid-a.jpg', script_path: 'pages/uid-a.script.txt', audio_path: 'pages/uid-a.m4a', audio_duration_seconds: 12.5, status: 'audio_ready' },
    { page_number: 2, page_uid: 'uid-new', image_path: null, status: 'failed' }, // the half-built inserted page
    { page_number: 3, page_uid: 'uid-b', image_path: 'pages/uid-b.jpg', script_path: 'pages/uid-b.script.txt', audio_path: 'pages/uid-b.m4a', audio_duration_seconds: 8, status: 'audio_ready' },
  ]);

  // Stale on-disk metadata still describes the *old* 2-page layout.
  fs.mkdirSync(path.join(config.storageRoot, pdfId), { recursive: true });
  await writeMetadata(pdfId, {
    id: pdfId,
    title: 't',
    page_count: 2,
    status: 'ready',
    pages: [
      { page_number: 1, image: 'pages/uid-a.jpg', text: 'pages/uid-a.text.txt', status: 'audio_ready' },
      { page_number: 2, image: 'pages/uid-b.jpg', text: 'pages/uid-b.text.txt', status: 'audio_ready' },
    ],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  try {
    await rebuildAddPagesMetadataFromDb(pdfId);

    const meta = await readMetadata(pdfId);
    assert.ok(meta);
    assert.equal(meta!.page_count, 3, 'page_count should match DB');
    assert.equal(meta!.pages.length, 3, 'all DB pages should be present in metadata');

    const byNum = new Map(meta!.pages.map((p) => [p.page_number, p]));
    // The failed inserted page is now reflected (no longer hidden behind stale metadata).
    assert.equal(byNum.get(2)?.status, 'failed');
    assert.equal(byNum.get(2)?.image, null);
    // The original page 2 content is correctly at its new position 3.
    assert.equal(byNum.get(3)?.image, 'pages/uid-b.jpg');
    assert.equal(byNum.get(3)?.status, 'audio_ready');
    assert.equal(byNum.get(3)?.audio, 'pages/uid-b.m4a');
    assert.equal(byNum.get(1)?.audio_duration_seconds, 12.5);
  } finally {
    cleanup(pdfId);
  }
});

test('rebuildAddPagesMetadataFromDb is a no-op when the PDF has no metadata.json yet', async () => {
  const pdfId = 'add-pages-resync-nometa-01';
  seed(pdfId, 1, [{ page_number: 1, page_uid: 'uid-x', status: 'audio_ready' }]);
  try {
    // No metadata file written: must not throw.
    await rebuildAddPagesMetadataFromDb(pdfId);
    assert.equal(await readMetadata(pdfId), null);
  } finally {
    cleanup(pdfId);
  }
});
