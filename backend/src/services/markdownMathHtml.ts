/**
 * Server-side twin of the frontend's `MarkdownMath` component (frontend/src/components/
 * MarkdownMath.tsx): the same small Markdown dialect — headings, bold, italic, inline code,
 * `[text](url)` links, lists, tables, fenced code blocks (``` / ~~~), KaTeX math (`$…$`, `\(…\)`, `$$…$$`, `\[…\]`) — rendered to
 * an HTML string for composing page elements in headless Chrome, plus a plain-text projection for
 * the node-canvas fallback.
 *
 * The grammar lives in two places on purpose (the backend cannot import frontend sources); a
 * frontend test compares the token regexes so the two cannot drift silently.
 */
import katex from 'katex';

// Kept character-for-character identical to MarkdownMath.tsx (guarded by a test).
export const MARKDOWN_INLINE_SOURCE =
  '(\\[[^\\]\\n]*\\]\\([^()\\s]*\\)|\\\\\\([\\s\\S]+?\\\\\\)|\\$[^$\\n]+?\\$|\\*\\*[\\s\\S]+?\\*\\*|`[^`]+?`|\\*[^*\\n]+?\\*)';
export const MARKDOWN_BLOCK_MATH_SOURCE = '\\$\\$[\\s\\S]+?\\$\\$|\\\\\\[[\\s\\S]+?\\\\\\]';
// Opening line of a fenced code block: ``` or ~~~ (3+), indented at most 3 spaces, optional
// language. Closed by the same character at least as long; an unclosed fence runs to the end.
export const MARKDOWN_FENCE_OPEN_SOURCE = '^( {0,3})(`{3,}|~{3,})([^`]*)$';

type FenceSegment = { kind: 'text'; text: string } | { kind: 'code'; code: string; lang: string };

/** Splits out fenced code blocks; their content is literal (no Markdown, no math). */
export function splitFences(text: string): FenceSegment[] {
  const lines = text.split('\n');
  const out: FenceSegment[] = [];
  let buf: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    const open = new RegExp(MARKDOWN_FENCE_OPEN_SOURCE).exec(line);
    if (!open) {
      buf.push(line);
      i++;
      continue;
    }
    const indent = open[1]?.length ?? 0;
    const fence = open[2] ?? '```';
    const close = new RegExp(`^ {0,3}${fence[0] === '`' ? '`' : '~'}{${fence.length},}\\s*$`);
    const code: string[] = [];
    let j = i + 1;
    while (j < lines.length && !close.test(lines[j] ?? '')) {
      code.push((lines[j] ?? '').replace(new RegExp(`^ {0,${indent}}`), ''));
      j++;
    }
    if (buf.length) out.push({ kind: 'text', text: buf.join('\n') });
    buf = [];
    out.push({ kind: 'code', code: code.join('\n'), lang: (open[3] ?? '').trim() });
    i = j + 1;
  }
  if (buf.length) out.push({ kind: 'text', text: buf.join('\n') });
  return out;
}

const SAFE_SCHEMES = new Set(['http', 'https', 'mailto']);

/** Same rule as frontend/src/lib/markdownLink.ts: http(s)/mailto or a site-absolute path. */
export function safeMarkdownLinkHref(raw: string): string | null {
  const href = raw.trim();
  if (!href) return null;
  if (href.startsWith('/')) return href.startsWith('//') ? null : href;
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(href)?.[1]?.toLowerCase();
  if (!scheme) return null;
  return SAFE_SCHEMES.has(scheme) ? href : null;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function mathHtml(tex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(tex, { throwOnError: false, displayMode });
  } catch {
    return escapeHtml(tex);
  }
}

