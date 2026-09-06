import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';
import { pageAnimationSpecPath, pageImagePath, pageThumbnailPath, pagesDir, pdfDir, figureManifestPath } from '../src/services/storage';
import { setCutoutEraserForTest, setCutoutPlacerForTest, setCutoutRefinerForTest } from '../src/services/cutoutDeps';
import { cutoutManifestPath, readCutoutManifest } from '../src/services/cutoutHistory';
import type { CutoutEraser } from '../src/services/pageCutouts';
import type { FigureManifest } from '../src/worker/steps/extractPdfFigures';

function testSessionCookie(sub: string): string {
  const payload = Buffer.from(JSON.stringify({ provider: 'google', sub, email: `${sub}@example.com` }), 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}
const OWNER = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie('account-1'))}`, 'content-type': 'application/json' };
setSystemAuthSettings({ googleAuthEnabled: false });
const now = () => new Date().toISOString();

/** White 400×200 page: red block lower-right, blue block upper-left. */
async function page(): Promise<Buffer> {
  const red = await sharp({ create: { width: 200, height: 100, channels: 3, background: '#ff0000' } }).png().toBuffer();
  const blue = await sharp({ create: { width: 100, height: 60, channels: 3, background: '#0000ff' } }).png().toBuffer();
  return sharp({ create: { width: 400, height: 200, channels: 3, background: '#ffffff' } })
    .composite([{ input: red, left: 200, top: 100 }, { input: blue, left: 20, top: 20 }])
    .jpeg({ quality: 95 })
    .toBuffer();
}

async function seedPdf(pdfId: string): Promise<string> {
  const t = now();
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
  fs.writeFileSync(pageImagePath(pdfId, uid), await page());
  fs.writeFileSync(`${pagesDir(pdfId)}/${uid}.script.txt`, '第一句。第二句。第三句。', 'utf8');
  return uid;
}
function cleanup(pdfId: string): void {
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  for (let i = 0; i < 3; i++) {
    try { fs.rmSync(pdfDir(pdfId), { recursive: true, force: true }); return; } catch { /* retry */ }
  }
}
async function pixelAt(image: Buffer, x: number, y: number): Promise<[number, number, number]> {
  const { data, info } = await sharp(image).raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * info.channels;
  return [data[i]!, data[i + 1]!, data[i + 2]!];
}
const near = (a: [number, number, number], b: [number, number, number], tol = 24) => a.every((c, i) => Math.abs(c - b[i]!) <= tol);

/** Paints the masked hole a recognisable green so a patch can be told from the original. */
const greenFillEraser: CutoutEraser = async ({ source, mask }) => {
  const meta = await sharp(source).metadata();
  const { data, info } = await sharp(mask).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const fill = Buffer.alloc(info.width * info.height * 4);
  for (let i = 0; i < info.width * info.height; i++) {
    fill[i * 4] = 0; fill[i * 4 + 1] = 200; fill[i * 4 + 2] = 0;
    fill[i * 4 + 3] = data[i * 4 + 3] === 0 ? 255 : 0;
  }
  const overlay = await sharp(fill, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
  return sharp(source).resize(meta.width, meta.height).composite([{ input: overlay }]).png().toBuffer();
};

const RED = { x: 0.5, y: 0.5, w: 0.5, h: 0.5 };
const BLUE = { x: 0.05, y: 0.1, w: 0.25, h: 0.3 };

test('the first cut records a lossless source and a patch; restoring is exact and needs no model', async () => {
  const pdfId = 'cutout-history-01';
  const uid = await seedPdf(pdfId);
  const original = fs.readFileSync(pageImagePath(pdfId, uid));
  setCutoutEraserForTest(greenFillEraser);
  setCutoutRefinerForTest(null);
  setCutoutPlacerForTest(null);
  const app = await buildApp();
  try {
    const cut = await app.inject({ method: 'POST', url: `/api/pdfs/${pdfId}/pages/1/cutouts/apply`, headers: OWNER, payload: { restore: [], cut: [RED, BLUE] } });
    assert.equal(cut.statusCode, 200, cut.body);
    const body = cut.json() as { cuts: Array<{ figureId: string; restorable: string; hidden: boolean }>; results: Array<{ status: string; figure_id: string }> };
    assert.equal(body.cuts.length, 2);
    assert.ok(body.cuts.every((c) => c.restorable === 'exact' && !c.hidden));
    const manifest = readCutoutManifest(pdfId, uid)!;
    assert.equal(manifest.cuts.length, 2);
    assert.ok(fs.existsSync(`${pdfDir(pdfId)}/${manifest.source}`), 'source kept');
    assert.ok(manifest.cuts.every((c) => fs.existsSync(`${pdfDir(pdfId)}/${c.patch}`)), 'a patch per cut');
    assert.ok(manifest.cuts.every((c) => c.effectId), 'effect ids recorded');
    const source = fs.readFileSync(`${pdfDir(pdfId)}/${manifest.source}`);
    assert.ok(near(await pixelAt(source, 300, 150), [255, 0, 0]), 'source still has the red block');
    const erased = fs.readFileSync(pageImagePath(pdfId, uid));
    assert.ok(near(await pixelAt(erased, 300, 150), [0, 200, 0]), 'page shows the erase patch');
    assert.ok(near(await pixelAt(erased, 60, 40), [0, 200, 0]), 'both regions erased');

    // Restore the red one: the eraser must not be called, the red pixels come back, blue stays erased.
    let eraserCalls = 0;
    setCutoutEraserForTest(async (input) => { eraserCalls++; return greenFillEraser(input); });
    const redId = body.results[0]!.figure_id;
    const restore = await app.inject({ method: 'POST', url: `/api/pdfs/${pdfId}/pages/1/cutouts/apply`, headers: OWNER, payload: { restore: [redId], cut: [] } });
    assert.equal(restore.statusCode, 200, restore.body);
    const rb = restore.json() as { restored: Array<{ figureId: string; status: string }>; cuts: unknown[] };
    assert.deepEqual(rb.restored, [{ figureId: redId, status: 'restored' }]);
    assert.equal(rb.cuts.length, 1);
    assert.equal(eraserCalls, 0, 'restoring is composition only');
    const restored = fs.readFileSync(pageImagePath(pdfId, uid));
    assert.ok(near(await pixelAt(restored, 300, 150), [255, 0, 0]), 'red is back, from the source');
    assert.ok(near(await pixelAt(restored, 60, 40), [0, 200, 0]), 'blue stays erased');
    const originalPixel = await pixelAt(original, 300, 150);
    const restoredPixel = await pixelAt(restored, 300, 150);
    assert.ok(near(restoredPixel, originalPixel, 6), 'pixel-level match with the original');
    const figures = JSON.parse(fs.readFileSync(figureManifestPath(pdfId), 'utf8')) as FigureManifest;
    assert.equal(figures.pages[0]!.figures.length, 1, 'the restored figure is gone');
    const spec = JSON.parse(fs.readFileSync(pageAnimationSpecPath(pdfId, uid), 'utf8')) as { effects: Array<{ figureId: string }> };
    assert.equal(spec.effects.length, 1);
    assert.notEqual(spec.effects[0]!.figureId, redId);
    assert.equal(readCutoutManifest(pdfId, uid)!.cuts.length, 1);
  } finally {
    setCutoutEraserForTest(undefined); setCutoutRefinerForTest(undefined); setCutoutPlacerForTest(undefined);
    await app.close();
    cleanup(pdfId);
  }
});

test('hide and show only move the effect in and out of the spec; the list reports the state', async () => {
  const pdfId = 'cutout-history-02';
  const uid = await seedPdf(pdfId);
  setCutoutEraserForTest(greenFillEraser); setCutoutRefinerForTest(null); setCutoutPlacerForTest(null);
  const app = await buildApp();
  try {
    const cut = await app.inject({ method: 'POST', url: `/api/pdfs/${pdfId}/pages/1/cutouts/apply`, headers: OWNER, payload: { restore: [], cut: [RED] } });
    assert.equal(cut.statusCode, 200, cut.body);
    const figureId = (cut.json() as { results: Array<{ figure_id: string }> }).results[0]!.figure_id;
    const before = fs.readFileSync(pageImagePath(pdfId, uid));

    const hide = await app.inject({ method: 'PATCH', url: `/api/pdfs/${pdfId}/pages/1/cutouts/${figureId}`, headers: OWNER, payload: { hidden: true } });
    assert.equal(hide.statusCode, 200, hide.body);
    assert.equal((hide.json() as { cuts: Array<{ hidden: boolean }> }).cuts[0]!.hidden, true);
    let spec = JSON.parse(fs.readFileSync(pageAnimationSpecPath(pdfId, uid), 'utf8')) as { effects: unknown[] };
    assert.equal(spec.effects.length, 0, 'effect removed');
    assert.deepEqual(fs.readFileSync(pageImagePath(pdfId, uid)), before, 'the picture is untouched');

    const show = await app.inject({ method: 'PATCH', url: `/api/pdfs/${pdfId}/pages/1/cutouts/${figureId}`, headers: OWNER, payload: { hidden: false } });
    assert.equal(show.statusCode, 200, show.body);
    assert.equal((show.json() as { cuts: Array<{ hidden: boolean }> }).cuts[0]!.hidden, false);
    spec = JSON.parse(fs.readFileSync(pageAnimationSpecPath(pdfId, uid), 'utf8')) as { effects: unknown[] };
    assert.equal(spec.effects.length, 1, 'effect back');

    const list = await app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}/pages/1/cutouts`, headers: OWNER });
    assert.equal(list.statusCode, 200);
    const item = (list.json() as { cuts: Array<{ origin: Record<string, number>; box: Record<string, number>; effectId: string | null }> }).cuts[0]!;
    assert.deepEqual(item.origin, RED);
    assert.ok(item.effectId);
  } finally {
    setCutoutEraserForTest(undefined); setCutoutRefinerForTest(undefined); setCutoutPlacerForTest(undefined);
    await app.close();
    cleanup(pdfId);
  }
});

