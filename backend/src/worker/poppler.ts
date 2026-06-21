import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createCanvas, DOMMatrix as NodeCanvasDOMMatrix, ImageData as NodeCanvasImageData } from 'canvas';
import { config } from '../config';

// The page-to-JPEG pipeline (renderPdfPages(), below) shells out to the real `pdftoppm`
// binary — see its own comment for why. pdf.js + NodeCanvasFactory is still used for
// extractPdfFigures.ts's vector-figure cropping (needs pdf.js's operator list) and for
// extractPdfTextPages()/getPdfPageCount() (text/page-count don't need canvas rendering at
// all), so the Node/canvas-library compatibility patches below remain necessary for those.
//
// pdfjs-dist uses createImageBitmap and ImageDecoder (both available in Node.js 18+
// and Electron) to produce ImageBitmap / ImageDecoderFrame objects for embedded images.
// node-canvas's ctx.drawImage() does not accept these types → "Image or Canvas expected".
//
// The #getImage() path in pdf.worker is called unconditionally for RGB/Grayscale images
// regardless of isOffscreenCanvasSupported, so removing the APIs is the only reliable fix.
delete (globalThis as Record<string, unknown>).createImageBitmap;
delete (globalThis as Record<string, unknown>).ImageDecoder;

// pdfjs-dist's Node-environment shim (display/node_utils.js) polyfills `DOMMatrix`/`ImageData`
// from `@napi-rs/canvas` whenever they're not already on globalThis — a *different* native
// canvas module from the `canvas` (node-canvas) package NodeCanvasFactory below uses. Objects
// from one library fail `instanceof` checks inside the other's canvas code, e.g.
// RadialAxialShadingPattern.getPattern() does `pattern.setTransform(new DOMMatrix(inverse))`,
// and node-canvas's CanvasPattern.setTransform() throws "Expected DOMMatrix" because the
// instance came from @napi-rs/canvas instead of node-canvas — breaking any PDF page that uses
// an axial/radial shading pattern fill. Pre-setting these from `canvas` satisfies pdfjs-dist's
// `if (!globalThis.X)` checks before it ever reaches for the incompatible @napi-rs/canvas ones.
if (!('DOMMatrix' in globalThis)) (globalThis as Record<string, unknown>).DOMMatrix = NodeCanvasDOMMatrix;
if (!('ImageData' in globalThis)) (globalThis as Record<string, unknown>).ImageData = NodeCanvasImageData;

// ---------------------------------------------------------------------------
// runCommand — generic process runner (still used by generateVideo.ts)
// ---------------------------------------------------------------------------

export interface CommandResult {
  stdout: string;
  stderr: string;
}

