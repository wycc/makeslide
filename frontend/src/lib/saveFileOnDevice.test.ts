import test from 'node:test';
import assert from 'node:assert/strict';
import { canAutoDownload, isIosDevice } from './saveFileOnDevice';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const CHROME_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1';
const IPADOS_DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';

test('iPhone (Safari or Chrome) and iPadOS-as-Mac cannot auto-download; Android, desktop Mac and others can', () => {
  assert.equal(isIosDevice({ userAgent: IPHONE }), true);
  assert.equal(isIosDevice({ userAgent: CHROME_IOS }), true);
  assert.equal(isIosDevice({ userAgent: IPADOS_DESKTOP, platform: 'MacIntel', maxTouchPoints: 5 }), true);
  assert.equal(isIosDevice({ userAgent: IPADOS_DESKTOP, platform: 'MacIntel', maxTouchPoints: 0 }), false, 'a real Mac');
  assert.equal(isIosDevice({ userAgent: ANDROID, platform: 'Linux armv8l', maxTouchPoints: 5 }), false);
  assert.equal(canAutoDownload({ userAgent: IPHONE }), false);
  assert.equal(canAutoDownload({ userAgent: ANDROID }), true);
});

test('never opens the PDF in a tab (on iOS that just shows it as a page); downloads within the tap instead', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const src = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), 'saveFileOnDevice.ts'), 'utf8');
  assert.doesNotMatch(src, /window\.open\(/);
  assert.match(src, /triggerDownload\(url, filename\);\s*return \{ kind: 'downloaded' \};/);
  assert.match(src, /kind: 'shareFailed'/);
});
