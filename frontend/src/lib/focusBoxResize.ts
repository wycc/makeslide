import { clamp } from './clamp';

/** Drag handle identifying which part of the focus box is being moved/resized. */
export type FocusBoxHandle = 'move' | 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se';

/** A focus box in percentage coordinates of its container (0..100). */
export interface FocusBox {
  xPct: number;
  yPct: number;
  widthPct: number;
  heightPct: number;
}

/** Minimum box size (percent) so a resize can't collapse the box to nothing. */
export const FOCUS_BOX_MIN_SIZE_PCT = 2;

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Compute the new focus box after dragging `handle` by `dxPct`/`dyPct` (deltas in
 * percentage of the container). `start` is the box state captured at pointer-down.
 *
 * - `move` (or `moveOnly`, used for pointer-only effects) translates the box,
 *   clamping the top-left corner into [0, 100].
 * - Edge/corner handles resize from the opposite anchor, clamping each side to a
 *   minimum of `FOCUS_BOX_MIN_SIZE_PCT` and within the container bounds; the
 *   west/north handles also shift the origin so the opposite edge stays put.
 *
 * Result coordinates are rounded to one decimal place. Pure function extracted
 * from AnimationEditorTab's pointer-move handler for unit testing.
 */
export function resizeFocusBox(
  handle: FocusBoxHandle,
  start: FocusBox,
  dxPct: number,
  dyPct: number,
  moveOnly = false,
): FocusBox {
  const { xPct: startXPct, yPct: startYPct, widthPct: startWidthPct, heightPct: startHeightPct } = start;
  let newX = startXPct;
  let newY = startYPct;
  let newW = startWidthPct;
  let newH = startHeightPct;

  if (handle === 'move' || moveOnly) {
    newX = clamp(startXPct + dxPct, 0, 100);
    newY = clamp(startYPct + dyPct, 0, 100);
  } else {
    if (handle === 'e' || handle === 'ne' || handle === 'se') {
      newW = clamp(startWidthPct + dxPct, FOCUS_BOX_MIN_SIZE_PCT, 100 - startXPct);
    }
    if (handle === 'w' || handle === 'nw' || handle === 'sw') {
      const newWidth = clamp(startWidthPct - dxPct, FOCUS_BOX_MIN_SIZE_PCT, startXPct + startWidthPct);
      newX = startXPct + startWidthPct - newWidth;
      newW = newWidth;
    }
    if (handle === 's' || handle === 'se' || handle === 'sw') {
      newH = clamp(startHeightPct + dyPct, FOCUS_BOX_MIN_SIZE_PCT, 100 - startYPct);
    }
    if (handle === 'n' || handle === 'nw' || handle === 'ne') {
      const newHeight = clamp(startHeightPct - dyPct, FOCUS_BOX_MIN_SIZE_PCT, startYPct + startHeightPct);
      newY = startYPct + startHeightPct - newHeight;
      newH = newHeight;
    }
  }

  return {
    xPct: round1(newX),
    yPct: round1(newY),
    widthPct: round1(newW),
    heightPct: round1(newH),
  };
}
