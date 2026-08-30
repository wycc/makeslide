import { z } from 'zod';
import { callChatJSON, type TokenUsage } from '../../services/openai';
import { logger } from '../../logger';
import { containsPdfPageMarkers, splitByPdfPageMarkers, stripPdfPageMarkers } from '../../services/pdfPageMarkers';
import { isMinimalSlideStyleRequested } from './generateScript';
import { getRuntimeAiSettings } from '../../services/aiSettings';
import { outlineLanguageRule } from '../../services/contentLanguage';

/**
 * 每頁原文要產生幾張投影片：範圍的下界與上界。實測一篇 39 頁的論文，模型
 * 自行規劃出 22~23 張，落在這個比例中間。
 */
const SLIDES_PER_SOURCE_PAGE_MIN = 0.5;
const SLIDES_PER_SOURCE_PAGE_MAX = 1;

/**
 * 投影片張數的絕對上下限。上限同時是 schema 的硬性上限：它只負責攔下失控的
 * 輸出，實際張數由提示詞裡的範圍引導——schema 的 `.max()` 是全有全無的，
 * 拿它來表達「希望大約幾張」會讓只超出兩三張的完整大綱被整份丟棄。
 */
const MIN_SLIDES = 3;
const MAX_SLIDES = 60;

/** 每張投影片預留的輸出 token 數，用來依張數範圍推算 `maxTokens`。 */
const TOKENS_PER_SLIDE = 340;
const MIN_OUTLINE_MAX_TOKENS = 6_400;
const MAX_OUTLINE_MAX_TOKENS = 16_000;

/**
 * 沒有 `[[PDF_PAGE_N]]` 標記時（純文字匯入、YouTube 字幕），用來把字元數換算
 * 成「等效原文頁數」的密度。取自實測：39 頁的 arXiv 論文抽出約 11 萬字元。
 */
const CHARS_PER_SOURCE_PAGE = 2_800;

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/**
 * 估算一段原文相當於幾頁：優先數 `[[PDF_PAGE_N]]` 標記，沒有標記才用字元數
 * 換算。`chunkText()` 會沿頁邊界切分，所以單一 chunk 也能問出自己的頁數。
 */
export function estimateSourcePageCount(text: string): number {
  const pages = splitByPdfPageMarkers(text);
  if (pages.length > 0) return pages.length;
  return Math.max(1, Math.round(text.length / CHARS_PER_SOURCE_PAGE));
}

/**
 * 依原文頁數換算出要產生的投影片張數範圍。給範圍而不是單一數字，是為了讓
 * 模型按內容密度自己拿捏——原文有多少頁，投影片就該大致是那個量級。
 */
export function slideCountRangeForSourcePages(sourcePages: number): { min: number; max: number } {
  const min = clamp(Math.round(sourcePages * SLIDES_PER_SOURCE_PAGE_MIN), MIN_SLIDES, MAX_SLIDES - 2);
  const max = clamp(Math.round(sourcePages * SLIDES_PER_SOURCE_PAGE_MAX), min + 2, MAX_SLIDES);
  return { min, max };
}

/** 依張數範圍推算輸出 token 上限：張數越多，需要的輸出空間越大。 */
function outlineMaxTokens(range: { max: number }): number {
  return clamp(range.max * TOKENS_PER_SLIDE, MIN_OUTLINE_MAX_TOKENS, MAX_OUTLINE_MAX_TOKENS);
}

const SplitSchema = z.object({
  pages: z
    .array(
      z.object({
        page_number: z.number().int().positive(),
        content: z.string().min(1),
      }),
    )
    .min(1)
    .max(MAX_SLIDES),
});

/* ------------------------------------------------------------------ */
/*  Phase-1: 全文大綱產生（類似 YouTube buildYoutubeOutlineAsSlideText） */
/* ------------------------------------------------------------------ */

