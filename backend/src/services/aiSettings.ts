import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';

export type AiProvider = 'openai' | 'gemini';
export type AppLanguage = 'zh-TW' | 'en';

export interface RuntimeAiSettings {
  openaiApiKey: string;
  openaiBaseUrl: string;
  geminiApiKey: string;
  llmProvider: AiProvider;
  ttsProvider: AiProvider;
  openaiLlmModel: string;
  geminiLlmModel: string;
  openaiTtsModel: string;
  geminiTtsModel: string;
  geminiTtsSpeaker1: string;
  geminiTtsSpeaker2: string;
  geminiTtsSpeaker1Voice: string;
  geminiTtsSpeaker2Voice: string;
  userCode: string;
  uiLanguage: AppLanguage;
  contentLanguage: AppLanguage;
  googleAuthEnabled: boolean;
  googleClientId: string;
  googleClientSecret: string;
  googleRedirectUri: string;
  githubRepoUrl: string;
  githubToken: string;
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
    openaiBaseUrl: values.OPENAI_BASE_URL,
    geminiApiKey: values.GEMINI_API_KEY,
    llmProvider: values.LLM_PROVIDER === 'gemini' ? 'gemini' : values.LLM_PROVIDER === 'openai' ? 'openai' : undefined,
    ttsProvider: values.TTS_PROVIDER === 'gemini' ? 'gemini' : values.TTS_PROVIDER === 'openai' ? 'openai' : undefined,
    openaiLlmModel: values.OPENAI_LLM_MODEL,
    geminiLlmModel: values.GEMINI_LLM_MODEL,
    openaiTtsModel: values.OPENAI_TTS_MODEL,
    geminiTtsModel: values.GEMINI_TTS_MODEL,
    geminiTtsSpeaker1: values.GEMINI_TTS_SPEAKER1,
    geminiTtsSpeaker2: values.GEMINI_TTS_SPEAKER2,
    geminiTtsSpeaker1Voice: values.GEMINI_TTS_SPEAKER1_VOICE,
    geminiTtsSpeaker2Voice: values.GEMINI_TTS_SPEAKER2_VOICE,
    userCode: values.USER_CODE,
    uiLanguage: values.UI_LANGUAGE === 'en' ? 'en' : values.UI_LANGUAGE === 'zh-TW' ? 'zh-TW' : undefined,
    contentLanguage: values.CONTENT_LANGUAGE === 'en' ? 'en' : values.CONTENT_LANGUAGE === 'zh-TW' ? 'zh-TW' : undefined,
    googleAuthEnabled:
      values.GOOGLE_AUTH_ENABLED === 'true'
        ? true
        : values.GOOGLE_AUTH_ENABLED === 'false'
          ? false
          : undefined,
    googleClientId: values.GOOGLE_CLIENT_ID,
    googleClientSecret: values.GOOGLE_CLIENT_SECRET,
    googleRedirectUri: values.GOOGLE_REDIRECT_URI,
    githubRepoUrl: values.GITHUB_REPO_URL,
    githubToken: values.GITHUB_TOKEN,
  };
}

