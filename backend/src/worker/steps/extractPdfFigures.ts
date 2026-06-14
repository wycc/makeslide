import fs from 'node:fs';
import { createRequire } from 'node:module';
import sharp from 'sharp';
import { logger } from '../../logger';
import {
  figureFilePath,
  figureManifestPath,
  figuresDir,
  sourcePdfPath,
} from '../../services/storage';

// Same workaround as poppler.ts: pdf.js's image-resolution path (used while
// building the operator list) prefers createImageBitmap/ImageDecoder when
// present, returning `.bitmap` objects instead of raw `.data` buffers that
// we can hand to sharp. Removing the APIs forces the raw-data path.
delete (globalThis as Record<string, unknown>).createImageBitmap;
delete (globalThis as Record<string, unknown>).ImageDecoder;

const require = createRequire(import.meta.url);

type Matrix = [number, number, number, number, number, number];

type PdfjsImageObject = {
  width: number;
  height: number;
  kind?: number;
  data?: Uint8Array | Uint8ClampedArray;
  bitmap?: unknown;
};

type PdfjsTextItem = { str?: string; hasEOL?: boolean; transform?: Matrix };

type PdfjsPage = {
  view: [number, number, number, number];
  getOperatorList: () => Promise<{ fnArray: number[]; argsArray: unknown[][] }>;
  getTextContent: () => Promise<{ items: PdfjsTextItem[] }>;
  objs: {
    has: (id: string) => boolean;
    get: (id: string, callback?: (value: unknown) => void) => unknown;
  };
  cleanup?: () => void;
};

type PdfjsDoc = {
  numPages: number;
  getPage: (n: number) => Promise<PdfjsPage>;
  destroy: () => Promise<void>;
};

type PdfjsApi = {
  getDocument: (args: { data: Uint8Array; useSystemFonts?: boolean }) => {
    promise: Promise<PdfjsDoc>;
  };
  OPS: Record<string, number>;
  ImageKind: { GRAYSCALE_1BPP: number; RGB_24BPP: number; RGBA_32BPP: number };
};

let cachedPdfjs: PdfjsApi | null = null;
function loadPdfjs(): PdfjsApi {
  if (cachedPdfjs) return cachedPdfjs;
  const mod = require('pdfjs-dist/legacy/build/pdf.mjs') as unknown;
  const api =
    (mod as { getDocument?: unknown }).getDocument !== undefined
      ? (mod as PdfjsApi)
      : (mod as { default: PdfjsApi }).default;
  if (!api || typeof api.getDocument !== 'function') {
    throw new Error('Failed to load pdfjs-dist legacy build');
  }
  cachedPdfjs = api;
  return api;
}

export interface FigureBBox {
  /** Left edge, percentage of page width (0-1). */
  xPct: number;
  /** Top edge, percentage of page height (0-1), measured from the top. */
  yPct: number;
  widthPct: number;
  heightPct: number;
}

export interface FigureEntry {
  /** Stable id: `p<pageNumber>-<pdfObjectId>`. */
  id: string;
  /** Path relative to storage/<pdfId>/, e.g. "figures/p3-img_p2_1.png". */
  imagePath: string;
  width: number;
  height: number;
  bbox: FigureBBox;
  caption: string | null;
  context: string | null;
}

export interface FigurePageEntry {
  pageNumber: number;
  figures: FigureEntry[];
}

export interface FigureManifest {
  pdfId: string;
  generatedAt: string;
  pages: FigurePageEntry[];
}

export interface ExtractPdfFiguresResult {
  manifest: FigureManifest;
  figureCount: number;
}

// Filters out decorative icons/logos (too small) and full-page background
// scans (too large) while keeping real figures/charts/tables.
const FIGURE_MIN_AREA_PCT = 1;
const FIGURE_MAX_AREA_PCT = 95;
// How close (in PDF user-space points) a text line must be to a figure's
// bounding box to be considered its caption.
const CAPTION_MAX_DISTANCE_PT = 40;
const CAPTION_CONTEXT_LINES = 2;
const OBJECT_RESOLVE_TIMEOUT_MS = 5000;

const CAPTION_RE = /^(Fig(?:ure)?\.?|Table|圖表?|表)\s*\.?\s*\d+/i;