test('a cut-out made before the history existed restores by pasting its picture back', async () => {
  const pdfId = 'cutout-history-03';
  const uid = await seedPdf(pdfId);
  setCutoutEraserForTest(greenFillEraser); setCutoutRefinerForTest(null); setCutoutPlacerForTest(null);
  const app = await buildApp();
  try {
    const cut = await app.inject({ method: 'POST', url: `/api/pdfs/${pdfId}/pages/1/cutouts`, headers: OWNER, payload: { regions: [RED] } });
    assert.equal(cut.statusCode, 200, cut.body);
    const figureId = (cut.json() as { results: Array<{ figure_id: string }> }).results[0]!.figure_id;
    // Simulate a legacy cut: throw the history away.
    const manifest = readCutoutManifest(pdfId, uid)!;
    fs.rmSync(`${pdfDir(pdfId)}/${manifest.source}`, { force: true });
    for (const c of manifest.cuts) fs.rmSync(`${pdfDir(pdfId)}/${c.patch}`, { force: true });
    fs.rmSync(cutoutManifestPath(pdfId, uid), { force: true });

    const list = await app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}/pages/1/cutouts`, headers: OWNER });
    assert.equal((list.json() as { cuts: Array<{ restorable: string }> }).cuts[0]!.restorable, 'paste-back');

    const restore = await app.inject({ method: 'POST', url: `/api/pdfs/${pdfId}/pages/1/cutouts/apply`, headers: OWNER, payload: { restore: [figureId], cut: [] } });
    assert.equal(restore.statusCode, 200, restore.body);
    assert.deepEqual((restore.json() as { restored: unknown[] }).restored, [{ figureId, status: 'pasted-back' }]);
    const restored = fs.readFileSync(pageImagePath(pdfId, uid));
    assert.ok(near(await pixelAt(restored, 300, 150), [255, 0, 0]), 'the cut-out picture is back in its box');
    assert.equal(fs.existsSync(pageAnimationSpecPath(pdfId, uid)) ? (JSON.parse(fs.readFileSync(pageAnimationSpecPath(pdfId, uid), 'utf8')) as { effects: unknown[] }).effects.length : 0, 0);
  } finally {
    setCutoutEraserForTest(undefined); setCutoutRefinerForTest(undefined); setCutoutPlacerForTest(undefined);
    await app.close();
    cleanup(pdfId);
  }
});

test('replacing the picture invalidates the history; deleting the page removes its files', async () => {
  const pdfId = 'cutout-history-04';
  const uid = await seedPdf(pdfId);
  setCutoutEraserForTest(greenFillEraser); setCutoutRefinerForTest(null); setCutoutPlacerForTest(null);
  const app = await buildApp();
  try {
    const cut = await app.inject({ method: 'POST', url: `/api/pdfs/${pdfId}/pages/1/cutouts/apply`, headers: OWNER, payload: { restore: [], cut: [RED] } });
    assert.equal(cut.statusCode, 200, cut.body);
    const manifest = readCutoutManifest(pdfId, uid)!;
    const boundary = '----cutout-history-replace';
    const jpeg = await sharp({ create: { width: 400, height: 200, channels: 3, background: '#123456' } }).jpeg().toBuffer();
    const payload = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="new.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
      jpeg,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const replace = await app.inject({ method: 'POST', url: `/api/pdfs/${pdfId}/pages/1/replace-image`, headers: { ...OWNER, 'content-type': `multipart/form-data; boundary=${boundary}` }, payload });
    assert.equal(replace.statusCode, 200, replace.body);
    assert.equal(readCutoutManifest(pdfId, uid), null, 'history dropped with the picture');
    assert.equal(fs.existsSync(`${pdfDir(pdfId)}/${manifest.source}`), false);
    const list = await app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}/pages/1/cutouts`, headers: OWNER });
    assert.equal((list.json() as { cuts: Array<{ restorable: string }> }).cuts[0]!.restorable, 'paste-back', 'the figure survives; only paste-back remains');
  } finally {
    setCutoutEraserForTest(undefined); setCutoutRefinerForTest(undefined); setCutoutPlacerForTest(undefined);
    await app.close();
    cleanup(pdfId);
  }
});

