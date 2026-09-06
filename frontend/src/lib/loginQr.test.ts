import test from 'node:test';
import assert from 'node:assert/strict';
import { isLocalOnlyOrigin, loginPageUrl } from './loginQr';
import { buildJoinQrImageUrl } from './joinQr';

test('the login page is the site root', () => {
  // 沒有獨立的 /login 路由——Google 登入按鈕就在 HomePage 上。
  assert.equal(loginPageUrl('https://slides.example.com'), 'https://slides.example.com/');
  assert.equal(loginPageUrl('http://192.168.1.20:3000'), 'http://192.168.1.20:3000/');
});

test('a trailing slash is not doubled', () => {
  assert.equal(loginPageUrl('https://example.com/'), 'https://example.com/');
  assert.equal(loginPageUrl('https://example.com///'), 'https://example.com/');
});

test('an empty origin degrades to a relative root instead of "undefined/"', () => {
  // 伺服器端算的時候沒有 window，寧可給一個沒有用的相對路徑，也不要把 "undefined" 編進 QR。
  assert.equal(loginPageUrl(''), '/');
  assert.equal(loginPageUrl('   '), '/');
});

test('loopback addresses are flagged as unreachable from other devices', () => {
  // 掃 QR 的是別人的手機，那支手機上的 localhost 是它自己。
  for (const origin of [
    'http://localhost:3000',
    'https://localhost',
    'http://app.localhost:5173',
    'http://127.0.0.1:3000',
    'http://127.1.2.3:8080',
    'http://[::1]:3000',
  ]) {
    assert.equal(isLocalOnlyOrigin(origin), true, origin);
  }
});

test('a LAN or public address is not flagged — those scan fine', () => {
  // 判斷看的是主機名而不是 http/https：區網 IP 是這個功能最常見的正常用法。
  for (const origin of [
    'http://192.168.1.20:3000',
    'http://10.0.0.5:3000',
    'https://slides.example.com',
    'http://makeslide.local:3000',
  ]) {
    assert.equal(isLocalOnlyOrigin(origin), false, origin);
  }
});

test('a malformed origin is not flagged, so no warning is invented', () => {
  for (const origin of ['', '   ', 'not a url']) {
    assert.equal(isLocalOnlyOrigin(origin), false, JSON.stringify(origin));
  }
});

test('the login URL survives being encoded into the shared QR generator', () => {
  // 站上只有一套 QR 產法（播放頁的分享碼用的也是它）。
  const url = loginPageUrl('https://slides.example.com');
  assert.equal(
    buildJoinQrImageUrl(url),
    'https://api.qrserver.com/v1/create-qr-code/?size=520x520&data=https%3A%2F%2Fslides.example.com%2F',
  );
});
