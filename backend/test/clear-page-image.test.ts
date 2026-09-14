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

function pagesDirOf(pdfId: string): string {
  return path.join(config.storageRoot, pdfId, 'pages');
}

/** A page that has a real picture on disk (plus thumbnail, base image and deck cover). */
function seedPageWithImage(pdfId: string, pageUid: string, renderType: 'image' | 'react' = 'image'): Buffer {
  const t = nowIso();
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,owner_sub,visibility,created_at,updated_at)
     VALUES (?,?,?,'ready',1,NULL,'private',?,?)`,
  ).run(pdfId, 't', 't.pdf', t, t);

  const pagesDir = pagesDirOf(pdfId);
  fs.mkdirSync(pagesDir, { recursive: true });
  const image = Buffer.from(ONE_PIXEL_PNG_B64, 'base64');
  fs.writeFileSync(path.join(pagesDir, `${pageUid}.jpg`), image);
  fs.writeFileSync(path.join(pagesDir, `${pageUid}.thumb.jpg`), image);
  fs.writeFileSync(path.join(pagesDir, `${pageUid}.base.jpg`), image);
  fs.writeFileSync(path.join(config.storageRoot, pdfId, 'cover.jpg'), image);
  fs.writeFileSync(path.join(config.storageRoot, pdfId, 'cover.thumb.jpg'), image);
  fs.writeFileSync(path.join(pagesDir, `${pageUid}.text.txt`), '本頁說明矩陣與向量的線性組合', 'utf8');
  fs.writeFileSync(path.join(pagesDir, `${pageUid}.script.txt`), '矩陣乘法可視為列向量的線性組合', 'utf8');

  db.prepare(
    `INSERT INTO pages (pdf_id,page_number,page_uid,image_path,text_path,script_path,audio_path,audio_duration_seconds,status,error_message,render_type,created_at,updated_at)
     VALUES (?,1,?,?,?,?,NULL,NULL,'audio_ready',NULL,?,?,?)`,
  ).run(
    pdfId,
    pageUid,
    `pages/${pageUid}.jpg`,
    `pages/${pageUid}.text.txt`,
    `pages/${pageUid}.script.txt`,
    renderType,
    t,
    t,
  );
  return image;
}

function cleanup(pdfId: string): void {
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  fs.rmSync(path.join(config.storageRoot, pdfId), { recursive: true, force: true });
}

function imagePathOf(pdfId: string): string | null {
  const row = db.prepare(`SELECT image_path FROM pages WHERE pdf_id = ? AND page_number = 1`).get(pdfId) as
    | { image_path: string | null }
    | undefined;
  return row?.image_path ?? null;
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

test('POST /pages/:n/clear-image removes the picture, its thumbnail, base image and cover', async () => {
  const pdfId = 'test-clear-image-01';
  const pageUid = 'clearuid1';
  seedPageWithImage(pdfId, pageUid);

  const app = await buildApp();
  try {
    const resp = await app.inject({ method: 'POST', url: `/api/pdfs/${pdfId}/pages/1/clear-image` });
    assert.equal(resp.statusCode, 200);
    const body = resp.json() as { cleared: boolean; candidate_id: string | null; candidate_image_url: string | null };
    assert.equal(body.cleared, true);

    const pagesDir = pagesDirOf(pdfId);
    assert.equal(fs.existsSync(path.join(pagesDir, `${pageUid}.jpg`)), false, 'page image is gone');
    assert.equal(fs.existsSync(path.join(pagesDir, `${pageUid}.thumb.jpg`)), false, 'thumbnail is gone');
    assert.equal(fs.existsSync(path.join(pagesDir, `${pageUid}.base.jpg`)), false, 'base image is gone');
    // Page 1's picture is also the deck cover.
    assert.equal(fs.existsSync(path.join(config.storageRoot, pdfId, 'cover.jpg')), false, 'cover is gone');
    assert.equal(fs.existsSync(path.join(config.storageRoot, pdfId, 'cover.thumb.jpg')), false, 'cover thumb is gone');
    // image_path NULL is what makes the detail API report the page as having no image.
    assert.equal(imagePathOf(pdfId), null);
    // The transcript and slide text are the page's content, not its drawing — they must survive.
    assert.equal(fs.existsSync(path.join(pagesDir, `${pageUid}.script.txt`)), true);
  } finally {
    setOpenAIClientForTest(null);
    await app.close();
    cleanup(pdfId);
  }
});

test('POST /pages/:n/clear-image keeps the old picture as an image candidate that can be served back', async () => {
  const pdfId = 'test-clear-image-candidate-01';
  const original = seedPageWithImage(pdfId, 'clearuid2');

  const app = await buildApp();
  try {
    const resp = await app.inject({ method: 'POST', url: `/api/pdfs/${pdfId}/pages/1/clear-image` });
    assert.equal(resp.statusCode, 200);
    const body = resp.json() as { candidate_id: string | null; candidate_image_url: string | null };
    assert.ok(body.candidate_id, 'a candidate id is returned so the UI can offer the picture back');
    assert.equal(body.candidate_image_url, `api/pdfs/${pdfId}/pages/1/image-candidates/${body.candidate_id}`);

    const fetched = await app.inject({ method: 'GET', url: `/${body.candidate_image_url}` });
    assert.equal(fetched.statusCode, 200);
    assert.deepEqual(fetched.rawPayload, original, 'the candidate is the picture that was cleared, byte for byte');
  } finally {
    await app.close();
    cleanup(pdfId);
  }
});

test('after clear-image, regenerate-image draws from scratch instead of editing the old picture', async () => {
  const pdfId = 'test-clear-image-regen-01';
  seedPageWithImage(pdfId, 'clearuid3');
  const calls = mockImagesClient();

  const app = await buildApp();
  try {
    // Before clearing, regeneration edits the existing picture (keeping its layout).
    const before = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${pdfId}/pages/1/regenerate-image`,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: '改成藍色背景' }),
    });
    assert.equal(before.statusCode, 200);
    assert.equal(calls.edit.length, 1, 'with a picture present it edits');
    assert.equal(calls.generate.length, 0);

    const cleared = await app.inject({ method: 'POST', url: `/api/pdfs/${pdfId}/pages/1/clear-image` });
    assert.equal(cleared.statusCode, 200);

    const after = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${pdfId}/pages/1/regenerate-image`,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: '改成藍色背景' }),
    });
    assert.equal(after.statusCode, 200);
    // This is the point of the feature: no base image, so nothing anchors the new drawing.
    assert.equal(calls.edit.length, 1, 'no further edit call');
    assert.equal(calls.generate.length, 1, 'it generates a brand new picture');
  } finally {
    setOpenAIClientForTest(null);
    await app.close();
    cleanup(pdfId);
  }
});

test('POST /pages/:n/clear-image on an already-cleared page succeeds and reports nothing to clear', async () => {
  const pdfId = 'test-clear-image-idempotent-01';
  seedPageWithImage(pdfId, 'clearuid4');

  const app = await buildApp();
  try {
    assert.equal((await app.inject({ method: 'POST', url: `/api/pdfs/${pdfId}/pages/1/clear-image` })).statusCode, 200);
    const second = await app.inject({ method: 'POST', url: `/api/pdfs/${pdfId}/pages/1/clear-image` });
    assert.equal(second.statusCode, 200);
    const body = second.json() as { cleared: boolean; candidate_id: string | null };
    assert.equal(body.cleared, false, 'there was no picture to clear');
    assert.equal(body.candidate_id, null, 'and so no candidate was kept');
  } finally {
    await app.close();
    cleanup(pdfId);
  }
});

test('POST /pages/:n/clear-image refuses on a React page, whose picture is a bake of its code', async () => {
  const pdfId = 'test-clear-image-react-01';
  const pageUid = 'clearuid5';
  seedPageWithImage(pdfId, pageUid, 'react');

  const app = await buildApp();
  try {
    const resp = await app.inject({ method: 'POST', url: `/api/pdfs/${pdfId}/pages/1/clear-image` });
    assert.equal(resp.statusCode, 409);
    assert.match(resp.json().error.message, /React/);
    // Refusing means refusing: the bake is still there and the page still points at it.
    assert.equal(fs.existsSync(path.join(pagesDirOf(pdfId), `${pageUid}.jpg`)), true);
    assert.equal(imagePathOf(pdfId), `pages/${pageUid}.jpg`);
  } finally {
    await app.close();
    cleanup(pdfId);
  }
});

test('POST /pages/:n/clear-image 404s for an unknown page', async () => {
  const pdfId = 'test-clear-image-404-01';
  seedPageWithImage(pdfId, 'clearuid6');

  const app = await buildApp();
  try {
    const resp = await app.inject({ method: 'POST', url: `/api/pdfs/${pdfId}/pages/9/clear-image` });
    assert.equal(resp.statusCode, 404);
  } finally {
    await app.close();
    cleanup(pdfId);
  }
});