function multiplyMatrix(m1: Matrix, m2: Matrix): Matrix {
  return [
    m1[0] * m2[0] + m1[1] * m2[2],
    m1[0] * m2[1] + m1[1] * m2[3],
    m1[2] * m2[0] + m1[3] * m2[2],
    m1[2] * m2[1] + m1[3] * m2[3],
    m1[4] * m2[0] + m1[5] * m2[2] + m2[4],
    m1[4] * m2[1] + m1[5] * m2[3] + m2[5],
  ];
}

interface PageBBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Maps the unit square (image space) through `m` and returns its bounds in PDF user space. */
function unitSquareBounds(m: Matrix): PageBBox {
  const corners: Array<[number, number]> = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [x, y] of corners) {
    xs.push(x * m[0] + y * m[2] + m[4]);
    ys.push(x * m[1] + y * m[3] + m[5]);
  }
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}

function getPageObject(page: PdfjsPage, id: string, timeoutMs: number): Promise<unknown | null> {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        resolve(null);
      }
    }, timeoutMs);
    page.objs.get(id, (value: unknown) => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        resolve(value);
      }
    });
  });
}

function unpack1bppToGray8(data: Uint8Array, width: number, height: number): Buffer {
  const rowBytes = Math.ceil(width / 8);
  const out = Buffer.alloc(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const byte = data[y * rowBytes + (x >> 3)] ?? 0;
      const bit = (byte >> (7 - (x & 7))) & 1;
      out[y * width + x] = bit ? 255 : 0;
    }
  }
  return out;
}

interface TextLine {
  text: string;
  /** y position (PDF user space, origin bottom-left) of the line's first item. */
  y: number;
}

function collectTextLines(items: PdfjsTextItem[]): TextLine[] {
  const lines: TextLine[] = [];
  let buf = '';
  let bufY: number | null = null;
  for (const item of items) {
    const s = typeof item.str === 'string' ? item.str : '';
    if (bufY === null && item.transform) bufY = item.transform[5];
    buf += s;
    if (item.hasEOL) {
      const text = buf.trim();
      if (text) lines.push({ text, y: bufY ?? 0 });
      buf = '';
      bufY = null;
    }
  }
  const text = buf.trim();
  if (text) lines.push({ text, y: bufY ?? 0 });
  return lines;
}

/** Finds the closest caption-like line to `bbox` and a short context blurb following it. */
function findCaption(lines: TextLine[], bbox: PageBBox): { caption: string; context: string } | null {
  let bestIndex = -1;
  let bestDistance = Infinity;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!CAPTION_RE.test(line.text)) continue;
    let distance: number;
    if (line.y < bbox.y0) {
      distance = bbox.y0 - line.y;
    } else if (line.y > bbox.y1) {
      distance = line.y - bbox.y1;
    } else {
      distance = 0;
    }
    if (distance <= CAPTION_MAX_DISTANCE_PT && distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
    }
  }
  if (bestIndex === -1) return null;

  const captionLine = lines[bestIndex]!.text;
  const extra: string[] = [];
  for (let i = bestIndex + 1; i < lines.length && extra.length < CAPTION_CONTEXT_LINES; i++) {
    const next = lines[i]!;
    if (CAPTION_RE.test(next.text)) break;
    extra.push(next.text);
  }
  return { caption: captionLine, context: [captionLine, ...extra].join(' ') };
}

/**
 * Extracts embedded figures (charts, photos, diagrams) from a PDF, together
 * with their on-page position and any nearby caption text, into
 * `storage/<pdfId>/figures.json` + `storage/<pdfId>/figures/*.png`.
 *
 * Idempotent: if `figures.json` already exists, it is returned as-is.
 */
