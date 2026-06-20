import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildApp, timingSafeStringEqual } from '../src/server';
import { config } from '../src/config';
import { db } from '../src/db';
import { getRuntimeAiSettings, persistEnvSettings, setRuntimeAiSettings, setSystemAuthSettings } from '../src/services/aiSettings';

function makeSessionCookie(sub: string): string {
  const session = { provider: 'google', sub, email: `${sub}@example.com` };
  const payload = Buffer.from(JSON.stringify(session), 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

const ACCOUNT_A = 'mcp-account-a';
const ACCOUNT_B = 'mcp-account-b';
const A_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(makeSessionCookie(ACCOUNT_A))}` };
const B_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(makeSessionCookie(ACCOUNT_B))}` };

function nowIso(): string {
  return new Date().toISOString();
}

function seedPdf(pdfId: string, ownerSub: string, visibility: 'private' | 'public' | 'public_editable'): void {
  const t = nowIso();
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,progress_step,progress_current,progress_total,error_message,user_prompt,require_script_confirmation,owner_sub,visibility,tts_voice,tts_speed,script_max_chars_per_page,created_at,updated_at)
     VALUES (?,?,?,'ready',1,NULL,NULL,NULL,NULL,NULL,0,?,?,NULL,NULL,NULL,?,?)`,
  ).run(pdfId, 't', `${pdfId}.pdf`, ownerSub, visibility, t, t);
}

// findAccountIdByMcpAuthToken() scans accounts/ on disk, so the token must actually be
// persisted (not just cached in memory) for an account to be discoverable — exactly what the
// real generate-token route does (setRuntimeAiSettings + persistEnvSettings together).
async function setAccountMcpToken(accountId: string, token: string): Promise<void> {
  setRuntimeAiSettings(accountId, { mcpAuthToken: token });
  await persistEnvSettings(accountId, { mcpAuthToken: token });
}

async function clearTokens(): Promise<void> {
  await setAccountMcpToken(ACCOUNT_A, '');
  await setAccountMcpToken(ACCOUNT_B, '');
}

test('timingSafeStringEqual returns true only for an exact match', () => {
  assert.equal(timingSafeStringEqual('Bearer secret-token', 'Bearer secret-token'), true);
});

test('timingSafeStringEqual returns false for different content of the same length', () => {
  assert.equal(timingSafeStringEqual('Bearer secret-token', 'Bearer wrongg-token'), false);
});

test('timingSafeStringEqual returns false (not throw) for inputs of different lengths', () => {
  assert.doesNotThrow(() => {
    assert.equal(timingSafeStringEqual('Bearer short', 'Bearer a-much-longer-token-value'), false);
  });
  assert.equal(timingSafeStringEqual('', 'Bearer secret-token'), false);
});

test('MCP bearer token grants API access when Google login is otherwise required', async () => {
  setSystemAuthSettings({
    googleAuthEnabled: true,
    googleClientId: 'test-client.apps.googleusercontent.com',
    googleClientSecret: 'test-secret',
    googleRedirectUri: 'https://example.test/api/auth/google/callback',
    adminAccountIds: [],
  });
  await setAccountMcpToken(ACCOUNT_A, 'mcp-test-secret-token');
  try {
    const app = await buildApp();
    try {
      const unauthorized = await app.inject({ method: 'GET', url: '/api/pdfs' });
      assert.equal(unauthorized.statusCode, 401);

      const withWrongToken = await app.inject({
        method: 'GET',
        url: '/api/pdfs',
        headers: { authorization: 'Bearer wrong-token' },
      });
      assert.equal(withWrongToken.statusCode, 401);

      const withCorrectToken = await app.inject({
        method: 'GET',
        url: '/api/pdfs',
        headers: { authorization: 'Bearer mcp-test-secret-token' },
      });
      assert.notEqual(withCorrectToken.statusCode, 401);
    } finally {
      await app.close();
    }
  } finally {
    setSystemAuthSettings({ googleAuthEnabled: false });
    await clearTokens();
  }
});

test('MCP bearer token authenticates as the specific account that owns it, not anonymously', async () => {
  seedPdf('mcp-acct-private-a', ACCOUNT_A, 'private');
  await setAccountMcpToken(ACCOUNT_A, 'mcp-account-a-token');
  try {
    const app = await buildApp();
    try {
      // Account A's own token can read its own private presentation.
      const ownToken = await app.inject({
        method: 'GET',
        url: '/api/pdfs/mcp-acct-private-a',
        headers: { authorization: 'Bearer mcp-account-a-token' },
      });
      assert.equal(ownToken.statusCode, 200);

      // An invalid/unrecognized token gets treated as having no session at all
      // (falls back to the ownerless-anonymous model), so a private presentation
      // owned by a real account is still correctly rejected.
      const unknownToken = await app.inject({
        method: 'GET',
        url: '/api/pdfs/mcp-acct-private-a',
        headers: { authorization: 'Bearer not-a-real-token' },
      });
      assert.equal(unknownToken.statusCode, 403);
    } finally {
      await app.close();
    }
  } finally {
    await clearTokens();
    db.prepare(`DELETE FROM pdfs WHERE id = ?`).run('mcp-acct-private-a');
  }
});

test('MCP bearer token does not grant access to a different account\'s private presentation', async () => {
  seedPdf('mcp-acct-private-b', ACCOUNT_B, 'private');
  await setAccountMcpToken(ACCOUNT_A, 'mcp-account-a-token-2');
  try {
    const app = await buildApp();
    try {
      const resp = await app.inject({
        method: 'GET',
        url: '/api/pdfs/mcp-acct-private-b',
        headers: { authorization: 'Bearer mcp-account-a-token-2' },
      });
      assert.equal(resp.statusCode, 403);
    } finally {
      await app.close();
    }
  } finally {
    await clearTokens();
    db.prepare(`DELETE FROM pdfs WHERE id = ?`).run('mcp-acct-private-b');
  }
});

test('POST /api/system/mcp-auth-token lets any logged-in account generate its own token, no admin permission required', async () => {
  setSystemAuthSettings({ googleAuthEnabled: false, adminAccountIds: [] });
  const app = await buildApp();
  try {
    // ACCOUNT_B is not an admin, and generation succeeds anyway.
    const generated = await app.inject({ method: 'POST', url: '/api/system/mcp-auth-token', headers: B_HEADERS });
    assert.equal(generated.statusCode, 200);
    const body = generated.json() as { ok: boolean; token: string; has_mcp_auth_token: boolean };
    assert.equal(body.ok, true);
    assert.equal(body.has_mcp_auth_token, true);
    assert.match(body.token, /^[A-Za-z0-9_-]{43}$/);

    // The token is saved under ACCOUNT_B specifically, not shared with ACCOUNT_A.
    assert.equal(getRuntimeAiSettings(ACCOUNT_B).mcpAuthToken, body.token);
    assert.notEqual(getRuntimeAiSettings(ACCOUNT_A).mcpAuthToken, body.token);

    const settings = await app.inject({ method: 'GET', url: '/api/system/ai-settings', headers: B_HEADERS });
    assert.equal(settings.statusCode, 200);
    const settingsBody = settings.json() as { has_mcp_auth_token?: boolean; mcp_auth_token?: string };
    assert.equal(settingsBody.has_mcp_auth_token, true);
    assert.equal(settingsBody.mcp_auth_token, undefined);

    // A different account (ACCOUNT_A) does not see ACCOUNT_B's token as its own.
    const aSettings = await app.inject({ method: 'GET', url: '/api/system/ai-settings', headers: A_HEADERS });
    const aSettingsBody = aSettings.json() as { has_mcp_auth_token?: boolean };
    assert.equal(aSettingsBody.has_mcp_auth_token, false);
  } finally {
    await app.close();
    await clearTokens();
  }
});
