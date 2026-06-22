import type { FastifyInstance, FastifyRequest } from 'fastify';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { db } from '../../db';
import type { PdfRow } from '../../types';
import { pdfDir } from '../../services/storage';
import { decodeSession, parseCookies } from '../auth';
import { errorResponse } from './shared';
import { runZipCommand, addFileToZip, loadExportedSources, buildContentDisposition } from './export';

const BATCH_EXPORT_TIMEOUT_MS = 10 * 60_000;

interface BatchExportJob {
  ownerSub: string;
  status: 'running' | 'done' | 'failed';
  progress: number;
  total: number;
  tempDir?: string;
  zipPath?: string;
  error?: string;
  createdAt: number;
}

const batchExportJobs = new Map<string, BatchExportJob>();

setInterval(() => {
  const now = Date.now();
  for (const [id, job] of batchExportJobs) {
    if (now - job.createdAt > BATCH_EXPORT_TIMEOUT_MS) {
      if (job.tempDir) void fs.promises.rm(job.tempDir, { recursive: true, force: true });
      batchExportJobs.delete(id);
    }
  }
}, 5 * 60_000);

function sessionSub(request: FastifyRequest): string | null {
  const session = decodeSession(parseCookies(request).makeslide_session);
  return session?.sub ?? null;
}

function uniqueZipName(used: Set<string>, baseName: string): string {
  let candidate = `${baseName}.zip`;
  if (!used.has(candidate)) return candidate;
  let n = 2;
  while (used.has(`${baseName}_${n}.zip`)) n++;
  return `${baseName}_${n}.zip`;
}

async function runBatchExport(jobId: string, ownerSub: string, tempDir: string): Promise<void> {
  const job = batchExportJobs.get(jobId);
  if (!job) return;

  const pdfs = db
    .prepare(`SELECT id, title FROM pdfs WHERE owner_sub = ? AND status = 'ready' ORDER BY created_at ASC`)
    .all(ownerSub) as Array<Pick<PdfRow, 'id' | 'title'>>;

  job.total = pdfs.length;

  const stagingDir = path.join(tempDir, 'staging');
  await fs.promises.mkdir(stagingDir, { recursive: true });

  const usedNames = new Set<string>();

  for (let i = 0; i < pdfs.length; i++) {
    const pdf = pdfs[i];
    if (!pdf) continue;
    const sourceDir = pdfDir(pdf.id);
    if (!fs.existsSync(sourceDir)) {
      job.progress = i + 1;
      continue;
    }
    const safeBase = (pdf.title?.trim() || pdf.id).replace(/[\\/:*?"<>|]+/g, '_').slice(0, 120);
    const innerZipName = uniqueZipName(usedNames, safeBase || pdf.id);
    usedNames.add(innerZipName);
    const innerZipPath = path.join(stagingDir, innerZipName);
    try {
      await runZipCommand(sourceDir, innerZipPath);
      const sources = loadExportedSources(pdf.id);
      if (sources.length > 0) {
        // Use a per-pdf temp dir so the file is stored as 'sources.json' (not an absolute path)
        const perPdfTmpDir = path.join(tempDir, `tmp-src-${pdf.id}`);
        await fs.promises.mkdir(perPdfTmpDir, { recursive: true });
        await fs.promises.writeFile(path.join(perPdfTmpDir, 'sources.json'), JSON.stringify(sources, null, 2), 'utf8');
        await addFileToZip(perPdfTmpDir, innerZipPath, 'sources.json');
        void fs.promises.rm(perPdfTmpDir, { recursive: true, force: true });
      }
    } catch {
      // Skip failed PDFs; continue with the rest
    }
    job.progress = i + 1;
  }

  const outerZipPath = path.join(tempDir, 'batch-export.zip');
  await runZipCommand(stagingDir, outerZipPath);
  job.zipPath = outerZipPath;
  job.status = 'done';
}

export async function registerBatchExportRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/export/batch — start a batch export job, returns jobId for polling
  app.post('/api/export/batch', async (request, reply) => {
    const sub = sessionSub(request);
    if (!sub) return reply.code(403).send(errorResponse('FORBIDDEN', '需要登入才能批次匯出'));

    const jobId = crypto.randomUUID();
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), `makeslide-batch-${jobId}-`));

    const job: BatchExportJob = {
      ownerSub: sub,
      status: 'running',
      progress: 0,
      total: 0,
      tempDir,
      createdAt: Date.now(),
    };
    batchExportJobs.set(jobId, job);

    void runBatchExport(jobId, sub, tempDir).catch((err: unknown) => {
      const j = batchExportJobs.get(jobId);
      if (j) {
        j.status = 'failed';
        j.error = err instanceof Error ? err.message : 'Unknown error';
      }
    });

    return reply.send({ jobId, status: 'running' });
  });

  // GET /api/export/batch/:jobId — poll job status
  app.get('/api/export/batch/:jobId', async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const sub = sessionSub(request);
    const job = batchExportJobs.get(jobId);
    if (!job) return reply.code(404).send(errorResponse('NOT_FOUND', 'Export job not found'));
    if (!sub || job.ownerSub !== sub) return reply.code(403).send(errorResponse('FORBIDDEN', '無權限存取此匯出任務'));
    return reply.send({ jobId, status: job.status, progress: job.progress, total: job.total, error: job.error ?? null });
  });

  // GET /api/export/batch/:jobId/download — download the finished ZIP
  app.get('/api/export/batch/:jobId/download', async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const sub = sessionSub(request);
    const job = batchExportJobs.get(jobId);
    if (!job) return reply.code(404).send(errorResponse('NOT_FOUND', 'Export job not found'));
    if (!sub || job.ownerSub !== sub) return reply.code(403).send(errorResponse('FORBIDDEN', '無權限存取此匯出任務'));
    if (job.status !== 'done' || !job.zipPath) {
      return reply.code(409).send(errorResponse('INVALID_STATE', '匯出尚未完成'));
    }
    const zipBuffer = await fs.promises.readFile(job.zipPath);
    const dateStr = new Date().toISOString().slice(0, 10);
    const zipName = `makeslide_all_${dateStr}.zip`;
    void reply.header('content-type', 'application/zip');
    void reply.header('content-length', String(zipBuffer.byteLength));
    void reply.header('cache-control', 'no-store');
    void reply.header('content-disposition', buildContentDisposition(zipName));
    return reply.send(zipBuffer);
  });
}
