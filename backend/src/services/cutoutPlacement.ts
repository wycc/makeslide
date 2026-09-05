/**
 * Decides, for each cut-out (docs/page-elements.md §9.5), *when* it should appear — the narration
 * sentence it illustrates — and *where* on the slide it should be shown, by asking a
 * vision-capable model to look at the erased page, the cut-out pictures and the transcript.
 *
 * Injected into `cutoutPageRegions()` like the eraser: the route supplies `llmCutoutPlacer` when
 * an LLM is configured, tests a stub, and when it is absent or fails every cut-out falls back to
 * its original box and a staggered start time.
 */
import sharp from 'sharp';
import { z } from 'zod';
import type { ChatCompletionContentPart } from 'openai/resources/chat/completions';
import { config } from '../config';
import { logger } from '../logger';
import { callChatJSON } from './openai';

/** Same cap as the AI focus generator: sentences past this index cannot be referenced. */
export const MAX_CUTOUT_SENTENCES = 20;
const MIN_WIDTH_PCT = 5;

export interface CutoutPlacementBox {
  xPct: number;
  yPct: number;
  widthPct: number;
  heightPct: number;
}

export interface CutoutPlacementInput {
  /** The page after erasing, so the model sees which areas are now empty background. */
  erasedPage: Buffer;
  pageWidth: number;
  pageHeight: number;
  cutouts: Array<{
    index: number;
    /** PNG of the cut-out. */
    image: Buffer;
    /** Where it was cut from, 0–100 percentages of the page. */
    origin: CutoutPlacementBox;
    /** width / height of the cut-out in pixels. */
    aspect: number;
  }>;
  sentences: string[];
}

export interface CutoutPlacement {
  index: number;
  /** Transcript sentence (0-based) whose start reveals the cut-out; null = no good match. */
  line: number | null;
  /** Where to show it, 0–100 percentages of the page, aspect ratio preserved. */
  box: CutoutPlacementBox;
}

export type CutoutPlacer = (input: CutoutPlacementInput) => Promise<CutoutPlacement[]>;

const ResponseSchema = z.object({
  placements: z
    .array(
      z.object({
        cutout: z.number().int().min(0),
        line: z.number().int().min(-1).nullable().optional(),
        xPct: z.number().optional(),
        yPct: z.number().optional(),
        widthPct: z.number().optional(),
        reason: z.string().max(400).optional(),
      }),
    )
    .max(40),
});

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Turns a proposed box into one that fits the page and keeps the cut-out's aspect ratio.
 * Height is always derived from width, so the picture is never stretched.
 */
export function fitPlacementBox(
  proposal: { xPct?: number; yPct?: number; widthPct?: number },
  origin: CutoutPlacementBox,
  aspect: number,
  page: { width: number; height: number },
): CutoutPlacementBox {
  const pageAspect = page.width / page.height;
  const widthPct = clamp(Number.isFinite(proposal.widthPct) ? (proposal.widthPct as number) : origin.widthPct, MIN_WIDTH_PCT, 100);
  // width% of page → pixels → height pixels via the picture's aspect → % of page height.
  let heightPct = (widthPct * pageAspect) / Math.max(0.01, aspect);
  let w = widthPct;
  if (heightPct > 100) {
    heightPct = 100;
    w = (heightPct * aspect) / pageAspect;
  }
  const xPct = clamp(Number.isFinite(proposal.xPct) ? (proposal.xPct as number) : origin.xPct, 0, 100 - w);
  const yPct = clamp(Number.isFinite(proposal.yPct) ? (proposal.yPct as number) : origin.yPct, 0, 100 - heightPct);
  const r = (v: number) => Math.round(v * 100) / 100;
  return { xPct: r(xPct), yPct: r(yPct), widthPct: r(w), heightPct: r(heightPct) };
}

