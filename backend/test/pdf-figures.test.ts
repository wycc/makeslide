import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../src/config';
import { extractPdfFigures } from '../src/worker/steps/extractPdfFigures';
import {
  buildFigureReferenceNotes,
  figureImageAbsPath,
  findFigureById,
  getFigureReferencesForPage,
  getFigureReferencesForPages,
  getPageFigures,
  loadFigureManifest,
  loadFigureReferenceFiles,
  loadFigureSelection,
  loadSplitPageFigureMap,
  saveFigureSelection,
  saveSplitPageFigureMap,
} from '../src/services/pdfFigures';
import { figureSelectionPath, splitFigureMapPath } from '../src/services/storage';
import type { FigureEntry } from '../src/worker/steps/extractPdfFigures';

// Real production PDF checked into storage/ (gitignored), used as a fixture
// because it contains both an embedded raster chart with a "Figure 10" caption
// on page 26 and pure-vector figures (Figure 1-9, on pages 2 and 4-9, including
// multi-panel figures split into two clusters on pages 7 and 9) - good coverage
// for V2 vector clustering, multi-panel grouping, and caption matching against
// real data.
const PDF_ID = 'jBaLIg8vMa';
const PAGE_COUNT = 37;
const PDF_DIR = path.join(config.storageRoot, PDF_ID);
const SOURCE_PDF = path.join(PDF_DIR, 'source.pdf');

function cleanupArtifacts(): void {
  fs.rmSync(path.join(PDF_DIR, 'figures.json'), { force: true });
  fs.rmSync(path.join(PDF_DIR, 'figures'), { recursive: true, force: true });
}

test('extractPdfFigures extracts figures + captions from a real PDF', async (t) => {
  if (!fs.existsSync(SOURCE_PDF)) {
    t.skip('fixture PDF not present in storage/');
    return;
  }

  cleanupArtifacts();
  try {
    const { manifest, figureCount } = await extractPdfFigures(PDF_ID, PAGE_COUNT);
    assert.equal(manifest.pdfId, PDF_ID);
    assert.equal(manifest.pages.length, PAGE_COUNT);
    assert.ok(figureCount >= 1, 'expected at least one figure to be extracted');

    // Page 26 contains a large bar chart with a "Figure 10: ..." caption directly below it.
    const page26 = getPageFigures(PDF_ID, 26);
    assert.equal(page26.length, 1);
    const fig = page26[0]!;
    assert.match(fig.caption ?? '', /Figure 10/);
    assert.match(fig.context ?? '', /Figure 10/);
    const areaPct = fig.bbox.widthPct * fig.bbox.heightPct * 100;
    assert.ok(areaPct > 5, `expected figure area > 5%, got ${areaPct}`);
    assert.ok(fs.existsSync(figureImageAbsPath(PDF_ID, fig)), 'extracted PNG should exist on disk');

    // getFigureReferencesForPage exposes the same figure for the regenerate-image flow.
    const refs = getFigureReferencesForPage(PDF_ID, 26);
    assert.deepEqual(refs, page26);
    const notes = buildFigureReferenceNotes(refs);
    assert.match(notes ?? '', /Figure 10/);
    assert.match(notes ?? '', /參考圖表 1/);

    // V2: pure-vector figures (Figure 1-9) are detected via constructPath clustering,
    // grouped per multi-panel figure, full-page-rendered + cropped, and matched to
    // their "Figure N:" caption even when it shares a content-stream line with
    // trailing axis labels or sub-panel markers (e.g. "(a) (b)Figure 2: ...").
    assert.equal(figureCount, 23, 'expected exactly 23 figures across the document');

    const page2 = getPageFigures(PDF_ID, 2);
    assert.equal(page2.length, 1);
    assert.equal(page2[0]!.source, 'vector');
    assert.match(page2[0]!.caption ?? '', /Figure 1:/);
    assert.ok(fs.existsSync(figureImageAbsPath(PDF_ID, page2[0]!)));

    // Pages 4-9: single-panel figures (Figure 2-4, 7) and multi-panel figures split
    // into two clusters each (Figure 5+6 on page 7, Figure 8+9 on page 9).
    const expectedVectorCaptions: Record<number, RegExp[]> = {
      4: [/Figure 2:/],
      5: [/Figure 3:/],
      6: [/Figure 4:/],
      7: [/Figure 6:/, /Figure 5:/],
      8: [/Figure 7:/],
      9: [/Figure 9:/, /Figure 8:/],
    };
    for (const [pageNumStr, captionPatterns] of Object.entries(expectedVectorCaptions)) {
      const pageNum = Number(pageNumStr);
      const figs = getPageFigures(PDF_ID, pageNum);
      assert.equal(figs.length, captionPatterns.length, `page ${pageNum} figure count`);
      figs.forEach((fig, i) => {
        assert.equal(fig.source, 'vector', `page ${pageNum} figure ${i} source`);
        assert.match(fig.caption ?? '', captionPatterns[i]!, `page ${pageNum} figure ${i} caption`);
        assert.ok(fs.existsSync(figureImageAbsPath(PDF_ID, fig)), `page ${pageNum} figure ${i} PNG should exist`);
      });
    }

    // Page 3 has no qualifying vector clusters or embedded images.
    assert.deepEqual(getPageFigures(PDF_ID, 3), []);

    // Page 1 only has small logo-sized images (< 1% of page area) - filtered out.
    assert.deepEqual(getPageFigures(PDF_ID, 1), []);

    // Idempotent: second call reuses the existing manifest instead of recomputing.
    const second = await extractPdfFigures(PDF_ID, PAGE_COUNT);
    assert.deepEqual(second.manifest, manifest);
  } finally {
    cleanupArtifacts();
  }
});

