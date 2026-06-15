import fs from 'node:fs';
import { createRequire } from 'node:module';
import { createCanvas } from 'canvas';
import sharp from 'sharp';
import { logger } from '../../logger';
import { NodeCanvasFactory } from '../poppler';
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

type PdfjsViewport = { width: number; height: number };

type PdfjsPage = {
  view: [number, number, number, number];
  getOperatorList: () => Promise<{ fnArray: number[]; argsArray: unknown[][] }>;
  getTextContent: () => Promise<{ items: PdfjsTextItem[] }>;
  getViewport: (params: { scale: number }) => PdfjsViewport;
  render: (params: { canvasContext: unknown; viewport: PdfjsViewport }) => { promise: Promise<void> };
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
  getDocument: (args: { data: Uint8Array; useSystemFonts?: boolean; CanvasFactory?: unknown }) => {
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
  /** Stable id: `p<pageNumber>-<pdfObjectId>` (raster) or `p<pageNumber>-vec<n>` (vector region). */
  id: string;
  /** Path relative to storage/<pdfId>/, e.g. "figures/p3-img_p2_1.png". */
  imagePath: string;
  width: number;
  height: number;
  bbox: FigureBBox;
  caption: string | null;
  context: string | null;
  /** How the image was produced: an embedded raster XObject, or a cropped render of a vector-drawn region. */
  source?: 'raster' | 'vector';
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

// Matches "Figure N:" / "Table N:" / "圖N：" etc. anywhere within a line, not
// just at its start - multi-panel figures often place the caption text on the
// same content-stream line as trailing axis labels or sub-panel markers (e.g.
// "(a) (b)Figure 2: ..." or "40KFigure 6: ..."), so the caption text rarely
// begins at index 0. Requiring a trailing colon (the separator used by every
// real caption header in practice) distinguishes the caption itself from a
// mid-sentence reference such as "Fig. 11 and analytically described..." or
// "...shown in Fig. 17." (sentence-ending period, not a caption).
const CAPTION_RE = /(Fig(?:ure)?\.?|Table|圖表?|表)\s*\.?\s*\d+\s*[:：]/i;

// ---------------------------------------------------------------------------
// V2: vector figure extraction (design doc §12)
// ---------------------------------------------------------------------------

// Minimum number of `constructPath` ops a clustered region must contain to be
// considered a chart/diagram rather than table borders, underlines, etc.
const VECTOR_FIGURE_MIN_PATHS = 20;
// Padding (PDF points) applied to each path bbox before union-find clustering.
const VECTOR_CLUSTER_PAD_PT = 5;
// Horizontal gap between adjacent same-row candidates, as a fraction of the
// row's average candidate width, beyond which they are treated as separate
// figure groups.
const GROUP_X_GAP_RATIO = 0.2;
// If a raster candidate and a vector cluster overlap by more than this IoU,
// treat them as the same region (merge bboxes) instead of emitting both.
const RASTER_VECTOR_IOU_MERGE_THRESHOLD = 0.5;
// If a raster candidate sits almost entirely inside a vector cluster's bbox
// (e.g. a heatmap/photo embedded within a larger chart's axes), it is already
// part of that figure's full-page crop - merge it in rather than emitting it
// again as a separate, duplicate figure.
const RASTER_VECTOR_CONTAINMENT_MERGE_THRESHOLD = 0.9;
// A raster candidate is a candidate for occlusion-filtering if a later-drawn
// candidate covers at least this fraction of its area.
const OCCLUDED_RASTER_OVERLAP_THRESHOLD = 0.5;
// Mean per-channel (0-255) absolute pixel difference between a raster
// candidate's own pixels and the corresponding region of the fully rendered
// page, above which the raster is considered invisible (painted over) and
// excluded from the output.
const OCCLUDED_RASTER_DIFF_THRESHOLD = 60;
// DPI used when rendering a full page to crop out vector-drawn figure regions.
const FIGURE_RENDER_DPI = 150;

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

/** Maps a bbox (in pre-CTM space) through `m` and returns its bounds in PDF user space. */
function bboxBounds(bbox: [number, number, number, number], m: Matrix): PageBBox {
  const corners: Array<[number, number]> = [
    [bbox[0], bbox[1]],
    [bbox[2], bbox[1]],
    [bbox[2], bbox[3]],
    [bbox[0], bbox[3]],
  ];
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [x, y] of corners) {
    xs.push(x * m[0] + y * m[2] + m[4]);
    ys.push(x * m[1] + y * m[3] + m[5]);
  }
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}

/** Maps the unit square (image space) through `m` and returns its bounds in PDF user space. */
function unitSquareBounds(m: Matrix): PageBBox {
  return bboxBounds([0, 0, 1, 1], m);
}

function bboxArea(b: PageBBox): number {
  return Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);
}

