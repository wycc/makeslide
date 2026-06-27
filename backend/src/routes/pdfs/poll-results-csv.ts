import type { FastifyInstance } from 'fastify';
import { canEditPdf } from './permissions';
import { db } from '../../db';
import type { PdfRow } from '../../types';
import { sessionSub } from '../auth';
import { errorResponse, IdParamSchema } from './shared';
import { csvEscape, withCsvBom } from './csv';
import { safeDownloadBaseName, buildContentDisposition } from './downloadFilename';

interface PollRow {
  id: number;
  page_number: number;
  question: string;
  options_json: string;
}

interface VoteCountRow {
  option_index: number;
  vote_count: number;
}

export async function registerPollResultsCsvRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/pdfs/:id/poll-results.csv', async (request, reply) => {
    const parsed = IdParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id parameter'));

    const row = db
      .prepare(`SELECT id, title, original_filename, owner_sub, visibility FROM pdfs WHERE id = ?`)
      .get(parsed.data.id) as Pick<PdfRow, 'id' | 'title' | 'original_filename' | 'owner_sub' | 'visibility'> | undefined;
    if (!row) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${parsed.data.id} not found`));
    if (!canEditPdf(sessionSub(request), row)) return reply.code(403).send(errorResponse('FORBIDDEN', '無權限下載投票結果'));

    const polls = db
      .prepare(
        `SELECT id, page_number, question, options_json
           FROM page_polls
          WHERE pdf_id = ?
          ORDER BY page_number ASC, created_at ASC`,
      )
      .all(parsed.data.id) as PollRow[];

    const lines: string[] = [
      ['page_number', 'poll_id', 'poll_question', 'option_index', 'option_text', 'vote_count', 'total_votes'].join(','),
    ];

    for (const poll of polls) {
      const options = JSON.parse(poll.options_json) as string[];
      const voteCounts = db
        .prepare(
          `SELECT option_index, COUNT(*) AS vote_count
             FROM page_poll_votes
            WHERE poll_id = ?
            GROUP BY option_index`,
        )
        .all(poll.id) as VoteCountRow[];

      const voteMap = new Map<number, number>();
      for (const vc of voteCounts) {
        voteMap.set(vc.option_index, vc.vote_count);
      }
      const totalVotes = voteCounts.reduce((sum, vc) => sum + vc.vote_count, 0);

      for (let i = 0; i < options.length; i++) {
        lines.push(
          [
            csvEscape(poll.page_number),
            csvEscape(poll.id),
            csvEscape(poll.question),
            csvEscape(i),
            csvEscape(options[i]),
            csvEscape(voteMap.get(i) ?? 0),
            csvEscape(totalVotes),
          ].join(','),
        );
      }
    }

    const csv = lines.join('\n') + '\n';
    const titleBase = safeDownloadBaseName(row.title, '');
    const filename = titleBase ? `${titleBase}-poll-results.csv` : `poll-results-${parsed.data.id}.csv`;

    reply.header('content-type', 'text/csv; charset=utf-8');
    reply.header('content-disposition', buildContentDisposition(filename));
    reply.header('cache-control', 'no-store');
    return reply.send(withCsvBom(csv));
  });
}
