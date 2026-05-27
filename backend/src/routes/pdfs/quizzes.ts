import fs from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../db';
import { callChatJSON } from '../../services/openai';
import { pageScriptPath, pageTextPath } from '../../services/storage';
import { errorResponse, IdParamSchema } from './shared';

const QuizOptionSchema = z.object({ text: z.string().trim().min(1).max(300) });
const QuizQuestionSchema = z.object({
  id: z.string().trim().min(1).max(80),
  type: z.enum(['single', 'multiple']),
  question: z.string().trim().min(1).max(1000),
  options: z.array(QuizOptionSchema).min(2).max(8),
  answer_indices: z.array(z.number().int().min(0).max(7)).min(1).max(8),
  explanation: z.string().trim().max(1200).optional().default(''),
});
const GeneratedQuizQuestionSchema = QuizQuestionSchema.extend({
  id: z.string().trim().min(1).max(80).optional(),
  options: z
    .array(z.union([QuizOptionSchema, z.string().trim().min(1).max(300)]))
    .min(2)
    .max(8)
    .transform((options) => options.map((option) => (typeof option === 'string' ? { text: option } : option))),
});
const QuizQuestionsSchema = z.array(QuizQuestionSchema).min(1).max(50);
const ExistingQuizQuestionsSchema = z.array(QuizQuestionSchema).max(50);
const GeneratedQuizQuestionsSchema = z.array(GeneratedQuizQuestionSchema).min(1).max(50);

const SaveQuizBodySchema = z.object({
  title: z.string().trim().min(1).max(200),
  prompt: z.string().trim().max(4000).default(''),
  questions: QuizQuestionsSchema,
});

const GenerateQuizBodySchema = z.object({
  prompt: z.string().trim().min(1).max(4000),
  existing_questions: ExistingQuizQuestionsSchema.optional().default([]),
});

const QuizParamSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{6,}$/),
  quizId: z.string().regex(/^[1-9]\d{0,9}$/).transform(Number),
});

interface QuizSetRow {
  id: number;
  pdf_id: string;
  title: string;
  prompt: string;
  questions_json: string;
  created_at: string;
  updated_at: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function rowToQuiz(row: QuizSetRow) {
  let questions: unknown = [];
  try {
    questions = JSON.parse(row.questions_json);
  } catch {
    questions = [];
  }
  const parsed = QuizQuestionsSchema.safeParse(questions);
  return {
    id: row.id,
    pdf_id: row.pdf_id,
    title: row.title,
    prompt: row.prompt,
    questions: parsed.success ? parsed.data : [],
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function readPageContext(pdfId: string, pageCount: number | null): Promise<string> {
  const count = Math.max(0, pageCount ?? 0);
  const chunks: string[] = [];
  for (let page = 1; page <= count; page += 1) {
    const [text, script] = await Promise.all([
      fs.readFile(pageTextPath(pdfId, page, count), 'utf8').catch(() => ''),
      fs.readFile(pageScriptPath(pdfId, page, count), 'utf8').catch(() => ''),
    ]);
    const body = [`投影片文字：${text.trim() || '（無）'}`, `逐字稿：${script.trim() || '（無）'}`].join('\n');
    chunks.push(`第 ${page} 頁\n${body}`);
  }
  return chunks.join('\n\n---\n\n').slice(0, 60000);
}

function normalizeQuestions(input: unknown) {
  const parsed = GeneratedQuizQuestionsSchema.parse(input);
  return parsed.map((q, idx) => {
    const maxIndex = q.options.length - 1;
    const answers = Array.from(new Set(q.answer_indices.filter((answer) => answer >= 0 && answer <= maxIndex)));
    return {
      ...q,
      id: q.id?.trim() || `q${idx + 1}`,
      answer_indices: q.type === 'single' ? [answers[0] ?? 0] : answers.length > 0 ? answers : [0],
    };
  });
}

export async function registerQuizRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/pdfs/:id/quizzes', async (request, reply) => {
    const parsed = IdParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid pdf id'));
    const rows = db
      .prepare(`SELECT id, pdf_id, title, prompt, questions_json, created_at, updated_at FROM quiz_sets WHERE pdf_id = ? ORDER BY updated_at DESC`)
      .all(parsed.data.id) as QuizSetRow[];
    return reply.send({ quizzes: rows.map(rowToQuiz) });
  });

