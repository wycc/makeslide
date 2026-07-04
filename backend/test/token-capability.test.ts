import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';
import { canReadPdf, canEditPdf, canDestructivelyEditPdf, type PdfAclContext } from '../src/routes/pdfs/permissions';
import { resolveTokenAccessLevel } from '../src/routes/pdfs/share';
import type { PdfAccessLevel } from '../src/routes/pdfs/pdfAccess';
import type { FastifyRequest } from 'fastify';

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
function insertUserAcl(id: string, email: string, access: 'read_only' | 'read_write'): void {
  db.prepare(
    `INSERT INTO pdf_permissions (pdf_id, principal_type, principal_id, access, created_at, updated_at)
     VALUES (?, 'user', ?, ?, ?, ?)`,
  ).run(id, email.toLowerCase(), access, nowIso(), nowIso());
}
/** A minimal request carrying a share token via the header, for unit-testing resolveTokenAccessLevel. */
function tokenReq(token: string | null): FastifyRequest {
  return { headers: token ? { 'x-makeslide-share-token': token } : {}, query: {} } as unknown as FastifyRequest;
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

// --- Gap C: resolveTokenAccessLevel edge cases (direct unit tests) ---

test('resolveTokenAccessLevel: no token on the request → none', () => {
  const id = `tok-lvl-none-${Date.now()}`;
  seedPdf(id);
  try {
    assert.equal(resolveTokenAccessLevel(tokenReq(null), id), 'none');
  } finally { cleanup(id); }
});

test('resolveTokenAccessLevel: a malformed token (wrong shape) → none', () => {
  const id = `tok-lvl-bad-${Date.now()}`;
  seedPdf(id);
  try {
    // too short to pass ShareTokenParamSchema (needs 12+ url-safe chars)
    assert.equal(resolveTokenAccessLevel(tokenReq('short'), id), 'none');
  } finally { cleanup(id); }
});

test('resolveTokenAccessLevel: a valid token issued for a different presentation → none', () => {
  const id = `tok-lvl-a-${Date.now()}`;
  const other = `tok-lvl-b-${Date.now()}`;
  seedPdf(id);
  seedPdf(other);
  const token = insertToken(other, 'editable');
  try {
    assert.equal(resolveTokenAccessLevel(tokenReq(token), id), 'none');
  } finally { cleanup(id); cleanup(other); }
});

test('resolveTokenAccessLevel: read_only → read, editable → edit', () => {
  const id = `tok-lvl-rw-${Date.now()}`;
  seedPdf(id);
  const ro = insertToken(id, 'read_only');
  const rw = insertToken(id, 'editable');
  try {
    assert.equal(resolveTokenAccessLevel(tokenReq(ro), id), 'read');
    assert.equal(resolveTokenAccessLevel(tokenReq(rw), id), 'edit');
  } finally { cleanup(id); }
});

test('resolveTokenAccessLevel: an expired token → none', () => {
  const id = `tok-lvl-exp-${Date.now()}`;
  seedPdf(id);
  const token = insertToken(id, 'editable', new Date(Date.now() - 86400000).toISOString());
  try {
    assert.equal(resolveTokenAccessLevel(tokenReq(token), id), 'none');
  } finally { cleanup(id); }
});

// --- Gap B: destructive access via a read_write ACL grant (identity path, no token) ---

test('canDestructivelyEditPdf allows a read_write ACL grant with an authenticated session', () => {
  const id = `tok-acl-rw-${Date.now()}`;
  seedPdf(id, 'private');
  insertUserAcl(id, 'grantee@example.com', 'read_write');
  const ctxRw: PdfAclContext = { id, email: 'grantee@example.com', tokenAccess: 'none' };
  try {
    // authenticated read_write grantee: may destructively edit a part of the presentation
    assert.equal(canDestructivelyEditPdf('grantee-sub', privateRow, ctxRw), true);
    // ...but not when unauthenticated (destructive always requires a session)
    assert.equal(canDestructivelyEditPdf(null, privateRow, ctxRw), false);
  } finally { cleanup(id); }
});

test('a read_only ACL grant never allows destructive access', () => {
  const id = `tok-acl-ro-${Date.now()}`;
  seedPdf(id, 'private');
  insertUserAcl(id, 'reader@example.com', 'read_only');
  const ctxRo: PdfAclContext = { id, email: 'reader@example.com', tokenAccess: 'none' };
  try {
    assert.equal(canDestructivelyEditPdf('reader-sub', privateRow, ctxRo), false);
  } finally { cleanup(id); }
});

test('destructive route (DELETE drawing) honors a read_write ACL grant but rejects read-only / anonymous', async () => {
  const id = `tok-acl-draw-${Date.now()}`;
  seedPdf(id, 'private');
  insertUserAcl(id, 'tok-other@example.com', 'read_write'); // OTHER's session email is tok-other@example.com
  const app = await buildApp();
  try {
    // read_write ACL grantee (authenticated) can delete a page's drawing
    const okRw = await app.inject({ method: 'DELETE', url: `/api/pdfs/${id}/pages/1/drawing`, headers: OTHER });
    assert.equal(okRw.statusCode, 204, okRw.body.slice(0, 200));
    // downgrade the same user to read_only → now forbidden
    db.prepare(`DELETE FROM pdf_permissions WHERE pdf_id = ?`).run(id);
    insertUserAcl(id, 'tok-other@example.com', 'read_only');
    const ro = await app.inject({ method: 'DELETE', url: `/api/pdfs/${id}/pages/1/drawing`, headers: OTHER });
    assert.equal(ro.statusCode, 403);
    // an anonymous holder of an editable token still cannot do a destructive op (needs a session)
    const token = insertToken(id, 'editable');
    const anon = await app.inject({ method: 'DELETE', url: `/api/pdfs/${id}/pages/1/drawing?share=${encodeURIComponent(token)}` });
    assert.equal(anon.statusCode, 403);
  } finally { cleanup(id); await app.close(); }
});

// --- Gap A: detail access_level reflects the EFFECTIVE level (identity max token) ---

test('GET detail reports access_level=edit for an anonymous editable-token holder', async () => {
  const id = `tok-al-edit-${Date.now()}`;
  seedPdf(id, 'private');
  const token = insertToken(id, 'editable');
  const app = await buildApp();
  try {
    const resp = await app.inject({ method: 'GET', url: `/api/pdfs/${id}?share=${encodeURIComponent(token)}` });
    assert.equal(resp.statusCode, 200, resp.body.slice(0, 200));
    assert.equal((resp.json() as { access_level: string }).access_level, 'edit');
  } finally { cleanup(id); await app.close(); }
});

test('GET detail reports access_level=read for an anonymous read-only-token holder', async () => {
  const id = `tok-al-read-${Date.now()}`;
  seedPdf(id, 'private');
  const token = insertToken(id, 'read_only');
  const app = await buildApp();
  try {
    const resp = await app.inject({ method: 'GET', url: `/api/pdfs/${id}?share=${encodeURIComponent(token)}` });
    assert.equal(resp.statusCode, 200, resp.body.slice(0, 200));
    assert.equal((resp.json() as { access_level: string }).access_level, 'read');
  } finally { cleanup(id); await app.close(); }
});

// --- Gap D: an editable token grants edit on a second edit route (PATCH title) ---

test('an editable token lets an anonymous holder edit via PATCH title; a read-only token cannot', async () => {
  const id = `tok-title-${Date.now()}`;
  seedPdf(id, 'private');
  const editable = insertToken(id, 'editable');
  const readonly = insertToken(id, 'read_only');
  const app = await buildApp();
  try {
    const okEdit = await app.inject({
      method: 'PATCH', url: `/api/pdfs/${id}/title?share=${encodeURIComponent(editable)}`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ title: 'Renamed via editable token' }),
    });
    assert.ok(okEdit.statusCode < 300, `expected success but got ${okEdit.statusCode}: ${okEdit.body.slice(0, 200)}`);

    const rejected = await app.inject({
      method: 'PATCH', url: `/api/pdfs/${id}/title?share=${encodeURIComponent(readonly)}`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ title: 'Should be rejected' }),
    });
    assert.equal(rejected.statusCode, 403);
  } finally { cleanup(id); await app.close(); }
});

