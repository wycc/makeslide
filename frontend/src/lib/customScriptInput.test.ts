import test from "node:test";
import assert from "node:assert/strict";
import {
  CUSTOM_SCRIPT_CAPTURE_MESSAGE,
  CUSTOM_SCRIPT_INPUT_MESSAGE,
  applyCustomScriptCaptureMessage,
  capturesKey,
  customScriptCaptureFor,
  forgetCustomScriptCaptures,
  handleAnimationKeyboardEvent,
  handleAnimationPointerEvent,
  hasActiveCustomScriptCapture,
  parseCaptureMessage,
  rectContains,
  registerCustomScriptFrame,
  resetCustomScriptFrames,
  setCustomScriptFrameActive,
  subscribeCustomScriptCapture,
  toFrameCoordinates,
  type CustomScriptFrameHandle,
} from "./customScriptInput";

interface PostedMessage {
  [key: string]: unknown;
}

/** A stand-in for one animation iframe: records what the host posts into it. */
function fakeFrame(rect = { left: 100, top: 50, width: 200, height: 100 }, contentSize = { width: 400, height: 200 }) {
  const posted: PostedMessage[] = [];
  const contentWindow = {
    postMessage: (message: PostedMessage) => {
      posted.push(message);
    },
  };
  const handle: CustomScriptFrameHandle = {
    contentWindow: contentWindow as unknown as Window,
    getRect: () => rect,
    getContentSize: () => contentSize,
  };
  return { handle, contentWindow, posted };
}

/** Minimal KeyboardEvent stand-in that records preventDefault/stopImmediatePropagation. */
function fakeKeyEvent(key: string, extra: Record<string, unknown> = {}) {
  const state = { prevented: false, stopped: false };
  const ev = {
    type: "keydown",
    key,
    code: `Key${key.toUpperCase()}`,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    repeat: false,
    target: null,
    cancelable: true,
    preventDefault: () => {
      state.prevented = true;
    },
    stopImmediatePropagation: () => {
      state.stopped = true;
    },
    ...extra,
  } as unknown as KeyboardEvent;
  return { ev, state };
}

function fakePointerEvent(type: string, clientX: number, clientY: number, extra: Record<string, unknown> = {}) {
  const state = { prevented: false, stopped: false };
  const ev = {
    type,
    clientX,
    clientY,
    button: 0,
    buttons: 1,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    cancelable: true,
    preventDefault: () => {
      state.prevented = true;
    },
    stopImmediatePropagation: () => {
      state.stopped = true;
    },
    ...extra,
  } as unknown as MouseEvent;
  return { ev, state };
}

test.afterEach(() => {
  resetCustomScriptFrames();
});

test("parseCaptureMessage ignores unrelated payloads", () => {
  assert.equal(parseCaptureMessage(null), null);
  assert.equal(parseCaptureMessage("keys"), null);
  assert.equal(parseCaptureMessage({ type: "sync", t: 1 }), null);
});

test("parseCaptureMessage normalizes keys, dropping non-strings and over-long entries", () => {
  const capture = parseCaptureMessage({
    type: CUSTOM_SCRIPT_CAPTURE_MESSAGE,
    keys: ["ArrowLeft", 42, "", "x".repeat(33), "a"],
    pointer: true,
  });
  assert.ok(capture);
  assert.deepEqual([...(capture!.keys as Set<string>)].sort(), ["ArrowLeft", "a"]);
  assert.equal(capture!.pointer, true);
  assert.equal(capture!.wheel, false);
});

test("parseCaptureMessage keeps the '*' wildcard and treats an empty list as no capture", () => {
  assert.equal(parseCaptureMessage({ type: CUSTOM_SCRIPT_CAPTURE_MESSAGE, keys: "*" })?.keys, "*");
  assert.equal(parseCaptureMessage({ type: CUSTOM_SCRIPT_CAPTURE_MESSAGE, keys: [] })?.keys, null);
  assert.equal(parseCaptureMessage({ type: CUSTOM_SCRIPT_CAPTURE_MESSAGE, keys: null })?.keys, null);
});

test("parseCaptureMessage honours the wildcard inside the key list", () => {
  // A real generated animation wrote `api.captureKeys(["*"])`; reading that as a
  // key named "*" meant it declared everything and received nothing.
  assert.equal(parseCaptureMessage({ type: CUSTOM_SCRIPT_CAPTURE_MESSAGE, keys: ["*"] })?.keys, "*");
  assert.equal(parseCaptureMessage({ type: CUSTOM_SCRIPT_CAPTURE_MESSAGE, keys: ["a", "*"] })?.keys, "*");
});

