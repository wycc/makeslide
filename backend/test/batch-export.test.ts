import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';

setSystemAuthSettings({ googleAuthEnabled: false });

function testSessionCookie(sub: string): string {
  const payload = Buffer.from(JSON.stringify({ provider: 'google', sub, email: `${sub}@example.com` }), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function ownerHeaders(sub: string) {
  return { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie(sub))}` };
}

function nowIso() { return new Date().toISOString(); }

function seedPdf(id: string, ownerSub: string, status = 'ready'): void {
  const t = nowIso();
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(id);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,owner_sub,visibility,created_at,updated_at)
     VALUES (?,?,?,?,1,?,'private',?,?)`,
  ).run(id, `PDF ${id}`, `${id}.pdf`, status, ownerSub, t, t);
}

function cleanup(id: string): void {
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(id);
}

test('POST /api/export/batch returns 403 when not authenticated', async () => {
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'POST', url: '/api/export/batch' });
    assert.equal(res.statusCode, 403);
  } finally {
    await app.close();
  }
});

test('POST /api/export/batch returns jobId and status running for authenticated user', async () => {
  const sub = `batch-owner-${crypto.randomUUID()}`;
  const pdfId = `batch-pdf-${Date.now()}`;
  seedPdf(pdfId, sub);
  const app = await buildApp();
  try {
    const res = await app.inject({
      method: 'POST',
      url: '/api/export/batch',
      headers: ownerHeaders(sub),
    });
    assert.equal(res.statusCode, 200, `expected 200 but got ${res.statusCode}: ${res.body}`);
    const body = JSON.parse(res.body) as { jobId: string; status: string };
    assert.ok(typeof body.jobId === 'string' && body.jobId.length > 0);
    assert.equal(body.status, 'running');

    // Poll status — job may be running or done
    const statusRes = await app.inject({
      method: 'GET',
      url: `/api/export/batch/${body.jobId}`,
      headers: ownerHeaders(sub),
    });
    assert.equal(statusRes.statusCode, 200);
    const statusBody = JSON.parse(statusRes.body) as { jobId: string; status: string; progress: number; total: number };
    assert.equal(statusBody.jobId, body.jobId);
    assert.ok(['running', 'done', 'failed'].includes(statusBody.status));
  } finally {
    cleanup(pdfId);
    await app.close();
  }
});

test('GET /api/export/batch/:jobId returns 403 for different user', async () => {
  const sub = `batch-owner2-${crypto.randomUUID()}`;
  const app = await buildApp();
  try {
    const startRes = await app.inject({
      method: 'POST',
      url: '/api/export/batch',
      headers: ownerHeaders(sub),
    });
    assert.equal(startRes.statusCode, 200);
    const { jobId } = JSON.parse(startRes.body) as { jobId: string };

    const res = await app.inject({
      method: 'GET',
      url: `/api/export/batch/${jobId}`,
      headers: ownerHeaders('different-user'),
    });
    assert.equal(res.statusCode, 403);
  } finally {
    await app.close();
  }
});

test('GET /api/export/batch/:jobId returns 404 for unknown jobId', async () => {
  const app = await buildApp();
  try {
    const res = await app.inject({
      method: 'GET',
      url: '/api/export/batch/nonexistent-job-id',
      headers: ownerHeaders('some-user'),
    });
    assert.equal(res.statusCode, 404);
  } finally {
    await app.close();
  }
});
