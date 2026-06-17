export type YoutubeSubtitleLanguageOption = 'zh-TW' | 'en' | 'ja' | 'auto';

export const YOUTUBE_SUBTITLE_LANGUAGE_OPTIONS: YoutubeSubtitleLanguageOption[] = ['zh-TW', 'en', 'ja', 'auto'];

export function normalizeYoutubeSubtitleLanguageForSubmit(language: string): string | undefined {
  const trimmed = language.trim();
  if (!trimmed || trimmed.toLowerCase() === 'auto') return undefined;
  return trimmed;
}
