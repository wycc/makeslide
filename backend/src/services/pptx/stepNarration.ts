/**
 * Narration for a step-built page: one line per step, and the voice that says it
 * (docs/pptx-animated-import-design.md §5 step 5).
 *
 * The model is not shown 136 pictures. It is told what the slide says and, for each click, which
 * of those words that click brings in — which the pptx itself records (parsePptx's step `text`).
 * That is both cheaper and more reliable than asking a model to read a picture and guess what
 * changed between two of them.
 *
 * The narration is written into the step manifest and joined into the page's own script file, so
 * everything that reads a page's narration — subtitles, the AI tutor, export, search — keeps
 * working on these pages without knowing that steps exist.
 */

import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { db } from '../../db';
import { logger } from '../../logger';
import { callChatJSON } from '../openai';
import { contentLanguageInstruction } from '../contentLanguage';
import { getRuntimeAiSettings } from '../aiSettings';
import { pageAudioPath, pageScriptPath, pageStepAudioName, pageStepAudioPath, pageTextPath, pdfDir, writeSourceText } from '../storage';
import { openPptx } from './pptxArchive';
import { parsePptxDeck, type PptxSlide } from './parsePptx';
import {
  applyPlanToPageText,
  planDeckNarration,
  type PlanSlideInput,
  readNarrationPlan,
  renderDeckPlanHeader,
  type DeckNarrationPlan,
  type PageNarrationPlan,
} from './narrationPlan';
import { joinStepScripts, readPageSteps, writePageSteps, MAX_STEP_SCRIPT_CHARS } from '../pageSteps';
import { synthesizeScriptToFile } from '../../worker/steps/synthesizeAudio';
import { scriptCharBounds } from '../../worker/steps/generateScript';
import { scriptLengthFor } from '../contentLanguage';
import { config } from '../../config';

export interface StepNarrationInput {
  pdfId: string;
  pageNumber: number;
  pageUid: string;
  /** The slide's own words, in reading order. */
  slideText: string[];
  /** What each click reveals, in order. Index 0 is the first click (step 1 of the manifest). */
  revealedText: string[];
  /**
   * How long this page's narration should be, expressed the way the user thinks about it.
   *
   *  - `pageTargetChars`: the per-page setting. The actual budget grows with the step count
   *    (`pageNarrationBudget`), and the model spends it across the steps as their content
   *    deserves. This is the normal case.
   *  - `charsPerStep`: an explicit per-step length, for someone who really means "this much per step".
   *    The page budget is then simply that times the step count.
   *  - `keepCurrentLengths`: rewrite what each step says without changing how long it is — the
   *    "I just want it written better" case, where re-timing the build is not wanted.
   *
   * All are in characters; English is converted to words by `scriptLengthFor`, as everywhere else.
   */
  pageTargetChars?: number;
  charsPerStep?: number;
  keepCurrentLengths?: boolean;
  /**
   * An extra instruction for this run only — "多舉一個例子", "少用術語".
   *
   * Deliberately not persisted anywhere, and in particular never written into the narration plan:
   * the plan is the deck's standing description of what each page teaches and is reused by every
   * later regeneration, while this is a one-off adjustment. Storing it would silently make one
   * experiment the permanent brief.
   */
  instruction?: string;
  /** Skip the voice and only write the words. */
  textOnly?: boolean;
  /** Called as each step's voice is recorded, so a long page reports something while it works. */
  onStep?: (done: number, total: number) => void;
  signal?: { aborted: boolean };
  /**
   * Where this page sits in the lecture (services/pptx/narrationPlan.ts). Without it the narration
   * can only describe what appeared; with it the steps carry the page's argument instead.
   */
  context?: {
    deckGoal: string;
    storyline: string;
    plan: PageNarrationPlan | null;
    previousPageGoal: string;
    nextPageGoal: string;
    isFirstPage: boolean;
    isLastPage: boolean;
  };
}

const NarrationSchema = z.object({
  lines: z.array(z.string()).min(1),
});

/**
 * What length this run is aiming for, from whichever of the three intents the caller expressed.
 *
 * `keepCurrent` carries each step's present length, which is how "rewrite it better without
 * re-timing the build" is expressed: the model is told what to match rather than a total to
 * divide up.
 */
