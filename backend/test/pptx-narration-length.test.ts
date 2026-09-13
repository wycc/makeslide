/**
 * How long a step's narration should be, and which pages a re-narration touches.
 *
 * Both used to be unreachable. The length was two hard-coded numbers — "一到三句" in the prompt and
 * a 300-character truncation after it — so a deck whose narration came out too short had no way to
 * ask for more; and `POST /pptx-narration` always did the whole deck, which meant 26 pages of model
 * and TTS spend to fix one.
 *
 * The length is per *step* on purpose: a page that builds in 24 steps is one explanation delivered
 * in 24 beats, so its total has to grow with the step count, which only happens if the number is
 * per step rather than per page.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import { charsPerStaticPageFor, charsPerStepFor, lineCharCap } from '../src/services/pptx/stepNarration';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MAX_STEP_SCRIPT_CHARS } from '../src/services/pageSteps';
import { setSystemAuthSettings } from '../src/services/aiSettings';

const ACCOUNT = 'narration-length-owner';

setSystemAuthSettings({ googleAuthEnabled: false });

function testSessionCookie(sub = ACCOUNT): string {
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

test('the per-step length falls back the way a deck expects', async (t) => {
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
      payload: { title: '旁白長度測試', category: '課程' },
    });
    assert.equal(resp.statusCode, 201);
    deckId = (resp.json() as { id: string }).id;
  });

  await t.test('an untouched deck uses the product default, not a hard-coded number', () => {
    assert.equal(charsPerStepFor(deckId), config.openaiScriptTargetChars);
    assert.equal(charsPerStaticPageFor(deckId), config.openaiScriptTargetChars);
  });

  await t.test('setting only the per-page target moves the steps too', async () => {
    const resp = await app.inject({
      method: 'PATCH',
      url: `/api/pdfs/${deckId}/script-settings`,
      headers: HEADERS,
      payload: { script_max_chars_per_page: 400 },
    });
    assert.equal(resp.statusCode, 200);
    // Otherwise a deck that asked for longer narration would keep getting the default per step.
    assert.equal(charsPerStepFor(deckId), 400);
    assert.equal(charsPerStaticPageFor(deckId), 400);
  });

  await t.test('the per-step setting wins for steps, and leaves static pages alone', async () => {
    const resp = await app.inject({
      method: 'PATCH',
      url: `/api/pdfs/${deckId}/script-settings`,
      headers: HEADERS,
      payload: { script_max_chars_per_page: 400, script_chars_per_step: 250 },
    });
    assert.equal(resp.statusCode, 200);
    assert.equal((resp.json() as { script_chars_per_step: number }).script_chars_per_step, 250);
    assert.equal(charsPerStepFor(deckId), 250);
    // A static page is an ordinary page and keeps the ordinary target.
    assert.equal(charsPerStaticPageFor(deckId), 400);
  });

  await t.test('a client that does not know the field cannot silently clear it', async () => {
    const resp = await app.inject({
      method: 'PATCH',
      url: `/api/pdfs/${deckId}/script-settings`,
      headers: HEADERS,
      payload: { script_max_chars_per_page: 400 },
    });
    assert.equal(resp.statusCode, 200);
    assert.equal(charsPerStepFor(deckId), 250, 'omitting the field must not reset it');
  });

  await t.test('null clears it back to the per-page target', async () => {
    const resp = await app.inject({
      method: 'PATCH',
      url: `/api/pdfs/${deckId}/script-settings`,
      headers: HEADERS,
      payload: { script_max_chars_per_page: 400, script_chars_per_step: null },
    });
    assert.equal(resp.statusCode, 200);
    assert.equal(charsPerStepFor(deckId), 400);
  });

  await t.test('the bounds are per step, so a step may be shorter than a whole page may', async () => {
    const tooSmall = await app.inject({
      method: 'PATCH',
      url: `/api/pdfs/${deckId}/script-settings`,
      headers: HEADERS,
      payload: { script_max_chars_per_page: 400, script_chars_per_step: 39 },
    });
    assert.equal(tooSmall.statusCode, 400);
    const allowed = await app.inject({
      method: 'PATCH',
      url: `/api/pdfs/${deckId}/script-settings`,
      headers: HEADERS,
      payload: { script_max_chars_per_page: 400, script_chars_per_step: 60 },
    });
    // 60 is below the per-page minimum of 80 and must still be accepted: one beat of an
    // explanation is legitimately shorter than a whole page.
    assert.equal(allowed.statusCode, 200);
    assert.equal(charsPerStepFor(deckId), 60);
  });

  await t.test('re-narration validates its page list and length before starting anything', async () => {
    for (const payload of [
      { pages: [0] },
      { pages: [1.5] },
      { chars_per_step: 39 },
      { chars_per_step: 2001 },
    ]) {
      const resp = await app.inject({
        method: 'POST',
        url: `/api/pdfs/${deckId}/pptx-narration`,
        headers: HEADERS,
        payload,
      });
      assert.equal(resp.statusCode, 400, `${JSON.stringify(payload)} 應該被擋下`);
    }
  });
});

test('the truncation follows the target instead of capping every step at 300', () => {
  // The second hard-coded number: raising the target did nothing while everything the model wrote
  // was cut back to 300 characters anyway.
  assert.equal(lineCharCap(150), 300, 'short targets keep the old headroom');
  assert.equal(lineCharCap(400), 800, 'a longer target may write longer');
  assert.equal(lineCharCap(1200), MAX_STEP_SCRIPT_CHARS, 'the manifest limit is still the ceiling');
});

test('the step prompt states a target length instead of "one to three sentences"', () => {
  const src = fs.readFileSync(
    fileURLToPath(new URL('../src/services/pptx/stepNarration.ts', import.meta.url)),
    'utf8',
  );
  assert.doesNotMatch(src, /寫一到三句/, 'the sentence count was what made the narration short');
  // The length reaches the model, and is computed with the same helpers the ordinary per-page
  // script uses so English is counted in words rather than characters.
  assert.match(src, /const lengthInstruction =/);
  assert.match(src, /scriptLengthFor\(language, targetChars, bounds\)/);
  assert.match(src, /lengthInstruction,/, 'and is actually in the system prompt');
});
