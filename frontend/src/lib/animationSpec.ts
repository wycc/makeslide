import type {
  ChatMessage,
  SlideAnimationEase,
  SlideAnimationEffect,
  SlideAnimationEffectType,
  SlideAnimationShapeKind,
  SlideAnimationSpec,
  SlideAnimationStartTrigger,
} from '../types';
import { CUSTOM_SCRIPT_CAPTURE_MESSAGE, CUSTOM_SCRIPT_INPUT_MESSAGE } from './customScriptInput';
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
  'shape',
  'step-list',
  'overlay-image',
  'formula',
  'pause-playback',
  'realtime-poll',
  'custom-script',
];

/** Focus-style effect types: a rectangular overlay highlighting an area of the slide. */
export const FOCUS_EFFECT_TYPES: readonly SlideAnimationEffectType[] = ['highlight-box', 'spotlight'];

/** Effect types rendered as a positioned overlay element inside the animated stage (vs. a transform on the whole slide). */
export const OVERLAY_EFFECT_TYPES: readonly SlideAnimationEffectType[] = [
  ...FOCUS_EFFECT_TYPES,
  'pointer',
  'text-callout',
  'shape',
  'step-list',
  'overlay-image',
  'formula',
  'pause-playback',
  'realtime-poll',
  'custom-script',
];

/** SVG primitive shapes drawable by `shape` effects (design doc §12 V2 "SVG 圖元"), matching the backend's `ANIMATION_SHAPE_KINDS`. */
export const ANIMATION_SHAPE_KINDS: readonly SlideAnimationShapeKind[] = ['circle', 'rect', 'ellipse', 'arrow', 'line', 'triangle', 'star', 'hexagon'];

/** Default `shape` kind when a `shape` effect doesn't specify one. */
export const DEFAULT_SHAPE_KIND: SlideAnimationShapeKind = 'circle';

/** Reads a `shape` effect's SVG primitive, falling back to `DEFAULT_SHAPE_KIND`. */
export function getShapeKind(effect: SlideAnimationEffect): SlideAnimationShapeKind {
  return effect.shape ?? DEFAULT_SHAPE_KIND;
}

/**
 * Whole-slide transform effect types. On these types, `exitDuration` plays the
 * entrance tween in reverse (same `duration`/`ease`) to restore the slide to
 * its pre-effect state, instead of the auto-hide behaviour used by
 * `OVERLAY_EFFECT_TYPES` (see `buildGsapTimeline`).
 */
export const TRANSFORM_EFFECT_TYPES: readonly SlideAnimationEffectType[] = [
  'fade-in',
  'zoom-in',
  'zoom-out',
  'pan-left',
  'pan-right',
  'pan-up',
  'pan-down',
];

/** Max length (chars) for a `text-callout` or `pause-playback` effect's `text`, matching the backend's `MAX_TEXT_CALLOUT_LENGTH`. */
export const MAX_TEXT_CALLOUT_LENGTH = 80;

/** Effect types that, when their start time is reached, pause playback (see `getDuePausePlaybackEffect`). */
const PAUSING_EFFECT_TYPES: readonly SlideAnimationEffectType[] = ['pause-playback', 'realtime-poll'];

/** Max number of bullet items in a `step-list` effect's `items`, matching the backend's `MAX_STEP_LIST_ITEMS`. */
export const MAX_STEP_LIST_ITEMS = 6;
/** Max length (chars) for a single `step-list` item, matching the backend's `MAX_STEP_LIST_ITEM_LENGTH`. */
export const MAX_STEP_LIST_ITEM_LENGTH = 60;

/** Max length (chars) for an `overlay-image` effect's `figureId`, matching the backend's `MAX_OVERLAY_IMAGE_FIGURE_ID_LENGTH`. */
export const MAX_OVERLAY_IMAGE_FIGURE_ID_LENGTH = 200;

/** Max length (chars) for a `formula` effect's LaTeX source, matching the backend's `MAX_FORMULA_LENGTH`. */
export const MAX_FORMULA_LENGTH = 200;

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

