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

const RAW_MESSAGE_MAX_CHARS = 300;

/**
 * The provider's own error text, made safe to show an end user. `describeLlmFailure` only gives a
 * fixed category; when a tutor-quiz question fails the learner (and the teacher they report to)
 * also needs the provider's actual words — "You have no credits remaining" points straight at
 * billing, which a generic "出題失敗" never did. Secrets are masked first: OpenAI's 401 body embeds
 * the key prefix ("Incorrect API key provided: sk-…"), Gemini keys start with `AIza`, and some
 * gateways echo `Authorization: Bearer …` or `?key=…`; URLs are dropped (see below). Returns ''
 * when there is no message.
 */
export function sanitizeLlmErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? '');
  const masked = raw
    .replace(/\bsk-[A-Za-z0-9_*\-]{4,}/g, 'sk-***')
    .replace(/\bAIza[0-9A-Za-z_\-]{10,}/g, 'AIza***')
    .replace(/\bBearer\s+[^\s"',]+/gi, 'Bearer ***')
    .replace(/([?&](?:api[_-]?)?key=)[^&\s"']+/gi, '$1***')
    // URLs go too: a gateway's 429 embeds *OpenAI's* billing URL (which once convinced a user the
    // app was still calling OpenAI after switching to CGU Air), and others leak internal base URLs.
    .replace(/https?:\/\/[^\s"'<>)]+/gi, '<URL>')
    .replace(/\s+/g, ' ')
    .trim();
  return masked.length > RAW_MESSAGE_MAX_CHARS ? `${masked.slice(0, RAW_MESSAGE_MAX_CHARS)}…` : masked;
}

/**
 * One user-facing line for an LLM failure: provider name, the classified reason when there is one,
 * and the sanitised provider message, e.g.
 * `OpenAI：LLM 服務額度已用盡，請儲值或改用其他 LLM 供應商（429 You have no credits remaining…）`.
 */
export function formatLlmFailureForUser(err: unknown, providerLabel: string): string {
  const reason = describeLlmFailure(err);
  const raw = sanitizeLlmErrorMessage(err);
  if (reason && raw) return `${providerLabel}：${reason}（${raw}）`;
  if (reason) return `${providerLabel}：${reason}`;
  return raw ? `${providerLabel} 錯誤：${raw}` : `${providerLabel} 呼叫失敗`;
}

/**
 * HTTP status to answer an LLM failure with. Never the provider's own status verbatim: a provider
 * 401 (bad key) would read to the frontend as "your login expired" and bounce the user to Google
 * sign-in. 429 is kept (it means the same thing upstream and here); everything else is 502.
 */
export function llmFailureHttpStatus(err: unknown): number {
  const status = err instanceof APIError ? err.status : (err as { status?: unknown } | null)?.status;
  return status === 429 ? 429 : 502;
}
