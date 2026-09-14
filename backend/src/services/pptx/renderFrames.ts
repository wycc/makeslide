/**
 * Turning a pptx into the pictures a makeslide page shows: one JPEG per animation step
 * (docs/pptx-animated-import-design.md §1, §5 step 3).
 *
 * LibreOffice does the drawing. That is the whole point — the frames come out of the same engine
 * that would show the original file, so the import never has to reproduce a layout, a font
 * fallback or a chart. What this module adds is the animation: a step's frame is rendered from a
 * *variant* of the deck in which the shapes that have not been clicked into view yet are removed
 * (see parsePptx.buildStepSlideXml).
 *
 * Cost control: a frame that is identical to the file as authored comes from one conversion of the
 * deck as given, and only the others need a variant each. For the reference deck that is 110
 * variants instead of 136.
 *
 * "Identical to the file as authored" is asked of `hiddenShapeIdsForStep` rather than assumed of
 * the last frame: a slide with an exit effect ends in a state the file does not contain, because
 * the file still has the shapes that left the screen. Taking the last frame from the original there
 * drew every departed shape back on top of the final one, and lost the real final state
 * altogether — it was never rendered.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { config } from '../../config';
import { logger } from '../../logger';
import { pdftoppmBin, runCommand } from '../../worker/poppler';
import { openPptx, type PptxArchive } from './pptxArchive';
import { buildStepSlideXml, hiddenShapeIdsForStep, type PptxSlide } from './parsePptx';

/** A picture to produce: slide `slideNumber` as it looks after `stepIndex` clicks. */
export interface FrameRequest {
  slideNumber: number;
  stepIndex: number;
  /** Absolute path of the JPEG to write. */
  outPath: string;
}

export interface RenderFramesOptions {
  /** Parsed slides, in deck order (index 0 = slide 1). */
  slides: PptxSlide[];
  width: number;
  height: number;
  /** Rendering DPI for the intermediate PNG; 192 gives ~1920px across a 16:9 deck. */
  dpi?: number;
  /** Called after each frame is written, for job progress. */
  onFrame?: (done: number, total: number) => void;
  signal?: { aborted: boolean };
}

export class LibreOfficeUnavailableError extends Error {
  constructor(detail: string) {
    super(`LibreOffice is required to import a pptx but is not usable: ${detail}`);
    this.name = 'LibreOfficeUnavailableError';
  }
}

const CONVERT_TIMEOUT_MS = 10 * 60_000;
const RASTERIZE_TIMEOUT_MS = 2 * 60_000;
/** How many variant files to hand one LibreOffice run. Startup dominates, so batching matters. */
const CONVERT_BATCH = 20;
const DEFAULT_DPI = 192;
const JPEG_QUALITY = 88;

export function libreOfficeBin(): string {
  return config.libreOfficeBin || 'soffice';
}

