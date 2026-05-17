const ONE_YEAR_SECONDS = 31_536_000;

const FINGERPRINTED_ASSET_RE = /(?:^|\/)[^/]+-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/;

export const STATIC_CACHE_CONTROL = {
  fingerprintedAsset: `public, max-age=${ONE_YEAR_SECONDS}, immutable`,
  revalidatedEntry: "no-cache",
  defaultAsset: "public, max-age=3600",
} as const;

export function cacheControlForStaticAsset(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");

  if (
    normalized.endsWith("/index.html") ||
    normalized.endsWith("/manifest.json")
  ) {
    return STATIC_CACHE_CONTROL.revalidatedEntry;
  }

  if (FINGERPRINTED_ASSET_RE.test(normalized)) {
    return STATIC_CACHE_CONTROL.fingerprintedAsset;
  }

  return STATIC_CACHE_CONTROL.defaultAsset;
}
