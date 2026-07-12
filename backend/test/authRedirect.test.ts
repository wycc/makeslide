import test from 'node:test';
import assert from 'node:assert/strict';

import { sanitizeOAuthRedirectTarget } from '../src/authRedirect';

test('sanitizeOAuthRedirectTarget accepts a same-page hash-router path', () => {
  assert.equal(sanitizeOAuthRedirectTarget('#/play/abc123?share=xyz'), '#/play/abc123?share=xyz');
  assert.equal(sanitizeOAuthRedirectTarget('#/settings'), '#/settings');
});

test('sanitizeOAuthRedirectTarget rejects missing/empty input', () => {
  assert.equal(sanitizeOAuthRedirectTarget(undefined), null);
  assert.equal(sanitizeOAuthRedirectTarget(null), null);
  assert.equal(sanitizeOAuthRedirectTarget(''), null);
});

test('sanitizeOAuthRedirectTarget rejects targets that are not a hash-router path', () => {
  assert.equal(sanitizeOAuthRedirectTarget('/play/abc123'), null);
  assert.equal(sanitizeOAuthRedirectTarget('https://evil.test/phish'), null);
  assert.equal(sanitizeOAuthRedirectTarget('//evil.test'), null);
  assert.equal(sanitizeOAuthRedirectTarget('javascript:alert(1)'), null);
});

test('sanitizeOAuthRedirectTarget rejects control characters that could smuggle extra headers', () => {
  assert.equal(sanitizeOAuthRedirectTarget('#/play/abc\r\nSet-Cookie: evil=1'), null);
  assert.equal(sanitizeOAuthRedirectTarget('#/play/abc\n'), null);
  assert.equal(sanitizeOAuthRedirectTarget('#/play/abc\x00'), null);
});

test('sanitizeOAuthRedirectTarget rejects overly long targets', () => {
  const long = '#/' + 'a'.repeat(2048);
  assert.equal(sanitizeOAuthRedirectTarget(long), null);
});
