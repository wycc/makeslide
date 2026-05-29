import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
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
import type { PageRow, PdfMetadataPage, PdfRow } from '../types';
import { renderTextPagesWithLlm } from './steps/renderTextPagesWithLlm';
import { generateScript } from './steps/generateScript';
import { synthesizeAudio } from './steps/synthesizeAudio';

function nowIso(): string {
  return new Date().toISOString();
}

export type AddPagesStep =
  | 'generating_outline'
  | 'rendering_images'
  | 'generating_scripts'
  | 'synthesizing_audio';

export interface AddPagesJobState {
  pdfId: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  step: AddPagesStep | null;
  progress: { current: number; total: number } | null;
  addedPageNumbers: number[];
  totalPagesAfter: number | null;
  error: string | null;
  startedAt: string;
  updatedAt: string;
}

const jobs = new Map<string, AddPagesJobState>();

export function getAddPagesJob(pdfId: string): AddPagesJobState | undefined {
  return jobs.get(pdfId);
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

function renderNewSlideTexts(
  slides: z.infer<typeof AddPagesSlideSchema>['slides'],
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
}): Promise<z.infer<typeof AddPagesSlideSchema>['slides']> {
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
    maxTokens: 4000,
    temperature: 0.5,
    label: 'add-pages-from-prompt',
  });
  return result.data.slides;
}

function updateJob(pdfId: string, updates: Partial<AddPagesJobState>): void {
  const current = jobs.get(pdfId);
  if (current) {
    jobs.set(pdfId, { ...current, ...updates, updatedAt: nowIso() });
  }
}

async function runAddPagesJob(pdfId: string, prompt: string): Promise<void> {
  updateJob(pdfId, { status: 'running' });

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
    const pageRows = db
      .prepare(
        `SELECT page_number, text_path FROM pages WHERE pdf_id = ? ORDER BY page_number ASC`,
      )
      .all(pdfId) as Array<{ page_number: number; text_path: string | null }>;

    // Read existing texts for context (up to 12 pages, max 8000 chars)
    const existingTexts = await Promise.all(
      pageRows.map(async (p) => {
        if (!p.text_path) return '';
        try {
          const fullPath = path.join(pdfDir(pdfId), p.text_path);
          return await fs.promises.readFile(fullPath, 'utf8');
        } catch {
          return '';
        }
      }),
    );
    const existingContext = existingTexts
      .filter(Boolean)
      .slice(0, 12)
      .join('\n\n---\n\n')
      .slice(0, 8000);

    // Step 1: Generate outline
    updateJob(pdfId, {
      step: 'generating_outline',
      progress: { current: 0, total: 1 },
    });

    const newSlides = await generateOutlineForNewPages({
      existingContext,
      userPrompt: prompt,
      existingPageCount,
    });

    updateJob(pdfId, { progress: { current: 1, total: 1 } });

    const newPageCount = existingPageCount + newSlides.length;
    const startPageNumber = existingPageCount + 1;
    const newPagesData = renderNewSlideTexts(newSlides, startPageNumber);

    // Ensure pages directory exists
    await fs.promises.mkdir(pagesDir(pdfId), { recursive: true });

    // Write text files and insert DB rows for new pages
    for (const page of newPagesData) {
      const textPath = pageTextPath(pdfId, page.pageNumber, newPageCount);
      await fs.promises.writeFile(textPath, page.content, 'utf8');
      const relTextPath = path.relative(pdfDir(pdfId), textPath);
      const existing = db
        .prepare(`SELECT page_number FROM pages WHERE pdf_id = ? AND page_number = ?`)
        .get(pdfId, page.pageNumber);
      if (!existing) {
        const now = nowIso();
        db.prepare(
          `INSERT INTO pages (pdf_id, page_number, text_path, status, created_at, updated_at)
           VALUES (?, ?, ?, 'pending', ?, ?)`,
        ).run(pdfId, page.pageNumber, relTextPath, now, now);
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
      progress: { current: 0, total: newSlides.length },
    });

    let renderedCount = 0;
    await renderTextPagesWithLlm({
      pdfId,
      pages: newPagesData,
      totalPageCount: newPageCount,
      onPage: (pageNumber, imagePath) => {
        renderedCount++;
        updateJob(pdfId, {
          progress: { current: renderedCount, total: newSlides.length },
        });
        const relImagePath = path.relative(pdfDir(pdfId), imagePath);
        db.prepare(
          `UPDATE pages SET image_path = ?, status = 'rendered', updated_at = ? WHERE pdf_id = ? AND page_number = ?`,
        ).run(relImagePath, nowIso(), pdfId, pageNumber);
      },
    });

    // Step 3: Generate scripts
    updateJob(pdfId, {
      step: 'generating_scripts',
      progress: { current: 0, total: newSlides.length },
    });

    const pagesForScript = newPagesData.map((p) => ({
      pageNumber: p.pageNumber,
      text: p.content,
      empty: false,
      imagePath: pageImagePath(pdfId, p.pageNumber, newPageCount),
    }));

    let scriptCount = 0;
    const scriptResult = await generateScript({
      pdfId,
      pageCount: newPageCount,
      pages: pagesForScript,
      userPrompt: row.user_prompt,
      maxCharsPerPage: row.script_max_chars_per_page,
      onPage: () => {
        scriptCount++;
        updateJob(pdfId, {
          progress: { current: scriptCount, total: newSlides.length },
        });
      },
    });

    for (const sp of scriptResult.pages) {
      db.prepare(
        `UPDATE pages SET script_path = ?, status = 'script_ready', updated_at = ? WHERE pdf_id = ? AND page_number = ?`,
      ).run(path.relative(pdfDir(pdfId), sp.scriptPath), nowIso(), pdfId, sp.pageNumber);
    }

    // Step 4: Synthesize audio - read scripts for only new pages
    updateJob(pdfId, {
      step: 'synthesizing_audio',
      progress: { current: 0, total: newSlides.length },
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
      onPage: () => {
        audioCount++;
        updateJob(pdfId, {
          progress: { current: audioCount, total: nonEmptyScripts.length },
        });
      },
    });

    for (const a of ttsResult.pages) {
      db.prepare(
        `UPDATE pages SET audio_path = ?, audio_duration_seconds = ?, status = 'audio_ready', updated_at = ? WHERE pdf_id = ? AND page_number = ?`,
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
      { pdfId, addedPages: newSlides.length, newPageCount },
      'add-pages-from-prompt: done',
    );
  } catch (err) {
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

export async function startAddPagesFromPrompt(
  pdfId: string,
  prompt: string,
): Promise<AddPagesJobState> {
  const existing = jobs.get(pdfId);
  if (existing && (existing.status === 'pending' || existing.status === 'running')) {
    const err = new Error('ADD_PAGES_JOB_ALREADY_RUNNING') as Error & { code: string };
    err.code = 'ADD_PAGES_JOB_ALREADY_RUNNING';
    throw err;
  }

  const row = db
    .prepare(`SELECT status, page_count FROM pdfs WHERE id = ?`)
    .get(pdfId) as { status: string; page_count: number | null } | undefined;
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
    error: null,
    startedAt: nowIso(),
    updatedAt: nowIso(),
  };
  jobs.set(pdfId, job);

  void runAddPagesJob(pdfId, prompt).catch((err) => {
    logger.error({ err, pdfId }, 'add-pages-from-prompt: uncaught error in runner');
  });

  return { ...job };
}
