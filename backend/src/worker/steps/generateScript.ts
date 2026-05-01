import fs from 'node:fs';
import sharp from 'sharp';
import { z } from 'zod';
import type { ChatCompletionContentPart } from 'openai/resources/chat/completions';
import { config } from '../../config';
import { logger } from '../../logger';
import { callChatJSON, type TokenUsage } from '../../services/openai';
import { pageScriptPath, pageTextPath } from '../../services/storage';

export interface ScriptPageResult {
  pageNumber: number;
  scriptPath: string;
  script: string;
  chars: number;
  generatedAt: string;
  usage: TokenUsage;
  skipped: boolean;
}

export interface GenerateScriptResult {
  pages: ScriptPageResult[];
  totalUsage: TokenUsage;
}

export interface GenerateScriptOptions {
  pdfId: string;
  pageCount: number;
  /**
   * Per-page input. `text` is the raw extracted text (may be empty).
   * `empty === true` means the M2 step marked this page as text-less
   * (scanned image / graphics only). `imagePath` is the absolute path to
   * the rendered PNG of this page (used when vision is enabled).
   */
  pages: Array<{
    pageNumber: number;
    text: string;
    empty: boolean;
    imagePath: string;
  }>;
  /**
   * Freeform style / tone hint supplied by the user right after upload
   * (via POST /api/pdfs/:id/start). May be null / empty → default tone.
   */
  userPrompt?: string | null;
  maxCharsPerPage?: number | null;
  /**
   * Optional progress callback fired after each page completes (including
   * idempotent skips). `done` is 1-based count of pages finished so far.
   */
  onPage?: (pageNumber: number, done: number) => void;
}

const ScriptResponseSchema = z.object({
  script: z.string().min(1),
});

const ScriptDeckRewriteSchema = z.object({
  pages: z
    .array(
      z.object({
        page_number: z.number().int().positive(),
        script: z.string().min(1),
      }),
    )
    .min(1),
});

/**
 * Hard clip extracted text so we don't explode token usage on PDFs that
 * happen to include huge embedded tables or raw extracts. ~4x the target
 * output char count is plenty of context for the *current* page.
 */
const MAX_TEXT_CHARS_PER_PAGE = 4000;

function clipText(text: string, max: number = MAX_TEXT_CHARS_PER_PAGE): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return t.slice(0, max) + '……（內容過長已截斷）';
}

/**
 * Pull the last ~2 sentences of the previous page's script as lightweight
 * context so the next page flows naturally. Uses CJK + Western sentence
 * terminators.
 */
function lastSentences(text: string, maxSentences = 2): string {
  const trimmed = text.trim();
  if (!trimmed) return '';
  // Split on common sentence terminators while keeping the terminator attached.
  const parts = trimmed.split(/(?<=[。！？.!?])/u).filter((s) => s.trim().length > 0);
  if (parts.length === 0) return trimmed.slice(-120);
  return parts.slice(-maxSentences).join('').trim();
}

/**
 * Build the "previous page context" blob. Uses the last N characters of
 * the generated previous-page script (clipped to a sensible cap). If the
 * configured cap is 0 (or we have no generated script yet) we fall back to
 * the last 2 sentences.
 */
function buildPreviousContext(previousScript: string): string {
  const cap = config.openaiScriptPrevContextChars;
  if (!previousScript) return '';
  if (cap <= 0) return lastSentences(previousScript);
  if (previousScript.length <= cap) return previousScript.trim();
  // Keep the tail (most recent content) so hand-off phrasing stays coherent.
  return '……' + previousScript.slice(previousScript.length - cap).trim();
}

function buildNextContext(nextText: string, nextEmpty: boolean): string {
  if (nextEmpty) return '（下一頁抽不到文字，可能是純圖像或分隔頁）';
  const cap = config.openaiScriptNextContextChars;
  if (cap <= 0) return '';
  return clipText(nextText, cap);
}

