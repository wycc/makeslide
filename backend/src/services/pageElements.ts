/**
 * Page element layer — text / image / shape elements placed over a page's base image, the way a
 * presentation app does (docs/page-elements.md).
 *
 * The invariant this module protects: `<uid>.jpg` is what every AI path and every export reads,
 * so with elements present it is the *composite* (base image + elements), and the editable base
 * moves to `<uid>.base.jpg`. Nothing outside this module needs to know the difference — that is
 * the whole point (docs/page-elements.md §1.2).
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { z } from 'zod';
import { db } from '../db';
import { logger } from '../logger';
import { commitPresentationFiles } from './presentationGit';
import { generateCoverThumbnail, generatePageThumbnail } from './thumbnails';
import { forgetDeckCanvas } from './deckCanvas';
import {
  coverImagePath,
  pageElementsPath,
  pageBaseImagePath,
  pageElementAssetPath,
  pageImagePath,
  pagesDir,
  safeJoinPdfPath,
} from './storage';
import { renderPageElements } from './pageElementsRender';
import { buildPageElementsDocument } from './pageElementsDocument';
import { bakeAvailability, renderSlideToJpeg } from './reactSlideBake';

// ─── Schema ─────────────────────────────────────────────────────────────────

/** Reference height the "reference pixel" sizes (font size, stroke width, padding) are relative to. */
export const ELEMENT_REF_HEIGHT = 1080;
export const MAX_PAGE_ELEMENTS = 100;
export const MAX_ELEMENT_TEXT_CHARS = 2000;
/** Element asset uploads: sharp-validated, at most this many bytes, longest edge capped. */
export const MAX_ELEMENT_ASSET_BYTES = 8 * 1024 * 1024;
export const MAX_ELEMENT_ASSET_EDGE_PX = 2048;

export const ELEMENT_FONT_FAMILIES = ['sans', 'serif', 'mono', 'kai'] as const;
export type ElementFontFamily = (typeof ELEMENT_FONT_FAMILIES)[number];
export const ELEMENT_SHAPES = ['rect', 'ellipse', 'triangle', 'diamond', 'star'] as const;
export type ElementShape = (typeof ELEMENT_SHAPES)[number];

/**
 * Only `#rrggbb`, `#rrggbbaa` and `rgba(r, g, b, a)` — a narrow whitelist keeps the browser
 * preview and the node-canvas composite reading the same value (docs/page-elements.md §2.4).
 */
export const ELEMENT_COLOR_RE =
  /^(#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?|rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(0|1|0?\.\d{1,4})\s*\))$/;

export function isElementColor(value: string): boolean {
  const m = ELEMENT_COLOR_RE.exec(value);
  if (!m) return false;
  if (m[3] !== undefined) {
    return [m[3], m[4], m[5]].every((c) => Number(c) <= 255);
  }
  return true;
}

/** Asset file name: `<pageUid>.el-<nanoid8>.<ext>` — a bare name, never a path. */
export const ELEMENT_ASSET_NAME_RE = /^([A-Za-z0-9_-]{1,64})\.el-([A-Za-z0-9_-]{8})\.(png|jpe?g|webp|gif)$/;

const ColorSchema = z.string().max(40).refine(isElementColor, 'Invalid colour (use #rrggbb, #rrggbbaa or rgba())');
const IdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,32}$/);
/** Position may sit a little outside the page (an element half dragged off the edge is still valid). */
const Coord = z.number().finite().min(-1).max(2);
const Size = z.number().finite().min(0.001).max(3);
const RefPx = z.number().finite().min(0).max(1000);

const BaseSchema = z.object({
  id: IdSchema,
  x: Coord,
  y: Coord,
  w: Size,
  h: Size,
  rotation: z.number().finite().min(-360).max(360).default(0),
  opacity: z.number().finite().min(0).max(1).default(1),
});

export const TextElementSchema = BaseSchema.extend({
  type: z.literal('text'),
  text: z.string().max(MAX_ELEMENT_TEXT_CHARS),
  fontFamily: z.enum(ELEMENT_FONT_FAMILIES).default('sans'),
  fontSize: z.number().finite().min(8).max(400).default(48),
  bold: z.boolean().default(false),
  italic: z.boolean().default(false),
  underline: z.boolean().default(false),
  align: z.enum(['left', 'center', 'right']).default('left'),
  valign: z.enum(['top', 'middle', 'bottom']).default('top'),
  lineHeight: z.number().finite().min(0.8).max(3).default(1.3),
  color: ColorSchema.default('#111111'),
  background: ColorSchema.nullable().default(null),
  padding: RefPx.default(8),
  borderRadius: RefPx.default(0),
});

