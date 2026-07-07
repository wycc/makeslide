import type { FastifyInstance } from 'fastify';
import { config } from '../config';
import { sessionSub } from './auth';
import { errorResponse } from './pdfs/shared';

/**
 * Connection parameters the frontend needs to talk to the Jupyter server with
 * `@jupyterlab/services` (docs/jupyter-integration-plan.md §2.2).
 *
 * Two modes:
 *  - Same-origin cookie mode (production): `baseUrl`/`wsUrl` empty → the frontend
 *    uses the current origin + `nbPrefix`, and the browser's existing session
 *    cookie authenticates. No token is ever shipped to the bundle.
 *  - Explicit URL + token mode (dev/desktop): `baseUrl` is set and, if a token is
 *    configured, it is handed out here (only over this session-protected endpoint).
 */
export interface JupyterConnectionInfo {
  enabled: true;
  /** Empty → frontend connects same-origin. */
  baseUrl: string;
  /** Empty → derive from baseUrl (http→ws, https→wss). */
  wsUrl: string;
  /** NB_PREFIX so the frontend can build the same-origin base path. */
  nbPrefix: string;
  /** Present only in the explicit dev/desktop token mode; empty otherwise. */
  token: string;
}

/** Derive a WebSocket URL from an http(s) base URL. Empty in → empty out. */
export function deriveWsUrl(baseUrl: string): string {
  if (!baseUrl) return '';
  if (baseUrl.startsWith('https://')) return `wss://${baseUrl.slice('https://'.length)}`;
  if (baseUrl.startsWith('http://')) return `ws://${baseUrl.slice('http://'.length)}`;
  return baseUrl;
}

export async function jupyterRoutes(app: FastifyInstance) {
  // Session-protected. When the feature is disabled the endpoint 404s so the whole
  // capability stays hidden (zero-risk rollout — see plan §2.1).
  app.get('/api/jupyter/connection', async (request, reply) => {
    if (!config.jupyterEnabled) {
      return reply.code(404).send(errorResponse('NOT_FOUND', 'Jupyter 整合未啟用'));
    }
    const sub = sessionSub(request);
    if (!sub) {
      return reply.code(401).send(errorResponse('UNAUTHENTICATED', '需要登入'));
    }
    const baseUrl = config.jupyterBaseUrl;
    const info: JupyterConnectionInfo = {
      enabled: true,
      baseUrl,
      wsUrl: deriveWsUrl(baseUrl),
      nbPrefix: config.nbPrefix,
      // Only meaningful in explicit-URL mode; same-origin production leaves it empty
      // and relies on the cookie.
      token: baseUrl ? config.jupyterToken : '',
    };
    return reply.send(info);
  });
}
