// React hook that connects a notebook slide page to a real Jupyter kernel (phase 1c-iii-b).
//
// @jupyterlab/services is heavy, so it is **lazy-loaded** via dynamic import — only when a
// notebook page is actually opened, keeping it out of the main player bundle. Connection
// parameters come from the session-protected backend endpoint (phase 1a) and are resolved
// by the pure helpers in jupyterConnection.ts. One kernel is kept per notebook file
// (`${pdfId}:${pageNumber}`) in a module-level registry so it stays warm across page
// switches (plan §1.3); execution streams `iopub` messages which the caller reduces with
// nbformatModel.applyIopub.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Kernel } from '@jupyterlab/services';
import { fetchJupyterConnection } from '../../lib/api/jupyter';
import { iopubMessageFrom, kernelStatusFrom, resolveJupyterUrls, isJupyterDisabledError, type KernelStatus } from '../../lib/jupyterConnection';
import type { IopubMessage } from '../../lib/nbformatModel';

// 'disabled' = backend JUPYTER_ENABLED is off (connection endpoint 404s), distinct from a real
// connection failure ('unavailable') so the UI can say "not enabled" instead of "can't connect".
export type KernelPhase = 'idle' | 'connecting' | 'ready' | 'busy' | 'unavailable' | 'disabled' | 'error';

export interface ExecuteHandlers {
  onIopub: (msg: IopubMessage) => void;
}

export interface ExecuteResult {
  executionCount: number | null;
}

// Module-level so a kernel survives component unmount/remount and page switches (warm kernel).
interface KernelEntry {
  kernel: Kernel.IKernelConnection;
  managerDispose: () => void;
}
const kernelRegistry = new Map<string, Promise<KernelEntry>>();

let servicesModulePromise: Promise<typeof import('@jupyterlab/services')> | null = null;
function loadServices(): Promise<typeof import('@jupyterlab/services')> {
  if (!servicesModulePromise) servicesModulePromise = import('@jupyterlab/services');
  return servicesModulePromise;
}

async function connectKernel(notebookKey: string): Promise<KernelEntry> {
  const info = await fetchJupyterConnection(); // throws when disabled (404) / unauthenticated (401)
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const { baseUrl, wsUrl } = resolveJupyterUrls(info, origin);
  const { ServerConnection, KernelManager } = await loadServices();
  const serverSettings = ServerConnection.makeSettings({ baseUrl, wsUrl, token: info.token || '' });
  const manager = new KernelManager({ serverSettings });
  await manager.ready;
  const kernel = await manager.startNew({ name: 'python3' });
  await kernel.info; // wait until the kernel is actually alive
  void notebookKey;
  return { kernel, managerDispose: () => manager.dispose() };
}

function getKernel(notebookKey: string): Promise<KernelEntry> {
  let entry = kernelRegistry.get(notebookKey);
  if (!entry) {
    entry = connectKernel(notebookKey).catch((err) => {
      // Don't cache a failed attempt, so a later retry can reconnect.
      kernelRegistry.delete(notebookKey);
      throw err;
    });
    kernelRegistry.set(notebookKey, entry);
  }
  return entry;
}

async function shutdownKernel(notebookKey: string): Promise<void> {
  const entry = kernelRegistry.get(notebookKey);
  kernelRegistry.delete(notebookKey);
  if (!entry) return;
  try {
    const resolved = await entry;
    await resolved.kernel.shutdown().catch(() => undefined);
    resolved.managerDispose();
  } catch {
    // connection never succeeded; nothing to shut down
  }
}

export interface UseJupyterKernelResult {
  phase: KernelPhase;
  status: KernelStatus | null;
  /** Connect (or reuse) the kernel for this notebook; safe to call repeatedly. */
  connect: () => void;
  /** Execute code on the page's kernel, streaming iopub messages to the handler. */
  execute: (code: string, handlers: ExecuteHandlers) => Promise<ExecuteResult>;
  /** Restart the kernel (clears its state); outputs are the caller's concern. */
  restart: () => Promise<void>;
}

export function useJupyterKernel(notebookKey: string | null): UseJupyterKernelResult {
  const [phase, setPhase] = useState<KernelPhase>('idle');
  const [status, setStatus] = useState<KernelStatus | null>(null);
  // Track the latest key so async callbacks don't apply to a stale page.
  const keyRef = useRef(notebookKey);
  keyRef.current = notebookKey;

  const connect = useCallback(() => {
    const key = keyRef.current;
    if (!key) return;
    setPhase((p) => (p === 'ready' || p === 'busy' ? p : 'connecting'));
    getKernel(key)
      .then((entry) => {
        if (keyRef.current !== key) return;
        entry.kernel.statusChanged.connect((_, s) => {
          if (keyRef.current === key) setStatus(s === 'idle' || s === 'busy' || s === 'starting' || s === 'restarting' || s === 'dead' ? s : 'unknown');
        });
        setPhase('ready');
      })
      .catch((err) => {
        if (keyRef.current === key) setPhase(isJupyterDisabledError(err) ? 'disabled' : 'unavailable');
      });
  }, []);

  const execute = useCallback(async (code: string, handlers: ExecuteHandlers): Promise<ExecuteResult> => {
    const key = keyRef.current;
    if (!key) throw new Error('No notebook page selected');
    const entry = await getKernel(key);
    setPhase('busy');
    let executionCount: number | null = null;
    const future = entry.kernel.requestExecute({ code, stop_on_error: true });
    future.onIOPub = (raw) => {
      const status = kernelStatusFrom(raw as { header?: { msg_type?: unknown }; content?: unknown });
      if (status && keyRef.current === key) setStatus(status);
      const msg = iopubMessageFrom(raw as { header?: { msg_type?: unknown }; content?: unknown });
      if (msg) {
        if (msg.msg_type === 'execute_input') {
          const count = (msg.content as { execution_count?: unknown }).execution_count;
          if (typeof count === 'number') executionCount = count;
        }
        handlers.onIopub(msg);
      }
    };
    await future.done;
    if (keyRef.current === key) setPhase('ready');
    return { executionCount };
  }, []);

  const restart = useCallback(async () => {
    const key = keyRef.current;
    if (!key) return;
    const entry = await getKernel(key);
    await entry.kernel.restart();
  }, []);

  // Shut the kernel down when the whole notebook page is left (key → null). Switching
  // between notebook pages keeps each page's kernel warm in the registry.
  useEffect(() => {
    if (!notebookKey) return;
    return () => {
      // Best-effort: only shut down if we're truly leaving this key (not a quick remount).
      const leavingKey = notebookKey;
      window.setTimeout(() => {
        if (keyRef.current !== leavingKey) void shutdownKernel(leavingKey);
      }, 0);
    };
  }, [notebookKey]);

  return { phase, status, connect, execute, restart };
}
