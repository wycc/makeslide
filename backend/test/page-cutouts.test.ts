import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';
import { pageAnimationSpecPath, pageBaseImagePath, pageImagePath, pagesDir, pdfDir, figureManifestPath } from '../src/services/storage';
import { setCutoutEraserForTest, setCutoutPlacerForTest } from '../src/routes/pdfs/page-cutouts';
import { fitPlacementBox, mapPlacementResponse } from '../src/services/cutoutPlacement';
import { pageScriptPath } from '../src/services/storage';
import { buildHoleMask, cutoutRegionToPixels, type CutoutEraser } from '../src/services/pageCutouts';
import type { FigureManifest } from '../src/worker/steps/extractPdfFigures';

function testSessionCookie(sub: string): string {
  const payload = Buffer.from(JSON.stringify({ provider: 'google', sub, email: `${sub}@example.com` }), 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}
const OWNER = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie('account-1'))}`, 'content-type': 'application/json' };
const OTHER = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie('account-2'))}`, 'content-type': 'application/json' };
setSystemAuthSettings({ googleAuthEnabled: false });

const now = () => new Date().toISOString();

/** A white 400×200 page with a solid red block in its lower-right quarter. */
async function pageWithRedBlock(): Promise<Buffer> {
  const red = await sharp({ create: { width: 200, height: 100, channels: 3, background: '#ff0000' } }).png().toBuffer();
  return sharp({ create: { width: 400, height: 200, channels: 3, background: '#ffffff' } })
    .composite([{ input: red, left: 200, top: 100 }])
    .jpeg({ quality: 95 })
    .toBuffer();
}

