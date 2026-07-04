import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { getPdfPermissionRow, canReadPdf, canEditPdf, aclCtx } from './permissions';
import { sessionSub } from '../auth';
import { errorResponse, IdParamSchema, nowIso } from './shared';
import { narrationDir, narrationManifestPath, narrationSegmentAudioPath } from '../../services/storage';

// 簡報旁白錄音（多段）：每份簡報存一份 manifest.json（有序的 segment 清單）＋逐段音檔。
// 每段 = 一次錄音（可跨多頁），含該段的翻頁時間軸（相對段起點）。
// 上傳/重錄/刪除/排序需編輯權限；讀取/串流需讀取權限。

const SegmentSchema = z.object({
  page: z.number().int(),
  startMs: z.number().nonnegative(),
  endMs: z.number().nonnegative(),
});
const TimelineSchema = z.object({
  durationMs: z.number().nonnegative(),
  segments: z.array(SegmentSchema).max(10000),
});

interface SegmentMeta {
  id: string;
  durationMs: number;
  slideTimeline: z.infer<typeof SegmentSchema>[];
  createdAt: string;
}
interface NarrationManifest {
  segments: SegmentMeta[];
}

const ManifestSchema = z.object({
  segments: z.array(
    z.object({
      id: z.string(),
      durationMs: z.number(),
      slideTimeline: z.array(SegmentSchema),
      createdAt: z.string(),
    }),
  ),
});

function multipartFieldValue(field: unknown): string | undefined {
  if (field && typeof field === 'object' && 'value' in field) {
    const value = (field as { value: unknown }).value;
    if (typeof value === 'string') return value;
  }
  return undefined;
}

async function readManifest(pdfId: string): Promise<NarrationManifest> {
  try {
    const raw = await fs.readFile(narrationManifestPath(pdfId), 'utf8');
    const parsed = ManifestSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : { segments: [] };
  } catch {
    return { segments: [] };
  }
}

async function writeManifest(pdfId: string, manifest: NarrationManifest): Promise<void> {
  await fs.mkdir(narrationDir(pdfId), { recursive: true });
  await fs.writeFile(narrationManifestPath(pdfId), JSON.stringify(manifest), 'utf8');
}

