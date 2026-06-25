import test from 'node:test';
import assert from 'node:assert/strict';
import { OVERLAY_EFFECT_TYPES } from '../../lib/animationSpec';
import { EFFECT_PRESETS, imageAspectPaddingPct } from './AnimationEditorTab';

test('every overlay-effect preset (other than custom-script) sets a default exitDuration', () => {
  // custom-script intentionally has no preset here and renders fully visible from the start
  // with no fade, per buildGsapTimeline.ts; it's excluded from this invariant on purpose.
  for (const preset of EFFECT_PRESETS) {
    const applied = preset.apply();
    if (!applied.type || applied.type === 'custom-script' || !OVERLAY_EFFECT_TYPES.includes(applied.type)) continue;
    assert.notEqual(
      applied.exitDuration,
      undefined,
      `preset "${preset.id}" (type "${applied.type}") should default exitDuration so its overlay doesn't stay on screen forever`,
    );
  }
});

test('pause-playback preset specifically sets a default exitDuration', () => {
  const preset = EFFECT_PRESETS.find((p) => p.id === 'pause-playback');
  assert.ok(preset, 'expected a pause-playback preset to exist');
  const applied = preset!.apply();
  assert.equal(applied.type, 'pause-playback');
  assert.notEqual(applied.exitDuration, undefined, 'pause-playback overlay must fade out after the user resumes playback');
});

test('imageAspectPaddingPct matches the focus-box preview container to the real image aspect', () => {
  // 16:9 slide → 56.25% (unchanged from the old hardcoded value).
  assert.equal(imageAspectPaddingPct(1920, 1080), 56.25);
  // 4:3 PDF slide → 75% (the old hardcoded 56.25% would letterbox and misplace the box).
  assert.equal(imageAspectPaddingPct(1024, 768), 75);
  // Portrait A4-ish page → taller than wide.
  assert.equal(imageAspectPaddingPct(1000, 1414), 141.4);
  // Invalid dimensions fall back to 16:9.
  assert.equal(imageAspectPaddingPct(0, 0), 56.25);
  assert.equal(imageAspectPaddingPct(Number.NaN, 100), 56.25);
  assert.equal(imageAspectPaddingPct(100, -5), 56.25);
});

test('realtime-poll preset specifically sets a default exitDuration and no poll selected yet', () => {
  const preset = EFFECT_PRESETS.find((p) => p.id === 'realtime-poll');
  assert.ok(preset, 'expected a realtime-poll preset to exist');
  const applied = preset!.apply();
  assert.equal(applied.type, 'realtime-poll');
  assert.notEqual(applied.exitDuration, undefined, 'realtime-poll overlay must fade out once the poll mode is entered');
  assert.equal(applied.pollId, undefined, 'pollId should be left for the user to pick from this page\'s polls');
});
