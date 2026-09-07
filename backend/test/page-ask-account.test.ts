/**
 * AI 導師花的是**發問者**的 API key，不是簡報擁有者的。
 *
 * server.ts 的 resolveAccountIdForRequest 讓所有帶 :id 的請求都跑在簡報 owner 的帳號情境下。
 * 對 pipeline／regenerate 這類「幫這份簡報做事」的工作是對的，但導師問答是觀看者的即時互動：
 * 照 owner 情境跑的話，任何讀得到簡報的人（含只拿到分享連結的人）問問題，花的都是擁有者的
 * key 與額度。這幾條測試把「用誰的 key」釘住。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { db } from '../src/db';
import { config } from '../src/config';
import { setOpenAIClientForTest } from '../src/services/openai';
import { setRuntimeAiSettings, setSystemAuthSettings } from '../src/services/aiSettings';
import { accountIdFromOwnerSub } from '../src/services/accountContext';
import { buildApp } from '../src/server';

setSystemAuthSettings({ googleAuthEnabled: false });

const RUN = crypto.randomBytes(4).toString('hex');
const OWNER_SUB = `askacct-owner-${RUN}`;
const READER_SUB = `askacct-reader-${RUN}`;

function sessionCookie(sub: string): string {
  const payload = Buffer.from(JSON.stringify({ provider: 'google', sub, email: `${sub}@example.com` }), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `makeslide_session=${encodeURIComponent(`${payload}.${sig}`)}`;
}
const OWNER_HEADERS = { cookie: sessionCookie(OWNER_SUB), 'content-type': 'application/json' };
const READER_HEADERS = { cookie: sessionCookie(READER_SUB), 'content-type': 'application/json' };

/** public 讓 reader 讀得到——導師問答本來就開放給任何讀得到這份簡報的登入者。 */
function seedPublicDeck(pdfId: string): void {
  const t = new Date().toISOString();
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,owner_sub,visibility,created_at,updated_at)
     VALUES (?,?,?,'ready',1,?,'public',?,?)`,
  ).run(pdfId, 'Deck', 'd.pdf', OWNER_SUB, t, t);
  const uid = `askacct${RUN}`;
  db.prepare(
    `INSERT INTO pages (pdf_id,page_number,page_uid,text_path,script_path,status,created_at,updated_at)
     VALUES (?,1,?,?,?,'audio_ready',?,?)`,
  ).run(pdfId, uid, `pages/${uid}.text.txt`, `pages/${uid}.script.txt`, t, t);
  const pagesDir = path.join(config.storageRoot, pdfId, 'pages');
  fs.mkdirSync(pagesDir, { recursive: true });
  fs.writeFileSync(path.join(pagesDir, `${uid}.text.txt`), '頁面內容', 'utf8');
  fs.writeFileSync(path.join(pagesDir, `${uid}.script.txt`), '逐字稿', 'utf8');
}

/** 捕捉送到模型的 `model` 參數——那是分辨「用了誰的設定」最直接的證據。 */
let capturedModel: string | null = null;
function mockModelCapture(): void {
  capturedModel = null;
  setOpenAIClientForTest({
    chat: {
      completions: {
        create: async (args: { model: string }) => {
          capturedModel = args.model;
          return {
            async *[Symbol.asyncIterator]() {
              yield { choices: [{ delta: { content: '答案' }, finish_reason: null }] };
              yield { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
            },
          };
        },
      },
    },
  } as never);
}

function askAs(app: Awaited<ReturnType<typeof buildApp>>, pdfId: string, headers: Record<string, string>) {
  return app.inject({ method: 'POST', url: `/api/pdfs/${pdfId}/pages/1/ask`, headers, body: JSON.stringify({ question: '這頁在說什麼？' }) });
}

test('ask — 讀者沒設自己的 key 時被擋下，不會去花擁有者的 key', async () => {
  const pdfId = `askacct-nokey-${RUN}`;
  seedPublicDeck(pdfId);
  // 沒有 stub client：hasTestOpenAIClient() 會讓守門一律放行（stub 本身就是 provider），
  // 那樣就測不到「有沒有 key」這件事。
  setOpenAIClientForTest(null);
  // 擁有者有 key，讀者沒有。base URL 指向本機的無效埠：萬一守門錯誤放行，
  // 也只會立刻 ECONNREFUSED，絕不會真的打到外部服務。
  setRuntimeAiSettings(accountIdFromOwnerSub(OWNER_SUB), { llmProvider: 'openai', openaiApiKey: 'owner-key', openaiBaseUrl: 'http://127.0.0.1:1/v1' });
  setRuntimeAiSettings(accountIdFromOwnerSub(READER_SUB), { llmProvider: 'openai', openaiApiKey: '' });

  const app = await buildApp();
  try {
    const resp = await askAs(app, pdfId, READER_HEADERS);
    assert.equal(resp.statusCode, 400, `讀者沒 key 卻沒被擋下：${resp.body.slice(0, 300)}`);
    assert.equal(JSON.parse(resp.body).error.code, 'API_KEY_MISSING');
  } finally {
    await app.close();
  }
});

test('ask — 讀者有自己的 key 時用讀者的設定，不是擁有者的', async () => {
  const pdfId = `askacct-readerkey-${RUN}`;
  seedPublicDeck(pdfId);
  mockModelCapture();
  setRuntimeAiSettings(accountIdFromOwnerSub(OWNER_SUB), { llmProvider: 'openai', openaiApiKey: 'owner-key', openaiBaseUrl: '', openaiLlmModel: 'owner-model' });
  setRuntimeAiSettings(accountIdFromOwnerSub(READER_SUB), { llmProvider: 'openai', openaiApiKey: 'reader-key', openaiLlmModel: 'reader-model' });

  const app = await buildApp();
  try {
    const resp = await askAs(app, pdfId, READER_HEADERS);
    assert.equal(resp.statusCode, 200);
    assert.equal(capturedModel, 'reader-model', '導師用的是擁有者的設定，而不是發問者自己的');
  } finally {
    setOpenAIClientForTest(null);
    await app.close();
  }
});

test('ask — 擁有者問自己的簡報照樣可用', async () => {
  const pdfId = `askacct-owner-${RUN}`;
  seedPublicDeck(pdfId);
  mockModelCapture();
  setRuntimeAiSettings(accountIdFromOwnerSub(OWNER_SUB), { llmProvider: 'openai', openaiApiKey: 'owner-key', openaiBaseUrl: '', openaiLlmModel: 'owner-model' });

  const app = await buildApp();
  try {
    const resp = await askAs(app, pdfId, OWNER_HEADERS);
    assert.equal(resp.statusCode, 200);
    assert.equal(capturedModel, 'owner-model');
  } finally {
    setOpenAIClientForTest(null);
    await app.close();
  }
});
