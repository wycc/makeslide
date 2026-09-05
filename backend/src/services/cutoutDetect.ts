/**
 * Proposes cut-out regions automatically (docs/page-elements.md §9.6), so the user does not have
 * to box every part of the picture by hand.
 *
 * Two stages. The first is deterministic image analysis: pixels that differ from the page's
 * background are grouped into connected blobs, blobs are closed into blocks (so the glyphs of a
 * paragraph become one box), and boxes that touch or nearly touch are merged. The second,
 * optional, asks a vision model to look at the numbered candidates and say which to keep, which
 * to merge into one unit (a chart and its caption) and what each shows — that is the part a
 * pixel rule cannot know. The model never invents coordinates: it only groups boxes the analysis
 * found, so its imprecision with numbers does not matter.
 */
import sharp from 'sharp';
import { z } from 'zod';
import type { ChatCompletionContentPart } from 'openai/resources/chat/completions';
import { config } from '../config';
import { logger } from '../logger';
import { callChatJSON } from './openai';
import type { CutoutRegion } from './pageCutouts';

export interface CutoutCandidate extends CutoutRegion {
  /** Short description from the refiner, when it ran. */
  label?: string;
}

export interface DetectOptions {
  /** Analysis width in pixels; the picture is downscaled to this (default 320). */
  analysisWidth?: number;
  /** Colour distance (0–441) from the background that counts as content (default 48). */
  threshold?: number;
  /** Closing radius as a fraction of the width, merging glyphs into blocks (default 0.012). */
  closeRadius?: number;
  /** Boxes closer than this fraction of the width are merged (default 0.015). */
  mergeGap?: number;
  /** Boxes covering less than this fraction of the page are dropped (default 0.0015). */
  minArea?: number;
  /** Boxes covering more than this fraction of the page are dropped — that is the page itself (default 0.85). */
  maxArea?: number;
  maxRegions?: number;
}

export const MAX_DETECTED_REGIONS = 20;

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The page's background colour: the most common quantised colour along its border. */
export function estimateBackground(data: Buffer, width: number, height: number, channels: number): [number, number, number] {
  const counts = new Map<string, { n: number; sum: [number, number, number] }>();
  const visit = (x: number, y: number) => {
    const i = (y * width + x) * channels;
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    const key = `${r >> 4},${g >> 4},${b >> 4}`;
    const entry = counts.get(key) ?? { n: 0, sum: [0, 0, 0] };
    entry.n++;
    entry.sum[0] += r;
    entry.sum[1] += g;
    entry.sum[2] += b;
    counts.set(key, entry);
  };
  for (let x = 0; x < width; x++) {
    visit(x, 0);
    visit(x, height - 1);
  }
  for (let y = 1; y < height - 1; y++) {
    visit(0, y);
    visit(width - 1, y);
  }
  let best: { n: number; sum: [number, number, number] } | null = null;
  for (const entry of counts.values()) if (!best || entry.n > best.n) best = entry;
  if (!best) return [255, 255, 255];
  return [Math.round(best.sum[0] / best.n), Math.round(best.sum[1] / best.n), Math.round(best.sum[2] / best.n)];
}

function dilate(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  if (radius <= 0) return mask;
  // Separable box dilation: horizontal pass, then vertical.
  const tmp = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    let run = 0;
    for (let x = 0; x < width + radius; x++) {
      if (x < width && mask[y * width + x]) run = radius * 2 + 1;
      const tx = x - radius;
      if (tx >= 0 && tx < width && run > 0) tmp[y * width + tx] = 1;
      if (run > 0) run--;
    }
  }
  const out = new Uint8Array(mask.length);
  for (let x = 0; x < width; x++) {
    let run = 0;
    for (let y = 0; y < height + radius; y++) {
      if (y < height && tmp[y * width + x]) run = radius * 2 + 1;
      const ty = y - radius;
      if (ty >= 0 && ty < height && run > 0) out[ty * width + x] = 1;
      if (run > 0) run--;
    }
  }
  return out;
}

/** Bounding boxes of the 4-connected components of a binary mask. */
export function connectedComponentBoxes(mask: Uint8Array, width: number, height: number): Box[] {
  const seen = new Uint8Array(mask.length);
  const boxes: Box[] = [];
  const stack: number[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    seen[start] = 1;
    stack.push(start);
    const box: Box = { left: width, top: height, right: -1, bottom: -1 };
    while (stack.length) {
      const idx = stack.pop()!;
      const x = idx % width;
      const y = (idx - x) / width;
      if (x < box.left) box.left = x;
      if (x > box.right) box.right = x;
      if (y < box.top) box.top = y;
      if (y > box.bottom) box.bottom = y;
      const neighbours = [idx - 1, idx + 1, idx - width, idx + width];
      if (x === 0) neighbours[0] = -1;
      if (x === width - 1) neighbours[1] = -1;
      for (const n of neighbours) {
        if (n < 0 || n >= mask.length || seen[n] || !mask[n]) continue;
        seen[n] = 1;
        stack.push(n);
      }
    }
    boxes.push(box);
  }
  return boxes;
}

