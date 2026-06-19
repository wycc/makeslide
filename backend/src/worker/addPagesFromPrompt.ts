import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { db } from '../db';
import { logger } from '../logger';
import {
  pageImagePath,
  pageScriptPath,
  pageTextPath,
  pagesDir,
  pdfDir,
  readMetadata,
  writeMetadata,
} from '../services/storage';
import { callChatJSON } from '../services/openai';
import { accountIdFromOwnerSub, runWithAccountId } from '../services/accountContext';
import type { PageRow, PdfMetadataPage, PdfRow } from '../types';
import { renderTextPagesWithLlm } from './steps/renderTextPagesWithLlm';
import { generateScript } from './steps/generateScript';
import { synthesizeAudio } from './steps/synthesizeAudio';
import { shiftChildPageNumbers } from '../routes/pdfs/shared';

function nowIso(): string {
  return new Date().toISOString();
}

export type AddPagesStep =
  | 'generating_outline'
  | 'rendering_images'
  | 'generating_scripts'
  | 'synthesizing_audio';

export interface AddPagesPageResult {
  pageNumber: number;
  imageDone: boolean;
  scriptPreview: string | null;
}

export interface AddPagesJobState {
  pdfId: string;
  status: 'pending' | 'running' | 'done' | 'failed' | 'cancelled';
  step: AddPagesStep | null;
  progress: { current: number; total: number } | null;
  addedPageNumbers: number[];
  totalPagesAfter: number | null;
  insertAfterPage: number | null;
  pageResults: AddPagesPageResult[];
  error: string | null;
  startedAt: string;
  updatedAt: string;
}

const jobs = new Map<string, AddPagesJobState>();

export function getAddPagesJob(pdfId: string): AddPagesJobState | undefined {
  return jobs.get(pdfId);
}

export function abortAddPagesJob(pdfId: string): boolean {
  const job = jobs.get(pdfId);
  if (!job || (job.status !== 'pending' && job.status !== 'running')) return false;
  jobs.set(pdfId, { ...job, status: 'cancelled', updatedAt: nowIso() });
  return true;
}

const AddPagesSlideSchema = z.object({
  slides: z
    .array(
      z.object({
        title: z.string().min(1).max(160),
        bullets: z.array(z.string().min(1).max(300)).min(2).max(6),
      }),
    )
    .min(1)
    .max(10),
});

function parseOutlineText(text: string): Array<{ title: string; bullets: string[] }> {
  const slides: Array<{ title: string; bullets: string[] }> = [];
  let current: { title: string; bullets: string[] } | null = null;

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) {
      if (current && current.bullets.length >= 2) {
        slides.push(current);
        current = null;
      }
      continue;
    }
    if (line.startsWith('-') || line.startsWith('•') || line.startsWith('*')) {
      const bullet = line.replace(/^[-•*]\s*/, '').trim();
      if (bullet && current) {
        current.bullets.push(bullet);
      }
    } else {
      const titleMatch = line.match(/^(?:Slide\s*\d+\s*[:：]\s*)?(.+)$/i);
      const title = (titleMatch ? (titleMatch[1] ?? line) : line).trim();
      if (!title) continue;
      if (current && current.bullets.length >= 2) {
        slides.push(current);
      }
      current = { title, bullets: [] };
    }
  }
  if (current && current.bullets.length >= 2) {
    slides.push(current);
  }
  return slides;
}

/**
 * Build insertion context: focus on pages surrounding the insertion point.
 */
export function buildInsertionContext(
  pageTexts: Array<{ page_number: number; text: string }>,
  insertAfter: number,
  maxPages = 12,
  maxChars = 8000,
): string {
  if (pageTexts.length === 0) return '';

  const before = pageTexts.filter((p) => p.page_number <= insertAfter);
  const after = pageTexts.filter((p) => p.page_number > insertAfter);

  const headPages = pageTexts.slice(0, 2);
  const beforePages = before.slice(-5);
  const afterPages = after.slice(0, 5);

  const seen = new Set<number>();
  const selected: Array<{ page_number: number; text: string }> = [];
  for (const p of [...headPages, ...beforePages, ...afterPages]) {
    if (!seen.has(p.page_number) && p.text.trim()) {
      seen.add(p.page_number);
      selected.push(p);
    }
  }
  selected.sort((a, b) => a.page_number - b.page_number);

  return selected
    .slice(0, maxPages)
    .map((p) => `[第 ${p.page_number} 頁]\n${p.text.trim()}`)
    .join('\n\n---\n\n')
    .slice(0, maxChars);
}

