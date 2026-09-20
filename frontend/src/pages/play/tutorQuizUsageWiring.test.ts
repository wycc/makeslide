import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Source-level guards for the after-class practice usage records. The backend refuses non-owners
 * on its own; what these pin is the UI side of the same promise — a student must never be offered
 * a button that only ever answers 403 — and the two facts the numbers depend on: the period
 * buckets follow the viewer's time zone, and round questions load on demand.
 */
const here = path.dirname(new URL(import.meta.url).pathname);
const read = (rel: string) => fs.readFileSync(path.resolve(here, rel), 'utf8');

test('the usage button is only rendered for the deck owner', () => {
  const section = read('./TutorQuizSection.tsx');
  assert.match(section, /\{detail\?\.is_owner && \(\s*<button[\s\S]*?setUsageOpen\(true\)/);
  assert.match(section, /\{usageOpen && <TutorQuizUsageDialog /);
});

test('the dialog sends the browser time zone and loads a round only when it is opened', () => {
  const dialog = read('./TutorQuizUsageDialog.tsx');
  assert.match(dialog, /Intl\.DateTimeFormat\(\)\.resolvedOptions\(\)\.timeZone/);
  assert.match(dialog, /fetchTutorQuizUsage\(pdfId, timeZone\)/);
  // Every round of every student is listed at once; preloading their questions would be hundreds
  // of rows nobody asked for.
  assert.match(dialog, /if \(!next \|\| detail \|\| !pdfId\) return;[\s\S]*?fetchTutorQuizUsageRound\(pdfId, round\.id\)/);
  // Weekly / monthly / all-time are all offered.
  assert.match(dialog, /\['weekly', 'monthly', 'all'\] as const/);
});