function bboxIntersectionArea(a: PageBBox, b: PageBBox): number {
  const x0 = Math.max(a.x0, b.x0);
  const x1 = Math.min(a.x1, b.x1);
  const y0 = Math.max(a.y0, b.y0);
  const y1 = Math.min(a.y1, b.y1);
  if (x1 <= x0 || y1 <= y0) return 0;
  return (x1 - x0) * (y1 - y0);
}

function bboxUnion(a: PageBBox, b: PageBBox): PageBBox {
  return {
    x0: Math.min(a.x0, b.x0),
    y0: Math.min(a.y0, b.y0),
    x1: Math.max(a.x1, b.x1),
    y1: Math.max(a.y1, b.y1),
  };
}

function bboxIoU(a: PageBBox, b: PageBBox): number {
  const inter = bboxIntersectionArea(a, b);
  if (inter <= 0) return 0;
  const union = bboxArea(a) + bboxArea(b) - inter;
  return union <= 0 ? 0 : inter / union;
}

function unionPageBBox(boxes: PageBBox[]): PageBBox {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const b of boxes) {
    if (b.x0 < x0) x0 = b.x0;
    if (b.y0 < y0) y0 = b.y0;
    if (b.x1 > x1) x1 = b.x1;
    if (b.y1 > y1) y1 = b.y1;
  }
  return { x0, y0, x1, y1 };
}

function toPctBBox(b: PageBBox, vx0: number, vy1: number, pageWidth: number, pageHeight: number): FigureBBox {
  return {
    xPct: (b.x0 - vx0) / pageWidth,
    yPct: (vy1 - b.y1) / pageHeight,
    widthPct: (b.x1 - b.x0) / pageWidth,
    heightPct: (b.y1 - b.y0) / pageHeight,
  };
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
  let bestMatchStart = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const match = CAPTION_RE.exec(line.text);
    if (!match) continue;
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
      bestMatchStart = match.index;
    }
  }
  if (bestIndex === -1) return null;

  // Strip any leading axis-label/sub-panel text before the matched "Figure N:".
  const captionLine = lines[bestIndex]!.text.slice(bestMatchStart);
  const extra: string[] = [];
  for (let i = bestIndex + 1; i < lines.length && extra.length < CAPTION_CONTEXT_LINES; i++) {
    const next = lines[i]!;
    if (CAPTION_RE.test(next.text)) break;
    extra.push(next.text);
  }
  return { caption: captionLine, context: [captionLine, ...extra].join(' ') };
}

// ---------------------------------------------------------------------------
// V2: vector path clustering (design doc §12.3)
// ---------------------------------------------------------------------------

interface PathBoxEntry {
  bbox: PageBBox;
  /** Index into the page's operator list (used for z-order / occlusion reasoning). */
  opIndex: number;
}

interface VectorCluster {
  bbox: PageBBox;
  nPaths: number;
  /** Highest operator-list index among the cluster's member paths. */
  maxOpIndex: number;
}

/** Computes a pre-CTM bbox for a `constructPath` op, falling back to the raw coordinate list when pdf.js leaves `minMax` as `[Infinity, Infinity, -Infinity, -Infinity]` (curve-only paths). */
function pathBBoxFromArgs(args: unknown[]): [number, number, number, number] | null {
  const minMax = args[2] as [number, number, number, number] | undefined;
  if (minMax && minMax.every((v) => Number.isFinite(v))) return minMax;

  const coords = args[1] as number[] | undefined;
  if (!coords || coords.length < 2) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i + 1 < coords.length; i += 2) {
    const x = coords[i]!;
    const y = coords[i + 1]!;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  if (!Number.isFinite(x0) || !Number.isFinite(y0) || !Number.isFinite(x1) || !Number.isFinite(y1)) return null;
  return [x0, y0, x1, y1];
}

