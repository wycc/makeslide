import type { FastifyInstance } from 'fastify';
import { canReadPdf } from './permissions';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { db } from '../../db';
import type { PdfRow, PdfSourceItem } from '../../types';
import { pdfDir } from '../../services/storage';
import { sessionSub } from '../auth';
import { IdParamSchema, errorResponse } from './shared';

/**
 * `pdf_sources`（「來源」分頁顯示的 YouTube 字幕原文/使用者上傳 TXT 原文等資料）
 * 只存在 SQLite 資料庫裡，不是 `pdfDir()` 底下的檔案，所以單純把儲存目錄打包成
 * zip 不會帶到這份資料。匯出時額外把這個表的內容序列化成 `sources.json` 加進 zip
 * 根目錄，供 `import.ts` 還原，避免「匯出備份 -> 匯入還原」流程把來源資料分頁的
 * 內容靜默遺失（原始 id/pdf_id 因為匯入後會換成新的 PDF id，不寫進匯出檔）。
 */
export interface ExportedPdfSource {
  source_kind: PdfSourceItem['source_kind'];
  source_name: string | null;
  content_text: string;
  created_at: string;
  updated_at: string;
}

/** Exported for unit testing; not part of the public export routes API. */
export function loadExportedSources(pdfId: string): ExportedPdfSource[] {
  const rows = db
    .prepare(
      `SELECT source_kind, source_name, content_text, created_at, updated_at
         FROM pdf_sources
        WHERE pdf_id = ?
        ORDER BY created_at ASC, id ASC`,
    )
    .all(pdfId) as ExportedPdfSource[];
  return rows;
}

/**
 * 投票題目（`page_polls`）同樣只存在資料庫、不落在 `pdfDir()` 底下，所以單純打包
 * 儲存目錄帶不到。匯出時序列化成 `polls.json` 加進 zip，供 `import.ts` 還原。只帶
 * 題目本身（不含 `page_poll_votes` 的學生票數）——匯入會建立一份全新的私有副本，
 * 原本聽眾的投票紀錄套到新副本上沒有意義，且 `id`/`pdf_id` 匯入後都會換新。
 */
export interface ExportedPoll {
  page_number: number;
  question: string;
  options_json: string;
  is_active: number;
  show_results: number;
  created_at: string;
  updated_at: string;
}

/** Exported for unit testing; not part of the public export routes API. */
export function loadExportedPolls(pdfId: string): ExportedPoll[] {
  return db
    .prepare(
      `SELECT page_number, question, options_json, is_active, show_results, created_at, updated_at
         FROM page_polls
        WHERE pdf_id = ?
        ORDER BY page_number ASC, created_at ASC, id ASC`,
    )
    .all(pdfId) as ExportedPoll[];
}

/**
 * 測驗題庫（`quiz_sets`）也是純資料庫資料。序列化成 `quizzes.json` 加進 zip。
 * 同樣只帶題庫，不帶 `quiz_attempts`（學生作答紀錄）。
 */
export interface ExportedQuiz {
  title: string;
  prompt: string;
  questions_json: string;
  created_at: string;
  updated_at: string;
}

/** Exported for unit testing; not part of the public export routes API. */
export function loadExportedQuizzes(pdfId: string): ExportedQuiz[] {
  return db
    .prepare(
      `SELECT title, prompt, questions_json, created_at, updated_at
         FROM quiz_sets
        WHERE pdf_id = ?
        ORDER BY created_at ASC, id ASC`,
    )
    .all(pdfId) as ExportedQuiz[];
}

/**
 * GSAP 動畫規格檔（`pages/<page_uid>.animation.json`）本身會隨 `pdfDir()` 一起被打包，
 * 但「這一頁要用動畫播放」這件事是記在 `pages` 資料表的 `render_type` /
 * `animation_spec_path` 欄位，而 `import.ts` 重建 `pages` 時不會帶到這兩欄（還會重新
 * 產生 `page_uid`），導致匯入後動畫靜默失效。把這兩欄序列化成 `animations.json`，
 * 匯入時依 `page_number` 對回去即可——規格檔已隨儲存目錄原樣複製，路徑維持不變。
 */
export interface ExportedAnimation {
  page_number: number;
  render_type: string;
  animation_spec_path: string | null;
}

