import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';
import {
  joinStepScripts,
  missingStepLayers,
  countStepLayers,
  readPageSteps,
  writePageSteps,
  deletePageSteps,
  type PageStepsManifest,
} from '../src/services/pageSteps';
import { pageStepAudioName, pageStepAudioPath, pageStepsPath } from '../src/services/storage';

setSystemAuthSettings({ googleAuthEnabled: false });

function seedPage(pdfId: string, pageUid: string): void {
  const t = new Date().toISOString();
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,owner_sub,visibility,created_at,updated_at)
     VALUES (?,?,?,'ready',1,NULL,'private',?,?)`,
  ).run(pdfId, 'steps', 's.pptx', t, t);
  fs.mkdirSync(path.join(config.storageRoot, pdfId, 'pages'), { recursive: true });
  db.prepare(
    `INSERT INTO pages (pdf_id,page_number,page_uid,render_type,status,created_at,updated_at)
     VALUES (?,1,?,'react','audio_ready',?,?)`,
  ).run(pdfId, pageUid, t, t);
}

function cleanup(pdfId: string): void {
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  fs.rmSync(path.join(config.storageRoot, pdfId), { recursive: true, force: true });
}

const MANIFEST: PageStepsManifest = {
  version: 1,
  source: 'pptx',
  steps: [
    { index: 0, asset: 'asset-aaa.jpg', script: '先看整體。' },
    { index: 1, asset: 'asset-bbb.jpg', script: '再看細節。', audio: 'uid1.step-01.m4a', audioDurationSeconds: 3.5 },
  ],
};

test('a page’s steps round-trip through the manifest', () => {
  const pdfId = 'steps-roundtrip-01';
  seedPage(pdfId, 'uid1');
  try {
    writePageSteps(pdfId, 'uid1', MANIFEST);
    assert.equal(fs.existsSync(pageStepsPath(pdfId, 'uid1')), true);
    const read = readPageSteps(pdfId, 'uid1');
    assert.deepEqual(read, MANIFEST);
  } finally {
    cleanup(pdfId);
  }
});

test('a page with no manifest, and one with an unreadable manifest, both read as "no steps"', () => {
  const pdfId = 'steps-missing-01';
  seedPage(pdfId, 'uid1');
  try {
    assert.equal(readPageSteps(pdfId, 'uid1'), null);
    // Corrupt rather than absent: the page still has a picture and a narration, so refusing to
    // open the deck over a broken side-car would be the worse outcome.
    fs.writeFileSync(pageStepsPath(pdfId, 'uid1'), '{ not json', 'utf8');
    assert.equal(readPageSteps(pdfId, 'uid1'), null);
    fs.writeFileSync(pageStepsPath(pdfId, 'uid1'), JSON.stringify({ version: 9, steps: [] }), 'utf8');
    assert.equal(readPageSteps(pdfId, 'uid1'), null);
  } finally {
    cleanup(pdfId);
  }
});

test('steps are renumbered by position, so playback cannot run the narration out of order', () => {
  const pdfId = 'steps-renumber-01';
  seedPage(pdfId, 'uid1');
  try {
    fs.writeFileSync(
      pageStepsPath(pdfId, 'uid1'),
      JSON.stringify({ version: 1, source: 'pptx', steps: [{ index: 5, script: 'a' }, { index: 2, script: 'b' }] }),
      'utf8',
    );
    assert.deepEqual(readPageSteps(pdfId, 'uid1')?.steps.map((s) => [s.index, s.script]), [[0, 'a'], [1, 'b']]);
  } finally {
    cleanup(pdfId);
  }
});

test('deletePageSteps removes the manifest and every step audio file', () => {
  const pdfId = 'steps-delete-01';
  seedPage(pdfId, 'uid1');
  try {
    writePageSteps(pdfId, 'uid1', MANIFEST);
    fs.writeFileSync(pageStepAudioPath(pdfId, 'uid1', 0), 'a');
    fs.writeFileSync(pageStepAudioPath(pdfId, 'uid1', 1), 'b');
    deletePageSteps(pdfId, 'uid1');
    assert.equal(fs.existsSync(pageStepsPath(pdfId, 'uid1')), false);
    assert.equal(fs.existsSync(pageStepAudioPath(pdfId, 'uid1', 0)), false);
    assert.equal(fs.existsSync(pageStepAudioPath(pdfId, 'uid1', 1)), false);
  } finally {
    cleanup(pdfId);
  }
});

test('the page script is the steps joined in order, so everything that reads narration still works', () => {
  assert.equal(joinStepScripts(MANIFEST), '先看整體。\n再看細節。');
  assert.equal(joinStepScripts({ version: 1, source: 'pptx', steps: [] }), '');
});

test('step layers are counted from the code, and step 0 needs no layer of its own', () => {
  const code = '<img data-ms-step-layer="0" /><div data-ms-step-layer="1" /><span data-ms-step-layer="1" />';
  assert.deepEqual([...countStepLayers(code).entries()].sort(), [[0, 1], [1, 2]]);
  assert.deepEqual(missingStepLayers(code, MANIFEST), [], 'both steps are drawn');
  const threeSteps: PageStepsManifest = { ...MANIFEST, steps: [...MANIFEST.steps, { index: 2, script: 'c' }] };
  assert.deepEqual(missingStepLayers(code, threeSteps), [2], 'a step the code never draws is reported');
  // Step 0 is exempt: what is visible from the start is usually drawn outside the step layers.
  assert.deepEqual(missingStepLayers('<div data-ms-step-layer="1" />', MANIFEST), []);
});

test('GET step audio serves the file the manifest names, and 404s for anything else', async () => {
  const pdfId = 'steps-audio-route-01';
  seedPage(pdfId, 'uid1');
  const app = await buildApp();
  try {
    writePageSteps(pdfId, 'uid1', {
      version: 1,
      source: 'pptx',
      steps: [
        { index: 0, script: 'a', audio: pageStepAudioName('uid1', 0), audioDurationSeconds: 1 },
        { index: 1, script: 'b' },
      ],
    });
    fs.writeFileSync(pageStepAudioPath(pdfId, 'uid1', 0), 'fake-m4a-bytes');

    const ok = await app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}/pages/1/steps/0/audio` });
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.rawPayload.toString(), 'fake-m4a-bytes');

    // A step the manifest says has no audio, even though a file could be guessed at its path.
    fs.writeFileSync(pageStepAudioPath(pdfId, 'uid1', 1), 'orphan');
    const noAudio = await app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}/pages/1/steps/1/audio` });
    assert.equal(noAudio.statusCode, 404, 'the manifest decides what exists, not the filesystem');

    const outOfRange = await app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}/pages/1/steps/99/audio` });
    assert.equal(outOfRange.statusCode, 400);
    const badPage = await app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}/pages/7/steps/0/audio` });
    assert.equal(badPage.statusCode, 404);
  } finally {
    await app.close();
    cleanup(pdfId);
  }
});

test('the deck detail reports a page’s steps for the player, and nothing for an ordinary page', async () => {
  const pdfId = 'steps-detail-01';
  seedPage(pdfId, 'uid1');
  const app = await buildApp();
  try {
    const plain = await app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}` });
    assert.equal(plain.statusCode, 200);
    assert.equal(plain.json().pages[0].steps, null, 'an ordinary page has no steps');

    writePageSteps(pdfId, 'uid1', {
      version: 1,
      source: 'pptx',
      steps: [
        { index: 0, script: 'a', audio: pageStepAudioName('uid1', 0), audioDurationSeconds: 2.5 },
        { index: 1, script: 'b' },
      ],
    });
    const withSteps = await app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}` });
    assert.deepEqual(withSteps.json().pages[0].steps, [
      { index: 0, script: 'a', audio_url: `api/pdfs/${pdfId}/pages/1/steps/0/audio`, audio_duration_seconds: 2.5 },
      { index: 1, script: 'b', audio_url: null, audio_duration_seconds: null },
    ]);
  } finally {
    await app.close();
    cleanup(pdfId);
  }
});