/** Union-find clustering of path bboxes: bboxes within `pad` of each other (after expansion) merge into one cluster. */
function clusterVectorPaths(boxes: PathBoxEntry[], pad: number): VectorCluster[] {
  const n = boxes.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  function find(x: number): number {
    let root = x;
    while (parent[root] !== root) root = parent[root]!;
    while (parent[x] !== root) {
      const next = parent[x]!;
      parent[x] = root;
      x = next;
    }
    return root;
  }
  for (let a = 0; a < n; a++) {
    const ba = boxes[a]!.bbox;
    for (let b = a + 1; b < n; b++) {
      const bb = boxes[b]!.bbox;
      if (ba.x1 + pad < bb.x0 - pad || bb.x1 + pad < ba.x0 - pad) continue;
      if (ba.y1 + pad < bb.y0 - pad || bb.y1 + pad < ba.y0 - pad) continue;
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent[rb] = ra;
    }
  }

  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    let g = groups.get(r);
    if (!g) {
      g = [];
      groups.set(r, g);
    }
    g.push(i);
  }

  const clusters: VectorCluster[] = [];
  for (const idxs of groups.values()) {
    let bbox = boxes[idxs[0]!]!.bbox;
    let maxOpIndex = boxes[idxs[0]!]!.opIndex;
    for (let k = 1; k < idxs.length; k++) {
      const item = boxes[idxs[k]!]!;
      bbox = bboxUnion(bbox, item.bbox);
      if (item.opIndex > maxOpIndex) maxOpIndex = item.opIndex;
    }
    clusters.push({ bbox, nPaths: idxs.length, maxOpIndex });
  }
  return clusters;
}

// ---------------------------------------------------------------------------
// V2: multi-panel grouping (design doc §12.4)
// ---------------------------------------------------------------------------

/**
 * Groups candidate bboxes (given as top-down percentages) into figure groups:
 * candidates whose y-ranges overlap form a "row"; within a row, candidates
 * separated by less than `GROUP_X_GAP_RATIO` of the row's average width are
 * merged into the same group. Returns groups as lists of indices into `boxes`.
 */
function groupCandidatesByLayout(boxes: FigureBBox[]): number[][] {
  const order = boxes.map((_, idx) => idx).sort((a, b) => boxes[a]!.yPct - boxes[b]!.yPct);
  const rows: number[][] = [];
  let rowY1 = -Infinity;
  for (const idx of order) {
    const b = boxes[idx]!;
    if (rows.length > 0 && b.yPct < rowY1) {
      rows[rows.length - 1]!.push(idx);
      rowY1 = Math.max(rowY1, b.yPct + b.heightPct);
    } else {
      rows.push([idx]);
      rowY1 = b.yPct + b.heightPct;
    }
  }

  const groups: number[][] = [];
  for (const row of rows) {
    const sorted = [...row].sort((a, b) => boxes[a]!.xPct - boxes[b]!.xPct);
    const avgWidth = sorted.reduce((sum, idx) => sum + boxes[idx]!.widthPct, 0) / sorted.length;
    const gap = avgWidth * GROUP_X_GAP_RATIO;
    let current: number[] = [];
    let prevX1 = -Infinity;
    for (const idx of sorted) {
      const b = boxes[idx]!;
      if (current.length > 0 && b.xPct - prevX1 > gap) {
        groups.push(current);
        current = [];
      }
      current.push(idx);
      prevX1 = Math.max(prevX1, b.xPct + b.widthPct);
    }
    if (current.length > 0) groups.push(current);
  }
  return groups;
}

// ---------------------------------------------------------------------------
// V2: full-page rendering + cropping (design doc §12.5)
// ---------------------------------------------------------------------------

interface PagePng {
  buffer: Buffer;
  width: number;
  height: number;
}

async function renderPageToPng(page: PdfjsPage, dpi: number): Promise<PagePng> {
  const scale = dpi / 72;
  const viewport = page.getViewport({ scale });
  const width = Math.max(1, Math.ceil(viewport.width));
  const height = Math.max(1, Math.ceil(viewport.height));

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport }).promise;
  return { buffer: canvas.toBuffer('image/png'), width, height };
}

async function cropPagePng(pagePng: PagePng, pct: FigureBBox): Promise<{ buffer: Buffer; width: number; height: number }> {
  const left = Math.max(0, Math.min(pagePng.width - 1, Math.round(pct.xPct * pagePng.width)));
  const top = Math.max(0, Math.min(pagePng.height - 1, Math.round(pct.yPct * pagePng.height)));
  const width = Math.max(1, Math.min(pagePng.width - left, Math.round(pct.widthPct * pagePng.width)));
  const height = Math.max(1, Math.min(pagePng.height - top, Math.round(pct.heightPct * pagePng.height)));
  const buffer = await sharp(pagePng.buffer).extract({ left, top, width, height }).png().toBuffer();
  return { buffer, width, height };
}

