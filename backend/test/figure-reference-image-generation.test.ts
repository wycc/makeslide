import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';
import { setOpenAIClientForTest } from '../src/services/openai';
import { saveFigureSelection } from '../src/services/pdfFigures';

setSystemAuthSettings({ googleAuthEnabled: false });

const ONE_PIXEL_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

function nowIso(): string {
  return new Date().toISOString();
}

/** Writes a `figures.json` + reference PNG for page 1 with a caption, so getFigureReferencesForPage finds it. */
function seedFigureManifest(pdfId: string): void {
  const pdfDir = path.join(config.storageRoot, pdfId);
  const figuresDir = path.join(pdfDir, 'figures');
  fs.mkdirSync(figuresDir, { recursive: true });
  fs.writeFileSync(path.join(figuresDir, 'p1-img1.png'), Buffer.from([137, 80, 78, 71]));
  fs.writeFileSync(
    path.join(pdfDir, 'figures.json'),
    JSON.stringify({
      pdfId,
      generatedAt: nowIso(),
      pages: [
        {
          pageNumber: 1,
          figures: [
            {
              id: 'p1-img1',
              imagePath: 'figures/p1-img1.png',
              width: 100,
              height: 100,
              bbox: { xPct: 0.1, yPct: 0.1, widthPct: 0.5, heightPct: 0.5 },
              caption: 'Figure 1: 營收成長趨勢',
              context: 'Figure 1: 營收成長趨勢，2020-2025',
            },
          ],
        },
      ],
    }),
    'utf8',
  );
}

function cleanup(pdfId: string): void {
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  fs.rmSync(path.join(config.storageRoot, pdfId), { recursive: true, force: true });
}

test('POST /pages/:n/regenerate-image attaches extracted figure as reference image + notes', async () => {
  const pdfId = 'test-figure-ref-regen-image-01';
  cleanup(pdfId);
  const t = nowIso();
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,progress_step,progress_current,progress_total,error_message,user_prompt,require_script_confirmation,tts_voice,tts_speed,script_max_chars_per_page,created_at,updated_at)
     VALUES (?,?,?,'ready',1,NULL,NULL,NULL,NULL,NULL,0,NULL,NULL,NULL,?,?)`,
  ).run(pdfId, 't', 't.pdf', t, t);

  const pdfDir = path.join(config.storageRoot, pdfId);
  const pagesDir = path.join(pdfDir, 'pages');
  fs.mkdirSync(pagesDir, { recursive: true });
  db.prepare(
    `INSERT INTO pages (pdf_id,page_number,image_path,text_path,script_path,audio_path,audio_duration_seconds,status,error_message,created_at,updated_at)
     VALUES (?,1,?,?,?,NULL,NULL,'audio_ready',NULL,?,?)`,
  ).run(pdfId, 'pages/001.png', 'pages/001.text.txt', 'pages/001.script.txt', t, t);
  fs.writeFileSync(path.join(pagesDir, '001.png'), Buffer.from([137, 80, 78, 71]));
  fs.writeFileSync(path.join(pagesDir, '001.text.txt'), '本頁說明營收成長', 'utf8');
  fs.writeFileSync(path.join(pagesDir, '001.script.txt'), '營收成長逐字稿', 'utf8');
  seedFigureManifest(pdfId);

  const calls: Array<{ image: unknown; prompt: string }> = [];
  setOpenAIClientForTest({
    images: {
      edit: async (body: { image: unknown; prompt: string }) => {
        calls.push({ image: body.image, prompt: body.prompt });
        return { data: [{ b64_json: ONE_PIXEL_PNG_B64 }] };
      },
    },
  } as never);

  const app = await buildApp();
  try {
    const resp = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${pdfId}/pages/1/regenerate-image`,
      payload: { prompt: '改成更活潑的風格' },
    });
    assert.equal(resp.statusCode, 200);
    assert.equal(calls.length, 1);
    const { image, prompt } = calls[0]!;
    assert.ok(Array.isArray(image));
    assert.equal((image as unknown[]).length, 2);
    assert.match(prompt, /本頁對應的原始 PDF 內含以下圖表/);
    assert.match(prompt, /參考圖表 1：Figure 1: 營收成長趨勢/);
  } finally {
    setOpenAIClientForTest(null);
    await app.close();
    cleanup(pdfId);
  }
});