test('loadFigureManifest / getPageFigures return null/[] when no manifest exists', () => {
  assert.equal(loadFigureManifest('does-not-exist'), null);
  assert.deepEqual(getPageFigures('does-not-exist', 1), []);
});

test('getFigureReferencesForPage caps at `max`, keeping the largest figures first', () => {
  const SYNTH_PDF_ID = 'pdf-figures-synth-01';
  const synthDir = path.join(config.storageRoot, SYNTH_PDF_ID);
  fs.mkdirSync(synthDir, { recursive: true });
  const figure = (id: string, areaPct: number): FigureEntry => ({
    id,
    imagePath: `figures/${id}.png`,
    width: 100,
    height: 100,
    bbox: { xPct: 0, yPct: 0, widthPct: areaPct, heightPct: 1 },
    caption: null,
    context: null,
  });
  try {
    fs.writeFileSync(
      path.join(synthDir, 'figures.json'),
      JSON.stringify({
        pdfId: SYNTH_PDF_ID,
        generatedAt: new Date().toISOString(),
        pages: [
          { pageNumber: 1, figures: [figure('small', 0.1), figure('large', 0.6), figure('medium', 0.3)] },
        ],
      }),
      'utf8',
    );

    const refs = getFigureReferencesForPage(SYNTH_PDF_ID, 1, 2);
    assert.deepEqual(refs.map((f) => f.id), ['large', 'medium']);

    // No cap needed when figure count is within `max`.
    assert.equal(getFigureReferencesForPage(SYNTH_PDF_ID, 1, 5).length, 3);
  } finally {
    fs.rmSync(synthDir, { recursive: true, force: true });
  }
});

test('buildFigureReferenceNotes formats captions and falls back when missing', () => {
  assert.equal(buildFigureReferenceNotes([]), null);

  const withCaption: FigureEntry = {
    id: 'p1-img1',
    imagePath: 'figures/p1-img1.png',
    width: 100,
    height: 100,
    bbox: { xPct: 0, yPct: 0, widthPct: 0.5, heightPct: 0.5 },
    caption: 'Figure 1: revenue growth',
    context: 'Figure 1: revenue growth across regions',
  };
  const withoutCaption: FigureEntry = { ...withCaption, id: 'p1-img2', caption: null, context: null };

  const notes = buildFigureReferenceNotes([withCaption, withoutCaption]);
  assert.match(notes ?? '', /參考圖表 1：Figure 1: revenue growth/);
  assert.match(notes ?? '', /參考圖表 2：\(無圖說文字\)/);
});

test('getFigureReferencesForPages aggregates and dedupes figures across multiple pages, capped by area', () => {
  const SYNTH_PDF_ID = 'pdf-figures-synth-pages-01';
  const synthDir = path.join(config.storageRoot, SYNTH_PDF_ID);
  fs.mkdirSync(synthDir, { recursive: true });
  const figure = (id: string, areaPct: number): FigureEntry => ({
    id,
    imagePath: `figures/${id}.png`,
    width: 100,
    height: 100,
    bbox: { xPct: 0, yPct: 0, widthPct: areaPct, heightPct: 1 },
    caption: null,
    context: null,
  });
  try {
    fs.writeFileSync(
      path.join(synthDir, 'figures.json'),
      JSON.stringify({
        pdfId: SYNTH_PDF_ID,
        generatedAt: new Date().toISOString(),
        pages: [
          { pageNumber: 1, figures: [figure('shared', 0.2), figure('small', 0.1)] },
          { pageNumber: 2, figures: [figure('shared', 0.2), figure('large', 0.6)] },
        ],
      }),
      'utf8',
    );

    // Figure 'shared' appears on both pages but is only counted once.
    const all = getFigureReferencesForPages(SYNTH_PDF_ID, [1, 2], 5);
    assert.deepEqual(all.map((f) => f.id).sort(), ['large', 'shared', 'small']);

    // Capped by area: keep the two largest across both pages.
    const capped = getFigureReferencesForPages(SYNTH_PDF_ID, [1, 2], 2);
    assert.deepEqual(capped.map((f) => f.id), ['large', 'shared']);

    // Empty when no figures exist on the given pages.
    assert.deepEqual(getFigureReferencesForPages(SYNTH_PDF_ID, [3, 4]), []);
  } finally {
    fs.rmSync(synthDir, { recursive: true, force: true });
  }
});