const OutlineSchema = z.object({
  slides: z
    .array(
      z.object({
        title: z.string().min(1),
        // Lower bound relaxed to 1 so Takahashi-style / minimal requests
        // (see isMinimalSlideStyleRequested) can produce a single bullet.
        bullets: z.array(z.string().min(1)).min(1).max(8),
        // Only populated when the input text contains [[PDF_PAGE_N]] markers:
        // which original PDF page(s) this slide's content is drawn from.
        source_pages: z.array(z.number().int().positive()).max(10).optional(),
      }),
    )
    .min(3)
    .max(MAX_SLIDES),
});

/**
 * 全文大綱上限：超過此字數的全文會先截取再送 LLM。
 * 128 000 字可涵蓋絕大多數 PDF 全文（含 [[PDF_PAGE_N]] 標記），
 * 對 256K context window 的模型仍留有充足的系統提示詞與輸出空間。
 */
const OUTLINE_MAX_INPUT_CHARS = 128_000;

/**
 * 當原文長度 ≥ 此門檻時，啟用「先產生大綱 → 再按 Slide 標記切分」的
 * 兩階段流程，確保全局視野。短文直接走 LLM chunk 分頁即可。
 */
const OUTLINE_THRESHOLD_CHARS = 800;

/**
 * 把全文送 LLM，產生一份結構化的簡報大綱（標題 + 重點）。回傳的 `slides`
 * 陣列已經是可以直接拿來建構分頁結果的結構化資料（每項自帶渲染好的
 * `content`/`slideLabel`），呼叫端不需要、也不應該再把 `outlineText`
 * 丟回 `splitBySlideMarkers()` 重新解析一次（見下方 `slides` 欄位的說明）。
 * `outlineText` 僅保留作為人類可讀的除錯/記錄用途。
 *
 * 回傳 `null` 表示 LLM 呼叫失敗，呼叫端應 fallback 到舊的 chunk 流程。
 */
