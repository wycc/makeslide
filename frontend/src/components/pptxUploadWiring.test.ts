import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { zhTW } from '../locales/zh-TW';
import { en } from '../locales/en';

/**
 * Source-level guards for importing a .pptx from the browser.
 *
 * The backend has had `POST /api/pdfs/from-pptx` since the animated import went in, but nothing
 * in the UI called it: a PowerPoint could only be imported through MCP or curl. These pin the
 * three wires that make the menu entry actually work, each of which fails quietly on its own — a
 * .pptx sent to the PDF endpoint comes back "not a PDF", an unchanged `accept` hides the file in
 * the picker, and the prompt dialog would ask how to generate a deck that already exists.
 */
const here = path.dirname(new URL(import.meta.url).pathname);
const read = (rel: string) => fs.readFileSync(path.resolve(here, rel), 'utf8');

test('the upload menu offers PowerPoint and sends it to the pptx endpoint', () => {
  const button = read('./UploadButton.tsx');
  assert.match(button, /key: 'pptx'/);
  assert.match(button, /t\('upload\.sourcePptx'\)/);
  assert.match(button, /await uploadPptx\(file, \{ category, signal: abortController\.signal, onProgress \}\)/);
  // The picker has to offer .pptx, or the file cannot be selected in the first place.
  assert.match(button, /pickKind === 'pptx'[\s\S]{0,200}presentationml\.presentation,\.pptx/);
  // And a file picked for one source must not be uploaded as the other.
  assert.match(button, /const wantPptx = pickKind === 'pptx'/);
  assert.match(button, /t\('upload\.selectPptxFile'\)/);
});

test('a pptx does not open the prompt dialog, because it brings its own pages', () => {
  const home = read('../pages/HomePage.tsx');
  assert.match(home, /\(resp: UploadResponse, source\?: 'pdf' \| 'pptx'\)/);
  assert.match(home, /if \(source === 'pptx'\) return;\s*\n\s*openPromptFor\(resp\)/);
});

test('the import API call exists and points at the right route', () => {
  const uploads = read('../lib/api/uploads.ts');
  assert.match(uploads, /export function uploadPptx/);
  assert.match(uploads, /xhr\.open\('POST', 'api\/pdfs\/from-pptx'\)/);
  assert.match(uploads, /export async function fetchPptxImportStatus/);
  assert.match(uploads, /pptx-import\/status/);
});

test('the deck card names the import stage instead of a bare "processing"', () => {
  const card = read('./PdfCard.tsx');
  for (const step of ['pptx_import', 'pptx_parsing', 'pptx_rendering', 'pptx_building']) {
    assert.match(card, new RegExp(`${step}: 'progress\\.`), `${step} needs a label`);
  }
  // The backend has to write those values, or the labels never appear.
  const route = read('../../../backend/src/routes/pdfs/pptx-import.ts');
  assert.match(route, /const PPTX_PROGRESS_STEPS: Record<string, string> = \{/);
  assert.match(route, /UPDATE pdfs SET progress_step = \?/);
});

test('both locales carry every new string', () => {
  const keys = [
    'upload.sourcePptx',
    'upload.selectPptxFile',
    'upload.pptxQueued',
    'progress.pptxImport',
    'progress.pptxParsing',
    'progress.pptxRendering',
    'progress.pptxBuilding',
  ] as const;
  for (const key of keys) {
    for (const [name, locale] of [['zh-TW', zhTW], ['en', en]] as const) {
      const value = (locale as Record<string, string | undefined>)[key];
      assert.equal(typeof value, 'string', `${name} is missing ${key}`);
      assert.notEqual((value ?? '').trim(), '');
    }
  }
});
