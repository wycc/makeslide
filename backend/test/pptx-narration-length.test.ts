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
import { charsPerStaticPageFor, charsPerStepFor, narrationMaxTokens, pageNarrationBudget, trimStepScript } from '../src/services/pptx/stepNarration';
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

  await t.test('an untouched deck has no per-step override and uses the product default per page', () => {
    // The per-page target is the setting people reach for; a per-step length is the advanced
    // escape hatch and is absent until someone asks for it.
    assert.equal(charsPerStepFor(deckId), null);
    assert.equal(charsPerStaticPageFor(deckId), config.openaiScriptTargetChars);
  });

  await t.test('the per-page target is the page target, and does not become a per-step one', async () => {
    const resp = await app.inject({
      method: 'PATCH',
      url: `/api/pdfs/${deckId}/script-settings`,
      headers: HEADERS,
      payload: { script_max_chars_per_page: 400 },
    });
    assert.equal(resp.statusCode, 200);
    assert.equal(charsPerStaticPageFor(deckId), 400);
    // The regression: reading this as "400 per step" gave a five-step page five pages of talking.
    assert.equal(charsPerStepFor(deckId), null);
    // What an animated page actually gets is the budget, anchored at three steps.
    assert.equal(pageNarrationBudget(charsPerStaticPageFor(deckId), 3), 400);
  });

  await t.test('an explicit per-step length is available for those who mean it', async () => {
    const resp = await app.inject({
      method: 'PATCH',
      url: `/api/pdfs/${deckId}/script-settings`,
      headers: HEADERS,
      payload: { script_max_chars_per_page: 400, script_chars_per_step: 250 },
    });
    assert.equal(resp.statusCode, 200);
    assert.equal((resp.json() as { script_chars_per_step: number }).script_chars_per_step, 250);
    assert.equal(charsPerStepFor(deckId), 250);
    // A static page is an ordinary page and keeps the ordinary target either way.
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

  await t.test('null removes the override, returning to the page budget', async () => {
    const resp = await app.inject({
      method: 'PATCH',
      url: `/api/pdfs/${deckId}/script-settings`,
      headers: HEADERS,
      payload: { script_max_chars_per_page: 400, script_chars_per_step: null },
    });
    assert.equal(resp.statusCode, 200);
    assert.equal(charsPerStepFor(deckId), null);
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

test('the step prompt states a length instead of a sentence count, in the reader\'s own unit', () => {
  const src = fs.readFileSync(
    fileURLToPath(new URL('../src/services/pptx/stepNarration.ts', import.meta.url)),
    'utf8',
  );
  assert.doesNotMatch(src, /寫一到三句/, 'the sentence count was what made the narration short');
  assert.match(src, /const lengthInstruction =/);
  // Computed with the same helper the ordinary per-page script uses, so English is stated in words
  // rather than characters — the mismatch that once truncated every English step at 300.
  assert.match(src, /scriptLengthFor\(language, budget\.pageChars, bounds\)/);
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

test('the page budget is anchored at a three-step page and grows gently from there', () => {
  // The setting reads "characters per page", and a three-step build is what an ordinary animated
  // page looks like — so that is where the number means exactly itself. Anchoring at one step
  // would make it mean "a static page" and every animated page would then run long.
  assert.equal(pageNarrationBudget(500, 3), 500);
  assert.ok(pageNarrationBudget(500, 1) < 500, '單步頁不該拿到整個動畫頁的量');
  // A longer build is a longer explanation, but not proportionally: 24 steps is not 8x a 3-step
  // page's worth of talking.
  const five = pageNarrationBudget(500, 5);
  const twentyFour = pageNarrationBudget(500, 24);
  assert.ok(five > 500 && five < 800, `5 步應該溫和成長，得到 ${five}`);
  assert.ok(twentyFour > five && twentyFour < 500 * 4 + 1, `24 步應該有上限，得到 ${twentyFour}`);
  // The regression this whole change is about: a five-step page must not be given five pages'
  // worth of narration.
  assert.ok(five < 500 * 5 * 0.5, '整頁預算不可以接近「每步一頁份」');
  assert.equal(pageNarrationBudget(500, 400), 2000, 'the cap holds however long the build is');
});

test('the prompt hands over a page total and tells the model not to spread it evenly', () => {
  const src = fs.readFileSync(
    fileURLToPath(new URL('../src/services/pptx/stepNarration.ts', import.meta.url)),
    'utf8',
  );
  assert.match(src, /【整頁長度】/, 'the budget is stated as the page total');
  assert.match(src, /這是整頁的總量，不是每一步的量/);
  assert.match(src, /\*\*不要平均分配\*\*/, 'the even split is the thing being corrected');
  // The three cases a step can be, which is what makes the split defensible.
  assert.match(src, /只是一個數字變了/);
  assert.match(src, /帶進新的概念、完整的公式/);
  assert.match(src, /任何一步都不要少於/);
  // And the alternative intent: rewrite without re-timing.
  assert.match(src, /不要改變每一步的長度/);
});

test('the three length intents resolve to what they say', () => {
  const src = fs.readFileSync(
    fileURLToPath(new URL('../src/services/pptx/stepNarration.ts', import.meta.url)),
    'utf8',
  );
  const start = src.indexOf('function resolvePageBudget(');
  const body = src.slice(start, src.indexOf('\n}', start));
  // keep wins, then an explicit per-step length, then the per-page target through the budget.
  const keepAt = body.indexOf('keepCurrentLengths');
  const stepAt = body.indexOf('charsPerStep');
  const pageAt = body.indexOf('pageNarrationBudget');
  assert.ok(keepAt > 0 && stepAt > keepAt && pageAt > stepAt, '三種意圖的優先順序要明確');
  // An explicit per-step length means exactly that, times the steps.
  assert.match(body, /explicitPerStep \* stepCount/);
  // "Keep" with nothing written yet has no lengths to keep and must fall through.
  assert.match(body, /current\.some\(\(n\) => n > 0\)/);
});
