import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { db } from '../../db';
import type { PdfRow } from '../../types';
import { pdfDir } from '../../services/storage';
import { sessionSub } from '../auth';
import { canReadPdf, aclCtx } from './permissions';
import { IdParamSchema, errorResponse } from './shared';
import {
  runZipCommand,
  addFileToZip,
  loadExportedSources,
  loadExportedPageUids,
  loadExportedPolls,
  loadExportedQuizzes,
  loadExportedAnimations,
  loadExportedNotebooks,
  sendZipDownload,
} from './export';

// Job-based counterpart to the synchronous GET /api/pdfs/:id/export.zip (which stays as-is for
// existing callers/tests). This lets PlayPage show a progress bar for a single-deck export
// instead of blocking on one long request, mirroring the batch-export job+poll+download pattern.
const SINGLE_EXPORT_TIMEOUT_MS = 10 * 60_000;

interface SingleExportJob {
  pdfId: string;
  status: 'running' | 'done' | 'failed';
  progress: number;
  total: number;
  tempDir?: string;
  zipPath?: string;
  zipFileName?: string;
  error?: string;
  createdAt: number;
}

const singleExportJobs = new Map<string, SingleExportJob>();

setInterval(() => {
  const now = Date.now();
  for (const [id, job] of singleExportJobs) {
    if (now - job.createdAt > SINGLE_EXPORT_TIMEOUT_MS) {
      if (job.tempDir) void fs.promises.rm(job.tempDir, { recursive: true, force: true });
      singleExportJobs.delete(id);
    }
  }
}, 5 * 60_000);

// Fixed step count (zip + 6 sidecar checks + final read) so the frontend gets a stable,
// predictable total regardless of which sidecar tables happen to have rows for this deck.
const SINGLE_EXPORT_TOTAL_STEPS = 8;

async function runSingleExport(jobId: string, pdfId: string, sourceDir: string, zipFileName: string): Promise<void> {
  const job = singleExportJobs.get(jobId);
  if (!job || !job.tempDir) return;
  const tempDir = job.tempDir;
  const zipPath = path.join(tempDir, zipFileName);

  await runZipCommand(sourceDir, zipPath);
  job.progress = 1;

  const appendSidecar = async (fileName: string, data: unknown[]): Promise<void> => {
    if (data.length > 0) {
      const sidecarPath = path.join(tempDir, fileName);
      await fs.promises.writeFile(sidecarPath, JSON.stringify(data, null, 2), 'utf8');
      await addFileToZip(tempDir, zipPath, fileName);
    }
    job.progress += 1;
  };

  await appendSidecar('sources.json', loadExportedSources(pdfId));
  await appendSidecar('page-uids.json', loadExportedPageUids(pdfId));
  await appendSidecar('polls.json', loadExportedPolls(pdfId));
  await appendSidecar('quizzes.json', loadExportedQuizzes(pdfId));
  await appendSidecar('animations.json', loadExportedAnimations(pdfId));
  await appendSidecar('notebooks.json', loadExportedNotebooks(pdfId));

  // Touch the file to confirm it's readable before declaring done (mirrors the sync route,
  // which reads the buffer eagerly rather than streaming it back on download).
  await fs.promises.access(zipPath, fs.constants.R_OK);
  job.progress = SINGLE_EXPORT_TOTAL_STEPS;
  job.zipPath = zipPath;
  job.zipFileName = zipFileName;
  job.status = 'done';
}

export async function registerExportJobRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/pdfs/:id/export-job — start a single-deck export job, returns jobId for polling
  app.post('/api/pdfs/:id/export-job', async (request, reply) => {
    const parsed = IdParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id parameter'));
    }
    const { id } = parsed.data;

    const row = db
      .prepare('SELECT id, title, owner_sub, visibility FROM pdfs WHERE id = ?')
      .get(id) as Pick<PdfRow, 'id' | 'title' | 'owner_sub' | 'visibility'> | undefined;
    if (!row) {
      return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    }

    const sub = sessionSub(request);
    if (!canReadPdf(sub, row, aclCtx(request, id))) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限檢視此簡報'));
    }

    const sourceDir = pdfDir(id);
    if (!fs.existsSync(sourceDir)) {
      return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} storage not found`));
    }

    const jobId = crypto.randomUUID();
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), `makeslide-export-job-${id}-`));
    const safeBaseName = (row.title?.trim() || id).replace(/[\\/:*?"<>|]+/g, '_').slice(0, 120);
    const zipFileName = `${safeBaseName || id}.zip`;

    const job: SingleExportJob = {
      pdfId: id,
      status: 'running',
      progress: 0,
      total: SINGLE_EXPORT_TOTAL_STEPS,
      tempDir,
      createdAt: Date.now(),
    };
    singleExportJobs.set(jobId, job);

    void runSingleExport(jobId, id, sourceDir, zipFileName).catch((err: unknown) => {
      const j = singleExportJobs.get(jobId);
      if (j) {
        j.status = 'failed';
        j.error = err instanceof Error ? err.message : 'Unknown error';
      }
    });

    return reply.send({ jobId, status: 'running' });
  });

  // GET /api/pdfs/:id/export-job/:jobId — poll job status
  app.get('/api/pdfs/:id/export-job/:jobId', async (request, reply) => {
    const parsed = IdParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id parameter'));
    }
    const { id } = parsed.data;
    const { jobId } = request.params as { jobId: string };

    const job = singleExportJobs.get(jobId);
    if (!job || job.pdfId !== id) {
      return reply.code(404).send(errorResponse('NOT_FOUND', 'Export job not found'));
    }

    const row = db
      .prepare('SELECT id, owner_sub, visibility FROM pdfs WHERE id = ?')
      .get(id) as Pick<PdfRow, 'id' | 'owner_sub' | 'visibility'> | undefined;
    const sub = sessionSub(request);
    if (!row || !canReadPdf(sub, row, aclCtx(request, id))) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限存取此匯出任務'));
    }

    return reply.send({ jobId, status: job.status, progress: job.progress, total: job.total, error: job.error ?? null });
  });

  // GET /api/pdfs/:id/export-job/:jobId/download — download the finished ZIP
  app.get('/api/pdfs/:id/export-job/:jobId/download', async (request, reply) => {
    const parsed = IdParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id parameter'));
    }
    const { id } = parsed.data;
    const { jobId } = request.params as { jobId: string };

    const job = singleExportJobs.get(jobId);
    if (!job || job.pdfId !== id) {
      return reply.code(404).send(errorResponse('NOT_FOUND', 'Export job not found'));
    }

    const row = db
      .prepare('SELECT id, owner_sub, visibility FROM pdfs WHERE id = ?')
      .get(id) as Pick<PdfRow, 'id' | 'owner_sub' | 'visibility'> | undefined;
    const sub = sessionSub(request);
    if (!row || !canReadPdf(sub, row, aclCtx(request, id))) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限存取此匯出任務'));
    }

    if (job.status !== 'done' || !job.zipPath || !job.zipFileName) {
      return reply.code(409).send(errorResponse('INVALID_STATE', '匯出尚未完成'));
    }

    const zipBuffer = await fs.promises.readFile(job.zipPath);
    return sendZipDownload(reply, zipBuffer, job.zipFileName);
  });
}
