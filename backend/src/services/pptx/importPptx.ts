/**
 * Turning a .pptx into a makeslide deck (docs/pptx-animated-import-design.md §5).
 *
 * A static slide becomes an ordinary image page. A slide that is built by clicking becomes a React
 * page whose steps are the clicks: every step's picture is rendered from the original file (see
 * renderFrames.ts) and stacked as a layer the sandbox reveals one at a time, so the page animates
 * exactly the way the original does without anything having to re-create its layout.
 *
 * Narration is left empty here; writing it is a separate stage, because it costs model calls and
 * because an import that has produced the right pictures is already worth keeping.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { nanoid } from 'nanoid';
import { db } from '../../db';
import { logger } from '../../logger';
import {
  coverImagePath,
  pageImagePath,
  pageScriptPath,
  pageTextPath,
  pagesDir,
  readMetadata,
  writeMetadata,
} from '../storage';
import { generateCoverThumbnail, generatePageThumbnail } from '../thumbnails';
import { storePageAsset } from '../reactSlideAsset';
import { validateAndCompileReactSlide } from '../reactSlide';
import { writeReactSlideForPage } from '../reactSlidePage';
import { writePageSteps, type PageStep } from '../pageSteps';
import { openPptx } from './pptxArchive';
import { parsePptxDeck, type PptxSlide } from './parsePptx';
import { renderPptxFrames, type FrameRequest } from './renderFrames';

/** Page width every rendered frame is produced at; the height follows the deck's own ratio. */
const PAGE_WIDTH = 1920;
const MAX_SLIDES = 200;

export interface PptxImportProgress {
  stage: 'parsing' | 'rendering' | 'building' | 'done';
  done: number;
  total: number;
}

export interface PptxImportResult {
  pageCount: number;
  animatedPageCount: number;
  stepCount: number;
  title: string;
}

export interface PptxImportOptions {
  pdfId: string;
  pptxPath: string;
  onProgress?: (progress: PptxImportProgress) => void;
  signal?: { aborted: boolean };
  /**
   * The renderer, so the import itself can be tested without LibreOffice — what the frames look
   * like is renderFrames.ts's business and is tested there against the real thing.
   */
  renderFrames?: typeof renderPptxFrames;
}

/**
 * Import the file into a deck row that already exists (created by the route, so the caller has an
 * id to poll with). Page rows are written as the import goes, so a deck that fails half way still
 * shows what it managed to build.
 */
