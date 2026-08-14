import fs from 'node:fs';
import sharp from 'sharp';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { callChatJSON } from './openai';
import {
  MAX_TEXT_LAYER_FONT_PX,
  MIN_TEXT_LAYER_FONT_PX,
  TEXT_LAYER_FONTS,
  type ReactSlideTextLayer,
} from './reactSlide';

/**
 * Lifting text out of a slide's background image (docs/react-slide-image-to-text.md §3).
 *
 * A page converted from a PDF has its text as *pixels*: changing one word means redrawing the
 * whole picture. Extraction turns a selected region into real text — editable, themeable, sharp at
 * any resolution — and erases those pixels from the background so the words are not drawn twice.
 *
 * The two halves are deliberately separable: recognition is fast and cheap and produces something
 * useful on its own, while erasure is a generative image call that is slow, costs money and can
 * fail. Callers run recognition first and treat erasure as best-effort.
 */

/** The canvas everything is measured against. */
const CANVAS_WIDTH = 1920;
const CANVAS_HEIGHT = 1080;

/** Region of the slide, in canvas percentages (same convention as focus effects). */
export interface SlideRegion {
  xPct: number;
  yPct: number;
  widthPct: number;
  heightPct: number;
}

export const SlideRegionSchema = z.object({
  xPct: z.number().min(0).max(100),
  yPct: z.number().min(0).max(100),
  widthPct: z.number().min(1).max(100),
  heightPct: z.number().min(1).max(100),
});

/** What the vision model is asked for. Narrow on purpose: every field maps to one CSS property. */
const ExtractedTextSchema = z.object({
  text: z.string(),
  fontSizePx: z.number(),
  color: z.string(),
  fontWeight: z.number(),
  fontFamily: z.enum(TEXT_LAYER_FONTS),
  textAlign: z.enum(['left', 'center', 'right']),
  lineHeight: z.number(),
});
export type ExtractedText = z.infer<typeof ExtractedTextSchema>;

/**
 * Keep the model's font size inside what the region can actually hold.
 *
 * Vision models estimate type size poorly, and the failure is asymmetric: too large and the text
 * overflows onto whatever is beside it (and gets clipped), too small and there is merely more
 * whitespace than there should be — which the user can fix with one control. So the estimate is
 * capped by the region's own geometry: its height divided by the number of lines it must hold.
 */
export function clampExtractedFontSize(
  rawFontSizePx: number,
  regionHeightPx: number,
  lineCount: number,
  lineHeight: number,
): number {
  const lines = Math.max(1, lineCount);
  const safeLineHeight = Number.isFinite(lineHeight) && lineHeight > 0 ? lineHeight : 1.2;
  // 1.05 leaves a sliver of tolerance: exactly-fitting text still clips on some fonts' descenders.
  const geometricMax = regionHeightPx / lines / safeLineHeight * 1.05;
  const candidate = Number.isFinite(rawFontSizePx) && rawFontSizePx > 0 ? rawFontSizePx : geometricMax;
  return Math.round(
    Math.min(MAX_TEXT_LAYER_FONT_PX, Math.max(MIN_TEXT_LAYER_FONT_PX, Math.min(candidate, geometricMax))),
  );
}

