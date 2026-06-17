import fs from 'node:fs';
import path from 'node:path';
import { toFile } from 'openai';
import { coverImagePath, pageImagePath, pageTextPath, pagesDir, pdfDir, sourcePdfPath } from '../../services/storage';
import { commitPresentationFiles } from '../../services/presentationGit';
import { generateCoverThumbnail, generatePageThumbnail, ensurePageThumbnail } from '../../services/thumbnails';
import { getOpenAIClient } from '../../services/openai';
import { logger } from '../../logger';
import { config } from '../../config';
import { buildImagePrompt, IMAGE_PROMPT_TEMPLATES } from '../../services/imagePromptTemplates';
import { buildFigureReferenceNotes, figureImageAbsPath, getFigureReferencesForPages } from '../../services/pdfFigures';
import { db, savePageGenerationPrompt } from '../../db';
import { redactLogObject } from '../../services/logSanitizer';

export interface RenderTextPagesWithLlmOptions {
  pdfId: string;
  pages: Array<{
    pageNumber: number;
    pageUid: string;
    content: string;
    slideLabel?: string;
    /** Original PDF page number(s) this slide's content is drawn from (document-mode imports). */
    sourcePdfPages?: number[];
  }>;
  /** Override total page count for path naming (used when rendering a subset of pages). Defaults to pages.length. */
  totalPageCount?: number;
  onPage?: (pageNumber: number, imagePath: string, info: RenderTextPageTimingInfo) => void;
  /** Optional abort probe checked before each page. Throws CANCELLED if true. */
  shouldAbort?: () => boolean;
  /** When true, skip updating cover.jpg after rendering. Use when adding pages to an existing deck. */
  skipCoverUpdate?: boolean;
}

export interface RenderTextPageTimingInfo {
  imagePath: string;
  startedAt: string;
  endedAt: string;
  latencyMs: number;
  reused: boolean;
  status?: 'succeeded' | 'failed' | 'skipped';
  attempt?: number;
  model?: string;
  promptLength?: number;
  timeoutMs?: number;
  error?: RenderTextPageErrorInfo;
  metadata?: Record<string, unknown>;
}

export interface RenderTextPageErrorInfo {
  status?: number | null;
  code?: string | null;
  type?: string | null;
  message: string;
}

export interface RenderTextPagesWithLlmResult {
  pageCount: number;
  pagePaths: string[];
  pageUids: string[];
}

const IMAGE_GENERATION_MAX_ATTEMPTS = 3;
const IMAGE_GENERATION_BACKOFF_BASE_MS = 500;
const SOURCE_PDF_MAX_INLINE_BYTES = 5 * 1024 * 1024;

function imageTimeoutMs(): number {
  return config.openaiImageQuality === 'high'
    ? config.openaiImageTimeoutMsHighQuality
    : config.openaiImageTimeoutMs;
}

