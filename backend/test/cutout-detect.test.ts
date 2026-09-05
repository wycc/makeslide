import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';
import { pageImagePath, pagesDir, pdfDir } from '../src/services/storage';
import { setCutoutRefinerForTest } from '../src/routes/pdfs/page-cutouts';
import { applyRefinement, connectedComponentBoxes, detectCutoutCandidates, estimateBackground, mergeBoxes } from '../src/services/cutoutDetect';

function testSessionCookie(sub: string): string {
  const payload = Buffer.from(JSON.stringify({ provider: 'google', sub, email: `${sub}@example.com` }), 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}
const OWNER = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie('account-1'))}`, 'content-type': 'application/json' };
const OTHER = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie('account-2'))}`, 'content-type': 'application/json' };
setSystemAuthSettings({ googleAuthEnabled: false });

/**
 * A 800×450 slide on a light-grey background: a blue block top-left, a red block bottom-right,
 * and a "paragraph" of small dark dashes (glyph-like) top-right that must come out as one box.
 */
async function syntheticSlide(): Promise<Buffer> {
  const dash = await sharp({ create: { width: 10, height: 4, channels: 3, background: '#222222' } }).png().toBuffer();
  const glyphs: sharp.OverlayOptions[] = [];
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 12; col++) {
      glyphs.push({ input: dash, left: 480 + col * 16, top: 60 + row * 14 });
    }
  }
  return sharp({ create: { width: 800, height: 450, channels: 3, background: '#f2f2f2' } })
    .composite([
      { input: await sharp({ create: { width: 200, height: 120, channels: 3, background: '#1d4ed8' } }).png().toBuffer(), left: 80, top: 60 },
      { input: await sharp({ create: { width: 240, height: 100, channels: 3, background: '#dc2626' } }).png().toBuffer(), left: 480, top: 300 },
      ...glyphs,
    ])
    .png()
    .toBuffer();
}

test('detectCutoutCandidates finds the content blocks of a slide and groups glyphs into one box', async () => {
  const image = await syntheticSlide();
  const regions = await detectCutoutCandidates(image);
  assert.equal(regions.length, 3, `three blocks, got ${JSON.stringify(regions)}`);
  const near = (a: number, b: number, tol = 0.03) => Math.abs(a - b) <= tol;
  // Sorted top-to-bottom then left-to-right: blue, paragraph, red.
  const [blue, para, red] = regions as [typeof regions[number], typeof regions[number], typeof regions[number]];
  assert.ok(near(blue.x, 80 / 800) && near(blue.y, 60 / 450) && near(blue.w, 200 / 800) && near(blue.h, 120 / 450), `blue ${JSON.stringify(blue)}`);
  assert.ok(near(para.x, 480 / 800) && near(para.y, 60 / 450) && near(para.w, 186 / 800, 0.04) && near(para.h, 46 / 450, 0.04), `paragraph ${JSON.stringify(para)}`);
  assert.ok(near(red.x, 480 / 800) && near(red.y, 300 / 450) && near(red.w, 240 / 800) && near(red.h, 100 / 450), `red ${JSON.stringify(red)}`);
});

test('detectCutoutCandidates ignores a blank page and drops the whole-page block', async () => {
  const blank = await sharp({ create: { width: 400, height: 225, channels: 3, background: '#ffffff' } }).png().toBuffer();
  assert.deepEqual(await detectCutoutCandidates(blank), []);
  // A picture that is one big photo-like block: the block covers > 85% → not a cut-out.
  const full = await sharp({ create: { width: 400, height: 225, channels: 3, background: '#ffffff' } })
    .composite([{ input: await sharp({ create: { width: 390, height: 215, channels: 3, background: '#3355aa' } }).png().toBuffer(), left: 5, top: 5 }])
    .png()
    .toBuffer();
  assert.deepEqual(await detectCutoutCandidates(full), []);
});

test('estimateBackground, connectedComponentBoxes and mergeBoxes behave on tiny masks', () => {
  // 4×2 RGB image whose border is mostly white with one grey pixel.
  const data = Buffer.from([255, 255, 255, 255, 255, 255, 255, 255, 255, 120, 120, 120, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255]);
  assert.deepEqual(estimateBackground(data, 4, 2, 3), [255, 255, 255]);
  // Two separate components on a 6×3 mask.
  const mask = new Uint8Array([1, 1, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0]);
  const boxes = connectedComponentBoxes(mask, 6, 3);
  assert.equal(boxes.length, 2);
  assert.deepEqual(boxes[0], { left: 0, top: 0, right: 1, bottom: 1 });
  assert.deepEqual(boxes[1], { left: 5, top: 0, right: 5, bottom: 1 });
  assert.equal(mergeBoxes(boxes, 1).length, 2, 'far apart stays apart');
  assert.equal(mergeBoxes(boxes, 4).length, 1, 'within the gap they merge');
});

