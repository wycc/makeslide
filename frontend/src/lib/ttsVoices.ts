export const OPENAI_TTS_VOICES = [
  'alloy',
  'ash',
  'ballad',
  'coral',
  'echo',
  'fable',
  'onyx',
  'nova',
  'sage',
  'shimmer',
  'verse',
] as const;

// Backward-compatible export for existing callers.
export const TTS_VOICES = OPENAI_TTS_VOICES;

export const GEMINI_TTS_VOICES = [
  'Kore',
  'Puck',
  'Charon',
  'Fenrir',
  'Leda',
  'Orus',
  'Zephyr',
] as const;

export const TTS_VOICES_BY_PROVIDER = {
  openai: OPENAI_TTS_VOICES,
  gemini: GEMINI_TTS_VOICES,
} as const;

export const DEFAULT_TTS_VOICE_BY_PROVIDER = {
  openai: OPENAI_TTS_VOICES[0],
  gemini: GEMINI_TTS_VOICES[0],
} as const;

export type TtsProvider = keyof typeof TTS_VOICES_BY_PROVIDER;
export type OpenAiTtsVoice = (typeof OPENAI_TTS_VOICES)[number];
export type GeminiTtsVoice = (typeof GEMINI_TTS_VOICES)[number];
export type TtsVoice = OpenAiTtsVoice | GeminiTtsVoice;