/**
 * Load a page PNG from disk, downsize it to the configured max width and
 * return a `data:image/jpeg;base64,...` URL suitable for OpenAI vision.
 * Returns `null` (and logs a warning) on any failure so the script step can
 * still fall back to text-only reasoning.
 */
async function loadPageImageDataUrl(
  pdfId: string,
  pageNumber: number,
  imagePath: string,
): Promise<string | null> {
  try {
    const buf = await sharp(imagePath)
      .resize({
        width: config.openaiScriptImageMaxWidth,
        withoutEnlargement: true,
        fit: 'inside',
      })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
    const b64 = buf.toString('base64');
    const url = `data:image/jpeg;base64,${b64}`;
    logger.debug(
      { pdfId, pageNumber, bytes: buf.length, width: config.openaiScriptImageMaxWidth },
      'generateScript: page image encoded for vision',
    );
    return url;
  } catch (err) {
    logger.warn(
      {
        pdfId,
        pageNumber,
        imagePath,
        error: err instanceof Error ? err.message : String(err),
      },
      'generateScript: failed to load page image, falling back to text-only',
    );
    return null;
  }
}

const MAX_USER_PROMPT_CHARS_IN_SYSTEM = 2000;

function sanitiseUserPrompt(raw: string | null | undefined): string {
  if (!raw) return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  return trimmed.length > MAX_USER_PROMPT_CHARS_IN_SYSTEM
    ? trimmed.slice(0, MAX_USER_PROMPT_CHARS_IN_SYSTEM) + '……（已截斷）'
    : trimmed;
}

function buildSystemPrompt(
  userPrompt: string | null | undefined,
  targetChars: number,
): string {
  const base = [
    '你是一位專業的中文簡報講師與旁白配音員。',
    `你的任務：根據單一簡報頁的**文字 + 投影片圖像**，生成一段適合直接朗讀的**繁體中文逐字稿**（約 ${targetChars} 字，允許在 120–180 字之間）。`,
    '嚴格規則：',
    '1. 只輸出純粹口語化的連貫段落，不要 Markdown、不要項目符號、不要標題、不要表情符號、不要英文括號註解。',
    '2. 語氣自然、像真人對觀眾講解，避免贅詞與口頭禪。',
    '3. 使用繁體中文，術語保留原文（如有必要）。',
    '4. 每段以句號、問號或驚嘆號作為結尾。',
    '5. 要充分利用投影片圖像：讀懂其中的**標題、條列、流程圖、示意圖、圖表與程式碼**，並轉成口語敘述；若圖像呈現的資訊比文字更豐富，以圖像為準。',
    '6. 必須與**上一頁結尾**銜接、並為**下一頁**做自然鋪陳，整份簡報聽起來是一個連貫的故事；但不要重複上一頁已講過的內容，也不要提前劇透下一頁的細節。',
    '7. 回傳 JSON，格式固定為 {"script": "..."}，不要夾帶其他欄位或說明。',
    '8. 請儘量使用比喻、故事、類比等方式來講解，讓內容生動有趣，避免乾巴巴地照抄文字內容。',
  ];

  const sanitized = sanitiseUserPrompt(userPrompt);
  if (sanitized) {
    base.push('');
    base.push(
      '【使用者指定的風格 / 語氣 / 聽眾要求】（優先遵守；若與上述規則衝突時，仍須維持逐字稿結構與字數，但語氣、人稱、情緒強度可依照此要求調整。請勿把這段內容直接複製到輸出裡。）',
    );
    base.push(sanitized);
  }

  return base.join('\n');
}

interface PromptContext {
  pageNumber: number;
  pageCount: number;
  targetChars: number;
  pageText: string;
  pageEmpty: boolean;
  previousContext: string;
  nextContext: string;
}

