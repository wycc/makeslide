import type { FastifyInstance, FastifyRequest } from 'fastify';
import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import os from 'node:os';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { config } from '../../config';
import { db } from '../../db';
import { createPdfDir } from '../../services/storage';
import type { PdfMetadata, PdfRow } from '../../types';
import { isPageStatus } from '../../statusMachine';
import { decodeSession, parseCookies } from '../auth';
import { DEFAULT_PDF_CATEGORY, errorResponse, nowIso, rowToListItem } from './shared';
import { runUnzipCommand } from './unzip';

// 跟 detail.ts 的 `POST /api/pdfs/:id/sources/txt` 共用同一套上限，避免匯入端
// 用一份刻意構造的超大/格式錯誤 sources.json 塞爆資料庫；單一筆驗證失敗只跳過
// 那一筆，不影響整個匯入流程（其餘 metadata 欄位仍可能是合法、值得保留的）。
const ImportedSourceSchema = z.object({
  source_kind: z.enum(['pdf', 'txt', 'youtube_caption', 'youtube_audio']),
  source_name: z.string().trim().max(200).nullable().optional(),
  content_text: z.string().trim().min(1).max(120000),
  created_at: z.string().trim().min(1).optional(),
  updated_at: z.string().trim().min(1).optional(),
});

// 投票題目（page_polls）。options_json 是 export 端直接帶出的 JSON 字串，這裡只驗證
// 長度上限避免被塞爆，內容維持原樣寫回（來源就是本服務自己的匯出檔）。單筆驗證失敗
// 只跳過該筆，不影響其餘匯入。
const ImportedPollSchema = z.object({
  page_number: z.number().int().positive(),
  question: z.string().trim().min(1).max(2000),
  options_json: z.string().trim().min(1).max(20000),
  is_active: z.union([z.literal(0), z.literal(1)]).optional(),
  show_results: z.union([z.literal(0), z.literal(1)]).optional(),
  created_at: z.string().trim().min(1).optional(),
  updated_at: z.string().trim().min(1).optional(),
});

// 測驗題庫（quiz_sets）。questions_json 同樣是匯出端帶出的 JSON 字串。
const ImportedQuizSchema = z.object({
  title: z.string().trim().min(1).max(500),
  prompt: z.string().max(20000),
  questions_json: z.string().trim().min(1).max(200000),
  created_at: z.string().trim().min(1).optional(),
  updated_at: z.string().trim().min(1).optional(),
});

// 動畫對應（pages.render_type / animation_spec_path）。匯入時依 page_number 套回；
// 對應的規格檔已隨儲存目錄原樣複製，因此 animation_spec_path 直接沿用即可。
const ImportedAnimationSchema = z.object({
  page_number: z.number().int().positive(),
  render_type: z.enum(['static-image', 'gsap-image']),
  animation_spec_path: z.string().trim().max(500).nullable().optional(),
});

/**
 * 讀取 export.zip 根目錄的某個 sidecar JSON（陣列），逐筆用 schema 驗證後回傳合法項目。
 * 缺檔、非 JSON、非陣列、或單筆驗證失敗都只是「少還原這部分」而非整個匯入失敗——舊版
 * 匯出檔本來就不含這些檔案。
 */
async function readSidecarArray<T>(
  extractedDir: string,
  fileName: string,
  schema: z.ZodType<T>,
  log: FastifyRequest['log'],
): Promise<T[]> {
  const filePath = path.join(extractedDir, fileName);
  if (!fs.existsSync(filePath)) return [];
  const out: T[] = [];
  try {
    const raw = await fs.promises.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        const result = schema.safeParse(item);
        if (result.success) out.push(result.data);
      }
    }
  } catch (err) {
    log.warn({ err, fileName }, 'Failed to parse sidecar JSON in export zip, skipping');
  }
  return out;
}

