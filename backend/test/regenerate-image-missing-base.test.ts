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

/**
 * Seed a page whose `image_path` is set in the DB but whose image file does NOT exist on
 * disk — the state a half-failed add-pages insert leaves behind (e.g. Uhga6bY0Bm pages
 * 43/44). text/script files are present so the from-scratch prompt has content.
 */
function seedPageWithMissingImage(pdfId: string, pageUid: string): void {
  const t = nowIso();
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,owner_sub,visibility,created_at,updated_at)
     VALUES (?,?,?,'ready',1,NULL,'private',?,?)`,
  ).run(pdfId, 't', 't.pdf', t, t);

  const pagesDir = path.join(config.storageRoot, pdfId, 'pages');
  fs.mkdirSync(pagesDir, { recursive: true });
  // Note: NO `${pageUid}.jpg` is written — the base image is intentionally absent.
  fs.writeFileSync(path.join(pagesDir, `${pageUid}.text.txt`), '本頁說明矩陣與向量的線性組合', 'utf8');
  fs.writeFileSync(path.join(pagesDir, `${pageUid}.script.txt`), '矩陣乘法可視為列向量的線性組合', 'utf8');

  db.prepare(
    `INSERT INTO pages (pdf_id,page_number,page_uid,image_path,text_path,script_path,audio_path,audio_duration_seconds,status,error_message,created_at,updated_at)
     VALUES (?,1,?,?,?,?,NULL,NULL,'audio_ready',NULL,?,?)`,
  ).run(pdfId, pageUid, `pages/${pageUid}.jpg`, `pages/${pageUid}.text.txt`, `pages/${pageUid}.script.txt`, t, t);
}

function cleanup(pdfId: string): void {
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  fs.rmSync(path.join(config.storageRoot, pdfId), { recursive: true, force: true });
}

interface MockImageCalls {
  edit: string[];
  generate: string[];
}

function mockImagesClient(): MockImageCalls {
  const calls: MockImageCalls = { edit: [], generate: [] };
  setOpenAIClientForTest({
    images: {
      edit: async (body: { prompt: string }) => {
        calls.edit.push(body.prompt);
        return { data: [{ b64_json: ONE_PIXEL_PNG_B64 }] };
      },
      generate: async (body: { prompt: string }) => {
        calls.generate.push(body.prompt);
        return { data: [{ b64_json: ONE_PIXEL_PNG_B64 }] };
      },
    },
  } as never);
  return calls;
}

test('POST /pages/:n/regenerate-image generates from scratch when the base image file is missing', async () => {
  const pdfId = 'test-regen-missing-base-route-01';
  seedPageWithMissingImage(pdfId, 'missbaseuid1');
  const calls = mockImagesClient();

  const app = await buildApp();
  try {
    const resp = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${pdfId}/pages/1/regenerate-image`,
      payload: { prompt: '畫一張說明線性組合的投影片' },
    });
    assert.equal(resp.statusCode, 200);
    // No base image and no figures => pure text->image generation, not an edit.
    assert.equal(calls.edit.length, 0, 'images.edit must not be called without a base image');
    assert.equal(calls.generate.length, 1, 'images.generate should be used as the fallback');
  } finally {
    setOpenAIClientForTest(null);
    await app.close();
    cleanup(pdfId);
  }
});

test('regenerate job (images) generates from scratch when the base image file is missing', async () => {
  const pdfId = 'test-regen-missing-base-job-01';
  seedPageWithMissingImage(pdfId, 'missbaseuid2');
  const calls = mockImagesClient();

  const app = await buildApp();
  try {
    const started = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${pdfId}/regenerate`,
      payload: { images: { prompt: '畫一張說明線性組合的投影片' } },
    });
    assert.equal(started.statusCode, 202);

    let finalStatus = '';
    for (let i = 0; i < 80; i++) {
      const status = await app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}/regenerate/status` });
      finalStatus = status.json().status;
      if (finalStatus === 'completed' || finalStatus === 'failed') break;
      await new Promise((r) => setTimeout(r, 25));
    }
    assert.equal(finalStatus, 'completed', 'job must complete instead of failing with ENOENT');
    assert.equal(calls.edit.length, 0, 'images.edit must not be called without a base image');
    assert.equal(calls.generate.length, 1, 'images.generate should be used as the fallback');

    // The freshly generated image file should now exist on disk.
    assert.ok(
      fs.existsSync(path.join(config.storageRoot, pdfId, 'pages', 'missbaseuid2.jpg')),
      'generated image should be written to disk',
    );
  } finally {
    setOpenAIClientForTest(null);
    await app.close();
    cleanup(pdfId);
  }
});
