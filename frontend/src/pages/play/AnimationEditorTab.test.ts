import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
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

test('effects are collapsed summaries and only one editor is expanded at a time', () => {
  const src = fs.readFileSync(path.resolve(path.dirname(new URL(import.meta.url).pathname), 'AnimationEditorTab.tsx'), 'utf8');
  assert.match(src, /const \[expandedEffectId, setExpandedEffectId\] = useState<string \| null>\(null\);/, 'a single expanded id, not a set');
  assert.match(src, /setExpandedEffectId\(\(prev\) => \(prev === effect\.id \? null : effect\.id\)\)/, 'clicking toggles that one and closes the other');
  assert.match(src, /effectSentence\(effect, effectStart, sentenceTimeline\)/, 'the row names the aligned sentence');
  assert.match(src, /formatClock\(effectStart\)/, 'the row shows the start time');
  assert.match(src, /effect\.type === 'overlay-image' && effect\.figureId[\s\S]*?figureImageUrl\(pdfId, effect\.figureId\)/, 'overlay pictures get a thumbnail');
  assert.match(src, /left: `\$\{Math\.max\(0, Math\.min\(100, box\.xPct\)\)\}%`/, 'the miniature shows where the effect is');
  assert.doesNotMatch(src, /\{index \+ 1\}\.<\/span>/, 'no effect number in the row');
  assert.match(src, /\{thumbUrl \? \(\s*\/\/ An inserted picture shows the picture itself/, 'inserted pictures show the picture instead of the miniature');
  assert.doesNotMatch(src, /title=\{`x \$\{Math\.round\(box\.xPct\)\}%/, 'no position tooltip');
  assert.match(src, /hoveredEffectId === effect\.id \?/, 'hover opens a popover');
  assert.match(src, /cropStyleForBox\(box, 16 \/ 9\)/, 'the popover crops the slide region under the marker');
  assert.match(src, /currentPage\.has_cutouts \? \(currentPage\.thumbnail_url \?\? currentPage\.image_url\) : currentPage\.image_url/, 'cut-out pages crop from the uncut thumbnail');
  assert.match(src, /\{isExpanded \? \(\s*<div className="flex flex-wrap items-end gap-2">/, 'the editor body renders only when expanded');
});

test('rows are listed by resolved start time and previews pop up on hover', () => {
  const src = fs.readFileSync(path.resolve(path.dirname(new URL(import.meta.url).pathname), 'AnimationEditorTab.tsx'), 'utf8');
  assert.match(src, /\.sort\(\(a, b\) => a\.effectStart - b\.effectStart \|\| a\.specIndex - b\.specIndex\)/, 'time order, spec order breaks ties');
  assert.doesNotMatch(src, /moveEffect\(/, 'no manual reordering once rows follow time');
  assert.doesNotMatch(src, /title=\{`x \$\{Math\.round\(box\.xPct\)\}%/, 'no position tooltip');
  assert.match(src, /hoveredEffectId === effect\.id \?/, 'hover opens a popover');
  assert.match(src, /cropStyleForBox\(box, 16 \/ 9\)/, 'the popover crops the slide region under the marker');
  assert.match(src, /currentPage\.has_cutouts \? \(currentPage\.thumbnail_url \?\? currentPage\.image_url\) : currentPage\.image_url/, 'cut-out pages crop from the uncut thumbnail');
});