test('loadSplitPageFigureMap / saveSplitPageFigureMap persist the AI-split-page -> source-PDF-page mapping', () => {
  const PDF_ID = 'pdf-figures-split-map-01';
  const dir = path.join(config.storageRoot, PDF_ID);
  fs.mkdirSync(dir, { recursive: true });
  try {
    assert.equal(loadSplitPageFigureMap(PDF_ID), null);

    const map = { 1: [1], 2: [2, 3] };
    saveSplitPageFigureMap(PDF_ID, map);
    assert.ok(fs.existsSync(splitFigureMapPath(PDF_ID)));
    assert.deepEqual(loadSplitPageFigureMap(PDF_ID), map);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('findFigureById finds a figure across pages by id, or returns null', () => {
  const SYNTH_PDF_ID = 'pdf-figures-synth-find-01';
  const synthDir = path.join(config.storageRoot, SYNTH_PDF_ID);
  fs.mkdirSync(synthDir, { recursive: true });
  const figure = (id: string): FigureEntry => ({
    id,
    imagePath: `figures/${id}.png`,
    width: 100,
    height: 100,
    bbox: { xPct: 0, yPct: 0, widthPct: 0.5, heightPct: 0.5 },
    caption: null,
    context: null,
  });
  try {
    fs.writeFileSync(
      path.join(synthDir, 'figures.json'),
      JSON.stringify({
        pdfId: SYNTH_PDF_ID,
        generatedAt: new Date().toISOString(),
        pages: [
          { pageNumber: 1, figures: [figure('p1-a')] },
          { pageNumber: 2, figures: [figure('p2-b')] },
        ],
      }),
      'utf8',
    );

    assert.equal(findFigureById(SYNTH_PDF_ID, 'p2-b')?.id, 'p2-b');
    assert.equal(findFigureById(SYNTH_PDF_ID, 'does-not-exist'), null);
    assert.equal(findFigureById('does-not-exist-pdf', 'p1-a'), null);
  } finally {
    fs.rmSync(synthDir, { recursive: true, force: true });
  }
});

test('getFigureReferencesForPage / getFigureReferencesForPages drop excluded figure ids before capping', () => {
  const SYNTH_PDF_ID = 'pdf-figures-synth-exclude-01';
  const synthDir = path.join(config.storageRoot, SYNTH_PDF_ID);
  fs.mkdirSync(synthDir, { recursive: true });
  const figure = (id: string, areaPct: number): FigureEntry => ({
    id,
    imagePath: `figures/${id}.png`,
    width: 100,
    height: 100,
    bbox: { xPct: 0, yPct: 0, widthPct: areaPct, heightPct: 1 },
    caption: null,
    context: null,
  });
  try {
    fs.writeFileSync(
      path.join(synthDir, 'figures.json'),
      JSON.stringify({
        pdfId: SYNTH_PDF_ID,
        generatedAt: new Date().toISOString(),
        pages: [
          { pageNumber: 1, figures: [figure('small', 0.1), figure('large', 0.6), figure('medium', 0.3)] },
          { pageNumber: 2, figures: [figure('other', 0.9)] },
        ],
      }),
      'utf8',
    );

    // Excluding the largest figure leaves the remaining two within the cap (no resort needed).
    const refs = getFigureReferencesForPage(SYNTH_PDF_ID, 1, 2, new Set(['large']));
    assert.deepEqual(refs.map((f) => f.id).sort(), ['medium', 'small']);

    // Excluding down to just one figure when max=1 keeps the largest of the remaining.
    const capped = getFigureReferencesForPage(SYNTH_PDF_ID, 1, 1, new Set(['large']));
    assert.deepEqual(capped.map((f) => f.id), ['medium']);

    // Excluding everything yields an empty list.
    assert.deepEqual(getFigureReferencesForPage(SYNTH_PDF_ID, 1, 2, new Set(['large', 'medium', 'small'])), []);

    // getFigureReferencesForPages also drops excluded ids (including duplicates across pages).
    const all = getFigureReferencesForPages(SYNTH_PDF_ID, [1, 2], 5, new Set(['large']));
    assert.deepEqual(all.map((f) => f.id).sort(), ['medium', 'other', 'small']);
  } finally {
    fs.rmSync(synthDir, { recursive: true, force: true });
  }
});

test('loadFigureSelection / saveFigureSelection persist per-page figure exclusions', () => {
  const PDF_ID = 'pdf-figures-selection-01';
  const PAGE_UID = 'selectuid1';
  const dir = path.join(config.storageRoot, PDF_ID, 'pages');
  fs.mkdirSync(dir, { recursive: true });
  try {
    // Defaults to an empty exclusion list when no file exists yet.
    assert.deepEqual(loadFigureSelection(PDF_ID, PAGE_UID), { excluded: [] });

    saveFigureSelection(PDF_ID, PAGE_UID, { excluded: ['p1-img1', 'p1-img2'] });
    assert.ok(fs.existsSync(figureSelectionPath(PDF_ID, PAGE_UID)));
    assert.deepEqual(loadFigureSelection(PDF_ID, PAGE_UID), { excluded: ['p1-img1', 'p1-img2'] });

    // Corrupted/invalid file falls back to an empty list rather than throwing.
    fs.writeFileSync(figureSelectionPath(PDF_ID, PAGE_UID), JSON.stringify({ excluded: ['ok', 42, null] }), 'utf8');
    assert.deepEqual(loadFigureSelection(PDF_ID, PAGE_UID), { excluded: ['ok'] });
  } finally {
    fs.rmSync(path.join(config.storageRoot, PDF_ID), { recursive: true, force: true });
  }
});

test('loadFigureReferenceFiles skips a figure whose image file is missing, without throwing', async () => {
  const SYNTH_PDF_ID = 'pdf-figures-synth-resilient-01';
  const synthDir = path.join(config.storageRoot, SYNTH_PDF_ID);
  const figuresDir = path.join(synthDir, 'figures');
  fs.mkdirSync(figuresDir, { recursive: true });
  const figure = (id: string): FigureEntry => ({
    id,
    imagePath: `figures/${id}.png`,
    width: 1,
    height: 1,
    bbox: { xPct: 0, yPct: 0, widthPct: 0.5, heightPct: 0.5 },
    caption: `Figure ${id}`,
    context: null,
  });
  // A 1x1 transparent PNG, just enough bytes for the file to exist and be readable.
  const tinyPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYIA=',
    'base64',
  );
  try {
    fs.writeFileSync(path.join(figuresDir, 'present.png'), tinyPng);
    // Deliberately do not write a file for "missing" — its manifest entry
    // exists but the image was removed/never written.

    const { figures, files } = await loadFigureReferenceFiles(SYNTH_PDF_ID, [figure('present'), figure('missing')]);

    assert.deepEqual(figures.map((f) => f.id), ['present']);
    assert.equal(files.length, 1);
  } finally {
    fs.rmSync(synthDir, { recursive: true, force: true });
  }
});

test('loadFigureReferenceFiles returns an empty result for an empty input without touching the filesystem', async () => {
  const { figures, files } = await loadFigureReferenceFiles('pdf-figures-synth-resilient-empty', []);
  assert.deepEqual(figures, []);
  assert.deepEqual(files, []);
});

test('loadFigureReferenceFiles loads every figure when all image files are present', async () => {
  const SYNTH_PDF_ID = 'pdf-figures-synth-resilient-all-present-01';
  const synthDir = path.join(config.storageRoot, SYNTH_PDF_ID);
  const figuresDir = path.join(synthDir, 'figures');
  fs.mkdirSync(figuresDir, { recursive: true });
  const tinyPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYIA=',
    'base64',
  );
  const figure = (id: string): FigureEntry => ({
    id,
    imagePath: `figures/${id}.png`,
    width: 1,
    height: 1,
    bbox: { xPct: 0, yPct: 0, widthPct: 0.5, heightPct: 0.5 },
    caption: null,
    context: null,
  });
  try {
    fs.writeFileSync(path.join(figuresDir, 'a.png'), tinyPng);
    fs.writeFileSync(path.join(figuresDir, 'b.png'), tinyPng);

    const { figures, files } = await loadFigureReferenceFiles(SYNTH_PDF_ID, [figure('a'), figure('b')]);
    assert.deepEqual(figures.map((f) => f.id), ['a', 'b']);
    assert.equal(files.length, 2);
  } finally {
    fs.rmSync(synthDir, { recursive: true, force: true });
  }
});
