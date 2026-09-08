/**
 * 遠端 MCP 端點（給 ChatGPT 用）與它的 OAuth 授權伺服器。
 *
 * 全部走真的 HTTP 而不是 app.inject()，理由跟其他 MCP 測試一樣，但這裡還多一層：`tools/call`
 * 會讓 `callTool` 從後端內部再打一次迴圈 HTTP 請求回自己，沒有真的在監聽的 port 就跑不起來
 * ——而那條迴圈路徑正是「OAuth token 到底有沒有被當成正確帳號」的唯一實測點。
 *
 * 安全性質是這裡的重點，光是「流程能跑通」不夠：PKCE 驗證、授權碼一次性、redirect_uri
 * 完全比對、refresh token 輪替，每一條錯了都會變成可以拿到別人帳號的漏洞，所以都各有一
 * 條測試釘住。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { buildApp } from '../src/server';
import { db } from '../src/db';
import { encodeSession, SESSION_COOKIE } from '../src/routes/auth';
import { setSystemAuthSettings } from '../src/services/aiSettings';

const ACCOUNT = 'mcp-remote-oauth-account';
const REDIRECT_URI = 'https://chatgpt.com/connector_platform_oauth_redirect';

setSystemAuthSettings({ googleAuthEnabled: false });

function sessionCookie(sub: string): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(encodeSession({ provider: 'google', sub, email: `${sub}@example.com` }))}`;
}

/** PKCE：產生一組 verifier 與對應的 S256 challenge。 */
function pkcePair(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier, 'utf8').digest('base64url');
  return { verifier, challenge };
}

