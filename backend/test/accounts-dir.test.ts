import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { config } from '../src/config';
import { getAccountSettingsLocation } from '../src/services/aiSettings';

// 每帳號設定原本寫死在 `<repo>/accounts`，測試（尤其是 E2E，它會以真實 HTTP 啟動整個
// 後端）因此會在開發者的工作目錄留下測試帳號。改由 ACCOUNTS_DIR 決定後，測試可以指到
// 拋棄式目錄。這裡釘住「位置一律由 config.accountsDir 推導」，避免哪天又有人寫回
// path.join(config.repoRoot, 'accounts')。

test('account settings live under config.accountsDir', () => {
  const location = getAccountSettingsLocation('some-account');
  assert.equal(location.accountDir, path.join(config.accountsDir, 'some-account'));
  assert.equal(location.envPath, path.join(config.accountsDir, 'some-account', 'settings.env'));
});

test('accountsDir defaults to <repo>/accounts when ACCOUNTS_DIR is unset', () => {
  // 這個測試 process 沒有設 ACCOUNTS_DIR，所以預設值必須維持既有行為——
  // 否則升級後既有部署會突然讀不到自己的帳號設定。
  assert.equal(config.accountsDir, path.resolve(config.repoRoot, './accounts'));
});

test('account ids are sanitised before becoming a path', () => {
  // owner_sub 來自 Google，不該直接當檔名用。
  const location = getAccountSettingsLocation('../../etc/passwd');
  assert.ok(
    location.accountDir.startsWith(config.accountsDir),
    `account dir escaped the accounts root: ${location.accountDir}`,
  );
});
