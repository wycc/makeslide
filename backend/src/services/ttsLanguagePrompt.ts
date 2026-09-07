import type { AppLanguage } from './aiSettings';

/**
 * Steering line prepended to every Chinese TTS request.
 *
 * The models are trained mostly on mainland Mandarin, so left to themselves they drift into
 * mainland vocabulary and a flatter news-reader delivery. Saying which variant and what tone is
 * wanted is the only lever available — the voice itself is a fixed prebuilt timbre.
 */
export const ZH_TW_TTS_INSTRUCTION = '請使用台灣用語的繁體中文，以親切且自然的語氣朗讀';

/**
 * Steering line prepended to every English TTS request.
 *
 * English decks used to send no language line at all, on the reasoning that English text speaks
 * for itself. It does — for *words*. Digits do not: "2024", "35%", "$1.5M" and "3.2 GHz" carry no
 * language of their own, so a multilingual speech model reads them in whichever language the
 * request as a whole leans towards. With no steering line, and with every other line of the
 * request written in Chinese (the persona labels, the closing line, the default tone 「平穩敘述」),
 * that lean was towards Chinese — which is exactly the reported symptom: ordinary English words
 * came out in English while the numbers in the middle of them came out in Mandarin.
 *
 * So the numbers are named explicitly rather than left to follow from "read this in English".
 */
export const EN_TTS_INSTRUCTION =
  'Read the following aloud in English, with a warm and natural delivery. '
  + 'Speak every number, digit, year, date, time, percentage, currency amount, unit, ordinal, '
  + 'acronym and symbol in English — never in Chinese or any other language';

/** The steering line for `language`. Every supported language has one. */
export function ttsLanguageInstruction(language: AppLanguage): string {
  return language === 'en' ? EN_TTS_INSTRUCTION : ZH_TW_TTS_INSTRUCTION;
}

/**
 * The wording around the steering block, in the language being read.
 *
 * A Chinese frame around English text is not neutral packaging — it is the strongest language
 * signal in the whole request, and it is what pulled the digits into Mandarin (see
 * `EN_TTS_INSTRUCTION`). Each language therefore labels its own persona lines, closes with its
 * own "and here is the text" line, and uses its own colon.
 *
 * The speaker labels are deliberately *not* written as `Speaker 1: …`. Multi-speaker mode is
 * chosen by looking for that exact shape in the script, so a persona line starting with it would
 * make a solo page look like a dialogue. `Persona for Speaker 1:` puts a word in between and
 * cannot match, the same way 「Speaker 1 的角色設定：」 cannot.
 */
interface TtsPromptLabels {
  /** Separator between a single steering sentence and the text that follows it. */
  colon: string;
  /** Line naming the persona of the one reader (solo narration). */
  persona: (persona: string) => string;
  /** Line naming the persona of one host in a two-host script. */
  speakerPersona: (speaker: 1 | 2, persona: string) => string;
  /** Line that marks the end of the steering block and the start of the content. */
  closing: string;
  /** Tone applied to a passage carrying no `[[ … ]]` marker of its own. */
  defaultTone: string;
  /** Label for the persona line in providers with a separate `instructions` field. */
  instructionsPersona: (persona: string) => string;
  /** Label for the per-passage tone line in that same field. */
  instructionsTone: (tone: string) => string;
}

const LABELS: Readonly<Record<AppLanguage, TtsPromptLabels>> = {
  'zh-TW': {
    colon: '：',
    persona: (persona) => `朗讀者的角色設定：${persona}`,
    speakerPersona: (speaker, persona) => `Speaker ${speaker} 的角色設定：${persona}`,
    closing: '以下為朗讀內容：',
    defaultTone: '平穩敘述',
    instructionsPersona: (persona) => `角色設定：${persona}`,
    instructionsTone: (tone) => `這一段的語氣：${tone}`,
  },
  en: {
    colon: ':',
    persona: (persona) => `The reader's persona: ${persona}`,
    speakerPersona: (speaker, persona) => `Persona for Speaker ${speaker}: ${persona}`,
    closing: 'Here is the text to read aloud:',
    defaultTone: 'steady, even narration',
    instructionsPersona: (persona) => `Persona: ${persona}`,
    instructionsTone: (tone) => `Tone for this passage: ${tone}`,
  },
};

/** The steering vocabulary for `language`. */
export function ttsPromptLabels(language: AppLanguage): TtsPromptLabels {
  return LABELS[language] ?? LABELS['zh-TW'];
}

/**
 * The tone a passage with no `[[ … ]]` marker is read with, in the language it is written in.
 *
 * This used to be the bare string 「平穩敘述」 for every deck, and on OpenAI it is sent on every
 * single segment — so an English deck with no markers and no persona still shipped a request
 * whose only instruction was a Chinese sentence.
 */
export function defaultTtsTone(language: AppLanguage): string {
  return ttsPromptLabels(language).defaultTone;
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
 * reaching it — where the prompt itself is the only channel.
 *
 * Persona lines are addressed to the speaker labels the text actually carries, because in
 * multi-speaker mode one request covers both hosts and the model needs to know which is which.
 */
export function buildTtsPromptInstruction(params: TtsPromptParams): string {
  const labels = ttsPromptLabels(params.language);
  const lines: string[] = [ttsLanguageInstruction(params.language)];
  const persona = params.persona?.trim();
  if (persona) lines.push(labels.persona(persona));
  const speaker1 = params.speaker1Persona?.trim();
  const speaker2 = params.speaker2Persona?.trim();
  if (speaker1) lines.push(labels.speakerPersona(1, speaker1));
  if (speaker2) lines.push(labels.speakerPersona(2, speaker2));
  return lines.join('\n');
}

/**
 * Prefix `text` with that steering block.
 *
 * The colon at the boundary matters: it is the shape Google documents for style control
 * ("Say the following: …"), which the model treats as an instruction rather than as words to
 * read out. A bare sentence in front of the text is much likelier to be spoken aloud.
 *
 * The language line alone keeps the tighter one-line form, since it is a sentence that ends
 * naturally in a colon. As soon as a persona line joins it, an explicit closing line is used
 * instead: persona lines already contain a colon of their own, so appending another would
 * produce 「⋯⋯角色設定：沉穩：」 and stop reading as "and here is the text".
 */
export function withTtsPrompt(text: string, params: TtsPromptParams): string {
  const labels = ttsPromptLabels(params.language);
  const instruction = buildTtsPromptInstruction(params);
  const languageOnly = instruction === ttsLanguageInstruction(params.language);
  if (languageOnly) return `${instruction}${labels.colon}\n${text}`;
  return `${instruction}\n${labels.closing}\n${text}`;
}
