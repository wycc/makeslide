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

/**
 * The nine speakers packaged with Qwen3-TTS CustomVoice — the model this project's audio.cpp
 * setup uses. Order follows the upstream listing (Chinese first, then the English and the
 * other-language voices), so the picker reads the way the model card does.
 *
 * Gender and dialect come from Qwen's own voice list (github.com/QwenLM/Qwen3-TTS), not from
 * guessing at the names: `uncle_fu` and `ono_anna` are obvious enough, but `dylan` and `eric` are
 * male voices whose names say nothing, and measuring pitch to find out proved unreliable.
 *
 * The names are the `spk_id` keys inside the model, which audio.cpp lowercases before looking
 * them up — so these must stay lowercase to match what gets stored in settings.
 */
/**
 * The audio.cpp families this app knows how to drive, for the settings picker.
 *
 * Free text still works (audio.cpp has dozens of families and the backend passes the name
 * through), but the two here behave differently enough that picking one has to also set the model
 * path and change what the voice field offers: Qwen3-TTS has nine packaged speakers across three
 * model packages, BreezeTTS 2 has none and takes the voice as a written instruction.
 */
export const AUDIOCPP_FAMILIES = [
  {
    id: 'qwen3_tts',
    label: 'Qwen3-TTS',
    /**
     * Where this family's package sits under audio.cpp's `models/` directory, exactly as
     * `model_manager_v2.py` names it. Qwen3 is a directory; the backend derives the sibling
     * VoiceDesign/Base packages from it.
     */
    packagePath: 'Qwen3-TTS-12Hz-1.7B-CustomVoice-GGUF',
    /** Recognises a configured path as belonging to this family, whichever package it names. */
    marker: /Qwen3-TTS/i,
    hasPackagedSpeakers: true,
  },
  {
    id: 'breeze_tts',
    label: 'BreezeTTS 2',
    packagePath: 'Breeze-TTS-2-GGUF/breeze-tts-2-q8_0.gguf',
    marker: /Breeze-TTS/i,
    hasPackagedSpeakers: false,
  },
] as const;

export type AudioCppFamilyId = (typeof AUDIOCPP_FAMILIES)[number]['id'];

/** The known family a setting names, or null for anything else (still allowed, just not special). */
export function audioCppFamilyOf(family: string): (typeof AUDIOCPP_FAMILIES)[number] | null {
  const f = family.trim().toLowerCase();
  return AUDIOCPP_FAMILIES.find((entry) => f.startsWith(entry.id)) ?? null;
}

/** Whether this family ships speakers the picker can list; a family we do not know might. */
export function audioCppHasPackagedSpeakers(family: string): boolean {
  return audioCppFamilyOf(family)?.hasPackagedSpeakers ?? true;
}

/**
 * audio.cpp's `models/` directory, found from what is already configured.
 *
 * The backend hands the model path to the CLI verbatim, so a relative `models/…` resolves against
 * whatever directory the server runs in — not the audio.cpp checkout — and fails. The answer is
 * already on the page, though: a configured model path contains `…/models/<package>`, and the CLI
 * path is normally `<checkout>/build/bin/audiocpp_cli`, whose checkout holds `models/`.
 */
export function audioCppModelsRoot(currentModel: string, binPath: string): string | null {
  const model = currentModel.trim().replace(/\\/g, '/');
  const inModels = /^(.*\/models)\//.exec(model);
  if (inModels?.[1]) return inModels[1];
  const bin = binPath.trim().replace(/\\/g, '/');
  const checkout = /^(.*)\/build\/(?:[^/]+\/)*bin\/audiocpp_cli(?:\.exe)?$/.exec(bin);
  if (checkout?.[1]) return `${checkout[1]}/models`;
  return null;
}

/**
 * The model path to use after switching to `family`, or null to leave the box as it is.
 *
 * The path is only replaced when it is empty or recognisably another known family's package —
 * switching must not leave Breeze pointed at Qwen3's directory, which fails on the first segment —
 * and never when it is a path someone typed to somewhere this app does not know about.
 */
export function audioCppModelPathForFamily(params: {
  family: string;
  currentModel: string;
  binPath: string;
}): string | null {
  const target = audioCppFamilyOf(params.family);
  if (!target) return null;
  const current = params.currentModel.trim();
  if (target.marker.test(current)) return null; // already this family's package
  const belongsToAnother = AUDIOCPP_FAMILIES.some((f) => f.id !== target.id && f.marker.test(current));
  if (current && !belongsToAnother) return null;
  const root = audioCppModelsRoot(current, params.binPath);
  // Without a root the relative path is still the right *shape*; the hint next to the box says
  // an absolute path is needed.
  return root ? `${root}/${target.packagePath}` : `models/${target.packagePath}`;
}

