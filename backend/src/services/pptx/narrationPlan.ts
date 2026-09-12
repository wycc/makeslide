/**
 * Understanding the deck before narrating it (docs/pptx-animated-import-design.md §5 step 5).
 *
 * The first version of the narration wrote each page — each *step* — on its own, knowing nothing
 * but the words that step revealed. The result read exactly like what it was: a voice reading out
 * whatever had just appeared, with no thread between pages and no idea what the deck was for.
 *
 * So narration now happens in two passes. This one reads the whole deck once and writes a plan:
 * what the deck is teaching, and for each page what that page is for, which points it has to make,
 * and how it follows from the page before. The second pass (stepNarration.ts) turns one page's
 * plan into the lines the steps say — so a step's narration comes from the page's argument,
 * rather than from the accident of which shape appeared.
 *
 * The plan is stored next to the deck so it can be read, corrected, and reused without paying for
 * it again.
 */

import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { logger } from '../../logger';
import { callChatJSON } from '../openai';
import { contentLanguageInstruction } from '../contentLanguage';
import { getRuntimeAiSettings } from '../aiSettings';
import { pdfDir } from '../storage';

export interface PageNarrationPlan {
  page: number;
  /** What this page is for, in one sentence. */
  goal: string;
  /** The things the narration has to get across on this page, in teaching order. */
  keyPoints: string[];
  /** How this page follows from the one before; empty on the first page. */
  bridge: string;
}

export interface DeckNarrationPlan {
  version: 1;
  /** What the deck as a whole is teaching. */
  deckGoal: string;
  /** The thread through the deck: how the pages build on each other. */
  storyline: string;
  pages: PageNarrationPlan[];
}

/** What the planner is told about one slide. */
export interface PlanSlideInput {
  page: number;
  text: string[];
  stepCount: number;
}

const PlanSchema = z.object({
  deck_goal: z.string(),
  storyline: z.string().default(''),
  pages: z
    .array(
      z.object({
        page: z.number().int().min(1),
        goal: z.string().default(''),
        key_points: z.array(z.string()).default([]),
        bridge: z.string().default(''),
      }),
    )
    .default([]),
});

const MAX_PAGE_TEXT_CHARS = 700;
const MAX_KEY_POINTS = 8;

export function narrationPlanPath(pdfId: string): string {
  return path.join(pdfDir(pdfId), 'narration-plan.json');
}

