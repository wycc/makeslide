import test from 'node:test';
import assert from 'node:assert/strict';
import { mapAutoFocusResponseToEffects, type AutoFocusAiResponse } from '../src/services/animationAutoFocus';

// The function reads already-validated items, so build plain objects and cast.
function resp(effects: unknown[]): AutoFocusAiResponse {
  return { effects } as unknown as AutoFocusAiResponse;
}
const box = (line: number, extra: Record<string, unknown> = {}) => ({
  line, show: true, type: 'highlight-box', xPct: 10, yPct: 10, widthPct: 20, heightPct: 20, ...extra,
});

test('keeps only show:true entries, sorted by line', () => {
  const out = mapAutoFocusResponseToEffects(resp([box(2), { line: 1, show: false }, box(0)]), 5);
  assert.deepEqual(out.map((e) => e.startTrigger?.line), [0, 2]);
});

test('drops lines outside [0, sentenceLimit)', () => {
  const out = mapAutoFocusResponseToEffects(resp([box(-1), box(5), box(0)]), 2);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.startTrigger?.line, 0);
});

test('dedupes a duplicate line, keeping the first occurrence', () => {
  const out = mapAutoFocusResponseToEffects(
    resp([{ ...box(0), type: 'text-callout', text: 'first' }, box(0)]),
    3,
  );
  assert.equal(out.length, 1);
  assert.equal(out[0]!.type, 'text-callout');
  assert.equal(out[0]!.text, 'first');
});

test('text-callout without text falls back to highlight-box', () => {
  const out = mapAutoFocusResponseToEffects(resp([{ ...box(0), type: 'text-callout' }]), 3);
  assert.equal(out[0]!.type, 'highlight-box');
  assert.equal(out[0]!.text, undefined);
});

test('step-list falls back when items are blank, keeps trimmed items otherwise', () => {
  const empty = mapAutoFocusResponseToEffects(resp([{ ...box(0), type: 'step-list', items: ['  ', ''] }]), 3);
  assert.equal(empty[0]!.type, 'highlight-box');
  const filled = mapAutoFocusResponseToEffects(resp([{ ...box(0), type: 'step-list', items: [' a ', 'b'] }]), 3);
  assert.equal(filled[0]!.type, 'step-list');
  assert.deepEqual(filled[0]!.items, ['a', 'b']);
});

test('pointer effects carry only xPct/yPct (no width/height) plus angle', () => {
  const out = mapAutoFocusResponseToEffects(resp([{ line: 0, show: true, type: 'pointer', xPct: 60, yPct: 40, angle: 270 }]), 3);
  assert.deepEqual(out[0]!.params, { xPct: 60, yPct: 40 });
  assert.equal(out[0]!.angle, 270);
});

test('clamps box position/size into range', () => {
  const out = mapAutoFocusResponseToEffects(resp([{ line: 0, show: true, type: 'highlight-box', xPct: 200, yPct: -5, widthPct: 1, heightPct: 999 }]), 3);
  assert.deepEqual(out[0]!.params, { xPct: 95, yPct: 0, widthPct: 5, heightPct: 100 });
});

test('produces a well-formed effect skeleton and clamps exitDuration', () => {
  const out = mapAutoFocusResponseToEffects(resp([box(2, { exitDuration: 2 })]), 5);
  const e = out[0]!;
  assert.equal(e.target, 'slide');
  assert.equal(e.start, 0);
  assert.equal(e.ease, 'power1.out');
  assert.deepEqual(e.startTrigger, { type: 'transcript-line', line: 2 });
  assert.match(e.id, /^ai-focus-2-/);
  assert.equal(e.exitDuration, 2);

  const clamped = mapAutoFocusResponseToEffects(resp([box(0, { exitDuration: 99999 })]), 5);
  assert.ok(clamped[0]!.exitDuration! >= 0 && clamped[0]!.exitDuration! < 99999);
});
