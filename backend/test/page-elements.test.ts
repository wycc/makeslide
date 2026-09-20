import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';
import { pageBaseImagePath, pageElementsPath, pageImagePath, pageThumbnailPath, pagesDir, pdfDir } from '../src/services/storage';
import { isElementColor, PageElementSchema, PageElementsArraySchema, type PageElement } from '../src/services/pageElements';
import { renderPageElements, wrapText } from '../src/services/pageElementsRender';
import { containsMath, markdownToPlainText, renderMarkdownMathHtml, safeMarkdownLinkHref } from '../src/services/markdownMathHtml';
import { buildPageElementsDocument, katexCssWithInlineFonts } from '../src/services/pageElementsDocument';
import { loadExportedPageElements } from '../src/routes/pdfs/export';

function testSessionCookie(sub: string): string {
  const payload = Buffer.from(JSON.stringify({ provider: 'google', sub, email: `${sub}@example.com` }), 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

const OWNER = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie('account-1'))}`, 'content-type': 'application/json' };
const OTHER = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie('account-2'))}`, 'content-type': 'application/json' };

setSystemAuthSettings({ googleAuthEnabled: false });

const now = () => new Date().toISOString();

async function solidJpeg(width: number, height: number, background: string): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background } }).jpeg({ quality: 95 }).toBuffer();
}

async function seedPdf(pdfId: string, opts: { visibility?: 'private' | 'public' | 'public_editable'; renderType?: string; imageBg?: string } = {}): Promise<string> {
  const t = now();
  const uid = `${pdfId}-u1`;
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,progress_step,progress_current,progress_total,error_message,user_prompt,require_script_confirmation,owner_sub,visibility,tts_voice,tts_speed,script_max_chars_per_page,created_at,updated_at)
     VALUES (?,?,?,'ready',1,NULL,NULL,NULL,NULL,NULL,0,'account-1',?,NULL,NULL,NULL,?,?)`,
  ).run(pdfId, 't', `${pdfId}.pdf`, opts.visibility ?? 'private', t, t);
  db.prepare(
    `INSERT INTO pages (pdf_id,page_number,page_uid,image_path,text_path,script_path,audio_path,audio_duration_seconds,status,error_message,render_type,created_at,updated_at)
     VALUES (?,?,?,?,?,?,NULL,NULL,'audio_ready',NULL,?,?,?)`,
  ).run(pdfId, 1, uid, `pages/${uid}.jpg`, `pages/${uid}.text.txt`, `pages/${uid}.script.txt`, opts.renderType ?? 'static-image', t, t);
  fs.rmSync(pdfDir(pdfId), { recursive: true, force: true });
  fs.mkdirSync(pagesDir(pdfId), { recursive: true });
  fs.writeFileSync(pageImagePath(pdfId, uid), await solidJpeg(320, 180, opts.imageBg ?? '#ffffff'));
  return uid;
}

function cleanup(pdfId: string): void {
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  fs.rmSync(pdfDir(pdfId), { recursive: true, force: true });
}

async function pixelAt(jpeg: Buffer, x: number, y: number): Promise<[number, number, number]> {
  const { data, info } = await sharp(jpeg).raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * info.channels;
  return [data[i]!, data[i + 1]!, data[i + 2]!];
}

function near(actual: [number, number, number], expected: [number, number, number], tolerance = 24): boolean {
  return actual.every((c, i) => Math.abs(c - expected[i]!) <= tolerance);
}

function rect(id: string, extra: Partial<Extract<PageElement, { type: 'shape' }>> = {}): PageElement {
  return { id, type: 'shape', shape: 'rect', x: 0.25, y: 0.25, w: 0.5, h: 0.5, rotation: 0, opacity: 1, fill: '#ff0000', stroke: null, strokeWidth: 0, borderRadius: 0, ...extra };
}

function multipart(parts: Array<{ name: string; value?: string; filename?: string; type?: string; data?: Buffer }>): { payload: Buffer; contentType: string } {
  const boundary = '----makeslide-elements-test';
  const chunks: Buffer[] = [];
  for (const p of parts) {
    if (p.filename) {
      chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${p.name}"; filename="${p.filename}"\r\nContent-Type: ${p.type ?? 'application/octet-stream'}\r\n\r\n`));
      chunks.push(p.data ?? Buffer.alloc(0));
      chunks.push(Buffer.from('\r\n'));
    } else {
      chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${p.name}"\r\n\r\n${p.value ?? ''}\r\n`));
    }
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

// ─── Schema ─────────────────────────────────────────────────────────────────

