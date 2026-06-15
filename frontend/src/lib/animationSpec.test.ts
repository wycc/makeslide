import test from "node:test";
import assert from "node:assert/strict";
import {
  ANIMATION_SHAPE_KINDS,
  DEFAULT_SHAPE_KIND,
  MAX_CUSTOM_SCRIPT_CONVERSATION_MESSAGES,
  MAX_CUSTOM_SCRIPT_CONVERSATION_MESSAGE_LENGTH,
  MAX_FORMULA_LENGTH,
  MAX_OVERLAY_IMAGE_FIGURE_ID_LENGTH,
  MAX_SLIDE_ANIMATION_EFFECTS,
  MAX_STEP_LIST_ITEMS,
  MAX_STEP_LIST_ITEM_LENGTH,
  OVERLAY_EFFECT_TYPES,
  SLIDE_ANIMATION_EFFECT_TYPES,
  animationTimelineDurationSeconds,
  appendConversationMessages,
  buildCustomScriptSandboxDoc,
  cloneAnimationSpec,
  customScriptDurationSeconds,
  generateFocusEffectsFromTranscript,
  getFocusEffectParams,
  getShapeKind,
  resolveAnimationSpec,
  resolveStartTriggerSeconds,
} from "./animationSpec";

test("generateFocusEffectsFromTranscript creates one highlight-box effect per sentence", () => {
  const effects = generateFocusEffectsFromTranscript(3);
  assert.equal(effects.length, 3);
  effects.forEach((effect, idx) => {
    assert.equal(effect.type, "highlight-box");
    assert.equal(effect.target, "slide");
    assert.deepEqual(effect.startTrigger, { type: "transcript-line", line: idx });
  });
  const ids = new Set(effects.map((e) => e.id));
  assert.equal(ids.size, 3);
});

test("generateFocusEffectsFromTranscript caps at MAX_SLIDE_ANIMATION_EFFECTS", () => {
  const effects = generateFocusEffectsFromTranscript(MAX_SLIDE_ANIMATION_EFFECTS + 10);
  assert.equal(effects.length, MAX_SLIDE_ANIMATION_EFFECTS);
});

test("generateFocusEffectsFromTranscript returns empty array for no sentences", () => {
  assert.deepEqual(generateFocusEffectsFromTranscript(0), []);
});

test("buildCustomScriptSandboxDoc embeds the code as base64 and defines #root", () => {
  const code = "window.renderAnimation = function (root, api) { api.onFrame(function () {}); };";
  const html = buildCustomScriptSandboxDoc(code, 10);
  assert.match(html, /<div id="root"><\/div>/);
  assert.match(html, /window\.renderAnimation/);

  // The code is embedded as a base64 literal, never as raw source (avoids
  // </script> / quote-escaping issues entirely).
  assert.equal(html.includes(code), false);
  const base64 = Buffer.from(code, "utf8").toString("base64");
  assert.ok(html.includes(base64));
});

test("buildCustomScriptSandboxDoc embeds api.duration from the durationSeconds argument", () => {
  const html = buildCustomScriptSandboxDoc("window.renderAnimation = function () {};", 7.5);
  assert.match(html, /duration:\s*7\.5/);
});

test("buildCustomScriptSandboxDoc falls back to a safe default duration for invalid input", () => {
  assert.match(buildCustomScriptSandboxDoc("", 0), /duration:\s*1\b/);
  assert.match(buildCustomScriptSandboxDoc("", -5), /duration:\s*1\b/);
  assert.match(buildCustomScriptSandboxDoc("", Number.NaN), /duration:\s*1\b/);
});

test("buildCustomScriptSandboxDoc has no unescaped </script> even for adversarial code", () => {
  const code = '</script><script>alert(1)</script>" \' `';
  const html = buildCustomScriptSandboxDoc(code, 10);
  // Only the two trusted <script> tags (Manim helper + wrapper) should remain.
  assert.equal((html.match(/<script>/g) ?? []).length, 2);
  assert.equal((html.match(/<\/script>/g) ?? []).length, 2);
});

test("buildCustomScriptSandboxDoc injects the window.Manim helper library", () => {
  const html = buildCustomScriptSandboxDoc("window.renderAnimation = function () {};", 10);
  assert.match(html, /window\.Manim\s*=/);
  assert.match(html, /smooth:/);
  assert.match(html, /colors:/);
  assert.match(html, /shapes:/);
  assert.match(html, /animate:/);
});

test("buildCustomScriptSandboxDoc handles non-Latin1 (multi-byte) code", () => {
  const code = "// 旋轉的圓形\nwindow.renderAnimation = function (root, api) {};";
  const html = buildCustomScriptSandboxDoc(code, 10);
  const base64 = Buffer.from(code, "utf8").toString("base64");
  assert.ok(html.includes(base64));
});

