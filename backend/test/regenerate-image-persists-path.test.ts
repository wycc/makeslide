import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';
import { setOpenAIClientForTest } from '../src/services/openai';

setSystemAuthSettings({ googleAuthEnabled: false });

const ONE_PIXEL_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

function nowIso(): string {
  return new Date().toISOString();
}

function cleanup(pdfId: string): void {
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  db.prepare(`DELETE FROM regenerate_jobs WHERE pdf_id = ?`).run(pdfId);
  fs.rmSync(path.join(config.storageRoot, pdfId), { recursive: true, force: true });
}

test('regenerate (images) sets pages.image_path for a page that had no image yet', async () => {
  // Mirrors Uhga6bY0Bm pages 43/44: a recovered page with image_path NULL and no image file.
  // The image step must persist image_path so the regenerated image is actually visible.
  const pdfId = 'test-regen-persist-image-path-01';
  cleanup(pdfId);
  const t = nowIso();
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,owner_sub,visibility,created_at,updated_at)
     VALUES (?,?,?,'ready',1,NULL,'private',?,?)`,
  ).run(pdfId, 't', 't.pdf', t, t);

  const pageUid = 'persistpathu1';
  const pagesDir = path.join(config.storageRoot, pdfId, 'pages');
  fs.mkdirSync(pagesDir, { recursive: true });
  fs.writeFileSync(path.join(pagesDir, `${pageUid}.text.txt`), '本頁說明矩陣與向量', 'utf8');
  fs.writeFileSync(path.join(pagesDir, `${pageUid}.script.txt`), '矩陣乘法的逐字稿', 'utf8');
  // Deliberately: image_path NULL and no image file on disk.
  db.prepare(
    `INSERT INTO pages (pdf_id,page_number,page_uid,image_path,text_path,script_path,audio_path,audio_duration_seconds,status,error_message,created_at,updated_at)
     VALUES (?,1,?,NULL,?,?,NULL,NULL,'audio_ready',NULL,?,?)`,
  ).run(pdfId, pageUid, `pages/${pageUid}.text.txt`, `pages/${pageUid}.script.txt`, t, t);

  setOpenAIClientForTest({
    images: {
      edit: async () => ({ data: [{ b64_json: ONE_PIXEL_PNG_B64 }] }),
      generate: async () => ({ data: [{ b64_json: ONE_PIXEL_PNG_B64 }] }),
    },
  } as never);

  const app = await buildApp();
  try {
    const started = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${pdfId}/regenerate`,
      payload: { images: { prompt: '畫一張投影片' } },
    });
    assert.equal(started.statusCode, 202);

    let finalStatus = '';
    for (let i = 0; i < 80; i++) {
      const status = await app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}/regenerate/status` });
      finalStatus = status.json().status;
      if (finalStatus === 'completed' || finalStatus === 'failed') break;
      await new Promise((r) => setTimeout(r, 25));
    }
    assert.equal(finalStatus, 'completed');

    const row = db
      .prepare(`SELECT image_path FROM pages WHERE pdf_id = ? AND page_number = 1`)
      .get(pdfId) as { image_path: string | null };
    assert.equal(row.image_path, `pages/${pageUid}.jpg`, 'image_path must be persisted to the DB');
    assert.ok(
      fs.existsSync(path.join(pagesDir, `${pageUid}.jpg`)),
      'the generated image file should exist on disk',
    );
  } finally {
    setOpenAIClientForTest(null);
    await app.close();
    cleanup(pdfId);
  }
});
