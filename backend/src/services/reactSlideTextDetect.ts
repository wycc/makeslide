import fs from 'node:fs';
import sharp from 'sharp';
import { logger } from '../logger';
import { CANVAS_HEIGHT, CANVAS_WIDTH, type SlideRegion } from './reactSlideTextExtract';

/**
 * Finding the text on a slide, so the user does not have to draw every box by hand.
 *
 * Uses PP-OCRv6's detection model through ONNX (no Python), rather than asking an LLM where the
 * text is. That is not a close call: on published benchmarks the specialised detector beats the
 * strongest VLM at text localisation by ~39 points, and a box that is off by ten pixels lands
 * directly in the slide's `left`/`top` — nothing downstream corrects it.
 *
 * Detection only, never recognition: reading the text and judging its style already works well
 * (services/reactSlideTextExtract.ts), and running the recogniser here would mean a second answer
 * to the same question.
 */

/** Loaded once and kept: initialisation downloads and compiles the model, which is slow. */
let servicePromise: Promise<{ detect: (buf: Buffer) => Promise<{ boxes: Array<{ x: number; y: number; width: number; height: number }> }> }> | null = null;

export class TextDetectionUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TextDetectionUnavailableError';
  }
}

async function getService(): Promise<{ detect: (buf: Buffer) => Promise<{ boxes: Array<{ x: number; y: number; width: number; height: number }> }> }> {
  if (!servicePromise) {
    servicePromise = (async () => {
      // Imported lazily: the model files are fetched on first use, so a deck that never asks for
      // detection pays nothing — the same bargain the audio.cpp install makes.
      const { PaddleOcrService } = await import('ppu-paddle-ocr');
      const service = new PaddleOcrService({ model: { preset: 'medium' } } as never);
      await service.initialize();
      return service as never;
    })().catch((err) => {
      servicePromise = null;   // let the next request try again rather than caching the failure
      throw err;
    });
  }
  return servicePromise;
}

/** Test seam: drop the cached model between tests. */
export function resetTextDetection(): void {
  servicePromise = null;
}

/**
 * Boxes are merged when they sit on consecutive lines of the same block: same left edge, similar
 * height, and a vertical gap no larger than a line's worth of leading.
 *
 * The detector returns one box per *line*, but a paragraph is what the user means to lift — and
 * the line breaks inside it are what the extraction reproduces with `<br />`. Merging here is what
 * makes "one box, one paragraph" true.
 */
export function mergeLineBoxes(
  boxes: Array<{ x: number; y: number; width: number; height: number }>,
): Array<{ x: number; y: number; width: number; height: number }> {
  const sorted = [...boxes].sort((a, b) => a.y - b.y || a.x - b.x);
  const out: Array<{ x: number; y: number; width: number; height: number }> = [];
  // The height of the *line* last added, kept separately: once two lines merge, the box's height is
  // the paragraph's, and comparing the next line against that would reject every line after the
  // second.
  const lineHeights: number[] = [];
  for (const box of sorted) {
    const last = out[out.length - 1];
    const lineHeight = lineHeights[lineHeights.length - 1] ?? box.height;
    if (last) {
      const gap = box.y - (last.y + last.height);
      const sameLeft = Math.abs(box.x - last.x) <= Math.max(8, lineHeight * 0.4);
      const sameSize = Math.abs(box.height - lineHeight) <= Math.max(6, lineHeight * 0.35);
      // Up to 0.8 of a line height of leading still reads as the same paragraph.
      if (sameLeft && sameSize && gap >= -2 && gap <= lineHeight * 0.8) {
        const right = Math.max(last.x + last.width, box.x + box.width);
        last.width = right - last.x;
        last.height = box.y + box.height - last.y;
        continue;
      }
    }
    out.push({ ...box });
    lineHeights.push(box.height);
  }
  return out;
}

/** Detected boxes as canvas percentages — the same shape the extraction endpoint already takes. */
export async function detectTextRegions(imagePath: string): Promise<SlideRegion[]> {
  if (!fs.existsSync(imagePath)) return [];
  // Normalised to the canvas so the percentages are computed against the geometry every other part
  // of this feature uses.
  const buffer = await sharp(imagePath)
    .resize(CANVAS_WIDTH, CANVAS_HEIGHT, { fit: 'contain', background: { r: 255, g: 255, b: 255 } })
    .png()
    .toBuffer();

  let boxes: Array<{ x: number; y: number; width: number; height: number }>;
  try {
    const service = await getService();
    ({ boxes } = await service.detect(buffer));
  } catch (err) {
    logger.warn({ err }, 'react slide: text detection unavailable');
    throw new TextDetectionUnavailableError(
      '文字偵測模型無法啟動（第一次使用需要下載模型，請確認這台機器可以連外）。你仍然可以自己在投影片上拉框。',
    );
  }

  return mergeLineBoxes(boxes)
    .map((box) => ({
      xPct: (box.x / CANVAS_WIDTH) * 100,
      yPct: (box.y / CANVAS_HEIGHT) * 100,
      widthPct: (box.width / CANVAS_WIDTH) * 100,
      heightPct: (box.height / CANVAS_HEIGHT) * 100,
    }))
    // Slivers are detector noise, not text worth lifting.
    .filter((region) => region.widthPct >= 1 && region.heightPct >= 0.8)
    .sort((a, b) => a.yPct - b.yPct || a.xPct - b.xPct);
}
