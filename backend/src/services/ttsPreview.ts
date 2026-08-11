import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { config } from '../config';
import { getRuntimeAiSettings, globalSpeakerVoicesFor, type TtsProvider } from './aiSettings';
import { isGeminiVoiceName, normalizeGeminiVoiceName, parseMimeRateAndChannels, synthesizeGeminiSpeech } from './gemini';
import { audioCppVoiceOrEmpty, isAudioCppVoiceUsable, synthesizeAudioCppSpeech } from './audiocpp';
import { getOpenAIClient } from './openai';
import { buildWavPcm16 } from './wav';
import { withTtsPrompt } from './ttsLanguagePrompt';
import {
  buildSegmentLoudnessConcatArgs,
  buildTtsInstructions,
  resolveSpeakerVoice,
  runCommand,
  supportsTtsInstructions,
} from '../worker/steps/synthesizeAudio';
import ffmpegStatic from 'ffmpeg-static';

const FFMPEG = ffmpegStatic ?? 'ffmpeg';

/**
 * The line every speaker preview reads. Fixed on purpose: the point of the button is to compare
 * one persona/voice against another, and that only works if the text is the same every time.
 *
 * Long enough to actually hear a persona — a two-word clip reveals timbre but nothing about pace
 * or delivery, which is what the 人設 field controls.
 */
export const TTS_PREVIEW_TEXT: Record<'zh-TW' | 'en', string> = {
  'zh-TW': '大家好，這是聲音試聽。接下來我會用這個語氣，帶大家看完這一頁的重點。',
  en: 'Hello, this is a voice preview. I will walk you through the key points on this slide in just this tone.',
};

export interface TtsPreviewResult {
  audio: Buffer;
  /** Mime type for the reply, so the browser can play the bytes without sniffing. */
  contentType: string;
  /** Text that was actually read, echoed back so the UI can show it. */
  text: string;
  /** Voice the preview actually used, after the same fallback chain a deck runs. */
  voice: string;
}

/**
 * The voice this speaker would really be read with, resolved exactly as the pipeline does.
 *
 * The form value is only the *first* candidate. Leaving the box on 「沿用設定」 sends an empty
 * string, and the deck would then fall back to the global speaker voice — so a preview that
 * treated empty as "no voice" and let normalizeGeminiVoiceName turn it into 'Kore' would
 * demonstrate a voice the deck never uses. That mismatch is the whole complaint this addresses.
 */
function previewVoiceFor(params: {
  provider: TtsProvider;
  speaker: '1' | '2';
  formVoice: string;
  runtime: ReturnType<typeof getRuntimeAiSettings>;
}): string {
  const { provider, speaker, formVoice, runtime } = params;
  const usesGeminiVoices = provider === 'gemini' || provider === 'openrouter';
  const { speaker1Voice, speaker2Voice } = globalSpeakerVoicesFor(provider, runtime);
  const resolved = resolveSpeakerVoice({
    speaker,
    // Last resort. There is no deck here, so it is the provider's own default single voice —
    // the same thing a deck falls back to when nothing more specific is set. audio.cpp has no
    // such default: the voices are family-specific, so '' means "whatever the family uses",
    // which is precisely what the deck would do too.
    deckVoice:
      usesGeminiVoices ? normalizeGeminiVoiceName('')
      : provider === 'audiocpp' ? ''
      : config.openaiTtsVoice,
    deckSpeaker1Voice: speaker === '1' ? formVoice : null,
    deckSpeaker2Voice: speaker === '2' ? formVoice : null,
    globalSpeaker1Voice: speaker1Voice,
    globalSpeaker2Voice: speaker2Voice,
    isVoiceUsable:
      provider === 'openrouter' ? isGeminiVoiceName
      : provider === 'audiocpp' ? isAudioCppVoiceUsable
      : undefined,
  });
  if (provider === 'audiocpp') return audioCppVoiceOrEmpty(resolved);
  return usesGeminiVoices ? normalizeGeminiVoiceName(resolved) : resolved;
}

/**
 * Level and encode the clip the way the pipeline does before a deck ever plays it.
 *
 * Deck audio goes through EBU R128 loudness normalization and an AAC encode; raw provider output
 * does not. Handing back the raw bytes made the preview noticeably different in loudness — and
 * therefore in perceived tone — from the same voice in a real deck.
 *
 * Never throws: if ffmpeg is unavailable the un-levelled clip is still worth hearing.
 */
async function levelLikeTheDeck(
  audio: Buffer,
  sourceExt: string,
  /**
   * Playback speed to bake in, for the provider whose deck audio gets it here rather than in the
   * request (audio.cpp — see buildSegmentLoudnessConcatArgs). Leaving it out would make every
   * audio.cpp preview play at 1.0 while its decks play at the configured speed: the same
   * "the preview is not what the deck sounds like" mismatch this function exists to avoid.
   */
  tempo?: number,
): Promise<{ audio: Buffer; contentType: string } | null> {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'makeslide-tts-preview-'));
  const source = path.join(dir, `preview.${sourceExt}`);
  const target = path.join(dir, 'preview.m4a');
  try {
    await fs.promises.writeFile(source, audio);
    await runCommand(FFMPEG, buildSegmentLoudnessConcatArgs([source], target, { tempo }), 60_000);
    return { audio: await fs.promises.readFile(target), contentType: 'audio/mp4' };
  } catch {
    return null;
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}

