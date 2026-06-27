import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { buildApp } from '../src/server';
import { config } from '../src/config';
import {
  setSystemAuthSettings,
  clampSemanticSearchMaxPdfs,
  SEMANTIC_SEARCH_MAX_PDFS_DEFAULT,
  SEMANTIC_SEARCH_MAX_PDFS_MIN,
  SEMANTIC_SEARCH_MAX_PDFS_MAX,
} from '../src/services/aiSettings';

function testSessionCookie(sub: string): string {
  const payload = Buffer.from(
    JSON.stringify({ provider: 'google', sub, email: `${sub}@example.com` }),
    'utf8',
  ).toString('base64url');
  const signature = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

setSystemAuthSettings({ googleAuthEnabled: false });

const ACCOUNT_SUB = 'semantic-max-pdfs-test-01';
const SESSION_COOKIE = testSessionCookie(ACCOUNT_SUB);
const HEADERS_JSON = {
  cookie: `makeslide_session=${encodeURIComponent(SESSION_COOKIE)}`,
  'content-type': 'application/json',
};
const ACCOUNT_DIR = path.join(config.repoRoot, 'accounts', ACCOUNT_SUB);
const ENV_PATH = path.join(ACCOUNT_DIR, 'settings.env');

function cleanupAccountDir(): void {
  fs.rmSync(ACCOUNT_DIR, { recursive: true, force: true });
}

test('clampSemanticSearchMaxPdfs rounds and clamps to [MIN, MAX]', () => {
  // within range, kept (rounded)
  assert.equal(clampSemanticSearchMaxPdfs(20), 20);
  assert.equal(clampSemanticSearchMaxPdfs(33.4), 33);
  assert.equal(clampSemanticSearchMaxPdfs(33.6), 34);
  // below MIN clamps up, above MAX clamps down
  assert.equal(clampSemanticSearchMaxPdfs(0), SEMANTIC_SEARCH_MAX_PDFS_MIN);
  assert.equal(clampSemanticSearchMaxPdfs(-5), SEMANTIC_SEARCH_MAX_PDFS_MIN);
  assert.equal(clampSemanticSearchMaxPdfs(9999), SEMANTIC_SEARCH_MAX_PDFS_MAX);
  // non-finite falls back to default
  assert.equal(clampSemanticSearchMaxPdfs(Number.NaN), SEMANTIC_SEARCH_MAX_PDFS_DEFAULT);
  assert.equal(clampSemanticSearchMaxPdfs(Number.POSITIVE_INFINITY), SEMANTIC_SEARCH_MAX_PDFS_DEFAULT);
});

test('GET /api/system/ai-settings returns the default semantic_search_max_pdfs for a fresh account', async () => {
  cleanupAccountDir();
  const app = await buildApp();
  try {
    const resp = await app.inject({ method: 'GET', url: '/api/system/ai-settings', headers: HEADERS_JSON });
    assert.equal(resp.statusCode, 200);
    assert.equal(
      (resp.json() as { semantic_search_max_pdfs: number }).semantic_search_max_pdfs,
      SEMANTIC_SEARCH_MAX_PDFS_DEFAULT,
    );
  } finally {
    await app.close();
    cleanupAccountDir();
  }
});

test('PATCH /api/system/ai-settings persists a valid semantic_search_max_pdfs and reads it back', async () => {
  cleanupAccountDir();
  const app = await buildApp();
  try {
    const patched = await app.inject({
      method: 'PATCH',
      url: '/api/system/ai-settings',
      headers: HEADERS_JSON,
      payload: { semantic_search_max_pdfs: 50 },
    });
    assert.equal(patched.statusCode, 200);
    assert.equal((patched.json() as { semantic_search_max_pdfs: number }).semantic_search_max_pdfs, 50);

    // persisted to the account's settings.env
    const envContent = fs.readFileSync(ENV_PATH, 'utf8');
    assert.match(envContent, /^SEMANTIC_SEARCH_MAX_PDFS=50$/m);

    const fetched = await app.inject({ method: 'GET', url: '/api/system/ai-settings', headers: HEADERS_JSON });
    assert.equal((fetched.json() as { semantic_search_max_pdfs: number }).semantic_search_max_pdfs, 50);
  } finally {
    await app.close();
    cleanupAccountDir();
  }
});

test('PATCH /api/system/ai-settings rejects an out-of-range semantic_search_max_pdfs (schema guard)', async () => {
  cleanupAccountDir();
  const app = await buildApp();
  try {
    const tooBig = await app.inject({
      method: 'PATCH',
      url: '/api/system/ai-settings',
      headers: HEADERS_JSON,
      payload: { semantic_search_max_pdfs: 500 },
    });
    assert.equal(tooBig.statusCode, 400);

    const tooSmall = await app.inject({
      method: 'PATCH',
      url: '/api/system/ai-settings',
      headers: HEADERS_JSON,
      payload: { semantic_search_max_pdfs: 0 },
    });
    assert.equal(tooSmall.statusCode, 400);
  } finally {
    await app.close();
    cleanupAccountDir();
  }
});
