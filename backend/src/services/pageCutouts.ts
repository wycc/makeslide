/**
 * Cut-outs (docs/page-elements.md §9): the user boxes regions of a page's base image; each box is
 * cropped into a page figure, erased from the base with an AI inpaint so the picture reads as
 * background there, and (by default) brought back as an `overlay-image` animation effect at its
 * original position — so the region can be revealed on the timeline.
 *
 * The erase itself is injected (`CutoutEraser`): the route supplies the image-edit model, tests a
 * stub. Everything around it — cropping, mask geometry, compositing only the box back, figure and
 * spec bookkeeping — is deterministic and lives here.
 */
import fs from 'node:fs';
import sharp from 'sharp';
import { nanoid } from 'nanoid';
import { db } from '../db';
import { logger } from '../logger';
import { addPageFigure } from './pdfFigures';
import type { FigureEntry } from '../worker/steps/extractPdfFigures';
import { computeEraseContext, compositeErasedRegion, type PixelBox } from './reactSlideTextExtract';
import { pageAnimationSpecPath, pageBaseImagePath, pageImagePath, safeJoinPdfPath } from './storage';
import { defaultAnimationSpec, parseStoredAnimationSpec, renderTypeForSpec, validateAnimationSpec, type AnimationEffect, type AnimationSpec } from './pageAnimation';
import { replacePageBaseImage } from './pageElements';
import { splitScriptIntoSentences } from './textSentences';
import type { CutoutPlacement, CutoutPlacer } from './cutoutPlacement';

/** A box on the page, 0..1 of the base image's width / height (same space as page elements). */
export interface CutoutRegion {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Optional description (from auto-detection); becomes the figure's caption. */
  label?: string;
}

export const MAX_CUTOUT_REGIONS = 20;
export const MIN_CUTOUT_SIZE = 0.01;
/** The image-edit model's working size; crops are resampled to it and back. */
export const CUTOUT_MODEL_WIDTH = 1536;
export const CUTOUT_MODEL_HEIGHT = 1024;

/**
 * Repaints `source` (a PNG at the model size) inside the transparent area of `mask` and returns the
 * model's output image. Only this step talks to a model.
 */
export type CutoutEraser = (input: { source: Buffer; mask: Buffer; prompt: string }) => Promise<Buffer>;

export const DEFAULT_CUTOUT_PROMPT = [
  'Remove everything inside the masked region and continue the surrounding background exactly:',
  'same colours, gradient, pattern, texture and lighting.',
  'Do not draw any new text, shapes, icons or objects there — it must look like empty background.',
].join(' ');

export interface CutoutOptions {
  eraser: CutoutEraser;
  /** Extra guidance appended to the default erase instruction. */
  prompt?: string | null;
  /** Add an `overlay-image` effect per cut-out (default true). */
  animate?: boolean;
  /** Seconds between consecutive reveals on the timeline (default 1). */
  revealGapSeconds?: number;
  /**
   * Picks the narration sentence and the on-slide box for each cut-out (§9.5). Absent or failing:
   * original box, staggered start times.
   */
  placer?: CutoutPlacer | null;
}

export interface CutoutRegionResult {
  index: number;
  status: 'done' | 'failed';
  message?: string;
  figure?: FigureEntry;
  effectId?: string;
  /** Transcript sentence (0-based) the cut-out illustrates, when the placer found one. */
  line?: number | null;
  sentence?: string | null;
  /**
   * How the effect is timed: `immediate` (visible from the start — the title, or a cut-out whose
   * sentence is the first), `before-sentence` (fades in one sentence ahead of `line`), or
   * `timeline` (staggered numeric start; no narration match).
   */
  reveal?: 'immediate' | 'before-sentence' | 'timeline';
  /** Where the overlay shows it, 0–100 percentages of the page. */
  params?: { xPct: number; yPct: number; widthPct: number; heightPct: number };
  /** PNG of the crop, kept for the placer; not serialised. */
  crop?: Buffer;
}

