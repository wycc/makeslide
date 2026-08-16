import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { db } from '../src/db';
import { config } from '../src/config';
import { setOpenAIClientForTest } from '../src/services/openai';
import { setSystemAuthSettings } from '../src/services/aiSettings';
import { buildApp } from '../src/server';

setSystemAuthSettings({ googleAuthEnabled: false });

const RUN = crypto.randomBytes(4).toString('hex');
const OWNER = `split-owner-${RUN}`;

function cookie(sub: string): string {
  const payload = Buffer.from(JSON.stringify({ provider: 'google', sub, email: `${sub}@e.com` }), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}
const HEADERS = { cookie: `makeslide_session=${encodeURIComponent(cookie(OWNER))}`, 'content-type': 'application/json' };

/** A deck of `count` pages; page 1 carries the transcript under test. */
function seed(pdfId: string, script: string, count = 2, renderType = 'static-image'): string[] {
  const t = new Date().toISOString();
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,owner_sub,visibility,created_at,updated_at)
     VALUES (?,?,?,'ready',?,?,'private',?,?)`,
  ).run(pdfId, 'D', 'd.pdf', count, OWNER, t, t);
  const dir = path.join(config.storageRoot, pdfId, 'pages');
  fs.mkdirSync(dir, { recursive: true });
  const uids: string[] = [];
  for (let i = 1; i <= count; i += 1) {
    const uid = `sp${RUN}-${i}`;
    uids.push(uid);
    db.prepare(
      `INSERT INTO pages (pdf_id,page_number,page_uid,image_path,text_path,script_path,audio_path,audio_duration_seconds,render_type,status,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,'audio_ready',?,?)`,
    ).run(pdfId, i, uid, `pages/${uid}.jpg`, `pages/${uid}.text.txt`, `pages/${uid}.script.txt`,
      `pages/${uid}.m4a`, 12.5, i === 1 ? renderType : 'static-image', t, t);
    fs.writeFileSync(path.join(dir, `${uid}.script.txt`), i === 1 ? script : `第 ${i} 頁逐字稿。`, 'utf8');
    fs.writeFileSync(path.join(dir, `${uid}.text.txt`), i === 1 ? '要點一\n要點二' : `文字 ${i}`, 'utf8');
    fs.writeFileSync(path.join(dir, `${uid}.jpg`), `jpeg-${i}`, 'utf8');
  }
  return uids;
}

function mockPlan(plan: object): void {
  setOpenAIClientForTest({
    chat: {
      completions: {
        create: async () => ({
          choices: [{ message: { content: JSON.stringify(plan) }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      },
    },
  } as never);
}

test('POST split — divides the transcript, inserts the page after it, and renumbers the rest', async (t) => {
  const pdfId = `split-ok-${RUN}`;
  const uids = seed(pdfId, '概念一的第一句。概念一的第二句。概念二的第一句。概念二的第二句。', 2);
  t.after(() => fs.rmSync(path.join(config.storageRoot, pdfId), { recursive: true, force: true }));
  mockPlan({ firstPageSentenceCount: 2, firstPageText: '要點一', secondPageText: '要點二', secondPageSummary: '概念二' });
  const app = await buildApp();
  try {
    const resp = await app.inject({ method: 'POST', url: `/api/pdfs/${pdfId}/pages/1/split`, headers: HEADERS, body: '{}' });
    assert.equal(resp.statusCode, 201, resp.body);
    const body = JSON.parse(resp.body) as { new_page_number: number; page_count: number; second_page_summary: string };
    assert.equal(body.new_page_number, 2);
    assert.equal(body.page_count, 3);
    assert.equal(body.second_page_summary, '概念二');

    const pages = db.prepare(`SELECT page_number,page_uid,audio_path,status FROM pages WHERE pdf_id=? ORDER BY page_number`).all(pdfId) as Array<{ page_number: number; page_uid: string; audio_path: string | null; status: string }>;
    assert.deepEqual(pages.map((p) => p.page_number), [1, 2, 3]);
    // The deck's original second page moved down rather than being overwritten.
    assert.equal(pages[2]!.page_uid, uids[1]);

    const dir = path.join(config.storageRoot, pdfId, 'pages');
    const first = fs.readFileSync(path.join(dir, `${pages[0]!.page_uid}.script.txt`), 'utf8');
    const second = fs.readFileSync(path.join(dir, `${pages[1]!.page_uid}.script.txt`), 'utf8');
    assert.match(first, /概念一的第一句/);
    assert.match(first, /概念一的第二句/);
    assert.ok(!first.includes('概念二'), 'the second concept must not stay on page 1');
    assert.match(second, /概念二的第一句/);
    assert.match(second, /概念二的第二句/);

    // Slide text divided along the same boundary.
    assert.equal(fs.readFileSync(path.join(dir, `${pages[0]!.page_uid}.text.txt`), 'utf8'), '要點一');
    assert.equal(fs.readFileSync(path.join(dir, `${pages[1]!.page_uid}.text.txt`), 'utf8'), '要點二');

    // The new page starts as a copy of the picture, so neither half is blank.
    assert.equal(fs.readFileSync(path.join(dir, `${pages[1]!.page_uid}.jpg`), 'utf8'), 'jpeg-1');

    // Both halves lose their narration: it matches neither of them now.
    assert.equal(pages[0]!.audio_path, null);
    assert.equal(pages[1]!.audio_path, null);
    assert.equal(pages[0]!.status, 'script_ready');
  } finally {
    setOpenAIClientForTest(null);
    await app.close();
  }
});

test('POST split — a page with one sentence has nothing to divide', async (t) => {
  const pdfId = `split-short-${RUN}`;
  seed(pdfId, '只有一句話。', 1);
  t.after(() => fs.rmSync(path.join(config.storageRoot, pdfId), { recursive: true, force: true }));
  mockPlan({ firstPageSentenceCount: 1, firstPageText: '', secondPageText: '', secondPageSummary: '' });
  const app = await buildApp();
  try {
    const resp = await app.inject({ method: 'POST', url: `/api/pdfs/${pdfId}/pages/1/split`, headers: HEADERS, body: '{}' });
    assert.equal(resp.statusCode, 409);
    assert.equal(JSON.parse(resp.body).error.code, 'CANNOT_SPLIT');
    // Nothing was created.
    assert.equal((db.prepare(`SELECT COUNT(*) c FROM pages WHERE pdf_id=?`).get(pdfId) as { c: number }).c, 1);
  } finally {
    setOpenAIClientForTest(null);
    await app.close();
  }
});

test('POST split — a model answer that would empty one page is clamped, not obeyed', async (t) => {
  const pdfId = `split-clamp-${RUN}`;
  seed(pdfId, '第一句。第二句。第三句。', 1);
  t.after(() => fs.rmSync(path.join(config.storageRoot, pdfId), { recursive: true, force: true }));
  // "All of it stays on page 1" is a refusal; acting on it makes an empty page.
  mockPlan({ firstPageSentenceCount: 3, firstPageText: 'a', secondPageText: 'b', secondPageSummary: 's' });
  const app = await buildApp();
  try {
    const resp = await app.inject({ method: 'POST', url: `/api/pdfs/${pdfId}/pages/1/split`, headers: HEADERS, body: '{}' });
    assert.equal(resp.statusCode, 201, resp.body);
    const pages = db.prepare(`SELECT page_uid FROM pages WHERE pdf_id=? ORDER BY page_number`).all(pdfId) as Array<{ page_uid: string }>;
    const dir = path.join(config.storageRoot, pdfId, 'pages');
    const second = fs.readFileSync(path.join(dir, `${pages[1]!.page_uid}.script.txt`), 'utf8');
    assert.match(second, /第三句/, 'the second page must not be empty');
  } finally {
    setOpenAIClientForTest(null);
    await app.close();
  }
});

test('POST split — refused on a React page, whose slide is code and does not halve', async (t) => {
  const pdfId = `split-react-${RUN}`;
  seed(pdfId, '第一句。第二句。', 1, 'react');
  t.after(() => fs.rmSync(path.join(config.storageRoot, pdfId), { recursive: true, force: true }));
  mockPlan({ firstPageSentenceCount: 1, firstPageText: '', secondPageText: '', secondPageSummary: '' });
  const app = await buildApp();
  try {
    const resp = await app.inject({ method: 'POST', url: `/api/pdfs/${pdfId}/pages/1/split`, headers: HEADERS, body: '{}' });
    assert.equal(resp.statusCode, 409);
    assert.equal(JSON.parse(resp.body).error.code, 'INVALID_STATE');
  } finally {
    setOpenAIClientForTest(null);
    await app.close();
  }
});
