import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';
import {
  beginAudioProgress,
  endAudioProgress,
  listAudioProgress,
  resetAudioProgressForTest,
  secondsPerChar,
  setAudioSegments,
} from '../src/services/audioProgress';

setSystemAuthSettings({ googleAuthEnabled: false });

test('an entry lives exactly while its synthesis does, with an estimate from the rate', () => {
  resetAudioProgressForTest();
  const id = beginAudioProgress({ pdfId: 'apDeck', page: 3, step: 2, chars: 500, provider: 'p1' });
  const [entry] = listAudioProgress('apDeck');
  assert.equal(entry?.page, 3);
  assert.equal(entry?.step, 2);
  assert.equal(entry?.estimated_seconds, Math.round(500 * secondsPerChar('p1')));
  assert.deepEqual(listAudioProgress('otherDeck'), [], 'scoped to its deck');
  setAudioSegments(id, 1, 3);
  assert.equal(listAudioProgress('apDeck')[0]?.segments_done, 1);
  assert.equal(listAudioProgress('apDeck')[0]?.segments_total, 3);
  endAudioProgress(id, false);
  assert.deepEqual(listAudioProgress('apDeck'), []);
});

test('a finished synthesis teaches its provider the rate; a failed one does not', () => {
  resetAudioProgressForTest();
  const before = secondsPerChar('p2');
  const failed = beginAudioProgress({ pdfId: 'apDeck', page: 1, chars: 100, provider: 'p2' });
  endAudioProgress(failed, false);
  assert.equal(secondsPerChar('p2'), before);

  const realNow = Date.now;
  const id = beginAudioProgress({ pdfId: 'apDeck', page: 1, chars: 100, provider: 'p2' });
  try {
    Date.now = () => realNow() + 50_000; // 50 s for 100 chars
    endAudioProgress(id, true);
  } finally {
    Date.now = realNow;
  }
  assert.ok(Math.abs(secondsPerChar('p2') - 0.5) < 0.01, `learned ${secondsPerChar('p2')}`);
  assert.equal(secondsPerChar('p3'), before, 'per provider');
});

test('GET audio-progress lists what is being synthesized for a deck the viewer may read', async () => {
  resetAudioProgressForTest();
  const pdfId = 'apRoute01';
  const t = new Date().toISOString();
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,owner_sub,visibility,created_at,updated_at)
     VALUES (?,?,?,'ready',1,'ap-owner','private',?,?)`,
  ).run(pdfId, 't', 't.pdf', t, t);
  const id = beginAudioProgress({ pdfId, page: 1, chars: 200, provider: 'p1' });
  const payload = Buffer.from(JSON.stringify({ provider: 'google', sub: 'ap-owner', email: 'ap-owner@example.com' })).toString('base64url');
  const sig = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  const app = await buildApp();
  try {
    const owner = await app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}/audio-progress`, headers: { cookie: `makeslide_session=${payload}.${sig}` } });
    assert.equal(owner.statusCode, 200, owner.body);
    const body = owner.json() as { now: string; items: Array<{ page: number; chars: number }> };
    assert.ok(body.now);
    assert.deepEqual(body.items.map((i) => [i.page, i.chars]), [[1, 200]]);
    const stranger = await app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}/audio-progress` });
    assert.equal(stranger.statusCode, 403);
  } finally {
    endAudioProgress(id, false);
    await app.close();
  }
});

test('every synthesis registers: synthesizeOnePage begins and ends an entry, the segment loop reports', () => {
  // Every path that makes speech (page redo, step voice, regenerate, step narration) ends in
  // synthesizeOnePage, so that is the one place the progress bars need wiring.
  const src = fs.readFileSync(new URL('../src/worker/steps/synthesizeAudio.ts', import.meta.url), 'utf8');
  const wrapper = src.slice(src.indexOf('async function synthesizeOnePage('), src.indexOf('interface SynthesizeOnePageParams'));
  assert.match(wrapper, /beginAudioProgress\(/);
  assert.match(wrapper, /finally \{\s*endAudioProgress\(progressId, ok\);/);
  assert.match(src, /for \(const \[segIndex, seg\] of segments\.entries\(\)\) \{\s*setAudioSegments\(params\.progressId, segIndex, segments\.length\);/);
  const stepCallers = [
    fs.readFileSync(new URL('../src/services/pptx/stepNarration.ts', import.meta.url), 'utf8'),
    fs.readFileSync(new URL('../src/routes/pdfs/detail.ts', import.meta.url), 'utf8'),
  ].join('\n');
  const calls = stepCallers.match(/synthesizeScriptToFile\(\{[\s\S]*?\}\)/g) ?? [];
  const stepCalls = calls.filter((c) => /targetPath: (target|pageStepAudioPath)/.test(c));
  assert.equal(stepCalls.length, 3, 'the three step-voice call sites');
  for (const c of stepCalls) assert.match(c, /step: (step\.index|stepIndex)/, 'each step voice labels its step');
});
