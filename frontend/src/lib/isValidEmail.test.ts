import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidEmail } from './isValidEmail';

test('accepts typical email addresses', () => {
  assert.equal(isValidEmail('a@b.co'), true);
  assert.equal(isValidEmail('user.name+tag@example.com'), true);
});

test('rejects addresses missing @, domain, or TLD', () => {
  assert.equal(isValidEmail('nope'), false);
  assert.equal(isValidEmail('a@b'), false); // no dot/TLD
  assert.equal(isValidEmail('@b.co'), false); // no local part
  assert.equal(isValidEmail('a@.co'), false); // empty domain label is still non-empty char? '.' -> fails
});

test('rejects empty input and whitespace', () => {
  assert.equal(isValidEmail(''), false);
  assert.equal(isValidEmail('  '), false);
  assert.equal(isValidEmail('a @b.co'), false);
  assert.equal(isValidEmail('a@b .co'), false);
});
