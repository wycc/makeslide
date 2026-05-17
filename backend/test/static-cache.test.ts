import test from "node:test";
import assert from "node:assert/strict";
import {
  cacheControlForStaticAsset,
  STATIC_CACHE_CONTROL,
} from "../src/staticCache";

test("fingerprinted Vite assets use long-lived immutable cache headers", () => {
  assert.equal(
    cacheControlForStaticAsset("/app/frontend/dist/assets/index-B1c2D3e4.js"),
    STATIC_CACHE_CONTROL.fingerprintedAsset,
  );
  assert.equal(
    cacheControlForStaticAsset(
      "C:\\app\\frontend\\dist\\assets\\style-AaBbCcDd.css",
    ),
    STATIC_CACHE_CONTROL.fingerprintedAsset,
  );
});

test("HTML and manifest entry files require revalidation", () => {
  assert.equal(
    cacheControlForStaticAsset("/app/frontend/dist/index.html"),
    STATIC_CACHE_CONTROL.revalidatedEntry,
  );
  assert.equal(
    cacheControlForStaticAsset("/app/frontend/dist/.vite/manifest.json"),
    STATIC_CACHE_CONTROL.revalidatedEntry,
  );
});

test("non-fingerprinted static assets get a short default cache window", () => {
  assert.equal(
    cacheControlForStaticAsset("/app/frontend/dist/favicon.svg"),
    STATIC_CACHE_CONTROL.defaultAsset,
  );
});
