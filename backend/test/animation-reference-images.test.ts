import test from 'node:test';
import assert from 'node:assert/strict';

import { usableReferenceImages } from '../src/services/animationCustomScript';
import {
  MAX_CUSTOM_SCRIPT_IMAGE_DATA_URL_LENGTH,
  MAX_CUSTOM_SCRIPT_REFERENCE_IMAGES,
} from '../src/services/pageAnimation';

const png = (payload = 'iVBORw0KGgo') => `data:image/png;base64,${payload}`;

test('inline images of a supported type are passed through', () => {
  const images = [png(), 'data:image/jpeg;base64,/9j/4AAQ', 'data:image/webp;base64,UklGRg'];
  assert.deepEqual(usableReferenceImages(images, MAX_CUSTOM_SCRIPT_REFERENCE_IMAGES), images);
});

test('anything that is not an inline image is dropped', () => {
  // These arrive from the browser and go straight to the model: a remote URL would turn an
  // "attachment" into a fetch of whatever the caller named.
  const rejected = [
    'https://example.com/diagram.png',
    'file:///etc/passwd',
    'data:text/html;base64,PHNjcmlwdD4=',
    'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
    'data:image/png,notbase64',
    'javascript:alert(1)',
    '',
  ];
  assert.deepEqual(usableReferenceImages(rejected, MAX_CUSTOM_SCRIPT_REFERENCE_IMAGES), []);
});

test('an oversized image is dropped rather than forwarded', () => {
  const huge = png('A'.repeat(MAX_CUSTOM_SCRIPT_IMAGE_DATA_URL_LENGTH));
  assert.deepEqual(usableReferenceImages([huge], MAX_CUSTOM_SCRIPT_REFERENCE_IMAGES), []);
});

test('the count is capped, keeping the first images', () => {
  const images = [png('AAAA'), png('BBBB'), png('CCCC'), png('DDDD'), png('EEEE')];
  assert.deepEqual(usableReferenceImages(images, 2), [png('AAAA'), png('BBBB')]);
});

test('no attachments is not an error', () => {
  assert.deepEqual(usableReferenceImages(undefined, MAX_CUSTOM_SCRIPT_REFERENCE_IMAGES), []);
  assert.deepEqual(usableReferenceImages([], MAX_CUSTOM_SCRIPT_REFERENCE_IMAGES), []);
});