/** Default `exitDuration` (seconds) suggested when a user first enables auto-hide (overlay effects) or auto-revert (transform effects). */
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
  'elastic.out',
  'back.out',
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
 * Also extends `exitDuration` (when set) so the effect stays fully visible
 * at least until its referenced sentence finishes narrating — the AI/author
 * picks `exitDuration` from the sentence's text alone without knowing its
 * actual spoken length, so short exit durations on long sentences would
 * otherwise make the effect disappear mid-explanation. Never shortens an
 * `exitDuration` that's already longer than the sentence.
 *
 * Returns the original `spec` reference when nothing needs resolving, so
 * callers can safely use the result as a memoization/effect dependency
 * without triggering unnecessary GSAP timeline rebuilds.
 */
/**
 * Resolves a `startTrigger` to a playback second, applying its optional
 * `offsetSeconds` (start N seconds earlier) and clamping to 0. Returns
 * `undefined` if the referenced sentence doesn't exist in `sentenceTimeline`
 * (e.g. the transcript was edited).
 *
 * `anchor` picks which end of the sentence to hang off: `'start'` (the
 * default, and what every spec written before this option existed means) runs
 * the effect alongside the narration; `'end'` waits until the sentence has
 * finished being spoken. The latter routinely lands past the audio's own
 * length — that is the point, and the page extends itself to let the animation
 * finish before advancing.
 */
