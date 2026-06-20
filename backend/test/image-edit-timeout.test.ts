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

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64',
);

function nowIso(): string {
  return new Date().toISOString();
}

function seedPage(pdfId: string): void {
  const t = nowIso();
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,progress_step,progress_current,progress_total,error_message,user_prompt,require_script_confirmation,tts_voice,tts_speed,script_max_chars_per_page,created_at,updated_at)
     VALUES (?,?,?,'ready',1,NULL,NULL,NULL,NULL,NULL,0,NULL,NULL,NULL,?,?)`,
  ).run(pdfId, 't', 't.pdf', t, t);
  const pagesDir = path.join(config.storageRoot, pdfId, 'pages');
  fs.mkdirSync(pagesDir, { recursive: true });
  db.prepare(
    `INSERT INTO pages (pdf_id,page_number,image_path,text_path,script_path,audio_path,audio_duration_seconds,status,error_message,created_at,updated_at)
     VALUES (?,1,?,?,?,NULL,NULL,'audio_ready',NULL,?,?)`,
  ).run(pdfId, 'pages/001.png', 'pages/001.text.txt', 'pages/001.script.txt', t, t);
  fs.writeFileSync(path.join(pagesDir, '001.png'), ONE_PIXEL_PNG);
  fs.writeFileSync(path.join(pagesDir, '001.text.txt'), 'text', 'utf8');
  fs.writeFileSync(path.join(pagesDir, '001.script.txt'), 'script', 'utf8');
}

function cleanup(pdfId: string): void {
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  fs.rmSync(path.join(config.storageRoot, pdfId), { recursive: true, force: true });
}

test('POST /pages/:n/regenerate-image passes the configured image timeout to images.edit', async () => {
  const pdfId = 'image-edit-timeout-regen-01';
  seedPage(pdfId);
  const capturedOptions: unknown[] = [];
  setOpenAIClientForTest({
    images: {
      edit: async (_body: unknown, options: unknown) => {
        capturedOptions.push(options);
        return { data: [{ b64_json: ONE_PIXEL_PNG.toString('base64') }] };
      },
    },
  } as never);

  const app = await buildApp();
  try {
    const resp = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${pdfId}/pages/1/regenerate-image`,
      payload: { prompt: 'make it brighter' },
    });
    assert.equal(resp.statusCode, 200);
    assert.equal(capturedOptions.length, 1);
    assert.deepEqual(capturedOptions[0], { timeout: config.openaiImageTimeoutMs });
  } finally {
    setOpenAIClientForTest(null);
    await app.close();
    cleanup(pdfId);
  }
});

test('POST /pages/:n/regenerate-image uses the high-quality timeout budget when openaiImageQuality is high', async () => {
  const pdfId = 'image-edit-timeout-regen-hq-01';
  seedPage(pdfId);
  const originalQuality = config.openaiImageQuality;
  config.openaiImageQuality = 'high';
  const capturedOptions: unknown[] = [];
  setOpenAIClientForTest({
    images: {
      edit: async (_body: unknown, options: unknown) => {
        capturedOptions.push(options);
        return { data: [{ b64_json: ONE_PIXEL_PNG.toString('base64') }] };
      },
    },
  } as never);

  const app = await buildApp();
  try {
    const resp = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${pdfId}/pages/1/regenerate-image`,
      payload: { prompt: 'make it brighter' },
    });
    assert.equal(resp.statusCode, 200);
    assert.deepEqual(capturedOptions[0], { timeout: config.openaiImageTimeoutMsHighQuality });
  } finally {
    config.openaiImageQuality = originalQuality;
    setOpenAIClientForTest(null);
    await app.close();
    cleanup(pdfId);
  }
});

test('POST /pages/:n/inpaint-image passes the configured image timeout to images.edit', async () => {
  const pdfId = 'image-edit-timeout-inpaint-01';
  seedPage(pdfId);
  const capturedOptions: unknown[] = [];
  setOpenAIClientForTest({
    images: {
      edit: async (_body: unknown, options: unknown) => {
        capturedOptions.push(options);
        return { data: [{ b64_json: ONE_PIXEL_PNG.toString('base64') }] };
      },
    },
  } as never);

  const app = await buildApp();
  try {
    const boundary = '----imgtimeout';
    const body =
      `--${boundary}\r\n` +
      'Content-Disposition: form-data; name="prompt"\r\n\r\n' +
      'fill in the blank area\r\n' +
      `--${boundary}--\r\n`;
    const resp = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${pdfId}/pages/1/inpaint-image`,
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
    assert.equal(resp.statusCode, 200);
    assert.equal(capturedOptions.length, 1);
    assert.deepEqual(capturedOptions[0], { timeout: config.openaiImageTimeoutMs });
  } finally {
    setOpenAIClientForTest(null);
    await app.close();
    cleanup(pdfId);
  }
});
