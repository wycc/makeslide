import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PDF_STATUSES, PAGE_STATUSES, PROGRESS_STEPS } from '../src/statusMachine';

// The frontend mirrors the backend status machine as string-union types in
// frontend/src/types.ts (PdfStatus, PageStatus, ProgressStep). They drive the
// status badge, the generating banner and the per-step labels. They live in
// separate packages, so a status/step added on one side without the other would
// silently surface a raw/untranslated value (this is how the animation shape
// list once drifted). Parse the frontend unions from source and assert they
// describe the same set of values as the backend arrays. Order is intentionally
// ignored — the union order is arbitrary; only the value set is a contract.
function readFrontendUnion(typeName: string): string[] {
  const srcUrl = new URL('../../frontend/src/types.ts', import.meta.url);
  const src = fs.readFileSync(srcUrl, 'utf8');
  const m = src.match(new RegExp(`export type ${typeName} =([\\s\\S]*?);`));
  assert.ok(m, `could not locate frontend type ${typeName}`);
  return [...m![1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!);
}

const sorted = (xs: readonly string[]) => [...xs].sort();

test('frontend union types parse to non-trivial sets', () => {
  assert.ok(readFrontendUnion('PdfStatus').length >= 4);
  assert.ok(readFrontendUnion('PageStatus').length >= 4);
  assert.ok(readFrontendUnion('ProgressStep').length >= 5);
});

test('frontend PdfStatus matches backend PDF_STATUSES', () => {
  assert.deepEqual(sorted(readFrontendUnion('PdfStatus')), sorted(PDF_STATUSES));
});

test('frontend PageStatus matches backend PAGE_STATUSES', () => {
  assert.deepEqual(sorted(readFrontendUnion('PageStatus')), sorted(PAGE_STATUSES));
});

test('frontend ProgressStep matches backend PROGRESS_STEPS (ignoring the null member)', () => {
  // ProgressStep additionally allows null on the frontend; the quoted members
  // should equal the backend PROGRESS_STEPS set.
  assert.deepEqual(sorted(readFrontendUnion('ProgressStep')), sorted(PROGRESS_STEPS));
});