test('element colour whitelist accepts hex6/hex8/rgba and rejects everything else', () => {
  assert.equal(isElementColor('#ff0000'), true);
  assert.equal(isElementColor('#FF000080'), true);
  assert.equal(isElementColor('rgba(10, 20, 30, 0.5)'), true);
  assert.equal(isElementColor('rgba(300, 0, 0, 1)'), false);
  assert.equal(isElementColor('red'), false);
  assert.equal(isElementColor('#fff'), false);
  assert.equal(isElementColor('hsl(0, 100%, 50%)'), false);
  assert.equal(isElementColor('var(--x)'), false);
  assert.equal(isElementColor('url(javascript:alert(1))'), false);
});

test('element schema fills defaults, rejects bad values, and caps the list', () => {
  const text = PageElementSchema.parse({ id: 'a1', type: 'text', x: 0.1, y: 0.1, w: 0.3, h: 0.1, text: 'hi' });
  assert.equal(text.type, 'text');
  if (text.type === 'text') {
    assert.equal(text.fontFamily, 'sans');
    assert.equal(text.fontSize, 48);
    assert.equal(text.opacity, 1);
  }
  assert.equal(PageElementSchema.safeParse({ id: 'a1', type: 'text', x: 0.1, y: 0.1, w: 0.3, h: 0.1, text: 'hi', color: 'red' }).success, false);
  assert.equal(PageElementSchema.safeParse({ id: 'a1', type: 'text', x: 0.1, y: 0.1, w: 0.3, h: 0.1, text: 'hi', fontSize: 4 }).success, false);
  assert.equal(PageElementSchema.safeParse({ id: 'a1', type: 'video', x: 0.1, y: 0.1, w: 0.3, h: 0.1 }).success, false);
  assert.equal(PageElementSchema.safeParse({ id: 'a1', type: 'image', x: 0, y: 0, w: 0.3, h: 0.1, asset: '../../etc/passwd' }).success, false);
  assert.equal(PageElementSchema.safeParse({ id: 'a1', type: 'image', x: 0, y: 0, w: 0.3, h: 0.1, asset: 'uid.el-abcdefgh.svg' }).success, false);
  assert.equal(PageElementSchema.safeParse({ id: 'a1', type: 'image', x: 0, y: 0, w: 0.3, h: 0.1, asset: 'uid.el-abcdefgh.png' }).success, true);
  const tooMany = Array.from({ length: 101 }, (_, i) => rect(`r${i}`));
  assert.equal(PageElementsArraySchema.safeParse(tooMany).success, false);
});

// ─── Rendering ──────────────────────────────────────────────────────────────

test('wrapText breaks CJK per character and Latin at spaces, splitting oversize words', () => {
  const measure = (s: string) => Array.from(s).length * 10;
  assert.deepEqual(wrapText(measure, '中文字換行測試', 40), ['中文字換', '行測試']);
  assert.deepEqual(wrapText(measure, 'hello wide world', 70), ['hello', 'wide', 'world']);
  assert.deepEqual(wrapText(measure, 'abcdefghij', 40), ['abcd', 'efgh', 'ij']);
  assert.deepEqual(wrapText(measure, 'a\nb', 100), ['a', 'b']);
});

