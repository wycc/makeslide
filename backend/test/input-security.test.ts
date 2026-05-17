import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/server';

function multipartUpload(filename: string, contentType: string, body: string): string {
  return (
    '------roo\r\n' +
    `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
    `Content-Type: ${contentType}\r\n\r\n` +
    body +
    '\r\n------roo--\r\n'
  );
}

test('POST /api/pdfs sanitizes uploaded filename before persisting metadata', async () => {
  const app = await buildApp();
  const resp = await app.inject({
    method: 'POST',
    url: '/api/pdfs',
    headers: { 'content-type': 'multipart/form-data; boundary=----roo' },
    payload: multipartUpload('../evil\u0000<deck>.txt', 'text/plain', 'hello'),
  });

  assert.equal(resp.statusCode, 201);
  const body = resp.json() as { title: string; original_filename: string };
  assert.equal(body.original_filename, 'evil_deck_.txt');
  assert.equal(body.title, 'evil_deck_');
  await app.close();
});

test('POST /api/pdfs rejects spoofed PDF uploads whose content is not PDF', async () => {
  const app = await buildApp();
  const resp = await app.inject({
    method: 'POST',
    url: '/api/pdfs',
    headers: { 'content-type': 'multipart/form-data; boundary=----roo' },
    payload: multipartUpload('spoof.pdf', 'application/pdf', 'not actually a pdf'),
  });

  assert.equal(resp.statusCode, 400);
  assert.deepEqual(resp.json(), {
    error: { code: 'INVALID_UPLOAD_CONTENT', message: 'PDF 檔案內容格式不正確' },
  });
  await app.close();
});

test('POST /api/pdfs rejects text uploads containing NUL bytes', async () => {
  const app = await buildApp();
  const resp = await app.inject({
    method: 'POST',
    url: '/api/pdfs',
    headers: { 'content-type': 'multipart/form-data; boundary=----roo' },
    payload: multipartUpload('payload.txt', 'text/plain', `hello${String.fromCharCode(0)}world`),
  });

  assert.equal(resp.statusCode, 400);
  assert.deepEqual(resp.json(), {
    error: { code: 'INVALID_UPLOAD_CONTENT', message: 'TXT 檔案必須是 UTF-8 文字內容' },
  });
  await app.close();
});

test('POST /api/youtube only accepts YouTube hosts and normalized language tags', async () => {
  const app = await buildApp();

  const invalidHost = await app.inject({
    method: 'POST',
    url: '/api/youtube',
    payload: { youtube_url: 'https://example.com/watch?v=dQw4w9WgXcQ', language: 'zh-TW' },
  });
  assert.equal(invalidHost.statusCode, 400);

  const invalidLanguage = await app.inject({
    method: 'POST',
    url: '/api/youtube',
    payload: { youtube_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', language: '../zh' },
  });
  assert.equal(invalidLanguage.statusCode, 400);

  await app.close();
});
