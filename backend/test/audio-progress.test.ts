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
  setAudioSegments,
  speechSeconds,
  synthesisRate,
} from '../src/services/audioProgress';

setSystemAuthSettings({ googleAuthEnabled: false });

test('an entry lives exactly while its synthesis does, with an estimate from the rate', () => {
  resetAudioProgressForTest();
  const text = '遞迴函式一定要有終止條件。'.repeat(40);
  const id = beginAudioProgress({ pdfId: 'apDeck', page: 3, step: 2, text, provider: 'p1' });
  const [entry] = listAudioProgress('apDeck');
  assert.equal(entry?.page, 3);
  assert.equal(entry?.step, 2);
  assert.equal(entry?.chars, [...text].length);
  assert.equal(entry?.estimated_seconds, Math.round(speechSeconds(text) * synthesisRate('p1')));
  assert.deepEqual(Object.keys(entry ?? {}).sort(), ['chars', 'estimated_seconds', 'page', 'segments_done', 'segments_total', 'started_at', 'step'], 'internals stay internal');
  assert.deepEqual(listAudioProgress('otherDeck'), [], 'scoped to its deck');
  setAudioSegments(id, 1, 3);
  assert.equal(listAudioProgress('apDeck')[0]?.segments_done, 1);
  assert.equal(listAudioProgress('apDeck')[0]?.segments_total, 3);
  endAudioProgress(id, false);
  assert.deepEqual(listAudioProgress('apDeck'), []);
});

test('a finished synthesis teaches its provider the rate; a failed one does not', () => {
  resetAudioProgressForTest();
  const before = synthesisRate('p2');
  const text = '字'.repeat(400); // 100 s of speech
  const failed = beginAudioProgress({ pdfId: 'apDeck', page: 1, text, provider: 'p2' });
  endAudioProgress(failed, false);
  assert.equal(synthesisRate('p2'), before);

  const realNow = Date.now;
  const id = beginAudioProgress({ pdfId: 'apDeck', page: 1, text, provider: 'p2' });
  try {
    Date.now = () => realNow() + 50_000; // 50 s of work for 100 s of speech
    endAudioProgress(id, true);
  } finally {
    Date.now = realNow;
  }
  assert.ok(Math.abs(synthesisRate('p2') - 0.5) < 0.01, `learned ${synthesisRate('p2')}`);
  assert.equal(synthesisRate('p3'), before, 'per provider');

  // A few words are mostly start-up cost: they must not drag the rate.
  const tiny = beginAudioProgress({ pdfId: 'apDeck', page: 1, text: 'Hello there.', provider: 'p3' });
  try {
    Date.now = () => realNow() + 9_000;
    endAudioProgress(tiny, true);
  } finally {
    Date.now = realNow;
  }
  assert.equal(synthesisRate('p3'), before);
});

test('speechSeconds counts each script its own way, so English is not estimated by the character', () => {
  assert.equal(speechSeconds('字'.repeat(40)), 10, 'Chinese: 4 characters a second');
  assert.ok(Math.abs(speechSeconds('one two three four five six seven') - 3) < 0.01, 'English: 140 words a minute');
  assert.equal(speechSeconds(''), 0);
  // The same sentence in both languages takes about as long to say. Per character, the English
  // one is four times "longer" — which is exactly how the estimate went wrong.
  const zh = '接著我們建立一個名為機率的張量，它有三列兩行。';
  const en = 'Next, we create a tensor named probs. It contains three rows and two columns.';
  assert.ok([...en].length > [...zh].length * 3);
  const ratio = speechSeconds(en) / speechSeconds(zh);
  assert.ok(ratio > 0.7 && ratio < 1.5, `speech time ratio ${ratio}`);
  // Mixed text is the sum of its parts.
  assert.ok(Math.abs(speechSeconds('使用 PyTorch 的 tensor 物件') - (5 / 4 + 2 / (140 / 60))) < 0.01);
});

