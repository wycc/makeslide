import test from 'node:test';
import assert from 'node:assert/strict';
import { OVERLAY_EFFECT_TYPES } from '../../lib/animationSpec';
import { EFFECT_PRESETS } from './AnimationEditorTab';

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
