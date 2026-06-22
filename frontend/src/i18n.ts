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
export const SHOW_SUBTITLE_STORAGE_KEY = 'makeslide.show_subtitle';
export const INTERACTIVE_MODE_STORAGE_KEY = 'makeslide.interactive_mode';
export const TTS_SPEED_STORAGE_KEY = 'makeslide.ttsSpeed';

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

export function getStoredTtsSpeed(): number {
  if (typeof window === 'undefined') return 1;
  const raw = window.localStorage.getItem(TTS_SPEED_STORAGE_KEY);
  if (!raw) return 1;
  const n = parseFloat(raw);
  return Number.isFinite(n) && n >= 0.5 && n <= 2 ? n : 1;
}

export function setStoredTtsSpeed(speed: number): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(TTS_SPEED_STORAGE_KEY, String(speed));
}

export function getStoredShowSubtitle(): boolean {
  if (typeof window === 'undefined') return true;
  const raw = window.localStorage.getItem(SHOW_SUBTITLE_STORAGE_KEY);
  if (raw == null) return true;
  return raw === '1' || raw.toLowerCase() === 'true';
}

export function getStoredInteractiveMode(): boolean {
  if (typeof window === 'undefined') return false;
  const raw = window.localStorage.getItem(INTERACTIVE_MODE_STORAGE_KEY);
  if (raw == null) return false;
  return raw === '1' || raw.toLowerCase() === 'true';
}

export const SUBTITLE_SIZE_STORAGE_KEY = 'makeslide.subtitleSize';
export type SubtitleSize = 'sm' | 'md' | 'lg';

export function getStoredSubtitleSize(): SubtitleSize {
  if (typeof window === 'undefined') return 'md';
  const raw = window.localStorage.getItem(SUBTITLE_SIZE_STORAGE_KEY);
  if (raw === 'sm' || raw === 'md' || raw === 'lg') return raw;
  return 'md';
}