function imageResponseShape(image: unknown): Record<string, unknown> {
  const payload = image as { data?: unknown } | null | undefined;
  const data = Array.isArray(payload?.data) ? payload.data : [];
  const first = data[0] as Record<string, unknown> | undefined;
  return {
    dataLength: data.length,
    firstKeys: first ? Object.keys(first) : [],
    hasB64Json: typeof first?.b64_json === 'string' && first.b64_json.length > 0,
    hasUrl: typeof first?.url === 'string' && first.url.length > 0,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractErrorInfo(err: unknown): RenderTextPageErrorInfo {
  const e = err as {
    status?: unknown;
    code?: unknown;
    type?: unknown;
    name?: unknown;
    message?: unknown;
    cause?: { code?: unknown; message?: unknown };
  };
  const status = typeof e?.status === 'number' ? e.status : null;
  const code = typeof e?.code === 'string'
    ? e.code
    : typeof e?.cause?.code === 'string'
      ? e.cause.code
      : null;
  const type = typeof e?.type === 'string'
    ? e.type
    : typeof e?.name === 'string'
      ? e.name
      : null;
  const message = typeof e?.message === 'string'
    ? e.message
    : typeof e?.cause?.message === 'string'
      ? e.cause.message
      : String(err);
  return { status, code, type, message };
}

function isTransientImageError(err: unknown): boolean {
  const info = extractErrorInfo(err);
  if (info.status === 429) return true;
  if (typeof info.status === 'number' && info.status >= 500 && info.status < 600) return true;
  const code = (info.code ?? '').toUpperCase();
  const type = (info.type ?? '').toLowerCase();
  const message = info.message.toLowerCase();
  return [
    'ETIMEDOUT',
    'ECONNRESET',
    'ECONNREFUSED',
    'EPIPE',
    'ENOTFOUND',
    'EAI_AGAIN',
    'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_HEADERS_TIMEOUT',
    'UND_ERR_BODY_TIMEOUT',
  ].includes(code) || type.includes('timeout') || message.includes('timeout') || message.includes('timed out');
}

function retryDelayMs(attempt: number): number {
  return IMAGE_GENERATION_BACKOFF_BASE_MS * 2 ** (attempt - 1);
}

async function buildSourcePdfDataUrl(pdfId: string): Promise<string | null> {
  const sourcePath = sourcePdfPath(pdfId);
  try {
    const st = await fs.promises.stat(sourcePath);
    if (!st.isFile() || st.size <= 0 || st.size > SOURCE_PDF_MAX_INLINE_BYTES) {
      return null;
    }
    const buf = await fs.promises.readFile(sourcePath);
    return `data:application/pdf;base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

export async function renderTextPagesWithLlm(
  opts: RenderTextPagesWithLlmOptions,
): Promise<RenderTextPagesWithLlmResult> {
  const client = getOpenAIClient();
  const pageCount = opts.totalPageCount ?? opts.pages.length;
  const pagePaths: string[] = [];
  const pageUids: string[] = [];
  const styleRow = db
    .prepare('SELECT image_style_prompt FROM pdfs WHERE id = ?')
    .get(opts.pdfId) as { image_style_prompt?: string | null } | undefined;
  const deckStylePrompt = styleRow?.image_style_prompt?.trim() || IMAGE_PROMPT_TEMPLATES[0]?.prompt_en;
  const sourcePdfDataUrl = await buildSourcePdfDataUrl(opts.pdfId);
  await fs.promises.mkdir(pagesDir(opts.pdfId), { recursive: true });

  for (const p of opts.pages) {
    if (opts.shouldAbort?.()) {
      const err = new Error('CANCELLED');
      (err as Error & { code?: string }).code = 'CANCELLED';
      throw err;
    }
    const startedAtMs = Date.now();
    const startedAt = new Date(startedAtMs).toISOString();
    const imagePath = pageImagePath(opts.pdfId, p.pageUid);
    const textPath = pageTextPath(opts.pdfId, p.pageUid);

    // Idempotency: if image already exists and non-empty, keep it and skip
    // re-generation. Still sync text file so downstream steps read latest text.
    try {
      const st = await fs.promises.stat(imagePath);
      if (st.isFile() && st.size > 0) {
        await ensurePageThumbnail(opts.pdfId, p.pageUid, imagePath);
        await fs.promises.writeFile(textPath, p.content, 'utf8');
        pagePaths.push(imagePath);
        pageUids.push(p.pageUid);
        logger.info(
          {
            pdfId: opts.pdfId,
            pageNumber: p.pageNumber,
            pageCount,
            bytes: st.size,
          },
          'Text image generation: reuse existing image (idempotent skip)',
        );
        const endedAt = new Date().toISOString();
        opts.onPage?.(p.pageNumber, imagePath, {
          imagePath,
          startedAt,
          endedAt,
          latencyMs: Date.parse(endedAt) - Date.parse(startedAt),
          reused: true,
        });
        continue;
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      // proceed to generate
    }

    logger.info(
      {
        pdfId: opts.pdfId,
        pageNumber: p.pageNumber,
        pageCount,
        strategy: 'text-slide-marker-direct-image-gen',
        slideLabel: p.slideLabel ?? null,
      },
      'Text image generation: page start',
    );

    const figureRefs = p.sourcePdfPages?.length
      ? getFigureReferencesForPages(opts.pdfId, p.sourcePdfPages)
      : [];
    const figureNotes = buildFigureReferenceNotes(figureRefs);

    const prompt = buildImagePrompt({
      stylePrompt: deckStylePrompt,
      slideLabel: p.slideLabel ?? null,
      figureNotes,
      textBody: [
        '請優先遵守「生圖風格模板」指定的視覺語彙（配色、光影、材質、構圖語氣、插畫/資訊圖特徵）。',
        '將內容做視覺化摘要，不要逐字抄錄；保留少量必要文字即可。',
        '若內容與風格衝突，優先保留風格一致性，再調整內容呈現方式。',
        '避免整頁密集文字與純文本排版。',
        p.content,
      ].join('\n\n'),
    });
    const promptWithSourceHint = sourcePdfDataUrl
      ? `${prompt}\n\n[Context]\nA source PDF exists for this slide deck. Keep generated visuals semantically aligned with the provided slide text.`
      : prompt;

    savePageGenerationPrompt(opts.pdfId, p.pageNumber, 'image', promptWithSourceHint, config.openaiImageModel);

    const figureRefFiles = await Promise.all(
      figureRefs.map((figure, index) =>
        fs.promises
          .readFile(figureImageAbsPath(opts.pdfId, figure))
          .then((buf) => toFile(buf, `figure-ref-${index + 1}.png`, { type: 'image/png' })),
      ),
    );

    let image;
    let finalAttempt = 0;
    let lastErrorInfo: RenderTextPageErrorInfo | null = null;
    const timeoutMs = imageTimeoutMs();
    for (let attempt = 1; attempt <= IMAGE_GENERATION_MAX_ATTEMPTS; attempt++) {
      finalAttempt = attempt;
      try {
        if (figureRefFiles.length > 0) {
          image = await client.images.edit({
            model: config.openaiImageModel,
            image: figureRefFiles.length === 1 ? figureRefFiles[0]! : figureRefFiles,
            prompt: promptWithSourceHint,
            size: '1536x1024',
            quality: config.openaiImageQuality,
          } as never, { timeout: timeoutMs });
        } else {
          const imagePayload: Record<string, unknown> = {
            model: config.openaiImageModel,
            prompt: promptWithSourceHint,
            size: '1536x1024',
            quality: config.openaiImageQuality,
          };
          logger.debug(
            redactLogObject({
              pdfId: opts.pdfId,
              pageNumber: p.pageNumber,
              stage: 'text_image_generation',
              requestPayload: imagePayload,
              promptLength: promptWithSourceHint.length,
              timeoutMs,
            }),
            'Text image generation: OpenAI image request prepared',
          );
          image = await client.images.generate(imagePayload as never, { timeout: timeoutMs });
        }
        break;
      } catch (err) {
        const errorInfo = extractErrorInfo(err);
        lastErrorInfo = errorInfo;
        const transient = isTransientImageError(err);
        const willRetry = transient && attempt < IMAGE_GENERATION_MAX_ATTEMPTS;
        logger[willRetry ? 'warn' : 'error'](
          {
            pdfId: opts.pdfId,
            pageNumber: p.pageNumber,
            pageCount,
            attempt,
            maxAttempts: IMAGE_GENERATION_MAX_ATTEMPTS,
            model: config.openaiImageModel,
            quality: config.openaiImageQuality,
            promptLength: prompt.length,
            timeoutMs,
            latencyMs: Date.now() - startedAtMs,
            transient,
            willRetry,
            error: errorInfo,
          },
          willRetry ? 'Text image generation: page attempt failed, retrying' : 'Text image generation: page failed',
        );
        if (!willRetry) {
          const endedAt = new Date().toISOString();
          opts.onPage?.(p.pageNumber, imagePath, {
            imagePath,
            startedAt,
            endedAt,
            latencyMs: Date.parse(endedAt) - Date.parse(startedAt),
            reused: false,
            status: 'failed',
            attempt,
            model: config.openaiImageModel,
            metadata: {
              source_type: 'text',
              precision: 'step_timing',
              maxAttempts: IMAGE_GENERATION_MAX_ATTEMPTS,
              transient,
              quality: config.openaiImageQuality,
              sourcePdfAttached: !!sourcePdfDataUrl,
            },
            promptLength: prompt.length,
            timeoutMs,
            error: errorInfo,
          });
          throw err;
        }
        await sleep(retryDelayMs(attempt));
      }
    }

    if (!image) {
      const err = new Error(`LLM image generation failed at page ${p.pageNumber}: no image response`);
      lastErrorInfo = extractErrorInfo(err);
      const endedAt = new Date().toISOString();
      const responseShape = imageResponseShape(image);
      logger.error(
        {
          pdfId: opts.pdfId,
          pageNumber: p.pageNumber,
          pageCount,
          model: config.openaiImageModel,
          quality: config.openaiImageQuality,
          promptLength: prompt.length,
          timeoutMs,
          attempt: finalAttempt,
          responseShape,
        },
        'Text image generation: empty image response',
      );
      opts.onPage?.(p.pageNumber, imagePath, {
        imagePath,
        startedAt,
        endedAt,
        latencyMs: Date.parse(endedAt) - Date.parse(startedAt),
        reused: false,
        status: 'failed',
        attempt: finalAttempt,
        model: config.openaiImageModel,
        promptLength: prompt.length,
        timeoutMs,
        error: lastErrorInfo,
        metadata: {
          source_type: 'text',
          precision: 'step_timing',
          maxAttempts: IMAGE_GENERATION_MAX_ATTEMPTS,
          quality: config.openaiImageQuality,
          responseShape,
          sourcePdfAttached: !!sourcePdfDataUrl,
        },
      });
      throw err;
    }

    const first = image.data?.[0];
    const b64 = first?.b64_json;
    if (!b64) {
      const err = new Error(`LLM image generation failed at page ${p.pageNumber}: missing b64_json`);
      lastErrorInfo = extractErrorInfo(err);
      const endedAt = new Date().toISOString();
      const responseShape = imageResponseShape(image);
      logger.error(
        {
          pdfId: opts.pdfId,
          pageNumber: p.pageNumber,
          pageCount,
          model: config.openaiImageModel,
          quality: config.openaiImageQuality,
          promptLength: prompt.length,
          timeoutMs,
          attempt: finalAttempt,
          responseShape,
        },
        'Text image generation: missing b64_json in image response',
      );
      opts.onPage?.(p.pageNumber, imagePath, {
        imagePath,
        startedAt,
        endedAt,
        latencyMs: Date.parse(endedAt) - Date.parse(startedAt),
        reused: false,
        status: 'failed',
        attempt: finalAttempt,
        model: config.openaiImageModel,
        promptLength: prompt.length,
        timeoutMs,
        error: lastErrorInfo,
        metadata: {
          source_type: 'text',
          precision: 'step_timing',
          maxAttempts: IMAGE_GENERATION_MAX_ATTEMPTS,
          quality: config.openaiImageQuality,
          responseShape,
          sourcePdfAttached: !!sourcePdfDataUrl,
        },
      });
      throw err;
    }

    await fs.promises.writeFile(imagePath, Buffer.from(b64, 'base64'));
    await generatePageThumbnail(opts.pdfId, p.pageUid, imagePath);
    await fs.promises.writeFile(textPath, p.content, 'utf8');
    const dir = pdfDir(opts.pdfId);
    const relImage = path.relative(dir, imagePath);
    void commitPresentationFiles(
      opts.pdfId,
      [relImage],
      `image: generate page ${p.pageNumber}`,
    );
    const endedAt = new Date().toISOString();
    const latencyMs = Date.parse(endedAt) - Date.parse(startedAt);
    pagePaths.push(imagePath);
    pageUids.push(p.pageUid);
    logger.info(
        {
          pdfId: opts.pdfId,
          pageNumber: p.pageNumber,
          pageCount,
          latencyMs,
          model: config.openaiImageModel,
          quality: config.openaiImageQuality,
          attempt: finalAttempt,
          promptLength: prompt.length,
          timeoutMs,
        },
        'Text image generation: page done',
      );
    opts.onPage?.(p.pageNumber, imagePath, {
      imagePath,
      startedAt,
      endedAt,
      latencyMs,
      reused: false,
      status: 'succeeded',
      attempt: finalAttempt,
      model: config.openaiImageModel,
      promptLength: prompt.length,
      timeoutMs,
      metadata: {
        source_type: 'text',
        precision: 'step_timing',
        maxAttempts: IMAGE_GENERATION_MAX_ATTEMPTS,
        quality: config.openaiImageQuality,
        sourcePdfAttached: !!sourcePdfDataUrl,
        figureReferenceCount: figureRefs.length,
      },
    });
  }

  if (pagePaths[0] && !opts.skipCoverUpdate) {
    const coverPath = coverImagePath(opts.pdfId);
    await fs.promises.copyFile(pagePaths[0], coverPath);
    await generateCoverThumbnail(opts.pdfId, coverPath);
  }

  return { pageCount, pagePaths, pageUids };
}