export function resolveStartTriggerSeconds(
  startTrigger: SlideAnimationStartTrigger,
  sentenceTimeline: SentenceTimelineItem[],
): number | undefined {
  const target = sentenceTimeline[startTrigger.line];
  if (!target) return undefined;
  const anchorSeconds = startTrigger.anchor === 'end' ? target.end : target.start;
  return Math.max(0, anchorSeconds - (startTrigger.offsetSeconds ?? 0));
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
      const target = sentenceTimeline[effect.startTrigger.line];
      const resolved = resolveStartTriggerSeconds(effect.startTrigger, sentenceTimeline);
      if (resolved === undefined || !target) return effect;
      const next = { ...effect, start: resolved };
      if (next.exitDuration !== undefined && effect.startTrigger.anchor !== 'end') {
        // 只有「句子開始時」需要這個保護：效果與旁白同時進行，作者挑的 exitDuration
        // 又是看文字長度猜的，太短會讓效果在講解到一半時消失。錨在句子結束時，
        // 效果本來就是在旁白講完之後才出現，沒有「講到一半消失」這回事。
        const minExitDuration = Math.max(0, target.end - resolved - next.duration);
        next.exitDuration = Math.max(next.exitDuration, minExitDuration);
      }
      return next;
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

/** A selected effect paired with its resolved absolute start/end seconds. */
export interface SelectedEffectRange {
  effect: SlideAnimationEffect;
  start: number;
  end: number;
}

/**
 * Merge several selected effects (each with its resolved start/end seconds) into
 * one: the result starts at the earliest start, lasts until the latest end, and
 * inherits all other settings from the earliest effect — including its
 * `startTrigger`, so a transcript-anchored effect stays anchored (`start` is
 * still set to the resolved `minStart` as a fallback for when the transcript can
 * no longer be resolved). The merged effect keeps the earliest effect's `id`.
 * Returns `null` when there are fewer than two ranges (nothing to merge). Pure
 * function extracted from AnimationEditorTab's merge handler for unit testing.
 */
export function mergeEffectRanges(ranges: SelectedEffectRange[]): SlideAnimationEffect | null {
  if (ranges.length < 2) return null;
  const minStart = Math.min(...ranges.map((r) => r.start));
  const maxEnd = Math.max(...ranges.map((r) => r.end));
  const earliest = ranges.reduce((a, b) => (b.start < a.start ? b : a)).effect;
  return { ...earliest, start: minStart, duration: maxEnd - minStart };
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
 * 暫停提示實際應該暫停播放的時間點：等提示框淡入動畫（`effect.duration`）播完，
 * 而且——如果這個效果落在某一句逐字稿的時間範圍內——還要等那一整句講完，而不是
 * 講到一半就把播放凍結住，讓使用者聽完那句話的完整內容才看到暫停提示。
 * 找不到對應句子時（例如沒有逐字稿時間軸、或效果落在句子之間的空隙），回退成
 * 只等淡入動畫播完。
 */
export function pausePlaybackTriggerSeconds(
  effect: SlideAnimationEffect,
  sentenceTimeline: readonly { start: number; end: number }[] = [],
): number {
  const minimumAfterFadeIn = effect.start + effect.duration;
  // 只有**落在句子內部**才等那句講完。用 `>=` 的話，剛好停在句子邊界的效果會被算成
  // 「在下一句之中」而延到下一整句講完——設在 3 秒的即時問答實際 7 秒才停，看起來就是
  // 「指定的時間沒有停下來」。邊界代表前一句剛講完，本來就沒有「講到一半被凍結」的問題，
  // 而「句子結束時」錨點解析出來的時間**必然**落在邊界上。
  const containingSentence = sentenceTimeline.find((s) => effect.start > s.start && effect.start < s.end);
  return containingSentence ? Math.max(minimumAfterFadeIn, containingSentence.end) : minimumAfterFadeIn;
}

export function getDuePausePlaybackEffect(
  spec: SlideAnimationSpec | null | undefined,
  previousTime: number,
  currentTime: number,
  consumedEffectIds: ReadonlySet<string>,
  sentenceTimeline: readonly { start: number; end: number }[] = [],
): SlideAnimationEffect | null {
  if (!spec?.enabled || currentTime < previousTime) return null;
  for (const effect of spec.effects) {
    if (!PAUSING_EFFECT_TYPES.includes(effect.type) || consumedEffectIds.has(effect.id)) continue;
    const pauseAt = pausePlaybackTriggerSeconds(effect, sentenceTimeline);
    if (pauseAt > previousTime && pauseAt <= currentTime) return effect;
  }
  return null;
}

/**
 * 播放時間往回跳（拖曳進度條、跳到指定時間）時，把落在新時間點之後的暫停提示
 * 重新標記為「未消費」，讓使用者重播到該時間點時仍會觸發暫停，而不是因為先前
 * 已經消費過就被永遠跳過。
 */
export function effectIdsToReleaseOnSeekBack(
  spec: SlideAnimationSpec | null | undefined,
  newCurrentTime: number,
  sentenceTimeline: readonly { start: number; end: number }[] = [],
): string[] {
  if (!spec?.enabled) return [];
  return spec.effects
    .filter((effect) => PAUSING_EFFECT_TYPES.includes(effect.type) && pausePlaybackTriggerSeconds(effect, sentenceTimeline) >= newCurrentTime)
    .map((effect) => effect.id);
}

export function insertEffectAfterFirstStartingEffect(
  effects: readonly SlideAnimationEffect[],
  effect: SlideAnimationEffect,
): SlideAnimationEffect[] {
  const insertIndex = effects.findIndex((item) => item.start === 0 || item.startTrigger !== undefined);
  if (insertIndex === -1) return [effect, ...effects];
  return [...effects.slice(0, insertIndex + 1), effect, ...effects.slice(insertIndex + 1)];
}

/**
 * Inserts a newly created effect immediately after the effect that is active at
 * `currentTime`. If no effect covers the current playback time, falls back to
 * appending at the end to preserve the editor's existing behaviour.
 */
export function insertEffectAfterPlaybackEffect(
  effects: readonly SlideAnimationEffect[],
  effect: SlideAnimationEffect,
  currentTime: number,
  resolveEffectStartSeconds: (effect: SlideAnimationEffect) => number = (item) => item.start,
): SlideAnimationEffect[] {
  if (!Number.isFinite(currentTime)) return [...effects, effect];
  let insertIndex = -1;
  for (let index = 0; index < effects.length; index += 1) {
    const item = effects[index];
    if (!item) continue;
    const start = resolveEffectStartSeconds(item);
    const end = start + item.duration + (item.exitDuration ?? 0);
    if (currentTime >= start && currentTime <= end) insertIndex = index;
  }
  if (insertIndex === -1) return [...effects, effect];
  return [...effects.slice(0, insertIndex + 1), effect, ...effects.slice(insertIndex + 1)];
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
 * The `api.captureKeys`/`api.capturePointer`/`api.onKey`/`api.onPointer` half
 * of the contract lets an animation take keyboard/mouse input *before* the
 * player's own shortcuts, which it otherwise never sees: the overlay is
 * `pointer-events: none` and the iframe is never focused. Capture is
 * declarative because the host has to decide synchronously whether to swallow
 * an event — see `customScriptInput.ts` for the host side of the protocol.
 *
 * `MANIM_HELPER_SCRIPT` runs first and defines `window.Manim`, a small
 * manim-inspired helper library (coordinate system, color palette, rate
 * functions, shape mobjects and Create/Write/FadeIn/Transform-style
 * animations) that `code` can optionally use for "manim 式" animations.
 */
export function buildCustomScriptSandboxDoc(code: string, durationSeconds: number): string {
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
${buildCustomScriptRuntimeScript(code, durationSeconds)}
</script>
</body>
</html>`;
}

/**
 * The sandbox's bootstrap IIFE: sets up `api`, bridges host messages (playback
 * `sync` plus forwarded input events) and finally runs `code`. Split out of
 * `buildCustomScriptSandboxDoc` so tests can execute it against a stub
 * `window`/`document`/`parent` instead of only string-matching the document.
 */
export function buildCustomScriptRuntimeScript(code: string, durationSeconds: number): string {
  const encoded = code ? utf8ToBase64(code) : '';
  const safeDuration = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 1;
  return `(function () {
  "use strict";
  var root = document.getElementById('root');
  var listeners = [];
  var keyListeners = [];
  var pointerListeners = [];
  var captured = { keys: null, pointer: false, wheel: false };
  // The host can only decide synchronously whether to hand an event over, so it
  // needs the declaration up front rather than a reply per event.
  function declareCapture() {
    try {
      parent.postMessage({
        type: '${CUSTOM_SCRIPT_CAPTURE_MESSAGE}',
        keys: captured.keys,
        pointer: captured.pointer,
        wheel: captured.wheel,
      }, '*');
    } catch (e) { /* host unreachable: input simply stays with the player */ }
  }
  var api = {
    duration: ${safeDuration},
    onFrame: function (cb) { if (typeof cb === 'function') listeners.push(cb); },
    onKey: function (cb) { if (typeof cb === 'function') keyListeners.push(cb); },
    onPointer: function (cb) { if (typeof cb === 'function') pointerListeners.push(cb); },
    captureKeys: function (keys) {
      // Accept every shape a generated animation plausibly uses: '*', ['*'],
      // 'ArrowLeft' and ['ArrowLeft', ' ']. Taking the wildcard only as a bare
      // string silently turned captureKeys(['*']) into "a key literally named *",
      // i.e. an animation that declared everything received nothing.
      var list = typeof keys === 'string' ? [keys] : Array.prototype.slice.call(keys || [], 0, 64).map(String);
      captured.keys = list.indexOf('*') >= 0 ? '*' : list;
      declareCapture();
    },
    releaseKeys: function () { captured.keys = null; declareCapture(); },
    capturePointer: function (opts) {
      captured.pointer = true;
      captured.wheel = !!(opts && opts.wheel);
      declareCapture();
    },
    releasePointer: function () { captured.pointer = false; captured.wheel = false; declareCapture(); },
  };
  function dispatchInput(data) {
    var isKey = data.kind === 'keydown' || data.kind === 'keyup';
    var list = isKey ? keyListeners : pointerListeners;
    var ev = isKey
      ? {
          type: data.kind, key: data.key, code: data.code, repeat: !!data.repeat,
          ctrlKey: !!data.ctrlKey, shiftKey: !!data.shiftKey, altKey: !!data.altKey, metaKey: !!data.metaKey,
        }
      : {
          type: data.kind, x: data.x, y: data.y, nx: data.nx, ny: data.ny,
          button: data.button, buttons: data.buttons,
          deltaX: data.deltaX || 0, deltaY: data.deltaY || 0,
          ctrlKey: !!data.ctrlKey, shiftKey: !!data.shiftKey, altKey: !!data.altKey, metaKey: !!data.metaKey,
        };
    for (var i = 0; i < list.length; i++) {
      try { list[i](ev); } catch (e) { /* ignore listener errors */ }
    }
  }
  window.addEventListener('message', function (ev) {
    // Only the embedding player drives this frame; ignore anything else.
    if (ev.source !== parent) return;
    var data = ev.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === '${CUSTOM_SCRIPT_INPUT_MESSAGE}') { dispatchInput(data); return; }
    if (data.type !== 'sync') return;
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
  // Always announce once on startup, even when nothing was captured: the host
  // remembers declarations across re-registrations, and this is what tells it a
  // freshly loaded animation claims nothing.
  declareCapture();
})();`;
}
