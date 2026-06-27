import type { FastifyInstance } from 'fastify';
import { db } from '../../db';
import type { PdfRow } from '../../types';
import { sessionSub } from '../auth';
import { errorResponse, IdParamSchema } from './shared';
import { csvEscape, withCsvBom } from './csv';
import { safeRatio, round4, pollDivergence, average } from './reportMetrics';
import { safeDownloadBaseName, buildContentDisposition } from './downloadFilename';
import { isCorrectAnswer } from '../../services/quizCorrectness';
import { getSyncFollowerQuestionsSnapshot } from './sync';

function canEditPdf(sub: string | null, row: Pick<PdfRow, 'owner_sub' | 'visibility'>): boolean {
  if (!row.owner_sub) return true;
  if (sub && row.owner_sub === sub) return true;
  return row.visibility === 'public_editable';
}

function getPdfPermissionRow(id: string): Pick<PdfRow, 'owner_sub' | 'visibility' | 'title'> | undefined {
  return db.prepare(`SELECT owner_sub, visibility, title FROM pdfs WHERE id = ?`).get(id) as
    | Pick<PdfRow, 'owner_sub' | 'visibility' | 'title'>
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

interface QuizSetRow {
  id: number;
  questions_json: string;
}

interface QuizAttemptAnswersRow {
  answers_json: string;
}

interface QuizQuestionRecord {
  id: string;
  question: string;
  options: Array<{ text: string }>;
  answer_indices: number[];
  type: 'single' | 'multiple';
}

interface QuestionStat {
  question_id: string;
  question: string;
  option_count: number;
  attempt_count: number;
  correct_count: number;
  wrong_count: number;
  correct_rate: number;
  option_votes: number[];
}

function computeQuestionStats(pdfId: string): QuestionStat[] {
  const quizSets = db
    .prepare(`SELECT id, questions_json FROM quiz_sets WHERE pdf_id = ? ORDER BY updated_at DESC`)
    .all(pdfId) as QuizSetRow[];

  const statMap = new Map<string, QuestionStat>();

  for (const quizSet of quizSets) {
    let questions: QuizQuestionRecord[];
    try {
      questions = JSON.parse(quizSet.questions_json) as QuizQuestionRecord[];
      if (!Array.isArray(questions)) continue;
    } catch {
      continue;
    }

    const attempts = db
      .prepare(`SELECT answers_json FROM quiz_attempts WHERE quiz_id = ?`)
      .all(quizSet.id) as QuizAttemptAnswersRow[];

    for (const q of questions) {
      if (!q.id || typeof q.question !== 'string') continue;
      const key = `${quizSet.id}:${q.id}`;
      if (!statMap.has(key)) {
        statMap.set(key, {
          question_id: q.id,
          question: q.question,
          option_count: Array.isArray(q.options) ? q.options.length : 0,
          attempt_count: 0,
          correct_count: 0,
          wrong_count: 0,
          correct_rate: 0,
          option_votes: Array.isArray(q.options) ? new Array(q.options.length).fill(0) as number[] : [],
        });
      }
      const stat = statMap.get(key)!;
      const answerIndices = Array.isArray(q.answer_indices) ? q.answer_indices : [];

      for (const attempt of attempts) {
        let answersRecord: Record<string, number[]>;
        try {
          answersRecord = JSON.parse(attempt.answers_json) as Record<string, number[]>;
          if (typeof answersRecord !== 'object' || answersRecord === null) continue;
        } catch {
          continue;
        }
        const selected: number[] = Array.isArray(answersRecord[q.id]) ? (answersRecord[q.id] ?? []) : [];
        if (selected.length === 0 && !Object.prototype.hasOwnProperty.call(answersRecord, q.id)) continue;

        stat.attempt_count += 1;
        for (const idx of selected) {
          if (idx >= 0 && idx < stat.option_votes.length) {
            stat.option_votes[idx] = (stat.option_votes[idx] ?? 0) + 1;
          }
        }

        if (isCorrectAnswer(answerIndices, selected)) {
          stat.correct_count += 1;
        } else {
          stat.wrong_count += 1;
        }
      }
    }
  }

  return Array.from(statMap.values()).map((s) => ({
    ...s,
    correct_rate: safeRatio(s.correct_count, s.attempt_count),
  }));
}

interface WatchPageRow {
  page_number: number;
  total_viewers: number;
  completed_viewers: number;
  avg_listened_ratio: number | null;
}

/**
 * Per-page watch aggregation shared by the pages CSV export and the summary
 * endpoint: viewer count, completed count, and the average listened ratio
 * (each row's listened/duration capped at 1.0; rows without a positive duration
 * are excluded from the average so they don't count as 0%).
 */
function queryWatchPages(pdfId: string): WatchPageRow[] {
  return db
    .prepare(
      `SELECT p.page_number AS page_number,
              COUNT(w.viewer_id) AS total_viewers,
              COALESCE(SUM(w.completed), 0) AS completed_viewers,
              AVG(CASE WHEN w.duration_ms IS NOT NULL AND w.duration_ms > 0 THEN MIN(CAST(w.listened_ms AS REAL) / w.duration_ms, 1.0) ELSE NULL END) AS avg_listened_ratio
         FROM pages p
         LEFT JOIN page_watch_progress w ON w.pdf_id = p.pdf_id AND w.page_number = p.page_number
        WHERE p.pdf_id = ?
        GROUP BY p.page_number
        ORDER BY p.page_number ASC`,
    )
    .all(pdfId) as WatchPageRow[];
}

function sortedUnique(values: Iterable<string>): string[] {
  return Array.from(new Set(Array.from(values).map((value) => value.trim()).filter(Boolean))).sort();
}

interface StudentAttemptQuestionResult {
  question_id: string;
  question: string;
  options: string[];
  selected: number[];
  correct_indices: number[];
  is_correct: boolean;
}

interface StudentAttempt {
  attempt_id: number;
  quiz_id: number;
  quiz_title: string;
  score: number | null;
  submitted_at: string;
  question_results: StudentAttemptQuestionResult[];
}

interface StudentRecord {
  client_id: string;
  attempt_count: number;
  average_score: number | null;
  attempts: StudentAttempt[];
}

interface RawAttemptRow {
  id: number;
  quiz_id: number;
  quiz_title: string | null;
  client_id: string;
  score: number | null;
  submitted_at: string;
  answers_json: string;
  questions_json: string;
}

function computeStudentRecords(pdfId: string): StudentRecord[] {
  const rows = db
    .prepare(
      `SELECT a.id, a.quiz_id, qs.title AS quiz_title, a.client_id,
              a.score, a.submitted_at, a.answers_json, qs.questions_json
         FROM quiz_attempts a
         JOIN quiz_sets qs ON qs.id = a.quiz_id
        WHERE a.pdf_id = ?
        ORDER BY a.client_id ASC, a.submitted_at ASC`,
    )
    .all(pdfId) as RawAttemptRow[];

  const studentMap = new Map<string, StudentRecord>();

  for (const row of rows) {
    let answers: Record<string, number[]> = {};
    try {
      const parsed = JSON.parse(row.answers_json) as unknown;
      if (typeof parsed === 'object' && parsed !== null) {
        answers = parsed as Record<string, number[]>;
      }
    } catch { /* skip */ }

    let questions: QuizQuestionRecord[] = [];
    try {
      const parsed = JSON.parse(row.questions_json) as unknown;
      if (Array.isArray(parsed)) questions = parsed as QuizQuestionRecord[];
    } catch { /* skip */ }

    const questionResults: StudentAttemptQuestionResult[] = questions.map((q) => {
      const selected: number[] = Array.isArray(answers[q.id]) ? (answers[q.id] ?? []) : [];
      const is_correct = isCorrectAnswer(Array.isArray(q.answer_indices) ? q.answer_indices : [], selected);
      return {
        question_id: q.id,
        question: q.question ?? '',
        options: Array.isArray(q.options) ? q.options.map((o) => (typeof o === 'object' && o !== null ? (o as { text?: string }).text ?? '' : String(o))) : [],
        selected,
        correct_indices: Array.isArray(q.answer_indices) ? q.answer_indices : [],
        is_correct,
      };
    });

    let student = studentMap.get(row.client_id);
    if (!student) {
      student = { client_id: row.client_id, attempt_count: 0, average_score: null, attempts: [] };
      studentMap.set(row.client_id, student);
    }
    student.attempt_count += 1;
    student.attempts.push({
      attempt_id: row.id,
      quiz_id: row.quiz_id,
      quiz_title: row.quiz_title ?? '',
      score: row.score,
      submitted_at: row.submitted_at,
      question_results: questionResults,
    });
  }

  for (const student of studentMap.values()) {
    const scores = student.attempts.map((a) => a.score).filter((s): s is number => s !== null);
    student.average_score = average(scores);
  }

  return Array.from(studentMap.values());
}

export async function registerReportRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/pdfs/:id/report/students.csv', async (request, reply) => {
    const parsed = IdParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send('Invalid pdf id');

    const { id } = parsed.data;
    const pdfRow = getPdfPermissionRow(id);
    if (!pdfRow) return reply.code(404).send('PDF not found');
    if (!canEditPdf(sessionSub(request), pdfRow)) {
      return reply.code(403).send('Forbidden');
    }

    const students = computeStudentRecords(id);
    const header = ['student_id', 'attempt_id', 'quiz_title', 'score', 'submitted_at', 'correct_count', 'total_questions'].join(',');
    const rows: string[] = [header];
    for (const student of students) {
      for (const attempt of student.attempts) {
        const correct = attempt.question_results.filter((q) => q.is_correct).length;
        const total = attempt.question_results.length;
        rows.push([
          csvEscape(student.client_id),
          csvEscape(attempt.attempt_id),
          csvEscape(attempt.quiz_title),
          csvEscape(attempt.score),
          csvEscape(attempt.submitted_at),
          csvEscape(correct),
          csvEscape(total),
        ].join(','));
      }
    }
    const csv = rows.join('\n');
    void reply.header('Content-Type', 'text/csv; charset=utf-8');
    void reply.header('Content-Disposition', buildContentDisposition(safeDownloadBaseName(pdfRow.title, '') ? `${safeDownloadBaseName(pdfRow.title, '')}-students.csv` : `report-${id}.csv`));
    return reply.code(200).send(withCsvBom(csv));
  });

  // Per-page learning analytics export: viewers/completion plus aggregated poll
  // participation and a divergence score (1 - top option's vote share; 0 = consensus).
  app.get('/api/pdfs/:id/report/pages.csv', async (request, reply) => {
    const parsed = IdParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send('Invalid pdf id');

    const { id } = parsed.data;
    const pdfRow = getPdfPermissionRow(id);
    if (!pdfRow) return reply.code(404).send('PDF not found');
    if (!canEditPdf(sessionSub(request), pdfRow)) {
      return reply.code(403).send('Forbidden');
    }

    const watchPages = queryWatchPages(id);

    const pollVoteRows = db
      .prepare(
        `SELECT p.page_number AS page_number, v.option_index AS option_index, COUNT(*) AS votes
           FROM page_polls p
           JOIN page_poll_votes v ON v.poll_id = p.id
          WHERE p.pdf_id = ?
          GROUP BY p.page_number, v.option_index`,
      )
      .all(id) as Array<{ page_number: number; option_index: number; votes: number }>;

    const pollByPage = new Map<number, { total: number; max: number }>();
    for (const row of pollVoteRows) {
      const agg = pollByPage.get(row.page_number) ?? { total: 0, max: 0 };
      agg.total += row.votes;
      agg.max = Math.max(agg.max, row.votes);
      pollByPage.set(row.page_number, agg);
    }

    const header = ['page_number', 'total_viewers', 'completed_viewers', 'completion_rate', 'poll_total_votes', 'poll_divergence_score', 'avg_listened_ratio'].join(',');
    const rows: string[] = [header];
    for (const wp of watchPages) {
      const completion = safeRatio(wp.completed_viewers, wp.total_viewers);
      const poll = pollByPage.get(wp.page_number);
      const totalVotes = poll?.total ?? 0;
      const divergence = pollDivergence(poll?.max ?? 0, totalVotes);
      // 無聆聽資料（無觀看者或皆無 duration）時輸出空字串，避免被誤讀為 0%。
      const avgListened = wp.avg_listened_ratio == null ? '' : round4(wp.avg_listened_ratio);
      rows.push([
        csvEscape(wp.page_number),
        csvEscape(wp.total_viewers),
        csvEscape(wp.completed_viewers),
        csvEscape(round4(completion)),
        csvEscape(totalVotes),
        csvEscape(round4(divergence)),
        csvEscape(avgListened),
      ].join(','));
    }
    const csv = rows.join('\n');
    void reply.header('Content-Type', 'text/csv; charset=utf-8');
    void reply.header('Content-Disposition', buildContentDisposition(safeDownloadBaseName(pdfRow.title, '') ? `${safeDownloadBaseName(pdfRow.title, '')}-pages.csv` : `report-pages-${id}.csv`));
    return reply.code(200).send(withCsvBom(csv));
  });

  // Per-question quiz statistics export (one row per question).
  app.get('/api/pdfs/:id/report/questions.csv', async (request, reply) => {
    const parsed = IdParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send('Invalid pdf id');

    const { id } = parsed.data;
    const pdfRow = getPdfPermissionRow(id);
    if (!pdfRow) return reply.code(404).send('PDF not found');
    if (!canEditPdf(sessionSub(request), pdfRow)) {
      return reply.code(403).send('Forbidden');
    }

    const stats = computeQuestionStats(id);
    const header = ['question_id', 'question', 'option_count', 'attempt_count', 'correct_count', 'wrong_count', 'correct_rate', 'option_votes'].join(',');
    const rows: string[] = [header];
    for (const s of stats) {
      rows.push([
        csvEscape(s.question_id),
        csvEscape(s.question),
        csvEscape(s.option_count),
        csvEscape(s.attempt_count),
        csvEscape(s.correct_count),
        csvEscape(s.wrong_count),
        csvEscape(round4(s.correct_rate)),
        // option_votes is a variable-length array; join into one field to keep column count fixed.
        csvEscape(s.option_votes.join('|')),
      ].join(','));
    }
    const csv = rows.join('\n');
    void reply.header('Content-Type', 'text/csv; charset=utf-8');
    void reply.header('Content-Disposition', buildContentDisposition(safeDownloadBaseName(pdfRow.title, '') ? `${safeDownloadBaseName(pdfRow.title, '')}-questions.csv` : `report-questions-${id}.csv`));
    return reply.code(200).send(withCsvBom(csv));
  });

  app.get('/api/pdfs/:id/report/students', async (request, reply) => {
    const parsed = IdParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid pdf id'));

    const { id } = parsed.data;
    const pdfRow = getPdfPermissionRow(id);
    if (!pdfRow) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    if (!canEditPdf(sessionSub(request), pdfRow)) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限檢視此簡報的學生報告'));
    }

    return reply.send({ students: computeStudentRecords(id) });
  });

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

    const watchPages = queryWatchPages(id);

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

    const questionStats = computeQuestionStats(id);
    const hardestQuestions = [...questionStats]
      .filter((s) => s.attempt_count > 0)
      .sort((a, b) => a.correct_rate - b.correct_rate || b.wrong_count - a.wrong_count)
      .slice(0, 5)
      .map((s) => ({
        question_id: s.question_id,
        question: s.question,
        attempt_count: s.attempt_count,
        wrong_count: s.wrong_count,
        wrong_rate: safeRatio(s.wrong_count, s.attempt_count),
      }));

    return reply.code(200).send({
      pdf_id: id,
      participant_count: participantCount,
      quiz: {
        attempt_count: quiz.attempt_count ?? 0,
        participant_count: quiz.participant_count ?? 0,
        average_score: quiz.average_score,
        hardest_questions: hardestQuestions,
        question_stats: questionStats,
      },
      polls: {
        poll_count: poll.poll_count ?? 0,
        vote_count: poll.vote_count ?? 0,
        participant_count: poll.participant_count ?? 0,
        participation_rate: safeRatio(poll.vote_count ?? 0, pollParticipationDenominator),
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
          completion_rate: safeRatio(row.completed_viewers, row.total_viewers),
          avg_listened_ratio: row.avg_listened_ratio,
        })),
      },
      generated_at: new Date().toISOString(),
    });
  });
}