test('renderPageElements paints a filled rectangle where the element says and leaves the rest alone', async () => {
  const dir = fs.mkdtempSync(`${config.storageRoot}/elements-render-`);
  const base = `${dir}/base.jpg`;
  fs.writeFileSync(base, await solidJpeg(200, 100, '#ffffff'));
  try {
    const out = await renderPageElements(base, [rect('r1', { x: 0.5, y: 0, w: 0.5, h: 1 })], () => null);
    const meta = await sharp(out).metadata();
    assert.equal(meta.width, 200);
    assert.equal(meta.height, 100);
    assert.ok(near(await pixelAt(out, 150, 50), [255, 0, 0]), 'inside the rectangle is red');
    assert.ok(near(await pixelAt(out, 50, 50), [255, 255, 255]), 'outside stays white');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('renderPageElements honours rotation, opacity, text and images', async () => {
  const dir = fs.mkdtempSync(`${config.storageRoot}/elements-render-`);
  const base = `${dir}/base.jpg`;
  fs.writeFileSync(base, await solidJpeg(200, 200, '#ffffff'));
  const assetPath = `${dir}/u.el-abcdefgh.png`;
  fs.writeFileSync(assetPath, await sharp({ create: { width: 10, height: 10, channels: 3, background: '#0000ff' } }).png().toBuffer());
  try {
    // A thin horizontal bar rotated 90° becomes a vertical bar through the centre.
    const rotated = await renderPageElements(base, [rect('r', { x: 0.05, y: 0.45, w: 0.9, h: 0.1, rotation: 90 })], () => null);
    assert.ok(near(await pixelAt(rotated, 100, 20), [255, 0, 0]), 'vertical bar reaches the top');
    assert.ok(near(await pixelAt(rotated, 20, 100), [255, 255, 255]), 'horizontal extent is gone');

    const half = await renderPageElements(base, [rect('r', { opacity: 0.5 })], () => null);
    const p = await pixelAt(half, 100, 100);
    assert.ok(p[0] > 200 && p[1] > 90 && p[1] < 170, `50% red over white is pink, got ${p.join(',')}`);

    const withText: PageElement[] = [
      { id: 't', type: 'text', x: 0, y: 0, w: 1, h: 0.5, rotation: 0, opacity: 1, text: '測試 Text', fontFamily: 'sans', fontSize: 120, bold: true, italic: false, underline: true, align: 'center', valign: 'middle', lineHeight: 1.2, color: '#000000', background: null, padding: 0, borderRadius: 0 },
    ];
    const text = await renderPageElements(base, withText, () => null);
    const { data } = await sharp(text).extract({ left: 0, top: 0, width: 200, height: 100 }).raw().toBuffer({ resolveWithObject: true });
    let dark = 0;
    for (let i = 0; i < data.length; i += 3) if (data[i]! < 128) dark++;
    assert.ok(dark > 50, `text painted dark pixels in its box (${dark})`);

    const image = await renderPageElements(
      base,
      [{ id: 'i', type: 'image', x: 0.5, y: 0.5, w: 0.5, h: 0.5, rotation: 0, opacity: 1, asset: 'u.el-abcdefgh.png', fit: 'fill', borderRadius: 0 }],
      (name) => (name === 'u.el-abcdefgh.png' ? assetPath : null),
    );
    assert.ok(near(await pixelAt(image, 150, 150), [0, 0, 255]), 'image asset drawn in its box');
    assert.ok(near(await pixelAt(image, 50, 50), [255, 255, 255]));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ─── Routes ─────────────────────────────────────────────────────────────────

test('PUT elements adopts the current picture as base, composes, and clearing restores it', async () => {
  const pdfId = 'elements-put-01';
  const uid = await seedPdf(pdfId, { imageBg: '#00ff00' });
  const originalBytes = fs.readFileSync(pageImagePath(pdfId, uid));
  const app = await buildApp();
  try {
    const put = await app.inject({ method: 'PUT', url: `/api/pdfs/${pdfId}/pages/1/elements`, headers: OWNER, payload: { elements: [rect('r1')] } });
    assert.equal(put.statusCode, 200, put.body);
    assert.equal((put.json() as { has_elements: boolean }).has_elements, true);
    assert.ok(fs.existsSync(pageBaseImagePath(pdfId, uid)), 'base image created');
    assert.ok(fs.existsSync(pageElementsPath(pdfId, uid)), 'elements file written');
    assert.ok(fs.existsSync(pageThumbnailPath(pdfId, uid)), 'thumbnail regenerated');
    assert.deepEqual(fs.readFileSync(pageBaseImagePath(pdfId, uid)), originalBytes, 'base is the original picture');
    const composite = fs.readFileSync(pageImagePath(pdfId, uid));
    assert.ok(near(await pixelAt(composite, 160, 90), [255, 0, 0]), 'composite shows the rectangle');
    assert.ok(near(await pixelAt(composite, 10, 10), [0, 255, 0]), 'composite keeps the base elsewhere');
    const row = db.prepare(`SELECT elements_path FROM pages WHERE pdf_id = ? AND page_number = 1`).get(pdfId) as { elements_path: string | null };
    assert.equal(row.elements_path, `pages/${uid}.elements.json`);

    // The regular image endpoint serves the composite; base-image serves the base.
    const image = await app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}/pages/1/image`, headers: OWNER });
    assert.equal(image.statusCode, 200);
    assert.ok(near(await pixelAt(image.rawPayload, 160, 90), [255, 0, 0]));
    const base = await app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}/pages/1/base-image`, headers: OWNER });
    assert.equal(base.statusCode, 200);
    assert.ok(near(await pixelAt(base.rawPayload, 160, 90), [0, 255, 0]));

    // Detail inlines the elements and the base-image URL.
    const detail = await app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}`, headers: OWNER });
    assert.equal(detail.statusCode, 200);
    const page = (detail.json() as { pages: Array<{ elements: unknown[] | null; base_image_url: string | null }> }).pages[0]!;
    assert.equal(page.elements?.length, 1);
    assert.equal(page.base_image_url, `api/pdfs/${pdfId}/pages/1/base-image`);

    // A second save re-composes from the base, not from the previous composite.
    const put2 = await app.inject({ method: 'PUT', url: `/api/pdfs/${pdfId}/pages/1/elements`, headers: OWNER, payload: { elements: [rect('r1', { x: 0, y: 0, w: 0.25, h: 0.25 })] } });
    assert.equal(put2.statusCode, 200, put2.body);
    const composite2 = fs.readFileSync(pageImagePath(pdfId, uid));
    assert.ok(near(await pixelAt(composite2, 160, 90), [0, 255, 0]), 'old rectangle gone');
    assert.ok(near(await pixelAt(composite2, 10, 10), [255, 0, 0]), 'new rectangle painted');

    // Clearing every element puts the base back and removes the layer files.
    const clear = await app.inject({ method: 'PUT', url: `/api/pdfs/${pdfId}/pages/1/elements`, headers: OWNER, payload: { elements: [] } });
    assert.equal(clear.statusCode, 200, clear.body);
    assert.equal((clear.json() as { has_elements: boolean }).has_elements, false);
    assert.equal(fs.existsSync(pageBaseImagePath(pdfId, uid)), false);
    assert.equal(fs.existsSync(pageElementsPath(pdfId, uid)), false);
    assert.deepEqual(fs.readFileSync(pageImagePath(pdfId, uid)), originalBytes, 'page image is the original again');
    const row2 = db.prepare(`SELECT elements_path FROM pages WHERE pdf_id = ? AND page_number = 1`).get(pdfId) as { elements_path: string | null };
    assert.equal(row2.elements_path, null);
    assert.equal(loadExportedPageElements(pdfId).length, 0);
  } finally {
    await app.close();
    cleanup(pdfId);
  }
});

test('PUT elements enforces permissions, page type, validation, and missing assets', async () => {
  const pdfId = 'elements-put-guard-01';
  await seedPdf(pdfId);
  const reactId = 'elements-put-guard-react';
  await seedPdf(reactId, { renderType: 'react' });
  const app = await buildApp();
  try {
    const forbidden = await app.inject({ method: 'PUT', url: `/api/pdfs/${pdfId}/pages/1/elements`, headers: OTHER, payload: { elements: [rect('r1')] } });
    assert.equal(forbidden.statusCode, 403);
    const readForbidden = await app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}/pages/1/elements`, headers: OTHER });
    assert.equal(readForbidden.statusCode, 403);
    const invalid = await app.inject({ method: 'PUT', url: `/api/pdfs/${pdfId}/pages/1/elements`, headers: OWNER, payload: { elements: [{ ...rect('r1'), fill: 'red' }] } });
    assert.equal(invalid.statusCode, 400);
    const missingAsset = await app.inject({
      method: 'PUT',
      url: `/api/pdfs/${pdfId}/pages/1/elements`,
      headers: OWNER,
      payload: { elements: [{ id: 'i', type: 'image', x: 0, y: 0, w: 0.5, h: 0.5, asset: `${pdfId}-u1.el-zzzzzzzz.png` }] },
    });
    assert.equal(missingAsset.statusCode, 400);
    assert.equal((missingAsset.json() as { error: { code: string } }).error.code, 'MISSING_ASSET');
    const react = await app.inject({ method: 'PUT', url: `/api/pdfs/${reactId}/pages/1/elements`, headers: OWNER, payload: { elements: [rect('r1')] } });
    assert.equal(react.statusCode, 409);
    assert.equal(fs.existsSync(pageBaseImagePath(pdfId, `${pdfId}-u1`)), false, 'nothing written on rejected saves');
    const empty = await app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}/pages/1/elements`, headers: OWNER });
    assert.equal(empty.statusCode, 200);
    assert.deepEqual((empty.json() as { elements: unknown[] }).elements, []);
  } finally {
    await app.close();
    cleanup(pdfId);
    cleanup(reactId);
  }
});

test('asset upload validates bytes, names the file by page uid, serves it, and drops orphans on save', async () => {
  const pdfId = 'elements-asset-01';
  const uid = await seedPdf(pdfId);
  const app = await buildApp();
  try {
    const png = await sharp({ create: { width: 20, height: 10, channels: 4, background: '#ff00ff' } }).png().toBuffer();
    const good = multipart([{ name: 'file', filename: 'logo.png', type: 'image/png', data: png }]);
    const upload = await app.inject({ method: 'POST', url: `/api/pdfs/${pdfId}/pages/1/elements/assets`, headers: { ...OWNER, 'content-type': good.contentType }, payload: good.payload });
    assert.equal(upload.statusCode, 201, upload.body);
    const { asset, width, height } = upload.json() as { asset: string; width: number; height: number };
    assert.match(asset, new RegExp(`^${uid}\\.el-[A-Za-z0-9_-]{8}\\.png$`));
    assert.equal(width, 20);
    assert.equal(height, 10);

    const served = await app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}/pages/1/elements/assets/${asset}`, headers: OWNER });
    assert.equal(served.statusCode, 200);
    assert.equal(served.headers['content-type'], 'image/png');
    assert.match(String(served.headers['cache-control']), /immutable/);

    const bad = multipart([{ name: 'file', filename: 'x.png', type: 'image/png', data: Buffer.from('not an image') }]);
    const rejected = await app.inject({ method: 'POST', url: `/api/pdfs/${pdfId}/pages/1/elements/assets`, headers: { ...OWNER, 'content-type': bad.contentType }, payload: bad.payload });
    assert.equal(rejected.statusCode, 400);
    const svg = multipart([{ name: 'file', filename: 'x.svg', type: 'image/svg+xml', data: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>') }]);
    const svgRejected = await app.inject({ method: 'POST', url: `/api/pdfs/${pdfId}/pages/1/elements/assets`, headers: { ...OWNER, 'content-type': svg.contentType }, payload: svg.payload });
    assert.equal(svgRejected.statusCode, 400);
    const forbidden = await app.inject({ method: 'POST', url: `/api/pdfs/${pdfId}/pages/1/elements/assets`, headers: { ...OTHER, 'content-type': good.contentType }, payload: good.payload });
    assert.equal(forbidden.statusCode, 403);

    // Name checks: traversal and a foreign page prefix both 404 / 400.
    const traversal = await app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}/pages/1/elements/assets/..%2F..%2Fmetadata.json`, headers: OWNER });
    assert.notEqual(traversal.statusCode, 200);
    const foreign = await app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}/pages/1/elements/assets/other-uid.el-abcdefgh.png`, headers: OWNER });
    assert.equal(foreign.statusCode, 404);

    // Use the asset, then save without it: the orphan is removed.
    const withImage = await app.inject({
      method: 'PUT',
      url: `/api/pdfs/${pdfId}/pages/1/elements`,
      headers: OWNER,
      payload: { elements: [{ id: 'i', type: 'image', x: 0.5, y: 0.5, w: 0.5, h: 0.5, asset, fit: 'fill' }] },
    });
    assert.equal(withImage.statusCode, 200, withImage.body);
    const composite = fs.readFileSync(pageImagePath(pdfId, uid));
    assert.ok(near(await pixelAt(composite, 300, 170), [255, 0, 255]), 'uploaded asset appears in the composite');
    const without = await app.inject({ method: 'PUT', url: `/api/pdfs/${pdfId}/pages/1/elements`, headers: OWNER, payload: { elements: [rect('r1')] } });
    assert.equal(without.statusCode, 200, without.body);
    assert.equal(fs.existsSync(`${pagesDir(pdfId)}/${asset}`), false, 'orphan asset deleted');
  } finally {
    await app.close();
    cleanup(pdfId);
  }
});