test("buildCustomScriptSandboxDoc handles empty code without throwing", () => {
  const html = buildCustomScriptSandboxDoc("", 10);
  assert.match(html, /<div id="root"><\/div>/);
});

test("buildCustomScriptSandboxDoc reports missing renderAnimation for non-empty incompatible code", () => {
  const html = buildCustomScriptSandboxDoc("var x = 1;", 10);
  assert.match(html, /generated code did not define window\.renderAnimation/);
});

test("customScriptDurationSeconds sums duration and exitDuration, defaulting exitDuration to 0", () => {
  const base = { id: "e1", target: "slide" as const, type: "custom-script" as const, ease: "none" as const, start: 0 };
  assert.equal(customScriptDurationSeconds({ ...base, duration: 1.5 }), 1.5);
  assert.equal(customScriptDurationSeconds({ ...base, duration: 1.5, exitDuration: 8 }), 9.5);
});

test("customScriptDurationSeconds falls back to 1 for a zero or negative total", () => {
  const base = { id: "e1", target: "slide" as const, type: "custom-script" as const, ease: "none" as const, start: 0 };
  assert.equal(customScriptDurationSeconds({ ...base, duration: 0 }), 1);
  assert.equal(customScriptDurationSeconds({ ...base, duration: -2 }), 1);
});

test("animationTimelineDurationSeconds returns 0 for a disabled or null spec", () => {
  const effect = {
    id: "e1", target: "slide" as const, type: "fade-in" as const, ease: "none" as const, start: 1, duration: 2,
  };
  assert.equal(animationTimelineDurationSeconds(null), 0);
  assert.equal(animationTimelineDurationSeconds({ version: 1, enabled: false, effects: [effect] }), 0);
});

test("animationTimelineDurationSeconds returns the latest effect end time, including exitDuration", () => {
  const spec = {
    version: 1 as const,
    enabled: true,
    effects: [
      { id: "e1", target: "slide" as const, type: "fade-in" as const, ease: "none" as const, start: 0, duration: 2 },
      {
        id: "e2", target: "slide" as const, type: "highlight-box" as const, ease: "none" as const,
        start: 3, duration: 1, exitDuration: 4,
      },
    ],
  };
  // e1 ends at 0+2=2, e2 ends at 3+1+4=8 → max is 8
  assert.equal(animationTimelineDurationSeconds(spec), 8);
});

test("animationTimelineDurationSeconds ignores exitDuration when not set", () => {
  const spec = {
    version: 1 as const,
    enabled: true,
    effects: [
      { id: "e1", target: "slide" as const, type: "zoom-in" as const, ease: "none" as const, start: 5, duration: 3 },
    ],
  };
  assert.equal(animationTimelineDurationSeconds(spec), 8);
});

test("cloneAnimationSpec preserves custom-script code and prompt without sharing nested objects", () => {
  const spec = {
    version: 1 as const,
    enabled: true,
    effects: [
      {
        id: "effect-1",
        target: "slide" as const,
        type: "custom-script" as const,
        start: 0,
        duration: 2,
        ease: "power1.out" as const,
        params: { xPct: 10, yPct: 20 },
        code: "window.renderAnimation = function (root, api) { api.onFrame(function () {}); };",
        prompt: "draw dots",
      },
    ],
  };
  const cloned = cloneAnimationSpec(spec);
  const clonedEffect = cloned.effects[0];
  const originalEffect = spec.effects[0];
  assert.ok(clonedEffect);
  assert.ok(originalEffect);
  assert.notEqual(clonedEffect, originalEffect);
  assert.notEqual(clonedEffect.params, originalEffect.params);
  assert.equal(clonedEffect.type, "custom-script");
  assert.equal(clonedEffect.prompt, "draw dots");
  assert.match(clonedEffect.code ?? "", /renderAnimation/);
});

test("cloneAnimationSpec deep-clones a custom-script effect's conversation", () => {
  const spec = {
    version: 1 as const,
    enabled: true,
    effects: [
      {
        id: "effect-1",
        target: "slide" as const,
        type: "custom-script" as const,
        start: 0,
        duration: 2,
        ease: "power1.out" as const,
        conversation: [
          { role: "user" as const, content: "畫一個圓形" },
          { role: "assistant" as const, content: "已產生動畫程式碼" },
        ],
      },
    ],
  };
  const cloned = cloneAnimationSpec(spec);
  const clonedEffect = cloned.effects[0];
  const originalEffect = spec.effects[0];
  assert.ok(clonedEffect);
  assert.ok(originalEffect);
  assert.deepEqual(clonedEffect.conversation, originalEffect.conversation);
  assert.notEqual(clonedEffect.conversation, originalEffect.conversation);
  assert.notEqual(clonedEffect.conversation?.[0], originalEffect.conversation?.[0]);
});