// ---------------------------------------------------------------------------
// V2: occluded-raster detection (design doc §12.6, pixel-diff based)
// ---------------------------------------------------------------------------

interface ResolvedRaster {
  raw: Buffer;
  width: number;
  height: number;
  channels: 1 | 3 | 4;
}

async function resolveRasterImage(
  page: PdfjsPage,
  id: string,
  ImageKind: PdfjsApi['ImageKind'],
  pdfId: string,
  pageNumber: number,
): Promise<ResolvedRaster | null> {
  const obj = (await getPageObject(page, id, OBJECT_RESOLVE_TIMEOUT_MS)) as PdfjsImageObject | null;
  if (!obj || !obj.data) {
    logger.warn({ pdfId, pageNumber, objId: id }, 'extractPdfFigures: skip image without raw pixel data');
    return null;
  }
  if (obj.kind === ImageKind.RGBA_32BPP) {
    return { raw: Buffer.from(obj.data), width: obj.width, height: obj.height, channels: 4 };
  }
  if (obj.kind === ImageKind.RGB_24BPP) {
    return { raw: Buffer.from(obj.data), width: obj.width, height: obj.height, channels: 3 };
  }
  if (obj.kind === ImageKind.GRAYSCALE_1BPP) {
    return { raw: unpack1bppToGray8(obj.data as Uint8Array, obj.width, obj.height), width: obj.width, height: obj.height, channels: 1 };
  }
  logger.warn({ pdfId, pageNumber, objId: id, kind: obj.kind }, 'extractPdfFigures: skip image with unsupported pixel kind');
  return null;
}

/** Mean per-channel (0-255) absolute difference between a raster image and the corresponding region of the rendered page. */
async function computeOcclusionDiff(resolved: ResolvedRaster, pagePng: PagePng, pct: FigureBBox): Promise<number> {
  const cropped = await cropPagePng(pagePng, pct);
  const croppedRaw = await sharp(cropped.buffer).raw().toBuffer({ resolveWithObject: true });
  const resizedRaw = await sharp(resolved.raw, { raw: { width: resolved.width, height: resolved.height, channels: resolved.channels } })
    .resize(croppedRaw.info.width, croppedRaw.info.height, { fit: 'fill' })
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true });

  const a = croppedRaw.data;
  const aCh = croppedRaw.info.channels;
  const b = resizedRaw.data;
  const bCh = resizedRaw.info.channels;
  const n = croppedRaw.info.width * croppedRaw.info.height;
  if (n === 0) return 0;

  let sum = 0;
  for (let p = 0; p < n; p++) {
    const ar = a[p * aCh]!;
    const ag = a[p * aCh + 1] ?? ar;
    const ab = a[p * aCh + 2] ?? ar;
    const br = b[p * bCh]!;
    const bg = b[p * bCh + 1] ?? br;
    const bb = b[p * bCh + 2] ?? br;
    sum += Math.abs(ar - br) + Math.abs(ag - bg) + Math.abs(ab - bb);
  }
  return sum / (n * 3);
}

// ---------------------------------------------------------------------------
// Per-page extraction
// ---------------------------------------------------------------------------

interface FigureCandidate {
  source: 'raster' | 'vector';
  bbox: PageBBox;
  /** For raster: the `paintImageXObject` op index. For vector: the cluster's `maxOpIndex`. */
  opIndex: number;
  rasterId?: string;
  caption?: string | null;
  context?: string | null;
}

