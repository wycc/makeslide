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

      const sources = loadExportedSources(parsed.data.id);
      if (sources.length > 0) {
        const sourcesJsonPath = path.join(tempDir, 'sources.json');
        await fs.promises.writeFile(sourcesJsonPath, JSON.stringify(sources, null, 2), 'utf8');
        // 只把這個檔案以「去掉路徑、放進 zip 根目錄」的方式加進已存在的 zip，不影響
        // 前面 runZipCommand 已經寫入的 pdfDir() 內容，也完全不會碰到 sourceDir 本身。
        await addFileToZip(tempDir, zipPath, 'sources.json');
      }

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
