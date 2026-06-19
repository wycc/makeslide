import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';
import { saveSplitPageFigureMap } from '../src/services/pdfFigures';
import crypto from 'node:crypto';

setSystemAuthSettings({ googleAuthEnabled: false });

function testSessionCookie(sub = 'account-1'): string {
  const payload = Buffer.from(JSON.stringify({ provider: 'google', sub, email: `${sub}@example.com` }), 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}
const SESSION_COOKIE = testSessionCookie('account-1');
const AUTH_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(SESSION_COOKIE)}` };
const OTHER_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie('account-2'))}` };

function nowIso(): string {
  return new Date().toISOString();
}

/** Seeds a PDF with `pageCount` ready pages and a `figures.json` manifest covering pages 1-2. */
function seedFigurePdf(pdfId: string, pageCount: number, visibility: 'private' | 'public' | 'public_editable' = 'public'): void {
  const t = nowIso();
  db.prepare(`DELETE FROM pdf_shares WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,progress_step,progress_current,progress_total,error_message,user_prompt,require_script_confirmation,owner_sub,visibility,tts_voice,tts_speed,script_max_chars_per_page,created_at,updated_at)
     VALUES (?,?,?,'ready',?,NULL,NULL,NULL,NULL,NULL,0,'account-1',?,NULL,NULL,NULL,?,?)`,
  ).run(pdfId, 't', 't.pdf', pageCount, visibility, t, t);

  const pdfDir = path.join(config.storageRoot, pdfId);
  const pagesDir = path.join(pdfDir, 'pages');
  const figuresDir = path.join(pdfDir, 'figures');
  fs.mkdirSync(pagesDir, { recursive: true });
  fs.mkdirSync(figuresDir, { recursive: true });
  for (let i = 1; i <= pageCount; i++) {
    const uid = `figuid${i}`;
    db.prepare(
      `INSERT INTO pages (pdf_id,page_number,page_uid,image_path,text_path,script_path,audio_path,audio_duration_seconds,status,error_message,created_at,updated_at)
       VALUES (?,?,?,?,?,?,NULL,NULL,'audio_ready',NULL,?,?)`,
    ).run(pdfId, i, uid, `pages/${uid}.jpg`, `pages/${uid}.text.txt`, `pages/${uid}.script.txt`, t, t);
    fs.writeFileSync(path.join(pagesDir, `${uid}.jpg`), Buffer.from([0xff, 0xd8, 0xff]));
  }

  fs.writeFileSync(path.join(figuresDir, 'p1-large.png'), Buffer.from([137, 80, 78, 71, 1]));
  fs.writeFileSync(path.join(figuresDir, 'p1-small.png'), Buffer.from([137, 80, 78, 71, 2]));
  fs.writeFileSync(path.join(figuresDir, 'p2-vec.png'), Buffer.from([137, 80, 78, 71, 3]));

  fs.writeFileSync(
    path.join(pdfDir, 'figures.json'),
    JSON.stringify({
      pdfId,
      generatedAt: t,
      pages: [
        {
          pageNumber: 1,
          figures: [
            {
              id: 'p1-large',
              imagePath: 'figures/p1-large.png',
              width: 200,
              height: 200,
              bbox: { xPct: 0.1, yPct: 0.1, widthPct: 0.6, heightPct: 0.6 },
              caption: 'Figure 1: 營收成長',
              context: 'Figure 1: 營收成長，2020-2025',
            },
            {
              id: 'p1-small',
              imagePath: 'figures/p1-small.png',
              width: 50,
              height: 50,
              bbox: { xPct: 0.7, yPct: 0.7, widthPct: 0.1, heightPct: 0.1 },
              caption: null,
              context: null,
            },
          ],
        },
        {
          pageNumber: 2,
          figures: [
            {
              id: 'p2-vec',
              imagePath: 'figures/p2-vec.png',
              width: 120,
              height: 120,
              bbox: { xPct: 0.2, yPct: 0.2, widthPct: 0.4, heightPct: 0.4 },
              caption: 'Figure 2: 使用者成長',
              context: 'Figure 2: 使用者成長，2020-2025',
              source: 'vector',
            },
          ],
        },
      ],
    }),
    'utf8',
  );
}

