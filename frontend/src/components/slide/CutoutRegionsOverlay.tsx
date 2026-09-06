import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { normalizedPointerPosition } from '../../lib/normalizedPointerPosition';
import { dragToRegion, regionAtPoint, type CutoutRegion } from '../../lib/cutoutRegions';

interface CutoutRegionsOverlayProps {
  regions: CutoutRegion[];
  onAdd: (region: CutoutRegion) => void;
  onRemove: (index: number) => void;
  disabled?: boolean;
  /** Show the pending boxes without taking the pointer (drawing mode off). */
  passive?: boolean;
}

/** Hatched fill: "this will be erased" — an honest marker rather than a fake erase. */
const PENDING_FILL = 'repeating-linear-gradient(135deg, rgba(251, 146, 60, 0.28) 0 6px, rgba(251, 146, 60, 0.08) 6px 12px)';

/**
 * Drawing surface for cut-out regions (docs/page-elements.md §9): drag to add a box, click a box
 * to remove it. Sits over the slide inside `SlideRenderer` like the inpaint region picker, so the
 * coordinates are fractions of the picture whatever size it is shown at.
 */
export function CutoutRegionsOverlay({ regions, onAdd, onRemove, disabled, passive }: CutoutRegionsOverlayProps) {
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const [preview, setPreview] = useState<CutoutRegion | null>(null);

  const pointAt = (e: ReactPointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return normalizedPointerPosition(e.clientX, e.clientY, rect);
  };

  return (
    <div
      className="absolute inset-0 rounded-lg"
      style={{ cursor: passive ? undefined : disabled ? 'not-allowed' : 'crosshair', zIndex: 30, userSelect: 'none', touchAction: 'none', pointerEvents: passive ? 'none' : 'auto' }}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => {
        if (disabled || passive) return;
        e.preventDefault();
        e.stopPropagation();
        dragRef.current = pointAt(e);
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!dragRef.current) return;
        e.preventDefault();
        setPreview(dragToRegion(dragRef.current, pointAt(e)));
      }}
      onPointerUp={(e) => {
        const start = dragRef.current;
        dragRef.current = null;
        setPreview(null);
        if (!start || disabled) return;
        const end = pointAt(e);
        const region = dragToRegion(start, end);
        if (region) {
          onAdd(region);
          return;
        }
        // A click (no drag) on an existing box removes it.
        const hit = regionAtPoint(regions, end);
        if (hit >= 0) onRemove(hit);
      }}
      onPointerCancel={() => {
        dragRef.current = null;
        setPreview(null);
      }}
      data-testid="cutout-regions-overlay"
    >
      {regions.map((r, i) => (
        <div
          key={`${r.x}-${r.y}-${r.w}-${r.h}-${i}`}
          className="pointer-events-none absolute flex items-start justify-start"
          style={{
            left: `${r.x * 100}%`,
            top: `${r.y * 100}%`,
            width: `${r.w * 100}%`,
            height: `${r.h * 100}%`,
            border: '2px dashed rgba(251, 146, 60, 0.95)',
            background: PENDING_FILL,
            boxSizing: 'border-box',
          }}
        >
          <span className="rounded-br bg-orange-500 px-1 text-[10px] font-semibold leading-4 text-white">✂ {i + 1}</span>
        </div>
      ))}
      {preview ? (
        <div
          className="pointer-events-none absolute"
          style={{
            left: `${preview.x * 100}%`,
            top: `${preview.y * 100}%`,
            width: `${preview.w * 100}%`,
            height: `${preview.h * 100}%`,
            border: '2px solid rgba(251, 146, 60, 0.95)',
            backgroundColor: 'rgba(251, 146, 60, 0.12)',
            boxSizing: 'border-box',
          }}
        />
      ) : null}
    </div>
  );
}
