import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';
import { DEFAULT_ACCOUNT_ID, currentAccountId, sanitizeAccountId } from './accountContext';

export type AiProvider = 'openai' | 'gemini';
export type AppLanguage = 'zh-TW' | 'en';

/**
 * 帳號層級設定：每個使用者（以 Google sub 區分）各自擁有一份，存放在
 * accounts/<accountId>/settings.env，彼此完全獨立、不共用快取。
 */
export interface PerAccountAiSettings {
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
  githubRepoUrl: string;
  githubToken: string;
}

/**
 * 系統層級設定：Google 登入是「進入帳號之前」就要用到的設定，因此整個服務
 * 只有一份，固定存放在 DEFAULT_ACCOUNT_ID（accounts/default/settings.env）
 * 之中，不隨登入者切換。
 */
export interface SystemAuthSettings {
  googleAuthEnabled: boolean;
  googleClientId: string;
  googleClientSecret: string;
  googleRedirectUri: string;
  adminAccountIds: string[];
}

export interface RuntimeAiSettings extends PerAccountAiSettings, SystemAuthSettings {}

export interface AccountSettingsLocation {
  accountId: string;
  accountDir: string;
  envPath: string;
}

export function getAccountSettingsLocation(accountId: string = DEFAULT_ACCOUNT_ID): AccountSettingsLocation {
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

function readEnvFile(accountId: string): Record<string, string> {
  const { envPath } = getAccountSettingsLocation(accountId);
  if (!fs.existsSync(envPath)) return {};
  return parseEnvContent(fs.readFileSync(envPath, 'utf8'));
}

function asProvider(value: string | undefined): AiProvider | undefined {
  return value === 'gemini' ? 'gemini' : value === 'openai' ? 'openai' : undefined;
}

function asLanguage(value: string | undefined): AppLanguage | undefined {
  return value === 'en' ? 'en' : value === 'zh-TW' ? 'zh-TW' : undefined;
}

function asBoolean(value: string | undefined): boolean | undefined {
  return value === 'true' ? true : value === 'false' ? false : undefined;
}

function parseAdminAccountIds(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  const ids = value
    .split(',')
    .map((id) => sanitizeAccountId(id))
    .filter((id) => id.length > 0 && id !== DEFAULT_ACCOUNT_ID);
  return Array.from(new Set(ids));
}

function definedEntries<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => {
      if (typeof value === 'string') return value.trim().length > 0;
      return value !== undefined;
    }),
  ) as Partial<T>;
}

// ---------------------------------------------------------------------------
// 帳號層級設定（AI provider、模型、語音、語言、GitHub 同步……）
// ---------------------------------------------------------------------------

function basePerAccountSettings(): PerAccountAiSettings {
  return {
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
    githubRepoUrl: process.env.GITHUB_REPO_URL?.trim() || '',
    githubToken: process.env.GITHUB_TOKEN?.trim() || '',
  };
}

function loadPerAccountOverrides(accountId: string): Partial<PerAccountAiSettings> {
  const values = readEnvFile(accountId);
  return definedEntries({
    openaiApiKey: values.OPENAI_API_KEY,
    openaiBaseUrl: values.OPENAI_BASE_URL,
    geminiApiKey: values.GEMINI_API_KEY,
    llmProvider: asProvider(values.LLM_PROVIDER),
    ttsProvider: asProvider(values.TTS_PROVIDER),
    openaiLlmModel: values.OPENAI_LLM_MODEL,
    geminiLlmModel: values.GEMINI_LLM_MODEL,
    openaiTtsModel: values.OPENAI_TTS_MODEL,
    geminiTtsModel: values.GEMINI_TTS_MODEL,
    geminiTtsSpeaker1: values.GEMINI_TTS_SPEAKER1,
    geminiTtsSpeaker2: values.GEMINI_TTS_SPEAKER2,
    geminiTtsSpeaker1Voice: values.GEMINI_TTS_SPEAKER1_VOICE,
    geminiTtsSpeaker2Voice: values.GEMINI_TTS_SPEAKER2_VOICE,
    userCode: values.USER_CODE,
    uiLanguage: asLanguage(values.UI_LANGUAGE),
    contentLanguage: asLanguage(values.CONTENT_LANGUAGE),
    githubRepoUrl: values.GITHUB_REPO_URL,
    githubToken: values.GITHUB_TOKEN,
  });
}

// 每個帳號各自一份快取，彼此獨立；絕不互相讀取或回退到別人的設定。
const perAccountCache = new Map<string, PerAccountAiSettings>();

function loadPerAccountSettings(accountId: string): PerAccountAiSettings {
  const safeAccountId = sanitizeAccountId(accountId);
  const cached = perAccountCache.get(safeAccountId);
  if (cached) return cached;
  const merged: PerAccountAiSettings = { ...basePerAccountSettings(), ...loadPerAccountOverrides(safeAccountId) };
  perAccountCache.set(safeAccountId, merged);
  return merged;
}

