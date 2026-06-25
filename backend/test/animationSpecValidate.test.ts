import test from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultAnimationSpec,
  validateAnimationSpec,
  renderTypeForSpec,
  parseStoredAnimationSpec,
} from '../src/services/pageAnimation';

const fadeIn = { id: 'e1', target: 'slide', type: 'fade-in', start: 0, duration: 1, ease: 'none' };

test('defaultAnimationSpec is a disabled v1 spec with no effects', () => {
  assert.deepEqual(defaultAnimationSpec(), { version: 1, enabled: false, effects: [] });
});

test('validateAnimationSpec accepts a minimal valid spec', () => {
  const result = validateAnimationSpec({ version: 1, enabled: false, effects: [] });
  assert.equal(result.ok, true);
  assert.ok(result.ok && result.spec.version === 1);
  assert.ok(result.ok && result.spec.effects.length === 0);
});

test('validateAnimationSpec rejects non-objects and wrong version', () => {
  assert.equal(validateAnimationSpec(null).ok, false);
  assert.equal(validateAnimationSpec('nope').ok, false);
  assert.equal(validateAnimationSpec({ version: 2, enabled: false, effects: [] }).ok, false);
});

test('validateAnimationSpec rejects an unknown effect type with a path in the message', () => {
  const result = validateAnimationSpec({
    version: 1,
    enabled: true,
    effects: [{ ...fadeIn, type: 'not-a-real-effect' }],
  });
  assert.equal(result.ok, false);
  assert.ok(!result.ok && /effects\.0\.type/.test(result.message));
});

test('validateAnimationSpec keeps a valid effect and its allowed typed fields', () => {
  const result = validateAnimationSpec({
    version: 1,
    enabled: true,
    effects: [{ ...fadeIn, id: 'e3', type: 'text-callout', text: 'Hi' }],
  });
  assert.ok(result.ok);
  if (result.ok) {
    assert.equal(result.spec.effects.length, 1);
    assert.equal(result.spec.effects[0]!.text, 'Hi');
    assert.equal(result.spec.effects[0]!.type, 'text-callout');
  }
});

test('validateAnimationSpec filters params to the effect type whitelist', () => {
  const result = validateAnimationSpec({
    version: 1,
    enabled: true,
    // distancePct is not allowed for zoom-in; toScale as a string is dropped; bad is non-finite
    effects: [{ ...fadeIn, type: 'zoom-in', params: { fromScale: 1.5, toScale: 2, distancePct: 10, bad: NaN } }],
  });
  assert.ok(result.ok);
  if (result.ok) {
    assert.deepEqual(result.spec.effects[0]!.params, { fromScale: 1.5, toScale: 2 });
  }
});

test('validateAnimationSpec drops params entirely for an effect type with no allowed params', () => {
  const result = validateAnimationSpec({
    version: 1,
    enabled: true,
    effects: [{ ...fadeIn, params: { fromScale: 2 } }],
  });
  assert.ok(result.ok);
  if (result.ok) {
    assert.equal('params' in result.spec.effects[0]!, false);
  }
});

test('validateAnimationSpec omits an empty hints object but keeps a non-empty one', () => {
  const empty = validateAnimationSpec({ version: 1, enabled: false, effects: [], hints: {} });
  assert.ok(empty.ok);
  if (empty.ok) assert.equal('hints' in empty.spec, false);

  const withHints = validateAnimationSpec({ version: 1, enabled: false, effects: [], hints: { '0': 'note' } });
  assert.ok(withHints.ok);
  if (withHints.ok) assert.deepEqual(withHints.spec.hints, { '0': 'note' });
});

test('renderTypeForSpec maps the enabled flag to the render type', () => {
  assert.equal(renderTypeForSpec({ version: 1, enabled: true, effects: [] }), 'gsap-image');
  assert.equal(renderTypeForSpec({ version: 1, enabled: false, effects: [] }), 'static-image');
});

test('parseStoredAnimationSpec round-trips valid JSON', () => {
  const raw = JSON.stringify({ version: 1, enabled: true, effects: [fadeIn] });
  const spec = parseStoredAnimationSpec(raw);
  assert.equal(spec.enabled, true);
  assert.equal(spec.effects.length, 1);
  assert.equal(spec.effects[0]!.id, 'e1');
});

test('parseStoredAnimationSpec falls back to default on corrupt JSON or invalid spec', () => {
  assert.deepEqual(parseStoredAnimationSpec('{ not json'), defaultAnimationSpec());
  assert.deepEqual(parseStoredAnimationSpec('{"version":2}'), defaultAnimationSpec());
});
