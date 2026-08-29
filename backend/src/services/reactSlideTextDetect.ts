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
interface OcrItem { text: string; box: { x: number; y: number; width: number; height: number } }
interface OcrService {
  recognize: (buf: ArrayBuffer, opts?: unknown) => Promise<{ results: OcrItem[] }>;
}
let servicePromise: Promise<OcrService> | null = null;

export class TextDetectionUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TextDetectionUnavailableError';
  }
}

async function getService(): Promise<OcrService> {
  if (!servicePromise) {
    servicePromise = (async () => {
      // Imported lazily: the model files are fetched on first use, so a deck that never asks for
      // detection pays nothing — the same bargain the audio.cpp install makes.
      const { PaddleOcrService } = await import('ppu-paddle-ocr');
      // minimumConfidence 0: the recogniser's default bar drops almost every CJK line, and a box
      // we cannot label is still a box worth offering.
      const service = new PaddleOcrService({
        model: { preset: 'medium' },
        recognition: { minimumConfidence: 0 },
      } as never);
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
  boxes: Array<{ x: number; y: number; width: number; height: number; text?: string }>,
): Array<{ x: number; y: number; width: number; height: number; text: string }> {
  const sorted = [...boxes].sort((a, b) => a.y - b.y || a.x - b.x);
  const out: Array<{ x: number; y: number; width: number; height: number; text: string }> = [];
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
        // The merged box is a paragraph, so its text is its lines joined by the breaks that
        // separate them — the same breaks the extraction reproduces as <br />.
        last.text = `${last.text}\n${box.text ?? ''}`.trim();
        continue;
      }
    }
    out.push({ ...box, text: box.text ?? '' });
    lineHeights.push(box.height);
  }
  return out;
}

/** Detected boxes as canvas percentages — the same shape the extraction endpoint already takes. */
export interface DetectedTextRegion extends SlideRegion {
  /** What the OCR read there — used to label the box in the picker, not to build the slide. */
  text: string;
  /**
   * Whether to start out selected. Narrow boxes are pre-deselected: on a slide they are almost
   * always chart axis labels and page furniture, which belong to the picture rather than being
   * text worth lifting out of it.
   */
  preselected: boolean;
}

/** Below this share of the canvas width, a box is presumed to be a label rather than prose. */
const NARROW_WIDTH_PCT = 4;

export async function detectTextRegions(imagePath: string): Promise<DetectedTextRegion[]> {
  if (!fs.existsSync(imagePath)) return [];
  // Normalised to the canvas so the percentages are computed against the geometry every other part
  // of this feature uses.
  const buffer = await sharp(imagePath)
    .resize(CANVAS_WIDTH, CANVAS_HEIGHT, { fit: 'contain', background: { r: 255, g: 255, b: 255 } })
    .png()
    .toBuffer();

  let boxes: Array<{ x: number; y: number; width: number; height: number; text: string }>;
  try {
    const service = await getService();
    // Recognition as well as detection: the picker labels each box with its first few words, and
    // a box the user cannot read is a box they cannot choose.
    // An ArrayBuffer, not a Buffer: the library treats anything that is neither a string nor an
    // ArrayBuffer as a canvas and calls getContext on it, which a Node Buffer does not have.
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    const { results } = await service.recognize(arrayBuffer as ArrayBuffer, { flatten: true, noCache: true });
    boxes = results.map((item) => ({ ...item.box, text: item.text }));
  } catch (err) {
    logger.warn({ err }, 'react slide: text detection unavailable');
    throw new TextDetectionUnavailableError(
      '文字偵測模型無法啟動（第一次使用需要下載模型，請確認這台機器可以連外）。你仍然可以自己在投影片上拉框。',
    );
  }

  return mergeLineBoxes(boxes)
    .map((box) => {
      const widthPct = (box.width / CANVAS_WIDTH) * 100;
      return {
        xPct: (box.x / CANVAS_WIDTH) * 100,
        yPct: (box.y / CANVAS_HEIGHT) * 100,
        widthPct,
        heightPct: (box.height / CANVAS_HEIGHT) * 100,
        text: box.text,
        preselected: widthPct >= NARROW_WIDTH_PCT,
      };
    })
    // Slivers are detector noise, not text worth lifting.
    .filter((region) => region.widthPct >= 1 && region.heightPct >= 0.8)
    .sort((a, b) => a.yPct - b.yPct || a.xPct - b.xPct);
}