export const AUDIOCPP_QWEN3_VOICES = [
  { id: 'vivian', gender: 'F', note: 'zh' },
  { id: 'serena', gender: 'F', note: 'zh' },
  { id: 'uncle_fu', gender: 'M', note: 'zh' },
  { id: 'dylan', gender: 'M', note: 'zh-beijing' },
  { id: 'eric', gender: 'M', note: 'zh-sichuan' },
  { id: 'ryan', gender: 'M', note: 'en' },
  { id: 'aiden', gender: 'M', note: 'en' },
  { id: 'ono_anna', gender: 'F', note: 'ja' },
  { id: 'sohee', gender: 'F', note: 'ko' },
] as const satisfies ReadonlyArray<{ id: string; gender: 'M' | 'F'; note: string }>;

export type AudioCppQwen3Voice = (typeof AUDIOCPP_QWEN3_VOICES)[number]['id'];

/** Whether a stored value is one of the packaged speakers (rather than a path or another family's id). */
export function isAudioCppQwen3Voice(voice: string): boolean {
  const v = voice.trim().toLowerCase();
  return AUDIOCPP_QWEN3_VOICES.some((entry) => entry.id === v);
}

/**
 * Stored in the voice field to mean 「用人設的文字描述設計一個聲音」 — Qwen3-TTS VoiceDesign.
 *
 * Must stay identical to AUDIOCPP_VOICE_DESIGN in backend/src/services/audiocpp.ts: that is where
 * the value is turned into `--task vdes` against the VoiceDesign package, and a mismatch would be
 * read as a speaker id that does not exist.
 */
export const AUDIOCPP_VOICE_DESIGN = ' voice-design';

export function isAudioCppVoiceDesign(voice: string): boolean {
  return voice.trim() === AUDIOCPP_VOICE_DESIGN.trim();
}

/** Whether a stored value points at a reference clip (voice cloning) rather than a named voice. */
export function isAudioCppVoiceReference(voice: string): boolean {
  const v = voice.trim();
  if (!v || isAudioCppVoiceDesign(v)) return false;
  return v.includes('/') || v.includes('\\') || /\.(wav|mp3|flac|ogg|m4a|webm)$/i.test(v);
}

export const TTS_VOICES_BY_PROVIDER = {
  openai: OPENAI_TTS_VOICES,
  gemini: GEMINI_TTS_VOICES,
  // CGU Air forwards to OpenAI's TTS, so it takes the OpenAI voice names.
  'cgu-air': OPENAI_TTS_VOICES,
  // OpenRouter reaches Google's Gemini TTS, so it takes the Gemini voice names.
  openrouter: GEMINI_TTS_VOICES,
  // audio.cpp (local): the nine speakers packaged with Qwen3-TTS CustomVoice, the model family
  // this project's audio.cpp setup uses (see AUDIOCPP_QWEN3_VOICES). A different family installed
  // on the server would ship a different set with no way to enumerate it from here — that is what
  // the empty default ('') and the "use the voice from settings" entry callers add are for.
  audiocpp: AUDIOCPP_QWEN3_VOICES.map((v) => v.id),
} as const;

export const DEFAULT_TTS_VOICE_BY_PROVIDER = {
  openai: OPENAI_TTS_VOICES[0],
  gemini: GEMINI_TTS_VOICES[0],
  'cgu-air': OPENAI_TTS_VOICES[0],
  openrouter: GEMINI_TTS_VOICES[0],
  // '' = no per-deck override; audio.cpp falls back to the family's own default (see
  // audioCppEffectiveVoice in backend/src/services/audiocpp.ts).
  audiocpp: '',
} as const;

/**
 * Whether this provider has a fixed list of voices to choose from.
 *
 * audio.cpp always does now (the Qwen3-TTS CustomVoice speakers), but a deck can still opt to
 * inherit the family default instead of naming one — see the '' entry callers add for it.
 */
export function hasEnumerableVoices(provider: TtsProvider): boolean {
  return TTS_VOICES_BY_PROVIDER[provider].length > 0;
}

export type TtsProvider = keyof typeof TTS_VOICES_BY_PROVIDER;
export type OpenAiTtsVoice = (typeof OPENAI_TTS_VOICES)[number];
export type GeminiTtsVoice = (typeof GEMINI_TTS_VOICES)[number];
export type TtsVoice = OpenAiTtsVoice | GeminiTtsVoice;
