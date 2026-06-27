import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildApp } from '../src/server';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';
import { checkPoppler } from '../src/worker/poppler';

setSystemAuthSettings({ googleAuthEnabled: false });

function testSessionCookie(sub: string): string {
  const payload = Buffer.from(
    JSON.stringify({ provider: 'google', sub, email: `${sub}@example.com` }),
    'utf8',
  ).toString('base64url');
  const signature = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

const HEADERS = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie('source-page-count-test'))}` };

/** Minimal valid multi-page PDF (standard Helvetica text); byte offsets computed as built. */
function buildTextPdf(pageCount: number): Buffer {
  const objects: string[] = [];
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  const kids = Array.from({ length: pageCount }, (_, i) => `${3 + i} 0 R`).join(' ');
  objects[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`;
  const fontObjNum = 3 + pageCount * 2;
  for (let i = 0; i < pageCount; i++) {
    const pageObjNum = 3 + i;
    const contentObjNum = 3 + pageCount + i;
    objects[pageObjNum] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] `
      + `/Resources << /Font << /F1 ${fontObjNum} 0 R >> >> /Contents ${contentObjNum} 0 R >>`;
    const content = `BT /F1 48 Tf 10 100 Td (Page ${i + 1}) Tj ET\n`;
    objects[contentObjNum] = `<< /Length ${Buffer.byteLength(content, 'utf8')} >>\nstream\n${content}endstream`;
  }
  objects[fontObjNum] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let i = 1; i <= fontObjNum; i++) {
    offsets[i] = Buffer.byteLength(pdf, 'utf8');
    pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${fontObjNum + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= fontObjNum; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${fontObjNum + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, 'utf8');
}

function multipartBody(filename: string, contentType: string, fileBytes: Buffer): Buffer {
  const head = Buffer.from(
    '------roo\r\n'
    + `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n`
    + `Content-Type: ${contentType}\r\n\r\n`,
    'utf8',
  );
  const tail = Buffer.from('\r\n------roo--\r\n', 'utf8');
  return Buffer.concat([head, fileBytes, tail]);
}

test('POST /api/pdfs returns the uploaded PDF physical page count as source_page_count (cost-estimate basis)', async () => {
  const poppler = await checkPoppler();
  if (!poppler.pdfinfo) {
    // getPdfPageCount shells out to pdfinfo; skip gracefully where poppler is unavailable.
    return;
  }
  const app = await buildApp();
  try {
    const resp = await app.inject({
      method: 'POST',
      url: '/api/pdfs',
      headers: { ...HEADERS, 'content-type': 'multipart/form-data; boundary=----roo' },
      payload: multipartBody('deck.pdf', 'application/pdf', buildTextPdf(7)),
    });
    assert.equal(resp.statusCode, 201);
    const body = resp.json() as { status: string; source_page_count: number | null; page_count?: number };
    assert.equal(body.source_page_count, 7);
    // It is an estimate basis only; the real slide count is still null until the pipeline runs.
    assert.equal(body.status, 'awaiting_prompt');
    assert.equal(body.page_count, undefined);
  } finally {
    await app.close();
  }
});

test('POST /api/pdfs leaves source_page_count null for a TXT upload (slide count unknown pre-generation)', async () => {
  const app = await buildApp();
  try {
    const resp = await app.inject({
      method: 'POST',
      url: '/api/pdfs',
      headers: { ...HEADERS, 'content-type': 'multipart/form-data; boundary=----roo' },
      payload: multipartBody('notes.txt', 'text/plain', Buffer.from('hello world from a plain text upload', 'utf8')),
    });
    assert.equal(resp.statusCode, 201);
    const body = resp.json() as { source_page_count: number | null };
    assert.equal(body.source_page_count, null);
  } finally {
    await app.close();
  }
});
