import { z } from 'zod';
import { callChatJSON, type TokenUsage } from '../../services/openai';
import { logger } from '../../logger';

const SplitSchema = z.object({
  pages: z
    .array(
      z.object({
        page_number: z.number().int().positive(),
        content: z.string().min(1),
      }),
    )
    .min(1),
});

export interface SplitTextWithLlmResult {
  pages: Array<{ pageNumber: number; content: string; slideLabel?: string }>;
  usage: TokenUsage;
}

export function splitBySlideMarkers(rawText: string): Array<{ pageNumber: number; content: string; slideLabel?: string }> {
  const text = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = text.split('\n');
  const markerRe = /^\s*(?:#{1,6}\s*)?slide\s*(\d{1,4})\s*[:：-]?\s*(.*)$/i;
  const starts: Array<{ idx: number; label: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const m = markerRe.exec(line.trim());
    if (m) {
      const n = m[1];
      starts.push({ idx: i, label: `Slide ${n}` });
    }
  }
  if (starts.length === 0) return [];

  const out: Array<{ pageNumber: number; content: string; slideLabel?: string }> = [];
  for (let i = 0; i < starts.length; i++) {
    const s = starts[i];
    if (!s) continue;
    const e = starts[i + 1]?.idx ?? lines.length;
    const block = lines.slice(s.idx, e).join('\n').trim();
    if (!block) continue;
    out.push({ pageNumber: out.length + 1, content: block, slideLabel: s.label });
  }
  return out;
}

const LOCAL_TARGET_CHARS = 220;
const LLM_CHUNK_CHARS = 1800;

function localSplit(text: string, targetChars: number = LOCAL_TARGET_CHARS): string[] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!normalized) return [''];
  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const pages: string[] = [];
  let buf = '';
  for (const p of paragraphs) {
    if (!buf) {
      buf = p;
      continue;
    }
    if (buf.length + 2 + p.length <= targetChars) {
      buf += `\n\n${p}`;
      continue;
    }
    pages.push(buf);
    buf = p;
  }
  if (buf) pages.push(buf);
  return pages.length > 0 ? pages : [''];
}

function chunkText(text: string, chunkSize: number = LLM_CHUNK_CHARS): string[] {
  if (text.length <= chunkSize) return [text];
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + chunkSize, text.length);
    if (end < text.length) {
      const nl = text.lastIndexOf('\n', end);
      if (nl > start + 200) end = nl;
    }
    chunks.push(text.slice(start, end).trim());
    start = end;
  }
  return chunks.filter((c) => c.length > 0);
}

async function splitChunkWithLlm(chunk: string): Promise<SplitTextWithLlmResult> {
  const system = [
    '你是簡報分頁助理。',
    '請把輸入文字切成適合簡報逐頁講解的段落。',
    '每頁約 120~260 字，盡量保持語意完整，不要切斷句。',
    '只回傳 JSON：{"pages":[{"page_number":1,"content":"..."}]}',
  ].join('\n');

  const user = `請將以下文字分頁：\n\n${chunk}`;
  const result = await callChatJSON({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    schema: SplitSchema,
    maxTokens: 1200,
    temperature: 0.3,
    label: 'split-text-with-llm',
  });

  const pages = result.data.pages
    .sort((a, b) => a.page_number - b.page_number)
    .map((p, idx) => ({ pageNumber: idx + 1, content: p.content.trim() }));
  return { pages, usage: result.usage };
}

async function splitChunkRobust(chunk: string): Promise<SplitTextWithLlmResult> {
  try {
    return await splitChunkWithLlm(chunk);
  } catch {
    // If one chunk still fails (e.g. empty JSON), bisect and retry recursively.
    if (chunk.length < 500) {
      const local = localSplit(chunk).map((content, idx) => ({
        pageNumber: idx + 1,
        content,
      }));
      return {
        pages: local,
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      };
    }
    const mid = Math.floor(chunk.length / 2);
    const left = chunk.slice(0, mid).trim();
    const right = chunk.slice(mid).trim();
    const a = await splitChunkRobust(left);
    const b = await splitChunkRobust(right);
    return {
      pages: [
        ...a.pages,
        ...b.pages.map((p, idx) => ({ pageNumber: a.pages.length + idx + 1, content: p.content })),
      ],
      usage: {
        prompt_tokens: a.usage.prompt_tokens + b.usage.prompt_tokens,
        completion_tokens: a.usage.completion_tokens + b.usage.completion_tokens,
        total_tokens: a.usage.total_tokens + b.usage.total_tokens,
      },
    };
  }
}

export async function splitTextWithLlm(rawText: string): Promise<SplitTextWithLlmResult> {
  const text = rawText.trim();
  if (!text) {
    return {
      pages: [{ pageNumber: 1, content: '' }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    };
  }

  const slidePages = splitBySlideMarkers(text);
  if (slidePages.length > 0) {
    logger.info(
      {
        strategy: 'text-slide-marker-direct',
        marker: 'Slide ##',
        pages: slidePages.length,
      },
      'Text split strategy: slide-marker-direct',
    );
    return {
      pages: slidePages,
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    };
  }

  const chunks = chunkText(text);
  const merged: Array<{ pageNumber: number; content: string }> = [];
  let usage: TokenUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  try {
    logger.info(
      {
        strategy: 'text-llm-chunked',
        chunks: chunks.length,
      },
      'Text split strategy: llm-chunked',
    );
    for (const chunk of chunks) {
      const part = await splitChunkRobust(chunk);
      usage = {
        prompt_tokens: usage.prompt_tokens + part.usage.prompt_tokens,
        completion_tokens: usage.completion_tokens + part.usage.completion_tokens,
        total_tokens: usage.total_tokens + part.usage.total_tokens,
      };
      for (const p of part.pages) {
        merged.push({ pageNumber: merged.length + 1, content: p.content });
      }
    }
    return { pages: merged, usage };
  } catch {
    const fallbackPages = localSplit(text).map((content, idx) => ({
      pageNumber: idx + 1,
      content,
    }));
    return {
      pages: fallbackPages,
      usage,
    };
  }
}