test('POST /pages/:n/regenerate-image omits a figure the user excluded via the figure-asset browser', async () => {
  const pdfId = 'test-figure-ref-excluded-01';
  cleanup(pdfId);
  const t = nowIso();
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,progress_step,progress_current,progress_total,error_message,user_prompt,require_script_confirmation,tts_voice,tts_speed,script_max_chars_per_page,created_at,updated_at)
     VALUES (?,?,?,'ready',1,NULL,NULL,NULL,NULL,NULL,0,NULL,NULL,NULL,?,?)`,
  ).run(pdfId, 't', 't.pdf', t, t);

  const pdfDir = path.join(config.storageRoot, pdfId);
  const pagesDir = path.join(pdfDir, 'pages');
  fs.mkdirSync(pagesDir, { recursive: true });
  const pageUid = 'figexcluid1';
  db.prepare(
    `INSERT INTO pages (pdf_id,page_number,page_uid,image_path,text_path,script_path,audio_path,audio_duration_seconds,status,error_message,created_at,updated_at)
     VALUES (?,1,?,?,?,?,NULL,NULL,'audio_ready',NULL,?,?)`,
  ).run(pdfId, pageUid, `pages/${pageUid}.jpg`, `pages/${pageUid}.text.txt`, `pages/${pageUid}.script.txt`, t, t);
  fs.writeFileSync(path.join(pagesDir, `${pageUid}.jpg`), Buffer.from([0xff, 0xd8, 0xff]));
  fs.writeFileSync(path.join(pagesDir, `${pageUid}.text.txt`), '本頁說明營收成長', 'utf8');
  fs.writeFileSync(path.join(pagesDir, `${pageUid}.script.txt`), '營收成長逐字稿', 'utf8');
  seedFigureManifest(pdfId);
  saveFigureSelection(pdfId, pageUid, { excluded: ['p1-img1'] });

  const calls: Array<{ image: unknown; prompt: string }> = [];
  setOpenAIClientForTest({
    images: {
      edit: async (body: { image: unknown; prompt: string }) => {
        calls.push({ image: body.image, prompt: body.prompt });
        return { data: [{ b64_json: ONE_PIXEL_PNG_B64 }] };
      },
    },
  } as never);

  const app = await buildApp();
  try {
    const resp = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${pdfId}/pages/1/regenerate-image`,
      payload: { prompt: '改成更活潑的風格' },
    });
    assert.equal(resp.statusCode, 200);
    assert.equal(calls.length, 1);
    const { image, prompt } = calls[0]!;
    // The excluded figure leaves no reference images attached, so `image` is the bare page image (not an array).
    assert.ok(!Array.isArray(image));
    assert.doesNotMatch(prompt, /本頁對應的原始 PDF 內含以下圖表/);
    assert.doesNotMatch(prompt, /參考圖表 1：Figure 1: 營收成長趨勢/);
  } finally {
    setOpenAIClientForTest(null);
    await app.close();
    cleanup(pdfId);
  }
});

test('regenerate job (images) attaches extracted figure as reference image + notes', async () => {
  const pdfId = 'test-figure-ref-regen-job-01';
  cleanup(pdfId);
  const t = nowIso();
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,progress_step,progress_current,progress_total,error_message,user_prompt,require_script_confirmation,owner_sub,tts_voice,tts_speed,script_max_chars_per_page,created_at,updated_at)
     VALUES (?,?,?,'ready',1,NULL,NULL,NULL,NULL,NULL,0,NULL,NULL,NULL,NULL,?,?)`,
  ).run(pdfId, 't', 't.pdf', t, t);

  const pdfDir = path.join(config.storageRoot, pdfId);
  const pagesDir = path.join(pdfDir, 'pages');
  fs.mkdirSync(pagesDir, { recursive: true });
  const pageUid = 'regenuid1';
  db.prepare(
    `INSERT INTO pages (pdf_id,page_number,page_uid,image_path,text_path,script_path,audio_path,audio_duration_seconds,status,error_message,created_at,updated_at)
     VALUES (?,1,?,?,?,?,NULL,NULL,'audio_ready',NULL,?,?)`,
  ).run(pdfId, pageUid, `pages/${pageUid}.jpg`, `pages/${pageUid}.text.txt`, `pages/${pageUid}.script.txt`, t, t);
  fs.writeFileSync(path.join(pagesDir, `${pageUid}.jpg`), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  fs.writeFileSync(path.join(pagesDir, `${pageUid}.text.txt`), '本頁說明營收成長', 'utf8');
  fs.writeFileSync(path.join(pagesDir, `${pageUid}.script.txt`), '營收成長逐字稿', 'utf8');
  seedFigureManifest(pdfId);

  const calls: Array<{ image: unknown; prompt: string }> = [];
  setOpenAIClientForTest({
    images: {
      edit: async (body: { image: unknown; prompt: string }) => {
        calls.push({ image: body.image, prompt: body.prompt });
        return { data: [{ b64_json: ONE_PIXEL_PNG_B64 }] };
      },
    },
  } as never);

  const app = await buildApp();
  try {
    const started = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${pdfId}/regenerate`,
      payload: { images: { prompt: '改成更活潑的風格' } },
    });
    assert.equal(started.statusCode, 202);

    let finalStatus = '';
    for (let i = 0; i < 60; i++) {
      const status = await app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}/regenerate/status` });
      finalStatus = status.json().status;
      if (finalStatus === 'completed' || finalStatus === 'failed') break;
      await new Promise((r) => setTimeout(r, 25));
    }
    assert.equal(finalStatus, 'completed');

    assert.equal(calls.length, 1);
    const { image, prompt } = calls[0]!;
    assert.ok(Array.isArray(image));
    assert.equal((image as unknown[]).length, 2);
    assert.match(prompt, /本頁對應的原始 PDF 內含以下圖表/);
    assert.match(prompt, /參考圖表 1：Figure 1: 營收成長趨勢/);
  } finally {
    setOpenAIClientForTest(null);
    await app.close();
    cleanup(pdfId);
  }
});
