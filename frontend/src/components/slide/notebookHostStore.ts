/**
 * Tiny external store coordinating the single shared NotebookPanel instance
 * (see NotebookPanelSingleton in SlideRenderer.tsx) with the places that want
 * to display it. Each SlideRenderer rendering a notebook page registers its
 * empty "slot" element here; the singleton portals the one panel into the
 * active slot. The fullscreen overlay's slot wins over the always-mounted
 * normal panel's slot, so entering/leaving fullscreen just moves the same
 * panel (and all its editing/kernel state) between containers instead of
 * mounting a second, out-of-sync instance.
 */
export interface NotebookHostEntry {
  el: HTMLElement;
  fullscreen: boolean;
  maxHeight?: string | number;
}

let hosts: readonly NotebookHostEntry[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Registers a slot element; returns its unregister function. */
export function registerNotebookHost(entry: NotebookHostEntry): () => void {
  hosts = [...hosts, entry];
  emit();
  return () => {
    hosts = hosts.filter((h) => h !== entry);
    emit();
  };
}

/** For useSyncExternalStore. */
export function subscribeNotebookHosts(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The slot the shared panel should live in right now: the most recently
 * registered fullscreen slot if any, otherwise the most recent normal slot,
 * otherwise null (panel stays mounted but detached, preserving its state).
 * Returns a stable reference while registrations are unchanged.
 */
export function activeNotebookHost(): NotebookHostEntry | null {
  for (let i = hosts.length - 1; i >= 0; i--) {
    const entry = hosts[i];
    if (entry?.fullscreen) return entry;
  }
  return hosts[hosts.length - 1] ?? null;
}
