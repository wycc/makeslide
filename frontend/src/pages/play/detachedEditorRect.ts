/**
 * Placement of the detached editor window, and the rules for restoring it.
 *
 * The window's useful position depends on the user's screen, so it is remembered in localStorage
 * rather than re-arranged on every visit. Restoring it needs the viewport taken into account: a
 * rect saved on a large screen (or before the browser window shrank) can land the window mostly or
 * entirely off-screen, and a floating window you cannot reach is no better than not saving it.
 */

export interface DetachedEditorRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ViewportSize {
  width: number;
  height: number;
}

/** Smallest window still worth having: below this the tab strip and controls stop being usable. */
export const MIN_DETACHED_WIDTH = 320;
export const MIN_DETACHED_HEIGHT = 240;

/** How much of the window must stay reachable horizontally / how far down its title bar may sit. */
const MIN_VISIBLE_WIDTH = 200;
const MIN_VISIBLE_HEIGHT = 80;

/** Default placement when nothing is stored yet. */
export function defaultDetachedEditorRect(viewport: ViewportSize): DetachedEditorRect {
  return {
    x: 80,
    y: 120,
    width: Math.min(900, Math.max(MIN_DETACHED_WIDTH, viewport.width - 120)),
    height: Math.max(MIN_DETACHED_HEIGHT, Math.round(viewport.height * 0.6)),
  };
}

/**
 * Fits a rect into the viewport: never larger than the screen, never smaller than usable, and
 * always with its top-left corner (and enough of its width) on screen so it can be grabbed.
 */
export function clampDetachedEditorRect(rect: DetachedEditorRect, viewport: ViewportSize): DetachedEditorRect {
  const width = Math.max(MIN_DETACHED_WIDTH, Math.min(rect.width, Math.max(MIN_DETACHED_WIDTH, viewport.width - 16)));
  const height = Math.max(MIN_DETACHED_HEIGHT, Math.min(rect.height, Math.max(MIN_DETACHED_HEIGHT, viewport.height - 16)));
  return {
    width,
    height,
    x: Math.max(0, Math.min(rect.x, Math.max(0, viewport.width - Math.min(width, MIN_VISIBLE_WIDTH)))),
    y: Math.max(0, Math.min(rect.y, Math.max(0, viewport.height - MIN_VISIBLE_HEIGHT))),
  };
}

/**
 * Parses a stored rect, returning `null` for anything that isn't a complete set of finite numbers.
 * Storage is user-writable and survives across versions, so a partial or hand-edited value must
 * fall back to the default rather than place the window at `NaN`.
 */
export function parseStoredDetachedEditorRect(raw: string | null): DetachedEditorRect | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<DetachedEditorRect> | null;
    if (!parsed || typeof parsed !== 'object') return null;
    const { x, y, width, height } = parsed;
    if (![x, y, width, height].every((value) => typeof value === 'number' && Number.isFinite(value))) return null;
    return { x: x as number, y: y as number, width: width as number, height: height as number };
  } catch {
    return null;
  }
}

/** The rect to open with: the stored one fitted to this screen, or the default placement. */
export function restoreDetachedEditorRect(raw: string | null, viewport: ViewportSize): DetachedEditorRect {
  const stored = parseStoredDetachedEditorRect(raw);
  return stored ? clampDetachedEditorRect(stored, viewport) : defaultDetachedEditorRect(viewport);
}
