/**
 * Input arbitration between the player UI and `custom-script` animations.
 *
 * A custom-script effect runs inside `<iframe sandbox="allow-scripts">` with an
 * opaque origin, and its overlay is `pointer-events: none` — so today keyboard
 * and mouse events never reach the animation at all: the player's window-level
 * capture-phase handlers consume them first, and the iframe (never focused,
 * never hit-tested) sees nothing.
 *
 * Handing input over cannot be a "forward and ask" round trip: postMessage is
 * asynchronous, and the host must decide *synchronously* whether to call
 * `preventDefault()` and skip the player's own shortcut. So the contract is
 * declarative instead — the animation announces up front which keys (and
 * whether pointer/wheel input) it wants via `api.captureKeys()` /
 * `api.capturePointer()`, the iframe posts that declaration back to the host,
 * and the host consults it synchronously on every event:
 *
 * - declared + the effect is currently on screen → forward to the iframe and
 *   stop the event, the player never sees it;
 * - anything else → untouched, the player behaves exactly as before.
 *
 * An animation that never calls `captureKeys`/`capturePointer` therefore
 * changes nothing, and one that calls `releaseKeys()` when its interactive
 * phase ends gives the keys straight back to the player.
 */

/** Message type an animation iframe posts to declare (or withdraw) its input capture. */
export const CUSTOM_SCRIPT_CAPTURE_MESSAGE = 'makeslide:animation-capture';
/** Message type the host posts into an animation iframe carrying one forwarded input event. */
export const CUSTOM_SCRIPT_INPUT_MESSAGE = 'makeslide:animation-input';

/**
 * Keys the player never gives up, even to an animation that captured `'*'`.
 * Escape is the only way out of fullscreen/an overlay; a buggy or greedy
 * animation must not be able to trap the presenter there.
 */
export const RESERVED_KEYS: ReadonlySet<string> = new Set(['Escape']);

/** Upper bound on declared keys, so a malformed declaration can't grow unbounded. */
const MAX_CAPTURED_KEYS = 64;

/** What one animation frame currently wants to receive. */
export interface CaptureDeclaration {
  /** `'*'` = every non-reserved key; a set = only those `KeyboardEvent.key` values; `null` = none. */
  keys: '*' | ReadonlySet<string> | null;
  /** True once the animation called `api.capturePointer()`. */
  pointer: boolean;
  /** True when the animation also asked for wheel events. */
  wheel: boolean;
}

const NO_CAPTURE: CaptureDeclaration = { keys: null, pointer: false, wheel: false };

/** Rect of a frame in viewport CSS pixels (i.e. after any stage scaling). */
export interface FrameRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * The host-side handle for one animation iframe. Kept as an interface (rather
 * than the `HTMLIFrameElement` itself) so the arbitration logic is testable
 * without a DOM — see `frameHandleFromIframe` for the real implementation.
 */
export interface CustomScriptFrameHandle {
  /** The iframe's content window; used both to post into it and to match incoming messages. */
  readonly contentWindow: Window | null;
  /** Position/size on screen, or `null` when the frame isn't laid out. */
  getRect(): FrameRect | null;
  /** The iframe's own (unscaled) coordinate space, so forwarded coordinates match what the script drew. */
  getContentSize(): { width: number; height: number };
}

interface FrameEntry {
  effectId: string;
  handle: CustomScriptFrameHandle;
  /** True only while the effect's slice of the timeline is on screen. */
  active: boolean;
  capture: CaptureDeclaration;
}

/** Registration order; later entries render on top, so they get first refusal on input. */
const frames: FrameEntry[] = [];

/**
 * Events already routed to an animation. The same event can reach us twice —
 * once through the window-level capture listener and once through the explicit
 * guard inside the player's own shortcut handler (whichever registered first
 * runs first) — and it must only be forwarded once.
 */
const handledEvents = new WeakSet<Event>();

/**
 * Registers an animation frame. Returns the unregister function; call it when
 * the effect's iframe goes away so a stale frame can't keep swallowing input.
 */
export function registerCustomScriptFrame(effectId: string, handle: CustomScriptFrameHandle): () => void {
  const entry: FrameEntry = { effectId, handle, active: false, capture: NO_CAPTURE };
  frames.push(entry);
  return () => {
    const index = frames.indexOf(entry);
    if (index >= 0) frames.splice(index, 1);
  };
}

/**
 * Marks whether the effect is currently on screen. Only active frames receive
 * input: an animation that already faded out (or hasn't started) must not hold
 * on to the arrow keys for the rest of the page.
 */
export function setCustomScriptFrameActive(effectId: string, active: boolean): void {
  for (const entry of frames) {
    if (entry.effectId === effectId) entry.active = active;
  }
}

/** Test/debug helper: the declaration currently in force for `effectId`. */
export function customScriptCaptureFor(effectId: string): CaptureDeclaration | null {
  return frames.find((entry) => entry.effectId === effectId)?.capture ?? null;
}

