import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { z } from 'zod';
import type { ChatCompletionContentPart } from 'openai/resources/chat/completions';
import { config } from '../../config';
import { logger } from '../../logger';
import { db, savePageGenerationPrompt } from '../../db';
import { callChatJSON, type TokenUsage } from '../../services/openai';
import { getRuntimeAiSettings } from '../../services/aiSettings';
import { loadPromptTemplate, renderPromptTemplate } from '../../services/promptTemplates';
import { pageScriptPath, pdfDir } from '../../services/storage';
import { commitPresentationFile } from '../../services/presentationGit';

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
  onPage?: (pageNumber: number, done: number, info?: { startedAt: string; endedAt: string; skipped: boolean; scriptPath: string }) => void;
  /**
   * Optional cancellation probe. Invoked before each page; if it returns
   * true, script generation throws `CANCELLED` immediately without
   * processing further pages. Only checked between pages; any already
   * in-flight OpenAI call will run to completion.
   */
  shouldAbort?: () => boolean;
  /**
   * Additional pages whose scripts are already on disk and should be included
   * as context in the deck-rewrite pass but NOT themselves regenerated.
   * Useful when inserting new pages into an existing deck: pass the
   * surrounding pages so the rewrite produces scripts that flow naturally.
   * Only `pageNumber` and `script` are needed.
   */
  rewriteContextPages?: Array<{ pageNumber: number; script: string }>;
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
const SCRIPT_MAX_ATTEMPTS = 10;
const SCRIPT_RETRY_INITIAL_DELAY_MS = 1000;
const SCRIPT_RETRY_MAX_DELAY_MS = 15000;
const SCRIPT_RETRY_FACTOR = 2;

async function writeUtf8Ensured(filePath: string, content: string): Promise<void> {
  try {
    await fs.promises.writeFile(filePath, content, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') throw err;
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, content, 'utf8');
  }
}

function clipText(text: string, max: number = MAX_TEXT_CHARS_PER_PAGE): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return t.slice(0, max) + '……（內容過長已截斷）';
}

/**
 * Derive the acceptable per-page script length window (±20% around the
 * target) used to turn the soft "建議字數" hint into a hard range the LLM
 * must stay within. Shared by both the initial generation pass and the
 * single-page rewrite endpoint so they enforce the same bounds.
 */
export function scriptCharBounds(targetChars: number): { min: number; max: number } {
  const t = Math.max(1, Math.round(targetChars));
  return { min: Math.round(t * 0.8), max: Math.round(t * 1.2) };
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

function isRetryableScriptError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: string; message?: string; type?: string; status?: number };
  const name = (e.name ?? '').toLowerCase();
  const type = (e.type ?? '').toLowerCase();
  const message = (e.message ?? '').toLowerCase();
  const status = e.status;

  if (status === 408 || status === 429) return true;
  if (typeof status === 'number' && status >= 500) return true;
  if (name.includes('timeout') || type.includes('timeout') || message.includes('timed out')) {
    return true;
  }
  if (name.includes('connection') || type.includes('connection')) return true;
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
const TONE_MARKER_PATTERN = /\[\[\s*[^\]]+\s*\]\]/;
const LEGACY_TONE_MARKER_RE = /\[\[\s*話氣提示伺\s*:\s*([^\]]+?)\s*\]\]/g;

function normalizeLegacyToneMarkers(script: string): string {
  return script.replace(LEGACY_TONE_MARKER_RE, (_m, tone: string) => `[[ ${String(tone).trim()} ]]`);
}

