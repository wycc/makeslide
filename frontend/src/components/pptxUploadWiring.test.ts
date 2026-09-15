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
  assert.match(button, /await uploadPptx\(file, \{[\s\S]{0,400}signal: abortController\.signal/);
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

test('the import asks how the deck should be narrated before it starts', () => {
  const button = read('./UploadButton.tsx');
  // The PDF flow's prompt dialog asks how to *generate* a deck; a pptx already has its pages. What
  // is still open is the narration, and these are the deck's standing settings — asked now so the
  // first narration already follows them.
  assert.match(button, /setShowPptxOptions\(true\)/);
  assert.match(button, /<UploadPptxDialog/);
  assert.match(button, /userPrompt: pptxOptions\.userPrompt/);
  assert.match(button, /scriptMaxCharsPerPage: Number\(pptxOptions\.scriptMaxCharsPerPage\) \|\| undefined/);
  assert.match(button, /scriptCharsPerStep: Number\(pptxOptions\.scriptCharsPerStep\) \|\| undefined/);
  // Narration costs model and TTS calls, so it cannot be offered when the LLM is off.
  assert.match(button, /narrate: pptxOptions\.narrate && !llmDisabled/);

  const uploads = read('../lib/api/uploads.ts');
  // Multipart is parsed in order and the route reads the fields off the file handle, so anything
  // appended after the file would not be there yet.
  const fieldsAt = uploads.indexOf("formData.append('user_prompt'");
  const fileAt = uploads.indexOf("formData.append('file', file);", fieldsAt);
  assert.ok(fieldsAt > 0 && fileAt > fieldsAt, '欄位必須排在檔案之前');
});

test('the backend stores them on the deck and can narrate straight after importing', () => {
  const route = read('../../../backend/src/routes/pdfs/pptx-import.ts');
  assert.match(route, /multipartFieldValue\(file\.fields\.user_prompt\)/);
  assert.match(route, /multipartNumber\(file\.fields\.script_max_chars_per_page, 80, 2000\)/);
  assert.match(route, /multipartNumber\(file\.fields\.script_chars_per_step, 40, 2000\)/);
  // Narration is written against the steps the import produced, so it can only start afterwards.
  const importDone = route.indexOf("'pptx import: finished'");
  // Awaited now, so the deck stays read-only until the narration is done
  // (backend/test/pptx-import-readonly.test.ts pins that part).
  const narrateAt = route.indexOf('await runNarrationJob(pdfId, narrateAsAccount');
  assert.ok(importDone > 0 && narrateAt > importDone, '旁白必須等頁面都畫好之後才開始');
  // The account cannot be read at that point — the request is long gone — and narration spends
  // that account's budget.
  assert.match(route, /function startNarrationJob\(\s*pdfId: string,\s*accountId: string,/);
});

test('the options dialog escapes the header, so it is not clipped to a strip', () => {
  // The upload button lives in the home page header, which has backdrop-blur. A backdrop-filter
  // makes that header the containing block for position:fixed, so a dialog rendered in place was
  // laid out against a ~70px strip — it showed as a thin scrolling box with its buttons out of
  // reach, and no file could be chosen at all.
  const dialog = read('./UploadPptxDialog.tsx');
  assert.match(dialog, /import \{ createPortal \} from 'react-dom'/);
  assert.match(dialog, /return createPortal\(/);
  assert.match(dialog, /document\.body,\s*\n\s*\);/);
  // And the panel itself must not be height-capped to its (formerly tiny) parent.
  assert.doesNotMatch(dialog, /className="[^"]*max-h-full/);
  assert.match(dialog, /role="dialog"/);
  assert.match(dialog, /aria-modal="true"/);
});

test('confirming opens the file picker inside the same gesture', () => {
  // Browsers only open a picker from a user gesture; a deferred click can be refused.
  const button = read('./UploadButton.tsx');
  const start = button.indexOf('const handleConfirmPptxDialog = () => {');
  assert.ok(start > 0);
  const body = button.slice(start, button.indexOf('\n  };', start));
  assert.match(body, /fileInputRef\.current\?\.click\(\);/);
  assert.doesNotMatch(body, /setTimeout/);
});

test('both locales carry every new string', () => {
  const keys = [
    'upload.sourcePptx',
    'upload.selectPptxFile',
    'upload.pptxQueued',
    'upload.pptxQueuedWithNarration',
    'upload.pptxDialog.title',
    'upload.pptxDialog.styleLabel',
    'upload.pptxDialog.pageCharsLabel',
    'upload.pptxDialog.stepCharsLabel',
    'upload.pptxDialog.stepCharsHint',
    'upload.pptxDialog.narrateLabel',
    'upload.pptxDialog.choose',
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