test('remote MCP endpoint with OAuth', async (t) => {
  const app = await buildApp();
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  assert.ok(address && typeof address === 'object', '無法取得測試伺服器的位址');
  const base = `http://127.0.0.1:${address.port}`;

  const createdDeckIds: string[] = [];
  t.after(async () => {
    await app.close();
    for (const id of createdDeckIds) db.prepare('DELETE FROM pdfs WHERE id = ?').run(id);
    db.prepare('DELETE FROM mcp_oauth_clients').run();
    db.prepare('DELETE FROM mcp_oauth_codes').run();
    db.prepare('DELETE FROM mcp_oauth_tokens').run();
  });

  // ── 探索 ────────────────────────────────────────────────────────────────

  await t.test('protected-resource metadata points at this server as its own authorization server', async () => {
    const res = await fetch(`${base}/.well-known/oauth-protected-resource`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { resource: string; authorization_servers: string[] };
    assert.equal(body.resource, `${base}/mcp`);
    assert.deepEqual(body.authorization_servers, [base]);
  });

  await t.test('authorization-server metadata advertises S256', async () => {
    const res = await fetch(`${base}/.well-known/oauth-authorization-server`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      issuer: string;
      authorization_endpoint: string;
      token_endpoint: string;
      registration_endpoint: string;
      code_challenge_methods_supported: string[];
    };
    assert.equal(body.issuer, base);
    assert.equal(body.authorization_endpoint, `${base}/oauth/authorize`);
    assert.equal(body.token_endpoint, `${base}/oauth/token`);
    assert.equal(body.registration_endpoint, `${base}/oauth/register`);
    // 這一條是 ChatGPT 的硬性檢查：沒宣告 S256 就整個 connector 被判不合規。
    assert.ok(
      body.code_challenge_methods_supported.includes('S256'),
      'metadata 必須宣告支援 S256，否則 ChatGPT 會拒絕連線',
    );
  });

  // ── 動態註冊 ────────────────────────────────────────────────────────────

  let clientId = '';

  await t.test('dynamic client registration issues a public client', async () => {
    const res = await fetch(`${base}/oauth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_name: 'ChatGPT', redirect_uris: [REDIRECT_URI] }),
    });
    assert.equal(res.status, 201);
    const body = (await res.json()) as { client_id: string; token_endpoint_auth_method: string };
    assert.ok(body.client_id, '註冊必須回傳 client_id');
    assert.equal(body.token_endpoint_auth_method, 'none', '公開 client 不該有 secret，靠 PKCE 防護');
    clientId = body.client_id;
  });

  await t.test('registration without redirect_uris is rejected', async () => {
    const res = await fetch(`${base}/oauth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_name: 'ChatGPT' }),
    });
    assert.equal(res.status, 400);
  });

  // ── 授權 ────────────────────────────────────────────────────────────────

  /** 走完「顯示同意頁 → 使用者按下允許」，回傳導向網址上的授權碼。 */
  async function approve(challenge: string, opts: { redirectUri?: string; state?: string } = {}): Promise<URL> {
    const form = new URLSearchParams({
      client_id: clientId,
      redirect_uri: opts.redirectUri ?? REDIRECT_URI,
      response_type: 'code',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      ...(opts.state ? { state: opts.state } : {}),
    });
    const res = await fetch(`${base}/oauth/authorize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: sessionCookie(ACCOUNT) },
      body: form.toString(),
      redirect: 'manual',
    });
    assert.equal(res.status, 302, '核可後應該導回 client 的 redirect_uri');
    return new URL(res.headers.get('location') ?? '');
  }

  async function exchange(code: string, verifier: string, redirectUri = REDIRECT_URI) {
    return fetch(`${base}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: clientId,
        redirect_uri: redirectUri,
        code_verifier: verifier,
      }).toString(),
    });
  }

  await t.test('the consent page renders for a logged-in browser', async () => {
    const url = new URL(`${base}/oauth/authorize`);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', REDIRECT_URI);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('code_challenge', pkcePair().challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    const res = await fetch(url, { headers: { Cookie: sessionCookie(ACCOUNT) } });
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /ChatGPT/, '同意頁要說清楚是誰要連線');
    assert.match(html, new RegExp(ACCOUNT), '同意頁要說清楚會用哪個帳號的身分');
  });

  await t.test('an unregistered redirect_uri never gets redirected to', async () => {
    // 這是最要緊的一條：只要放行，攻擊者就能把授權碼導到自己的網址，換到一把等同
    // 受害者帳號的 token。所以錯的 redirect_uri 必須以錯誤頁收場，而不是照著導過去。
    const url = new URL(`${base}/oauth/authorize`);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', 'https://attacker.example/steal');
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('code_challenge', pkcePair().challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    const res = await fetch(url, { headers: { Cookie: sessionCookie(ACCOUNT) }, redirect: 'manual' });
    assert.equal(res.status, 400);
    assert.equal(res.headers.get('location'), null, '未註冊的網址一律不得成為轉址目標');
  });

  await t.test('a non-S256 challenge method is refused', async () => {
    const url = new URL(`${base}/oauth/authorize`);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', REDIRECT_URI);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('code_challenge', 'plain-challenge');
    url.searchParams.set('code_challenge_method', 'plain');
    const res = await fetch(url, { headers: { Cookie: sessionCookie(ACCOUNT) }, redirect: 'manual' });
    assert.equal(res.status, 302, '參數錯誤（但 client 與網址都合法）依規範帶著 error 導回去');
    const location = new URL(res.headers.get('location') ?? '');
    assert.equal(location.searchParams.get('error'), 'invalid_request');
  });

  await t.test('authorizing without a session is refused when Google login is on', async () => {
    setSystemAuthSettings({
      googleAuthEnabled: true,
      googleClientId: 'test-client',
      googleClientSecret: 'test-secret',
    });
    try {
      const url = new URL(`${base}/oauth/authorize`);
      url.searchParams.set('client_id', clientId);
      url.searchParams.set('redirect_uri', REDIRECT_URI);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('code_challenge', pkcePair().challenge);
      url.searchParams.set('code_challenge_method', 'S256');
      const res = await fetch(url, { redirect: 'manual' });
      assert.equal(res.status, 401, '沒有登入 session 就沒有身分可以授權');
    } finally {
      setSystemAuthSettings({ googleAuthEnabled: false });
    }
  });

  // ── 換發 token ──────────────────────────────────────────────────────────

  await t.test('state is echoed back so the client can match the response', async () => {
    const { challenge } = pkcePair();
    const location = await approve(challenge, { state: 'xyz-123' });
    assert.equal(location.searchParams.get('state'), 'xyz-123');
    assert.ok(location.searchParams.get('code'));
  });

  await t.test('a wrong PKCE verifier cannot redeem the code', async () => {
    const { challenge } = pkcePair();
    const location = await approve(challenge);
    const code = location.searchParams.get('code') ?? '';
    // 用另一組完全無關的 verifier——攔截到授權碼但沒拿到 verifier 的攻擊者就是這個處境。
    const res = await exchange(code, pkcePair().verifier);
    assert.equal(res.status, 400);
    assert.equal(((await res.json()) as { error: string }).error, 'invalid_grant');
  });

  await t.test('an authorization code works exactly once', async () => {
    const { verifier, challenge } = pkcePair();
    const location = await approve(challenge);
    const code = location.searchParams.get('code') ?? '';

    const first = await exchange(code, verifier);
    assert.equal(first.status, 200, '第一次換發應該成功');

    const second = await exchange(code, verifier);
    assert.equal(second.status, 400, '同一個授權碼重放必須失敗');
  });

  await t.test('the redirect_uri at the token endpoint must match the one authorized', async () => {
    const { verifier, challenge } = pkcePair();
    const location = await approve(challenge);
    const code = location.searchParams.get('code') ?? '';
    const res = await exchange(code, verifier, 'https://attacker.example/steal');
    assert.equal(res.status, 400);
  });

  let accessToken = '';
  let refreshToken = '';

  await t.test('the full authorization code flow issues a usable token', async () => {
    const { verifier, challenge } = pkcePair();
    const location = await approve(challenge);
    const code = location.searchParams.get('code') ?? '';
    const res = await exchange(code, verifier);
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      access_token: string;
      refresh_token: string;
      token_type: string;
      expires_in: number;
    };
    assert.equal(body.token_type, 'Bearer');
    assert.ok(body.expires_in > 0);
    assert.ok(body.access_token);
    assert.ok(body.refresh_token);
    accessToken = body.access_token;
    refreshToken = body.refresh_token;
  });

  await t.test('refreshing rotates both tokens and retires the old refresh token', async () => {
    const res = await fetch(`${base}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
      }).toString(),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { access_token: string; refresh_token: string };
    assert.notEqual(body.access_token, accessToken, 'access token 應該換新');
    assert.notEqual(body.refresh_token, refreshToken, 'refresh token 應該輪替');

    const replay = await fetch(`${base}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
      }).toString(),
    });
    assert.equal(replay.status, 400, '輪替掉的 refresh token 必須立刻失效');

    // 後面的測試改用這一組新的。
    accessToken = body.access_token;
    refreshToken = body.refresh_token;
  });

  // ── MCP 端點 ────────────────────────────────────────────────────────────

  async function rpc(method: string, params?: unknown, token = accessToken) {
    const res = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    return res;
  }

  await t.test('an unauthenticated request points the client at the OAuth metadata', async () => {
    const res = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    assert.equal(res.status, 401);
    const challenge = res.headers.get('www-authenticate') ?? '';
    // 少了 resource_metadata，ChatGPT 只會看到 401 而不會提示使用者去授權。
    assert.match(challenge, /resource_metadata="/);
    assert.match(challenge, /oauth-protected-resource/);
  });

  await t.test('an invalid token is refused', async () => {
    const res = await rpc('tools/list', undefined, 'not-a-real-token');
    assert.equal(res.status, 401);
  });

  await t.test('initialize echoes back a protocol version the client asked for', async () => {
    const res = await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {} });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { result: { protocolVersion: string; serverInfo: { name: string } } };
    assert.equal(body.result.protocolVersion, '2025-03-26');
    assert.equal(body.result.serverInfo.name, 'makeslide');
  });

  await t.test('an unknown protocol version falls back to the newest supported one', async () => {
    const res = await rpc('initialize', { protocolVersion: '1999-01-01', capabilities: {} });
    const body = (await res.json()) as { result: { protocolVersion: string } };
    assert.equal(body.result.protocolVersion, '2025-06-18');
  });

  await t.test('notifications get 202 with no body', async () => {
    const res = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });
    assert.equal(res.status, 202, '沒有 id 的通知依 JSON-RPC 不該有回應');
  });

  await t.test('tools/list exposes the ChatGPT-mandated search and fetch tools', async () => {
    const res = await rpc('tools/list');
    const body = (await res.json()) as { result: { tools: Array<{ name: string }> } };
    const names = body.result.tools.map((tool) => tool.name);
    // 名稱必須逐字相符，ChatGPT 只認這兩個字。
    assert.ok(names.includes('search'), 'ChatGPT 的深度研究模式要求要有 search');
    assert.ok(names.includes('fetch'), 'ChatGPT 的深度研究模式要求要有 fetch');
    assert.ok(names.includes('list_presentations'), '既有的完整工具集也應該一起暴露出去');
    assert.ok(names.length > 20, `工具數量看起來不對：${names.length}`);
  });

  await t.test('GET is refused with 405 because there is nothing to stream', async () => {
    const res = await fetch(`${base}/mcp`, { headers: { Authorization: `Bearer ${accessToken}` } });
    assert.equal(res.status, 405);
    assert.equal(res.headers.get('allow'), 'POST');
  });

  // 這一條把整串接起來：OAuth token → /mcp → callTool → 迴圈打回 /api → 認回同一個帳號。
  // 中間任何一段接錯，建立出來的簡報就不會屬於這個帳號，或者根本建立不了。
  await t.test('tools/call runs a real tool as the account that authorized', async () => {
    const res = await rpc('tools/call', {
      name: 'create_blank_deck',
      arguments: { title: 'ChatGPT 遠端連線測試' },
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      result: { content: Array<{ text: string }>; isError?: boolean };
    };
    assert.notEqual(body.result.isError, true, `工具呼叫失敗：${body.result.content[0]?.text}`);
    const deckId = /ID：(\S+)/.exec(body.result.content[0]?.text ?? '')?.[1];
    assert.ok(deckId, `工具輸出裡找不到簡報 ID：${body.result.content[0]?.text}`);
    createdDeckIds.push(deckId);

    const row = db.prepare('SELECT owner_sub FROM pdfs WHERE id = ?').get(deckId) as
      | { owner_sub: string | null }
      | undefined;
    assert.ok(row, '簡報應該真的被建立出來');
    assert.equal(row.owner_sub, ACCOUNT, '簡報的擁有者必須是當初授權的那個帳號');
  });

  await t.test('search returns the JSON shape ChatGPT expects', async () => {
    const res = await rpc('tools/call', {
      name: 'search',
      arguments: { query: 'ChatGPT 遠端連線測試' },
    });
    const body = (await res.json()) as { result: { content: Array<{ text: string }>; isError?: boolean } };
    assert.notEqual(body.result.isError, true, `search 失敗：${body.result.content[0]?.text}`);
    const parsed = JSON.parse(body.result.content[0]?.text ?? '{}') as {
      results: Array<{ id: string; title: string; url: string }>;
    };
    assert.ok(Array.isArray(parsed.results), 'search 必須回傳 results 陣列');
    for (const entry of parsed.results) {
      assert.equal(typeof entry.id, 'string');
      assert.equal(typeof entry.title, 'string');
      assert.equal(typeof entry.url, 'string');
    }
  });

  await t.test('fetch returns the full document for a deck id', async () => {
    const deckId = createdDeckIds[0]!;
    const res = await rpc('tools/call', { name: 'fetch', arguments: { id: deckId } });
    const body = (await res.json()) as { result: { content: Array<{ text: string }>; isError?: boolean } };
    assert.notEqual(body.result.isError, true, `fetch 失敗：${body.result.content[0]?.text}`);
    const doc = JSON.parse(body.result.content[0]?.text ?? '{}') as {
      id: string;
      title: string;
      text: string;
      url: string;
    };
    assert.equal(doc.id, deckId);
    assert.equal(doc.title, 'ChatGPT 遠端連線測試');
    assert.equal(typeof doc.text, 'string');
    assert.match(doc.url, new RegExp(deckId));
  });

  await t.test('an unknown method gets a JSON-RPC method-not-found error', async () => {
    const res = await rpc('resources/list');
    const body = (await res.json()) as { error?: { code: number } };
    assert.equal(body.error?.code, -32601);
  });
});