async function seedPdf(pdfId: string, renderType = 'static-image'): Promise<string> {
  const t = now();
  const uid = `${pdfId}-u1`;
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,progress_step,progress_current,progress_total,error_message,user_prompt,require_script_confirmation,owner_sub,visibility,tts_voice,tts_speed,script_max_chars_per_page,created_at,updated_at)
     VALUES (?,?,?,'ready',1,NULL,NULL,NULL,NULL,NULL,0,'account-1','private',NULL,NULL,NULL,?,?)`,
  ).run(pdfId, 't', `${pdfId}.pdf`, t, t);
  db.prepare(
    `INSERT INTO pages (pdf_id,page_number,page_uid,image_path,text_path,script_path,audio_path,audio_duration_seconds,status,error_message,render_type,created_at,updated_at)
     VALUES (?,?,?,?,?,?,NULL,NULL,'audio_ready',NULL,?,?,?)`,
  ).run(pdfId, 1, uid, `pages/${uid}.jpg`, `pages/${uid}.text.txt`, `pages/${uid}.script.txt`, renderType, t, t);
  fs.rmSync(pdfDir(pdfId), { recursive: true, force: true });
  fs.mkdirSync(pagesDir(pdfId), { recursive: true });
  fs.writeFileSync(pageImagePath(pdfId, uid), await pageWithRedBlock());
  return uid;
}

function cleanup(pdfId: string): void {
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  // The deck's git bookkeeping may still be writing when the test ends; a leftover directory is
  // not a failure of the feature under test.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      fs.rmSync(pdfDir(pdfId), { recursive: true, force: true });
      return;
    } catch {
      /* retry */
    }
  }
}

async function pixelAt(image: Buffer, x: number, y: number): Promise<[number, number, number]> {
  const { data, info } = await sharp(image).raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * info.channels;
  return [data[i]!, data[i + 1]!, data[i + 2]!];
}
const near = (a: [number, number, number], b: [number, number, number], tol = 24) => a.every((c, i) => Math.abs(c - b[i]!) <= tol);

/** Stands in for the model: paints the masked hole white (the "background" of the test page). */
const whiteFillEraser: CutoutEraser = async ({ source, mask }) => {
  const meta = await sharp(source).metadata();
  const { data, info } = await sharp(mask).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  // Where the mask is transparent, paint white; elsewhere keep the source.
  const white = Buffer.alloc(info.width * info.height * 4, 255);
  for (let i = 0; i < info.width * info.height; i++) {
    white[i * 4 + 3] = data[i * 4 + 3] === 0 ? 255 : 0;
  }
  const overlay = await sharp(white, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
  return sharp(source).resize(meta.width, meta.height).composite([{ input: overlay }]).png().toBuffer();
};

test('cutoutRegionToPixels clamps into the image and buildHoleMask punches a transparent hole', async () => {
  assert.deepEqual(cutoutRegionToPixels({ x: 0.5, y: 0.5, w: 0.5, h: 0.5 }, 400, 200), { left: 200, top: 100, width: 200, height: 100 });
  assert.deepEqual(cutoutRegionToPixels({ x: 0.9, y: 0.9, w: 0.5, h: 0.5 }, 400, 200), { left: 360, top: 180, width: 40, height: 20 });
  const mask = await buildHoleMask(100, 50, { left: 10, top: 10, width: 20, height: 10 });
  const { data, info } = await sharp(mask).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const alphaAt = (x: number, y: number) => data[(y * info.width + x) * 4 + 3];
  assert.equal(alphaAt(15, 15), 0, 'inside the hole is transparent');
  assert.equal(alphaAt(50, 25), 255, 'outside stays opaque');
});

test('POST cutouts crops each region into a figure, erases it from the base, and adds overlay-image effects', async () => {
  const pdfId = 'cutout-basic-01';
  const uid = await seedPdf(pdfId);
  setCutoutEraserForTest(whiteFillEraser);
  setCutoutPlacerForTest(null);
  const app = await buildApp();
  try {
    const resp = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${pdfId}/pages/1/cutouts`,
      headers: OWNER,
      payload: { regions: [{ x: 0.5, y: 0.5, w: 0.5, h: 0.5 }] },
    });
    assert.equal(resp.statusCode, 200, resp.body);
    const body = resp.json() as { render_type: string; results: Array<{ status: string; figure_id: string | null; effect_id: string | null }> };
    assert.equal(body.render_type, 'gsap-image');
    assert.equal(body.results.length, 1);
    assert.equal(body.results[0]!.status, 'done');
    const figureId = body.results[0]!.figure_id!;
    assert.match(figureId, /^p1-upload-/);

    // The figure holds the red block; the base no longer does.
    const manifest = JSON.parse(fs.readFileSync(figureManifestPath(pdfId), 'utf8')) as FigureManifest;
    const figure = manifest.pages[0]!.figures.find((f) => f.id === figureId)!;
    assert.equal(figure.source, 'cutout');
    assert.deepEqual(figure.bbox, { xPct: 0.5, yPct: 0.5, widthPct: 0.5, heightPct: 0.5 });
    assert.equal(figure.width, 200);
    assert.equal(figure.height, 100);
    const figurePng = fs.readFileSync(`${pdfDir(pdfId)}/${figure.imagePath}`);
    assert.ok(near(await pixelAt(figurePng, 100, 50), [255, 0, 0]), 'the cut-out is the red block');
    const base = fs.readFileSync(pageImagePath(pdfId, uid));
    assert.ok(near(await pixelAt(base, 300, 150), [255, 255, 255]), 'the block is erased from the page image');
    assert.ok(near(await pixelAt(base, 100, 50), [255, 255, 255]));
    const row = db.prepare(`SELECT render_type, animation_spec_path FROM pages WHERE pdf_id = ? AND page_number = 1`).get(pdfId) as { render_type: string; animation_spec_path: string };
    assert.equal(row.render_type, 'gsap-image');
    assert.equal(row.animation_spec_path, `pages/${uid}.animation.json`);
    const spec = JSON.parse(fs.readFileSync(pageAnimationSpecPath(pdfId, uid), 'utf8')) as { enabled: boolean; effects: Array<Record<string, unknown>> };
    assert.equal(spec.enabled, true);
    assert.equal(spec.effects.length, 1);
    const effect = spec.effects[0]!;
    assert.equal(effect.type, 'overlay-image');
    assert.equal(effect.figureId, figureId);
    assert.equal(effect.id, body.results[0]!.effect_id);
    assert.deepEqual(effect.params, { xPct: 50, yPct: 50, widthPct: 50, heightPct: 50 });
    assert.equal(effect.exitDuration, undefined, 'a revealed region stays on screen');
    assert.equal(effect.startTrigger, undefined, 'no placer → timeline start, no sentence trigger');

    // The figure is listed for the page, and its image streams.
    const list = await app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}/pages/1/figures`, headers: OWNER });
    assert.equal(list.statusCode, 200);
    const listed = (list.json() as { figures: Array<{ id: string; source: string }> }).figures.find((f) => f.id === figureId);
    assert.equal(listed?.source, 'cutout');
  } finally {
    setCutoutEraserForTest(null);
    setCutoutPlacerForTest(undefined);
    await app.close();
    cleanup(pdfId);
  }
});

test('cut-outs keep an existing element layer: the base is replaced and the composite re-rendered', async () => {
  const pdfId = 'cutout-layered-01';
  const uid = await seedPdf(pdfId);
  setCutoutEraserForTest(whiteFillEraser);
  const app = await buildApp();
  try {
    const put = await app.inject({
      method: 'PUT',
      url: `/api/pdfs/${pdfId}/pages/1/elements`,
      headers: OWNER,
      payload: { elements: [{ id: 'r1', type: 'shape', shape: 'rect', x: 0, y: 0, w: 0.25, h: 0.5, fill: '#0000ff' }] },
    });
    assert.equal(put.statusCode, 200, put.body);
    const resp = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${pdfId}/pages/1/cutouts`,
      headers: OWNER,
      payload: { regions: [{ x: 0.5, y: 0.5, w: 0.5, h: 0.5 }], animate: false },
    });
    assert.equal(resp.statusCode, 200, resp.body);
    assert.equal((resp.json() as { render_type: string | null }).render_type, null);
    const base = fs.readFileSync(pageBaseImagePath(pdfId, uid));
    assert.ok(near(await pixelAt(base, 300, 150), [255, 255, 255]), 'base erased');
    assert.ok(near(await pixelAt(base, 50, 50), [255, 255, 255]), 'base has no element painted in');
    const composite = fs.readFileSync(pageImagePath(pdfId, uid));
    assert.ok(near(await pixelAt(composite, 50, 50), [0, 0, 255]), 'composite still shows the element');
    assert.ok(near(await pixelAt(composite, 300, 150), [255, 255, 255]), 'composite shows the erased base');
    const row = db.prepare(`SELECT render_type FROM pages WHERE pdf_id = ? AND page_number = 1`).get(pdfId) as { render_type: string };
    assert.equal(row.render_type, 'static-image', 'animate:false leaves the page type alone');
  } finally {
    setCutoutEraserForTest(null);
    await app.close();
    cleanup(pdfId);
  }
});