function distinctPages(timeline: z.infer<typeof SegmentSchema>[]): number[] {
  const seen = new Set<number>();
  for (const s of timeline) seen.add(s.page);
  return [...seen].sort((a, b) => a - b);
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** Reads the uploaded audio buffer + parsed timeline from a multipart request. */
async function readSegmentUpload(request: import('fastify').FastifyRequest): Promise<
  { ok: true; buffer: Buffer; timeline: z.infer<typeof TimelineSchema> } | { ok: false; code: number; message: string }
> {
  let file;
  try {
    file = await request.file();
  } catch {
    return { ok: false, code: 413, message: '旁白音檔超過大小上限' };
  }
  if (!file) return { ok: false, code: 400, message: 'Missing narration audio file' };
  const timelineRaw = multipartFieldValue(file.fields.timeline);
  if (!timelineRaw) return { ok: false, code: 400, message: 'Missing timeline field' };
  let timeline: z.infer<typeof TimelineSchema>;
  try {
    timeline = TimelineSchema.parse(JSON.parse(timelineRaw));
  } catch {
    return { ok: false, code: 400, message: 'Invalid timeline JSON' };
  }
  let buffer: Buffer;
  try {
    buffer = await file.toBuffer();
  } catch {
    return { ok: false, code: 413, message: '旁白音檔超過大小上限' };
  }
  if (buffer.length === 0) return { ok: false, code: 400, message: 'Empty narration audio' };
  return { ok: true, buffer, timeline };
}

export async function registerNarrationRoutes(app: FastifyInstance): Promise<void> {
  // 讀取旁白：有序的 segment 清單（每段含時長與用過的頁面）。
  app.get('/api/pdfs/:id/narration', async (request, reply) => {
    const parsed = IdParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id parameter'));
    const pdfRow = getPdfPermissionRow(parsed.data.id);
    if (!pdfRow) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${parsed.data.id} not found`));
    if (!canReadPdf(sessionSub(request), pdfRow, aclCtx(request, parsed.data.id))) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限檢視此簡報旁白'));
    }
    const manifest = await readManifest(parsed.data.id);
    return reply.send({
      segments: manifest.segments.map((s) => ({
        id: s.id,
        duration_ms: s.durationMs,
        pages: distinctPages(s.slideTimeline),
        slide_timeline: s.slideTimeline,
        created_at: s.createdAt,
      })),
    });
  });

  // 新增一段錄音（multipart：audio + timeline JSON），append 到最後。
  app.post('/api/pdfs/:id/narration/segments', async (request, reply) => {
    const parsed = IdParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id parameter'));
    if (!request.isMultipart()) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Expected multipart/form-data'));
    const pdfRow = getPdfPermissionRow(parsed.data.id);
    if (!pdfRow) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${parsed.data.id} not found`));
    if (!canEditPdf(sessionSub(request), pdfRow, aclCtx(request, parsed.data.id))) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限為此簡報錄製旁白'));
    }
    const up = await readSegmentUpload(request);
    if (!up.ok) return reply.code(up.code).send(errorResponse('INVALID_REQUEST', up.message));

    const id = nanoid(10);
    await fs.mkdir(narrationDir(parsed.data.id), { recursive: true });
    await fs.writeFile(narrationSegmentAudioPath(parsed.data.id, id), up.buffer);
    const manifest = await readManifest(parsed.data.id);
    manifest.segments.push({ id, durationMs: up.timeline.durationMs, slideTimeline: up.timeline.segments, createdAt: nowIso() });
    await writeManifest(parsed.data.id, manifest);
    return reply.code(201).send({ ok: true, id, size_bytes: up.buffer.length });
  });

  // 重錄某一段（取代其 audio + timeline，位置不變）。
  app.put('/api/pdfs/:id/narration/segments/:segId', async (request, reply) => {
    const parsed = IdParamSchema.safeParse(request.params);
    const segId = String((request.params as { segId?: string }).segId ?? '');
    if (!parsed.success || !segId) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid parameters'));
    if (!request.isMultipart()) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Expected multipart/form-data'));
    const pdfRow = getPdfPermissionRow(parsed.data.id);
    if (!pdfRow) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${parsed.data.id} not found`));
    if (!canEditPdf(sessionSub(request), pdfRow, aclCtx(request, parsed.data.id))) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限重錄此旁白段'));
    }
    const manifest = await readManifest(parsed.data.id);
    const seg = manifest.segments.find((s) => s.id === segId);
    if (!seg) return reply.code(404).send(errorResponse('SEGMENT_NOT_FOUND', `Segment ${segId} not found`));
    const up = await readSegmentUpload(request);
    if (!up.ok) return reply.code(up.code).send(errorResponse('INVALID_REQUEST', up.message));
    await fs.writeFile(narrationSegmentAudioPath(parsed.data.id, segId), up.buffer);
    seg.durationMs = up.timeline.durationMs;
    seg.slideTimeline = up.timeline.segments;
    await writeManifest(parsed.data.id, manifest);
    return reply.send({ ok: true, id: segId, size_bytes: up.buffer.length });
  });

  // 刪除某一段。
  app.delete('/api/pdfs/:id/narration/segments/:segId', async (request, reply) => {
    const parsed = IdParamSchema.safeParse(request.params);
    const segId = String((request.params as { segId?: string }).segId ?? '');
    if (!parsed.success || !segId) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid parameters'));
    const pdfRow = getPdfPermissionRow(parsed.data.id);
    if (!pdfRow) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${parsed.data.id} not found`));
    if (!canEditPdf(sessionSub(request), pdfRow, aclCtx(request, parsed.data.id))) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限刪除旁白段'));
    }
    const manifest = await readManifest(parsed.data.id);
    if (!manifest.segments.some((s) => s.id === segId)) {
      return reply.code(404).send(errorResponse('SEGMENT_NOT_FOUND', `Segment ${segId} not found`));
    }
    manifest.segments = manifest.segments.filter((s) => s.id !== segId);
    await fs.rm(narrationSegmentAudioPath(parsed.data.id, segId), { force: true });
    if (manifest.segments.length === 0) {
      await fs.rm(narrationDir(parsed.data.id), { recursive: true, force: true });
    } else {
      await writeManifest(parsed.data.id, manifest);
    }
    return reply.send({ ok: true });
  });

  // 調整段落順序（body: { order: string[] } 為完整的 segment id 排列）。
  app.put('/api/pdfs/:id/narration/order', async (request, reply) => {
    const parsed = IdParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id parameter'));
    const body = z.object({ order: z.array(z.string()).max(10000) }).safeParse(request.body);
    if (!body.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid order'));
    const pdfRow = getPdfPermissionRow(parsed.data.id);
    if (!pdfRow) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${parsed.data.id} not found`));
    if (!canEditPdf(sessionSub(request), pdfRow, aclCtx(request, parsed.data.id))) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限調整旁白順序'));
    }
    const manifest = await readManifest(parsed.data.id);
    const byId = new Map(manifest.segments.map((s) => [s.id, s]));
    // 依 body.order 重排（只納入實際存在者），未列到的段附在後面以避免遺失。
    const reordered: SegmentMeta[] = [];
    for (const id of body.data.order) {
      const seg = byId.get(id);
      if (seg && !reordered.includes(seg)) reordered.push(seg);
    }
    for (const seg of manifest.segments) if (!reordered.includes(seg)) reordered.push(seg);
    manifest.segments = reordered;
    await writeManifest(parsed.data.id, manifest);
    return reply.send({ ok: true });
  });

  // 串流某段音檔。
  app.get('/api/pdfs/:id/narration/segments/:segId/audio', async (request, reply) => {
    const parsed = IdParamSchema.safeParse(request.params);
    const segId = String((request.params as { segId?: string }).segId ?? '');
    if (!parsed.success || !segId) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid parameters'));
    const pdfRow = getPdfPermissionRow(parsed.data.id);
    if (!pdfRow) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${parsed.data.id} not found`));
    if (!canReadPdf(sessionSub(request), pdfRow, aclCtx(request, parsed.data.id))) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限播放此簡報旁白'));
    }
    const audioPath = narrationSegmentAudioPath(parsed.data.id, segId);
    if (!(await fileExists(audioPath))) return reply.code(404).send(errorResponse('SEGMENT_NOT_FOUND', 'Segment audio not found'));
    reply.header('Content-Type', 'audio/webm');
    reply.header('Cache-Control', 'no-store');
    return reply.send(createReadStream(audioPath));
  });
}
