import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db';
import {
  decidePdfAccessLevel,
  defaultAccessLevel,
  maxAccessLevel,
  resolvePdfAccessLevel,
} from '../src/routes/pdfs/pdfAccess';

function nowIso(): string {
  return new Date().toISOString();
}

function seedPdf(id: string, ownerSub: string | null, visibility: 'private' | 'public' | 'public_editable'): void {
  const t = nowIso();
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(id);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,owner_sub,visibility,created_at,updated_at)
     VALUES (?,?,?,'ready',1,?,?,?,?)`,
  ).run(id, 't', `${id}.pdf`, ownerSub, visibility, t, t);
}

function grant(pdfId: string, email: string, access: 'read_only' | 'read_write'): void {
  const t = nowIso();
  db.prepare(
    `INSERT OR REPLACE INTO pdf_permissions (pdf_id, principal_type, principal_id, access, created_at, updated_at)
     VALUES (?, 'user', ?, ?, ?, ?)`,
  ).run(pdfId, email, access, t, t);
}

// ─── defaultAccessLevel ──────────────────────────────────────────────────────
test('defaultAccessLevel maps visibility to the fallback access', () => {
  assert.equal(defaultAccessLevel('private'), 'none');
  assert.equal(defaultAccessLevel('public'), 'read');
  assert.equal(defaultAccessLevel('public_editable'), 'edit');
});

test('maxAccessLevel returns the higher level', () => {
  assert.equal(maxAccessLevel('none', 'read'), 'read');
  assert.equal(maxAccessLevel('edit', 'read'), 'edit');
  assert.equal(maxAccessLevel('none', 'none'), 'none');
});

// ─── decidePdfAccessLevel (pure) ─────────────────────────────────────────────
test('decidePdfAccessLevel: ownerless presentation is fully open', () => {
  assert.equal(
    decidePdfAccessLevel({ ownerSub: null, visibility: 'private', userSub: null, matchedGrants: [] }),
    'edit',
  );
});

test('decidePdfAccessLevel: the owner always gets edit', () => {
  assert.equal(
    decidePdfAccessLevel({ ownerSub: 'owner-1', visibility: 'private', userSub: 'owner-1', matchedGrants: [] }),
    'edit',
  );
});

test('decidePdfAccessLevel: a listed read-only user gets read even on a private default', () => {
  assert.equal(
    decidePdfAccessLevel({ ownerSub: 'owner-1', visibility: 'private', userSub: 'u2', matchedGrants: ['read_only'] }),
    'read',
  );
});

test('decidePdfAccessLevel: a listed read-write user gets edit even on a private default', () => {
  assert.equal(
    decidePdfAccessLevel({ ownerSub: 'owner-1', visibility: 'private', userSub: 'u2', matchedGrants: ['read_write'] }),
    'edit',
  );
});

test('decidePdfAccessLevel: an ACL match overrides a higher default (read-only caps below public_editable)', () => {
  assert.equal(
    decidePdfAccessLevel({ ownerSub: 'owner-1', visibility: 'public_editable', userSub: 'u2', matchedGrants: ['read_only'] }),
    'read',
  );
});

test('decidePdfAccessLevel: multiple grants take the highest', () => {
  assert.equal(
    decidePdfAccessLevel({ ownerSub: 'owner-1', visibility: 'private', userSub: 'u2', matchedGrants: ['read_only', 'read_write'] }),
    'edit',
  );
});

test('decidePdfAccessLevel: unlisted user falls back to the default (visibility)', () => {
  assert.equal(
    decidePdfAccessLevel({ ownerSub: 'owner-1', visibility: 'public', userSub: 'u2', matchedGrants: [] }),
    'read',
  );
  assert.equal(
    decidePdfAccessLevel({ ownerSub: 'owner-1', visibility: 'private', userSub: 'u2', matchedGrants: [] }),
    'none',
  );
});

// ─── resolvePdfAccessLevel (DB-backed) ───────────────────────────────────────
test('resolvePdfAccessLevel: reads the ACL from the DB and matches email case-insensitively', () => {
  seedPdf('acl-db-1', 'owner-1', 'private');
  grant('acl-db-1', 'Alice@Example.com', 'read_write');
  const row = { owner_sub: 'owner-1', visibility: 'private' as const };
  assert.equal(resolvePdfAccessLevel('acl-db-1', 'u-alice', 'alice@example.com', row), 'edit');
  // A different (unlisted) user falls back to the private default → no access.
  assert.equal(resolvePdfAccessLevel('acl-db-1', 'u-bob', 'bob@example.com', row), 'none');
  // The owner is edit regardless of the ACL.
  assert.equal(resolvePdfAccessLevel('acl-db-1', 'owner-1', 'owner@example.com', row), 'edit');
});

test('resolvePdfAccessLevel: a listed read-only user caps below a public_editable default', () => {
  seedPdf('acl-db-2', 'owner-1', 'public_editable');
  grant('acl-db-2', 'carol@example.com', 'read_only');
  const row = { owner_sub: 'owner-1', visibility: 'public_editable' as const };
  assert.equal(resolvePdfAccessLevel('acl-db-2', 'u-carol', 'carol@example.com', row), 'read');
  // Unlisted user still gets the public_editable default (edit).
  assert.equal(resolvePdfAccessLevel('acl-db-2', 'u-dave', 'dave@example.com', row), 'edit');
});

function seedGroup(groupId: string, ownerSub: string, memberEmails: string[]): void {
  const t = nowIso();
  db.prepare(`DELETE FROM groups WHERE id = ?`).run(groupId);
  db.prepare(`INSERT INTO groups (id, owner_sub, name, created_at, updated_at) VALUES (?, ?, 'g', ?, ?)`).run(groupId, ownerSub, t, t);
  for (const email of memberEmails) {
    db.prepare(`INSERT OR REPLACE INTO group_members (group_id, email, created_at) VALUES (?, ?, ?)`).run(groupId, email, t);
  }
}

function grantGroup(pdfId: string, groupId: string, access: 'read_only' | 'read_write'): void {
  const t = nowIso();
  db.prepare(
    `INSERT OR REPLACE INTO pdf_permissions (pdf_id, principal_type, principal_id, access, created_at, updated_at)
     VALUES (?, 'group', ?, ?, ?, ?)`,
  ).run(pdfId, groupId, access, t, t);
}

test('resolvePdfAccessLevel: a group member inherits the group grant', () => {
  seedPdf('acl-db-3', 'owner-1', 'private');
  seedGroup('grp-team1234', 'owner-1', ['erin@example.com', 'frank@example.com']);
  grantGroup('acl-db-3', 'grp-team1234', 'read_write');
  const row = { owner_sub: 'owner-1', visibility: 'private' as const };
  // A group member gets the group's access.
  assert.equal(resolvePdfAccessLevel('acl-db-3', 'u-erin', 'erin@example.com', row), 'edit');
  // A non-member still falls back to the private default.
  assert.equal(resolvePdfAccessLevel('acl-db-3', 'u-zoe', 'zoe@example.com', row), 'none');
});

test('resolvePdfAccessLevel: the highest of a direct grant and a group grant wins', () => {
  seedPdf('acl-db-4', 'owner-1', 'private');
  seedGroup('grp-readers99', 'owner-1', ['gil@example.com']);
  grantGroup('acl-db-4', 'grp-readers99', 'read_only');
  grant('acl-db-4', 'gil@example.com', 'read_write');
  const row = { owner_sub: 'owner-1', visibility: 'private' as const };
  assert.equal(resolvePdfAccessLevel('acl-db-4', 'u-gil', 'gil@example.com', row), 'edit');
});
