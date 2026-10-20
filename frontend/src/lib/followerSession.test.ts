import test from 'node:test';
import assert from 'node:assert/strict';
import { clearFollowerFullscreen, markFollowerFullscreen, readFollowerFullscreen, readShareToken, rememberShareToken } from './followerSession';

// 使用者回報（2026-10-20）：學生從測驗頁返回或打開沒帶參數的網址後不會被導回測驗——全螢幕跟隨只認網址參數。
function fakeStorage() {
  const map = new Map<string, string>();
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); }, removeItem: (k: string) => { map.delete(k); } };
}

test('follower fullscreen is remembered per deck until the viewer leaves fullscreen themselves', () => {
  const store = fakeStorage();
  assert.equal(readFollowerFullscreen('deck', store), false);
  markFollowerFullscreen('deck', store);
  assert.equal(readFollowerFullscreen('deck', store), true);
  assert.equal(readFollowerFullscreen('other', store), false);
  clearFollowerFullscreen('deck', store);
  assert.equal(readFollowerFullscreen('deck', store), false);
});

test('the share token is remembered per deck and an empty token is never stored', () => {
  const store = fakeStorage();
  rememberShareToken('deck', '', store);
  assert.equal(readShareToken('deck', store), '');
  rememberShareToken('deck', 'tok-1', store);
  assert.equal(readShareToken('deck', store), 'tok-1');
  assert.equal(readShareToken('', store), '', 'no deck id, no token');
});
