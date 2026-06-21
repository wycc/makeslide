import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createCanvas, DOMMatrix as NodeCanvasDOMMatrix, ImageData as NodeCanvasImageData } from 'canvas';

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

export interface PopplerCheck {
  pdftoppm: boolean;
  pdfinfo: boolean;
  versionOutput: string;
}

/** pdfjs-dist is always available — no external binary needed. */
export async function checkPoppler(): Promise<PopplerCheck> {
  return { pdftoppm: true, pdfinfo: true, versionOutput: 'pdfjs-dist (built-in, no poppler required)' };
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

export async function renderPdfPages(
  pdfPath: string,
  dpi: number,
): Promise<RenderPdfPagesResult> {
  const doc = await openPdf(pdfPath);
  const pageCount = doc.numPages;
  const pages: Buffer[] = [];
  const scale = dpi / 72;

  try {
    for (let i = 1; i <= pageCount; i++) {
      const page = await doc.getPage(i);
      try {
        const viewport = page.getViewport({ scale });
        const w = Math.ceil(viewport.width);
        const h = Math.ceil(viewport.height);
        const cnv = createCanvas(w, h);
        const ctx = cnv.getContext('2d');
        await page.render({ canvasContext: ctx, viewport }).promise;
        pages.push(cnv.toBuffer('image/png'));
      } finally {
        page.cleanup?.();
      }
    }
  } finally {
    await doc.destroy().catch(() => undefined);
  }

  return { pageCount, pages };
}

// ---------------------------------------------------------------------------
// Deprecated stubs — kept so existing import paths compile without change
// ---------------------------------------------------------------------------
/** @deprecated use renderPdfPages() */
export function pdftoppmBin(): string { return 'pdftoppm'; }
/** @deprecated */
export function pdfinfoBin(): string { return 'pdfinfo'; }
/** @deprecated */
export function pdftotextBin(): string { return 'pdftotext'; }
