import { APIError } from 'openai';
import { isApiKeyMissingError } from './apiKeyErrors';

/**
 * Maps an LLM chat-call failure to a concise, actionable zh-TW reason, so endpoints can surface
 * *why* generation failed instead of a dead-end generic message. The concrete case that motivated
 * this: an account switched to CGU Air whose gateway credit ran out — every call failed with 429
 * `credit_balance_exhausted`, the UI said only "Failed to generate custom-script animation code",
 * and the raw gateway error even embedded OpenAI's billing URL, so the user concluded the app was
 * still (wrongly) calling OpenAI. Naming the failure lets the user act on it instead of debugging
 * a provider switch that had actually worked.
 *
 * Callers should prefix the returned string with the provider's name (see
 * `currentLlmProviderLabel`) — "額度已用盡" is only actionable when it says *whose* quota.
 *
 * Deliberately never echoes the raw provider message: OpenAI's 401 body embeds the API key prefix
 * ("Incorrect API key provided: sk-…") and gateway errors can leak internal base URLs, so this
 * classifies by status/code/message and returns fixed, sanitised strings only. Returns null for
 * unrecognised errors so the caller keeps its original generic message. Mirrors
 * `describeImageEditFailure` (page-operations.ts), which does the same for image calls.
 */
export function describeLlmFailure(err: unknown): string | null {
  if (isApiKeyMissingError(err)) {
    return 'API 金鑰未設定，請到系統設定頁填入金鑰';
  }
  const status = err instanceof APIError ? err.status : undefined;
  const code = err instanceof APIError && typeof err.code === 'string' ? err.code : '';
  const type = err instanceof APIError && typeof (err as { type?: unknown }).type === 'string'
    ? String((err as { type?: unknown }).type)
    : '';
  const message = err instanceof Error ? err.message : String(err ?? '');
  const haystack = `${code} ${type} ${message}`;

  // Quota / billing exhausted — e.g. the CGU gateway's `credit_balance_exhausted` /
  // `insufficient_quota`, or OpenAI's own billing cap.
  if (/quota|insufficient|billing|credit/i.test(haystack)) {
    return 'LLM 服務額度已用盡，請儲值或改用其他 LLM 供應商';
  }
  // Bad or missing key. Check before the generic 403 branch so a 401 always reads as a key problem.
  if (status === 401 || /invalid[_ ]?api[_ ]?key|incorrect api key/i.test(message)) {
    return 'API 金鑰無效，請到系統設定頁檢查金鑰';
  }
  if (status === 403) {
    return 'LLM 服務拒絕存取，請稍後再試或聯絡管理員';
  }
  if (status === 404 || /model.*(not exist|not found|unknown)/i.test(message)) {
    return '選用的模型不存在，請到系統設定頁檢查模型名稱';
  }
  if (status === 429) {
    return 'LLM 服務請求過於頻繁（rate limit），請稍後再試';
  }
  // The OpenAI SDK surfaces timeouts as APIConnectionTimeoutError / an aborted request.
  if (/timeout|timed out|ETIMEDOUT|aborted/i.test(message)) {
    return 'LLM 回應逾時，請稍後再試';
  }
  if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|fetch failed|Connection error/i.test(message)) {
    return '無法連線到 LLM 服務，請檢查網路或 Base URL 設定';
  }
  return null;
}
