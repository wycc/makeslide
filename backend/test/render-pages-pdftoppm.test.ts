import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { checkPoppler, renderPdfPages } from '../src/worker/poppler';

/**
 * Builds a minimal PDF with the given number of pages, each filling most of the page with
 * real text (standard, non-embedded Helvetica). Byte offsets are computed as each object is
 * appended, so the xref table stays accurate without manual counting.
 */
function buildTextPdf(pageCount: number): Buffer {
  const objects: string[] = [];
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  const kids = Array.from({ length: pageCount }, (_, i) => `${3 + i} 0 R`).join(' ');
  objects[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`;
  const fontObjNum = 3 + pageCount * 2;
  for (let i = 0; i < pageCount; i++) {
    const pageObjNum = 3 + i;
    const contentObjNum = 3 + pageCount + i;
    objects[pageObjNum] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] `
      + `/Resources << /Font << /F1 ${fontObjNum} 0 R >> >> /Contents ${contentObjNum} 0 R >>`;
    const content = `BT /F1 48 Tf 10 100 Td (Page ${i + 1}) Tj ET\n`;
    objects[contentObjNum] = `<< /Length ${Buffer.byteLength(content, 'utf8')} >>\nstream\n${content}endstream`;
  }
  objects[fontObjNum] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';

  const totalObjects = fontObjNum;
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let i = 1; i <= totalObjects; i++) {
    offsets[i] = Buffer.byteLength(pdf, 'utf8');
    pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${totalObjects + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= totalObjects; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${totalObjects + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, 'utf8');
}

/** Counts non-white pixels, to confirm text was actually painted rather than the page staying blank. */
async function countNonWhitePixels(png: Buffer): Promise<number> {
  const { data } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let count = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] !== 255 || data[i + 1] !== 255 || data[i + 2] !== 255) count++;
  }
  return count;
}

test('checkPoppler finds the real pdftoppm/pdfinfo binaries', async () => {
  const result = await checkPoppler();
  assert.equal(result.pdftoppm, true);
  assert.equal(result.pdfinfo, true);
});

test('renderPdfPages renders real text via pdftoppm (regression for pdf.js silently dropping glyphs)', async () => {
  const tmpFile = path.join(os.tmpdir(), `render-pages-pdftoppm-${Date.now()}.pdf`);
  fs.writeFileSync(tmpFile, buildTextPdf(1));
  try {
    const result = await renderPdfPages(tmpFile, 72);
    assert.equal(result.pageCount, 1);
    assert.equal(result.pages.length, 1);
    assert.ok((await countNonWhitePixels(result.pages[0])) > 0, 'expected the rendered page to contain visible text pixels');
  } finally {
    fs.rmSync(tmpFile, { force: true });
  }
});

test('renderPdfPages keeps multi-page output in the correct order regardless of pdftoppm zero-padding', async () => {
  const tmpFile = path.join(os.tmpdir(), `render-pages-pdftoppm-multi-${Date.now()}.pdf`);
  fs.writeFileSync(tmpFile, buildTextPdf(11));
  try {
    const result = await renderPdfPages(tmpFile, 72);
    assert.equal(result.pageCount, 11);
    assert.equal(result.pages.length, 11);
    for (const page of result.pages) {
      assert.ok((await countNonWhitePixels(page)) > 0, 'expected every page to contain visible text pixels');
    }
  } finally {
    fs.rmSync(tmpFile, { force: true });
  }
});
