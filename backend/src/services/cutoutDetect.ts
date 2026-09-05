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
  /** Analysis width in pixels; the picture is downscaled to this (default 480). */
  analysisWidth?: number;
  /** Colour distance (0–441) from the background that counts as content (default 40). */
  threshold?: number;
  /** Closing radius as a fraction of the width, merging glyphs into blocks (default 0.008). */
  closeRadius?: number;
  /** Boxes closer than this fraction of the width are merged (default 0.01). */
  mergeGap?: number;
  /** Boxes covering less than this fraction of the page are dropped (default 0.0015). */
  minArea?: number;
  /** Boxes covering more than this fraction of the page are dropped — that is the page itself (default 0.85). */
  maxArea?: number;
  /** Blobs larger than this fraction of the page are cut along internal whitespace (default 0.12). */
  splitMinArea?: number;
  /** A whitespace band must be at least this fraction of the page dimension to count as a separator (default 0.015). */
  minGap?: number;
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

interface Analysis {
  data: Buffer;
  width: number;
  height: number;
  channels: number;
}

function colourDistance(data: Buffer, offset: number, bg: [number, number, number]): number {
  const dr = data[offset]! - bg[0];
  const dg = data[offset + 1]! - bg[1];
  const db = data[offset + 2]! - bg[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/** Most common quantised colour inside a box (the fill of a card / panel), with its share of the pixels. */
function dominantColour(a: Analysis, box: Box): { colour: [number, number, number]; share: number } {
  const counts = new Map<string, { n: number; sum: [number, number, number] }>();
  let total = 0;
  for (let y = box.top; y <= box.bottom; y++) {
    for (let x = box.left; x <= box.right; x++) {
      const i = (y * a.width + x) * a.channels;
      const r = a.data[i]!;
      const g = a.data[i + 1]!;
      const b = a.data[i + 2]!;
      const key = `${r >> 4},${g >> 4},${b >> 4}`;
      const entry = counts.get(key) ?? { n: 0, sum: [0, 0, 0] };
      entry.n++;
      entry.sum[0] += r;
      entry.sum[1] += g;
      entry.sum[2] += b;
      counts.set(key, entry);
      total++;
    }
  }
  let best: { n: number; sum: [number, number, number] } | null = null;
  for (const entry of counts.values()) if (!best || entry.n > best.n) best = entry;
  if (!best || total === 0) return { colour: [255, 255, 255], share: 0 };
  return { colour: [Math.round(best.sum[0] / best.n), Math.round(best.sum[1] / best.n), Math.round(best.sum[2] / best.n)], share: best.n / total };
}

/** Content mask of a box against a background colour; 1 = differs from the background. */
function boxMask(a: Analysis, box: Box, bg: [number, number, number], threshold: number): { mask: Uint8Array; w: number; h: number; ink: number } {
  const w = box.right - box.left + 1;
  const h = box.bottom - box.top + 1;
  const mask = new Uint8Array(w * h);
  let ink = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = ((box.top + y) * a.width + (box.left + x)) * a.channels;
      if (colourDistance(a.data, i, bg) > threshold) {
        mask[y * w + x] = 1;
        ink++;
      }
    }
  }
  return { mask, w, h, ink };
}

