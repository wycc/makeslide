import fs from 'node:fs';
import { coverImagePath, pageImagePath, pageTextPath, pagesDir } from '../../services/storage';
import { getOpenAIClient } from '../../services/openai';
import { logger } from '../../logger';
import { config } from '../../config';
import { buildImagePrompt, IMAGE_PROMPT_TEMPLATES } from '../../services/imagePromptTemplates';

export interface RenderTextPagesWithLlmOptions {
  pdfId: string;
  pages: Array<{ pageNumber: number; content: string; slideLabel?: string }>;
  onPage?: (pageNumber: number, imagePath: string, info: RenderTextPageTimingInfo) => void;
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
}

const IMAGE_GENERATION_MAX_ATTEMPTS = 3;
const IMAGE_GENERATION_BACKOFF_BASE_MS = 500;

function imageTimeoutMs(): number {
  return config.openaiImageQuality === 'high'
    ? config.openaiImageTimeoutMsHighQuality
    : config.openaiImageTimeoutMs;
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

export async function renderTextPagesWithLlm(
  opts: RenderTextPagesWithLlmOptions,
): Promise<RenderTextPagesWithLlmResult> {
  const client = getOpenAIClient();
  const pageCount = opts.pages.length;
  const pagePaths: string[] = [];
  await fs.promises.mkdir(pagesDir(opts.pdfId), { recursive: true });

  for (const p of opts.pages) {
    const startedAtMs = Date.now();
    const startedAt = new Date(startedAtMs).toISOString();
    const imagePath = pageImagePath(opts.pdfId, p.pageNumber, pageCount);
    const textPath = pageTextPath(opts.pdfId, p.pageNumber, pageCount);

    // Idempotency: if image already exists and non-empty, keep it and skip
    // re-generation. Still sync text file so downstream steps read latest text.
    try {
      const st = await fs.promises.stat(imagePath);
      if (st.isFile() && st.size > 0) {
        await fs.promises.writeFile(textPath, p.content, 'utf8');
        pagePaths.push(imagePath);
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

    const prompt = buildImagePrompt({
      stylePrompt: IMAGE_PROMPT_TEMPLATES[0]?.prompt_en,
      slideLabel: p.slideLabel ?? null,
      textBody: [
        '目標是「視覺化摘要」而不是全文轉貼。請把重點轉成圖像與結構，不要做文字牆。',
        '版型要求：1 個主標題 + 3~5 個關鍵短句（每句 ≤ 14 字）+ 1 個大型視覺主體（流程圖/關係圖/圖示群/概念圖）。',
        '文字規範：繁體中文、精簡短句、可讀性高；避免長段落、密集條列、過小字。',
        '視覺規範：扁平化圖示、卡片分區、柔和對比、資訊圖表感；可用抽象圖形輔助理解。',
        '禁止項目：整頁密集文字、逐字抄錄、黑底白字純文本頁、學術論文式排版。',
        p.content,
      ].join('\n\n'),
    });

    let image;
    let finalAttempt = 0;
    let lastErrorInfo: RenderTextPageErrorInfo | null = null;
    const timeoutMs = imageTimeoutMs();
    for (let attempt = 1; attempt <= IMAGE_GENERATION_MAX_ATTEMPTS; attempt++) {
      finalAttempt = attempt;
      try {
        image = await client.images.generate(
          {
            model: config.openaiImageModel,
            prompt,
            size: '1536x1024',
          },
          { timeout: timeoutMs },
        );
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
            promptLength: prompt.length,
            timeoutMs,
            error: errorInfo,
            metadata: {
              source_type: 'text',
              precision: 'step_timing',
              maxAttempts: IMAGE_GENERATION_MAX_ATTEMPTS,
              transient,
            },
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
        metadata: { source_type: 'text', precision: 'step_timing', maxAttempts: IMAGE_GENERATION_MAX_ATTEMPTS },
      });
      throw err;
    }

    const first = image.data?.[0];
    const b64 = first?.b64_json;
    if (!b64) {
      const err = new Error(`LLM image generation failed at page ${p.pageNumber}: missing b64_json`);
      lastErrorInfo = extractErrorInfo(err);
      const endedAt = new Date().toISOString();
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
        metadata: { source_type: 'text', precision: 'step_timing', maxAttempts: IMAGE_GENERATION_MAX_ATTEMPTS },
      });
      throw err;
    }

    await fs.promises.writeFile(imagePath, Buffer.from(b64, 'base64'));
    await fs.promises.writeFile(textPath, p.content, 'utf8');
    const endedAt = new Date().toISOString();
    const latencyMs = Date.parse(endedAt) - Date.parse(startedAt);
    pagePaths.push(imagePath);
    logger.info(
        {
          pdfId: opts.pdfId,
          pageNumber: p.pageNumber,
          pageCount,
          latencyMs,
          model: config.openaiImageModel,
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
      metadata: { source_type: 'text', precision: 'step_timing', maxAttempts: IMAGE_GENERATION_MAX_ATTEMPTS },
    });
  }

  if (pagePaths[0]) {
    await fs.promises.copyFile(pagePaths[0], coverImagePath(opts.pdfId));
  }

  return { pageCount, pagePaths };
}
