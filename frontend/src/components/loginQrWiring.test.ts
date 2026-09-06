import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => fs.readFileSync(path.join(srcDir, rel), 'utf8');

test('the account menu offers the login QR code and opens the dialog', () => {
  const home = read('pages/HomePage.tsx');
  assert.match(home, /key: 'login-qr'/);
  assert.match(home, /label: t\('home\.loginQr'\)/);
  assert.match(home, /onSelect: \(\) => setLoginQrOpen\(true\)/);
  // 選單項目沒有掛上對話框的話，點了什麼也不會發生。
  assert.match(home, /\{loginQrOpen && <LoginQrDialog onClose=\{\(\) => setLoginQrOpen\(false\)\} \/>\}/);
});

test('the dialog uses the one QR generator the site already has', () => {
  // 另外接一套（或改用別的服務）會讓兩種 QR 在同一台投影機上長得不一樣、失效方式也不同。
  const dialog = read('components/LoginQrDialog.tsx');
  assert.match(dialog, /from '\.\.\/lib\/joinQr'/);
  assert.match(dialog, /buildJoinQrImageUrl\(url\)/);
  assert.doesNotMatch(dialog, /api\.qrserver\.com/);
});

test('the QR image always sits on white, whatever the theme', () => {
  // 掃描靠明暗對比：深色模式下把黑色的碼放在深色面板上，相機讀不到。
  const dialog = read('components/LoginQrDialog.tsx');
  const wrapper = /<div className="[^"]*bg-white[^"]*">\s*<img/.test(dialog);
  assert.ok(wrapper, 'QR 圖外層必須是白底');
});

test('the URL is shown as text too, and can be copied', () => {
  // 掃不到的人要能把網址打進去。
  const dialog = read('components/LoginQrDialog.tsx');
  assert.match(dialog, /\{url\}<\/p>/);
  assert.match(dialog, /clipboard\?\.writeText\(url\)/);
});

test('the dialog closes the same way every other overlay does', () => {
  const dialog = read('components/LoginQrDialog.tsx');
  assert.match(dialog, /useOverlayDismiss\(onClose\)/);
  assert.match(dialog, /role="dialog"/);
  assert.match(dialog, /aria-modal="true"/);
});