export interface CutoutResult {
  results: CutoutRegionResult[];
  /** True when the base image was rewritten (at least one region succeeded). */
  baseUpdated: boolean;
  renderType: string | null;
}

interface PageIdentity {
  pdfId: string;
  pageNumber: number;
  pageUid: string;
}

/** Pixel box of a region on an image of the given size, clamped inside it. */
export function cutoutRegionToPixels(region: CutoutRegion, width: number, height: number): PixelBox {
  const left = Math.max(0, Math.min(width - 1, Math.round(region.x * width)));
  const top = Math.max(0, Math.min(height - 1, Math.round(region.y * height)));
  const w = Math.max(1, Math.min(width - left, Math.round(region.w * width)));
  const h = Math.max(1, Math.min(height - top, Math.round(region.h * height)));
  return { left, top, width: w, height: h };
}

/** Opaque black mask with a transparent hole — the image-edit "paint here" convention. */
export async function buildHoleMask(width: number, height: number, hole: PixelBox): Promise<Buffer> {
  const stamp = await sharp({
    create: { width: Math.max(1, hole.width), height: Math.max(1, hole.height), channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
  })
    .png()
    .toBuffer();
  return sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } })
    .composite([{ input: stamp, left: Math.max(0, hole.left), top: Math.max(0, hole.top), blend: 'dest-out' }])
    .png()
    .toBuffer();
}

/** The picture the cut-outs come from: the element layer's base when there is one, else the page image. */
export function cutoutSourcePath(page: PageIdentity, imagePath: string | null): string {
  const base = pageBaseImagePath(page.pdfId, page.pageUid);
  if (fs.existsSync(base)) return base;
  return imagePath ? safeJoinPdfPath(page.pdfId, imagePath) : pageImagePath(page.pdfId, page.pageUid);
}

export async function cutoutPageRegions(
  page: PageIdentity,
  imagePath: string | null,
  regions: CutoutRegion[],
  options: CutoutOptions,
): Promise<CutoutResult> {
  const { pdfId, pageNumber } = page;
  const sourcePath = cutoutSourcePath(page, imagePath);
  const original = await sharp(sourcePath).png().toBuffer();
  const meta = await sharp(original).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (!width || !height) throw new Error('Page image has no dimensions');
  const prompt = options.prompt?.trim() ? `${DEFAULT_CUTOUT_PROMPT} ${options.prompt.trim()}` : DEFAULT_CUTOUT_PROMPT;

  let current = original;
  const results: CutoutRegionResult[] = [];
  for (const [index, region] of regions.entries()) {
    const box = cutoutRegionToPixels(region, width, height);
    try {
      // The crop is taken from the picture as it was before any erasing, so overlapping boxes
      // still cut out what the user saw, not a half-erased patch.
      const crop = await sharp(original).extract(box).png().toBuffer();
      const context = computeEraseContext(box, width, height, CUTOUT_MODEL_WIDTH / CUTOUT_MODEL_HEIGHT);
      const source = await sharp(current).extract(context).resize(CUTOUT_MODEL_WIDTH, CUTOUT_MODEL_HEIGHT, { fit: 'fill' }).png().toBuffer();
      const sx = CUTOUT_MODEL_WIDTH / context.width;
      const sy = CUTOUT_MODEL_HEIGHT / context.height;
      const mask = await buildHoleMask(CUTOUT_MODEL_WIDTH, CUTOUT_MODEL_HEIGHT, {
        left: Math.round((box.left - context.left) * sx),
        top: Math.round((box.top - context.top) * sy),
        width: Math.max(1, Math.round(box.width * sx)),
        height: Math.max(1, Math.round(box.height * sy)),
      });
      const edited = await options.eraser({ source, mask, prompt });
      current = await compositeErasedRegion({ original: current, edited, context, box });

      const figure = await addPageFigure(pdfId, pageNumber, crop, {
        caption: region.label?.trim() || `剪下區域 ${index + 1}`,
        context: `從第 ${pageNumber} 頁底圖剪下的區域（x ${(region.x * 100).toFixed(1)}%、y ${(region.y * 100).toFixed(1)}%、寬 ${(region.w * 100).toFixed(1)}%、高 ${(region.h * 100).toFixed(1)}%）`,
        bbox: { xPct: box.left / width, yPct: box.top / height, widthPct: box.width / width, heightPct: box.height / height },
        source: 'cutout',
      });
      results.push({ index, status: 'done', figure, crop });
    } catch (err) {
      logger.warn({ err, pdfId, pageNumber, index }, 'cutout: region failed');
      results.push({ index, status: 'failed', message: err instanceof Error ? err.message : String(err) });
    }
  }

  const done = results.filter((r) => r.status === 'done');
  if (done.length === 0) {
    return { results, baseUpdated: false, renderType: null };
  }

  const jpeg = await sharp(current).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
  await replacePageBaseImage(page, jpeg, `image: cut out ${done.length} region(s) from page ${pageNumber}`);

  let renderType: string | null = null;
  if (options.animate !== false) {
    const sentences = readPageSentences(page);
    const placements = options.placer ? await placeCutouts(options.placer, { page, current, width, height, done, sentences }) : null;
    renderType = await appendCutoutEffects(page, done, placements, sentences, options.revealGapSeconds ?? 1);
  }
  for (const r of results) delete r.crop;
  return { results, baseUpdated: true, renderType };
}