/** Shrinks a box to the bounding box of its content mask; null when the box is empty. */
function trimToContent(box: Box, m: { mask: Uint8Array; w: number; h: number }): Box | null {
  let left = m.w;
  let top = m.h;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < m.h; y++) {
    for (let x = 0; x < m.w; x++) {
      if (!m.mask[y * m.w + x]) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (right < 0) return null;
  return { left: box.left + left, top: box.top + top, right: box.left + right, bottom: box.top + bottom };
}

/**
 * Longest run of (nearly) empty rows or columns strictly inside the profile; null when none reaches
 * `minLen`. `maxInk` lets a thin connector — an arrow between two stacked figures — count as
 * whitespace, since a text line carries far more ink than that.
 */
function widestGap(profile: number[], minLen: number, maxInk = 0): { start: number; end: number } | null {
  let best: { start: number; end: number } | null = null;
  let runStart = -1;
  for (let i = 0; i <= profile.length; i++) {
    const empty = i < profile.length && profile[i]! <= maxInk;
    if (empty && runStart < 0) runStart = i;
    if (!empty && runStart >= 0) {
      const runEnd = i - 1;
      // Gaps touching the edges are margins, not separators.
      if (runStart > 0 && runEnd < profile.length - 1 && runEnd - runStart + 1 >= minLen && (!best || runEnd - runStart > best.end - best.start)) {
        best = { start: runStart, end: runEnd };
      }
      runStart = -1;
    }
  }
  return best;
}

/**
 * Recursive XY-cut: a big box is split at its widest internal band of whitespace, alternating
 * axes as the data dictates, until the pieces are small or no band remains. Inside each box the
 * background is re-estimated, so the contents of a tinted card separate from the card's fill.
 */
function xyCut(a: Analysis, box: Box, globalBg: [number, number, number], opts: Required<Pick<DetectOptions, 'threshold' | 'splitMinArea' | 'minGap'>>, depth = 0): Box[] {
  const pageArea = a.width * a.height;
  const area = (box.right - box.left + 1) * (box.bottom - box.top + 1);
  // Big blobs split at any real whitespace band; smaller ones (a card's worth) only at a wide one,
  // so a bullet list is not cut into its lines; anything below a few percent stays whole.
  const small = area < opts.splitMinArea * pageArea;
  if ((small && area < 0.04 * pageArea) || depth > 8) return [box];
  const minGapFrac = small ? Math.max(opts.minGap, 0.04) : opts.minGap;

  // The card's own fill counts as background here — but only when it clearly is one: a light
  // colour covering a good share of the box. A photo's dominant colour must not become "background".
  const dominant = dominantColour(a, box);
  const distanceToGlobal = Math.sqrt(dominant.colour.reduce((s, c, i) => s + (c - globalBg[i]!) ** 2, 0));
  const localBg = dominant.share >= 0.3 && distanceToGlobal < 120 ? dominant.colour : globalBg;
  const m = boxMask(a, box, localBg, opts.threshold);
  const trimmed = trimToContent(box, m);
  if (!trimmed) return [];
  // Dense boxes are pictures (photos, charts): cutting through them is wrong even if they contain a blank band.
  if (m.ink / (m.w * m.h) > 0.6) return [trimmed];
  const tm = boxMask(a, trimmed, localBg, opts.threshold);
  const rows = new Array<number>(tm.h).fill(0);
  const cols = new Array<number>(tm.w).fill(0);
  for (let y = 0; y < tm.h; y++) {
    for (let x = 0; x < tm.w; x++) {
      if (tm.mask[y * tm.w + x]) {
        rows[y]!++;
        cols[x]!++;
      }
    }
  }
  // Horizontal bands may carry a thin connector (an arrow between stacked figures) and still count
  // as a separator; vertical bands must be truly empty — a sparse column (an axis, an arrow between
  // side-by-side pictures) is part of the diagram, not a gutter.
  const rowGap = widestGap(rows, Math.max(2, Math.round(minGapFrac * a.height)), Math.floor(a.width * 0.02));
  const colGap = widestGap(cols, Math.max(2, Math.round(minGapFrac * a.width)), 0);
  const rowScore = rowGap ? (rowGap.end - rowGap.start + 1) / a.height : 0;
  const colScore = colGap ? (colGap.end - colGap.start + 1) / a.width : 0;
  if (!rowGap && !colGap) return [trimmed];
  if (rowScore >= colScore && rowGap) {
    const upper: Box = { ...trimmed, bottom: trimmed.top + rowGap.start - 1 };
    const lower: Box = { ...trimmed, top: trimmed.top + rowGap.end + 1 };
    return [...xyCut(a, upper, globalBg, opts, depth + 1), ...xyCut(a, lower, globalBg, opts, depth + 1)];
  }
  const leftBox: Box = { ...trimmed, right: trimmed.left + colGap!.start - 1 };
  const rightBox: Box = { ...trimmed, left: trimmed.left + colGap!.end + 1 };
  return [...xyCut(a, leftBox, globalBg, opts, depth + 1), ...xyCut(a, rightBox, globalBg, opts, depth + 1)];
}

/**
 * A short strip (an axis label, a caption, a heading) sitting right above or below a much larger
 * box it lines up with belongs to that box — the XY-cut separated them because a whitespace band
 * ran between, but a chart without its axis labels is not a unit anyone wants to animate alone.
 */
export function absorbLabelStrips(boxes: Box[], width: number, height: number): Box[] {
  const result = boxes.map((b) => ({ ...b }));
  const maxStripH = 0.06 * height;
  const maxGap = 0.04 * height;
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < result.length; i++) {
      const strip = result[i]!;
      const stripH = strip.bottom - strip.top + 1;
      const stripW = strip.right - strip.left + 1;
      if (stripH > maxStripH) continue;
      let host = -1;
      for (let j = 0; j < result.length; j++) {
        if (j === i) continue;
        const other = result[j]!;
        const otherArea = (other.right - other.left + 1) * (other.bottom - other.top + 1);
        if (otherArea < 2 * stripH * stripW) continue;
        const gap = strip.top > other.bottom ? strip.top - other.bottom - 1 : other.top > strip.bottom ? other.top - strip.bottom - 1 : 0;
        if (gap > maxGap) continue;
        const overlap = Math.min(strip.right, other.right) - Math.max(strip.left, other.left) + 1;
        if (overlap < 0.6 * stripW) continue;
        host = j;
        break;
      }
      if (host < 0) continue;
      const other = result[host]!;
      other.left = Math.min(other.left, strip.left);
      other.top = Math.min(other.top, strip.top);
      other.right = Math.max(other.right, strip.right);
      other.bottom = Math.max(other.bottom, strip.bottom);
      result.splice(i, 1);
      changed = true;
      break;
    }
  }
  return result;
}

