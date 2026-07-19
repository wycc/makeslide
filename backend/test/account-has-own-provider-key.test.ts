import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { config } from '../src/config';
import { accountHasOwnProviderKey, getAccountSettingsLocation, persistEnvSettings } from '../src/services/aiSettings';

const ACCOUNT_ID = 'account-has-own-provider-key-test-01';

function cleanup(): void {
  fs.rmSync(getAccountSettingsLocation(ACCOUNT_ID).accountDir, { recursive: true, force: true });
}

test('accountHasOwnProviderKey is false for a brand-new account (inherits the shared default key)', () => {
  cleanup();
  try {
    assert.equal(accountHasOwnProviderKey(ACCOUNT_ID, 'openai'), false);
    assert.equal(accountHasOwnProviderKey(ACCOUNT_ID, 'gemini'), false);
  } finally {
    cleanup();
  }
});

test('accountHasOwnProviderKey is true only for the provider the account explicitly configured', async () => {
  cleanup();
  try {
    await persistEnvSettings(ACCOUNT_ID, { openaiApiKey: 'sk-own-key-test' });
    assert.equal(accountHasOwnProviderKey(ACCOUNT_ID, 'openai'), true);
    assert.equal(accountHasOwnProviderKey(ACCOUNT_ID, 'gemini'), false);
    assert.equal(accountHasOwnProviderKey(ACCOUNT_ID, 'cgu-air'), false);
    assert.equal(accountHasOwnProviderKey(ACCOUNT_ID, 'openrouter'), false);
  } finally {
    cleanup();
  }
});

test('accountHasOwnProviderKey ignores a blank/whitespace-only stored key', async () => {
  cleanup();
  try {
    await persistEnvSettings(ACCOUNT_ID, { geminiApiKey: '   ' });
    assert.equal(accountHasOwnProviderKey(ACCOUNT_ID, 'gemini'), false);
  } finally {
    cleanup();
  }
});

test('config sanity: DEFAULT_SOURCE_WEEKLY_QUOTA_USD parses to a nonnegative number', () => {
  assert.equal(typeof config.defaultSourceWeeklyQuotaUsd, 'number');
  assert.ok(config.defaultSourceWeeklyQuotaUsd >= 0);
});