async function extractFiguresForPage(
  page: PdfjsPage,
  pageNumber: number,
  pdfId: string,
  pdfjs: PdfjsApi,
): Promise<FigureEntry[]> {
  const { OPS, ImageKind } = pdfjs;
  const [vx0, vy0, vx1, vy1] = page.view;
  const pageWidth = vx1 - vx0;
  const pageHeight = vy1 - vy0;
  const opList = await page.getOperatorList();

  // Skip op 0: pdf.js prepends a viewport-flip transform that is not part of
  // the actual content stream. Tracking starts from identity.
  let ctm: Matrix = [1, 0, 0, 1, 0, 0];
  const stack: Matrix[] = [];
  const seenIds = new Set<string>();
  const rasterOps: Array<{ id: string; bbox: PageBBox; opIndex: number }> = [];
  const pathBoxes: PathBoxEntry[] = [];

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
      rasterOps.push({ id, bbox: unitSquareBounds(ctm), opIndex: i });
    } else if (fn === OPS.constructPath) {
      const bbox4 = pathBBoxFromArgs(args);
      if (!bbox4) continue;
      pathBoxes.push({ bbox: bboxBounds(bbox4, ctm), opIndex: i });
    }
  }

  if (rasterOps.length === 0 && pathBoxes.length === 0) return [];

  // §12.3: cluster vector paths, then filter by path count + area.
  const vectorClusters = clusterVectorPaths(pathBoxes, VECTOR_CLUSTER_PAD_PT);
  const candidates: FigureCandidate[] = [];
  for (const cluster of vectorClusters) {
    if (cluster.nPaths < VECTOR_FIGURE_MIN_PATHS) continue;
    const widthPct = (cluster.bbox.x1 - cluster.bbox.x0) / pageWidth;
    const heightPct = (cluster.bbox.y1 - cluster.bbox.y0) / pageHeight;
    const areaPct = widthPct * heightPct * 100;
    if (areaPct < FIGURE_MIN_AREA_PCT || areaPct > FIGURE_MAX_AREA_PCT) continue;
    candidates.push({ source: 'vector', bbox: cluster.bbox, opIndex: cluster.maxOpIndex });
  }

  for (const r of rasterOps) {
    const widthPct = (r.bbox.x1 - r.bbox.x0) / pageWidth;
    const heightPct = (r.bbox.y1 - r.bbox.y0) / pageHeight;
    const areaPct = widthPct * heightPct * 100;
    if (areaPct < FIGURE_MIN_AREA_PCT || areaPct > FIGURE_MAX_AREA_PCT) continue;
    candidates.push({ source: 'raster', bbox: r.bbox, opIndex: r.opIndex, rasterId: r.id });
  }

  if (candidates.length === 0) return [];

  // §12.3 step 3: a raster that's mostly the same region as a vector cluster
  // is merged into that cluster (avoids emitting the same area twice).
  for (const v of candidates) {
    if (v.source !== 'vector') continue;
    for (let idx = candidates.length - 1; idx >= 0; idx--) {
      const r = candidates[idx]!;
      if (r.source !== 'raster' || r === v) continue;
      const containment = bboxIntersectionArea(v.bbox, r.bbox) / bboxArea(r.bbox);
      if (bboxIoU(v.bbox, r.bbox) > RASTER_VECTOR_IOU_MERGE_THRESHOLD || containment > RASTER_VECTOR_CONTAINMENT_MERGE_THRESHOLD) {
        v.bbox = bboxUnion(v.bbox, r.bbox);
        v.opIndex = Math.max(v.opIndex, r.opIndex);
        candidates.splice(idx, 1);
      }
    }
  }

  // Lazily resolve raster pixel data (shared between the occlusion check and final output).
  const rasterCache = new Map<string, Promise<ResolvedRaster | null>>();
  function resolveRasterCached(id: string): Promise<ResolvedRaster | null> {
    let p = rasterCache.get(id);
    if (!p) {
      p = resolveRasterImage(page, id, ImageKind, pdfId, pageNumber);
      rasterCache.set(id, p);
    }
    return p;
  }

  // Lazily render the full page (shared between occlusion checks and vector crops).
  let pagePngPromise: Promise<PagePng> | null = null;
  function getPagePng(): Promise<PagePng> {
    if (!pagePngPromise) pagePngPromise = renderPageToPng(page, FIGURE_RENDER_DPI);
    return pagePngPromise;
  }

  // §12.6 (revised): a raster covered by a later, larger candidate is checked
  // against the rendered page; if its own pixels don't resemble what's
  // actually drawn there, it's an invisible residual and gets excluded.
  const excluded = new Set<FigureCandidate>();
  for (const r of candidates) {
    if (r.source !== 'raster' || !r.rasterId) continue;
    const occluder = candidates.find(
      (c) => c !== r && c.opIndex > r.opIndex && bboxIntersectionArea(c.bbox, r.bbox) / bboxArea(r.bbox) > OCCLUDED_RASTER_OVERLAP_THRESHOLD,
    );
    if (!occluder) continue;
    try {
      const resolved = await resolveRasterCached(r.rasterId);
      if (!resolved) continue;
      const pagePng = await getPagePng();
      const pct = toPctBBox(r.bbox, vx0, vy1, pageWidth, pageHeight);
      const diff = await computeOcclusionDiff(resolved, pagePng, pct);
      if (diff > OCCLUDED_RASTER_DIFF_THRESHOLD) {
        excluded.add(r);
        logger.info({ pdfId, pageNumber, objId: r.rasterId, diff }, 'extractPdfFigures: excluding occluded raster image');
      }
    } catch (err) {
      logger.warn({ pdfId, pageNumber, objId: r.rasterId, err }, 'extractPdfFigures: occlusion check failed, keeping image');
    }
  }
  const surviving = candidates.filter((c) => !excluded.has(c));
  if (surviving.length === 0) return [];

  // §12.4: group candidates by layout, then match each group's union bbox to a caption.
  const content = await page.getTextContent();
  const lines = collectTextLines(content.items);
  const pctBoxes = surviving.map((c) => toPctBBox(c.bbox, vx0, vy1, pageWidth, pageHeight));
  const groups = groupCandidatesByLayout(pctBoxes);
  for (const group of groups) {
    const unionBbox = unionPageBBox(group.map((idx) => surviving[idx]!.bbox));
    const match = findCaption(lines, unionBbox);
    for (const idx of group) {
      surviving[idx]!.caption = match?.caption ?? null;
      surviving[idx]!.context = match?.context ?? null;
    }
  }

  // Stable left-to-right, top-to-bottom ordering for output + vector naming.
  const ordered = surviving
    .map((c, idx) => ({ c, pct: pctBoxes[idx]! }))
    .sort((a, b) => a.pct.yPct - b.pct.yPct || a.pct.xPct - b.pct.xPct);

  const figures: FigureEntry[] = [];
  let vecIndex = 0;
  for (const { c, pct } of ordered) {
    if (c.source === 'raster') {
      try {
        const resolved = await resolveRasterCached(c.rasterId!);
        if (!resolved) continue;
        const filename = `p${pageNumber}-${c.rasterId}.png`;
        await fs.promises.mkdir(figuresDir(pdfId), { recursive: true });
        await sharp(resolved.raw, { raw: { width: resolved.width, height: resolved.height, channels: resolved.channels } })
          .png()
          .toFile(figureFilePath(pdfId, filename));
        figures.push({
          id: `p${pageNumber}-${c.rasterId}`,
          imagePath: `figures/${filename}`,
          width: resolved.width,
          height: resolved.height,
          bbox: pct,
          caption: c.caption ?? null,
          context: c.context ?? null,
          source: 'raster',
        });
      } catch (err) {
        logger.warn({ pdfId, pageNumber, objId: c.rasterId, err }, 'extractPdfFigures: failed to extract image, skipping');
      }
    } else {
      try {
        const pagePng = await getPagePng();
        const cropped = await cropPagePng(pagePng, pct);
        vecIndex += 1;
        const filename = `p${pageNumber}-vec${vecIndex}.png`;
        await fs.promises.mkdir(figuresDir(pdfId), { recursive: true });
        await fs.promises.writeFile(figureFilePath(pdfId, filename), cropped.buffer);
        figures.push({
          id: `p${pageNumber}-vec${vecIndex}`,
          imagePath: `figures/${filename}`,
          width: cropped.width,
          height: cropped.height,
          bbox: pct,
          caption: c.caption ?? null,
          context: c.context ?? null,
          source: 'vector',
        });
      } catch (err) {
        logger.warn({ pdfId, pageNumber, err }, 'extractPdfFigures: failed to render vector figure region, skipping');
      }
    }
  }
  return figures;
}

