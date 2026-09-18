import type { FastifyInstance, FastifyRequest } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { db } from '../../db';
import { config } from '../../config';
import { logger } from '../../logger';
import type { PdfStatus } from '../../types';
import { createPdfDir, pdfDir, removePdfDir } from '../../services/storage';
import { getAccountContentLanguage } from '../../services/aiSettings';
import { looksLikePptx } from '../../services/pptx/pptxArchive';
import { checkLibreOffice } from '../../services/pptx/renderFrames';
import { PPTX_IMPORT_HEARTBEAT_MS } from '../../worker/pipeline';
import { importPptxIntoDeck, type PptxImportProgress } from '../../services/pptx/importPptx';
import { narrateImportedDeck, type DeckNarrationProgress } from '../../services/pptx/stepNarration';
import { currentAccountId, runWithAccountId } from '../../services/accountContext';
import { canReadPdf, canEditPdf, aclCtx, getPdfPermissionRow } from './permissions';
import { errorResponse, nowIso, replyIfLlmDisabled, IdParamSchema } from './shared';
import { decodeSession, parseCookies, sessionSub } from '../auth';

/**
 * Importing a PowerPoint file, animation and all (docs/pptx-animated-import-design.md §5).
 *
 * The work is long — the reference deck renders 136 pictures — so the upload answers as soon as
 * the file is stored and the deck row exists, and the import runs behind it. An agent (or the UI)
 * follows it with the status endpoint.
 *
 * Job state is in memory, like add-pages: it exists to let a caller watch a run it just started,
 * and a restart is not a case worth persisting for, since the deck rows written so far survive on
 * their own.
 */

const PDF_ID_SIZE = 10;
const MAX_PPTX_BYTES = 200 * 1024 * 1024;

interface ImportJob {
  pdfId: string;
  status: 'running' | 'succeeded' | 'failed';
  progress: PptxImportProgress;
  error: string | null;
  startedAt: string;
  endedAt: string | null;
  result: { pageCount: number; animatedPageCount: number; stepCount: number; title: string } | null;
}

const jobs = new Map<string, ImportJob>();

interface NarrationJob {
  status: 'running' | 'succeeded' | 'failed';
  progress: DeckNarrationProgress;
  error: string | null;
  startedAt: string;
  endedAt: string | null;
  result: { pages: number; steps: number; spoken: number } | null;
  textOnly: boolean;
}

const narrationJobs = new Map<string, NarrationJob>();

/** Same rule as the other upload routes: the deck belongs to whoever is signed in, if anyone. */
function ownerSubFromRequest(request: FastifyRequest): string | null {
  const session = decodeSession(parseCookies(request).makeslide_session);
  return session?.sub ?? null;
}

export function getPptxImportJob(pdfId: string): ImportJob | null {
  return jobs.get(pdfId) ?? null;
}

