// Pure helpers for connecting the notebook UI to a Jupyter server (phase 1c-iii).
//
// The backend endpoint `GET /api/jupyter/connection` hands the frontend either an explicit
// base/ws URL (dev/desktop token mode) or empty strings, meaning "connect same-origin using
// NB_PREFIX and the session cookie" (production). These functions resolve that into the
// concrete `{ baseUrl, wsUrl }` that @jupyterlab/services' ServerConnection needs, and map a
// raw kernel `iopub` message into the minimal shape nbformatModel.applyIopub reduces over —
// all without importing the heavy @jupyterlab/services package, so they are unit-testable.

import type { IopubMessage } from './nbformatModel';

export interface JupyterConnectionInfo {
  enabled: true;
  /** Empty → connect same-origin (origin + nbPrefix). */
  baseUrl: string;
  /** Empty → derive from the resolved base URL (http→ws, https→wss). */
  wsUrl: string;
  /** NB_PREFIX so the frontend can build the same-origin base path. */
  nbPrefix: string;
  /** Present only in explicit dev/desktop token mode; empty otherwise (cookie auth). */
  token: string;
}

export interface JupyterUrls {
  baseUrl: string;
  wsUrl: string;
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

function joinPrefix(origin: string, nbPrefix: string): string {
  const base = stripTrailingSlash(origin);
  if (!nbPrefix) return base;
  const prefix = nbPrefix.startsWith('/') ? nbPrefix : `/${nbPrefix}`;
  return stripTrailingSlash(base + prefix);
}

/** http(s):// → ws(s)://; leaves an already-ws(s) or unknown scheme unchanged. */
export function httpToWs(url: string): string {
  if (url.startsWith('https://')) return `wss://${url.slice('https://'.length)}`;
  if (url.startsWith('http://')) return `ws://${url.slice('http://'.length)}`;
  return url;
}

/**
 * Resolve the concrete base + ws URLs to connect with. `origin` is the browser's current
 * origin (e.g. `window.location.origin`); it is only used in same-origin mode.
 */
export function resolveJupyterUrls(info: JupyterConnectionInfo, origin: string): JupyterUrls {
  const baseUrl = info.baseUrl ? stripTrailingSlash(info.baseUrl) : joinPrefix(origin, info.nbPrefix);
  const wsUrl = info.wsUrl ? stripTrailingSlash(info.wsUrl) : httpToWs(baseUrl);
  return { baseUrl, wsUrl };
}

// ---- iopub message mapping (decoupled from @jupyterlab/services) ----

/** The subset of a Jupyter `iopub` message we read: `header.msg_type` + `content`. */
export interface RawKernelMessage {
  header?: { msg_type?: unknown };
  content?: unknown;
}

/**
 * Map a raw kernel message into the `{ msg_type, content }` shape that
 * nbformatModel.applyIopub understands. Returns null for messages without a usable
 * msg_type/content (so callers can ignore them).
 */
export function iopubMessageFrom(raw: RawKernelMessage): IopubMessage | null {
  const msgType = raw.header?.msg_type;
  if (typeof msgType !== 'string') return null;
  const content = raw.content;
  return { msg_type: msgType, content: typeof content === 'object' && content !== null ? (content as Record<string, unknown>) : {} };
}

export type KernelStatus = 'idle' | 'busy' | 'starting' | 'restarting' | 'dead' | 'unknown';

/**
 * Extract the kernel execution state from a `status` iopub message (for the footer
 * status indicator). Returns null when the message is not a recognized status update.
 */
export function kernelStatusFrom(raw: RawKernelMessage): KernelStatus | null {
  if (raw.header?.msg_type !== 'status') return null;
  const state = (raw.content as Record<string, unknown> | undefined)?.execution_state;
  switch (state) {
    case 'idle':
    case 'busy':
    case 'starting':
    case 'restarting':
    case 'dead':
      return state;
    default:
      return 'unknown';
  }
}
