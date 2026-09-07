import type { SlideAnimationSpec } from '../types';

/**
 * Presenter-remote stepping through a page's animation (fullscreen). A "step" is a state of the
 * page: the initial one before any effect has appeared, then one per moment on the timeline where
 * an effect begins. Stepping forward seeks to the next such moment, stepping back to the previous
 * one, and past the last step the remote's Next turns the page — the way a slide app advances
 * builds before it advances slides.
 */

/** Two starts closer than this are one step: effects meant to appear together should not need two presses. */
const STEP_MERGE_SECONDS = 0.15;
/** Tolerance when comparing the current time with a step time. */
const STEP_EPSILON_SECONDS = 0.05;

export interface AnimationStepOptions {
  /**
   * When the first transcript sentence starts speaking (seconds). An effect that begins with the
   * narration is part of the page's initial state, so it does not get a separate "nothing shown
   * yet" step in front of it. Omit (or 0) when the page has no narration.
   */
  firstSentenceStart?: number;
}

/**
 * Sorted, de-duplicated step times of the (resolved) effects; empty when the page has none.
 *
 * Unless the first effect already begins at the very start (second 0, or with the first sentence),
 * the page's initial state — nothing animated yet — is a step of its own at second 0, so four
 * effects that all start mid-narration make five steps: the presenter first shows the bare page,
 * then reveals each effect in turn.
 */
export function animationStepTimes(spec: SlideAnimationSpec | null | undefined, options: AnimationStepOptions = {}): number[] {
  if (!spec?.enabled) return [];
  const starts = spec.effects
    .filter((e) => e.type !== 'pause-playback')
    .map((e) => e.start)
    .filter((s) => Number.isFinite(s) && s >= 0)
    .sort((a, b) => a - b);
  const steps: number[] = [];
  for (const s of starts) {
    const last = steps[steps.length - 1];
    if (last === undefined || s - last > STEP_MERGE_SECONDS) steps.push(Math.round(s * 1000) / 1000);
  }
  const first = steps[0];
  if (first === undefined) return steps;
  const firstSentenceStart = options.firstSentenceStart;
  const beginning = firstSentenceStart !== undefined && Number.isFinite(firstSentenceStart) ? Math.max(0, firstSentenceStart) : 0;
  if (first > beginning + STEP_MERGE_SECONDS) steps.unshift(0);
  return steps;
}

/** The next step strictly after `currentTime`, or null when the last one has been reached. */
export function nextAnimationStep(steps: number[], currentTime: number): number | null {
  for (const s of steps) if (s > currentTime + STEP_EPSILON_SECONDS) return s;
  return null;
}

/**
 * The step to go back to: the latest step strictly before the current one. From the first step
 * (or before it) there is nothing earlier on this page → null, and the caller turns the page back.
 */
export function prevAnimationStep(steps: number[], currentTime: number): number | null {
  let prev: number | null = null;
  for (const s of steps) {
    if (s < currentTime - STEP_EPSILON_SECONDS) prev = s;
    else break;
  }
  return prev;
}

/** 1-based index of the step reached at `currentTime` (0 = before the first), plus the total. */
export function animationStepPosition(steps: number[], currentTime: number): { current: number; total: number } {
  let current = 0;
  for (const s of steps) if (s <= currentTime + STEP_EPSILON_SECONDS) current++;
  return { current, total: steps.length };
}

export type PresenterStepAction = { kind: 'seek'; seconds: number } | { kind: 'page'; delta: 1 | -1 };

/**
 * What a presenter-remote Next/Previous should do on a page: seek to the neighbouring step, or
 * turn the page when there is none in that direction (or no animation at all).
 */
export function presenterStepAction(steps: number[], currentTime: number, direction: 1 | -1): PresenterStepAction {
  const target = direction === 1 ? nextAnimationStep(steps, currentTime) : prevAnimationStep(steps, currentTime);
  if (target === null) return { kind: 'page', delta: direction };
  return { kind: 'seek', seconds: target };
}
