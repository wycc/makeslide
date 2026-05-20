import fs from 'node:fs';
import sharp from 'sharp';

export interface HandoutPdfPage {
  pageNumber: number;
  imagePath: string;
  script: string;
}

const PAGE_WIDTH = 842;
const PAGE_HEIGHT = 595;
const MARGIN = 36;
const IMAGE_MAX_WIDTH = PAGE_WIDTH - MARGIN * 2;
const IMAGE_MAX_HEIGHT = 350;
const TEXT_BOTTOM_MARGIN = 40;
const TEXT_GAP_FROM_IMAGE = 18;
const TEXT_SIZE = 11;
const TEXT_LEADING = 15;
const MAX_TEXT_LINES = 8;

function escapePdfText(input: string): string {
  return input.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function sanitizePdfText(input: string): string {
  return input.replace(/\r\n/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ');
}

function wrapText(input: string, maxChars: number): string[] {
  const lines: string[] = [];
  for (const paragraph of sanitizePdfText(input).split(/\n+/)) {
    let remaining = paragraph.trim();
    if (!remaining) continue;
    while (Array.from(remaining).length > maxChars) {
      const chars = Array.from(remaining);
      let cutAt = Math.min(maxChars, chars.length);
      const chunk = chars.slice(0, cutAt).join('');
      const spaced = chunk.lastIndexOf(' ');
      if (spaced > 0) cutAt = spaced;
      lines.push(chars.slice(0, cutAt).join('').trim());
      remaining = chars.slice(cutAt).join('').trim();
    }
    if (remaining) lines.push(remaining);
  }
  return lines;
}

function toUtf16BeHex(text: string): string {
  const utf16le = Buffer.from(text, 'utf16le');
  const out = Buffer.alloc(utf16le.length + 2);
  // BOM FEFF
  out[0] = 0xfe;
  out[1] = 0xff;
  for (let i = 0; i < utf16le.length; i += 2) {
    out[i + 2] = utf16le[i + 1] ?? 0;
    out[i + 3] = utf16le[i] ?? 0;
  }
  return out.toString('hex').toUpperCase();
}

function pdfBytes(text: string): Buffer {
  return Buffer.from(text, 'binary');
}

async function normalizeJpeg(imagePath: string): Promise<{ data: Buffer; width: number; height: number }> {
  const image = sharp(imagePath).rotate();
  const meta = await image.metadata();
  const width = meta.width ?? 1920;
  const height = meta.height ?? 1080;
  const data = await image.jpeg({ quality: 88 }).toBuffer();
  return { data, width, height };
}

export async function buildHandoutPdf(pages: HandoutPdfPage[], title: string): Promise<Buffer> {
  if (pages.length === 0) throw new Error('No pages available for handout PDF');
  const objects: Buffer[] = [];
  const addObject = (body: Buffer | string): number => {
    objects.push(Buffer.isBuffer(body) ? body : pdfBytes(body));
    return objects.length;
  };
  const catalogId = addObject('');
  const pagesId = addObject('');
  // Use a built-in CJK composite font so Chinese text can render correctly.
  const fontId = addObject('<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> >>] >>\n');
  const pageIds: number[] = [];

  for (const page of pages) {
    const image = await normalizeJpeg(page.imagePath);
    const imageId = addObject(Buffer.concat([
      pdfBytes(`<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.data.length} >>\nstream\n`),
      image.data,
      pdfBytes('\nendstream\n'),
    ]));
    const scale = Math.min(IMAGE_MAX_WIDTH / image.width, IMAGE_MAX_HEIGHT / image.height);
    const drawWidth = image.width * scale;
    const drawHeight = image.height * scale;
    const imageX = (PAGE_WIDTH - drawWidth) / 2;
    const imageY = PAGE_HEIGHT - MARGIN - drawHeight;
    const lines = wrapText(page.script || 'No transcript available.', 54).slice(0, MAX_TEXT_LINES);
    const title = `第 ${page.pageNumber} 頁逐字稿：`;
    const textStartY = Math.max(TEXT_BOTTOM_MARGIN, imageY - TEXT_GAP_FROM_IMAGE);
    const textOps = [
      'BT',
      `/F1 ${TEXT_SIZE} Tf`,
      `${MARGIN} ${textStartY.toFixed(2)} Td`,
      `${TEXT_LEADING} TL`,
      `<${toUtf16BeHex(title)}> Tj`,
      'T*',
      ...(lines.length ? lines : ['No transcript available.']).map((line) => `<${toUtf16BeHex(line)}> Tj T*`),
      'ET',
    ].join('\n');
    const stream = ['q', `${drawWidth.toFixed(2)} 0 0 ${drawHeight.toFixed(2)} ${imageX.toFixed(2)} ${imageY.toFixed(2)} cm`, `/Im${page.pageNumber} Do`, 'Q', textOps].join('\n');
    const contentId = addObject(`<< /Length ${Buffer.byteLength(stream, 'binary')} >>\nstream\n${stream}\nendstream\n`);
    const pageId = addObject(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 ${fontId} 0 R >> /XObject << /Im${page.pageNumber} ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>\n`);
    pageIds.push(pageId);
  }

  objects[catalogId - 1] = pdfBytes(`<< /Type /Catalog /Pages ${pagesId} 0 R >>\n`);
  objects[pagesId - 1] = pdfBytes(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>\n`);
  const header = pdfBytes(`%PDF-1.4\n% ${escapePdfText(sanitizePdfText(title)).slice(0, 80)}\n`);
  const chunks: Buffer[] = [header];
  const offsets = [0];
  let offset = header.length;
  objects.forEach((body, index) => {
    offsets[index + 1] = offset;
    const prefix = pdfBytes(`${index + 1} 0 obj\n`);
    const suffix = pdfBytes('endobj\n');
    chunks.push(prefix, body, suffix);
    offset += prefix.length + body.length + suffix.length;
  });
  const xrefOffset = offset;
  chunks.push(pdfBytes([`xref\n0 ${objects.length + 1}`, '0000000000 65535 f ', ...offsets.slice(1).map((value) => `${String(value).padStart(10, '0')} 00000 n `), `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>`, `startxref\n${xrefOffset}\n%%EOF\n`].join('\n')));
  return Buffer.concat(chunks);
}

export async function readTextIfExists(filePath: string | null): Promise<string> {
  if (!filePath || !fs.existsSync(filePath)) return '';
  return fs.promises.readFile(filePath, 'utf8');
}