/** Drops every registration. Only used by tests and full teardown. */
export function resetCustomScriptFrames(): void {
  frames.length = 0;
}

/**
 * Parses a `makeslide:animation-capture` payload into a declaration, or returns
 * `null` if it isn't one. The payload crosses an opaque-origin boundary, so
 * every field is treated as untrusted input.
 */
export function parseCaptureMessage(data: unknown): CaptureDeclaration | null {
  if (!data || typeof data !== 'object') return null;
  const payload = data as { type?: unknown; keys?: unknown; pointer?: unknown; wheel?: unknown };
  if (payload.type !== CUSTOM_SCRIPT_CAPTURE_MESSAGE) return null;
  let keys: CaptureDeclaration['keys'] = null;
  if (payload.keys === '*') {
    keys = '*';
  } else if (Array.isArray(payload.keys)) {
    const named = payload.keys
      .filter((key): key is string => typeof key === 'string' && key.length > 0 && key.length <= 32)
      .slice(0, MAX_CAPTURED_KEYS);
    keys = named.length > 0 ? new Set(named) : null;
  }
  return { keys, pointer: payload.pointer === true, wheel: payload.wheel === true };
}

/**
 * Applies a capture declaration posted by one of the registered frames.
 * Returns true when the message came from a known frame and was applied —
 * a message from any other window is ignored, so an unrelated iframe on the
 * page can't declare capture on an animation's behalf.
 */
export function applyCustomScriptCaptureMessage(source: unknown, data: unknown): boolean {
  const capture = parseCaptureMessage(data);
  if (!capture) return false;
  const entry = frames.find((item) => item.handle.contentWindow != null && item.handle.contentWindow === source);
  if (!entry) return false;
  entry.capture = capture;
  return true;
}

/** True when `capture` claims `key` (reserved player keys are never claimable). */
export function capturesKey(capture: CaptureDeclaration, key: string): boolean {
  if (RESERVED_KEYS.has(key)) return false;
  if (capture.keys === '*') return true;
  return capture.keys instanceof Set && capture.keys.has(key);
}

/** True when the event target is a text field, where the player also stays out of the way. */
function isTextEntryTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element || typeof element !== 'object' || !('tagName' in element)) return false;
  return (
    element.tagName === 'INPUT' ||
    element.tagName === 'TEXTAREA' ||
    element.tagName === 'SELECT' ||
    element.isContentEditable === true
  );
}

/**
 * Frames that should receive `key`: the topmost active claimant, plus every
 * other registration of the *same effect*. The normal panel and the fullscreen
 * overlay each mount their own `SlideRenderer`, so one effect can be live in two
 * iframes at once; sending the key to only one of them would let the two copies
 * of the animation drift into different states.
 */
function findKeyboardTargets(key: string): FrameEntry[] {
  for (let index = frames.length - 1; index >= 0; index -= 1) {
    const entry = frames[index];
    if (entry?.active && capturesKey(entry.capture, key)) {
      return frames.filter((item) => item.effectId === entry.effectId && item.active);
    }
  }
  return [];
}

/**
 * Converts viewport coordinates into the iframe's own coordinate space. The
 * animation stage is CSS-scaled (fullscreen, editor preview, follower view all
 * render at different sizes), so the on-screen rect and the iframe's internal
 * pixel size differ; the script drew in the latter.
 */
export function toFrameCoordinates(
  rect: FrameRect,
  contentSize: { width: number; height: number },
  clientX: number,
  clientY: number,
): { x: number; y: number; nx: number; ny: number } {
  const nx = rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
  const ny = rect.height > 0 ? (clientY - rect.top) / rect.height : 0;
  return { x: nx * contentSize.width, y: ny * contentSize.height, nx, ny };
}

/** True when the point lies inside the rect (bounds inclusive). */
export function rectContains(rect: FrameRect, clientX: number, clientY: number): boolean {
  return (
    clientX >= rect.left &&
    clientX <= rect.left + rect.width &&
    clientY >= rect.top &&
    clientY <= rect.top + rect.height
  );
}

/** Topmost active frame that captures pointer input and contains the point. */
function findPointerTarget(clientX: number, clientY: number, needsWheel: boolean): { entry: FrameEntry; rect: FrameRect } | null {
  for (let index = frames.length - 1; index >= 0; index -= 1) {
    const entry = frames[index];
    if (!entry?.active || !entry.capture.pointer) continue;
    if (needsWheel && !entry.capture.wheel) continue;
    const rect = entry.handle.getRect();
    if (rect && rectContains(rect, clientX, clientY)) return { entry, rect };
  }
  return null;
}

function postToFrame(entry: FrameEntry, payload: Record<string, unknown>): void {
  const win = entry.handle.contentWindow;
  if (!win) return;
  try {
    win.postMessage({ type: CUSTOM_SCRIPT_INPUT_MESSAGE, ...payload }, '*');
  } catch {
    /* a frame torn down mid-dispatch is not an error worth surfacing */
  }
}

/**
 * Offers a keyboard event to the animations first. Returns true when an
 * animation claimed it — in that case the event has already been forwarded and
 * stopped, and the caller must not run its own shortcut handling.
 */