function cleanup(pdfId: string): void {
  db.prepare(`DELETE FROM pdf_shares WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  fs.rmSync(path.join(config.storageRoot, pdfId), { recursive: true, force: true });
}

function seedShareToken(pdfId: string, token: string, access: 'read_only' | 'editable' = 'read_only'): void {
  const t = nowIso();
  db.prepare(`INSERT INTO pdf_shares (pdf_id, token, access, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run(pdfId, token, access, t, t);
}

test('GET /pages/:n/figures lists extracted figures with image URLs and exclusion state', async () => {
  const pdfId = 'test-figure-assets-list-01';
  cleanup(pdfId);
  seedFigurePdf(pdfId, 2);
  const app = await buildApp();
  try {
    const resp = await app.inject({
      method: 'GET',
      url: `/api/pdfs/${pdfId}/pages/1/figures`,
      headers: AUTH_HEADERS,
    });
    assert.equal(resp.statusCode, 200);
    const body = resp.json() as {
      page_number: number;
      source_pdf_pages: number[];
      figures: Array<{ id: string; caption: string | null; source: string; image_url: string; excluded: boolean }>;
    };
    assert.equal(body.page_number, 1);
    assert.deepEqual(body.source_pdf_pages, [1]);
    assert.equal(body.figures.length, 2);

    const large = body.figures.find((f) => f.id === 'p1-large');
    assert.ok(large);
    assert.equal(large!.caption, 'Figure 1: 營收成長');
    assert.equal(large!.source, 'raster');
    assert.equal(large!.excluded, false);
    assert.equal(large!.image_url, `api/pdfs/${pdfId}/figures/p1-large/image`);

    const small = body.figures.find((f) => f.id === 'p1-small');
    assert.ok(small);
    assert.equal(small!.caption, null);
    assert.equal(small!.excluded, false);
  } finally {
    await app.close();
    cleanup(pdfId);
  }
});

test('PUT /pages/:n/figures/selection persists exclusions reflected by subsequent GET', async () => {
  const pdfId = 'test-figure-assets-selection-01';
  cleanup(pdfId);
  seedFigurePdf(pdfId, 2);
  const app = await buildApp();
  try {
    const putResp = await app.inject({
      method: 'PUT',
      url: `/api/pdfs/${pdfId}/pages/1/figures/selection`,
      headers: { ...AUTH_HEADERS, 'content-type': 'application/json' },
      payload: { excluded: ['p1-large', 'p1-large'] },
    });
    assert.equal(putResp.statusCode, 200);
    const putBody = putResp.json() as { page_number: number; excluded: string[] };
    assert.equal(putBody.page_number, 1);
    assert.deepEqual(putBody.excluded, ['p1-large']);

    const getResp = await app.inject({
      method: 'GET',
      url: `/api/pdfs/${pdfId}/pages/1/figures`,
      headers: AUTH_HEADERS,
    });
    const body = getResp.json() as { figures: Array<{ id: string; excluded: boolean }> };
    assert.equal(body.figures.find((f) => f.id === 'p1-large')?.excluded, true);
    assert.equal(body.figures.find((f) => f.id === 'p1-small')?.excluded, false);

    // Saving an empty selection clears all exclusions again.
    await app.inject({
      method: 'PUT',
      url: `/api/pdfs/${pdfId}/pages/1/figures/selection`,
      headers: { ...AUTH_HEADERS, 'content-type': 'application/json' },
      payload: { excluded: [] },
    });
    const getResp2 = await app.inject({
      method: 'GET',
      url: `/api/pdfs/${pdfId}/pages/1/figures`,
      headers: AUTH_HEADERS,
    });
    const body2 = getResp2.json() as { figures: Array<{ id: string; excluded: boolean }> };
    assert.ok(body2.figures.every((f) => !f.excluded));
  } finally {
    await app.close();
    cleanup(pdfId);
  }
});

test('GET /pages/:n/figures aggregates across source PDF pages via the split-figure-map', async () => {
  const pdfId = 'test-figure-assets-split-01';
  cleanup(pdfId);
  seedFigurePdf(pdfId, 1);
  saveSplitPageFigureMap(pdfId, { 1: [1, 2] });
  const app = await buildApp();
  try {
    const resp = await app.inject({
      method: 'GET',
      url: `/api/pdfs/${pdfId}/pages/1/figures`,
      headers: AUTH_HEADERS,
    });
    assert.equal(resp.statusCode, 200);
    const body = resp.json() as { source_pdf_pages: number[]; figures: Array<{ id: string }> };
    assert.deepEqual(body.source_pdf_pages, [1, 2]);
    assert.deepEqual(body.figures.map((f) => f.id).sort(), ['p1-large', 'p1-small', 'p2-vec']);
  } finally {
    await app.close();
    cleanup(pdfId);
  }
});

test('GET /pages/:n/figures and PUT selection return 404 for an unknown page', async () => {
  const pdfId = 'test-figure-assets-404-page-01';
  cleanup(pdfId);
  seedFigurePdf(pdfId, 1);
  const app = await buildApp();
  try {
    const getResp = await app.inject({
      method: 'GET',
      url: `/api/pdfs/${pdfId}/pages/99/figures`,
      headers: AUTH_HEADERS,
    });
    assert.equal(getResp.statusCode, 404);
    assert.equal((getResp.json() as { error: { code: string } }).error.code, 'PAGE_NOT_FOUND');

    const putResp = await app.inject({
      method: 'PUT',
      url: `/api/pdfs/${pdfId}/pages/99/figures/selection`,
      headers: { ...AUTH_HEADERS, 'content-type': 'application/json' },
      payload: { excluded: [] },
    });
    assert.equal(putResp.statusCode, 404);
    assert.equal((putResp.json() as { error: { code: string } }).error.code, 'PAGE_NOT_FOUND');
  } finally {
    await app.close();
    cleanup(pdfId);
  }
});

test('GET /figures/:figureId/image streams the figure PNG, and 404s for unknown or missing files', async () => {
  const pdfId = 'test-figure-assets-image-01';
  cleanup(pdfId);
  seedFigurePdf(pdfId, 1);
  const app = await buildApp();
  try {
    const resp = await app.inject({
      method: 'GET',
      url: `/api/pdfs/${pdfId}/figures/p1-large/image`,
      headers: AUTH_HEADERS,
    });
    assert.equal(resp.statusCode, 200);
    assert.equal(resp.headers['content-type'], 'image/png');
    assert.deepEqual(resp.rawPayload, Buffer.from([137, 80, 78, 71, 1]));

    const unknown = await app.inject({
      method: 'GET',
      url: `/api/pdfs/${pdfId}/figures/does-not-exist/image`,
      headers: AUTH_HEADERS,
    });
    assert.equal(unknown.statusCode, 404);
    assert.equal((unknown.json() as { error: { code: string } }).error.code, 'FIGURE_NOT_FOUND');

    // Manifest entry exists but the PNG file is missing on disk.
    fs.rmSync(path.join(config.storageRoot, pdfId, 'figures', 'p1-small.png'));
    const missingFile = await app.inject({
      method: 'GET',
      url: `/api/pdfs/${pdfId}/figures/p1-small/image`,
      headers: AUTH_HEADERS,
    });
    assert.equal(missingFile.statusCode, 404);
    assert.equal((missingFile.json() as { error: { code: string } }).error.code, 'FIGURE_NOT_FOUND');
  } finally {
    await app.close();
    cleanup(pdfId);
  }
});

test('GET figure assets reject non-owner private reads, but allow owner and share token', async () => {
  const pdfId = 'fig-read-perm-01';
  const token = 'figure-share-token-01';
  cleanup(pdfId);
  seedFigurePdf(pdfId, 1, 'private');
  seedShareToken(pdfId, token, 'read_only');
  const app = await buildApp();
  try {
    const forbiddenList = await app.inject({
      method: 'GET',
      url: `/api/pdfs/${pdfId}/pages/1/figures`,
      headers: OTHER_HEADERS,
    });
    assert.equal(forbiddenList.statusCode, 403);
    assert.equal((forbiddenList.json() as { error: { code: string } }).error.code, 'FORBIDDEN');

    const ownerList = await app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}/pages/1/figures`, headers: AUTH_HEADERS });
    assert.equal(ownerList.statusCode, 200);

    const shareList = await app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}/pages/1/figures?share=${token}` });
    assert.equal(shareList.statusCode, 200);

    const forbiddenImage = await app.inject({
      method: 'GET',
      url: `/api/pdfs/${pdfId}/figures/p1-large/image`,
      headers: OTHER_HEADERS,
    });
    assert.equal(forbiddenImage.statusCode, 403);
    assert.equal((forbiddenImage.json() as { error: { code: string } }).error.code, 'FORBIDDEN');

    const ownerImage = await app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}/figures/p1-large/image`, headers: AUTH_HEADERS });
    assert.equal(ownerImage.statusCode, 200);

    const shareImage = await app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}/figures/p1-large/image?share=${token}` });
    assert.equal(shareImage.statusCode, 200);
  } finally {
    await app.close();
    cleanup(pdfId);
  }
});
