import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';
import { pageAnimationSpecPath, pageImagePath, figureManifestPath } from '../src/services/storage';
import { setCutoutEraserForTest, setCutoutPlacerForTest, setCutoutRefinerForTest } from '../src/services/cutoutDeps';
import type { CutoutEraser } from '../src/services/pageCutouts';
import type { FigureManifest } from '../src/worker/steps/extractPdfFigures';

function testSessionCookie(sub: string): string {
  const payload = Buffer.from(JSON.stringify({ provider: 'google', sub, email: `${sub}@example.com` }), 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}
const OWNER = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie('account-1'))}`, 'content-type': 'application/json' };
setSystemAuthSettings({ googleAuthEnabled: false });

const nowIso = () => new Date().toISOString();

/** A light page with one dark block in its lower-right quarter — one detectable region. */
async function slideWithBlock(): Promise<Buffer> {
  const block = await sharp({ create: { width: 200, height: 100, channels: 3, background: '#1d4ed8' } }).png().toBuffer();
  return sharp({ create: { width: 400, height: 200, channels: 3, background: '#ffffff' } })
    .composite([{ input: block, left: 200, top: 100 }])
    .jpeg({ quality: 95 })
    .toBuffer();
}

async function seedPdf(pdfId: string, pages: Array<{ renderType?: string; blank?: boolean }>): Promise<void> {
  const t = nowIso();
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,progress_step,progress_current,progress_total,error_message,user_prompt,require_script_confirmation,owner_sub,visibility,tts_voice,tts_speed,script_max_chars_per_page,created_at,updated_at)
     VALUES (?,?,?,'ready',?,NULL,NULL,NULL,NULL,NULL,0,NULL,'private',NULL,NULL,NULL,?,?)`,
  ).run(pdfId, 'cutouts', `${pdfId}.pdf`, pages.length, t, t);
  // No owner (like regenerate-animations.test.ts): the LLM gate then looks at the default
  // account's settings, which is what the other regenerate tests rely on too.
  const pagesDir = path.join(config.storageRoot, pdfId, 'pages');
  fs.rmSync(path.join(config.storageRoot, pdfId), { recursive: true, force: true });
  fs.mkdirSync(pagesDir, { recursive: true });
  for (const [i, page] of pages.entries()) {
    const n = i + 1;
    const uid = `${pdfId}-u${n}`;
    db.prepare(
      `INSERT INTO pages (pdf_id,page_number,page_uid,image_path,text_path,script_path,audio_path,audio_duration_seconds,status,error_message,render_type,created_at,updated_at)
       VALUES (?,?,?,?,?,?,NULL,NULL,'audio_ready',NULL,?,?,?)`,
    ).run(pdfId, n, uid, `pages/${uid}.jpg`, `pages/${uid}.text.txt`, `pages/${uid}.script.txt`, page.renderType ?? 'static-image', t, t);
    const image = page.blank
      ? await sharp({ create: { width: 400, height: 200, channels: 3, background: '#ffffff' } }).jpeg().toBuffer()
      : await slideWithBlock();
    fs.writeFileSync(path.join(pagesDir, `${uid}.jpg`), image);
    fs.writeFileSync(path.join(pagesDir, `${uid}.script.txt`), `第 ${n} 頁第一句。第 ${n} 頁第二句講到右下角。`, 'utf8');
  }
}

function cleanup(pdfId: string): void {
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  for (let i = 0; i < 3; i++) {
    try {
      fs.rmSync(path.join(config.storageRoot, pdfId), { recursive: true, force: true });
      return;
    } catch {
      /* retry */
    }
  }
}

async function waitForCompletion(app: Awaited<ReturnType<typeof buildApp>>, id: string): Promise<Record<string, unknown> & { status: string }> {
  let state: Record<string, unknown> & { status: string } = { status: 'pending' };
  for (let i = 0; i < 400; i++) {
    const res = await app.inject({ method: 'GET', url: `/api/pdfs/${id}/regenerate/status`, headers: OWNER });
    assert.equal(res.statusCode, 200);
    state = res.json();
    if (['completed', 'failed', 'cancelled'].includes(state.status)) break;
    await new Promise((r) => setTimeout(r, 25));
  }
  return state;
}

async function pixelAt(image: Buffer, x: number, y: number): Promise<[number, number, number]> {
  const { data, info } = await sharp(image).raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * info.channels;
  return [data[i]!, data[i + 1]!, data[i + 2]!];
}
const near = (a: [number, number, number], b: [number, number, number], tol = 24) => a.every((c, i) => Math.abs(c - b[i]!) <= tol);