test("parseCaptureMessage accepts a single key given as a bare string", () => {
  const capture = parseCaptureMessage({ type: CUSTOM_SCRIPT_CAPTURE_MESSAGE, keys: "ArrowLeft" });
  assert.deepEqual([...(capture!.keys as Set<string>)], ["ArrowLeft"]);
});

test("capturesKey never yields Escape, not even to a wildcard capture", () => {
  assert.equal(capturesKey({ keys: "*", pointer: false, wheel: false }, "Escape"), false);
  assert.equal(capturesKey({ keys: new Set(["Escape"]), pointer: false, wheel: false }, "Escape"), false);
  assert.equal(capturesKey({ keys: "*", pointer: false, wheel: false }, "ArrowLeft"), true);
  assert.equal(capturesKey({ keys: new Set(["a"]), pointer: false, wheel: false }, "b"), false);
  assert.equal(capturesKey({ keys: null, pointer: false, wheel: false }, "a"), false);
});

test("applyCustomScriptCaptureMessage only accepts declarations from a registered frame", () => {
  const frame = fakeFrame();
  registerCustomScriptFrame("e1", frame.handle);
  const payload = { type: CUSTOM_SCRIPT_CAPTURE_MESSAGE, keys: ["ArrowLeft"], pointer: false };

  assert.equal(applyCustomScriptCaptureMessage({}, payload), false, "unknown window is ignored");
  assert.equal(customScriptCaptureFor("e1")?.keys, null);

  assert.equal(applyCustomScriptCaptureMessage(frame.contentWindow, payload), true);
  assert.ok((customScriptCaptureFor("e1")?.keys as Set<string>).has("ArrowLeft"));
});

test("a declared key is forwarded to the frame and withheld from the player", () => {
  const frame = fakeFrame();
  registerCustomScriptFrame("e1", frame.handle);
  applyCustomScriptCaptureMessage(frame.contentWindow, { type: CUSTOM_SCRIPT_CAPTURE_MESSAGE, keys: ["ArrowLeft"] });
  setCustomScriptFrameActive("e1", true);

  const { ev, state } = fakeKeyEvent("ArrowLeft");
  assert.equal(handleAnimationKeyboardEvent(ev), true);
  assert.equal(state.prevented, true);
  assert.equal(state.stopped, true);
  assert.equal(frame.posted.length, 1);
  assert.equal(frame.posted[0]?.type, CUSTOM_SCRIPT_INPUT_MESSAGE);
  assert.equal(frame.posted[0]?.kind, "keydown");
  assert.equal(frame.posted[0]?.key, "ArrowLeft");
});

test("an undeclared key stays with the player", () => {
  const frame = fakeFrame();
  registerCustomScriptFrame("e1", frame.handle);
  applyCustomScriptCaptureMessage(frame.contentWindow, { type: CUSTOM_SCRIPT_CAPTURE_MESSAGE, keys: ["ArrowLeft"] });
  setCustomScriptFrameActive("e1", true);

  const { ev, state } = fakeKeyEvent(" ");
  assert.equal(handleAnimationKeyboardEvent(ev), false);
  assert.equal(state.prevented, false);
  assert.equal(frame.posted.length, 0);
});

test("an off-screen effect keeps no claim on its declared keys", () => {
  const frame = fakeFrame();
  registerCustomScriptFrame("e1", frame.handle);
  applyCustomScriptCaptureMessage(frame.contentWindow, { type: CUSTOM_SCRIPT_CAPTURE_MESSAGE, keys: "*" });

  // Never activated: the effect's slice of the timeline hasn't been reached.
  assert.equal(handleAnimationKeyboardEvent(fakeKeyEvent("ArrowRight").ev), false);

  setCustomScriptFrameActive("e1", true);
  assert.equal(handleAnimationKeyboardEvent(fakeKeyEvent("ArrowRight").ev), true);

  // …and once it has faded out again.
  setCustomScriptFrameActive("e1", false);
  assert.equal(handleAnimationKeyboardEvent(fakeKeyEvent("ArrowRight").ev), false);
});

