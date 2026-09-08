/**
 * OAuth 2.1 端點，服務 ChatGPT 對遠端 MCP 連線的授權需求。
 *
 * 這些路由刻意**不**掛在 `/api/` 底下：server.ts 那個「啟用 Google 登入後 /api/ 一律要求
 * session」的 hook 會把它們全部擋掉，而 OAuth 的探索端點與 token 端點本來就必須能匿名存取
 * ——ChatGPT 得先讀得到 metadata、註冊得了 client，才有辦法把使用者導來登入。
 *
 * 授權碼流程的實際樣子：
 *   1. ChatGPT 讀 /.well-known/oauth-protected-resource 找到授權伺服器（就是我們自己）
 *   2. 讀 /.well-known/oauth-authorization-server 取得各端點位置
 *   3. POST /oauth/register 動態註冊自己，拿到 client_id
 *   4. 把使用者的瀏覽器導到 GET /oauth/authorize——這一步要求 makeslide 的登入 session，
 *      核可後帶著授權碼導回 ChatGPT
 *   5. POST /oauth/token 用授權碼＋PKCE code_verifier 換 access token
 *
 * 詳細的安全考量寫在 services/mcpOAuth.ts。
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { decodeSession, parseCookies, SESSION_COOKIE } from './auth';
import { accountIdFromOwnerSub } from '../services/accountContext';
import { getSystemAuthSettings } from '../services/aiSettings';
import {
  getOAuthClient,
  isRegisteredRedirectUri,
  issueAuthorizationCode,
  purgeExpiredOAuthState,
  redeemAuthorizationCode,
  redeemRefreshToken,
  registerOAuthClient,
} from '../services/mcpOAuth';

/**
 * ChatGPT 從公開網際網路連進來，看到的網址不見得等於後端自己綁的位址（中間通常隔著反向
 * 代理）。metadata 裡回報的端點若寫成內部位址，ChatGPT 會照著去打然後連不上，所以優先採用
 * 明確設定的對外網址，其次才從代理轉發的 header 推。
 */
function externalBaseUrl(request: FastifyRequest): string {
  const configured = process.env.MAKESLIDE_PUBLIC_URL?.trim();
  if (configured) return configured.replace(/\/+$/, '');
  const forwardedProto = String(request.headers['x-forwarded-proto'] ?? '').split(',')[0]?.trim();
  const forwardedHost = String(request.headers['x-forwarded-host'] ?? '').split(',')[0]?.trim();
  const proto = forwardedProto || request.protocol;
  const host = forwardedHost || request.headers.host || 'localhost';
  return `${proto}://${host}`;
}

