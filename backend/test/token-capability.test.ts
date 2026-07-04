import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';
import { canReadPdf, canEditPdf, canDestructivelyEditPdf, type PdfAclContext } from '../src/routes/pdfs/permissions';
import type { PdfAccessLevel } from '../src/routes/pdfs/pdfAccess';

setSystemAuthSettings({ googleAuthEnabled: false });

function testSessionCookie(sub: string): string {
  const payload = Buffer.from(JSON.stringify({ provider: 'google', sub, email: `${sub}@example.com` }), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}
const OWNER = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie('tok-owner'))}` };
const OTHER = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie('tok-other'))}` };

function nowIso() { return new Date().toISOString(); }

function seedPdf(id: string, visibility: 'private' | 'public' | 'public_editable' = 'private'): void {
  const t = nowIso();
  db.prepare(`DELETE FROM pdf_shares WHERE pdf_id = ?`).run(id);
  db.prepare(`DELETE FROM pdf_permissions WHERE pdf_id = ?`).run(id);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(id);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,owner_sub,visibility,created_at,updated_at)
     VALUES (?,?,?,'ready',1,'tok-owner',?,?,?)`,
  ).run(id, `PDF ${id}`, `${id}.pdf`, visibility, t, t);
}
function cleanup(id: string): void {
  db.prepare(`DELETE FROM pdf_shares WHERE pdf_id = ?`).run(id);
  db.prepare(`DELETE FROM pdf_permissions WHERE pdf_id = ?`).run(id);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(id);
}
function insertToken(id: string, access: 'read_only' | 'editable', expiresAt: string | null = null): string {
  const token = crypto.randomBytes(18).toString('base64url');
  db.prepare(`INSERT INTO pdf_shares (token, pdf_id, access, expires_at, created_at, updated_at) VALUES (?,?,?,?,?,?)`)
    .run(token, id, access, expiresAt, nowIso(), nowIso());
  return token;
}

// --- Unit tests: effective access = max(identity, token capability) ---

function ctx(tokenAccess: PdfAccessLevel, email: string | null = null): PdfAclContext {
  return { id: 'unit-none', email, tokenAccess };
}
const privateRow = { owner_sub: 'tok-owner', visibility: 'private' as const };
const editableRow = { owner_sub: 'tok-owner', visibility: 'public_editable' as const };

test('editable token grants edit to anyone on a private presentation', () => {
  assert.equal(canReadPdf('someone', privateRow, ctx('edit')), true);
  assert.equal(canEditPdf('someone', privateRow, ctx('edit')), true);
  // even fully anonymous (no sub): a capability token stands alone
  assert.equal(canEditPdf(null, privateRow, ctx('edit')), true);
});

test('read_only token grants read but not edit on a private presentation', () => {
  assert.equal(canReadPdf(null, privateRow, ctx('read')), true);
  assert.equal(canEditPdf(null, privateRow, ctx('read')), false);
});

test('no token on a private presentation grants nothing to a non-owner', () => {
  assert.equal(canReadPdf('someone', privateRow, ctx('none')), false);
  assert.equal(canEditPdf('someone', privateRow, ctx('none')), false);
});

test('effective access is the higher of the two systems (read_only token cannot downgrade public_editable)', () => {
  // identity says edit (public_editable), token says read → effective edit
  assert.equal(canEditPdf('someone', editableRow, ctx('read')), true);
});

test('destructive sub-op needs an authenticated session even with an editable token', () => {
  // anonymous holder of an editable token: may edit, may NOT destructively edit
  assert.equal(canEditPdf(null, privateRow, ctx('edit')), true);
  assert.equal(canDestructivelyEditPdf(null, privateRow, ctx('edit')), false);
  // authenticated holder of an editable token: may destructively edit a part
  assert.equal(canDestructivelyEditPdf('tok-other', privateRow, ctx('edit')), true);
});

test('read_only token never grants destructive access', () => {
  assert.equal(canDestructivelyEditPdf('tok-other', privateRow, ctx('read')), false);
});

// --- Integration tests: token capability end-to-end, no visibility side effects ---

test('creating a share link does NOT change the presentation visibility', async () => {
  const id = `tok-novis-${Date.now()}`;
  seedPdf(id, 'private');
  const app = await buildApp();
  try {
    const resp = await app.inject({
      method: 'POST', url: `/api/pdfs/${id}/share`,
      headers: { ...OWNER, 'content-type': 'application/json' },
      payload: JSON.stringify({ access: 'editable' }),
    });
    assert.equal(resp.statusCode, 200, resp.body.slice(0, 200));
    assert.equal((resp.json() as { visibility: string }).visibility, 'private');
    const row = db.prepare(`SELECT visibility FROM pdfs WHERE id = ?`).get(id) as { visibility: string };
    assert.equal(row.visibility, 'private', 'visibility must stay private after creating an editable share');
  } finally { cleanup(id); await app.close(); }
});

test('an editable token lets an anonymous holder edit a private presentation', async () => {
  const id = `tok-edit-${Date.now()}`;
  seedPdf(id, 'private');
  const token = insertToken(id, 'editable');
  const app = await buildApp();
  try {
    const resp = await app.inject({
      method: 'POST', url: `/api/pdfs/${id}/sources/txt?share=${encodeURIComponent(token)}`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ content_text: 'added via editable token' }),
    });
    assert.ok(resp.statusCode < 300, `expected success but got ${resp.statusCode}: ${resp.body.slice(0, 200)}`);
  } finally { cleanup(id); await app.close(); }
});

test('a read_only token cannot edit a private presentation', async () => {
  const id = `tok-ro-${Date.now()}`;
  seedPdf(id, 'private');
  const token = insertToken(id, 'read_only');
  const app = await buildApp();
  try {
    const resp = await app.inject({
      method: 'POST', url: `/api/pdfs/${id}/sources/txt?share=${encodeURIComponent(token)}`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ content_text: 'should be rejected' }),
    });
    assert.equal(resp.statusCode, 403);
  } finally { cleanup(id); await app.close(); }
});

test('an expired editable token grants no edit', async () => {
  const id = `tok-exp-${Date.now()}`;
  seedPdf(id, 'private');
  const token = insertToken(id, 'editable', new Date(Date.now() - 86400000).toISOString());
  const app = await buildApp();
  try {
    const resp = await app.inject({
      method: 'POST', url: `/api/pdfs/${id}/sources/txt?share=${encodeURIComponent(token)}`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ content_text: 'expired token edit' }),
    });
    assert.equal(resp.statusCode, 403);
  } finally { cleanup(id); await app.close(); }
});

test('deleting the whole presentation is owner-only even with an editable token', async () => {
  const id = `tok-del-${Date.now()}`;
  seedPdf(id, 'private');
  const token = insertToken(id, 'editable');
  const app = await buildApp();
  try {
    // authenticated non-owner holding an editable token still cannot delete the whole presentation
    const resp = await app.inject({
      method: 'DELETE', url: `/api/pdfs/${id}?share=${encodeURIComponent(token)}`,
      headers: OTHER,
    });
    assert.equal(resp.statusCode, 403);
    assert.notEqual(db.prepare(`SELECT id FROM pdfs WHERE id = ?`).get(id), undefined);
    // owner can delete
    const ok = await app.inject({ method: 'DELETE', url: `/api/pdfs/${id}`, headers: OWNER });
    assert.equal(ok.statusCode, 204);
  } finally { cleanup(id); await app.close(); }
});
