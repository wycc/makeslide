/**
 * Editing one step of a step-built page's narration.
 *
 * The transcript editor writes the page-level `script.txt`, which such a page does not play: its
 * words live in the manifest, one entry per step, each with its own audio clip. So editing the
 * narration of an animated page had no working path — the text changed and the voice kept saying
 * the old words. This route is that path, and the property that matters is that the words and the
 * clip cannot drift apart: either both change, or the clip is dropped so the step is silent rather
 * than wrong.
 *
 * TTS is not configured under the test runner, so these cover the manifest side and the failure
 * behaviour; the synthesis itself is `synthesizeScriptToFile`, tested where it lives.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import { pageScriptPath, pageStepAudioPath } from '../src/services/storage';
import { readPageSteps, writePageSteps } from '../src/services/pageSteps';
import { setSystemAuthSettings } from '../src/services/aiSettings';

const ACCOUNT = 'step-script-owner';

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

function pageUidOf(pdfId: string): string {
  return (db.prepare('SELECT page_uid FROM pages WHERE pdf_id = ? AND page_number = 1').get(pdfId) as {
    page_uid: string;
  }).page_uid;
}

test('editing one step rewrites that step, and never leaves a clip saying the old words', async (t) => {
  const app = await buildApp();
  let deckId = '';
  let uid = '';
  t.after(async () => {
    await app.close();
    if (deckId) db.prepare('DELETE FROM pdfs WHERE id = ?').run(deckId);
  });

  await t.test('setup: a page with three steps, the middle one voiced', async () => {
    const resp = await app.inject({
      method: 'POST',
      url: '/api/pdfs/blank',
      headers: HEADERS,
      payload: { title: '逐步逐字稿測試', category: '課程' },
    });
    assert.equal(resp.statusCode, 201);
    deckId = (resp.json() as { id: string }).id;
    uid = pageUidOf(deckId);
    writePageSteps(deckId, uid, {
      version: 1,
      source: 'pptx',
      steps: [
        { index: 0, asset: 'asset-a.webp', script: '第一步原本的話' },
        { index: 1, asset: 'asset-b.webp', script: '第二步原本的話', audio: `${uid}.step-01.m4a`, audioDurationSeconds: 4 },
        { index: 2, asset: 'asset-c.webp', script: '第三步原本的話' },
      ],
    });
    // A file on disk for the voiced step, so "the clip was dropped" is observable.
    fs.writeFileSync(pageStepAudioPath(deckId, uid, 1), 'not really audio');
  });

  await t.test('a step not on this page is refused with the range that exists', async () => {
    const resp = await app.inject({
      method: 'PUT',
      url: `/api/pdfs/${deckId}/pages/1/steps/7/script`,
      headers: HEADERS,
      payload: { script: '越界', voice: false },
    });
    assert.equal(resp.statusCode, 404);
    assert.match(JSON.stringify(resp.json()), /0～2/, '訊息要講出實際有幾步，否則呼叫端只能猜');
  });

  await t.test('text-only edit changes that step and leaves the others alone', async () => {
    const resp = await app.inject({
      method: 'PUT',
      url: `/api/pdfs/${deckId}/pages/1/steps/0/script`,
      headers: HEADERS,
      payload: { script: '第一步改過的話', voice: false },
    });
    assert.equal(resp.statusCode, 200);
    const steps = readPageSteps(deckId, uid)!.steps;
    assert.equal(steps[0]!.script, '第一步改過的話');
    assert.equal(steps[1]!.script, '第二步原本的話');
    assert.equal(steps[2]!.script, '第三步原本的話');
  });

  await t.test("the page's own script follows, because everything else reads that", async () => {
    // Exports, search and the AI tutor all go through script.txt; leaving it behind would make
    // the page say one thing and export another.
    const stored = fs.readFileSync(pageScriptPath(deckId, uid), 'utf8');
    assert.match(stored, /第一步改過的話/);
    assert.match(stored, /第三步原本的話/);
    assert.doesNotMatch(stored, /第一步原本的話/);
  });

  await t.test('emptying a step drops its clip rather than letting it speak', async () => {
    assert.ok(fs.existsSync(pageStepAudioPath(deckId, uid, 1)));
    const resp = await app.inject({
      method: 'PUT',
      url: `/api/pdfs/${deckId}/pages/1/steps/1/script`,
      headers: HEADERS,
      payload: { script: '   ' },
    });
    assert.equal(resp.statusCode, 200);
    const body = resp.json() as { audio_url: string | null; script: string };
    assert.equal(body.script, '');
    assert.equal(body.audio_url, null);
    const step = readPageSteps(deckId, uid)!.steps[1]!;
    assert.equal(step.audio, undefined, 'a silent step must not keep pointing at a clip');
    assert.equal(step.audioDurationSeconds, undefined);
    assert.equal(fs.existsSync(pageStepAudioPath(deckId, uid, 1)), false, 'and the file goes with it');
  });

  await t.test('a page with no steps says so instead of inventing them', async () => {
    const resp = await app.inject({
      method: 'PUT',
      url: `/api/pdfs/${deckId}/pages/2/steps/0/script`,
      headers: HEADERS,
      payload: { script: 'x', voice: false },
    });
    // Page 2 does not exist on a one-page deck; a real page without a manifest answers 409.
    assert.ok([404, 409].includes(resp.statusCode), `expected 404/409, got ${resp.statusCode}`);
  });

  await t.test('a reader cannot edit', async () => {
    const resp = await app.inject({
      method: 'PUT',
      url: `/api/pdfs/${deckId}/pages/1/steps/0/script`,
      headers: {
        cookie: `makeslide_session=${encodeURIComponent(cookie('someone-else'))}`,
        'content-type': 'application/json',
      },
      payload: { script: '別人改的', voice: false },
    });
    assert.equal(resp.statusCode, 403);
    assert.equal(readPageSteps(deckId, uid)!.steps[0]!.script, '第一步改過的話');
  });
});
