import fs from 'node:fs';
import { z } from 'zod';
import { logger } from '../../logger';
import { db } from '../../db';
import { type AppLanguage, getRuntimeAiSettings } from '../../services/aiSettings';
import { callChatJSON, type TokenUsage } from '../../services/openai';
import { pageScriptPath, pageTextPath } from '../../services/storage';

export interface GenerateTitleResult {
  title: string;
  usage: TokenUsage;
  latencyMs: number;
  source: 'script' | 'text';
}

const TitleResponseSchema = z.object({
  title: z
    .string()
    .min(2)
    .max(60)
    .transform((s) => s.trim()),
});

async function readFileOrNull(path: string): Promise<string | null> {
  try {
    return await fs.promises.readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

async function collectCorpus(
  pdfId: string,
  pageCount: number,
): Promise<{ corpus: string; source: 'script' | 'text' }> {
  const pageUidRows = db
    .prepare(`SELECT page_number, page_uid FROM pages WHERE pdf_id = ? AND page_number <= ? ORDER BY page_number ASC`)
    .all(pdfId, pageCount) as Array<{ page_number: number; page_uid: string }>;

  const scripts: string[] = [];
  for (const { page_uid: uid } of pageUidRows) {
    const s = await readFileOrNull(pageScriptPath(pdfId, uid));
    if (s && s.trim()) scripts.push(s.trim());
  }
  if (scripts.length > 0) {
    return { corpus: scripts.join('\n\n'), source: 'script' };
  }
  // Fallback: use extracted text if no scripts exist.
  const texts: string[] = [];
  for (const { page_uid: uid } of pageUidRows) {
    const t = await readFileOrNull(pageTextPath(pdfId, uid));
    if (t && t.trim()) texts.push(t.trim());
  }
  return { corpus: texts.join('\n\n'), source: 'text' };
}

/**
 * Clip combined page content to keep prompts predictable. ~6k chars is
 * well within the model window and sufficient for a title heuristic.
 */
const MAX_CORPUS_CHARS = 6000;

export function clipCorpus(corpus: string): string {
  const t = corpus.trim();
  if (t.length <= MAX_CORPUS_CHARS) return t;
  // Take the first ~70% + last ~30% to capture both intro and conclusion.
  const headLen = Math.floor(MAX_CORPUS_CHARS * 0.7);
  const tailLen = MAX_CORPUS_CHARS - headLen;
  return `${t.slice(0, headLen)}\n……（內容過長，中段略）……\n${t.slice(-tailLen)}`;
}

const MAX_USER_PROMPT_CHARS_IN_SYSTEM = 2000;

export function sanitiseUserPrompt(raw: string | null | undefined): string {
  if (!raw) return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  return trimmed.length > MAX_USER_PROMPT_CHARS_IN_SYSTEM
    ? trimmed.slice(0, MAX_USER_PROMPT_CHARS_IN_SYSTEM) + '……（已截斷）'
    : trimmed;
}

export function buildSystem(userPrompt: string | null | undefined, contentLanguage: AppLanguage): string {
  const base = contentLanguage === 'en'
    ? [
        'You are a senior English editor who creates concise, compelling titles for slide decks.',
        'Rules:',
        '1. Write the title in English, even if the source content or user prompt is Chinese; translate and summarize naturally.',
        '2. Use 4–12 English words, no more than 60 characters.',
        '3. Do not end with punctuation of any kind (period, question mark, exclamation mark, colon, semicolon, parentheses, etc.).',
        '4. Avoid vague openings such as "This", "About", "A", "An", "The", "Introduction to", or "Overview of".',
        '5. Describe the topic or core conclusion directly and powerfully.',
        '6. Return JSON: {"title": "..."}; do not include any other fields or explanations.',
      ]
    : [
        '你是一位資深的中文編輯，擅長為簡報製作簡潔有力的繁體中文標題。',
        '規則：',
        '1. 使用繁體中文產生標題；即使來源內容或使用者提示是英文，也要翻譯並自然整理成繁體中文。',
        '2. 10–25 個中文字，不可超過 25 字，也不可少於 10 字。',
        '3. 若含專有名詞可保留原文。',
        '4. 結尾**不要**使用任何標點符號（句號、問號、驚嘆號、冒號、分號、括號等）。',
        '5. 避免以「這份」、「關於」、「本簡報」、「一份」、「淺談」等空泛開頭。',
        '6. 直接描述主題或核心結論，精簡有力。',
        '7. 回傳 JSON：{"title": "..."}，不要夾帶其他欄位或說明。',
      ];
  const sanitized = sanitiseUserPrompt(userPrompt);
  if (sanitized) {
    base.push('');
    base.push(contentLanguage === 'en'
      ? '[User-specified style / tone / audience requirements] (Follow these with priority while still obeying the language, length, and punctuation rules above. Do not copy this text directly into the title.)'
      : '【使用者指定的風格／語氣／聽眾要求】（優先遵守；仍須符合上述語言、字數與標點限制。請勿把這段內容直接塞進標題裡。）');
    base.push(sanitized);
  }
  return base.join('\n');
}

export function buildUser(corpus: string, contentLanguage: AppLanguage): string {
  if (contentLanguage === 'en') {
    return [
      'Below are transcript / source excerpts from each page of a slide deck:',
      '-----------------',
      corpus,
      '-----------------',
      'Name the whole slide deck in English based on the content. Follow every rule in the system message and return JSON: {"title": "..."}',
    ].join('\n');
  }
  return [
    '以下為一份簡報各頁的逐字稿 / 原文節錄：',
    '-----------------',
    corpus,
    '-----------------',
    '請依內容為整份簡報命名，遵守系統訊息中所有規則，並以繁體中文回傳 JSON：{"title": "..."}',
  ].join('\n');
}

export interface GenerateTitleOptions {
  /**
   * Freeform user style / tone hint (same field used by generateScript).
   * Optional.
   */
  userPrompt?: string | null;
  /**
   * Target language for generated content. Defaults to runtime AI settings.
   */
  contentLanguage?: AppLanguage;
}

/**
 * Invoke the LLM once to propose a concise Traditional Chinese title for the
 * whole deck. **Non-fatal**: callers should treat any thrown error as a
 * warning and keep the existing title.
 */
export async function generateTitle(
  pdfId: string,
  pageCount: number,
  opts: GenerateTitleOptions = {},
): Promise<GenerateTitleResult> {
  const { corpus, source } = await collectCorpus(pdfId, pageCount);
  if (!corpus.trim()) {
    throw new Error('No script/text content available for title generation');
  }
  const clipped = clipCorpus(corpus);
  const contentLanguage = opts.contentLanguage ?? getRuntimeAiSettings().contentLanguage;

  const label = `title(${source})`;
  const { data, usage, latencyMs } = await callChatJSON({
    messages: [
      { role: 'system', content: buildSystem(opts.userPrompt, contentLanguage) },
      { role: 'user', content: buildUser(clipped, contentLanguage) },
    ],
    schema: TitleResponseSchema,
    label,
    maxTokens: 3200,
    temperature: 0.5,
  });

  // Strip any trailing punctuation that the model might have slipped in,
  // just in case it ignored rule 3.
  const title = data.title.replace(/[。！？．.!?:;；：、,，\s]+$/u, '').trim();
  if (title.length < 2) {
    throw new Error('LLM returned empty title after sanitisation');
  }

  logger.info(
    { pdfId, title, chars: title.length, source, contentLanguage, latencyMs, usage },
    'generateTitle: done',
  );

  return { title, usage, latencyMs, source };
}
