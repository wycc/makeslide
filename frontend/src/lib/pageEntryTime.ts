import type { SlideAnimationSpec } from '../types';

const AT_START_TOLERANCE_SECONDS = 0.05;

/**
 * The timeline time to *present* when a page is shown while paused at its start.
 *
 * Effects that begin at 0 (or at the first sentence, which resolves to 0) are the page's opening
 * state — a title cut-out, an initial highlight — and should be on screen the moment the page
 * appears, not only once playback has run 0.8 s into their fade. So while paused at 0 the
 * timeline is shown at the end of those entrances, but never as far as the next effect's start:
 * that one still belongs to playback.
 */
export function pageEntryPresentationTime(spec: SlideAnimationSpec | null | undefined, currentTime: number, isPlaying: boolean): number {
  if (isPlaying || currentTime > AT_START_TOLERANCE_SECONDS || !spec?.enabled) return currentTime;
  let opening = 0;
  let nextStart = Number.POSITIVE_INFINITY;
  for (const effect of spec.effects) {
    if (effect.type === 'pause-playback') continue;
    if (effect.start <= AT_START_TOLERANCE_SECONDS) opening = Math.max(opening, effect.start + effect.duration);
    else nextStart = Math.min(nextStart, effect.start);
  }
  if (opening <= currentTime) return currentTime;
  // Stay a hair before the next effect so it does not begin its own entrance.
  return Math.min(opening, Math.max(currentTime, nextStart - 0.01));
}
