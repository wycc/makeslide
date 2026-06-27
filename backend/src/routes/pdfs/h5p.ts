import type { FastifyInstance, FastifyRequest } from 'fastify';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
const JSZip = require('jszip') as new () => any;

import { db } from '../../db';
import type { PageRow, PdfRow } from '../../types';
import { safeJoinPdfPath, pageImagePath, pageScriptPath, pageTextPath } from '../../services/storage';
import { decodeSession, parseCookies } from '../auth';
import { errorResponse, IdParamSchema } from './shared';

function sessionSub(request: FastifyRequest): string | null {
  const session = decodeSession(parseCookies(request).makeslide_session);
  return session?.sub ?? null;
}

function canReadPdf(sub: string | null, row: Pick<PdfRow, 'owner_sub' | 'visibility'>): boolean {
  if (!row.owner_sub) return true;
  if (sub && row.owner_sub === sub) return true;
  return row.visibility === 'public' || row.visibility === 'public_editable';
}

async function readFileSafe(absPath: string | null): Promise<Buffer | null> {
  if (!absPath) return null;
  try {
    return await fs.readFile(absPath);
  } catch {
    return null;
  }
}

async function readTextSafe(absPath: string | null): Promise<string> {
  if (!absPath) return '';
  try {
    return (await fs.readFile(absPath, 'utf-8')).trim();
  } catch {
    return '';
  }
}

interface H5PSlide {
  elements: H5PElement[];
}

interface H5PElement {
  x: number;
  y: number;
  width: number;
  height: number;
  action: H5PAction;
  backgroundOpacity?: number;
}

interface H5PAction {
  library: string;
  params: Record<string, unknown>;
  subContentId?: string;
  metadata?: Record<string, unknown>;
}

function makeSubContentId(index: number): string {
  return `00000000-0000-0000-0000-${String(index).padStart(12, '0')}`;
}

export async function registerH5pRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/pdfs/:id/export.h5p', async (request, reply) => {
    const parsed = IdParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid pdf id'));
    const { id } = parsed.data;

    const pdfRow = db
      .prepare(`SELECT owner_sub, visibility, title FROM pdfs WHERE id = ?`)
      .get(id) as (Pick<PdfRow, 'owner_sub' | 'visibility'> & { title: string }) | undefined;
    if (!pdfRow) return reply.code(404).send(errorResponse('NOT_FOUND', 'PDF not found'));
    if (!canReadPdf(sessionSub(request), pdfRow)) return reply.code(403).send(errorResponse('FORBIDDEN', 'Access denied'));

    // Completed pages end at the terminal page status 'audio_ready' ('ready' is
    // a PDF-level status, never set on pages, so it matched nothing).
    const pages = db
      .prepare(
        `SELECT page_number, page_uid, image_path, audio_path, script_path, text_path
           FROM pages WHERE pdf_id = ? AND status = 'audio_ready' ORDER BY page_number ASC`,
      )
      .all(id) as PageRow[];

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
    const zip = new JSZip();

    const slides: H5PSlide[] = [];
    let subContentIdx = 1;

    for (const page of pages) {
      const dir = `page_${String(page.page_number).padStart(3, '0')}`;
      const imageAbsPath = page.image_path ? safeJoinPdfPath(id, page.image_path) : pageImagePath(id, page.page_uid);
      const scriptAbsPath = page.script_path ? safeJoinPdfPath(id, page.script_path) : pageScriptPath(id, page.page_uid);
      const textAbsPath = page.text_path ? safeJoinPdfPath(id, page.text_path) : pageTextPath(id, page.page_uid);

      const imgBuf = await readFileSafe(imageAbsPath);
      const script = await readTextSafe(scriptAbsPath) || await readTextSafe(textAbsPath);

      const elements: H5PElement[] = [];

      if (imgBuf) {
        const imgFilename = `images/${dir}.jpg`;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
        zip.file(`content/${imgFilename}`, imgBuf);
        elements.push({
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          action: {
            library: 'H5P.Image 1.1',
            params: {
              contentName: 'Image',
              file: {
                path: imgFilename,
                mime: 'image/jpeg',
                copyright: { license: 'U' },
              },
              alt: `第 ${page.page_number} 頁`,
            },
            subContentId: makeSubContentId(subContentIdx++),
            metadata: { contentType: 'Image', license: 'U', title: `第 ${page.page_number} 頁` },
          },
          backgroundOpacity: 100,
        });
      }

      if (script) {
        elements.push({
          x: 0,
          y: 80,
          width: 100,
          height: 20,
          action: {
            library: 'H5P.AdvancedText 1.1',
            params: { text: `<p>${script.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>` },
            subContentId: makeSubContentId(subContentIdx++),
            metadata: { contentType: 'Text', license: 'U', title: '逐字稿' },
          },
        });
      }

      slides.push({ elements });
    }

    const contentJson = {
      presentation: {
        slides,
        globalBackgroundSelector: {},
        keywordListEnabled: true,
        keywordListAlwaysShow: false,
        keywordListAutoHide: false,
        keywordListOpacity: 90,
      },
      overrideShowSolutionButton: 'off',
      overrideRetry: 'off',
    };

    const h5pJson = {
      title: pdfRow.title || 'MakeSlide Presentation',
      language: 'zh',
      mainLibrary: 'H5P.CoursePresentation',
      embedTypes: ['iframe'],
      license: 'U',
      preloadedDependencies: [
        { machineName: 'H5P.CoursePresentation', majorVersion: 1, minorVersion: 25 },
        { machineName: 'H5P.Image', majorVersion: 1, minorVersion: 1 },
        { machineName: 'H5P.AdvancedText', majorVersion: 1, minorVersion: 1 },
        { machineName: 'FontAwesome', majorVersion: 4, minorVersion: 5 },
        { machineName: 'H5P.JoubelUI', majorVersion: 1, minorVersion: 3 },
        { machineName: 'H5P.Transition', majorVersion: 1, minorVersion: 0 },
        { machineName: 'H5P.FontIcons', majorVersion: 1, minorVersion: 0 },
      ],
    };

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    zip.file('h5p.json', JSON.stringify(h5pJson, null, 2));
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    zip.file('content/content.json', JSON.stringify(contentJson, null, 2));

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const zipBuffer: Buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });

    const safeTitle = (pdfRow.title || id).replace(/[^\w一-鿿-]/g, '_').slice(0, 60);
    await reply
      .code(200)
      .header('Content-Type', 'application/zip')
      .header('Content-Disposition', `attachment; filename="${safeTitle}.h5p"`)
      .send(zipBuffer);
  });
}
