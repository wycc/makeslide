import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';
import {
  pageImagePath,
  pageReactSlideBackgroundPath,
  pageReactSlideConfigPath,
} from '../src/services/storage';
import { parseStoredReactSlideConfig } from '../src/services/reactSlide';

/**
 * Converting a page between types must not lose what is on screen (docs/react-slide-design.md
 * §10.1): becoming a React slide adopts the old image as the background, and going back writes the
 * rendered React page into the image. Without those two, each conversion silently discards the
 * visual the user had.
 */

function testSessionCookie(sub = 'convert-owner'): string {
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

const SLIDE_CODE = `function Slide() {
  return <div style={{ width: '100%', height: '100%' }}><h1>轉換測試</h1></div>;
}
window.SlideComponent = Slide;
`;

async function createBlankDeck(app: Awaited<ReturnType<typeof buildApp>>): Promise<string> {
  const resp = await app.inject({
    method: 'POST',
    url: '/api/pdfs/blank',
    headers: HEADERS,
    payload: { title: '轉換測試', category: '課程' },
  });
  assert.equal(resp.statusCode, 201);
  return (resp.json() as { id: string }).id;
}

function pageUidOf(pdfId: string, pageNumber: number): string {
  const row = db
    .prepare(`SELECT page_uid FROM pages WHERE pdf_id = ? AND page_number = ?`)
    .get(pdfId, pageNumber) as { page_uid: string };
  return row.page_uid;
}

test('becoming a React slide adopts the page image as the background', async () => {
  const app = await buildApp();
  try {
    const pdfId = await createBlankDeck(app);
    const pageUid = pageUidOf(pdfId, 1);
    assert.ok(fs.existsSync(pageImagePath(pdfId, pageUid)), 'blank deck should have a page image');

    const resp = await app.inject({
      method: 'PUT',
      url: `/api/pdfs/${pdfId}/pages/1/react-slide`,
      headers: HEADERS,
      payload: { code: SLIDE_CODE },
    });
    assert.equal(resp.statusCode, 200);
    assert.equal((resp.json() as { render_type: string }).render_type, 'react');

    // The old picture is copied — not referenced — because baking rewrites the page JPG and a
    // background pointing at it would compound with every bake.
    assert.ok(fs.existsSync(pageReactSlideBackgroundPath(pdfId, pageUid)), 'background snapshot should exist');
    const stored = parseStoredReactSlideConfig(fs.readFileSync(pageReactSlideConfigPath(pdfId, pageUid), 'utf8'));
    assert.equal(stored.background.mode, 'image');
    assert.equal(stored.background.file, `pages/${pageUid}.slide-bg.png`);
    assert.ok((stored.background.overlayOpacity ?? 0) > 0, 'an adopted image gets a scrim so new text reads');
  } finally {
    await app.close();
  }
});

test('a background the user already chose is never overwritten by the conversion', async () => {
  const app = await buildApp();
  try {
    const pdfId = await createBlankDeck(app);
    const pageUid = pageUidOf(pdfId, 1);

    const chosen = await app.inject({
      method: 'PUT',
      url: `/api/pdfs/${pdfId}/pages/1/react-slide`,
      headers: HEADERS,
      payload: { config: { version: 1, overrides: {}, background: { mode: 'color', color: '#123456' } } },
    });
    assert.equal(chosen.statusCode, 200);

    const converted = await app.inject({
      method: 'PUT',
      url: `/api/pdfs/${pdfId}/pages/1/react-slide`,
      headers: HEADERS,
      payload: { code: SLIDE_CODE },
    });
    assert.equal(converted.statusCode, 200);

    const stored = parseStoredReactSlideConfig(fs.readFileSync(pageReactSlideConfigPath(pdfId, pageUid), 'utf8'));
    assert.equal(stored.background.mode, 'color');
    assert.equal(stored.background.color, '#123456');
    assert.equal(fs.existsSync(pageReactSlideBackgroundPath(pdfId, pageUid)), false);
  } finally {
    await app.close();
  }
});

test('converting back to an ordinary slide keeps the React page as the image', async () => {
  const app = await buildApp();
  try {
    const pdfId = await createBlankDeck(app);
    const pageUid = pageUidOf(pdfId, 1);

    await app.inject({
      method: 'PUT',
      url: `/api/pdfs/${pdfId}/pages/1/react-slide`,
      headers: HEADERS,
      payload: { code: SLIDE_CODE },
    });
    const before = fs.readFileSync(pageImagePath(pdfId, pageUid));

    const resp = await app.inject({
      method: 'DELETE',
      url: `/api/pdfs/${pdfId}/pages/1/react-slide`,
      headers: HEADERS,
    });
    assert.equal(resp.statusCode, 200);
    assert.equal((resp.json() as { render_type: string }).render_type, 'static-image');

    // The bake runs before the revert. The suite does not launch a browser (see renderSlideToJpeg),
    // so the image only changes when someone opts in with MAKESLIDE_TEST_ALLOW_BROWSER=1; either
    // way the conversion itself must succeed — which is what makes baking an enhancement rather
    // than a prerequisite.
    const after = fs.readFileSync(pageImagePath(pdfId, pageUid));
    if (process.env.MAKESLIDE_TEST_ALLOW_BROWSER === '1') {
      assert.ok(!before.equals(after), 'the page image should now be the rendered React slide');
    }
  } finally {
    await app.close();
  }
});