export function mcpResourceUrl(request: FastifyRequest): string {
  return `${externalBaseUrl(request)}/mcp`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 誰在授權。
 *
 * 啟用 Google 登入時，一定要有瀏覽器 session——授權的意義就是「這個帳號本人同意」，
 * 沒有身分就沒有東西可以授權。沒啟用登入時整個服務本來就只有一個預設帳號，直接用它。
 */
function authorizingAccountId(request: FastifyRequest): string | null {
  const session = decodeSession(parseCookies(request)[SESSION_COOKIE]);
  if (session) return accountIdFromOwnerSub(session.sub);
  const auth = getSystemAuthSettings();
  const googleAuthActive = Boolean(auth.googleAuthEnabled && auth.googleClientId && auth.googleClientSecret);
  return googleAuthActive ? null : accountIdFromOwnerSub(null);
}

function consentPage(params: {
  clientName: string;
  accountId: string;
  hiddenFields: Record<string, string>;
}): string {
  const hidden = Object.entries(params.hiddenFields)
    .map(([k, v]) => `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}">`)
    .join('\n      ');
  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>授權連線 — makeslide</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, -apple-system, "Noto Sans TC", sans-serif; margin: 0;
         min-height: 100vh; display: grid; place-items: center; background: #f6f7f9; color: #1a1a1a; }
  @media (prefers-color-scheme: dark) { body { background: #16181c; color: #e8e8e8; } .card { background: #22252b !important; } }
  .card { background: #fff; padding: 2rem; border-radius: 12px; max-width: 30rem; width: calc(100% - 2rem);
          box-shadow: 0 2px 16px rgba(0,0,0,.1); }
  h1 { font-size: 1.25rem; margin: 0 0 1rem; }
  p { line-height: 1.6; margin: .5rem 0; }
  .who { font-weight: 600; }
  ul { line-height: 1.6; padding-left: 1.2rem; }
  button { margin-top: 1.5rem; width: 100%; padding: .75rem; font-size: 1rem; border: 0; border-radius: 8px;
           background: #2563eb; color: #fff; cursor: pointer; }
  button:hover { background: #1d4ed8; }
</style>
</head>
<body>
  <div class="card">
    <h1>授權 <span class="who">${escapeHtml(params.clientName)}</span> 連線</h1>
    <p>它將以 <span class="who">${escapeHtml(params.accountId)}</span> 這個帳號的身分操作 makeslide，權限與你在瀏覽器裡登入時完全相同：</p>
    <ul>
      <li>讀取、建立、修改與刪除這個帳號的簡報</li>
      <li>觸發 AI 生成（會用到這個帳號設定的 API key 與額度）</li>
    </ul>
    <p>不確定這個連線是你自己發起的，就直接關掉這個頁面。</p>
    <form method="post" action="/oauth/authorize">
      ${hidden}
      <button type="submit">允許連線</button>
    </form>
  </div>
</body>
</html>`;
}

function loginRequiredPage(): string {
  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>請先登入 — makeslide</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, -apple-system, "Noto Sans TC", sans-serif; margin: 0;
         min-height: 100vh; display: grid; place-items: center; background: #f6f7f9; color: #1a1a1a; }
  @media (prefers-color-scheme: dark) { body { background: #16181c; color: #e8e8e8; } .card { background: #22252b !important; } }
  .card { background: #fff; padding: 2rem; border-radius: 12px; max-width: 30rem; width: calc(100% - 2rem);
          box-shadow: 0 2px 16px rgba(0,0,0,.1); }
  h1 { font-size: 1.25rem; margin: 0 0 1rem; }
  p { line-height: 1.6; }
  a { color: #2563eb; }
</style>
</head>
<body>
  <div class="card">
    <h1>請先登入 makeslide</h1>
    <p>要授權外部應用程式連線，得先知道你是誰。請<a href="/" target="_blank" rel="noopener">開啟 makeslide 登入</a>，登入完成後回到這一頁按重新整理。</p>
  </div>
</body>
</html>`;
}

export async function mcpOAuthRoutes(app: FastifyInstance) {
  purgeExpiredOAuthState();

  // OAuth 的 token 端點與我們的同意表單都送 form-urlencoded，而 Fastify 內建只解析 JSON
  // ——少了這個 parser，兩者都會直接以 415 收場。寫在這個 plugin 裡，Fastify 的封裝會讓它
  // 只作用於本檔的路由，不影響其餘 API 既有的 JSON-only 行為。
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_request, body, done) => {
      try {
        done(null, Object.fromEntries(new URLSearchParams(body as string)));
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  // ── 探索（discovery）─────────────────────────────────────────────────────
  // ChatGPT 先問「這個資源受誰保護」，再去那個授權伺服器問「端點在哪」。RFC 9728 允許
  // 把資源路徑接在 well-known 後面，兩種形式都要能回答。

  const protectedResourceMetadata = async (request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({
      resource: mcpResourceUrl(request),
      authorization_servers: [externalBaseUrl(request)],
      bearer_methods_supported: ['header'],
      scopes_supported: ['makeslide'],
    });
  };

  app.get('/.well-known/oauth-protected-resource', protectedResourceMetadata);
  app.get('/.well-known/oauth-protected-resource/mcp', protectedResourceMetadata);

  const authorizationServerMetadata = async (request: FastifyRequest, reply: FastifyReply) => {
    const base = externalBaseUrl(request);
    return reply.send({
      issuer: base,
      authorization_endpoint: `${base}/oauth/authorize`,
      token_endpoint: `${base}/oauth/token`,
      registration_endpoint: `${base}/oauth/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      // S256 一定要列出來：ChatGPT 看到授權伺服器沒宣告支援 S256，就會判定不合規而拒絕連線。
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: ['makeslide'],
    });
  };

  app.get('/.well-known/oauth-authorization-server', authorizationServerMetadata);
  app.get('/.well-known/oauth-authorization-server/mcp', authorizationServerMetadata);

  // ── 動態註冊 ────────────────────────────────────────────────────────────

  app.post('/oauth/register', async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const redirectUris = Array.isArray(body.redirect_uris)
      ? body.redirect_uris.filter((u): u is string => typeof u === 'string' && u.length > 0)
      : [];
    if (redirectUris.length === 0) {
      return reply.code(400).send({ error: 'invalid_redirect_uri', error_description: '需要至少一個 redirect_uris。' });
    }
    const clientName = typeof body.client_name === 'string' && body.client_name.trim()
      ? body.client_name.trim().slice(0, 200)
      : '未具名的 MCP client';
    const client = registerOAuthClient(clientName, redirectUris);
    return reply.code(201).send({
      client_id: client.clientId,
      client_name: client.clientName,
      redirect_uris: client.redirectUris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    });
  });

  // ── 授權 ────────────────────────────────────────────────────────────────

  interface AuthorizeParams {
    client_id?: string;
    redirect_uri?: string;
    response_type?: string;
    code_challenge?: string;
    code_challenge_method?: string;
    state?: string;
  }

  /**
   * 驗證授權請求的參數。
   *
   * 順序有講究：client_id 與 redirect_uri 沒驗過之前，任何錯誤都只能直接顯示在我們自己
   * 的頁面上，**不能**導回請求端——那個網址還沒被證實屬於已註冊的 client，照著導就等於
   * 讓任何人拿我們當開放轉址。只有這兩項都確認無誤之後，其餘錯誤才依 OAuth 規範帶著
   * error 參數導回去。
   */
  function validateAuthorize(query: AuthorizeParams):
    | { ok: true; clientName: string; redirectUri: string }
    | { ok: false; status: number; message: string }
    | { ok: false; redirectTo: string } {
    const clientId = query.client_id ?? '';
    const redirectUri = query.redirect_uri ?? '';
    const client = clientId ? getOAuthClient(clientId) : null;
    if (!client) {
      return { ok: false, status: 400, message: 'client_id 無效或尚未註冊。' };
    }
    if (!redirectUri || !isRegisteredRedirectUri(client, redirectUri)) {
      return { ok: false, status: 400, message: 'redirect_uri 與註冊時登記的不符。' };
    }

    const fail = (error: string, description: string) => {
      const url = new URL(redirectUri);
      url.searchParams.set('error', error);
      url.searchParams.set('error_description', description);
      if (query.state) url.searchParams.set('state', query.state);
      return { ok: false as const, redirectTo: url.toString() };
    };

    if (query.response_type !== 'code') return fail('unsupported_response_type', '只支援 response_type=code。');
    if (query.code_challenge_method !== 'S256') return fail('invalid_request', 'PKCE 必須使用 S256。');
    if (!query.code_challenge) return fail('invalid_request', '缺少 code_challenge。');

    return { ok: true, clientName: client.clientName, redirectUri };
  }

  app.get('/oauth/authorize', async (request, reply) => {
    const query = (request.query ?? {}) as AuthorizeParams;
    const validated = validateAuthorize(query);
    if (!validated.ok) {
      if ('redirectTo' in validated) return reply.redirect(302, validated.redirectTo);
      return reply.code(validated.status).type('text/plain; charset=utf-8').send(validated.message);
    }

    const accountId = authorizingAccountId(request);
    if (!accountId) {
      return reply.code(401).type('text/html; charset=utf-8').send(loginRequiredPage());
    }

    return reply.type('text/html; charset=utf-8').send(
      consentPage({
        clientName: validated.clientName,
        accountId,
        hiddenFields: {
          client_id: query.client_id ?? '',
          redirect_uri: query.redirect_uri ?? '',
          response_type: query.response_type ?? '',
          code_challenge: query.code_challenge ?? '',
          code_challenge_method: query.code_challenge_method ?? '',
          ...(query.state ? { state: query.state } : {}),
        },
      }),
    );
  });

  app.post('/oauth/authorize', async (request, reply) => {
    const body = (request.body ?? {}) as AuthorizeParams;
    const validated = validateAuthorize(body);
    if (!validated.ok) {
      if ('redirectTo' in validated) return reply.redirect(302, validated.redirectTo);
      return reply.code(validated.status).type('text/plain; charset=utf-8').send(validated.message);
    }

    // session 在同意頁與這次送出之間可能已經失效（登出、過期），所以重新確認一次而不是
    // 相信表單裡帶回來的任何身分資訊——身分永遠只從 cookie 讀，表單只帶不敏感的參數。
    const accountId = authorizingAccountId(request);
    if (!accountId) {
      return reply.code(401).type('text/html; charset=utf-8').send(loginRequiredPage());
    }

    const code = issueAuthorizationCode({
      clientId: body.client_id ?? '',
      accountId,
      redirectUri: validated.redirectUri,
      codeChallenge: body.code_challenge ?? '',
    });

    const url = new URL(validated.redirectUri);
    url.searchParams.set('code', code);
    if (body.state) url.searchParams.set('state', body.state);
    return reply.redirect(302, url.toString());
  });

  // ── 換發 token ──────────────────────────────────────────────────────────

  app.post('/oauth/token', async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const str = (key: string): string => (typeof body[key] === 'string' ? (body[key] as string) : '');
    const grantType = str('grant_type');
    const clientId = str('client_id');

    if (grantType === 'authorization_code') {
      const result = redeemAuthorizationCode({
        code: str('code'),
        clientId,
        redirectUri: str('redirect_uri'),
        codeVerifier: str('code_verifier'),
      });
      if (!result.ok) {
        return reply.code(400).send({ error: result.error, error_description: '授權碼無效、已使用或已過期。' });
      }
      return reply.send({
        access_token: result.tokens.accessToken,
        refresh_token: result.tokens.refreshToken,
        token_type: 'Bearer',
        expires_in: result.tokens.expiresInSeconds,
        scope: 'makeslide',
      });
    }

    if (grantType === 'refresh_token') {
      const result = redeemRefreshToken(str('refresh_token'), clientId);
      if (!result.ok) {
        return reply.code(400).send({ error: result.error, error_description: 'refresh token 無效或已被輪替。' });
      }
      return reply.send({
        access_token: result.tokens.accessToken,
        refresh_token: result.tokens.refreshToken,
        token_type: 'Bearer',
        expires_in: result.tokens.expiresInSeconds,
        scope: 'makeslide',
      });
    }

    return reply.code(400).send({
      error: 'unsupported_grant_type',
      error_description: '只支援 authorization_code 與 refresh_token。',
    });
  });
}
