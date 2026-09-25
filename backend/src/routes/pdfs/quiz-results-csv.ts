import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { canEditPdf , aclCtx } from './permissions';
import { db } from '../../db';
import { getAccountDisplayNames } from '../../services/accountProfiles';
import { buildQuizScoreSheet, type ScoreSheetAttempt } from '../../services/quizScoreSheet';
import { QuizQuestionsSchema } from './quizzes';
import type { PdfRow } from '../../types';
import { sessionSub } from '../auth';
import { errorResponse, IdParamSchema } from './shared';
import { csvEscape, withCsvBom } from './csv';
import { csvDownloadFilename, buildContentDisposition } from './downloadFilename';

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

const ScoreSheetParamSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{6,}$/),
  quizId: z.string().regex(/^[1-9]\d{0,9}$/).transform(Number),
});

const ScoreSheetQuerySchema = z.object({
  lang: z.enum(['zh-TW', 'en']).optional(),
  // The viewer's IANA time zone, so "作答時間" reads as the teacher's wall clock rather than UTC.
  tz: z.string().max(64).optional(),
});

const SCORE_SHEET_LABELS = {
  'zh-TW': {
    name: '姓名',
    code: '代碼',
    submittedAt: '作答時間',
    question: (n: number, max: number) => `第${n}題（${max}分）`,
    total: '總分',
    tutorAnswered: '課後輔導答題數',
    tutorLevel: '課後輔導能力落點',
    note: '備註',
    ungradedNote: '尚有問答題未評分',
    editedNote: (score: number) => `題目在作答後修改過；作答當時記錄的分數為 ${score}`,
  },
  en: {
    name: 'Name',
    code: 'Code',
    submittedAt: 'Submitted at',
    question: (n: number, max: number) => `Q${n} (${max} pts)`,
    total: 'Total',
    tutorAnswered: 'Practice answered',
    tutorLevel: 'Practice ability level',
    note: 'Note',
    ungradedNote: 'Essay not graded yet',
    editedNote: (score: number) => `Quiz edited after this attempt; score recorded at the time: ${score}`,
  },
} as const;