function renderInline(text: string): string {
  let out = '';
  let last = 0;
  const re = new RegExp(MARKDOWN_INLINE_SOURCE, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out += escapeHtml(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('[')) {
      const split = tok.indexOf('](');
      const label = tok.slice(1, split);
      const href = safeMarkdownLinkHref(tok.slice(split + 2, -1));
      out += href ? `<a href="${escapeHtml(href)}">${label ? renderInline(label) : escapeHtml(href)}</a>` : `<span>${escapeHtml(tok)}</span>`;
    } else if (tok.startsWith('\\(')) {
      out += `<span>${mathHtml(tok.slice(2, -2), false)}</span>`;
    } else if (tok.startsWith('$')) {
      out += `<span>${mathHtml(tok.slice(1, -1), false)}</span>`;
    } else if (tok.startsWith('**')) {
      out += `<strong>${renderInline(tok.slice(2, -2))}</strong>`;
    } else if (tok.startsWith('`')) {
      out += `<code>${escapeHtml(tok.slice(1, -1))}</code>`;
    } else {
      out += `<em>${renderInline(tok.slice(1, -1))}</em>`;
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out += escapeHtml(text.slice(last));
  return out;
}

const isTableRow = (line: string): boolean => /^\s*\|.*\|\s*$/.test(line);
const isTableSeparator = (line: string): boolean => /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(line) && line.includes('-');

function parseCells(row: string): string[] {
  let r = row.trim();
  if (r.startsWith('|')) r = r.slice(1);
  if (r.endsWith('|')) r = r.slice(0, -1);
  return r.split('|').map((c) => c.trim());
}

function renderTable(rows: string[]): string {
  const [headerRow, , ...bodyRows] = rows;
  const headerCells = parseCells(headerRow ?? '');
  const head = headerCells.map((c) => `<th>${renderInline(c)}</th>`).join('');
  const body = bodyRows
    .map((row) => {
      const cells = parseCells(row);
      return `<tr>${headerCells.map((_, ci) => `<td>${renderInline(cells[ci] ?? '')}</td>`).join('')}</tr>`;
    })
    .join('');
  return `<div class="md-table"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

// ── Lists (nested by indentation) — same algorithm as MarkdownMath.tsx ─────────────────────
// An item deeper-indented than the previous one (2 or 4 spaces, or a tab) is its child; dedenting
// returns to the matching level. Switching ordered/unordered at one level starts a sibling list
// under the same parent item.
interface ListBlock { ordered: boolean; items: ListItem[] }
interface ListItem { text: string; children: ListBlock[] }
interface OpenList { root: ListBlock; stack: Array<{ indent: number; block: ListBlock }> }

const LIST_ITEM_RE = /^(\s*)([-*]|\d+\.)\s+(.*)$/;
const indentWidth = (ws: string): number => ws.replace(/\t/g, '    ').length;

function pushListLine(open: OpenList | null, indent: number, ordered: boolean, text: string): OpenList {
  const item: ListItem = { text, children: [] };
  if (!open) {
    const root: ListBlock = { ordered, items: [item] };
    return { root, stack: [{ indent, block: root }] };
  }
  const { stack } = open;
  let popped: { indent: number; block: ListBlock } | undefined;
  while (stack.length > 1 && indent < (stack[stack.length - 1]?.indent ?? 0)) popped = stack.pop();
  // Dedented to somewhere between two levels (e.g. 4 → 2 spaces): it joins the deeper level just
  // left rather than opening a fresh child list beside it.
  if (popped && indent > (stack[stack.length - 1]?.indent ?? 0)) {
    stack.push({ indent, block: popped.block });
  }
  const top = stack[stack.length - 1]!;
  const parentItem = top.block.items[top.block.items.length - 1];
  if (indent > top.indent && parentItem) {
    const child: ListBlock = { ordered, items: [item] };
    parentItem.children.push(child);
    stack.push({ indent, block: child });
    return open;
  }
  if (top.block.ordered !== ordered) {
    const parent = stack[stack.length - 2];
    const parentLast = parent?.block.items[parent.block.items.length - 1];
    if (!parentLast) return pushListLine(null, indent, ordered, text);
    const sibling: ListBlock = { ordered, items: [item] };
    parentLast.children.push(sibling);
    stack[stack.length - 1] = { indent: top.indent, block: sibling };
    return open;
  }
  top.block.items.push(item);
  return open;
}

function renderList(block: ListBlock): string {
  const tag = block.ordered ? 'ol' : 'ul';
  const items = block.items.map((it) => `<li>${renderInline(it.text)}${it.children.map(renderList).join('')}</li>`).join('');
  return `<${tag}>${items}</${tag}>`;
}

function renderTextBlocks(text: string): string {
  const blocks: string[] = [];
  let list: OpenList | null = null;
  const flushList = () => {
    if (!list) return;
    blocks.push(renderList(list.root));
    list = null;
  };
  const lines = text.split('\n');
  let idx = 0;
  while (idx < lines.length) {
    const line = lines[idx] ?? '';
    let nextNonBlank = idx + 1;
    while (nextNonBlank < lines.length && (lines[nextNonBlank] ?? '').trim() === '') nextNonBlank++;
    if (isTableRow(line) && isTableSeparator(lines[nextNonBlank] ?? '')) {
      flushList();
      const rows: string[] = [];
      let j = idx;
      while (j < lines.length) {
        const l = lines[j] ?? '';
        if (isTableRow(l)) {
          rows.push(l);
          j++;
        } else if (l.trim() === '') {
          let k = j + 1;
          while (k < lines.length && (lines[k] ?? '').trim() === '') k++;
          if (isTableRow(lines[k] ?? '')) j = k;
          else break;
        } else {
          break;
        }
      }
      blocks.push(renderTable(rows));
      idx = j;
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line.trim());
    const listItem = LIST_ITEM_RE.exec(line);
    if (heading) {
      flushList();
      const tag = (heading[1]?.length ?? 1) <= 2 ? 'h3' : 'h4';
      blocks.push(`<${tag}>${renderInline(heading[2] ?? '')}</${tag}>`);
    } else if (listItem) {
      const ordered = /\d+\./.test(listItem[2] ?? '');
      const indent = indentWidth(listItem[1] ?? '');
      if (list && list.stack.length === 1 && indent <= list.stack[0]!.indent && list.root.ordered !== ordered) flushList();
      list = pushListLine(list, indent, ordered, listItem[3] ?? '');
    } else if (line.trim() === '') {
      flushList();
    } else {
      flushList();
      blocks.push(`<p>${renderInline(line)}</p>`);
    }
    idx++;
  }
  flushList();
  return blocks.join('');
}

function renderMathAndBlocks(text: string): string {
  const parts: string[] = [];
  const re = new RegExp(MARKDOWN_BLOCK_MATH_SOURCE, 'g');
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(renderTextBlocks(text.slice(last, m.index)));
    parts.push(`<div class="md-math">${mathHtml(m[0].slice(2, -2), true)}</div>`);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(renderTextBlocks(text.slice(last)));
  return parts.join('');
}

/** Markdown + math → HTML. Text is escaped; only KaTeX output and our own tags are markup. */
export function renderMarkdownMathHtml(content: string): string {
  const text = (content ?? '').replace(/\r\n/g, '\n');
  const parts = splitFences(text).map((seg) =>
    seg.kind === 'text' ? renderMathAndBlocks(seg.text) : `<pre><code>${escapeHtml(seg.code)}</code></pre>`,
  );
  return `<div class="md">${parts.join('')}</div>`;
}

/** True when the text uses any math delimiter — the only case the KaTeX stylesheet is needed. */
export function containsMath(content: string): boolean {
  return /\$|\\\(|\\\[/.test(content);
}

/**
 * The plain-text projection used when no browser is available to render the HTML: markup is
 * stripped, list items get a bullet, table rows become `a | b`, math is left as its TeX source.
 */
export function markdownToPlainText(content: string): string {
  const segments = splitFences((content ?? '').replace(/\r\n/g, '\n'));
  if (segments.some((seg) => seg.kind === 'code')) {
    // Code keeps its lines verbatim; everything around it goes through the normal projection.
    return segments
      .map((seg) => (seg.kind === 'code' ? seg.code : markdownToPlainText(seg.text)))
      .filter((s) => s !== '')
      .join('\n')
      .trim();
  }
  const text = segments.map((seg) => (seg.kind === 'text' ? seg.text : '')).join('');
  const stripInline = (s: string): string => {
    const re = new RegExp(MARKDOWN_INLINE_SOURCE, 'g');
    return s.replace(re, (tok) => {
      if (tok.startsWith('[')) {
        const split = tok.indexOf('](');
        const label = tok.slice(1, split);
        return label ? stripInline(label) : tok.slice(split + 2, -1);
      }
      if (tok.startsWith('\\(')) return tok.slice(2, -2);
      if (tok.startsWith('$')) return tok.slice(1, -1);
      if (tok.startsWith('**')) return stripInline(tok.slice(2, -2));
      if (tok.startsWith('`')) return tok.slice(1, -1);
      return stripInline(tok.slice(1, -1));
    });
  };
  const withoutBlockMath = text.replace(new RegExp(MARKDOWN_BLOCK_MATH_SOURCE, 'g'), (tok) => `\n${tok.slice(2, -2).trim()}\n`);
  const lines = withoutBlockMath.split('\n').map((line) => {
    if (isTableSeparator(line) && isTableRow(line.trim().startsWith('|') ? line : `|${line}|`)) return null;
    if (isTableRow(line)) return parseCells(line).map(stripInline).join(' | ');
    const heading = /^(#{1,6})\s+(.*)$/.exec(line.trim());
    if (heading) return stripInline(heading[2] ?? '');
    const listItem = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(line);
    if (listItem) return `${listItem[1] ?? ''}${/\d/.test(listItem[2] ?? '') ? listItem[2] : '•'} ${stripInline(listItem[3] ?? '')}`;
    return stripInline(line);
  });
  return lines.filter((l): l is string => l !== null).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
