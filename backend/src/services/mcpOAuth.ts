/**
 * 最小的 OAuth 2.1 授權伺服器，只為了一件事：讓 ChatGPT 能連上 makeslide 的 MCP 端點。
 *
 * 為什麼需要這個？ChatGPT 新增自訂 connector 時，認證只有「OAuth」與「不認證」兩個選項
 * ——它不像 Claude Code 那樣可以在設定檔裡填一個 header，所以 makeslide 既有的 MCP auth
 * token 完全接不上。把 token 塞進網址（`/mcp/<token>`）也不是辦法：ChatGPT 會對網址裡帶
 * 密鑰的伺服器跳「Connector is not safe」而拒絕連線。要讓 ChatGPT 認得，就得真的講 OAuth。
 *
 * 範圍刻意做到最小，只實作 ChatGPT 這個 client 會走的路徑：
 *   - 動態註冊（RFC 7591）：ChatGPT 會自己註冊，沒有事先約定的 client_id 可用。
 *   - 授權碼流程 ＋ PKCE S256（強制，OAuth 2.1 對公開 client 的要求）。
 *   - refresh token 輪替：ChatGPT 授權一次會用很久，access token 必須能續期。
 * 沒有實作 client_credentials、implicit、device code——ChatGPT 都不會用到。
 *
 * 誰是「使用者」：授權頁要求瀏覽器帶著 makeslide 的登入 session，核可後把 access token
 * 綁到那個帳號。於是 ChatGPT 透過這個 token 做的每件事，權限都等同該帳號本人在瀏覽器裡
 * 操作——與既有 MCP token 的授權模型一致，沒有放寬任何東西。
 *
 * 密鑰一律以 SHA-256 雜湊後入庫，資料庫外洩不會直接洩漏可用的 token。這些是高熵隨機值，
 * 不是密碼，所以不需要 salt 或慢雜湊——攻擊者無從字典攻擊 256 bit 的隨機字串。
 */
import crypto from 'node:crypto';

import { db } from '../db';
import { logger } from '../logger';

/** access token 壽命。夠短，外洩時的暴露窗口有限；ChatGPT 會用 refresh token 自動續期。 */
const ACCESS_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
/** 授權碼壽命。RFC 6749 建議 10 分鐘以內，一次性使用。 */
const AUTH_CODE_TTL_MS = 10 * 60 * 1000;

export interface OAuthClient {
  clientId: string;
  clientName: string;
  redirectUris: string[];
  /** 雜湊後的 client secret；真正的公開 client 沒有，值為 null。 */
  clientSecretHash: string | null;
}

