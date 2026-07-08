import type { FastifyInstance } from 'fastify';
import fastifyHttpProxy from '@fastify/http-proxy';
import { config } from '../config';
import { sessionSub, decodeSession, SESSION_COOKIE } from './auth';
import { errorResponse } from './pdfs/shared';

/**
 * Same-origin backend reverse proxy to a local Jupyter server (docs/jupyter-integration-plan.md
 * §2.2, "same-origin cookie mode"). When enabled, `<NB_PREFIX><PROXY_PREFIX>/*` (HTTP + WebSocket)
 * is proxied to `JUPYTER_PROXY_TARGET` (e.g. http://127.0.0.1:8888) so the browser talks to Jupyter
 * same-origin — no CORS, no mixed-content, authenticated by the existing MakeSlide session cookie —
 * and the Jupyter server (which executes arbitrary code) never faces the network directly.
 *
 * The mount path uses a dedicated PROXY_PREFIX (default `/jupyter`) kept separate from NB_PREFIX
 * (MakeSlide's own base) so Jupyter's `/api/*` doesn't collide with MakeSlide's routes/static.
 *
 * SECURITY: because the target is arbitrary-code-execution, both the HTTP route and the WebSocket
 * upgrade are gated on a valid MakeSlide session; an unauthenticated request gets 401 / a rejected
 * handshake and never reaches Jupyter. Run the target bound to localhost.
 */

/** True when the same-origin backend proxy should be mounted (feature on + a target configured). */
export function jupyterProxyEnabled(cfg: { jupyterEnabled: boolean; jupyterProxyTarget: string }): boolean {
  return cfg.jupyterEnabled && cfg.jupyterProxyTarget !== '';
}

/** Path the proxy mounts under (and the base_url the Jupyter server must run with): `<NB_PREFIX><PROXY_PREFIX>`. */
export function jupyterProxyMountPath(cfg: { nbPrefix: string; jupyterProxyPrefix: string }): string {
  const prefix = cfg.jupyterProxyPrefix.startsWith('/') ? cfg.jupyterProxyPrefix : `/${cfg.jupyterProxyPrefix}`;
  return `${cfg.nbPrefix}${prefix.replace(/\/$/, '')}`;
}

/** Verify a MakeSlide session from a raw Cookie header (used for the WebSocket handshake, which has no FastifyRequest). */
export function sessionSubFromCookieHeader(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  const cookies = Object.fromEntries(
    cookieHeader.split(';').map((part) => {
      const [key, ...rest] = part.trim().split('=');
      return [key, decodeURIComponent(rest.join('='))];
    }),
  );
  return decodeSession(cookies[SESSION_COOKIE])?.sub ?? null;
}

export async function jupyterProxyRoutes(app: FastifyInstance): Promise<void> {
  if (!jupyterProxyEnabled(config)) return;
  const token = config.jupyterToken;
  const mountPath = jupyterProxyMountPath(config);
  await app.register(fastifyHttpProxy, {
    upstream: config.jupyterProxyTarget,
    prefix: mountPath,
    // Keep the prefix on the upstream path: the Jupyter server is expected to run with
    // ServerApp.base_url = mountPath, so it serves e.g. `<mountPath>/api/kernels`.
    rewritePrefix: mountPath,
    websocket: true,
    // HTTP guard: only a logged-in MakeSlide session may reach Jupyter.
    preHandler: (request, reply, done) => {
      if (!sessionSub(request)) {
        reply.code(401).send(errorResponse('UNAUTHENTICATED', '需要登入'));
        return;
      }
      done();
    },
    // Inject the Jupyter token on HTTP requests when configured (else assume a token-less
    // localhost Jupyter protected solely by this proxy's session gate).
    replyOptions: token
      ? {
          rewriteRequestHeaders: (_req, headers) => ({ ...headers, authorization: `token ${token}` }),
        }
      : undefined,
    // WebSocket guard: reject the upgrade handshake unless the cookie carries a valid session.
    wsServerOptions: {
      verifyClient: (
        info: { req: { headers: { cookie?: string } } },
        cb: (verified: boolean) => void,
      ) => {
        cb(sessionSubFromCookieHeader(info.req.headers.cookie) != null);
      },
    },
  });
}
