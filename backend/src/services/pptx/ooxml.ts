/**
 * The little bit of OOXML handling the PPTX import needs (docs/pptx-animated-import-design.md §1).
 *
 * Hand-written rather than pulled from a dependency for one reason: removing a shape must be
 * *byte surgery*, not a parse-and-reserialize. A slide's XML carries namespaces, attribute order,
 * `r:embed` relationship ids and vendor extension blocks (`p:extLst`) that LibreOffice reads; a
 * round-trip through a generic DOM rewrites all of that, and any difference shows up as a visual
 * difference in the rendered frame — which is the one thing this import must not have. Cutting the
 * exact byte range of one element and leaving every other byte untouched has no such risk.
 *
 * Scope is deliberately narrow: these functions understand element nesting, nothing else. They do
 * not resolve namespaces (the prefixes are fixed in practice for the producers we care about) and
 * they do not build a tree.
 */

/** One element occurrence in the source: its tag, attributes as raw text, and its byte range. */
export interface XmlElement {
  tag: string;
  /** Raw attribute text, e.g. `id="3" name="Title"`. */
  attrs: string;
  /** Index of the `<` that opens this element. */
  start: number;
  /** Index just past the `>` that closes it (or past `/>` when self-closing). */
  end: number;
  /** Nesting depth, counted from 0 for the document element. */
  depth: number;
  selfClosing: boolean;
}

const NAME_RE = /[A-Za-z_:][-A-Za-z0-9_:.]*/y;

/**
 * Walk the elements of a well-formed XML document, reporting each with its byte range.
 *
 * `onElement` is called when an element *closes*, so `start`/`end` already span the whole subtree —
 * which is what a caller removing an element needs.
 */
export function walkXmlElements(xml: string, onElement: (el: XmlElement) => void): void {
  const stack: Array<{ tag: string; attrs: string; start: number; depth: number }> = [];
  let i = 0;
  while (i < xml.length) {
    const lt = xml.indexOf('<', i);
    if (lt < 0) break;
    // Skip the things that can contain a bare '<'-looking byte or simply carry no structure.
    if (xml.startsWith('<!--', lt)) {
      const close = xml.indexOf('-->', lt + 4);
      i = close < 0 ? xml.length : close + 3;
      continue;
    }
    if (xml.startsWith('<![CDATA[', lt)) {
      const close = xml.indexOf(']]>', lt + 9);
      i = close < 0 ? xml.length : close + 3;
      continue;
    }
    if (xml.startsWith('<?', lt) || xml.startsWith('<!', lt)) {
      const close = xml.indexOf('>', lt + 2);
      i = close < 0 ? xml.length : close + 1;
      continue;
    }
    if (xml.startsWith('</', lt)) {
      NAME_RE.lastIndex = lt + 2;
      const m = NAME_RE.exec(xml);
      const close = xml.indexOf('>', lt);
      if (!m || close < 0) break;
      const open = stack.pop();
      if (open && open.tag === m[0]) {
        onElement({ ...open, end: close + 1, selfClosing: false });
      }
      i = close + 1;
      continue;
    }
    NAME_RE.lastIndex = lt + 1;
    const m = NAME_RE.exec(xml);
    if (!m) {
      i = lt + 1;
      continue;
    }
    // Find this tag's '>' without being fooled by a '>' inside an attribute value.
    let j = NAME_RE.lastIndex;
    let quote: string | null = null;
    while (j < xml.length) {
      const ch = xml[j]!;
      if (quote) {
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === '>') {
        break;
      }
      j += 1;
    }
    if (j >= xml.length) break;
    const selfClosing = xml[j - 1] === '/';
    const attrs = xml.slice(NAME_RE.lastIndex, selfClosing ? j - 1 : j).trim();
    if (selfClosing) {
      onElement({ tag: m[0], attrs, start: lt, end: j + 1, depth: stack.length, selfClosing: true });
    } else {
      stack.push({ tag: m[0], attrs, start: lt, depth: stack.length });
    }
    i = j + 1;
  }
}

/** The value of one attribute in an element's raw attribute text, or null. */
export function attr(attrs: string, name: string): string | null {
  const re = new RegExp(`(?:^|\\s)${name.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\s*=\\s*("([^"]*)"|'([^']*)')`);
  const m = re.exec(attrs);
  if (!m) return null;
  return (m[2] ?? m[3] ?? '').trim();
}

/** Every element with this tag, outermost first. */
export function findElements(xml: string, tag: string): XmlElement[] {
  const out: XmlElement[] = [];
  walkXmlElements(xml, (el) => {
    if (el.tag === tag) out.push(el);
  });
  return out.sort((a, b) => a.start - b.start || b.end - a.end);
}

/**
 * Remove the given byte ranges, outermost-first and non-overlapping.
 *
 * Ranges nested inside another removed range are dropped rather than cut twice.
 */
export function cutRanges(xml: string, ranges: Array<{ start: number; end: number }>): string {
  const sorted = [...ranges].sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: Array<{ start: number; end: number }> = [];
  for (const r of sorted) {
    const last = kept[kept.length - 1];
    if (last && r.start < last.end) continue; // inside one we are already removing
    kept.push(r);
  }
  let out = '';
  let cursor = 0;
  for (const r of kept) {
    out += xml.slice(cursor, r.start);
    cursor = r.end;
  }
  return out + xml.slice(cursor);
}

/** Decode the five XML entities that appear in slide text. */
export function decodeXmlText(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

/** Escape text for use inside an XML text node or a double-quoted attribute. */
export function escapeXmlText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
