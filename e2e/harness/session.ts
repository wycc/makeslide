/**
 * 自動登入：直接鑄造後端認得的 session cookie。
 *
 * 為什麼不走 Google OAuth：E2E 不可能、也不該真的往 Google 跑一趟——那需要真實
 * 帳密、會被 bot 偵測擋下、而且把測試綁在外部服務的可用性上。
 *
 * 為什麼這不是「繞過驗證」：session cookie 的格式是
 * `base64url(JSON).HMAC-SHA256(payload, AUTH_SESSION_SECRET)`。我們用**與後端相同的
 * 金鑰**簽出一張合法的票，後端無從、也不需要區分它與真實登入產生的票。因此
 * `owner_sub`、每帳號 AI 設定隔離、權限判定全部照常運作——測到的是真正的登入後路徑。
 *
 * 附帶的好處是可以任意切換身分：`asTeacher()` / `asStudent()` / `asStranger()` 只是
 * 鑄造不同的 `sub`，權限測試（別人的簡報看不到、別人的成績不計入）才寫得出來。
 * 不注入 cookie 就是匿名，可用來驗證未登入行為。
 */
import crypto from 'node:crypto';
import type { BrowserContext, Cookie } from '@playwright/test';
import { E2E_SESSION_SECRET } from './stack';

export interface E2EAccount {
  sub: string;
  email: string;
  name: string;
}

/** 測試用的固定身分。sub 是後端用來歸屬資料的鍵（owner_sub）。 */
export const ACCOUNTS = {
  teacher: { sub: 'e2e-teacher', email: 'teacher@e2e.local', name: 'E2E 老師' },
  student: { sub: 'e2e-student', email: 'student@e2e.local', name: 'E2E 學生' },
  stranger: { sub: 'e2e-stranger', email: 'stranger@e2e.local', name: 'E2E 路人' },
} as const satisfies Record<string, E2EAccount>;

export type AccountName = keyof typeof ACCOUNTS;

const SESSION_COOKIE = 'makeslide_session';

/**
 * 複製 backend/src/routes/auth.ts 的簽章方式。
 *
 * 刻意不 import 後端的 `encodeSession`：那會把 E2E 綁進後端的模組載入鏈（config.ts
 * 會讀 .env、驗證環境變數、必要時 process.exit），在 Playwright worker 裡是不必要的
 * 副作用。這裡只需要 20 行純函式，且格式若哪天改了，測試會立刻以 401 告訴我們。
 */
export function mintSessionCookie(account: E2EAccount, secret = E2E_SESSION_SECRET): string {
  const payload = Buffer.from(
    JSON.stringify({ provider: 'google', sub: account.sub, email: account.email, name: account.name }),
    'utf8',
  ).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function sessionCookieFor(account: E2EAccount, baseUrl: string): Cookie {
  const url = new URL(baseUrl);
  return {
    name: SESSION_COOKIE,
    value: mintSessionCookie(account),
    domain: url.hostname,
    path: '/',
    expires: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
    httpOnly: true,
    secure: url.protocol === 'https:',
    sameSite: 'Lax',
  };
}

/** 讓這個 browser context 以指定身分登入。 */
export async function loginAs(
  context: BrowserContext,
  account: AccountName | E2EAccount,
  baseUrl: string,
): Promise<E2EAccount> {
  const resolved = typeof account === 'string' ? ACCOUNTS[account] : account;
  await context.clearCookies({ name: SESSION_COOKIE });
  await context.addCookies([sessionCookieFor(resolved, baseUrl)]);
  return resolved;
}

/** 登出：測試「未登入看到什麼」時使用。 */
export async function logout(context: BrowserContext): Promise<void> {
  await context.clearCookies({ name: SESSION_COOKIE });
}

/** 供直接打 API（不經瀏覽器）的測試使用。 */
export function authHeaderFor(account: AccountName | E2EAccount): Record<string, string> {
  const resolved = typeof account === 'string' ? ACCOUNTS[account] : account;
  return { cookie: `${SESSION_COOKIE}=${encodeURIComponent(mintSessionCookie(resolved))}` };
}
