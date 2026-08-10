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

export interface TtsPromptParams {
  language: AppLanguage;
  /** Persona of the single voice reading this text (solo narration, or one dual-host segment). */
  persona?: string | null;
  /** Both personas, for one request that covers both hosts (multiSpeakerVoiceConfig). */
  speaker1Persona?: string | null;
  speaker2Persona?: string | null;
}

/**
 * The steering block for providers with no separate instructions field — Gemini, and OpenRouter
 * reaching it — where the prompt itself is the only channel. Returns null when there is nothing
 * to say, so English decks with no persona keep sending the bare text.
 *
 * Persona lines are addressed to the speaker labels the text actually carries, because in
 * multi-speaker mode one request covers both hosts and the model needs to know which is which.
 */
export function buildTtsPromptInstruction(params: TtsPromptParams): string | null {
  const lines: string[] = [];
  const language = ttsLanguageInstruction(params.language);
  if (language) lines.push(language);
  const persona = params.persona?.trim();
  if (persona) lines.push(`朗讀者的角色設定：${persona}`);
  const speaker1 = params.speaker1Persona?.trim();
  const speaker2 = params.speaker2Persona?.trim();
  if (speaker1) lines.push(`Speaker 1 的角色設定：${speaker1}`);
  if (speaker2) lines.push(`Speaker 2 的角色設定：${speaker2}`);
  return lines.length > 0 ? lines.join('\n') : null;
}

/**
 * Prefix `text` with that steering block.
 *
 * The colon at the boundary matters: it is the shape Google documents for style control
 * ("Say the following: …"), which the model treats as an instruction rather than as words to
 * read out. A bare sentence in front of the text is much likelier to be spoken aloud.
 *
 * The language line alone keeps the tighter one-line form, since it is a sentence that ends
 * naturally in a colon. As soon as a persona line joins it, an explicit 「以下為朗讀內容：」
 * closing line is used instead: persona lines already contain a colon of their own, so appending
 * another would produce 「⋯⋯角色設定：沉穩：」 and stop reading as "and here is the text".
 */
export function withTtsPrompt(text: string, params: TtsPromptParams): string {
  const instruction = buildTtsPromptInstruction(params);
  if (!instruction) return text;
  const languageOnly = instruction === ttsLanguageInstruction(params.language);
  if (languageOnly) return `${instruction}：\n${text}`;
  return `${instruction}\n以下為朗讀內容：\n${text}`;
}
