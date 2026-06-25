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

export function getStoredNotebookTab(): NotebookTab {
  if (typeof window === 'undefined') return DEFAULT_NOTEBOOK_TAB;
  return normalizeNotebookTab(window.localStorage.getItem(NOTEBOOK_TAB_STORAGE_KEY));
}

export function setStoredNotebookTab(tab: NotebookTab): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(NOTEBOOK_TAB_STORAGE_KEY, tab);
}
