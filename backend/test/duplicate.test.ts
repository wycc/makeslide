import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';
import { pdfDir, pagesDir, quizRecordingsDir, quizEssayDir, metadataPath } from '../src/services/storage';

function testSessionCookie(sub: string): string {
  const payload = Buffer.from(JSON.stringify({ provider: 'google', sub, email: `${sub}@example.com` }), 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

const OWNER = 'dup-owner';
const OTHER = 'dup-other';
// Cookie-only (no content-type): /duplicate takes no body, and sending a JSON content-type with an
// empty body would make Fastify's JSON parser 400 — mirroring how the real frontend calls it.
const OWNER_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie(OWNER))}` };
const OTHER_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie(OTHER))}` };

setSystemAuthSettings({ googleAuthEnabled: false });

function nowIso(): string {
  return new Date().toISOString();
}

function cleanup(id: string): void {
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(id);
  fs.rmSync(pdfDir(id), { recursive: true, force: true });
}

/** Seed a one-page deck with page files on disk. `writeMeta=false` mimics a collection deck. */
function seedDeck(id: string, opts: { visibility: 'private' | 'public'; sourceType?: string; linkPdfId?: string | null; writeMeta?: boolean }): void {
  cleanup(id);
  const t = nowIso();
  const uid = crypto.randomUUID();
  db.prepare(
    `INSERT INTO pdfs (id, title, original_filename, status, page_count, owner_sub, visibility, source_type, created_at, updated_at)
     VALUES (?, ?, ?, 'ready', 1, ?, ?, ?, ?, ?)`,
  ).run(id, id, `${id}.pdf`, OWNER, opts.visibility, opts.sourceType ?? 'pdf', t, t);
  db.prepare(
    `INSERT INTO pages (pdf_id, page_number, page_uid, image_path, text_path, script_path, link_pdf_id, status, created_at, updated_at)
     VALUES (?, 1, ?, ?, ?, ?, ?, 'audio_ready', ?, ?)`,
  ).run(id, uid, `pages/${uid}.jpg`, `pages/${uid}.text.txt`, `pages/${uid}.script.txt`, opts.linkPdfId ?? null, t, t);
  fs.mkdirSync(pagesDir(id), { recursive: true });
  fs.writeFileSync(path.join(pagesDir(id), `${uid}.jpg`), 'img');
  fs.writeFileSync(path.join(pagesDir(id), `${uid}.text.txt`), 'text');
  fs.writeFileSync(path.join(pagesDir(id), `${uid}.script.txt`), 'script');
  if (opts.writeMeta !== false) {
    fs.writeFileSync(metadataPath(id), JSON.stringify({ id, title: id, original_filename: `${id}.pdf`, status: 'ready', page_count: 1, pages: [] }));
  }
}

test('duplicating a collection deck without metadata.json succeeds and preserves source_type + link_pdf_id', async () => {
  seedDeck('dup-coll-01', { visibility: 'private', sourceType: 'collection', linkPdfId: 'some-source-id', writeMeta: false });
  const app = await buildApp();
  try {
    const resp = await app.inject({ method: 'POST', url: '/api/pdfs/dup-coll-01/duplicate', headers: OWNER_HEADERS });
    assert.equal(resp.statusCode, 201);
    const copy = resp.json() as { id: string };
    const copyRow = db.prepare(`SELECT source_type FROM pdfs WHERE id = ?`).get(copy.id) as { source_type: string };
    assert.equal(copyRow.source_type, 'collection');
    const copyPage = db.prepare(`SELECT link_pdf_id FROM pages WHERE pdf_id = ? AND page_number = 1`).get(copy.id) as { link_pdf_id: string | null };
    assert.equal(copyPage.link_pdf_id, 'some-source-id');
    assert.ok(fs.existsSync(metadataPath(copy.id)), 'copy should have a synthesised metadata.json');
    cleanup(copy.id);
  } finally {
    await app.close();
    cleanup('dup-coll-01');
  }
});

