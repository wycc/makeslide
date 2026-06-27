import type { FastifyInstance } from 'fastify';
import { canEditPdf } from './permissions';
import { db } from '../../db';
import type { PdfRow } from '../../types';
import { sessionSub } from '../auth';
import { errorResponse, IdParamSchema } from './shared';
import { csvEscape, withCsvBom } from './csv';
import { safeDownloadBaseName, buildContentDisposition } from './downloadFilename';

interface AttemptRow {
  id: number;
  quiz_id: number;
  quiz_title: string;
  client_id: string;
  code: string | null;
  score: number | null;
  submitted_at: string;
  answers_json: string;
}

export async function registerQuizResultsCsvRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/pdfs/:id/quiz-results.csv', async (request, reply) => {
    const parsed = IdParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id parameter'));

    const row = db
      .prepare(`SELECT id, title, original_filename, owner_sub, visibility FROM pdfs WHERE id = ?`)
      .get(parsed.data.id) as Pick<PdfRow, 'id' | 'title' | 'original_filename' | 'owner_sub' | 'visibility'> | undefined;
    if (!row) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${parsed.data.id} not found`));
    if (!canEditPdf(sessionSub(request), row)) return reply.code(403).send(errorResponse('FORBIDDEN', '無權限下載測驗結果'));

    const attempts = db
      .prepare(
        `SELECT a.id, a.quiz_id, q.title AS quiz_title, a.client_id, a.code,
                a.score, a.submitted_at, a.answers_json
           FROM quiz_attempts a
           JOIN quiz_sets q ON q.id = a.quiz_id
          WHERE a.pdf_id = ?
          ORDER BY a.submitted_at ASC, a.id ASC`,
      )
      .all(parsed.data.id) as AttemptRow[];

    const lines: string[] = [
      ['attempt_id', 'quiz_id', 'quiz_title', 'client_id', 'code', 'score', 'submitted_at', 'answers_json'].join(','),
    ];

    for (const a of attempts) {
      lines.push(
        [
          csvEscape(a.id),
          csvEscape(a.quiz_id),
          csvEscape(a.quiz_title),
          csvEscape(a.client_id),
          csvEscape(a.code),
          csvEscape(a.score),
          csvEscape(a.submitted_at),
          csvEscape(a.answers_json),
        ].join(','),
      );
    }

    const csv = lines.join('\n') + '\n';
    const titleBase = safeDownloadBaseName(row.title, '');
    const filename = titleBase ? `${titleBase}-quiz-results.csv` : `quiz-results-${parsed.data.id}.csv`;

    reply.header('content-type', 'text/csv; charset=utf-8');
    reply.header('content-disposition', buildContentDisposition(filename));
    reply.header('cache-control', 'no-store');
    return reply.send(withCsvBom(csv));
  });
}
