import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { canEditPdf, aclCtx } from './permissions';
import { db } from '../../db';
import { buildQuizPaperHtml, renderQuizPaperPdf } from '../../services/quizPaperPdf';
import { BakeUnavailableError } from '../../services/reactSlideBake';
import { QuizQuestionsSchema } from './quizzes';
import type { PdfRow } from '../../types';
import { sessionSub } from '../auth';
import { errorResponse } from './shared';
import { pdfDownloadFilename, buildContentDisposition } from './downloadFilename';

const ParamSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{6,}$/),
  quizId: z.string().regex(/^[1-9]\d{0,9}$/).transform(Number),
});

const QuerySchema = z.object({
  variant: z.enum(['paper', 'answers']).default('paper'),
  lang: z.enum(['zh-TW', 'en']).default('zh-TW'),
});

export async function registerQuizPaperRoutes(app: FastifyInstance): Promise<void> {
  // Teacher-only for both variants: students get the questions through the quiz session, under its
  // timing and proctoring, not as a file they can take away beforehand.
  app.get('/api/pdfs/:id/quizzes/:quizId/paper.pdf', async (request, reply) => {
    const parsed = ParamSchema.safeParse(request.params);
    const query = QuerySchema.safeParse(request.query ?? {});
    if (!parsed.success || !query.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid quiz parameters'));

    const row = db
      .prepare(`SELECT id, title, original_filename, owner_sub, visibility FROM pdfs WHERE id = ?`)
      .get(parsed.data.id) as Pick<PdfRow, 'id' | 'title' | 'original_filename' | 'owner_sub' | 'visibility'> | undefined;
    if (!row) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${parsed.data.id} not found`));
    if (!canEditPdf(sessionSub(request), row, aclCtx(request, parsed.data.id))) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限下載試卷'));
    }
    const quiz = db
      .prepare(`SELECT id, title, questions_json, time_limit_seconds FROM quiz_sets WHERE id = ? AND pdf_id = ?`)
      .get(parsed.data.quizId, parsed.data.id) as { id: number; title: string; questions_json: string; time_limit_seconds: number | null } | undefined;
    if (!quiz) return reply.code(404).send(errorResponse('QUIZ_NOT_FOUND', `Quiz ${parsed.data.quizId} not found`));

    let rawQuestions: unknown = [];
    try {
      rawQuestions = JSON.parse(quiz.questions_json);
    } catch {
      rawQuestions = [];
    }
    const questions = QuizQuestionsSchema.safeParse(rawQuestions);
    if (!questions.success) return reply.code(422).send(errorResponse('QUIZ_INVALID', '這份測驗的題目無法讀取'));

    const html = buildQuizPaperHtml({
      quizTitle: quiz.title,
      deckTitle: row.title,
      timeLimitSeconds: quiz.time_limit_seconds ?? 0,
      questions: questions.data,
      variant: query.data.variant,
      lang: query.data.lang,
    });
    let pdf: Buffer;
    try {
      pdf = await renderQuizPaperPdf(html);
    } catch (err) {
      if (err instanceof BakeUnavailableError) {
        return reply.code(503).send(errorResponse('PDF_UNAVAILABLE', '伺服器沒有可用的 Chrome，無法產生 PDF'));
      }
      throw err;
    }

    const filename = pdfDownloadFilename(quiz.title, `${parsed.data.id}-${quiz.id}`, {
      titleSuffix: query.data.variant,
      fallbackPrefix: 'quiz-paper',
    });
    reply.header('content-type', 'application/pdf');
    reply.header('content-disposition', buildContentDisposition(filename));
    reply.header('cache-control', 'no-store');
    return reply.send(pdf);
  });
}
