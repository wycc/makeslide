import type { FastifyInstance } from 'fastify';
import { canEditPdf } from './permissions';
import { z } from 'zod';
import { db } from '../../db';
import type { PdfRow } from '../../types';
import { sessionSub } from '../auth';
import { callChatJSON } from '../../services/openai';
import { safeJoinPdfPath } from '../../services/storage';
import { errorResponse, PageParamSchema } from './shared';
import fs from 'node:fs';

function readPageText(pdfId: string, relativePath: string | null): string {
  if (!relativePath) return '';
  try { return fs.readFileSync(safeJoinPdfPath(pdfId, relativePath), 'utf8').trim(); } catch { return ''; }
}

const GeneratedPollSchema = z.object({
  question: z.string().trim().min(1).max(300),
  options: z.array(z.string().trim().min(1).max(120)).min(2).max(4),
});

// When the user already typed a question, the model only needs to produce options.
const GeneratedOptionsSchema = z.object({
  options: z.array(z.string().trim().min(1).max(120)).min(2).max(4),
});

const GeneratePollBodySchema = z.object({
  question: z.string().trim().max(300).optional(),
});

interface PageRow {
  script_path: string | null;
  text_path: string | null;
}

export async function registerGeneratePollRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/pdfs/:id/pages/:n/generate-poll', async (request, reply) => {
    const parsed = PageParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id or page number'));
    const { id, n } = parsed.data;

    const pdf = db.prepare(`SELECT id, owner_sub, visibility FROM pdfs WHERE id = ?`).get(id) as Pick<PdfRow, 'id' | 'owner_sub' | 'visibility'> | undefined;
    if (!pdf) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    if (!canEditPdf(sessionSub(request), pdf)) return reply.code(403).send(errorResponse('FORBIDDEN', 'No edit permission'));

    const page = db.prepare(`SELECT script_path, text_path FROM pages WHERE pdf_id = ? AND page_number = ?`).get(id, n) as PageRow | undefined;
    if (!page) return reply.code(404).send(errorResponse('PAGE_NOT_FOUND', `Page ${n} not found`));

    const parsedBody = GeneratePollBodySchema.safeParse(request.body ?? {});
    if (!parsedBody.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid request body'));
    const providedQuestion = parsedBody.data.question?.trim() ?? '';

    const pageScript = readPageText(id, page.script_path);
    const pageText = readPageText(id, page.text_path);
    const context = (pageScript || pageText || '（無逐字稿）').slice(0, 2000);

    if (providedQuestion) {
      // The teacher already typed a question — only generate options for it.
      const result = await callChatJSON({
        label: 'generate_poll_options',
        schema: GeneratedOptionsSchema,
        maxTokens: 400,
        temperature: 0.5,
        messages: [
          {
            role: 'system',
            content: '你是教學助教。使用者已經給定一道課堂單選投票題目，請只根據投影片內容為「這道題目」產生合適的選項。只回傳 JSON：{"options":["選項A","選項B","選項C"]}。選項 2 到 4 個，文字精簡，彼此互斥、貼合題意，不含答案提示。',
          },
          {
            role: 'user',
            content: `題目：${providedQuestion}\n\n投影片內容：\n${context}`,
          },
        ],
      });
      return reply.send({ question: providedQuestion, options: result.data.options });
    }

    const result = await callChatJSON({
      label: 'generate_poll_draft',
      schema: GeneratedPollSchema,
      maxTokens: 500,
      temperature: 0.5,
      messages: [
        {
          role: 'system',
          content: '你是教學助教。請根據投影片逐字稿或文字，產生一道適合課堂討論的單選投票題目。只回傳 JSON：{"question":"...","options":["選項A","選項B","選項C"]}。選項 2 到 4 個，文字精簡，不含答案提示。',
        },
        {
          role: 'user',
          content: `投影片內容：\n${context}`,
        },
      ],
    });

    return reply.send({ question: result.data.question, options: result.data.options });
  });
}
