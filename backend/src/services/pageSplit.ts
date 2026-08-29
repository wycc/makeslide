import { z } from 'zod';
import { callChatJSON } from './openai';
import { outlineLanguageRule } from './contentLanguage';
import type { AppLanguage } from './aiSettings';

/**
 * Splitting one over-full page into two.
 *
 * The page is **re-planned, not cut**. Slicing the transcript in half looks like a split but leaves
 * two pages that were each written to be one page: the first ends mid-argument, the second opens
 * without introducing itself, and the picture still shows all the concepts. So the model writes a
 * fresh outline for each half — a title and its bullets — and the deck's normal pipeline then
 * regenerates the image, the script and the audio from those outlines, exactly as it would for any
 * other page.
 *
 * This module only produces the two outlines. Creating the page and scheduling the regeneration is
 * the route's job, because that has to share a transaction with the renumbering.
 */

/** Matches what the outline step produces per page (worker/steps/splitTextWithLlm.ts). */
const MAX_TITLE_CHARS = 200;
const MAX_BULLET_CHARS = 400;
const MAX_BULLETS = 6;

/** Below this a page has nothing to say twice; splitting would invent content. */
const MIN_SOURCE_CHARS = 40;

const OutlineSchema = z.object({
  title: z.string().min(1).max(MAX_TITLE_CHARS),
  bullets: z.array(z.string().min(1).max(MAX_BULLET_CHARS)).min(1).max(MAX_BULLETS),
});

const SplitPlanSchema = z.object({
  first: OutlineSchema,
  second: OutlineSchema,
});

export interface PageOutline {
  title: string;
  bullets: string[];
}

export interface PageSplitPlan {
  first: PageOutline;
  second: PageOutline;
}

export class PageSplitNotPossibleError extends Error {}

/**
 * What the regenerate job's image step is told after a split.
 *
 * That step *edits* the page's existing picture, with this string appended to a prompt that already
 * carries the page's new outline. It must not be empty — the step rejects that outright, which is
 * how the first live split failed — and it has to say the page changed, or the image keeps the
 * concepts that moved to the other page.
 */
export const SPLIT_IMAGE_PROMPT =
  'This page has been re-planned and now covers only the outline given above. '
  + "Redraw the whole slide from that outline: keep the deck's visual style, but remove anything "
  + 'belonging to the concepts that are no longer on this page, and lay out the current title and '
  + "bullet points as the slide's content.";

/** The stored form of a page's outline: the same shape the pipeline writes (`Slide N: …`). */
export function renderOutline(pageNumber: number, outline: PageOutline): string {
  return [`Slide ${pageNumber}: ${outline.title}`, ...outline.bullets.map((b) => `- ${b}`)].join('\n');
}

export function buildSplitMessages(
  pageText: string,
  script: string,
  language: AppLanguage,
): Array<{ role: 'system' | 'user'; content: string }> {
  return [
    {
      role: 'system',
      content: [
        '你要把一頁投影片重新規劃成兩頁，因為它涵蓋的概念太多。',
        '',
        '規則：',
        '1. 依**概念**分成兩頁：找出這一頁在講的幾件事，把它們分配到兩頁，每一頁只講完整的一件事（或一組緊密相關的事）。',
        '2. 兩頁各自要有**自己的標題**與 1～6 個重點。第二頁不是第一頁的續集殘句，它要能獨立讀懂。',
        '3. 涵蓋原本這一頁的內容，不要遺漏重點，也**不要加入原本沒有的新知識**。',
        '4. 重點要精簡可讀，不是逐字稿的句子；後續會依這份大綱重新產生圖片與逐字稿。',
        '5. 兩頁的順序要合理：先講的放第一頁。',
        outlineLanguageRule(language),
        '',
        // The JSON shape has to be in the prompt. `callChatJSON` asks for `json_object`, which
        // guarantees *valid* JSON and nothing about its keys — the schema only validates the reply
        // afterwards. Without this the model returned well-formed JSON under its own key names and
        // every attempt failed validation.
        '請只輸出 JSON，格式為：',
        '{"first":{"title":"第一頁的標題","bullets":["第一頁的重點一","第一頁的重點二"]},'
          + '"second":{"title":"第二頁的標題","bullets":["第二頁的重點一","第二頁的重點二"]}}',
        '兩個鍵都必須是 `first` 與 `second`，各自都要有 `title`（字串）與 `bullets`（字串陣列，1～6 項）。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        '【這一頁目前的大綱／投影片文字】',
        pageText.trim() || '（無）',
        '',
        '【這一頁目前的逐字稿（用來理解它實際講了什麼）】',
        script.trim() || '（無）',
      ].join('\n'),
    },
  ];
}

/**
 * Plan the two pages.
 *
 * Bullets are capped rather than rejected: a model that returns seven bullets has understood the
 * task and overrun a formatting limit, and failing the whole split for that would be a worse answer
 * than a page with six.
 */
export async function planPageSplit(input: {
  pageText: string;
  script: string;
  language: AppLanguage;
}): Promise<PageSplitPlan> {
  const source = `${input.pageText}\n${input.script}`.trim();
  if (source.length < MIN_SOURCE_CHARS) {
    throw new PageSplitNotPossibleError('這一頁的內容太少，沒有可以分成兩頁的兩個概念');
  }

  const result = await callChatJSON({
    label: 'split_page',
    schema: SplitPlanSchema,
    maxTokens: 2000,
    temperature: 0.3,
    messages: buildSplitMessages(input.pageText, input.script, input.language),
  });

  const clean = (outline: PageOutline): PageOutline => ({
    title: outline.title.trim(),
    bullets: outline.bullets.map((b) => b.trim()).filter(Boolean).slice(0, MAX_BULLETS),
  });
  const first = clean(result.data.first);
  const second = clean(result.data.second);
  if (first.bullets.length === 0 || second.bullets.length === 0) {
    throw new PageSplitNotPossibleError('AI 沒有把這一頁分成兩個有內容的部分');
  }
  return { first, second };
}