export async function importPptxIntoDeck(options: PptxImportOptions): Promise<PptxImportResult> {
  const { pdfId, pptxPath, onProgress, signal } = options;
  onProgress?.({ stage: 'parsing', done: 0, total: 1 });

  const archive = await openPptx(pptxPath);
  const deck = await parsePptxDeck((name) => archive.readText(name));
  if (deck.slides.length === 0) throw new Error('這個 pptx 沒有任何投影片');
  if (deck.slides.length > MAX_SLIDES) {
    throw new Error(`這個 pptx 有 ${deck.slides.length} 頁，超過 ${MAX_SLIDES} 頁上限`);
  }

  const pageHeight = Math.round((PAGE_WIDTH * deck.heightEmu) / deck.widthEmu / 2) * 2;
  fs.mkdirSync(pagesDir(pdfId), { recursive: true });

  // One page row per slide, with its stable uid, before anything is rendered: the frames are
  // written straight to each page's own files.
  const now = new Date().toISOString();
  const pageUids = deck.slides.map(() => nanoid(10));
  db.transaction(() => {
    db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);
    for (const [index, slide] of deck.slides.entries()) {
      db.prepare(
        `INSERT INTO pages (pdf_id, page_number, page_uid, text_path, script_path, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
      ).run(
        pdfId,
        slide.slideNumber,
        pageUids[index],
        `pages/${pageUids[index]}.text.txt`,
        `pages/${pageUids[index]}.script.txt`,
        now,
        now,
      );
    }
    db.prepare(`UPDATE pdfs SET page_count = ?, updated_at = ? WHERE id = ?`).run(deck.slides.length, now, pdfId);
  })();

  // Every frame the deck needs. Intermediate steps land in a scratch directory; the final frame of
  // each slide is the page's own picture.
  const frameDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'makeslide-pptx-import-'));
  try {
    const requests: FrameRequest[] = [];
    const stepFramePaths = new Map<string, string>(); // `${slideNumber}:${stepIndex}` -> file
    for (const [index, slide] of deck.slides.entries()) {
      const uid = pageUids[index]!;
      const stepCount = slide.steps.length;
      for (let step = 0; step <= stepCount; step += 1) {
        if (step === stepCount) {
          // The finished slide is the page image every image-shaped consumer uses.
          requests.push({ slideNumber: slide.slideNumber, stepIndex: step, outPath: pageImagePath(pdfId, uid) });
        } else {
          const file = path.join(frameDir, `${uid}-${String(step).padStart(2, '0')}.jpg`);
          stepFramePaths.set(`${slide.slideNumber}:${step}`, file);
          requests.push({ slideNumber: slide.slideNumber, stepIndex: step, outPath: file });
        }
      }
    }

    onProgress?.({ stage: 'rendering', done: 0, total: requests.length });
    await (options.renderFrames ?? renderPptxFrames)(pptxPath, requests, {
      slides: deck.slides,
      width: PAGE_WIDTH,
      height: pageHeight,
      signal,
      onFrame: (done, total) => onProgress?.({ stage: 'rendering', done, total }),
    });

    onProgress?.({ stage: 'building', done: 0, total: deck.slides.length });
    let animatedPageCount = 0;
    let stepCountTotal = 0;
    for (const [index, slide] of deck.slides.entries()) {
      if (signal?.aborted) throw new Error('cancelled');
      const uid = pageUids[index]!;
      await fs.promises.writeFile(pageTextPath(pdfId, uid), slideOutline(slide), 'utf8');
      await fs.promises.writeFile(pageScriptPath(pdfId, uid), '', 'utf8');
      const imagePath = pageImagePath(pdfId, uid);
      await generatePageThumbnail(pdfId, uid, imagePath);

      if (slide.steps.length > 0) {
        await buildSteppedPage({ pdfId, slide, pageUid: uid, frameDir, stepFramePaths, now });
        animatedPageCount += 1;
        stepCountTotal += slide.steps.length + 1;
      }

      db.prepare(
        `UPDATE pages SET image_path = ?, status = 'text_ready', updated_at = ? WHERE pdf_id = ? AND page_number = ?`,
      ).run(`pages/${uid}.jpg`, new Date().toISOString(), pdfId, slide.slideNumber);
      onProgress?.({ stage: 'building', done: index + 1, total: deck.slides.length });
    }

    const cover = coverImagePath(pdfId);
    await sharp(pageImagePath(pdfId, pageUids[0]!)).jpeg({ quality: 80, mozjpeg: true }).toFile(cover);
    await generateCoverThumbnail(pdfId, cover);

    const title = deckTitle(deck.slides, pptxPath);
    db.prepare(`UPDATE pdfs SET title = ?, updated_at = ? WHERE id = ?`).run(title, new Date().toISOString(), pdfId);
    await syncMetadata(pdfId);

    onProgress?.({ stage: 'done', done: deck.slides.length, total: deck.slides.length });
    return { pageCount: deck.slides.length, animatedPageCount, stepCount: stepCountTotal, title };
  } finally {
    await fs.promises.rm(frameDir, { recursive: true, force: true });
  }
}

/** Turn one animated slide into a React page whose layers are its steps. */
async function buildSteppedPage(args: {
  pdfId: string;
  slide: PptxSlide;
  pageUid: string;
  frameDir: string;
  stepFramePaths: Map<string, string>;
  now: string;
}): Promise<void> {
  const { pdfId, slide, pageUid, stepFramePaths, now } = args;
  const stepAssets: string[] = [];
  for (let step = 0; step < slide.steps.length; step += 1) {
    const file = stepFramePaths.get(`${slide.slideNumber}:${step}`);
    if (!file) throw new Error(`missing rendered frame for slide ${slide.slideNumber} step ${step}`);
    // WebP, not JPEG: every frame is a full-slide picture and they all travel to the sandbox as
    // data URLs in one document, so a 24-step slide's total size is what decides whether the page
    // opens quickly. Same picture, roughly half the bytes.
    const webp = await sharp(file).webp({ quality: 82 }).toBuffer();
    const stored = await storePageAsset(pdfId, pageUid, webp, 'frame.webp');
    stepAssets.push(stored.name);
  }
  // The last step is the finished slide, which is already the page's own JPG.
  const finalAsset = await storePageAsset(
    pdfId,
    pageUid,
    await sharp(pageImagePath(pdfId, pageUid)).webp({ quality: 82 }).toBuffer(),
    'frame.webp',
  );
  stepAssets.push(finalAsset.name);

  const code = buildStepSlideCode(stepAssets);
  const validation = await validateAndCompileReactSlide(code);
  // We generate this code ourselves, so a rejection is a bug here rather than bad input — and it
  // must stop the import rather than leave a page whose steps play against a blank slide.
  if (!validation.ok || !validation.compiled) {
    throw new Error(`generated slide code was rejected: ${validation.ok ? 'no compiled output' : validation.message}`);
  }
  await writeReactSlideForPage(pdfId, slide.slideNumber, pageUid, code, validation.compiled, now);

  const steps: PageStep[] = stepAssets.map((asset, index) => ({ index, asset, script: '' }));
  writePageSteps(pdfId, pageUid, { version: 1, source: 'pptx', steps });
  logger.info({ pdfId, pageNumber: slide.slideNumber, steps: steps.length }, 'pptx import: built a stepped page');
}

/**
 * The page's React code: one full-slide layer per step, stacked in order.
 *
 * Every layer is the whole slide as it looks at that step, so revealing layer k covers everything
 * before it — the build never has to describe what changed, which is what makes it exact.
 */
export function buildStepSlideCode(assetNames: string[]): string {
  const layers = assetNames
    .map(
      (name, index) =>
        `      <img data-ms-step-layer="${index}" src={MS_ASSET(${JSON.stringify(name)})} alt="" ` +
        `style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', objectFit: 'contain' }} />`,
    )
    .join('\n');
  return `function Slide() {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
${layers}
    </div>
  );
}

window.SlideComponent = Slide;
`;
}

/**
 * The page's text: the slide's own words, in the `Slide N: title` shape the rest of the pipeline
 * already reads (see routes/pdfs/slides-upload.ts), so script generation and the AI tutor treat an
 * imported deck like any other.
 */
function slideOutline(slide: PptxSlide): string {
  const [title, ...rest] = slide.paragraphs;
  const lines = [`Slide ${slide.slideNumber}: ${(title ?? '').trim() || '(untitled)'}`];
  for (const line of rest) lines.push(`- ${line}`);
  if (slide.notes.trim()) lines.push('', slide.notes.trim());
  return `${lines.join('\n')}\n`;
}

function deckTitle(slides: PptxSlide[], pptxPath: string): string {
  const first = slides[0]?.paragraphs[0]?.trim();
  if (first) return first.slice(0, 200);
  return path.basename(pptxPath, path.extname(pptxPath)).slice(0, 200);
}

/** Rewrite metadata.json from the rows we just wrote; it is a derived snapshot of the DB. */
async function syncMetadata(pdfId: string): Promise<void> {
  try {
    const meta = await readMetadata(pdfId);
    if (!meta) return;
    const rows = db
      .prepare(
        `SELECT page_number, image_path, text_path, script_path, audio_path, status, render_type, react_slide_path
         FROM pages WHERE pdf_id = ? ORDER BY page_number ASC`,
      )
      .all(pdfId) as Array<Record<string, unknown>>;
    meta.page_count = rows.length;
    meta.updated_at = new Date().toISOString();
    meta.pages = rows.map((row) => ({
      page_number: row.page_number as number,
      image: (row.image_path as string | null) ?? null,
      text: (row.text_path as string | null) ?? null,
      script: (row.script_path as string | null) ?? null,
      audio: (row.audio_path as string | null) ?? null,
      status: row.status as string,
      render_type: (row.render_type as string | null) ?? undefined,
      react_slide_path: (row.react_slide_path as string | null) ?? undefined,
    })) as typeof meta.pages;
    await writeMetadata(pdfId, meta);
  } catch {
    // non-fatal
  }
}
