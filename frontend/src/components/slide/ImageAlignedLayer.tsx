import { useEffect, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';

/**
 * A layer that sits in the fullscreen container but always covers exactly the slide image —
 * including while a GSAP zoom/pan effect is transforming the stage, since the image's bounding box
 * follows the transform. Used for the pen layer: inside the stage the canvas can never be painted
 * above the fullscreen panels (the stage's `will-change: transform` makes it its own stacking
 * context), so the canvas lives out here and is pinned to the picture instead.
 */

export interface AlignedRect { left: number; top: number; width: number; height: number }

/** The image's box expressed in the container's coordinate space (both from getBoundingClientRect). */
export function imageRectWithin(image: DOMRectReadOnly, root: DOMRectReadOnly): AlignedRect {
  return { left: image.left - root.left, top: image.top - root.top, width: image.width, height: image.height };
}

/** Sub-pixel jitter must not re-render the layer (and resize the canvas) every frame. */
export function alignedRectChanged(a: AlignedRect | null, b: AlignedRect, tolerance = 0.5): boolean {
  if (!a) return true;
  return (
    Math.abs(a.left - b.left) > tolerance
    || Math.abs(a.top - b.top) > tolerance
    || Math.abs(a.width - b.width) > tolerance
    || Math.abs(a.height - b.height) > tolerance
  );
}

export function ImageAlignedLayer({
  imageRef,
  fallbackRef,
  containerRef,
  className,
  style,
  children,
}: {
  imageRef: RefObject<HTMLElement>;
  /** The slide's outer box, used when the page has no <img> (React and notebook pages). */
  fallbackRef?: RefObject<HTMLElement>;
  containerRef: RefObject<HTMLElement>;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}) {
  const [rect, setRect] = useState<AlignedRect | null>(null);

  // One layout read per frame while mounted (fullscreen only): the image moves not only on
  // resize but on every frame of a zoom effect, which no observer reports.
  useEffect(() => {
    let frame = 0;
    let last: AlignedRect | null = null;
    const tick = () => {
      const image = imageRef.current ?? fallbackRef?.current ?? null;
      const root = containerRef.current;
      if (image && root) {
        const next = imageRectWithin(image.getBoundingClientRect(), root.getBoundingClientRect());
        if (alignedRectChanged(last, next)) {
          last = next;
          setRect(next);
        }
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [imageRef, fallbackRef, containerRef]);

  if (!rect || rect.width <= 0 || rect.height <= 0) return null;
  return (
    <div
      className={`absolute ${className ?? ''}`}
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height, ...style }}
    >
      {children}
    </div>
  );
}