test("releasing keys hands them straight back to the player", () => {
  const frame = fakeFrame();
  registerCustomScriptFrame("e1", frame.handle);
  applyCustomScriptCaptureMessage(frame.contentWindow, { type: CUSTOM_SCRIPT_CAPTURE_MESSAGE, keys: ["a"] });
  setCustomScriptFrameActive("e1", true);
  assert.equal(handleAnimationKeyboardEvent(fakeKeyEvent("a").ev), true);

  applyCustomScriptCaptureMessage(frame.contentWindow, { type: CUSTOM_SCRIPT_CAPTURE_MESSAGE, keys: null });
  assert.equal(handleAnimationKeyboardEvent(fakeKeyEvent("a").ev), false);
});

test("the same event is forwarded once even when both entry points see it", () => {
  const frame = fakeFrame();
  registerCustomScriptFrame("e1", frame.handle);
  applyCustomScriptCaptureMessage(frame.contentWindow, { type: CUSTOM_SCRIPT_CAPTURE_MESSAGE, keys: "*" });
  setCustomScriptFrameActive("e1", true);

  const { ev } = fakeKeyEvent("a");
  assert.equal(handleAnimationKeyboardEvent(ev), true);
  assert.equal(handleAnimationKeyboardEvent(ev), true, "still reported as consumed");
  assert.equal(frame.posted.length, 1, "but not posted twice");
});

test("keys typed into a text field are left alone", () => {
  const frame = fakeFrame();
  registerCustomScriptFrame("e1", frame.handle);
  applyCustomScriptCaptureMessage(frame.contentWindow, { type: CUSTOM_SCRIPT_CAPTURE_MESSAGE, keys: "*" });
  setCustomScriptFrameActive("e1", true);

  const { ev } = fakeKeyEvent("a", { target: { tagName: "INPUT" } });
  assert.equal(handleAnimationKeyboardEvent(ev), false);
  assert.equal(frame.posted.length, 0);
});

test("an unregistered frame stops receiving input", () => {
  const frame = fakeFrame();
  const dispose = registerCustomScriptFrame("e1", frame.handle);
  applyCustomScriptCaptureMessage(frame.contentWindow, { type: CUSTOM_SCRIPT_CAPTURE_MESSAGE, keys: "*" });
  setCustomScriptFrameActive("e1", true);
  dispose();

  assert.equal(handleAnimationKeyboardEvent(fakeKeyEvent("a").ev), false);
  assert.equal(frame.posted.length, 0);
});

test("the topmost of two overlapping frames wins the key", () => {
  const lower = fakeFrame();
  const upper = fakeFrame();
  registerCustomScriptFrame("lower", lower.handle);
  registerCustomScriptFrame("upper", upper.handle);
  for (const [id, frame] of [["lower", lower], ["upper", upper]] as const) {
    applyCustomScriptCaptureMessage(frame.contentWindow, { type: CUSTOM_SCRIPT_CAPTURE_MESSAGE, keys: "*" });
    setCustomScriptFrameActive(id, true);
  }

  handleAnimationKeyboardEvent(fakeKeyEvent("a").ev);
  assert.equal(upper.posted.length, 1);
  assert.equal(lower.posted.length, 0);
});

test("a re-registered frame keeps its declaration", () => {
  // The spec object changes identity during ordinary playback (e.g. the sentence
  // timeline is recomputed once audio metadata arrives), which re-registers every
  // frame without reloading the iframe — so it never re-announces. Losing the
  // declaration here meant the animation silently stopped receiving keys mid-talk.
  const frame = fakeFrame();
  const dispose = registerCustomScriptFrame("e1", frame.handle);
  applyCustomScriptCaptureMessage(frame.contentWindow, { type: CUSTOM_SCRIPT_CAPTURE_MESSAGE, keys: ["a"] });
  dispose();

  registerCustomScriptFrame("e1", frame.handle);
  setCustomScriptFrameActive("e1", true);
  assert.equal(handleAnimationKeyboardEvent(fakeKeyEvent("a").ev), true);
});

test("forgetting captures stops the next page inheriting this page's declaration", () => {
  const frame = fakeFrame();
  const dispose = registerCustomScriptFrame("e1", frame.handle);
  applyCustomScriptCaptureMessage(frame.contentWindow, { type: CUSTOM_SCRIPT_CAPTURE_MESSAGE, keys: "*" });
  dispose();
  forgetCustomScriptCaptures();

  // Same effect id on the next page — a different animation that claims nothing.
  const next = fakeFrame();
  registerCustomScriptFrame("e1", next.handle);
  setCustomScriptFrameActive("e1", true);
  assert.equal(handleAnimationKeyboardEvent(fakeKeyEvent("a").ev), false);
});

