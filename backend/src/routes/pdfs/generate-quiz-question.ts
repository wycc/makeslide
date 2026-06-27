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

const GeneratedQuizQuestionSchema = z.object({
  question: z.string().trim().min(1).max(400),
  options: z.array(z.string().trim().min(1).max(150)).length(4),
  correct_index: z.number().int().min(0).max(3),
  explanation: z.string().trim().max(500).optional().default(''),
});

interface PageRow {
  script_path: string | null;
  text_path: string | null;
}

export async function registerGenerateQuizQuestionRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/pdfs/:id/pages/:n/generate-quiz-question', async (request, reply) => {
    const parsed = PageParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id or page number'));
    const { id, n } = parsed.data;

    const pdf = db.prepare(`SELECT id, owner_sub, visibility FROM pdfs WHERE id = ?`).get(id) as Pick<PdfRow, 'id' | 'owner_sub' | 'visibility'> | undefined;
    if (!pdf) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    if (!canEditPdf(sessionSub(request), pdf)) return reply.code(403).send(errorResponse('FORBIDDEN', 'No edit permission'));

    const page = db.prepare(`SELECT script_path, text_path FROM pages WHERE pdf_id = ? AND page_number = ?`).get(id, n) as PageRow | undefined;
    if (!page) return reply.code(404).send(errorResponse('PAGE_NOT_FOUND', `Page ${n} not found`));

    const pageScript = readPageText(id, page.script_path);
    const pageText = readPageText(id, page.text_path);
    const context = (pageScript || pageText || '（無逐字稿）').slice(0, 2000);

    const result = await callChatJSON({
      label: 'generate_quiz_question_draft',
      schema: GeneratedQuizQuestionSchema,
      maxTokens: 600,
      temperature: 0.5,
      messages: [
        {
          role: 'system',
          content: '你是教學助教。請根據投影片逐字稿或文字，產生一道四選項單選測驗題目。只回傳 JSON：{"question":"...","options":["選項A","選項B","選項C","選項D"],"correct_index":0,"explanation":"..."}。correct_index 為正確答案的索引（0–3）。explanation 用一句話說明答案。所有欄位必填。',
        },
        {
          role: 'user',
          content: `投影片內容：\n${context}`,
        },
      ],
    });

    const data = result.data;
    return reply.send({
      question: data.question,
      options: data.options,
      correct_index: data.correct_index,
      explanation: data.explanation ?? '',
    });
  });
}
