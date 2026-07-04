import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readNumberArrayFromStorage, readJsonArrayFromStorage } from './storageNumberArray';

function storageWith(value: string | null): Pick<Storage, 'getItem'> {
  return { getItem: () => value };
}

test('readJsonArrayFromStorage returns the parsed array as-is (mixed types)', () => {
  assert.deepEqual(readJsonArrayFromStorage('k', storageWith('[1,"a",true]')), [1, 'a', true]);
});

test('readJsonArrayFromStorage returns [] for malformed/non-array/missing/throwing', () => {
  assert.deepEqual(readJsonArrayFromStorage('k', storageWith('nope')), []);
  assert.deepEqual(readJsonArrayFromStorage('k', storageWith('{"a":1}')), []);
  assert.deepEqual(readJsonArrayFromStorage('k', storageWith(null)), []);
  assert.deepEqual(readJsonArrayFromStorage('k', { getItem: () => { throw new Error('x'); } }), []);
});

test('reads a JSON number array', () => {
  assert.deepEqual(readNumberArrayFromStorage('k', storageWith('[1,2,3]')), [1, 2, 3]);
});

test('filters out non-number elements', () => {
  assert.deepEqual(readNumberArrayFromStorage('k', storageWith('[1,"a",2,null,3]')), [1, 2, 3]);
});

test('returns [] for a missing value, malformed JSON, or a non-array', () => {
  assert.deepEqual(readNumberArrayFromStorage('k', storageWith(null)), []);
  assert.deepEqual(readNumberArrayFromStorage('k', storageWith('not json')), []);
  assert.deepEqual(readNumberArrayFromStorage('k', storageWith('{"a":1}')), []);
});

test('returns [] when no storage is available', () => {
  assert.deepEqual(readNumberArrayFromStorage('k', undefined), []);
});

test('returns [] when getItem throws', () => {
  const throwing: Pick<Storage, 'getItem'> = { getItem: () => { throw new Error('blocked'); } };
  assert.deepEqual(readNumberArrayFromStorage('k', throwing), []);
});