test('applyRefinement unions grouped candidates, drops rejected ones, keeps unmentioned ones and labels', () => {
  const candidates = [
    { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
    { x: 0.1, y: 0.32, w: 0.2, h: 0.05 },
    { x: 0.6, y: 0.1, w: 0.3, h: 0.3 },
    { x: 0, y: 0.95, w: 1, h: 0.05 },
  ];
  const out = applyRefinement(candidates, {
    units: [
      { boxes: [0, 1], label: 'chart with caption' },
      { boxes: [3], keep: false },
      { boxes: [9], label: 'nonexistent' },
    ],
  });
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], { x: 0.1, y: 0.1, w: 0.2, h: 0.27, label: 'chart with caption' });
  assert.deepEqual(out[1], candidates[2], 'unmentioned candidate kept as is');
});

test('POST cutouts/detect returns the analysis, runs the refiner when present, and guards access', async () => {
  const pdfId = 'cutout-detect-01';
  const t = new Date().toISOString();
  const uid = `${pdfId}-u1`;
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,progress_step,progress_current,progress_total,error_message,user_prompt,require_script_confirmation,owner_sub,visibility,tts_voice,tts_speed,script_max_chars_per_page,created_at,updated_at)
     VALUES (?,?,?,'ready',1,NULL,NULL,NULL,NULL,NULL,0,'account-1','private',NULL,NULL,NULL,?,?)`,
  ).run(pdfId, 't', `${pdfId}.pdf`, t, t);
  db.prepare(
    `INSERT INTO pages (pdf_id,page_number,page_uid,image_path,text_path,script_path,audio_path,audio_duration_seconds,status,error_message,created_at,updated_at)
     VALUES (?,?,?,?,?,?,NULL,NULL,'audio_ready',NULL,?,?)`,
  ).run(pdfId, 1, uid, `pages/${uid}.jpg`, `pages/${uid}.text.txt`, `pages/${uid}.script.txt`, t, t);
  fs.rmSync(pdfDir(pdfId), { recursive: true, force: true });
  fs.mkdirSync(pagesDir(pdfId), { recursive: true });
  fs.writeFileSync(pageImagePath(pdfId, uid), await sharp(await syntheticSlide()).jpeg({ quality: 95 }).toBuffer());
  fs.writeFileSync(`${pagesDir(pdfId)}/${uid}.script.txt`, '先看左上的藍色方塊。再看說明文字。', 'utf8');
  const app = await buildApp();
  try {
    setCutoutRefinerForTest(null);
    const raw = await app.inject({ method: 'POST', url: `/api/pdfs/${pdfId}/pages/1/cutouts/detect`, headers: OWNER, payload: {} });
    assert.equal(raw.statusCode, 200, raw.body);
    const rawBody = raw.json() as { regions: Array<{ x: number; label?: string }>; candidates: number; refined: boolean };
    assert.equal(rawBody.regions.length, 3);
    assert.equal(rawBody.candidates, 3);
    assert.equal(rawBody.refined, false);

    let seenSentences: string[] = [];
    setCutoutRefinerForTest(async (input) => {
      seenSentences = input.sentences;
      return [{ ...input.candidates[0]!, label: '藍色方塊' }];
    });
    const refined = await app.inject({ method: 'POST', url: `/api/pdfs/${pdfId}/pages/1/cutouts/detect`, headers: OWNER, payload: {} });
    assert.equal(refined.statusCode, 200, refined.body);
    const refinedBody = refined.json() as { regions: Array<{ label?: string }>; candidates: number; refined: boolean };
    assert.equal(refinedBody.refined, true);
    assert.equal(refinedBody.regions.length, 1);
    assert.equal(refinedBody.regions[0]!.label, '藍色方塊');
    assert.equal(refinedBody.candidates, 3, 'raw count still reported');
    assert.deepEqual(seenSentences, ['先看左上的藍色方塊。', '再看說明文字。']);

    // A failing refiner falls back to the raw candidates; `raw: true` skips it entirely.
    setCutoutRefinerForTest(async () => { throw new Error('llm down'); });
    const fallback = await app.inject({ method: 'POST', url: `/api/pdfs/${pdfId}/pages/1/cutouts/detect`, headers: OWNER, payload: {} });
    assert.equal(fallback.statusCode, 200);
    assert.equal((fallback.json() as { regions: unknown[]; refined: boolean }).regions.length, 3);
    assert.equal((fallback.json() as { refined: boolean }).refined, false);
    let called = false;
    setCutoutRefinerForTest(async (input) => { called = true; return input.candidates; });
    const skip = await app.inject({ method: 'POST', url: `/api/pdfs/${pdfId}/pages/1/cutouts/detect`, headers: OWNER, payload: { raw: true } });
    assert.equal(skip.statusCode, 200);
    assert.equal(called, false);

    assert.equal((await app.inject({ method: 'POST', url: `/api/pdfs/${pdfId}/pages/1/cutouts/detect`, headers: OTHER, payload: {} })).statusCode, 403);
  } finally {
    setCutoutRefinerForTest(undefined);
    await app.close();
    db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);
    db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
    fs.rmSync(pdfDir(pdfId), { recursive: true, force: true });
  }
});