/** Normalize a colour the model returned into `#rrggbb`, falling back to the theme's foreground. */
export function normalizeExtractedColor(raw: string, fallback: string): string {
  const value = (raw ?? '').trim();
  if (/^#[0-9a-f]{6}$/i.test(value)) return value.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(value)) {
    const [r, g, b] = value.slice(1).split('');
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(value);
  if (rgb) {
    const hex = (part: string | undefined): string =>
      Math.max(0, Math.min(255, Number(part))).toString(16).padStart(2, '0');
    return `#${hex(rgb[1])}${hex(rgb[2])}${hex(rgb[3])}`;
  }
  return fallback;
}

/**
 * Messages for the recognition call.
 *
 * Only the cropped region is sent, not the whole page: the model has one job here, and small text
 * is recognised far more reliably when it fills the image. The region's real pixel size goes in the
 * prompt because font size is meaningless without it — the model cannot know the crop's scale.
 */
export function buildExtractTextMessages(
  regionDataUrl: string,
  regionWidthPx: number,
  regionHeightPx: number,
): ChatCompletionMessageParam[] {
  return [
    {
      role: 'system',
      content: [
        '你是一位簡報排版分析員。使用者會給你一張「投影片局部區域」的圖片，請把裡面的文字與它的排版樣式辨識出來。',
        '只回傳 JSON：{"text","fontSizePx","color","fontWeight","fontFamily","textAlign","lineHeight"}。',
        'text：區域內的文字，保留換行（用 \\n）；沒有文字就回空字串。不要加任何說明或標點修飾。',
        'fontSizePx：文字的字級，單位是這張圖片的像素（圖片尺寸會告訴你）。請以「大寫字母的高度約為字級的 0.7 倍」估算。',
        'color：文字顏色，#rrggbb。',
        'fontWeight：100~900 的整數（一般 400、粗體 700）。',
        'fontFamily：只能是 heading（標題用的無襯線）、body（內文）、mono（等寬）三者之一。',
        'textAlign：left / center / right。',
        'lineHeight：行高與字級的比值，通常 1.0~1.8；單行文字回 1.2。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: `這張圖片是投影片上的一塊區域，實際尺寸為 ${Math.round(regionWidthPx)}×${Math.round(regionHeightPx)} 像素（投影片整體為 ${CANVAS_WIDTH}×${CANVAS_HEIGHT}）。請辨識其中的文字與樣式。`,
        },
        { type: 'image_url', image_url: { url: regionDataUrl, detail: 'high' } },
      ] as never,
    },
  ];
}

/** Region in canvas pixels, clamped to the canvas so a crop can never fall outside the image. */
export function regionToPixels(region: SlideRegion): { left: number; top: number; width: number; height: number } {
  const left = Math.max(0, Math.min(CANVAS_WIDTH - 1, Math.round((region.xPct / 100) * CANVAS_WIDTH)));
  const top = Math.max(0, Math.min(CANVAS_HEIGHT - 1, Math.round((region.yPct / 100) * CANVAS_HEIGHT)));
  const width = Math.max(1, Math.min(CANVAS_WIDTH - left, Math.round((region.widthPct / 100) * CANVAS_WIDTH)));
  const height = Math.max(1, Math.min(CANVAS_HEIGHT - top, Math.round((region.heightPct / 100) * CANVAS_HEIGHT)));
  return { left, top, width, height };
}

/**
 * Crop the region out of `sourcePath` as a PNG data URL, normalising the source to the canvas size
 * first so the crop maths is the same regardless of what the stored image happens to be.
 */
export async function cropRegionDataUrl(sourcePath: string, region: SlideRegion): Promise<string> {
  const box = regionToPixels(region);
  const buffer = await sharp(sourcePath)
    .resize(CANVAS_WIDTH, CANVAS_HEIGHT, { fit: 'contain', background: { r: 255, g: 255, b: 255 } })
    .extract(box)
    .png()
    .toBuffer();
  return `data:image/png;base64,${buffer.toString('base64')}`;
}

export interface ExtractTextResult {
  layer: ReactSlideTextLayer;
  /** Raw model output, kept for logging when a result looks wrong. */
  raw: ExtractedText;
}

/**
 * Recognise the text in `region` and turn it into a layer positioned exactly over it.
 *
 * Returns null when the region holds no text — a user who selects an empty area should get "no
 * text found", not an empty box they then have to delete.
 */