export function readNarrationPlan(pdfId: string): DeckNarrationPlan | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(narrationPlanPath(pdfId), 'utf8')) as DeckNarrationPlan;
    if (parsed?.version !== 1 || !Array.isArray(parsed.pages)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeNarrationPlan(pdfId: string, plan: DeckNarrationPlan): void {
  fs.writeFileSync(narrationPlanPath(pdfId), `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
}

/**
 * Read the whole deck and write the plan.
 *
 * One call for the deck, not one per page: the point is the thread between pages, and a model
 * shown one page at a time cannot see it. A deck too large for that is truncated per page rather
 * than split, so the planner always sees every page — a plan missing its last third would put the
 * summary in the wrong place.
 */
export async function planDeckNarration(pdfId: string, slides: PlanSlideInput[]): Promise<DeckNarrationPlan | null> {
  const language = getRuntimeAiSettings().contentLanguage;
  const outline = slides
    .map((slide) => {
      const text = slide.text.filter(Boolean).join(' / ').slice(0, MAX_PAGE_TEXT_CHARS) || '（沒有文字）';
      const build = slide.stepCount > 0 ? `，逐步展開 ${slide.stepCount} 步` : '';
      return `第 ${slide.page} 頁${build}：${text}`;
    })
    .join('\n');

  const system = [
    '你是一位要把這份投影片講給學生聽的老師。現在還不要寫旁白，先讀完整份投影片，想清楚它在教什麼。',
    '請產出一份講稿大綱：',
    '1. deck_goal：整份簡報要讓學生學會什麼，一到兩句。',
    '2. storyline：這些頁面之間的脈絡——從哪裡開始、怎麼推進、最後收在哪裡，三到五句。',
    '3. pages：每一頁一個項目，包含',
    '   - goal：這一頁在整個脈絡裡負責什麼（不是複述頁面文字，而是它為什麼存在）',
    `   - key_points：這一頁一定要講到的重點，依講解順序排列，最多 ${MAX_KEY_POINTS} 點`,
    '   - bridge：這一頁如何承接上一頁（第一頁留空字串）',
    '規則：只根據投影片內容判斷，不要編造投影片沒有的數據、來源或結論；',
    '每一頁都要有對應項目，page 用投影片的頁碼。',
    '請以 JSON 物件回覆，格式為 {"deck_goal": "...", "storyline": "...", "pages": [{"page": 1, "goal": "...", "key_points": ["..."], "bridge": ""}]}。',
    contentLanguageInstruction(language),
  ].join('\n');

  try {
    const result = await callChatJSON<z.infer<typeof PlanSchema>>({
      label: `pptx-narration-plan ${pdfId}`,
      schema: PlanSchema,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: `整份投影片共 ${slides.length} 頁：\n${outline}` },
      ],
      maxTokens: 8000,
      temperature: 0.3,
    });
    const byPage = new Map(result.data.pages.map((page) => [page.page, page]));
    const plan: DeckNarrationPlan = {
      version: 1,
      deckGoal: result.data.deck_goal.trim(),
      storyline: result.data.storyline.trim(),
      // Every slide gets an entry even if the model skipped it, so the second pass can always
      // look one up and a missing plan degrades to "no extra context" rather than to a crash.
      pages: slides.map((slide) => {
        const planned = byPage.get(slide.page);
        return {
          page: slide.page,
          goal: planned?.goal.trim() ?? '',
          keyPoints: (planned?.key_points ?? []).map((point) => point.trim()).filter(Boolean).slice(0, MAX_KEY_POINTS),
          bridge: planned?.bridge.trim() ?? '',
        };
      }),
    };
    writeNarrationPlan(pdfId, plan);
    logger.info({ pdfId, pages: plan.pages.length }, 'pptx narration: wrote the deck plan');
    return plan;
  } catch (err) {
    // Without a plan the narration is still written, just without the deck's context — worse, but
    // not nothing, and the failure is visible in the log rather than as a failed import.
    logger.error({ err, pdfId }, 'pptx narration: could not plan the deck');
    return null;
  }
}

/** Marker that separates the slide's own words from the plan written underneath them. */
export const PLAN_SECTION_MARKER = '【講稿大綱】';

/** The plan for one page, as the text a reader (or the AI tutor) sees under the slide's words. */
export function renderPagePlanSection(plan: PageNarrationPlan): string {
  const lines = [PLAN_SECTION_MARKER];
  if (plan.goal) lines.push(`這一頁的目標：${plan.goal}`);
  if (plan.bridge) lines.push(`承接上一頁：${plan.bridge}`);
  if (plan.keyPoints.length > 0) {
    lines.push('要講到的重點：');
    for (const point of plan.keyPoints) lines.push(`- ${point}`);
  }
  return lines.join('\n');
}

/**
 * Put the plan into the presentation itself.
 *
 * The plan is not only an instruction to the narrator — it is the page's outline, and the deck's
 * own text is where an outline belongs: it is what the outline view shows, what the user can edit,
 * and what the AI tutor reads. Written under the slide's own words behind a marker, so re-planning
 * replaces the section instead of stacking copies of it.
 */
export function applyPlanToPageText(existingText: string, plan: PageNarrationPlan): string {
  const base = stripPlanSection(existingText).trimEnd();
  const section = renderPagePlanSection(plan);
  if (section === PLAN_SECTION_MARKER) return `${base}\n`;
  return `${base}\n\n${section}\n`;
}

export function stripPlanSection(text: string): string {
  const index = text.indexOf(PLAN_SECTION_MARKER);
  return index < 0 ? text : text.slice(0, index);
}

/** The deck-level plan as the header of the deck's source text. */
export function renderDeckPlanHeader(plan: DeckNarrationPlan): string {
  const lines = ['【這份簡報的目標】', plan.deckGoal || '（未指定）'];
  if (plan.storyline) lines.push('', '【整份脈絡】', plan.storyline);
  return lines.join('\n');
}
