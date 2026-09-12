/**
 * The deck plan (services/pptx/narrationPlan.ts) and what it changes about the narration.
 *
 * The first version of the narration wrote every step on its own, knowing only which words that
 * click revealed, and it read like it: a voice naming shapes, page after page, with no idea what
 * the deck was teaching. These tests pin the two things that fixed it — the deck is read once and
 * planned, and each page's steps are written from that plan — plus the plan being written into the
 * deck itself, where it can be read and corrected.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../src/db';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';
import { setOpenAIClientForTest } from '../src/services/openai';
import {
  applyPlanToPageText,
  planDeckNarration,
  readNarrationPlan,
  renderDeckPlanHeader,
  stripPlanSection,
  PLAN_SECTION_MARKER,
} from '../src/services/pptx/narrationPlan';
import { writeStepNarration } from '../src/services/pptx/stepNarration';
import { writePageSteps, readPageSteps } from '../src/services/pageSteps';
import { pageScriptPath } from '../src/services/storage';

setSystemAuthSettings({ googleAuthEnabled: false });

function seedDeck(pdfId: string, pageUid: string): void {
  const t = new Date().toISOString();
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,owner_sub,visibility,created_at,updated_at)
     VALUES (?,?,?,'ready',1,NULL,'private',?,?)`,
  ).run(pdfId, 'plan', 'deck.pptx', t, t);
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

function mockJson(payload: unknown): { prompts: string[] } {
  const prompts: string[] = [];
  setOpenAIClientForTest({
    chat: {
      completions: {
        create: async (args: { messages: Array<{ role: string; content: unknown }> }) => {
          prompts.push(args.messages.map((m) => String(m.content)).join('\n'));
          return {
            choices: [{ message: { content: JSON.stringify(payload) }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          };
        },
      },
    },
  } as never);
  return { prompts };
}

test('the deck is planned in one pass that sees every page', async () => {
  const pdfId = 'plan-one-pass-01';
  seedDeck(pdfId, 'uid1');
  const { prompts } = mockJson({
    deck_goal: '教會學生計算圖怎麼運作',
    storyline: '先建圖，再算前向，再算反向。',
    pages: [
      { page: 1, goal: '帶出主題', key_points: ['什麼是計算圖'], bridge: '' },
      { page: 2, goal: '示範前向傳遞', key_points: ['沿著邊計算', '中間值會被保留'], bridge: '接著把圖跑一次' },
    ],
  });
  try {
    const plan = await planDeckNarration(pdfId, [
      { page: 1, text: ['Computational Graph'], stepCount: 0 },
      { page: 2, text: ['Forward pass', 'f = (a+b*c)*3'], stepCount: 8 },
    ]);
    assert.equal(prompts.length, 1, 'one call for the deck — a model shown one page cannot see the thread');
    assert.match(prompts[0]!, /第 1 頁/);
    assert.match(prompts[0]!, /第 2 頁.*8 步/s, 'the planner knows which pages are built in steps');
    assert.equal(plan?.deckGoal, '教會學生計算圖怎麼運作');
    assert.deepEqual(plan?.pages[1]?.keyPoints, ['沿著邊計算', '中間值會被保留']);
    // Stored, so it can be read, corrected and reused without paying for it again.
    assert.deepEqual(readNarrationPlan(pdfId), plan);
  } finally {
    setOpenAIClientForTest(null);
    cleanup(pdfId);
  }
});

test('a page the planner skipped still gets an entry, so narration degrades instead of breaking', async () => {
  const pdfId = 'plan-missing-page-01';
  seedDeck(pdfId, 'uid1');
  mockJson({ deck_goal: 'g', storyline: '', pages: [{ page: 1, goal: 'a', key_points: [], bridge: '' }] });
  try {
    const plan = await planDeckNarration(pdfId, [
      { page: 1, text: ['one'], stepCount: 0 },
      { page: 2, text: ['two'], stepCount: 2 },
    ]);
    assert.equal(plan?.pages.length, 2);
    assert.deepEqual(plan?.pages[1], { page: 2, goal: '', keyPoints: [], bridge: '' });
  } finally {
    setOpenAIClientForTest(null);
    cleanup(pdfId);
  }
});

test('a failed planning call leaves the deck narratable, just without its context', async () => {
  const pdfId = 'plan-fail-01';
  seedDeck(pdfId, 'uid1');
  setOpenAIClientForTest({ chat: { completions: { create: async () => { throw new Error('down'); } } } } as never);
  try {
    assert.equal(await planDeckNarration(pdfId, [{ page: 1, text: ['x'], stepCount: 0 }]), null);
    assert.equal(readNarrationPlan(pdfId), null);
  } finally {
    setOpenAIClientForTest(null);
    cleanup(pdfId);
  }
});

test('the plan goes into the page text, and re-planning replaces it instead of stacking copies', () => {
  const slideWords = 'Slide 3: Forward pass\n- f = (a+b*c)*3\n';
  const first = applyPlanToPageText(slideWords, {
    page: 3,
    goal: '示範前向傳遞怎麼算',
    keyPoints: ['沿著邊往右算', '每個節點留下中間值'],
    bridge: '承接上一頁建好的圖',
  });
  assert.match(first, /Slide 3: Forward pass/, "the slide's own words stay");
  assert.match(first, /這一頁的目標：示範前向傳遞怎麼算/);
  assert.match(first, /- 沿著邊往右算/);

  const second = applyPlanToPageText(first, { page: 3, goal: '換個說法', keyPoints: [], bridge: '' });
  assert.equal((second.match(new RegExp(PLAN_SECTION_MARKER, 'g')) ?? []).length, 1, 'one section, not two');
  assert.match(second, /這一頁的目標：換個說法/);
  assert.doesNotMatch(second, /沿著邊往右算/, 'the old plan is gone');
  assert.equal(stripPlanSection(second).trim(), slideWords.trim(), 'and the slide words are untouched');
});

test('the deck header names the goal and the thread through the pages', () => {
  const header = renderDeckPlanHeader({ version: 1, deckGoal: '學會計算圖', storyline: '先建圖再前向', pages: [] });
  assert.match(header, /這份簡報的目標/);
  assert.match(header, /學會計算圖/);
  assert.match(header, /先建圖再前向/);
});

test('a step is told what to teach, not what appeared on screen', async () => {
  const pdfId = 'plan-step-prompt-01';
  seedDeck(pdfId, 'uid1');
  const { prompts } = mockJson({ lines: ['一', '二', '三'] });
  try {
    writePageSteps(pdfId, 'uid1', {
      version: 1,
      source: 'pptx',
      steps: [{ index: 0, script: '' }, { index: 1, script: '' }, { index: 2, script: '' }],
    });
    await writeStepNarration({
      pdfId,
      pageNumber: 2,
      pageUid: 'uid1',
      slideText: ['Forward pass'],
      revealedText: ['a b c', ''],
      textOnly: true,
      context: {
        deckGoal: '教會學生計算圖怎麼運作',
        storyline: '先建圖，再算前向。',
        plan: { page: 2, goal: '示範前向傳遞', keyPoints: ['沿著邊計算', '中間值會被保留'], bridge: '接著把圖跑一次' },
        previousPageGoal: '帶出主題',
        nextPageGoal: '示範反向傳遞',
        isFirstPage: false,
        isLastPage: false,
      },
    });
    const prompt = prompts[0]!;
    // The page's argument, not the page's pixels.
    assert.match(prompt, /整份簡報的目標：教會學生計算圖怎麼運作/);
    assert.match(prompt, /這一頁的目標：示範前向傳遞/);
    assert.match(prompt, /1\. 沿著邊計算/);
    assert.match(prompt, /上一頁講的是：帶出主題/);
    assert.match(prompt, /下一頁將要講：示範反向傳遞/);
    // And the instruction that keeps it from narrating the screen, which is what went wrong first.
    assert.match(prompt, /不是在唸畫面上出現了什麼/);
    assert.match(prompt, /嚴禁出現「這一步顯示…」/);
    assert.match(prompt, /最後一步收尾/);
    assert.deepEqual(readPageSteps(pdfId, 'uid1')?.steps.map((s) => s.script), ['一', '二', '三']);
    assert.equal(fs.readFileSync(pageScriptPath(pdfId, 'uid1'), 'utf8').trim(), '一\n二\n三');
  } finally {
    setOpenAIClientForTest(null);
    cleanup(pdfId);
  }
});

test('without a plan the narration still runs, with no deck context in the prompt', async () => {
  const pdfId = 'plan-none-01';
  seedDeck(pdfId, 'uid1');
  const { prompts } = mockJson({ lines: ['一', '二'] });
  try {
    writePageSteps(pdfId, 'uid1', { version: 1, source: 'pptx', steps: [{ index: 0, script: '' }, { index: 1, script: '' }] });
    const result = await writeStepNarration({
      pdfId, pageNumber: 1, pageUid: 'uid1', slideText: ['x'], revealedText: ['y'], textOnly: true,
    });
    assert.equal(result.narrated, 2);
    assert.doesNotMatch(prompts[0]!, /整份簡報的目標/);
  } finally {
    setOpenAIClientForTest(null);
    cleanup(pdfId);
  }
});
