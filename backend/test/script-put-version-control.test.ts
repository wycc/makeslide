/**
 * `PUT /api/pdfs/:id/pages/:n/script` must version the transcript it writes.
 *
 * Every other way a transcript changes commits into the deck's git repo — pipeline generation
 * (`script: generate page N`), the AI rewrite (`script: rewrite page N via chat`), the save that
 * accompanies audio regeneration. This route did not, and it is the one behind both the transcript
 * editor's plain save and MCP's `set_page_script`: a transcript written through it had no version
 * to restore from, and `/script/history` could not see it at all.
 *
 * The commit message also has to say how the change arrived. Until now "was this page's transcript
 * written by makeslide or by an agent?" was answerable precisely because agent writes left no
 * commit; now that they do leave one, the message must carry what that absence used to say.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import { getPresentationFileHistory } from '../src/services/presentationGit';
import { persistEnvSettings, setRuntimeAiSettings, setSystemAuthSettings } from '../src/services/aiSettings';

const ACCOUNT = 'script-version-owner';
const TOKEN = 'script-version-mcp-token';

setSystemAuthSettings({ googleAuthEnabled: false });

function testSessionCookie(sub = ACCOUNT): string {
  const payload = Buffer.from(
    JSON.stringify({ provider: 'google', sub, email: `${sub}@example.com` }),
    'utf8',
  ).toString('base64url');
  const signature = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

const BROWSER_HEADERS = {
  cookie: `makeslide_session=${encodeURIComponent(testSessionCookie())}`,
  'content-type': 'application/json',
};

/** Bearer only, no cookie — the shape every MCP request has (see the auth hook in server.ts). */
const MCP_HEADERS = {
  authorization: `Bearer ${TOKEN}`,
  'content-type': 'application/json',
};

function scriptPathOf(pdfId: string, page: number): string {
  const row = db
    .prepare('SELECT script_path FROM pages WHERE pdf_id = ? AND page_number = ?')
    .get(pdfId, page) as { script_path: string | null };
  return row.script_path!;
}

/**
 * The route commits without awaiting (`void commitPresentationFile`) so a slow git never delays
 * the response, so the test waits for the commit to land instead of assuming it already has.
 */
async function waitForCommitMessage(pdfId: string, relPath: string, expected: RegExp): Promise<string[]> {
  for (let attempt = 0; attempt < 60; attempt++) {
    const history = await getPresentationFileHistory(pdfId, relPath);
    const messages = history.map((entry) => entry.message);
    if (messages.some((message) => expected.test(message))) return messages;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const history = await getPresentationFileHistory(pdfId, relPath);
  assert.fail(`等不到符合 ${expected} 的 commit，目前歷史：${JSON.stringify(history.map((h) => h.message))}`);
}

test('a transcript saved through PUT /script is versioned, and the message says how it arrived', async (t) => {
  setRuntimeAiSettings(ACCOUNT, { mcpAuthToken: TOKEN });
  await persistEnvSettings(ACCOUNT, { mcpAuthToken: TOKEN });

  const app = await buildApp();
  let deckId = '';
  t.after(async () => {
    await app.close();
    if (deckId) db.prepare('DELETE FROM pdfs WHERE id = ?').run(deckId);
    setRuntimeAiSettings(ACCOUNT, { mcpAuthToken: '' });
    await persistEnvSettings(ACCOUNT, { mcpAuthToken: '' });
  });

  await t.test('setup: a blank deck owned by this account', async () => {
    const resp = await app.inject({
      method: 'POST',
      url: '/api/pdfs/blank',
      headers: BROWSER_HEADERS,
      payload: { title: '逐字稿版控測試', category: '課程' },
    });
    assert.equal(resp.statusCode, 201);
    deckId = (resp.json() as { id: string }).id;
  });

  await t.test('a browser save commits as "via API"', async () => {
    const resp = await app.inject({
      method: 'PUT',
      url: `/api/pdfs/${deckId}/pages/1/script`,
      headers: BROWSER_HEADERS,
      payload: { script: '第一版：從編輯框存的。' },
    });
    assert.equal(resp.statusCode, 200);

    const messages = await waitForCommitMessage(deckId, scriptPathOf(deckId, 1), /^script: edit page 1 via API$/);
    assert.ok(
      messages.some((m) => m === 'script: edit page 1 via API'),
      `commit message 應該標明來自 API：${JSON.stringify(messages)}`,
    );
  });

  await t.test('an MCP save commits as "via MCP"', async () => {
    // Same account, no cookie: the bearer token is translated into a session by the auth hook, so
    // this is indistinguishable from the browser save except for how it authenticated — which is
    // the one thing the message has to preserve.
    const resp = await app.inject({
      method: 'PUT',
      url: `/api/pdfs/${deckId}/pages/1/script`,
      headers: MCP_HEADERS,
      payload: { script: '第二版：agent 透過 MCP 寫的。' },
    });
    assert.equal(resp.statusCode, 200);

    await waitForCommitMessage(deckId, scriptPathOf(deckId, 1), /^script: edit page 1 via MCP$/);
  });

  await t.test('/script/history serves both versions, newest first', async () => {
    // The endpoint behind the editor's "version history" — the whole point of committing here.
    const resp = await app.inject({
      method: 'GET',
      url: `/api/pdfs/${deckId}/pages/1/script/history`,
      headers: BROWSER_HEADERS,
    });
    assert.equal(resp.statusCode, 200);
    const { history } = resp.json() as { history: Array<{ hash: string; message: string }> };
    const messages = history.map((entry) => entry.message);
    assert.ok(messages.includes('script: edit page 1 via MCP'), JSON.stringify(messages));
    assert.ok(messages.includes('script: edit page 1 via API'), JSON.stringify(messages));
    assert.ok(
      messages.indexOf('script: edit page 1 via MCP') < messages.indexOf('script: edit page 1 via API'),
      'git log 是新的在前，版本清單才會照時間倒序顯示',
    );

    // And the older version is actually retrievable — a history entry that cannot be read back
    // restores nothing.
    const olderHash = history[messages.indexOf('script: edit page 1 via API')]!.hash;
    const older = await app.inject({
      method: 'GET',
      url: `/api/pdfs/${deckId}/pages/1/script/versions/${olderHash}`,
      headers: BROWSER_HEADERS,
    });
    assert.equal(older.statusCode, 200);
    // The endpoint serves the stored text itself, not a JSON envelope.
    assert.match(older.body, /從編輯框存的/);
  });

  await t.test('saving the same text again adds no version', async () => {
    // commitPresentationFile is a no-op for an unchanged file; without that, every open-and-save
    // of an unedited transcript would add a version that differs from the one before it in nothing.
    const before = (await getPresentationFileHistory(deckId, scriptPathOf(deckId, 1))).length;
    const resp = await app.inject({
      method: 'PUT',
      url: `/api/pdfs/${deckId}/pages/1/script`,
      headers: BROWSER_HEADERS,
      payload: { script: '第二版：agent 透過 MCP 寫的。' },
    });
    assert.equal(resp.statusCode, 200);
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.equal((await getPresentationFileHistory(deckId, scriptPathOf(deckId, 1))).length, before);
  });
});
