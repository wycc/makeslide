import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';
import { pdfDir } from '../src/services/storage';
import { blankPageRowPaths } from '../src/services/blankPage';

function testSessionCookie(sub = 'blank-owner'): string {
  const payload = Buffer.from(
    JSON.stringify({ provider: 'google', sub, email: `${sub}@example.com` }),
    'utf8',
  ).toString('base64url');
  const signature = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

const HEADERS = {
  cookie: `makeslide_session=${encodeURIComponent(testSessionCookie())}`,
  'content-type': 'application/json',
};

setSystemAuthSettings({ googleAuthEnabled: false });

test('POST /api/pdfs/blank creates a ready one-page deck with the blank slide on disk', async () => {
  const app = await buildApp();
  try {
    const resp = await app.inject({
      method: 'POST',
      url: '/api/pdfs/blank',
      headers: HEADERS,
      payload: { title: '空白測試', category: '課程' },
    });
    assert.equal(resp.statusCode, 201);
    const body = resp.json() as { id: string; status: string; page_count: number; category: string; title: string };
    assert.equal(body.status, 'ready');
    assert.equal(body.page_count, 1);
    assert.equal(body.title, '空白測試');
    // The deck lands in the category the client is browsing, like the other creation endpoints.
    assert.equal(body.category, '課程');

    const row = db.prepare('SELECT status, page_count FROM pdfs WHERE id = ?').get(body.id) as
      | { status: string; page_count: number }
      | undefined;
    assert.deepEqual(row, { status: 'ready', page_count: 1 });

    const pages = db
      .prepare('SELECT page_number, page_uid, image_path, text_path, script_path, status FROM pages WHERE pdf_id = ?')
      .all(body.id) as Array<{ page_number: number; page_uid: string; image_path: string; text_path: string; script_path: string; status: string }>;
    assert.equal(pages.length, 1);
    assert.equal(pages[0]!.page_number, 1);
    assert.equal(pages[0]!.status, 'audio_ready');
    const expected = blankPageRowPaths(pages[0]!.page_uid);
    assert.equal(pages[0]!.image_path, expected.image_path);
    assert.equal(pages[0]!.text_path, expected.text_path);
    assert.equal(pages[0]!.script_path, expected.script_path);

    // Without these files on disk the slide renders as broken rather than empty.
    const dir = pdfDir(body.id);
    for (const rel of [expected.image_path, expected.text_path, expected.script_path, 'metadata.json']) {
      assert.ok(fs.existsSync(`${dir}/${rel}`), `missing ${rel}`);
    }
    assert.ok(fs.statSync(`${dir}/${expected.image_path}`).size > 0, 'blank slide image is empty');
  } finally {
    await app.close();
  }
});

test('a blank deck accepts more pages right away — the point of creating one', async () => {
  const app = await buildApp();
  try {
    const created = await app.inject({
      method: 'POST',
      url: '/api/pdfs/blank',
      headers: HEADERS,
      payload: {},
    });
    const { id } = created.json() as { id: string };

    const added = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${id}/pages`,
      headers: HEADERS,
      payload: { after_page_number: 1 },
    });
    assert.equal(added.statusCode, 201);
    assert.deepEqual(added.json(), {
      ...(added.json() as Record<string, unknown>),
      page_number: 2,
      page_count: 2,
    });

    const count = db.prepare('SELECT COUNT(*) AS n FROM pages WHERE pdf_id = ?').get(id) as { n: number };
    assert.equal(count.n, 2);
  } finally {
    await app.close();
  }
});

test('a blank deck defaults its title when none is given', async () => {
  const app = await buildApp();
  try {
    const resp = await app.inject({ method: 'POST', url: '/api/pdfs/blank', headers: HEADERS, payload: {} });
    assert.equal(resp.statusCode, 201);
    assert.equal((resp.json() as { title: string }).title, '空白簡報');
  } finally {
    await app.close();
  }
});
