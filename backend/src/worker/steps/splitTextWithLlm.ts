import { z } from 'zod';
import { callChatJSON, type TokenUsage } from '../../services/openai';
import { logger } from '../../logger';
import { containsPdfPageMarkers, stripPdfPageMarkers } from '../../services/pdfPageMarkers';

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

/* ------------------------------------------------------------------ */
/*  Phase-1: 全文大綱產生（類似 YouTube buildYoutubeOutlineAsSlideText） */
/* ------------------------------------------------------------------ */

const OutlineSchema = z.object({
  slides: z
    .array(
      z.object({
        title: z.string().min(1),
        bullets: z.array(z.string().min(1)).min(2).max(6),
        // Only populated when the input text contains [[PDF_PAGE_N]] markers:
        // which original PDF page(s) this slide's content is drawn from.
        source_pages: z.array(z.number().int().positive()).max(10).optional(),
      }),
    )
    .min(3)
    .max(20),
});

/**
 * 全文大綱上限：超過此字數的全文會先截取再送 LLM。
 * 與 YouTube outline 的 16 000 字上限一致。
 */
const OUTLINE_MAX_INPUT_CHARS = 16_000;

/**
 * 當原文長度 ≥ 此門檻時，啟用「先產生大綱 → 再按 Slide 標記切分」的
 * 兩階段流程，確保全局視野。短文直接走 LLM chunk 分頁即可。
 */
const OUTLINE_THRESHOLD_CHARS = 800;

/**
 * 把全文送 LLM，產生一份結構化的簡報大綱（標題 + 重點），
 * 再轉成 `Slide N: 標題\n- 重點1\n- 重點2` 的純文字格式，
 * 讓下游 `splitBySlideMarkers()` 可以直接解析。
 *
 * 回傳 `null` 表示 LLM 呼叫失敗，呼叫端應 fallback 到舊的 chunk 流程。
 */
async function buildOutlineFromFullText(
  fullText: string,
): Promise<{
  outlineText: string;
  usage: TokenUsage;
  /** One entry per non-empty slide in `outlineText`, in the same order. */
  slides: Array<{ title: string; bullets: string[]; sourcePdfPages?: number[] }>;
} | null> {
  const input =
    fullText.length > OUTLINE_MAX_INPUT_CHARS
      ? fullText.slice(0, OUTLINE_MAX_INPUT_CHARS)
      : fullText;
  const hasPageMarkers = containsPdfPageMarkers(input);

  const system = [
    '你是簡報大綱助理。',
    '請根據以下全文內容，整理成一份投影片大綱。',
    '務必先通讀全文、理解整體脈絡，再規劃大綱結構。',
    '大綱需有邏輯順序（背景 → 方法/機制 → 結果/結論），必要時可重排內容。',
    '每頁需有一個標題與 2~6 點重點，放在 bullets 陣列之中。',
    '每一頁大綱重點要精簡、可讀、避免逐字轉錄。',
    ...(hasPageMarkers
      ? [
          '原文中包含形如 [[PDF_PAGE_N]] 的標記，代表後續內容出自原始 PDF 第 N 頁。',
          '請針對每張投影片，於 source_pages 陣列中列出其內容主要參考自哪些原始頁碼（整數，可有多個）。',
          '絕對不要把 [[PDF_PAGE_N]] 標記文字寫入 title 或 bullets 之中。',
        ]
      : []),
    '務必輸出結構化 JSON，不要輸出 markdown。',
  ].join('\n');

  const user = [
    '請根據以下全文產生投影片大綱。',
    '需儘量涵蓋全文重要內容，但要去蕪存菁。',
    '每頁需有標題與 2~6 點重點。',
    '',
    '全文內容如下：',
    input,
  ].join('\n');

  try {
    const r = await callChatJSON({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      schema: OutlineSchema,
      maxTokens: 6400,
      temperature: 0.4,
      label: 'pdf-fulltext-outline',
    });

    logger.info(
      {
        inputChars: input.length,
        slides: r.data.slides.length,
        outlineJsonPretty: JSON.stringify(r.data, null, 2),
      },
      'buildOutlineFromFullText: LLM outline generated',
    );

    // 轉成 Slide 標記格式
    const lines: string[] = [];
    const slides: Array<{ title: string; bullets: string[]; sourcePdfPages?: number[] }> = [];
    r.data.slides.forEach((s) => {
      const bullets = s.bullets
        .map((t) => t.trim())
        .filter((t) => t.length > 0);
      if (bullets.length === 0) return;
      const title = s.title.trim();
      const sourcePdfPages = s.source_pages?.length
        ? Array.from(new Set(s.source_pages)).sort((a, b) => a - b)
        : undefined;
      slides.push({ title, bullets, sourcePdfPages });
      lines.push(`Slide ${slides.length}: ${title}`);
      for (const b of bullets) lines.push(`- ${b}`);
      lines.push('');
    });
    const rendered = lines.join('\n').trim();

    if (!rendered) {
      logger.warn('buildOutlineFromFullText: LLM returned empty outline');
      return null;
    }

    return { outlineText: rendered, usage: r.usage, slides };
  } catch (err) {
    logger.warn(
      { error: err instanceof Error ? err.message : String(err) },
      'buildOutlineFromFullText: LLM call failed, will fallback to chunk split',
    );
    return null;
  }
}

