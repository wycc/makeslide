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
  'pointer',
  'text-callout',
  'shape',
  'step-list',
  'overlay-image',
  'formula',
  'custom-script',
] as const;

export const ANIMATION_EASES = ['none', 'power1.in', 'power1.out', 'power1.inOut', 'power2.inOut'] as const;

/** SVG primitive shapes drawable by `shape` effects (design doc §12 V2 "SVG 圖元"). */
export const ANIMATION_SHAPE_KINDS = ['circle', 'rect', 'ellipse', 'arrow'] as const;

export type AnimationEffectType = (typeof ANIMATION_EFFECT_TYPES)[number];
export type AnimationEase = (typeof ANIMATION_EASES)[number];
export type AnimationShapeKind = (typeof ANIMATION_SHAPE_KINDS)[number];

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
  /**
   * Rotation angle in degrees for `pointer` effects (ignored by other effect types).
   * Defaults to `0` (pointing down-right) when omitted. Accepts any finite number.
   */
  angle?: number;
  /**
   * Arrow colour (CSS hex) for `pointer` effects (ignored by other effect types).
   * Defaults to `DEFAULT_POINTER_COLOR` (`#f43f5e`).
   */
  pointerColor?: string;
  /**
   * Arrow size in rem units for `pointer` effects (ignored by other effect types).
   * Defaults to `DEFAULT_POINTER_SIZE_REM` (2.5). Clamped to [1, 6].
   */
  pointerSize?: number;
  /**
   * Border colour (CSS hex) for `highlight-box` effects (ignored by other
   * effect types). Defaults to `DEFAULT_HIGHLIGHT_BOX_COLOR` (`#ef4444`).
   */
  highlightColor?: string;
  /** Caption text for `text-callout` effects (ignored by other effect types). */
  text?: string;
  /**
   * Font size in rem for `text-callout` effects (ignored by other effect types).
   * Defaults to `DEFAULT_TEXT_CALLOUT_FONT_SIZE_REM` (1.25). Clamped to
   * [`MIN_TEXT_CALLOUT_FONT_SIZE_REM`, `MAX_TEXT_CALLOUT_FONT_SIZE_REM`].
   */
  textCalloutFontSize?: number;
  /**
   * Background colour (CSS hex) for `text-callout` effects (ignored by other
   * effect types). Defaults to `DEFAULT_TEXT_CALLOUT_BG_COLOR` (`#0f172a`).
   */
  textCalloutBgColor?: string;
  /**
   * Text colour (CSS hex) for `text-callout` effects (ignored by other
   * effect types). Defaults to `DEFAULT_TEXT_CALLOUT_TEXT_COLOR` (`#f8fafc`).
   */
  textCalloutTextColor?: string;
  /**
   * Mask colour (CSS hex) for `spotlight` effects (ignored by other
   * effect types). Defaults to `DEFAULT_SPOTLIGHT_COLOR` (`#000000`).
   */
  spotlightColor?: string;
  /**
   * Mask opacity (0–1) for `spotlight` effects (ignored by other
   * effect types). Defaults to `DEFAULT_SPOTLIGHT_OPACITY` (0.6).
   */
  spotlightOpacity?: number;
  /** SVG primitive drawn by `shape` effects (ignored by other effect types). Defaults to `'circle'` when omitted. */
  shape?: AnimationShapeKind;
  /**
   * Stroke colour for `shape` effects (ignored by other effect types). Accepts
   * CSS hex colour strings (e.g. `#f43f5e`) up to `MAX_SHAPE_COLOR_LENGTH`
   * chars. Defaults to `DEFAULT_SHAPE_STROKE_COLOR` when omitted.
   */
  color?: string;
  /**
   * Fill colour (CSS hex) for `shape` effects (ignored by other effect types).
   * When omitted the shape is rendered hollow (`fill="none"`).
   * Not meaningful for `arrow` shapes.
   */
  shapeFillColor?: string;
  /**
   * Stroke width (in SVG user units, within a 100×100 viewBox) for `shape`
   * effects (ignored by other effect types). Clamped to [1, `MAX_SHAPE_STROKE_WIDTH`].
   * Defaults to `DEFAULT_SHAPE_STROKE_WIDTH` when omitted.
   */
  strokeWidth?: number;
  /**
   * Bullet items for `step-list` effects (ignored by other effect types).
   * Each item is revealed in sequence (staggered fade-in) over `duration`.
   * Up to `MAX_STEP_LIST_ITEMS` items, each up to `MAX_STEP_LIST_ITEM_LENGTH` chars.
   */
  items?: string[];
  /**
   * Background colour (CSS hex) for `step-list` effects (ignored by other
   * effect types). Defaults to `DEFAULT_STEP_LIST_BG_COLOR` (`#1e293b`).
   */
  stepListBgColor?: string;
  /**
   * Text colour (CSS hex) for `step-list` effects (ignored by other
   * effect types). Defaults to `DEFAULT_STEP_LIST_TEXT_COLOR` (`#f1f5f9`).
   */
  stepListTextColor?: string;
  /**
   * Id of a figure extracted from the slide's source PDF (see
   * `GET /api/pdfs/:id/pages/:n/figures`), shown as a positioned image
   * overlay by `overlay-image` effects (ignored by other effect types).
   * Up to `MAX_OVERLAY_IMAGE_FIGURE_ID_LENGTH` chars.
   */
  figureId?: string;
  /**
   * LaTeX source rendered as a math formula by `formula` effects (ignored by
   * other effect types), via KaTeX. Up to `MAX_FORMULA_LENGTH` chars.
   */
  formula?: string;
  /**
   * Font size in em units for `formula` effect rendering. Defaults to
   * `DEFAULT_FORMULA_FONT_SIZE_EM` (1.5em). Clamped to
   * [`MIN_FORMULA_FONT_SIZE_EM`, `MAX_FORMULA_FONT_SIZE_EM`].
   */
  formulaFontSize?: number;
  /**
   * Seconds to remain visible after the fade-in completes before
   * automatically fading back out (same `duration`/`ease` as the fade-in).
   * Only meaningful for overlay effect types (`highlight-box`, `spotlight`,
   * `pointer`, `text-callout`, `shape`, `step-list`, `overlay-image`, `formula`, `custom-script`); ignored by transform effects.
   */
  exitDuration?: number;
  /**
   * JavaScript source for `custom-script` effects, executed inside a
   * sandboxed `<iframe sandbox="allow-scripts">` (no `allow-same-origin`,
   * so it has an opaque origin and cannot reach the parent page, cookies,
   * or storage). Ignored by other effect types.
   */
  code?: string;
  /**
   * The prompt that produced `code` via the AI custom-script generator.
   * Stored so the user can re-open the editor and iterate. Ignored by
   * other effect types.
   */
  prompt?: string;
  /**
   * Multi-turn chat history with the AI custom-script generator, so each new
   * prompt can build on prior turns. Ignored by other effect types.
   */
  conversation?: ConversationMessage[];
}

