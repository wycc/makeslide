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
import { charsPerStaticPageFor, charsPerStepFor, narrationMaxTokens, trimStepScript } from '../src/services/pptx/stepNarration';
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

test('an answer within the manifest limit is left exactly as written', () => {
  // The cut is no longer how length is enforced — the prompt is. An English step at the default
  // target is ~450 characters, and the old character cut sliced every one of them at 300.
  const english = 'Now that we know how gradients move backward through a computation graph, we need something to optimise. '.repeat(4).trim();
  assert.ok(english.length > 300 && english.length < MAX_STEP_SCRIPT_CHARS);
  assert.equal(trimStepScript(english), english, '合理長度的英文旁白不可以被截斷');
});

test('a runaway answer is cut at a sentence end, not mid-clause', () => {
  const long = `${'這是一句話。'.repeat(400)}`;
  const out = trimStepScript(long);
  assert.ok(out.length <= MAX_STEP_SCRIPT_CHARS);
  assert.ok(out.endsWith('。'), `結尾應該是完整句子，實際：${out.slice(-20)}`);
  // A single enormous sentence has no boundary to honour; it is still cut, rather than kept whole.
  const oneSentence = 'x'.repeat(MAX_STEP_SCRIPT_CHARS + 500);
  assert.equal(trimStepScript(oneSentence).length, MAX_STEP_SCRIPT_CHARS);
});

test('the output budget grows with the work, so a 24-step page can fit at all', () => {
  // Fixed at 2000 tokens, a long build could not physically be returned: the JSON was cut off and
  // the steps that arrived were the only ones written.
  assert.equal(narrationMaxTokens(5, 150), 2000, 'small pages keep the old floor');
  assert.ok(narrationMaxTokens(24, 150) > 2000, '24 步的頁需要比 2000 更多的輸出空間');
  assert.ok(narrationMaxTokens(24, 400) > narrationMaxTokens(24, 150), '要求更長就需要更多空間');
  assert.equal(narrationMaxTokens(60, 2000), 16000, 'and there is still a ceiling');
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

test('progress is reportable before the work starts, and from inside a page', async () => {
  // The bug: progress was only reported when a page finished, so re-narrating one page showed
  // "0/0" from beginning to end and then jumped straight to done. The total has to be known up
  // front, and the minutes spent inside a page have to be visible.
  const src = fs.readFileSync(
    fileURLToPath(new URL('../src/services/pptx/stepNarration.ts', import.meta.url)),
    'utf8',
  );
  // Total before the plan — the plan is itself a model call that can take a minute.
  const planAt = src.indexOf('const plan = await resolvePlan(');
  const firstReport = src.indexOf("stage: 'planning'");
  assert.ok(firstReport > 0 && firstReport < planAt, '排大綱之前就要先報出總頁數');
  assert.match(src, /total: totalPages/, 'the total counts only the pages this run will do');
  // And the per-step voicing reports as it goes.
  assert.match(src, /onStep\?: \(done: number, total: number\) => void;/);
  assert.match(src, /input\.onStep\?\.\(attempted, voiceable\)/);
  assert.match(src, /stage: 'speaking',[\s\S]{0,80}stepDone,/);
});