/** The page's narration split the way playback does (frontend `splitScriptIntoSentences`). */
function readPageSentences(page: PageIdentity): string[] {
  const row = db.prepare(`SELECT script_path FROM pages WHERE pdf_id = ? AND page_number = ?`).get(page.pdfId, page.pageNumber) as
    | { script_path: string | null }
    | undefined;
  if (!row?.script_path) return [];
  try {
    return splitScriptIntoSentences(fs.readFileSync(safeJoinPdfPath(page.pdfId, row.script_path), 'utf8'));
  } catch {
    return [];
  }
}

/** Runs the placer; any failure means "no placements" so the cut-outs still land at their origin. */
async function placeCutouts(
  placer: CutoutPlacer,
  input: { page: PageIdentity; current: Buffer; width: number; height: number; done: CutoutRegionResult[]; sentences: string[] },
): Promise<Map<number, CutoutPlacement> | null> {
  try {
    const placements = await placer({
      erasedPage: input.current,
      pageWidth: input.width,
      pageHeight: input.height,
      sentences: input.sentences,
      cutouts: input.done.map((r) => ({
        index: r.index,
        image: r.crop!,
        origin: originBox(r.figure!),
        aspect: r.figure!.width / Math.max(1, r.figure!.height),
      })),
    });
    return new Map(placements.map((p) => [p.index, p]));
  } catch (err) {
    logger.warn({ err, pdfId: input.page.pdfId, pageNumber: input.page.pageNumber }, 'cutout: placement failed, using original boxes');
    return null;
  }
}

function originBox(figure: FigureEntry): { xPct: number; yPct: number; widthPct: number; heightPct: number } {
  const r = (v: number) => Math.round(v * 10000) / 100;
  return { xPct: r(figure.bbox.xPct), yPct: r(figure.bbox.yPct), widthPct: r(figure.bbox.widthPct), heightPct: r(figure.bbox.heightPct) };
}

function readSpec(page: PageIdentity): AnimationSpec {
  const row = db.prepare(`SELECT animation_spec_path FROM pages WHERE pdf_id = ? AND page_number = ?`).get(page.pdfId, page.pageNumber) as
    | { animation_spec_path: string | null }
    | undefined;
  const abs = row?.animation_spec_path ? safeJoinPdfPath(page.pdfId, row.animation_spec_path) : pageAnimationSpecPath(page.pdfId, page.pageUid);
  if (!fs.existsSync(abs)) return defaultAnimationSpec();
  try {
    return parseStoredAnimationSpec(fs.readFileSync(abs, 'utf8'));
  } catch {
    return defaultAnimationSpec();
  }
}

