import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
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

function nowIso(): string {
  return new Date().toISOString();
}

function seedPdf(id: string, ownerSub: string | null, visibility = 'private'): void {
  const t = nowIso();
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(id);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,owner_sub,visibility,created_at,updated_at)
     VALUES (?,?,?,'ready',1,?,?,?,?)`,
  ).run(id, `PDF ${id}`, `${id}.pdf`, ownerSub, visibility, t, t);
  const dir = path.join(config.storageRoot, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'dummy.txt'), 'hello');
}

function cleanup(id: string): void {
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(id);
  fs.rmSync(path.join(config.storageRoot, id), { recursive: true, force: true });
}

async function waitForDone(
  app: Awaited<ReturnType<typeof buildApp>>,
  pdfId: string,
  jobId: string,
  headers: Record<string, string>,
): Promise<{ status: string; progress: number; total: number }> {
  for (let i = 0; i < 50; i++) {
    const res = await app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}/export-job/${jobId}`, headers });
    const body = JSON.parse(res.body) as { status: string; progress: number; total: number };
    if (body.status !== 'running') return body;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('export job did not finish in time');
}

test('POST /api/pdfs/:id/export-job returns 403 for a private deck the requester cannot read', async () => {
  const owner = `single-owner-${crypto.randomUUID()}`;
  const pdfId = `single-export-${Date.now()}-a`;
  seedPdf(pdfId, owner);
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'POST', url: `/api/pdfs/${pdfId}/export-job`, headers: ownerHeaders('someone-else') });
    assert.equal(res.statusCode, 403);
  } finally {
    cleanup(pdfId);
    await app.close();
  }
});

test('single-deck export job runs to completion and the finished zip can be downloaded', async () => {
  const owner = `single-owner-${crypto.randomUUID()}`;
  const pdfId = `single-export-${Date.now()}-b`;
  seedPdf(pdfId, owner);
  const app = await buildApp();
  try {
    const startRes = await app.inject({ method: 'POST', url: `/api/pdfs/${pdfId}/export-job`, headers: ownerHeaders(owner) });
    assert.equal(startRes.statusCode, 200, `expected 200 but got ${startRes.statusCode}: ${startRes.body}`);
    const { jobId, status } = JSON.parse(startRes.body) as { jobId: string; status: string };
    assert.ok(typeof jobId === 'string' && jobId.length > 0);
    assert.equal(status, 'running');

    const finalStatus = await waitForDone(app, pdfId, jobId, ownerHeaders(owner));
    assert.equal(finalStatus.status, 'done');
    assert.equal(finalStatus.progress, finalStatus.total);

    const downloadRes = await app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}/export-job/${jobId}/download`, headers: ownerHeaders(owner) });
    assert.equal(downloadRes.statusCode, 200);
    assert.equal(downloadRes.headers['content-type'], 'application/zip');
    assert.ok(typeof downloadRes.headers['content-disposition'] === 'string');
  } finally {
    cleanup(pdfId);
    await app.close();
  }
});

test('GET .../export-job/:jobId/download returns 409 before the job has finished', async () => {
  const owner = `single-owner-${crypto.randomUUID()}`;
  const pdfId = `single-export-${Date.now()}-c`;
  seedPdf(pdfId, owner);
  const app = await buildApp();
  try {
    const startRes = await app.inject({ method: 'POST', url: `/api/pdfs/${pdfId}/export-job`, headers: ownerHeaders(owner) });
    const { jobId } = JSON.parse(startRes.body) as { jobId: string };

    const downloadRes = await app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}/export-job/${jobId}/download`, headers: ownerHeaders(owner) });
    assert.equal(downloadRes.statusCode, 409);

    // Drain the job so its temp dir gets cleaned up promptly rather than waiting for the sweep.
    await waitForDone(app, pdfId, jobId, ownerHeaders(owner));
  } finally {
    cleanup(pdfId);
    await app.close();
  }
});

test('GET /api/pdfs/:id/export-job/:jobId returns 403 for a different user and 404 for an unknown jobId', async () => {
  const owner = `single-owner-${crypto.randomUUID()}`;
  const pdfId = `single-export-${Date.now()}-d`;
  seedPdf(pdfId, owner);
  const app = await buildApp();
  try {
    const startRes = await app.inject({ method: 'POST', url: `/api/pdfs/${pdfId}/export-job`, headers: ownerHeaders(owner) });
    const { jobId } = JSON.parse(startRes.body) as { jobId: string };

    const forbidden = await app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}/export-job/${jobId}`, headers: ownerHeaders('different-user') });
    assert.equal(forbidden.statusCode, 403);

    const notFound = await app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}/export-job/nonexistent-job-id`, headers: ownerHeaders(owner) });
    assert.equal(notFound.statusCode, 404);

    await waitForDone(app, pdfId, jobId, ownerHeaders(owner));
  } finally {
    cleanup(pdfId);
    await app.close();
  }
});

test('POST /api/pdfs/:id/export-job returns 404 for a nonexistent deck', async () => {
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'POST', url: `/api/pdfs/nonexistent-deck-id/export-job`, headers: ownerHeaders('someone') });
    assert.equal(res.statusCode, 404);
  } finally {
    await app.close();
  }
});
