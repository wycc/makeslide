import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';
import { createPdfDir, pageTextPath, pageScriptPath } from '../src/services/storage';
import crypto from 'node:crypto';

setSystemAuthSettings({ googleAuthEnabled: false });

function nowIso(): string {
  return new Date().toISOString();
}

function testSessionCookie(sub = 'account-1'): string {
  const payload = Buffer.from(JSON.stringify({ provider: 'google', sub, email: `${sub}@example.com` }), 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

const OWNER_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie('search-owner-1'))}`, 'content-type': 'application/json' };

interface SeedPdfOptions {
  pdfId: string;
  title: string;
  ownerSub: string | null;
  visibility: 'private' | 'public' | 'public_editable';
  pages?: Array<{
    pageNumber: number;
    pageUid: string;
    scriptText?: string;
    pageText?: string;
  }>;
}

function seedPdf(opts: SeedPdfOptions): void {
  const t = nowIso();
  const { pdfId, title, ownerSub, visibility, pages = [] } = opts;

  // Clean up first
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);

  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,progress_step,progress_current,progress_total,error_message,user_prompt,require_script_confirmation,owner_sub,visibility,tts_voice,tts_speed,script_max_chars_per_page,created_at,updated_at)
     VALUES (?,?,?,'ready',?,NULL,NULL,NULL,NULL,NULL,0,?,?,NULL,NULL,NULL,?,?)`,
  ).run(pdfId, title, `${pdfId}.pdf`, pages.length || 1, ownerSub, visibility, t, t);

  createPdfDir(pdfId);

  for (const page of pages) {
    db.prepare(
      `INSERT INTO pages (pdf_id,page_number,page_uid,image_path,text_path,script_path,audio_path,audio_duration_seconds,status,error_message,created_at,updated_at)
       VALUES (?,?,?,?,?,?,NULL,NULL,'audio_ready',NULL,?,?)`,
    ).run(
      pdfId,
      page.pageNumber,
      page.pageUid,
      `pages/${page.pageUid}.jpg`,
      page.pageText != null ? `pages/${page.pageUid}.text.txt` : null,
      page.scriptText != null ? `pages/${page.pageUid}.script.txt` : null,
      t,
      t,
    );

    if (page.scriptText != null) {
      fs.writeFileSync(pageScriptPath(pdfId, page.pageUid), page.scriptText, 'utf8');
    }
    if (page.pageText != null) {
      fs.writeFileSync(pageTextPath(pdfId, page.pageUid), page.pageText, 'utf8');
    }
  }
}

function cleanupPdf(pdfId: string): void {
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  try {
    const dir = path.join(config.storageRoot, pdfId);
    fs.rmSync(dir, { recursive: true, force: true });
  } catch { /* ignore */ }
}

// Test 1: Find PDF by title keyword match
test('GET /api/search - finds PDF by title keyword', async () => {
  const pdfId = 'search-test-title-01';
  try {
    seedPdf({
      pdfId,
      title: '機器學習入門教材',
      ownerSub: 'search-owner-1',
      visibility: 'private',
      pages: [{ pageNumber: 1, pageUid: `${pdfId}-uid1` }],
    });

    const app = await buildApp();
    try {
      const resp = await app.inject({
        method: 'GET',
        url: '/api/search?q=機器學習',
        headers: OWNER_HEADERS,
      });
      assert.equal(resp.statusCode, 200);
      const body = resp.json() as { query: string; results: Array<{ pdf_id: string; match_type: string; page_number: number | null }> };
      assert.equal(body.query, '機器學習');
      const titleResult = body.results.find((r) => r.pdf_id === pdfId && r.match_type === 'title');
      assert.ok(titleResult, 'Should find a title match');
      assert.equal(titleResult.page_number, null, 'Title match should have null page_number');
    } finally {
      await app.close();
    }
  } finally {
    cleanupPdf(pdfId);
  }
});

// Test 2: Find page by script content
test('GET /api/search - finds page by script (transcript) content', async () => {
  const pdfId = 'search-test-script-01';
  const pageUid = `${pdfId}-uid1`;
  try {
    seedPdf({
      pdfId,
      title: '測試簡報逐字稿搜尋',
      ownerSub: 'search-owner-1',
      visibility: 'private',
      pages: [{
        pageNumber: 1,
        pageUid,
        scriptText: '歡迎來到深度學習的世界，今天我們要介紹神經網路的基本概念。',
      }],
    });

    const app = await buildApp();
    try {
      const resp = await app.inject({
        method: 'GET',
        url: '/api/search?q=深度學習',
        headers: OWNER_HEADERS,
      });
      assert.equal(resp.statusCode, 200);
      const body = resp.json() as { results: Array<{ pdf_id: string; match_type: string; page_number: number | null }> };
      const scriptResult = body.results.find((r) => r.pdf_id === pdfId && r.match_type === 'script');
      assert.ok(scriptResult, 'Should find a script match');
      assert.equal(scriptResult.page_number, 1, 'Should have correct page_number');
    } finally {
      await app.close();
    }
  } finally {
    cleanupPdf(pdfId);
  }
});