/** Maps the model's answer onto the cut-outs; anything missing or out of range falls back to the origin. */
export function mapPlacementResponse(
  response: z.infer<typeof ResponseSchema>,
  input: Pick<CutoutPlacementInput, 'cutouts' | 'sentences' | 'pageWidth' | 'pageHeight'>,
): CutoutPlacement[] {
  const limit = Math.min(input.sentences.length, MAX_CUTOUT_SENTENCES);
  const byIndex = new Map<number, (typeof response.placements)[number]>();
  for (const p of response.placements) if (!byIndex.has(p.cutout)) byIndex.set(p.cutout, p);
  return input.cutouts.map((c) => {
    const p = byIndex.get(c.index);
    const line = p && typeof p.line === 'number' && p.line >= 0 && p.line < limit ? p.line : null;
    return {
      index: c.index,
      line,
      box: fitPlacementBox(p ?? {}, c.origin, c.aspect, { width: input.pageWidth, height: input.pageHeight }),
    };
  });
}

function systemPrompt(): string {
  return [
    'You place pictures that were cut out of a presentation slide back onto that slide as an animation.',
    'Each cut-out will fade in when a narration sentence starts. For every cut-out decide:',
    '1. "line": the 0-based index of the narration sentence that talks about what the picture shows — the moment a presenter would point at it. If no sentence relates to it, use null.',
    '2. Where to show it, as percentages of the slide: "xPct", "yPct" (top-left corner) and "widthPct". Height is derived from the picture\'s own aspect ratio, so give width only.',
    'The slide image you receive is the page AFTER the cut-outs were erased, so their original spots are empty background. Showing a cut-out at its original spot ("origin" below) is usually right; move it only when another spot is clearly better (e.g. the picture is small and would be more readable larger in an empty area, or it would now cover text). Never cover text or other cut-outs; keep everything inside the slide.',
    'Answer with JSON only: {"placements":[{"cutout":0,"line":2,"xPct":10,"yPct":20,"widthPct":30}]}. One entry per cut-out.',
  ].join('\n');
}

async function toDataUrl(buffer: Buffer, width: number): Promise<string> {
  const jpeg = await sharp(buffer).resize({ width, withoutEnlargement: true, fit: 'inside' }).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
  return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
}

/** Asks the configured LLM (with vision) for placements. Throws on failure — callers fall back. */
export const llmCutoutPlacer: CutoutPlacer = async (input) => {
  const limit = Math.min(input.sentences.length, MAX_CUTOUT_SENTENCES);
  const parts: ChatCompletionContentPart[] = [];
  parts.push({ type: 'text', text: 'The slide after erasing the cut-outs:' });
  parts.push({ type: 'image_url', image_url: { url: await toDataUrl(input.erasedPage, config.openaiScriptImageMaxWidth), detail: 'high' } });
  for (const c of input.cutouts) {
    const o = c.origin;
    parts.push({
      type: 'text',
      text: `Cut-out #${c.index} — origin: xPct ${o.xPct.toFixed(1)}, yPct ${o.yPct.toFixed(1)}, widthPct ${o.widthPct.toFixed(1)}, heightPct ${o.heightPct.toFixed(1)}:`,
    });
    parts.push({ type: 'image_url', image_url: { url: await toDataUrl(c.image, 512), detail: 'low' } });
  }
  const sentenceLines = input.sentences
    .slice(0, limit)
    .map((s, i) => `${i}: ${s.trim()}`)
    .join('\n');
  parts.push({
    type: 'text',
    text: limit > 0 ? `Narration sentences (0-based):\n${sentenceLines}` : 'There is no narration for this page: set "line" to null for every cut-out and only choose positions.',
  });
  const result = await callChatJSON({
    label: 'cutout-placement',
    schema: ResponseSchema,
    maxTokens: 1500,
    temperature: 0.2,
    messages: [
      { role: 'system', content: systemPrompt() },
      { role: 'user', content: parts },
    ],
  });
  logger.info({ placements: result.data.placements.length, cutouts: input.cutouts.length }, 'cutoutPlacement: model answered');
  return mapPlacementResponse(result.data, input);
};
