import { z } from 'zod';
import { getRuntimeAiSettings } from './aiSettings';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

export interface GeminiUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

function getGeminiApiKey(): string {
  const key = (process.env.GEMINI_API_KEY ?? getRuntimeAiSettings().geminiApiKey ?? '').trim();
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
  schema: z.ZodType<T>;
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
  voiceName?: string;
}): Promise<Buffer> {
  const apiKey = getGeminiApiKey();
  const body = {
    contents: [{ role: 'user', parts: [{ text: params.text }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: params.voiceName ?? 'Kore',
          },
        },
      },
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
  if (!resp.ok) throw new Error(`Gemini TTS failed: HTTP ${resp.status}`);
  const json = (await resp.json()) as any;
  const b64 = json?.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData?.data)?.inlineData?.data;
  if (!b64 || typeof b64 !== 'string') throw new Error('Gemini TTS returned empty audio');
  return Buffer.from(b64, 'base64');
}