test('an editor (owner) copy carries quiz + poll definitions but never students\' recordings/essays', async () => {
  seedDeck('dup-ctrl-01', { visibility: 'private' });
  db.prepare(
    `INSERT INTO quiz_sets (pdf_id, title, prompt, questions_json, time_limit_seconds, shuffle_questions, is_public, record_camera, created_at, updated_at)
     VALUES (?, '測驗', '', '[]', 0, 0, 0, 1, ?, ?)`,
  ).run('dup-ctrl-01', nowIso(), nowIso());
  db.prepare(
    `INSERT INTO page_polls (pdf_id, page_number, question, options_json, is_active, show_results, created_at, updated_at)
     VALUES (?, 1, 'Q?', '["A","B"]', 1, 1, ?, ?)`,
  ).run('dup-ctrl-01', nowIso(), nowIso());
  // Student-controlled artifacts on disk that must not be copied.
  fs.mkdirSync(quizRecordingsDir('dup-ctrl-01'), { recursive: true });
  fs.writeFileSync(path.join(quizRecordingsDir('dup-ctrl-01'), 'rec.webm'), 'video');
  fs.mkdirSync(quizEssayDir('dup-ctrl-01'), { recursive: true });
  fs.writeFileSync(path.join(quizEssayDir('dup-ctrl-01'), 'ans.jpg'), 'photo');

  const app = await buildApp();
  try {
    const resp = await app.inject({ method: 'POST', url: '/api/pdfs/dup-ctrl-01/duplicate', headers: OWNER_HEADERS });
    assert.equal(resp.statusCode, 201);
    const copy = (resp.json() as { id: string }).id;
    const quizCount = (db.prepare(`SELECT COUNT(*) c FROM quiz_sets WHERE pdf_id = ?`).get(copy) as { c: number }).c;
    const pollCount = (db.prepare(`SELECT COUNT(*) c FROM page_polls WHERE pdf_id = ?`).get(copy) as { c: number }).c;
    assert.equal(quizCount, 1, 'editor copy keeps the quiz definition');
    assert.equal(pollCount, 1, 'editor copy keeps the poll definition');
    assert.equal(fs.existsSync(quizRecordingsDir(copy)), false, 'recordings must not be copied');
    assert.equal(fs.existsSync(quizEssayDir(copy)), false, 'essay answers must not be copied');
    cleanup(copy);
  } finally {
    await app.close();
    cleanup('dup-ctrl-01');
  }
});

test('a read-only copier of a public deck gets slides only — no quiz/poll definitions', async () => {
  seedDeck('dup-ro-01', { visibility: 'public' });
  db.prepare(
    `INSERT INTO quiz_sets (pdf_id, title, prompt, questions_json, time_limit_seconds, shuffle_questions, is_public, record_camera, created_at, updated_at)
     VALUES (?, '測驗', '', '[]', 0, 0, 0, 1, ?, ?)`,
  ).run('dup-ro-01', nowIso(), nowIso());
  db.prepare(
    `INSERT INTO page_polls (pdf_id, page_number, question, options_json, is_active, show_results, created_at, updated_at)
     VALUES (?, 1, 'Q?', '["A","B"]', 1, 1, ?, ?)`,
  ).run('dup-ro-01', nowIso(), nowIso());

  const app = await buildApp();
  try {
    const resp = await app.inject({ method: 'POST', url: '/api/pdfs/dup-ro-01/duplicate', headers: OTHER_HEADERS });
    assert.equal(resp.statusCode, 201);
    const copy = (resp.json() as { id: string }).id;
    const quizCount = (db.prepare(`SELECT COUNT(*) c FROM quiz_sets WHERE pdf_id = ?`).get(copy) as { c: number }).c;
    const pollCount = (db.prepare(`SELECT COUNT(*) c FROM page_polls WHERE pdf_id = ?`).get(copy) as { c: number }).c;
    assert.equal(quizCount, 0, 'read-only copy excludes quiz definitions');
    assert.equal(pollCount, 0, 'read-only copy excludes poll definitions');
    // Slides still copied.
    const pageCount = (db.prepare(`SELECT COUNT(*) c FROM pages WHERE pdf_id = ?`).get(copy) as { c: number }).c;
    assert.equal(pageCount, 1);
    cleanup(copy);
  } finally {
    await app.close();
    cleanup('dup-ro-01');
  }
});
