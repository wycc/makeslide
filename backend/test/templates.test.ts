import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildApp } from '../src/server';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';

setSystemAuthSettings({ googleAuthEnabled: false });

const OWNER_SUB = 'template-owner';
const OTHER_SUB = 'template-other';

function testSessionCookie(sub: string): string {
  const payload = Buffer.from(JSON.stringify({ provider: 'google', sub, email: `${sub}@example.com` }), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

const OWNER_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie(OWNER_SUB))}` };
const OTHER_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie(OTHER_SUB))}` };

const SKILL_DATA = {
  prompt: '請以親切語氣說明',
  applyTo: 'script',
  imageStylePrompt: '水彩風格',
};

test('POST /api/templates — 201 with valid data', async () => {
  const app = await buildApp();
  const resp = await app.inject({
    method: 'POST',
    url: '/api/templates',
    headers: { ...OWNER_HEADERS, 'content-type': 'application/json' },
    body: JSON.stringify({ name: '親切教學', description: '測試模板', category: 'teaching', skill_data: SKILL_DATA }),
  });
  assert.equal(resp.statusCode, 201);
  const body = resp.json() as { template: { id: string; name: string; is_public: boolean; skill_data: { prompt: string } } };
  assert.equal(body.template.name, '親切教學');
  assert.equal(body.template.is_public, true);
  assert.equal(body.template.skill_data.prompt, SKILL_DATA.prompt);
  await app.close();
});

test('POST /api/templates — 401 when not authenticated', async () => {
  const app = await buildApp();
  const resp = await app.inject({
    method: 'POST',
    url: '/api/templates',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: '未登入', skill_data: SKILL_DATA }),
  });
  assert.equal(resp.statusCode, 401);
  await app.close();
});

test('GET /api/templates — 200 returns public templates', async () => {
  const app = await buildApp();
  // create one first
  await app.inject({
    method: 'POST',
    url: '/api/templates',
    headers: { ...OWNER_HEADERS, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'get-test', skill_data: SKILL_DATA }),
  });
  const resp = await app.inject({ method: 'GET', url: '/api/templates' });
  assert.equal(resp.statusCode, 200);
  const body = resp.json() as { templates: unknown[] };
  assert.ok(Array.isArray(body.templates));
  await app.close();
});

test('DELETE /api/templates/:id — 403 when not owner', async () => {
  const app = await buildApp();
  const create = await app.inject({
    method: 'POST',
    url: '/api/templates',
    headers: { ...OWNER_HEADERS, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'delete-test', skill_data: SKILL_DATA }),
  });
  const { template } = create.json() as { template: { id: string } };
  const del = await app.inject({
    method: 'DELETE',
    url: `/api/templates/${template.id}`,
    headers: OTHER_HEADERS,
  });
  assert.equal(del.statusCode, 403);
  await app.close();
});