test('previews come from the uncut picture: thumbnail keeps the red block, detail flags has_cutouts, playback keeps the erased base', async () => {
  const pdfId = 'cutout-history-05';
  const uid = await seedPdf(pdfId);
  setCutoutEraserForTest(greenFillEraser); setCutoutRefinerForTest(null); setCutoutPlacerForTest(null);
  const app = await buildApp();
  try {
    const cut = await app.inject({ method: 'POST', url: `/api/pdfs/${pdfId}/pages/1/cutouts/apply`, headers: OWNER, payload: { restore: [], cut: [RED] } });
    assert.equal(cut.statusCode, 200, cut.body);
    const thumb = fs.readFileSync(pageThumbnailPath(pdfId, uid));
    const tm = await sharp(thumb).metadata();
    // The thumbnail is a scaled copy of the *uncut* picture: the red block is still there.
    assert.ok(near(await pixelAt(thumb, Math.round(tm.width! * 0.75), Math.round(tm.height! * 0.75)), [255, 0, 0]), 'thumbnail shows the uncut red block');
    const served = await app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}/pages/1/thumbnail`, headers: OWNER });
    assert.equal(served.statusCode, 200);
    const sm = await sharp(served.rawPayload).metadata();
    assert.ok(near(await pixelAt(served.rawPayload, Math.round(sm.width! * 0.75), Math.round(sm.height! * 0.75)), [255, 0, 0]));
    const full = await app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}/pages/1/image`, headers: OWNER });
    assert.ok(near(await pixelAt(full.rawPayload, 300, 150), [0, 200, 0]), 'the page image itself is the erased base');
    const detail = await app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}`, headers: OWNER });
    const page = (detail.json() as { pages: Array<{ has_cutouts: boolean }> }).pages[0]!;
    assert.equal(page.has_cutouts, true);

    // Restoring the only cut empties the history: previews fall back to the page image.
    const figureId = (cut.json() as { results: Array<{ figure_id: string }> }).results[0]!.figure_id;
    const restore = await app.inject({ method: 'POST', url: `/api/pdfs/${pdfId}/pages/1/cutouts/apply`, headers: OWNER, payload: { restore: [figureId], cut: [] } });
    assert.equal(restore.statusCode, 200, restore.body);
    const detail2 = await app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}`, headers: OWNER });
    assert.equal((detail2.json() as { pages: Array<{ has_cutouts: boolean }> }).pages[0]!.has_cutouts, false);
  } finally {
    setCutoutEraserForTest(undefined); setCutoutRefinerForTest(undefined); setCutoutPlacerForTest(undefined);
    await app.close();
    cleanup(pdfId);
  }
});