/** Exported for unit testing; not part of the public export routes API. */
export function loadExportedAnimations(pdfId: string): ExportedAnimation[] {
  return db
    .prepare(
      `SELECT page_number, render_type, animation_spec_path
         FROM pages
        WHERE pdf_id = ?
          AND render_type IS NOT NULL
          AND render_type <> 'static-image'
        ORDER BY page_number ASC`,
    )
    .all(pdfId) as ExportedAnimation[];
}

const ZIP_EXPORT_TIMEOUT_MS = 2 * 60_000;

/**
 * Builds an RFC 6266-compliant Content-Disposition header value for a filename that may
 * contain non-ASCII characters (e.g. a Traditional Chinese presentation title).
 *
 * `filename="..."` alone is NOT percent-decoded by browsers/HTTP clients — it's taken
 * literally. Wrapping a UTF-8 string in encodeURIComponent() and putting it in `filename="..."`
 * (the previous behaviour here) therefore produces a literal "%E4%B8%AD...zip" filename on
 * download instead of the intended CJK title. The fix follows RFC 5987/6266: an ASCII-only
 * `filename=` fallback for clients that don't understand the extended syntax, plus a
 * `filename*=UTF-8''<percent-encoded>` parameter that modern browsers prefer and decode correctly.
 */
export function buildContentDisposition(filename: string): string {
  const asciiFallback = filename.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, "'");
  const encoded = encodeURIComponent(filename).replace(/['()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

/** Exported for unit testing; not part of the public export routes API. */
export function runZipCommand(
  cwd: string,
  outputZipPath: string,
  options: { command?: string; timeoutMs?: number } = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const command = options.command ?? 'zip';
    const timeoutMs = options.timeoutMs ?? ZIP_EXPORT_TIMEOUT_MS;
    const child = spawn(command, ['-r', '-q', outputZipPath, '.'], { cwd, stdio: 'ignore' });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`zip command timed out after ${timeoutMs} ms`));
        return;
      }
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`zip command failed with code ${code ?? -1}`));
    });
  });
}

/**
 * Exported for unit testing; not part of the public export routes API.
 * 把 `cwd` 底下的單一檔案（`fileName`）以「去掉路徑、放進 zip 根目錄」的方式加進
 * 已存在的 `outputZipPath`（`zip -j`），用於追加 `sources.json` 而不重新打包整個
 * pdfDir() 目錄、也不需要先把它複製進 pdfDir() 弄髒原始儲存目錄。
 */
export function addFileToZip(
  cwd: string,
  outputZipPath: string,
  fileName: string,
  options: { command?: string; timeoutMs?: number } = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const command = options.command ?? 'zip';
    const timeoutMs = options.timeoutMs ?? ZIP_EXPORT_TIMEOUT_MS;
    const child = spawn(command, ['-j', '-q', outputZipPath, fileName], { cwd, stdio: 'ignore' });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`zip command timed out after ${timeoutMs} ms`));
        return;
      }
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

    const sub = sessionSub(request);
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

      // 把一份資料表內容序列化成 sidecar JSON，以「去掉路徑、放進 zip 根目錄」的方式
      // 加進已存在的 zip（不影響前面 runZipCommand 寫入的 pdfDir() 內容，也不碰
      // sourceDir 本身）。空陣列就略過，維持舊版匯出檔不含該檔的相容性。
      const appendSidecar = async (fileName: string, data: unknown[]): Promise<void> => {
        if (data.length === 0) return;
        const sidecarPath = path.join(tempDir, fileName);
        await fs.promises.writeFile(sidecarPath, JSON.stringify(data, null, 2), 'utf8');
        await addFileToZip(tempDir, zipPath, fileName);
      };

      await appendSidecar('sources.json', loadExportedSources(parsed.data.id));
      await appendSidecar('polls.json', loadExportedPolls(parsed.data.id));
      await appendSidecar('quizzes.json', loadExportedQuizzes(parsed.data.id));
      await appendSidecar('animations.json', loadExportedAnimations(parsed.data.id));

      const zipBuffer = await fs.promises.readFile(zipPath);
      reply.header('content-type', 'application/zip');
      reply.header('content-length', String(zipBuffer.byteLength));
      reply.header('cache-control', 'no-store');
      reply.header('content-disposition', buildContentDisposition(zipFileName));
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
