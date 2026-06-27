import type { FastifyInstance, FastifyRequest } from 'fastify';
import { canReadPdf } from './permissions';
import fs from 'node:fs';
import { z } from 'zod';
import { db } from '../../db';
import type { PdfRow } from '../../types';
import { decodeSession, parseCookies } from '../auth';
import { safeJoinPdfPath, pageScriptPath, pageTextPath } from '../../services/storage';
import { callChatJSON } from '../../services/openai';
import { errorResponse, IdParamSchema } from './shared';

function sessionSub(request: FastifyRequest): string | null {
  const session = decodeSession(parseCookies(request).makeslide_session);
  return session?.sub ?? null;
}

interface PageScriptRow {
  page_number: number;
  page_uid: string;
  script_path: string | null;
  text_path: string | null;
}

function readScript(pdfId: string, row: PageScriptRow): string {
  const scriptAbs = row.script_path ? safeJoinPdfPath(pdfId, row.script_path) : pageScriptPath(pdfId, row.page_uid);
  const textAbs = row.text_path ? safeJoinPdfPath(pdfId, row.text_path) : pageTextPath(pdfId, row.page_uid);
  try { return fs.readFileSync(scriptAbs, 'utf8').trim(); } catch { /* fall through */ }
  try { return fs.readFileSync(textAbs, 'utf8').trim(); } catch { return ''; }
}

export interface ScriptContextBreak {
  pageNumber: number;
  nextPageNumber: number;
  suggestion: string;
}

export interface ScriptQualityResponse {
  contextBreaks: ScriptContextBreak[];
  analyzedAt: string;
}

const ContextBreaksSchema = z.object({
  breaks: z.array(
    z.object({
      page_number: z.number().int().min(1),
      next_page_number: z.number().int().min(1),
      suggestion: z.string().min(1).max(400),
    }),
  ),
});

export async function registerScriptQualityRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/pdfs/:id/script-quality', async (request, reply) => {
    const parsed = IdParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid pdf id'));
    const { id } = parsed.data;

    const pdfRow = db.prepare(`SELECT owner_sub, visibility FROM pdfs WHERE id = ?`).get(id) as
      | Pick<PdfRow, 'owner_sub' | 'visibility'>
      | undefined;
    if (!pdfRow) return reply.code(404).send(errorResponse('NOT_FOUND', 'PDF not found'));
    if (!canReadPdf(sessionSub(request), pdfRow)) return reply.code(403).send(errorResponse('FORBIDDEN', 'Access denied'));

    // Completed pages end at the terminal page status 'audio_ready' ('ready' is
    // a PDF-level status, never set on pages, so it matched nothing).
    const pages = db
      .prepare(
        `SELECT page_number, page_uid, script_path, text_path
           FROM pages WHERE pdf_id = ? AND status = 'audio_ready' ORDER BY page_number ASC`,
      )
      .all(id) as PageScriptRow[];

    if (pages.length < 2) {
      return reply.code(200).send({ contextBreaks: [], analyzedAt: new Date().toISOString() });
    }

    const pageScripts = pages.map((p) => ({
      n: p.page_number,
      text: readScript(id, p).slice(0, 500),
    }));

    const scriptSummary = pageScripts
      .map((p) => `第 ${p.n} 頁：${p.text || '（無逐字稿）'}`)
      .join('\n\n');

    const result = await callChatJSON({
      label: 'script_quality_context_break',
      schema: ContextBreaksSchema,
      maxTokens: 1200,
      temperature: 0.3,
      messages: [
        {
          role: 'system',
          content:
            '你是一位教學設計顧問。請分析以下各頁逐字稿，找出相鄰頁面間有明顯脈絡斷裂的地方（例如：前頁預告下一個主題，但後頁卻跳到無關的內容；或前後頁的主題毫無銜接）。只回報真正有問題的相鄰對，不要過度報告。對每個斷裂，說明第幾頁到第幾頁，並給出簡短的修改建議（中文，不超過 80 字）。若整份簡報銜接良好，回傳空陣列。',
        },
        {
          role: 'user',
          content: `以下是簡報各頁逐字稿摘要，請以 JSON 格式回傳 breaks 陣列（每個元素含 page_number、next_page_number、suggestion）：\n\n${scriptSummary.slice(0, 12000)}`,
        },
      ],
    });

    const contextBreaks: ScriptContextBreak[] = result.data.breaks.map((b) => ({
      pageNumber: b.page_number,
      nextPageNumber: b.next_page_number,
      suggestion: b.suggestion,
    }));

    return reply.code(200).send({ contextBreaks, analyzedAt: new Date().toISOString() });
  });
}
