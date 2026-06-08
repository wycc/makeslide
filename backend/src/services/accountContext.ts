/**
 * 多帳號設計下，每個請求／背景工作都會在「目前帳號」的情境中執行：
 * AI 設定（API key、模型、語音…）一律依此情境讀寫，避免不同使用者的設定
 * 在後端互相污染。情境一律以登入者的 Google `sub`（經過消毒成檔名安全字串）
 * 作為帳號代碼；尚未綁定擁有者的舊資料則落在 DEFAULT_ACCOUNT_ID 下。
 *
 * 情境透過 AsyncLocalStorage 傳遞，因此既有的 getRuntimeAiSettings() /
 * getOpenAIClient() 等呼叫不需要逐層改函式簽章也能取得正確的帳號。背景工作
 * （pipeline、regenerate、add-pages…）會在工作起點明確以該簡報的 owner_sub
 * 重新進入情境，確保結果不受觸發者的登入身分影響。
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export const DEFAULT_ACCOUNT_ID = process.env.MAKESLIDE_ACCOUNT_ID?.trim() || 'default';

const storage = new AsyncLocalStorage<string>();

export function sanitizeAccountId(accountId: string | null | undefined): string {
  if (!accountId) return DEFAULT_ACCOUNT_ID;
  const sanitized = accountId.trim().replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '');
  return sanitized || DEFAULT_ACCOUNT_ID;
}

/** 把簡報的 owner_sub（或登入者的 session sub）轉成帳號代碼。 */
export function accountIdFromOwnerSub(ownerSub: string | null | undefined): string {
  return sanitizeAccountId(ownerSub);
}

/** 在指定帳號情境中執行 fn；fn 內（含其觸發的非同步操作）呼叫 currentAccountId() 都會拿到這個帳號代碼。 */
export function runWithAccountId<T>(accountId: string | null | undefined, fn: () => T): T {
  return storage.run(sanitizeAccountId(accountId), fn);
}

/** 取得目前情境的帳號代碼；情境外（例如啟動流程）回傳 DEFAULT_ACCOUNT_ID。 */
export function currentAccountId(): string {
  return storage.getStore() ?? DEFAULT_ACCOUNT_ID;
}