function resolvePageBudget(
  input: StepNarrationInput,
  stepCount: number,
): { pageChars: number; keepCurrent: number[] | null } {
  if (input.keepCurrentLengths) {
    const current = readPageSteps(input.pdfId, input.pageUid)?.steps.map((step) => step.script.trim().length) ?? [];
    // Nothing written yet — there is no length to keep, so fall through to the ordinary budget.
    if (current.some((n) => n > 0)) {
      return { pageChars: current.reduce((a, b) => a + b, 0), keepCurrent: current };
    }
  }
  const explicitPerStep = input.charsPerStep ?? charsPerStepFor(input.pdfId);
  if (explicitPerStep) return { pageChars: explicitPerStep * stepCount, keepCurrent: null };
  const pageTarget = input.pageTargetChars ?? charsPerStaticPageFor(input.pdfId);
  return { pageChars: pageNarrationBudget(pageTarget, stepCount), keepCurrent: null };
}

/**
 * The pivot: the step count at which the deck's per-page target means exactly itself.
 *
 * Three, because that is what an ordinary animated page looks like — a claim, its reason, its
 * consequence. Anchoring at one step instead would make the number mean "a static page", and every
 * animated page would then run long.
 */
const BUDGET_PIVOT_STEPS = 3;
/** Each step beyond the first adds this fraction of the base. Gentle on purpose: see the cap. */
const BUDGET_GROWTH_PER_STEP = 0.15;
/** A page never talks for less than half, nor more than four times, its per-page target. */
const BUDGET_MIN_FACTOR = 0.5;
const BUDGET_MAX_FACTOR = 4;

/**
 * How long a step-built page's narration should be *in total*.
 *
 * The unit that matters is the page, not the step. Treating the per-page target as a per-step one
 * — which is what the regeneration did — gave a five-step page 90 seconds per step and eight
 * minutes overall from a setting that reads "500 characters a page".
 *
 * It still has to grow with the build: 24 steps is a long explanation however it is narrated, and
 * a fixed page budget would leave each step with a few words. Growth is gentle and capped, so a
 * long build lengthens the page without multiplying it.
 *
 * The model is given this total and decides how to spend it; `stepLengthGuidance` describes how.
 */
export function pageNarrationBudget(pageTargetChars: number, stepCount: number): number {
  if (stepCount <= 0) return pageTargetChars;
  const base = pageTargetChars / (1 + BUDGET_GROWTH_PER_STEP * (BUDGET_PIVOT_STEPS - 1));
  const raw = base * (1 + BUDGET_GROWTH_PER_STEP * (stepCount - 1));
  return Math.round(
    Math.min(pageTargetChars * BUDGET_MAX_FACTOR, Math.max(pageTargetChars * BUDGET_MIN_FACTOR, raw)),
  );
}

/**
 * How long one step of this deck's narration should be.
 *
 * Falls back through `script_chars_per_step` → the per-page target → the product default, so a
 * deck that has never been told anything still gets the length its ordinary pages would get, and
 * setting the per-page target alone still moves the steps.
 */
export function charsPerStepFor(pdfId: string): number | null {
  const row = db
    .prepare(`SELECT script_chars_per_step FROM pdfs WHERE id = ?`)
    .get(pdfId) as { script_chars_per_step: number | null } | undefined;
  return row?.script_chars_per_step ?? null;
}

/** How long a static page's narration should be: the per-page target, as for any ordinary page. */
export function charsPerStaticPageFor(pdfId: string): number {
  const row = db
    .prepare(`SELECT script_max_chars_per_page FROM pdfs WHERE id = ?`)
    .get(pdfId) as { script_max_chars_per_page: number | null } | undefined;
  return row?.script_max_chars_per_page ?? config.openaiScriptTargetChars;
}

