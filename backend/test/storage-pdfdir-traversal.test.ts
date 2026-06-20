import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { config } from '../src/config';
import { pdfDir } from '../src/services/storage';

test('pdfDir resolves a normal id inside storageRoot', () => {
  const dir = pdfDir('abc123');
  assert.equal(dir, path.join(config.storageRoot, 'abc123'));
});

test('pdfDir resolves an empty id to storageRoot itself without throwing', () => {
  assert.equal(pdfDir(''), config.storageRoot);
});

test('pdfDir throws instead of escaping storageRoot for a ".." pdfId', () => {
  assert.throws(() => pdfDir('..'), /outside storageRoot/);
});

test('pdfDir throws instead of escaping storageRoot for a deeper traversal pdfId', () => {
  assert.throws(() => pdfDir('../../etc'), /outside storageRoot/);
});

test('pdfDir does not throw for an id that merely contains dots without escaping', () => {
  assert.doesNotThrow(() => pdfDir('a..b'));
  assert.equal(pdfDir('a..b'), path.join(config.storageRoot, 'a..b'));
});