/** Merges boxes that overlap or sit within `gap` pixels of each other, until nothing changes. */
export function mergeBoxes(boxes: Box[], gap: number): Box[] {
  let current = boxes.map((b) => ({ ...b }));
  let merged = true;
  while (merged) {
    merged = false;
    const next: Box[] = [];
    const used = new Uint8Array(current.length);
    for (let i = 0; i < current.length; i++) {
      if (used[i]) continue;
      const a = { ...current[i]! };
      used[i] = 1;
      for (let j = i + 1; j < current.length; j++) {
        if (used[j]) continue;
        const b = current[j]!;
        const touches = a.left - gap <= b.right && b.left - gap <= a.right && a.top - gap <= b.bottom && b.top - gap <= a.bottom;
        if (!touches) continue;
        a.left = Math.min(a.left, b.left);
        a.top = Math.min(a.top, b.top);
        a.right = Math.max(a.right, b.right);
        a.bottom = Math.max(a.bottom, b.bottom);
        used[j] = 1;
        merged = true;
      }
      next.push(a);
    }
    current = next;
  }
  return current;
}

/**
 * Stage one: content blocks of the picture as page-fraction boxes, top-to-bottom, left-to-right.
 */
export async function detectCutoutCandidates(image: Buffer, options: DetectOptions = {}): Promise<CutoutCandidate[]> {
  const analysisWidth = options.analysisWidth ?? 320;
  const threshold = options.threshold ?? 48;
  const { data, info } = await sharp(image).resize({ width: analysisWidth, withoutEnlargement: false }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const bg = estimateBackground(data, width, height, channels);
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const o = i * channels;
    const dr = data[o]! - bg[0];
    const dg = data[o + 1]! - bg[1];
    const db = data[o + 2]! - bg[2];
    if (Math.sqrt(dr * dr + dg * dg + db * db) > threshold) mask[i] = 1;
  }
  const radius = Math.max(1, Math.round((options.closeRadius ?? 0.012) * width));
  const closed = dilate(mask, width, height, radius);
  const gap = Math.max(1, Math.round((options.mergeGap ?? 0.015) * width));
  const boxes = mergeBoxes(connectedComponentBoxes(closed, width, height), gap);
  const minArea = options.minArea ?? 0.0015;
  const maxArea = options.maxArea ?? 0.85;
  const pad = Math.max(1, Math.round(radius / 2));
  const regions = boxes
    .map((b) => {
      // Undo the dilation's growth, keep a small margin, clamp to the picture.
      const left = Math.max(0, b.left + radius - pad);
      const top = Math.max(0, b.top + radius - pad);
      const right = Math.min(width, b.right - radius + pad + 1);
      const bottom = Math.min(height, b.bottom - radius + pad + 1);
      return { x: left / width, y: top / height, w: Math.max(0, right - left) / width, h: Math.max(0, bottom - top) / height };
    })
    .filter((r) => r.w > 0 && r.h > 0)
    .filter((r) => {
      const area = r.w * r.h;
      return area >= minArea && area <= maxArea;
    })
    .map((r) => ({ x: round4(r.x), y: round4(r.y), w: round4(r.w), h: round4(r.h) }))
    .sort((a, b) => (Math.abs(a.y - b.y) > 0.04 ? a.y - b.y : a.x - b.x));
  return regions.slice(0, options.maxRegions ?? MAX_DETECTED_REGIONS);
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}

// ─── Stage two: the model groups and labels ─────────────────────────────────

export interface RefineInput {
  image: Buffer;
  candidates: CutoutCandidate[];
  sentences: string[];
}

export type CutoutRefiner = (input: RefineInput) => Promise<CutoutCandidate[]>;

const RefineResponseSchema = z.object({
  units: z
    .array(
      z.object({
        boxes: z.array(z.number().int().min(0)).min(1).max(40),
        label: z.string().max(120).optional(),
        keep: z.boolean().optional(),
      }),
    )
    .max(40),
});

