import type { FastifyInstance, FastifyRequest } from 'fastify';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { nanoid } from 'nanoid';
import { db } from '../../db';
import { createPdfDir } from '../../services/storage';
import type { PdfRow } from '../../types';
import { decodeSession, parseCookies } from '../auth';
import { DEFAULT_PDF_CATEGORY, errorResponse, nowIso, rowToListItem } from './shared';

function ownerSubFromRequest(request: FastifyRequest): string | null {
  const session = decodeSession(parseCookies(request).makeslide_session);
  return session?.sub ?? null;
}

function runUnzipCommand(zipPath: string, outputDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('unzip', ['-q', zipPath, '-d', outputDir], { stdio: 'ignore' });
    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`unzip command failed with code ${code ?? -1}`));
    });
  });
}

export async function registerImportRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/pdfs/import.zip', async (request, reply) => {
    const file = await request.file();
    if (!file) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Missing zip file'));
    }

    const uploadName = file.filename?.trim() || 'import.zip';
    if (!uploadName.toLowerCase().endsWith('.zip')) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Only .zip files are supported'));
    }

    const id = nanoid(10);
    const now = nowIso();
    const title = uploadName.replace(/\.zip$/i, '').trim() || `import-${id}`;
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), `makeslide-import-${id}-`));
    const zipPath = path.join(tempDir, 'input.zip');
    const extractedDir = path.join(tempDir, 'unzipped');

    try {
      await fs.promises.mkdir(extractedDir, { recursive: true });
      const data = await file.toBuffer();
      await fs.promises.writeFile(zipPath, data);
      await runUnzipCommand(zipPath, extractedDir);

      const metadataPath = path.join(extractedDir, 'metadata.json');
      if (!fs.existsSync(metadataPath)) {
        return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid export zip: metadata.json not found'));
      }

      const destDir = createPdfDir(id);
      const entries = await fs.promises.readdir(extractedDir);
      for (const entry of entries) {
        await fs.promises.cp(path.join(extractedDir, entry), path.join(destDir, entry), { recursive: true });
      }

      const ownerSub = ownerSubFromRequest(request);
      db.prepare(
        `INSERT INTO pdfs (id, title, original_filename, status, page_count,
                           progress_step, error_message, user_prompt, require_script_confirmation,
                           require_split_confirmation, tts_voice, tts_speed, script_max_chars_per_page,
                           source_type, source_url, source_video_id, source_caption_language, category,
                           owner_sub, visibility, created_at, updated_at)
         VALUES (?, ?, ?, 'ready', NULL,
                 NULL, NULL, NULL, 0,
                 0, NULL, NULL, NULL,
                 'pdf', NULL, NULL, NULL, ?,
                 ?, 'private', ?, ?)`
      ).run(id, title, uploadName, DEFAULT_PDF_CATEGORY, ownerSub, now, now);

      const row = db.prepare('SELECT * FROM pdfs WHERE id = ?').get(id) as PdfRow | undefined;
      if (!row) {
        return reply.code(500).send(errorResponse('INTERNAL_ERROR', 'Import succeeded but record missing'));
      }
      return reply.code(201).send(rowToListItem(row));
    } catch (err) {
      request.log.error({ err }, 'Failed to import export zip');
      return reply.code(500).send(errorResponse('INTERNAL_ERROR', 'Failed to import zip'));
    } finally {
      void fs.promises.rm(tempDir, { recursive: true, force: true });
    }
  });
}

