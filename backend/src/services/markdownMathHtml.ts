/**
 * Server-side twin of the frontend's `MarkdownMath` component (frontend/src/components/
 * MarkdownMath.tsx): the same small Markdown dialect — headings, bold, italic, inline code,
 * `[text](url)` links, lists, tables, KaTeX math (`$…$`, `\(…\)`, `$$…$$`, `\[…\]`) — rendered to
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

function renderTextBlocks(text: string): string {
  const blocks: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flushList = () => {
    if (!list) return;
    const tag = list.ordered ? 'ol' : 'ul';
    blocks.push(`<${tag}>${list.items.map((it) => `<li>${renderInline(it)}</li>`).join('')}</${tag}>`);
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
    const listItem = /^\s*([-*]|\d+\.)\s+(.*)$/.exec(line);
    if (heading) {
      flushList();
      const tag = (heading[1]?.length ?? 1) <= 2 ? 'h3' : 'h4';
      blocks.push(`<${tag}>${renderInline(heading[2] ?? '')}</${tag}>`);
    } else if (listItem) {
      const ordered = /\d+\./.test(listItem[1] ?? '');
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push(listItem[2] ?? '');
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

/** Markdown + math → HTML. Text is escaped; only KaTeX output and our own tags are markup. */
export function renderMarkdownMathHtml(content: string): string {
  const text = (content ?? '').replace(/\r\n/g, '\n');
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
  const text = (content ?? '').replace(/\r\n/g, '\n');
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