export interface RegisteredClient extends OAuthClient {
  /** 明文 secret，只在註冊當下回傳這一次，之後只留雜湊。 */
  clientSecret: string;
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function randomSecret(): string {
  return crypto.randomBytes(32).toString('base64url');
}

// ---------------------------------------------------------------------------
// 動態註冊（RFC 7591）
// ---------------------------------------------------------------------------

/**
 * ChatGPT 沒有預先登記的 client_id，它會自己送一份 metadata 過來註冊。
 *
 * 註冊時一併發一把 client_secret，但**安全性並不依賴它**：擋下「授權碼被攔截後拿去換
 * token」的是 PKCE，這也是 OAuth 2.1 對公開 client 的規範做法。發 secret 純粹是為了相容
 * ——只宣告 `none` 時 ChatGPT 會判定伺服器不支援動態註冊而整個拒絕建立 connector。
 */
export function registerOAuthClient(clientName: string, redirectUris: string[]): RegisteredClient {
  const clientId = `makeslide-${crypto.randomBytes(16).toString('hex')}`;
  // 一併發一把 secret。安全上不需要它——PKCE 才是防止授權碼被攔截後盜用的機制，OAuth 2.1
  // 也正是這樣看待公開 client 的——但 ChatGPT 只宣告 none 時會判定伺服器不支援動態註冊。
  // 發了 secret 兩邊都能接受：要用的就驗，不用的照樣靠 PKCE 過關。
  const clientSecret = randomSecret();
  db.prepare(
    `INSERT INTO mcp_oauth_clients (client_id, client_name, redirect_uris, client_secret, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(clientId, clientName, JSON.stringify(redirectUris), sha256(clientSecret), new Date().toISOString());
  logger.info({ clientId, clientName }, 'Registered MCP OAuth client');
  return { clientId, clientName, redirectUris, clientSecretHash: sha256(clientSecret), clientSecret };
}

export function getOAuthClient(clientId: string): OAuthClient | null {
  const row = db
    .prepare(`SELECT client_id, client_name, redirect_uris, client_secret FROM mcp_oauth_clients WHERE client_id = ?`)
    .get(clientId) as
    | { client_id: string; client_name: string; redirect_uris: string; client_secret: string | null }
    | undefined;
  if (!row) return null;
  let redirectUris: string[] = [];
  try {
    const parsed = JSON.parse(row.redirect_uris);
    if (Array.isArray(parsed)) redirectUris = parsed.filter((u): u is string => typeof u === 'string');
  } catch {
    redirectUris = [];
  }
  return {
    clientId: row.client_id,
    clientName: row.client_name,
    redirectUris,
    clientSecretHash: row.client_secret ?? null,
  };
}

/**
 * redirect_uri 必須逐字命中註冊時登記的其中一個。
 *
 * 這是整個流程裡最不能放寬的一項檢查：只要允許前綴或子網域比對，攻擊者就能把授權碼
 * 導去自己的網址，拿到一把等同受害者帳號的 token。所以只做完全相等比對。
 */
export function isRegisteredRedirectUri(client: OAuthClient, redirectUri: string): boolean {
  return client.redirectUris.includes(redirectUri);
}

/**
 * 驗證 client 在 token 端點出示的 secret。
 *
 * 沒帶 secret 一律放行，因為 PKCE 才是這裡真正的防護，而 OAuth 2.1 明確允許公開 client
 * 不帶 secret。帶了就必須是對的——帶一把錯的還放行，等於把這個欄位變成純裝飾。
 */
export function verifyClientSecret(client: OAuthClient, presented: string): boolean {
  if (!presented) return true;
  if (!client.clientSecretHash) return false;
  const a = Buffer.from(sha256(presented), 'utf8');
  const b = Buffer.from(client.clientSecretHash, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------
// 授權碼
// ---------------------------------------------------------------------------

export function issueAuthorizationCode(params: {
  clientId: string;
  accountId: string;
  redirectUri: string;
  codeChallenge: string;
}): string {
  const code = randomSecret();
  db.prepare(
    `INSERT INTO mcp_oauth_codes (code, client_id, account_id, redirect_uri, code_challenge, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    sha256(code),
    params.clientId,
    params.accountId,
    params.redirectUri,
    params.codeChallenge,
    new Date(Date.now() + AUTH_CODE_TTL_MS).toISOString(),
  );
  return code;
}

/** PKCE S256：驗證 code_verifier 雜湊後是否等於當初授權請求登記的 challenge。 */
function verifyPkce(codeVerifier: string, codeChallenge: string): boolean {
  const computed = crypto.createHash('sha256').update(codeVerifier, 'utf8').digest('base64url');
  const a = Buffer.from(computed, 'utf8');
  const b = Buffer.from(codeChallenge, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export type CodeRedemption =
  | { ok: true; tokens: IssuedTokens }
  | { ok: false; error: 'invalid_grant' | 'invalid_request' };

/**
 * 拿授權碼換 token。
 *
 * 授權碼一律先刪再驗（不論後續檢查通過與否），確保一次性使用：重放同一個碼的第二次
 * 請求會因為查不到而失敗，攻擊者攔截到碼也只有一次機會，而那一次還得同時握有 PKCE 的
 * code_verifier 才過得了關。
 */
export function redeemAuthorizationCode(params: {
  code: string;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
}): CodeRedemption {
  const codeHash = sha256(params.code);
  const row = db
    .prepare(
      `SELECT client_id, account_id, redirect_uri, code_challenge, expires_at
         FROM mcp_oauth_codes WHERE code = ?`,
    )
    .get(codeHash) as
    | { client_id: string; account_id: string; redirect_uri: string; code_challenge: string; expires_at: string }
    | undefined;
  db.prepare(`DELETE FROM mcp_oauth_codes WHERE code = ?`).run(codeHash);

  if (!row) return { ok: false, error: 'invalid_grant' };
  if (Date.parse(row.expires_at) < Date.now()) return { ok: false, error: 'invalid_grant' };
  if (row.client_id !== params.clientId) return { ok: false, error: 'invalid_grant' };
  if (row.redirect_uri !== params.redirectUri) return { ok: false, error: 'invalid_grant' };
  if (!params.codeVerifier || !verifyPkce(params.codeVerifier, row.code_challenge)) {
    return { ok: false, error: 'invalid_grant' };
  }

  return { ok: true, tokens: issueTokens(params.clientId, row.account_id) };
}

// ---------------------------------------------------------------------------
// access ／ refresh token
// ---------------------------------------------------------------------------

function issueTokens(clientId: string, accountId: string): IssuedTokens {
  const accessToken = randomSecret();
  const refreshToken = randomSecret();
  const now = new Date();
  db.prepare(
    `INSERT INTO mcp_oauth_tokens (access_token, refresh_token, client_id, account_id, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    sha256(accessToken),
    sha256(refreshToken),
    clientId,
    accountId,
    new Date(now.getTime() + ACCESS_TOKEN_TTL_MS).toISOString(),
    now.toISOString(),
  );
  return { accessToken, refreshToken, expiresInSeconds: Math.floor(ACCESS_TOKEN_TTL_MS / 1000) };
}

export type RefreshRedemption =
  | { ok: true; tokens: IssuedTokens }
  | { ok: false; error: 'invalid_grant' };

/**
 * 換發新 token，並把舊的那組作廢（refresh token 輪替）。
 *
 * 輪替的價值在偵測：refresh token 若被複製走，攻擊者與正常 client 之中先用的那一方會
 * 讓另一方的 token 失效，異常會浮現成「ChatGPT 突然要求重新授權」，而不是雙方長期共用
 * 同一把 token 卻無人察覺。
 */
export function redeemRefreshToken(refreshToken: string, clientId: string): RefreshRedemption {
  const hash = sha256(refreshToken);
  const row = db
    .prepare(`SELECT access_token, client_id, account_id FROM mcp_oauth_tokens WHERE refresh_token = ?`)
    .get(hash) as { access_token: string; client_id: string; account_id: string } | undefined;
  if (!row || row.client_id !== clientId) return { ok: false, error: 'invalid_grant' };
  db.prepare(`DELETE FROM mcp_oauth_tokens WHERE refresh_token = ?`).run(hash);
  return { ok: true, tokens: issueTokens(clientId, row.account_id) };
}

/**
 * 把 access token 解析成帳號 id，過期的一律不算數。
 *
 * 用雜湊當主鍵直接查，所以是索引查找而不是逐一比對——也因此不需要常數時間比較：
 * 攻擊者能觀測的只有「雜湊後的值存不存在」，而要湊出一個雜湊命中的字串，得先破解
 * SHA-256，這比任何時間側通道都難得多。
 */
export function findAccountIdByOAuthAccessToken(accessToken: string): string | null {
  if (!accessToken) return null;
  const row = db
    .prepare(`SELECT account_id, expires_at FROM mcp_oauth_tokens WHERE access_token = ?`)
    .get(sha256(accessToken)) as { account_id: string; expires_at: string } | undefined;
  if (!row) return null;
  if (Date.parse(row.expires_at) < Date.now()) return null;
  return row.account_id;
}

/**
 * 清掉沒有用處的授權碼與 token。在後端啟動時跑一次——這些東西的量很小（授權碼十分鐘就
 * 過期，token 每次續期是換掉而不是新增一列），不值得為它排一個常駐的清理工作。
 */
export function purgeExpiredOAuthState(): void {
  const now = new Date().toISOString();
  db.prepare(`DELETE FROM mcp_oauth_codes WHERE expires_at < ?`).run(now);

  // access token 過期不代表這一列沒用了——refresh token 還能換發新的一組，ChatGPT 平常
  // 就是這樣續期的。所以只刪真正的孤兒：沒有 refresh token 可用、access token 又已過期。
  db.prepare(`DELETE FROM mcp_oauth_tokens WHERE refresh_token IS NULL AND expires_at < ?`).run(now);

  // 閒置太久的授權自動失效。每次續期都會寫入新的一列並刪掉舊的，所以 created_at 反映的是
  // 「最後一次續期」而不是「當初授權」——真正還在用的連線永遠不會被這一條掃到，被掃到的
  // 是三十天沒有動靜的那些。使用者要用時重新授權一次即可。
  const idleCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare(`DELETE FROM mcp_oauth_tokens WHERE created_at < ?`).run(idleCutoff);
}
