import type {
  SlideAnimationEase,
  SlideAnimationEffect,
  SlideAnimationEffectType,
  SlideAnimationSpec,
  SlideAnimationStartTrigger,
} from '../types';
import type { SentenceTimelineItem } from './subtitles';

export const SLIDE_ANIMATION_EFFECT_TYPES: readonly SlideAnimationEffectType[] = [
  'fade-in',
  'zoom-in',
  'zoom-out',
  'pan-left',
  'pan-right',
  'pan-up',
  'pan-down',
  'highlight-box',
  'spotlight',
];

/** Effect types rendered as an overlay element inside the animated stage (vs. a transform on the whole slide). */
export const FOCUS_EFFECT_TYPES: readonly SlideAnimationEffectType[] = ['highlight-box', 'spotlight'];

export interface FocusEffectParams {
  xPct: number;
  yPct: number;
  widthPct: number;
  heightPct: number;
}

const DEFAULT_FOCUS_PARAMS: FocusEffectParams = { xPct: 30, yPct: 30, widthPct: 40, heightPct: 40 };

/** Reads an effect's overlay position/size, filling in defaults for unset params. */
export function getFocusEffectParams(effect: SlideAnimationEffect): FocusEffectParams {
  return {
    xPct: effect.params?.xPct ?? DEFAULT_FOCUS_PARAMS.xPct,
    yPct: effect.params?.yPct ?? DEFAULT_FOCUS_PARAMS.yPct,
    widthPct: effect.params?.widthPct ?? DEFAULT_FOCUS_PARAMS.widthPct,
    heightPct: effect.params?.heightPct ?? DEFAULT_FOCUS_PARAMS.heightPct,
  };
}

export const SLIDE_ANIMATION_EASES: readonly SlideAnimationEase[] = [
  'none',
  'power1.in',
  'power1.out',
  'power1.inOut',
  'power2.inOut',
];

export const MAX_SLIDE_ANIMATION_EFFECTS = 20;

export function defaultAnimationSpec(): SlideAnimationSpec {
  return { version: 1, enabled: false, effects: [] };
}

export function cloneAnimationSpec(spec: SlideAnimationSpec): SlideAnimationSpec {
  return {
    version: 1,
    enabled: spec.enabled,
    effects: spec.effects.map((e) => ({
      ...e,
      params: e.params ? { ...e.params } : undefined,
      startTrigger: e.startTrigger ? { ...e.startTrigger } : undefined,
    })),
  };
}

export function hasPlayableAnimation(spec: SlideAnimationSpec | null | undefined): spec is SlideAnimationSpec {
  return Boolean(spec && spec.enabled && spec.effects.length > 0);
}

/**
 * Resolves each effect's playback `start` time, replacing it with the start
 * time of its referenced transcript sentence (`startTrigger`) when one is
 * set and the sentence timeline has a matching entry. Effects without a
 * `startTrigger`, or whose referenced line is out of range (e.g. the
 * transcript was edited), keep their literal `start` value unchanged.
 *
 * Returns the original `spec` reference when nothing needs resolving, so
 * callers can safely use the result as a memoization/effect dependency
 * without triggering unnecessary GSAP timeline rebuilds.
 */
/**
 * Resolves a `startTrigger` to a playback second, applying its optional
 * `offsetSeconds` (start N seconds before the referenced sentence) and
 * clamping to 0. Returns `undefined` if the referenced sentence doesn't
 * exist in `sentenceTimeline` (e.g. the transcript was edited).
 */
export function resolveStartTriggerSeconds(
  startTrigger: SlideAnimationStartTrigger,
  sentenceTimeline: SentenceTimelineItem[],
): number | undefined {
  const target = sentenceTimeline[startTrigger.line];
  if (!target) return undefined;
  return Math.max(0, target.start - (startTrigger.offsetSeconds ?? 0));
}

export function resolveAnimationSpec(
  spec: SlideAnimationSpec | null,
  sentenceTimeline: SentenceTimelineItem[],
): SlideAnimationSpec | null {
  if (!spec || !spec.effects.some((e) => e.startTrigger)) return spec;
  return {
    ...spec,
    effects: spec.effects.map((effect) => {
      if (!effect.startTrigger) return effect;
      const resolved = resolveStartTriggerSeconds(effect.startTrigger, sentenceTimeline);
      if (resolved === undefined) return effect;
      return { ...effect, start: resolved };
    }),
  };
}
