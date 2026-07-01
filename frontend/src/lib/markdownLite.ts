// 極簡 markdown 解析器：僅支援標題（# / ## / ###）、無序清單（- / *）、有序清單（1. ）、
// 段落與行內粗體（**text**）。刻意不支援原始 HTML、連結、圖片等，避免在測驗規則等
// 使用者可自訂的內容中引入 XSS 風險。回傳純資料結構（不含 JSX），方便單元測試；實際
// 渲染由 React 元件消費這些區塊。專案目前沒有 markdown 渲染器，本檔提供最小可用子集。

export type MdInline = { text: string; bold: boolean };

export type MdBlock =
  | { type: 'heading'; level: 1 | 2 | 3; inline: MdInline[] }
  | { type: 'paragraph'; inline: MdInline[] }
  | { type: 'list'; ordered: boolean; items: MdInline[][] };

/** 解析行內粗體 `**text**`，其餘視為一般文字。回傳依序排列的片段。 */
export function parseInline(text: string): MdInline[] {
  const out: MdInline[] = [];
  const regex = /\*\*(.+?)\*\*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      out.push({ text: text.slice(lastIndex, match.index), bold: false });
    }
    out.push({ text: match[1] ?? '', bold: true });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    out.push({ text: text.slice(lastIndex), bold: false });
  }
  return out.length > 0 ? out : [{ text: '', bold: false }];
}

const HEADING_RE = /^(#{1,3})\s+(.*)$/;
const UNORDERED_RE = /^[-*]\s+(.*)$/;
const ORDERED_RE = /^\d+\.\s+(.*)$/;

/** 把 markdown 字串解析成區塊陣列，供渲染層消費。 */
export function parseMarkdownLite(md: string): MdBlock[] {
  const blocks: MdBlock[] = [];
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push({ type: 'paragraph', inline: parseInline(paragraph.join(' ')) });
    paragraph = [];
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (line === '') {
      flushParagraph();
      continue;
    }
    const heading = HEADING_RE.exec(line);
    if (heading) {
      flushParagraph();
      blocks.push({ type: 'heading', level: (heading[1] ?? '').length as 1 | 2 | 3, inline: parseInline(heading[2] ?? '') });
      continue;
    }
    const ordered = ORDERED_RE.exec(line);
    const unordered = UNORDERED_RE.exec(line);
    if (ordered || unordered) {
      flushParagraph();
      const wantOrdered = Boolean(ordered);
      const itemText = (ordered ? ordered[1] : unordered?.[1]) ?? '';
      const last = blocks[blocks.length - 1];
      if (last && last.type === 'list' && last.ordered === wantOrdered) {
        last.items.push(parseInline(itemText));
      } else {
        blocks.push({ type: 'list', ordered: wantOrdered, items: [parseInline(itemText)] });
      }
      continue;
    }
    paragraph.push(line);
  }
  flushParagraph();
  return blocks;
}