function buildUserText(ctx: PromptContext): string {
  const lines: string[] = [];
  lines.push(`目前頁碼：第 ${ctx.pageNumber} 頁 / 共 ${ctx.pageCount} 頁。`);
  lines.push(`目標字數：約 ${ctx.targetChars} 字（120–180）。`);
  lines.push(`輸出語言：${config.openaiScriptLanguage}（繁體中文）。`);

  if (ctx.previousContext) {
    lines.push('');
    lines.push('【上一頁腳本（已產生，供銜接參考，請勿重複其句子）】');
    lines.push(ctx.previousContext);
  } else if (ctx.pageNumber === 1) {
    lines.push('');
    lines.push('【備註】這是第一頁，請自然地作為開場引言。');
  }

  if (ctx.nextContext) {
    lines.push('');
    lines.push('【下一頁原文（預告參考；只做銜接鋪陳，請勿把下一頁的細節講完）】');
    lines.push(ctx.nextContext);
  } else if (ctx.pageNumber === ctx.pageCount) {
    lines.push('');
    lines.push('【備註】這是最後一頁，請自然地作為總結 / 收尾。');
  }

  lines.push('');
  if (ctx.pageEmpty || ctx.pageText.trim().length === 0) {
    lines.push(
      '【本頁文字】（本頁抽不到文字，可能是封面、分隔頁或純圖像。請**根據附上的投影片圖像**與前後頁脈絡，給出合理的講解。）',
    );
  } else {
    lines.push('【本頁原始文字（pdf 抽取，可能有排版殘留）】');
    lines.push(clipText(ctx.pageText));
  }
  lines.push('');
  lines.push('【本頁投影片圖像】請觀察附上的圖片，結合圖表、示意圖、條列與排版來講解。');
  lines.push('');
  lines.push('請以 JSON 格式回覆：{"script": "本頁逐字稿內容..."}');
  return lines.join('\n');
}

function buildDeckRewriteSystemPrompt(userPrompt: string | null | undefined): string {
  const base = [
    '你是一位專業的繁體中文簡報旁白編輯。',
    '任務：根據「全頁逐字稿草稿」，重新潤飾每一頁，讓整份簡報聽起來更連貫、自然、有過場。',
    '規則：',
    '1. 必須輸出 JSON：{"pages":[{"page_number":1,"script":"..."}, ...]}，不要其他欄位。',
    '2. pages 的數量與 page_number 必須和輸入完全一致，不可增刪頁。',
    '3. 每頁保持約 120–180 字，繁體中文、口語自然。',
    '4. 可以調整句子銜接與語氣，但不要憑空捏造與投影片無關的新事實。',
    '5. 每頁腳本仍要可獨立朗讀，並在頁與頁之間有連續性。',
  ];
  const sanitized = sanitiseUserPrompt(userPrompt);
  if (sanitized) {
    base.push('');
    base.push('【使用者風格要求】');
    base.push(sanitized);
  }
  return base.join('\n');
}

function buildDeckRewriteUserText(
  pageCount: number,
  pages: Array<{ pageNumber: number; script: string }>,
): string {
  const lines: string[] = [];
  lines.push(`請重排以下 ${pageCount} 頁逐字稿草稿，提升全稿連貫性：`);
  lines.push('');
  for (const p of pages) {
    lines.push(`【第 ${p.pageNumber} 頁草稿】`);
    lines.push(p.script.trim());
    lines.push('');
  }
  lines.push('請回傳 JSON：{"pages":[{"page_number":1,"script":"..."}, ...]}');
  return lines.join('\n');
}