/** A single turn in a `custom-script` effect's AI chat `conversation`. */
export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
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

export const MAX_SLIDE_ANIMATION_EFFECTS = 20;
const MAX_EFFECTS = MAX_SLIDE_ANIMATION_EFFECTS;
const MAX_DURATION_SECONDS = 600;
const MAX_TRANSCRIPT_LINE = 999;
const MAX_START_OFFSET_SECONDS = 60;
export const MAX_TEXT_CALLOUT_LENGTH = 80;
/** Max number of bullet items in a `step-list` effect's `items`. */
export const MAX_STEP_LIST_ITEMS = 6;
/** Max length (chars) for a single `step-list` item. */
export const MAX_STEP_LIST_ITEM_LENGTH = 60;
/** Max length (chars) for an `overlay-image` effect's `figureId`, matching `FigureImageParamSchema`'s `figureId`. */
export const MAX_OVERLAY_IMAGE_FIGURE_ID_LENGTH = 200;
/** Max length (chars) for a `formula` effect's LaTeX source. */
export const MAX_FORMULA_LENGTH = 200;
/** Default font size (em) for `formula` effect rendering via KaTeX. */
export const DEFAULT_FORMULA_FONT_SIZE_EM = 1.5;
/** Minimum font size (em) for `formula` effects. */
export const MIN_FORMULA_FONT_SIZE_EM = 0.5;
/** Maximum font size (em) for `formula` effects. */
export const MAX_FORMULA_FONT_SIZE_EM = 4;
export const MAX_HINTS = 50;
export const MAX_HINT_LENGTH = 200;
/** Default stroke colour for `shape` effects (rose-500). */
export const DEFAULT_SHAPE_STROKE_COLOR = '#f43f5e';
/** Default stroke width (SVG user units in a 100×100 viewBox) for `shape` effects. */
export const DEFAULT_SHAPE_STROKE_WIDTH = 5;
/** Max length (chars) for a `shape` effect's `color` field. */
export const MAX_SHAPE_COLOR_LENGTH = 20;
/** Default arrow colour for `pointer` effects (rose-500). */
export const DEFAULT_POINTER_COLOR = '#f43f5e';
/** Default arrow size (rem) for `pointer` effects. */
export const DEFAULT_POINTER_SIZE_REM = 2.5;
/** Minimum arrow size (rem) for `pointer` effects. */
export const MIN_POINTER_SIZE_REM = 1;
/** Maximum arrow size (rem) for `pointer` effects. */
export const MAX_POINTER_SIZE_REM = 6;
/** Default border colour for `highlight-box` effects (red-500). */
export const DEFAULT_HIGHLIGHT_BOX_COLOR = '#ef4444';
/** Default font size (rem) for `text-callout` effects. */
export const DEFAULT_TEXT_CALLOUT_FONT_SIZE_REM = 1.25;
/** Minimum font size (rem) for `text-callout` effects. */
export const MIN_TEXT_CALLOUT_FONT_SIZE_REM = 0.5;
/** Maximum font size (rem) for `text-callout` effects. */
export const MAX_TEXT_CALLOUT_FONT_SIZE_REM = 3;
/** Default background colour for `text-callout` effects (slate-950). */
export const DEFAULT_TEXT_CALLOUT_BG_COLOR = '#0f172a';
/** Default text colour for `text-callout` effects (slate-50). */
export const DEFAULT_TEXT_CALLOUT_TEXT_COLOR = '#f8fafc';
/** Default mask colour for `spotlight` effects (black). */
export const DEFAULT_SPOTLIGHT_COLOR = '#000000';
/** Default mask opacity for `spotlight` effects (0–1). */
export const DEFAULT_SPOTLIGHT_OPACITY = 0.6;
/** Default background colour for `step-list` effects (slate-900 equivalent). */
export const DEFAULT_STEP_LIST_BG_COLOR = '#1e293b';
/** Default text colour for `step-list` effects (slate-100 equivalent). */
export const DEFAULT_STEP_LIST_TEXT_COLOR = '#f1f5f9';
/** Max stroke width (SVG user units) for `shape` effects. */
export const MAX_SHAPE_STROKE_WIDTH = 20;
/** Max length (chars) for a `custom-script` effect's generated JavaScript `code`. */
export const MAX_CUSTOM_SCRIPT_CODE_LENGTH = 24000;
/** Max length (chars) for the prompt used to generate a `custom-script` effect's `code`. */
export const MAX_CUSTOM_SCRIPT_PROMPT_LENGTH = 300;
/** Max number of messages kept in a `custom-script` effect's AI chat `conversation`. */
export const MAX_CUSTOM_SCRIPT_CONVERSATION_MESSAGES = 40;
/** Max length (chars) for a single `conversation` message's `content`. Large enough to hold a generated step plan. */
export const MAX_CUSTOM_SCRIPT_CONVERSATION_MESSAGE_LENGTH = 2000;
/** Max output tokens requested from the LLM when generating `custom-script` code (streaming). */
export const MAX_CUSTOM_SCRIPT_OUTPUT_TOKENS = 24000;
/** Max output tokens requested from the LLM when generating the `custom-script` implementation step plan (streaming). */
export const MAX_CUSTOM_SCRIPT_PLAN_OUTPUT_TOKENS = 1200;

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
  'pointer': ['xPct', 'yPct'],
  'text-callout': ['xPct', 'yPct', 'widthPct', 'heightPct'],
  'shape': ['xPct', 'yPct', 'widthPct', 'heightPct'],
  'step-list': ['xPct', 'yPct', 'widthPct', 'heightPct'],
  'overlay-image': ['xPct', 'yPct', 'widthPct', 'heightPct'],
  'formula': ['xPct', 'yPct', 'widthPct', 'heightPct'],
  'custom-script': ['xPct', 'yPct', 'widthPct', 'heightPct'],
};