export function handleAnimationKeyboardEvent(ev: KeyboardEvent): boolean {
  if (handledEvents.has(ev)) return true;
  if (isTextEntryTarget(ev.target)) return false;
  const targets = findKeyboardTargets(ev.key);
  if (targets.length === 0) return false;
  handledEvents.add(ev);
  for (const entry of targets) {
    postToFrame(entry, {
      kind: ev.type,
      key: ev.key,
      code: ev.code,
      ctrlKey: ev.ctrlKey,
      shiftKey: ev.shiftKey,
      altKey: ev.altKey,
      metaKey: ev.metaKey,
      repeat: ev.repeat,
    });
  }
  ev.preventDefault();
  ev.stopImmediatePropagation();
  return true;
}

/**
 * Offers a mouse/pointer/wheel event to the animations first. Returns true when
 * an animation claimed it (already forwarded and stopped).
 *
 * Unlike keys, a pointer event goes to the single frame under the cursor: the
 * coordinates only mean anything in the frame that was actually hit, and the
 * cursor is only ever over one of an effect's copies.
 */
export function handleAnimationPointerEvent(ev: MouseEvent | WheelEvent): boolean {
  if (handledEvents.has(ev)) return true;
  const target = findPointerTarget(ev.clientX, ev.clientY, ev.type === 'wheel');
  if (!target) return false;
  const { x, y, nx, ny } = toFrameCoordinates(target.rect, target.entry.handle.getContentSize(), ev.clientX, ev.clientY);
  handledEvents.add(ev);
  const wheel = ev as WheelEvent;
  postToFrame(target.entry, {
    kind: ev.type,
    x,
    y,
    nx,
    ny,
    button: ev.button,
    buttons: ev.buttons,
    ctrlKey: ev.ctrlKey,
    shiftKey: ev.shiftKey,
    altKey: ev.altKey,
    metaKey: ev.metaKey,
    ...(ev.type === 'wheel' ? { deltaX: wheel.deltaX, deltaY: wheel.deltaY } : {}),
  });
  // Wheel/pointer defaults (page scroll, text selection, the browser's own drag)
  // would fight the animation's own handling.
  if (ev.cancelable) ev.preventDefault();
  ev.stopImmediatePropagation();
  return true;
}

/** Builds the host-side handle for a real iframe element. */
export function frameHandleFromIframe(iframe: HTMLIFrameElement): CustomScriptFrameHandle {
  return {
    get contentWindow() {
      return iframe.contentWindow;
    },
    getRect() {
      const rect = iframe.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    },
    getContentSize() {
      // Layout size of the iframe itself — the coordinate space `root` has inside it.
      return { width: iframe.clientWidth, height: iframe.clientHeight };
    },
  };
}

/** Pointer-ish event types offered to animations before the player UI sees them. */
const POINTER_EVENT_TYPES = ['pointerdown', 'pointerup', 'pointermove', 'click', 'dblclick', 'contextmenu', 'wheel'] as const;

let installCount = 0;
let uninstall: (() => void) | null = null;

/**
 * Installs the window-level capture-phase listeners that give animations first
 * refusal on input, plus the listener that receives their capture declarations.
 * Reference-counted: returns a disposer, and the listeners are removed once the
 * last caller disposes.
 *
 * These run at `window` in the capture phase, i.e. before React's delegated
 * handlers and (since events claimed by an animation are stopped with
 * `stopImmediatePropagation`) before other window-level listeners registered
 * later. The player's own keyboard handler additionally calls
 * `handleAnimationKeyboardEvent` first, which covers the case where it happened
 * to register before this one.
 */
export function installAnimationInputCapture(): () => void {
  installCount += 1;
  if (installCount === 1 && typeof window !== 'undefined') {
    const onMessage = (ev: MessageEvent) => {
      applyCustomScriptCaptureMessage(ev.source, ev.data);
    };
    const onKey = (ev: KeyboardEvent) => {
      handleAnimationKeyboardEvent(ev);
    };
    const onPointer = (ev: Event) => {
      handleAnimationPointerEvent(ev as MouseEvent);
    };
    window.addEventListener('message', onMessage);
    window.addEventListener('keydown', onKey, { capture: true });
    window.addEventListener('keyup', onKey, { capture: true });
    for (const type of POINTER_EVENT_TYPES) {
      // `wheel` needs an explicitly non-passive listener or preventDefault() is ignored.
      window.addEventListener(type, onPointer, { capture: true, passive: false });
    }
    uninstall = () => {
      window.removeEventListener('message', onMessage);
      window.removeEventListener('keydown', onKey, { capture: true });
      window.removeEventListener('keyup', onKey, { capture: true });
      for (const type of POINTER_EVENT_TYPES) {
        window.removeEventListener(type, onPointer, { capture: true });
      }
    };
  }
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    installCount -= 1;
    if (installCount === 0) {
      uninstall?.();
      uninstall = null;
    }
  };
}