  app.post('/api/pdfs/:id/quizzes/generate', async (request, reply) => {
    const parsed = IdParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid pdf id'));
    const body = GenerateQuizBodySchema.safeParse(request.body ?? {});
    if (!body.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', body.error.issues[0]?.message ?? 'Invalid body'));
    const pdf = db.prepare(`SELECT id, title, page_count FROM pdfs WHERE id = ?`).get(parsed.data.id) as { id: string; title: string | null; page_count: number | null } | undefined;
    if (!pdf) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${parsed.data.id} not found`));
    const context = await readPageContext(parsed.data.id, pdf.page_count);
    const result = await callChatJSON({
      label: `quiz-generate ${parsed.data.id}`,
      messages: [
        { role: 'system', content: '你是繁體中文教學測驗設計助理。請只輸出 JSON，格式為 {"title":"...","questions":[...]}。每題 type 為 single 或 multiple，options 是 {text} 陣列，answer_indices 是 0-based 正確選項索引，並提供 explanation。' },
        { role: 'user', content: [`簡報標題：${pdf.title ?? '未命名簡報'}`, `老師提示詞：${body.data.prompt}`, `既有問題列表（可依提示詞修改、增刪或重寫）：${JSON.stringify(body.data.existing_questions)}`, `簡報內容：\n${context}`].join('\n\n') },
      ],
      schema: z.object({ title: z.string().trim().min(1).max(200), questions: GeneratedQuizQuestionsSchema }),
      maxTokens: 5000,
      temperature: 0.4,
    });
    return reply.send({ title: result.data.title, questions: normalizeQuestions(result.data.questions) });
  });

  app.post('/api/pdfs/:id/quizzes', async (request, reply) => {
    const parsed = IdParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid pdf id'));
    const body = SaveQuizBodySchema.safeParse(request.body ?? {});
    if (!body.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', body.error.issues[0]?.message ?? 'Invalid body'));
    const now = nowIso();
    const result = db.prepare(`INSERT INTO quiz_sets (pdf_id, title, prompt, questions_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`).run(parsed.data.id, body.data.title, body.data.prompt, JSON.stringify(normalizeQuestions(body.data.questions)), now, now);
    const row = db.prepare(`SELECT id, pdf_id, title, prompt, questions_json, created_at, updated_at FROM quiz_sets WHERE id = ?`).get(result.lastInsertRowid) as QuizSetRow;
    return reply.code(201).send(rowToQuiz(row));
  });

  app.put('/api/pdfs/:id/quizzes/:quizId', async (request, reply) => {
    const parsed = QuizParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid quiz parameters'));
    const body = SaveQuizBodySchema.safeParse(request.body ?? {});
    if (!body.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', body.error.issues[0]?.message ?? 'Invalid body'));
    const now = nowIso();
    const result = db.prepare(`UPDATE quiz_sets SET title = ?, prompt = ?, questions_json = ?, updated_at = ? WHERE id = ? AND pdf_id = ?`).run(body.data.title, body.data.prompt, JSON.stringify(normalizeQuestions(body.data.questions)), now, parsed.data.quizId, parsed.data.id);
    if (result.changes === 0) return reply.code(404).send(errorResponse('QUIZ_NOT_FOUND', `Quiz ${parsed.data.quizId} not found`));
    const row = db.prepare(`SELECT id, pdf_id, title, prompt, questions_json, created_at, updated_at FROM quiz_sets WHERE id = ?`).get(parsed.data.quizId) as QuizSetRow;
    return reply.send(rowToQuiz(row));
  });
}
