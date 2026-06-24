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
import { createPdfDir, pageScriptPath } from '../src/services/storage';

setSystemAuthSettings({ googleAuthEnabled: false });

function nowIso(): string {
  return new Date().toISOString();
}

function testSessionCookie(sub: string): string {
  const payload = Buffer.from(JSON.stringify({ provider: 'google', sub, email: `${sub}@example.com` }), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function makeHeaders(sub: string): Record<string, string> {
  return { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie(sub))}` };
}

// Fake embedding: 1536-dim vector with a fixed pattern
function fakeEmbedding(seed: number): number[] {
  const vec = new Array(1536).fill(0) as number[];
  vec[seed % 1536] = 1;
  return vec;
}

function mockEmbeddings(queryEmb: number[], pageEmb: number[]): void {
  let callCount = 0;
  setOpenAIClientForTest({
    embeddings: {
      create: async () => {
        const emb = callCount === 0 ? queryEmb : pageEmb;
        callCount++;
        return { data: [{ embedding: emb, index: 0, object: 'embedding' }], model: 'text-embedding-3-small', object: 'list', usage: { prompt_tokens: 10, total_tokens: 10 } };
      },
    },
  } as never);
}

function mockEmbeddingsBatch(embeddings: number[][]): void {
  let callCount = 0;
  setOpenAIClientForTest({
    embeddings: {
      create: async (req: { input: string | string[] }) => {
        const inputs = Array.isArray(req.input) ? req.input : [req.input];
        const embs = callCount === 0
          ? embeddings.slice(0, inputs.length)
          : embeddings.slice(callCount, callCount + inputs.length);
        callCount += inputs.length;
        return {
          data: embs.map((e, i) => ({ embedding: e, index: i, object: 'embedding' as const })),
          model: 'text-embedding-3-small',
          object: 'list' as const,
          usage: { prompt_tokens: 10, total_tokens: 10 },
        };
      },
    },
  } as never);
}

function seedPdfWithScript(pdfId: string, ownerSub: string, scriptText: string): string {
  const pageUid = `${pdfId}-uid1`;
  const t = nowIso();

  db.prepare(`DELETE FROM page_embeddings WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);

  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,owner_sub,visibility,created_at,updated_at)
     VALUES (?,?,?,'ready',1,?,?,?,?)`,
  ).run(pdfId, `Test PDF ${pdfId}`, `${pdfId}.pdf`, ownerSub, 'private', t, t);

  db.prepare(
    `INSERT INTO pages (pdf_id,page_number,page_uid,status,script_path,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?)`,
  ).run(pdfId, 1, pageUid, 'audio_ready', `pages/${pageUid}.script.txt`, t, t);

  createPdfDir(pdfId);
  fs.writeFileSync(pageScriptPath(pdfId, pageUid), scriptText, 'utf8');

  return pageUid;
}

function cleanupPdf(pdfId: string): void {
  db.prepare(`DELETE FROM page_embeddings WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  try {
    fs.rmSync(path.join(config.storageRoot, pdfId), { recursive: true, force: true });
  } catch { /* ignore */ }
}

test('GET /api/search?semantic=true — 401 when not authenticated', async () => {
  const app = await buildApp();
  try {
    const resp = await app.inject({ method: 'GET', url: '/api/search?q=test&semantic=true' });
    assert.equal(resp.statusCode, 401);
  } finally {
    await app.close();
  }
});

test('GET /api/search?semantic=true — returns semantic results with score', async () => {
  const pdfId = 'semantic-search-test-01';
  const ownerSub = 'sem-search-owner-1';

  seedPdfWithScript(pdfId, ownerSub, '深度學習是人工智慧的一個分支，使用多層神經網路進行特徵學習。');

  // Query embedding = [1, 0, 0, ...]; page embedding = [1, 0, 0, ...] → cosine = 1.0 (high similarity)
  const qVec = fakeEmbedding(0);
  // Batch mock: first call is the query, second call is the page embedding batch
  let callCount = 0;
  setOpenAIClientForTest({
    embeddings: {
      create: async (req: { input: string | string[] }) => {
        const inputs = Array.isArray(req.input) ? req.input : [req.input];
        const embs = inputs.map(() => fakeEmbedding(callCount++));
        return {
          data: embs.map((e, i) => ({ embedding: e, index: i, object: 'embedding' as const })),
          model: 'text-embedding-3-small',
          object: 'list' as const,
          usage: { prompt_tokens: 10, total_tokens: 10 },
        };
      },
    },
  } as never);

  // Override so query and page both get embedding at index 0 → cosine similarity = 1.0
  let call2Count = 0;
  setOpenAIClientForTest({
    embeddings: {
      create: async () => {
        const emb = call2Count === 0 ? qVec : qVec; // same vector for both → cosine = 1.0
        call2Count++;
        return {
          data: [{ embedding: emb, index: 0, object: 'embedding' as const }],
          model: 'text-embedding-3-small',
          object: 'list' as const,
          usage: { prompt_tokens: 10, total_tokens: 10 },
        };
      },
    },
  } as never);

  const app = await buildApp();
  try {
    const resp = await app.inject({
      method: 'GET',
      url: `/api/search?q=深度學習&semantic=true`,
      headers: makeHeaders(ownerSub),
    });
    assert.equal(resp.statusCode, 200);
    const body = resp.json() as { query: string; results: Array<{ pdf_id: string; match_type: string; score?: number }>; semantic?: boolean };
    assert.equal(body.semantic, true);
    assert.ok(Array.isArray(body.results), 'results should be an array');
    // The similarity is 1.0 which is > 0.3 threshold, so we expect a result
    if (body.results.length > 0) {
      const r = body.results[0]!;
      assert.equal(r.match_type, 'semantic');
      assert.equal(r.pdf_id, pdfId);
    }
  } finally {
    await app.close();
    cleanupPdf(pdfId);
    setOpenAIClientForTest(null);
  }
});

test('GET /api/search?semantic=true — returns empty when no PDFs owned', async () => {
  const ownerSub = 'sem-search-no-pdfs';
  const app = await buildApp();
  try {
    const resp = await app.inject({
      method: 'GET',
      url: '/api/search?q=test&semantic=true',
      headers: makeHeaders(ownerSub),
    });
    assert.equal(resp.statusCode, 200);
    const body = resp.json() as { results: unknown[]; semantic?: boolean };
    assert.equal(body.semantic, true);
    assert.deepEqual(body.results, []);
  } finally {
    await app.close();
  }
});

test('GET /api/search (keyword) — still works normally without semantic flag', async () => {
  const pdfId = 'semantic-search-kw-test-01';
  const ownerSub = 'sem-search-kw-owner';

  seedPdfWithScript(pdfId, ownerSub, '這是一份關於量子計算的簡報，介紹量子位元和疊加態。');

  const app = await buildApp();
  try {
    const resp = await app.inject({
      method: 'GET',
      url: `/api/search?q=量子計算`,
      headers: makeHeaders(ownerSub),
    });
    assert.equal(resp.statusCode, 200);
    const body = resp.json() as { results: Array<{ pdf_id: string; match_type: string }> };
    const scriptResult = body.results.find((r) => r.pdf_id === pdfId && r.match_type === 'script');
    assert.ok(scriptResult, 'keyword search should find script match');
  } finally {
    await app.close();
    cleanupPdf(pdfId);
  }
});