/**
 * Trim one step's narration, and never mid-sentence.
 *
 * Two things went wrong here before. A fixed 300-character cut made every step short no matter
 * what length was asked for. Replacing it with "twice the target" then broke English: the prompt
 * states the target in *words* (`scriptLengthFor`), while the cut counts *characters*, and ~78
 * English words is ~450 characters — so a well-behaved English answer was still sliced at 300,
 * mid-word, on every step.
 *
 * The cut is therefore no longer how length is enforced — the prompt is. What remains is a
 * backstop against a runaway answer, at the manifest's own limit, and it ends on a sentence
 * boundary: a step that says slightly too much is fine, a step that stops mid-clause is not,
 * because it is read aloud.
 */
export function trimStepScript(text: string, cap: number = MAX_STEP_SCRIPT_CHARS): string {
  const trimmed = text.trim();
  if (trimmed.length <= cap) return trimmed;
  const cut = trimmed.slice(0, cap);
  const lastEnd = Math.max(
    cut.lastIndexOf('。'), cut.lastIndexOf('！'), cut.lastIndexOf('？'),
    cut.lastIndexOf('.'), cut.lastIndexOf('!'), cut.lastIndexOf('?'),
  );
  // Only honour a boundary that leaves most of the allowance used; otherwise a single very long
  // sentence would be cut back to almost nothing.
  return lastEnd >= cap * 0.6 ? cut.slice(0, lastEnd + 1).trim() : cut.trim();
}

/**
 * Output budget for the whole reply.
 *
 * Fixed at 2000 tokens, a 24-step page could not physically fit: the JSON was cut off and the
 * steps that did arrive were the only ones written. The budget has to grow with what is being
 * asked for — roughly two tokens per target character, per step, plus room for the JSON itself.
 */
export function narrationMaxTokens(stepCount: number, targetChars: number): number {
  const estimate = Math.round(stepCount * targetChars * 2) + 500;
  return Math.min(16000, Math.max(2000, estimate));
}

/**
 * Write the narration for one step-built page and synthesize each step's voice.
 *
 * Returns how many steps ended up with audio. A step whose voice fails keeps its words: the page
 * still steps and still reads correctly, and the missing voice is visible as a silent step rather
 * than as a failed import.
 */
export async function writeStepNarration(input: StepNarrationInput): Promise<{ narrated: number; spoken: number }> {
  const { pdfId, pageNumber, pageUid } = input;
  const manifest = readPageSteps(pdfId, pageUid);
  if (!manifest || manifest.steps.length === 0) return { narrated: 0, spoken: 0 };

  const lines = await narrationLines(input, manifest.steps.length);
  const steps = manifest.steps.map((step, index) => ({
    ...step,
    script: trimStepScript(lines[index] ?? ''),
  }));
  writePageSteps(pdfId, pageUid, { ...manifest, steps });

  // The page's own script is the steps joined, so every existing reader of a page's narration
  // keeps working.
  await fs.promises.writeFile(pageScriptPath(pdfId, pageUid), `${joinStepScripts({ ...manifest, steps })}\n`, 'utf8');
  // The status is deliberately not moved down to 'script_ready' on the way: an imported page is
  // already terminal, and a restart while narration is running would otherwise leave it below
  // terminal in a `ready` deck, where the orphan sweep marks it failed.
  db.prepare(`UPDATE pages SET script_path = ?, updated_at = ? WHERE pdf_id = ? AND page_number = ?`)
    .run(`pages/${pageUid}.script.txt`, new Date().toISOString(), pdfId, pageNumber);

  if (input.textOnly) return { narrated: steps.filter((s) => s.script.trim()).length, spoken: 0 };

  let spoken = 0;
  let attempted = 0;
  const voiceable = steps.filter((s) => s.script.trim()).length;
  input.onStep?.(0, voiceable);
  for (const step of steps) {
    if (input.signal?.aborted) break;
    if (!step.script.trim()) continue;
    const target = pageStepAudioPath(pdfId, pageUid, step.index);
    try {
      const result = await synthesizeScriptToFile({
        pdfId,
        pageNumber,
        pageUid,
        script: step.script,
        targetPath: target,
      });
      if (result.skipped || result.error) throw new Error(result.error ?? 'TTS skipped');
      step.audio = pageStepAudioName(pageUid, step.index);
      step.audioDurationSeconds = result.durationSeconds ?? undefined;
      spoken += 1;
    } catch (err) {
      // One silent step, not a failed page: the words are already saved and the build still runs.
      logger.warn({ err, pdfId, pageNumber, step: step.index }, 'pptx narration: step TTS failed');
    }
    // Written after every step, not once at the end: this is what a client polling the page sees,
    // so a 24-step page fills in as it is recorded instead of staying unchanged for minutes and
    // then arriving whole. It also means an interrupted run keeps the clips it already made.
    writePageSteps(pdfId, pageUid, { ...manifest, steps });
    // Reported after the attempt, success or not: the caller is watching progress, not success.
    attempted += 1;
    input.onStep?.(attempted, voiceable);
  }
  if (spoken > 0) {
    db.prepare(`UPDATE pages SET status = 'audio_ready', updated_at = ? WHERE pdf_id = ? AND page_number = ?`)
      .run(new Date().toISOString(), pdfId, pageNumber);
  }
  return { narrated: steps.filter((s) => s.script.trim()).length, spoken };
}

