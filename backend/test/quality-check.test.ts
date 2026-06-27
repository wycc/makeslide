import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';
import { summarizeQualityResults } from '../src/routes/pdfs/quality-check';

setSystemAuthSettings({ googleAuthEnabled: false });

function testSessionCookie(sub = 'owner-qc'): string {
  const payload = Buffer.from(JSON.stringify({ provider: 'google', sub, email: `${sub}@example.com` }), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

const OWNER_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie('owner-qc'))}` };

function nowIso() { return new Date().toISOString(); }

/**
 * Seed a PDF whose pages are at the terminal page status 'audio_ready' (the
 * state the pipeline actually leaves completed pages in) with no artifact
 * paths, so quality-check reports missing image/audio/script for each page.
 */
function seedPdf(id: string, opts: { ownerSub?: string | null; visibility?: string; pageCount?: number; pageStatus?: string } = {}): void {
  const t = nowIso();
  const pageCount = opts.pageCount ?? 2;
  const pageStatus = opts.pageStatus ?? 'audio_ready';
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(id);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(id);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,owner_sub,visibility,created_at,updated_at)
     VALUES (?,?,?,'ready',?,?,?,?,?)`,
  ).run(id, `PDF ${id}`, `${id}.pdf`, pageCount, opts.ownerSub ?? 'owner-qc', opts.visibility ?? 'private', t, t);
  for (let i = 1; i <= pageCount; i++) {
    db.prepare(
      `INSERT INTO pages (pdf_id,page_number,page_uid,status,created_at,updated_at)
       VALUES (?,?,?,?,?,?)`,
    ).run(id, i, `uid-qc-${id}-${i}`, pageStatus, t, t);
  }
}

function cleanup(id: string): void {
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(id);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(id);
}

// Regression test for the bug where the route filtered on `status = 'ready'`,
// which is a PDF-level status never set on pages — so audio_ready pages (the
// real completed state) were silently skipped and nothing was ever checked.
test('GET /api/pdfs/:id/quality-check inspects audio_ready pages (regression)', async () => {
  const id = `qc-${Date.now()}`;
  seedPdf(id, { pageCount: 2, pageStatus: 'audio_ready' });
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'GET', url: `/api/pdfs/${id}/quality-check`, headers: OWNER_HEADERS });
    assert.equal(res.statusCode, 200, `expected 200 but got ${res.statusCode}: ${res.body.slice(0, 200)}`);
    const body = JSON.parse(res.body) as {
      pages: Array<{ pageNumber: number; issues: Array<{ code: string }> }>;
      summary: { pagesChecked: number; pagesWithIssues: number; totalIssues: number };
      checkedAt: string;
    };
    assert.equal(body.pages.length, 2, 'both audio_ready pages should be inspected');
    const codes = body.pages[0].issues.map((x) => x.code);
    assert.ok(codes.includes('missing_image'), 'missing image artifact should be flagged');
    assert.ok(codes.includes('missing_audio'), 'missing audio artifact should be flagged');
    assert.ok(codes.includes('missing_script'), 'missing script artifact should be flagged');
    assert.ok(typeof body.checkedAt === 'string');
    // Summary rolls up the badge counts: 2 pages inspected, both flagged, 3 issues each.
    assert.deepEqual(body.summary, { pagesChecked: 2, pagesWithIssues: 2, totalIssues: 6 });
  } finally {
    cleanup(id);
    await app.close();
  }
});

test('GET /api/pdfs/:id/quality-check ignores non-completed (e.g. rendered) pages', async () => {
  const id = `qc-rendered-${Date.now()}`;
  seedPdf(id, { pageCount: 2, pageStatus: 'rendered' });
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'GET', url: `/api/pdfs/${id}/quality-check`, headers: OWNER_HEADERS });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body) as { pages: unknown[]; summary: { pagesChecked: number; pagesWithIssues: number; totalIssues: number } };
    assert.deepEqual(body.pages, [], 'pages that are not audio_ready should not be inspected');
    assert.deepEqual(body.summary, { pagesChecked: 0, pagesWithIssues: 0, totalIssues: 0 });
  } finally {
    cleanup(id);
    await app.close();
  }
});

test('summarizeQualityResults rolls up page/issue counts', () => {
  // two flagged pages with 2 + 1 issues, out of 5 inspected
  assert.deepEqual(
    summarizeQualityResults(
      [
        { pageNumber: 1, issues: [{ code: 'missing_image' }, { code: 'missing_audio' }] },
        { pageNumber: 4, issues: [{ code: 'empty_script' }] },
      ],
      5,
    ),
    { pagesChecked: 5, pagesWithIssues: 2, totalIssues: 3 },
  );
  // no flagged pages -> all zero except the inspected count
  assert.deepEqual(summarizeQualityResults([], 3), { pagesChecked: 3, pagesWithIssues: 0, totalIssues: 0 });
});

test('GET /api/pdfs/:id/quality-check returns 404 for unknown PDF', async () => {
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'GET', url: '/api/pdfs/nonexistent-qc/quality-check', headers: OWNER_HEADERS });
    assert.equal(res.statusCode, 404);
  } finally {
    await app.close();
  }
});

test('GET /api/pdfs/:id/quality-check returns 403 for private PDF without auth', async () => {
  const id = `qc-priv-${Date.now()}`;
  seedPdf(id, { ownerSub: 'other-owner', visibility: 'private' });
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'GET', url: `/api/pdfs/${id}/quality-check` });
    assert.equal(res.statusCode, 403);
  } finally {
    cleanup(id);
    await app.close();
  }
});
