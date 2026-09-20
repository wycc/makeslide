/**
 * Choosing which pages of a deck go into the AI tutor's prompt.
 *
 * A deck's pages together run far past any sensible prompt budget — a 36-page lesson here is over
 * 100,000 characters against a 14,000 budget — so most of it never reaches the model. What matters
 * is *which* part survives. Joining every page in order and cutting the tail kept pages 1–5 and
 * dropped everything else, including the page the student was looking at: the tutor was asked
 * about page 31, had no page 31, and asked the student to paste it in.
 *
 * So the page the student is on is reserved first and never dropped, the budget then spends
 * outwards from it (the pages either side are the ones a question usually reaches for), and what
 * did not fit is named rather than silently missing — the tutor has tools that can fetch any page
 * on demand, but only if it knows the page exists and is not in front of it.
 */

export interface AskCorpusPage {
  pageNumber: number;
  /** The words on the slide. */
  text: string;
  /** What the narration says about it. */
  script: string;
}

export interface AskCorpusResult {
  /** The prompt section, pages in reading order. */
  corpus: string;
  includedPages: number[];
  /** Pages with content that did not fit; the tutor is told it can fetch these with its tools. */
  omittedPages: number[];
  /** Pages that hold nothing at all — neither the prompt nor a tool call would find anything. */
  emptyPages: number[];
}

/** One page as the model sees it. */
export function formatAskCorpusPage(page: AskCorpusPage, isCurrent: boolean): string {
  return [
    `# 第 ${page.pageNumber} 頁${isCurrent ? '（學生目前所在頁）' : ''}`,
    page.text.trim() ? `頁面文字：${page.text.trim()}` : '',
    page.script.trim() ? `逐字稿：${page.script.trim()}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Distance from the page being asked about; the current page first, then its neighbours. */
function byDistanceFrom(currentPage: number) {
  return (a: AskCorpusPage, b: AskCorpusPage) => {
    const da = Math.abs(a.pageNumber - currentPage);
    const db = Math.abs(b.pageNumber - currentPage);
    if (da !== db) return da - db;
    // A tie is "one page back" against "one page on": prefer the one already covered in class.
    return a.pageNumber - b.pageNumber;
  };
}

export function buildAskCorpus(pages: AskCorpusPage[], currentPage: number, maxChars: number): AskCorpusResult {
  const withContent = pages.filter((p) => p.text.trim() || p.script.trim());
  const emptyPages = pages.filter((p) => !p.text.trim() && !p.script.trim()).map((p) => p.pageNumber);

  const chosen: AskCorpusPage[] = [];
  const omitted: number[] = [];
  let used = 0;
  for (const page of [...withContent].sort(byDistanceFrom(currentPage))) {
    const section = formatAskCorpusPage(page, page.pageNumber === currentPage);
    const cost = section.length + 2; // the blank line between sections
    // The student's own page goes in whatever it costs: a tutor that cannot see the slide being
    // asked about has nothing useful to say about it.
    if (page.pageNumber === currentPage || used + cost <= maxChars) {
      chosen.push(page);
      used += cost;
    } else {
      omitted.push(page.pageNumber);
    }
  }
  chosen.sort((a, b) => a.pageNumber - b.pageNumber);
  omitted.sort((a, b) => a - b);
  return {
    corpus: chosen.map((p) => formatAskCorpusPage(p, p.pageNumber === currentPage)).join('\n\n'),
    includedPages: chosen.map((p) => p.pageNumber),
    omittedPages: omitted,
    emptyPages,
  };
}

/** Turns a page list into "3、7、12–20" so a long deck's missing pages stay one readable line. */
export function formatPageRanges(pages: number[]): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const parts: string[] = [];
  let start: number | null = null;
  let prev: number | null = null;
  const flush = () => {
    if (start == null || prev == null) return;
    parts.push(start === prev ? `${start}` : prev === start + 1 ? `${start}、${prev}` : `${start}–${prev}`);
  };
  for (const p of sorted) {
    if (start == null) {
      start = prev = p;
    } else if (prev != null && p === prev + 1) {
      prev = p;
    } else {
      flush();
      start = prev = p;
    }
  }
  flush();
  return parts.join('、');
}

/**
 * What the prompt says about the pages that did not fit.
 *
 * The old prompt promised the model "every page of the deck", which stopped being true the moment
 * the corpus was cut — and a model that believes it already has everything does not go looking. It
 * asks the student to paste the missing page in instead.
 */
export function describeCorpusCoverage(result: AskCorpusResult, totalPages: number): string {
  if (result.omittedPages.length === 0) {
    return `以上已包含這份簡報全部 ${totalPages} 頁中所有有內容的頁面。`;
  }
  return [
    `注意：因長度限制，上面只附上部分頁面（共 ${totalPages} 頁）。`,
    `未附上的頁面：第 ${formatPageRanges(result.omittedPages)} 頁。`,
    '這些頁面**確實存在且有內容**，只是沒放進這段文字。需要它們時，請直接用 `get_page_text`／`get_page_script`／`get_page_image` 工具讀取該頁，不要向學生索取頁面內容或截圖。',
  ].join('\n');
}