// --- Access ADMINISTRATION is owner-only: neither edit-level tokens nor ACL grants qualify ---

test('creating a share link is owner-only: authed non-owner and anonymous token holder get 403', async () => {
  const id = `tok-mint-${Date.now()}`;
  seedPdf(id, 'public_editable'); // even the most permissive default must not allow minting
  const token = insertToken(id, 'editable');
  const app = await buildApp();
  try {
    const other = await app.inject({
      method: 'POST', url: `/api/pdfs/${id}/share`,
      headers: { ...OTHER, 'content-type': 'application/json' },
      payload: JSON.stringify({ access: 'editable' }),
    });
    assert.equal(other.statusCode, 403);
    // an editable-token holder must not be able to mint further tokens
    const viaToken = await app.inject({
      method: 'POST', url: `/api/pdfs/${id}/share?share=${encodeURIComponent(token)}`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ access: 'editable' }),
    });
    assert.equal(viaToken.statusCode, 403);
  } finally { cleanup(id); await app.close(); }
});

test('changing visibility (the default permission) is owner-only', async () => {
  const id = `tok-vis-${Date.now()}`;
  seedPdf(id, 'private');
  insertUserAcl(id, 'tok-other@example.com', 'read_write');
  const token = insertToken(id, 'editable');
  const app = await buildApp();
  try {
    // a read_write ACL grantee may edit CONTENT but not administer access
    const grantee = await app.inject({
      method: 'PATCH', url: `/api/pdfs/${id}/visibility`,
      headers: { ...OTHER, 'content-type': 'application/json' },
      payload: JSON.stringify({ visibility: 'public_editable' }),
    });
    assert.equal(grantee.statusCode, 403);
    // an anonymous editable-token holder must not escalate the default beyond the token's life
    const viaToken = await app.inject({
      method: 'PATCH', url: `/api/pdfs/${id}/visibility?share=${encodeURIComponent(token)}`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ visibility: 'public_editable' }),
    });
    assert.equal(viaToken.statusCode, 403);
    const row = db.prepare(`SELECT visibility FROM pdfs WHERE id = ?`).get(id) as { visibility: string };
    assert.equal(row.visibility, 'private', 'visibility must be unchanged by non-owner attempts');
    // the owner still can
    const owner = await app.inject({
      method: 'PATCH', url: `/api/pdfs/${id}/visibility`,
      headers: { ...OWNER, 'content-type': 'application/json' },
      payload: JSON.stringify({ visibility: 'public' }),
    });
    assert.equal(owner.statusCode, 200, owner.body.slice(0, 200));
  } finally { cleanup(id); await app.close(); }
});