/**
 * Write the lines the steps say, from the page's plan.
 *
 * The steps are where the explanation is *delivered*, not what it is about: the plan decides what
 * this page has to teach, and the reveals only say how much of the picture the student can see at
 * each moment. Asking the model to "describe what appeared" — the first version of this — produced
 * a voice reading out shapes, which is what this prompt exists to avoid.
 */
async function narrationLines(input: StepNarrationInput, stepCount: number): Promise<string[]> {
  const language = getRuntimeAiSettings().contentLanguage;
  // The same length machinery the ordinary per-page script uses, so "how long should this be"
  // has one answer in the product and English is counted in words rather than characters.
  const budget = resolvePageBudget(input, stepCount);
  const bounds = scriptCharBounds(budget.pageChars);
  const length = scriptLengthFor(language, budget.pageChars, bounds);
  const unit = length.unit;
  // Per-step floors and ceilings, expressed in the same unit as the total so the model is not
  // asked to convert anything. The ceiling is what stops one step eating the page; the floor is
  // what stops a step being filled with "接下來看這裡".
  const perStep = (chars: number) => scriptLengthFor(language, Math.max(1, Math.round(chars)), { min: 1, max: 1 }).target;
  const smallStep = perStep(budget.pageChars * 0.12);
  const bigStep = perStep(budget.pageChars * 0.4);
  const floorStep = perStep(Math.max(30, (budget.pageChars / stepCount) * 0.3));
  const lengthInstruction = budget.keepCurrent
    ? [
        `【長度】這一次**不要改變每一步的長度**，只把內容寫得更好。各步請維持大約：${budget.keepCurrent
          .map((chars, i) => `第 ${i + 1} 步 ${perStep(chars)} ${unit}`)
          .join('、')}。`,
      ].join('\n')
    : [
        `【整頁長度】這一頁全部 ${stepCount} 步的旁白**合計**目標約 ${length.target} ${unit}，`
          + `控制在 ${length.min}～${length.max} ${unit}之間。這是整頁的總量，不是每一步的量。`,
        `【怎麼分配】**不要平均分配**。每一步該講多少，由它帶進畫面的東西決定：`,
        `  • 只是一個數字變了、或只多一條箭頭／一個方框：一兩句話帶過（約 ${smallStep} ${unit}以內）。`,
        `  • 帶進新的概念、完整的公式、或一整段文字：這是這一頁的重點，可以佔掉很大一部分（最多約 ${bigStep} ${unit}）。`,
        `  • 沒有新文字、但把先前講過的關係畫出來：通常短，除非那個關係本身需要解釋。`,
        `  • 任何一步都不要少於約 ${floorStep} ${unit}，也不要用「接下來看這裡」這種沒有內容的句子充數。`,
        '把時間花在需要解釋的那幾步上——每一步都一樣長，聽起來就會像在唸稿而不是在講課。',
      ].join('\n');
  const slideText = input.slideText.filter(Boolean).join('\n').slice(0, 4000);
  const context = input.context;
  const plan = context?.plan ?? null;

  // What the student can see at each step. Deliberately described as "by now the student can see",
  // not as "this step is about": the narration follows the plan, the picture only paces it.
  const stepDescriptions = [
    '第 1 步：投影片剛出現的狀態',
    ...input.revealedText.map((text, index) => {
      const trimmed = text.trim();
      return `第 ${index + 2} 步：畫面新出現「${trimmed || '沒有文字的圖形（例如箭頭、方框或連線）'}」`;
    }),
  ].join('\n');

  const system = [
    '你是一位老師，正在講一頁會逐步展開的投影片。學生看得到畫面，聽得到你的聲音。',
    `這一頁分成 ${stepCount} 步展開，請為每一步寫一段口語旁白。`,
    lengthInstruction,
    '',
    '最重要的一件事：**這是一段連貫的講解，不是在唸畫面上出現了什麼。**',
    '每一步要講的是「這一步在整個說明裡的那一段內容」，畫面只是決定講到哪裡時學生看得到什麼。',
    '嚴禁出現「這一步顯示…」「畫面出現…」「這個視覺提示…」這類描述畫面的句子。',
    '',
    '結構：',
    '1. 第一步先講清楚這一頁要解決什麼問題、或要建立什麼概念；若有承接上一頁的線索，先接起來再開始。',
    '2. 中間各步依照「要講到的重點」順序推進，說明原因與關係，而不是複述名詞。',
    stepCount > 2
      ? '3. 最後一步收尾：用一句話點出這一頁的結論；若後面還有內容，可以順勢帶到下一頁要談什麼。'
      : '3. 最後一步收尾：用一句話點出這一頁的結論。',
    '',
    '規則：只根據提供的投影片內容與大綱作答，不要編造數據、來源或沒提到的結論；',
    '用口語、適合朗讀，不要條列符號、不要標題、不要 Markdown；',
    '每一步的語氣要和前一步接得起來，不要每一步都用相同句型開頭；',
    `一定要剛好回傳 ${stepCount} 句，順序與步驟相同。`,
    // Last among the rules so it can override the general guidance, but before the output-format
    // line, which must stay the final word or the reply stops being parseable JSON.
    ...(input.instruction?.trim() ? [`【這一次的額外要求（只有這次適用）】${input.instruction.trim()}`] : []),
    // The word "json" has to appear in the messages themselves: OpenAI refuses a json_object
    // response format without it (400 "messages must contain the word json"), and every rule
    // above is written in Chinese.
    '請以 JSON 物件回覆，格式為 {"lines": ["第一步的旁白", "第二步的旁白", ...]}，不要加上其他欄位或說明文字。',
    contentLanguageInstruction(language),
  ].join('\n');

  const userParts: string[] = [];
  if (context?.deckGoal) {
    userParts.push(`整份簡報的目標：${context.deckGoal}`);
    if (context.storyline) userParts.push(`整份脈絡：${context.storyline}`);
    userParts.push('');
  }
  if (plan?.goal) userParts.push(`這一頁的目標：${plan.goal}`);
  if (plan?.bridge && !context?.isFirstPage) userParts.push(`承接上一頁：${plan.bridge}`);
  if (context?.previousPageGoal) userParts.push(`上一頁講的是：${context.previousPageGoal}`);
  if (context?.nextPageGoal && !context.isLastPage) userParts.push(`下一頁將要講：${context.nextPageGoal}`);
  if (plan?.keyPoints.length) {
    userParts.push('', '這一頁一定要講到的重點（依這個順序）：');
    plan.keyPoints.forEach((point, index) => userParts.push(`${index + 1}. ${point}`));
  }
  userParts.push(
    '',
    `投影片第 ${input.pageNumber} 頁的全部文字：`,
    slideText || '（這一頁沒有文字）',
    '',
    '各步驟學生會看到的畫面變化：',
    stepDescriptions,
  );

  try {
    const result = await callChatJSON<{ lines: string[] }>({
      label: `pptx-step-narration ${input.pdfId}/${input.pageNumber}`,
      schema: NarrationSchema,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userParts.join('\n') },
      ],
      maxTokens: narrationMaxTokens(stepCount, Math.round(budget.pageChars / stepCount)),
      temperature: 0.4,
    });
    const lines = result.data.lines.map((line) => trimStepScript(line));
    // A short answer leaves later steps silent rather than shifting every line onto the wrong
    // picture, which is what padding by repeating would do.
    if (lines.length < stepCount) {
      logger.warn(
        { pdfId: input.pdfId, pageNumber: input.pageNumber, got: lines.length, want: stepCount },
        'pptx narration: model returned fewer lines than steps',
      );
    }
    return lines.slice(0, stepCount);
  } catch (err) {
    logger.error({ err, pdfId: input.pdfId, pageNumber: input.pageNumber }, 'pptx narration: failed');
    return [];
  }
}