/** Cut-outs whose top edge is above this line of the page are treated as the title. */
export const TITLE_ZONE_PCT = 25;

/**
 * One `overlay-image` per cut-out, fading in with no exit: a revealed region stays — that is the
 * "gradually show parts of the picture" use case.
 *
 * Timing rules (docs/page-elements.md §9.5):
 * - The topmost cut-out, when it sits in the title zone, is visible from the very start — a page
 *   that opens completely blank reads as broken, and that region is almost always the title.
 * - A cut-out matched to sentence N fades in at the start of sentence N-1, so the picture is on
 *   screen before the narration refers to it; a match to the first sentence is shown immediately.
 * - Without a match (no narration, no LLM) the reveals are staggered on the timeline instead.
 */
async function appendCutoutEffects(
  page: PageIdentity,
  done: CutoutRegionResult[],
  placements: Map<number, CutoutPlacement> | null,
  sentences: string[],
  gapSeconds: number,
): Promise<string> {
  const spec = readSpec(page);
  const lastEnd = spec.effects.reduce((max, e) => Math.max(max, e.start + e.duration), 0);
  // The title: the topmost cut-out, provided it really sits at the top of the page.
  let titleIndex = -1;
  let titleTop = Number.POSITIVE_INFINITY;
  for (const r of done) {
    const top = originBox(r.figure!).yPct;
    if (top < titleTop) {
      titleTop = top;
      titleIndex = r.index;
    }
  }
  if (titleTop >= TITLE_ZONE_PCT) titleIndex = -1;

  let staggered = 0;
  const effects: AnimationEffect[] = done.map((r) => {
    const id = `cutout-${nanoid(8)}`;
    r.effectId = id;
    const placement = placements?.get(r.index) ?? null;
    const params = placement?.box ?? originBox(r.figure!);
    const line = placement?.line ?? null;
    r.line = line;
    r.sentence = line !== null ? sentences[line] ?? null : null;
    r.params = params;
    const immediate = r.index === titleIndex || line === 0;
    r.reveal = immediate ? 'immediate' : line !== null ? 'before-sentence' : 'timeline';
    let start = 0;
    if (!immediate) {
      staggered++;
      // Numeric fallback when the page has no narration timing; with a startTrigger the sentence wins.
      start = Math.round((lastEnd + staggered * gapSeconds) * 100) / 100;
    }
    return {
      id,
      target: 'slide',
      type: 'overlay-image',
      start,
      duration: immediate ? 0.01 : 0.8,
      ease: 'power1.out',
      figureId: r.figure!.id,
      overlayImageOpacity: 1,
      params: { ...params } as Record<string, number>,
      ...(!immediate && line !== null ? { startTrigger: { type: 'transcript-line', line: line - 1, anchor: 'start' } } : {}),
    } as AnimationEffect;
  });
  const candidate = { ...spec, version: 1 as const, enabled: true, effects: [...spec.effects, ...effects] };
  const validated = validateAnimationSpec(candidate);
  if (!validated.ok) throw new Error(`Cut-out animation effects are invalid: ${validated.message}`);
  const renderType = renderTypeForSpec(validated.spec);
  await fs.promises.writeFile(pageAnimationSpecPath(page.pdfId, page.pageUid), `${JSON.stringify(validated.spec, null, 2)}\n`, 'utf8');
  db.prepare(`UPDATE pages SET render_type = ?, animation_spec_path = ?, updated_at = ? WHERE pdf_id = ? AND page_number = ?`).run(
    renderType,
    `pages/${page.pageUid}.animation.json`,
    new Date().toISOString(),
    page.pdfId,
    page.pageNumber,
  );
  return renderType;
}
