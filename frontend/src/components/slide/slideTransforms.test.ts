import test from 'node:test';
import assert from 'node:assert/strict';
import { panDistance, transformFromTo } from './slideTransforms';
import type { SlideAnimationEffect, SlideAnimationEffectType } from '../../types';

function eff(type: SlideAnimationEffectType, params?: Record<string, number>): SlideAnimationEffect {
  return { id: 'e', target: 'slide', type, start: 0, duration: 1, ease: 'none', ...(params ? { params } : {}) };
}

test('panDistance defaults to 3 when distancePct is missing or invalid', () => {
  assert.equal(panDistance(eff('pan-left')), 3);
  assert.equal(panDistance(eff('pan-left', { distancePct: Number.NaN })), 3);
  assert.equal(panDistance(eff('pan-left', { distancePct: Number.POSITIVE_INFINITY })), 3);
});

test('panDistance uses a finite distancePct when provided', () => {
  assert.equal(panDistance(eff('pan-left', { distancePct: 7 })), 7);
  assert.equal(panDistance(eff('pan-left', { distancePct: 0 })), 0);
});

test('transformFromTo handles fade-in', () => {
  assert.deepEqual(transformFromTo(eff('fade-in')), { from: { autoAlpha: 0 }, to: { autoAlpha: 1 } });
});

test('transformFromTo uses zoom defaults and honors explicit scales', () => {
  assert.deepEqual(transformFromTo(eff('zoom-in')), { from: { scale: 1 }, to: { scale: 1.08 } });
  assert.deepEqual(transformFromTo(eff('zoom-out')), { from: { scale: 1.08 }, to: { scale: 1 } });
  assert.deepEqual(
    transformFromTo(eff('zoom-in', { fromScale: 0.5, toScale: 2 })),
    { from: { scale: 0.5 }, to: { scale: 2 } },
  );
});

test('transformFromTo maps each pan direction to the correct axis and sign', () => {
  assert.deepEqual(transformFromTo(eff('pan-left', { distancePct: 5 })), {
    from: { xPercent: 5 },
    to: { xPercent: -5 },
  });
  assert.deepEqual(transformFromTo(eff('pan-right', { distancePct: 5 })), {
    from: { xPercent: -5 },
    to: { xPercent: 5 },
  });
  assert.deepEqual(transformFromTo(eff('pan-up', { distancePct: 5 })), {
    from: { yPercent: 5 },
    to: { yPercent: -5 },
  });
  assert.deepEqual(transformFromTo(eff('pan-down', { distancePct: 5 })), {
    from: { yPercent: -5 },
    to: { yPercent: 5 },
  });
});

test('transformFromTo returns null for overlay (non-transform) effect types', () => {
  assert.equal(transformFromTo(eff('text-callout')), null);
  assert.equal(transformFromTo(eff('pointer')), null);
  assert.equal(transformFromTo(eff('highlight-box')), null);
});