/**
 * Re-record a step-built page's existing words, without rewriting them.
 *
 * The audio half of a re-narration on its own, for the ordinary regeneration's audio stage: that
 * stage means "say this again", not "say something else", and a page-level recording would not be
 * played by a page that has one clip per step.
 *
 * Each clip is written to the manifest as it is made, so an interrupted run keeps what it already made
 * and a client watching the page sees it fill in.
 */
export async function respeakPageSteps(
  pdfId: string,
  pageNumber: number,
  pageUid: string,
  opts: { signal?: { aborted: boolean }; onStep?: (done: number, total: number) => void } = {},
): Promise<{ spoken: number; total: number }> {
  const manifest = readPageSteps(pdfId, pageUid);
  if (!manifest || manifest.steps.length === 0) return { spoken: 0, total: 0 };
  const steps = manifest.steps.map((step) => ({ ...step }));
  const voiceable = steps.filter((step) => step.script.trim()).length;
  opts.onStep?.(0, voiceable);
  let spoken = 0;
  let attempted = 0;
  for (const step of steps) {
    if (opts.signal?.aborted) break;
    if (!step.script.trim()) continue;
    try {
      const result = await synthesizeScriptToFile({
        pdfId,
        pageNumber,
        pageUid,
        script: step.script,
        targetPath: pageStepAudioPath(pdfId, pageUid, step.index),
      });
      if (result.skipped || result.error) throw new Error(result.error ?? 'TTS skipped');
      step.audio = pageStepAudioName(pageUid, step.index);
      step.audioDurationSeconds = result.durationSeconds ?? undefined;
      spoken += 1;
    } catch (err) {
      // One silent step, not a failed page — the same trade writeStepNarration makes.
      logger.warn({ err, pdfId, pageNumber, step: step.index }, 'respeak: step TTS failed');
      step.audio = undefined;
      step.audioDurationSeconds = undefined;
    }
    writePageSteps(pdfId, pageUid, { ...manifest, steps });
    attempted += 1;
    opts.onStep?.(attempted, voiceable);
  }
  return { spoken, total: voiceable };
}

