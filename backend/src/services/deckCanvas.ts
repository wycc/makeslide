import fs from 'node:fs';
import sharp from 'sharp';
import { db } from '../db';
import { pageImagePath } from './storage';

/**
 * The pixel canvas one deck's slides are laid out against.
 *
 * React pages used to be laid out against a hardcoded 1920×1080 while page images are generated at
 * 1536×1024 (the image model's native landscape size). A deck therefore ended up with pages of two
 * different *shapes*: 3:2 everywhere and 16:9 on the React page, which reads as "that page is
 * bigger than the others" and, once baked, permanently changed that page's JPG. Fusion spread it
 * further — a page converted back to an image kept the 16:9 bake.
 *
 * So the canvas is derived from the deck instead of fixed: whatever shape this deck's pages
 * actually are is the shape a React page in it should be.
 */

/** Used when a deck has no readable page image yet — a new deck's first React page, typically. */
export const DEFAULT_CANVAS_WIDTH = 1920;
export const DEFAULT_CANVAS_HEIGHT = 1080;

/**
 * Bounds on a derived canvas. A page image is normally 1–2k across; anything far outside that is a
 * source we should not be laying out against (a scanned poster, a favicon-sized placeholder), and
 * the canvas feeds a headless browser viewport and every generated coordinate.
 */
const MIN_CANVAS_EDGE = 320;
const MAX_CANVAS_EDGE = 4096;

export interface DeckCanvas {
  width: number;
  height: number;
}

interface CacheEntry {
  value: DeckCanvas;
  at: number;
}

/**
 * Deriving this reads every page image's header, so it is cached briefly: the editor asks for it on
 * every page load, while it only changes when images are regenerated or replaced.
 */
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000;

/** Tests drive several decks through this; nothing in production needs it. */
export function clearDeckCanvasCacheForTest(): void {
  cache.clear();
}

/** Invalidate one deck, for the paths that rewrite a page image. */
export function forgetDeckCanvas(pdfId: string): void {
  cache.delete(pdfId);
}

function isUsableSize(width: number | undefined, height: number | undefined): boolean {
  if (!width || !height) return false;
  return (
    width >= MIN_CANVAS_EDGE && height >= MIN_CANVAS_EDGE
    && width <= MAX_CANVAS_EDGE && height <= MAX_CANVAS_EDGE
  );
}

/**
 * The canvas for this deck: the size most of its pages already are.
 *
 * The mode rather than the first page's size, because a deck can legitimately contain one odd page
 * — including a React page that was baked at the old fixed canvas, or one converted back to an
 * image by fusion. Those are exactly the pages whose size should *not* redefine the deck; taking
 * the most common size lets the majority outvote them.
 *
 * Ties break toward the larger area, so a deck split evenly keeps the more detailed canvas.
 */
export async function deckCanvasSize(pdfId: string): Promise<DeckCanvas> {
  const cached = cache.get(pdfId);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

  const rows = db
    .prepare(`SELECT page_uid FROM pages WHERE pdf_id = ? ORDER BY page_number ASC`)
    .all(pdfId) as Array<{ page_uid: string }>;

  const tally = new Map<string, { width: number; height: number; count: number }>();
  for (const row of rows) {
    const file = pageImagePath(pdfId, row.page_uid);
    if (!fs.existsSync(file)) continue;
    try {
      const meta = await sharp(file).metadata();
      if (!isUsableSize(meta.width, meta.height)) continue;
      const key = `${meta.width}x${meta.height}`;
      const entry = tally.get(key);
      if (entry) entry.count += 1;
      else tally.set(key, { width: meta.width!, height: meta.height!, count: 1 });
    } catch {
      // An unreadable page image is not a reason to fail; it just does not get a vote.
    }
  }

  let best: DeckCanvas = { width: DEFAULT_CANVAS_WIDTH, height: DEFAULT_CANVAS_HEIGHT };
  let bestCount = 0;
  for (const entry of tally.values()) {
    const better =
      entry.count > bestCount
      || (entry.count === bestCount && entry.width * entry.height > best.width * best.height);
    if (better) {
      best = { width: entry.width, height: entry.height };
      bestCount = entry.count;
    }
  }

  cache.set(pdfId, { value: best, at: Date.now() });
  return best;
}
