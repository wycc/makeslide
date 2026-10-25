/**
 * AI 導師用的「原始來源全文」（source.txt）取段（使用者回報，2026-10-25：AI 導師似乎不看原始資料）。
 *
 * 原本只送前 12,000 字、其餘直接截掉，模型也沒有工具讀後面——demo16 上最常被問的論文
 *（47,545 字）只送出前 25%，問到後半段的方法或實驗，導師就說資料裡沒有。
 *
 * 現在：全文放得下就全送；放不下時保留開頭（摘要／引言通常在那裡），其餘預算給與學生問題及
 * 所在頁最相關的段落，依原文順序排列並標出字元位置；沒附上的部分由唯讀工具
 * `search_source_text`／`read_source_text`（services/aiTools.ts）讓模型自己查。
 *
 * 純函式，不碰檔案系統。
 */

export interface SourceChunk {
  /** 在全文中的起始字元位置（0 起算）。 */
  start: number;
  text: string;
}

const CHUNK_TARGET_CHARS = 1500;

/** 以段落為單位切成約 1500 字的區塊；單一段落太長時硬切。 */
export function chunkSourceText(text: string, target = CHUNK_TARGET_CHARS): SourceChunk[] {
  const chunks: SourceChunk[] = [];
  let start = 0;
  let buf = '';
  let bufStart = 0;
  const flush = () => {
    if (buf.trim()) chunks.push({ start: bufStart, text: buf });
    buf = '';
  };
  // 保留段落分隔（\n\n）在前一段尾端，位置才能與原文一一對應。
  const paragraphs = text.split(/(?<=\n\s*\n)/);
  for (const para of paragraphs) {
    if (buf && buf.length + para.length > target) flush();
    if (!buf) bufStart = start;
    if (para.length > target * 1.5) {
      // 超長段落（例如 PDF 抽出沒有空行的文字）：先把手上的送出，再按 target 硬切。
      flush();
      for (let i = 0; i < para.length; i += target) {
        chunks.push({ start: start + i, text: para.slice(i, i + target) });
      }
    } else {
      buf += para;
    }
    start += para.length;
  }
  flush();
  return chunks;
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'are', 'was', 'were', 'which', 'what', 'how', 'why',
  'can', 'will', 'not', 'but', 'its', 'our', 'their', 'into', 'than', 'then', 'there', 'these', 'those',
  'been', 'has', 'have', 'had', 'also', 'such', 'more', 'most', 'other', 'some', 'any', 'each', 'about',
]);

/** 查詢詞：英數字詞（小寫、≥3 字元、去停用詞）＋連續漢字的雙字組。 */
export function queryTerms(text: string): string[] {
  const terms = new Set<string>();
  for (const w of text.toLowerCase().match(/[a-z0-9][a-z0-9\-_]{2,}/g) ?? []) {
    if (!STOPWORDS.has(w)) terms.add(w);
  }
  for (const run of text.match(/[一-鿿]{2,}/g) ?? []) {
    for (let i = 0; i + 2 <= run.length; i += 1) terms.add(run.slice(i, i + 2));
  }
  return [...terms];
}

/**
 * 依查詢詞替每個區塊打分：出現的詞乘上權重與稀有度（越多區塊都有的詞越不重要），
 * 同一詞重複出現只算一次加上少量次數獎勵，避免一個常見詞灌爆分數。
 */
export function scoreChunks(chunks: readonly SourceChunk[], weighted: ReadonlyArray<{ terms: string[]; weight: number }>): number[] {
  const lower = chunks.map((c) => c.text.toLowerCase());
  const df = new Map<string, number>();
  const allTerms = new Set(weighted.flatMap((w) => w.terms));
  for (const term of allTerms) df.set(term, lower.filter((t) => t.includes(term)).length);
  const n = Math.max(1, chunks.length);
  return lower.map((text) => {
    let score = 0;
    for (const { terms, weight } of weighted) {
      for (const term of terms) {
        const d = df.get(term) ?? 0;
        if (d === 0 || !text.includes(term)) continue;
        const occurrences = Math.min(5, text.split(term).length - 1);
        score += weight * Math.log(1 + n / d) * (1 + 0.2 * (occurrences - 1));
      }
    }
    return score;
  });
}

export interface SourceExcerptResult {
  /** 要放進提示的文字（全文，或開頭＋相關段落，段落間以「……（略）……」相接並標位置）。 */
  text: string;
  /** 是否只附了部分。 */
  partial: boolean;
  totalChars: number;
  includedChars: number;
}

/** 開頭固定保留的字數（摘要、引言、目錄通常在這裡）。 */
const HEAD_CHARS = 3000;

/**
 * 依預算從全文挑段：放得下就全送；否則開頭＋最相關的區塊（依原文順序）。
 * `question` 權重較高；`pageContext`（學生所在頁的投影片文字與逐字稿）次之。
 */
export function selectSourceExcerpts(fullText: string, question: string, pageContext: string, budget: number): SourceExcerptResult {
  const text = fullText.trim();
  if (text.length <= budget) return { text, partial: false, totalChars: text.length, includedChars: text.length };

  const chunks = chunkSourceText(text);
  const scores = scoreChunks(chunks, [
    { terms: queryTerms(question), weight: 3 },
    { terms: queryTerms(pageContext), weight: 1 },
  ]);
  const chosen = new Set<number>();
  let used = 0;
  // 開頭：前幾個區塊，直到 HEAD_CHARS。
  for (let i = 0; i < chunks.length && used < Math.min(HEAD_CHARS, budget); i += 1) {
    chosen.add(i);
    used += chunks[i]!.text.length;
  }
  const ranked = chunks
    .map((_, i) => i)
    .filter((i) => !chosen.has(i) && (scores[i] ?? 0) > 0)
    .sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0));
  const take = (i: number) => {
    const c = chunks[i];
    if (!c || chosen.has(i) || used + c.text.length > budget) return;
    chosen.add(i);
    used += c.text.length;
  };
  const relevant: number[] = [];
  for (const i of ranked) {
    const before = chosen.size;
    take(i);
    if (chosen.size > before) relevant.push(i);
  }
  // 預算還有剩：先補相關段落的前後文（答案常跨段），再從開頭往後接續。
  for (const i of relevant) { take(i + 1); take(i - 1); }
  for (let i = 0; i < chunks.length; i += 1) take(i);

  const parts: string[] = [];
  let prevEnd = 0;
  for (const i of [...chosen].sort((a, b) => a - b)) {
    const c = chunks[i]!;
    if (c.start > prevEnd) parts.push(`……（略去第 ${prevEnd + 1}–${c.start} 字）……`);
    parts.push(`【原文第 ${c.start + 1}–${c.start + c.text.length} 字】\n${c.text.trim()}`);
    prevEnd = c.start + c.text.length;
  }
  if (prevEnd < text.length) parts.push(`……（略去第 ${prevEnd + 1}–${text.length} 字）……`);
  return { text: parts.join('\n\n'), partial: true, totalChars: text.length, includedChars: used };
}

/** 工具用：關鍵字搜尋全文，回傳最相關的幾個區塊（含位置）。 */
export function searchSourceText(fullText: string, query: string, maxChunks = 4): SourceChunk[] {
  const chunks = chunkSourceText(fullText.trim());
  const scores = scoreChunks(chunks, [{ terms: queryTerms(query), weight: 1 }]);
  return chunks
    .map((c, i) => ({ c, s: scores[i] ?? 0 }))
    .filter(({ s }) => s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, maxChunks)
    .map(({ c }) => c)
    .sort((a, b) => a.start - b.start);
}