export async function registerPptxImportRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/pdfs/from-pptx — multipart with a single `file` field.
  app.post('/api/pdfs/from-pptx', async (request, reply) => {
    if (!request.isMultipart()) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Expected multipart/form-data'));
    }
    // Refuse before storing anything: without a renderer every page would come out blank, and a
    // deck full of blank pages is worse than a clear "this host cannot do that".
    const renderer = await checkLibreOffice();
    if (!renderer.available) {
      return reply
        .code(503)
        .send(errorResponse('PPTX_RENDERER_UNAVAILABLE', '這台主機沒有可用的 LibreOffice，無法匯入 pptx'));
    }

    let buffer: Buffer | null = null;
    let originalName = 'presentation.pptx';
    let userPrompt: string | null = null;
    let scriptMaxCharsPerPage: number | null = null;
    let scriptCharsPerStep: number | null = null;
    let narrateAfterImport = false;
    try {
      const file = await request.file({ limits: { fileSize: MAX_PPTX_BYTES } });
      if (!file) return reply.code(400).send(errorResponse('NO_FILE', 'No file field found'));
      originalName = file.filename || originalName;
      // Read before the buffer: the client appends fields ahead of the file so they are already
      // parsed by the time the file handle exists (same order the PDF upload relies on).
      userPrompt = multipartFieldValue(file.fields.user_prompt)?.trim().slice(0, 4000) || null;
      scriptMaxCharsPerPage = multipartNumber(file.fields.script_max_chars_per_page, 80, 2000);
      scriptCharsPerStep = multipartNumber(file.fields.script_chars_per_step, 40, 2000);
      narrateAfterImport = multipartFieldValue(file.fields.narrate) === 'true';
      buffer = await file.toBuffer();
    } catch (err) {
      const e = err as { code?: string };
      if (e.code === 'FST_REQ_FILE_TOO_LARGE') {
        return reply.code(413).send(errorResponse('FILE_TOO_LARGE', `檔案超過 ${MAX_PPTX_BYTES / 1024 / 1024} MB 上限`));
      }
      request.log.error({ err }, 'pptx import: failed to read upload');
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Failed to parse multipart request'));
    }
    if (!buffer || buffer.length === 0) {
      return reply.code(400).send(errorResponse('NO_FILE', 'Uploaded file is empty'));
    }
    if (buffer.length > config.maxUploadBytes && buffer.length > MAX_PPTX_BYTES) {
      return reply.code(413).send(errorResponse('FILE_TOO_LARGE', '檔案過大'));
    }
    // The extension proves nothing; the archive has to actually be a presentation.
    if (!(await looksLikePptx(buffer))) {
      return reply.code(400).send(errorResponse('INVALID_MIME', '這個檔案不是 .pptx 簡報'));
    }

    const pdfId = nanoid(PDF_ID_SIZE);
    const createdAt = nowIso();
    const ownerSub = ownerSubFromRequest(request);
    const contentLanguage = getAccountContentLanguage();
    const title = path.basename(originalName, path.extname(originalName)).slice(0, 200) || 'PPTX';
    const status: PdfStatus = 'processing';

    let sourcePath: string;
    try {
      createPdfDir(pdfId);
      sourcePath = path.join(pdfDir(pdfId), 'source.pptx');
      await fs.promises.writeFile(sourcePath, buffer);
      db.transaction(() => {
        db.prepare(
          `INSERT INTO pdfs (id, title, original_filename, status, page_count,
                             progress_step, error_message, user_prompt, require_script_confirmation,
                             category, owner_sub, visibility,
                             tts_voice, tts_speed, script_max_chars_per_page, script_chars_per_step,
                             image_style_prompt,
                             host_mode, content_language, created_at, updated_at)
           VALUES (?, ?, ?, ?, 0, 'pptx_import', NULL, ?, 0, 'general', ?, 'private',
                   NULL, NULL, ?, ?, NULL, 'solo', ?, ?, ?)`,
        ).run(
          pdfId, title, originalName, status,
          // The style and the lengths are the deck's standing instructions from the outset, so the
          // narration written later — whenever it is asked for — already follows them.
          userPrompt,
          ownerSub,
          scriptMaxCharsPerPage,
          scriptCharsPerStep,
          contentLanguage, createdAt, createdAt,
        );
        db.prepare(
          `INSERT INTO pdf_sources (pdf_id, source_kind, source_name, content_text, created_at, updated_at)
           VALUES (?, 'pptx', ?, '', ?, ?)`,
        ).run(pdfId, originalName, createdAt, createdAt);
      })();
    } catch (err) {
      request.log.error({ err, pdfId }, 'pptx import: failed to create the deck');
      try {
        await removePdfDir(pdfId);
      } catch {
        // best effort
      }
      return reply.code(500).send(errorResponse('INTERNAL_ERROR', 'Failed to create presentation'));
    }

    startImportJob(pdfId, sourcePath, narrateAfterImport ? currentAccountId() : null);
    return reply.code(202).send({ id: pdfId, title, status: 'processing', narrate: narrateAfterImport });
  });

  // POST /api/pdfs/:id/pptx-narration — write the per-step narration and its voice.
  //
  // Separate from the import because it costs model and TTS calls: an import whose pictures are
  // right is worth keeping on its own, and an agent may want to write the narration itself.
  app.post('/api/pdfs/:id/pptx-narration', async (request, reply) => {
    const parsed = IdParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id parameter'));
    }
    const { id } = parsed.data;
    const pdfRow = getPdfPermissionRow(id);
    if (!pdfRow) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    if (!canEditPdf(sessionSub(request), pdfRow, aclCtx(request, id))) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限編輯此簡報'));
    }
    if (replyIfLlmDisabled(reply)) return reply;
    const running = narrationJobs.get(id);
    if (running?.status === 'running') {
      return reply.code(409).send(errorResponse('INVALID_STATE', '這份簡報正在產生逐步旁白'));
    }
    const parsedBody = z
      .object({
        text_only: z.boolean().optional(),
        /** Only these pages; everything else keeps the narration it has. */
        pages: z.array(z.number().int().positive()).max(MAX_NARRATION_PAGES).optional(),
        /**
         * Length for this run, overriding the deck's settings. At most one is meaningful:
         *  - chars_per_page: a whole page's worth; the actual budget grows with the step count and
         *    the model spreads it over the steps by what each one reveals. The normal control.
         *  - chars_per_step: an explicit per-step length, for "this much per step" exactly.
         *  - keep_lengths: rewrite what the steps say without changing how long they are.
         */
        chars_per_page: z.number().int().min(80).max(4000).optional(),
        chars_per_step: z.number().int().min(40).max(2000).optional(),
        keep_lengths: z.boolean().optional(),
        /**
         * An extra instruction for this run only. Not stored and not written into the narration
         * plan — unlike the deck's prompt, which every later regeneration keeps following.
         */
        instruction: z.string().max(2000).optional(),
      })
      .safeParse(request.body ?? {});
    if (!parsedBody.success) {
      return reply
        .code(400)
        .send(errorResponse('INVALID_REQUEST', parsedBody.error.issues[0]?.message ?? 'Invalid body'));
    }
    const textOnly = parsedBody.data.text_only === true;
    const pages = parsedBody.data.pages;
    const charsPerStep = parsedBody.data.chars_per_step;
    const pageTargetChars = parsedBody.data.chars_per_page;
    const keepLengths = parsedBody.data.keep_lengths === true;
    const instruction = parsedBody.data.instruction?.trim() || undefined;

    startNarrationJob(id, currentAccountId(), {
      textOnly, pages, charsPerStep, pageTargetChars, keepLengths, instruction,
    });
    return reply.code(202).send({
      id,
      status: 'running',
      text_only: textOnly,
      ...(pages ? { pages } : {}),
      ...(charsPerStep ? { chars_per_step: charsPerStep } : {}),
      ...(pageTargetChars ? { chars_per_page: pageTargetChars } : {}),
      ...(keepLengths ? { keep_lengths: true } : {}),
    });
  });

  // GET /api/pdfs/:id/pptx-import/status
  app.get('/api/pdfs/:id/pptx-import/status', async (request, reply) => {
    const parsed = IdParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id parameter'));
    }
    const { id } = parsed.data;
    const pdfRow = getPdfPermissionRow(id);
    if (!pdfRow) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    if (!canReadPdf(sessionSub(request), pdfRow, aclCtx(request, id))) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限檢視此簡報'));
    }
    const job = jobs.get(id);
    if (!job) {
      // No job in memory: either the server restarted, or the import finished long ago. The deck
      // row is the durable answer, so report from it rather than pretending nothing happened.
      const row = db.prepare(`SELECT status, page_count, error_message FROM pdfs WHERE id = ?`).get(id) as
        | { status: string; page_count: number | null; error_message: string | null }
        | undefined;
      return reply.send({
        id,
        status: row?.status === 'failed' ? 'failed' : row?.status === 'ready' ? 'succeeded' : 'unknown',
        progress: null,
        error: row?.error_message ?? null,
        page_count: row?.page_count ?? 0,
        narration: narrationState(id),
      });
    }
    return reply.send({
      id,
      status: job.status,
      narration: narrationState(id),
      progress: job.progress,
      error: job.error,
      started_at: job.startedAt,
      ended_at: job.endedAt,
      result: job.result,
    });
  });
}

