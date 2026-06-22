import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';
import { setOpenAIClientForTest } from '../src/services/openai';

setSystemAuthSettings({ googleAuthEnabled: false });

function testSessionCookie(sub = 'owner-1'): string {
  const payload = Buffer.from(JSON.stringify({ provider: 'google', sub, email: `${sub}@example.com` }), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

const OWNER_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie('owner-1'))}` };

function nowIso() { return new Date().toISOString(); }

function seedPdf(id: string, opts: { ownerSub?: string | null; visibility?: string } = {}): void {
  const t = nowIso();
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(id);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(id);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,owner_sub,visibility,created_at,updated_at)
     VALUES (?,?,?,'ready',1,?,?,?,?)`,
  ).run(id, `PDF ${id}`, `${id}.pdf`, opts.ownerSub ?? 'owner-1', opts.visibility ?? 'private', t, t);

  const pagesDir = path.join(config.storageRoot, id, 'pages');
  fs.mkdirSync(pagesDir, { recursive: true });

  const uid = `${id}-p1`;
  const minPng = Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489' +
    '00000006624b474400ff00ff00ffa0bda793' +
    '0000000d49444154089963f8ffffff7f0009fb03fd08d1e81e' +
    '0000000049454e44ae426082',
    'hex',
  );
  fs.writeFileSync(path.join(pagesDir, `${uid}.png`), minPng);
  fs.writeFileSync(path.join(pagesDir, `${uid}.script.txt`), '這是第一頁的逐字稿內容。', 'utf8');

  db.prepare(
    `INSERT INTO pages (pdf_id,page_uid,page_number,image_path,script_path,status,created_at,updated_at)
     VALUES (?,?,1,?,?,'ready',?,?)`,
  ).run(id, uid, `pages/${uid}.png`, `pages/${uid}.script.txt`, t, t);
}

function cleanup(id: string): void {
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(id);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(id);
  fs.rmSync(path.join(config.storageRoot, id), { recursive: true, force: true });
}

function mockLlmCoursePackage(): void {
  const content = JSON.stringify({
    study_sheet: '# 學習單\n## 學習目標\n- 了解基本概念\n## 重點摘要\n第 1 頁：測試逐字稿',
    homework: '# 課後作業\n1. 請說明本課程的核心主題',
  });
  setOpenAIClientForTest({
    chat: {
      completions: {
        create: async () => ({
          choices: [{ message: { content }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 50, completion_tokens: 60, total_tokens: 110 },
        }),
      },
    },
  } as never);
}

test('POST /api/pdfs/:id/course-package returns 200 ZIP with study sheet and handout', async () => {
  const id = `cp-success-${Date.now()}`;
  seedPdf(id, { ownerSub: 'owner-1', visibility: 'private' });
  mockLlmCoursePackage();
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'POST', url: `/api/pdfs/${id}/course-package`, headers: OWNER_HEADERS });
    assert.equal(res.statusCode, 200, `expected 200 but got ${res.statusCode}: ${res.body.slice(0, 200)}`);
    assert.ok(
      res.headers['content-type']?.toString().includes('application/zip'),
      `unexpected content-type: ${String(res.headers['content-type'])}`,
    );
    assert.ok(res.rawPayload.length > 100, 'ZIP payload too small');
    const cd = String(res.headers['content-disposition'] ?? '');
    assert.ok(cd.includes('.zip'), `content-disposition should reference .zip: ${cd}`);
  } finally {
    setOpenAIClientForTest(null);
    cleanup(id);
    await app.close();
  }
});

test('POST /api/pdfs/:id/course-package returns 404 for unknown PDF', async () => {
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'POST', url: '/api/pdfs/nonexistent-cp-id/course-package' });
    assert.equal(res.statusCode, 404);
  } finally {
    await app.close();
  }
});

test('POST /api/pdfs/:id/course-package returns 403 for private PDF without session', async () => {
  const id = `cp-private-${Date.now()}`;
  seedPdf(id, { ownerSub: 'other-owner', visibility: 'private' });
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'POST', url: `/api/pdfs/${id}/course-package` });
    assert.equal(res.statusCode, 403);
  } finally {
    cleanup(id);
    await app.close();
  }
});
