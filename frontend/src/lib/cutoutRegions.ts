/**
 * Cut-out regions (docs/page-elements.md §9): boxes the user draws on the base image, 0..1 of
 * its width / height — the same space as page elements and the server's `CutoutRegion`.
 */
export interface CutoutRegion {
  x: number;
  y: number;
  w: number;
  h: number;
  /** What the region shows, when auto-detection labelled it; becomes the figure caption. */
  label?: string;
}

export const MAX_CUTOUT_REGIONS = 20;
/** Boxes smaller than this (in either axis) are accidental clicks, not regions. */
export const MIN_CUTOUT_SIZE = 0.01;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** The box between two pointer positions (0..1), clamped to the page; null when it is too small. */
export function dragToRegion(start: { x: number; y: number }, end: { x: number; y: number }): CutoutRegion | null {
  const x1 = clamp01(Math.min(start.x, end.x));
  const y1 = clamp01(Math.min(start.y, end.y));
  const x2 = clamp01(Math.max(start.x, end.x));
  const y2 = clamp01(Math.max(start.y, end.y));
  const w = x2 - x1;
  const h = y2 - y1;
  if (w < MIN_CUTOUT_SIZE || h < MIN_CUTOUT_SIZE) return null;
  return { x: round4(x1), y: round4(y1), w: round4(w), h: round4(h) };
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}

/** Index of the region under a point, topmost (last drawn) first; -1 when none. */
export function regionAtPoint(regions: CutoutRegion[], point: { x: number; y: number }): number {
  for (let i = regions.length - 1; i >= 0; i--) {
    const r = regions[i]!;
    if (point.x >= r.x && point.x <= r.x + r.w && point.y >= r.y && point.y <= r.y + r.h) return i;
  }
  return -1;
}

/** Human label for a region, e.g. "x 12% · y 30% · 40×20%". */
export function describeRegion(region: CutoutRegion): string {
  const p = (v: number) => `${Math.round(v * 100)}%`;
  return `x ${p(region.x)} · y ${p(region.y)} · ${Math.round(region.w * 100)}×${Math.round(region.h * 100)}%`;
}
