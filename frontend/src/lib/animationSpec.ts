import type {
  ChatMessage,
  SlideAnimationEase,
  SlideAnimationEffect,
  SlideAnimationEffectType,
  SlideAnimationSpec,
  SlideAnimationStartTrigger,
} from '../types';
import { MANIM_HELPER_SCRIPT } from './manimHelperScript';
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
  'pointer',
  'text-callout',
  'custom-script',
];

/** Focus-style effect types: a rectangular overlay highlighting an area of the slide. */
export const FOCUS_EFFECT_TYPES: readonly SlideAnimationEffectType[] = ['highlight-box', 'spotlight'];

/** Effect types rendered as a positioned overlay element inside the animated stage (vs. a transform on the whole slide). */
export const OVERLAY_EFFECT_TYPES: readonly SlideAnimationEffectType[] = [
  ...FOCUS_EFFECT_TYPES,
  'pointer',
  'text-callout',
  'custom-script',
];

/** Max length (chars) for a `text-callout` effect's `text`, matching the backend's `MAX_TEXT_CALLOUT_LENGTH`. */
export const MAX_TEXT_CALLOUT_LENGTH = 80;

/** Max number of per-sentence animation hints, matching the backend's `MAX_HINTS`. */
export const MAX_HINTS = 50;
/** Max length (chars) for a single animation hint, matching the backend's `MAX_HINT_LENGTH`. */
export const MAX_HINT_LENGTH = 200;

/** Max length (chars) for a `custom-script` effect's `code`, matching the backend's `MAX_CUSTOM_SCRIPT_CODE_LENGTH`. */
export const MAX_CUSTOM_SCRIPT_CODE_LENGTH = 24000;
/** Max length (chars) for the prompt used to generate a `custom-script` effect's `code`, matching the backend's `MAX_CUSTOM_SCRIPT_PROMPT_LENGTH`. */
export const MAX_CUSTOM_SCRIPT_PROMPT_LENGTH = 300;
/** Max number of messages kept in a `custom-script` effect's AI chat `conversation`, matching the backend's `MAX_CUSTOM_SCRIPT_CONVERSATION_MESSAGES`. */
export const MAX_CUSTOM_SCRIPT_CONVERSATION_MESSAGES = 40;
/** Max length (chars) for a single `conversation` message's `content`, matching the backend's `MAX_CUSTOM_SCRIPT_CONVERSATION_MESSAGE_LENGTH`. */
export const MAX_CUSTOM_SCRIPT_CONVERSATION_MESSAGE_LENGTH = 2000;

/** Default `exitDuration` (seconds) suggested when a user first enables auto-hide for an overlay effect. */
export const DEFAULT_EXIT_DURATION_SECONDS = 2;

export interface FocusEffectParams {
  xPct: number;
  yPct: number;
  widthPct: number;
  heightPct: number;
}

const DEFAULT_FOCUS_PARAMS: FocusEffectParams = { xPct: 30, yPct: 30, widthPct: 40, heightPct: 40 };

/** custom-script 的編輯器未提供位置/大小欄位，預設鋪滿整張投影片（(0,0) ~ (100,100)），讓自訂動畫可使用全部畫面。 */
const DEFAULT_CUSTOM_SCRIPT_PARAMS: FocusEffectParams = { xPct: 0, yPct: 0, widthPct: 100, heightPct: 100 };

/** pointer 只需要 (xPct, yPct) 一個定位點，widthPct/heightPct 不會被渲染使用，預設置於投影片中央。 */
const DEFAULT_POINTER_PARAMS: FocusEffectParams = { xPct: 50, yPct: 50, widthPct: 0, heightPct: 0 };

/** Reads an overlay effect's position/size (focus, pointer or text-callout), filling in defaults for unset params. */
export function getFocusEffectParams(effect: SlideAnimationEffect): FocusEffectParams {
  const defaults =
    effect.type === 'custom-script'
      ? DEFAULT_CUSTOM_SCRIPT_PARAMS
      : effect.type === 'pointer'
        ? DEFAULT_POINTER_PARAMS
        : DEFAULT_FOCUS_PARAMS;
  return {
    xPct: effect.params?.xPct ?? defaults.xPct,
    yPct: effect.params?.yPct ?? defaults.yPct,
    widthPct: effect.params?.widthPct ?? defaults.widthPct,
    heightPct: effect.params?.heightPct ?? defaults.heightPct,
  };
}

/** Effect type and fade duration used by `generateFocusEffectsFromTranscript`. */
const AUTO_FOCUS_EFFECT_TYPE: SlideAnimationEffectType = 'highlight-box';
const AUTO_FOCUS_DURATION_SECONDS = 1.2;

function newAutoFocusEffectId(line: number): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `focus-${line}-${Date.now()}`;
}

/**
 * Generates one `highlight-box` focus effect per transcript sentence, each
 * synced via `startTrigger: { type: 'transcript-line', line }` so it fades
 * in when that sentence starts playing. Position/size use the default focus
 * box (center area) — the user can adjust per-effect afterwards. Capped at
 * `MAX_SLIDE_ANIMATION_EFFECTS`.
 */