test('replace-image keeps elements on a new base by default and fuses them on mode=fuse', async () => {
  const pdfId = 'elements-replace-01';
  const uid = await seedPdf(pdfId, { imageBg: '#ffffff' });
  const app = await buildApp();
  try {
    const put = await app.inject({ method: 'PUT', url: `/api/pdfs/${pdfId}/pages/1/elements`, headers: OWNER, payload: { elements: [rect('r1', { x: 0, y: 0, w: 0.2, h: 0.2 })] } });
    assert.equal(put.statusCode, 200, put.body);

    const blue = await solidJpeg(320, 180, '#0000ff');
    const baseForm = multipart([{ name: 'file', filename: 'bg.jpg', type: 'image/jpeg', data: blue }]);
    const replaceBase = await app.inject({ method: 'POST', url: `/api/pdfs/${pdfId}/pages/1/replace-image`, headers: { ...OWNER, 'content-type': baseForm.contentType }, payload: baseForm.payload });
    assert.equal(replaceBase.statusCode, 200, replaceBase.body);
    assert.ok(fs.existsSync(pageElementsPath(pdfId, uid)), 'elements survive a base replacement');
    // replace-image normalises uploads to 1920×1080, so the composite is that size now.
    const composite = fs.readFileSync(pageImagePath(pdfId, uid));
    assert.equal((await sharp(composite).metadata()).width, 1920);
    assert.ok(near(await pixelAt(composite, 30, 20), [255, 0, 0]), 'rectangle re-composed onto the new base');
    assert.ok(near(await pixelAt(composite, 1900, 1000), [0, 0, 255]), 'new base visible');
    const baseServed = await app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}/pages/1/base-image`, headers: OWNER });
    assert.ok(near(await pixelAt(baseServed.rawPayload, 30, 20), [0, 0, 255]), 'base itself has no rectangle');

    const green = await solidJpeg(320, 180, '#00ff00');
    const fuseForm = multipart([{ name: 'mode', value: 'fuse' }, { name: 'file', filename: 'ai.jpg', type: 'image/jpeg', data: green }]);
    const fuse = await app.inject({ method: 'POST', url: `/api/pdfs/${pdfId}/pages/1/replace-image`, headers: { ...OWNER, 'content-type': fuseForm.contentType }, payload: fuseForm.payload });
    assert.equal(fuse.statusCode, 200, fuse.body);
    assert.equal(fs.existsSync(pageElementsPath(pdfId, uid)), false, 'elements dropped');
    assert.equal(fs.existsSync(pageBaseImagePath(pdfId, uid)), false, 'base dropped');
    const fused = fs.readFileSync(pageImagePath(pdfId, uid));
    assert.ok(near(await pixelAt(fused, 30, 20), [0, 255, 0]), 'the AI picture is the page as delivered');
    const row = db.prepare(`SELECT elements_path FROM pages WHERE pdf_id = ? AND page_number = 1`).get(pdfId) as { elements_path: string | null };
    assert.equal(row.elements_path, null);
  } finally {
    await app.close();
    cleanup(pdfId);
  }
});

test('deleting a page removes its element layer files', async () => {
  const pdfId = 'elements-delete-01';
  const t = now();
  const uid = await seedPdf(pdfId);
  db.prepare(`UPDATE pdfs SET page_count = 2 WHERE id = ?`).run(pdfId);
  db.prepare(
    `INSERT INTO pages (pdf_id,page_number,page_uid,image_path,text_path,script_path,audio_path,audio_duration_seconds,status,error_message,created_at,updated_at)
     VALUES (?,?,?,?,?,?,NULL,NULL,'audio_ready',NULL,?,?)`,
  ).run(pdfId, 2, `${pdfId}-u2`, `pages/${pdfId}-u2.jpg`, `pages/${pdfId}-u2.text.txt`, `pages/${pdfId}-u2.script.txt`, t, t);
  fs.writeFileSync(pageImagePath(pdfId, `${pdfId}-u2`), await solidJpeg(320, 180, '#ffffff'));
  const app = await buildApp();
  try {
    const put = await app.inject({ method: 'PUT', url: `/api/pdfs/${pdfId}/pages/1/elements`, headers: OWNER, payload: { elements: [rect('r1')] } });
    assert.equal(put.statusCode, 200, put.body);
    const del = await app.inject({ method: 'DELETE', url: `/api/pdfs/${pdfId}/pages/1`, headers: OWNER });
    assert.equal(del.statusCode, 200, del.body);
    assert.equal(fs.existsSync(pageElementsPath(pdfId, uid)), false);
    assert.equal(fs.existsSync(pageBaseImagePath(pdfId, uid)), false);
  } finally {
    await app.close();
    cleanup(pdfId);
  }
});

test('share token readers can fetch elements and base image but not save', async () => {
  const pdfId = 'elements-share-01';
  await seedPdf(pdfId, { visibility: 'private' });
  const token = 'elements-share-token-01';
  db.prepare(`DELETE FROM pdf_shares WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`INSERT INTO pdf_shares (pdf_id, token, access, created_at, updated_at) VALUES (?, ?, 'read_only', ?, ?)`).run(pdfId, token, now(), now());
  const app = await buildApp();
  try {
    const put = await app.inject({ method: 'PUT', url: `/api/pdfs/${pdfId}/pages/1/elements`, headers: OWNER, payload: { elements: [rect('r1')] } });
    assert.equal(put.statusCode, 200, put.body);
    const anon = { 'content-type': 'application/json' };
    assert.equal((await app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}/pages/1/elements`, headers: anon })).statusCode, 403);
    assert.equal((await app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}/pages/1/elements?share=${token}`, headers: anon })).statusCode, 200);
    assert.equal((await app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}/pages/1/base-image?share=${token}`, headers: anon })).statusCode, 200);
    assert.equal((await app.inject({ method: 'PUT', url: `/api/pdfs/${pdfId}/pages/1/elements?share=${token}`, headers: anon, payload: { elements: [] } })).statusCode, 403);
  } finally {
    await app.close();
    db.prepare(`DELETE FROM pdf_shares WHERE pdf_id = ?`).run(pdfId);
    cleanup(pdfId);
  }
});

// ─── Markdown text + lines ──────────────────────────────────────────────────

test('renderMarkdownMathHtml nests lists by indentation like the frontend component', () => {
  assert.equal(
    renderMarkdownMathHtml('- 甲\n  - 甲一\n    - 甲一 a\n- 乙\n\n1. 第一\n   - 細節\n2. 第二'),
    '<div class="md"><ul><li>甲<ul><li>甲一<ul><li>甲一 a</li></ul></li></ul></li><li>乙</li></ul><ol><li>第一<ul><li>細節</li></ul></li><li>第二</li></ol></div>',
  );
  assert.equal(markdownToPlainText('- 甲\n  - 甲一'), '• 甲\n  • 甲一', 'the plain-text projection keeps the indentation');
});

test('renderMarkdownMathHtml renders the shared dialect, escapes text, and keeps unsafe links as text', () => {
  const html = renderMarkdownMathHtml('# 標題\n- **粗** *斜* `code` [站](https://example.com) [x](javascript:alert(1))\n\n<b>raw</b> $E=mc^2$\n\n$$\\int_0^1 x\\,dx$$\n\n| a | b |\n|---|---|\n| 1 | 2 |');
  assert.match(html, /<h3>標題<\/h3>/);
  assert.match(html, /<li><strong>粗<\/strong> <em>斜<\/em> <code>code<\/code> <a href="https:\/\/example.com">站<\/a> \[x\]\(javascript:alert\(1\)\)<\/li>/);
  assert.match(renderMarkdownMathHtml('[x](javascript:alert)'), /^<div class="md"><p><span>\[x\]\(javascript:alert\)<\/span><\/p><\/div>$/, 'a matched link with an unsafe scheme stays literal text');
  assert.match(html, /&lt;b&gt;raw&lt;\/b&gt;/, 'raw HTML is escaped, never emitted');
  assert.match(html, /class="katex"/, 'inline math rendered by KaTeX');
  assert.match(html, /class="md-math"><span class="katex-display">/, 'block math rendered in display mode');
  assert.match(html, /<table><thead><tr><th>a<\/th><th>b<\/th><\/tr><\/thead><tbody><tr><td>1<\/td><td>2<\/td><\/tr><\/tbody><\/table>/);
  assert.equal(safeMarkdownLinkHref('data:text/html,x'), null);
  assert.equal(safeMarkdownLinkHref('/deck/1'), '/deck/1');
  assert.equal(containsMath('plain'), false);
  assert.equal(containsMath('a $x$'), true);
});

test('markdownToPlainText strips markup for the no-browser fallback', () => {
  assert.equal(markdownToPlainText('# Title\n- **bold** and *it* `c` [link](https://x.y)\n1. one\n$$a+b$$\nend $x^2$'), 'Title\n• bold and it c link\n1. one\n\na+b\n\nend x^2');
  assert.equal(markdownToPlainText('| a | b |\n|---|---|\n| 1 | 2 |'), 'a | b\n1 | 2');
});

test('fenced code blocks render literally in the HTML and keep their lines in the plain-text fallback', () => {
  const src = '# T\n```py\n    x = 1  # *not* a heading\n<b>$a$</b>\n```\nafter';
  assert.equal(
    renderMarkdownMathHtml(src),
    '<div class="md"><h3>T</h3><pre><code>    x = 1  # *not* a heading\n&lt;b&gt;$a$&lt;/b&gt;</code></pre><p>after</p></div>',
  );
  assert.equal(markdownToPlainText(src), 'T\n    x = 1  # *not* a heading\n<b>$a$</b>\nafter');
  assert.equal(renderMarkdownMathHtml('~~~\nopen to the end\n# still code'), '<div class="md"><pre><code>open to the end\n# still code</code></pre></div>');
});

