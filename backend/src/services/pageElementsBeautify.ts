/**
 * Beautifying a page that already has an element layer (docs/page-elements.md §10).
 *
 * Two steps, either of which can be used alone: paint a new background under the elements, and
 * move the elements onto it. What makes this different from "redraw the page with AI" (which fuses
 * the elements into pixels) is that nothing is flattened — the background becomes the page's base
 * image and the elements stay elements, still draggable, still editable text.
 *
 * The model is only ever allowed to move and resize. Text, element kind, asset, font family and
 * the rest are copied from the element that was already there: a layout pass that silently
 * rewrote someone's words would be a much worse bug than a badly placed box.
 */
import sharp from 'sharp';
import { z } from 'zod';
import type { ChatCompletionContentPart } from 'openai/resources/chat/completions';
import { config } from '../config';
import { logger } from '../logger';
import { callChatJSON } from './openai';
import { isElementColor, MAX_PAGE_ELEMENTS, type PageElement } from './pageElements';

/** The element schema's own font range; a number outside it is not a smaller font, it is noise. */
const MIN_FONT_SIZE = 8;
const MAX_FONT_SIZE = 400;

export interface ElementLayoutProposal {
  id: string;
  xPct?: number;
  yPct?: number;
  widthPct?: number;
  heightPct?: number;
  fontSize?: number;
  color?: string;
}

export const ElementLayoutResponseSchema = z.object({
  layout: z
    .array(
      z.object({
        id: z.string().max(64),
        xPct: z.number().optional(),
        yPct: z.number().optional(),
        widthPct: z.number().optional(),
        heightPct: z.number().optional(),
        fontSize: z.number().optional(),
        color: z.string().max(32).optional(),
        reason: z.string().max(300).optional(),
      }),
    )
    .max(MAX_PAGE_ELEMENTS),
});

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const round = (v: number): number => Math.round(v * 10000) / 10000;
/**
 * A position is clamped, a size is not.
 *
 * Asking for x = -5 is a legible intent ("against the left edge") and pinning it to the edge does
 * what was meant. A width of 0 or a font size of -20 means nothing at all, and clamping it to the
 * smallest legal value would hand back an element too small to find, so a size out of range is
 * dropped and the element keeps the one it had.
 */
const position = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const size = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 100 ? v : null;
const fontSize = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= MIN_FONT_SIZE && v <= MAX_FONT_SIZE ? v : null;

/**
 * Applies what the model proposed, one element at a time.
 *
 * Everything is a fallback to the element as it stands: an id that matches nothing is ignored, an
 * element the model forgot keeps its place, and a number that makes no sense is dropped on its own
 * rather than throwing the whole page's layout away. Percentages (0–100, how the model is asked to
 * answer) become the fractions the element layer stores.
 */
export function applyElementLayout(
  elements: PageElement[],
  proposals: ElementLayoutProposal[],
): { elements: PageElement[]; moved: string[] } {
  const byId = new Map<string, ElementLayoutProposal>();
  for (const p of proposals) if (p.id && !byId.has(p.id)) byId.set(p.id, p);
  const moved: string[] = [];
  const next = elements.map((el) => {
    const p = byId.get(el.id);
    // A line is two page points rather than a box, and dragging its ends is the only sensible way
    // to move it: leave lines exactly where the user drew them.
    if (!p || el.type === 'line') return el;
    const proposedW = size(p.widthPct);
    const proposedH = size(p.heightPct);
    const w = clamp(proposedW != null ? proposedW / 100 : el.w, 0, 1);
    const h = clamp(proposedH != null ? proposedH / 100 : el.h, 0, 1);
    const proposedX = position(p.xPct);
    const proposedY = position(p.yPct);
    const x = clamp(proposedX != null ? proposedX / 100 : el.x, 0, 1 - w);
    const y = clamp(proposedY != null ? proposedY / 100 : el.y, 0, 1 - h);
    const box = { x: round(x), y: round(y), w: round(w), h: round(h) };
    let updated: PageElement = { ...el, ...box };
    if (el.type === 'text') {
      const font = fontSize(p.fontSize);
      const color = typeof p.color === 'string' && isElementColor(p.color) ? p.color : null;
      updated = {
        ...updated,
        ...(font != null ? { fontSize: Math.round(font) } : {}),
        ...(color ? { color } : {}),
      } as PageElement;
    }
    if (JSON.stringify(updated) !== JSON.stringify(el)) moved.push(el.id);
    return updated;
  });
  return { elements: next, moved };
}

/** Perceived brightness of an sRGB colour, 0 (black) – 255 (white). `null` when it cannot be read. */
export function colorLuminance(color: string): number | null {
  const hex = /^#([0-9a-fA-F]{6})/.exec(color);
  if (hex) {
    const v = parseInt(hex[1]!, 16);
    return 0.299 * ((v >> 16) & 255) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255);
  }
  const rgba = /^rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/.exec(color);
  if (rgba) return 0.299 * Number(rgba[1]) + 0.587 * Number(rgba[2]) + 0.114 * Number(rgba[3]);
  return null;
}

/** Ink that can be read on this background: the existing colour when it contrasts, else black or white. */
export function readableTextColor(backgroundLuminance: number, color: string): string {
  const own = colorLuminance(color);
  if (own != null && Math.abs(own - backgroundLuminance) >= 90) return color;
  return backgroundLuminance >= 128 ? '#111111' : '#f8fafc';
}

/**
 * Repaints text that the new background swallowed.
 *
 * A dark photo under dark text is the one way this feature can leave a page *worse* than it found
 * it, and it is invisible in the JSON — only the picture underneath knows. So the check reads the
 * background where each text box actually sits.
 */
