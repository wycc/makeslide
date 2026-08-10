import type { AppLanguage } from './aiSettings';

/**
 * Steering line prepended to every Chinese TTS request.
 *
 * The models are trained mostly on mainland Mandarin, so left to themselves they drift into
 * mainland vocabulary and a flatter news-reader delivery. Saying which variant and what tone is
 * wanted is the only lever available — the voice itself is a fixed prebuilt timbre.
 */
export const ZH_TW_TTS_INSTRUCTION = '請使用台灣用語的繁體中文，以親切且自然的語氣朗讀';

/** The steering line for `language`, or null when that language needs none. */
export function ttsLanguageInstruction(language: AppLanguage): string | null {
  return language === 'zh-TW' ? ZH_TW_TTS_INSTRUCTION : null;
}

/**
 * Prefix `text` with a steering line for providers that have no separate instructions field
 * (Gemini, and OpenRouter reaching it), where the prompt itself is the only channel.
 *
 * The trailing colon matters: it is the shape Google documents for style control
 * ("Say the following: …"), which the model treats as an instruction rather than as words to
 * read out. A bare sentence in front of the text is much likelier to be spoken aloud.
 */
export function withTtsLanguageInstruction(text: string, language: AppLanguage): string {
  const instruction = ttsLanguageInstruction(language);
  if (!instruction) return text;
  return `${instruction}：\n${text}`;
}
