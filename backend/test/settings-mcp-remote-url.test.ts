/**
 * 設定頁要顯示「貼進 ChatGPT 的那個網址」，而那個值是後端算的，不是前端接 location.origin
 * ——隔著反向代理時，瀏覽器看到的來源不一定是外部連得到的網址。這裡釘住兩件事：算出來的
 * 網址要跟 OAuth 探索文件裡宣告的資源網址一致（兩邊各算各的就會有一邊是錯的，而錯的那邊
 * 不會有任何錯誤訊息，只會讓 ChatGPT 連不上），以及明確設定的對外網址要蓋得過推測。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { buildApp } from '../src/server';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';

function testSessionCookie(sub: string): string {
  const payload = Buffer.from(JSON.stringify({ provider: 'google', sub, email: `${sub}@example.com` }), 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

setSystemAuthSettings({ googleAuthEnabled: false });

const ACCOUNT_SUB = 'settings-mcp-remote-url-test';
const HEADERS = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie(ACCOUNT_SUB))}` };

test('settings expose the remote MCP URL for the ChatGPT connector', async (t) => {
  // 部署用的 .env 可能設了對外網址，那會蓋掉這裡要驗的推測行為；先清掉，讓測試與這台
  // 機器怎麼部署無關（存回原值，才不會影響同一個行程裡的其他測試）。
  const savedPublicUrl = process.env.MAKESLIDE_PUBLIC_URL;
  delete process.env.MAKESLIDE_PUBLIC_URL;
  t.after(() => {
    if (savedPublicUrl === undefined) delete process.env.MAKESLIDE_PUBLIC_URL;
    else process.env.MAKESLIDE_PUBLIC_URL = savedPublicUrl;
  });

  const app = await buildApp();
  t.after(async () => { await app.close(); });

  await t.test('the URL is derived from the forwarded host, not the bind address', async () => {
    const resp = await app.inject({
      method: 'GET',
      url: '/api/system/ai-settings',
      headers: { ...HEADERS, 'x-forwarded-proto': 'https', 'x-forwarded-host': 'slides.example.com' },
    });
    assert.equal(resp.statusCode, 200);
    assert.equal(resp.json().mcp_remote_url, 'https://slides.example.com/mcp');
  });

  await t.test('an explicitly configured public URL wins over the headers', async () => {
    process.env.MAKESLIDE_PUBLIC_URL = 'https://configured.example.com:7701/';
    try {
      const resp = await app.inject({
        method: 'GET',
        url: '/api/system/ai-settings',
        headers: { ...HEADERS, 'x-forwarded-proto': 'https', 'x-forwarded-host': 'guessed.example.com' },
      });
      // 尾端斜線要被吃掉，否則使用者複製到的會是 `…:7701//mcp`。
      assert.equal(resp.json().mcp_remote_url, 'https://configured.example.com:7701/mcp');
    } finally {
      delete process.env.MAKESLIDE_PUBLIC_URL;
    }
  });

  await t.test('it matches the resource the OAuth metadata advertises', async () => {
    const headers = { ...HEADERS, 'x-forwarded-proto': 'https', 'x-forwarded-host': 'slides.example.com' };
    const settings = await app.inject({ method: 'GET', url: '/api/system/ai-settings', headers });
    const metadata = await app.inject({ method: 'GET', url: '/.well-known/oauth-protected-resource', headers });
    // 設定頁叫使用者貼的網址，必須就是 OAuth 宣告受保護的那個資源。不一致的話 ChatGPT 會
    // 拿到互相矛盾的兩個位址，而且不會有任何錯誤訊息說明為什麼連不上。
    assert.equal(settings.json().mcp_remote_url, metadata.json().resource);
  });
});
