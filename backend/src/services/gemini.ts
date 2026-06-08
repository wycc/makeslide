import { z } from 'zod';
import { getRuntimeAiSettings } from './aiSettings';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

export interface GeminiUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

const GEMINI_VOICES = new Set([
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
]);

function normalizeGeminiVoiceName(input?: string): string {
  const raw = (input ?? '').trim();
  if (!raw) return 'Kore';
  if (GEMINI_VOICES.has(raw)) return raw;
  // OpenAI voice names or any unknown value fallback to a stable Gemini voice.
  return 'Kore';
}


function buildWavFromPcm16(pcm: Buffer, sampleRate: number, channels: number): Buffer {
  const bitsPerSample = 16;
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const dataSize = pcm.length;
  const header = Buffer.alloc(44);

  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16); // PCM fmt chunk size
  header.writeUInt16LE(1, 20); // audio format = PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcm]);
}

function parseMimeRateAndChannels(mimeType: string): { sampleRate: number; channels: number } {
  const normalized = mimeType.toLowerCase();
  const rateMatch = /(?:rate|samplerate)=([0-9]{4,6})/.exec(normalized);
  const channelsMatch = /channels=([1-8])/.exec(normalized);
  const sampleRate = rateMatch ? Number(rateMatch[1]) : 24000;
  const channels = channelsMatch ? Number(channelsMatch[1]) : 1;
  return { sampleRate, channels };
}

function getGeminiApiKey(): string {
  const key = (getRuntimeAiSettings().geminiApiKey ?? '').trim();
  if (!key) throw new Error('GEMINI_API_KEY is not set — cannot call Gemini');
  return key;
}

function normalizeMessages(messages: ChatCompletionMessageParam[]): string {
  return messages
    .map((m) => {
      const role = m.role;
      const content = m.content;
      if (typeof content === 'string') return `[${role}] ${content}`;
      if (Array.isArray(content)) {
        return `[${role}] ${content
          .map((c) => (c.type === 'text' ? c.text : '[image]'))
          .join('\n')}`;
      }
      return `[${role}]`;
    })
    .join('\n\n');
}

export async function callGeminiJson<T>(params: {
  model: string;
  messages: ChatCompletionMessageParam[];
  schema: z.ZodType<T, z.ZodTypeDef, unknown>;
  maxTokens?: number;
  temperature?: number;
}): Promise<{ data: T; usage: GeminiUsage; rawContent: string }> {
  const apiKey = getGeminiApiKey();
  const prompt = normalizeMessages(params.messages);
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: params.temperature ?? 0.6,
      maxOutputTokens: params.maxTokens ?? 2048,
      responseMimeType: 'application/json',
    },
  };
  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(params.model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  if (!resp.ok) throw new Error(`Gemini request failed: HTTP ${resp.status}`);
  const json = (await resp.json()) as any;
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  const parsed = params.schema.parse(JSON.parse(text));
  const promptTokens = Number(json?.usageMetadata?.promptTokenCount ?? 0);
  const completionTokens = Number(json?.usageMetadata?.candidatesTokenCount ?? 0);
  return {
    data: parsed,
    rawContent: text,
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  };
}

export async function synthesizeGeminiSpeech(params: {
  model: string;
  text: string;
  /** Primary / single-narrator voice (the per-PDF tts_voice). */
  voiceName?: string;
  /** Explicit voice for "Speaker 1" lines in dual-host scripts. Falls back to voiceName. */
  speaker1VoiceName?: string;
  /** Explicit voice for "Speaker 2" lines in dual-host scripts. Falls back to voiceName. */
  speaker2VoiceName?: string;
}): Promise<Buffer> {
  const apiKey = getGeminiApiKey();
  const voiceName = normalizeGeminiVoiceName(params.voiceName);
  // 性別/音色一律由 prebuilt voice 決定，不再把人設文字塞進朗讀內容（避免與聲線打架而漂移）。
  const ttsPrompt = params.text;
  // 只有腳本實際出現 Speaker 1:/Speaker 2: 對白時才用多人模式。
  const hasSpeakerDialog = /(^|\n)\s*Speaker\s*1\s*:/i.test(params.text)
    || /(^|\n)\s*Speaker\s*2\s*:/i.test(params.text);
  // 兩位主持人的聲音都由設定明確指定，未指定時沿用主聲音（不再由程式自動挑對比聲線）。
  const speaker1Voice = params.speaker1VoiceName?.trim()
    ? normalizeGeminiVoiceName(params.speaker1VoiceName)
    : voiceName;
  const speaker2Voice = params.speaker2VoiceName?.trim()
    ? normalizeGeminiVoiceName(params.speaker2VoiceName)
    : voiceName;

  const speechConfig = hasSpeakerDialog
    ? {
        multiSpeakerVoiceConfig: {
          speakerVoiceConfigs: [
            {
              speaker: 'Speaker 1',
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: speaker1Voice },
              },
            },
            {
              speaker: 'Speaker 2',
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: speaker2Voice },
              },
            },
          ],
        },
      }
    : {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName,
          },
        },
      };

  const body = {
    contents: [{ role: 'user', parts: [{ text: ttsPrompt }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig,
    },
  };
  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(params.model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  if (!resp.ok) {
    const bodyText = await resp.text().catch(() => '');
    throw new Error(
      `Gemini TTS failed: HTTP ${resp.status}${bodyText ? ` - ${bodyText.slice(0, 600)}` : ''}`,
    );
  }
  const json = (await resp.json()) as any;
  const inline = json?.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData?.data)?.inlineData;
  const b64 = inline?.data;
  const mimeType = String(inline?.mimeType ?? '').toLowerCase();
  if (!b64 || typeof b64 !== 'string') throw new Error('Gemini TTS returned empty audio');
  const raw = Buffer.from(b64, 'base64');

  // Gemini may return raw PCM (e.g. audio/L16) rather than MP3/WAV.
  // Wrap PCM as WAV so browsers can decode and play it reliably.
  if (mimeType.startsWith('audio/l16') || mimeType === 'audio/pcm') {
    const { sampleRate, channels } = parseMimeRateAndChannels(mimeType);
    return buildWavFromPcm16(raw, sampleRate, channels);
  }

  return raw;
}