const StartTriggerSchema = z.object({
  type: z.literal('transcript-line'),
  line: z.number().int().min(0).max(MAX_TRANSCRIPT_LINE),
  offsetSeconds: z.number().min(0).max(MAX_START_OFFSET_SECONDS).optional(),
});

export const ConversationMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().max(MAX_CUSTOM_SCRIPT_CONVERSATION_MESSAGE_LENGTH),
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
  angle: z.number().finite().optional(),
  pointerColor: z.string().max(MAX_SHAPE_COLOR_LENGTH).regex(/^#[0-9a-fA-F]{3,8}$/).optional(),
  pointerSize: z.number().min(MIN_POINTER_SIZE_REM).max(MAX_POINTER_SIZE_REM).optional(),
  highlightColor: z.string().max(MAX_SHAPE_COLOR_LENGTH).regex(/^#[0-9a-fA-F]{3,8}$/).optional(),
  text: z.string().max(MAX_TEXT_CALLOUT_LENGTH).optional(),
  textCalloutFontSize: z.number().min(MIN_TEXT_CALLOUT_FONT_SIZE_REM).max(MAX_TEXT_CALLOUT_FONT_SIZE_REM).optional(),
  textCalloutBgColor: z.string().max(MAX_SHAPE_COLOR_LENGTH).regex(/^#[0-9a-fA-F]{3,8}$/).optional(),
  textCalloutTextColor: z.string().max(MAX_SHAPE_COLOR_LENGTH).regex(/^#[0-9a-fA-F]{3,8}$/).optional(),
  spotlightColor: z.string().max(MAX_SHAPE_COLOR_LENGTH).regex(/^#[0-9a-fA-F]{3,8}$/).optional(),
  spotlightOpacity: z.number().min(0).max(1).optional(),
  shape: z.enum(ANIMATION_SHAPE_KINDS).optional(),
  color: z.string().max(MAX_SHAPE_COLOR_LENGTH).regex(/^#[0-9a-fA-F]{3,8}$/).optional(),
  shapeFillColor: z.string().max(MAX_SHAPE_COLOR_LENGTH).regex(/^#[0-9a-fA-F]{3,8}$/).optional(),
  strokeWidth: z.number().min(1).max(MAX_SHAPE_STROKE_WIDTH).optional(),
  items: z.array(z.string().max(MAX_STEP_LIST_ITEM_LENGTH)).max(MAX_STEP_LIST_ITEMS).optional(),
  stepListBgColor: z.string().max(MAX_SHAPE_COLOR_LENGTH).regex(/^#[0-9a-fA-F]{3,8}$/).optional(),
  stepListTextColor: z.string().max(MAX_SHAPE_COLOR_LENGTH).regex(/^#[0-9a-fA-F]{3,8}$/).optional(),
  figureId: z.string().min(1).max(MAX_OVERLAY_IMAGE_FIGURE_ID_LENGTH).optional(),
  formula: z.string().min(1).max(MAX_FORMULA_LENGTH).optional(),
  formulaFontSize: z.number().min(MIN_FORMULA_FONT_SIZE_EM).max(MAX_FORMULA_FONT_SIZE_EM).optional(),
  exitDuration: z.number().min(0).max(MAX_DURATION_SECONDS).optional(),
  code: z.string().max(MAX_CUSTOM_SCRIPT_CODE_LENGTH).optional(),
  prompt: z.string().max(MAX_CUSTOM_SCRIPT_PROMPT_LENGTH).optional(),
  conversation: z.array(ConversationMessageSchema).max(MAX_CUSTOM_SCRIPT_CONVERSATION_MESSAGES).optional(),
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
      ...(effect.angle !== undefined ? { angle: effect.angle } : {}),
      ...(effect.pointerColor !== undefined ? { pointerColor: effect.pointerColor } : {}),
      ...(effect.pointerSize !== undefined ? { pointerSize: Math.max(MIN_POINTER_SIZE_REM, Math.min(MAX_POINTER_SIZE_REM, effect.pointerSize)) } : {}),
      ...(effect.highlightColor !== undefined ? { highlightColor: effect.highlightColor } : {}),
      ...(effect.text !== undefined ? { text: effect.text } : {}),
      ...(effect.textCalloutFontSize !== undefined ? { textCalloutFontSize: Math.max(MIN_TEXT_CALLOUT_FONT_SIZE_REM, Math.min(MAX_TEXT_CALLOUT_FONT_SIZE_REM, effect.textCalloutFontSize)) } : {}),
      ...(effect.textCalloutBgColor !== undefined ? { textCalloutBgColor: effect.textCalloutBgColor } : {}),
      ...(effect.textCalloutTextColor !== undefined ? { textCalloutTextColor: effect.textCalloutTextColor } : {}),
      ...(effect.spotlightColor !== undefined ? { spotlightColor: effect.spotlightColor } : {}),
      ...(effect.spotlightOpacity !== undefined ? { spotlightOpacity: effect.spotlightOpacity } : {}),
      ...(effect.shape !== undefined ? { shape: effect.shape } : {}),
      ...(effect.color !== undefined ? { color: effect.color } : {}),
      ...(effect.shapeFillColor !== undefined ? { shapeFillColor: effect.shapeFillColor } : {}),
      ...(effect.strokeWidth !== undefined ? { strokeWidth: Math.max(1, Math.min(MAX_SHAPE_STROKE_WIDTH, Math.round(effect.strokeWidth))) } : {}),
      ...(effect.items !== undefined ? { items: effect.items } : {}),
      ...(effect.stepListBgColor !== undefined ? { stepListBgColor: effect.stepListBgColor } : {}),
      ...(effect.stepListTextColor !== undefined ? { stepListTextColor: effect.stepListTextColor } : {}),
      ...(effect.figureId !== undefined ? { figureId: effect.figureId } : {}),
      ...(effect.formula !== undefined ? { formula: effect.formula } : {}),
      ...(effect.formulaFontSize !== undefined ? { formulaFontSize: effect.formulaFontSize } : {}),
      ...(effect.exitDuration !== undefined ? { exitDuration: effect.exitDuration } : {}),
      ...(effect.code !== undefined ? { code: effect.code } : {}),
      ...(effect.prompt !== undefined ? { prompt: effect.prompt } : {}),
      ...(effect.conversation !== undefined ? { conversation: effect.conversation } : {}),
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
