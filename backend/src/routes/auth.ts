import crypto from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { config } from '../config';
import { getRuntimeAiSettings } from '../services/aiSettings';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const SESSION_COOKIE = 'makeslide_session';
const OAUTH_STATE_COOKIE = 'makeslide_oauth_state';
const GOOGLE_OAUTH_CLIENT_ID_SUFFIX = '.apps.googleusercontent.com';

export interface GoogleAccountSession {
  provider: 'google';
  sub: string;
  email: string;
  name?: string;
  picture?: string;
}

const TokenResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.string().optional(),
  expires_in: z.number().optional(),
});

const GoogleUserInfoSchema = z.object({
  sub: z.string(),
  email: z.string().email(),
  name: z.string().optional(),
  picture: z.string().url().optional(),
});

function base64UrlEncode(input: Buffer | string): string {
  const raw = Buffer.isBuffer(input) ? input : Buffer.from(input, 'utf8');
  return raw.toString('base64url');
}

function signPayload(payload: string): string {
  return crypto
    .createHmac('sha256', config.authSessionSecret)
    .update(payload)
    .digest('base64url');
}

function encodeSession(session: GoogleAccountSession): string {
  const payload = base64UrlEncode(JSON.stringify(session));
  return `${payload}.${signPayload(payload)}`;
}

export function decodeSession(value: string | undefined): GoogleAccountSession | null {
  if (!value) return null;
  const [payload, signature] = value.split('.');
  if (!payload || !signature || signPayload(payload) !== signature) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as unknown;
    return GoogleUserInfoSchema.extend({ provider: z.literal('google') }).parse(parsed);
  } catch {
    return null;
  }
}

export function parseCookies(request: FastifyRequest): Record<string, string> {
  const header = request.headers.cookie;
  if (!header) return {};
  return Object.fromEntries(
    header.split(';').map((part) => {
      const [key, ...rest] = part.trim().split('=');
      return [key, decodeURIComponent(rest.join('='))];
    }),
  );
}

function setCookie(reply: FastifyReply, name: string, value: string, maxAgeSeconds: number): void {
  reply.header(
    'set-cookie',
    `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; SameSite=Lax`,
  );
}

function clearCookie(reply: FastifyReply, name: string): void {
  reply.header('set-cookie', `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
}

function authBaseUrl(request: FastifyRequest): string {
  const proto = request.headers['x-forwarded-proto']?.toString().split(',')[0] || 'https';
  const host = request.headers['x-forwarded-host']?.toString().split(',')[0] || request.headers.host || `localhost:${config.port}`;
  return `${proto}://${host}${config.nbPrefix}`;
}

function redirectUri(request: FastifyRequest): string {
  if (!config.googleRedirectUri) {
    return `${authBaseUrl(request)}/api/auth/google/callback`;
  }
  if (config.googleRedirectUri.startsWith('/')) {
    return `${authBaseUrl(request)}${config.googleRedirectUri}`;
  }
  return config.googleRedirectUri;
}

export async function authRoutes(app: FastifyInstance) {
  app.get('/api/auth/status', async (request) => {
    const runtime = getRuntimeAiSettings();
    const session = decodeSession(parseCookies(request)[SESSION_COOKIE]);
    return {
      google_enabled: Boolean(runtime.googleAuthEnabled && runtime.googleClientId && runtime.googleClientSecret),
      authenticated: Boolean(session),
      user: session,
    };
  });

  app.get('/api/auth/google/start', async (request, reply) => {
    const runtime = getRuntimeAiSettings();
    if (!runtime.googleAuthEnabled) {
      return reply.code(503).send({
        error: {
          code: 'GOOGLE_AUTH_DISABLED',
          message: 'Google 登入已停用',
        },
      });
    }
    if (!runtime.googleClientId || !runtime.googleClientSecret) {
      return reply.code(503).send({
        error: {
          code: 'GOOGLE_AUTH_NOT_CONFIGURED',
          message: 'Google 登入尚未設定 GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET',
        },
      });
    }
    if (!runtime.googleClientId.endsWith(GOOGLE_OAUTH_CLIENT_ID_SUFFIX)) {
      return reply.code(503).send({
        error: {
          code: 'GOOGLE_AUTH_CLIENT_ID_INVALID',
          message: `GOOGLE_CLIENT_ID 看起來不是 OAuth Web Client ID，應以 ${GOOGLE_OAUTH_CLIENT_ID_SUFFIX} 結尾`,
        },
      });
    }
    const state = crypto.randomBytes(24).toString('base64url');
    setCookie(reply, OAUTH_STATE_COOKIE, state, 10 * 60);
    const params = new URLSearchParams({
      client_id: runtime.googleClientId,
      redirect_uri: redirectUri(request),
      response_type: 'code',
      scope: 'openid email profile',
      state,
      prompt: 'select_account',
    });
    return reply.redirect(`${GOOGLE_AUTH_URL}?${params.toString()}`);
  });

  app.get('/api/auth/google/callback', async (request, reply) => {
    const runtime = getRuntimeAiSettings();
    const query = z.object({ code: z.string(), state: z.string() }).safeParse(request.query);
    const expectedState = parseCookies(request)[OAUTH_STATE_COOKIE];
    clearCookie(reply, OAUTH_STATE_COOKIE);
    if (!query.success || !expectedState || query.data.state !== expectedState) {
      return reply.code(400).send({ error: { code: 'INVALID_OAUTH_STATE', message: 'Google 登入驗證失敗' } });
    }

    const tokenResp = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: query.data.code,
        client_id: runtime.googleClientId,
        client_secret: runtime.googleClientSecret,
        redirect_uri: redirectUri(request),
        grant_type: 'authorization_code',
      }),
    });
    if (!tokenResp.ok) {
      return reply.code(502).send({ error: { code: 'GOOGLE_TOKEN_EXCHANGE_FAILED', message: 'Google token 交換失敗' } });
    }
    const token = TokenResponseSchema.parse(await tokenResp.json());
    const userResp = await fetch(GOOGLE_USERINFO_URL, {
      headers: { authorization: `Bearer ${token.access_token}` },
    });
    if (!userResp.ok) {
      return reply.code(502).send({ error: { code: 'GOOGLE_USERINFO_FAILED', message: 'Google 帳號資訊讀取失敗' } });
    }
    const user = GoogleUserInfoSchema.parse(await userResp.json());
    setCookie(reply, SESSION_COOKIE, encodeSession({ provider: 'google', ...user }), 30 * 24 * 60 * 60);
    return reply.redirect(`${config.nbPrefix || ''}/#/settings`);
  });

  app.post('/api/auth/logout', async (_request, reply) => {
    clearCookie(reply, SESSION_COOKIE);
    return { ok: true };
  });
}