/** A page list longer than the deck is a mistake, not a request; 200 is the import's own slide cap. */
const MAX_NARRATION_PAGES = 200;

/** One multipart field's value, or undefined. Same shape the PDF upload uses. */
function multipartFieldValue(field: unknown): string | undefined {
  const first = Array.isArray(field) ? field[0] : field;
  if (!first || typeof first !== 'object') return undefined;
  const value = (first as { value?: unknown }).value;
  return typeof value === 'string' ? value : undefined;
}

/** A numeric multipart field within bounds, or null when absent/unusable. */
function multipartNumber(field: unknown, min: number, max: number): number | null {
  const raw = multipartFieldValue(field);
  if (raw === undefined || raw.trim() === '') return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) return null;
  return n;
}

/** Import stages, as the deck list's progress labels name them. */
const PPTX_PROGRESS_STEPS: Record<string, string> = {
  parsing: 'pptx_parsing',
  rendering: 'pptx_rendering',
  building: 'pptx_building',
  done: 'pptx_building',
};

/** The narration job's state, or null when none has been started in this process. */
function narrationState(pdfId: string): {
  status: string;
  progress: DeckNarrationProgress;
  error: string | null;
  result: { pages: number; steps: number; spoken: number } | null;
} | null {
  const job = narrationJobs.get(pdfId);
  if (!job) return null;
  return { status: job.status, progress: job.progress, error: job.error, result: job.result };
}

