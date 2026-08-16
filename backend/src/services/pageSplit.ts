import { z } from 'zod';
import { callChatJSON } from './openai';
import { splitScriptIntoSentences } from './textSentences';
import { contentLanguageName } from './contentLanguage';
import type { AppLanguage } from './aiSettings';

/**
 * Splitting one over-full page into two.
 *
 * A page that covers three concepts is hard to narrate and harder to follow, and the fix is
 * mechanical only in appearance: *where* to cut is a judgement about meaning, which is why the
 * model picks the boundary rather than the code taking the midpoint.
 *
 * What this module decides — and nothing else — is the plan: which sentence the second page starts
 * at, and how the slide's own text divides. Actually moving rows, files and page numbers is the
 * route's job, because that has to be one transaction with the renumbering.
 */

/** Below this there is nothing to divide: one concept, or a page that has barely been written. */
export const MIN_SENTENCES_TO_SPLIT = 2;

/** Long pages are the ones worth splitting, but a whole transcript still has to fit the prompt. */
const MAX_SENTENCES_IN_PROMPT = 200;
const MAX_PAGE_TEXT_CHARS = 4000;

const SplitPlanSchema = z.object({
  /**
   * How many of the numbered sentences stay on the first page. The second page starts at the next
   * one, so this is 1..n-1 — anything else is not a split.
   */
  firstPageSentenceCount: z.number().int(),
  /** The slide text (bullets/heading) each page keeps. May be empty when the page had none. */
  firstPageText: z.string().max(MAX_PAGE_TEXT_CHARS),
  secondPageText: z.string().max(MAX_PAGE_TEXT_CHARS),
  /** One short line naming what the second page is about, shown in the confirmation. */
  secondPageSummary: z.string().max(200),
});

export interface PageSplitPlan {
  /** Sentences that stay on the original page; the rest move to the new one. */
  firstPageSentenceCount: number;
  firstScript: string;
  secondScript: string;
  firstPageText: string;
  secondPageText: string;
  secondPageSummary: string;
}

export class PageSplitNotPossibleError extends Error {}

export function buildSplitMessages(
  sentences: string[],
  pageText: string,
  language: AppLanguage,
): Array<{ role: 'system' | 'user'; content: string }> {
  const numbered = sentences
    .slice(0, MAX_SENTENCES_IN_PROMPT)
    .map((s, i) => `${i + 1}. ${s}`)
    .join('\n');
  return [
    {
      role: 'system',
      content: [
        '你要把一頁投影片拆成兩頁，因為它涵蓋的概念太多。',
        '',
        '規則：',
        '1. 依**概念**切，不是依長度：找出逐字稿裡「講完一件事、開始講下一件事」的那個位置。',
        '2. `firstPageSentenceCount` 是留在第一頁的句子數，必須介於 1 與（總句數 - 1）之間——兩頁都必須有內容。',
        '3. **不要改寫逐字稿**，你只決定切在哪裡；逐字稿由系統依你給的句數切開。',
        '4. 投影片文字（要點）請依同樣的概念界線分配到兩頁；一行要點只能屬於其中一頁，不要重複、不要新增原本沒有的要點。若原本沒有文字，兩邊都給空字串。',
        `5. 你輸出的文字一律使用${contentLanguageName(language)}，與原內容一致。`,
        '',
        '只輸出 JSON。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        '【逐字稿（已編號的句子）】',
        numbered || '（無逐字稿）',
        '',
        '【這一頁的投影片文字】',
        pageText.slice(0, MAX_PAGE_TEXT_CHARS).trim() || '（無）',
      ].join('\n'),
    },
  ];
}

/**
 * Rejoin a run of sentences into a script.
 *
 * The sentences came from `splitScriptIntoSentences`, which already strips TTS tone markers and
 * trims — so this cannot reproduce the original spacing exactly, and joining with a newline per
 * sentence is both readable and what the editor shows anyway.
 */
function joinSentences(sentences: string[]): string {
  return sentences.join('\n').trim();
}

/**
 * Decide where a page divides.
 *
 * The count the model returns is clamped into a range that actually produces two pages: a model
 * that answers 0 or n has effectively refused, and acting on it would create an empty page that
 * the user then has to notice and delete.
 */
export async function planPageSplit(input: {
  script: string;
  pageText: string;
  language: AppLanguage;
}): Promise<PageSplitPlan> {
  const sentences = splitScriptIntoSentences(input.script);
  if (sentences.length < MIN_SENTENCES_TO_SPLIT) {
    throw new PageSplitNotPossibleError('這一頁的逐字稿太短，沒有可以分開的兩個部分');
  }

  const result = await callChatJSON({
    label: 'split_page',
    schema: SplitPlanSchema,
    maxTokens: 2000,
    temperature: 0.2,
    messages: buildSplitMessages(sentences, input.pageText, input.language),
  });

  const count = Math.min(
    sentences.length - 1,
    Math.max(1, Math.round(result.data.firstPageSentenceCount)),
  );
  return {
    firstPageSentenceCount: count,
    firstScript: joinSentences(sentences.slice(0, count)),
    secondScript: joinSentences(sentences.slice(count)),
    firstPageText: result.data.firstPageText.trim(),
    secondPageText: result.data.secondPageText.trim(),
    secondPageSummary: result.data.secondPageSummary.trim(),
  };
}

/**
 * Keep only the animation effects that still refer to a sentence the page has.
 *
 * Effects are anchored to a transcript sentence by index (`startTrigger.line`). Once half the
 * sentences move to another page those indices point at the wrong line, or past the end — the
 * animation would fire on the wrong words rather than simply not firing, which is harder to notice
 * and worse to watch. Effects with no trigger are time-based and are left alone.
 */
export function keepEffectsBeforeSplit<T extends { startTrigger?: { type: string; line: number } }>(
  effects: T[],
  firstPageSentenceCount: number,
): T[] {
  return effects.filter((effect) => {
    const trigger = effect.startTrigger;
    if (!trigger || trigger.type !== 'transcript-line') return true;
    return trigger.line < firstPageSentenceCount;
  });
}