/** Unions the candidates a unit lists; drops units marked `keep: false`; unlisted candidates are kept as they are. */
export function applyRefinement(candidates: CutoutCandidate[], response: z.infer<typeof RefineResponseSchema>, maxRegions = MAX_DETECTED_REGIONS): CutoutCandidate[] {
  const used = new Set<number>();
  const out: CutoutCandidate[] = [];
  for (const unit of response.units) {
    const ids = unit.boxes.filter((i) => i < candidates.length && !used.has(i));
    if (ids.length === 0) continue;
    ids.forEach((i) => used.add(i));
    if (unit.keep === false) continue;
    const members = ids.map((i) => candidates[i]!);
    const x = Math.min(...members.map((m) => m.x));
    const y = Math.min(...members.map((m) => m.y));
    const right = Math.max(...members.map((m) => m.x + m.w));
    const bottom = Math.max(...members.map((m) => m.y + m.h));
    out.push({ x: round4(x), y: round4(y), w: round4(right - x), h: round4(bottom - y), ...(unit.label?.trim() ? { label: unit.label.trim().slice(0, 120) } : {}) });
  }
  candidates.forEach((c, i) => {
    if (!used.has(i)) out.push(c);
  });
  return out.sort((a, b) => (Math.abs(a.y - b.y) > 0.04 ? a.y - b.y : a.x - b.x)).slice(0, maxRegions);
}

/** Draws numbered boxes on the picture so the model can refer to candidates by number. */
export async function annotateCandidates(image: Buffer, candidates: CutoutCandidate[]): Promise<Buffer> {
  const meta = await sharp(image).metadata();
  const width = meta.width ?? 1;
  const height = meta.height ?? 1;
  const fontSize = Math.max(14, Math.round(height / 32));
  const rects = candidates
    .map((c, i) => {
      const x = c.x * width;
      const y = c.y * height;
      const w = c.w * width;
      const h = c.h * height;
      return (
        `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#ff3b30" stroke-width="${Math.max(2, width / 400)}"/>` +
        `<rect x="${x}" y="${Math.max(0, y - fontSize * 1.3)}" width="${fontSize * 1.8}" height="${fontSize * 1.3}" fill="#ff3b30"/>` +
        `<text x="${x + fontSize * 0.3}" y="${Math.max(fontSize, y - fontSize * 0.3)}" font-family="sans-serif" font-size="${fontSize}" font-weight="bold" fill="#fff">${i}</text>`
      );
    })
    .join('');
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${rects}</svg>`);
  return sharp(image).composite([{ input: svg, left: 0, top: 0 }]).jpeg({ quality: 85 }).toBuffer();
}

function refineSystemPrompt(): string {
  return [
    'You help prepare a presentation slide for a step-by-step reveal animation.',
    'The slide picture is shown with numbered red boxes: candidate regions found by image analysis. Each region that survives will be cut out of the picture and faded back in later, one after another.',
    'Group the numbered boxes into meaningful units. Rules:',
    '- Boxes that belong together (a chart and its caption, an icon and its label, the lines of one paragraph, one diagram split into pieces) go into ONE unit.',
    '- Drop decorative or structural pieces that should stay in the background (page borders, dividers, background shapes, footers, logos, page numbers): give them "keep": false.',
    '- Keep meaningful content: figures, diagrams, charts, photos, formulas, text blocks, bullet groups.',
    '- Give each kept unit a short label (a few words) saying what it shows.',
    'Answer with JSON only: {"units":[{"boxes":[0,3],"label":"revenue chart","keep":true},{"boxes":[5],"keep":false}]}. Every box number should appear in exactly one unit.',
  ].join('\n');
}

/** The LLM refiner. Throws on failure — callers fall back to the raw candidates. */
export const llmCutoutRefiner: CutoutRefiner = async (input) => {
  if (input.candidates.length === 0) return [];
  const annotated = await annotateCandidates(input.image, input.candidates);
  const resized = await sharp(annotated).resize({ width: config.openaiScriptImageMaxWidth, withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
  const parts: ChatCompletionContentPart[] = [
    { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${resized.toString('base64')}`, detail: 'high' } },
    {
      type: 'text',
      text:
        `Candidates (page percentages): ${input.candidates
          .map((c, i) => `#${i} x ${(c.x * 100).toFixed(0)} y ${(c.y * 100).toFixed(0)} w ${(c.w * 100).toFixed(0)} h ${(c.h * 100).toFixed(0)}`)
          .join('; ')}.` +
        (input.sentences.length ? `\nNarration of this page, for context:\n${input.sentences.slice(0, 20).map((s, i) => `${i}: ${s}`).join('\n')}` : ''),
    },
  ];
  const result = await callChatJSON({
    label: 'cutout-detect-refine',
    schema: RefineResponseSchema,
    maxTokens: 1200,
    temperature: 0.2,
    messages: [
      { role: 'system', content: refineSystemPrompt() },
      { role: 'user', content: parts },
    ],
  });
  logger.info({ candidates: input.candidates.length, units: result.data.units.length }, 'cutoutDetect: model grouped candidates');
  return applyRefinement(input.candidates, result.data);
};
