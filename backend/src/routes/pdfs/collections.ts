import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { canReadPdf, aclCtx } from './permissions';
import { db } from '../../db';
import { logger } from '../../logger';
import type { PdfRow } from '../../types';
import { config } from '../../config';
import { sessionSub } from '../auth';
import { callChatJSON } from '../../services/openai';
import { pageTextPath, pageScriptPath, pageImagePath, pagesDir } from '../../services/storage';
import { nanoid } from 'nanoid';
import { errorResponse, PDF_ID_SIZE } from './shared';

const CreateCollectionBodySchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  source_pdf_ids: z.array(z.string().min(1).max(200)).min(1).max(50),
});

interface SourcePageRow {
  page_number: number;
  page_uid: string;
  image_path: string | null;
}

async function readTextIfExists(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return '';
  }
}

/** Concatenate a source presentation's per-page slide text + narration for summarization. */
async function readSourceContent(pdfId: string, pages: SourcePageRow[]): Promise<string> {
  const chunks: string[] = [];
  for (const page of pages) {
    const [text, script] = await Promise.all([
      readTextIfExists(pageTextPath(pdfId, page.page_uid)),
      readTextIfExists(pageScriptPath(pdfId, page.page_uid)),
    ]);
    const body = [`投影片文字：${text.trim() || '（無）'}`, `逐字稿：${script.trim() || '（無）'}`].join('\n');
    chunks.push(`第 ${page.page_number} 頁\n${body}`);
  }
  return chunks.join('\n\n---\n\n').slice(0, 40000);
}

const SummaryResultSchema = z.object({ summary: z.string().trim().min(1).max(2000) });

/** AI-generate a short摘要 for one source presentation; falls back to the title on any failure. */
async function summarizeSource(title: string, content: string): Promise<string> {
  if (!content.trim()) return `${title}\n\n（此簡報尚無可摘要的內容）`;
  try {
    const result = await callChatJSON({
      label: `collection-summary ${title}`,
      messages: [
        {
          role: 'system',
          content: [
            '你是一位繁體中文簡報摘要助理。請根據簡報逐字稿與投影片文字，寫出一段 3-5 句的重點摘要，',
            '讓讀者快速掌握這份簡報的主題與重點。只輸出 JSON，格式為 {"summary":"..."}，不要輸出 markdown 代碼塊。',
          ].join('\n'),
        },
        { role: 'user', content: `簡報標題：${title}\n\n${content}` },
      ],
      schema: SummaryResultSchema,
      maxTokens: 800,
      temperature: 0.4,
    });
    return result.data.summary.trim();
  } catch (err) {
    logger.warn({ title, error: err instanceof Error ? err.message : String(err) }, 'collection-summary: LLM failed, using title fallback');
    return `${title}\n\n（摘要生成失敗，請開啟原簡報查看內容）`;
  }
}

async function copyFileSafe(src: string, dest: string): Promise<boolean> {
  try {
    await fs.copyFile(src, dest);
    return true;
  } catch {
    return false;
  }
}

export async function registerCollectionRoutes(app: FastifyInstance): Promise<void> {
  // Create a "collection" presentation: one page per selected source, each a summary + link.
  // A quiz generated from this collection aggregates the full content of every source.
  app.post('/api/pdfs/collections', async (request, reply) => {
    const sub = sessionSub(request);
    if (!sub) return reply.code(401).send(errorResponse('UNAUTHORIZED', 'Authentication required'));

    const parsed = CreateCollectionBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', parsed.error.issues[0]?.message ?? 'Invalid body'));

    // De-duplicate while preserving order.
    const sourceIds = [...new Set(parsed.data.source_pdf_ids)];

    // Verify read access to every source and collect its pages up front.
    const sources: Array<{ id: string; title: string; pages: SourcePageRow[] }> = [];
    for (const srcId of sourceIds) {
      const srcRow = db
        .prepare(`SELECT id, title, original_filename, owner_sub, visibility FROM pdfs WHERE id = ?`)
        .get(srcId) as (Pick<PdfRow, 'id' | 'title' | 'original_filename' | 'owner_sub' | 'visibility'>) | undefined;
      if (!srcRow) return reply.code(404).send(errorResponse('NOT_FOUND', `PDF not found: ${srcId}`));
      if (!canReadPdf(sub, srcRow, aclCtx(request, srcId))) return reply.code(403).send(errorResponse('FORBIDDEN', `Access denied: ${srcId}`));
      const pages = db
        .prepare(`SELECT page_number, page_uid, image_path FROM pages WHERE pdf_id = ? ORDER BY page_number ASC`)
        .all(srcId) as SourcePageRow[];
      sources.push({ id: srcId, title: srcRow.title || srcRow.original_filename || srcId, pages });
    }

    // Use the same id shape as uploads (nanoid, PDF_ID_SIZE) so the collection passes the
    // PDF_ID_RE param guard on downstream routes such as /quizzes/generate — a 36-char
    // crypto.randomUUID() would be rejected there.
    const newId = nanoid(PDF_ID_SIZE);
    const now = new Date().toISOString();
    const newTitle = parsed.data.title ?? `簡報合輯 ${now.slice(0, 10)}`;

    db.prepare(
      `INSERT INTO pdfs (id, title, original_filename, status, page_count, source_type, owner_sub, visibility, created_at, updated_at)
       VALUES (?, ?, ?, 'ready', ?, 'collection', ?, 'private', ?, ?)`,
    ).run(newId, newTitle, `${newId}.pdf`, sources.length, sub, now, now);

    await fs.mkdir(path.join(config.storageRoot, newId), { recursive: true });
    await fs.mkdir(pagesDir(newId), { recursive: true });

    for (let i = 0; i < sources.length; i++) {
      const source = sources[i]!;
      const pageNumber = i + 1;
      const pageUid = crypto.randomUUID();
      const pageNow = new Date().toISOString();

      const content = await readSourceContent(source.id, source.pages);
      const summary = await summarizeSource(source.title, content);
      const slideText = `${source.title}\n\n${summary}`;

      // Cover image: copy the source's first-page image if present.
      const firstImagePage = source.pages.find((p) => p.image_path !== null) ?? source.pages[0];
      let imageRel: string | null = null;
      if (firstImagePage) {
        const destImageRel = `pages/${pageUid}.jpg`;
        const destImage = path.join(config.storageRoot, newId, destImageRel);
        const copied = await copyFileSafe(pageImagePath(source.id, firstImagePage.page_uid), destImage);
        if (copied) imageRel = destImageRel;
      }

      const textRel = `pages/${pageUid}.text.txt`;
      const scriptRel = `pages/${pageUid}.script.txt`;
      await fs.writeFile(path.join(config.storageRoot, newId, textRel), slideText, 'utf8');
      await fs.writeFile(path.join(config.storageRoot, newId, scriptRel), summary, 'utf8');

      db.prepare(
        `INSERT INTO pages (pdf_id, page_number, page_uid, image_path, text_path, script_path, link_pdf_id, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'audio_ready', ?, ?)`,
      ).run(newId, pageNumber, pageUid, imageRel, textRel, scriptRel, source.id, pageNow, pageNow);
    }

    return reply.code(201).send({ id: newId, title: newTitle, pageCount: sources.length });
  });
}
