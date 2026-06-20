import { z } from 'zod';
import { getRuntimeAiSettings } from './aiSettings';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { appendLlmRequestLog, appendLlmResponseLog } from './llmUsage';
import { logger } from '../logger';
import { redactLogObject } from './logSanitizer';
import { config } from '../config';
import { ApiKeyMissingError } from './apiKeyErrors';

/** Same request-deadline budget used for OpenAI calls (services/openai.ts); applied here so a hung Gemini API connection can't block a request/job forever. */
function geminiRequestTimeoutSignal(): AbortSignal {
  return AbortSignal.timeout(config.openaiRequestTimeoutMs);
}

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

/**
 * Summarizes the shape of a Gemini TTS response for diagnostic logging when
 * the expected `candidates[0].content.parts[].inlineData.data` path can't be
 * resolved. Reports which level was missing/empty instead of raw content, so
 * future Gemini API response-shape changes can be diagnosed from logs alone.
 */
export function summarizeTtsResponseForLog(json: unknown): Record<string, unknown> {
  const candidates = (json as { candidates?: unknown })?.candidates;
  const firstCandidate = Array.isArray(candidates) ? (candidates[0] as Record<string, unknown> | undefined) : undefined;
  const content = firstCandidate?.content as Record<string, unknown> | undefined;
  const parts = content?.parts;
  const partKinds = Array.isArray(parts)
    ? parts.map((p: unknown) => {
        const part = p as Record<string, unknown> | undefined;
        if (part && typeof part === 'object' && 'inlineData' in part) return 'inlineData';
        if (part && typeof part === 'object' && 'text' in part) return 'text';
        return 'unknown';
      })
    : [];
  return redactLogObject({
    hasCandidates: Array.isArray(candidates),
    candidatesCount: Array.isArray(candidates) ? candidates.length : 0,
    hasContent: content != null,
    hasParts: Array.isArray(parts),
    partsCount: Array.isArray(parts) ? parts.length : 0,
    partKinds,
    finishReason: (firstCandidate?.finishReason as string | undefined) ?? null,
  });
}

function getGeminiApiKey(): string {
  const key = (getRuntimeAiSettings().geminiApiKey ?? '').trim();
  if (!key) throw new ApiKeyMissingError('Gemini', 'GEMINI_API_KEY is not set — cannot call Gemini');
  return key;
}

type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } };

interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

interface GeminiContents {
  systemInstruction?: { parts: { text: string }[] };
  contents: GeminiContent[];
}

function parseDataUrl(url: string): { mimeType: string; data: string } | null {
  const match = /^data:([a-zA-Z0-9+/.-]+\/[a-zA-Z0-9+/.-]+);base64,(.+)$/s.exec(url);
  if (!match) return null;
  return { mimeType: match[1]!, data: match[2]! };
}

/**
 * Converts OpenAI-format messages into the Gemini `contents` + optional
 * `systemInstruction` structure. System messages become `systemInstruction`;
 * user/assistant messages map to `user`/`model` roles. `image_url` parts
 * carrying `data:image/...;base64,...` URLs are converted to `inlineData`
 * so vision-capable Gemini models receive the actual image bytes.
 * Non-data-URL image references are dropped (Gemini cannot fetch external HTTP
 * resources in server-side calls).
 */
export function buildGeminiContents(messages: ChatCompletionMessageParam[]): GeminiContents {
  const systemTexts: string[] = [];
  const contents: GeminiContent[] = [];

  for (const m of messages) {
    if (m.role === 'system') {
      const text = typeof m.content === 'string' ? m.content : '';
      if (text) systemTexts.push(text);
      continue;
    }

    const role: 'user' | 'model' = m.role === 'assistant' ? 'model' : 'user';
    const parts: GeminiPart[] = [];

    if (typeof m.content === 'string') {
      parts.push({ text: m.content });
    } else if (Array.isArray(m.content)) {
      for (const c of m.content) {
        if (c.type === 'text') {
          parts.push({ text: c.text as string });
        } else if (c.type === 'image_url') {
          const url = (c as { type: 'image_url'; image_url?: { url?: string } }).image_url?.url ?? '';
          const parsed = parseDataUrl(url);
          if (parsed) {
            parts.push({ inlineData: parsed });
          }
          // Non-data URLs are dropped — Gemini cannot fetch external HTTP resources.
        }
      }
    }

    if (parts.length > 0) {
      contents.push({ role, parts });
    }
  }

  const result: GeminiContents = { contents };
  if (systemTexts.length > 0) {
    result.systemInstruction = { parts: systemTexts.map((text) => ({ text })) };
  }
  return result;
}

