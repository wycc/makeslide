import { createElement, type ReactNode } from 'react';
import katex from 'katex';

/**
 * 輕量 Markdown + LaTeX 渲染：支援 `# 標題`、`**粗體**`、`*斜體*`、`` `行內碼` ``、
 * `-`/`*`/`1.` 條列、段落換行，以及 LaTeX 數學（`$...$`、`$$...$$`、`\(...\)`、`\[...\]`）。
 * 不引入 markdown 套件，數學交由專案已內建的 katex 渲染。文字內容一律以 React text node
 * 呈現（不走 innerHTML），只有 katex 產生的 HTML 才用 dangerouslySetInnerHTML（受信任）。
 */
function renderMathHtml(tex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(tex, { throwOnError: false, displayMode });
  } catch {
    return tex;
  }
}

// 行內 token：數學優先（避免 $ 內的 * 被當粗體），其次粗體/行內碼/斜體。
const INLINE_RE = /(\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$[^$\n]+?\$|\*\*[\s\S]+?\*\*|`[^`]+?`|\*[^*\n]+?\*)/g;

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  INLINE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = INLINE_RE.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const key = `${keyPrefix}-${i++}`;
    if (tok.startsWith('$$') || tok.startsWith('\\[')) {
      out.push(<span key={key} dangerouslySetInnerHTML={{ __html: renderMathHtml(tok.slice(2, -2), true) }} />);
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

export function MarkdownMath({ content, className }: { content: string; className?: string }) {
  const lines = (content ?? '').replace(/\r\n/g, '\n').split('\n');
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

  lines.forEach((line, idx) => {
    const key = `b${idx}`;
    const heading = /^(#{1,6})\s+(.*)$/.exec(line.trim());
    const listItem = /^\s*([-*]|\d+\.)\s+(.*)$/.exec(line);
    if (heading) {
      flushList(`l${idx}`);
      const tag = (heading[1]?.length ?? 1) <= 2 ? 'h3' : 'h4';
      blocks.push(createElement(tag, { key, className: 'mt-2 font-semibold' }, renderInline(heading[2] ?? '', key)));
    } else if (listItem) {
      const ordered = /\d+\./.test(listItem[1] ?? '');
      if (!list || list.ordered !== ordered) {
        flushList(`l${idx}`);
        list = { ordered, items: [] };
      }
      list.items.push(listItem[2] ?? '');
    } else if (line.trim() === '') {
      flushList(`l${idx}`);
    } else {
      flushList(`l${idx}`);
      blocks.push(<p key={key} className="whitespace-pre-wrap break-words">{renderInline(line, key)}</p>);
    }
  });
  flushList('lend');

  return <div className={`space-y-1 ${className ?? ''}`}>{blocks}</div>;
}
