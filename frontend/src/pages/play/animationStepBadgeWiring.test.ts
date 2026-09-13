import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { animationStepPosition, animationStepTimes } from '../../lib/animationSteps';
import { zhTW } from '../../locales/zh-TW';
import { en } from '../../locales/en';
import type { SlideAnimationSpec } from '../../types';

/**
 * The "Animation 2/5" badge on a page that has animation.
 *
 * Fullscreen has had one since the presenter-remote stepping went in; the normal view had no way
 * to see how many steps a page builds in or which one it was on. The badge is now in both, and
 * what matters is that it is the *same* count: the fullscreen badge, the arrow keys and this badge
 * all read `animationStepTimes` / `animationStepPosition`, so a page cannot report "3 steps" in one
 * view and "4" in the other, nor count a step the arrows refuse to stop at.
 */
const here = path.dirname(new URL(import.meta.url).pathname);
const read = (rel: string) => fs.readFileSync(path.resolve(here, rel), 'utf8');

function spec(effects: Array<{ start: number; type?: string }>, enabled = true): SlideAnimationSpec {
  return {
    version: 1,
    enabled,
    effects: effects.map((e, i) => ({
      id: `e${i}`,
      target: 'slide',
      type: e.type ?? 'fade-in',
      start: e.start,
      duration: 1,
      ease: 'none',
    })),
  } as unknown as SlideAnimationSpec;
}

test('the badge counts what the arrow keys actually stop at', () => {
  // Effects that start together are one step (one press reveals them both), and pause-playback is
  // not a step — stepping never stops there. Counting raw effects would tell the presenter there
  // are five things to press through when there are three.
  const steps = animationStepTimes(spec([
    { start: 0 },
    { start: 0.05 },
    { start: 3 },
    { start: 3, type: 'pause-playback' },
    { start: 7 },
  ]));
  assert.deepEqual(steps, [0, 3, 7]);
  assert.deepEqual(animationStepPosition(steps, 0), { current: 1, total: 3 });
  assert.deepEqual(animationStepPosition(steps, 4), { current: 2, total: 3 });
  assert.deepEqual(animationStepPosition(steps, 99), { current: 3, total: 3 });
});

test('a page with no animation, or with it switched off, gets no badge', () => {
  assert.deepEqual(animationStepTimes(null), []);
  assert.deepEqual(animationStepTimes(spec([])), []);
  // Disabled animation plays nothing, so a badge counting its effects would describe a page the
  // viewer is not looking at.
  assert.deepEqual(animationStepTimes(spec([{ start: 0 }, { start: 2 }], false)), []);
});

test('both views derive the badge from the shared helper, covering spec and pptx-built pages', () => {
  for (const file of ['./PlayPageSlidePanel.tsx', './PlayPageFullscreen.tsx']) {
    const src = read(file);
    assert.match(
      src,
      /import \{ slideStepBadgePosition \} from '\.\.\/\.\.\/lib\/animationSteps'/,
      `${file}: one helper answers for both kinds of stepping`,
    );
    // Both numbers must be passed in, or a pptx-built page (no spec) reports nothing again.
    assert.match(
      src,
      /slideStepBadgePosition\(\{ spec: currentAnimationSpec, currentTime, stepCount, currentPageStep \}\)/,
      `${file}: the build steps are part of the question`,
    );
    // The tooltip has to follow the kind: the playhead moves one, ↑/↓ move the other.
    assert.match(src, /play\.slidePanel\.buildStepHint/, `${file}: pptx builds get their own hint`);
  }
  const panel = read('./PlayPageSlidePanel.tsx');
  assert.match(panel, /\{animationStepBadge \? \(/, 'no stepping → no badge');
  assert.match(panel, /\{animationStepBadge\.text\}<\/span>/);
  const fullscreen = read('./PlayPageFullscreen.tsx');
  assert.match(fullscreen, /title=\{animationStepBadgeHint\}/, 'fullscreen stopped hard-coding the spec hint');
});

test('both locales carry the badge strings, with the placeholders the panel fills in', () => {
  for (const locale of [zhTW, en]) {
    const badge = locale['play.slidePanel.animationStepBadge'];
    const hint = locale['play.slidePanel.animationStepHint'];
    const buildHint = locale['play.slidePanel.buildStepHint'];
    assert.equal(typeof badge, 'string');
    assert.equal(typeof hint, 'string');
    // interpolateTemplate fills these by name; a renamed placeholder would ship the literal text.
    assert.match(badge, /\{current\}/);
    assert.match(badge, /\{total\}/);
    assert.match(hint, /\{total\}/);
    assert.equal(typeof buildHint, 'string');
    assert.match(buildHint, /\{total\}/);
    assert.match(buildHint, /\{current\}/);
  }
});
