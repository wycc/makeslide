import { createElement, type ReactNode } from 'react';
import katex from 'katex';
import { opensInNewTab, safeMarkdownLinkHref } from '../lib/markdownLink';

/**
 * 輕量 Markdown + LaTeX 渲染：支援 `# 標題`、`**粗體**`、`*斜體*`、`` `行內碼` ``、
 * `[文字](網址)` 連結、`-`/`*`/`1.` 條列、段落換行、```` ``` ```` / `~~~` 圍欄程式碼區塊，以及 LaTeX 數學——區塊數學
 * `$$...$$`、`\[...\]`（可跨行），行內數學 `$...$`、`\(...\)`。不引入 markdown 套件，
 * 數學交由專案已內建的 katex 渲染。
 * 文字內容一律以 React text node 呈現（不走 innerHTML）；只有 katex 產生的 HTML 才用
 * dangerouslySetInnerHTML（受信任）。連結的網址先經 safeMarkdownLinkHref 收斂 scheme——
 * 那是這份 Markdown 裡唯一「使用者寫的字會變成 DOM 屬性」的地方。
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
// 連結放在最前面：`[文字](網址)` 的文字段允許其他行內語法（遞迴處理），但網址段不允許
// 空白與括號，免得把後面整段文字都吞進網址裡。
const INLINE_SOURCE = '(\\[[^\\]\\n]*\\]\\([^()\\s]*\\)|\\\\\\([\\s\\S]+?\\\\\\)|\\$[^$\\n]+?\\$|\\*\\*[\\s\\S]+?\\*\\*|`[^`]+?`|\\*[^*\\n]+?\\*)';

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
    if (tok.startsWith('[')) {
      const split = tok.indexOf('](');
      const label = tok.slice(1, split);
      const href = safeMarkdownLinkHref(tok.slice(split + 2, -1));
      if (!href) {
        // 不接受的網址原樣顯示整段，讓寫的人看得出來自己寫了什麼，而不是靜靜變成沒有連結的字。
        out.push(<span key={key}>{tok}</span>);
      } else {
        out.push(
          <a
            key={key}
            href={href}
            {...(opensInNewTab(href) ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
            className="text-primary underline underline-offset-2 hover:opacity-80"
          >
            {label ? renderInline(label, key) : href}
          </a>,
        );
      }
    } else if (tok.startsWith('\\(')) {
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

// 圍欄程式碼區塊的開頭行：最多縮排 3 格的 ``` 或 ~~~（3 個以上），後面可接語言名稱。
// 以同字元、至少同長度的圍欄結束；沒有結束圍欄就延伸到文末（打字途中不會整段跳回一般文字）。
// 區塊內的文字原樣顯示，不解析 Markdown 也不解析數學——程式碼裡的 `#`、`*`、`$` 都是字面。
const FENCE_OPEN_SOURCE = '^( {0,3})(`{3,}|~{3,})([^`]*)$';

type FenceSegment = { kind: 'text'; text: string } | { kind: 'code'; code: string; lang: string };

function splitFences(text: string): FenceSegment[] {
  const lines = text.split('\n');
  const out: FenceSegment[] = [];
  let buf: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    const open = new RegExp(FENCE_OPEN_SOURCE).exec(line);
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
      // 開頭圍欄有縮排時，內容行去掉至多同樣多的前導空白。
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

/** 一段「不含圍欄程式碼」的文字：先抽區塊數學，其餘逐行解析。 */
function renderMathAndBlocks(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = new RegExp(BLOCK_MATH_SOURCE, 'g');
  let last = 0;
  let i = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(...renderTextBlocks(text.slice(last, m.index), `${keyPrefix}seg${i}`));
    const tok = m[0];
    // $$...$$ 與 \[...\] 都是去頭去尾 2 個字元。
    nodes.push(
      <div
        key={`${keyPrefix}bm${i}`}
        className="my-1 overflow-x-auto"
        dangerouslySetInnerHTML={{ __html: renderMathHtml(tok.slice(2, -2), true) }}
      />,
    );
    last = m.index + tok.length;
    i++;
  }
  if (last < text.length) nodes.push(...renderTextBlocks(text.slice(last), `${keyPrefix}segend`));
  return nodes;
}

export function MarkdownMath({ content, className }: { content: string; className?: string }) {
  const text = (content ?? '').replace(/\r\n/g, '\n');
  const nodes: ReactNode[] = [];
  splitFences(text).forEach((seg, i) => {
    if (seg.kind === 'text') {
      nodes.push(...renderMathAndBlocks(seg.text, `f${i}`));
    } else {
      nodes.push(
        <pre
          key={`f${i}code`}
          data-lang={seg.lang || undefined}
          className="my-1 overflow-x-auto rounded bg-black/10 p-2 text-[0.9em] leading-snug dark:bg-white/15"
        >
          <code className="font-mono">{seg.code}</code>
        </pre>,
      );
    }
  });

  return <div className={`space-y-1 ${className ?? ''}`}>{nodes}</div>;
}
