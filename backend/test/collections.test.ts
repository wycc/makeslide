import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';
import { setOpenAIClientForTest } from '../src/services/openai';
import { pagesDir, pageTextPath, pageScriptPath } from '../src/services/storage';

function testSessionCookie(sub = 'account-1'): string {
  const payload = Buffer.from(JSON.stringify({ provider: 'google', sub, email: `${sub}@example.com` }), 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

const OWNER_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie('account-1'))}`, 'content-type': 'application/json' };

setSystemAuthSettings({ googleAuthEnabled: false });

function nowIso(): string {
  return new Date().toISOString();
}

/** Seed a one-page source presentation and write its page text/script to storage. */
function seedSourcePdf(pdfId: string, title: string, content: string): void {
  const t = nowIso();
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,owner_sub,visibility,created_at,updated_at)
     VALUES (?,?,?,'ready',1,'account-1','private',?,?)`,
  ).run(pdfId, title, `${pdfId}.pdf`, t, t);
  const pageUid = crypto.randomUUID();
  db.prepare(
    `INSERT INTO pages (pdf_id,page_number,page_uid,text_path,script_path,status,created_at,updated_at)
     VALUES (?,1,?,?,?,'audio_ready',?,?)`,
  ).run(pdfId, pageUid, `pages/${pageUid}.text.txt`, `pages/${pageUid}.script.txt`, t, t);
  fs.mkdirSync(pagesDir(pdfId), { recursive: true });
  fs.writeFileSync(pageTextPath(pdfId, pageUid), content, 'utf8');
  fs.writeFileSync(pageScriptPath(pdfId, pageUid), content, 'utf8');
}

test('POST /api/pdfs/collections builds a collection linking every source', async () => {
  seedSourcePdf('coll-src-a-01', '來源甲', 'ALPHA_MARKER 內容甲');
  seedSourcePdf('coll-src-b-01', '來源乙', 'BETA_MARKER 內容乙');
  db.prepare(`DELETE FROM pages WHERE link_pdf_id IN ('coll-src-a-01','coll-src-b-01')`).run();

  // Deterministic summary so the endpoint's per-source LLM call is offline.
  setOpenAIClientForTest({
    chat: { completions: { create: async () => ({
      choices: [{ message: { content: JSON.stringify({ summary: '這是一段摘要。' }) }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }) } },
  } as never);

  try {
    const app = await buildApp();
    const resp = await app.inject({
      method: 'POST',
      url: '/api/pdfs/collections',
      headers: OWNER_HEADERS,
      payload: { title: '我的合輯', source_pdf_ids: ['coll-src-a-01', 'coll-src-b-01'] },
    });
    assert.equal(resp.statusCode, 201);
    const body = resp.json() as { id: string; pageCount: number };
    assert.equal(body.pageCount, 2);

    const pdfRow = db.prepare(`SELECT source_type FROM pdfs WHERE id = ?`).get(body.id) as { source_type: string };
    assert.equal(pdfRow.source_type, 'collection');

    const links = db
      .prepare(`SELECT link_pdf_id FROM pages WHERE pdf_id = ? ORDER BY page_number ASC`)
      .all(body.id) as Array<{ link_pdf_id: string }>;
    assert.deepEqual(links.map((r) => r.link_pdf_id), ['coll-src-a-01', 'coll-src-b-01']);
    await app.close();
  } finally {
    setOpenAIClientForTest(null);
  }
});

test('quiz generation on a collection aggregates content from all sources', async () => {
  seedSourcePdf('coll-src-a-02', '來源甲', 'ALPHA_MARKER 內容甲');
  seedSourcePdf('coll-src-b-02', '來源乙', 'BETA_MARKER 內容乙');

  // First mock: build the collection (summary calls). Then swap to a mock that captures the
  // quiz-generate messages so we can assert both sources' markers reached the LLM.
  setOpenAIClientForTest({
    chat: { completions: { create: async () => ({
      choices: [{ message: { content: JSON.stringify({ summary: '摘要。' }) }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }) } },
  } as never);

  try {
    const app = await buildApp();
    const created = await app.inject({
      method: 'POST',
      url: '/api/pdfs/collections',
      headers: OWNER_HEADERS,
      payload: { source_pdf_ids: ['coll-src-a-02', 'coll-src-b-02'] },
    });
    assert.equal(created.statusCode, 201);
    const collectionId = (created.json() as { id: string }).id;

    let capturedUserContent = '';
    setOpenAIClientForTest({
      chat: { completions: { create: async (params: { messages: Array<{ role: string; content: string }> }) => {
        capturedUserContent = params.messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n');
        return {
          choices: [{ message: { content: JSON.stringify({ title: '測驗', questions: [{ type: 'single', question: 'Q?', options: ['A', 'B'], answer_indices: [0] }] }) }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        };
      } } },
    } as never);

    const gen = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${collectionId}/quizzes/generate`,
      headers: OWNER_HEADERS,
      payload: { prompt: '出題' },
    });
    assert.equal(gen.statusCode, 200);
    assert.match(capturedUserContent, /ALPHA_MARKER/);
    assert.match(capturedUserContent, /BETA_MARKER/);
    await app.close();
  } finally {
    setOpenAIClientForTest(null);
  }
});
