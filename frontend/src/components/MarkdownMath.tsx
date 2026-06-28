import { createElement, type ReactNode } from 'react';
import katex from 'katex';

/**
 * 輕量 Markdown + LaTeX 渲染：支援 `# 標題`、`**粗體**`、`*斜體*`、`` `行內碼` ``、
 * `-`/`*`/`1.` 條列、段落換行，以及 LaTeX 數學——區塊數學 `$$...$$`、`\[...\]`（可跨行），
 * 行內數學 `$...$`、`\(...\)`。不引入 markdown 套件，數學交由專案已內建的 katex 渲染。
 * 文字內容一律以 React text node 呈現（不走 innerHTML）；只有 katex 產生的 HTML 才用
 * dangerouslySetInnerHTML（受信任）。
 */
function renderMathHtml(tex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(tex, { throwOnError: false, displayMode });
  } catch {
    return tex;
  }
}

// 行內 token（不含區塊數學，那在外層先抽走）：行內數學 \(...\)、$...$，再粗體/行內碼/斜體。
// 每次呼叫都建立新的 RegExp——renderInline 會遞迴，共用帶 g 旗標的有狀態 regex 會污染
// 外層迴圈的 lastIndex 而無限迴圈。
const INLINE_SOURCE = '(\\\\\\([\\s\\S]+?\\\\\\)|\\$[^$\\n]+?\\$|\\*\\*[\\s\\S]+?\\*\\*|`[^`]+?`|\\*[^*\\n]+?\\*)';

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  const re = new RegExp(INLINE_SOURCE, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const key = `${keyPrefix}-${i++}`;
    if (tok.startsWith('\\(')) {
      out.push(<span key={key} dangerouslySetInnerHTML={{ __html: renderMathHtml(tok.slice(2, -2), false) }} />);
    } else if (tok.startsWith('$')) {
      out.push(<span key={key} dangerouslySetInnerHTML={{ __html: renderMathHtml(tok.slice(1, -1), false) }} />);
    } else if (tok.startsWith('**')) {
      out.push(<strong key={key}>{renderInline(tok.slice(2, -2), key)}</strong>);
    } else if (tok.startsWith('`')) {
      out.push(<code key={key} className="rounded bg-black/10 px-1 text-[0.95em] dark:bg-white/15">{tok.slice(1, -1)}</code>);
    } else {
      out.push(<em key={key}>{renderInline(tok.slice(1, -1), key)}</em>);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// ── Markdown 表格 ───────────────────────────────────────────────────────────
const isTableRow = (line: string): boolean => /^\s*\|.*\|\s*$/.test(line);
const isTableSeparator = (line: string): boolean => /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(line) && line.includes('-');

function parseCells(row: string): string[] {
  let r = row.trim();
  if (r.startsWith('|')) r = r.slice(1);
  if (r.endsWith('|')) r = r.slice(0, -1);
  return r.split('|').map((c) => c.trim());
}

function renderTable(rows: string[], key: string): ReactNode {
  const [headerRow, , ...bodyRows] = rows; // rows[1] 是分隔列，略過
  const headerCells = parseCells(headerRow ?? '');
  const cellCls = 'border border-current/20 px-2 py-1 align-top';
  return (
    <div key={key} className="my-1 overflow-x-auto">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr>{headerCells.map((c, i) => <th key={i} className={`${cellCls} font-semibold`}>{renderInline(c, `${key}-h${i}`)}</th>)}</tr>
        </thead>
        <tbody>
          {bodyRows.map((row, r) => {
            const cells = parseCells(row);
            return <tr key={r}>{headerCells.map((_, ci) => <td key={ci} className={cellCls}>{renderInline(cells[ci] ?? '', `${key}-r${r}c${ci}`)}</td>)}</tr>;
          })}
        </tbody>
      </table>
    </div>
  );
}

/** 把一段「不含區塊數學」的文字逐行解析成標題/條列/表格/段落區塊。 */
function renderTextBlocks(text: string, keyPrefix: string): ReactNode[] {
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushList = (key: string) => {
    if (!list) return;
    const { ordered, items } = list;
    blocks.push(
      createElement(
        ordered ? 'ol' : 'ul',
        { key, className: ordered ? 'list-decimal pl-5 space-y-0.5' : 'list-disc pl-5 space-y-0.5' },
        items.map((it, idx) => <li key={idx}>{renderInline(it, `${key}-${idx}`)}</li>),
      ),
    );
    list = null;
  };

  const lines = text.split('\n');
  let idx = 0;
  while (idx < lines.length) {
    const line = lines[idx] ?? '';
    const key = `${keyPrefix}-b${idx}`;
    const lkey = `${keyPrefix}-l${idx}`;

    // 表格：第二（非空）列為分隔列時，連續的 | 列（容許列間空行）整段當表格。
    let nextNonBlank = idx + 1;
    while (nextNonBlank < lines.length && (lines[nextNonBlank] ?? '').trim() === '') nextNonBlank++;
    if (isTableRow(line) && isTableSeparator(lines[nextNonBlank] ?? '')) {
      flushList(lkey);
      const rows: string[] = [];
      let j = idx;
      while (j < lines.length) {
        const l = lines[j] ?? '';
        if (isTableRow(l)) {
          rows.push(l);
          j++;
        } else if (l.trim() === '') {
          // 跳過列間（一或多行）空行——只要後面還有表格列就繼續，否則結束表格。
          let k = j + 1;
          while (k < lines.length && (lines[k] ?? '').trim() === '') k++;
          if (isTableRow(lines[k] ?? '')) j = k;
          else break;
        } else {
          break;
        }
      }
      blocks.push(renderTable(rows, key));
      idx = j;
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line.trim());
    const listItem = /^\s*([-*]|\d+\.)\s+(.*)$/.exec(line);
    if (heading) {
      flushList(lkey);
      const tag = (heading[1]?.length ?? 1) <= 2 ? 'h3' : 'h4';
      blocks.push(createElement(tag, { key, className: 'mt-2 font-semibold' }, renderInline(heading[2] ?? '', key)));
    } else if (listItem) {
      const ordered = /\d+\./.test(listItem[1] ?? '');
      if (!list || list.ordered !== ordered) {
        flushList(lkey);
        list = { ordered, items: [] };
      }
      list.items.push(listItem[2] ?? '');
    } else if (line.trim() === '') {
      flushList(lkey);
    } else {
      flushList(lkey);
      blocks.push(<p key={key} className="whitespace-pre-wrap break-words">{renderInline(line, key)}</p>);
    }
    idx++;
  }
  flushList(`${keyPrefix}-lend`);
  return blocks;
}

// 區塊數學（可跨行）：$$...$$、\[...\]。
const BLOCK_MATH_SOURCE = '\\$\\$[\\s\\S]+?\\$\\$|\\\\\\[[\\s\\S]+?\\\\\\]';

export function MarkdownMath({ content, className }: { content: string; className?: string }) {
  const text = (content ?? '').replace(/\r\n/g, '\n');
  const nodes: ReactNode[] = [];
  const re = new RegExp(BLOCK_MATH_SOURCE, 'g');
  let last = 0;
  let i = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(...renderTextBlocks(text.slice(last, m.index), `seg${i}`));
    const tok = m[0];
    // $$...$$ 與 \[...\] 都是去頭去尾 2 個字元。
    nodes.push(
      <div
        key={`bm${i}`}
        className="my-1 overflow-x-auto"
        dangerouslySetInnerHTML={{ __html: renderMathHtml(tok.slice(2, -2), true) }}
      />,
    );
    last = m.index + tok.length;
    i++;
  }
  if (last < text.length) nodes.push(...renderTextBlocks(text.slice(last), 'segend'));

  return <div className={`space-y-1 ${className ?? ''}`}>{nodes}</div>;
}
