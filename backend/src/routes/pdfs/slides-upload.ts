import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { db } from '../../db';
import {
  createPdfDir,
  figureFilePath,
  figureManifestPath,
  figuresDir,
  pageTextPath,
  pdfDir,
  removePdfDir,
  writeMetadata,
  writeSourceText,
} from '../../services/storage';
import { MAX_FIGURE_REFERENCES_PER_PAGE, saveSplitPageFigureMap, type SplitPageFigureMap } from '../../services/pdfFigures';
import type { FigureEntry, FigureManifest, FigurePageEntry } from '../../worker/steps/extractPdfFigures';
import { decodeSession, parseCookies } from '../auth';
import type { PdfStatus } from '../../types';
import {
  PDF_ID_SIZE,
  buildMetadataFromDb,
  errorResponse,
  nowIso,
  titleFromUploadFilename,
} from './shared';

/** Upper bound on how many slides a single `upload_slide` request may create. */
const MAX_SLIDES = 60;

/**
 * Reuses `getFigureReferencesForPage(s)`'s cap on how many reference images are actually used
 * per page when generating its image (`pdfFigures.ts`), so the number is defined once. Enforcing
 * it here too means a caller never uploads a 3rd image only to have it silently ignored later.
 */
const MAX_REFERENCE_IMAGES_PER_SLIDE = MAX_FIGURE_REFERENCES_PER_PAGE;
const MAX_TOTAL_REFERENCE_FILES = MAX_SLIDES * MAX_REFERENCE_IMAGES_PER_SLIDE;

const SlideItemSchema = z.object({
  title: z.string().trim().min(1).max(200),
  bullets: z.array(z.string().trim().min(1).max(500)).max(20),
  summary: z.string().trim().max(2000).optional(),
});

const SlidesPayloadSchema = z.object({
  title: z.string().trim().max(200).optional(),
  slides: z.array(SlideItemSchema).min(1).max(MAX_SLIDES),
});

function ownerSubFromRequest(request: FastifyRequest): string | null {
  const session = decodeSession(parseCookies(request).makeslide_session);
  return session?.sub ?? null;
}

/**
 * Renders a slide's structured content into the same "Slide N: title\n- bullet" text format
 * `renderPromptText` (upload.ts) and `splitTextWithLlm` produce. `pipeline.ts`'s "reuse existing
 * split pages" branch parses the first line back out with a "Slide N:" prefix regex to recover
 * the slide label, so the format is load-bearing, not cosmetic.
 */
function renderSlideContent(pageNumber: number, slide: z.infer<typeof SlideItemSchema>): string {
  const lines = [`Slide ${pageNumber}: ${slide.title}`];
  for (const bullet of slide.bullets) {
    if (bullet) lines.push(`- ${bullet}`);
  }
  if (slide.summary) {
    lines.push('', slide.summary);
  }
  return lines.join('\n');
}

async function saveSlideReferenceImage(
  pdfId: string,
  pageUid: string,
  index: number,
  buffer: Buffer,
): Promise<FigureEntry> {
  const filename = `${pageUid}-ref-${index}.png`;
  const image = sharp(buffer);
  const meta = await image.metadata();
  await image.png().toFile(figureFilePath(pdfId, filename));
  return {
    id: `${pageUid}-ref-${index}`,
    imagePath: `figures/${filename}`,
    width: meta.width ?? 0,
    height: meta.height ?? 0,
    // A user-supplied reference image isn't "part of" any region of the slide the way an
    // extracted PDF figure is — it has no natural bbox. capFiguresByArea (pdfFigures.ts) sorts
    // by bbox area, so giving every upload_slide reference the same full-frame bbox makes that
    // sort a no-op (stable sort keeps upload order) instead of arbitrarily favouring one image.
    bbox: { xPct: 0, yPct: 0, widthPct: 1, heightPct: 1 },
    caption: null,
    context: null,
    source: 'raster',
  };
}