/**
 * Stage one: content blocks of the picture as page-fraction boxes, top-to-bottom, left-to-right.
 *
 * Coarse first — everything that differs from the page background, closed and merged into blobs —
 * then every blob that is large is cut recursively along its internal whitespace (XY-cut). The
 * coarse pass alone glued a densely laid-out slide into one page-sized blob; the cut pass is what
 * separates its cards, columns and paragraphs again.
 */
export async function detectCutoutCandidates(image: Buffer, options: DetectOptions = {}): Promise<CutoutCandidate[]> {
  const analysisWidth = options.analysisWidth ?? 480;
  const threshold = options.threshold ?? 40;
  const { data, info } = await sharp(image).resize({ width: analysisWidth, withoutEnlargement: false }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const a: Analysis = { data, width, height, channels };
  const bg = estimateBackground(data, width, height, channels);
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    if (colourDistance(data, i * channels, bg) > threshold) mask[i] = 1;
  }
  const radius = Math.max(1, Math.round((options.closeRadius ?? 0.008) * width));
  const closed = dilate(mask, width, height, radius);
  const gap = Math.max(1, Math.round((options.mergeGap ?? 0.01) * width));
  const coarse = mergeBoxes(connectedComponentBoxes(closed, width, height), gap).map((b) => ({
    // Undo the dilation's growth, clamp to the picture.
    left: Math.max(0, b.left + radius),
    top: Math.max(0, b.top + radius),
    right: Math.min(width - 1, b.right - radius),
    bottom: Math.min(height - 1, b.bottom - radius),
  })).filter((b) => b.right >= b.left && b.bottom >= b.top);

  const cutOpts = { threshold, splitMinArea: options.splitMinArea ?? 0.12, minGap: options.minGap ?? 0.015 };
  const boxes = absorbLabelStrips(coarse.flatMap((b) => xyCut(a, b, bg, cutOpts)), width, height);

  const minArea = options.minArea ?? 0.0015;
  const maxArea = options.maxArea ?? 0.85;
  const pad = Math.max(1, Math.round(0.004 * width));
  const regions = boxes
    .map((b) => {
      const left = Math.max(0, b.left - pad);
      const top = Math.max(0, b.top - pad);
      const right = Math.min(width, b.right + pad + 1);
      const bottom = Math.min(height, b.bottom + pad + 1);
      return { x: left / width, y: top / height, w: Math.max(0, right - left) / width, h: Math.max(0, bottom - top) / height };
    })
    .filter((r) => r.w > 0 && r.h > 0)
    .filter((r) => {
      const area = r.w * r.h;
      return area >= minArea && area <= maxArea;
    })
    .map((r) => ({ x: round4(r.x), y: round4(r.y), w: round4(r.w), h: round4(r.h) }))
    .sort((a1, b1) => (Math.abs(a1.y - b1.y) > 0.04 ? a1.y - b1.y : a1.x - b1.x));
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