/**
 * Start the narration job for a deck, as `accountId`.
 *
 * Separate from the route because the import can start it too: asked for at upload time, it runs
 * as soon as the pages exist. The account has to be passed in rather than read here — by then the
 * request that carried it is long gone, and narration spends that account's model and TTS budget.
 */
function startNarrationJob(
  pdfId: string,
  accountId: string,
  opts: NarrationJobOptions,
): void {
  void runNarrationJob(pdfId, accountId, opts);
}

interface NarrationJobOptions {
  textOnly?: boolean;
  pages?: number[];
  charsPerStep?: number;
  pageTargetChars?: number;
  keepLengths?: boolean;
  instruction?: string;
  /** Called with each progress report, so the import can mirror it onto the deck row. */
  onProgress?: (progress: { done: number; total: number; pageNumber: number }) => void;
}

/**
 * The narration job, awaitable. The route fires it and moves on; the import awaits it, because an
 * imported deck stays read-only until its narration exists (see startImportJob).
 */
async function runNarrationJob(pdfId: string, accountId: string, opts: NarrationJobOptions): Promise<NarrationJob> {
  const running = narrationJobs.get(pdfId);
  if (running?.status === 'running') return running;
  const job: NarrationJob = {
    status: 'running',
    progress: { done: 0, total: 0, pageNumber: 0, stage: 'planning' as const },
    error: null,
    startedAt: nowIso(),
    endedAt: null,
    result: null,
    textOnly: opts.textOnly === true,
  };
  narrationJobs.set(pdfId, job);
  try {
    const result = await runWithAccountId(accountId, () =>
      narrateImportedDeck({
        pdfId,
        textOnly: opts.textOnly,
        pages: opts.pages,
        charsPerStep: opts.charsPerStep,
        pageTargetChars: opts.pageTargetChars,
        keepCurrentLengths: opts.keepLengths,
        instruction: opts.instruction,
        onProgress: (progress) => {
          job.progress = progress;
          opts.onProgress?.(progress);
        },
      }));
    job.result = result;
    job.status = 'succeeded';
  } catch (err) {
    job.status = 'failed';
    job.error = err instanceof Error ? err.message : String(err);
    logger.error({ err, pdfId }, 'pptx narration: failed');
  } finally {
    job.endedAt = nowIso();
  }
  return job;
}

/**
 * @param narrateAsAccount When set, the narration is started as that account once the pictures
 *   are done. Offered at upload time because the two together are what "import this deck" means to
 *   the user, and the alternative is watching for the import to end in order to press a second
 *   button — the import takes minutes.
 */
