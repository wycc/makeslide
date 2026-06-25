import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { safeJoinPdfPath, pdfDir } from '../src/services/storage';

const base = (id: string) => path.resolve(pdfDir(id));

test('safeJoinPdfPath resolves normal segments inside the pdf directory', () => {
  assert.equal(safeJoinPdfPath('abc', 'sub', 'f.txt'), path.resolve(base('abc'), 'sub', 'f.txt'));
});

test('safeJoinPdfPath returns the base dir when given no segments', () => {
  assert.equal(safeJoinPdfPath('abc'), base('abc'));
});

test('safeJoinPdfPath allows internal .. segments that stay within the base', () => {
  assert.equal(safeJoinPdfPath('abc', 'sub/../f.txt'), path.resolve(base('abc'), 'f.txt'));
});

test('safeJoinPdfPath throws on parent-directory traversal', () => {
  assert.throws(() => safeJoinPdfPath('abc', '../../etc/passwd'), /Path traversal detected/);
});

test('safeJoinPdfPath throws when a segment is an absolute path', () => {
  assert.throws(() => safeJoinPdfPath('abc', '/etc/passwd'), /Path traversal detected/);
});

test('safeJoinPdfPath throws on a sibling directory sharing the base name prefix', () => {
  // ../abc-evil resolves next to (not inside) the "abc" dir; the prefix check
  // must not treat "abc-evil" as a child of "abc".
  assert.throws(() => safeJoinPdfPath('abc', '../abc-evil'), /Path traversal detected/);
});
