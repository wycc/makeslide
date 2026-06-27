import type { FastifyInstance } from 'fastify';
import { canEditPdf } from './permissions';
import { z } from 'zod';
import { db } from '../../db';
import type { PdfRow } from '../../types';
import { sessionSub } from '../auth';
import { callChatJSON } from '../../services/openai';
import { errorResponse, IdParamSchema } from './shared';

interface QuizSetRow {
  id: number;
  questions_json: string;
}

interface QuizAttemptRow {
  answers_json: string;
}

interface WatchPageRow {
  page_number: number;
  completion_rate: number;
}

interface QuestionStat {
  question: string;
  correct_rate: number;
  attempt_count: number;
}

function buildQuizStats(pdfId: string): QuestionStat[] {
  const quizSets = db
    .prepare(`SELECT id, questions_json FROM quiz_sets WHERE pdf_id = ? ORDER BY updated_at DESC`)
    .all(pdfId) as QuizSetRow[];

  const stats: QuestionStat[] = [];
  for (const qs of quizSets) {
    let questions: Array<{ id: string; question: string; options?: unknown[]; answer_indices?: number[] }>;
    try {
      const parsed = JSON.parse(qs.questions_json) as unknown;
      if (!Array.isArray(parsed)) continue;
      questions = parsed as typeof questions;
    } catch { continue; }

    const attempts = db
      .prepare(`SELECT answers_json FROM quiz_attempts WHERE quiz_id = ?`)
      .all(qs.id) as QuizAttemptRow[];

    for (const q of questions) {
      if (!q.id || typeof q.question !== 'string') continue;
      const correctSet = new Set(Array.isArray(q.answer_indices) ? q.answer_indices : []);
      let total = 0;
      let correct = 0;
      for (const a of attempts) {
        let answers: Record<string, number[]> = {};
        try { answers = JSON.parse(a.answers_json) as Record<string, number[]>; } catch { continue; }
        const selected: number[] = Array.isArray(answers[q.id]) ? (answers[q.id] ?? []) : [];
        if (selected.length === 0 && !Object.prototype.hasOwnProperty.call(answers, q.id)) continue;
        total += 1;
        const sel = new Set(selected);
        if (correctSet.size === sel.size && Array.from(correctSet).every((i) => sel.has(i))) correct += 1;
      }
      if (total > 0) stats.push({ question: q.question, correct_rate: correct / total, attempt_count: total });
    }
  }
  return stats;
}

function buildWatchStats(pdfId: string): WatchPageRow[] {
  return db
    .prepare(
      `SELECT p.page_number,
              CASE WHEN COUNT(w.viewer_id) > 0 THEN CAST(COALESCE(SUM(w.completed), 0) AS REAL) / COUNT(w.viewer_id) ELSE 0 END AS completion_rate
         FROM pages p
         LEFT JOIN page_watch_progress w ON w.pdf_id = p.pdf_id AND w.page_number = p.page_number
        WHERE p.pdf_id = ?
        GROUP BY p.page_number
        ORDER BY p.page_number ASC`,
    )
    .all(pdfId) as WatchPageRow[];
}

const AiSuggestionsSchema = z.object({
  suggestions: z.string().min(1).max(6000),
});

export async function registerReportAiSuggestionsRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/pdfs/:id/report/ai-suggestions', async (request, reply) => {
    const parsed = IdParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid pdf id'));

    const { id } = parsed.data;
    const pdfRow = db
      .prepare(`SELECT owner_sub, visibility FROM pdfs WHERE id = ?`)
      .get(id) as Pick<PdfRow, 'owner_sub' | 'visibility'> | undefined;
    if (!pdfRow) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    if (!canEditPdf(sessionSub(request), pdfRow)) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限生成此簡報的 AI 建議'));
    }

    const quizStats = buildQuizStats(id);
    const watchStats = buildWatchStats(id);

    const quizSection =
      quizStats.length === 0
        ? '（無測驗資料）'
        : quizStats
            .map((s, i) => `${i + 1}. 「${s.question}」— 答對率 ${Math.round(s.correct_rate * 100)}%（${s.attempt_count} 人作答）`)
            .join('\n');

    const watchSection =
      watchStats.length === 0
        ? '（無觀看記錄）'
        : watchStats.map((w) => `第 ${w.page_number} 頁：完成率 ${Math.round(w.completion_rate * 100)}%`).join('、');

    const result = await callChatJSON({
      label: `report-ai-suggestions ${id}`,
      messages: [
        {
          role: 'system',
          content: [
            '你是一位繁體中文教學顧問。根據下列課堂數據，為教師生成具體、可行動的教學建議（Markdown 格式）。',
            '建議應包含：',
            '1. 最需補強的概念（依答錯率排序）',
            '2. 觀看率最低的頁面可能的原因與建議',
            '3. 下一堂課具體建議（複習重點、補充說明方式）',
            '請輸出 JSON 格式：{"suggestions":"..."}，value 為 Markdown 字串，不超過 1500 字。',
          ].join('\n'),
        },
        {
          role: 'user',
          content: `【測驗答對率】\n${quizSection}\n\n【每頁觀看完成率】\n${watchSection}`,
        },
      ],
      schema: AiSuggestionsSchema,
      maxTokens: 1800,
    });

    return reply.send({ suggestions: result.data.suggestions });
  });
}
