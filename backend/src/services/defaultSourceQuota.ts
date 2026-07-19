import { db } from '../db';
import { config } from '../config';
import { sanitizeAccountId } from './accountContext';

/**
 * Gates how much of the shared server-wide default LLM/TTS key an account that hasn't configured
 * its own key (see aiSettings.ts's accountHasOwnProviderKey) may use per week, so one busy
 * account can't exhaust the operator's shared budget for everyone else. Accounts with their own
 * key are never gated here — see the call sites in openai.ts / synthesizeAudio.ts.
 *
 * The reset boundary ("every Thursday") is computed on read from the wall clock, the same way
 * routes/pdfs/monthly-cost.ts derives its month-start boundary — there is no background job that
 * resets anything; a new week's bucket simply doesn't exist yet until first written.
 */

const WEEKLY_RESET_UTC_WEEKDAY = 4; // Thursday (Date#getUTCDay(): Sun=0 … Thu=4 … Sat=6)
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** ISO date (UTC, no time) of the most recent Thursday at/before `now` — the current quota week's bucket key. */
export function weekStartIso(now: Date): string {
  const daysSinceThursday = (now.getUTCDay() - WEEKLY_RESET_UTC_WEEKDAY + 7) % 7;
  const weekStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  weekStart.setUTCDate(weekStart.getUTCDate() - daysSinceThursday);
  return weekStart.toISOString().slice(0, 10);
}

/** ISO date (UTC, no time) of the next reset — one week after the current bucket's start. */
export function nextWeekStartIso(now: Date): string {
  const current = weekStartIso(now);
  const next = new Date(`${current}T00:00:00.000Z`).getTime() + WEEK_MS;
  return new Date(next).toISOString().slice(0, 10);
}

export function getDefaultSourceWeeklyQuotaUsd(): number {
  return config.defaultSourceWeeklyQuotaUsd;
}

export interface AccountWeeklyUsage {
  weekStart: string;
  nextReset: string;
  costUsd: number;
  quotaUsd: number;
  remainingUsd: number;
}

export function getAccountWeeklyUsage(accountId: string, now: Date = new Date()): AccountWeeklyUsage {
  const safeAccountId = sanitizeAccountId(accountId);
  const weekStart = weekStartIso(now);
  const row = db
    .prepare(`SELECT cost_usd FROM account_weekly_usage WHERE account_id = ? AND week_start = ?`)
    .get(safeAccountId, weekStart) as { cost_usd: number } | undefined;
  const costUsd = row?.cost_usd ?? 0;
  const quotaUsd = getDefaultSourceWeeklyQuotaUsd();
  return {
    weekStart,
    nextReset: nextWeekStartIso(now),
    costUsd,
    quotaUsd,
    remainingUsd: Math.max(0, quotaUsd - costUsd),
  };
}

/** Whether this account still has budget left in the current week (quota of 0 disables the shared default source entirely). */
export function hasDefaultSourceQuotaRemaining(accountId: string, now: Date = new Date()): boolean {
  return getAccountWeeklyUsage(accountId, now).remainingUsd > 0;
}

/** Adds `costUsd` to this account's running total for the current week. No-ops for costUsd <= 0. */
export function recordDefaultSourceCost(accountId: string, costUsd: number, now: Date = new Date()): void {
  if (!(costUsd > 0)) return;
  const safeAccountId = sanitizeAccountId(accountId);
  const weekStart = weekStartIso(now);
  const nowIso = now.toISOString();
  db.prepare(
    `INSERT INTO account_weekly_usage (account_id, week_start, cost_usd, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(account_id, week_start) DO UPDATE SET cost_usd = cost_usd + excluded.cost_usd, updated_at = excluded.updated_at`,
  ).run(safeAccountId, weekStart, costUsd, nowIso);
}

export class DefaultSourceQuotaExceededError extends Error {
  readonly code = 'DEFAULT_SOURCE_QUOTA_EXCEEDED';

  constructor(message?: string) {
    super(message ?? 'This account has exhausted its weekly free AI quota.');
    this.name = 'DefaultSourceQuotaExceededError';
  }
}

export function isDefaultSourceQuotaExceededError(err: unknown): err is DefaultSourceQuotaExceededError {
  return err instanceof DefaultSourceQuotaExceededError
    || (typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'DEFAULT_SOURCE_QUOTA_EXCEEDED');
}

export function defaultSourceQuotaExceededMessage(usage: AccountWeeklyUsage): string {
  return `本週共用 AI 額度已用完（$${usage.costUsd.toFixed(2)} / $${usage.quotaUsd.toFixed(2)}），將於 ${usage.nextReset}（UTC）自動重置；如需不受限制使用，請於「設定」新增自己的 API Key。`;
}