export async function ensureReadableText(baseImage: Buffer, elements: PageElement[]): Promise<PageElement[]> {
  const meta = await sharp(baseImage).metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  if (!W || !H) return elements;
  const out: PageElement[] = [];
  for (const el of elements) {
    if (el.type !== 'text') {
      out.push(el);
      continue;
    }
    try {
      const left = Math.max(0, Math.min(W - 1, Math.round(el.x * W)));
      const top = Math.max(0, Math.min(H - 1, Math.round(el.y * H)));
      const width = Math.max(1, Math.min(W - left, Math.round(el.w * W)));
      const height = Math.max(1, Math.min(H - top, Math.round(el.h * H)));
      const { channels } = await sharp(baseImage).extract({ left, top, width, height }).stats();
      const [r, g, b] = channels;
      const luminance = 0.299 * (r?.mean ?? 255) + 0.587 * (g?.mean ?? 255) + 0.114 * (b?.mean ?? 255);
      out.push({ ...el, color: readableTextColor(luminance, el.color) });
    } catch {
      out.push(el);
    }
  }
  return out;
}

/** What the page says, in the order it says it — the context a background has to leave room for. */
export function describeElements(elements: PageElement[]): string {
  return elements
    .map((el) => {
      const where = el.type === 'line'
        ? `line ${(el.x1 * 100).toFixed(0)},${(el.y1 * 100).toFixed(0)} → ${(el.x2 * 100).toFixed(0)},${(el.y2 * 100).toFixed(0)}`
        : `x ${(el.x * 100).toFixed(0)}, y ${(el.y * 100).toFixed(0)}, w ${(el.w * 100).toFixed(0)}, h ${(el.h * 100).toFixed(0)}`;
      if (el.type === 'text') {
        const text = el.text.replace(/\s+/g, ' ').trim().slice(0, 160);
        return `- id "${el.id}" text (font size ${el.fontSize}, colour ${el.color}) at ${where}: ${text}`;
      }
      if (el.type === 'image') return `- id "${el.id}" picture at ${where}`;
      if (el.type === 'shape') return `- id "${el.id}" ${el.shape} at ${where}`;
      return `- id "${el.id}" ${where}`;
    })
    .join('\n');
}

/** The prompt for the background image. It must be a backdrop, never the slide itself. */
export function buildBackgroundPrompt(instruction: string, elements: PageElement[]): string {
  const words = elements
    .filter((el): el is Extract<PageElement, { type: 'text' }> => el.type === 'text')
    .map((el) => el.text.replace(/\s+/g, ' ').trim())
    .join(' ')
    .slice(0, 400);
  return [
    'A background for one 16:9 presentation slide.',
    'Absolutely no text, letters, numbers, logos or watermarks anywhere in the image — the slide\'s words are drawn on top of it afterwards and must stay readable.',
    'Keep the middle and upper-left calm and low-contrast (that is where the text sits); any illustration, texture or colour should live around the edges.',
    instruction.trim() ? `Style asked for: ${instruction.trim()}` : 'Style: clean, modern, professional, subtle.',
    words ? `The slide is about: ${words}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function systemPrompt(): string {
  return [
    'You lay out the elements of a presentation slide on a new background image.',
    'You receive the background picture (no text on it) and the list of elements that go on top: their id, kind, current box, and for text its words, font size and colour.',
    'For each element answer with where it should sit, as percentages of the slide: "xPct", "yPct" (top-left corner), "widthPct", "heightPct". For text you may also give "fontSize" (pixels on a 1080-tall slide) and "color" (#rrggbb).',
    'Rules: keep every element fully inside the slide; never overlap two elements; keep the reading order the boxes already imply (a title stays above its bullets); leave a margin of at least 4% from every edge; place elements over the calm parts of the background, not over its busiest area; make text large enough to read from the back of a room, and choose a colour that contrasts with the background right under it.',
    'You must not change what an element says, what kind it is, or which picture it shows — only where it sits, how big it is, and for text its size and colour.',
    'Answer with JSON only: {"layout":[{"id":"abc","xPct":8,"yPct":6,"widthPct":84,"heightPct":18,"fontSize":64,"color":"#111111"}]}. One entry per element, using the ids you were given.',
  ].join('\n');
}

export interface ElementLayoutInput {
  /** The background the elements will sit on (the new base image). */
  background: Buffer;
  canvas: { width: number; height: number };
  elements: PageElement[];
  /** The user's own wish for this page, if they wrote one. */
  instruction: string;
}

/** Asks the configured vision model where the elements should go. Throws; the caller falls back. */
export async function proposeElementLayout(input: ElementLayoutInput): Promise<ElementLayoutProposal[]> {
  const jpeg = await sharp(input.background)
    .resize({ width: config.openaiScriptImageMaxWidth, withoutEnlargement: true, fit: 'inside' })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
  const parts: ChatCompletionContentPart[] = [
    { type: 'text', text: `The background, ${input.canvas.width}×${input.canvas.height}:` },
    { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${jpeg.toString('base64')}`, detail: 'high' } },
    { type: 'text', text: `The elements, with the boxes they have now (percentages of the slide):\n${describeElements(input.elements)}` },
  ];
  if (input.instruction.trim()) {
    parts.push({ type: 'text', text: `What the user asked for: ${input.instruction.trim()}` });
  }
  const result = await callChatJSON({
    label: 'element-layout',
    schema: ElementLayoutResponseSchema,
    maxTokens: 2000,
    temperature: 0.2,
    messages: [
      { role: 'system', content: systemPrompt() },
      { role: 'user', content: parts },
    ],
  });
  logger.info({ proposals: result.data.layout.length, elements: input.elements.length }, 'pageElementsBeautify: model answered');
  return result.data.layout;
}