export async function writeStaticPageNarration(input: StepNarrationInput): Promise<{ narrated: number; spoken: number }> {
  const { pdfId, pageNumber, pageUid } = input;
  const [line] = await narrationLines({ ...input, pageTargetChars: input.pageTargetChars ?? charsPerStaticPageFor(input.pdfId) }, 1);
  const script = (line ?? '').trim();
  if (!script) return { narrated: 0, spoken: 0 };
  await fs.promises.writeFile(pageScriptPath(pdfId, pageUid), `${script}\n`, 'utf8');
  db.prepare(`UPDATE pages SET script_path = ?, updated_at = ? WHERE pdf_id = ? AND page_number = ?`)
    .run(`pages/${pageUid}.script.txt`, new Date().toISOString(), pdfId, pageNumber);
  if (input.textOnly) return { narrated: 1, spoken: 0 };
  try {
    const result = await synthesizeScriptToFile({
      pdfId,
      pageNumber,
      pageUid,
      script,
      targetPath: pageAudioPath(pdfId, pageUid),
    });
    if (result.skipped || result.error) throw new Error(result.error ?? 'TTS skipped');
    db.prepare(
      `UPDATE pages SET audio_path = ?, audio_duration_seconds = ?, status = 'audio_ready', updated_at = ? WHERE pdf_id = ? AND page_number = ?`,
    ).run(`pages/${pageUid}.m4a`, result.durationSeconds ?? null, new Date().toISOString(), pdfId, pageNumber);
    return { narrated: 1, spoken: 1 };
  } catch (err) {
    logger.warn({ err, pdfId, pageNumber }, 'pptx narration: static page TTS failed');
    return { narrated: 1, spoken: 0 };
  }
}