function renderNewSlideTexts(
  slides: Array<{ title: string; bullets: string[] }>,
  startPageNumber: number,
): Array<{ pageNumber: number; content: string }> {
  return slides.map((slide, idx) => {
    const pageNumber = startPageNumber + idx;
    const lines = [`Slide ${pageNumber}: ${slide.title.trim()}`];
    for (const bullet of slide.bullets) {
      const trimmed = bullet.trim();
      if (trimmed) lines.push(`- ${trimmed}`);
    }
    return { pageNumber, content: lines.join('\n') };
  });
}

async function generateOutlineForNewPages(params: {
  existingContext: string;
  userPrompt: string;
  existingPageCount: number;
}): Promise<Array<{ title: string; bullets: string[] }>> {
  const result = await callChatJSON({
    messages: [
      {
        role: 'system',
        content: [
          '你是簡報內容企劃助理。',
          '你的工作是根據使用者的需求，為現有簡報追加新的投影片頁面。',
          '新的投影片必須與現有內容一致、不重複，並且延伸或補充現有主題。',
          '務必輸出結構化 JSON，不要輸出 markdown。',
          'JSON 格式：{"slides":[{"title":"頁面標題","bullets":["重點1","重點2"]}]}。',
          '每一頁只能使用 bullets 欄位，每頁 2 到 6 個重點。',
        ].join('\n'),
      },
      {
        role: 'user',
        content: [
          `現有簡報共 ${params.existingPageCount} 頁，部分頁面內容摘要如下：`,
          '',
          params.existingContext,
          '',
          '根據以下需求，生成 2 到 8 頁新的投影片，內容要與現有簡報連貫，不要重複已有頁面的標題：',
          params.userPrompt,
          '',
          '請只輸出 JSON，格式：{"slides":[{"title":"...","bullets":["...","..."]}]}',
        ].join('\n'),
      },
    ],
    schema: AddPagesSlideSchema,
    maxTokens: 128000,
    temperature: 0.5,
    label: 'add-pages-from-prompt',
  });
  return result.data.slides;
}

export const AddPagesOutlineChatSchema = z.object({
  assistant_message: z.string().min(1),
  outline_text: z.string().min(1),
});

export async function continueAddPagesOutlineChat(params: {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  existingContext: string;
  existingPageCount: number;
}): Promise<z.infer<typeof AddPagesOutlineChatSchema>> {
  const { messages, existingContext, existingPageCount } = params;
  const conversation = messages
    .map((m) => `${m.role === 'user' ? '使用者' : 'AI'}：${m.content}`)
    .join('\n\n');

  const result = await callChatJSON({
    messages: [
      {
        role: 'system',
        content: [
          `你是簡報大綱規劃助理，協助使用者為現有 ${existingPageCount} 頁簡報追加新的投影片頁面。`,
          '現有部分頁面摘要如下：',
          '',
          existingContext,
          '',
          '你的任務是根據使用者需求生成「補充大綱」，這些是要插入現有簡報的新頁面。',
          '新頁面不可重複現有內容，必須連貫且延伸現有主題。',
          'outline_text 格式：每個投影片以「標題」開頭，下一行起用 - 列 2 到 6 個重點，以空白行分隔各頁。',
          '範例：',
          '深度學習應用',
          '- CNN 圖像辨識',
          '- RNN 序列處理',
          '- Transformer 注意力機制',
          '',
          '請輸出 JSON，格式：{"assistant_message":"給使用者的回覆","outline_text":"補充投影片大綱"}。',
        ].join('\n'),
      },
      {
        role: 'user',
        content: [
          '以下是對話記錄，請延續並更新大綱：',
          '',
          conversation,
          '',
          '請輸出：{"assistant_message":"...","outline_text":"..."}',
        ].join('\n'),
      },
    ],
    schema: AddPagesOutlineChatSchema,
    maxTokens: 128000,
    temperature: 0.5,
    label: 'add-pages-outline-chat',
  });
  return result.data;
}

