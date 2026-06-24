import type { FastifyInstance, FastifyRequest } from 'fastify';
import fs from 'node:fs';
import { z } from 'zod';
import sharp from 'sharp';
import { db } from '../../db';
import { decodeSession, parseCookies } from '../auth';
import { pageScriptPath, pageTextPath, pageImagePath } from '../../services/storage';
import { callChatJSON } from '../../services/openai';
import type { PdfRow } from '../../types';
import { IdParamSchema, errorResponse } from './shared';

// Max width for vision analysis (keeps token usage reasonable)
const IMAGE_MAX_WIDTH = 800;

interface PageImageRow {
  page_number: number;
  page_uid: string;
  image_path: string | null;
  script_path: string | null;
  text_path: string | null;
}

export interface ImageMismatchResult {
  pageNumber: number;
  mismatch: boolean;
  detail: string;
}

export interface ImageQualityResponse {
  pages: ImageMismatchResult[];
  analyzedAt: string;
}

const PageAnalysisSchema = z.object({
  mismatch: z.boolean(),
  detail: z.string().max(200),
});

function sessionSub(request: FastifyRequest): string | null {
  const session = decodeSession(parseCookies(request).makeslide_session);
  return session?.sub ?? null;
}

function canReadPdf(sub: string | null, row: Pick<PdfRow, 'owner_sub' | 'visibility'>): boolean {
  if (!row.owner_sub) return true;
  if (sub && row.owner_sub === sub) return true;
  return row.visibility === 'public' || row.visibility === 'public_editable';
}

function readScript(pdfId: string, row: PageImageRow): string {
  const scriptAbs = pageScriptPath(pdfId, row.page_uid);
  const textAbs = pageTextPath(pdfId, row.page_uid);
  try { return fs.readFileSync(scriptAbs, 'utf8').trim(); } catch { /* fall through */ }
  try { return fs.readFileSync(textAbs, 'utf8').trim(); } catch { return ''; }
}

async function loadImageDataUrl(absPath: string): Promise<string | null> {
  try {
    const buf = await sharp(absPath)
      .resize({ width: IMAGE_MAX_WIDTH, withoutEnlargement: true, fit: 'inside' })
      .jpeg({ quality: 80, mozjpeg: true })
      .toBuffer();
    return `data:image/jpeg;base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

export async function registerImageQualityRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/pdfs/:id/image-quality', async (request, reply) => {
    const parsed = IdParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid pdf id'));
    const { id } = parsed.data;

    const pdfRow = db.prepare(`SELECT owner_sub, visibility FROM pdfs WHERE id = ?`).get(id) as
      | Pick<PdfRow, 'owner_sub' | 'visibility'>
      | undefined;
    if (!pdfRow) return reply.code(404).send(errorResponse('NOT_FOUND', 'PDF not found'));
    if (!canReadPdf(sessionSub(request), pdfRow)) return reply.code(403).send(errorResponse('FORBIDDEN', 'Access denied'));

    const pages = db
      .prepare(
        `SELECT page_number, page_uid, image_path, script_path, text_path
           FROM pages WHERE pdf_id = ? AND status = 'ready' ORDER BY page_number ASC`,
      )
      .all(id) as PageImageRow[];

    const results: ImageMismatchResult[] = [];

    for (const row of pages) {
      // Skip pages without both image and script
      const absImagePath = pageImagePath(id, row.page_uid);
      if (!row.image_path || !fs.existsSync(absImagePath)) continue;
      const script = readScript(id, row);
      if (!script) continue;

      const imageDataUrl = await loadImageDataUrl(absImagePath);
      if (!imageDataUrl) continue;

      const result = await callChatJSON({
        label: 'image_quality_mismatch',
        schema: PageAnalysisSchema,
        maxTokens: 300,
        temperature: 0.2,
        messages: [
          {
            role: 'system',
            content:
              '你是投影片品質審核員。你會收到一張投影片圖片和對應的逐字稿文字。請判斷圖片內容是否與逐字稿描述的主題明顯不符（例如：逐字稿提到長條圖但圖片是山脈風景；或逐字稿談論程式碼但圖片是人物照）。僅在有明顯內容不符時回報 mismatch=true，並提供簡短說明（中文，不超過 60 字）。若圖片與逐字稿合理相關，或圖片為純色背景/裝飾性圖片，請回報 mismatch=false。',
          },
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: imageDataUrl, detail: 'low' } },
              { type: 'text', text: `逐字稿內容：\n${script.slice(0, 800)}` },
            ],
          },
        ],
      });

      if (result.data.mismatch) {
        results.push({
          pageNumber: row.page_number,
          mismatch: true,
          detail: result.data.detail,
        });
      }
    }

    return reply.code(200).send({ pages: results, analyzedAt: new Date().toISOString() });
  });
}