export async function extractPdfFigures(pdfId: string, pageCount: number): Promise<ExtractPdfFiguresResult> {
  const manifestPath = figureManifestPath(pdfId);
  if (fs.existsSync(manifestPath)) {
    const existing = JSON.parse(await fs.promises.readFile(manifestPath, 'utf8')) as FigureManifest;
    const figureCount = existing.pages.reduce((sum, p) => sum + p.figures.length, 0);
    return { manifest: existing, figureCount };
  }

  const pdfjs = loadPdfjs();
  const { OPS, ImageKind } = pdfjs;
  const data = await fs.promises.readFile(sourcePdfPath(pdfId));
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data), useSystemFonts: true }).promise;

  const pages: FigurePageEntry[] = [];
  let figureCount = 0;

  try {
    const limit = Math.min(doc.numPages, pageCount);
    for (let pageNumber = 1; pageNumber <= limit; pageNumber++) {
      const page = await doc.getPage(pageNumber);
      const figures: FigureEntry[] = [];
      try {
        const [vx0, vy0, vx1, vy1] = page.view;
        const pageWidth = vx1 - vx0;
        const pageHeight = vy1 - vy0;
        const opList = await page.getOperatorList();

        // Skip op 0: pdf.js prepends a viewport-flip transform that is not
        // part of the actual content stream. Tracking starts from identity.
        let ctm: Matrix = [1, 0, 0, 1, 0, 0];
        const stack: Matrix[] = [];
        const seenIds = new Set<string>();
        const candidates: Array<{ id: string; bbox: PageBBox }> = [];

        for (let i = 1; i < opList.fnArray.length; i++) {
          const fn = opList.fnArray[i];
          const args = opList.argsArray[i] as unknown[];
          if (fn === OPS.save) {
            stack.push(ctm);
          } else if (fn === OPS.restore) {
            ctm = stack.pop() ?? ctm;
          } else if (fn === OPS.transform) {
            ctm = multiplyMatrix(args as Matrix, ctm);
          } else if (fn === OPS.paintImageXObject) {
            const id = args[0] as string;
            if (seenIds.has(id)) continue;
            seenIds.add(id);
            candidates.push({ id, bbox: unitSquareBounds(ctm) });
          }
        }

        if (candidates.length > 0) {
          const content = await page.getTextContent();
          const lines = collectTextLines(content.items);

          for (const candidate of candidates) {
            const b = candidate.bbox;
            const widthPct = (b.x1 - b.x0) / pageWidth;
            const heightPct = (b.y1 - b.y0) / pageHeight;
            const areaPct = widthPct * heightPct * 100;
            if (areaPct < FIGURE_MIN_AREA_PCT || areaPct > FIGURE_MAX_AREA_PCT) continue;

            try {
              const obj = (await getPageObject(page, candidate.id, OBJECT_RESOLVE_TIMEOUT_MS)) as PdfjsImageObject | null;
              if (!obj || !obj.data) {
                logger.warn({ pdfId, pageNumber, objId: candidate.id }, 'extractPdfFigures: skip image without raw pixel data');
                continue;
              }

              let raw: Buffer;
              let channels: 1 | 3 | 4;
              if (obj.kind === ImageKind.RGBA_32BPP) {
                raw = Buffer.from(obj.data);
                channels = 4;
              } else if (obj.kind === ImageKind.RGB_24BPP) {
                raw = Buffer.from(obj.data);
                channels = 3;
              } else if (obj.kind === ImageKind.GRAYSCALE_1BPP) {
                raw = unpack1bppToGray8(obj.data as Uint8Array, obj.width, obj.height);
                channels = 1;
              } else {
                logger.warn({ pdfId, pageNumber, objId: candidate.id, kind: obj.kind }, 'extractPdfFigures: skip image with unsupported pixel kind');
                continue;
              }

              const filename = `p${pageNumber}-${candidate.id}.png`;
              await fs.promises.mkdir(figuresDir(pdfId), { recursive: true });
              await sharp(raw, { raw: { width: obj.width, height: obj.height, channels } })
                .png()
                .toFile(figureFilePath(pdfId, filename));

              const match = findCaption(lines, b);
              figures.push({
                id: `p${pageNumber}-${candidate.id}`,
                imagePath: `figures/${filename}`,
                width: obj.width,
                height: obj.height,
                bbox: {
                  xPct: (b.x0 - vx0) / pageWidth,
                  yPct: (vy1 - b.y1) / pageHeight,
                  widthPct,
                  heightPct,
                },
                caption: match?.caption ?? null,
                context: match?.context ?? null,
              });
              figureCount++;
            } catch (err) {
              logger.warn({ pdfId, pageNumber, objId: candidate.id, err }, 'extractPdfFigures: failed to extract image, skipping');
            }
          }
        }
      } finally {
        page.cleanup?.();
      }
      pages.push({ pageNumber, figures });
    }

    for (let pageNumber = limit + 1; pageNumber <= pageCount; pageNumber++) {
      pages.push({ pageNumber, figures: [] });
    }
  } finally {
    await doc.destroy().catch(() => undefined);
  }

  const manifest: FigureManifest = {
    pdfId,
    generatedAt: new Date().toISOString(),
    pages,
  };
  await fs.promises.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  logger.info({ pdfId, pageCount, figureCount }, 'Extracted PDF figures');
  return { manifest, figureCount };
}
