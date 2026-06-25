import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  ANIMATION_EFFECT_TYPES,
  ANIMATION_EASES,
  ANIMATION_SHAPE_KINDS,
} from '../src/services/pageAnimation';

// The frontend's animationSpec.ts keeps SLIDE_ANIMATION_EFFECT_TYPES,
// SLIDE_ANIMATION_EASES and ANIMATION_SHAPE_KINDS that are documented to mirror
// the backend's ANIMATION_EFFECT_TYPES / ANIMATION_EASES / ANIMATION_SHAPE_KINDS.
// They live in separate packages, so nothing stops them drifting and silently
// making the animation editor offer a different set of effects/eases/shapes than
// the renderer and backend validation actually support (this is exactly how the
// shape list once drifted to 4 while the backend, type and renderer had 8). Parse
// the frontend arrays from source and assert the two stay in lockstep.
function readFrontendStringArray(name: string): string[] {
  const srcUrl = new URL('../../frontend/src/lib/animationSpec.ts', import.meta.url);
  const src = fs.readFileSync(srcUrl, 'utf8');
  const block = src.match(new RegExp(`${name}[^=]*=\\s*\\[([\\s\\S]*?)\\]`));
  assert.ok(block, `could not locate ${name} in frontend animationSpec.ts`);
  return [...block![1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]!);
}

test('frontend animation arrays parse to non-trivial sets', () => {
  assert.ok(readFrontendStringArray('SLIDE_ANIMATION_EFFECT_TYPES').length >= 5);
  assert.ok(readFrontendStringArray('SLIDE_ANIMATION_EASES').length >= 3);
  assert.ok(readFrontendStringArray('ANIMATION_SHAPE_KINDS').length >= 4);
});

test('frontend and backend agree on animation effect types', () => {
  assert.deepEqual(
    readFrontendStringArray('SLIDE_ANIMATION_EFFECT_TYPES'),
    [...ANIMATION_EFFECT_TYPES],
  );
});

test('frontend and backend agree on animation eases', () => {
  assert.deepEqual(
    readFrontendStringArray('SLIDE_ANIMATION_EASES'),
    [...ANIMATION_EASES],
  );
});

test('frontend and backend agree on animation shape kinds', () => {
  assert.deepEqual(
    readFrontendStringArray('ANIMATION_SHAPE_KINDS'),
    [...ANIMATION_SHAPE_KINDS],
  );
});
