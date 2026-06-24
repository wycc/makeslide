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
import {
  buildDescriptionSystem,
  buildDescriptionUser,
  generateDescription,
} from '../src/worker/steps/generateDescription';

setSystemAuthSettings({ googleAuthEnabled: false });

const RUN = crypto.randomBytes(4).toString('hex');
const OWNER_SUB = `desc-owner-${RUN}`;

function testSessionCookie(sub: string): string {
  const payload = Buffer.from(JSON.stringify({ provider: 'google', sub, email: `${sub}@example.com` }), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}
const OWNER_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie(OWNER_SUB))}` };

function nowIso(): string { return new Date().toISOString(); }

function seedPdfWithScripts(pdfId: string, owner: string, scripts: string[]): void {
  const t = nowIso();
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,owner_sub,created_at,updated_at)
     VALUES (?,?,?,'ready',?,?,?,?)`,
  ).run(pdfId, 't', 't.pdf', scripts.length, owner, t, t);
  const pagesDir = path.join(config.storageRoot, pdfId, 'pages');
  fs.mkdirSync(pagesDir, { recursive: true });
  scripts.forEach((script, idx) => {
    const pageNumber = idx + 1;
    const uid = `gendesc${RUN}-${pageNumber}`;
    db.prepare(
      `INSERT INTO pages (pdf_id,page_number,page_uid,image_path,text_path,script_path,status,created_at,updated_at)
       VALUES (?,?,?,?,?,?,'audio_ready',?,?)`,
    ).run(pdfId, pageNumber, uid, `pages/${uid}.jpg`, `pages/${uid}.text.txt`, `pages/${uid}.script.txt`, t, t);
    fs.writeFileSync(path.join(pagesDir, `${uid}.script.txt`), script, 'utf8');
  });
}

function mockDescription(text: string): void {
  setOpenAIClientForTest({
    chat: {
      completions: {
        create: async () => ({
          choices: [{ message: { content: JSON.stringify({ description: text }) }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      },
    },
  } as never);
}

// ── unit ──────────────────────────────────────────────────────────────────

test('buildDescriptionSystem / buildDescriptionUser honour language', () => {
  assert.match(buildDescriptionSystem('zh-TW'), /精簡的內容簡介/);
  assert.match(buildDescriptionSystem('en'), /concise summaries/);
  assert.match(buildDescriptionUser('CORPUS', 'zh-TW'), /CORPUS/);
});

test('generateDescription summarises the first pages (mocked LLM)', async () => {
  seedPdfWithScripts(`desc-unit-${RUN}`, OWNER_SUB, ['第一頁逐字稿', '第二頁逐字稿', '第三頁', '第四頁不應使用']);
  mockDescription('這是一份關於測試的簡報。');
  try {
    const result = await generateDescription(`desc-unit-${RUN}`, { contentLanguage: 'zh-TW' });
    assert.equal(result.description, '這是一份關於測試的簡報。');
    assert.equal(result.source, 'script');
  } finally {
    setOpenAIClientForTest(null);
  }
});

// ── route ─────────────────────────────────────────────────────────────────

test('POST /api/pdfs/:id/generate-description persists and returns description', async () => {
  const pdfId = `desc-route-${RUN}`;
  seedPdfWithScripts(pdfId, OWNER_SUB, ['內容一', '內容二']);
  mockDescription('自動生成的簡介。');
  const app = await buildApp();
  try {
    const resp = await app.inject({ method: 'POST', url: `/api/pdfs/${pdfId}/generate-description`, headers: OWNER_HEADERS });
    assert.equal(resp.statusCode, 200);
    const body = resp.json() as { description: string };
    assert.equal(body.description, '自動生成的簡介。');
    const row = db.prepare(`SELECT description FROM pdfs WHERE id = ?`).get(pdfId) as { description: string };
    assert.equal(row.description, '自動生成的簡介。');
  } finally {
    setOpenAIClientForTest(null);
    await app.close();
  }
});

test('POST /api/pdfs/:id/generate-description — 403 for non-owner', async () => {
  const pdfId = `desc-forbidden-${RUN}`;
  seedPdfWithScripts(pdfId, `someone-else-${RUN}`, ['內容']);
  const app = await buildApp();
  try {
    const resp = await app.inject({ method: 'POST', url: `/api/pdfs/${pdfId}/generate-description`, headers: OWNER_HEADERS });
    assert.equal(resp.statusCode, 403);
  } finally {
    await app.close();
  }
});
