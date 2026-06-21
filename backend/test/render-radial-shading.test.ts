import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renderPdfPages } from '../src/worker/poppler';

/**
 * Builds a minimal one-page PDF whose content fills a rectangle with an axial
 * (`ShadingType 2`) pattern — the exact construct that drove pdf.js into
 * `RadialAxialShadingPattern.getPattern()`, which calls `pattern.setTransform(new
 * DOMMatrix(...))`. Byte offsets are computed as each object is appended, so the
 * xref table stays accurate without manual counting; pdf.js also falls back to
 * scanning for objects directly if the xref is ever slightly off.
 */
function buildAxialShadingPdf(): Buffer {
  const objects: string[] = [];
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>';
  objects[3] =
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] '
    + '/Resources << /Pattern << /P1 5 0 R >> >> /Contents 4 0 R >>';
  const content = '/Pattern cs\n/P1 scn\n0 0 100 100 re\nf\n';
  objects[4] = `<< /Length ${Buffer.byteLength(content, 'utf8')} >>\nstream\n${content}endstream`;
  objects[5] = '<< /Type /Pattern /PatternType 2 /Shading 6 0 R >>';
  objects[6] =
    '<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [0 0 100 100] '
    + '/Function 7 0 R /Extend [true true] >>';
  objects[7] = '<< /FunctionType 2 /Domain [0 1] /C0 [1 0 0] /C1 [0 0 1] /N 1 >>';

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let i = 1; i <= 7; i++) {
    offsets[i] = Buffer.byteLength(pdf, 'utf8');
    pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 8\n0000000000 65535 f \n`;
  for (let i = 1; i <= 7; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, 'utf8');
}

test('renderPdfPages renders a page that fills with an axial shading pattern (regression for "Expected DOMMatrix")', async () => {
  const tmpFile = path.join(os.tmpdir(), `render-radial-shading-${Date.now()}.pdf`);
  fs.writeFileSync(tmpFile, buildAxialShadingPdf());
  try {
    const result = await renderPdfPages(tmpFile, 72);
    assert.equal(result.pageCount, 1);
    assert.equal(result.pages.length, 1);
    assert.ok(result.pages[0].length > 0, 'expected a non-empty rendered PNG buffer');
    // PNG magic bytes, to confirm we actually got back image data and not a thrown error swallowed somewhere.
    assert.deepEqual(result.pages[0].subarray(0, 8), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  } finally {
    fs.rmSync(tmpFile, { force: true });
  }
});
