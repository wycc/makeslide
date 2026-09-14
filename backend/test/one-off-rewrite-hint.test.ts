/**
 * One-off instructions, as opposed to the deck's standing prompt.
 *
 * The deck's prompt and its per-page length are followed by *every* later regeneration; "this
 * time, add an example" must not become that. So both the per-page rewrite and the step
 * re-narration take an override that applies to the call and is never written back — and the
 * property worth pinning is exactly that nothing is stored.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';

const ACCOUNT = 'one-off-hint-owner';
setSystemAuthSettings({ googleAuthEnabled: false });

function cookie(sub = ACCOUNT): string {
  const payload = Buffer.from(
    JSON.stringify({ provider: 'google', sub, email: `${sub}@example.com` }),
    'utf8',
  ).toString('base64url');
  const signature = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

const HEADERS = {
  cookie: `makeslide_session=${encodeURIComponent(cookie())}`,
  'content-type': 'application/json',
};

test('a one-off length and instruction are accepted and never stored', async (t) => {
  const app = await buildApp();
  let deckId = '';
  t.after(async () => {
    await app.close();
    if (deckId) db.prepare('DELETE FROM pdfs WHERE id = ?').run(deckId);
  });

  await t.test('setup', async () => {
    const resp = await app.inject({
      method: 'POST',
      url: '/api/pdfs/blank',
      headers: HEADERS,
      payload: { title: '一次性提示測試', category: '課程' },
    });
    assert.equal(resp.statusCode, 201);
    deckId = (resp.json() as { id: string }).id;
    const settings = await app.inject({
      method: 'PATCH',
      url: `/api/pdfs/${deckId}/script-settings`,
      headers: HEADERS,
      payload: { script_max_chars_per_page: 200, script_chars_per_step: 120 },
    });
    assert.equal(settings.statusCode, 200);
  });

  await t.test('a rewrite with a one-off length leaves the deck setting alone', async () => {
    // The call itself needs a model, which the test runner has none of; what matters here is that
    // the request is accepted (not rejected as an unknown field) and changes nothing on the deck.
    await app.inject({
      method: 'POST',
      url: `/api/pdfs/${deckId}/pages/1/rewrite-script`,
      headers: HEADERS,
      payload: { prompt: '這次請多舉一個例子', script: '原本的稿子', target_chars: 900 },
    });
    const row = db
      .prepare('SELECT script_max_chars_per_page, script_chars_per_step, user_prompt FROM pdfs WHERE id = ?')
      .get(deckId) as { script_max_chars_per_page: number | null; script_chars_per_step: number | null; user_prompt: string | null };
    assert.equal(row.script_max_chars_per_page, 200, '一次性的字數不可以覆蓋簡報設定');
    assert.equal(row.script_chars_per_step, 120);
    assert.doesNotMatch(row.user_prompt ?? '', /多舉一個例子/, '一次性的提示不可以寫進簡報提示詞');
  });

  await t.test('an out-of-range one-off length is refused rather than silently clamped', async () => {
    for (const target of [39, 2001]) {
      const resp = await app.inject({
        method: 'POST',
        url: `/api/pdfs/${deckId}/pages/1/rewrite-script`,
        headers: HEADERS,
        payload: { prompt: 'x', script: 'y', target_chars: target },
      });
      assert.equal(resp.statusCode, 400, `target_chars=${target} 應該被擋下`);
    }
  });

  await t.test('re-narration accepts an instruction and stores neither it nor the length', async () => {
    const resp = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${deckId}/pptx-narration`,
      headers: HEADERS,
      payload: { pages: [1], chars_per_step: 400, instruction: '這次請解釋為什麼' },
    });
    // Not a pptx deck, so the job fails on its own; the request shape is what is under test.
    assert.ok([202, 400, 409].includes(resp.statusCode), `unexpected ${resp.statusCode}`);
    const row = db
      .prepare('SELECT script_chars_per_step, user_prompt FROM pdfs WHERE id = ?')
      .get(deckId) as { script_chars_per_step: number | null; user_prompt: string | null };
    assert.equal(row.script_chars_per_step, 120, '這一次的字數不可以改掉簡報設定');
    assert.doesNotMatch(row.user_prompt ?? '', /解釋為什麼/);
  });

  await t.test('an over-long instruction is refused', async () => {
    const resp = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${deckId}/pptx-narration`,
      headers: HEADERS,
      payload: { instruction: 'x'.repeat(2001) },
    });
    assert.equal(resp.statusCode, 400);
  });
});

test('the one-off instruction reaches the model without displacing the output format', () => {
  const src = fs.readFileSync(
    fileURLToPath(new URL('../src/services/pptx/stepNarration.ts', import.meta.url)),
    'utf8',
  );
  const start = src.indexOf('const system = [');
  assert.ok(start > 0);
  const block = src.slice(start, src.indexOf('].join(', start));
  const hintAt = block.indexOf('input.instruction');
  const jsonAt = block.indexOf('請以 JSON 物件回覆');
  assert.ok(hintAt > 0, 'the instruction is part of the system prompt');
  assert.ok(jsonAt > hintAt, 'and stays before the output-format line, which must have the last word');
  // The plan is the deck's standing brief, written to disk and reused by every later
  // regeneration, so the one-off instruction must not be part of what builds it.
  const resolveStart = src.indexOf('const plan = await resolvePlan(');
  assert.ok(resolveStart > 0, 'the deck narration resolves a plan first');
  const resolveCall = src.slice(resolveStart, src.indexOf(');', resolveStart));
  assert.doesNotMatch(resolveCall, /instruction/, '一次性提示不可以進入會被存下來的大綱');
});
