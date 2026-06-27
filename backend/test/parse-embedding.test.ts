import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEmbedding } from '../src/services/embeddings';

test('parseEmbedding returns the numeric vector for valid JSON', () => {
  assert.deepEqual(parseEmbedding('[1,2,3]'), [1, 2, 3]);
  assert.deepEqual(parseEmbedding('[0.1,-0.5,0]'), [0.1, -0.5, 0]);
  assert.deepEqual(parseEmbedding('[]'), []);
});

test('parseEmbedding returns null for malformed JSON', () => {
  assert.equal(parseEmbedding('[1,2,'), null);
  assert.equal(parseEmbedding('not json'), null);
});

test('parseEmbedding returns null when not an array', () => {
  assert.equal(parseEmbedding('{"a":1}'), null);
  assert.equal(parseEmbedding('42'), null);
  assert.equal(parseEmbedding('null'), null);
});

test('parseEmbedding returns null when any entry is not a finite number', () => {
  assert.equal(parseEmbedding('[1,"x",3]'), null);
  assert.equal(parseEmbedding('[1,null,3]'), null);
  // JSON has no Infinity/NaN literals, but a non-number sneaking in is rejected
  assert.equal(parseEmbedding('[1,true]'), null);
});

test('parseEmbedding returns null for null/undefined input', () => {
  assert.equal(parseEmbedding(null), null);
  assert.equal(parseEmbedding(undefined), null);
});