const PER_ACCOUNT_ENV_PAIRS: Array<[string, keyof PerAccountAiSettings]> = [
  ['OPENAI_API_KEY', 'openaiApiKey'],
  ['OPENAI_BASE_URL', 'openaiBaseUrl'],
  ['GEMINI_API_KEY', 'geminiApiKey'],
  ['LLM_PROVIDER', 'llmProvider'],
  ['TTS_PROVIDER', 'ttsProvider'],
  ['OPENAI_LLM_MODEL', 'openaiLlmModel'],
  ['GEMINI_LLM_MODEL', 'geminiLlmModel'],
  ['OPENAI_TTS_MODEL', 'openaiTtsModel'],
  ['GEMINI_TTS_MODEL', 'geminiTtsModel'],
  ['GEMINI_TTS_SPEAKER1', 'geminiTtsSpeaker1'],
  ['GEMINI_TTS_SPEAKER2', 'geminiTtsSpeaker2'],
  ['GEMINI_TTS_SPEAKER1_VOICE', 'geminiTtsSpeaker1Voice'],
  ['GEMINI_TTS_SPEAKER2_VOICE', 'geminiTtsSpeaker2Voice'],
  ['USER_CODE', 'userCode'],
  ['UI_LANGUAGE', 'uiLanguage'],
  ['CONTENT_LANGUAGE', 'contentLanguage'],
  ['GITHUB_REPO_URL', 'githubRepoUrl'],
  ['GITHUB_TOKEN', 'githubToken'],
];

// ---------------------------------------------------------------------------
// 系統層級設定（Google 登入）：全服務只有一份，固定存在 DEFAULT_ACCOUNT_ID 下
// ---------------------------------------------------------------------------

function baseSystemAuthSettings(): SystemAuthSettings {
  return {
    googleAuthEnabled: config.googleAuthEnabled,
    googleClientId: config.googleClientId,
    googleClientSecret: config.googleClientSecret,
    googleRedirectUri: config.googleRedirectUri,
    adminAccountIds: parseAdminAccountIds(process.env.ADMIN_ACCOUNT_IDS) ?? [],
  };
}

function loadSystemAuthOverrides(): Partial<SystemAuthSettings> {
  const values = readEnvFile(DEFAULT_ACCOUNT_ID);
  return definedEntries({
    googleAuthEnabled: asBoolean(values.GOOGLE_AUTH_ENABLED),
    googleClientId: values.GOOGLE_CLIENT_ID,
    googleClientSecret: values.GOOGLE_CLIENT_SECRET,
    googleRedirectUri: values.GOOGLE_REDIRECT_URI,
    adminAccountIds: parseAdminAccountIds(values.ADMIN_ACCOUNT_IDS),
  });
}

let systemAuthCache: SystemAuthSettings | null = null;

function loadSystemAuthSettings(): SystemAuthSettings {
  if (systemAuthCache) return systemAuthCache;
  systemAuthCache = { ...baseSystemAuthSettings(), ...loadSystemAuthOverrides() };
  return systemAuthCache;
}

const SYSTEM_ENV_PAIRS: Array<[string, keyof SystemAuthSettings]> = [
  ['GOOGLE_AUTH_ENABLED', 'googleAuthEnabled'],
  ['GOOGLE_CLIENT_ID', 'googleClientId'],
  ['GOOGLE_CLIENT_SECRET', 'googleClientSecret'],
  ['GOOGLE_REDIRECT_URI', 'googleRedirectUri'],
  ['ADMIN_ACCOUNT_IDS', 'adminAccountIds'],
];

export function getSystemAuthSettings(): SystemAuthSettings {
  return { ...loadSystemAuthSettings() };
}

export function setSystemAuthSettings(next: Partial<SystemAuthSettings>): SystemAuthSettings {
  const current = loadSystemAuthSettings();
  systemAuthCache = { ...current, ...next };
  return { ...systemAuthCache };
}

export async function persistSystemAuthSettings(next: Partial<SystemAuthSettings>): Promise<void> {
  await writeEnvOverrides(DEFAULT_ACCOUNT_ID, SYSTEM_ENV_PAIRS, next);
}

export function getAdminAccountIds(): string[] {
  return [...loadSystemAuthSettings().adminAccountIds];
}

export function isAdminAccount(accountId: string = currentAccountId()): boolean {
  const safeAccountId = sanitizeAccountId(accountId);
  return loadSystemAuthSettings().adminAccountIds.includes(safeAccountId);
}

export async function ensureAdminAccount(accountId: string): Promise<boolean> {
  const safeAccountId = sanitizeAccountId(accountId);
  if (safeAccountId === DEFAULT_ACCOUNT_ID) return false;
  const current = loadSystemAuthSettings();
  if (current.adminAccountIds.length > 0) return false;
  setSystemAuthSettings({ adminAccountIds: [safeAccountId] });
  await persistSystemAuthSettings({ adminAccountIds: [safeAccountId] });
  return true;
}

