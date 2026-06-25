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

// Keep in sync with backend GEMINI_VOICES (services/gemini.ts) so the picker never
// offers a name the backend will silently coerce to a fallback voice.
export const GEMINI_TTS_VOICES = [
  'Kore',
  'Puck',
  'Charon',
  'Fenrir',
  'Leda',
  'Orus',
  'Aoede',
  'Callirrhoe',
  'Autonoe',
  'Enceladus',
  'Iapetus',
  'Umbriel',
  'Algieba',
  'Despina',
  'Erinome',
  'Algenib',
  'Rasalgethi',
  'Laomedeia',
  'Achernar',
  'Alnilam',
  'Schedar',
  'Gacrux',
] as const;

// Approximate perceived gender per Gemini prebuilt voice (M = male, F = female).
// Used only to label the picker so users can reliably pick a male/female voice —
// in Gemini TTS the prebuilt voice is the only stable gender control.
export const GEMINI_TTS_VOICE_GENDER: Record<string, 'M' | 'F'> = {
  Kore: 'F',
  Puck: 'M',
  Charon: 'M',
  Fenrir: 'M',
  Leda: 'F',
  Orus: 'M',
  Aoede: 'F',
  Callirrhoe: 'F',
  Autonoe: 'F',
  Enceladus: 'M',
  Iapetus: 'M',
  Umbriel: 'M',
  Algieba: 'M',
  Despina: 'F',
  Erinome: 'F',
  Algenib: 'M',
  Rasalgethi: 'M',
  Laomedeia: 'F',
  Achernar: 'F',
  Alnilam: 'M',
  Schedar: 'M',
  Gacrux: 'F',
};

export interface VoiceGenderLabels {
  male: string;
  female: string;
}

export function geminiVoiceLabel(voice: string, genderLabels: VoiceGenderLabels): string {
  const g = GEMINI_TTS_VOICE_GENDER[voice];
  return g ? `${voice}（${g === 'M' ? genderLabels.male : genderLabels.female}）` : voice;
}

// Approximate perceived gender per OpenAI prebuilt voice (M = male, F = female).
// OpenAI does not officially classify voices by gender; this reflects common
// community description and is used only to help users pick distinct
// Speaker 1 / Speaker 2 voices for dual-host mode.
export const OPENAI_TTS_VOICE_GENDER: Record<string, 'M' | 'F'> = {
  alloy: 'M',
  ash: 'M',
  ballad: 'M',
  coral: 'F',
  echo: 'M',
  fable: 'M',
  onyx: 'M',
  nova: 'F',
  sage: 'F',
  shimmer: 'F',
  verse: 'M',
};

export function openaiVoiceLabel(voice: string, genderLabels: VoiceGenderLabels): string {
  const g = OPENAI_TTS_VOICE_GENDER[voice];
  return g ? `${voice}（${g === 'M' ? genderLabels.male : genderLabels.female}）` : voice;
}

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
