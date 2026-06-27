import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import type { FastifyInstance } from 'fastify';
import { db } from '../../db';
import type { PdfRow } from '../../types';
import { sessionSub } from '../auth';
import { callChatJSON } from '../../services/openai';
import { pageScriptPath, pageTextPath, safeJoinPdfPath } from '../../services/storage';
import { buildHandoutPdf, readTextIfExists } from '../../services/handoutPdf';
import { errorResponse, IdParamSchema } from './shared';
import { z } from 'zod';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
const JSZip = require('jszip') as new () => any;

function canEditPdf(sub: string | null, row: Pick<PdfRow, 'owner_sub' | 'visibility'>): boolean {
  if (!row.owner_sub) return true;
  if (sub && row.owner_sub === sub) return true;
  return row.visibility === 'public_editable';
}

interface PageRow {
  page_number: number;
  page_uid: string;
  image_path: string | null;
  script_path: string | null;
  text_path: string | null;
  audio_duration_seconds: number | null;
  status: string;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  pdf_id: string;
  audio_path: string | null;
}

interface QuizSetRow {
  id: number;
  title: string;
  questions_json: string;
}

async function readPageContext(pdfId: string, pages: PageRow[]): Promise<string> {
  const chunks: string[] = [];
  for (const page of pages) {
    const scriptPath = page.script_path ? safeJoinPdfPath(pdfId, page.script_path) : null;
    const textPath = page.text_path ? safeJoinPdfPath(pdfId, page.text_path) : null;
    const script = await readTextIfExists(scriptPath);
    const text = await readTextIfExists(textPath);
    const body = [`逐字稿：${script.trim() || '（無）'}`, `投影片文字：${text.trim() || '（無）'}`].join('\n');
    chunks.push(`第 ${page.page_number} 頁\n${body}`);
  }
  return chunks.join('\n\n---\n\n').slice(0, 50000);
}

function safeFilename(input: string): string {
  const name = input.trim().replace(/[^A-Za-z0-9._一-鿿-]+/g, '-').replace(/^-+|-+$/g, '');
  return name || 'makeslide';
}

const CoursePackageResultSchema = z.object({
  study_sheet: z.string().min(1).max(8000),
  homework: z.string().min(1).max(4000),
});

export async function registerCoursePackageRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/pdfs/:id/course-package', async (request, reply) => {
    const parsed = IdParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id parameter'));

    const row = db
      .prepare(`SELECT id, title, original_filename, owner_sub, visibility, page_count FROM pdfs WHERE id = ?`)
      .get(parsed.data.id) as Pick<PdfRow, 'id' | 'title' | 'original_filename' | 'owner_sub' | 'visibility' | 'page_count'> | undefined;
    if (!row) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${parsed.data.id} not found`));
    if (!canEditPdf(sessionSub(request), row)) return reply.code(403).send(errorResponse('FORBIDDEN', '無權限下載此課程包'));

    const pages = db
      .prepare(
        `SELECT pdf_id, page_number, page_uid, image_path, text_path, script_path,
                audio_path, audio_duration_seconds, status, error_message,
                created_at, updated_at
           FROM pages WHERE pdf_id = ? ORDER BY page_number ASC`,
      )
      .all(parsed.data.id) as PageRow[];

    if (pages.length === 0) return reply.code(400).send(errorResponse('NO_PAGES', 'No pages available'));

    const title = row.title || row.original_filename || row.id;
    const context = await readPageContext(parsed.data.id, pages);

    // Generate study sheet + homework from LLM
    const llmResult = await callChatJSON({
      label: `course-package ${parsed.data.id}`,
      messages: [
        {
          role: 'system',
          content: [
            '你是一位繁體中文課程設計助理。請根據簡報逐字稿為學生產生兩份文件：',
            '1. study_sheet：學習單（Markdown 格式），包含學習目標、重點摘要（每頁一段）、關鍵詞彙表。',
            '2. homework：課後作業（Markdown 格式），包含 3-5 個開放性問題或實作練習，鼓勵學生深化學習。',
            '請只輸出 JSON，格式：{"study_sheet":"...", "homework":"..."}，不要輸出 markdown 代碼塊。',
          ].join('\n'),
        },
        {
          role: 'user',
          content: `簡報標題：${title}\n\n${context}`,
        },
      ],
      schema: CoursePackageResultSchema,
      maxTokens: 4000,
      temperature: 0.4,
    });

    // Build handout PDF
    const handoutPages = await Promise.all(
      pages
        .filter((p) => p.image_path !== null)
        .map(async (page) => {
          const scriptPath = page.script_path ? safeJoinPdfPath(parsed.data.id, page.script_path) : null;
          const textPath = page.text_path ? safeJoinPdfPath(parsed.data.id, page.text_path) : null;
          const script = (await readTextIfExists(scriptPath)) || (await readTextIfExists(textPath));
          return {
            pageNumber: page.page_number,
            imagePath: safeJoinPdfPath(parsed.data.id, page.image_path ?? ''),
            script,
          };
        }),
    );

    const quizSets = db
      .prepare(`SELECT id, title, questions_json FROM quiz_sets WHERE pdf_id = ? ORDER BY created_at ASC`)
      .all(parsed.data.id) as QuizSetRow[];

    // Assemble ZIP
    const zip = new JSZip();

    if (handoutPages.length > 0) {
      const handoutPdf = await buildHandoutPdf(handoutPages, title);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      zip.file(`${safeFilename(title)}-handout.pdf`, handoutPdf);
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    zip.file('study-sheet.md', llmResult.data.study_sheet);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    zip.file('homework.md', llmResult.data.homework);

    for (const quizSet of quizSets) {
      const quizFilename = `quiz-${quizSet.id}-${safeFilename(quizSet.title)}.json`;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      zip.file(quizFilename, JSON.stringify({ title: quizSet.title, questions: JSON.parse(quizSet.questions_json) }, null, 2));
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const zipBuf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }) as Buffer;

    reply.header('content-type', 'application/zip');
    reply.header('content-disposition', `attachment; filename="${safeFilename(title)}-course-package.zip"`);
    reply.header('cache-control', 'no-store');
    return reply.send(zipBuf);
  });
}
