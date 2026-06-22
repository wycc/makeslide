import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildContentDisposition } from '../src/routes/pdfs/export';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';

setSystemAuthSettings({ googleAuthEnabled: false });

function nowIso(): string {
  return new Date().toISOString();
}

function seedExportPdf(pdfId: string, title: string): void {
  const t = nowIso();
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,owner_sub,visibility,created_at,updated_at)
     VALUES (?,?,?,'ready',1,NULL,'public',?,?)`,
  ).run(pdfId, title, `${pdfId}.pdf`, t, t);
  const dir = path.join(config.storageRoot, pdfId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'dummy.txt'), 'hello');
}

test('buildContentDisposition: ASCII-only filename round-trips unchanged through the fallback param', () => {
  const header = buildContentDisposition('My Slides.zip');
  assert.equal(header, `attachment; filename="My Slides.zip"; filename*=UTF-8''My%20Slides.zip`);
});

test('buildContentDisposition: a Traditional Chinese filename decodes correctly via filename*, unlike a bare percent-encoded filename=', () => {
  const title = '中文簡報標題.zip';
  const header = buildContentDisposition(title);

  // The previous implementation put encodeURIComponent(title) directly inside filename="...",
  // which is NOT percent-decoded by HTTP clients per RFC 6266 — it would be taken literally,
  // producing a garbled "%E4%B8%AD...zip" download filename. Guard against regressing to that.
  assert.ok(!header.includes(`filename="${encodeURIComponent(title)}"`), 'must not regress to embedding a raw percent-encoded string as the literal filename= value');

  // filename* must carry the correctly percent-encoded UTF-8 bytes that a standards-compliant
  // client decodes back to the original CJK title.
  const filenameStarMatch = header.match(/filename\*=UTF-8''([^;]+)/);
  assert.ok(filenameStarMatch, `expected a filename*=UTF-8'' parameter in: ${header}`);
  assert.equal(decodeURIComponent(filenameStarMatch![1]), title);

  // The ASCII fallback filename= must remain ASCII-only (non-ASCII chars replaced), so legacy
  // clients that ignore filename* still get a well-formed, non-garbled header value.
  const filenameMatch = header.match(/filename="([^"]*)"/);
  assert.ok(filenameMatch, `expected a filename="..." fallback in: ${header}`);
  assert.ok(/^[\x20-\x7E]*$/.test(filenameMatch![1]), 'ASCII fallback filename must only contain printable ASCII characters');
});

test('GET /api/pdfs/:id/export.zip returns a Content-Disposition header whose filename* decodes back to the Chinese title', async () => {
  const pdfId = 'export-zip-cjk-title-01';
  seedExportPdf(pdfId, '中文簡報標題');
  const app = await buildApp();
  try {
    const resp = await app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}/export.zip` });
    assert.equal(resp.statusCode, 200);
    const disposition = resp.headers['content-disposition'];
    assert.ok(typeof disposition === 'string', 'expected a content-disposition header');
    const filenameStarMatch = (disposition as string).match(/filename\*=UTF-8''([^;]+)/);
    assert.ok(filenameStarMatch, `expected filename*=UTF-8'' in: ${disposition}`);
    assert.equal(decodeURIComponent(filenameStarMatch![1]), '中文簡報標題.zip');
  } finally {
    await app.close();
  }
});