async function readPageText(
  pdfId: string,
  pageNumber: number,
  pageCount: number,
): Promise<string> {
  const p = pageTextPath(pdfId, pageNumber, pageCount);
  try {
    return await fs.promises.readFile(p, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw err;
  }
}

async function readExistingScript(
  pdfId: string,
  pageNumber: number,
  pageCount: number,
): Promise<string | null> {
  const p = pageScriptPath(pdfId, pageNumber, pageCount);
  try {
    const content = await fs.promises.readFile(p, 'utf8');
    return content.trim().length > 0 ? content : null;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * Generate a per-page spoken script for every page of a PDF.
 *
 * Runs serially so each call can use the **generated** previous page script
 * (continuity hand-off) and the **raw** next page text (forward teaser) as
 * context. When vision is enabled (`OPENAI_SCRIPT_USE_IMAGES`) the rendered
 * PNG of the current page is also inlined into the user message as a
 * base64 JPEG so the LLM can read diagrams / charts / stylised titles that
 * don't survive `pdftotext`.
 *
 * Idempotent: if a `.script.txt` already exists and is non-empty, that page
 * is skipped (its script still gets used as previous-page context for the
 * following pages).
 *
 * Throws on the first unrecoverable per-page failure after one retry.
 */
export async function generateScript(
  opts: GenerateScriptOptions,
): Promise<GenerateScriptResult> {
  const { pdfId, pageCount, pages, onPage, userPrompt } = opts;
  const targetChars = opts.maxCharsPerPage ?? config.openaiScriptTargetChars;
  const system = buildSystemPrompt(userPrompt, targetChars);
  if (userPrompt && userPrompt.trim()) {
    logger.info(
      { pdfId, promptPreview: userPrompt.trim().slice(0, 80) },
      'generateScript: applying user style prompt',
    );
  }

  const results: ScriptPageResult[] = [];
  const totalUsage: TokenUsage = {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
  };

  // Full previous script (may be clipped when injected into the prompt).
  let previousScript = '';
  let done = 0;

  for (let i = 0; i < pages.length; i++) {
    const pageInfo = pages[i]!;
    const nextInfo = pages[i + 1];

    const existing = await readExistingScript(pdfId, pageInfo.pageNumber, pageCount);
    if (existing) {
      previousScript = existing;
      results.push({
        pageNumber: pageInfo.pageNumber,
        scriptPath: pageScriptPath(pdfId, pageInfo.pageNumber, pageCount),
        script: existing,
        chars: existing.length,
        generatedAt: new Date().toISOString(),
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        skipped: true,
      });
      logger.info(
        { pdfId, pageNumber: pageInfo.pageNumber, chars: existing.length },
        'generateScript: reuse existing script (idempotent skip)',
      );
      done += 1;
      onPage?.(pageInfo.pageNumber, done);
      continue;
    }

    const previousContext = buildPreviousContext(previousScript);
    const nextContext = nextInfo
      ? buildNextContext(nextInfo.text, nextInfo.empty)
      : '';

    const userText = buildUserText({
      pageNumber: pageInfo.pageNumber,
      pageCount,
      targetChars,
      pageText: pageInfo.text,
      pageEmpty: pageInfo.empty,
      previousContext,
      nextContext,
    });

    // Optionally attach the current page's rendered PNG as a vision input.
    let imageDataUrl: string | null = null;
    if (config.openaiScriptUseImages) {
      imageDataUrl = await loadPageImageDataUrl(
        pdfId,
        pageInfo.pageNumber,
        pageInfo.imagePath,
      );
    }

    const userContent: ChatCompletionContentPart[] = [
      { type: 'text', text: userText },
    ];
    if (imageDataUrl) {
      userContent.push({
        type: 'image_url',
        image_url: { url: imageDataUrl, detail: 'auto' },
      });
    }

    const label = `script p${pageInfo.pageNumber}/${pageCount}`;
    let lastErr: unknown;
    let success: {
      script: string;
      usage: TokenUsage;
      latencyMs: number;
    } | null = null;

    const MAX_ATTEMPTS = 2; // outer page-level retry
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const { data, usage, latencyMs } = await callChatJSON({
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: userContent },
          ],
          schema: ScriptResponseSchema,
          label,
          maxTokens: 600,
          temperature: 0.6,
        });
        const script = data.script.trim();
        if (!script) {
          throw new Error('LLM returned empty script');
        }
        success = { script, usage, latencyMs };
        break;
      } catch (err) {
        lastErr = err;
        logger.warn(
          {
            pdfId,
            pageNumber: pageInfo.pageNumber,
            attempt,
            hasImage: !!imageDataUrl,
            error: err instanceof Error ? err.message : String(err),
          },
          'generateScript: page attempt failed',
        );
      }
    }

    if (!success) {
      throw new Error(
        `Page ${pageInfo.pageNumber} script generation failed: ${
          lastErr instanceof Error ? lastErr.message : String(lastErr)
        }`,
      );
    }

    const { script, usage, latencyMs } = success;
    const scriptPath = pageScriptPath(pdfId, pageInfo.pageNumber, pageCount);
    await fs.promises.writeFile(scriptPath, script, 'utf8');

    totalUsage.prompt_tokens += usage.prompt_tokens;
    totalUsage.completion_tokens += usage.completion_tokens;
    totalUsage.total_tokens += usage.total_tokens;

    logger.info(
      {
        pdfId,
        pageNumber: pageInfo.pageNumber,
        chars: script.length,
        latencyMs,
        usage,
        hasImage: !!imageDataUrl,
      },
      'generateScript: page done',
    );

    previousScript = script;
    results.push({
      pageNumber: pageInfo.pageNumber,
      scriptPath,
      script,
      chars: script.length,
      generatedAt: new Date().toISOString(),
      usage,
      skipped: false,
    });
    done += 1;
    onPage?.(pageInfo.pageNumber, done);
  }

  logger.info(
    {
      pdfId,
      pageCount,
      totalUsage,
      generated: results.filter((r) => !r.skipped).length,
      skipped: results.filter((r) => r.skipped).length,
      useImages: config.openaiScriptUseImages,
    },
    'generateScript: all pages complete',
  );

  // Second pass: rewrite whole deck scripts for cross-page continuity.
  const sorted = [...results].sort((a, b) => a.pageNumber - b.pageNumber);
  const rewriteLabel = `script-rewrite deck/${pageCount}`;
  try {
    const { data, usage, latencyMs } = await callChatJSON({
      messages: [
        { role: 'system', content: buildDeckRewriteSystemPrompt(userPrompt) },
        {
          role: 'user',
          content: buildDeckRewriteUserText(
            pageCount,
            sorted.map((r) => ({ pageNumber: r.pageNumber, script: r.script })),
          ),
        },
      ],
      schema: ScriptDeckRewriteSchema,
      label: rewriteLabel,
      maxTokens: Math.max(1200, pageCount * 260),
      temperature: 0.5,
    });

    const byPage = new Map<number, string>();
    for (const p of data.pages) {
      byPage.set(p.page_number, p.script.trim());
    }

    for (const r of results) {
      const rewritten = byPage.get(r.pageNumber);
      if (!rewritten) continue;
      await fs.promises.writeFile(r.scriptPath, rewritten, 'utf8');
      r.script = rewritten;
      r.chars = rewritten.length;
      r.generatedAt = new Date().toISOString();
      r.skipped = false;
    }

    totalUsage.prompt_tokens += usage.prompt_tokens;
    totalUsage.completion_tokens += usage.completion_tokens;
    totalUsage.total_tokens += usage.total_tokens;

    logger.info(
      { pdfId, pageCount, latencyMs, usage },
      'generateScript: deck rewrite pass complete',
    );
  } catch (err) {
    logger.warn(
      {
        pdfId,
        pageCount,
        error: err instanceof Error ? err.message : String(err),
      },
      'generateScript: deck rewrite pass failed, keeping first-pass scripts',
    );
  }

  return { pages: results, totalUsage };
}

/**
 * Read already-persisted scripts from disk. Used by generateTitle which
 * runs after the script step (and by idempotent re-runs).
 */
export async function readScripts(
  pdfId: string,
  pageCount: number,
): Promise<Array<{ pageNumber: number; script: string }>> {
  const out: Array<{ pageNumber: number; script: string }> = [];
  for (let n = 1; n <= pageCount; n++) {
    try {
      const content = await fs.promises.readFile(
        pageScriptPath(pdfId, n, pageCount),
        'utf8',
      );
      out.push({ pageNumber: n, script: content.trim() });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }
  return out;
}
