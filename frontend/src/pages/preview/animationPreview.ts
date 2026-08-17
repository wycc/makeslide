import { animationTimelineDurationSeconds } from '../../lib/animationSpec';
import type { SlideAnimationSpec } from '../../types';

/**
 * The pieces of the bare animation preview (`#/preview/:id`) worth stating separately from the
 * component: what to show, and where the clock is at.
 *
 * The preview exists to be looked at — by a person debugging, or by Playwright / the VSCode browser
 * driven through the MCP `get_page_preview_url` tool. It deliberately renders nothing but the
 * slide: no header, no controls, no panels, so a screenshot is of the animation and nothing else.
 */

/**
 * Narrows a spec to a single effect, for `?effect=<id>`.
 *
 * Debugging one effect among a page's twenty otherwise means watching the other nineteen play over
 * it. Returns the spec unchanged when no effect is named, and `null` when the named one does not
 * exist — the caller reports that rather than showing an empty slide, which looks identical to a
 * broken animation.
 */
export function specForSingleEffect(
  spec: SlideAnimationSpec | null,
  effectId: string | null,
): SlideAnimationSpec | null {
  if (!spec || !effectId) return spec;
  const effect = spec.effects.find((item) => item.id === effectId);
  if (!effect) return null;
  // Kept at its original start time: an effect anchored at 8s behaves differently from the same
  // effect at 0, and moving it would hide exactly the timing bug someone came here to find.
  return { ...spec, enabled: true, effects: [effect] };
}

/** How long the preview runs before it ends (or loops). 0 means there is nothing to play. */
export function previewDurationSeconds(spec: SlideAnimationSpec | null): number {
  const timeline = animationTimelineDurationSeconds(spec);
  return timeline > 0.05 ? timeline : 0;
}

export interface PreviewClockState {
  /** Seconds into the animation. */
  time: number;
  /** True once a non-looping preview has reached the end — the frame a screenshot should capture. */
  finished: boolean;
}

/**
 * Where the clock sits after `elapsed` seconds of wall time.
 *
 * Looping is a real debugging need (watch a 3-second effect until you catch the glitch), and the
 * modulo has to survive `duration` being 0: a page whose animation is empty or disabled would
 * otherwise divide by zero and hand GSAP a NaN, which renders as a blank stage.
 */
export function previewClockAt(elapsed: number, duration: number, loop: boolean): PreviewClockState {
  if (!(duration > 0)) return { time: 0, finished: true };
  const safeElapsed = Math.max(0, elapsed);
  if (loop) return { time: safeElapsed % duration, finished: false };
  if (safeElapsed >= duration) return { time: duration, finished: true };
  return { time: safeElapsed, finished: false };
}