test('cut-outs report failed regions, refuse non-image pages and non-editors, and validate the body', async () => {
  const pdfId = 'cutout-guard-01';
  const uid = await seedPdf(pdfId);
  const reactId = 'cutout-guard-react';
  await seedPdf(reactId, 'react');
  const original = fs.readFileSync(pageImagePath(pdfId, uid));
  let calls = 0;
  setCutoutEraserForTest(async (input) => {
    calls++;
    if (calls === 1) throw new Error('model said no');
    return whiteFillEraser(input);
  });
  const app = await buildApp();
  try {
    assert.equal((await app.inject({ method: 'POST', url: `/api/pdfs/${pdfId}/pages/1/cutouts`, headers: OTHER, payload: { regions: [{ x: 0.5, y: 0.5, w: 0.5, h: 0.5 }] } })).statusCode, 403);
    assert.equal((await app.inject({ method: 'POST', url: `/api/pdfs/${reactId}/pages/1/cutouts`, headers: OWNER, payload: { regions: [{ x: 0.5, y: 0.5, w: 0.5, h: 0.5 }] } })).statusCode, 409);
    assert.equal((await app.inject({ method: 'POST', url: `/api/pdfs/${pdfId}/pages/1/cutouts`, headers: OWNER, payload: { regions: [] } })).statusCode, 400);
    assert.equal((await app.inject({ method: 'POST', url: `/api/pdfs/${pdfId}/pages/1/cutouts`, headers: OWNER, payload: { regions: [{ x: 0, y: 0, w: 0.001, h: 0.5 }] } })).statusCode, 400);

    // Two regions: the first erase fails, the second succeeds — partial result, only one figure/effect.
    const resp = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${pdfId}/pages/1/cutouts`,
      headers: OWNER,
      payload: { regions: [{ x: 0, y: 0, w: 0.25, h: 0.25 }, { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }] },
    });
    assert.equal(resp.statusCode, 200, resp.body);
    const body = resp.json() as { results: Array<{ index: number; status: string; message: string | null }> };
    assert.equal(body.results[0]!.status, 'failed');
    assert.match(body.results[0]!.message ?? '', /model said no/);
    assert.equal(body.results[1]!.status, 'done');
    const manifest = JSON.parse(fs.readFileSync(figureManifestPath(pdfId), 'utf8')) as FigureManifest;
    assert.equal(manifest.pages[0]!.figures.length, 1, 'no figure for the failed region');
    const spec = JSON.parse(fs.readFileSync(pageAnimationSpecPath(pdfId, uid), 'utf8')) as { effects: unknown[] };
    assert.equal(spec.effects.length, 1);

    // Every region failing leaves the page untouched and answers 502.
    setCutoutEraserForTest(async () => { throw new Error('down'); });
    const allFailed = await app.inject({ method: 'POST', url: `/api/pdfs/${pdfId}/pages/1/cutouts`, headers: OWNER, payload: { regions: [{ x: 0, y: 0, w: 0.25, h: 0.25 }] } });
    assert.equal(allFailed.statusCode, 502);
    assert.notDeepEqual(fs.readFileSync(pageImagePath(pdfId, uid)), original, 'earlier successful cut-out persisted');
    assert.equal(manifest.pages[0]!.figures.length, 1);
  } finally {
    setCutoutEraserForTest(null);
    await app.close();
    cleanup(pdfId);
    cleanup(reactId);
  }
});

test('fitPlacementBox keeps the aspect ratio inside the page and mapPlacementResponse falls back to the origin', () => {
  const origin = { xPct: 50, yPct: 50, widthPct: 50, heightPct: 50 };
  // A 2:1 picture on a 2:1 page: 40% wide → 40% tall.
  assert.deepEqual(fitPlacementBox({ xPct: 10, yPct: 10, widthPct: 40 }, origin, 2, { width: 400, height: 200 }), { xPct: 10, yPct: 10, widthPct: 40, heightPct: 40 });
  // Too wide → clamped so the box stays on the page.
  const clamped = fitPlacementBox({ xPct: 90, yPct: 90, widthPct: 30 }, origin, 2, { width: 400, height: 200 });
  assert.equal(clamped.xPct + clamped.widthPct, 100);
  assert.equal(clamped.yPct + clamped.heightPct, 100);
  // Nothing proposed → origin, height re-derived from the aspect.
  assert.deepEqual(fitPlacementBox({}, origin, 2, { width: 400, height: 200 }), { xPct: 50, yPct: 50, widthPct: 50, heightPct: 50 });
  const mapped = mapPlacementResponse(
    { placements: [{ cutout: 0, line: 1, xPct: 5, yPct: 5, widthPct: 20 }, { cutout: 1, line: 99 }] },
    { cutouts: [{ index: 0, image: Buffer.alloc(0), origin, aspect: 2 }, { index: 1, image: Buffer.alloc(0), origin, aspect: 1 }], sentences: ['a', 'b'], pageWidth: 400, pageHeight: 200 },
  );
  assert.equal(mapped[0]!.line, 1);
  assert.deepEqual(mapped[0]!.box, { xPct: 5, yPct: 5, widthPct: 20, heightPct: 20 });
  assert.equal(mapped[1]!.line, null, 'out-of-range sentence → no trigger');
  // A square picture 50% wide on a 2:1 page is 100% tall, so it is pushed up to fit.
  assert.deepEqual(mapped[1]!.box, { xPct: 50, yPct: 0, widthPct: 50, heightPct: 100 }, 'height derived from the aspect, box kept on the page');
});

test('with a placer the effect is triggered by the chosen sentence and shown at the proposed box', async () => {
  const pdfId = 'cutout-placed-01';
  const uid = await seedPdf(pdfId);
  fs.writeFileSync(pageScriptPath(pdfId, uid), '第一句介紹主題。第二句講到右下角那張圖。第三句總結。', 'utf8');
  setCutoutEraserForTest(whiteFillEraser);
  const seen: { sentences: string[]; cutouts: number; erasedIsWhite: boolean }[] = [];
  setCutoutPlacerForTest(async (input) => {
    const centre = await pixelAt(input.erasedPage, 300, 150);
    seen.push({ sentences: input.sentences, cutouts: input.cutouts.length, erasedIsWhite: near(centre, [255, 255, 255]) });
    return input.cutouts.map((c) => ({ index: c.index, line: 1, box: { xPct: 10, yPct: 20, widthPct: 40, heightPct: 40 } }));
  });
  const app = await buildApp();
  try {
    const resp = await app.inject({ method: 'POST', url: `/api/pdfs/${pdfId}/pages/1/cutouts`, headers: OWNER, payload: { regions: [{ x: 0.5, y: 0.5, w: 0.5, h: 0.5 }] } });
    assert.equal(resp.statusCode, 200, resp.body);
    const body = resp.json() as { results: Array<{ line: number | null; sentence: string | null; reveal: string | null; params: Record<string, number> | null }> };
    assert.equal(body.results[0]!.line, 1);
    assert.equal(body.results[0]!.sentence, '第二句講到右下角那張圖。');
    assert.deepEqual(body.results[0]!.params, { xPct: 10, yPct: 20, widthPct: 40, heightPct: 40 });
    assert.equal(seen.length, 1);
    assert.deepEqual(seen[0]!.sentences, ['第一句介紹主題。', '第二句講到右下角那張圖。', '第三句總結。']);
    assert.equal(seen[0]!.cutouts, 1);
    assert.equal(seen[0]!.erasedIsWhite, true, 'the placer sees the page after erasing');
    const spec = JSON.parse(fs.readFileSync(pageAnimationSpecPath(pdfId, uid), 'utf8')) as { effects: Array<Record<string, unknown>> };
    // Matched to sentence 1 → fades in as sentence 0 starts, so it is on screen before it is mentioned.
    assert.deepEqual(spec.effects[0]!.startTrigger, { type: 'transcript-line', line: 0, anchor: 'start' });
    assert.equal(body.results[0]!.reveal, 'before-sentence');
    assert.deepEqual(spec.effects[0]!.params, { xPct: 10, yPct: 20, widthPct: 40, heightPct: 40 });

    // A placer that throws must not fail the cut-out: origin box, no trigger.
    setCutoutPlacerForTest(async () => { throw new Error('llm down'); });
    const fallback = await app.inject({ method: 'POST', url: `/api/pdfs/${pdfId}/pages/1/cutouts`, headers: OWNER, payload: { regions: [{ x: 0, y: 0, w: 0.25, h: 0.25 }] } });
    assert.equal(fallback.statusCode, 200, fallback.body);
    const fb = fallback.json() as { results: Array<{ line: number | null; params: Record<string, number> | null }> };
    assert.equal(fb.results[0]!.line, null);
    assert.deepEqual(fb.results[0]!.params, { xPct: 0, yPct: 0, widthPct: 25, heightPct: 25 });
  } finally {
    setCutoutEraserForTest(null);
    setCutoutPlacerForTest(undefined);
    await app.close();
    cleanup(pdfId);
  }
});

test('the topmost cut-out in the title zone is shown from the start; a match to the first sentence is immediate too', async () => {
  const pdfId = 'cutout-title-01';
  const uid = await seedPdf(pdfId);
  fs.writeFileSync(pageScriptPath(pdfId, uid), '開場。第二句。第三句。', 'utf8');
  setCutoutEraserForTest(whiteFillEraser);
  // Region 0 is a title bar at the top; region 1 is the red block lower right; region 2 sits mid-page
  // and the placer ties it to the first sentence.
  setCutoutPlacerForTest(async (input) =>
    input.cutouts.map((c) => ({ index: c.index, line: c.index === 0 ? 2 : c.index === 1 ? 2 : 0, box: c.origin })),
  );
  const app = await buildApp();
  try {
    const resp = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${pdfId}/pages/1/cutouts`,
      headers: OWNER,
      payload: { regions: [{ x: 0.05, y: 0.05, w: 0.6, h: 0.1 }, { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }, { x: 0.05, y: 0.4, w: 0.3, h: 0.2 }] },
    });
    assert.equal(resp.statusCode, 200, resp.body);
    const body = resp.json() as { results: Array<{ index: number; reveal: string | null; line: number | null }> };
    assert.equal(body.results[0]!.reveal, 'immediate', 'title zone → immediate even though the placer said sentence 2');
    assert.equal(body.results[1]!.reveal, 'before-sentence');
    assert.equal(body.results[2]!.reveal, 'immediate', 'first sentence → nothing to be earlier than');
    const spec = JSON.parse(fs.readFileSync(pageAnimationSpecPath(pdfId, uid), 'utf8')) as { effects: Array<Record<string, unknown>> };
    assert.equal(spec.effects[0]!.start, 0);
    assert.equal(spec.effects[0]!.startTrigger, undefined);
    assert.deepEqual(spec.effects[1]!.startTrigger, { type: 'transcript-line', line: 1, anchor: 'start' });
    assert.ok((spec.effects[1]!.start as number) > 0, 'timeline fallback still staggers the non-immediate one');
    assert.equal(spec.effects[2]!.start, 0);
    assert.equal(spec.effects[2]!.startTrigger, undefined);
  } finally {
    setCutoutEraserForTest(null);
    setCutoutPlacerForTest(undefined);
    await app.close();
    cleanup(pdfId);
  }
});