// Test 3: Empty q returns 400
test('GET /api/search - empty q returns 400', async () => {
  const app = await buildApp();
  try {
    const resp = await app.inject({
      method: 'GET',
      url: '/api/search?q=',
      headers: OWNER_HEADERS,
    });
    assert.equal(resp.statusCode, 400);
  } finally {
    await app.close();
  }
});

// Test 4: q over 100 chars returns 400
test('GET /api/search - q over 100 chars returns 400', async () => {
  const longQ = 'a'.repeat(101);
  const app = await buildApp();
  try {
    const resp = await app.inject({
      method: 'GET',
      url: `/api/search?q=${encodeURIComponent(longQ)}`,
      headers: OWNER_HEADERS,
    });
    assert.equal(resp.statusCode, 400);
  } finally {
    await app.close();
  }
});

// Test 5: Private PDF not visible to non-owner
test('GET /api/search - private PDF not visible to non-owner', async () => {
  const pdfId = 'search-test-private-01';
  try {
    seedPdf({
      pdfId,
      title: '私有簡報不應被其他使用者搜到',
      ownerSub: 'search-other-owner-99',
      visibility: 'private',
      pages: [{ pageNumber: 1, pageUid: `${pdfId}-uid1` }],
    });

    const app = await buildApp();
    try {
      const resp = await app.inject({
        method: 'GET',
        url: '/api/search?q=私有簡報不應被其他使用者搜到',
        headers: OWNER_HEADERS,  // logged in as search-owner-1, not search-other-owner-99
      });
      assert.equal(resp.statusCode, 200);
      const body = resp.json() as { results: Array<{ pdf_id: string }> };
      const found = body.results.find((r) => r.pdf_id === pdfId);
      assert.equal(found, undefined, 'Private PDF of another owner should not appear in results');
    } finally {
      await app.close();
    }
  } finally {
    cleanupPdf(pdfId);
  }
});

// Test 6: Description field match
test('GET /api/search - finds PDF by description keyword', async () => {
  const pdfId = 'search-test-desc-01';
  try {
    const t = new Date().toISOString();
    db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
    db.prepare(
      `INSERT INTO pdfs (id,title,description,original_filename,status,page_count,owner_sub,visibility,created_at,updated_at)
       VALUES (?,?,?,'desc-test.pdf','ready',1,'search-owner-1','private',?,?)`,
    ).run(pdfId, '無關標題', '這份說明文件介紹量子運算概念', t, t);

    const app = await buildApp();
    try {
      const resp = await app.inject({
        method: 'GET',
        url: '/api/search?q=量子運算',
        headers: OWNER_HEADERS,
      });
      assert.equal(resp.statusCode, 200);
      const body = resp.json() as { results: Array<{ pdf_id: string; match_type: string }> };
      const descResult = body.results.find((r) => r.pdf_id === pdfId && r.match_type === 'description');
      assert.ok(descResult, 'Should find a description match');
    } finally {
      await app.close();
    }
  } finally {
    db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  }
});

// Test 7: Result format is correct
test('GET /api/search - result format is correct', async () => {
  const pdfId = 'search-test-format-01';
  try {
    seedPdf({
      pdfId,
      title: '格式驗證測試簡報',
      ownerSub: 'search-owner-1',
      visibility: 'private',
      pages: [{ pageNumber: 1, pageUid: `${pdfId}-uid1` }],
    });

    const app = await buildApp();
    try {
      const resp = await app.inject({
        method: 'GET',
        url: '/api/search?q=格式驗證',
        headers: OWNER_HEADERS,
      });
      assert.equal(resp.statusCode, 200);
      const body = resp.json() as { query: string; results: unknown[] };
      assert.ok('query' in body, 'Response should have query field');
      assert.ok('results' in body, 'Response should have results field');
      assert.ok(Array.isArray(body.results), 'results should be an array');

      if (body.results.length > 0) {
        const r = body.results[0] as Record<string, unknown>;
        assert.ok('pdf_id' in r, 'Result should have pdf_id');
        assert.ok('pdf_title' in r, 'Result should have pdf_title');
        assert.ok('match_type' in r, 'Result should have match_type');
        assert.ok('snippet' in r, 'Result should have snippet');
        assert.ok('page_number' in r, 'Result should have page_number');
      }
    } finally {
      await app.close();
    }
  } finally {
    cleanupPdf(pdfId);
  }
});
