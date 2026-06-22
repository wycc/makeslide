import type { FastifyInstance, FastifyRequest } from 'fastify';
import fs from 'node:fs';
import { db } from '../../db';
import { decodeSession, parseCookies } from '../auth';
import {
  pageScriptPath,
  pageImagePath,
  pageAudioPath,
  pageAnimationSpecPath,
} from '../../services/storage';
import { MAX_SLIDE_ANIMATION_EFFECTS } from '../../services/pageAnimation';
import type { PdfRow } from '../../types';
import { IdParamSchema, errorResponse } from './shared';

const MIN_SCRIPT_CHARS = 10;
const SHORT_SCRIPT_CHARS = 30;

interface PageQualityRow {
  page_number: number;
  page_uid: string;
  image_path: string | null;
  audio_path: string | null;
  script_path: string | null;
  status: string;
}

export type QualityIssueCode =
  | 'missing_image'
  | 'missing_audio'
  | 'missing_script'
  | 'empty_script'
  | 'short_script'
  | 'animation_over_limit';

export interface PageQualityIssue {
  code: QualityIssueCode;
  detail?: string;
}

export interface PageQualityResult {
  pageNumber: number;
  issues: PageQualityIssue[];
}

function sessionSub(request: FastifyRequest): string | null {
  const session = decodeSession(parseCookies(request).makeslide_session);
  return session?.sub ?? null;
}

function canReadPdf(sub: string | null, row: Pick<PdfRow, 'owner_sub' | 'visibility'>): boolean {
  if (!row.owner_sub) return true;
  if (sub && row.owner_sub === sub) return true;
  return row.visibility === 'public' || row.visibility === 'public_editable';
}

export async function registerQualityCheckRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/pdfs/:id/quality-check', async (request, reply) => {
    const sub = sessionSub(request);
    const params = IdParamSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send(errorResponse('BAD_REQUEST', 'Invalid id'));
    const { id } = params.data;

    const pdfRow = db.prepare(`SELECT owner_sub, visibility, status FROM pdfs WHERE id = ?`).get(id) as
      | Pick<PdfRow, 'owner_sub' | 'visibility' | 'status'>
      | undefined;
    if (!pdfRow) return reply.code(404).send(errorResponse('NOT_FOUND', 'PDF not found'));
    if (!canReadPdf(sub, pdfRow)) return reply.code(403).send(errorResponse('FORBIDDEN', 'Access denied'));

    const pageRows = db.prepare(`
      SELECT page_number, page_uid, image_path, audio_path, script_path, status
      FROM pages WHERE pdf_id = ? AND status = 'ready' ORDER BY page_number ASC
    `).all(id) as PageQualityRow[];

    const results: PageQualityResult[] = [];

    for (const row of pageRows) {
      const issues: PageQualityIssue[] = [];

      if (!row.image_path || !fs.existsSync(pageImagePath(id, row.page_uid))) {
        issues.push({ code: 'missing_image' });
      }

      if (!row.audio_path || !fs.existsSync(pageAudioPath(id, row.page_uid))) {
        issues.push({ code: 'missing_audio' });
      }

      if (!row.script_path) {
        issues.push({ code: 'missing_script' });
      } else {
        const scriptFile = pageScriptPath(id, row.page_uid);
        let scriptContent = '';
        try { scriptContent = fs.readFileSync(scriptFile, 'utf8').trim(); } catch { /* file missing */ }
        if (!scriptContent) {
          issues.push({ code: 'empty_script' });
        } else if (scriptContent.length < SHORT_SCRIPT_CHARS && scriptContent.length >= MIN_SCRIPT_CHARS) {
          issues.push({ code: 'short_script', detail: `${scriptContent.length} 字` });
        }
      }

      const animSpecFile = pageAnimationSpecPath(id, row.page_uid);
      if (fs.existsSync(animSpecFile)) {
        try {
          const spec = JSON.parse(fs.readFileSync(animSpecFile, 'utf8')) as { effects?: unknown[] };
          const count = Array.isArray(spec.effects) ? spec.effects.length : 0;
          if (count > MAX_SLIDE_ANIMATION_EFFECTS) {
            issues.push({ code: 'animation_over_limit', detail: `${count}/${MAX_SLIDE_ANIMATION_EFFECTS}` });
          }
        } catch { /* ignore malformed spec */ }
      }

      if (issues.length > 0) {
        results.push({ pageNumber: row.page_number, issues });
      }
    }

    return reply.code(200).send({ pages: results, checkedAt: new Date().toISOString() });
  });
}