export async function extractTextFromRegion(
  sourcePath: string,
  region: SlideRegion,
  fallbackColor: string,
): Promise<ExtractTextResult | null> {
  const box = regionToPixels(region);
  const dataUrl = await cropRegionDataUrl(sourcePath, region);
  const result = await callChatJSON({
    label: 'extract_slide_text',
    schema: ExtractedTextSchema,
    maxTokens: 1500,
    temperature: 0.1,
    messages: buildExtractTextMessages(dataUrl, box.width, box.height),
  });
  const text = result.data.text.trim();
  if (!text) return null;

  const lineHeight = Math.min(3, Math.max(0.8, result.data.lineHeight || 1.2));
  const layer: ReactSlideTextLayer = {
    id: nanoid(8),
    xPct: region.xPct,
    yPct: region.yPct,
    widthPct: region.widthPct,
    heightPct: region.heightPct,
    text,
    fontSizePx: clampExtractedFontSize(result.data.fontSizePx, box.height, text.split('\n').length, lineHeight),
    color: normalizeExtractedColor(result.data.color, fallbackColor),
    fontWeight: Math.round(Math.min(900, Math.max(100, result.data.fontWeight || 400))),
    fontFamily: result.data.fontFamily,
    textAlign: result.data.textAlign,
    lineHeight,
    extractedAt: new Date().toISOString(),
  };
  return { layer, raw: result.data };
}

/**
 * A mask for `images.edit`: the region transparent (repaint this), everything else opaque (leave
 * it alone). Built at the size the image API expects so the two line up pixel for pixel.
 */
export async function buildRegionMask(region: SlideRegion, width = 1536, height = 1024): Promise<Buffer> {
  const scaleX = width / CANVAS_WIDTH;
  const scaleY = height / CANVAS_HEIGHT;
  const box = regionToPixels(region);
  const hole = {
    left: Math.round(box.left * scaleX),
    top: Math.round(box.top * scaleY),
    width: Math.max(1, Math.round(box.width * scaleX)),
    height: Math.max(1, Math.round(box.height * scaleY)),
  };
  // `dest-out` subtracts the *source's* alpha from the destination, so the stamp has to be opaque:
  // an already-transparent stamp removes nothing and the mask ends up with no hole at all.
  const holeStamp = await sharp({
    create: { width: hole.width, height: hole.height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
  })
    .png()
    .toBuffer();
  return await sharp({
    create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
  })
    .composite([{ input: holeStamp, left: hole.left, top: hole.top, blend: 'dest-out' }])
    .png()
    .toBuffer();
}

/** Instruction for the erase pass. Explicit about *not* inventing content: the region must read as background. */
export const ERASE_TEXT_PROMPT = [
  'Remove all text from the masked region.',
  'Continue the surrounding background exactly: same colours, gradient, pattern and noise.',
  'Do not draw any text, letters, numbers, shapes, icons or objects in that area — it must look like empty background.',
].join(' ');

/** True when the file exists and can be decoded, i.e. there is actually something to erase from. */
export async function isUsableImage(filePath: string): Promise<boolean> {
  try {
    if (!fs.existsSync(filePath)) return false;
    const meta = await sharp(filePath).metadata();
    return Boolean(meta.format);
  } catch {
    return false;
  }
}

/**
 * The recognised block's placement and typography, as CSS properties.
 *
 * Mirrors what `textLayerCss` produced for the old separate layer, but as a property map so it can
 * be written into a JSX `style` object — the same escaping and whitelist path as every other edit.
 * The font is a theme role, never a literal family: the sandbox cannot load an outside font, and
 * this is what keeps lifted text following the deck's theme.
 */
export function textLayerStyleProperties(layer: ReactSlideTextLayer): Record<string, string> {
  return {
    position: 'absolute',
    left: `${layer.xPct}%`,
    top: `${layer.yPct}%`,
    width: `${layer.widthPct}%`,
    height: `${layer.heightPct}%`,
    'font-size': `${layer.fontSizePx}px`,
    'line-height': String(layer.lineHeight),
    'font-weight': String(layer.fontWeight),
    'font-family': `var(--slide-font-${layer.fontFamily})`,
    color: layer.color,
    'text-align': layer.textAlign,
    'white-space': 'pre-wrap',
    overflow: 'hidden',
  };
}
