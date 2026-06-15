import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';
import { SLA_TARGETS_MS } from '../src/services/timing';
import type { SlaSettingsResponse } from '../src/types';

// 與 src/routes/auth.ts 的 encodeSession 相同演算法，避免硬編碼簽章在不同環境的
// AUTH_SESSION_SECRET 下失效。
function makeSessionCookie(sub: string): string {
  const session = { provider: 'google', sub, email: `${sub}@example.com` };
  const payload = Buffer.from(JSON.stringify(session), 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

const ADMIN_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(makeSessionCookie('account-1'))}` };
const NON_ADMIN_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(makeSessionCookie('account-2'))}` };

setSystemAuthSettings({ googleAuthEnabled: false, adminAccountIds: ['account-1'] });

function clearOverrides(): void {
  db.prepare(`DELETE FROM pipeline_sla_overrides WHERE (kind = 'stage' AND name = 'render_pages') OR (kind = 'artifact' AND name = 'image')`).run();
}

test('GET /api/system/sla-settings returns defaults/overrides/effective for admin', async () => {
  clearOverrides();
  const app = await buildApp();
  try {
    const resp = await app.inject({ method: 'GET', url: '/api/system/sla-settings', headers: ADMIN_HEADERS });
    assert.equal(resp.statusCode, 200);
    const body = resp.json() as SlaSettingsResponse;
    assert.equal(body.bounds.min_ms, 1_000);
    assert.equal(body.bounds.max_ms, 3_600_000);
    const renderPages = body.stages.find((s) => s.name === 'render_pages');
    assert.ok(renderPages);
    assert.equal(renderPages?.default_ms, SLA_TARGETS_MS.stages.render_pages);
    assert.equal(renderPages?.override_ms, null);
    assert.equal(renderPages?.effective_ms, SLA_TARGETS_MS.stages.render_pages);
    const image = body.artifacts.find((a) => a.name === 'image');
    assert.ok(image);
    assert.equal(image?.default_ms, SLA_TARGETS_MS.artifacts.image);
  } finally {
    await app.close();
  }
});

test('PUT /api/system/sla-settings sets and clears an override, reflected in GET', async () => {
  clearOverrides();
  const app = await buildApp();
  try {
    const putResp = await app.inject({
      method: 'PUT',
      url: '/api/system/sla-settings',
      headers: ADMIN_HEADERS,
      payload: { kind: 'stage', name: 'render_pages', target_ms: 90_000 },
    });
    assert.equal(putResp.statusCode, 200);
    const putBody = putResp.json() as SlaSettingsResponse;
    const renderPages = putBody.stages.find((s) => s.name === 'render_pages');
    assert.equal(renderPages?.override_ms, 90_000);
    assert.equal(renderPages?.effective_ms, 90_000);
    assert.ok(renderPages?.updated_at);

    const getResp = await app.inject({ method: 'GET', url: '/api/system/sla-settings', headers: ADMIN_HEADERS });
    const getBody = getResp.json() as SlaSettingsResponse;
    assert.equal(getBody.stages.find((s) => s.name === 'render_pages')?.effective_ms, 90_000);

    const clearResp = await app.inject({
      method: 'PUT',
      url: '/api/system/sla-settings',
      headers: ADMIN_HEADERS,
      payload: { kind: 'stage', name: 'render_pages', target_ms: null },
    });
    assert.equal(clearResp.statusCode, 200);
    const clearBody = clearResp.json() as SlaSettingsResponse;
    const clearedRenderPages = clearBody.stages.find((s) => s.name === 'render_pages');
    assert.equal(clearedRenderPages?.override_ms, null);
    assert.equal(clearedRenderPages?.effective_ms, SLA_TARGETS_MS.stages.render_pages);
  } finally {
    clearOverrides();
    await app.close();
  }
});

test('PUT /api/system/sla-settings rejects invalid kind/name/target_ms', async () => {
  const app = await buildApp();
  try {
    const badName = await app.inject({
      method: 'PUT',
      url: '/api/system/sla-settings',
      headers: ADMIN_HEADERS,
      payload: { kind: 'stage', name: 'not_a_stage', target_ms: 1_000 },
    });
    assert.equal(badName.statusCode, 400);

    const tooSmall = await app.inject({
      method: 'PUT',
      url: '/api/system/sla-settings',
      headers: ADMIN_HEADERS,
      payload: { kind: 'artifact', name: 'image', target_ms: 1 },
    });
    assert.equal(tooSmall.statusCode, 400);

    const tooLarge = await app.inject({
      method: 'PUT',
      url: '/api/system/sla-settings',
      headers: ADMIN_HEADERS,
      payload: { kind: 'artifact', name: 'image', target_ms: 10_000_000 },
    });
    assert.equal(tooLarge.statusCode, 400);
  } finally {
    await app.close();
  }
});

test('GET/PUT /api/system/sla-settings require admin', async () => {
  const app = await buildApp();
  try {
    const getResp = await app.inject({ method: 'GET', url: '/api/system/sla-settings', headers: NON_ADMIN_HEADERS });
    assert.equal(getResp.statusCode, 403);
    const getBody = getResp.json() as { error: { code: string } };
    assert.equal(getBody.error.code, 'ADMIN_REQUIRED');

    const putResp = await app.inject({
      method: 'PUT',
      url: '/api/system/sla-settings',
      headers: NON_ADMIN_HEADERS,
      payload: { kind: 'stage', name: 'render_pages', target_ms: 90_000 },
    });
    assert.equal(putResp.statusCode, 403);
  } finally {
    await app.close();
  }
});
