import test from 'node:test';
import assert from 'node:assert/strict';
import { splitScriptIntoSentences } from '../src/services/textSentences';
import { generateRuleBasedFocusEffects } from '../src/services/animationAutoFocus';
import { MAX_SLIDE_ANIMATION_EFFECTS } from '../src/services/pageAnimation';

test('splitScriptIntoSentences splits on CJK/ASCII terminators and strips tone markers', () => {
  const script = '[[興奮]]這是第一句。這是第二句！第三句嗎？最後一句';
  assert.deepEqual(splitScriptIntoSentences(script), [
    '這是第一句。',
    '這是第二句！',
    '第三句嗎？',
    '最後一句',
  ]);
});

test('splitScriptIntoSentences returns [] for empty/whitespace-only input', () => {
  assert.deepEqual(splitScriptIntoSentences(''), []);
  assert.deepEqual(splitScriptIntoSentences('   \n\n  '), []);
});

test('generateRuleBasedFocusEffects produces one highlight-box per sentence with transcript-line triggers', () => {
  const effects = generateRuleBasedFocusEffects(3);
  assert.equal(effects.length, 3);
  effects.forEach((effect, line) => {
    assert.equal(effect.target, 'slide');
    assert.equal(effect.type, 'highlight-box');
    assert.equal(effect.duration, 1.2);
    assert.equal(effect.ease, 'power1.out');
    assert.deepEqual(effect.startTrigger, { type: 'transcript-line', line });
  });
});

test('generateRuleBasedFocusEffects caps at MAX_SLIDE_ANIMATION_EFFECTS and clamps negative counts', () => {
  assert.equal(generateRuleBasedFocusEffects(MAX_SLIDE_ANIMATION_EFFECTS + 10).length, MAX_SLIDE_ANIMATION_EFFECTS);
  assert.equal(generateRuleBasedFocusEffects(-5).length, 0);
  assert.equal(generateRuleBasedFocusEffects(0).length, 0);
});
