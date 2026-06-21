/**
 * 持久化登入時的 Google 帳號基本資料（sub/email/name/picture），讓「不是自己擁有」
 * 的簡報列表可以顯示一個人類可讀的擁有者名稱。owner_sub 本身只是 Google sub id，
 * 沒有地方能把它換成姓名/email——這裡是唯一的來源，在每次登入成功時 upsert。
 */
import { db } from '../db';

export interface AccountProfileInput {
  sub: string;
  email: string;
  name?: string;
  picture?: string;
}

interface AccountProfileRow {
  sub: string;
  email: string;
  name: string | null;
}

export function upsertAccountProfile(profile: AccountProfileInput): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO accounts (sub, email, name, picture, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(sub) DO UPDATE SET
       email = excluded.email,
       name = excluded.name,
       picture = excluded.picture,
       updated_at = excluded.updated_at`,
  ).run(profile.sub, profile.email, profile.name ?? null, profile.picture ?? null, now, now);
}

/** Best-effort display name per sub (name, falling back to email); subs never seen logging in are simply absent from the result. */
export function getAccountDisplayNames(subs: readonly (string | null | undefined)[]): Map<string, string> {
  const unique = Array.from(new Set(subs.filter((sub): sub is string => Boolean(sub))));
  const result = new Map<string, string>();
  if (unique.length === 0) return result;
  const placeholders = unique.map(() => '?').join(', ');
  const rows = db
    .prepare(`SELECT sub, email, name FROM accounts WHERE sub IN (${placeholders})`)
    .all(...unique) as AccountProfileRow[];
  for (const row of rows) {
    result.set(row.sub, row.name?.trim() || row.email);
  }
  return result;
}