test('reported: 524 English words, 62 s in, four of seven segments done — not "about 654 s left"', () => {
  resetAudioProgressForTest();
  const segment = `${'word '.repeat(75)}`.trim(); // 7 segments ≈ 525 words ≈ 3:45 of speech
  const page = Array.from({ length: 7 }, () => segment).join(' ');
  const realNow = Date.now;
  const t0 = realNow();
  try {
    Date.now = () => t0;
    const id = beginAudioProgress({ pdfId: 'apDeck', page: 4, text: page, provider: 'fresh' });
    const initial = listAudioProgress('apDeck')[0]?.estimated_seconds ?? 0;
    // With no rate learned yet the first guess must already be in the right region: the speech
    // is 225 s long, the old per-character guess said 262 s for this text and 716 s in the report.
    assert.ok(initial > 60 && initial < 130, `initial estimate ${initial}s`);

    setAudioSegments(id, 0, 7, '');
    Date.now = () => t0 + 62_000;
    setAudioSegments(id, 4, 7, Array.from({ length: 4 }, () => segment).join(' '));
    const entry = listAudioProgress('apDeck')[0];
    // Four sevenths in 62 s → about 108 s in all, so roughly 46 s to go.
    assert.ok(Math.abs((entry?.estimated_seconds ?? 0) - 108.5) <= 1, `refined to ${entry?.estimated_seconds}s`);
    assert.equal(entry?.segments_done, 4);
    endAudioProgress(id, false);
  } finally {
    Date.now = realNow;
  }
});

test('the measured pace overrides a badly wrong learned rate, a short first segment only nudges it, a retry starts over', () => {
  resetAudioProgressForTest();
  const realNow = Date.now;
  const t0 = realNow();
  const long = '字'.repeat(360); // 90 s of speech
  const short = '字'.repeat(8); // 2 s of speech
  try {
    Date.now = () => t0;
    const id = beginAudioProgress({ pdfId: 'apDeck', page: 1, text: `${short} ${long} ${long}`, provider: 'fresh' });
    const prior = listAudioProgress('apDeck')[0]?.estimated_seconds ?? 0; // 182 s × 0.4 ≈ 73 s
    setAudioSegments(id, 0, 3, '');

    // The 2 s opener took 6 s (start-up cost). Taken at face value that is 546 s for the page;
    // it covers 1% of it, so it moves the estimate only a little.
    Date.now = () => t0 + 6_000;
    setAudioSegments(id, 1, 3, short);
    const afterShort = listAudioProgress('apDeck')[0]?.estimated_seconds ?? 0;
    assert.ok(afterShort > prior && afterShort < prior * 1.5, `after the opener: ${afterShort}s (prior ${prior}s)`);

    // Half the page done in 96 s → the page really takes about 190 s, whatever the rate said.
    Date.now = () => t0 + 96_000;
    setAudioSegments(id, 2, 3, `${short} ${long}`);
    const afterLong = listAudioProgress('apDeck')[0]?.estimated_seconds ?? 0;
    assert.ok(Math.abs(afterLong - 190) <= 2, `measured: ${afterLong}s`);

    // The attempt fails and the loop restarts: the 100 s are spent, the pace is measured afresh.
    Date.now = () => t0 + 100_000;
    setAudioSegments(id, 0, 3, '');
    assert.equal(listAudioProgress('apDeck')[0]?.estimated_seconds, afterLong, 'a restart alone changes nothing');
    Date.now = () => t0 + 146_000; // opener + first long segment again, 46 s this time
    setAudioSegments(id, 2, 3, `${short} ${long}`);
    const afterRetry = listAudioProgress('apDeck')[0]?.estimated_seconds ?? 0;
    assert.ok(Math.abs(afterRetry - (100 + 46 / 92 * 182)) <= 2, `after the retry: ${afterRetry}s`);
    endAudioProgress(id, false);
  } finally {
    Date.now = realNow;
  }
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
  const id = beginAudioProgress({ pdfId, page: 1, text: '字'.repeat(200), provider: 'p1' });
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
  // The finished text goes along: without it the estimate cannot follow this page's real pace.
  assert.match(src, /for \(const \[segIndex, seg\] of segments\.entries\(\)\) \{\s*setAudioSegments\(params\.progressId, segIndex, segments\.length, doneText\);\s*doneText \+= ` \$\{seg\.text\}`;/);
  assert.match(src, /registerProgress\(input, provider\)/, 'the spoken text, not a character count');
  const stepCallers = [
    fs.readFileSync(new URL('../src/services/pptx/stepNarration.ts', import.meta.url), 'utf8'),
    fs.readFileSync(new URL('../src/routes/pdfs/detail.ts', import.meta.url), 'utf8'),
  ].join('\n');
  const calls = stepCallers.match(/synthesizeScriptToFile\(\{[\s\S]*?\}\)/g) ?? [];
  const stepCalls = calls.filter((c) => /targetPath: (target|pageStepAudioPath)/.test(c));
  assert.equal(stepCalls.length, 3, 'the three step-voice call sites');
  for (const c of stepCalls) assert.match(c, /step: (step\.index|stepIndex)/, 'each step voice labels its step');
});
