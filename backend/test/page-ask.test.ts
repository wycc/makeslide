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
// The /ask endpoint now streams the answer as plain text via SSE, so the mock returns
// an async-iterable stream of content deltas (chunked to exercise the streaming path).
function mockAsk(answer: string): void {
  setOpenAIClientForTest({
    chat: {
      completions: {
        create: async (args: { messages: Array<{ role: string; content: unknown }> }) => {
          captured = { messages: args.messages };
          const mid = Math.ceil(answer.length / 2);
          const chunks = [answer.slice(0, mid), answer.slice(mid)];
          return {
            async *[Symbol.asyncIterator]() {
              for (const c of chunks) {
                yield { choices: [{ delta: { content: c }, finish_reason: null }] };
              }
              yield {
                choices: [{ delta: {}, finish_reason: 'stop' }],
                usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
              };
            },
          };
        },
      },
    },
  } as never);
}

// Extract the final answer from an SSE response body (the `event: done` payload).
function parseSseAnswer(body: string): string | null {
  let answer: string | null = null;
  for (const block of body.split('\n\n')) {
    let event = '';
    let data = '';
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice('event:'.length).trim();
      else if (line.startsWith('data:')) data += line.slice('data:'.length).trim();
    }
    if (event === 'done' && data) answer = (JSON.parse(data) as { answer: string }).answer;
  }
  return answer;
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
    assert.equal(parseSseAnswer(resp.body), '這是綜合全份的詳細回答。');

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
    // The system prompt mandates citing page numbers when answering from other pages.
    assert.match(flat, /引用規則/);
    assert.match(flat, /學生目前所在頁.*以外/);
    // No explicit verbosity → defaults to the detailed instruction.
    assert.match(flat, /本次回答長度：詳細/);
  } finally {
    setOpenAIClientForTest(null);
    await app.close();
  }
});

test('POST ask — verbosity:brief injects the concise-answer instruction', async () => {
  const pdfId = `ask-brief-${RUN}`;
  seedPdfWithPages(pdfId, OWNER_SUB, [{ text: '一些內容', script: '一些逐字稿' }]);
  mockAsk('精簡回答。');
  const app = await buildApp();
  try {
    const resp = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${pdfId}/pages/1/ask`,
      headers: { ...OWNER_HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify({ question: '重點是什麼？', verbosity: 'brief' }),
    });
    assert.equal(resp.statusCode, 200);
    assert.ok(captured, 'model was called');
    const flat = JSON.stringify(captured!.messages);
    assert.match(flat, /本次回答長度：精簡/);
    assert.doesNotMatch(flat, /本次回答長度：詳細/);
  } finally {
    setOpenAIClientForTest(null);
    await app.close();
  }
});

test('POST ask — attaches the original source.txt full text when present', async () => {
  const pdfId = `ask-source-${RUN}`;
  seedPdfWithPages(pdfId, OWNER_SUB, [
    { text: '投影片只有摘要', script: '逐字稿只有摘要' },
  ]);
  // Detail that lives ONLY in the original extracted source, not in any
  // page's slide text or script.
  fs.writeFileSync(path.join(config.storageRoot, pdfId, 'source.txt'), '原文獨有關鍵字ZETA9', 'utf8');
  mockAsk('依原文作答。');
  const app = await buildApp();
  try {
    const resp = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${pdfId}/pages/1/ask`,
      headers: { ...OWNER_HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'ZETA9 是什麼？' }),
    });
    assert.equal(resp.statusCode, 200);
    assert.ok(captured, 'model was called');
    const flat = JSON.stringify(captured!.messages);
    // The original source text (and its label) is forwarded to the model.
    assert.match(flat, /ZETA9/);
    assert.match(flat, /原始來源全文/);
  } finally {
    setOpenAIClientForTest(null);
    await app.close();
  }
});

test('POST ask — system prompt forbids fabrication when no info is found', async () => {
  const pdfId = `ask-nofab-${RUN}`;
  seedPdfWithPages(pdfId, OWNER_SUB, [{ text: '一些內容', script: '一些逐字稿' }]);
  mockAsk('回答。');
  const app = await buildApp();
  try {
    const resp = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${pdfId}/pages/1/ask`,
      headers: { ...OWNER_HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify({ question: '這份教材沒提到的東西？' }),
    });
    assert.equal(resp.statusCode, 200);
    const flat = JSON.stringify(captured!.messages);
    assert.match(flat, /禁止杜撰/);
    assert.match(flat, /找不到相關資訊/);
  } finally {
    setOpenAIClientForTest(null);
    await app.close();
  }
});

test('POST ask — a blank model answer is replaced with the fixed fallback', async () => {
  const pdfId = `ask-blank-${RUN}`;
  seedPdfWithPages(pdfId, OWNER_SUB, [{ text: '一些內容', script: '一些逐字稿' }]);
  // Model returns whitespace-only content (an empty answer edge case).
  mockAsk('   ');
  const app = await buildApp();
  try {
    const resp = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${pdfId}/pages/1/ask`,
      headers: { ...OWNER_HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify({ question: '隨便問' }),
    });
    assert.equal(resp.statusCode, 200);
    const answer = parseSseAnswer(resp.body);
    assert.match(answer ?? '', /找不到可以回答這個問題的相關資訊/);
  } finally {
    setOpenAIClientForTest(null);
    await app.close();
  }
});