export async function callGeminiJson<T>(params: {
  model: string;
  messages: ChatCompletionMessageParam[];
  schema: z.ZodType<T, z.ZodTypeDef, unknown>;
  maxTokens?: number;
  temperature?: number;
  label?: string;
}): Promise<{ data: T; usage: GeminiUsage; rawContent: string }> {
  const apiKey = getGeminiApiKey();
  const { systemInstruction, contents } = buildGeminiContents(params.messages);
  const maxOutputTokens = params.maxTokens ?? 2048;
  const temperature = params.temperature ?? 0.6;
  const body: Record<string, unknown> = {
    contents,
    generationConfig: {
      temperature,
      maxOutputTokens,
      responseMimeType: 'application/json',
    },
  };
  if (systemInstruction) {
    body.systemInstruction = systemInstruction;
  }
  await appendLlmRequestLog({
    ts: new Date().toISOString(),
    provider: 'gemini',
    label: params.label ?? null,
    model: params.model,
    maxOutputTokens,
    temperature,
  });
  const startedAt = Date.now();
  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(params.model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: geminiRequestTimeoutSignal(),
    },
  );
  if (!resp.ok) throw new Error(`Gemini request failed: HTTP ${resp.status}`);
  const json = (await resp.json()) as any;
  const latencyMs = Date.now() - startedAt;
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  const parsed = params.schema.parse(JSON.parse(text));
  const promptTokens = Number(json?.usageMetadata?.promptTokenCount ?? 0);
  const completionTokens = Number(json?.usageMetadata?.candidatesTokenCount ?? 0);
  const usage: GeminiUsage = {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens,
  };
  await appendLlmResponseLog({
    ts: new Date().toISOString(),
    provider: 'gemini',
    label: params.label ?? null,
    model: params.model,
    latencyMs,
    usage,
    raw_content_length: text.length,
  });
  return { data: parsed, rawContent: text, usage };
}

/**
 * Streaming plain-text completion via Gemini's `streamGenerateContent` (SSE)
 * endpoint, invoking `onDelta` for each text chunk as it arrives — mirrors
 * the incremental UX of `streamChatText`'s OpenAI path.
 */
export async function callGeminiTextStream(params: {
  model: string;
  messages: ChatCompletionMessageParam[];
  maxTokens?: number;
  temperature?: number;
  label?: string;
  onDelta: (delta: string) => void;
}): Promise<{ text: string; usage: GeminiUsage }> {
  const apiKey = getGeminiApiKey();
  const { systemInstruction, contents } = buildGeminiContents(params.messages);
  const maxOutputTokens = params.maxTokens ?? 2048;
  const temperature = params.temperature ?? 0.6;
  const body: Record<string, unknown> = {
    contents,
    generationConfig: {
      temperature,
      maxOutputTokens,
    },
  };
  if (systemInstruction) {
    body.systemInstruction = systemInstruction;
  }
  await appendLlmRequestLog({
    ts: new Date().toISOString(),
    provider: 'gemini',
    label: params.label ?? null,
    model: params.model,
    maxOutputTokens,
    temperature,
    stream: true,
  });
  const startedAt = Date.now();
  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(params.model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: geminiRequestTimeoutSignal(),
    },
  );
  if (!resp.ok) throw new Error(`Gemini request failed: HTTP ${resp.status}`);
  if (!resp.body) throw new Error('Gemini stream response has no body');

  let text = '';
  let usage: GeminiUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

  const handleLine = (line: string): void => {
    if (!line.startsWith('data:')) return;
    const jsonText = line.slice('data:'.length).trim();
    if (!jsonText) return;
    const json = JSON.parse(jsonText) as any;
    const parts = json?.candidates?.[0]?.content?.parts ?? [];
    for (const part of parts) {
      const delta = typeof part?.text === 'string' ? part.text : '';
      if (delta) {
        text += delta;
        params.onDelta(delta);
      }
    }
    if (json?.usageMetadata) {
      usage = {
        prompt_tokens: Number(json.usageMetadata.promptTokenCount ?? 0),
        completion_tokens: Number(json.usageMetadata.candidatesTokenCount ?? 0),
        total_tokens: Number(json.usageMetadata.totalTokenCount ?? 0),
      };
    }
  };

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      handleLine(buffer.slice(0, idx).trim());
      buffer = buffer.slice(idx + 1);
    }
  }
  if (buffer.trim()) handleLine(buffer.trim());

  await appendLlmResponseLog({
    ts: new Date().toISOString(),
    provider: 'gemini',
    label: params.label ?? null,
    model: params.model,
    latencyMs: Date.now() - startedAt,
    usage,
    raw_content_length: text.length,
    stream: true,
  });
  return { text, usage };
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
      signal: geminiRequestTimeoutSignal(),
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
  if (!b64 || typeof b64 !== 'string') {
    logger.warn({ response: summarizeTtsResponseForLog(json) }, 'Gemini TTS: failed to locate inlineData audio in response');
    throw new Error('Gemini TTS returned empty audio');
  }
  const raw = Buffer.from(b64, 'base64');

  // Gemini may return raw PCM (e.g. audio/L16) rather than MP3/WAV.
  // Wrap PCM as WAV so browsers can decode and play it reliably.
  if (mimeType.startsWith('audio/l16') || mimeType === 'audio/pcm') {
    const { sampleRate, channels } = parseMimeRateAndChannels(mimeType);
    return buildWavFromPcm16(raw, sampleRate, channels);
  }

  return raw;
}
