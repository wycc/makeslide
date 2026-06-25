import type { TranslationKey } from '../../i18n';

/**
 * The play-page right sidebar is organised as a "notebook" of thematic tabs;
 * only one tab's sections are rendered at a time. This module owns the tab
 * definitions and the (localStorage-backed) persistence of the last-used tab.
 * Kept free of React so the normalisation logic can be unit-tested.
 */
export type NotebookTab = 'slides' | 'ai' | 'interact' | 'notes';

export interface NotebookTabDef {
  id: NotebookTab;
  icon: string;
  labelKey: TranslationKey;
}

export const NOTEBOOK_TABS: readonly NotebookTabDef[] = [
  { id: 'slides', icon: '🧩', labelKey: 'play.sidebar.notebook.slides' },
  { id: 'ai', icon: '💬', labelKey: 'play.sidebar.notebook.ai' },
  { id: 'interact', icon: '📊', labelKey: 'play.sidebar.notebook.interact' },
  { id: 'notes', icon: '📝', labelKey: 'play.sidebar.notebook.notes' },
];

export const DEFAULT_NOTEBOOK_TAB: NotebookTab = 'slides';

export const NOTEBOOK_TAB_STORAGE_KEY = 'makeslide.notebookTab';

export function isNotebookTab(value: unknown): value is NotebookTab {
  return NOTEBOOK_TABS.some((tab) => tab.id === value);
}

/** Coerce an arbitrary value into a valid tab, falling back to the default. */
export function normalizeNotebookTab(value: unknown, fallback: NotebookTab = DEFAULT_NOTEBOOK_TAB): NotebookTab {
  return isNotebookTab(value) ? value : fallback;
}

/**
 * The next/previous tab for keyboard (ArrowRight/ArrowLeft) navigation, wrapping
 * around the ends. `direction` is +1 for next, -1 for previous. Pure for testing.
 */
export function getAdjacentNotebookTab(current: NotebookTab, direction: 1 | -1): NotebookTab {
  const idx = NOTEBOOK_TABS.findIndex((tab) => tab.id === current);
  const base = idx === -1 ? 0 : idx;
  const next = (base + direction + NOTEBOOK_TABS.length) % NOTEBOOK_TABS.length;
  return NOTEBOOK_TABS[next]?.id ?? DEFAULT_NOTEBOOK_TAB;
}

/**
 * Per-tab count badges shown on the tab bar. Only entries with a positive count
 * render a badge. "slides" surfaces the deck page count; "interact" sums the
 * user's saved markers and live polls for this deck. Pure for testing.
 */
export function computeNotebookTabCounts(input: {
  slides: number;
  bookmarks: number;
  important: number;
  polls: number;
}): Partial<Record<NotebookTab, number>> {
  return {
    slides: input.slides,
    interact: input.bookmarks + input.important + input.polls,
  };
}

/** The first or last tab, for Home/End keyboard navigation. Pure for testing. */
export function getEdgeNotebookTab(edge: 'first' | 'last'): NotebookTab {
  const tab = edge === 'first' ? NOTEBOOK_TABS[0] : NOTEBOOK_TABS[NOTEBOOK_TABS.length - 1];
  return tab?.id ?? DEFAULT_NOTEBOOK_TAB;
}

export function getStoredNotebookTab(): NotebookTab {
  if (typeof window === 'undefined') return DEFAULT_NOTEBOOK_TAB;
  return normalizeNotebookTab(window.localStorage.getItem(NOTEBOOK_TAB_STORAGE_KEY));
}

export function setStoredNotebookTab(tab: NotebookTab): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(NOTEBOOK_TAB_STORAGE_KEY, tab);
}
