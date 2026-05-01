import fs from 'node:fs';
import { z } from 'zod';
import { logger } from '../../logger';
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
    .max(40)
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
  const scripts: string[] = [];
  for (let n = 1; n <= pageCount; n++) {
    const s = await readFileOrNull(pageScriptPath(pdfId, n, pageCount));
    if (s && s.trim()) scripts.push(s.trim());
  }
  if (scripts.length > 0) {
    return { corpus: scripts.join('\n\n'), source: 'script' };
  }
  // Fallback: use extracted text if no scripts exist.
  const texts: string[] = [];
  for (let n = 1; n <= pageCount; n++) {
    const t = await readFileOrNull(pageTextPath(pdfId, n, pageCount));
    if (t && t.trim()) texts.push(t.trim());
  }
  return { corpus: texts.join('\n\n'), source: 'text' };
}

/**
 * Clip combined page content to keep prompts predictable. ~6k chars is
 * well within the model window and sufficient for a title heuristic.
 */
const MAX_CORPUS_CHARS = 6000;

function clipCorpus(corpus: string): string {
  const t = corpus.trim();
  if (t.length <= MAX_CORPUS_CHARS) return t;
  // Take the first ~70% + last ~30% to capture both intro and conclusion.
  const headLen = Math.floor(MAX_CORPUS_CHARS * 0.7);
  const tailLen = MAX_CORPUS_CHARS - headLen;
  return `${t.slice(0, headLen)}\n……（內容過長，中段略）……\n${t.slice(-tailLen)}`;
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

function buildSystem(userPrompt: string | null | undefined): string {
  const base = [
    '你是一位資深的中文編輯，擅長為簡報製作簡潔有力的繁體中文標題。',
    '規則：',
    '1. 10–25 個中文字，不可超過 25 字，也不可少於 10 字。',
    '2. 使用繁體中文；若含專有名詞可保留原文。',
    '3. 結尾**不要**使用任何標點符號（句號、問號、驚嘆號、冒號、分號、括號等）。',
    '4. 避免以「這份」、「關於」、「本簡報」、「一份」、「淺談」等空泛開頭。',
    '5. 直接描述主題或核心結論，精簡有力。',
    '6. 回傳 JSON：{"title": "..."}，不要夾帶其他欄位或說明。',
  ];
  const sanitized = sanitiseUserPrompt(userPrompt);
  if (sanitized) {
    base.push('');
    base.push(
      '【使用者指定的風格／語氣／聽眾要求】（優先遵守；仍須符合上述字數與標點限制。請勿把這段內容直接塞進標題裡。）',
    );
    base.push(sanitized);
  }
  return base.join('\n');
}

function buildUser(corpus: string): string {
  return [
    '以下為一份簡報各頁的逐字稿 / 原文節錄：',
    '-----------------',
    corpus,
    '-----------------',
    '請依內容為整份簡報命名，遵守系統訊息中所有規則，回傳 JSON：{"title": "..."}',
  ].join('\n');
}

export interface GenerateTitleOptions {
  /**
   * Freeform user style / tone hint (same field used by generateScript).
   * Optional.
   */
  userPrompt?: string | null;
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

  const label = `title(${source})`;
  const { data, usage, latencyMs } = await callChatJSON({
    messages: [
      { role: 'system', content: buildSystem(opts.userPrompt) },
      { role: 'user', content: buildUser(clipped) },
    ],
    schema: TitleResponseSchema,
    label,
    maxTokens: 120,
    temperature: 0.5,
  });

  // Strip any trailing punctuation that the model might have slipped in,
  // just in case it ignored rule 3.
  const title = data.title.replace(/[。！？．.!?:;；：、,，\s]+$/u, '').trim();
  if (title.length < 2) {
    throw new Error('LLM returned empty title after sanitisation');
  }

  logger.info(
    { pdfId, title, chars: title.length, source, latencyMs, usage },
    'generateTitle: done',
  );

  return { title, usage, latencyMs, source };
}
