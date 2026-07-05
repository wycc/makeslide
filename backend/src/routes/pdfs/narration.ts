import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { getPdfPermissionRow, canReadPdf, canEditPdf, aclCtx } from './permissions';
import { sessionSub } from '../auth';
import { errorResponse, IdParamSchema, nowIso } from './shared';
import { narrationDir, narrationManifestPath, narrationSegmentAudioPath } from '../../services/storage';
import { transcribeAudioBufferWithWordTimestamps, transcribeAudioBuffer, resolveTranscriptionProvider } from '../../services/openai';
import { splitWordsByPage, assignPlainTranscript } from './narrationTranscript';

// 簡報旁白錄音（多段）：每份簡報存一份 manifest.json（有序的 segment 清單）＋逐段音檔。
// 每段 = 一次錄音（可跨多頁），含該段的翻頁時間軸（相對段起點）。
// 上傳/重錄/刪除/排序需編輯權限；讀取/串流需讀取權限。

const SegmentSchema = z.object({
  page: z.number().int(),
  startMs: z.number().nonnegative(),
  endMs: z.number().nonnegative(),
});
// 游標點與繪圖筆畫（座標正規化 0–1、tMs 相對段起點）。
const CursorPointSchema = z.object({ tMs: z.number(), x: z.number(), y: z.number() });
const StrokeSchema = z.object({ tMs: z.number(), points: z.array(z.object({ x: z.number(), y: z.number() })).max(5000) });
const TimelineSchema = z.object({
  durationMs: z.number().nonnegative(),
  segments: z.array(SegmentSchema).max(10000),
  cursorTrack: z.array(CursorPointSchema).max(50000).optional(),
  drawTrack: z.array(StrokeSchema).max(2000).optional(),
});

interface SegmentMeta {
  id: string;
  durationMs: number;
  slideTimeline: z.infer<typeof SegmentSchema>[];
  createdAt: string;
  // 逐頁逐字稿（key 為頁碼字串，值為該頁的逐字稿）。可由 STT 產生或使用者編輯。
  transcriptByPage?: Record<string, string>;
  cursorTrack?: z.infer<typeof CursorPointSchema>[];
  drawTrack?: z.infer<typeof StrokeSchema>[];
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
      transcriptByPage: z.record(z.string(), z.string()).optional(),
      cursorTrack: z.array(CursorPointSchema).optional(),
      drawTrack: z.array(StrokeSchema).optional(),
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
        transcript_by_page: s.transcriptByPage ?? {},
        cursor_track: s.cursorTrack ?? [],
        draw_track: s.drawTrack ?? [],
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
    manifest.segments.push({
      id,
      durationMs: up.timeline.durationMs,
      slideTimeline: up.timeline.segments,
      createdAt: nowIso(),
      cursorTrack: up.timeline.cursorTrack,
      drawTrack: up.timeline.drawTrack,
    });
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
    seg.cursorTrack = up.timeline.cursorTrack;
    seg.drawTrack = up.timeline.drawTrack;
    // 重錄時逐字稿失效（音檔已換），清掉舊逐字稿。
    seg.transcriptByPage = undefined;
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

  // 對某段做語音轉文字（Whisper 逐字時間戳），依該段翻頁時間切成逐頁逐字稿並存回 manifest。
  app.post('/api/pdfs/:id/narration/segments/:segId/transcribe', async (request, reply) => {
    const parsed = IdParamSchema.safeParse(request.params);
    const segId = String((request.params as { segId?: string }).segId ?? '');
    if (!parsed.success || !segId) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid parameters'));
    const pdfRow = getPdfPermissionRow(parsed.data.id);
    if (!pdfRow) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${parsed.data.id} not found`));
    if (!canEditPdf(sessionSub(request), pdfRow, aclCtx(request, parsed.data.id))) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限轉錄此旁白段'));
    }
    const manifest = await readManifest(parsed.data.id);
    const seg = manifest.segments.find((s) => s.id === segId);
    if (!seg) return reply.code(404).send(errorResponse('SEGMENT_NOT_FOUND', `Segment ${segId} not found`));
    const audioPath = narrationSegmentAudioPath(parsed.data.id, segId);
    let audio: Buffer;
    try {
      audio = await fs.readFile(audioPath);
    } catch {
      return reply.code(404).send(errorResponse('SEGMENT_NOT_FOUND', 'Segment audio not found'));
    }
    // 先試 OpenAI Whisper 逐字時間戳（可依翻頁時間切逐頁）；若端點不支援 word timestamps 或無字，
    // 退回一般純文字轉錄（較多端點支援），整段掛到第一頁。兩者都失敗才回錯誤（並帶出真正原因）。
    // 用與 chat 相同的 OpenAI 相容 provider（例如 cgu-air）跑 STT，避免只設了該 provider 金鑰卻硬打 openai。
    const provider = resolveTranscriptionProvider();
    let transcriptByPage: Record<number, string>;
    try {
      const words = await transcribeAudioBufferWithWordTimestamps(audio, 'narration.webm', 'audio/webm', provider);
      if (words.length > 0) {
        transcriptByPage = splitWordsByPage(words, seg.slideTimeline);
      } else {
        const text = await transcribeAudioBuffer(audio, 'narration.webm', 'audio/webm', provider);
        transcriptByPage = assignPlainTranscript(text, seg.slideTimeline);
      }
    } catch (wordErr) {
      request.log.warn({ err: wordErr, pdfId: parsed.data.id, segId, provider }, 'narration word-timestamp STT failed; falling back to plain');
      try {
        const text = await transcribeAudioBuffer(audio, 'narration.webm', 'audio/webm', provider);
        transcriptByPage = assignPlainTranscript(text, seg.slideTimeline);
      } catch (err) {
        request.log.error({ err, pdfId: parsed.data.id, segId }, 'narration transcription failed');
        const message = err instanceof Error && err.message ? `語音轉文字失敗：${err.message}` : '語音轉文字失敗';
        return reply.code(502).send(errorResponse('TRANSCRIBE_FAILED', message));
      }
    }
    // Record<number,string> → Record<string,string> for JSON storage.
    seg.transcriptByPage = Object.fromEntries(Object.entries(transcriptByPage));
    await writeManifest(parsed.data.id, manifest);
    return reply.send({ ok: true, transcript_by_page: seg.transcriptByPage });
  });

  // 編輯某段的逐頁逐字稿（整段覆寫）。
  app.put('/api/pdfs/:id/narration/segments/:segId/transcript', async (request, reply) => {
    const parsed = IdParamSchema.safeParse(request.params);
    const segId = String((request.params as { segId?: string }).segId ?? '');
    if (!parsed.success || !segId) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid parameters'));
    const body = z.object({ transcript_by_page: z.record(z.string(), z.string()) }).safeParse(request.body);
    if (!body.success) return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid transcript'));
    const pdfRow = getPdfPermissionRow(parsed.data.id);
    if (!pdfRow) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${parsed.data.id} not found`));
    if (!canEditPdf(sessionSub(request), pdfRow, aclCtx(request, parsed.data.id))) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限編輯此旁白逐字稿'));
    }
    const manifest = await readManifest(parsed.data.id);
    const seg = manifest.segments.find((s) => s.id === segId);
    if (!seg) return reply.code(404).send(errorResponse('SEGMENT_NOT_FOUND', `Segment ${segId} not found`));
    seg.transcriptByPage = body.data.transcript_by_page;
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