test("a declaration reaches every frame of the same effect, not just the announcing one", () => {
  const panel = fakeFrame();
  const fullscreen = fakeFrame();
  registerCustomScriptFrame("e1", panel.handle);
  registerCustomScriptFrame("e1", fullscreen.handle);
  // Only one of the two iframes announces; both run the same code.
  applyCustomScriptCaptureMessage(fullscreen.contentWindow, { type: CUSTOM_SCRIPT_CAPTURE_MESSAGE, keys: ["a"] });
  setCustomScriptFrameActive("e1", true);

  handleAnimationKeyboardEvent(fakeKeyEvent("a").ev);
  assert.equal(panel.posted.length, 1);
  assert.equal(fullscreen.posted.length, 1);
});

test("both copies of one effect (panel + fullscreen) receive the key", () => {
  const panel = fakeFrame();
  const fullscreen = fakeFrame();
  registerCustomScriptFrame("e1", panel.handle);
  registerCustomScriptFrame("e1", fullscreen.handle);
  for (const frame of [panel, fullscreen]) {
    applyCustomScriptCaptureMessage(frame.contentWindow, { type: CUSTOM_SCRIPT_CAPTURE_MESSAGE, keys: "*" });
  }
  setCustomScriptFrameActive("e1", true);

  handleAnimationKeyboardEvent(fakeKeyEvent("a").ev);
  // Delivering to only one of them would let the two copies drift apart.
  assert.equal(panel.posted.length, 1);
  assert.equal(fullscreen.posted.length, 1);
});

test("pointer events inside the frame are forwarded in the frame's own coordinates", () => {
  const frame = fakeFrame({ left: 100, top: 50, width: 200, height: 100 }, { width: 400, height: 200 });
  registerCustomScriptFrame("e1", frame.handle);
  applyCustomScriptCaptureMessage(frame.contentWindow, { type: CUSTOM_SCRIPT_CAPTURE_MESSAGE, pointer: true });
  setCustomScriptFrameActive("e1", true);

  // Centre of the on-screen rect → centre of the (2× larger) content space.
  const { ev, state } = fakePointerEvent("pointerdown", 200, 100);
  assert.equal(handleAnimationPointerEvent(ev), true);
  assert.equal(state.prevented, true);
  assert.equal(state.stopped, true);
  assert.equal(frame.posted[0]?.kind, "pointerdown");
  assert.equal(frame.posted[0]?.x, 200);
  assert.equal(frame.posted[0]?.y, 100);
  assert.equal(frame.posted[0]?.nx, 0.5);
  assert.equal(frame.posted[0]?.ny, 0.5);
});

test("pointer events outside the frame stay with the player", () => {
  const frame = fakeFrame();
  registerCustomScriptFrame("e1", frame.handle);
  applyCustomScriptCaptureMessage(frame.contentWindow, { type: CUSTOM_SCRIPT_CAPTURE_MESSAGE, pointer: true });
  setCustomScriptFrameActive("e1", true);

  const { ev, state } = fakePointerEvent("click", 10, 10);
  assert.equal(handleAnimationPointerEvent(ev), false);
  assert.equal(state.prevented, false);
  assert.equal(frame.posted.length, 0);
});

test("wheel events need their own opt-in", () => {
  const frame = fakeFrame();
  registerCustomScriptFrame("e1", frame.handle);
  applyCustomScriptCaptureMessage(frame.contentWindow, { type: CUSTOM_SCRIPT_CAPTURE_MESSAGE, pointer: true });
  setCustomScriptFrameActive("e1", true);
  assert.equal(handleAnimationPointerEvent(fakePointerEvent("wheel", 200, 100, { deltaY: 12 }).ev), false);

  applyCustomScriptCaptureMessage(frame.contentWindow, {
    type: CUSTOM_SCRIPT_CAPTURE_MESSAGE,
    pointer: true,
    wheel: true,
  });
  assert.equal(handleAnimationPointerEvent(fakePointerEvent("wheel", 200, 100, { deltaY: 12 }).ev), true);
  assert.equal(frame.posted[0]?.deltaY, 12);
});

test("a keyboard-only capture does not swallow mouse events", () => {
  const frame = fakeFrame();
  registerCustomScriptFrame("e1", frame.handle);
  applyCustomScriptCaptureMessage(frame.contentWindow, { type: CUSTOM_SCRIPT_CAPTURE_MESSAGE, keys: "*" });
  setCustomScriptFrameActive("e1", true);

  assert.equal(handleAnimationPointerEvent(fakePointerEvent("click", 200, 100).ev), false);
  assert.equal(frame.posted.length, 0);
});

