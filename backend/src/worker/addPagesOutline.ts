/**
 * Pure outline-parsing / context-building helpers for the "add pages from
 * prompt" flow. Split out of addPagesFromPrompt.ts (which imports the DB and
 * other heavy worker deps) so this logic can be unit tested in isolation.
 */

export interface OutlineSlide {
  title: string;
  bullets: string[];
}

/**
 * Parse an LLM outline into slides. A line that is not a bullet starts a new
 * slide title (an optional `Slide N:` prefix is stripped); `-`/`•`/`*` lines are
 * bullets. Only slides with at least two bullets are kept, so thin/garbled
 * sections are dropped.
 */
export function parseOutlineText(text: string): OutlineSlide[] {
  const slides: OutlineSlide[] = [];
  let current: OutlineSlide | null = null;

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) {
      if (current && current.bullets.length >= 2) {
        slides.push(current);
        current = null;
      }
      continue;
    }
    if (line.startsWith('-') || line.startsWith('•') || line.startsWith('*')) {
      const bullet = line.replace(/^[-•*]\s*/, '').trim();
      if (bullet && current) {
        current.bullets.push(bullet);
      }
    } else {
      const titleMatch = line.match(/^(?:Slide\s*\d+\s*[:：]\s*)?(.+)$/i);
      const title = (titleMatch ? (titleMatch[1] ?? line) : line).trim();
      if (!title) continue;
      if (current && current.bullets.length >= 2) {
        slides.push(current);
      }
      current = { title, bullets: [] };
    }
  }
  if (current && current.bullets.length >= 2) {
    slides.push(current);
  }
  return slides;
}

/**
 * Build insertion context: focus on pages surrounding the insertion point.
 */
export function buildInsertionContext(
  pageTexts: Array<{ page_number: number; text: string }>,
  insertAfter: number,
  maxPages = 12,
  maxChars = 8000,
): string {
  if (pageTexts.length === 0) return '';

  const before = pageTexts.filter((p) => p.page_number <= insertAfter);
  const after = pageTexts.filter((p) => p.page_number > insertAfter);

  const headPages = pageTexts.slice(0, 2);
  const beforePages = before.slice(-5);
  const afterPages = after.slice(0, 5);

  const seen = new Set<number>();
  const selected: Array<{ page_number: number; text: string }> = [];
  for (const p of [...headPages, ...beforePages, ...afterPages]) {
    if (!seen.has(p.page_number) && p.text.trim()) {
      seen.add(p.page_number);
      selected.push(p);
    }
  }
  selected.sort((a, b) => a.page_number - b.page_number);

  return selected
    .slice(0, maxPages)
    .map((p) => `[第 ${p.page_number} 頁]\n${p.text.trim()}`)
    .join('\n\n---\n\n')
    .slice(0, maxChars);
}

export function renderNewSlideTexts(
  slides: OutlineSlide[],
  startPageNumber: number,
): Array<{ pageNumber: number; content: string }> {
  return slides.map((slide, idx) => {
    const pageNumber = startPageNumber + idx;
    const lines = [`Slide ${pageNumber}: ${slide.title.trim()}`];
    for (const bullet of slide.bullets) {
      const trimmed = bullet.trim();
      if (trimmed) lines.push(`- ${trimmed}`);
    }
    return { pageNumber, content: lines.join('\n') };
  });
}
