import type { FastifyInstance } from 'fastify';
import { canEditPdf , aclCtx } from './permissions';
import { z } from 'zod';
import { db } from '../../db';
import type { PdfRow } from '../../types';
import { sessionSub } from '../auth';
import { callChatJSON } from '../../services/openai';
import { safeJoinPdfPath } from '../../services/storage';
import { errorResponse, PageParamSchema } from './shared';
import { shuffleSingleChoice } from '../../services/quizShuffle';
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
  link_pdf_id: string | null;
}

/** Concatenate a linked source presentation's per-page script/text (used for collection pages). */
function readLinkedSourceContext(sourceId: string): string {
  const pages = db
    .prepare(`SELECT script_path, text_path FROM pages WHERE pdf_id = ? ORDER BY page_number ASC`)
    .all(sourceId) as Array<{ script_path: string | null; text_path: string | null }>;
  const chunks = pages
    .map((p) => readPageText(sourceId, p.script_path) || readPageText(sourceId, p.text_path))
    .filter(Boolean);
  return chunks.join('\n\n');
}

export async function registerGenerateQuizQuestionRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/pdfs/:id/pages/:n/generate-quiz-question', async (request, reply) => {
    const parsed = PageParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id or page number'));
    const { id, n } = parsed.data;

    const pdf = db.prepare(`SELECT id, owner_sub, visibility FROM pdfs WHERE id = ?`).get(id) as Pick<PdfRow, 'id' | 'owner_sub' | 'visibility'> | undefined;
    if (!pdf) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    if (!canEditPdf(sessionSub(request), pdf, aclCtx(request, id))) return reply.code(403).send(errorResponse('FORBIDDEN', 'No edit permission'));

    const page = db.prepare(`SELECT script_path, text_path, link_pdf_id FROM pages WHERE pdf_id = ? AND page_number = ?`).get(id, n) as PageRow | undefined;
    if (!page) return reply.code(404).send(errorResponse('PAGE_NOT_FOUND', `Page ${n} not found`));

    // Collection page: draw the question from the linked source's full content, not just the
    // on-page summary. Fall back to the page's own text if the source is gone or empty.
    const linkedContext = page.link_pdf_id ? readLinkedSourceContext(page.link_pdf_id) : '';
    const pageScript = readPageText(id, page.script_path);
    const pageText = readPageText(id, page.text_path);
    const context = (linkedContext || pageScript || pageText || '（無逐字稿）').slice(0, 2000);

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

    // 模型偏好把正解放在第一個選項；不重排的話整份測驗的答案幾乎都會是 A。
    const data = result.data;
    const shuffled = shuffleSingleChoice(data.options, data.correct_index);
    return reply.send({
      question: data.question,
      options: shuffled.options,
      correct_index: shuffled.correctIndex,
      explanation: data.explanation ?? '',
    });
  });
}