export const ImageElementSchema = BaseSchema.extend({
  type: z.literal('image'),
  asset: z.string().regex(ELEMENT_ASSET_NAME_RE, 'Invalid asset name'),
  fit: z.enum(['contain', 'cover', 'fill']).default('contain'),
  borderRadius: RefPx.default(0),
});

export const ShapeElementSchema = BaseSchema.extend({
  type: z.literal('shape'),
  shape: z.enum(ELEMENT_SHAPES),
  fill: ColorSchema.nullable().default('#3b82f6'),
  stroke: ColorSchema.nullable().default(null),
  strokeWidth: RefPx.default(4),
  borderRadius: RefPx.default(0),
});

/**
 * A line is not a shape in a box: it is two page points, each draggable on its own
 * (docs/page-elements.md §2.2). Arrow heads are flags rather than a separate kind.
 */
export const LineElementSchema = z.object({
  id: IdSchema,
  type: z.literal('line'),
  x1: Coord,
  y1: Coord,
  x2: Coord,
  y2: Coord,
  stroke: ColorSchema.default('#111111'),
  strokeWidth: RefPx.min(1).default(6),
  arrowStart: z.boolean().default(false),
  arrowEnd: z.boolean().default(false),
  opacity: z.number().finite().min(0).max(1).default(1),
});

export const PageElementSchema = z.discriminatedUnion('type', [TextElementSchema, ImageElementSchema, ShapeElementSchema, LineElementSchema]);
export const PageElementsArraySchema = z.array(PageElementSchema).max(MAX_PAGE_ELEMENTS);

export type TextElement = z.infer<typeof TextElementSchema>;
export type ImageElement = z.infer<typeof ImageElementSchema>;
export type ShapeElement = z.infer<typeof ShapeElementSchema>;
export type LineElement = z.infer<typeof LineElementSchema>;
export type PageElement = z.infer<typeof PageElementSchema>;

export interface PageElementsDoc {
  version: 1;
  elements: PageElement[];
}

const DocSchema = z.object({ version: z.literal(1), elements: PageElementsArraySchema });

// ─── Reading ────────────────────────────────────────────────────────────────

/** Elements of a page, or `[]` when the page has none (missing or unreadable file both count as none). */
export function readPageElementsSync(pdfId: string, pageUid: string): PageElement[] {
  const file = pageElementsPath(pdfId, pageUid);
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  try {
    const parsed = DocSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data.elements : [];
  } catch {
    return [];
  }
}

export function pageHasElements(pdfId: string, pageUid: string): boolean {
  return fs.existsSync(pageElementsPath(pdfId, pageUid));
}

/** Names of every asset file on disk belonging to this page (`<uid>.el-*`). */
async function listPageAssetNames(pdfId: string, pageUid: string): Promise<string[]> {
  let names: string[];
  try {
    names = await fs.promises.readdir(pagesDir(pdfId));
  } catch {
    return [];
  }
  const prefix = `${pageUid}.el-`;
  return names.filter((name) => name.startsWith(prefix) && ELEMENT_ASSET_NAME_RE.test(name));
}

/** Validates an asset name belongs to the page and resolves it under the pdf directory. */
export function resolvePageAssetPath(pdfId: string, pageUid: string, assetName: string): string | null {
  const m = ELEMENT_ASSET_NAME_RE.exec(assetName);
  if (!m || m[1] !== pageUid) return null;
  try {
    return pageElementAssetPath(pdfId, assetName);
  } catch {
    return null;
  }
}

// ─── Writing / composing ────────────────────────────────────────────────────

interface PageIdentity {
  pdfId: string;
  pageNumber: number;
  pageUid: string;
}

function relPages(fileName: string): string {
  return path.posix.join('pages', fileName);
}

