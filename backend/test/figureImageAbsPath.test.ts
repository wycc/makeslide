import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { figureImageAbsPath } from '../src/services/pdfFigures';
import { pdfDir } from '../src/services/storage';
import type { FigureEntry } from '../src/worker/steps/extractPdfFigures';

const figure = (imagePath: string): FigureEntry => ({ imagePath } as FigureEntry);

test('figureImageAbsPath resolves a normal figures/ path inside the pdf dir', () => {
  const abs = figureImageAbsPath('pdf-1', figure('figures/p1-abc.png'));
  assert.equal(abs, path.join(pdfDir('pdf-1'), 'figures', 'p1-abc.png'));
});

test('figureImageAbsPath rejects a traversal imagePath escaping the pdf dir', () => {
  assert.throws(() => figureImageAbsPath('pdf-1', figure('../pdf-2/figures/secret.png')));
  assert.throws(() => figureImageAbsPath('pdf-1', figure('../../etc/passwd')));
});
