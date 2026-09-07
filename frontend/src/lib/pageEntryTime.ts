import type { SlideAnimationSpec } from '../types';

/**
 * How far an effect's start may sit from the paused time and still count as "starting here".
 * Matches the presenter-step model (`animationSteps.ts`: starts within 0.15 s are one step, and the
 * current time is compared with a 0.05 s tolerance) so that everything one step reveals is shown.
 */
const AT_STEP_TOLERANCE_SECONDS = 0.2;

/**
 * The timeline time to *present* while playback is paused at `currentTime`.
 *
 * Seeking to the moment an effect begins lands on frame zero of its entrance — a fade-in at 0 %
 * opacity, i.e. nothing on screen — which is what a paused viewer would otherwise see in two
 * situations: a freshly entered page whose opening effects begin at 0 (or with the first sentence,
 * which resolves to 0), and a presenter remote stepping to an effect's start. So, while paused at a
 * moment where effects begin, the timeline is shown at the end of those entrances instead — but
 * never as far as the next effect's start: that one still belongs to the next step / to playback.
 *
 * Playing, or paused somewhere no effect begins, the time is returned unchanged.
 */
export function pageEntryPresentationTime(spec: SlideAnimationSpec | null | undefined, currentTime: number, isPlaying: boolean): number {
  if (isPlaying || !spec?.enabled) return currentTime;
  let entered = currentTime;
  let nextStart = Number.POSITIVE_INFINITY;
  for (const effect of spec.effects) {
    if (effect.type === 'pause-playback') continue;
    if (effect.start > currentTime + AT_STEP_TOLERANCE_SECONDS) {
      nextStart = Math.min(nextStart, effect.start);
    } else if (effect.start >= currentTime - AT_STEP_TOLERANCE_SECONDS) {
      entered = Math.max(entered, effect.start + effect.duration);
    }
  }
  if (entered <= currentTime) return currentTime;
  // Stay a hair before the next effect so it does not begin its own entrance.
  return Math.min(entered, Math.max(currentTime, nextStart - 0.01));
}
