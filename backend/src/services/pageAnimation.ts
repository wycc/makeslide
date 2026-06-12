import { z } from 'zod';
import type { SlideRenderType } from '../types';

export const ANIMATION_EFFECT_TYPES = [
  'fade-in',
  'zoom-in',
  'zoom-out',
  'pan-left',
  'pan-right',
  'pan-up',
  'pan-down',
  'highlight-box',
  'spotlight',
  'text-callout',
] as const;

export const ANIMATION_EASES = ['none', 'power1.in', 'power1.out', 'power1.inOut', 'power2.inOut'] as const;

export type AnimationEffectType = (typeof ANIMATION_EFFECT_TYPES)[number];
export type AnimationEase = (typeof ANIMATION_EASES)[number];

/** Ties an effect's start time to a transcript sentence instead of a fixed offset. */
export interface AnimationStartTrigger {
  type: 'transcript-line';
  /** 0-based index into the page script's sentence list. */
  line: number;
  /** Seconds to start before the referenced sentence's estimated playback time. */
  offsetSeconds?: number;
}

export interface AnimationEffect {
  id: string;
  target: 'slide';
  type: AnimationEffectType;
  start: number;
  duration: number;
  ease: AnimationEase;
  params?: Record<string, number>;
  /** When set, `start` is resolved at runtime from this transcript sentence's playback time. */
  startTrigger?: AnimationStartTrigger;
  /** Caption text for `text-callout` effects (ignored by other effect types). */
  text?: string;
  /**
   * Seconds to remain visible after the fade-in completes before
   * automatically fading back out (same `duration`/`ease` as the fade-in).
   * Only meaningful for overlay effect types (`highlight-box`, `spotlight`,
   * `text-callout`); ignored by transform effects.
   */
  exitDuration?: number;
}

export interface AnimationSpec {
  version: 1;
  enabled: boolean;
  effects: AnimationEffect[];
  /**
   * Optional per-sentence animation guidance, keyed by 0-based transcript
   * line index (as a string). Free-text notes the user writes manually to
   * describe what animation they want for that sentence; not consumed by
   * any generator yet — reserved as reference input for a future
   * LLM-based animation generator (see design doc §12 V2).
   */
  hints?: Record<string, string>;
}

const MAX_EFFECTS = 20;
const MAX_DURATION_SECONDS = 600;
const MAX_TRANSCRIPT_LINE = 999;
const MAX_START_OFFSET_SECONDS = 60;
export const MAX_TEXT_CALLOUT_LENGTH = 80;
export const MAX_HINTS = 50;
export const MAX_HINT_LENGTH = 200;

// Whitelisted numeric params per effect type; unknown keys are stripped, not rejected,
// so future spec versions can add params without breaking older backends.
const ALLOWED_PARAM_KEYS: Record<AnimationEffectType, readonly string[]> = {
  'fade-in': [],
  'zoom-in': ['fromScale', 'toScale'],
  'zoom-out': ['fromScale', 'toScale'],
  'pan-left': ['distancePct'],
  'pan-right': ['distancePct'],
  'pan-up': ['distancePct'],
  'pan-down': ['distancePct'],
  'highlight-box': ['xPct', 'yPct', 'widthPct', 'heightPct'],
  'spotlight': ['xPct', 'yPct', 'widthPct', 'heightPct'],
  'text-callout': ['xPct', 'yPct', 'widthPct', 'heightPct'],
};

const StartTriggerSchema = z.object({
  type: z.literal('transcript-line'),
  line: z.number().int().min(0).max(MAX_TRANSCRIPT_LINE),
  offsetSeconds: z.number().min(0).max(MAX_START_OFFSET_SECONDS).optional(),
});

const EffectSchema = z.object({
  id: z.string().min(1).max(64),
  target: z.literal('slide'),
  type: z.enum(ANIMATION_EFFECT_TYPES),
  start: z.number().min(0).max(MAX_DURATION_SECONDS),
  duration: z.number().gt(0).max(MAX_DURATION_SECONDS),
  ease: z.enum(ANIMATION_EASES),
  params: z.record(z.unknown()).optional(),
  startTrigger: StartTriggerSchema.optional(),
  text: z.string().max(MAX_TEXT_CALLOUT_LENGTH).optional(),
  exitDuration: z.number().min(0).max(MAX_DURATION_SECONDS).optional(),
});

const HintsSchema = z
  .record(z.string().regex(/^\d+$/), z.string().max(MAX_HINT_LENGTH))
  .refine((hints) => Object.keys(hints).length <= MAX_HINTS, {
    message: `Object must have at most ${MAX_HINTS} keys`,
  });

const SpecSchema = z.object({
  version: z.literal(1),
  enabled: z.boolean(),
  effects: z.array(EffectSchema).max(MAX_EFFECTS),
  hints: HintsSchema.optional(),
});

export function defaultAnimationSpec(): AnimationSpec {
  return { version: 1, enabled: false, effects: [] };
}

export type ValidateAnimationSpecResult =
  | { ok: true; spec: AnimationSpec }
  | { ok: false; message: string };

export function validateAnimationSpec(input: unknown): ValidateAnimationSpecResult {
  const parsed = SpecSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path?.length ? ` at ${issue.path.join('.')}` : '';
    return { ok: false, message: `${issue?.message ?? 'Invalid animation spec'}${where}` };
  }
  const effects: AnimationEffect[] = parsed.data.effects.map((effect) => {
    const allowed = ALLOWED_PARAM_KEYS[effect.type];
    let params: Record<string, number> | undefined;
    if (effect.params) {
      const filtered: Record<string, number> = {};
      for (const key of allowed) {
        const value = effect.params[key];
        if (typeof value === 'number' && Number.isFinite(value)) {
          filtered[key] = value;
        }
      }
      if (Object.keys(filtered).length > 0) params = filtered;
    }
    return {
      id: effect.id,
      target: effect.target,
      type: effect.type,
      start: effect.start,
      duration: effect.duration,
      ease: effect.ease,
      ...(params ? { params } : {}),
      ...(effect.startTrigger ? { startTrigger: effect.startTrigger } : {}),
      ...(effect.text !== undefined ? { text: effect.text } : {}),
      ...(effect.exitDuration !== undefined ? { exitDuration: effect.exitDuration } : {}),
    };
  });
  const hints = parsed.data.hints && Object.keys(parsed.data.hints).length > 0 ? parsed.data.hints : undefined;
  return { ok: true, spec: { version: 1, enabled: parsed.data.enabled, effects, ...(hints ? { hints } : {}) } };
}

export function renderTypeForSpec(spec: AnimationSpec): SlideRenderType {
  return spec.enabled ? 'gsap-image' : 'static-image';
}

/** Parse a spec JSON file's content; corrupted files fall back to the default spec. */
export function parseStoredAnimationSpec(raw: string): AnimationSpec {
  try {
    const result = validateAnimationSpec(JSON.parse(raw));
    return result.ok ? result.spec : defaultAnimationSpec();
  } catch {
    return defaultAnimationSpec();
  }
}
