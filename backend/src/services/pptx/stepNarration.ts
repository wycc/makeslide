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

export interface StepNarrationInput {
  pdfId: string;
  pageNumber: number;
  pageUid: string;
  /** The slide's own words, in reading order. */
  slideText: string[];
  /** What each click reveals, in order. Index 0 is the first click (step 1 of the manifest). */
  revealedText: string[];
  /** Skip the voice and only write the words. */
  textOnly?: boolean;
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

const MAX_LINE_CHARS = 300;

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
    script: (lines[index] ?? '').slice(0, MAX_STEP_SCRIPT_CHARS),
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
  }
  writePageSteps(pdfId, pageUid, { ...manifest, steps });
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
    `這一頁分成 ${stepCount} 步展開，請為每一步寫一到三句口語旁白。`,
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
      maxTokens: 2000,
      temperature: 0.4,
    });
    const lines = result.data.lines.map((line) => line.trim().slice(0, MAX_LINE_CHARS));
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

export async function writeStaticPageNarration(input: StepNarrationInput): Promise<{ narrated: number; spoken: number }> {
  const { pdfId, pageNumber, pageUid } = input;
  const [line] = await narrationLines(input, 1);
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
  done: number;
  total: number;
  pageNumber: number;
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

  const plan = await resolvePlan(pdfId, deck.slides.map((slide) => ({
    page: slide.slideNumber,
    text: slide.paragraphs,
    stepCount: slide.steps.length,
  })), options.reusePlan === true);
  if (plan) await writePlanIntoDeck(pdfId, plan, rows, deck.slides);

  const planByPage = new Map((plan?.pages ?? []).map((page) => [page.page, page]));
  let steps = 0;
  let spoken = 0;
  for (const [index, row] of rows.entries()) {
    if (options.signal?.aborted) break;
    const slide = deck.slides[index];
    if (!slide) continue;
    const narrationInput: StepNarrationInput = {
      pdfId,
      pageNumber: row.page_number,
      pageUid: row.page_uid,
      slideText: slide.paragraphs,
      revealedText: slide.steps.map((step) => step.text),
      textOnly: options.textOnly,
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
    const result = slide.steps.length > 0
      ? await writeStepNarration(narrationInput)
      : await writeStaticPageNarration(narrationInput);
    steps += result.narrated;
    spoken += result.spoken;
    options.onProgress?.({ done: index + 1, total: rows.length, pageNumber: row.page_number });
  }
  return { pages: rows.length, steps, spoken, planned: plan !== null };
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
