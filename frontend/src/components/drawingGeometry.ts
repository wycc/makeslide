import type { DrawingStroke } from './DrawingCanvas';

// Pure pixel-space hit-test geometry for the drawing eraser, split out of
// DrawingCanvas so the (non-trivial) point/segment distance maths can be unit
// tested without rendering the canvas component.

/** Squared Euclidean distance between two points (avoids a sqrt when only comparing). */
export function distSq(ax: number, ay: number, bx: number, by: number): number {
  return (ax - bx) ** 2 + (ay - by) ** 2;
}

/** Shortest distance from point (px,py) to the segment (ax,ay)-(bx,by). */
export function distPointToSegment(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.sqrt(distSq(px, py, ax, ay));
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.sqrt(distSq(px, py, ax + t * dx, ay + t * dy));
}

/**
 * Whether the eraser at (ex,ey) with `radius` (pixel space) touches `stroke`,
 * whose points are normalized [0,1] and scaled by canvas width `cw`/height `ch`.
 * Tests both each vertex and each connecting segment so a thin line between
 * sparse points is still erasable.
 */
export function strokeHitsPoint(
  stroke: DrawingStroke,
  ex: number, ey: number,
  radius: number,
  cw: number, ch: number,
): boolean {
  const pts = stroke.points;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (!p) continue;
    const px = p[0] * cw;
    const py = p[1] * ch;
    if (distSq(ex, ey, px, py) <= radius * radius) return true;
    if (i + 1 < pts.length) {
      const q = pts[i + 1];
      if (q && distPointToSegment(ex, ey, px, py, q[0] * cw, q[1] * ch) <= radius) return true;
    }
  }
  return false;
}
