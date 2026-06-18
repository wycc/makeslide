import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../src/config';
import { figureManifestPath } from '../src/services/storage';
import { readExistingManifest } from '../src/worker/steps/extractPdfFigures';

function manifestDirFor(pdfId: string): string {
  return path.join(config.storageRoot, pdfId);
}

test('readExistingManifest returns null when the manifest file does not exist', async () => {
  const pdfId = 'figparse-missing-01';
  const manifestPath = figureManifestPath(pdfId);
  fs.rmSync(manifestDirFor(pdfId), { recursive: true, force: true });

  const result = await readExistingManifest(pdfId, manifestPath);
  assert.equal(result, null);
});

test('readExistingManifest parses a valid manifest file', async () => {
  const pdfId = 'figparse-valid-01';
  const dir = manifestDirFor(pdfId);
  fs.mkdirSync(dir, { recursive: true });
  const manifestPath = figureManifestPath(pdfId);
  const manifest = {
    pdfId,
    generatedAt: new Date().toISOString(),
    pages: [{ pageNumber: 1, figures: [] }],
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest), 'utf8');

  try {
    const result = await readExistingManifest(pdfId, manifestPath);
    assert.deepEqual(result, manifest);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('readExistingManifest returns null instead of throwing when the manifest file is corrupted', async () => {
  const pdfId = 'figparse-corrupt-01';
  const dir = manifestDirFor(pdfId);
  fs.mkdirSync(dir, { recursive: true });
  const manifestPath = figureManifestPath(pdfId);
  fs.writeFileSync(manifestPath, '{ this is not valid json', 'utf8');

  try {
    const result = await readExistingManifest(pdfId, manifestPath);
    assert.equal(result, null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('readExistingManifest returns null for an empty manifest file', async () => {
  const pdfId = 'figparse-empty-01';
  const dir = manifestDirFor(pdfId);
  fs.mkdirSync(dir, { recursive: true });
  const manifestPath = figureManifestPath(pdfId);
  fs.writeFileSync(manifestPath, '', 'utf8');

  try {
    const result = await readExistingManifest(pdfId, manifestPath);
    assert.equal(result, null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