test('the compose document places every element with the same CSS as the screen and only ships KaTeX when needed', () => {
  const base = 'data:image/jpeg;base64,AAAA';
  const noMath = buildPageElementsDocument({
    width: 1920, height: 1080, baseDataUrl: base, assetDataUrls: { 'u.el-abcdefgh.png': 'data:image/png;base64,BBBB' },
    elements: [
      { id: 't', type: 'text', x: 0.1, y: 0.2, w: 0.5, h: 0.3, rotation: 15, opacity: 0.9, text: '# Hi **there**', fontFamily: 'serif', fontSize: 40, bold: false, italic: true, underline: false, align: 'center', valign: 'middle', lineHeight: 1.4, color: '#ff0000', background: '#00000080', padding: 10, borderRadius: 12 },
      { id: 'i', type: 'image', x: 0, y: 0, w: 0.2, h: 0.2, rotation: 0, opacity: 1, asset: 'u.el-abcdefgh.png', fit: 'cover', borderRadius: 4 },
      { id: 's', type: 'shape', x: 0.5, y: 0.5, w: 0.2, h: 0.2, rotation: 0, opacity: 1, shape: 'star', fill: '#00ff00', stroke: '#000000', strokeWidth: 3, borderRadius: 0 },
      { id: 'l', type: 'line', x1: 0.1, y1: 0.1, x2: 0.9, y2: 0.4, stroke: '#0000ff', strokeWidth: 8, arrowStart: false, arrowEnd: true, opacity: 1 },
    ],
  });
  assert.match(noMath, /left:10\.0000%;top:20\.0000%;width:50\.0000%;height:30\.0000%;opacity:0\.9;transform:rotate\(15deg\)/);
  assert.match(noMath, /font-size:40px/, 'reference px × (1080/1080)');
  assert.match(noMath, /<h3>Hi <strong>there<\/strong><\/h3>/);
  assert.match(noMath, /object-fit:cover/);
  assert.match(noMath, /<polygon points="/);
  assert.match(noMath, /<line x1="192" y1="108" x2="1728" y2="432" stroke="#0000ff" stroke-width="8"[^>]*marker-end="url\(#ah0e\)"/);
  assert.match(noMath, /\.ms-el-md h3 \{ font-size: 1\.5em/);
  assert.doesNotMatch(noMath, /\.katex-display\{/, 'no KaTeX stylesheet without math');
  assert.match(noMath, /window\.__msSlideReady = true/);

  const withMath = buildPageElementsDocument({
    width: 1536, height: 1024, baseDataUrl: base, assetDataUrls: {},
    elements: [{ id: 't', type: 'text', x: 0, y: 0, w: 1, h: 1, rotation: 0, opacity: 1, text: 'sum $\\sum_i x_i$', fontFamily: 'sans', fontSize: 54, bold: false, italic: false, underline: false, align: 'left', valign: 'top', lineHeight: 1.3, color: '#000000', background: null, padding: 0, borderRadius: 0 }],
  });
  assert.match(withMath, /class="katex"/);
  assert.match(withMath, /font-size:51\.2px/, '54 × (1024/1080)');
  const katexCss = katexCssWithInlineFonts();
  assert.ok(katexCss.includes('data:font/woff2;base64,'), 'KaTeX fonts are inlined');
  assert.doesNotMatch(katexCss, /url\(fonts\//, 'no relative font URLs survive');
  assert.ok(withMath.includes(katexCss.slice(0, 200)));
});

test('the canvas fallback draws lines between their two ends and text as plain text', async () => {
  const dir = fs.mkdtempSync(`${config.storageRoot}/elements-render-`);
  const base = `${dir}/base.jpg`;
  fs.writeFileSync(base, await solidJpeg(200, 200, '#ffffff'));
  try {
    const out = await renderPageElements(base, [{ id: 'l', type: 'line', x1: 0.1, y1: 0.5, x2: 0.9, y2: 0.5, stroke: '#ff0000', strokeWidth: 20, arrowStart: false, arrowEnd: true, opacity: 1 }], () => null);
    assert.ok(near(await pixelAt(out, 100, 100), [255, 0, 0]), 'the middle of the line is red');
    assert.ok(near(await pixelAt(out, 100, 40), [255, 255, 255]), 'above the line is untouched');
    assert.ok(near(await pixelAt(out, 172, 100), [255, 0, 0]), 'the arrow head reaches the end');
    const diagonal = await renderPageElements(base, [{ id: 'l', type: 'line', x1: 0, y1: 0, x2: 1, y2: 1, stroke: '#0000ff', strokeWidth: 20, arrowStart: false, arrowEnd: false, opacity: 1 }], () => null);
    assert.ok(near(await pixelAt(diagonal, 100, 100), [0, 0, 255]));
    assert.ok(near(await pixelAt(diagonal, 150, 50), [255, 255, 255]));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
