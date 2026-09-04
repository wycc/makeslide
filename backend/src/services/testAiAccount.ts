/**
 * 測試用的 AI 帳號：讓單元測試可以借用某個真實帳號的 LLM/TTS 設定去打真的 API。
 *
 * 背景：AI 設定是**每個帳號各一份**（accounts/<id>/settings.env，見 services/aiSettings.ts），
 * 而測試跑在沒有登入的情境下——`currentAccountId()` 會回 DEFAULT_ACCOUNT_ID，那份設定通常
 * 是空的。於是「這條路徑接上真的模型還會不會動」這種問題，過去只能靠手動跑 dev server 驗。
 *
 * 做法：在 `.env` 指定 `TEST_AI_ACCOUNT_ID=<帳號目錄名>`，測試就以 `runWithTestAiAccount()`
 * 進入那個帳號的情境執行——底下所有 `getRuntimeAiSettings()` / `getOpenAIClient()` 之類的既有
 * 呼叫都會自動拿到該帳號的 key、模型與語音設定，被測程式碼一行都不用改。
 *
 * 留空（預設）時 `llmTestAccount()` / `ttsTestAccount()` 會回 `{ available: false, reason }`，
 * 測試據此 `skip`，所以 CI 或沒設定 key 的機器上整套測試照常綠燈，不會因為缺 key 而紅。
 *
 * 安全性：`accounts/` 整個在 .gitignore 裡，金鑰不會進版控；這裡也只讀不寫那份設定。
 * 建議另外開一個**專用的測試帳號**（例如 accounts/test/settings.env）而不是指向自己平常
 * 在用的帳號——測試會真的花錢、也可能寫入該帳號的用量統計。
 */
import { config } from '../config';
import { runWithAccountId, sanitizeAccountId } from './accountContext';
import { getRuntimeAiSettings, type LlmProvider, type RuntimeAiSettings, type TtsProvider } from './aiSettings';
import { llmAvailability, ttsAvailability } from './providerAvailability';

/** `.env` 的 `TEST_AI_ACCOUNT_ID`，沒設定時為 null。 */
export function testAiAccountId(): string | null {
  const raw = config.testAiAccountId;
  if (!raw) return null;
  return sanitizeAccountId(raw);
}

/** 在測試帳號的情境中執行 fn。沒設定測試帳號時原地執行（等同 DEFAULT_ACCOUNT_ID）。 */
export function runWithTestAiAccount<T>(fn: () => T): T {
  const accountId = testAiAccountId();
  return accountId ? runWithAccountId(accountId, fn) : fn();
}

/** 測試帳號的完整 AI 設定；沒設定測試帳號時為 null。 */
export function testAiSettings(): RuntimeAiSettings | null {
  const accountId = testAiAccountId();
  return accountId ? getRuntimeAiSettings(accountId) : null;
}

export interface TestAiAvailability<P> {
  /** 這類功能在測試帳號上能不能真的用（provider 選好了、key 也在）。 */
  available: boolean;
  /** 不能用的原因，直接拿去當 `test(..., { skip })` 的訊息。 */
  reason: string;
  /** 會用到的 provider；不可用時為 null。 */
  provider: P | null;
  accountId: string | null;
}

const NOT_CONFIGURED =
  '未設定 TEST_AI_ACCOUNT_ID：需要真的呼叫 LLM/TTS 的測試已略過（在 .env 指定帳號目錄名即可啟用）';

function describe<P extends LlmProvider | TtsProvider>(
  kind: 'LLM' | 'TTS',
  read: (accountId: string) => { enabled: boolean; provider: P },
): TestAiAvailability<P> {
  const accountId = testAiAccountId();
  if (!accountId) return { available: false, reason: NOT_CONFIGURED, provider: null, accountId: null };
  const { enabled, provider } = read(accountId);
  if (!enabled) {
    return {
      available: false,
      reason: `測試帳號 ${accountId} 的 ${kind} provider（${provider}）沒有可用的 API key`,
      provider: null,
      accountId,
    };
  }
  return { available: true, reason: '', provider, accountId };
}

/** 測試帳號能不能真的打 LLM。 */
export function llmTestAccount(): TestAiAvailability<LlmProvider> {
  return describe('LLM', (accountId) => llmAvailability(accountId));
}

/** 測試帳號能不能真的做 TTS。 */
export function ttsTestAccount(): TestAiAvailability<TtsProvider> {
  return describe('TTS', (accountId) => ttsAvailability(accountId));
}