test("cloneAnimationSpec leaves conversation undefined when the original effect has none", () => {
  const spec = {
    version: 1 as const,
    enabled: true,
    effects: [
      { id: "effect-1", target: "slide" as const, type: "custom-script" as const, start: 0, duration: 2, ease: "none" as const },
    ],
  };
  const cloned = cloneAnimationSpec(spec);
  assert.equal(cloned.effects[0]?.conversation, undefined);
});

test("appendConversationMessages appends messages and truncates long content", () => {
  const longContent = "x".repeat(MAX_CUSTOM_SCRIPT_CONVERSATION_MESSAGE_LENGTH + 50);
  const result = appendConversationMessages(undefined, { role: "user", content: longContent });
  assert.equal(result.length, 1);
  assert.equal(result[0]?.content.length, MAX_CUSTOM_SCRIPT_CONVERSATION_MESSAGE_LENGTH);
});

test("appendConversationMessages preserves existing messages and appends new ones in order", () => {
  const existing = [{ role: "user" as const, content: "第一句" }];
  const result = appendConversationMessages(existing, { role: "assistant", content: "回覆" });
  assert.deepEqual(result, [
    { role: "user", content: "第一句" },
    { role: "assistant", content: "回覆" },
  ]);
  // does not mutate the original array
  assert.equal(existing.length, 1);
});

test("appendConversationMessages caps total length, dropping the oldest messages first", () => {
  const existing = Array.from({ length: MAX_CUSTOM_SCRIPT_CONVERSATION_MESSAGES }, (_, i) => ({
    role: "user" as const,
    content: `msg-${i}`,
  }));
  const result = appendConversationMessages(existing, { role: "assistant", content: "new" });
  assert.equal(result.length, MAX_CUSTOM_SCRIPT_CONVERSATION_MESSAGES);
  assert.equal(result[0]?.content, "msg-1");
  assert.equal(result[result.length - 1]?.content, "new");
});

test("resolveStartTriggerSeconds applies offset and clamps to zero", () => {
  const timeline = [{ text: "a", start: 1, end: 2 }];
  assert.equal(resolveStartTriggerSeconds({ type: "transcript-line", line: 0, offsetSeconds: 0.4 }, timeline), 0.6);
  assert.equal(resolveStartTriggerSeconds({ type: "transcript-line", line: 0, offsetSeconds: 5 }, timeline), 0);
  assert.equal(resolveStartTriggerSeconds({ type: "transcript-line", line: 3 }, timeline), undefined);
});

test("resolveAnimationSpec keeps original reference when no startTrigger is present", () => {
  const spec = {
    version: 1 as const,
    enabled: true,
    effects: [{ id: "e1", target: "slide" as const, type: "custom-script" as const, start: 4, duration: 2, ease: "none" as const }],
  };
  assert.equal(resolveAnimationSpec(spec, []), spec);
});

test("getFocusEffectParams defaults custom-script to fill the whole slide ((0,0) ~ (100,100))", () => {
  const effect = {
    id: "e1", target: "slide" as const, type: "custom-script" as const, ease: "none" as const, start: 0, duration: 1,
  };
  assert.deepEqual(getFocusEffectParams(effect), { xPct: 0, yPct: 0, widthPct: 100, heightPct: 100 });
});

test("getFocusEffectParams defaults highlight-box/spotlight/text-callout to the 30/30/40/40 focus box", () => {
  const effect = {
    id: "e1", target: "slide" as const, type: "highlight-box" as const, ease: "none" as const, start: 0, duration: 1,
  };
  assert.deepEqual(getFocusEffectParams(effect), { xPct: 30, yPct: 30, widthPct: 40, heightPct: 40 });
});

test("getFocusEffectParams respects explicit params even for custom-script", () => {
  const effect = {
    id: "e1", target: "slide" as const, type: "custom-script" as const, ease: "none" as const, start: 0, duration: 1,
    params: { xPct: 10, widthPct: 50 },
  };
  assert.deepEqual(getFocusEffectParams(effect), { xPct: 10, yPct: 0, widthPct: 50, heightPct: 100 });
});