/** Whether LibreOffice can be run at all; the import refuses up front rather than making blanks. */
export async function checkLibreOffice(): Promise<{ available: boolean; versionOutput: string }> {
  try {
    const { stdout, stderr } = await runCommand(libreOfficeBin(), ['--version'], { timeoutMs: 60_000 });
    const versionOutput = `${stdout}${stderr}`.trim();
    return { available: /libreoffice/i.test(versionOutput), versionOutput };
  } catch (err) {
    return { available: false, versionOutput: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Render the requested frames.
 *
 * Every frame is written as a `width`x`height` JPEG, letterboxed on white if the deck's aspect
 * ratio differs from the page's, so a 4:3 source deck does not come out stretched.
 */
export async function renderPptxFrames(
  pptxPath: string,
  requests: FrameRequest[],
  options: RenderFramesOptions,
): Promise<void> {
  if (requests.length === 0) return;
  const check = await checkLibreOffice();
  if (!check.available) throw new LibreOfficeUnavailableError(check.versionOutput || 'not found');

  const archive = await openPptx(pptxPath);
  const workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'makeslide-pptx-frames-'));
  const dpi = options.dpi ?? DEFAULT_DPI;
  let done = 0;
  try {
    // Frames that are just "the slide as authored" all come from one conversion of the original.
    const fromOriginal: FrameRequest[] = [];
    const needsVariant: FrameRequest[] = [];
    for (const request of requests) {
      const slide = options.slides[request.slideNumber - 1];
      if (canRenderFromOriginal(slide, request.stepIndex)) fromOriginal.push(request);
      else needsVariant.push(request);
    }

    if (fromOriginal.length > 0) {
      const [basePdf] = await convertToPdfBatch([pptxPath], workDir);
      for (const request of fromOriginal) {
        if (options.signal?.aborted) throw new Error('cancelled');
        await rasterize(basePdf!, request.slideNumber, request.outPath, options, dpi);
        options.onFrame?.((done += 1), requests.length);
      }
    }

    // The rest: one variant file per frame, converted in batches.
    for (let i = 0; i < needsVariant.length; i += CONVERT_BATCH) {
      if (options.signal?.aborted) throw new Error('cancelled');
      const batch = needsVariant.slice(i, i + CONVERT_BATCH);
      const files: string[] = [];
      for (const request of batch) {
        const slide = options.slides[request.slideNumber - 1]!;
        const original = (await archive.readText(slide.partName))!;
        const variantXml = buildStepSlideXml(original, slide.steps, request.stepIndex);
        const buffer = await archive.writeWith(new Map([[slide.partName, variantXml]]));
        const file = path.join(workDir, `s${request.slideNumber}-k${request.stepIndex}.pptx`);
        await fs.promises.writeFile(file, buffer);
        files.push(file);
      }
      const pdfs = await convertToPdfBatch(files, workDir);
      for (const [index, request] of batch.entries()) {
        await rasterize(pdfs[index]!, request.slideNumber, request.outPath, options, dpi);
        options.onFrame?.((done += 1), requests.length);
      }
      // A batch's inputs are large (the whole deck each); drop them before building the next.
      await Promise.all([...files, ...pdfs].map((f) => fs.promises.rm(f, { force: true })));
    }
  } finally {
    await fs.promises.rm(workDir, { recursive: true, force: true });
  }
}

/**
 * Whether this frame can be taken from the deck as given instead of a rebuilt variant.
 *
 * Only when nothing is hidden at that step. A static slide qualifies at any index, and an animated
 * one qualifies at its last step **only if that step hides nothing** — which an exit effect breaks.
 */
export function canRenderFromOriginal(slide: PptxSlide | undefined, stepIndex: number): boolean {
  const steps = slide?.steps ?? [];
  if (steps.length === 0) return true;
  if (stepIndex < steps.length) return false;
  return hiddenShapeIdsForStep(steps, stepIndex).size === 0;
}

/** Convert one batch of pptx files to PDFs in `outDir`, returning their paths in input order. */
async function convertToPdfBatch(files: string[], outDir: string): Promise<string[]> {
  if (files.length === 0) return [];
  const profileDir = path.join(outDir, 'lo-profile');
  // A private user profile: without it a LibreOffice already running as this user (a desktop
  // session, or a parallel import) makes the headless run exit without converting anything.
  await runCommand(
    libreOfficeBin(),
    [
      `-env:UserInstallation=file://${profileDir}`,
      '--headless',
      '--norestore',
      '--convert-to',
      'pdf',
      '--outdir',
      outDir,
      ...files,
    ],
    { timeoutMs: CONVERT_TIMEOUT_MS },
  );
  const pdfs = files.map((file) => path.join(outDir, `${path.basename(file, path.extname(file))}.pdf`));
  for (const pdf of pdfs) {
    if (!fs.existsSync(pdf)) {
      throw new Error(`LibreOffice produced no PDF for ${path.basename(pdf, '.pdf')}.pptx`);
    }
  }
  return pdfs;
}

/** One page of a PDF → a page-sized JPEG. */
async function rasterize(
  pdfPath: string,
  pageNumber: number,
  outPath: string,
  options: RenderFramesOptions,
  dpi: number,
): Promise<void> {
  const tmpPrefix = `${outPath}.raw`;
  await runCommand(
    pdftoppmBin(),
    ['-png', '-r', String(dpi), '-f', String(pageNumber), '-l', String(pageNumber), pdfPath, tmpPrefix],
    { timeoutMs: RASTERIZE_TIMEOUT_MS },
  );
  const dir = path.dirname(outPath);
  const base = path.basename(tmpPrefix);
  const produced = (await fs.promises.readdir(dir)).find((name) => name.startsWith(`${base}-`) && name.endsWith('.png'));
  if (!produced) throw new Error(`pdftoppm produced no image for page ${pageNumber} of ${path.basename(pdfPath)}`);
  const rawPath = path.join(dir, produced);
  try {
    await sharp(rawPath)
      .resize(options.width, options.height, { fit: 'contain', background: { r: 255, g: 255, b: 255 } })
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
      .toFile(outPath);
  } finally {
    await fs.promises.rm(rawPath, { force: true });
  }
  logger.debug({ outPath, pageNumber }, 'pptx import: frame rendered');
}
