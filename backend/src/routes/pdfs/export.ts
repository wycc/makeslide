import type { FastifyInstance, FastifyRequest } from 'fastify';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { db } from '../../db';
import type { PdfRow } from '../../types';
import { pdfDir } from '../../services/storage';
import { decodeSession, parseCookies } from '../auth';
import { IdParamSchema, errorResponse } from './shared';

function sessionSubFromRequest(request: FastifyRequest): string | null {
  const session = decodeSession(parseCookies(request).makeslide_session);
  return session?.sub ?? null;
}

function canReadPdf(sub: string | null, row: Pick<PdfRow, 'owner_sub' | 'visibility'>): boolean {
  if (!row.owner_sub) return true;
  if (sub && row.owner_sub === sub) return true;
  return row.visibility === 'public' || row.visibility === 'public_editable';
}

function runZipCommand(cwd: string, outputZipPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('zip', ['-r', '-q', outputZipPath, '.'], { cwd, stdio: 'ignore' });
    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`zip command failed with code ${code ?? -1}`));
    });
  });
}

export async function registerExportRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/pdfs/:id/export.zip', async (request, reply) => {
    const parsed = IdParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id parameter'));
    }

    const row = db
      .prepare('SELECT id, title, owner_sub, visibility FROM pdfs WHERE id = ?')
      .get(parsed.data.id) as Pick<PdfRow, 'id' | 'title' | 'owner_sub' | 'visibility'> | undefined;
    if (!row) {
      return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${parsed.data.id} not found`));
    }

    const sub = sessionSubFromRequest(request);
    if (!canReadPdf(sub, row)) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限檢視此簡報'));
    }

    const sourceDir = pdfDir(parsed.data.id);
    if (!fs.existsSync(sourceDir)) {
      return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${parsed.data.id} storage not found`));
    }

    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), `makeslide-export-${parsed.data.id}-`));
    const safeBaseName = (row.title?.trim() || parsed.data.id)
      .replace(/[\\/:*?"<>|]+/g, '_')
      .slice(0, 120);
    const zipFileName = `${safeBaseName || parsed.data.id}.zip`;
    const zipPath = path.join(tempDir, zipFileName);

    try {
      await runZipCommand(sourceDir, zipPath);
      const zipBuffer = await fs.promises.readFile(zipPath);
      reply.header('content-type', 'application/zip');
      reply.header('content-length', String(zipBuffer.byteLength));
      reply.header('cache-control', 'no-store');
      reply.header('content-disposition', `attachment; filename="${encodeURIComponent(zipFileName)}"`);
      return reply.send(zipBuffer);
    } catch {
      return reply.code(500).send(errorResponse('INTERNAL_ERROR', 'Failed to export zip'));
    } finally {
      setTimeout(() => {
        void fs.promises.rm(tempDir, { recursive: true, force: true });
      }, 30000);
    }
  });
}
