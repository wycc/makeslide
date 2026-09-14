import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../src/db';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';
import { setOpenAIClientForTest } from '../src/services/openai';
import { writePageSteps, readPageSteps } from '../src/services/pageSteps';
import { pageScriptPath } from '../src/services/storage';
import { writeStaticPageNarration, writeStepNarration } from '../src/services/pptx/stepNarration';

setSystemAuthSettings({ googleAuthEnabled: false });

function seedPage(pdfId: string, pageUid: string): void {
  const t = new Date().toISOString();
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,owner_sub,visibility,created_at,updated_at)
     VALUES (?,?,?,'ready',1,NULL,'private',?,?)`,
  ).run(pdfId, 'narration', 'd.pptx', t, t);
  fs.mkdirSync(path.join(config.storageRoot, pdfId, 'pages'), { recursive: true });
  db.prepare(
    `INSERT INTO pages (pdf_id,page_number,page_uid,render_type,status,created_at,updated_at)
     VALUES (?,1,?,'react','text_ready',?,?)`,
  ).run(pdfId, pageUid, t, t);
}

function cleanup(pdfId: string): void {
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  fs.rmSync(path.join(config.storageRoot, pdfId), { recursive: true, force: true });
}

/** Capture what the model is asked, and answer with the lines given. */
function mockNarration(lines: string[]): { prompts: string[] } {
  const prompts: string[] = [];
  setOpenAIClientForTest({
    chat: {
      completions: {
        create: async (args: { messages: Array<{ role: string; content: unknown }> }) => {
          prompts.push(args.messages.map((m) => String(m.content)).join('\n'));
          return {
            choices: [{ message: { content: JSON.stringify({ lines }) }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          };
        },
      },
    },
  } as never);
  return { prompts };
}

const STEPS = {
  version: 1 as const,
  source: 'pptx' as const,
  steps: [
    { index: 0, asset: 'asset-a.webp', script: '' },
    { index: 1, asset: 'asset-b.webp', script: '' },
    { index: 2, asset: 'asset-c.webp', script: '' },
  ],
};

test('each step gets its own line, and the model is told what that step reveals', async () => {
  const pdfId = 'narration-steps-01';
  seedPage(pdfId, 'uid1');
  const { prompts } = mockNarration(['先看整體。', '這裡加入 a、b、c。', '最後得到 42。']);
  try {
    writePageSteps(pdfId, 'uid1', STEPS);
    const result = await writeStepNarration({
      pdfId,
      pageNumber: 1,
      pageUid: 'uid1',
      slideText: ['Forward pass', 'f = (a+b*c)*3'],
      revealedText: ['a b c', '42'],
      textOnly: true,
    });
    assert.deepEqual(result, { narrated: 3, spoken: 0 });

    const steps = readPageSteps(pdfId, 'uid1')!.steps;
    assert.deepEqual(steps.map((s) => s.script), ['先看整體。', '這裡加入 a、b、c。', '最後得到 42。']);
    // What each click brings in is in the prompt — that is how the narration can follow the build
    // without the model ever seeing the pictures.
    assert.match(prompts[0]!, /a b c/);
    assert.match(prompts[0]!, /第 3 步/);
    assert.match(prompts[0]!, /Forward pass/);
    // The provider refuses a JSON response format unless the messages themselves say "json"
    // (400 "messages must contain the word json") — and every other line of this prompt is Chinese.
    assert.match(prompts[0]!, /JSON/);

    // The page's own script is the steps joined, so subtitles, export and the tutor keep working.
    assert.equal(fs.readFileSync(pageScriptPath(pdfId, 'uid1'), 'utf8').trim(), '先看整體。\n這裡加入 a、b、c。\n最後得到 42。');
    const row = db.prepare(`SELECT status, script_path FROM pages WHERE pdf_id = ? AND page_number = 1`).get(pdfId) as { status: string; script_path: string };
    assert.equal(row.script_path, 'pages/uid1.script.txt');
    // Narration never moves a finished page back below the terminal status: a restart in the
    // middle would leave it below terminal in a ready deck, where the orphan sweep marks it failed.
    assert.equal(row.status, 'text_ready', 'the page keeps whatever status it already had');
  } finally {
    setOpenAIClientForTest(null);
    cleanup(pdfId);
  }
});

test('a short answer leaves the later steps silent rather than shifting every line', async () => {
  const pdfId = 'narration-short-01';
  seedPage(pdfId, 'uid1');
  mockNarration(['只有一句。']);
  try {
    writePageSteps(pdfId, 'uid1', STEPS);
    const result = await writeStepNarration({
      pdfId, pageNumber: 1, pageUid: 'uid1', slideText: ['t'], revealedText: ['x', 'y'], textOnly: true,
    });
    assert.equal(result.narrated, 1);
    // Padding by repeating would put the wrong words on the wrong picture, which is worse than
    // saying nothing.
    assert.deepEqual(readPageSteps(pdfId, 'uid1')!.steps.map((s) => s.script), ['只有一句。', '', '']);
  } finally {
    setOpenAIClientForTest(null);
    cleanup(pdfId);
  }
});

test('a failed model call leaves the page intact, with no narration', async () => {
  const pdfId = 'narration-fail-01';
  seedPage(pdfId, 'uid1');
  setOpenAIClientForTest({
    chat: { completions: { create: async () => { throw new Error('provider down'); } } },
  } as never);
  try {
    writePageSteps(pdfId, 'uid1', STEPS);
    const result = await writeStepNarration({
      pdfId, pageNumber: 1, pageUid: 'uid1', slideText: ['t'], revealedText: ['x', 'y'], textOnly: true,
    });
    assert.deepEqual(result, { narrated: 0, spoken: 0 });
    const steps = readPageSteps(pdfId, 'uid1')!.steps;
    assert.equal(steps.length, 3, 'the build is untouched');
    assert.equal(steps.every((s) => s.script === ''), true);
  } finally {
    setOpenAIClientForTest(null);
    cleanup(pdfId);
  }
});

test('a page with no steps gets one script, written where an ordinary page keeps it', async () => {
  const pdfId = 'narration-static-01';
  seedPage(pdfId, 'uid1');
  mockNarration(['這一頁介紹計算圖的概念。']);
  try {
    const result = await writeStaticPageNarration({
      pdfId, pageNumber: 1, pageUid: 'uid1', slideText: ['Computational Graph'], revealedText: [], textOnly: true,
    });
    assert.deepEqual(result, { narrated: 1, spoken: 0 });
    assert.equal(fs.readFileSync(pageScriptPath(pdfId, 'uid1'), 'utf8').trim(), '這一頁介紹計算圖的概念。');
    assert.equal(readPageSteps(pdfId, 'uid1'), null, 'and it stays an ordinary page');
  } finally {
    setOpenAIClientForTest(null);
    cleanup(pdfId);
  }
});
