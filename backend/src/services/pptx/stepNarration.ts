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
import { pageAudioPath, pageScriptPath, pageStepAudioName, pageStepAudioPath, pdfDir } from '../storage';
import { openPptx } from './pptxArchive';
import { parsePptxDeck } from './parsePptx';
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

/** Ask the model for one line per step, and make sure that is what comes back. */
async function narrationLines(input: StepNarrationInput, stepCount: number): Promise<string[]> {
  const language = getRuntimeAiSettings().contentLanguage;
  const slideText = input.slideText.filter(Boolean).join('\n').slice(0, 4000);
  // Step 0 is the slide before any click; the clicks follow it.
  const stepDescriptions = [
    '第 1 步：這一頁剛出現時就看得到的內容',
    ...input.revealedText.map((text, index) => {
      const trimmed = text.trim();
      return `第 ${index + 2} 步：這一下點擊讓「${trimmed || '（沒有文字的圖形，例如箭頭或方框）'}」出現`;
    }),
  ].join('\n');

  const system = [
    '你是一位老師，正在為一頁逐步展開的投影片寫口語旁白。',
    `這一頁會分成 ${stepCount} 步依序呈現，請為每一步寫一句到三句話。`,
    '規則：',
    '1. 只根據提供的投影片內容作答，不要編造數據、來源或投影片沒提到的細節。',
    '2. 每一步的旁白要對應那一步「新出現的東西」，並和前一步接得起來。',
    '3. 第一步先帶出這一頁在講什麼。',
    '4. 用口語、適合朗讀，不要條列符號、不要標題、不要 Markdown。',
    `5. 一定要剛好回傳 ${stepCount} 句（每一步一句），順序與步驟相同。`,
    // The word "json" has to appear in the messages themselves: OpenAI refuses a json_object
    // response format without it (400 "messages must contain the word json"), and every rule
    // above is written in Chinese.
    '請以 JSON 物件回覆，格式為 {"lines": ["第一步的旁白", "第二步的旁白", ...]}，不要加上其他欄位或說明文字。',
    contentLanguageInstruction(language),
  ].join('\n');

  const user = [
    `投影片第 ${input.pageNumber} 頁的全部文字：`,
    slideText || '（這一頁沒有文字）',
    '',
    '各步驟依序出現的內容：',
    stepDescriptions,
  ].join('\n');

  try {
    const result = await callChatJSON<{ lines: string[] }>({
      label: `pptx-step-narration ${input.pdfId}/${input.pageNumber}`,
      schema: NarrationSchema,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
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

/**
 * Narration for a page that is not built in steps: one script, one voice, written exactly where an
 * ordinary page keeps them, so nothing downstream can tell it came from a pptx.
 */
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
 * Write narration for a whole imported deck: per step on a step-built page, one script on a
 * static one.
 *
 * A separate stage from the import on purpose: the import costs only CPU, while this costs model
 * and TTS calls, and an import whose pictures are right is already worth keeping. Re-reads the
 * stored source.pptx to recover what each click reveals, which is cheap (no rendering).
 */
export async function narrateImportedDeck(options: {
  pdfId: string;
  onProgress?: (progress: DeckNarrationProgress) => void;
  textOnly?: boolean;
  signal?: { aborted: boolean };
}): Promise<{ pages: number; steps: number; spoken: number }> {
  const { pdfId } = options;
  const sourcePath = path.join(pdfDir(pdfId), 'source.pptx');
  if (!fs.existsSync(sourcePath)) throw new Error('這份簡報沒有保留原始 pptx，無法產生逐步旁白');
  const archive = await openPptx(sourcePath);
  const deck = await parsePptxDeck((name) => archive.readText(name));

  const rows = db
    .prepare(`SELECT page_number, page_uid FROM pages WHERE pdf_id = ? ORDER BY page_number ASC`)
    .all(pdfId) as Array<{ page_number: number; page_uid: string }>;

  let steps = 0;
  let spoken = 0;
  for (const [index, row] of rows.entries()) {
    if (options.signal?.aborted) break;
    const slide = deck.slides[index];
    if (!slide) continue;
    const narrationInput = {
      pdfId,
      pageNumber: row.page_number,
      pageUid: row.page_uid,
      slideText: slide.paragraphs,
      revealedText: slide.steps.map((step) => step.text),
      textOnly: options.textOnly,
      signal: options.signal,
    };
    const result = slide.steps.length > 0
      ? await writeStepNarration(narrationInput)
      : await writeStaticPageNarration(narrationInput);
    steps += result.narrated;
    spoken += result.spoken;
    options.onProgress?.({ done: index + 1, total: rows.length, pageNumber: row.page_number });
  }
  return { pages: rows.length, steps, spoken };
}