/**
 * Extracts embedded figures (charts, photos, diagrams) from a PDF, together
 * with their on-page position and any nearby caption text, into
 * `storage/<pdfId>/figures.json` + `storage/<pdfId>/figures/*.png`.
 *
 * Covers both embedded raster images (`OPS.paintImageXObject`) and
 * purely vector-drawn charts (clusters of `OPS.constructPath` ops),
 * per `docs/pdf-figure-extraction-design.md` §12.
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
  const data = await fs.promises.readFile(sourcePdfPath(pdfId));
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data), useSystemFonts: true, CanvasFactory: NodeCanvasFactory }).promise;

  const pages: FigurePageEntry[] = [];
  let figureCount = 0;

  try {
    const limit = Math.min(doc.numPages, pageCount);
    for (let pageNumber = 1; pageNumber <= limit; pageNumber++) {
      const page = await doc.getPage(pageNumber);
      let figures: FigureEntry[] = [];
      try {
        figures = await extractFiguresForPage(page, pageNumber, pdfId, pdfjs);
      } catch (err) {
        logger.warn({ pdfId, pageNumber, err }, 'extractPdfFigures: failed to extract figures for page, skipping');
      } finally {
        page.cleanup?.();
      }
      pages.push({ pageNumber, figures });
      figureCount += figures.length;
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
