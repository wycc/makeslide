import type { FastifyInstance, FastifyRequest } from 'fastify';
import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { nanoid } from 'nanoid';
import { config } from '../../config';
import { db } from '../../db';
import { createPdfDir } from '../../services/storage';
import type { PdfMetadata, PdfRow } from '../../types';
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
    const file = await request.file({ limits: { fileSize: config.maxImportBytes } });
    if (!file) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Missing zip file'));
    }

    const uploadName = file.filename?.trim() || 'import.zip';
    if (!uploadName.toLowerCase().endsWith('.zip')) {
      // drain the stream to avoid keeping the connection open
      file.file.resume();
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
      // Stream directly to disk to avoid loading large archives into memory
      await pipeline(file.file, fs.createWriteStream(zipPath));
      if (file.file.truncated) {
        return reply
          .code(413)
          .send(errorResponse('FILE_TOO_LARGE', `Import zip must be under ${config.maxImportMb} MB`));
      }
      await runUnzipCommand(zipPath, extractedDir);

      const metadataPath = path.join(extractedDir, 'metadata.json');
      if (!fs.existsSync(metadataPath)) {
        return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid export zip: metadata.json not found'));
      }

      let metadata: PdfMetadata;
      try {
        const raw = await fs.promises.readFile(metadataPath, 'utf8');
        metadata = JSON.parse(raw) as PdfMetadata;
      } catch {
        return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid export zip: metadata.json is not valid JSON'));
      }

      const importedPageCount =
        typeof metadata.page_count === 'number' && Number.isFinite(metadata.page_count) && metadata.page_count > 0
          ? Math.floor(metadata.page_count)
          : null;
      const importedStatus =
        typeof metadata.status === 'string' && metadata.status.trim().length > 0
          ? metadata.status
          : 'ready';
      const importedProgressStep =
        typeof metadata.progress_step === 'string' && metadata.progress_step.trim().length > 0
          ? metadata.progress_step
          : null;
      const importedProgressCurrent =
        typeof metadata.progress_current === 'number' && Number.isFinite(metadata.progress_current)
          ? Math.floor(metadata.progress_current)
          : null;
      const importedProgressTotal =
        typeof metadata.progress_total === 'number' && Number.isFinite(metadata.progress_total)
          ? Math.floor(metadata.progress_total)
          : null;
      const importedErrorMessage = typeof metadata.error_message === 'string' ? metadata.error_message : null;
      const importedUserPrompt = typeof metadata.user_prompt === 'string' ? metadata.user_prompt : null;
      const importedRequireScriptConfirmation = metadata.require_script_confirmation ? 1 : 0;
      const importedRequireSplitConfirmation = metadata.require_split_confirmation ? 1 : 0;
      const importedTtsVoice = typeof metadata.tts_voice === 'string' ? metadata.tts_voice : null;
      const importedTtsSpeed =
        typeof metadata.tts_speed === 'number' && Number.isFinite(metadata.tts_speed)
          ? metadata.tts_speed
          : null;
      const importedScriptMaxCharsPerPage =
        typeof metadata.script_max_chars_per_page === 'number' && Number.isFinite(metadata.script_max_chars_per_page)
          ? Math.floor(metadata.script_max_chars_per_page)
          : null;
      const importedImageStylePrompt = typeof metadata.image_style_prompt === 'string' ? metadata.image_style_prompt : null;
      const importedTotalAudioDurationSeconds =
        typeof metadata.total_audio_duration_seconds === 'number' && Number.isFinite(metadata.total_audio_duration_seconds)
          ? metadata.total_audio_duration_seconds
          : null;
      const importedSourceType = metadata.source_type === 'youtube' ? 'youtube' : 'pdf';
      const importedSourceUrl = typeof metadata.source_url === 'string' ? metadata.source_url : null;
      const importedSourceVideoId = typeof metadata.source_video_id === 'string' ? metadata.source_video_id : null;
      const importedSourceCaptionLanguage = typeof metadata.source_caption_language === 'string' ? metadata.source_caption_language : null;
      const importedTitle = typeof metadata.title === 'string' && metadata.title.trim() ? metadata.title.trim() : title;
      const importedOriginalFilename =
        typeof metadata.original_filename === 'string' && metadata.original_filename.trim()
          ? metadata.original_filename.trim()
          : uploadName;

      const destDir = createPdfDir(id);
      const entries = await fs.promises.readdir(extractedDir);
      for (const entry of entries) {
        await fs.promises.cp(path.join(extractedDir, entry), path.join(destDir, entry), { recursive: true });
      }

      const ownerSub = ownerSubFromRequest(request);
      db.prepare(
        `INSERT INTO pdfs (id, title, original_filename, status, page_count,
                           progress_step, progress_current, progress_total,
                           error_message, user_prompt, require_script_confirmation,
                           require_split_confirmation, tts_voice, tts_speed, script_max_chars_per_page,
                           image_style_prompt, total_audio_duration_seconds,
                           source_type, source_url, source_video_id, source_caption_language, category,
                           owner_sub, visibility, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?,
                 ?, ?, ?, ?, ?,
                 ?, ?, ?, ?,
                 ?, ?,
                 ?, ?, ?, ?, ?,
                 ?, ?, 'private', ?, ?)`
      ).run(
        id,
        importedTitle,
        importedOriginalFilename,
        importedStatus,
        importedPageCount,
        importedProgressStep,
        importedProgressCurrent,
        importedProgressTotal,
        importedErrorMessage,
        importedUserPrompt,
        importedRequireScriptConfirmation,
        importedRequireSplitConfirmation,
        importedTtsVoice,
        importedTtsSpeed,
        importedScriptMaxCharsPerPage,
        importedImageStylePrompt,
        importedTotalAudioDurationSeconds,
        importedSourceType,
        importedSourceUrl,
        importedSourceVideoId,
        importedSourceCaptionLanguage,
        DEFAULT_PDF_CATEGORY,
        ownerSub,
        now,
        now,
      );

      if (Array.isArray(metadata.pages) && metadata.pages.length > 0) {
        const insertPage = db.prepare(
          `INSERT INTO pages (pdf_id, page_number, page_uid, image_path, text_path, script_path, audio_path, status, error_message, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        for (const p of metadata.pages) {
          const pageNumber = typeof p.page_number === 'number' && Number.isFinite(p.page_number)
            ? Math.floor(p.page_number)
            : 0;
          if (pageNumber <= 0) continue;
          const imagePath = typeof p.image === 'string' ? p.image : null;
          const textPath = typeof p.text === 'string' ? p.text : null;
          const scriptPath = typeof p.script === 'string' ? p.script : null;
          const audioPath = typeof p.audio === 'string' ? p.audio : null;
          const pageStatus = typeof p.status === 'string' && p.status.trim() ? p.status : 'ready';
          insertPage.run(
            id,
            pageNumber,
            nanoid(10),
            imagePath,
            textPath,
            scriptPath,
            audioPath,
            pageStatus,
            null,
            now,
            now,
          );
        }
      }

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