export function generateFocusEffectsFromTranscript(sentenceCount: number): SlideAnimationEffect[] {
  const count = Math.min(Math.max(0, sentenceCount), MAX_SLIDE_ANIMATION_EFFECTS);
  return Array.from({ length: count }, (_, line) => ({
    id: newAutoFocusEffectId(line),
    target: 'slide',
    type: AUTO_FOCUS_EFFECT_TYPE,
    start: 0,
    duration: AUTO_FOCUS_DURATION_SECONDS,
    ease: 'power1.out',
    startTrigger: { type: 'transcript-line', line },
  }));
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
      conversation: e.conversation ? e.conversation.map((m) => ({ ...m })) : undefined,
    })),
    ...(spec.hints ? { hints: { ...spec.hints } } : {}),
  };
}

/**
 * Appends one or more messages to a `custom-script` effect's AI chat
 * `conversation`, truncating each message's `content` to
 * `MAX_CUSTOM_SCRIPT_CONVERSATION_MESSAGE_LENGTH` and dropping the oldest
 * messages beyond `MAX_CUSTOM_SCRIPT_CONVERSATION_MESSAGES`.
 */
export function appendConversationMessages(
  conversation: ChatMessage[] | undefined,
  ...messages: ChatMessage[]
): ChatMessage[] {
  const next = [
    ...(conversation ?? []),
    ...messages.map((m) => ({ ...m, content: m.content.slice(0, MAX_CUSTOM_SCRIPT_CONVERSATION_MESSAGE_LENGTH) })),
  ];
  return next.length > MAX_CUSTOM_SCRIPT_CONVERSATION_MESSAGES
    ? next.slice(next.length - MAX_CUSTOM_SCRIPT_CONVERSATION_MESSAGES)
    : next;
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

/** Encodes a (possibly non-Latin1) string as base64, for safe embedding in a `<script>` block. */
function utf8ToBase64(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * Total seconds a `custom-script` effect's sandboxed iframe stays visible:
 * its configured `duration` plus any hold time before auto-exit
 * (`exitDuration`). Passed into the sandbox as `api.duration` so generated
 * code can compute playback progress from the user's configured timing
 * instead of guessing its own animation length.
 */
export function customScriptDurationSeconds(effect: SlideAnimationEffect): number {
  const total = effect.duration + (effect.exitDuration ?? 0);
  return Number.isFinite(total) && total > 0 ? total : 1;
}

/**
 * Total seconds the slide's GSAP animation timeline runs for: the latest
 * point at which any effect's tween ends (`start + duration`, plus
 * `exitDuration` for overlay effects that auto-hide). Mirrors
 * `buildGsapTimeline`'s resulting `tl.duration()` without needing a DOM
 * stage, so playback code can compare it against the narration audio's
 * duration and extend the page if the animation runs longer.
 */
export function animationTimelineDurationSeconds(spec: SlideAnimationSpec | null): number {
  if (!spec || !spec.enabled) return 0;
  return spec.effects.reduce((max, effect) => {
    const end = effect.start + effect.duration + (effect.exitDuration ?? 0);
    return Number.isFinite(end) && end > max ? end : max;
  }, 0);
}

/**
 * Builds the HTML document for a `custom-script` effect's sandboxed
 * `<iframe sandbox="allow-scripts">` (no `allow-same-origin`, so it has an
 * opaque origin and cannot reach the parent page, cookies or storage).
 *
 * `code` is expected to define `window.renderAnimation(root, api)`, where
 * `root` is the `#root` element to draw into, `api.duration` is the total
 * playback length in seconds (see `customScriptDurationSeconds`), and
 * `api.onFrame(cb)` registers a callback invoked with `{ t, playing }`
 * whenever the host posts a `{ type: 'sync', t, playing }` message (`t` =
 * seconds since this effect started, i.e. `effect.start`). `code` is
 * base64-encoded so it can be embedded verbatim without any HTML/script-tag
 * escaping concerns.
 *
 * `MANIM_HELPER_SCRIPT` runs first and defines `window.Manim`, a small
 * manim-inspired helper library (coordinate system, color palette, rate
 * functions, shape mobjects and Create/Write/FadeIn/Transform-style
 * animations) that `code` can optionally use for "manim 式" animations.
 */
export function buildCustomScriptSandboxDoc(code: string, durationSeconds: number): string {
  const encoded = code ? utf8ToBase64(code) : '';
  const safeDuration = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 1;
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: transparent; }
  #root { width: 100%; height: 100%; }
</style>
</head>
<body>
<div id="root"></div>
<script>${MANIM_HELPER_SCRIPT}</script>
<script>
(function () {
  "use strict";
  var root = document.getElementById('root');
  var listeners = [];
  var api = { duration: ${safeDuration}, onFrame: function (cb) { listeners.push(cb); } };
  window.addEventListener('message', function (ev) {
    var data = ev.data;
    if (!data || typeof data !== 'object' || data.type !== 'sync') return;
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i]({ t: data.t, playing: data.playing }); } catch (e) { /* ignore listener errors */ }
    }
  });
  function base64ToUtf8(b64) {
    var binary = atob(b64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  try {
    var code = "${encoded}" ? base64ToUtf8("${encoded}") : '';
    if (code) new Function(code)();
    if (typeof window.renderAnimation === 'function') {
      window.renderAnimation(root, api);
    } else if (code) {
      root.textContent = 'Animation error: generated code did not define window.renderAnimation(root, api).';
    }
  } catch (e) {
    root.textContent = 'Animation error: ' + (e && e.message ? e.message : String(e));
  }
})();
</script>
</body>
</html>`;
}
