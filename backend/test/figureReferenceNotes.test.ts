import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFigureReferenceNotes } from '../src/services/pdfFigures';
import type { FigureEntry } from '../src/worker/steps/extractPdfFigures';

function makeFigure(overrides: Partial<FigureEntry> = {}): FigureEntry {
  return {
    id: 'p1-img1',
    imagePath: 'figures/p1-img1.png',
    width: 100,
    height: 80,
    bbox: { xPct: 0.1, yPct: 0.1, widthPct: 0.5, heightPct: 0.5 },
    caption: null,
    context: null,
    ...overrides,
  };
}

test('buildFigureReferenceNotes returns null when there are no figures', () => {
  assert.equal(buildFigureReferenceNotes([]), null);
});

test('buildFigureReferenceNotes lists each figure with a 1-indexed caption', () => {
  const notes = buildFigureReferenceNotes([
    makeFigure({ caption: 'Bar chart of revenue' }),
    makeFigure({ caption: 'Flow diagram' }),
  ]);
  assert.ok(notes);
  assert.ok(notes!.includes('- 參考圖表 1：Bar chart of revenue'));
  assert.ok(notes!.includes('- 參考圖表 2：Flow diagram'));
});

test('buildFigureReferenceNotes prefers caption, falls back to context, then a placeholder', () => {
  const notes = buildFigureReferenceNotes([
    makeFigure({ caption: 'has caption', context: 'ctx' }),
    makeFigure({ caption: '   ', context: 'context fallback' }),
    makeFigure({ caption: null, context: null }),
  ]);
  assert.ok(notes);
  assert.ok(notes!.includes('- 參考圖表 1：has caption'));
  assert.ok(notes!.includes('- 參考圖表 2：context fallback'));
  assert.ok(notes!.includes('- 參考圖表 3：(無圖說文字)'));
});

test('buildFigureReferenceNotes wraps the list with explanatory header and footer lines', () => {
  const notes = buildFigureReferenceNotes([makeFigure({ caption: 'x' })]);
  assert.ok(notes);
  const lines = notes!.split('\n');
  assert.ok(lines[0]!.startsWith('本頁對應的原始 PDF 內含以下圖表'));
  assert.ok(lines[lines.length - 1]!.startsWith('請在生成的投影片圖片中盡量保留'));
  // header + 1 figure line + footer
  assert.equal(lines.length, 3);
});
