import test from "node:test";
import assert from "node:assert/strict";

import { REFERENCE_IMAGE_MAX_EDGE, isSupportedReferenceImage, scaledImageSize } from "./referenceImage";

test("scaledImageSize leaves an already-small image alone", () => {
  assert.deepEqual(scaledImageSize(800, 600), { width: 800, height: 600 });
  assert.deepEqual(scaledImageSize(REFERENCE_IMAGE_MAX_EDGE, 400), { width: REFERENCE_IMAGE_MAX_EDGE, height: 400 });
});

test("scaledImageSize fits the longest edge while keeping the aspect ratio", () => {
  const landscape = scaledImageSize(3840, 2160);
  assert.equal(landscape.width, REFERENCE_IMAGE_MAX_EDGE);
  assert.equal(landscape.height, Math.round((2160 / 3840) * REFERENCE_IMAGE_MAX_EDGE));

  const portrait = scaledImageSize(1000, 4000);
  assert.equal(portrait.height, REFERENCE_IMAGE_MAX_EDGE);
  assert.equal(portrait.width, Math.round((1000 / 4000) * REFERENCE_IMAGE_MAX_EDGE));
});

test("scaledImageSize never scales an extreme aspect ratio down to zero", () => {
  // A wide, short banner would otherwise round to height 0 and draw a blank canvas.
  const banner = scaledImageSize(8000, 20);
  assert.equal(banner.width, REFERENCE_IMAGE_MAX_EDGE);
  assert.ok(banner.height >= 1);
});

test("isSupportedReferenceImage accepts the formats the vision models read, and nothing else", () => {
  for (const type of ["image/png", "image/jpeg", "image/webp", "image/gif"]) {
    assert.equal(isSupportedReferenceImage({ type } as File), true, type);
  }
  for (const type of ["image/svg+xml", "application/pdf", "text/plain", ""]) {
    assert.equal(isSupportedReferenceImage({ type } as File), false, type);
  }
});
