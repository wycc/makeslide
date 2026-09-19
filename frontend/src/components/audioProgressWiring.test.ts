import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => fs.readFileSync(path.resolve(here, rel), 'utf8');

// Every place that waits on a voice shows how far along it is (user request, 2026-09-19).
const PLACES: Array<[string, RegExp]> = [
  ['../pages/play/PlayPageSlidePanel.tsx', /<AudioProgress\s+pdfId=\{pdfId\}\s+active=\{editorBusy && !ttsDisabled\}/],
  ['../pages/play/PlayPageFullscreen.tsx', /<AudioProgress\s+pdfId=\{pdfId\}\s+active=\{editorBusy && !ttsDisabled\}/],
  ['../pages/play/ScriptPatchDialog.tsx', /<AudioProgress pdfId=\{pdfId\} active=\{busy && !ttsDisabled\}/],
  ['../pages/play/StepNarrationPanel.tsx', /<AudioProgress\s+pdfId=\{pdfId\}\s+active=\{busyStep === index\}/],
  ['../pages/play/StepNarrationPanel.tsx', /<AudioProgress pdfId=\{pdfId\} active=\{rewriteBusy\}/],
  ['../pages/play/RegenerateProgress.tsx', /<AudioProgress\s+pdfId=\{pdfId\}\s+active=\{job\.current_step === 'audio'/],
];

test('every place that synthesizes speech renders the audio progress', () => {
  for (const [file, pattern] of PLACES) assert.match(read(file), pattern, file);
});

test('both RegenerateProgress callers and the patch dialog are given the deck id', () => {
  assert.match(read('../pages/play/PlayPageHeader.tsx'), /<RegenerateProgress job=\{regenJob\} pdfId=\{pdfId\} \/>/);
  assert.match(read('../pages/play/RegenAllDialog.tsx'), /<RegenerateProgress job=\{regenJob\} pdfId=\{pdfId\} \/>/);
  const dialogs = read('../pages/play/PlayPageDialogs.tsx');
  assert.match(dialogs, /<RegenAllDialog\s+pdfId=\{pdfId\}/);
  assert.match(dialogs, /<ScriptPatchDialog\s+pdfId=\{pdfId\}/);
});
