import test from 'node:test';
import assert from 'node:assert/strict';

import { buildEmbedCode } from './ShareDialog';

test('buildEmbedCode returns an iframe snippet for a share URL', () => {
  assert.equal(
    buildEmbedCode('https://example.com/p/abc'),
    '<iframe src="https://example.com/p/abc" width="800" height="600" frameborder="0" allowfullscreen></iframe>',
  );
});

test('buildEmbedCode returns an empty string when there is no URL yet', () => {
  assert.equal(buildEmbedCode(''), '');
});
