import type { FastifyInstance, FastifyRequest } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { db } from '../../db';
import { config } from '../../config';
import { logger } from '../../logger';
import type { PdfStatus } from '../../types';
import { createPdfDir, pdfDir, removePdfDir } from '../../services/storage';
import { getAccountContentLanguage } from '../../services/aiSettings';
import { looksLikePptx } from '../../services/pptx/pptxArchive';
import { checkLibreOffice } from '../../services/pptx/renderFrames';
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
    try {
      const file = await request.file({ limits: { fileSize: MAX_PPTX_BYTES } });
      if (!file) return reply.code(400).send(errorResponse('NO_FILE', 'No file field found'));
      originalName = file.filename || originalName;
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
                             tts_voice, tts_speed, script_max_chars_per_page, image_style_prompt,
                             host_mode, content_language, created_at, updated_at)
           VALUES (?, ?, ?, ?, 0, 'pptx_import', NULL, NULL, 0, 'general', ?, 'private',
                   NULL, NULL, NULL, NULL, 'solo', ?, ?, ?)`,
        ).run(pdfId, title, originalName, status, ownerSub, contentLanguage, createdAt, createdAt);
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

    startImportJob(pdfId, sourcePath);
    return reply.code(202).send({ id: pdfId, title, status: 'processing' });
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
    const body = (request.body ?? {}) as { text_only?: unknown };
    const textOnly = body.text_only === true;

    const job: NarrationJob = {
      status: 'running',
      progress: { done: 0, total: 0, pageNumber: 0 },
      error: null,
      startedAt: nowIso(),
      endedAt: null,
      result: null,
      textOnly,
    };
    narrationJobs.set(id, job);
    const accountId = currentAccountId();
    void (async () => {
      try {
        const result = await runWithAccountId(accountId, () =>
          narrateImportedDeck({
            pdfId: id,
            textOnly,
            onProgress: (progress) => {
              job.progress = progress;
            },
          }));
        job.result = result;
        job.status = 'succeeded';
      } catch (err) {
        job.status = 'failed';
        job.error = err instanceof Error ? err.message : String(err);
        logger.error({ err, pdfId: id }, 'pptx narration: failed');
      } finally {
        job.endedAt = nowIso();
      }
    })();
    return reply.code(202).send({ id, status: 'running', text_only: textOnly });
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

function startImportJob(pdfId: string, sourcePath: string): void {
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
  void (async () => {
    try {
      const result = await importPptxIntoDeck({
        pdfId,
        pptxPath: sourcePath,
        onProgress: (progress) => {
          job.progress = progress;
        },
      });
      job.result = result;
      job.status = 'succeeded';
      job.endedAt = nowIso();
      db.prepare(`UPDATE pdfs SET status = 'ready', progress_step = NULL, updated_at = ? WHERE id = ?`).run(
        nowIso(),
        pdfId,
      );
      logger.info({ pdfId, ...result }, 'pptx import: finished');
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
    }
  })();
}