export interface SplitTextWithLlmResult {
  pages: Array<{ pageNumber: number; content: string; slideLabel?: string; sourcePdfPages?: number[] }>;
  usage: TokenUsage;
}

export function splitBySlideMarkers(rawText: string): Array<{ pageNumber: number; content: string; slideLabel?: string }> {
  // Normalize newlines + full-width hash so variants like "＃Slide 1" work.
  const text = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/＃/g, '#');
  const lines = text.split('\n');
  // Accept marker variants:
  // - Slide 1
  // - #Slide 1
  // - ## Slide 1: title
  // - #Slide: title (without numeric index)
  const markerRe = /^\s*(?:#{1,6}\s*)?slide\b\s*(?:(\d{1,4}))?\s*[:：-]?\s*(.*)$/i;
  const starts: Array<{ idx: number; label: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const m = markerRe.exec(line.trim());
    if (m) {
      const n = (m[1] ?? '').trim();
      const title = (m[2] ?? '').trim();
      const label = n
        ? `Slide ${n}`
        : title
          ? `Slide ${title.slice(0, 24)}`
          : `Slide ${starts.length + 1}`;
      starts.push({ idx: i, label });
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
    '你是「簡報大綱生成助理」，不是逐字切頁器。',
    '請先理解全文重點，再重組成可講解的投影片大綱頁。',
    '每頁應包含：一句標題 + 3~5 個重點短句（可用條列或短段）。',
    '禁止逐字抄錄原文、禁止只做機械切段。',
    '內容要去蕪存菁，保留關鍵名詞、關鍵數字、因果與流程。',
    '每頁約 90~220 字，以「可口語講解」為主。',
    '只回傳 JSON：{"pages":[{"page_number":1,"content":"..."}]}',
  ].join('\n');

  const user = [
    '請把以下全文改寫成簡報大綱頁。',
    '輸出頁面要有邏輯順序（背景 → 方法/機制 → 結果/結論），必要時可重排內容。',
    '每頁 content 建議格式：',
    '標題：...\\n- 重點 1\\n- 重點 2\\n- 重點 3',
    '',
    chunk,
  ].join('\n');
  const result = await callChatJSON({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    schema: SplitSchema,
    maxTokens: 4800,
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

async function splitTextWithLlmCore(rawText: string): Promise<SplitTextWithLlmResult> {
  const text = rawText.trim();
  if (!text) {
    return {
      pages: [{ pageNumber: 1, content: '' }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    };
  }

  // Strategy 1: 原文已含 Slide 標記 → 直接切分
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

  // Strategy 2: 全文大綱流程 — 先用 LLM 看全文產生整體大綱，
  // 再用 Slide 標記格式切分。確保全局視野，避免 chunk 獨立處理
  // 導致缺乏整體脈絡。
  if (text.length >= OUTLINE_THRESHOLD_CHARS) {
    logger.info(
      {
        strategy: 'text-outline-then-split',
        inputChars: text.length,
      },
      'Text split strategy: attempting outline-first approach',
    );
    const outlineResult = await buildOutlineFromFullText(text);
    if (outlineResult) {
      const outlinePages = splitBySlideMarkers(outlineResult.outlineText);
      if (outlinePages.length > 0) {
        logger.info(
          {
            strategy: 'text-outline-then-split',
            pages: outlinePages.length,
            outlineUsage: outlineResult.usage,
          },
          'Text split strategy: outline-first succeeded',
        );
        return {
          pages: outlinePages.map((p, idx) => ({
            ...p,
            sourcePdfPages: outlineResult.slides[idx]?.sourcePdfPages,
          })),
          usage: outlineResult.usage,
        };
      }
      logger.warn(
        'Text split: outline produced but splitBySlideMarkers found no slides, falling back to chunk split',
      );
    }
    // outlineResult === null → LLM 失敗，fallback 到 chunk 流程
  }

  // Strategy 3 (fallback): 按 chunk 獨立送 LLM 分頁
  const chunks = chunkText(text);
  const merged: Array<{ pageNumber: number; content: string }> = [];
  let usage: TokenUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  try {
    logger.info(
      {
        strategy: 'text-llm-chunked',
        chunks: chunks.length,
      },
      'Text split strategy: llm-chunked (fallback)',
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

/**
 * Splits raw source text into slide pages. `rawText` may contain
 * `[[PDF_PAGE_N]]` markers (see `pdfPageMarkers`) for document-mode PDF
 * imports - any markers that leak into the final page content (e.g. via the
 * slide-marker-direct or chunked fallback strategies, which copy from the
 * input) are stripped before returning.
 */
export async function splitTextWithLlm(rawText: string): Promise<SplitTextWithLlmResult> {
  const result = await splitTextWithLlmCore(rawText);
  return {
    ...result,
    pages: result.pages.map((p) => ({ ...p, content: stripPdfPageMarkers(p.content) })),
  };
}