function ensureToneMarkers(script: string): string {
  const text = normalizeLegacyToneMarkers(script).trim();
  if (!text) return text;
  if (TONE_MARKER_PATTERN.test(text)) return text;
  const chunks = text
    .split(/(?<=[。！？!?])\s*/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (chunks.length <= 1) {
    return `[[ 平穩敘述 ]]${text}`;
  }
  return chunks
    .map((c, i) => {
      const tone = i === 0 ? '穩重開場' : i === chunks.length - 1 ? '收束總結' : '親切解釋';
      return `[[ ${tone} ]]${c}`;
    })
    .join('');
}

function sanitiseUserPrompt(raw: string | null | undefined): string {
  if (!raw) return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  return trimmed.length > MAX_USER_PROMPT_CHARS_IN_SYSTEM
    ? trimmed.slice(0, MAX_USER_PROMPT_CHARS_IN_SYSTEM) + '……（已截斷）'
    : trimmed;
}

/** Read the per-PDF host mode ('solo' single narrator | 'dual' two-host podcast). Defaults to 'solo'. */
export function getPdfHostMode(pdfId: string): 'solo' | 'dual' {
  try {
    const row = db.prepare(`SELECT host_mode FROM pdfs WHERE id = ?`).get(pdfId) as
      | { host_mode?: string | null }
      | undefined;
    return row?.host_mode === 'dual' ? 'dual' : 'solo';
  } catch {
    return 'solo';
  }
}

function buildSystemPrompt(
  userPrompt: string | null | undefined,
  targetChars: number,
  ttsProvider: 'openai' | 'gemini',
  geminiSpeaker1Persona?: string,
  geminiSpeaker2Persona?: string,
  contentLanguage: 'zh-TW' | 'en' = 'zh-TW',
  hostMode: 'solo' | 'dual' = 'solo',
): string {
  const languageInstruction = contentLanguage === 'en'
    ? '【輸出語言】請用英文產生逐字稿、旁白與所有可朗讀內容；即使使用者提示或投影片文字是中文，也要翻譯並自然改寫成英文。'
    : '【輸出語言】請用繁體中文產生逐字稿、旁白與所有可朗讀內容；即使使用者提示或投影片文字是英文，也要翻譯並自然改寫成繁體中文。';
  const bounds = scriptCharBounds(targetChars);
  const charLimitInstruction = `【字數限制】每頁逐字稿長度必須控制在 ${bounds.min}～${bounds.max} 字之間（目標約 ${targetChars} 字）：內容多時請優先濃縮、只挑核心重點講，不可超過 ${bounds.max} 字上限；內容少時可適度展開，但不要灌水。`;
  if (ttsProvider === 'gemini') {
    const isDual = hostMode === 'dual';
    const fallback = isDual
      ? '你是一位 Podcast 逐字稿編輯助理。請輸出 JSON：{"script":"..."}'
      : '你是一位繁體中文簡報旁白編輯。請輸出 JSON：{"script":"..."}';
    const template = loadPromptTemplate(
      isDual ? 'backend/prompts/generate-script-gemini.md' : 'backend/prompts/generate-script-gemini-solo.md',
      fallback,
    );
    const base = [template, '', languageInstruction, '', charLimitInstruction];
    const sanitized = sanitiseUserPrompt(userPrompt);
    // 人設僅在雙人模式下加入；單人模式不附加任何 Speaker 人設。
    if (isDual) {
      const speaker1 = geminiSpeaker1Persona?.trim();
      const speaker2 = geminiSpeaker2Persona?.trim();
      if (speaker1 || speaker2) {
        const speakerBlockTpl = loadPromptTemplate(
          'backend/prompts/partials/gemini-speaker-persona-block.md',
          '【雙主持人角色人設（優先遵守）】\n{{speaker1_line}}\n{{speaker2_line}}',
        );
        base.push('');
        base.push(
          renderPromptTemplate(speakerBlockTpl, {
            speaker1_line: speaker1 ? `- Speaker 1 人設：${speaker1}` : '',
            speaker2_line: speaker2 ? `- Speaker 2 人設：${speaker2}` : '',
          }),
        );
      }
    }
    if (sanitized) {
      const userBlockTpl = loadPromptTemplate(
        'backend/prompts/partials/user-style-block.md',
        '【使用者指定的風格 / 語氣 / 聽眾要求】\n{{user_prompt}}',
      );
      base.push('');
      base.push(renderPromptTemplate(userBlockTpl, { user_prompt: sanitized }));
    }
    return base.join('\n');
  }

  const ttsRewriteRules = [
    '請改寫成適合 TTS 朗讀的逐字稿。',
    '',
    '要求：',
    '1. 使用自然口語，不要像書面文章。',
    '2. 每句話盡量短。',
    '3. 重要概念前後加入停頓。',
    '4. 加入少量「好」、「那我們來看」、「這裡有一個重點」等自然轉場。',
    '5. 避免過度誇張，不要像廣告配音。',
    '6. 語氣像老師在課堂上清楚解釋。',
    '7. 輸出時保留段落換行，方便 TTS 產生停頓。',
  ];

  const isOpenaiDual = hostMode === 'dual';
  const base = [
    renderPromptTemplate(
      loadPromptTemplate(
        isOpenaiDual ? 'backend/prompts/generate-script-openai-dual.md' : 'backend/prompts/generate-script-openai.md',
        isOpenaiDual
          ? `你是一位雙人 Podcast 節目企劃與逐字稿編輯。你的任務：生成繁體中文雙人對談逐字稿（目標約 ${targetChars} 字，必須控制在 ${bounds.min}～${bounds.max} 字之間），由 Speaker 1 與 Speaker 2 輪流對話。請回傳 JSON：{"script":"..."}`
          : `你是一位專業的中文簡報講師與旁白配音員。你的任務：生成繁體中文逐字稿（目標約 ${targetChars} 字，必須控制在 ${bounds.min}～${bounds.max} 字之間）。請回傳 JSON：{"script":"..."}`,
      ),
      { target_chars: String(targetChars), min_chars: String(bounds.min), max_chars: String(bounds.max) },
    ),
    '',
    languageInstruction,
  ];

  const sanitized = sanitiseUserPrompt(userPrompt);
  if (sanitized) {
    const userBlockTpl = loadPromptTemplate(
      'backend/prompts/partials/user-style-block-openai.md',
      '【使用者指定的風格 / 語氣 / 聽眾要求】（優先遵守；若與上述規則衝突時，仍須維持逐字稿結構，但語氣、人稱、情緒強度可依照此要求調整。請勿把這段內容直接複製到輸出裡。）\n{{user_prompt}}',
    );
    base.push('');
    base.push(renderPromptTemplate(userBlockTpl, { user_prompt: sanitized }));
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
  extraSourcesText: string;
}

function buildUserText(ctx: PromptContext): string {
  const previousBlock = ctx.previousContext
    ? `【上一頁腳本（已產生，供銜接參考，請勿重複其句子）】\n${ctx.previousContext}`
    : ctx.pageNumber === 1
      ? '【備註】這是第一頁，請自然地作為開場引言。'
      : '';

  const nextBlock = ctx.nextContext
    ? `【下一頁原文（預告參考；只做銜接鋪陳，請勿把下一頁的細節講完）】\n${ctx.nextContext}`
    : ctx.pageNumber === ctx.pageCount
      ? '【備註】這是最後一頁，請自然地作為總結 / 收尾。'
      : '';

  const pageTextBlock = (ctx.pageEmpty || ctx.pageText.trim().length === 0)
    ? '【頁面文字】（此處可能抽不到文字，例如封面、分隔頁或純圖像。請**根據附上的投影片圖像**與前後頁脈絡，給出合理的講解。）'
    : `【頁面原始文字（pdf 抽取，可能有排版殘留）】\n${clipText(ctx.pageText)}`;

  const extraSourceBlock = ctx.extraSourcesText.trim()
    ? `【補充來源（PDF/TXT/YouTube 字幕等）】\n${ctx.extraSourcesText.trim()}`
    : '';

  const bounds = scriptCharBounds(ctx.targetChars);
  const fallback =
    '目前頁碼：第 {{page_number}} 頁 / 共 {{page_count}} 頁。\n目標字數：約 {{target_chars}} 字（必須落在 {{min_chars}}～{{max_chars}} 字之間）。\n{{previous_block}}\n{{next_block}}\n{{page_text_block}}\n{{extra_source_block}}\n請以 JSON 格式回覆：{"script": "逐字稿內容..."}';
  const template = loadPromptTemplate('backend/prompts/generate-script-usertext.md', fallback);
  const rendered = renderPromptTemplate(template, {
    page_number: String(ctx.pageNumber),
    page_count: String(ctx.pageCount),
    target_chars: String(ctx.targetChars),
    min_chars: String(bounds.min),
    max_chars: String(bounds.max),
    output_language: config.openaiScriptLanguage,
    previous_block: previousBlock,
    next_block: nextBlock,
    page_text_block: pageTextBlock,
    extra_source_block: extraSourceBlock,
  });
  return rendered
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function buildDeckRewriteSystemPrompt(
  userPrompt: string | null | undefined,
  targetChars: number,
  hostMode: 'solo' | 'dual' = 'solo',
): string {
  const runtime = getRuntimeAiSettings();
  const bounds = scriptCharBounds(targetChars);
  if (runtime.ttsProvider === 'gemini') {
    const isDual = hostMode === 'dual';
    const base = [
      loadPromptTemplate(
        isDual ? 'backend/prompts/rewrite-script-gemini.md' : 'backend/prompts/rewrite-script-gemini-solo.md',
        isDual
          ? '你是一位 Podcast 逐字稿總編輯。只輸出 JSON：{"pages":[{"page_number":1,"script":"..."}, ...]}。'
          : '你是一位繁體中文簡報旁白總編輯。只輸出 JSON：{"pages":[{"page_number":1,"script":"..."}, ...]}。',
      ),
      '',
      `【字數限制】每頁逐字稿長度必須控制在 ${bounds.min}～${bounds.max} 字之間（目標和原稿越接近越好）：內容多時優先濃縮挑重點，不可超過 ${bounds.max} 字上限；內容偏少時可適度展開、補足語氣與轉場，不要大幅刪減原意，也不可低於 ${bounds.min} 字下限。`,
    ];
    const sanitized = sanitiseUserPrompt(userPrompt);
    if (isDual) {
      const speaker1 = runtime.geminiTtsSpeaker1?.trim();
      const speaker2 = runtime.geminiTtsSpeaker2?.trim();
      if (speaker1 || speaker2) {
        base.push('');
        base.push('【雙主持人角色人設（優先遵守）】');
        if (speaker1) base.push(`- Speaker 1 人設：${speaker1}`);
        if (speaker2) base.push(`- Speaker 2 人設：${speaker2}`);
      }
    }
    if (sanitized) {
      base.push('');
      base.push('【使用者風格要求】');
      base.push(sanitized);
    }
    return base.join('\n');
  }

  if (hostMode === 'dual') {
    const base = [
      '你是逐字稿編修助理。',
      '',
      '任務：根據「全頁逐字稿草稿」，重新潤飾每一頁，產出適合 TTS 朗讀的「雙人 Podcast 對談」逐字稿，由 Speaker 1 與 Speaker 2 輪流對話。',
      '',
      '要求：',
      '1. 使用自然口語對話，不要像書面文章。',
      '2. 每句話盡量短，雙方互有來回、互相提問與回應，不要其中一人長篇獨白。',
      '3. 重要概念前後加入停頓。',
      '4. 加入少量「對」、「沒錯」、「那我們來看」等自然回應與轉場。',
      '5. 避免過度誇張，不要像廣告配音。',
      '6. 語氣自然，像兩位主持人在錄音間聊天討論。',
      '7. 輸出時保留段落換行，方便 TTS 產生停頓。',
      '規則：',
      '1. 必須輸出 JSON：{"pages":[{"page_number":1,"script":"..."}, ...]}，不要其他欄位。',
      '2. pages 的數量與 page_number 必須和輸入完全一致，不可增刪頁。',
      `3. 每頁字數必須控制在 ${bounds.min}～${bounds.max} 字之間（目標和原稿越接近越好）：內容多時優先濃縮挑重點，**不可超過 ${bounds.max} 字上限**；內容偏少時可適度展開、補足語氣與轉場，不要大幅刪減原意，**也不可低於 ${bounds.min} 字下限**。`,
      '4. 可以調整句子銜接與語氣，但不要憑空捏造與投影片無關的新事實。',
      '5. 每頁腳本仍要可獨立朗讀，並在頁與頁之間有連續性。',
      '6. 避免使用「這一頁／本頁／此頁／本張」等單頁指稱，讓整份節目聽感更連續。',
      '7. 每一段都要使用「語氣分段標記 + 講者標籤」格式：[[ 語氣描述 ]]Speaker 1: 對白文字 或 [[ 語氣描述 ]]Speaker 2: 對白文字；每頁至少 2 段，且 Speaker 1 與 Speaker 2 都要出現至少一次。',
    ];
    const sanitized = sanitiseUserPrompt(userPrompt);
    if (sanitized) {
      base.push('');
      base.push('【使用者風格要求】');
      base.push(sanitized);
    }
    return base.join('\n');
  }

  const ttsRewriteRules = [
    '請改寫成適合 TTS 朗讀的逐字稿。',
    '',
    '要求：',
    '1. 使用自然口語，不要像書面文章。',
    '2. 每句話盡量短。',
    '3. 重要概念前後加入停頓。',
    '4. 加入少量「好」、「那我們來看」、「這裡有一個重點」等自然轉場。',
    '5. 避免過度誇張，不要像廣告配音。',
    '6. 語氣像老師在課堂上清楚解釋。',
    '7. 輸出時保留段落換行，方便 TTS 產生停頓。',
  ];

  const base = [
    '你是一位專業的繁體中文簡報旁白編輯。',
    '任務：根據「全頁逐字稿草稿」，重新潤飾每一頁，讓整份簡報聽起來更連貫、自然、有過場。',
    ...ttsRewriteRules,
    '規則：',
    '1. 必須輸出 JSON：{"pages":[{"page_number":1,"script":"..."}, ...]}，不要其他欄位。',
    '2. pages 的數量與 page_number 必須和輸入完全一致，不可增刪頁。',
    `3. 每頁字數必須控制在 ${bounds.min}～${bounds.max} 字之間（目標和原稿越接近越好）：內容多時優先濃縮挑重點，**不可超過 ${bounds.max} 字上限**；內容偏少時可適度展開、補足語氣與轉場，不要大幅刪減原意，**也不可低於 ${bounds.min} 字下限**。`,
    '4. 可以調整句子銜接與語氣，但不要憑空捏造與投影片無關的新事實。',
    '5. 每頁腳本仍要可獨立朗讀，並在頁與頁之間有連續性。',
    '6. 避免使用「這一頁／本頁／此頁／本張」等單頁指稱，讓整份旁白聽感更連續。',
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

async function readExistingScript(
  pdfId: string,
  pageUid: string,
): Promise<string | null> {
  const p = pageScriptPath(pdfId, pageUid);
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
  const { pdfId, pageCount, pages, onPage, userPrompt, shouldAbort } = opts;
  const pageUidRows = db
    .prepare(`SELECT page_number, page_uid FROM pages WHERE pdf_id = ?`)
    .all(pdfId) as Array<{ page_number: number; page_uid: string }>;
  const pageUidByNumber = new Map(pageUidRows.map((r) => [r.page_number, r.page_uid]));
  const uidFor = (pageNumber: number): string => {
    const uid = pageUidByNumber.get(pageNumber);
    if (!uid) throw new Error(`page_uid not found for page ${pageNumber}`);
    return uid;
  };
  const extraSourcesRows = db
    .prepare(
      `SELECT source_kind, source_name, content_text
         FROM pdf_sources
        WHERE pdf_id = ?
        ORDER BY created_at ASC, id ASC`,
    )
    .all(pdfId) as Array<{ source_kind: string; source_name: string | null; content_text: string }>;
  const extraSourcesText = extraSourcesRows
    .map((s, idx) => {
      const kind = (s.source_kind || 'txt').toUpperCase();
      const name = s.source_name?.trim() ? ` (${s.source_name.trim()})` : '';
      const body = clipText(s.content_text || '', 2000);
      return `來源 ${idx + 1} [${kind}]${name}:\n${body}`;
    })
    .filter((x) => x.trim().length > 0)
    .join('\n\n');
  if (pages[0]) {
    const firstScriptPath = pageScriptPath(pdfId, uidFor(pages[0].pageNumber));
    await fs.promises.mkdir(path.dirname(firstScriptPath), { recursive: true });
  }
  const targetChars = opts.maxCharsPerPage ?? config.openaiScriptTargetChars;
  const runtime = getRuntimeAiSettings();
  const hostMode = getPdfHostMode(pdfId);
  const system = buildSystemPrompt(
    userPrompt,
    targetChars,
    runtime.ttsProvider,
    runtime.geminiTtsSpeaker1,
    runtime.geminiTtsSpeaker2,
    runtime.contentLanguage,
    hostMode,
  );
  console.log('System prompt for script generation:\n', system);
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
    if (shouldAbort?.()) {
      const err = new Error('CANCELLED');
      (err as Error & { code?: string }).code = 'CANCELLED';
      throw err;
    }
    const pageInfo = pages[i]!;
    const nextInfo = pages[i + 1];
    const pageStartedAt = new Date().toISOString();

    const existing = await readExistingScript(pdfId, uidFor(pageInfo.pageNumber));
    if (existing) {
      previousScript = existing;
      results.push({
        pageNumber: pageInfo.pageNumber,
        scriptPath: pageScriptPath(pdfId, uidFor(pageInfo.pageNumber)),
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
      const endedAt = new Date().toISOString();
      onPage?.(pageInfo.pageNumber, done, {
        startedAt: pageStartedAt,
        endedAt,
        skipped: true,
        scriptPath: pageScriptPath(pdfId, uidFor(pageInfo.pageNumber)),
      });
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
      extraSourcesText,
    });

    const imageDataUrl = await loadPageImageDataUrl(
      pdfId,
      pageInfo.pageNumber,
      pageInfo.imagePath,
    );

    const userContent: ChatCompletionContentPart[] = [];
    if (imageDataUrl) {
      userContent.push({
        type: 'image_url',
        image_url: { url: imageDataUrl, detail: 'high' },
      });
    }
    userContent.push({ type: 'text', text: userText });

    savePageGenerationPrompt(
      pdfId,
      pageInfo.pageNumber,
      'script',
      `[SYSTEM]\n${system}\n\n[USER]\n${userText}`,
      runtime.openaiLlmModel,
    );

    const label = `script p${pageInfo.pageNumber}/${pageCount}`;
    let lastErr: unknown;
    let success: {
      script: string;
      usage: TokenUsage;
      latencyMs: number;
    } | null = null;

    let delayMs = SCRIPT_RETRY_INITIAL_DELAY_MS;
    for (let attempt = 1; attempt <= SCRIPT_MAX_ATTEMPTS; attempt++) {
      try {
        const { data, usage, latencyMs } = await callChatJSON({
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: userContent },
          ],
          schema: ScriptResponseSchema,
          label,
          maxTokens: 2400,
          temperature: 0.6,
        });
        //const script = ensureToneMarkers(data.script.trim());
        const script = data.script.trim();
        if (!script) {
          throw new Error('LLM returned empty script');
        }
        success = { script, usage, latencyMs };
        break;
      } catch (err) {
        lastErr = err;
        const retryable = isRetryableScriptError(err);
        const hasMore = attempt < SCRIPT_MAX_ATTEMPTS;
        logger.warn(
          {
            pdfId,
            pageNumber: pageInfo.pageNumber,
            attempt,
            retryable,
            hasImage: !!imageDataUrl,
            error: err instanceof Error ? err.message : String(err),
          },
          'generateScript: page attempt failed',
        );

        if (!retryable || !hasMore) {
          break;
        }

        await sleep(delayMs);
        delayMs = Math.min(
          Math.floor(delayMs * SCRIPT_RETRY_FACTOR),
          SCRIPT_RETRY_MAX_DELAY_MS,
        );
      }
    }

    if (!success) {
      logger.error(
        {
          pdfId,
          pageNumber: pageInfo.pageNumber,
          attempts: SCRIPT_MAX_ATTEMPTS,
          error: lastErr instanceof Error ? lastErr.message : String(lastErr),
        },
        'generateScript: page failed after max retries, skipping page',
      );
      previousScript = '';
      done += 1;
      const endedAt = new Date().toISOString();
      onPage?.(pageInfo.pageNumber, done, {
        startedAt: pageStartedAt,
        endedAt,
        skipped: true,
        scriptPath: pageScriptPath(pdfId, uidFor(pageInfo.pageNumber)),
      });
      continue;
    }

    const { script, usage, latencyMs } = success;
    const scriptPath = pageScriptPath(pdfId, uidFor(pageInfo.pageNumber));
    await writeUtf8Ensured(scriptPath, script);
    const relScript = scriptPath.replace(pdfDir(pdfId) + '/', '');
    void commitPresentationFile(pdfId, relScript, `script: generate page ${pageInfo.pageNumber}`);

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
    onPage?.(pageInfo.pageNumber, done, {
      startedAt: pageStartedAt,
      endedAt: new Date().toISOString(),
      skipped: false,
      scriptPath,
    });
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

  // Second pass: rewrite scripts for cross-page continuity.
  // When rewriteContextPages is provided, merge them with the newly generated
  // scripts so the rewrite sees surrounding pages — but only write back the
  // pages that were actually generated in this call.
  const newPageNumbers = new Set(results.map((r) => r.pageNumber));
  const contextPages = opts.rewriteContextPages ?? [];
  const allForRewrite: Array<{ pageNumber: number; script: string }> = [
    ...contextPages.filter((c) => !newPageNumbers.has(c.pageNumber)),
    ...results.map((r) => ({ pageNumber: r.pageNumber, script: r.script })),
  ].sort((a, b) => a.pageNumber - b.pageNumber);

  const rewriteLabel = `script-rewrite deck/${pageCount}`;
  try {
    const { data, usage, latencyMs } = await callChatJSON({
      messages: [
        { role: 'system', content: buildDeckRewriteSystemPrompt(userPrompt, targetChars, hostMode) },
        {
          role: 'user',
          content: buildDeckRewriteUserText(
            pageCount,
            allForRewrite,
          ),
        },
      ],
      schema: ScriptDeckRewriteSchema,
      label: rewriteLabel,
      maxTokens: Math.max(1200, allForRewrite.length * 260),
      temperature: 0.5,
    });

    const byPage = new Map<number, string>();
    for (const p of data.pages) {
      byPage.set(p.page_number, p.script.trim());
    }

    // Only write back scripts for pages that were generated in this call
    for (const r of results) {
      const rewritten = byPage.get(r.pageNumber)?.trim() ?? '';
      if (!rewritten) continue;
      await writeUtf8Ensured(r.scriptPath, rewritten);
      r.script = rewritten;
      r.chars = rewritten.length;
      r.generatedAt = new Date().toISOString();
      r.skipped = false;
      const relScript = r.scriptPath.replace(pdfDir(pdfId) + '/', '');
      void commitPresentationFile(pdfId, relScript, `script: rewrite page ${r.pageNumber}`);
    }

    totalUsage.prompt_tokens += usage.prompt_tokens;
    totalUsage.completion_tokens += usage.completion_tokens;
    totalUsage.total_tokens += usage.total_tokens;

    logger.info(
      { pdfId, pageCount, latencyMs, usage, contextPageCount: contextPages.length },
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
  const pageUidRows = db
    .prepare(`SELECT page_number, page_uid FROM pages WHERE pdf_id = ? ORDER BY page_number ASC`)
    .all(pdfId) as Array<{ page_number: number; page_uid: string }>;
  const out: Array<{ pageNumber: number; script: string }> = [];
  for (const { page_number: n, page_uid: uid } of pageUidRows) {
    if (n > pageCount) continue;
    try {
      const content = await fs.promises.readFile(
        pageScriptPath(pdfId, uid),
        'utf8',
      );
      out.push({ pageNumber: n, script: content.trim() });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }
  return out;
}
