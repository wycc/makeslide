import type { FastifyInstance, FastifyRequest } from 'fastify';
import fs from 'node:fs';
import { db } from '../../db';
import type { PdfRow } from '../../types';
import {
  pageScriptPath,
  pageTimelinePath,
} from '../../services/storage';
import { decodeSession, parseCookies } from '../auth';
import { IdParamSchema, errorResponse } from './shared';
import {
  splitScriptIntoSentences,
  type SentenceTimelineItem,
} from '../../services/subtitleAlignment';

interface PageRecord {
  page_uid: string;
  page_number: number;
  audio_duration_seconds: number | null;
}

function sessionSubFromRequest(request: FastifyRequest): string | null {
  const session = decodeSession(parseCookies(request).makeslide_session);
  return session?.sub ?? null;
}

function canReadPdf(sub: string | null, row: Pick<PdfRow, 'owner_sub' | 'visibility'>): boolean {
  if (!row.owner_sub) return true;
  if (sub && row.owner_sub === sub) return true;
  return row.visibility === 'public' || row.visibility === 'public_editable';
}

/**
 * Format seconds as SRT timestamp: HH:MM:SS,mmm
 */
function toSrtTimestamp(seconds: number): string {
  const totalMs = Math.round(Math.max(0, seconds) * 1000);
  const ms = totalMs % 1000;
  const totalSec = Math.floor(totalMs / 1000);
  const sec = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const min = totalMin % 60;
  const hr = Math.floor(totalMin / 60);
  return `${String(hr).padStart(2, '0')}:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

/**
 * Format seconds as VTT timestamp: HH:MM:SS.mmm
 */
function toVttTimestamp(seconds: number): string {
  return toSrtTimestamp(seconds).replace(',', '.');
}

/**
 * Build a SentenceTimelineItem[] for one page.
 * If .timeline.json exists (Whisper mode), use it directly.
 * Otherwise, fall back to splitting the script and distributing
 * audio_duration_seconds evenly across sentences.
 */
async function buildPageTimeline(
  pdfId: string,
  pageUid: string,
  audioDurationSeconds: number | null,
): Promise<SentenceTimelineItem[]> {
  const timelinePath = pageTimelinePath(pdfId, pageUid);
  if (fs.existsSync(timelinePath)) {
    try {
      const raw = await fs.promises.readFile(timelinePath, 'utf8');
      return JSON.parse(raw) as SentenceTimelineItem[];
    } catch {
      // fall through to fallback
    }
  }

  // Fallback: split script into sentences and distribute duration evenly
  const scriptPath = pageScriptPath(pdfId, pageUid);
  let sentences: string[] = [];
  if (fs.existsSync(scriptPath)) {
    try {
      const script = await fs.promises.readFile(scriptPath, 'utf8');
      sentences = splitScriptIntoSentences(script);
    } catch {
      // ignore read errors
    }
  }

  if (sentences.length === 0) return [];

  const totalDuration = audioDurationSeconds ?? 0;
  const perSentence = totalDuration / sentences.length;
  return sentences.map((text, i) => ({
    text,
    start: i * perSentence,
    end: (i + 1) * perSentence,
  }));
}

/**
 * Build a merged global timeline across all pages, applying per-page time offsets.
 */
async function buildGlobalTimeline(
  pdfId: string,
  pages: PageRecord[],
): Promise<SentenceTimelineItem[]> {
  const result: SentenceTimelineItem[] = [];
  let offset = 0;

  for (const page of pages) {
    const pageTimeline = await buildPageTimeline(
      pdfId,
      page.page_uid,
      page.audio_duration_seconds,
    );
    for (const item of pageTimeline) {
      result.push({
        text: item.text,
        start: item.start + offset,
        end: item.end + offset,
      });
    }
    offset += page.audio_duration_seconds ?? 0;
  }

  return result;
}

function buildSrtContent(timeline: SentenceTimelineItem[]): string {
  if (timeline.length === 0) return '';
  const lines: string[] = [];
  for (let i = 0; i < timeline.length; i++) {
    const item = timeline[i]!;
    lines.push(String(i + 1));
    lines.push(`${toSrtTimestamp(item.start)} --> ${toSrtTimestamp(item.end)}`);
    lines.push(item.text);
    lines.push('');
  }
  return lines.join('\n');
}

function buildVttContent(timeline: SentenceTimelineItem[]): string {
  const lines: string[] = ['WEBVTT', ''];
  for (const item of timeline) {
    lines.push(`${toVttTimestamp(item.start)} --> ${toVttTimestamp(item.end)}`);
    lines.push(item.text);
    lines.push('');
  }
  return lines.join('\n');
}

export async function registerSubtitleRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/pdfs/:id/subtitles.srt
  app.get('/api/pdfs/:id/subtitles.srt', async (request, reply) => {
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

    const pages = db
      .prepare(
        `SELECT page_uid, page_number, audio_duration_seconds
           FROM pages
          WHERE pdf_id = ?
          ORDER BY page_number ASC`,
      )
      .all(parsed.data.id) as PageRecord[];

    const timeline = await buildGlobalTimeline(parsed.data.id, pages);
    const content = buildSrtContent(timeline);

    reply.header('content-type', 'application/x-subrip; charset=utf-8');
    reply.header('content-disposition', `attachment; filename="subtitles.srt"`);
    reply.header('cache-control', 'no-store');
    return reply.send(content);
  });

  // GET /api/pdfs/:id/subtitles.vtt
  app.get('/api/pdfs/:id/subtitles.vtt', async (request, reply) => {
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

    const pages = db
      .prepare(
        `SELECT page_uid, page_number, audio_duration_seconds
           FROM pages
          WHERE pdf_id = ?
          ORDER BY page_number ASC`,
      )
      .all(parsed.data.id) as PageRecord[];

    const timeline = await buildGlobalTimeline(parsed.data.id, pages);
    const content = buildVttContent(timeline);

    reply.header('content-type', 'text/vtt; charset=utf-8');
    reply.header('content-disposition', `attachment; filename="subtitles.vtt"`);
    reply.header('cache-control', 'no-store');
    return reply.send(content);
  });
}
