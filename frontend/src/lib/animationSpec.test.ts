import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_SLIDE_ANIMATION_EFFECTS,
  buildCustomScriptSandboxDoc,
  generateFocusEffectsFromTranscript,
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