test("an interaction counts as in progress only while on screen and holding input", () => {
  const frame = fakeFrame();
  registerCustomScriptFrame("e1", frame.handle);
  assert.equal(hasActiveCustomScriptCapture(), false, "registered but nothing declared");

  applyCustomScriptCaptureMessage(frame.contentWindow, { type: CUSTOM_SCRIPT_CAPTURE_MESSAGE, keys: ["a"] });
  assert.equal(hasActiveCustomScriptCapture(), false, "declared but not on screen yet");

  setCustomScriptFrameActive("e1", true);
  assert.equal(hasActiveCustomScriptCapture(), true);

  applyCustomScriptCaptureMessage(frame.contentWindow, { type: CUSTOM_SCRIPT_CAPTURE_MESSAGE, keys: null });
  assert.equal(hasActiveCustomScriptCapture(), false, "released");
});

test("a pointer-only capture also counts as an interaction in progress", () => {
  const frame = fakeFrame();
  registerCustomScriptFrame("e1", frame.handle);
  applyCustomScriptCaptureMessage(frame.contentWindow, { type: CUSTOM_SCRIPT_CAPTURE_MESSAGE, pointer: true });
  setCustomScriptFrameActive("e1", true);
  assert.equal(hasActiveCustomScriptCapture(), true);
});

test("subscribers are notified when an interaction starts and finishes, not on every change", () => {
  const flips: boolean[] = [];
  const unsubscribe = subscribeCustomScriptCapture(() => flips.push(hasActiveCustomScriptCapture()));
  const frame = fakeFrame();
  registerCustomScriptFrame("e1", frame.handle);
  applyCustomScriptCaptureMessage(frame.contentWindow, { type: CUSTOM_SCRIPT_CAPTURE_MESSAGE, keys: ["a"] });
  setCustomScriptFrameActive("e1", true); // starts
  applyCustomScriptCaptureMessage(frame.contentWindow, { type: CUSTOM_SCRIPT_CAPTURE_MESSAGE, keys: ["a", "b"] });
  applyCustomScriptCaptureMessage(frame.contentWindow, { type: CUSTOM_SCRIPT_CAPTURE_MESSAGE, keys: null }); // finishes
  unsubscribe();
  applyCustomScriptCaptureMessage(frame.contentWindow, { type: CUSTOM_SCRIPT_CAPTURE_MESSAGE, keys: ["a"] });

  // Only the two transitions, and nothing after unsubscribing.
  assert.deepEqual(flips, [true, false]);
});

test("an effect leaving the screen ends the interaction, so a stuck animation can't hold the page forever", () => {
  const frame = fakeFrame();
  registerCustomScriptFrame("e1", frame.handle);
  applyCustomScriptCaptureMessage(frame.contentWindow, { type: CUSTOM_SCRIPT_CAPTURE_MESSAGE, keys: "*" });
  setCustomScriptFrameActive("e1", true);
  setCustomScriptFrameActive("e1", false);
  assert.equal(hasActiveCustomScriptCapture(), false);
});

test("toFrameCoordinates maps viewport points into the scaled frame's space", () => {
  const rect = { left: 100, top: 50, width: 200, height: 100 };
  assert.deepEqual(toFrameCoordinates(rect, { width: 400, height: 200 }, 100, 50), { x: 0, y: 0, nx: 0, ny: 0 });
  assert.deepEqual(toFrameCoordinates(rect, { width: 400, height: 200 }, 300, 150), { x: 400, y: 200, nx: 1, ny: 1 });
});

test("toFrameCoordinates degrades to the origin for a zero-sized rect", () => {
  const coords = toFrameCoordinates({ left: 0, top: 0, width: 0, height: 0 }, { width: 100, height: 100 }, 5, 5);
  assert.deepEqual(coords, { x: 0, y: 0, nx: 0, ny: 0 });
});

test("rectContains includes the edges", () => {
  const rect = { left: 10, top: 20, width: 100, height: 50 };
  assert.equal(rectContains(rect, 10, 20), true);
  assert.equal(rectContains(rect, 110, 70), true);
  assert.equal(rectContains(rect, 111, 70), false);
  assert.equal(rectContains(rect, 10, 19), false);
});
