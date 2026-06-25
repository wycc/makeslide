import type { SlideAnimationEffect } from '../../types';

/** Pan distance (in percent) for a pan effect, defaulting to 3 when unset/invalid. */
export function panDistance(effect: SlideAnimationEffect): number {
  const d = effect.params?.distancePct;
  return typeof d === 'number' && Number.isFinite(d) ? d : 3;
}

/**
 * `from`/`to` GSAP vars for a whole-slide transform effect's entrance tween
 * (`from` is also the "reverted" state used when `exitDuration` is set).
 * Returns `null` for non-transform effect types (overlay effects).
 *
 * Pure (no GSAP/DOM dependency) so it can be unit-tested independently of the
 * timeline builder that consumes it.
 */
export function transformFromTo(
  effect: SlideAnimationEffect,
): { from: Record<string, number>; to: Record<string, number> } | null {
  switch (effect.type) {
    case 'fade-in':
      return { from: { autoAlpha: 0 }, to: { autoAlpha: 1 } };
    case 'zoom-in':
      return { from: { scale: effect.params?.fromScale ?? 1 }, to: { scale: effect.params?.toScale ?? 1.08 } };
    case 'zoom-out':
      return { from: { scale: effect.params?.fromScale ?? 1.08 }, to: { scale: effect.params?.toScale ?? 1 } };
    case 'pan-left': {
      const d = panDistance(effect);
      return { from: { xPercent: d }, to: { xPercent: -d } };
    }
    case 'pan-right': {
      const d = panDistance(effect);
      return { from: { xPercent: -d }, to: { xPercent: d } };
    }
    case 'pan-up': {
      const d = panDistance(effect);
      return { from: { yPercent: d }, to: { yPercent: -d } };
    }
    case 'pan-down': {
      const d = panDistance(effect);
      return { from: { yPercent: -d }, to: { yPercent: d } };
    }
    default:
      return null;
  }
}