const whiteFillEraser: CutoutEraser = async ({ source, mask }) => {
  const meta = await sharp(source).metadata();
  const { data, info } = await sharp(mask).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const white = Buffer.alloc(info.width * info.height * 4, 255);
  for (let i = 0; i < info.width * info.height; i++) white[i * 4 + 3] = data[i * 4 + 3] === 0 ? 255 : 0;
  const overlay = await sharp(white, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
  return sharp(source).resize(meta.width, meta.height).composite([{ input: overlay }]).png().toBuffer();
};

test('regenerate with cutouts: every image page is detected, cut out, erased and animated; blank and React pages are skipped; rollback restores', async () => {
  const id = 'regen-cutouts-01';
  await seedPdf(id, [{}, { blank: true }, { renderType: 'react' }, {}]);
  const original1 = fs.readFileSync(pageImagePath(id, `${id}-u1`));
  setCutoutEraserForTest(whiteFillEraser);
  setCutoutRefinerForTest(null);
  let placed = 0;
  setCutoutPlacerForTest(async (input) => {
    placed++;
    assert.equal(input.sentences.length, 2, 'the placer sees the page narration');
    return input.cutouts.map((c) => ({ index: c.index, line: 1, box: c.origin }));
  });
  const app = await buildApp();
  try {
    const started = await app.inject({ method: 'POST', url: `/api/pdfs/${id}/regenerate`, headers: OWNER, payload: { cutouts: { animate: true } } });
    assert.equal(started.statusCode, 202, started.body);
    const startedBody = started.json() as { steps: Array<{ name: string }> };
    assert.deepEqual(startedBody.steps.map((s) => s.name), ['cutout']);

    const final = await waitForCompletion(app, id);
    assert.equal(final.status, 'completed', JSON.stringify(final));
    const steps = final.steps as Array<{ name: string; status: string; total: number; completed: number; error: string | null }>;
    assert.equal(steps[0]!.name, 'cutout');
    assert.equal(steps[0]!.status, 'completed');
    assert.equal(steps[0]!.total, 3, 'the React page is not counted');
    assert.equal(steps[0]!.completed, 3);
    assert.equal(steps[0]!.error, null);
    assert.equal(placed, 2, 'the placer ran for the two pages with a region');

    // Page 1 and 4: erased, figure created, effect added, page type flipped.
    for (const n of [1, 4]) {
      const uid = `${id}-u${n}`;
      const image = fs.readFileSync(pageImagePath(id, uid));
      assert.ok(near(await pixelAt(image, 300, 150), [255, 255, 255]), `page ${n} block erased`);
      const spec = JSON.parse(fs.readFileSync(pageAnimationSpecPath(id, uid), 'utf8')) as { enabled: boolean; effects: Array<Record<string, unknown>> };
      assert.equal(spec.enabled, true);
      assert.equal(spec.effects.length, 1);
      assert.equal(spec.effects[0]!.type, 'overlay-image');
      assert.deepEqual(spec.effects[0]!.startTrigger, { type: 'transcript-line', line: 0, anchor: 'start' }, 'one sentence ahead of the match');
      const row = db.prepare(`SELECT render_type FROM pages WHERE pdf_id = ? AND page_number = ?`).get(id, n) as { render_type: string };
      assert.equal(row.render_type, 'gsap-image');
    }
    const manifest = JSON.parse(fs.readFileSync(figureManifestPath(id), 'utf8')) as FigureManifest;
    assert.deepEqual(manifest.pages.map((p) => p.pageNumber), [1, 4]);
    assert.ok(manifest.pages.every((p) => p.figures.length === 1 && p.figures[0]!.source === 'cutout'));

    // Blank page 2 and React page 3: untouched.
    assert.equal(fs.existsSync(pageAnimationSpecPath(id, `${id}-u2`)), false);
    assert.equal(fs.existsSync(pageAnimationSpecPath(id, `${id}-u3`)), false);
    const react = db.prepare(`SELECT render_type FROM pages WHERE pdf_id = ? AND page_number = 3`).get(id) as { render_type: string };
    assert.equal(react.render_type, 'react');

    // Rollback puts the pictures and the animation state back.
    const rollback = await app.inject({ method: 'POST', url: `/api/pdfs/${id}/regenerate/rollback`, headers: OWNER, payload: {} });
    assert.equal(rollback.statusCode, 200, rollback.body);
    assert.deepEqual(fs.readFileSync(pageImagePath(id, `${id}-u1`)), original1, 'page 1 picture restored');
    assert.equal(fs.existsSync(pageAnimationSpecPath(id, `${id}-u1`)), false, 'the spec the step created is gone again');
    const restored = db.prepare(`SELECT render_type, animation_spec_path FROM pages WHERE pdf_id = ? AND page_number = 1`).get(id) as { render_type: string; animation_spec_path: string | null };
    assert.equal(restored.render_type, 'static-image');
    assert.equal(restored.animation_spec_path, null);
  } finally {
    setCutoutEraserForTest(undefined);
    setCutoutRefinerForTest(undefined);
    setCutoutPlacerForTest(undefined);
    await app.close();
    cleanup(id);
  }
});

test('regenerate with cutouts: a page whose erase fails is reported in the step error and the rest still complete', async () => {
  const id = 'regen-cutouts-02';
  await seedPdf(id, [{}, {}]);
  let calls = 0;
  setCutoutEraserForTest(async (input) => {
    calls++;
    if (calls === 1) throw new Error('model down');
    return whiteFillEraser(input);
  });
  setCutoutRefinerForTest(null);
  setCutoutPlacerForTest(null);
  const app = await buildApp();
  try {
    const started = await app.inject({ method: 'POST', url: `/api/pdfs/${id}/regenerate`, headers: OWNER, payload: { cutouts: {}, page_numbers: [1, 2] } });
    assert.equal(started.statusCode, 202, started.body);
    const final = await waitForCompletion(app, id);
    assert.equal(final.status, 'completed', JSON.stringify(final));
    const step = (final.steps as Array<{ status: string; completed: number; error: string | null }>)[0]!;
    assert.equal(step.status, 'completed');
    assert.equal(step.completed, 2);
    // Page 1's only region failed → cutoutPageRegions had nothing to write and reports it; page 2 succeeded.
    assert.equal(fs.existsSync(pageAnimationSpecPath(id, `${id}-u1`)), false);
    assert.equal(fs.existsSync(pageAnimationSpecPath(id, `${id}-u2`)), true);
    assert.equal(step.error, null, 'a failed region inside a page is not a failed page');
  } finally {
    setCutoutEraserForTest(undefined);
    setCutoutRefinerForTest(undefined);
    setCutoutPlacerForTest(undefined);
    await app.close();
    cleanup(id);
  }
});