let runtime: RuntimeAiSettings = {
  openaiApiKey: config.openaiApiKey,
  openaiBaseUrl: process.env.OPENAI_BASE_URL?.trim() || '',
  geminiApiKey: config.geminiApiKey,
  llmProvider: config.llmProvider,
  ttsProvider: config.ttsProvider,
  openaiLlmModel: config.openaiLlmModel,
  geminiLlmModel: config.geminiLlmModel,
  openaiTtsModel: config.openaiTtsModel,
  geminiTtsModel: config.geminiTtsModel,
  geminiTtsSpeaker1: process.env.GEMINI_TTS_SPEAKER1?.trim() || '',
  geminiTtsSpeaker2: process.env.GEMINI_TTS_SPEAKER2?.trim() || '',
  geminiTtsSpeaker1Voice: process.env.GEMINI_TTS_SPEAKER1_VOICE?.trim() || '',
  geminiTtsSpeaker2Voice: process.env.GEMINI_TTS_SPEAKER2_VOICE?.trim() || '',
  userCode: process.env.USER_CODE?.trim() || '',
  uiLanguage: process.env.UI_LANGUAGE === 'en' ? 'en' : 'zh-TW',
  contentLanguage: process.env.CONTENT_LANGUAGE === 'en' ? 'en' : 'zh-TW',
  googleAuthEnabled: config.googleAuthEnabled,
  googleClientId: config.googleClientId,
  googleClientSecret: config.googleClientSecret,
  googleRedirectUri: config.googleRedirectUri,
  githubRepoUrl: process.env.GITHUB_REPO_URL?.trim() || '',
  githubToken: process.env.GITHUB_TOKEN?.trim() || '',
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
  if (typeof next.openaiBaseUrl === 'string') process.env.OPENAI_BASE_URL = next.openaiBaseUrl;
  if (typeof next.geminiApiKey === 'string') process.env.GEMINI_API_KEY = next.geminiApiKey;
  if (typeof next.llmProvider === 'string') process.env.LLM_PROVIDER = next.llmProvider;
  if (typeof next.ttsProvider === 'string') process.env.TTS_PROVIDER = next.ttsProvider;
  if (typeof next.openaiLlmModel === 'string') process.env.OPENAI_LLM_MODEL = next.openaiLlmModel;
  if (typeof next.geminiLlmModel === 'string') process.env.GEMINI_LLM_MODEL = next.geminiLlmModel;
  if (typeof next.openaiTtsModel === 'string') process.env.OPENAI_TTS_MODEL = next.openaiTtsModel;
  if (typeof next.geminiTtsModel === 'string') process.env.GEMINI_TTS_MODEL = next.geminiTtsModel;
  if (typeof next.geminiTtsSpeaker1 === 'string') process.env.GEMINI_TTS_SPEAKER1 = next.geminiTtsSpeaker1;
  if (typeof next.geminiTtsSpeaker2 === 'string') process.env.GEMINI_TTS_SPEAKER2 = next.geminiTtsSpeaker2;
  if (typeof next.geminiTtsSpeaker1Voice === 'string') process.env.GEMINI_TTS_SPEAKER1_VOICE = next.geminiTtsSpeaker1Voice;
  if (typeof next.geminiTtsSpeaker2Voice === 'string') process.env.GEMINI_TTS_SPEAKER2_VOICE = next.geminiTtsSpeaker2Voice;
  if (typeof next.userCode === 'string') process.env.USER_CODE = next.userCode;
  if (typeof next.uiLanguage === 'string') process.env.UI_LANGUAGE = next.uiLanguage;
  if (typeof next.contentLanguage === 'string') process.env.CONTENT_LANGUAGE = next.contentLanguage;
  if (typeof next.googleAuthEnabled === 'boolean') process.env.GOOGLE_AUTH_ENABLED = next.googleAuthEnabled ? 'true' : 'false';
  if (typeof next.googleClientId === 'string') process.env.GOOGLE_CLIENT_ID = next.googleClientId;
  if (typeof next.googleClientSecret === 'string') process.env.GOOGLE_CLIENT_SECRET = next.googleClientSecret;
  if (typeof next.googleRedirectUri === 'string') process.env.GOOGLE_REDIRECT_URI = next.googleRedirectUri;
  if (typeof next.githubRepoUrl === 'string') process.env.GITHUB_REPO_URL = next.githubRepoUrl;
  if (typeof next.githubToken === 'string') process.env.GITHUB_TOKEN = next.githubToken;
  return { ...runtime };
}

export async function persistEnvSettings(next: Partial<RuntimeAiSettings>): Promise<void> {
  const { accountDir, envPath } = getAccountSettingsLocation();
  let content = '';
  if (fs.existsSync(envPath)) content = await fs.promises.readFile(envPath, 'utf8');

  const pairs: Array<[string, string | undefined]> = [
    ['OPENAI_API_KEY', next.openaiApiKey],
    ['OPENAI_BASE_URL', next.openaiBaseUrl],
    ['GEMINI_API_KEY', next.geminiApiKey],
    ['LLM_PROVIDER', next.llmProvider],
    ['TTS_PROVIDER', next.ttsProvider],
    ['OPENAI_LLM_MODEL', next.openaiLlmModel],
    ['GEMINI_LLM_MODEL', next.geminiLlmModel],
    ['OPENAI_TTS_MODEL', next.openaiTtsModel],
    ['GEMINI_TTS_MODEL', next.geminiTtsModel],
    ['GEMINI_TTS_SPEAKER1', next.geminiTtsSpeaker1],
    ['GEMINI_TTS_SPEAKER2', next.geminiTtsSpeaker2],
    ['GEMINI_TTS_SPEAKER1_VOICE', next.geminiTtsSpeaker1Voice],
    ['GEMINI_TTS_SPEAKER2_VOICE', next.geminiTtsSpeaker2Voice],
    ['USER_CODE', next.userCode],
    ['UI_LANGUAGE', next.uiLanguage],
    ['CONTENT_LANGUAGE', next.contentLanguage],
    ['GOOGLE_AUTH_ENABLED', typeof next.googleAuthEnabled === 'boolean' ? (next.googleAuthEnabled ? 'true' : 'false') : undefined],
    ['GOOGLE_CLIENT_ID', next.googleClientId],
    ['GOOGLE_CLIENT_SECRET', next.googleClientSecret],
    ['GOOGLE_REDIRECT_URI', next.googleRedirectUri],
    ['GITHUB_REPO_URL', next.githubRepoUrl],
    ['GITHUB_TOKEN', next.githubToken],
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
