import type { FastifyInstance } from 'fastify';
import { canReadPdf } from './permissions';
import fs from 'node:fs';
import { db } from '../../db';
import { sessionSub } from '../auth';
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

export interface QualityCheckSummary {
  /** Completed (audio_ready) pages inspected. */
  pagesChecked: number;
  /** How many of those pages have at least one issue (drives the play-page badge count). */
  pagesWithIssues: number;
  /** Total issues across all flagged pages (a page can carry several). */
  totalIssues: number;
}

/**
 * Rolls up per-page quality results into the headline counts the play-page badge shows
 * ("N pages have quality issues"). Pure function — no I/O — so it is easy to unit test.
 */
export function summarizeQualityResults(
  results: PageQualityResult[],
  pagesChecked: number,
): QualityCheckSummary {
  let totalIssues = 0;
  for (const result of results) totalIssues += result.issues.length;
  return { pagesChecked, pagesWithIssues: results.length, totalIssues };
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

    // Completed pages end at the terminal page status 'audio_ready'; 'ready' is
    // a PDF-level status (not a valid page status), so filtering on it returned
    // no rows for normally-generated presentations.
    const pageRows = db.prepare(`
      SELECT page_number, page_uid, image_path, audio_path, script_path, status
      FROM pages WHERE pdf_id = ? AND status = 'audio_ready' ORDER BY page_number ASC
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

    return reply.code(200).send({
      pages: results,
      summary: summarizeQualityResults(results, pageRows.length),
      checkedAt: new Date().toISOString(),
    });
  });
}
