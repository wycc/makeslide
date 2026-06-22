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

function seedPdfWithPage(pdfId: string, ownerSub: string): void {
  const t = nowIso();
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,owner_sub,visibility,created_at,updated_at)
     VALUES (?,?,?,'ready',1,?,'private',?,?)`,
  ).run(pdfId, `PDF ${pdfId}`, `${pdfId}.pdf`, ownerSub, t, t);
  db.prepare(
    `INSERT INTO pages (pdf_id,page_number,page_uid,image_path,text_path,script_path,audio_path,audio_duration_seconds,status,error_message,created_at,updated_at)
     VALUES (?,1,'uid1',NULL,NULL,NULL,NULL,NULL,'audio_ready',NULL,?,?)`,
  ).run(pdfId, t, t);
}

function cleanup(pdfId: string): void {
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
}

test('PATCH /api/pdfs/:id/pages/:n/note updates and returns 200', async () => {
  const id = `note-test-${Date.now()}`;
  seedPdfWithPage(id, 'owner-note');
  const app = await buildApp();
  try {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/pdfs/${id}/pages/1/note`,
      headers: ownerHeaders('owner-note'),
      payload: { note: '這是第一頁的備註。' },
    });
    assert.equal(res.statusCode, 200, `expected 200 but got ${res.statusCode}: ${res.body}`);
    const body = JSON.parse(res.body) as { id: string; page_number: number; page_notes: string; updated_at: string };
    assert.equal(body.id, id);
    assert.equal(body.page_number, 1);
    assert.equal(body.page_notes, '這是第一頁的備註。');

    const row = db.prepare(`SELECT page_notes FROM pages WHERE pdf_id = ? AND page_number = 1`).get(id) as { page_notes: string } | undefined;
    assert.equal(row?.page_notes, '這是第一頁的備註。');
  } finally {
    cleanup(id);
    await app.close();
  }
});

test('PATCH /api/pdfs/:id/pages/:n/note returns 404 for unknown PDF', async () => {
  const app = await buildApp();
  try {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/pdfs/nonexistent-note/pages/1/note',
      headers: ownerHeaders('owner-note'),
      payload: { note: 'test' },
    });
    assert.equal(res.statusCode, 404);
  } finally {
    await app.close();
  }
});

test('PATCH /api/pdfs/:id/pages/:n/note returns 403 for non-owner', async () => {
  const id = `note-403-${Date.now()}`;
  seedPdfWithPage(id, 'owner-note');
  const app = await buildApp();
  try {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/pdfs/${id}/pages/1/note`,
      headers: ownerHeaders('other-user'),
      payload: { note: 'hacked' },
    });
    assert.equal(res.statusCode, 403);
  } finally {
    cleanup(id);
    await app.close();
  }
});

test('GET /api/pdfs/:id includes page_notes in detail response', async () => {
  const id = `note-detail-${Date.now()}`;
  seedPdfWithPage(id, 'owner-note');
  const app = await buildApp();
  try {
    await app.inject({
      method: 'PATCH',
      url: `/api/pdfs/${id}/pages/1/note`,
      headers: ownerHeaders('owner-note'),
      payload: { note: '頁面詳細備註。' },
    });
    const res = await app.inject({
      method: 'GET',
      url: `/api/pdfs/${id}`,
      headers: ownerHeaders('owner-note'),
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body) as { pages: Array<{ page_number: number; page_notes: string }> };
    const page1 = body.pages.find((p) => p.page_number === 1);
    assert.equal(page1?.page_notes, '頁面詳細備註。');
  } finally {
    cleanup(id);
    await app.close();
  }
});
