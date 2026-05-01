import fs from 'node:fs';
import { createRequire } from 'node:module';
import { logger } from '../../logger';
import {
  formatPageNumber,
  pageTextPath,
  sourcePdfPath,
  sourceTextPath,
} from '../../services/storage';

// pdfjs-dist v4 ships a CJS legacy build that works in Node without DOM shims.
// We load it via createRequire so tsx/ts-node don't pull in the ESM web build.
const require = createRequire(import.meta.url);

// Lazily cached so we don't pay the init cost repeatedly.
type PdfjsApi = {
  getDocument: (args: { data: Uint8Array; useSystemFonts?: boolean }) => {
    promise: Promise<{
      numPages: number;
      getPage: (n: number) => Promise<{
        getTextContent: () => Promise<{
          items: Array<{ str?: string; hasEOL?: boolean }>;
        }>;
        cleanup?: () => void;
      }>;
      destroy: () => Promise<void>;
    }>;
  };
};

let cachedPdfjs: PdfjsApi | null = null;
function loadPdfjs(): PdfjsApi {
  if (cachedPdfjs) return cachedPdfjs;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require('pdfjs-dist/legacy/build/pdf.mjs') as unknown;
  // CommonJS interop: the legacy build exports either a namespace or default.
  const api =
    (mod as { getDocument?: unknown }).getDocument !== undefined
      ? (mod as PdfjsApi)
      : ((mod as { default: PdfjsApi }).default);
  if (!api || typeof api.getDocument !== 'function') {
    throw new Error('Failed to load pdfjs-dist legacy build');
  }
  cachedPdfjs = api;
  return api;
}

export interface ExtractTextResult {
  /**
   * `pages[n-1]` is true when page `n` had zero non-whitespace text
   * (e.g. scanned PDF without OCR). We still emit an empty `.text.txt` and
   * record the page as `text_ready` — extraction itself did not fail.
   */
  pages: Array<{ pageNumber: number; empty: boolean; textPath: string }>;
}

/**
 * Extract per-page text from a PDF into `storage/<pdfId>/pages/NNN.text.txt`.
 */
export async function extractText(
  pdfId: string,
  pageCount: number,
  onPage?: (pageNumber: number) => void,
): Promise<ExtractTextResult> {
  const sourceTxt = sourceTextPath(pdfId);
  if (fs.existsSync(sourceTxt)) {
    const pages: ExtractTextResult['pages'] = [];
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
      const textPath = pageTextPath(pdfId, pageNumber, pageCount);
      let text = '';
      try {
        text = await fs.promises.readFile(textPath, 'utf8');
      } catch {
        text = '';
        await fs.promises.writeFile(textPath, '', 'utf8');
      }
      pages.push({ pageNumber, empty: text.trim().length === 0, textPath });
      onPage?.(pageNumber);
    }
    return { pages };
  }

  const source = sourcePdfPath(pdfId);
  const data = await fs.promises.readFile(source);

  const pdfjs = loadPdfjs();
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(data),
    useSystemFonts: true,
  });
  const doc = await loadingTask.promise;

  if (doc.numPages !== pageCount) {
    logger.warn(
      { pdfId, pdfjsPages: doc.numPages, pageCount },
      'pdfjs page count mismatch; using provided pageCount',
    );
  }

  const pages: ExtractTextResult['pages'] = [];
  try {
    const limit = Math.min(doc.numPages, pageCount);
    for (let pageNumber = 1; pageNumber <= limit; pageNumber++) {
      const page = await doc.getPage(pageNumber);
      let text = '';
      try {
        const content = await page.getTextContent();
        text = content.items
          .map((it) => {
            const s = typeof it.str === 'string' ? it.str : '';
            return it.hasEOL ? s + '\n' : s;
          })
          .join('')
          .replace(/\u0000/g, '')
          .trim();
      } finally {
        page.cleanup?.();
      }

      const textPath = pageTextPath(pdfId, pageNumber, pageCount);
      await fs.promises.writeFile(textPath, text, 'utf8');

      pages.push({
        pageNumber,
        empty: text.length === 0,
        textPath,
      });
      onPage?.(pageNumber);
    }

    // If pdfjs reported fewer pages than pdfinfo (rare), fill the rest with
    // empty files so the page inventory stays consistent.
    for (let pageNumber = limit + 1; pageNumber <= pageCount; pageNumber++) {
      const textPath = pageTextPath(pdfId, pageNumber, pageCount);
      await fs.promises.writeFile(textPath, '', 'utf8');
      pages.push({ pageNumber, empty: true, textPath });
      onPage?.(pageNumber);
    }
  } finally {
    await doc.destroy().catch(() => undefined);
  }

  const emptyCount = pages.filter((p) => p.empty).length;
  logger.info(
    { pdfId, pageCount, emptyCount, paddedWidth: formatPageNumber(1, pageCount).length },
    'Extracted page text',
  );
  return { pages };
}
