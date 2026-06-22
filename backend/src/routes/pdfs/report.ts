import type { FastifyInstance, FastifyRequest } from 'fastify';
import { db } from '../../db';
import type { PdfRow } from '../../types';
import { decodeSession, parseCookies } from '../auth';
import { errorResponse, IdParamSchema } from './shared';
import { getSyncFollowerQuestionsSnapshot } from './sync';

function sessionSub(request: FastifyRequest): string | null {
  const session = decodeSession(parseCookies(request).makeslide_session);
  return session?.sub ?? null;
}

function canEditPdf(sub: string | null, row: Pick<PdfRow, 'owner_sub' | 'visibility'>): boolean {
  if (!row.owner_sub) return true;
  if (sub && row.owner_sub === sub) return true;
  return row.visibility === 'public_editable';
}

function getPdfPermissionRow(id: string): Pick<PdfRow, 'owner_sub' | 'visibility'> | undefined {
  return db.prepare(`SELECT owner_sub, visibility FROM pdfs WHERE id = ?`).get(id) as
    | Pick<PdfRow, 'owner_sub' | 'visibility'>
    | undefined;
}

interface QuizSummaryRow {
  attempt_count: number;
  participant_count: number;
  average_score: number | null;
}

interface PollSummaryRow {
  poll_count: number;
  vote_count: number;
  participant_count: number;
}

interface WatchPageRow {
  page_number: number;
  total_viewers: number;
  completed_viewers: number;
  avg_listened_ratio: number | null;
}

function sortedUnique(values: Iterable<string>): string[] {
  return Array.from(new Set(Array.from(values).map((value) => value.trim()).filter(Boolean))).sort();
}

export async function registerReportRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/pdfs/:id/report/summary', async (request, reply) => {
    const parsed = IdParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid pdf id'));

    const { id } = parsed.data;
    const pdfRow = getPdfPermissionRow(id);
    if (!pdfRow) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    if (!canEditPdf(sessionSub(request), pdfRow)) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限檢視此簡報的課後學習報告'));
    }

    const quiz = db
      .prepare(
        `SELECT
           COUNT(*) AS attempt_count,
           COUNT(DISTINCT client_id) AS participant_count,
           AVG(score) AS average_score
         FROM quiz_attempts
        WHERE pdf_id = ?`,
      )
      .get(id) as QuizSummaryRow;

    const poll = db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM page_polls WHERE pdf_id = ?) AS poll_count,
           COUNT(v.voter_id) AS vote_count,
           COUNT(DISTINCT v.voter_id) AS participant_count
         FROM page_polls p
         LEFT JOIN page_poll_votes v ON v.poll_id = p.id
        WHERE p.pdf_id = ?`,
      )
      .get(id, id) as PollSummaryRow;

    const watchPages = db
      .prepare(
        `SELECT
           p.page_number,
           COUNT(w.viewer_id) AS total_viewers,
           COALESCE(SUM(w.completed), 0) AS completed_viewers,
           AVG(CASE WHEN w.duration_ms IS NOT NULL AND w.duration_ms > 0 THEN MIN(CAST(w.listened_ms AS REAL) / w.duration_ms, 1.0) ELSE NULL END) AS avg_listened_ratio
         FROM pages p
         LEFT JOIN page_watch_progress w ON w.pdf_id = p.pdf_id AND w.page_number = p.page_number
        WHERE p.pdf_id = ?
        GROUP BY p.page_number
        ORDER BY p.page_number ASC`,
      )
      .all(id) as WatchPageRow[];

    const quizParticipants = db
      .prepare(`SELECT DISTINCT client_id AS id FROM quiz_attempts WHERE pdf_id = ?`)
      .all(id) as Array<{ id: string }>;
    const pollParticipants = db
      .prepare(
        `SELECT DISTINCT v.voter_id AS id
           FROM page_polls p
           JOIN page_poll_votes v ON v.poll_id = p.id
          WHERE p.pdf_id = ?`,
      )
      .all(id) as Array<{ id: string }>;
    const watchParticipants = db
      .prepare(`SELECT DISTINCT viewer_id AS id FROM page_watch_progress WHERE pdf_id = ?`)
      .all(id) as Array<{ id: string }>;
    const followerQuestions = getSyncFollowerQuestionsSnapshot(id);
    const participantIds = sortedUnique([
      ...quizParticipants.map((row) => row.id),
      ...pollParticipants.map((row) => row.id),
      ...watchParticipants.map((row) => row.id),
      ...followerQuestions.map((question) => question.clientId),
    ]);
    const participantCount = participantIds.length;
    const pollParticipationDenominator = Math.max(0, (poll.poll_count ?? 0) * participantCount);

    return reply.send({
      pdf_id: id,
      participant_count: participantCount,
      quiz: {
        attempt_count: quiz.attempt_count ?? 0,
        participant_count: quiz.participant_count ?? 0,
        average_score: quiz.average_score,
      },
      polls: {
        poll_count: poll.poll_count ?? 0,
        vote_count: poll.vote_count ?? 0,
        participant_count: poll.participant_count ?? 0,
        participation_rate: pollParticipationDenominator > 0 ? (poll.vote_count ?? 0) / pollParticipationDenominator : 0,
      },
      questions: {
        count: followerQuestions.length,
        participant_count: sortedUnique(followerQuestions.map((question) => question.clientId)).length,
      },
      watch_progress: {
        pages: watchPages.map((row) => ({
          page_number: row.page_number,
          total_viewers: row.total_viewers,
          completed_viewers: row.completed_viewers,
          completion_rate: row.total_viewers > 0 ? row.completed_viewers / row.total_viewers : 0,
          avg_listened_ratio: row.avg_listened_ratio,
        })),
      },
      generated_at: new Date().toISOString(),
    });
  });
}
