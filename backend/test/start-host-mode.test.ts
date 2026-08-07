import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';
import { giveTestProviderKeys } from './testProviderKeys';

function testSessionCookie(sub = 'host-mode-owner'): string {
  const payload = Buffer.from(
    JSON.stringify({ provider: 'google', sub, email: `${sub}@example.com` }),
    'utf8',
  ).toString('base64url');
  const signature = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

const HEADERS = {
  cookie: `makeslide_session=${encodeURIComponent(testSessionCookie())}`,
  'content-type': 'application/json',
};

setSystemAuthSettings({ googleAuthEnabled: false });
// 這些測試測的是權限/流程，不是「沒有 key 就停用」——先把假 key 補上以通過入口守門。
giveTestProviderKeys('host-mode-owner');

/** A deck waiting for its prompt, i.e. exactly where the prompt modal is shown. */
function seedAwaitingPrompt(pdfId: string, hostMode: 'solo' | 'dual'): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO pdfs (id, title, original_filename, status, page_count, category, owner_sub, visibility,
                       host_mode, created_at, updated_at)
     VALUES (?, ?, ?, 'awaiting_prompt', 3, 'general', ?, 'private', ?, ?, ?)`,
  ).run(pdfId, 'host mode deck', 'deck.pdf', 'host-mode-owner', hostMode, now, now);
}

function hostModeOf(pdfId: string): string {
  return (db.prepare('SELECT host_mode FROM pdfs WHERE id = ?').get(pdfId) as { host_mode: string }).host_mode;
}

test('POST /start applies the host mode chosen in the prompt modal', async () => {
  const app = await buildApp();
  const id = 'hostmode01';
  try {
    seedAwaitingPrompt(id, 'solo');
    const resp = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${id}/start`,
      headers: HEADERS,
      payload: { prompt: '', host_mode: 'dual' },
    });
    assert.equal(resp.statusCode, 202);
    // Written before the pipeline is queued, so the first script generation is already dual.
    assert.equal(hostModeOf(id), 'dual');
  } finally {
    db.prepare('DELETE FROM pdfs WHERE id = ?').run(id);
    await app.close();
  }
});

test('POST /start without host_mode keeps the deck\'s upload-time choice', async () => {
  const app = await buildApp();
  const id = 'hostmode02';
  try {
    seedAwaitingPrompt(id, 'dual');
    const resp = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${id}/start`,
      headers: HEADERS,
      payload: { prompt: '' },
    });
    assert.equal(resp.statusCode, 202);
    assert.equal(hostModeOf(id), 'dual');
  } finally {
    db.prepare('DELETE FROM pdfs WHERE id = ?').run(id);
    await app.close();
  }
});

test('POST /start rejects an unknown host mode', async () => {
  const app = await buildApp();
  const id = 'hostmode03';
  try {
    seedAwaitingPrompt(id, 'solo');
    const resp = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${id}/start`,
      headers: HEADERS,
      payload: { prompt: '', host_mode: 'trio' },
    });
    assert.equal(resp.statusCode, 400);
    assert.equal(hostModeOf(id), 'solo');
  } finally {
    db.prepare('DELETE FROM pdfs WHERE id = ?').run(id);
    await app.close();
  }
});
