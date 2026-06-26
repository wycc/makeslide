import fs from 'node:fs';
import sharp from 'sharp';
import { nanoid } from 'nanoid';
import { coverImagePath, pageImagePath, pageTextPath, sourceTextPath } from '../../services/storage';
import { generateCoverThumbnail, generatePageThumbnail } from '../../services/thumbnails';
import { escapeXml } from '../../escapeXml';

const PAGE_WIDTH = 1920;
const PAGE_HEIGHT = 1080;
const MARGIN_X = 120;
const MARGIN_Y = 96;
const FONT_SIZE = 44;
const LINE_HEIGHT = 64;
const CHARS_PER_LINE = 34;
const LINES_PER_PAGE = 12;

export interface RenderTextPagesResult {
  pageCount: number;
  pagePaths: string[];
}

// Re-exported (imported at top) so existing importers/tests keep importing it from this module.
export { escapeXml };

export function splitLines(raw: string): string[] {
  const normalized = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const sourceLines = normalized.split('\n');
  const out: string[] = [];
  for (const line of sourceLines) {
    const trimmed = line.trimEnd();
    if (trimmed.length === 0) {
      out.push('');
      continue;
    }
    for (let i = 0; i < trimmed.length; i += CHARS_PER_LINE) {
      out.push(trimmed.slice(i, i + CHARS_PER_LINE));
    }
  }
  return out.length > 0 ? out : [''];
}

export function toPages(lines: string[]): string[] {
  const pages: string[] = [];
  for (let i = 0; i < lines.length; i += LINES_PER_PAGE) {
    pages.push(lines.slice(i, i + LINES_PER_PAGE).join('\n'));
  }
  return pages.length > 0 ? pages : [''];
}

async function renderPageImage(content: string, outPath: string): Promise<void> {
  const lines = content.split('\n');
  const tspans = lines
    .map((line, idx) => {
      const x = MARGIN_X;
      const y = MARGIN_Y + FONT_SIZE + idx * LINE_HEIGHT;
      return `<tspan x="${x}" y="${y}">${escapeXml(line)}</tspan>`;
    })
    .join('');
  const svg = `
<svg width="${PAGE_WIDTH}" height="${PAGE_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="#0f172a" />
  <text font-family="Noto Sans CJK TC, PingFang TC, Microsoft JhengHei, sans-serif" font-size="${FONT_SIZE}" fill="#e2e8f0">${tspans}</text>
</svg>`;
  await sharp(Buffer.from(svg)).png().toFile(outPath);
}

export async function renderTextPages(pdfId: string): Promise<RenderTextPagesResult> {
  const source = sourceTextPath(pdfId);
  const raw = await fs.promises.readFile(source, 'utf8');
  const pages = toPages(splitLines(raw));
  const pageCount = pages.length;
  const pagePaths: string[] = [];

  for (let i = 0; i < pages.length; i++) {
    const pageUid = nanoid(10);
    const imagePath = pageImagePath(pdfId, pageUid);
    const textPath = pageTextPath(pdfId, pageUid);
    await renderPageImage(pages[i] ?? '', imagePath);
    await generatePageThumbnail(pdfId, pageUid, imagePath);
    await fs.promises.writeFile(textPath, pages[i] ?? '', 'utf8');
    pagePaths.push(imagePath);
  }

  if (pagePaths[0]) {
    const coverPath = coverImagePath(pdfId);
    await fs.promises.copyFile(pagePaths[0], coverPath);
    await generateCoverThumbnail(pdfId, coverPath);
  }

  return { pageCount, pagePaths };
}
