import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../src/config';
import { extractPdfFigures } from '../src/worker/steps/extractPdfFigures';
import { figureImageAbsPath, getPageFigures, loadFigureManifest } from '../src/services/pdfFigures';

// Real production PDF checked into storage/ (gitignored), used as a fixture
// because it contains an embedded matplotlib chart with a "Figure 10" caption
// on page 26 - good coverage for bbox + caption matching against real data.
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

    // Pages with no embedded images should have no figures.
    assert.deepEqual(getPageFigures(PDF_ID, 2), []);
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