/**
 * Synthesize the fixed preview line for one speaker.
 *
 * `voice` and `persona` come from the settings form rather than the stored settings, so a
 * preview can be heard **before** saving — otherwise you would have to commit a persona to find
 * out how it sounds. Empty values fall through the same chain the pipeline uses.
 */
export async function synthesizeTtsPreview(params: {
  provider: TtsProvider;
  speaker: '1' | '2';
  voice: string;
  persona: string;
}): Promise<TtsPreviewResult> {
  const runtime = getRuntimeAiSettings();
  const text = TTS_PREVIEW_TEXT[runtime.uiLanguage] ?? TTS_PREVIEW_TEXT['zh-TW'];
  const persona = params.persona.trim();
  const voice = previewVoiceFor({
    provider: params.provider,
    speaker: params.speaker,
    formVoice: params.voice.trim(),
    runtime,
  });

  const raw = await synthesizeRaw({ provider: params.provider, voice, persona, text, runtime });
  // There is no deck here, so the speed a deck would use is the global default — the same value
  // synthesizeAudio falls back to when a deck has none of its own.
  const levelled = await levelLikeTheDeck(
    raw.audio,
    raw.ext,
    params.provider === 'audiocpp' ? config.openaiTtsSpeed : undefined,
  );
  return {
    audio: levelled?.audio ?? raw.audio,
    contentType: levelled?.contentType ?? raw.contentType,
    text,
    voice,
  };
}

async function synthesizeRaw(params: {
  provider: TtsProvider;
  voice: string;
  persona: string;
  text: string;
  runtime: ReturnType<typeof getRuntimeAiSettings>;
}): Promise<{ audio: Buffer; contentType: string; ext: string }> {
  const { provider, voice, persona, text, runtime } = params;

  if (provider === 'gemini') {
    // Single-voice mode: the preview line carries no "Speaker N:" labels, so there is nothing
    // for multiSpeakerVoiceConfig to resolve and the one voice under test is what is heard.
    const audio = await synthesizeGeminiSpeech({
      model: runtime.geminiTtsModel,
      text,
      voiceName: voice,
      // Same steering a real deck gets, or the preview would misrepresent the delivery. The
      // preview line carries no speaker labels, so this is the solo-persona slot.
      language: runtime.contentLanguage,
      persona: persona || null,
    });
    return { audio, contentType: 'audio/wav', ext: 'wav' };
  }

  if (provider === 'audiocpp') {
    // Local engine, same call the deck makes — including the steering switch, so what the button
    // demonstrates is what the pages will sound like (an acoustic family with steering on would
    // read the instruction aloud here exactly as it would there).
    const audio = await synthesizeAudioCppSpeech({
      text: config.audiocppTtsPromptSteering
        ? withTtsPrompt(text, { language: runtime.contentLanguage, persona: persona || null })
        : text,
      voice,
      runtime,
    });
    return { audio, contentType: 'audio/wav', ext: 'wav' };
  }

  if (provider === 'openrouter') {
    const client = getOpenAIClient(undefined, 'openrouter');
    const response = await client.audio.speech.create({
      model: runtime.openrouterTtsModel || config.openrouterTtsModel,
      voice,
      input: withTtsPrompt(text, { language: runtime.contentLanguage, persona: persona || null }),
      response_format: 'pcm',
    });
    // Same reasoning as the pipeline: headerless PCM stamped with a guessed rate plays at the
    // wrong pitch, which would make the preview lie about how the voice sounds.
    const contentType = response.headers?.get('content-type') ?? '';
    const { sampleRate, channels } = contentType
      ? parseMimeRateAndChannels(contentType)
      : { sampleRate: 24000, channels: 1 };
    const audio = buildWavPcm16(Buffer.from(await response.arrayBuffer()), sampleRate, channels);
    return { audio, contentType: 'audio/wav', ext: 'wav' };
  }

  const client = getOpenAIClient();
  const model = runtime.openaiTtsModel || config.openaiTtsModel;
  // The persona only reaches OpenAI through `instructions`, so a preview without it would sound
  // identical no matter what the 人設 box says — i.e. it would not be testing the thing the
  // button sits next to. Legacy tts-1 models reject the field.
  const instructions = supportsTtsInstructions(model)
    ? buildTtsInstructions({ tone: null, persona: persona || null, language: runtime.contentLanguage })
    : undefined;
  const response = await client.audio.speech.create({
    model,
    voice,
    input: text,
    response_format: config.openaiTtsFormat,
    ...(instructions ? { instructions } : {}),
  });
  return {
    audio: Buffer.from(await response.arrayBuffer()),
    contentType: config.openaiTtsFormat === 'mp3' ? 'audio/mpeg' : `audio/${config.openaiTtsFormat}`,
    ext: config.openaiTtsFormat === 'mp3' ? 'mp3' : String(config.openaiTtsFormat),
  };
}

/** Exported for tests: the voice-resolution half of a preview, without calling any provider. */
export const resolvePreviewVoice = previewVoiceFor;
