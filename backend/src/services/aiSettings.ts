import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';

export type AiProvider = 'openai' | 'gemini';

export interface RuntimeAiSettings {
  openaiApiKey: string;
  geminiApiKey: string;
  llmProvider: AiProvider;
  ttsProvider: AiProvider;
  openaiLlmModel: string;
  geminiLlmModel: string;
  openaiTtsModel: string;
  geminiTtsModel: string;
  geminiTtsSpeaker1: string;
  geminiTtsSpeaker2: string;
}

let runtime: RuntimeAiSettings = {
  openaiApiKey: config.openaiApiKey,
  geminiApiKey: config.geminiApiKey,
  llmProvider: config.llmProvider,
  ttsProvider: config.ttsProvider,
  openaiLlmModel: config.openaiLlmModel,
  geminiLlmModel: config.geminiLlmModel,
  openaiTtsModel: config.openaiTtsModel,
  geminiTtsModel: config.geminiTtsModel,
  geminiTtsSpeaker1: process.env.GEMINI_TTS_SPEAKER1?.trim() || '',
  geminiTtsSpeaker2: process.env.GEMINI_TTS_SPEAKER2?.trim() || '',
};

export function getRuntimeAiSettings(): RuntimeAiSettings {
  return { ...runtime };
}

export function setRuntimeAiSettings(next: Partial<RuntimeAiSettings>): RuntimeAiSettings {
  runtime = {
    ...runtime,
    ...next,
  };
  if (typeof next.openaiApiKey === 'string') process.env.OPENAI_API_KEY = next.openaiApiKey;
  if (typeof next.geminiApiKey === 'string') process.env.GEMINI_API_KEY = next.geminiApiKey;
  if (typeof next.llmProvider === 'string') process.env.LLM_PROVIDER = next.llmProvider;
  if (typeof next.ttsProvider === 'string') process.env.TTS_PROVIDER = next.ttsProvider;
  if (typeof next.openaiLlmModel === 'string') process.env.OPENAI_LLM_MODEL = next.openaiLlmModel;
  if (typeof next.geminiLlmModel === 'string') process.env.GEMINI_LLM_MODEL = next.geminiLlmModel;
  if (typeof next.openaiTtsModel === 'string') process.env.OPENAI_TTS_MODEL = next.openaiTtsModel;
  if (typeof next.geminiTtsModel === 'string') process.env.GEMINI_TTS_MODEL = next.geminiTtsModel;
  if (typeof next.geminiTtsSpeaker1 === 'string') process.env.GEMINI_TTS_SPEAKER1 = next.geminiTtsSpeaker1;
  if (typeof next.geminiTtsSpeaker2 === 'string') process.env.GEMINI_TTS_SPEAKER2 = next.geminiTtsSpeaker2;
  return { ...runtime };
}

export async function persistEnvSettings(next: Partial<RuntimeAiSettings>): Promise<void> {
  const envPath = path.join(config.repoRoot, '.env');
  let content = '';
  if (fs.existsSync(envPath)) content = await fs.promises.readFile(envPath, 'utf8');

  const pairs: Array<[string, string | undefined]> = [
    ['OPENAI_API_KEY', next.openaiApiKey],
    ['GEMINI_API_KEY', next.geminiApiKey],
    ['LLM_PROVIDER', next.llmProvider],
    ['TTS_PROVIDER', next.ttsProvider],
    ['OPENAI_LLM_MODEL', next.openaiLlmModel],
    ['GEMINI_LLM_MODEL', next.geminiLlmModel],
    ['OPENAI_TTS_MODEL', next.openaiTtsModel],
    ['GEMINI_TTS_MODEL', next.geminiTtsModel],
    ['GEMINI_TTS_SPEAKER1', next.geminiTtsSpeaker1],
    ['GEMINI_TTS_SPEAKER2', next.geminiTtsSpeaker2],
  ];

  for (const [key, raw] of pairs) {
    if (typeof raw !== 'string') continue;
    const value = raw.trim();
    const line = `${key}=${value}`;
    const re = new RegExp(`^${key}=.*`, 'm');
    if (re.test(content)) content = content.replace(re, line);
    else content = `${content.trimEnd()}\n${line}\n`;
  }

  await fs.promises.writeFile(envPath, content, 'utf8');
}
