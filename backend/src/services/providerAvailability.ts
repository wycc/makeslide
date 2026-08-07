import { currentAccountId } from './accountContext';
import { hasTestOpenAIClient } from './openai';
import {
  getRuntimeAiSettings,
  type LlmProvider,
  type RuntimeAiSettings,
  type TtsProvider,
} from './aiSettings';

/**
 * 「這個 provider 的 API key 有沒有設定」的單一判斷來源。
 *
 * 每個 provider 各自對應一把 key，而且 LLM 與 TTS 共用同一批 key（TTS 選 'gemini' 用的就是
 * `geminiApiKey`）。以前這個對照表在 openai.ts（providerApiKey，只涵蓋 OpenAI 相容的三家）、
 * admin.ts 的 openai-key-status（手寫四個 `||` 條件）與 gemini.ts 各寫一份，新增 provider 時
 * 很容易漏掉其中一處，於是「畫面說可以用、實際打下去才 401」。
 */
export function providerApiKeyOf(settings: RuntimeAiSettings, provider: LlmProvider | TtsProvider): string {
  if (provider === 'gemini') return settings.geminiApiKey;
  if (provider === 'cgu-air') return settings.cguAirApiKey;
  if (provider === 'openrouter') return settings.openrouterApiKey;
  return settings.openaiApiKey;
}

export function hasProviderKey(settings: RuntimeAiSettings, provider: LlmProvider | TtsProvider): boolean {
  return providerApiKeyOf(settings, provider).trim().length > 0;
}

export interface ProviderAvailability<P extends LlmProvider | TtsProvider> {
  /** 這類功能現在能不能用：主要 provider 有 key，或設定了次要 provider 且它有 key。 */
  enabled: boolean;
  provider: P;
  hasPrimaryKey: boolean;
  /** '' 代表沒有設定次要 provider。 */
  secondaryProvider: P | '';
  hasSecondaryKey: boolean;
}

/**
 * 判斷 enabled 時把次要 provider 也算進來：沒有 key 會被 openai.ts 的 isPermanentProviderError
 * 判為「這個 provider 這一輪不會再成功」，於是流程本來就會自動切到次要 provider（見
 * callChatJSON／synthesizeAudio 的 failover）。只看主要 provider 的話，明明還有可用備援卻把
 * 功能整個關掉，反而比舊行為更糟。
 */
function availabilityOf<P extends LlmProvider | TtsProvider>(
  settings: RuntimeAiSettings,
  provider: P,
  secondaryProvider: P | '',
): ProviderAvailability<P> {
  const hasPrimaryKey = hasProviderKey(settings, provider) || hasTestOpenAIClient();
  const hasSecondaryKey = secondaryProvider !== '' && hasProviderKey(settings, secondaryProvider);
  return {
    enabled: hasPrimaryKey || hasSecondaryKey,
    provider,
    hasPrimaryKey,
    secondaryProvider,
    hasSecondaryKey,
  };
}

export function llmAvailability(accountId: string = currentAccountId()): ProviderAvailability<LlmProvider> {
  const settings = getRuntimeAiSettings(accountId);
  return availabilityOf(settings, settings.llmProvider, settings.secondaryLlmProvider);
}

export function ttsAvailability(accountId: string = currentAccountId()): ProviderAvailability<TtsProvider> {
  const settings = getRuntimeAiSettings(accountId);
  return availabilityOf(settings, settings.ttsProvider, settings.secondaryTtsProvider);
}

export function isLlmEnabled(accountId: string = currentAccountId()): boolean {
  return llmAvailability(accountId).enabled;
}

export function isTtsEnabled(accountId: string = currentAccountId()): boolean {
  return ttsAvailability(accountId).enabled;
}

/** 給 API_KEY_MISSING 錯誤用的訊息，明講是哪個 provider 缺 key、該去哪裡補。 */
export function missingKeyMessage(kind: 'LLM' | 'TTS', provider: LlmProvider | TtsProvider): string {
  return `尚未設定 ${provider} 的 API key，${kind} 功能已停用。請到「設定 → AI 設定」填入 API key 後再試。`;
}