function startImportJob(pdfId: string, sourcePath: string, narrateAsAccount: string | null = null): void {
  const job: ImportJob = {
    pdfId,
    status: 'running',
    progress: { stage: 'parsing', done: 0, total: 1 },
    error: null,
    startedAt: nowIso(),
    endedAt: null,
    result: null,
  };
  jobs.set(pdfId, job);
  // Heartbeat, so the periodic rescan can tell a running import from an orphaned one. Progress
  // callbacks alone are not enough: a LibreOffice batch reports nothing until it finishes, and the
  // rescan cannot see this process's in-memory job table from another process.
  const heartbeat = setInterval(() => {
    try {
      db.prepare(`UPDATE pdfs SET updated_at = ? WHERE id = ? AND status = 'processing'`).run(nowIso(), pdfId);
    } catch (err) {
      logger.warn({ err, pdfId }, 'pptx import: heartbeat write failed');
    }
  }, PPTX_IMPORT_HEARTBEAT_MS);
  heartbeat.unref();
  void (async () => {
    try {
      // The deck list polls every 5s while anything is processing, so the stage belongs in the
      // row as well as in the job: an import takes minutes, and a card that says only "處理中"
      // for all of them is indistinguishable from one that is stuck.
      let lastStage: string | null = null;
      const result = await importPptxIntoDeck({
        pdfId,
        pptxPath: sourcePath,
        onProgress: (progress) => {
          job.progress = progress;
          const step = PPTX_PROGRESS_STEPS[progress.stage];
          if (step && step !== lastStage) {
            lastStage = step;
            db.prepare(`UPDATE pdfs SET progress_step = ?, updated_at = ? WHERE id = ?`).run(step, nowIso(), pdfId);
          }
        },
      });
      job.result = result;
      job.status = 'succeeded';
      job.endedAt = nowIso();
      logger.info({ pdfId, ...result }, 'pptx import: finished');

      if (narrateAsAccount) {
        // The deck stays `processing` — and therefore read-only — until its narration exists, as a
        // PDF or TXT deck does until its audio is done. Releasing it after the pictures would open
        // an editor and a player on pages whose voice is still being recorded: the player plays
        // half a page, and an edit made now is overwritten by the narration that is still coming.
        // The heartbeat keeps running across this (it is only cleared in `finally`), or the
        // periodic rescan would declare a long narration dead three minutes in.
        db.prepare(
          `UPDATE pdfs SET progress_step = 'pptx_narrating', progress_current = 0, progress_total = 0, updated_at = ? WHERE id = ?`,
        ).run(nowIso(), pdfId);
        const narration = await runNarrationJob(pdfId, narrateAsAccount, {
          onProgress: (progress) => {
            db.prepare(`UPDATE pdfs SET progress_current = ?, progress_total = ?, updated_at = ? WHERE id = ?`)
              .run(progress.done, progress.total, nowIso(), pdfId);
          },
        });
        // A failed narration still releases the deck. Its pages and pictures are good, the step
        // panel can retry the narration, and leaving it `failed` would lock a usable deck
        // read-only for good — a PDF that fails has nothing to show, this one does.
        db.prepare(
          `UPDATE pdfs SET status = 'ready', progress_step = NULL, progress_current = NULL, progress_total = NULL,
                  error_message = ?, updated_at = ? WHERE id = ?`,
        ).run(
          narration.status === 'failed' ? `旁白產生失敗：${(narration.error ?? '').slice(0, 1800)}` : null,
          nowIso(),
          pdfId,
        );
      } else {
        db.prepare(`UPDATE pdfs SET status = 'ready', progress_step = NULL, updated_at = ? WHERE id = ?`).run(
          nowIso(),
          pdfId,
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      job.status = 'failed';
      job.error = message;
      job.endedAt = nowIso();
      db.prepare(`UPDATE pdfs SET status = 'failed', error_message = ?, updated_at = ? WHERE id = ?`).run(
        message.slice(0, 2000),
        nowIso(),
        pdfId,
      );
      logger.error({ err, pdfId }, 'pptx import: failed');
    } finally {
      clearInterval(heartbeat);
    }
  })();
}
