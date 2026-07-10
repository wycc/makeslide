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
import { fetchJupyterConnection, type JupyterConnectionInfo } from '../../lib/api/jupyter';
import {
  iopubMessageFrom,
  kernelStatusFrom,
  resolveJupyterUrls,
  isJupyterDisabledError,
  isJupyterStartingError,
  type KernelStatus,
} from '../../lib/jupyterConnection';
import type { IopubMessage } from '../../lib/nbformatModel';

// 'disabled' = backend JUPYTER_ENABLED is off (connection endpoint 404s), distinct from a real
// connection failure ('unavailable') so the UI can say "not enabled" instead of "can't connect".
// 'starting' = the Kubeflow notebook Pod is booting (waking from stopped, or the zero-config
// default being auto-created) — distinct from 'connecting' so the UI reads as "the backend is
// doing something", not "stuck" (docs/jupyter-kubeflow-plan.md §3.2/§3.5).
export type KernelPhase = 'idle' | 'connecting' | 'starting' | 'ready' | 'busy' | 'unavailable' | 'disabled' | 'error';

/** How often to re-poll `GET /api/jupyter/connection` while it reports `202 {starting:true}`. */
const STARTING_POLL_INTERVAL_MS = 3_000;
/** Give up after ~2 minutes rather than polling forever if the Pod never becomes ready. */
const STARTING_MAX_ATTEMPTS = 40;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Resolve connection info, transparently polling while the Kubeflow notebook Pod is starting
 * (§3.2/§3.5's `202 {starting:true}`). `onStarting` fires once per poll tick so the caller can
 * reflect a distinct "starting" phase instead of looking stuck on 'connecting'.
 */
async function waitForJupyterConnection(runtime: string | undefined, onStarting?: () => void): Promise<JupyterConnectionInfo> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetchJupyterConnection(runtime);
    } catch (err) {
      if (!isJupyterStartingError(err) || attempt >= STARTING_MAX_ATTEMPTS) throw err;
      onStarting?.();
      await sleep(STARTING_POLL_INTERVAL_MS);
    }
  }
}

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

async function connectKernel(kernelName: string, runtime?: string, onStarting?: () => void): Promise<KernelEntry> {
  const info = await waitForJupyterConnection(runtime, onStarting); // throws when disabled (404) / unauthenticated (401)
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const { baseUrl, wsUrl } = resolveJupyterUrls(info, origin);
  const { ServerConnection, KernelManager } = await loadServices();
  const serverSettings = ServerConnection.makeSettings({ baseUrl, wsUrl, token: info.token || '' });
  const manager = new KernelManager({ serverSettings });
  await manager.ready;
  const kernel = await manager.startNew({ name: kernelName });
  await kernel.info; // wait until the kernel is actually alive
  return { kernel, managerDispose: () => manager.dispose() };
}

/** One selectable kernel; each Conda/Anaconda env registered as a kernelspec appears here. */
export interface KernelSpecInfo {
  name: string;
  displayName: string;
}

// List the Jupyter server's kernelspecs so the UI can offer an environment picker. A Conda/Anaconda
// environment shows up once it is registered as a kernelspec (e.g. via nb_conda_kernels, or
// `<env>/bin/python -m ipykernel install`). Returns [] when Jupyter is disabled/unreachable.
export async function listKernelSpecs(runtime?: string): Promise<KernelSpecInfo[]> {
  const info = await fetchJupyterConnection(runtime);
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const { baseUrl, wsUrl } = resolveJupyterUrls(info, origin);
  const { ServerConnection, KernelSpecManager } = await loadServices();
  const serverSettings = ServerConnection.makeSettings({ baseUrl, wsUrl, token: info.token || '' });
  const manager = new KernelSpecManager({ serverSettings });
  await manager.ready;
  const specs = manager.specs;
  manager.dispose();
  if (!specs) return [];
  return Object.values(specs.kernelspecs)
    .filter((s): s is NonNullable<typeof s> => Boolean(s))
    .map((s) => ({ name: s.name, displayName: s.display_name || s.name }));
}

function getKernel(regKey: string, kernelName: string, runtime?: string, onStarting?: () => void): Promise<KernelEntry> {
  let entry = kernelRegistry.get(regKey);
  if (!entry) {
    entry = connectKernel(kernelName, runtime, onStarting).catch((err) => {
      // Don't cache a failed attempt, so a later retry can reconnect.
      kernelRegistry.delete(regKey);
      throw err;
    });
    kernelRegistry.set(regKey, entry);
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

export function useJupyterKernel(notebookKey: string | null, kernelName = 'python3', runtime?: string): UseJupyterKernelResult {
  const [phase, setPhase] = useState<KernelPhase>('idle');
  const [status, setStatus] = useState<KernelStatus | null>(null);
  // One warm kernel per (page, environment, runtime); switching either starts a fresh kernel
  // (a different runtime is a different notebook Pod entirely — plan §3.4).
  const regKey = notebookKey ? `${notebookKey}::${kernelName}::${runtime ?? ''}` : null;
  // Track the latest key / kernel name / runtime so async callbacks don't apply to a stale page/env.
  const keyRef = useRef(regKey);
  keyRef.current = regKey;
  const kernelNameRef = useRef(kernelName);
  kernelNameRef.current = kernelName;
  const runtimeRef = useRef(runtime);
  runtimeRef.current = runtime;

  const connect = useCallback(() => {
    const key = keyRef.current;
    if (!key) return;
    setPhase((p) => (p === 'ready' || p === 'busy' ? p : 'connecting'));
    const onStarting = () => {
      if (keyRef.current === key) setPhase('starting');
    };
    getKernel(key, kernelNameRef.current, runtimeRef.current, onStarting)
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
    const entry = await getKernel(key, kernelNameRef.current, runtimeRef.current);
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
    const entry = await getKernel(key, kernelNameRef.current, runtimeRef.current);
    await entry.kernel.restart();
  }, []);

  // Reset phase when the environment or runtime changes: the newly-selected kernel isn't
  // connected yet (a different runtime is a whole different notebook Pod — plan §3.4).
  useEffect(() => {
    setPhase('idle');
    setStatus(null);
  }, [kernelName, runtime]);

  // Shut the kernel down when leaving the page (key → null) or switching environment. Switching
  // between notebook pages keeps each (page, env) kernel warm in the registry.
  useEffect(() => {
    if (!regKey) return;
    return () => {
      // Best-effort: only shut down if we're truly leaving this key (not a quick remount).
      const leavingKey = regKey;
      window.setTimeout(() => {
        if (keyRef.current !== leavingKey) void shutdownKernel(leavingKey);
      }, 0);
    };
  }, [regKey]);

  return { phase, status, connect, execute, restart };
}
