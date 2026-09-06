import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// 真的把對話框渲染出來，驗的是使用者實際會看到的東西：QR 圖指向哪個網址、掃不到時網址是否
// 也寫著、以及 localhost 的警告有沒有在該出現的時候出現。接線守門（loginQrWiring）只看得到
// 原始碼長什麼樣，看不到這些。
//
// `window.location.origin` 是這個元件唯一的輸入，所以每個案例先把它換掉再載入元件。
// navigator 不用假造：只有按下「複製網址」才會碰到它，渲染時不會。
async function renderAt(origin: string): Promise<string> {
  const url = new URL(origin);
  (globalThis as { window?: unknown }).window = {
    location: { origin, href: origin, hostname: url.hostname },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    addEventListener: () => {},
    removeEventListener: () => {},
    setTimeout: () => 0,
    matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
  };
  // 每個案例重新載入，模組載入時讀到的是這一輪的 window。
  const mod = await import(`./LoginQrDialog?origin=${encodeURIComponent(origin)}`);
  return renderToStaticMarkup(createElement(mod.default, { onClose: () => {} }));
}

test('QR 圖編的是這個站的登入首頁', async () => {
  const out = await renderAt('https://slides.example.com');
  assert.match(
    out,
    /src="https:\/\/api\.qrserver\.com\/v1\/create-qr-code\/\?size=520x520&amp;data=https%3A%2F%2Fslides\.example\.com%2F"/,
  );
  // 掃不到的人要能自己把網址打進去。
  assert.ok(out.includes('https://slides.example.com/'), '網址本身也要寫出來');
});

test('QR 圖放在白底上，深色模式也掃得到', async () => {
  const out = await renderAt('https://slides.example.com');
  assert.match(out, /<div class="[^"]*bg-white[^"]*"><img/);
});

test('區網網址不會跳出「只有本機連得到」的警告', async () => {
  const out = await renderAt('http://192.168.1.20:3000');
  assert.ok(!out.includes('localhost'), '區網 IP 是這個功能最正常的用法，不該被警告');
  assert.match(out, /data=http%3A%2F%2F192\.168\.1\.20%3A3000%2F/);
});

test('localhost 會先講清楚別人掃不到', async () => {
  const out = await renderAt('http://localhost:3000');
  assert.ok(out.includes('localhost'), '應顯示只有本機連得到的警告');
});

test('對話框是有名字的 modal', async () => {
  const out = await renderAt('https://slides.example.com');
  assert.match(out, /role="dialog"/);
  assert.match(out, /aria-modal="true"/);
  assert.match(out, /aria-labelledby="login-qr-title"/);
  assert.match(out, /id="login-qr-title"/);
});