async function buildOutlineFromFullText(
  fullText: string,
  userPrompt?: string | null,
): Promise<{
  outlineText: string;
  usage: TokenUsage;
  /**
   * One entry per non-empty slide, in the same order as rendered into
   * `outlineText`. Each entry carries its own rendered `content` block
   * (`Slide N: title\n- bullet...`) and `slideLabel` so callers never need
   * to re-parse `outlineText` via `splitBySlideMarkers()` — re-parsing is
   * unsafe because a bullet can itself contain an embedded newline whose
   * first line incidentally matches the `Slide N:` marker pattern (e.g. a
   * bullet quoting example text like "Slide 5: ..."), which would make
   * `splitBySlideMarkers()` produce more pages than `slides.length` and
   * silently misalign every page's `sourcePdfPages` (and shift page
   * numbering) from that point onward.
   */
  slides: Array<{ title: string; bullets: string[]; sourcePdfPages?: number[]; slideLabel: string; content: string }>;
} | null> {
  const input =
    fullText.length > OUTLINE_MAX_INPUT_CHARS
      ? fullText.slice(0, OUTLINE_MAX_INPUT_CHARS)
      : fullText;
  const hasPageMarkers = containsPdfPageMarkers(input);
  const minimalRequested = isMinimalSlideStyleRequested(userPrompt);
  // 張數由原文份量決定，而且必須講給模型聽：schema 曾單方面把上限訂在 20 張
  // 卻從未寫進提示詞，於是一篇 39 頁論文兩次都產出 22~23 張完整大綱、兩次都
  // 被驗證擋掉，最後掉進 chunk 流程切出 319 頁。
  const sourcePages = estimateSourcePageCount(input);
  const range = slideCountRangeForSourcePages(sourcePages);

  const system = [
    '你是簡報大綱助理。',
    '請根據以下全文內容，整理成一份投影片大綱。',
    '務必先通讀全文、理解整體脈絡，再規劃大綱結構。',
    '大綱需有邏輯順序（背景 → 方法/機制 → 結果/結論），必要時可重排內容。',
    `原文約 ${sourcePages} 頁，請規劃 ${range.min}~${range.max} 張投影片。這個範圍是依原文份量估算的，請盡量落在其中。`,
    minimalRequested
      ? '每頁僅放 1～2 個最核心的重點，放在 bullets 陣列之中；務必精簡，省略次要細節、案例與背景說明。'
      : '每頁需有一個標題與 2~6 點重點，放在 bullets 陣列之中。',
    '每一頁大綱重點要精簡、可讀、避免逐字轉錄。',
    // The outline's title and bullets are what ends up drawn on the slide, so an outline written
    // in the wrong language reaches the image model as material to copy.
    outlineLanguageRule(getRuntimeAiSettings().contentLanguage),
    ...(minimalRequested
      ? [
          '【高橋流 / 極簡大字模式優先規則】使用者已明確要求高橋流、Takahashi method/style、每頁只放一兩個重點、極簡大字投影片或類似低資訊密度風格，此規則優先於「儘量涵蓋全文重要內容」的一般要求。',
          '必要時可合併多個小節成同一張投影片重點，只保留最關鍵的訊息。',
        ]
      : []),
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
    `請產生 ${range.min}~${range.max} 張投影片（原文約 ${sourcePages} 頁）。`,
    minimalRequested
      ? '使用者已要求高橋流 / 極簡大字風格：請優先濃縮資訊，每頁只列 1～2 點重點，不必涵蓋全文所有細節。'
      : '需儘量涵蓋全文重要內容，但要去蕪存菁。',
    minimalRequested ? '每頁僅需標題與 1～2 點重點。' : '每頁需有標題與 2~6 點重點。',
    ...(userPrompt?.trim() ? ['', '使用者對本次簡報的補充指示（請納入大綱規劃考量）：', userPrompt.trim()] : []),
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
      maxTokens: outlineMaxTokens(range),
      temperature: 0.4,
      label: 'pdf-fulltext-outline',
    });

    logger.info(
      {
        inputChars: input.length,
        sourcePages,
        requestedRange: range,
        slides: r.data.slides.length,
        outlineJsonPretty: JSON.stringify(r.data, null, 2),
      },
      'buildOutlineFromFullText: LLM outline generated',
    );

    // 轉成 Slide 標記格式
    const lines: string[] = [];
    const slides: Array<{ title: string; bullets: string[]; sourcePdfPages?: number[]; slideLabel: string; content: string }> = [];
    r.data.slides.forEach((s) => {
      const bullets = s.bullets
        .map((t) => t.trim())
        .filter((t) => t.length > 0);
      if (bullets.length === 0) return;
      const title = s.title.trim();
      const sourcePdfPages = s.source_pages?.length
        ? Array.from(new Set(s.source_pages)).sort((a, b) => a - b)
        : undefined;
      const slideNumber = slides.length + 1;
      const slideLabel = `Slide ${slideNumber}`;
      const contentLines = [`${slideLabel}: ${title}`, ...bullets.map((b) => `- ${b}`)];
      const content = contentLines.join('\n').trim();
      slides.push({ title, bullets, sourcePdfPages, slideLabel, content });
      lines.push(...contentLines, '');
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

export interface SplitTextOptions {
  /**
   * 原文是否可能本身就是一份投影片大綱。純文字匯入預設為 true——使用者貼進來
   * 的 `Slide 1: ...` 是他自己寫好的分頁指示，照著切是對的。
   *
   * 「一般文件 AI 分頁」（document-mode PDF）必須傳 false：那是一份連續的文件，
   * 任何長得像標記的行都是內文而非分頁指示，照著切必定是誤判。實際案例是一篇
   * whole slide imaging 論文——參考文獻裡 "... for whole slide image
   * classification ..." 在 whole 之後換行，於是三行以 `slide` 開頭的內文被當成
   * 三個標記，整篇論文被切成三頁，最後一頁吞下 51k 字元。
   */
  allowSlideMarkers?: boolean;
}

export interface SplitTextWithLlmResult {
  pages: Array<{ pageNumber: number; content: string; slideLabel?: string; sourcePdfPages?: number[] }>;
  usage: TokenUsage;
}

/**
 * 只找到一個標記時，該頁內容若超過此字數，視為標記誤判：真正的投影片頁
 * 不會有這種長度，比較可能是內文某一行剛好長得像標記。
 */
const SLIDE_MARKER_MAX_SINGLE_PAGE_CHARS = 3000;

/**
 * `splitBySlideMarkers()` 只會從第一個標記開始切分，之前的內容會被丟棄。
 * 被丟棄的前言若同時超過這兩個門檻（絕對字數 + 佔全文比例），視為標記誤判。
 */
const SLIDE_MARKER_MAX_DROPPED_CHARS = 200;
const SLIDE_MARKER_MAX_DROPPED_RATIO = 0.2;

export function splitBySlideMarkers(rawText: string): Array<{ pageNumber: number; content: string; slideLabel?: string }> {
  // Normalize newlines + full-width hash so variants like "＃Slide 1" work.
  const text = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/＃/g, '#');
  const lines = text.split('\n');
  // Accept marker variants:
  // - Slide 1
  // - #Slide 1
  // - ## Slide 1: title
  // - ## Slide 1 - title
  // - #Slide: title (without numeric index)
  //
  // Both patterns are deliberately strict about what may follow "slide",
  // because this function runs against arbitrary source text. A single
  // false positive is destructive: it collapses the document into one page
  // *and* discards everything before the match. In particular an unnumbered
  // marker must be followed by a colon - matching a bare hyphen would make
  // English prose like "slide-level labels are available for this dataset."
  // (common in whole-slide-imaging papers) look like a slide marker.
  const numberedRe = /^\s*(?:#{1,6}\s*)?slide\b\s*(\d{1,4})\s*(?:[:：-]\s*(.*))?$/i;
  const unnumberedRe = /^\s*(?:#{1,6}\s*)?slide\b\s*[:：]\s*(\S.*)$/i;
  const starts: Array<{ idx: number; label: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] ?? '').trim();
    const numbered = numberedRe.exec(line);
    const m = numbered ?? unnumberedRe.exec(line);
    if (m) {
      const n = numbered ? (m[1] ?? '').trim() : '';
      const title = (numbered ? (m[2] ?? '') : (m[1] ?? '')).trim();
      const label = n
        ? `Slide ${n}`
        : title
          ? `Slide ${title.slice(0, 24)}`
          : `Slide ${starts.length + 1}`;
      starts.push({ idx: i, label });
    }
  }
  if (starts.length === 0) return [];

  // Guard 1: everything before the first marker is dropped by the loop below.
  // Losing a large preamble means the "marker" almost certainly came from body
  // text rather than a real deck outline, so report "no markers" and let the
  // caller fall back to the LLM outline strategy instead of silently throwing
  // away most of the document.
  const droppedChars = lines.slice(0, starts[0]!.idx).join('\n').trim().length;
  const totalChars = text.trim().length;
  if (
    droppedChars > SLIDE_MARKER_MAX_DROPPED_CHARS &&
    totalChars > 0 &&
    droppedChars / totalChars > SLIDE_MARKER_MAX_DROPPED_RATIO
  ) {
    logger.warn(
      { markers: starts.length, droppedChars, totalChars, firstMarkerLine: starts[0]!.idx + 1 },
      'splitBySlideMarkers: first marker drops too much preamble, treating as false positive',
    );
    return [];
  }

  const out: Array<{ pageNumber: number; content: string; slideLabel?: string }> = [];
  for (let i = 0; i < starts.length; i++) {
    const s = starts[i];
    if (!s) continue;
    const e = starts[i + 1]?.idx ?? lines.length;
    const block = lines.slice(s.idx, e).join('\n').trim();
    if (!block) continue;
    out.push({ pageNumber: out.length + 1, content: block, slideLabel: s.label });
  }

  // Guard 2: a single marker producing one very long page is not a deck - it is
  // a stray body-text line that matched. Fall back rather than emitting a
  // one-page presentation holding the whole document.
  if (out.length === 1 && (out[0]?.content.length ?? 0) > SLIDE_MARKER_MAX_SINGLE_PAGE_CHARS) {
    logger.warn(
      { singlePageChars: out[0]!.content.length, limit: SLIDE_MARKER_MAX_SINGLE_PAGE_CHARS },
      'splitBySlideMarkers: single marker yields an oversized page, treating as false positive',
    );
    return [];
  }
  return out;
}

const LOCAL_TARGET_CHARS = 220;

/**
 * Fallback chunk 的目標大小。1800 字元切得太細：每個 chunk 都失去上下文，模型
 * 只能就地把眼前的片段展開成好幾頁，頁數於是隨文件長度線性爆炸（一篇 39 頁
 * 的論文曾切出 63 個 chunk、共 319 頁）。放大到一次能吃下數頁原文，chunk 才
 * 有足夠上下文判斷什麼該留、什麼該併。
 */
const LLM_CHUNK_CHARS = 12_000;

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

  // 有 [[PDF_PAGE_N]] 標記時沿著頁邊界合併，每個 chunk 都是完整的整數頁。這樣
  // `splitChunkWithLlm()` 才能問出「這個 chunk 涵蓋幾頁原文」並據此決定要產生
  // 幾張投影片；從頁中間切開會讓頁數失真，也會把一頁的論述攔腰斬斷。
  const sourcePages = splitByPdfPageMarkers(text);
  if (sourcePages.length > 0) {
    const chunks: string[] = [];
    let buf = '';
    for (const page of sourcePages) {
      if (!buf) {
        buf = page.content;
        continue;
      }
      if (buf.length + 2 + page.content.length <= chunkSize) {
        buf += `\n\n${page.content}`;
        continue;
      }
      chunks.push(buf);
      buf = page.content;
    }
    if (buf) chunks.push(buf);
    return chunks.filter((c) => c.trim().length > 0);
  }

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

async function splitChunkWithLlm(chunk: string, userPrompt?: string | null): Promise<SplitTextWithLlmResult> {
  const minimalRequested = isMinimalSlideStyleRequested(userPrompt);
  // 每個 chunk 也照原文份量給範圍。少了這個約束，模型只會就地展開眼前的片段，
  // chunk 越多頁數就越多，整份文件的總頁數完全失控。
  const sourcePages = estimateSourcePageCount(chunk);
  const range = slideCountRangeForSourcePages(sourcePages);
  const system = [
    '你是「簡報大綱生成助理」，不是逐字切頁器。',
    '請先理解全文重點，再重組成可講解的投影片大綱頁。',
    `這段原文約 ${sourcePages} 頁，請產生 ${range.min}~${range.max} 頁投影片。`,
    minimalRequested
      ? '每頁應包含：一句標題 + 1~2 個最核心重點短句；務必精簡，省略次要細節（使用者已要求高橋流 / 極簡大字風格，此規則優先於一般展開要求）。'
      : '每頁應包含：一句標題 + 3~5 個重點短句（可用條列或短段）。',
    '禁止逐字抄錄原文、禁止只做機械切段。',
    '內容要去蕪存菁，保留關鍵名詞、關鍵數字、因果與流程。',
    minimalRequested
      ? '每頁約 20~60 字，以「極簡、可口語講解」為主，不要為了展開而補細節。'
      : '每頁約 90~220 字，以「可口語講解」為主。',
    '只回傳 JSON：{"pages":[{"page_number":1,"content":"..."}]}',
  ].join('\n');

  const user = [
    '請把以下全文改寫成簡報大綱頁。',
    `請產生 ${range.min}~${range.max} 頁（這段原文約 ${sourcePages} 頁）。`,
    '輸出頁面要有邏輯順序（背景 → 方法/機制 → 結果/結論），必要時可重排內容。',
    minimalRequested ? '每頁 content 建議格式（僅 1～2 點重點）：' : '每頁 content 建議格式：',
    '標題：...\\n- 重點 1\\n- 重點 2\\n- 重點 3',
    ...(userPrompt?.trim() ? ['', '使用者對本次簡報的補充指示（請納入規劃考量）：', userPrompt.trim()] : []),
    '',
    chunk,
  ].join('\n');
  const result = await callChatJSON({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    schema: SplitSchema,
    maxTokens: outlineMaxTokens(range),
    temperature: 0.3,
    label: 'split-text-with-llm',
  });

  const pages = result.data.pages
    .sort((a, b) => a.page_number - b.page_number)
    .map((p, idx) => ({ pageNumber: idx + 1, content: p.content.trim() }));
  return { pages, usage: result.usage };
}

async function splitChunkRobust(chunk: string, userPrompt?: string | null): Promise<SplitTextWithLlmResult> {
  try {
    return await splitChunkWithLlm(chunk, userPrompt);
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
    const a = await splitChunkRobust(left, userPrompt);
    const b = await splitChunkRobust(right, userPrompt);
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

async function splitTextWithLlmCore(
  rawText: string,
  userPrompt?: string | null,
  options?: SplitTextOptions,
): Promise<SplitTextWithLlmResult> {
  const text = rawText.trim();
  if (!text) {
    return {
      pages: [{ pageNumber: 1, content: '' }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    };
  }

  // Strategy 1: 原文已含 Slide 標記 → 直接切分。只適用於「原文本身就是一份
  // 投影片大綱」的來源；一般文件（見 SplitTextOptions.allowSlideMarkers）一律
  // 跳過，直接交給 LLM 分頁。
  const slidePages = options?.allowSlideMarkers === false ? [] : splitBySlideMarkers(text);
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

  if (options?.allowSlideMarkers === false) {
    logger.info(
      { inputChars: text.length },
      'Text split: source is a plain document, skipping the slide-marker shortcut',
    );
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
    const outlineResult = await buildOutlineFromFullText(text, userPrompt);
    if (outlineResult) {
      // Build pages directly from the structured `slides` array rather than
      // re-parsing `outlineResult.outlineText` via `splitBySlideMarkers()`.
      // Re-parsing the rendered text is unsafe: a bullet can contain an
      // embedded newline whose first line happens to match the `Slide N:`
      // marker pattern, which would make the parser discover more "pages"
      // than `slides.length` and misalign every subsequent page's
      // `sourcePdfPages` / numbering (see `buildOutlineFromFullText` doc
      // comment for a concrete reproduction).
      const outlinePages = outlineResult.slides;
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
            pageNumber: idx + 1,
            content: p.content,
            slideLabel: p.slideLabel,
            sourcePdfPages: p.sourcePdfPages,
          })),
          usage: outlineResult.usage,
        };
      }
      logger.warn(
        'Text split: outline produced but no slides survived bullet filtering, falling back to chunk split',
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
      const part = await splitChunkRobust(chunk, userPrompt);
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
 *
 * `userPrompt` is the deck's user-supplied prompt (e.g. from `pdfs.user_prompt`).
 * It is forwarded into the outline-generation LLM calls so the user's intent
 * actually informs the outline, and `isMinimalSlideStyleRequested()` is used
 * to detect Takahashi-style / minimal requests and trim bullets per slide.
 */
export async function splitTextWithLlm(
  rawText: string,
  userPrompt?: string | null,
  options?: SplitTextOptions,
): Promise<SplitTextWithLlmResult> {
  const result = await splitTextWithLlmCore(rawText, userPrompt, options);
  return {
    ...result,
    pages: result.pages.map((p) => ({ ...p, content: stripPdfPageMarkers(p.content) })),
  };
}