function ownerSubFromRequest(request: FastifyRequest): string | null {
  const session = decodeSession(parseCookies(request).makeslide_session);
  return session?.sub ?? null;
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

      // sources.json／polls.json／quizzes.json／animations.json 都是選用的 sidecar
      // （舊版匯出檔、或這份簡報本來就沒有對應資料時都不會有），缺檔或格式錯誤皆視為
      // 「沒有這部分資料可還原」，不視為整個匯入失敗。
      const importedSources = await readSidecarArray(extractedDir, 'sources.json', ImportedSourceSchema, request.log);
      const importedPolls = await readSidecarArray(extractedDir, 'polls.json', ImportedPollSchema, request.log);
      const importedQuizzes = await readSidecarArray(extractedDir, 'quizzes.json', ImportedQuizSchema, request.log);
      const importedAnimations = await readSidecarArray(extractedDir, 'animations.json', ImportedAnimationSchema, request.log);

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
        // sources.json 只是 export.zip 用來搭載 pdf_sources 資料表內容的中繼檔
        // （該表不落在 pdfDir() 底下任何檔案裡），下面會把它的內容寫回資料庫，
        // 不應該原樣留在新 PDF 的儲存目錄裡。
        if (entry === 'sources.json') continue;
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
          // Normalize to a valid PAGE status: preserve the imported one when it's
          // valid, otherwise fall back to the terminal 'audio_ready'. ('ready' is a
          // PDF-level status, not a page status — importing it would make the page
          // invisible to quality-check/exports and get it marked 'failed' by the
          // startup orphan-recovery sweep.)
          const pageStatus = isPageStatus(p.status) ? p.status : 'audio_ready';
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

      if (importedSources.length > 0) {
        const insertSource = db.prepare(
          `INSERT INTO pdf_sources (pdf_id, source_kind, source_name, content_text, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        );
        for (const s of importedSources) {
          insertSource.run(
            id,
            s.source_kind,
            s.source_name?.trim() || null,
            s.content_text,
            s.created_at || now,
            s.updated_at || now,
          );
        }
      }

      // 還原投票題目／測驗題庫／動畫對應。page_polls 與 animations 都依 page_number
      // 對應到上面剛建立的 pages，因此先查出實際存在的頁碼，跳過對不到頁的孤兒資料
      // （避免外鍵失敗讓整個匯入回滾）。
      const existingPageNumbers = new Set(
        (db.prepare('SELECT page_number FROM pages WHERE pdf_id = ?').all(id) as Array<{ page_number: number }>)
          .map((r) => r.page_number),
      );

      if (importedPolls.length > 0) {
        const insertPoll = db.prepare(
          `INSERT INTO page_polls (pdf_id, page_number, question, options_json, is_active, show_results, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        );
        for (const poll of importedPolls) {
          if (!existingPageNumbers.has(poll.page_number)) continue;
          insertPoll.run(
            id,
            poll.page_number,
            poll.question,
            poll.options_json,
            poll.is_active ?? 1,
            poll.show_results ?? 1,
            poll.created_at || now,
            poll.updated_at || now,
          );
        }
      }

      if (importedQuizzes.length > 0) {
        const insertQuiz = db.prepare(
          `INSERT INTO quiz_sets (pdf_id, title, prompt, questions_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        );
        for (const quiz of importedQuizzes) {
          insertQuiz.run(id, quiz.title, quiz.prompt, quiz.questions_json, quiz.created_at || now, quiz.updated_at || now);
        }
      }

      if (importedAnimations.length > 0) {
        const updateAnimation = db.prepare(
          `UPDATE pages SET render_type = ?, animation_spec_path = ?, updated_at = ? WHERE pdf_id = ? AND page_number = ?`
        );
        for (const anim of importedAnimations) {
          if (!existingPageNumbers.has(anim.page_number)) continue;
          updateAnimation.run(anim.render_type, anim.animation_spec_path ?? null, now, id, anim.page_number);
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
