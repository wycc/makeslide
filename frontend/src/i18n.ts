import { useCallback, useEffect, useMemo, useState } from 'react';

import { en } from './locales/en';
import { zhTW } from './locales/zh-TW';

export type AppLanguage = 'zh-TW' | 'en';
export type GeneratedContentLanguage = AppLanguage;

export const LANGUAGE_OPTIONS: Array<{ value: AppLanguage; label: string; nativeLabel: string }> = [
  { value: 'zh-TW', label: 'Traditional Chinese', nativeLabel: '繁體中文' },
  { value: 'en', label: 'English', nativeLabel: 'English' },
];

export const UI_LANGUAGE_STORAGE_KEY = 'makeslide.ui_language';
export const CONTENT_LANGUAGE_STORAGE_KEY = 'makeslide.content_language';
export const PLAYBACK_SPEED_STORAGE_KEY = 'makeslide.playback_speed';

const dictionaries = {
  'zh-TW': zhTW,
  en,
} as const;

export type TranslationKey = keyof typeof zhTW;

export function normalizeLanguage(value: unknown, fallback: AppLanguage = 'zh-TW'): AppLanguage {
  return value === 'en' || value === 'zh-TW' ? value : fallback;
}

export function getStoredUiLanguage(): AppLanguage {
  if (typeof window === 'undefined') return 'zh-TW';
  return normalizeLanguage(window.localStorage.getItem(UI_LANGUAGE_STORAGE_KEY));
}

export function getStoredContentLanguage(): GeneratedContentLanguage {
  if (typeof window === 'undefined') return 'zh-TW';
  return normalizeLanguage(window.localStorage.getItem(CONTENT_LANGUAGE_STORAGE_KEY));
}

export function storeLanguageSettings(uiLanguage: AppLanguage, contentLanguage: GeneratedContentLanguage): void {
  window.localStorage.setItem(UI_LANGUAGE_STORAGE_KEY, uiLanguage);
  window.localStorage.setItem(CONTENT_LANGUAGE_STORAGE_KEY, contentLanguage);
  window.dispatchEvent(
    new CustomEvent('makeslide:language-settings-changed', {
      detail: { uiLanguage, contentLanguage },
    }),
  );
}

export function translate(language: AppLanguage, key: TranslationKey): string {
  return dictionaries[language][key] ?? dictionaries['zh-TW'][key] ?? key;
}

export function useI18n() {
  const [language, setLanguage] = useState<AppLanguage>(() => getStoredUiLanguage());
  const [contentLanguage, setContentLanguage] = useState<GeneratedContentLanguage>(() => getStoredContentLanguage());

  useEffect(() => {
    const onChanged = () => {
      setLanguage(getStoredUiLanguage());
      setContentLanguage(getStoredContentLanguage());
    };
    window.addEventListener('storage', onChanged);
    window.addEventListener('makeslide:language-settings-changed', onChanged);
    return () => {
      window.removeEventListener('storage', onChanged);
      window.removeEventListener('makeslide:language-settings-changed', onChanged);
    };
  }, []);

  const t = useCallback((key: TranslationKey) => translate(language, key), [language]);

  return useMemo(() => ({ language, contentLanguage, t }), [contentLanguage, language, t]);
}

export function normalizePlaybackSpeed(value: unknown, fallback = 1): number {
  const n = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN;
  if (!Number.isFinite(n)) return fallback;
  const allowed = [0.5, 0.75, 1, 1.25, 1.5, 2];
  return allowed.includes(n) ? n : fallback;
}

export function getStoredPlaybackSpeed(): number {
  if (typeof window === 'undefined') return 1;
  return normalizePlaybackSpeed(window.localStorage.getItem(PLAYBACK_SPEED_STORAGE_KEY), 1);
}
