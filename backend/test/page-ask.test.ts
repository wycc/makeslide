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
const OWNER_SUB = `ask-owner-${RUN}`;

function testSessionCookie(sub: string): string {
  const payload = Buffer.from(JSON.stringify({ provider: 'google', sub, email: `${sub}@example.com` }), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}
const OWNER_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie(OWNER_SUB))}` };

function seedPdfWithPages(pdfId: string, owner: string, pages: { text: string; script: string }[]): void {
  const t = new Date().toISOString();
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,owner_sub,visibility,created_at,updated_at)
     VALUES (?,?,?,'ready',?,?,'private',?,?)`,
  ).run(pdfId, 'Deck', 'd.pdf', pages.length, owner, t, t);
  const pagesDir = path.join(config.storageRoot, pdfId, 'pages');
  fs.mkdirSync(pagesDir, { recursive: true });
  pages.forEach((p, idx) => {
    const n = idx + 1;
    const uid = `ask${RUN}-${n}`;
    db.prepare(
      `INSERT INTO pages (pdf_id,page_number,page_uid,text_path,script_path,status,created_at,updated_at)
       VALUES (?,?,?,?,?,'audio_ready',?,?)`,
    ).run(pdfId, n, uid, `pages/${uid}.text.txt`, `pages/${uid}.script.txt`, t, t);
    fs.writeFileSync(path.join(pagesDir, `${uid}.text.txt`), p.text, 'utf8');
    fs.writeFileSync(path.join(pagesDir, `${uid}.script.txt`), p.script, 'utf8');
  });
}

// Capture the messages sent to the model so we can assert the prompt contents.
let captured: { messages: Array<{ role: string; content: unknown }> } | null = null;
function mockAsk(answer: string): void {
  setOpenAIClientForTest({
    chat: {
      completions: {
        create: async (args: { messages: Array<{ role: string; content: unknown }> }) => {
          captured = { messages: args.messages };
          return {
            choices: [{ message: { content: JSON.stringify({ answer }) }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          };
        },
      },
    },
  } as never);
}

test('POST /api/pdfs/:id/pages/:n/ask — 403 when not authenticated', async () => {
  const app = await buildApp();
  const resp = await app.inject({
    method: 'POST',
    url: `/api/pdfs/whatever/pages/1/ask`,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question: 'hi' }),
  });
  assert.equal(resp.statusCode, 403);
  await app.close();
});

test('POST ask — sends all pages and prior history to the model', async () => {
  const pdfId = `ask-deck-${RUN}`;
  seedPdfWithPages(pdfId, OWNER_SUB, [
    { text: '第一頁原文ALPHA', script: '第一頁逐字稿' },
    { text: '第二頁原文BETA', script: '第二頁逐字稿' },
  ]);
  mockAsk('這是綜合全份的詳細回答。');
  const app = await buildApp();
  try {
    const resp = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${pdfId}/pages/1/ask`,
      headers: { ...OWNER_HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify({
        question: '請追問第二頁',
        history: [
          { role: 'user', content: '先前問題' },
          { role: 'assistant', content: '先前回答' },
        ],
      }),
    });
    assert.equal(resp.statusCode, 200);
    assert.equal((resp.json() as { answer: string }).answer, '這是綜合全份的詳細回答。');

    assert.ok(captured, 'model was called');
    const flat = JSON.stringify(captured!.messages);
    // Corpus includes BOTH pages, not just the current one.
    assert.match(flat, /ALPHA/);
    assert.match(flat, /BETA/);
    // Prior conversation history is forwarded.
    assert.match(flat, /先前問題/);
    assert.match(flat, /先前回答/);
    // The new question is present.
    assert.match(flat, /請追問第二頁/);
  } finally {
    setOpenAIClientForTest(null);
    await app.close();
  }
});