function nowIso(): string {
  return new Date().toISOString();
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.promises.access(file, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * The first element on a page turns the current picture into the base image
 * (docs/page-elements.md §3.2). Idempotent: an existing base is left alone so a later save never
 * overwrites it with the composite it produced.
 */
async function ensureBaseImage(pdfId: string, pageUid: string): Promise<void> {
  const base = pageBaseImagePath(pdfId, pageUid);
  if (await exists(base)) return;
  const current = pageImagePath(pdfId, pageUid);
  if (!(await exists(current))) {
    throw new PageElementsError('NO_BASE_IMAGE', 'This page has no image to place elements on');
  }
  await fs.promises.copyFile(current, base);
}

export class PageElementsError extends Error {
  constructor(
    public readonly code: 'NO_BASE_IMAGE' | 'MISSING_ASSET' | 'RENDER_FAILED',
    message: string,
  ) {
    super(message);
    this.name = 'PageElementsError';
  }
}

async function finishPageImage(page: PageIdentity, changedRelPaths: string[], message: string): Promise<string> {
  const { pdfId, pageNumber, pageUid } = page;
  const composite = pageImagePath(pdfId, pageUid);
  await generatePageThumbnail(pdfId, pageUid, composite);
  if (pageNumber === 1) {
    try {
      await fs.promises.copyFile(composite, coverImagePath(pdfId));
      await generateCoverThumbnail(pdfId);
    } catch (err) {
      logger.warn({ err, pdfId }, 'pageElements: cover refresh failed');
    }
  }
  forgetDeckCanvas(pdfId);
  const now = nowIso();
  db.prepare(`UPDATE pages SET updated_at = ? WHERE pdf_id = ? AND page_number = ?`).run(now, pdfId, pageNumber);
  db.prepare(`UPDATE pdfs SET updated_at = ? WHERE id = ?`).run(now, pdfId);
  void commitPresentationFiles(pdfId, changedRelPaths, message);
  return now;
}

/**
 * Saves the element list and re-composes `<uid>.jpg`. An empty list is the way back to a plain
 * image page (§3.3): the base becomes the page image again and every element file goes away.
 */
export async function savePageElements(page: PageIdentity, elements: PageElement[]): Promise<{ updated_at: string; has_elements: boolean }> {
  const { pdfId, pageNumber, pageUid } = page;
  if (elements.length === 0) {
    const updatedAt = await clearPageElements(page, 'restore-base');
    return { updated_at: updatedAt, has_elements: false };
  }

  // Every referenced asset has to exist before anything is written: a dangling reference would
  // otherwise surface as a silently blank spot in the composite.
  for (const el of elements) {
    if (el.type !== 'image') continue;
    const abs = resolvePageAssetPath(pdfId, pageUid, el.asset);
    if (!abs || !(await exists(abs))) {
      throw new PageElementsError('MISSING_ASSET', `Asset ${el.asset} does not exist on page ${pageNumber}`);
    }
  }

  await ensureBaseImage(pdfId, pageUid);
  const doc: PageElementsDoc = { version: 1, elements };
  await fs.promises.writeFile(pageElementsPath(pdfId, pageUid), `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
  await deleteOrphanAssets(pdfId, pageUid, elements);

  let jpeg: Buffer;
  try {
    jpeg = await composePageImage(pdfId, pageUid, elements);
  } catch (err) {
    logger.error({ err, pdfId, pageNumber }, 'pageElements: compose failed');
    throw new PageElementsError('RENDER_FAILED', err instanceof Error ? err.message : 'Failed to compose page image');
  }
  await fs.promises.writeFile(pageImagePath(pdfId, pageUid), jpeg);

  const relElements = relPages(`${pageUid}.elements.json`);
  db.prepare(`UPDATE pages SET elements_path = ?, image_path = ? WHERE pdf_id = ? AND page_number = ?`).run(
    relElements,
    relPages(`${pageUid}.jpg`),
    pdfId,
    pageNumber,
  );
  const updatedAt = await finishPageImage(
    page,
    [relElements, relPages(`${pageUid}.base.jpg`), relPages(`${pageUid}.jpg`)],
    `elements: update page ${pageNumber}`,
  );
  return { updated_at: updatedAt, has_elements: true };
}

/**
 * Composes base + elements into a JPEG. Headless Chrome renders the same HTML/CSS the browser
 * layer uses (Markdown, KaTeX, exact fonts); where no browser is available the node-canvas
 * fallback draws text as plain text (docs/page-elements.md §3.5).
 */
export async function composePageImage(pdfId: string, pageUid: string, elements: PageElement[]): Promise<Buffer> {
  const basePath = pageBaseImagePath(pdfId, pageUid);
  const availability = await bakeAvailability();
  if (availability.available) {
    try {
      const baseBuffer = await fs.promises.readFile(basePath);
      const meta = await sharp(baseBuffer).metadata();
      if (!meta.width || !meta.height) throw new Error('base image has no dimensions');
      const assetDataUrls: Record<string, string> = {};
      for (const el of elements) {
        if (el.type !== 'image' || assetDataUrls[el.asset]) continue;
        const abs = resolvePageAssetPath(pdfId, pageUid, el.asset);
        if (!abs) continue;
        const bytes = await fs.promises.readFile(abs);
        const ext = el.asset.split('.').pop()?.toLowerCase();
        const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/jpeg';
        assetDataUrls[el.asset] = `data:${mime};base64,${bytes.toString('base64')}`;
      }
      const html = buildPageElementsDocument({
        width: meta.width,
        height: meta.height,
        baseDataUrl: `data:image/jpeg;base64,${baseBuffer.toString('base64')}`,
        elements,
        assetDataUrls,
      });
      return await renderSlideToJpeg(html, { width: meta.width, height: meta.height });
    } catch (err) {
      // A browser that fails at runtime is not a reason to lose the save: fall through to canvas.
      logger.warn({ err, pdfId, pageUid }, 'pageElements: browser compose failed, using canvas fallback');
    }
  }
  return renderPageElements(basePath, elements, (name) => resolvePageAssetPath(pdfId, pageUid, name));
}

/**
 * Drops the element layer. `restore-base` puts the base image back as the page image (the user
 * deleted every element); `keep-composite` leaves `<uid>.jpg` as it is — the fusion case, where a
 * new picture that already contains the elements as pixels has just been written there (§3.4).
 */
export async function clearPageElements(page: PageIdentity, mode: 'restore-base' | 'keep-composite'): Promise<string> {
  const { pdfId, pageNumber, pageUid } = page;
  const base = pageBaseImagePath(pdfId, pageUid);
  const hadBase = await exists(base);
  if (mode === 'restore-base' && hadBase) {
    await fs.promises.copyFile(base, pageImagePath(pdfId, pageUid));
  }
  await fs.promises.rm(base, { force: true });
  await fs.promises.rm(pageElementsPath(pdfId, pageUid), { force: true });
  await deleteOrphanAssets(pdfId, pageUid, []);
  db.prepare(`UPDATE pages SET elements_path = NULL WHERE pdf_id = ? AND page_number = ?`).run(pdfId, pageNumber);
  if (mode === 'restore-base' && !hadBase) {
    // Nothing on disk to restore — the page never had elements; just touch nothing else.
    return nowIso();
  }
  return finishPageImage(page, [relPages(`${pageUid}.jpg`)], `elements: clear page ${pageNumber}`);
}

/**
 * A new base image arrived (user upload, "更換底圖"): keep the elements and compose them onto it.
 * Callers write the image to `<uid>.jpg` first exactly as they always did; this moves it under the
 * elements when the page has any. Returns false when the page has no element layer (nothing to do).
 */
export async function recomposeAfterBaseReplaced(page: PageIdentity): Promise<boolean> {
  const { pdfId, pageUid } = page;
  const elements = readPageElementsSync(pdfId, pageUid);
  if (elements.length === 0) return false;
  await fs.promises.copyFile(pageImagePath(pdfId, pageUid), pageBaseImagePath(pdfId, pageUid));
  await savePageElements(page, elements);
  return true;
}

/**
 * Writes a new picture for the page from a buffer: under the element layer (as the new base,
 * re-composing the elements) when the page has one, otherwise as the page image itself. The
 * server-side counterpart of `replace-image` with `mode=base`.
 */
export async function replacePageBaseImage(page: PageIdentity, jpeg: Buffer, message: string): Promise<string> {
  const { pdfId, pageNumber, pageUid } = page;
  const elements = readPageElementsSync(pdfId, pageUid);
  if (elements.length > 0 && (await exists(pageBaseImagePath(pdfId, pageUid)))) {
    await fs.promises.writeFile(pageBaseImagePath(pdfId, pageUid), jpeg);
    return (await savePageElements(page, elements)).updated_at;
  }
  await fs.promises.writeFile(pageImagePath(pdfId, pageUid), jpeg);
  db.prepare(`UPDATE pages SET image_path = ? WHERE pdf_id = ? AND page_number = ?`).run(relPages(`${pageUid}.jpg`), pdfId, pageNumber);
  return finishPageImage(page, [relPages(`${pageUid}.jpg`)], message);
}

/**
 * An AI-generated picture that already contains the elements (it was produced from the
 * composite) has just been written to `<uid>.jpg`: the elements are now pixels (§3.4).
 * Returns false when the page had no element layer.
 */
export async function fusePageElements(page: PageIdentity): Promise<boolean> {
  if (!pageHasElements(page.pdfId, page.pageUid)) return false;
  await clearPageElements(page, 'keep-composite');
  return true;
}

/** Removes asset files no element references any more. */
async function deleteOrphanAssets(pdfId: string, pageUid: string, elements: PageElement[]): Promise<void> {
  const referenced = new Set(elements.filter((e): e is ImageElement => e.type === 'image').map((e) => e.asset));
  const onDisk = await listPageAssetNames(pdfId, pageUid);
  await Promise.all(
    onDisk
      .filter((name) => !referenced.has(name))
      .map((name) => fs.promises.rm(safeJoinPdfPath(pdfId, 'pages', name), { force: true })),
  );
}

/** Every element-layer file of a page, for page deletion. */
export async function pageElementFiles(pdfId: string, pageUid: string): Promise<string[]> {
  const assets = await listPageAssetNames(pdfId, pageUid);
  return [
    pageElementsPath(pdfId, pageUid),
    pageBaseImagePath(pdfId, pageUid),
    ...assets.map((name) => safeJoinPdfPath(pdfId, 'pages', name)),
  ];
}
