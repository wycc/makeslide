import test from 'node:test';
import assert from 'node:assert/strict';

import { pdfMatchesSearch } from './HomePage';
import type { PdfListItem } from '../types';

const item = (over: Partial<PdfListItem>): PdfListItem => ({ id: 'x', title: null, ...over } as PdfListItem);

test('pdfMatchesSearch matches by title (case-insensitive)', () => {
  assert.equal(pdfMatchesSearch(item({ title: 'Calculus Basics' }), 'calculus'), true);
  assert.equal(pdfMatchesSearch(item({ title: 'Calculus Basics' }), 'physics'), false);
});

test('pdfMatchesSearch matches by tags', () => {
  assert.equal(pdfMatchesSearch(item({ title: 'X', tags: 'math, exam' }), 'exam'), true);
});

test('pdfMatchesSearch matches by description', () => {
  assert.equal(pdfMatchesSearch(item({ title: 'X', description: 'An intro to derivatives' }), 'derivatives'), true);
  assert.equal(pdfMatchesSearch(item({ title: 'X', description: 'An intro to derivatives' }), 'integral'), false);
});

test('pdfMatchesSearch returns true for an empty query and tolerates missing fields', () => {
  assert.equal(pdfMatchesSearch(item({ title: null }), ''), true);
  assert.equal(pdfMatchesSearch(item({ title: null, tags: undefined, description: undefined }), 'anything'), false);
});
