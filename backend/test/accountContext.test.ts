import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeAccountId,
  accountIdFromOwnerSub,
  runWithAccountId,
  currentAccountId,
  DEFAULT_ACCOUNT_ID,
} from '../src/services/accountContext';

test('sanitizeAccountId falls back to the default for empty/whitespace input', () => {
  assert.equal(sanitizeAccountId(null), DEFAULT_ACCOUNT_ID);
  assert.equal(sanitizeAccountId(undefined), DEFAULT_ACCOUNT_ID);
  assert.equal(sanitizeAccountId(''), DEFAULT_ACCOUNT_ID);
  assert.equal(sanitizeAccountId('   '), DEFAULT_ACCOUNT_ID);
});

test('sanitizeAccountId keeps filename-safe characters and trims', () => {
  assert.equal(sanitizeAccountId('google-sub.123_ABC'), 'google-sub.123_ABC');
  assert.equal(sanitizeAccountId('  padded-id  '), 'padded-id');
});

test('sanitizeAccountId replaces unsafe characters with underscores', () => {
  assert.equal(sanitizeAccountId('user@example.com'), 'user_example.com');
  assert.equal(sanitizeAccountId('a/b\\c'), 'a_b_c');
  assert.equal(sanitizeAccountId('spaced id'), 'spaced_id');
});

test('sanitizeAccountId strips leading dots and defaults when nothing remains', () => {
  assert.equal(sanitizeAccountId('...hidden'), 'hidden');
  assert.equal(sanitizeAccountId('....'), DEFAULT_ACCOUNT_ID);
});

test('accountIdFromOwnerSub is a sanitizing alias', () => {
  assert.equal(accountIdFromOwnerSub('owner@sub'), 'owner_sub');
  assert.equal(accountIdFromOwnerSub(null), DEFAULT_ACCOUNT_ID);
});

test('currentAccountId returns the default outside of any context', () => {
  assert.equal(currentAccountId(), DEFAULT_ACCOUNT_ID);
});

test('runWithAccountId exposes the sanitized id to currentAccountId within the callback', () => {
  const seen = runWithAccountId('a@b', () => currentAccountId());
  assert.equal(seen, 'a_b');
  // context does not leak out after the callback returns
  assert.equal(currentAccountId(), DEFAULT_ACCOUNT_ID);
});

test('runWithAccountId sanitizes null to the default account', () => {
  assert.equal(runWithAccountId(null, () => currentAccountId()), DEFAULT_ACCOUNT_ID);
});

test('runWithAccountId supports nested contexts and restores the outer one', () => {
  runWithAccountId('outer', () => {
    assert.equal(currentAccountId(), 'outer');
    runWithAccountId('inner', () => {
      assert.equal(currentAccountId(), 'inner');
    });
    assert.equal(currentAccountId(), 'outer');
  });
});

test('runWithAccountId preserves the context across awaits', async () => {
  await runWithAccountId('async-acct', async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(currentAccountId(), 'async-acct');
  });
  assert.equal(currentAccountId(), DEFAULT_ACCOUNT_ID);
});
