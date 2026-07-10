import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { config } from '../config';
import { sessionEmail, sessionSub } from './auth';
import { errorResponse } from './pdfs/shared';
import { jupyterProxyEnabled, jupyterProxyMountPath } from './jupyterProxy';
import { getNotebook, listNotebooks, notebookHasGpu, notebookImage, notebookState } from '../services/kubeflowClient';

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

// --- Kubeflow mode helpers (docs/jupyter-kubeflow-plan.md §3.2/§3.4) -------------

/** Lowercase + strip to DNS-1123-label-safe characters (k8s namespace/name component rules). */
export function sanitizeDnsLabel(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);
  return cleaned || 'user';
}

/** Derive a user's Kubeflow profile namespace from their MakeSlide session email + a `{user}` template. */
export function namespaceForUser(email: string, template: string): string {
  const local = sanitizeDnsLabel(email.split('@')[0] ?? email);
  return template.replace('{user}', local);
}

const RUNTIME_TOKEN_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * DNS-label whitelist for the `?runtime=` query param, so it can only ever select a
 * `<prefix><runtime>` name in the caller's own namespace — never traverse into an
 * arbitrary/foreign notebook name.
 */
export function isValidRuntimeToken(v: string): boolean {
  return RUNTIME_TOKEN_RE.test(v);
}

export function notebookNameForRuntime(prefix: string, runtime: string): string {
  return `${prefix}${runtime}`;
}

/** Inverse of `notebookNameForRuntime`: the runtime suffix, or `null` if the name doesn't carry the prefix. */
export function runtimeFromNotebookName(prefix: string, name: string): string | null {
  return name.startsWith(prefix) ? name.slice(prefix.length) : null;
}

/** Zero-config default runtime when the caller doesn't pick one (persisted-preference lookup lands in phase 7b). */
const DEFAULT_RUNTIME = 'cpu';

export interface RuntimeInfo {
  runtime: string;
  status: 'running' | 'pending' | 'stopped';
  gpu: boolean;
  image: string | null;
}

const ConnectionQuerySchema = z.object({ runtime: z.string().optional() });

async function handleKubeflowConnection(request: FastifyRequest, reply: FastifyReply) {
  const sub = sessionSub(request);
  const email = sessionEmail(request);
  if (!sub || !email) {
    return reply.code(401).send(errorResponse('UNAUTHENTICATED', '需要登入'));
  }
  const query = ConnectionQuerySchema.safeParse(request.query);
  const runtime = query.success && query.data.runtime ? query.data.runtime : DEFAULT_RUNTIME;
  if (!isValidRuntimeToken(runtime)) {
    return reply.code(400).send(errorResponse('INVALID_RUNTIME', 'runtime 參數含不允許的字元'));
  }

  // Server-enforced: always the caller's own namespace, never trusted from the client.
  const namespace = namespaceForUser(email, config.kubeflowDefaultNamespaceTemplate);
  const name = notebookNameForRuntime(config.kubeflowNotebookPrefix, runtime);

  let cr;
  try {
    cr = await getNotebook(namespace, name);
  } catch {
    return reply.code(502).send(errorResponse('KUBEFLOW_API_ERROR', '無法連線至 Kubeflow API'));
  }
  const state = notebookState(cr);

  switch (state) {
    case 'running': {
      const info: JupyterConnectionInfo = {
        enabled: true,
        baseUrl: '',
        wsUrl: '',
        nbPrefix: `/notebook/${namespace}/${name}`,
        token: '',
      };
      return reply.send(info);
    }
    case 'pending':
      return reply.code(202).send({ starting: true });
    case 'stopped':
      // Waking a stopped notebook (patch the stopped annotation) lands in phase 7c.
      return reply.code(503).send(errorResponse('NOTEBOOK_STOPPED', `Notebook ${name} 已停止，請於 Kubeflow 啟動`));
    case 'not_found':
      // Auto-creating the zero-config makeslide-jupyter-cpu default lands in phase 7c.
      return reply
        .code(404)
        .send(errorResponse('NOTEBOOK_NOT_FOUND', `找不到 notebook ${name}，請於 Kubeflow 建立`));
  }
}

/**
 * `GET /api/jupyter/runtimes` (§3.4): list the caller's own `makeslide-jupyter-*`
 * notebooks so the UI can offer a runtime picker alongside the kernelspec picker.
 * Notebooks not matching the configured prefix are invisible here — MakeSlide never
 * touches a user's other notebooks.
 */
async function handleKubeflowRuntimes(request: FastifyRequest, reply: FastifyReply) {
  const email = sessionEmail(request);
  if (!email) {
    return reply.code(401).send(errorResponse('UNAUTHENTICATED', '需要登入'));
  }
  const namespace = namespaceForUser(email, config.kubeflowDefaultNamespaceTemplate);
  const prefix = config.kubeflowNotebookPrefix;

  let notebooks;
  try {
    notebooks = await listNotebooks(namespace);
  } catch {
    return reply.code(502).send(errorResponse('KUBEFLOW_API_ERROR', '無法連線至 Kubeflow API'));
  }

  const runtimes: RuntimeInfo[] = [];
  for (const cr of notebooks) {
    const runtime = runtimeFromNotebookName(prefix, cr.metadata.name);
    if (runtime === null) continue;
    const state = notebookState(cr);
    if (state === 'not_found') continue; // unreachable (cr came from the list itself), but narrows the type
    runtimes.push({ runtime, status: state, gpu: notebookHasGpu(cr), image: notebookImage(cr) });
  }
  return reply.send({ runtimes });
}

export async function jupyterRoutes(app: FastifyInstance) {
  // Session-protected. When the feature is disabled the endpoint 404s so the whole
  // capability stays hidden (zero-risk rollout — see plan §2.1).
  app.get('/api/jupyter/connection', async (request, reply) => {
    if (!config.jupyterEnabled) {
      return reply.code(404).send(errorResponse('NOT_FOUND', 'Jupyter 整合未啟用'));
    }
    if (config.jupyterMode === 'kubeflow') {
      return handleKubeflowConnection(request, reply);
    }
    const sub = sessionSub(request);
    if (!sub) {
      return reply.code(401).send(errorResponse('UNAUTHENTICATED', '需要登入'));
    }
    const baseUrl = config.jupyterBaseUrl;
    // When the backend same-origin proxy is on, the frontend must connect to the proxy's mount
    // path (`<NB_PREFIX><PROXY_PREFIX>`), not MakeSlide's own NB_PREFIX; the session cookie
    // authenticates and no token is exposed.
    const sameOriginPrefix = jupyterProxyEnabled(config) ? jupyterProxyMountPath(config) : config.nbPrefix;
    const info: JupyterConnectionInfo = {
      enabled: true,
      baseUrl,
      wsUrl: deriveWsUrl(baseUrl),
      nbPrefix: sameOriginPrefix,
      // Only meaningful in explicit-URL mode; same-origin (proxy or Hub) relies on the cookie.
      token: baseUrl ? config.jupyterToken : '',
    };
    return reply.send(info);
  });

  // Only meaningful in kubeflow mode (single-server modes have exactly one implicit
  // "runtime"); 404 otherwise so the frontend can treat 404 as "no picker needed".
  app.get('/api/jupyter/runtimes', async (request, reply) => {
    if (!config.jupyterEnabled || config.jupyterMode !== 'kubeflow') {
      return reply.code(404).send(errorResponse('NOT_FOUND', 'Jupyter 整合未啟用'));
    }
    return handleKubeflowRuntimes(request, reply);
  });
}
