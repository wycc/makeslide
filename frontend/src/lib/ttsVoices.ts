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

/** Label a voice for a provider — OpenRouter voices are Gemini's. */
export function voiceLabelForProvider(
  provider: TtsProvider,
  voice: string,
  genderLabels: VoiceGenderLabels,
): string {
  // audio.cpp voice ids are family-specific strings with no gender table to look them up in;
  // showing the raw id is the only honest label.
  if (provider === 'audiocpp') return voice;
  return provider === 'openai' ? openaiVoiceLabel(voice, genderLabels) : geminiVoiceLabel(voice, genderLabels);
}

export function openaiVoiceLabel(voice: string, genderLabels: VoiceGenderLabels): string {
  const g = OPENAI_TTS_VOICE_GENDER[voice];
  return g ? `${voice}（${g === 'M' ? genderLabels.male : genderLabels.female}）` : voice;
}

export const TTS_VOICES_BY_PROVIDER = {
  openai: OPENAI_TTS_VOICES,
  gemini: GEMINI_TTS_VOICES,
  // OpenRouter reaches Google's Gemini TTS, so it takes the Gemini voice names.
  openrouter: GEMINI_TTS_VOICES,
  // audio.cpp (local): voices belong to whichever model family is installed, and there is no way
  // to enumerate them from here — the settings page takes a free-text voice id (or a path to a
  // reference clip for voice cloning) instead. Empty means a deck cannot pick a voice per deck;
  // it uses the one configured in settings. See hasEnumerableVoices.
  audiocpp: [] as readonly string[],
} as const;

export const DEFAULT_TTS_VOICE_BY_PROVIDER = {
  openai: OPENAI_TTS_VOICES[0],
  gemini: GEMINI_TTS_VOICES[0],
  openrouter: GEMINI_TTS_VOICES[0],
  audiocpp: '',
} as const;

/**
 * Whether this provider has a fixed list of voices to choose from.
 *
 * Where it doesn't (audio.cpp), a voice dropdown would render empty and silently submit an empty
 * value; callers show a single "use the voice from settings" entry instead.
 */
export function hasEnumerableVoices(provider: TtsProvider): boolean {
  return TTS_VOICES_BY_PROVIDER[provider].length > 0;
}

export type TtsProvider = keyof typeof TTS_VOICES_BY_PROVIDER;
export type OpenAiTtsVoice = (typeof OPENAI_TTS_VOICES)[number];
export type GeminiTtsVoice = (typeof GEMINI_TTS_VOICES)[number];
export type TtsVoice = OpenAiTtsVoice | GeminiTtsVoice;