export async function transferAdminAccount(accountId: string): Promise<string[]> {
  const safeAccountId = sanitizeAccountId(accountId);
  if (safeAccountId === DEFAULT_ACCOUNT_ID) {
    throw new Error('Cannot transfer admin to the default account');
  }
  setSystemAuthSettings({ adminAccountIds: [safeAccountId] });
  await persistSystemAuthSettings({ adminAccountIds: [safeAccountId] });
  return getAdminAccountIds();
}

// ---------------------------------------------------------------------------
// 對外介面：依「目前帳號情境」（見 accountContext）讀寫設定
// ---------------------------------------------------------------------------

/**
 * 取得指定帳號（預設為目前情境帳號）的有效設定（帳號層級設定 + 系統層級登入設定）。
 * 不同帳號各自快取、各自讀取自己的 settings.env，不會互相影響。
 */
export function getRuntimeAiSettings(accountId: string = currentAccountId()): RuntimeAiSettings {
  return { ...loadPerAccountSettings(accountId), ...loadSystemAuthSettings() };
}

/**
 * 更新指定帳號（預設為目前情境帳號）的記憶體快取。Google 登入相關欄位永遠
 * 寫入系統層級快取（與帳號無關），其餘欄位只影響該帳號自己的快取。
 *
 * 注意：刻意不寫入 process.env —— 那是跨帳號共用的全域狀態，寫入會讓不同
 * 使用者的設定互相覆蓋，正是多帳號設計要避免的「後台混用」問題。
 */
export function setRuntimeAiSettings(
  accountId: string = currentAccountId(),
  next: Partial<RuntimeAiSettings> = {},
): RuntimeAiSettings {
  const safeAccountId = sanitizeAccountId(accountId);
  const { systemPart, accountPart } = splitSettingsUpdate(next);

  if (Object.keys(systemPart).length > 0) {
    setSystemAuthSettings(systemPart);
  }
  if (Object.keys(accountPart).length > 0) {
    const current = loadPerAccountSettings(safeAccountId);
    perAccountCache.set(safeAccountId, { ...current, ...accountPart });
  }
  return getRuntimeAiSettings(safeAccountId);
}

function splitSettingsUpdate(next: Partial<RuntimeAiSettings>): {
  systemPart: Partial<SystemAuthSettings>;
  accountPart: Partial<PerAccountAiSettings>;
} {
  const systemKeys: Array<keyof SystemAuthSettings> = [
    'googleAuthEnabled',
    'googleClientId',
    'googleClientSecret',
    'googleRedirectUri',
    'adminAccountIds',
  ];
  const systemPart: Partial<SystemAuthSettings> = {};
  const accountPart: Partial<PerAccountAiSettings> = {};
  for (const [key, value] of Object.entries(next)) {
    if (value === undefined) continue;
    if ((systemKeys as string[]).includes(key)) {
      (systemPart as Record<string, unknown>)[key] = value;
    } else {
      (accountPart as Record<string, unknown>)[key] = value;
    }
  }
  return { systemPart, accountPart };
}

async function writeEnvOverrides<K extends string>(
  accountId: string,
  pairs: Array<[string, K]>,
  next: Partial<Record<K, string | boolean | string[] | AiProvider | AppLanguage | undefined>>,
): Promise<void> {
  const { accountDir, envPath } = getAccountSettingsLocation(accountId);
  let content = '';
  if (fs.existsSync(envPath)) content = await fs.promises.readFile(envPath, 'utf8');

  for (const [envKey, settingKey] of pairs) {
    const raw = next[settingKey];
    if (raw === undefined) continue;
    const value = Array.isArray(raw)
      ? raw.map((item) => sanitizeAccountId(item)).filter((item) => item.length > 0).join(',')
      : typeof raw === 'boolean'
        ? (raw ? 'true' : 'false')
        : String(raw).trim();
    const line = `${envKey}=${value}`;
    const re = new RegExp(`^${envKey}=.*`, 'm');
    if (re.test(content)) content = content.replace(re, line);
    else content = `${content.trimEnd()}\n${line}\n`;
  }

  await fs.promises.mkdir(accountDir, { recursive: true, mode: 0o700 });
  await fs.promises.writeFile(envPath, content, { encoding: 'utf8', mode: 0o600 });
}

/**
 * 將設定寫入磁碟。系統層級欄位（Google 登入）寫進 DEFAULT_ACCOUNT_ID 的設定檔，
 * 其餘欄位寫進指定帳號（預設為目前情境帳號）自己的設定檔，兩者互不交叉。
 */
export async function persistEnvSettings(
  accountId: string = currentAccountId(),
  next: Partial<RuntimeAiSettings> = {},
): Promise<void> {
  const { systemPart, accountPart } = splitSettingsUpdate(next);
  if (Object.keys(systemPart).length > 0) {
    await writeEnvOverrides(DEFAULT_ACCOUNT_ID, SYSTEM_ENV_PAIRS, systemPart);
  }
  if (Object.keys(accountPart).length > 0) {
    await writeEnvOverrides(sanitizeAccountId(accountId), PER_ACCOUNT_ENV_PAIRS, accountPart);
  }
}
