import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getPdfPermissionRow, canReadPdf, canEditPdf, aclCtx } from './permissions';
import { sessionSub } from '../auth';
import { errorResponse, IdParamSchema, nowIso } from './shared';
import { narrationDir, narrationAudioPath, narrationTimelinePath } from '../../services/storage';

// 簡報旁白錄音（MVP）：每份簡報存一段講者旁白音檔（webm/opus）＋翻頁時間軸。
// 上傳/刪除需編輯權限；讀取/串流需讀取權限。時間軸由前端以 buildSlideTimeline 產生。

const SegmentSchema = z.object({
  page: z.number().int(),
  startMs: z.number().nonnegative(),
  endMs: z.number().nonnegative(),
});
const TimelineSchema = z.object({
  durationMs: z.number().nonnegative(),
  segments: z.array(SegmentSchema).max(10000),
});

interface StoredTimeline {
  durationMs: number;
  segments: z.infer<typeof SegmentSchema>[];
  createdAt: string;
}

/** Reads a text value from a @fastify/multipart field (mirrors quizzes.ts's helper). */
function multipartFieldValue(field: unknown): string | undefined {
  if (field && typeof field === 'object' && 'value' in field) {
    const value = (field as { value: unknown }).value;
    if (typeof value === 'string') return value;
  }
  return undefined;
}

async function readStoredTimeline(pdfId: string): Promise<StoredTimeline | null> {
  try {
    const raw = await fs.readFile(narrationTimelinePath(pdfId), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    const result = z
      .object({ durationMs: z.number(), segments: z.array(SegmentSchema), createdAt: z.string() })
      .safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

export async function registerNarrationRoutes(app: FastifyInstance): Promise<void> {
  // 上傳/覆寫旁白（multipart：audio 檔 + `timeline` JSON 欄位）。
  app.post('/api/pdfs/:id/narration', async (request, reply) => {
    const parsed = IdParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id parameter'));
    if (!request.isMultipart()) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Expected multipart/form-data'));
    const pdfRow = getPdfPermissionRow(parsed.data.id);
    if (!pdfRow) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${parsed.data.id} not found`));
    if (!canEditPdf(sessionSub(request), pdfRow, aclCtx(request, parsed.data.id))) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限為此簡報錄製旁白'));
    }

    let file;
    try {
      file = await request.file();
    } catch {
      return reply.code(413).send(errorResponse('FILE_TOO_LARGE', '旁白音檔超過大小上限'));
    }
    if (!file) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Missing narration audio file'));

    const timelineRaw = multipartFieldValue(file.fields.timeline);
    if (!timelineRaw) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Missing timeline field'));
    let timeline: z.infer<typeof TimelineSchema>;
    try {
      timeline = TimelineSchema.parse(JSON.parse(timelineRaw));
    } catch {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid timeline JSON'));
    }

    let buffer: Buffer;
    try {
      buffer = await file.toBuffer();
    } catch {
      return reply.code(413).send(errorResponse('FILE_TOO_LARGE', '旁白音檔超過大小上限'));
    }
    if (buffer.length === 0) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Empty narration audio'));

    const now = nowIso();
    const stored: StoredTimeline = { durationMs: timeline.durationMs, segments: timeline.segments, createdAt: now };
    await fs.mkdir(narrationDir(parsed.data.id), { recursive: true });
    await fs.writeFile(narrationAudioPath(parsed.data.id), buffer);
    await fs.writeFile(narrationTimelinePath(parsed.data.id), JSON.stringify(stored), 'utf8');

    return reply.code(201).send({ ok: true, size_bytes: buffer.length, duration_ms: timeline.durationMs });
  });

  // 讀取旁白 metadata（是否存在、時長、時間軸）。
  app.get('/api/pdfs/:id/narration', async (request, reply) => {
    const parsed = IdParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id parameter'));
    const pdfRow = getPdfPermissionRow(parsed.data.id);
    if (!pdfRow) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${parsed.data.id} not found`));
    if (!canReadPdf(sessionSub(request), pdfRow, aclCtx(request, parsed.data.id))) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限檢視此簡報旁白'));
    }
    const timeline = await readStoredTimeline(parsed.data.id);
    const hasAudio = await fileExists(narrationAudioPath(parsed.data.id));
    if (!timeline || !hasAudio) return reply.send({ exists: false });
    return reply.send({
      exists: true,
      duration_ms: timeline.durationMs,
      segments: timeline.segments,
      created_at: timeline.createdAt,
    });
  });

  // 串流旁白音檔。
  app.get('/api/pdfs/:id/narration/audio', async (request, reply) => {
    const parsed = IdParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id parameter'));
    const pdfRow = getPdfPermissionRow(parsed.data.id);
    if (!pdfRow) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${parsed.data.id} not found`));
    if (!canReadPdf(sessionSub(request), pdfRow, aclCtx(request, parsed.data.id))) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限播放此簡報旁白'));
    }
    const audioPath = narrationAudioPath(parsed.data.id);
    if (!(await fileExists(audioPath))) return reply.code(404).send(errorResponse('NARRATION_NOT_FOUND', 'No narration recorded'));
    reply.header('Content-Type', 'audio/webm');
    reply.header('Cache-Control', 'no-store');
    return reply.send(createReadStream(audioPath));
  });

  // 刪除旁白。
  app.delete('/api/pdfs/:id/narration', async (request, reply) => {
    const parsed = IdParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id parameter'));
    const pdfRow = getPdfPermissionRow(parsed.data.id);
    if (!pdfRow) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${parsed.data.id} not found`));
    if (!canEditPdf(sessionSub(request), pdfRow, aclCtx(request, parsed.data.id))) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限刪除此簡報旁白'));
    }
    await fs.rm(narrationDir(parsed.data.id), { recursive: true, force: true });
    return reply.send({ ok: true });
  });
}