export interface DeckNarrationProgress {
  /** Pages finished. */
  done: number;
  /** Pages this run will do — known before any work starts, so a one-page run is not 0/0 all the way through. */
  total: number;
  /** The page being worked on; 0 before the first one. */
  pageNumber: number;
  /**
   * What is happening now.
   *
   * Reported because the page count alone is useless on the common case: re-narrating one page
   * finishes its only page at the very end, so "0/1" is the whole story until it is suddenly done.
   * The work inside a page is where the minutes go — the plan, then the writing, then one TTS
   * call per step.
   */
  stage: 'planning' | 'writing' | 'speaking';
  /** Steps voiced so far on this page, and how many there are. Absent while planning. */
  stepDone?: number;
  stepTotal?: number;
}

/**
 * Narrate a whole imported deck.
 *
 * Two passes, because a lecture is not a pile of independent pages: first read the deck and plan
 * it (narrationPlan.ts), then write each page's steps from that plan. The plan is also written
 * into the deck itself — under each page's own text and at the head of the deck's source text —
 * so it is something the user can read and correct, not a hidden prompt.
 *
 * Re-reads the stored source.pptx to recover what each click reveals, which is cheap (no
 * rendering). Running it again re-plans and rewrites: that is how a deck gets a second, better
 * narration after the plan is edited.
 */
export async function narrateImportedDeck(options: {
  pdfId: string;
  onProgress?: (progress: DeckNarrationProgress) => void;
  textOnly?: boolean;
  /** Reuse the stored plan instead of asking for a new one (e.g. after editing it by hand). */
  reusePlan?: boolean;
  /**
   * Only these page numbers. Redoing one page used to mean redoing the deck — 26 pages of model
   * and TTS spend to fix one — so the narration of every other page is left exactly as it is.
   * The plan still covers the whole deck, because a page's narration is written from where it
   * sits in the lecture.
   */
  pages?: number[];
  /**
   * Length for this run only, overriding the deck's settings. Exactly one is normally given:
   * `pageTargetChars` (a whole page's worth, spread over the steps by content),
   * `charsPerStep` (an explicit per-step length), or `keepCurrentLengths` (rewrite without
   * re-timing the build).
   */
  pageTargetChars?: number;
  charsPerStep?: number;
  keepCurrentLengths?: boolean;
  /** Extra instruction for this run only; never stored, never written into the plan. */
  instruction?: string;
  signal?: { aborted: boolean };
}): Promise<{ pages: number; steps: number; spoken: number; planned: boolean }> {
  const { pdfId } = options;
  const sourcePath = path.join(pdfDir(pdfId), 'source.pptx');
  if (!fs.existsSync(sourcePath)) throw new Error('這份簡報沒有保留原始 pptx，無法產生逐步旁白');
  const archive = await openPptx(sourcePath);
  const deck = await parsePptxDeck((name) => archive.readText(name));

  const rows = db
    .prepare(`SELECT page_number, page_uid FROM pages WHERE pdf_id = ? ORDER BY page_number ASC`)
    .all(pdfId) as Array<{ page_number: number; page_uid: string }>;

  const only = options.pages && options.pages.length > 0 ? new Set(options.pages) : null;
  const totalPages = only ? rows.filter((r) => only.has(r.page_number)).length : rows.length;
  // Before anything slow starts: the plan is a model call of its own, and without this the caller
  // has nothing but 0/0 to show for the first minute.
  options.onProgress?.({ done: 0, total: totalPages, pageNumber: 0, stage: 'planning' });

  const plan = await resolvePlan(pdfId, deck.slides.map((slide) => ({
    page: slide.slideNumber,
    text: slide.paragraphs,
    stepCount: slide.steps.length,
  })), options.reusePlan === true);
  if (plan) await writePlanIntoDeck(pdfId, plan, rows, deck.slides);

  const planByPage = new Map((plan?.pages ?? []).map((page) => [page.page, page]));
  let steps = 0;
  let spoken = 0;
  let narratedPages = 0;
  for (const [index, row] of rows.entries()) {
    if (options.signal?.aborted) break;
    const slide = deck.slides[index];
    if (!slide) continue;
    if (only && !only.has(row.page_number)) continue;
    const narrationInput: StepNarrationInput = {
      pdfId,
      pageNumber: row.page_number,
      pageUid: row.page_uid,
      slideText: slide.paragraphs,
      revealedText: slide.steps.map((step) => step.text),
      textOnly: options.textOnly,
      pageTargetChars: options.pageTargetChars,
      charsPerStep: options.charsPerStep,
      keepCurrentLengths: options.keepCurrentLengths,
      instruction: options.instruction,
      signal: options.signal,
      context: plan
        ? {
            deckGoal: plan.deckGoal,
            storyline: plan.storyline,
            plan: planByPage.get(row.page_number) ?? null,
            previousPageGoal: planByPage.get(row.page_number - 1)?.goal ?? '',
            nextPageGoal: planByPage.get(row.page_number + 1)?.goal ?? '',
            isFirstPage: index === 0,
            isLastPage: index === rows.length - 1,
          }
        : undefined,
    };
    options.onProgress?.({
      done: narratedPages,
      total: totalPages,
      pageNumber: row.page_number,
      stage: 'writing',
    });
    narrationInput.onStep = (stepDone, stepTotal) => {
      options.onProgress?.({
        done: narratedPages,
        total: totalPages,
        pageNumber: row.page_number,
        stage: 'speaking',
        stepDone,
        stepTotal,
      });
    };
    const result = slide.steps.length > 0
      ? await writeStepNarration(narrationInput)
      : await writeStaticPageNarration(narrationInput);
    steps += result.narrated;
    spoken += result.spoken;
    narratedPages += 1;
    options.onProgress?.({
      done: narratedPages,
      total: totalPages,
      pageNumber: row.page_number,
      stage: 'writing',
    });
  }
  return { pages: narratedPages, steps, spoken, planned: plan !== null };
}

