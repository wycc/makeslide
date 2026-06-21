/**
 * Wraps `run` so calls always execute in the order they were queued, regardless of
 * how long each underlying call takes. Without this, two overlapping "save the full
 * desired state" calls (e.g. toggling two checkboxes in quick succession) can land at
 * the server out of dispatch order if the earlier one is slower — silently reverting
 * whatever the later call saved. Queuing removes the race by ensuring at most one call
 * is ever in flight at a time, so the last *dispatched* call is always the last to land.
 */
export function createSequentialQueue<T>(run: (value: T) => Promise<void>): (value: T) => Promise<void> {
  let pending: Promise<void> = Promise.resolve();
  return (value: T) => {
    const next = pending.catch(() => undefined).then(() => run(value));
    pending = next;
    return next;
  };
}