function validTimeZone(tz: string | undefined): string {
  if (!tz) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

/** `YYYY-MM-DD HH:mm:ss` in the given zone — a form every spreadsheet parses as a date. */
function formatSheetTime(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  // sv-SE is the one built-in locale whose default date/time format is ISO-like.
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

interface ScoreSheetAttemptRow {
  session_id: string;
  client_id: string;
  code: string | null;
  sub: string | null;
  answers_json: string;
  score: number | null;
  submitted_at: string;
  tutor_answered: number | null;
  tutor_level_estimate: number | null;
}

function parseAnswers(json: string): Record<string, number[]> {
  try {
    const value = JSON.parse(json) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const answers: Record<string, number[]> = {};
    for (const [key, selected] of Object.entries(value as Record<string, unknown>)) {
      if (Array.isArray(selected)) answers[key] = selected.filter((n): n is number => Number.isInteger(n));
    }
    return answers;
  } catch {
    return {};
  }
}

export async function registerQuizResultsCsvRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/pdfs/:id/quiz-results.csv', async (request, reply) => {
    const parsed = IdParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id parameter'));

    const row = db
      .prepare(`SELECT id, title, original_filename, owner_sub, visibility FROM pdfs WHERE id = ?`)
      .get(parsed.data.id) as Pick<PdfRow, 'id' | 'title' | 'original_filename' | 'owner_sub' | 'visibility'> | undefined;
    if (!row) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${parsed.data.id} not found`));
    if (!canEditPdf(sessionSub(request), row, aclCtx(request, parsed.data.id))) return reply.code(403).send(errorResponse('FORBIDDEN', '無權限下載測驗結果'));

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
    const filename = csvDownloadFilename(row.title, parsed.data.id, {
      titleSuffix: 'quiz-results',
      fallbackPrefix: 'quiz-results',
    });

    reply.header('content-type', 'text/csv; charset=utf-8');
    reply.header('content-disposition', buildContentDisposition(filename));
    reply.header('cache-control', 'no-store');
    return reply.send(withCsvBom(csv));
  });

  // Per-student, per-question scores for one quiz (one row per attempt), with a total column.
  // Teacher-only, like the raw export above: it names every student and their score.
  app.get('/api/pdfs/:id/quizzes/:quizId/scores.csv', async (request, reply) => {
    const parsed = ScoreSheetParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid quiz parameters'));
    const query = ScoreSheetQuerySchema.safeParse(request.query ?? {});
    const labels = SCORE_SHEET_LABELS[query.success ? (query.data.lang ?? 'zh-TW') : 'zh-TW'];
    const timeZone = validTimeZone(query.success ? query.data.tz : undefined);

    const row = db
      .prepare(`SELECT id, title, original_filename, owner_sub, visibility FROM pdfs WHERE id = ?`)
      .get(parsed.data.id) as Pick<PdfRow, 'id' | 'title' | 'original_filename' | 'owner_sub' | 'visibility'> | undefined;
    if (!row) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${parsed.data.id} not found`));
    if (!canEditPdf(sessionSub(request), row, aclCtx(request, parsed.data.id))) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限下載測驗分數'));
    }
    const quiz = db
      .prepare(`SELECT id, title, questions_json FROM quiz_sets WHERE id = ? AND pdf_id = ?`)
      .get(parsed.data.quizId, parsed.data.id) as { id: number; title: string; questions_json: string } | undefined;
    if (!quiz) return reply.code(404).send(errorResponse('QUIZ_NOT_FOUND', `Quiz ${parsed.data.quizId} not found`));

    let rawQuestions: unknown = [];
    try {
      rawQuestions = JSON.parse(quiz.questions_json);
    } catch {
      rawQuestions = [];
    }
    const questionsResult = QuizQuestionsSchema.safeParse(rawQuestions);
    const questions = questionsResult.success ? questionsResult.data : [];

    const attemptRows = db
      .prepare(
        `SELECT session_id, client_id, code, sub, answers_json, score, submitted_at, tutor_answered, tutor_level_estimate
           FROM quiz_attempts WHERE quiz_id = ? AND pdf_id = ?
          ORDER BY submitted_at ASC, id ASC`,
      )
      .all(quiz.id, parsed.data.id) as ScoreSheetAttemptRow[];
    const essays = db
      .prepare(
        `SELECT session_id, client_id, question_id, ai_score, teacher_score
           FROM quiz_essay_answers WHERE quiz_id = ? AND pdf_id = ?`,
      )
      .all(quiz.id, parsed.data.id) as Array<{
        session_id: string; client_id: string; question_id: string; ai_score: number | null; teacher_score: number | null;
      }>;
    const names = getAccountDisplayNames(attemptRows.map((a) => a.sub));
    const attempts: ScoreSheetAttempt[] = attemptRows.map((a) => ({
      session_id: a.session_id,
      client_id: a.client_id,
      code: a.code,
      display_name: a.sub ? names.get(a.sub) ?? null : null,
      submitted_at: a.submitted_at,
      answers: parseAnswers(a.answers_json),
      recorded_score: a.score,
      tutor_answered: a.tutor_answered,
      tutor_level_estimate: a.tutor_level_estimate,
    }));

    const sheet = buildQuizScoreSheet({ questions, attempts, essays });
    const noteFor = (r: (typeof sheet.rows)[number]): string =>
      [
        ...(r.has_ungraded ? [labels.ungradedNote] : []),
        ...(r.recorded_score != null ? [labels.editedNote(r.recorded_score)] : []),
      ].join(labels === SCORE_SHEET_LABELS.en ? '; ' : '；');
    // Only when some row has something to say: otherwise every row would carry an empty column.
    const hasNotes = sheet.rows.some((r) => noteFor(r) !== '');
    const header = [
      labels.name,
      labels.code,
      labels.submittedAt,
      ...sheet.max_scores.map((max, idx) => labels.question(idx + 1, max)),
      labels.total,
      labels.tutorAnswered,
      labels.tutorLevel,
      ...(hasNotes ? [labels.note] : []),
    ];
    const lines = [header.map((h) => csvEscape(h)).join(',')];
    for (const r of sheet.rows) {
      lines.push(
        [
          csvEscape(r.name),
          csvEscape(r.code),
          csvEscape(formatSheetTime(r.submitted_at, timeZone)),
          ...r.scores.map((score) => csvEscape(score)),
          csvEscape(r.total),
          // 空白＝沒按過「合併課後輔導」或未登入；0＝合併時查過、沒做過。
          csvEscape(r.tutor_answered),
          csvEscape(r.tutor_level_estimate),
          ...(hasNotes ? [csvEscape(noteFor(r))] : []),
        ].join(','),
      );
    }

    const filename = csvDownloadFilename(quiz.title, `${parsed.data.id}-${quiz.id}`, {
      titleSuffix: 'scores',
      fallbackPrefix: 'quiz-scores',
    });
    reply.header('content-type', 'text/csv; charset=utf-8');
    reply.header('content-disposition', buildContentDisposition(filename));
    reply.header('cache-control', 'no-store');
    return reply.send(withCsvBom(lines.join('\n') + '\n'));
  });
}