test('deleting the whole presentation is owner-only even for a read_write ACL grantee', async () => {
  const id = `tok-del-acl-${Date.now()}`;
  seedPdf(id, 'private');
  insertUserAcl(id, 'tok-other@example.com', 'read_write');
  const app = await buildApp();
  try {
    const resp = await app.inject({ method: 'DELETE', url: `/api/pdfs/${id}`, headers: OTHER });
    assert.equal(resp.statusCode, 403);
    assert.notEqual(db.prepare(`SELECT id FROM pdfs WHERE id = ?`).get(id), undefined);
  } finally { cleanup(id); await app.close(); }
});

// --- max() in the other direction: a read-only listed user holding an editable token gets edit ---

test('a read-only listed user holding an editable token resolves to effective edit', async () => {
  const id = `tok-ro-plus-${Date.now()}`;
  seedPdf(id, 'private');
  insertUserAcl(id, 'tok-other@example.com', 'read_only'); // identity says read...
  const token = insertToken(id, 'editable'); // ...token says edit → max = edit
  const app = await buildApp();
  try {
    const detail = await app.inject({ method: 'GET', url: `/api/pdfs/${id}?share=${encodeURIComponent(token)}`, headers: OTHER });
    assert.equal(detail.statusCode, 200, detail.body.slice(0, 200));
    assert.equal((detail.json() as { access_level: string }).access_level, 'edit');
    const edit = await app.inject({
      method: 'PATCH', url: `/api/pdfs/${id}/title?share=${encodeURIComponent(token)}`,
      headers: { ...OTHER, 'content-type': 'application/json' },
      payload: JSON.stringify({ title: 'Edited by read-only listee via editable token' }),
    });
    assert.ok(edit.statusCode < 300, `expected success but got ${edit.statusCode}: ${edit.body.slice(0, 200)}`);
  } finally { cleanup(id); await app.close(); }
});

