import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AutoFocusAiResponseSchema,
  mapAutoFocusResponseToEffects,
} from '../src/services/animationAutoFocus';

test('AutoFocusAiResponseSchema accepts out-of-range coordinates instead of rejecting the whole response', () => {
  // Reproduces the real failure: a model (e.g. CGU Air) returned yPct > 100, which used to make
  // zod reject the entire response and fail the auto-focus/animation step after retries.
  const parsed = AutoFocusAiResponseSchema.safeParse({
    effects: [
      { line: 0, show: true, type: 'highlight-box', xPct: 10, yPct: 105, widthPct: 30, heightPct: 200 },
      { line: 1, show: true, type: 'pointer', xPct: -4, yPct: 120, angle: 450 },
    ],
  });
  assert.equal(parsed.success, true);
});

test('out-of-range coordinates are clamped, and angle is normalized into [0,359]', () => {
  const parsed = AutoFocusAiResponseSchema.parse({
    effects: [
      { line: 0, show: true, type: 'highlight-box', xPct: 10, yPct: 105, widthPct: 30, heightPct: 200 },
      { line: 1, show: true, type: 'pointer', xPct: 60, yPct: 120, angle: 450 },
    ],
  });
  const out = mapAutoFocusResponseToEffects(parsed, 5);

  const box = out.find((e) => e.startTrigger?.line === 0)!;
  assert.ok((box.params as { yPct: number }).yPct <= 100, 'yPct should be clamped to <= 100');
  assert.ok((box.params as { heightPct: number }).heightPct <= 100, 'heightPct should be clamped to <= 100');

  const pointer = out.find((e) => e.startTrigger?.line === 1)!;
  assert.ok((pointer.params as { yPct: number }).yPct <= 100);
  assert.equal(pointer.angle, 450 % 360, 'angle should wrap into [0,359]');
});

test('still rejects non-finite numbers (NaN / Infinity) rather than accepting garbage', () => {
  assert.equal(
    AutoFocusAiResponseSchema.safeParse({
      effects: [{ line: 0, show: true, type: 'highlight-box', yPct: Number.POSITIVE_INFINITY }],
    }).success,
    false,
  );
});
