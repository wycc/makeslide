import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_SLIDE_ANIMATION_EFFECTS,
  buildCustomScriptSandboxDoc,
  cloneAnimationSpec,
  generateFocusEffectsFromTranscript,
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
  const html = buildCustomScriptSandboxDoc(code);
  assert.match(html, /<div id="root"><\/div>/);
  assert.match(html, /window\.renderAnimation/);

  // The code is embedded as a base64 literal, never as raw source (avoids
  // </script> / quote-escaping issues entirely).
  assert.equal(html.includes(code), false);
  const base64 = Buffer.from(code, "utf8").toString("base64");
  assert.ok(html.includes(base64));
});

test("buildCustomScriptSandboxDoc has no unescaped </script> even for adversarial code", () => {
  const code = '</script><script>alert(1)</script>" \' `';
  const html = buildCustomScriptSandboxDoc(code);
  // Only the two trusted <script> tags from the wrapper itself should remain.
  assert.equal((html.match(/<script>/g) ?? []).length, 1);
  assert.equal((html.match(/<\/script>/g) ?? []).length, 1);
});

test("buildCustomScriptSandboxDoc handles non-Latin1 (multi-byte) code", () => {
  const code = "// 旋轉的圓形\nwindow.renderAnimation = function (root, api) {};";
  const html = buildCustomScriptSandboxDoc(code);
  const base64 = Buffer.from(code, "utf8").toString("base64");
  assert.ok(html.includes(base64));
});

test("buildCustomScriptSandboxDoc handles empty code without throwing", () => {
  const html = buildCustomScriptSandboxDoc("");
  assert.match(html, /<div id="root"><\/div>/);
});

test("buildCustomScriptSandboxDoc reports missing renderAnimation for non-empty incompatible code", () => {
  const html = buildCustomScriptSandboxDoc("var x = 1;");
  assert.match(html, /generated code did not define window\.renderAnimation/);
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