function updateJob(pdfId: string, updates: Partial<AddPagesJobState>): void {
  const current = jobs.get(pdfId);
  if (current) {
    jobs.set(pdfId, { ...current, ...updates, updatedAt: nowIso() });
  }
}

function updatePageResult(
  pdfId: string,
  pageNumber: number,
  patch: Partial<AddPagesPageResult>,
): void {
  const job = jobs.get(pdfId);
  if (!job) return;
  const existing = job.pageResults.find((r) => r.pageNumber === pageNumber);
  if (existing) {
    Object.assign(existing, patch);
  } else {
    job.pageResults.push({ pageNumber, imageDone: false, scriptPreview: null, ...patch });
  }
  job.updatedAt = nowIso();
}

async function runAddPagesJob(
  pdfId: string,
  prompt: string,
  outlineText: string | undefined,
  insertAfterPage: number | undefined,
): Promise<void> {
  updateJob(pdfId, { status: 'running' });

  const shouldAbort = (): boolean => jobs.get(pdfId)?.status === 'cancelled';

  try {
    const row = db
      .prepare(
        `SELECT id, title, original_filename, status, page_count,
                user_prompt, tts_voice, tts_speed, script_max_chars_per_page, image_style_prompt
           FROM pdfs WHERE id = ?`,
      )
      .get(pdfId) as PdfRow | undefined;

    if (!row || row.status !== 'ready' || !row.page_count) {
      throw new Error('PDF is not in ready state or has no pages');
    }

    const existingPageCount = row.page_count;

    const insertAfter =
      insertAfterPage !== undefined && insertAfterPage >= 0 && insertAfterPage <= existingPageCount
        ? insertAfterPage
        : existingPageCount;

    const pageRows = db
      .prepare(
        `SELECT page_number, text_path FROM pages WHERE pdf_id = ? ORDER BY page_number ASC`,
      )
      .all(pdfId) as Array<{ page_number: number; text_path: string | null }>;

    const pageTextsWithContent = await Promise.all(
      pageRows.map(async (p) => {
        if (!p.text_path) return { page_number: p.page_number, text: '' };
        try {
          const text = await fs.promises.readFile(path.join(pdfDir(pdfId), p.text_path), 'utf8');
          return { page_number: p.page_number, text };
        } catch {
          return { page_number: p.page_number, text: '' };
        }
      }),
    );
    const existingContext = buildInsertionContext(pageTextsWithContent, insertAfter);

    // Step 1: Generate or parse outline
    updateJob(pdfId, {
      step: 'generating_outline',
      progress: { current: 0, total: 1 },
    });

    if (shouldAbort()) throw Object.assign(new Error('CANCELLED'), { code: 'CANCELLED' });

    let newSlides: Array<{ title: string; bullets: string[] }>;

    if (outlineText) {
      newSlides = parseOutlineText(outlineText);
      if (newSlides.length === 0) {
        throw new Error('無法從大綱文字解析出有效投影片（每頁至少需要標題與 2 個重點）');
      }
    } else {
      newSlides = await generateOutlineForNewPages({
        existingContext,
        userPrompt: prompt,
        existingPageCount,
      });
    }

    updateJob(pdfId, { progress: { current: 1, total: 1 } });

    if (shouldAbort()) throw Object.assign(new Error('CANCELLED'), { code: 'CANCELLED' });

    const insertCount = newSlides.length;
    const newPageCount = existingPageCount + insertCount;
    const startPageNumber = insertAfter + 1;
    const newPagesData = renderNewSlideTexts(newSlides, startPageNumber);

    // Initialise per-page result placeholders
    updateJob(pdfId, {
      pageResults: newPagesData.map((p) => ({
        pageNumber: p.pageNumber,
        imageDone: false,
        scriptPreview: null,
      })),
    });

    // Shift existing pages if inserting in the middle
    if (insertAfter < existingPageCount) {
      db.transaction(() => {
        db.prepare(
          `UPDATE pages SET page_number = page_number + ? + 100000 WHERE pdf_id = ? AND page_number > ?`,
        ).run(insertCount, pdfId, insertAfter);
        shiftChildPageNumbers(pdfId, insertCount + 100000, { gt: insertAfter });
        db.prepare(
          `UPDATE pages SET page_number = page_number - 100000 WHERE pdf_id = ? AND page_number > ?`,
        ).run(pdfId, insertAfter + 100000);
        shiftChildPageNumbers(pdfId, -100000, { gt: insertAfter + 100000 });
      })();
    }

    // Ensure pages directory exists
    await fs.promises.mkdir(pagesDir(pdfId), { recursive: true });

    // Write text files and insert DB rows for new pages
    const newPageUidByNumber = new Map<number, string>();
    for (const page of newPagesData) {
      const existing = db
        .prepare(`SELECT page_number, page_uid FROM pages WHERE pdf_id = ? AND page_number = ?`)
        .get(pdfId, page.pageNumber) as { page_number: number; page_uid: string } | undefined;
      const pageUid = existing?.page_uid ?? nanoid(10);
      newPageUidByNumber.set(page.pageNumber, pageUid);
      const textPath = pageTextPath(pdfId, pageUid);
      await fs.promises.writeFile(textPath, page.content, 'utf8');
      const relTextPath = path.relative(pdfDir(pdfId), textPath);
      if (!existing) {
        const now = nowIso();
        db.prepare(
          `INSERT INTO pages (pdf_id, page_number, page_uid, text_path, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
        ).run(pdfId, page.pageNumber, pageUid, relTextPath, now, now);
      }
    }

    // Update page_count in DB
    db.prepare(`UPDATE pdfs SET page_count = ?, updated_at = ? WHERE id = ?`).run(
      newPageCount,
      nowIso(),
      pdfId,
    );

    // Step 2: Render images
    updateJob(pdfId, {
      step: 'rendering_images',
      progress: { current: 0, total: insertCount },
    });

    let renderedCount = 0;
    await renderTextPagesWithLlm({
      pdfId,
      pages: newPagesData.map((p) => ({ ...p, pageUid: newPageUidByNumber.get(p.pageNumber)! })),
      totalPageCount: newPageCount,
      shouldAbort,
      skipCoverUpdate: true,
      onPage: (pageNumber, imagePath) => {
        renderedCount++;
        updateJob(pdfId, {
          progress: { current: renderedCount, total: insertCount },
        });
        updatePageResult(pdfId, pageNumber, { imageDone: true });
        const relImagePath = path.relative(pdfDir(pdfId), imagePath);
        db.prepare(
          `UPDATE pages SET image_path = ?, status = 'rendered', updated_at = ? WHERE pdf_id = ? AND page_number = ?`,
        ).run(relImagePath, nowIso(), pdfId, pageNumber);
      },
    });

    if (shouldAbort()) throw Object.assign(new Error('CANCELLED'), { code: 'CANCELLED' });

    // Step 3: Generate scripts
    updateJob(pdfId, {
      step: 'generating_scripts',
      progress: { current: 0, total: insertCount },
    });

    const pagesForScript = newPagesData.map((p) => ({
      pageNumber: p.pageNumber,
      text: p.content,
      empty: false,
      imagePath: pageImagePath(pdfId, newPageUidByNumber.get(p.pageNumber)!),
    }));

    const firstNewPage = startPageNumber;
    const lastNewPage = startPageNumber + insertCount - 1;
    const contextPageNums: number[] = [];
    for (let i = Math.max(1, firstNewPage - 5); i < firstNewPage; i++) contextPageNums.push(i);
    for (let i = lastNewPage + 1; i <= Math.min(newPageCount, lastNewPage + 5); i++) contextPageNums.push(i);

    const surroundingRows =
      contextPageNums.length > 0
        ? (db
            .prepare(
              `SELECT page_number, script_path FROM pages
                WHERE pdf_id = ? AND page_number IN (${contextPageNums.map(() => '?').join(',')})
                ORDER BY page_number ASC`,
            )
            .all(pdfId, ...contextPageNums) as Array<{ page_number: number; script_path: string | null }>)
        : [];

    const rewriteContextPages: Array<{ pageNumber: number; script: string }> = [];
    for (const r of surroundingRows) {
      if (!r.script_path) continue;
      try {
        const script = await fs.promises.readFile(path.join(pdfDir(pdfId), r.script_path), 'utf8');
        if (script.trim()) rewriteContextPages.push({ pageNumber: r.page_number, script: script.trim() });
      } catch {
        // skip if file missing
      }
    }

    let scriptCount = 0;
    const scriptResult = await generateScript({
      pdfId,
      pageCount: newPageCount,
      pages: pagesForScript,
      userPrompt: row.user_prompt,
      maxCharsPerPage: row.script_max_chars_per_page,
      rewriteContextPages,
      shouldAbort,
      onPage: (pageNumber) => {
        scriptCount++;
        updateJob(pdfId, {
          progress: { current: scriptCount, total: insertCount },
        });
        // Read script to get preview
        const scriptPath = pageScriptPath(pdfId, newPageUidByNumber.get(pageNumber)!);
        fs.promises.readFile(scriptPath, 'utf8').then((s) => {
          updatePageResult(pdfId, pageNumber, {
            scriptPreview: s.trim().slice(0, 120) || null,
          });
        }).catch(() => {});
      },
    });

    for (const sp of scriptResult.pages) {
      db.prepare(
        `UPDATE pages SET script_path = ?, status = 'script_ready', updated_at = ? WHERE pdf_id = ? AND page_number = ?`,
      ).run(path.relative(pdfDir(pdfId), sp.scriptPath), nowIso(), pdfId, sp.pageNumber);
    }

    if (shouldAbort()) throw Object.assign(new Error('CANCELLED'), { code: 'CANCELLED' });

    // Step 4: Synthesize audio
    updateJob(pdfId, {
      step: 'synthesizing_audio',
      progress: { current: 0, total: insertCount },
    });

    const newPageScripts: Array<{ pageNumber: number; script: string }> = [];
    for (const sp of scriptResult.pages) {
      try {
        const script = await fs.promises.readFile(sp.scriptPath, 'utf8');
        newPageScripts.push({ pageNumber: sp.pageNumber, script });
      } catch {
        newPageScripts.push({ pageNumber: sp.pageNumber, script: '' });
      }
    }

    const nonEmptyScripts = newPageScripts.filter((s) => s.script.trim().length > 0);

    let audioCount = 0;
    const ttsResult = await synthesizeAudio({
      pdfId,
      pageCount: newPageCount,
      pages: nonEmptyScripts,
      voice: row.tts_voice,
      speed: row.tts_speed,
      shouldAbort,
      onPage: () => {
        audioCount++;
        updateJob(pdfId, {
          progress: { current: audioCount, total: nonEmptyScripts.length },
        });
      },
    });

    for (const a of ttsResult.pages) {
      if (a.skipped) {
        logger.error(
          { pdfId, pageNumber: a.pageNumber, error: a.error },
          'add-pages-from-prompt: audio synthesis failed for page',
        );
        db.prepare(
          `UPDATE pages SET status = 'failed', error_message = ?, updated_at = ? WHERE pdf_id = ? AND page_number = ?`,
        ).run(a.error ?? '語音生成失敗', nowIso(), pdfId, a.pageNumber);
        continue;
      }
      db.prepare(
        `UPDATE pages SET audio_path = ?, audio_duration_seconds = ?, status = 'audio_ready', error_message = NULL, updated_at = ? WHERE pdf_id = ? AND page_number = ?`,
      ).run(
        path.relative(pdfDir(pdfId), a.audioPath),
        a.durationSeconds,
        nowIso(),
        pdfId,
        a.pageNumber,
      );
    }

    // Rebuild metadata.json
    const meta = await readMetadata(pdfId);
    if (meta) {
      meta.page_count = newPageCount;
      meta.updated_at = nowIso();
      const allPageRows = db
        .prepare(
          `SELECT page_number, image_path, text_path, script_path, audio_path, audio_duration_seconds, status
             FROM pages WHERE pdf_id = ? ORDER BY page_number ASC`,
        )
        .all(pdfId) as PageRow[];
      meta.pages = allPageRows.map((p): PdfMetadataPage => ({
        page_number: p.page_number,
        image: p.image_path,
        text: p.text_path,
        script: p.script_path ?? undefined,
        audio: p.audio_path ?? undefined,
        audio_duration_seconds: p.audio_duration_seconds ?? undefined,
        status: p.status,
      }));
      await writeMetadata(pdfId, meta);
    }

    updateJob(pdfId, {
      status: 'done',
      step: null,
      progress: null,
      addedPageNumbers: newPagesData.map((p) => p.pageNumber),
      totalPagesAfter: newPageCount,
    });

    logger.info(
      { pdfId, addedPages: insertCount, newPageCount, insertAfter },
      'add-pages-from-prompt: done',
    );
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === 'CANCELLED') {
      // Job was already set to 'cancelled' by abortAddPagesJob; just log
      logger.info({ pdfId }, 'add-pages-from-prompt: cancelled by user');
      // Ensure status stays cancelled
      const current = jobs.get(pdfId);
      if (current && current.status !== 'cancelled') {
        updateJob(pdfId, { status: 'cancelled', step: null, progress: null });
      }
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, pdfId }, 'add-pages-from-prompt: failed');
    updateJob(pdfId, {
      status: 'failed',
      step: null,
      progress: null,
      error: message,
    });
  }
}

export interface StartAddPagesOptions {
  prompt: string;
  outlineText?: string;
  insertAfterPage?: number;
}

export async function startAddPagesFromPrompt(
  pdfId: string,
  opts: StartAddPagesOptions,
): Promise<AddPagesJobState> {
  const existing = jobs.get(pdfId);
  if (existing && (existing.status === 'pending' || existing.status === 'running')) {
    const err = new Error('ADD_PAGES_JOB_ALREADY_RUNNING') as Error & { code: string };
    err.code = 'ADD_PAGES_JOB_ALREADY_RUNNING';
    throw err;
  }

  const row = db
    .prepare(`SELECT status, page_count, owner_sub FROM pdfs WHERE id = ?`)
    .get(pdfId) as { status: string; page_count: number | null; owner_sub: string | null } | undefined;
  if (!row) {
    const err = new Error('PDF_NOT_FOUND') as Error & { code: string };
    err.code = 'PDF_NOT_FOUND';
    throw err;
  }
  if (row.status !== 'ready' || !row.page_count) {
    const err = new Error('PDF_NOT_READY') as Error & { code: string };
    err.code = 'PDF_NOT_READY';
    throw err;
  }

  const job: AddPagesJobState = {
    pdfId,
    status: 'pending',
    step: null,
    progress: null,
    addedPageNumbers: [],
    totalPagesAfter: null,
    insertAfterPage: opts.insertAfterPage ?? null,
    pageResults: [],
    error: null,
    startedAt: nowIso(),
    updatedAt: nowIso(),
  };
  jobs.set(pdfId, job);

  const accountId = accountIdFromOwnerSub(row.owner_sub);
  void runWithAccountId(accountId, () =>
    runAddPagesJob(pdfId, opts.prompt, opts.outlineText, opts.insertAfterPage),
  ).catch((err) => {
    logger.error({ err, pdfId }, 'add-pages-from-prompt: uncaught error in runner');
  });

  return { ...job };
}
