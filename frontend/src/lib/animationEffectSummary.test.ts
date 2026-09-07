import test from 'node:test';
import assert from 'node:assert/strict';
import { effectExcerpt, effectSentence, effectSummary, formatClock, formatSeconds } from './animationEffectSummary';
import type { SlideAnimationEffect } from '../types';

const mk = (over: Partial<SlideAnimationEffect>): SlideAnimationEffect =>
  ({ id: 'e', target: 'slide', type: 'fade-in', start: 1.25, duration: 0.8, ease: 'power1.out', ...over }) as SlideAnimationEffect;

test('formatSeconds keeps one decimal only when needed', () => {
  assert.equal(formatSeconds(0), '0s');
  assert.equal(formatSeconds(1.25), '1.3s');
  assert.equal(formatSeconds(4), '4s');
  assert.equal(formatSeconds(Number.NaN), '0s');
});

test('effectSummary joins type, timing, duration and a content excerpt', () => {
  assert.equal(effectSummary(mk({}), 1.25, { typeLabel: '淡入', triggerLabel: null }), '淡入 · 1.3s · 0.8s');
  assert.equal(effectSummary(mk({ type: 'text-callout', text: 'Hello world' } as Partial<SlideAnimationEffect>), 3, { typeLabel: '文字說明', triggerLabel: '第 2 句開始' }), '文字說明 · 第 2 句開始 · 0.8s · Hello world');
});

test('effectExcerpt shortens long content and knows which types carry content', () => {
  assert.equal(effectExcerpt(mk({ type: 'text-callout', text: 'x'.repeat(40) } as Partial<SlideAnimationEffect>)), `${'x'.repeat(24)}…`);
  assert.equal(effectExcerpt(mk({ type: 'step-list', items: ['a', 'b'] } as Partial<SlideAnimationEffect>)), 'a / b');
  assert.equal(effectExcerpt(mk({ type: 'overlay-image', figureId: 'p1-upload-abc' } as Partial<SlideAnimationEffect>)), 'p1-upload-abc');
  assert.equal(effectExcerpt(mk({ type: 'highlight-box' })), null);
});

test('effectSentence names the trigger sentence, else the sentence playing at the start time', () => {
  const timeline = [{ text: '一', start: 0, end: 2 }, { text: '二', start: 2, end: 5 }, { text: '三', start: 5, end: 8 }];
  assert.deepEqual(effectSentence(mk({ startTrigger: { type: 'transcript-line', line: 2 } } as Partial<SlideAnimationEffect>), 0, timeline), { index: 2, text: '三' });
  assert.deepEqual(effectSentence(mk({}), 3.4, timeline), { index: 1, text: '二' });
  assert.deepEqual(effectSentence(mk({}), 2, timeline), { index: 1, text: '二' }, 'a start exactly on the boundary belongs to the sentence that begins there');
  assert.equal(effectSentence(mk({}), 9, timeline), null, 'after the narration');
  assert.equal(effectSentence(mk({}), 1, []), null, 'no narration');
});

test('formatClock renders minutes and seconds', () => {
  assert.equal(formatClock(4), '0:04');
  assert.equal(formatClock(72.5), '1:12.5');
  assert.equal(formatClock(-1), '0:00');
});
