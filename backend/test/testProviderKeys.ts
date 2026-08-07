import { DEFAULT_ACCOUNT_ID, accountIdFromOwnerSub } from '../src/services/accountContext';
import { setRuntimeAiSettings } from '../src/services/aiSettings';

/**
 * LLM/TTS 的入口路由現在會在「選定的 provider 沒有 API key」時直接回 400 API_KEY_MISSING
 * （routes/pdfs/shared.ts 的 replyIfLlmDisabled／replyIfTtsDisabled）。測權限、流程或狀態機
 * 而不是測 key 檢查本身的測試，用這個替相關帳號補上假 key，讓請求能通過那道守門。
 *
 * 未帶參數時只設定預設帳號（未登入／匿名情境）。
 */
export function giveTestProviderKeys(...ownerSubs: Array<string | null | undefined>): void {
  const accountIds = new Set<string>([DEFAULT_ACCOUNT_ID]);
  for (const sub of ownerSubs) {
    accountIds.add(sub ? accountIdFromOwnerSub(sub) : DEFAULT_ACCOUNT_ID);
  }
  for (const accountId of accountIds) {
    setRuntimeAiSettings(accountId, {
      openaiApiKey: 'test-openai-key',
      geminiApiKey: 'test-gemini-key',
      cguAirApiKey: 'test-cgu-air-key',
      openrouterApiKey: 'test-openrouter-key',
    });
  }
}
