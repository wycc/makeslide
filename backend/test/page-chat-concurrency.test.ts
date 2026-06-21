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

// Covers a lost-update race in POST /api/pdfs/:id/pages/:n/chat: the handler reads
// chat_history_json, awaits a (potentially slow) LLM call, then writes back a history
// built by appending onto the *pre-await* snapshot. If two requests for the same page run
// concurrently, the request that started first but finishes last would overwrite whatever
// the other request already committed, silently dropping its question+answer. This is a
// realistic scenario: the same presentation page can be open in two browser tabs, or in a
// classroom sync session where several viewers can each ask their own question about the
// currently displayed page.

const PDF_ID = 'test-page-chat-concurrency-01';

function testSessionCookie(sub = 'account-1'): string {
  const payload = Buffer.from(JSON.stringify({ provider: 'google', sub, email: `${sub}@example.com` }), 'utf8').toString(
    'base64url',
  );
  const signature = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}
const SESSION_COOKIE = testSessionCookie('account-1');
const AUTH_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(SESSION_COOKIE)}` };
setSystemAuthSettings({ googleAuthEnabled: false });

function nowIso(): string {
  return new Date().toISOString();
}

function seedPdf(pdfId: string): void {
  const t = nowIso();
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,progress_step,progress_current,progress_total,error_message,user_prompt,require_script_confirmation,owner_sub,visibility,tts_voice,tts_speed,script_max_chars_per_page,created_at,updated_at)
     VALUES (?,?,?,'ready',?,NULL,NULL,NULL,NULL,NULL,0,'account-1','public',NULL,NULL,NULL,?,?)`,
  ).run(pdfId, 't', 't.pdf', 1, t, t);
  const pagesDir = path.join(config.storageRoot, pdfId, 'pages');
  fs.mkdirSync(pagesDir, { recursive: true });
  const uid = 'chatuid1';
  fs.writeFileSync(path.join(pagesDir, `${uid}.text.txt`), '頁面文字', 'utf8');
  db.prepare(
    `INSERT INTO pages (pdf_id,page_number,page_uid,image_path,text_path,script_path,audio_path,audio_duration_seconds,status,error_message,created_at,updated_at)
     VALUES (?,?,?,?,?,NULL,NULL,NULL,'audio_ready',NULL,?,?)`,
  ).run(pdfId, 1, uid, `pages/${uid}.jpg`, `pages/${uid}.text.txt`, t, t);
}

/** Stub OpenAI client whose response latency depends on which marker string appears in the
 * user message, so tests can control which concurrent request's LLM call resolves first. */
function delayedClient(delays: Record<string, number>) {
  return {
    chat: {
      completions: {
        create: async (body: unknown) => {
          const { messages } = body as { messages: Array<{ role: string; content: string }> };
          const userMsg = messages.find((m) => m.role === 'user')?.content ?? '';
          let delayMs = 0;
          let answer = 'default-answer';
          for (const [marker, ms] of Object.entries(delays)) {
            if (userMsg.includes(marker)) {
              delayMs = ms;
              answer = `answer-to-${marker}`;
            }
          }
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          return {
            choices: [{ message: { content: JSON.stringify({ answer }) }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
          };
        },
      },
    },
  };
}

test('POST /pages/:n/chat preserves both questions when two requests for the same page run concurrently', async () => {
  seedPdf(PDF_ID);
  // Request A is slow (its LLM call takes 200ms); request B is fast (10ms) and is sent
  // shortly after A. Without the fix, B's write (which lands first) would be overwritten by
  // A's write, which is based on a stale pre-await snapshot that doesn't include B's message.
  setOpenAIClientForTest(delayedClient({ QUESTION_A: 200, QUESTION_B: 10 }) as never);

  const app = await buildApp();
  try {
    const reqA = app.inject({
      method: 'POST',
      url: `/api/pdfs/${PDF_ID}/pages/1/chat`,
      headers: { ...AUTH_HEADERS, 'content-type': 'application/json' },
      payload: { question: 'QUESTION_A', history: [] },
    });
    // Small stagger so A's SELECT definitely happens before B's, simulating "A asked first,
    // B asked moments later while A's slower LLM call was still in flight."
    await new Promise((resolve) => setTimeout(resolve, 5));
    const reqB = app.inject({
      method: 'POST',
      url: `/api/pdfs/${PDF_ID}/pages/1/chat`,
      headers: { ...AUTH_HEADERS, 'content-type': 'application/json' },
      payload: { question: 'QUESTION_B', history: [] },
    });

    const [respA, respB] = await Promise.all([reqA, reqB]);
    assert.equal(respA.statusCode, 200);
    assert.equal(respB.statusCode, 200);

    const row = db
      .prepare(`SELECT chat_history_json FROM pages WHERE pdf_id = ? AND page_number = 1`)
      .get(PDF_ID) as { chat_history_json: string | null };
    const history = JSON.parse(row.chat_history_json ?? '[]') as Array<{ role: string; content: string }>;

    // Both question+answer pairs must survive regardless of which LLM call finished first.
    assert.equal(history.length, 4, `expected both Q&A pairs preserved, got: ${JSON.stringify(history)}`);
    const contents = history.map((m) => m.content);
    assert.ok(contents.includes('QUESTION_A'));
    assert.ok(contents.includes('answer-to-QUESTION_A'));
    assert.ok(contents.includes('QUESTION_B'));
    assert.ok(contents.includes('answer-to-QUESTION_B'));
  } finally {
    setOpenAIClientForTest(null);
    await app.close();
  }
});

test('POST /pages/:n/chat still works normally for a single sequential request', async () => {
  seedPdf(PDF_ID);
  setOpenAIClientForTest(delayedClient({ HELLO: 0 }) as never);

  const app = await buildApp();
  try {
    const resp = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${PDF_ID}/pages/1/chat`,
      headers: { ...AUTH_HEADERS, 'content-type': 'application/json' },
      payload: { question: 'HELLO', history: [] },
    });
    assert.equal(resp.statusCode, 200);
    const body = resp.json() as { answer: string };
    assert.equal(body.answer, 'answer-to-HELLO');

    const row = db
      .prepare(`SELECT chat_history_json FROM pages WHERE pdf_id = ? AND page_number = 1`)
      .get(PDF_ID) as { chat_history_json: string | null };
    const history = JSON.parse(row.chat_history_json ?? '[]') as Array<{ role: string; content: string }>;
    assert.equal(history.length, 2);
    assert.equal(history[0].content, 'HELLO');
    assert.equal(history[1].content, 'answer-to-HELLO');
  } finally {
    setOpenAIClientForTest(null);
    await app.close();
  }
});
