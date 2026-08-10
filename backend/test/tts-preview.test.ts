import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { buildApp } from '../src/server';
import { config } from '../src/config';
import { setSystemAuthSettings, persistEnvSettings } from '../src/services/aiSettings';

function testSessionCookie(sub: string): string {
  const payload = Buffer.from(JSON.stringify({ provider: 'google', sub, email: `${sub}@example.com` }), 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

setSystemAuthSettings({ googleAuthEnabled: false });

const ACCOUNT_SUB = 'tts-preview-test-01';
const HEADERS_JSON = {
  cookie: `makeslide_session=${encodeURIComponent(testSessionCookie(ACCOUNT_SUB))}`,
  'content-type': 'application/json',
};
const ACCOUNT_DIR = path.join(config.repoRoot, 'accounts', ACCOUNT_SUB);

function cleanupAccountDir(): void {
  fs.rmSync(ACCOUNT_DIR, { recursive: true, force: true });
}

test('POST /api/system/tts-preview rejects an unknown provider', async () => {
  cleanupAccountDir();
  const app = await buildApp();
  try {
    const resp = await app.inject({
      method: 'POST',
      url: '/api/system/tts-preview',
      headers: HEADERS_JSON,
      payload: { provider: 'elevenlabs', voice: 'Kore', persona: '沉穩' },
    });
    assert.equal(resp.statusCode, 400);
    assert.equal(resp.json().error.code, 'INVALID_REQUEST');
  } finally {
    await app.close();
    cleanupAccountDir();
  }
});

test('POST /api/system/tts-preview reports a missing key instead of attempting synthesis', async () => {
  // Without this the button would surface a raw SDK error; the account just has no key yet,
  // which is a setup problem the settings page can state plainly.
  cleanupAccountDir();
  await persistEnvSettings({ geminiApiKey: '' }, ACCOUNT_SUB);
  const app = await buildApp();
  try {
    const resp = await app.inject({
      method: 'POST',
      url: '/api/system/tts-preview',
      headers: HEADERS_JSON,
      payload: { provider: 'gemini', voice: 'Kore', persona: '沉穩' },
    });
    assert.equal(resp.statusCode, 422);
    assert.equal(resp.json().error.code, 'API_KEY_MISSING');
  } finally {
    await app.close();
    cleanupAccountDir();
  }
});

test('POST /api/system/tts-preview defaults voice and persona so the body can be minimal', async () => {
  // Both are optional: an empty persona box is a legitimate thing to preview (it is what the
  // provider sounds like with no steering at all).
  cleanupAccountDir();
  await persistEnvSettings({ geminiApiKey: '' }, ACCOUNT_SUB);
  const app = await buildApp();
  try {
    const resp = await app.inject({
      method: 'POST',
      url: '/api/system/tts-preview',
      headers: HEADERS_JSON,
      payload: { provider: 'gemini' },
    });
    // Reaches the key check rather than failing validation — proving the defaults applied.
    assert.equal(resp.statusCode, 422);
    assert.equal(resp.json().error.code, 'API_KEY_MISSING');
  } finally {
    await app.close();
    cleanupAccountDir();
  }
});
