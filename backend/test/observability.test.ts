import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildApp } from '../src/server';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';

function makeSessionCookie(sub: string): string {
  const session = { provider: 'google', sub, email: `${sub}@example.com` };
  const payload = Buffer.from(JSON.stringify(session), 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

const ADMIN_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(makeSessionCookie('account-1'))}` };
const NON_ADMIN_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(makeSessionCookie('account-2'))}` };

setSystemAuthSettings({ googleAuthEnabled: false, adminAccountIds: ['account-1'] });

test('GET /api/system/observability rejects a non-admin request', async () => {
  const app = await buildApp();
  try {
    const resp = await app.inject({ method: 'GET', url: '/api/system/observability', headers: NON_ADMIN_HEADERS });
    assert.equal(resp.statusCode, 403);
    assert.equal((resp.json() as { error: { code: string } }).error.code, 'ADMIN_REQUIRED');
  } finally {
    await app.close();
  }
});

test('GET /api/system/observability rejects an unauthenticated request', async () => {
  const app = await buildApp();
  try {
    const resp = await app.inject({ method: 'GET', url: '/api/system/observability' });
    assert.equal(resp.statusCode, 403);
    assert.equal((resp.json() as { error: { code: string } }).error.code, 'ADMIN_REQUIRED');
  } finally {
    await app.close();
  }
});

test('GET /api/system/observability returns aggregate stats for an admin', async () => {
  const app = await buildApp();
  try {
    const resp = await app.inject({ method: 'GET', url: '/api/system/observability', headers: ADMIN_HEADERS });
    assert.equal(resp.statusCode, 200);
    const body = resp.json() as {
      pdfs: { total: number };
      pipeline_runs: { total: number };
      stages: unknown[];
      artifacts: unknown[];
      llm_usage: { requests: number };
    };
    assert.equal(typeof body.pdfs.total, 'number');
    assert.equal(typeof body.pipeline_runs.total, 'number');
    assert.ok(Array.isArray(body.stages));
    assert.ok(Array.isArray(body.artifacts));
    assert.equal(typeof body.llm_usage.requests, 'number');
  } finally {
    await app.close();
  }
});