// --- Group grants end-to-end over HTTP (the resolver unit tests cover the SQL; this proves wiring) ---

test('a group member reads a private presentation via a group grant; read_write group also edits', async () => {
  const id = `tok-grp-${Date.now()}`;
  const groupId = `grp-tokcap${Date.now()}`;
  seedPdf(id, 'private');
  const t = nowIso();
  db.prepare(`DELETE FROM groups WHERE id = ?`).run(groupId);
  db.prepare(`INSERT INTO groups (id, owner_sub, name, created_at, updated_at) VALUES (?,?,?,?,?)`)
    .run(groupId, 'tok-owner', 'Test group', t, t);
  db.prepare(`INSERT INTO group_members (group_id, email, created_at) VALUES (?,?,?)`)
    .run(groupId, 'tok-other@example.com', t);
  db.prepare(
    `INSERT INTO pdf_permissions (pdf_id, principal_type, principal_id, access, created_at, updated_at)
     VALUES (?, 'group', ?, 'read_only', ?, ?)`,
  ).run(id, groupId, t, t);
  const app = await buildApp();
  try {
    // read_only group grant: the member reads, sees access_level=read, cannot edit
    const detail = await app.inject({ method: 'GET', url: `/api/pdfs/${id}`, headers: OTHER });
    assert.equal(detail.statusCode, 200, detail.body.slice(0, 200));
    assert.equal((detail.json() as { access_level: string }).access_level, 'read');
    const editDenied = await app.inject({
      method: 'PATCH', url: `/api/pdfs/${id}/title`,
      headers: { ...OTHER, 'content-type': 'application/json' },
      payload: JSON.stringify({ title: 'nope' }),
    });
    assert.equal(editDenied.statusCode, 403);
    // upgrade the group to read_write: the member may now edit
    db.prepare(`UPDATE pdf_permissions SET access = 'read_write' WHERE pdf_id = ? AND principal_id = ?`).run(id, groupId);
    const editOk = await app.inject({
      method: 'PATCH', url: `/api/pdfs/${id}/title`,
      headers: { ...OTHER, 'content-type': 'application/json' },
      payload: JSON.stringify({ title: 'Edited via read_write group grant' }),
    });
    assert.ok(editOk.statusCode < 300, `expected success but got ${editOk.statusCode}: ${editOk.body.slice(0, 200)}`);
    // an anonymous stranger (not in the group, no token) still cannot read
    const anon = await app.inject({ method: 'GET', url: `/api/pdfs/${id}` });
    assert.equal(anon.statusCode, 403);
  } finally {
    db.prepare(`DELETE FROM groups WHERE id = ?`).run(groupId);
    cleanup(id);
    await app.close();
  }
});