export function runCommand(
  cmd: string,
  args: string[],
  options: { cwd?: string; timeoutMs?: number } = {},
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: options.cwd });
    let stdout = '';
    let stderr = '';
    let timeoutHandle: NodeJS.Timeout | null = null;
    let killed = false;

    if (options.timeoutMs) {
      timeoutHandle = setTimeout(() => {
        killed = true;
        child.kill('SIGKILL');
      }, options.timeoutMs);
    }

    child.stdout.on('data', (d: Buffer) => { stdout += d.toString('utf8'); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString('utf8'); });
    child.on('error', (err) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      reject(err);
    });
    child.on('close', (code) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (killed) { reject(new Error(`${cmd} killed after timeout`)); return; }
      if (code !== 0) {
        reject(new Error(`${cmd} exited with code ${code}: ${stderr.trim() || stdout.trim()}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

// ---------------------------------------------------------------------------
// pdfjs-dist — loaded via createRequire so we use the legacy CJS build
// (same pattern as extractText.ts)
// ---------------------------------------------------------------------------

const _require = createRequire(import.meta.url);

type PdfjsViewport = { width: number; height: number };

type PdfjsPage = {
  getViewport: (params: { scale: number; rotation?: number }) => PdfjsViewport;
  render: (params: { canvasContext: unknown; viewport: PdfjsViewport }) => { promise: Promise<void> };
  getTextContent: () => Promise<{ items: Array<{ str?: string; hasEOL?: boolean }> }>;
  cleanup?: () => void;
};

type PdfjsDoc = {
  numPages: number;
  getPage: (n: number) => Promise<PdfjsPage>;
  destroy: () => Promise<void>;
};

type PdfjsApi = {
  getDocument: (args: {
    data: Uint8Array;
    useSystemFonts?: boolean;
    CanvasFactory?: unknown;
    standardFontDataUrl?: string;
    cMapUrl?: string;
    cMapPacked?: boolean;
  }) => {
    promise: Promise<PdfjsDoc>;
  };
};

let _pdfjs: PdfjsApi | null = null;

function loadPdfjs(): PdfjsApi {
  if (_pdfjs) return _pdfjs;
  const mod = _require('pdfjs-dist/legacy/build/pdf.mjs') as unknown;
  const api =
    (mod as { getDocument?: unknown }).getDocument !== undefined
      ? (mod as PdfjsApi)
      : (mod as { default: PdfjsApi }).default;
  if (!api || typeof api.getDocument !== 'function') {
    throw new Error('Failed to load pdfjs-dist legacy build');
  }
  _pdfjs = api;
  return api;
}

// pdfjs-dist's Node `StandardFontDataFactory`/`CMapReaderFactory` read font/CMap data via
// `fs.readFile(`${baseUrl}${filename}`)` (see display/node_utils.js) — without an explicit
// base directory, `baseUrl` stays null and every lookup throws "Ensure that the
// `standardFontDataUrl` API parameter is provided.", silently swallowed deep inside pdf.js's
// font-loading code. The practical effect: any text using a *non-embedded* standard font (e.g.
// Calibri/Arial text PowerPoint didn't bother to embed, or SmartArt/timeline label text) — or,
// for CID-keyed embedded CJK fonts, text needing a predefined CMap — renders as nothing, while
// vector paths, raster images and text in *embedded* fonts with simple encodings render fine.
// Both directories ship inside the pdfjs-dist package itself, so point at them directly.
const PDFJS_PACKAGE_DIR = path.dirname(_require.resolve('pdfjs-dist/package.json'));
const STANDARD_FONT_DATA_URL = path.join(PDFJS_PACKAGE_DIR, 'standard_fonts') + path.sep;
const CMAP_URL = path.join(PDFJS_PACKAGE_DIR, 'cmaps') + path.sep;

// ---------------------------------------------------------------------------
// NodeCanvasFactory — pdf.js's built-in Node canvas factory creates canvases via
// `@napi-rs/canvas`, which is a *different* native module than the `canvas`
// (node-canvas) package we use for our own canvasContext. A canvas created by
// one library is not a valid `drawImage()` argument for a context from the
// other ("Image or Canvas expected"), which breaks rendering of any page that
// contains an image XObject (regular or inline) — pdf.js paints those onto
// intermediate canvases obtained from this factory. Supplying our own factory
// (backed by `canvas`) keeps every canvas pdf.js touches on the same library
// as `canvasContext`.
// ---------------------------------------------------------------------------
type NodeCanvasAndContext = { canvas: ReturnType<typeof createCanvas> | null; context: ReturnType<ReturnType<typeof createCanvas>['getContext']> | null };

export class NodeCanvasFactory {
  create(width: number, height: number): NodeCanvasAndContext {
    if (width <= 0 || height <= 0) throw new Error('Invalid canvas size');
    const canvas = createCanvas(width, height);
    return { canvas, context: canvas.getContext('2d') };
  }
  reset(canvasAndContext: NodeCanvasAndContext, width: number, height: number): void {
    if (!canvasAndContext.canvas) throw new Error('Canvas is not specified');
    if (width <= 0 || height <= 0) throw new Error('Invalid canvas size');
    canvasAndContext.canvas.width = width;
    canvasAndContext.canvas.height = height;
  }
  destroy(canvasAndContext: NodeCanvasAndContext): void {
    if (!canvasAndContext.canvas) throw new Error('Canvas is not specified');
    canvasAndContext.canvas.width = 0;
    canvasAndContext.canvas.height = 0;
    canvasAndContext.canvas = null;
    canvasAndContext.context = null;
  }
}

async function openPdf(pdfPath: string): Promise<PdfjsDoc> {
  const data = await fs.promises.readFile(pdfPath);
  return loadPdfjs().getDocument({
    data: new Uint8Array(data),
    useSystemFonts: true,
    CanvasFactory: NodeCanvasFactory,
    standardFontDataUrl: STANDARD_FONT_DATA_URL,
    cMapUrl: CMAP_URL,
    cMapPacked: true,
  }).promise;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function resolveBin(name: string): string {
  if (config.popplerBinPath) return path.join(config.popplerBinPath, name);
  return name;
}

export function pdftoppmBin(): string { return resolveBin('pdftoppm'); }
export function pdfinfoBin(): string { return resolveBin('pdfinfo'); }
/** @deprecated text extraction goes through pdfjs-dist's getTextContent(), not pdftotext. */
export function pdftotextBin(): string { return resolveBin('pdftotext'); }

export interface PopplerCheck {
  pdftoppm: boolean;
  pdfinfo: boolean;
  versionOutput: string;
}

/** renderPdfPages() shells out to the real `pdftoppm` binary, so it must actually be on PATH (or POPPLER_BIN_PATH). */
export async function checkPoppler(): Promise<PopplerCheck> {
  const check: PopplerCheck = { pdftoppm: false, pdfinfo: false, versionOutput: '' };
  // pdftoppm/pdfinfo -v write to stderr and exit 0 on most builds, non-zero on some;
  // "no error spawning" (i.e. the binary was found) is treated as success either way.
  const r1 = await runCommand(pdftoppmBin(), ['-v'], { timeoutMs: 5000 }).catch((err) => ({ stdout: '', stderr: String(err) }));
  check.pdftoppm = !/ENOENT/.test(r1.stderr);
  check.versionOutput += r1.stderr || r1.stdout;
  const r2 = await runCommand(pdfinfoBin(), ['-v'], { timeoutMs: 5000 }).catch((err) => ({ stdout: '', stderr: String(err) }));
  check.pdfinfo = !/ENOENT/.test(r2.stderr);
  check.versionOutput += `\n${r2.stderr || r2.stdout}`;
  return check;
}

export async function getPdfPageCount(pdfPath: string): Promise<number> {
  const doc = await openPdf(pdfPath);
  const n = doc.numPages;
  await doc.destroy().catch(() => undefined);
  return n;
}

/** Extracts text content per page, one entry per PDF page (index 0 = page 1). */
export async function extractPdfTextPages(pdfPath: string): Promise<string[]> {
  const doc = await openPdf(pdfPath);
  const pages: string[] = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      try {
        const content = await page.getTextContent();
        const pageText = content.items
          .map((it) => {
            const s = typeof it.str === 'string' ? it.str : '';
            return it.hasEOL ? s + '\n' : s;
          })
          .join('');
        pages.push(pageText);
      } finally {
        page.cleanup?.();
      }
    }
  } finally {
    await doc.destroy().catch(() => undefined);
  }
  return pages;
}

export async function extractPdfText(pdfPath: string): Promise<string> {
  const pages = await extractPdfTextPages(pdfPath);
  return pages.join('\n').replace(/ /g, '').trim();
}

export interface RenderPdfPagesResult {
  pageCount: number;
  /** PNG buffers, one per page (index 0 = page 1). */
  pages: Buffer[];
}

const RENDER_PDFTOPPM_TIMEOUT_MS = 5 * 60_000;

/**
 * Renders every page to a PNG via the real `pdftoppm` (Poppler) binary, not pdf.js.
 *
 * Some PDFs — notably ones exported from PowerPoint/WPS with embedded CID TrueType font
 * subsets — defeat pdf.js's glyph-to-character mapping: `getTextContent()` (and so
 * extractPdfTextPages() below) returns the correct text, but `page.render()` paints nothing
 * for those glyphs (`fontChar` resolves to an empty string inside pdf.js's font code), so the
 * rendered slide image is missing all of its text while vector art/raster images render fine.
 * Poppler renders the same PDF correctly. This used to render via pdf.js + NodeCanvasFactory
 * (avoiding the `pdftoppm` system-binary dependency, friendlier to Electron packaging — see
 * docs/pdf-figure-extraction-design.md §12.5), but missing text in the visible slide image is
 * worse than depending on a binary the Docker image already installs (see Dockerfile).
 */
export async function renderPdfPages(
  pdfPath: string,
  dpi: number,
): Promise<RenderPdfPagesResult> {
  const pageCount = await getPdfPageCount(pdfPath);
  if (pageCount <= 0) return { pageCount, pages: [] };

  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'makeslide-render-pdf-'));
  try {
    const prefix = path.join(tmpDir, 'page');
    await runCommand(pdftoppmBin(), ['-png', '-r', String(dpi), pdfPath, prefix], {
      timeoutMs: RENDER_PDFTOPPM_TIMEOUT_MS,
    });
    const entries = await fs.promises.readdir(tmpDir);
    const numbered = entries
      .map((name) => {
        const match = /^page-(\d+)\.png$/.exec(name);
        return match ? { name, n: Number(match[1]) } : null;
      })
      .filter((entry): entry is { name: string; n: number } => entry !== null)
      .sort((a, b) => a.n - b.n);
    if (numbered.length !== pageCount) {
      throw new Error(`pdftoppm rendered ${numbered.length} pages but pdf.js reported ${pageCount}`);
    }
    const pages = await Promise.all(numbered.map((entry) => fs.promises.readFile(path.join(tmpDir, entry.name))));
    return { pageCount, pages };
  } finally {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  }
}
