import { config } from '../config';
import { getRuntimeAiSettings, type TtsProvider } from './aiSettings';
import { normalizeGeminiVoiceName, parseMimeRateAndChannels, synthesizeGeminiSpeech } from './gemini';
import { getOpenAIClient } from './openai';
import { buildWavPcm16 } from './wav';
import { buildTtsInstructions, supportsTtsInstructions } from '../worker/steps/synthesizeAudio';

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
}

/**
 * Synthesize the fixed preview line for one speaker.
 *
 * `voice` and `persona` come from the settings form rather than the stored settings, so a
 * preview can be heard **before** saving — otherwise you would have to commit a persona to find
 * out how it sounds. Empty values fall back to what is stored, matching the real pipeline.
 */
export async function synthesizeTtsPreview(params: {
  provider: TtsProvider;
  voice: string;
  persona: string;
}): Promise<TtsPreviewResult> {
  const runtime = getRuntimeAiSettings();
  const text = TTS_PREVIEW_TEXT[runtime.uiLanguage] ?? TTS_PREVIEW_TEXT['zh-TW'];
  const voice = params.voice.trim();
  const persona = params.persona.trim();

  if (params.provider === 'gemini') {
    // Single-voice mode: the preview line carries no "Speaker N:" labels, so there is nothing
    // for multiSpeakerVoiceConfig to resolve and the one voice under test is what is heard.
    const audio = await synthesizeGeminiSpeech({
      model: runtime.geminiTtsModel,
      text,
      voiceName: normalizeGeminiVoiceName(voice),
    });
    return { audio, contentType: 'audio/wav', text };
  }

  if (params.provider === 'openrouter') {
    const client = getOpenAIClient(undefined, 'openrouter');
    const response = await client.audio.speech.create({
      model: runtime.openrouterTtsModel || config.openrouterTtsModel,
      voice: normalizeGeminiVoiceName(voice),
      input: text,
      response_format: 'pcm',
    });
    // Same reasoning as the pipeline: headerless PCM stamped with a guessed rate plays at the
    // wrong pitch, which would make the preview lie about how the voice sounds.
    const contentType = response.headers?.get('content-type') ?? '';
    const { sampleRate, channels } = contentType
      ? parseMimeRateAndChannels(contentType)
      : { sampleRate: 24000, channels: 1 };
    const audio = buildWavPcm16(Buffer.from(await response.arrayBuffer()), sampleRate, channels);
    return { audio, contentType: 'audio/wav', text };
  }

  const client = getOpenAIClient();
  const model = runtime.openaiTtsModel || config.openaiTtsModel;
  // The persona only reaches OpenAI through `instructions`, so a preview without it would sound
  // identical no matter what the 人設 box says — i.e. it would not be testing the thing the
  // button sits next to. Legacy tts-1 models reject the field.
  const instructions = supportsTtsInstructions(model)
    ? buildTtsInstructions({ tone: null, persona: persona || null })
    : undefined;
  const response = await client.audio.speech.create({
    model,
    voice: voice || config.openaiTtsVoice,
    input: text,
    response_format: config.openaiTtsFormat,
    ...(instructions ? { instructions } : {}),
  });
  return {
    audio: Buffer.from(await response.arrayBuffer()),
    contentType: config.openaiTtsFormat === 'mp3' ? 'audio/mpeg' : `audio/${config.openaiTtsFormat}`,
    text,
  };
}