export async function registerSlidesUploadRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/pdfs/from-slides — create a presentation from a structured, pre-split outline
  // (array index = final page_number, no AI re-pagination) instead of free text, so each slide
  // can carry its own local reference images that are guaranteed to land on the right page.
  //
  // multipart fields:
  //   slides   JSON string: { title?, slides: [{ title, bullets, summary? }] }
  //   slide_<i>_ref_<n>   file fields (0-based), 0-2 per slide — reference images for slide i
  app.post('/api/pdfs/from-slides', async (request, reply) => {
    if (!request.isMultipart()) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Expected multipart/form-data'));
    }

    let payloadRaw = '';
    const filesBySlide = new Map<number, Buffer[]>();
    try {
      for await (const part of request.parts({ limits: { files: MAX_TOTAL_REFERENCE_FILES } })) {
        if (part.type === 'file') {
          const match = /^slide_(\d+)_ref_(\d+)$/.exec(part.fieldname);
          const buf = await part.toBuffer();
          if (!match) continue; // ignore unexpected file fields rather than failing the whole upload
          const slideIndex = Number(match[1]);
          const list = filesBySlide.get(slideIndex) ?? [];
          list.push(buf);
          filesBySlide.set(slideIndex, list);
        } else if (part.fieldname === 'slides' && typeof part.value === 'string') {
          payloadRaw = part.value;
        }
      }
    } catch (err) {
      const e = err as { code?: string };
      if (e.code === 'FST_REQ_FILE_TOO_LARGE' || e.code === 'FST_FILES_LIMIT') {
        return reply.code(413).send(errorResponse('FILE_TOO_LARGE', '參考圖片超過大小或張數上限'));
      }
      request.log.error({ err }, 'Failed to parse upload_slide multipart request');
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Failed to parse multipart request'));
    }

    if (!payloadRaw) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Missing slides field'));
    }
    let payloadJson: unknown;
    try {
      payloadJson = JSON.parse(payloadRaw);
    } catch {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'slides field must be valid JSON'));
    }
    const parsed = SlidesPayloadSchema.safeParse(payloadJson);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', parsed.error.issues[0]?.message ?? 'Invalid slides payload'));
    }
    const { slides } = parsed.data;

    for (const [slideIndex, files] of filesBySlide) {
      if (slideIndex < 0 || slideIndex >= slides.length) {
        return reply.code(400).send(errorResponse('INVALID_REQUEST', `slide_${slideIndex}_ref_* does not match any slide`));
      }
      if (files.length > MAX_REFERENCE_IMAGES_PER_SLIDE) {
        return reply.code(400).send(errorResponse('INVALID_REQUEST', `Slide ${slideIndex + 1} 最多只能附 ${MAX_REFERENCE_IMAGES_PER_SLIDE} 張參考圖`));
      }
    }

    const pdfId = nanoid(PDF_ID_SIZE);
    const createdAt = nowIso();
    const title = parsed.data.title?.trim() || null;
    const filename = `${titleFromUploadFilename(title || 'slides-outline')}.slides`;
    const status: PdfStatus = 'awaiting_prompt';
    const ownerSub = ownerSubFromRequest(request);

    try {
      createPdfDir(pdfId);
      await fs.promises.mkdir(figuresDir(pdfId), { recursive: true });

      const manifestPages: FigurePageEntry[] = [];
      const figureMap: SplitPageFigureMap = {};
      const contentParts: string[] = [];
      const pageRows: Array<{ pageNumber: number; pageUid: string; textPath: string }> = [];

      for (let i = 0; i < slides.length; i++) {
        const slide = slides[i]!;
        const pageNumber = i + 1;
        const pageUid = nanoid(10);
        const content = renderSlideContent(pageNumber, slide);
        contentParts.push(content);

        const textPath = pageTextPath(pdfId, pageUid);
        await fs.promises.writeFile(textPath, content, 'utf8');
        pageRows.push({ pageNumber, pageUid, textPath: path.relative(pdfDir(pdfId), textPath) });

        const files = filesBySlide.get(i);
        if (files?.length) {
          const entries: FigureEntry[] = [];
          for (let n = 0; n < files.length; n++) {
            entries.push(await saveSlideReferenceImage(pdfId, pageUid, n, files[n]!));
          }
          manifestPages.push({ pageNumber, figures: entries });
          figureMap[pageNumber] = [pageNumber];
        }
      }

      if (manifestPages.length > 0) {
        const manifest: FigureManifest = { pdfId, generatedAt: createdAt, pages: manifestPages };
        await fs.promises.writeFile(figureManifestPath(pdfId), JSON.stringify(manifest, null, 2), 'utf8');
        saveSplitPageFigureMap(pdfId, figureMap);
      }

      await writeSourceText(pdfId, contentParts.join('\n\n'));

      db.transaction(() => {
        db.prepare(
          `INSERT INTO pdfs (id, title, original_filename, status, page_count,
                              progress_step, error_message, user_prompt, require_script_confirmation,
                              category, owner_sub, visibility,
                              tts_voice, tts_speed, script_max_chars_per_page, image_style_prompt,
                              host_mode,
                              created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, 0, ?, ?, ?, NULL, NULL, NULL, NULL, 'solo', ?, ?)`,
        ).run(pdfId, title, filename, status, slides.length, 'general', ownerSub, 'private', createdAt, createdAt);

        db.prepare(
          `INSERT INTO pdf_sources (pdf_id, source_kind, source_name, content_text, created_at, updated_at)
           VALUES (?, 'slides', ?, ?, ?, ?)`,
        ).run(pdfId, filename, contentParts.join('\n\n'), createdAt, createdAt);

        for (const p of pageRows) {
          db.prepare(
            `INSERT INTO pages (pdf_id, page_number, page_uid, image_path, text_path, script_path,
                                audio_path, audio_duration_seconds, status, error_message, created_at, updated_at)
             VALUES (?, ?, ?, NULL, ?, NULL, NULL, NULL, 'pending', NULL, ?, ?)`,
          ).run(pdfId, p.pageNumber, p.pageUid, p.textPath, createdAt, createdAt);
        }
      })();

      const metadata = buildMetadataFromDb(pdfId);
      if (metadata) await writeMetadata(pdfId, metadata);
    } catch (err) {
      request.log.error({ err, pdfId }, 'Failed to create presentation from structured slides');
      try {
        await removePdfDir(pdfId);
      } catch {
        // ignore
      }
      return reply.code(500).send(errorResponse('INTERNAL_ERROR', 'Failed to create presentation from slides'));
    }

    return reply.code(201).send({
      id: pdfId,
      status,
      title,
      original_filename: filename,
      page_count: slides.length,
      created_at: createdAt,
    });
  });
}