test("resolveAnimationSpec resolves custom-script transcript startTrigger", () => {
  const spec = {
    version: 1 as const,
    enabled: true,
    effects: [
      {
        id: "e1",
        target: "slide" as const,
        type: "custom-script" as const,
        start: 4,
        duration: 2,
        ease: "none" as const,
        startTrigger: { type: "transcript-line" as const, line: 1, offsetSeconds: 0.5 },
      },
    ],
  };
  const resolved = resolveAnimationSpec(spec, [
    { text: "a", start: 0, end: 1 },
    { text: "b", start: 3, end: 4 },
  ]);
  assert.notEqual(resolved, spec);
  assert.ok(resolved);
  const resolvedEffect = resolved.effects[0];
  assert.ok(resolvedEffect);
  assert.equal(resolvedEffect.start, 2.5);
});

test("SLIDE_ANIMATION_EFFECT_TYPES and OVERLAY_EFFECT_TYPES include 'shape'", () => {
  assert.ok(SLIDE_ANIMATION_EFFECT_TYPES.includes("shape"));
  assert.ok(OVERLAY_EFFECT_TYPES.includes("shape"));
});

test("getFocusEffectParams defaults shape to the 30/30/40/40 focus box", () => {
  const effect = {
    id: "e1", target: "slide" as const, type: "shape" as const, ease: "none" as const, start: 0, duration: 1,
  };
  assert.deepEqual(getFocusEffectParams(effect), { xPct: 30, yPct: 30, widthPct: 40, heightPct: 40 });
});

test("getShapeKind defaults to 'circle' when unset, and reads the effect's shape otherwise", () => {
  const base = { id: "e1", target: "slide" as const, type: "shape" as const, ease: "none" as const, start: 0, duration: 1 };
  assert.equal(getShapeKind(base), DEFAULT_SHAPE_KIND);
  assert.equal(DEFAULT_SHAPE_KIND, "circle");
  for (const kind of ANIMATION_SHAPE_KINDS) {
    assert.equal(getShapeKind({ ...base, shape: kind }), kind);
  }
});

test("SLIDE_ANIMATION_EFFECT_TYPES and OVERLAY_EFFECT_TYPES include 'step-list'", () => {
  assert.ok(SLIDE_ANIMATION_EFFECT_TYPES.includes("step-list"));
  assert.ok(OVERLAY_EFFECT_TYPES.includes("step-list"));
});

test("getFocusEffectParams defaults step-list to the 30/30/40/40 focus box", () => {
  const effect = {
    id: "e1", target: "slide" as const, type: "step-list" as const, ease: "none" as const, start: 0, duration: 1,
  };
  assert.deepEqual(getFocusEffectParams(effect), { xPct: 30, yPct: 30, widthPct: 40, heightPct: 40 });
});

test("MAX_STEP_LIST_ITEMS and MAX_STEP_LIST_ITEM_LENGTH match the backend limits", () => {
  assert.equal(MAX_STEP_LIST_ITEMS, 6);
  assert.equal(MAX_STEP_LIST_ITEM_LENGTH, 60);
});

test("SLIDE_ANIMATION_EFFECT_TYPES and OVERLAY_EFFECT_TYPES include 'overlay-image'", () => {
  assert.ok(SLIDE_ANIMATION_EFFECT_TYPES.includes("overlay-image"));
  assert.ok(OVERLAY_EFFECT_TYPES.includes("overlay-image"));
});

test("getFocusEffectParams defaults overlay-image to the 30/30/40/40 focus box", () => {
  const effect = {
    id: "e1", target: "slide" as const, type: "overlay-image" as const, ease: "none" as const, start: 0, duration: 1,
  };
  assert.deepEqual(getFocusEffectParams(effect), { xPct: 30, yPct: 30, widthPct: 40, heightPct: 40 });
});

test("MAX_OVERLAY_IMAGE_FIGURE_ID_LENGTH matches the backend limit", () => {
  assert.equal(MAX_OVERLAY_IMAGE_FIGURE_ID_LENGTH, 200);
});

test("SLIDE_ANIMATION_EFFECT_TYPES and OVERLAY_EFFECT_TYPES include 'formula'", () => {
  assert.ok(SLIDE_ANIMATION_EFFECT_TYPES.includes("formula"));
  assert.ok(OVERLAY_EFFECT_TYPES.includes("formula"));
});

test("getFocusEffectParams defaults formula to the 30/30/40/40 focus box", () => {
  const effect = {
    id: "e1", target: "slide" as const, type: "formula" as const, ease: "none" as const, start: 0, duration: 1,
  };
  assert.deepEqual(getFocusEffectParams(effect), { xPct: 30, yPct: 30, widthPct: 40, heightPct: 40 });
});

test("MAX_FORMULA_LENGTH matches the backend limit", () => {
  assert.equal(MAX_FORMULA_LENGTH, 200);
});
