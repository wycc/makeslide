import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';

export type AiProvider = 'openai' | 'gemini';
export type AppLanguage = 'zh-TW' | 'en';

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
  userCode: string;
  uiLanguage: AppLanguage;
  contentLanguage: AppLanguage;
}

export interface AccountSettingsLocation {
  accountId: string;
  accountDir: string;
  envPath: string;
}

const DEFAULT_ACCOUNT_ID = process.env.MAKESLIDE_ACCOUNT_ID?.trim() || 'default';

function sanitizeAccountId(accountId: string): string {
  const sanitized = accountId.trim().replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '');
  return sanitized || 'default';
}

export function getAccountSettingsLocation(accountId = DEFAULT_ACCOUNT_ID): AccountSettingsLocation {
  const safeAccountId = sanitizeAccountId(accountId);
  const accountDir = path.join(config.repoRoot, 'accounts', safeAccountId);
  return {
    accountId: safeAccountId,
    accountDir,
    envPath: path.join(accountDir, 'settings.env'),
  };
}

function parseEnvContent(content: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key) values[key] = value;
  }
  return values;
}

function loadAccountEnvSettings(): Partial<RuntimeAiSettings> {
  const { envPath } = getAccountSettingsLocation();
  if (!fs.existsSync(envPath)) return {};
  const values = parseEnvContent(fs.readFileSync(envPath, 'utf8'));
  return {
    openaiApiKey: values.OPENAI_API_KEY,
    geminiApiKey: values.GEMINI_API_KEY,
    llmProvider: values.LLM_PROVIDER === 'gemini' ? 'gemini' : values.LLM_PROVIDER === 'openai' ? 'openai' : undefined,
    ttsProvider: values.TTS_PROVIDER === 'gemini' ? 'gemini' : values.TTS_PROVIDER === 'openai' ? 'openai' : undefined,
    openaiLlmModel: values.OPENAI_LLM_MODEL,
    geminiLlmModel: values.GEMINI_LLM_MODEL,
    openaiTtsModel: values.OPENAI_TTS_MODEL,
    geminiTtsModel: values.GEMINI_TTS_MODEL,
    geminiTtsSpeaker1: values.GEMINI_TTS_SPEAKER1,
    geminiTtsSpeaker2: values.GEMINI_TTS_SPEAKER2,
    userCode: values.USER_CODE,
    uiLanguage: values.UI_LANGUAGE === 'en' ? 'en' : values.UI_LANGUAGE === 'zh-TW' ? 'zh-TW' : undefined,
    contentLanguage: values.CONTENT_LANGUAGE === 'en' ? 'en' : values.CONTENT_LANGUAGE === 'zh-TW' ? 'zh-TW' : undefined,
  };
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
  userCode: process.env.USER_CODE?.trim() || '',
  uiLanguage: process.env.UI_LANGUAGE === 'en' ? 'en' : 'zh-TW',
  contentLanguage: process.env.CONTENT_LANGUAGE === 'en' ? 'en' : 'zh-TW',
};

runtime = {
  ...runtime,
  ...Object.fromEntries(
    Object.entries(loadAccountEnvSettings()).filter(([, value]) => typeof value === 'string' && value.trim().length > 0),
  ),
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
  if (typeof next.userCode === 'string') process.env.USER_CODE = next.userCode;
  if (typeof next.uiLanguage === 'string') process.env.UI_LANGUAGE = next.uiLanguage;
  if (typeof next.contentLanguage === 'string') process.env.CONTENT_LANGUAGE = next.contentLanguage;
  return { ...runtime };
}

export async function persistEnvSettings(next: Partial<RuntimeAiSettings>): Promise<void> {
  const { accountDir, envPath } = getAccountSettingsLocation();
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
    ['USER_CODE', next.userCode],
    ['UI_LANGUAGE', next.uiLanguage],
    ['CONTENT_LANGUAGE', next.contentLanguage],
  ];

  for (const [key, raw] of pairs) {
    if (typeof raw !== 'string') continue;
    const value = raw.trim();
    const line = `${key}=${value}`;
    const re = new RegExp(`^${key}=.*`, 'm');
    if (re.test(content)) content = content.replace(re, line);
    else content = `${content.trimEnd()}\n${line}\n`;
  }

  await fs.promises.mkdir(accountDir, { recursive: true, mode: 0o700 });
  await fs.promises.writeFile(envPath, content, { encoding: 'utf8', mode: 0o600 });
}
