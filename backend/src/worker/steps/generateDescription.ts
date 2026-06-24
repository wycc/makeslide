import fs from 'node:fs';
import { z } from 'zod';
import { logger } from '../../logger';
import { db } from '../../db';
import { type AppLanguage, getRuntimeAiSettings } from '../../services/aiSettings';
import { callChatJSON, type TokenUsage } from '../../services/openai';
import { pageScriptPath, pageTextPath } from '../../services/storage';

export interface GenerateDescriptionResult {
  description: string;
  usage: TokenUsage;
  latencyMs: number;
  source: 'script' | 'text';
}

const DescriptionResponseSchema = z.object({
  description: z
    .string()
    .min(2)
    .max(400)
    .transform((s) => s.trim()),
});

// Only the first few pages are needed to summarise what a deck is about.
const MAX_PAGES = 3;
const MAX_CORPUS_CHARS = 4000;

async function readFileOrNull(path: string): Promise<string | null> {
  try {
    return await fs.promises.readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

async function collectFirstPagesCorpus(
  pdfId: string,
): Promise<{ corpus: string; source: 'script' | 'text' }> {
  const pageUidRows = db
    .prepare(`SELECT page_number, page_uid FROM pages WHERE pdf_id = ? ORDER BY page_number ASC LIMIT ?`)
    .all(pdfId, MAX_PAGES) as Array<{ page_number: number; page_uid: string }>;

  const scripts: string[] = [];
  for (const { page_uid: uid } of pageUidRows) {
    const s = await readFileOrNull(pageScriptPath(pdfId, uid));
    if (s && s.trim()) scripts.push(s.trim());
  }
  if (scripts.length > 0) {
    return { corpus: scripts.join('\n\n').slice(0, MAX_CORPUS_CHARS), source: 'script' };
  }
  const texts: string[] = [];
  for (const { page_uid: uid } of pageUidRows) {
    const t = await readFileOrNull(pageTextPath(pdfId, uid));
    if (t && t.trim()) texts.push(t.trim());
  }
  return { corpus: texts.join('\n\n').slice(0, MAX_CORPUS_CHARS), source: 'text' };
}

export function buildDescriptionSystem(contentLanguage: AppLanguage): string {
  return contentLanguage === 'en'
    ? [
        'You write concise summaries that describe what a slide deck is about.',
        'Rules:',
        '1. Write 2–3 sentences in English (translate if the source is Chinese).',
        '2. Describe the topic and who it is for; do not invent facts.',
        '3. Return JSON: {"description": "..."}; no other fields.',
      ].join('\n')
    : [
        '你會為簡報撰寫精簡的內容簡介。',
        '規則：',
        '1. 以繁體中文寫 2–3 句（來源若為英文也要翻譯整理）。',
        '2. 說明主題與適合對象，不要捏造未提及的內容。',
        '3. 回傳 JSON：{"description": "..."}，不要夾帶其他欄位。',
      ].join('\n');
}

export function buildDescriptionUser(corpus: string, contentLanguage: AppLanguage): string {
  return contentLanguage === 'en'
    ? [
        'Below are transcript excerpts from the first pages of a slide deck:',
        '-----------------',
        corpus,
        '-----------------',
        'Summarise what the whole deck is about and return JSON: {"description": "..."}',
      ].join('\n')
    : [
        '以下為一份簡報前幾頁的逐字稿節錄：',
        '-----------------',
        corpus,
        '-----------------',
        '請以繁體中文摘要整份簡報的主題，回傳 JSON：{"description": "..."}',
      ].join('\n');
}

export interface GenerateDescriptionOptions {
  contentLanguage?: AppLanguage;
}

/**
 * Invoke the LLM once to propose a 2–3 sentence summary of the deck, drawn from
 * the first few pages. Throws when there is no content to summarise; callers
 * should treat any thrown error as non-fatal.
 */
export async function generateDescription(
  pdfId: string,
  opts: GenerateDescriptionOptions = {},
): Promise<GenerateDescriptionResult> {
  const { corpus, source } = await collectFirstPagesCorpus(pdfId);
  if (!corpus.trim()) {
    throw new Error('No script/text content available for description generation');
  }
  const contentLanguage = opts.contentLanguage ?? getRuntimeAiSettings().contentLanguage;

  const { data, usage, latencyMs } = await callChatJSON({
    messages: [
      { role: 'system', content: buildDescriptionSystem(contentLanguage) },
      { role: 'user', content: buildDescriptionUser(corpus, contentLanguage) },
    ],
    schema: DescriptionResponseSchema,
    label: `description(${source})`,
    maxTokens: 600,
    temperature: 0.5,
  });

  const description = data.description.trim();
  if (description.length < 2) {
    throw new Error('LLM returned empty description');
  }

  logger.info({ pdfId, chars: description.length, source, contentLanguage, latencyMs, usage }, 'generateDescription: done');
  return { description, usage, latencyMs, source };
}
