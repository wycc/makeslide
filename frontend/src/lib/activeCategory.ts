/** localStorage key holding the category filter currently active on the home page. */
export const CATEGORY_FILTER_STORAGE_KEY = 'makeslide.home.categoryFilter';

/**
 * The category a newly created presentation should be filed under, derived from
 * the home page's active category filter.
 *
 * Filters starting with `__` (`__all__`, `__recent__`) are views rather than real
 * categories, so they map to `null` — "no category, let the backend default apply".
 * Pure so both the home page (live state) and the import page (stored value) can
 * share one rule.
 */
export function categoryForNewItem(filter: string | null | undefined): string | null {
  const trimmed = filter?.trim() ?? '';
  if (!trimmed || trimmed.startsWith('__')) return null;
  return trimmed;
}

/**
 * Same as `categoryForNewItem`, but reads the active filter from localStorage —
 * for creation flows (e.g. the text import page) that run outside the home page
 * and therefore have no filter state of their own.
 */
export function readActiveCategoryForNewItem(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return categoryForNewItem(window.localStorage.getItem(CATEGORY_FILTER_STORAGE_KEY));
  } catch {
    return null;
  }
}
