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
      const correctSet = new Set(Array.isArray(q.answer_indices) ? q.answer_indices : []);

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

        const selectedSet = new Set(selected);
        const isCorrect =
          correctSet.size === selectedSet.size &&
          Array.from(correctSet).every((i) => selectedSet.has(i));
        if (isCorrect) {
          stat.correct_count += 1;
        } else {
          stat.wrong_count += 1;
        }
      }
    }
  }

  return Array.from(statMap.values()).map((s) => ({
    ...s,
    correct_rate: s.attempt_count > 0 ? s.correct_count / s.attempt_count : 0,
  }));
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
      const correctSet = new Set(Array.isArray(q.answer_indices) ? q.answer_indices : []);
      const selectedSet = new Set(selected);
      const is_correct =
        correctSet.size === selectedSet.size &&
        Array.from(correctSet).every((i) => selectedSet.has(i));
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
    student.average_score = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
  }

  return Array.from(studentMap.values());
}

function escapeCsvField(value: string | number | null | undefined): string {
  const str = value == null ? '' : String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
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
          escapeCsvField(student.client_id),
          escapeCsvField(attempt.attempt_id),
          escapeCsvField(attempt.quiz_title),
          escapeCsvField(attempt.score),
          escapeCsvField(attempt.submitted_at),
          escapeCsvField(correct),
          escapeCsvField(total),
        ].join(','));
      }
    }
    const csv = rows.join('\n');
    void reply.header('Content-Type', 'text/csv; charset=utf-8');
    void reply.header('Content-Disposition', `attachment; filename="report-${id}.csv"`);
    return reply.code(200).send(csv);
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
        wrong_rate: s.attempt_count > 0 ? s.wrong_count / s.attempt_count : 0,
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