async function resolvePlan(
  pdfId: string,
  slides: PlanSlideInput[],
  reuse: boolean,
): Promise<DeckNarrationPlan | null> {
  if (reuse) {
    const stored = readNarrationPlan(pdfId);
    if (stored) return stored;
    logger.warn({ pdfId }, 'pptx narration: no stored plan to reuse — planning again');
  }
  return planDeckNarration(pdfId, slides);
}

/**
 * Write the plan into the deck: each page's outline under its own words, and the deck's goal at
 * the head of the source text the AI tutor reads.
 */
async function writePlanIntoDeck(
  pdfId: string,
  plan: DeckNarrationPlan,
  rows: Array<{ page_number: number; page_uid: string }>,
  slides: PptxSlide[],
): Promise<void> {
  const planByPage = new Map(plan.pages.map((page) => [page.page, page]));
  const sourceParts = [renderDeckPlanHeader(plan)];
  for (const [index, row] of rows.entries()) {
    const pagePlan = planByPage.get(row.page_number);
    if (!pagePlan) continue;
    const file = pageTextPath(pdfId, row.page_uid);
    let existing = '';
    try {
      existing = await fs.promises.readFile(file, 'utf8');
    } catch {
      existing = `Slide ${row.page_number}: ${slides[index]?.paragraphs[0] ?? ''}`;
    }
    const updated = applyPlanToPageText(existing, pagePlan);
    await fs.promises.writeFile(file, updated, 'utf8');
    sourceParts.push(`# 第 ${row.page_number} 頁\n${updated.trim()}`);
  }
  await writeSourceText(pdfId, `${sourceParts.join('\n\n')}\n`);
  db.prepare(`UPDATE pdfs SET updated_at = ? WHERE id = ?`).run(new Date().toISOString(), pdfId);
  logger.info({ pdfId, pages: rows.length }, 'pptx narration: wrote the plan into the deck');
}
