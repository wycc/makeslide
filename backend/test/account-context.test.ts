import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_ACCOUNT_ID,
  accountIdFromOwnerSub,
  currentAccountId,
  runWithAccountId,
  sanitizeAccountId,
} from '../src/services/accountContext';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── sanitizeAccountId ──────────────────────────────────────────────────────

test('sanitizeAccountId falls back to DEFAULT_ACCOUNT_ID for null/undefined/empty/whitespace-only input', () => {
  assert.equal(sanitizeAccountId(null), DEFAULT_ACCOUNT_ID);
  assert.equal(sanitizeAccountId(undefined), DEFAULT_ACCOUNT_ID);
  assert.equal(sanitizeAccountId(''), DEFAULT_ACCOUNT_ID);
  assert.equal(sanitizeAccountId('   '), DEFAULT_ACCOUNT_ID);
});

test('sanitizeAccountId leaves an already filename-safe id untouched', () => {
  assert.equal(sanitizeAccountId('abc123'), 'abc123');
  assert.equal(sanitizeAccountId('User-Name_42.test'), 'User-Name_42.test');
});

test('sanitizeAccountId trims surrounding whitespace', () => {
  assert.equal(sanitizeAccountId('  account-1  '), 'account-1');
});

test('sanitizeAccountId replaces unsafe characters with underscores', () => {
  assert.equal(sanitizeAccountId('user@example.com'), 'user_example.com');
  assert.equal(sanitizeAccountId('weird/path\\name'), 'weird_path_name');
  assert.equal(sanitizeAccountId('has spaces'), 'has_spaces');
});

test('sanitizeAccountId strips leading dots to avoid hidden-file-like or traversal-like names', () => {
  assert.equal(sanitizeAccountId('...hidden'), 'hidden');
  assert.equal(sanitizeAccountId('.config'), 'config');
});

test('sanitizeAccountId falls back to DEFAULT_ACCOUNT_ID when the id is only dots', () => {
  assert.equal(sanitizeAccountId('...'), DEFAULT_ACCOUNT_ID);
  assert.equal(sanitizeAccountId('.'), DEFAULT_ACCOUNT_ID);
});

// ── accountIdFromOwnerSub ────────────────────────────────────────────────

test('accountIdFromOwnerSub delegates to sanitizeAccountId', () => {
  assert.equal(accountIdFromOwnerSub(null), DEFAULT_ACCOUNT_ID);
  assert.equal(accountIdFromOwnerSub('google-sub-123'), 'google-sub-123');
  assert.equal(accountIdFromOwnerSub('weird sub@host'), 'weird_sub_host');
});

// ── runWithAccountId / currentAccountId ──────────────────────────────────

test('currentAccountId returns DEFAULT_ACCOUNT_ID outside of any account context', () => {
  assert.equal(currentAccountId(), DEFAULT_ACCOUNT_ID);
});

test('runWithAccountId makes currentAccountId() return the (sanitized) account inside fn', () => {
  const result = runWithAccountId('account-42', () => currentAccountId());
  assert.equal(result, 'account-42');
});

test('runWithAccountId sanitizes the account id before storing it', () => {
  const result = runWithAccountId('weird id!', () => currentAccountId());
  assert.equal(result, 'weird_id_');
});

test('currentAccountId reverts to DEFAULT_ACCOUNT_ID once runWithAccountId returns', () => {
  runWithAccountId('account-42', () => currentAccountId());
  assert.equal(currentAccountId(), DEFAULT_ACCOUNT_ID);
});

test('nested runWithAccountId calls restore the outer context after the inner one returns', () => {
  const seen: string[] = [];
  runWithAccountId('outer', () => {
    seen.push(currentAccountId());
    runWithAccountId('inner', () => {
      seen.push(currentAccountId());
    });
    seen.push(currentAccountId());
  });
  assert.deepEqual(seen, ['outer', 'inner', 'outer']);
});

test('runWithAccountId propagates the account context across await boundaries inside an async fn', async () => {
  const result = await runWithAccountId('account-async', async () => {
    assert.equal(currentAccountId(), 'account-async');
    await sleep(5);
    return currentAccountId();
  });
  assert.equal(result, 'account-async');
});

test('concurrent runWithAccountId calls do not leak their account id into each other', async () => {
  async function runFor(id: string, delayMs: number): Promise<string[]> {
    return runWithAccountId(id, async () => {
      const seen: string[] = [currentAccountId()];
      await sleep(delayMs);
      seen.push(currentAccountId());
      await sleep(delayMs);
      seen.push(currentAccountId());
      return seen;
    });
  }

  const [resultA, resultB] = await Promise.all([runFor('account-a', 5), runFor('account-b', 1)]);
  assert.deepEqual(resultA, ['account-a', 'account-a', 'account-a']);
  assert.deepEqual(resultB, ['account-b', 'account-b', 'account-b']);
});
