/**
 * True when `window.localStorage` is available (i.e. running in a browser).
 * Shared guard previously duplicated in reviewList / recentSearches /
 * commentAuthor; lets those modules no-op gracefully in non-browser contexts
 * (SSR, unit tests).
 */
export function hasLocalStorage(): boolean {
  return typeof window !== 'undefined' && !!window.localStorage;
}
